'use client';

/**
 * Welcome — §6.
 *
 * Shown once, then never again. Its job is to frame what someone is about to
 * look at, not to collect anything: no questionnaire, no goal picker, no
 * "connect your accounts" button that cannot connect anything.
 *
 * That last point is the constraint that shaped this screen. The specification
 * asks for an onboarding flow that connects institutions; nothing here can, so
 * offering it would be a fake control (§80). It says what is real instead.
 */

import { useState } from 'react';

const KEY = 'veyra.welcomed';

export function alreadyWelcomed() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export default function Welcome({ onDone }) {
  const [leaving, setLeaving] = useState(false);

  function dismiss() {
    try { localStorage.setItem(KEY, '1'); } catch { /* preference only */ }
    setLeaving(true);
    setTimeout(onDone, 220);
  }

  return (
    <div className={`vy-welcome${leaving ? ' is-leaving' : ''}`}>
      <p className="vy-greeting" style={{ marginTop: 0 }}>Welcome to Veyra</p>
      <h1 className="vy-headline" style={{ marginBottom: 'var(--s2)' }}>
        Your money, intelligently routed.
      </h1>
      <p className="vy-sub" style={{ marginBottom: 'var(--s4)' }}>
        Veyra understands your financial position, decides what is worth doing next,
        explains why, and acts only inside rules you set.
      </p>

      <div className="vy-notice vy-notice-review">
        <div className="vy-notice-title">What you are about to see</div>
        The decision engine is live — the financial model, the policy and risk checks,
        the disclosure gate and the audit trail all run for real, on sample data.
        Execution is deliberately gated: no institution is connected and no money can move.
      </div>

      <ul className="vy-welcome-list">
        <li>
          <strong>Every number is reconstructible.</strong>
          <span>Open “Why?” on Safe to Deploy and the calculation appears line by line.</span>
        </li>
        <li>
          <strong>Nothing moves without you.</strong>
          <span>Review a recommendation: approval stays disabled until each risk disclosure is acknowledged.</span>
        </li>
        <li>
          <strong>Everything is on the record.</strong>
          <span>Activity holds a hash-chained log of who authorized what, and under which rules.</span>
        </li>
      </ul>

      <button className="vy-btn vy-btn-primary vy-welcome-cta" onClick={dismiss}>
        Show me the financial picture
      </button>
    </div>
  );
}
