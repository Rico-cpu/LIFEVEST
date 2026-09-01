'use client';

/**
 * Splash — §25.
 *
 * Minimal and brief. A splash screen is a cost paid by every visitor, so it
 * earns its place only by covering work that is genuinely happening, and it
 * gets out of the way fast. Once per session, not once per navigation.
 *
 * Skipped entirely under prefers-reduced-motion: an animation whose only
 * purpose is decoration should not run for someone who asked for less of it.
 */

import { useEffect, useState } from 'react';

const SEEN_KEY = 'veyra.splash.seen';
export const SPLASH_MS = 900;

export function splashAlreadySeen() {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // Private browsing and blocked storage both throw. Failing to remember is
    // harmless; failing to render is not.
    return false;
  }
}

export function markSplashSeen() {
  try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* not important enough to handle */ }
}

export default function Splash({ onDone }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { markSplashSeen(); onDone(); return; }

    const out = setTimeout(() => setLeaving(true), SPLASH_MS);
    const done = setTimeout(() => { markSplashSeen(); onDone(); }, SPLASH_MS + 260);
    return () => { clearTimeout(out); clearTimeout(done); };
  }, [onDone]);

  return (
    <div className={`vy-splash${leaving ? ' is-leaving' : ''}`} role="status" aria-label="Loading Veyra">
      <div className="vy-splash-mark">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path className="vy-splash-s1" d="M3 6.2c6.2 0 5.2 5.8 10.4 5.8" />
          <path className="vy-splash-s2" d="M3 12h10.4" />
          <path className="vy-splash-s3" d="M3 17.8c6.2 0 5.2-5.8 10.4-5.8" />
          <circle className="vy-splash-dot" cx="18.4" cy="12" r="2.1" fill="currentColor" stroke="none" />
        </svg>
      </div>
      <div className="vy-splash-word">Veyra</div>
    </div>
  );
}
