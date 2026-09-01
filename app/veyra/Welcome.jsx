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
      <div className="vy-meta" style={{ marginBottom: 'var(--s3)' }}>
        <span>Understand</span><span>Decide</span><span>Explain</span><span>Approve</span><span>Execute</span>
      </div>

      <div className="vy-facts">
        <div className="vy-fact"><span className="vy-fact-k">Decision engine</span><span className="vy-fact-v">Live</span></div>
        <div className="vy-fact"><span className="vy-fact-k">Data</span><span className="vy-fact-v">Sample</span></div>
        <div className="vy-fact"><span className="vy-fact-k">Institutions connected</span><span className="vy-fact-v">None</span></div>
        <div className="vy-fact"><span className="vy-fact-k">Money movement</span><span className="vy-fact-v">Gated</span></div>
      </div>

      <ul className="vy-welcome-list">
        <li>
          <strong>Why?</strong>
          <span>Every figure reconstructs line by line.</span>
        </li>
        <li>
          <strong>Approvals</strong>
          <span>Disabled until each risk disclosure is acknowledged.</span>
        </li>
        <li>
          <strong>Activity</strong>
          <span>Hash-chained log of who authorized what.</span>
        </li>
      </ul>

      <button className="vy-btn vy-btn-primary vy-welcome-cta" onClick={dismiss}>
        Show me the financial picture
      </button>
    </div>
  );
}
