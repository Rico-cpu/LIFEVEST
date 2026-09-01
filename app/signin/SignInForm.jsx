'use client';

/**
 * One form for both signing in and creating an account, because they are the
 * same three fields and a separate page would only add a decision.
 *
 * Deliberate details:
 *   - Errors are generic on sign-in. "No account with that email" is an
 *     enumeration oracle, and a stranger should not be able to discover who
 *     banks here.
 *   - The submit button reports progress and disables, because hashing takes
 *     real time by design and a second click must not create a second attempt.
 *   - Nothing is stored client-side. The session is an httpOnly cookie the
 *     script cannot read.
 */

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import './../veyra/veyra.css';

export default function SignInForm({ configured, missing, providers }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const isSignUp = mode === 'signup';

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (isSignUp) {
        const res = await fetch('/api/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? 'Could not create the account.');
          return;
        }
        // Deliberately identical whether or not the address was already taken.
        setNotice('Account ready. Signing you in…');
      }

      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError(
          isSignUp
            ? 'Account created, but sign-in failed. Try signing in.'
            : 'Those details did not match an account.'
        );
        return;
      }
      window.location.href = '/veyra';
    } catch {
      setError('Something interrupted the request. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <div className="vy">
        <main className="vy-shell vy-auth">
          <h1 className="vy-headline" style={{ marginBottom: 'var(--s2)' }}>
            Authentication is not configured
          </h1>
          <div className="vy-notice vy-notice-review">
            <div className="vy-notice-title">This deployment cannot sign anyone in</div>
            Set the following and redeploy:
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {missing.map((m) => <li key={m}><code>{m}</code></li>)}
            </ul>
          </div>
          <p className="vy-sub">
            Nothing is faked in the meantime: there is no stub session and no way in.
            The demonstration remains available without an account.
          </p>
          <a className="vy-btn" href="/veyra" style={{ display: 'inline-flex', alignItems: 'center', marginTop: 'var(--s2)' }}>
            Continue to the demonstration
          </a>
        </main>
      </div>
    );
  }

  return (
    <div className="vy">
      <main className="vy-shell vy-auth">
        <h1 className="vy-headline" style={{ marginBottom: 'var(--s1)' }}>
          {isSignUp ? 'Create your Veyra account' : 'Sign in to Veyra'}
        </h1>
        <p className="vy-sub" style={{ marginBottom: 'var(--s4)' }}>
          {isSignUp
            ? 'One account, then connect your financial life.'
            : 'Welcome back.'}
        </p>

        {error && (
          <div className="vy-notice vy-notice-risk" role="alert">
            {error}
          </div>
        )}
        {notice && <div className="vy-notice vy-notice-info">{notice}</div>}

        <form onSubmit={onSubmit} noValidate>
          {isSignUp && (
            <div className="vy-field">
              <label htmlFor="name">Name <span className="vy-optional">optional</span></label>
              <input
                id="name" className="vy-input" type="text" autoComplete="name"
                value={name} onChange={(e) => setName(e.target.value)} disabled={busy}
              />
            </div>
          )}

          <div className="vy-field">
            <label htmlFor="email">Email</label>
            <input
              id="email" className="vy-input" type="email" required
              autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck="false"
              value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy}
            />
          </div>

          <div className="vy-field">
            <label htmlFor="password">Password</label>
            <input
              id="password" className="vy-input" type="password" required
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy}
              aria-describedby={isSignUp ? 'pw-hint' : undefined}
            />
            {isSignUp && (
              <p id="pw-hint" className="vy-sub" style={{ fontSize: 'var(--t-micro)' }}>
                At least 12 characters. Length matters more than symbols — a passphrase is fine.
              </p>
            )}
          </div>

          <button className="vy-btn vy-btn-primary vy-auth-submit" type="submit" disabled={busy}>
            {busy ? 'Working…' : isSignUp ? 'Create account' : 'Sign in'}
          </button>
        </form>

        {providers.includes('google') && (
          <>
            <div className="vy-auth-divider"><span>or</span></div>
            <button
              className="vy-btn vy-auth-submit"
              onClick={() => signIn('google', { callbackUrl: '/veyra' })}
              disabled={busy}
            >
              Continue with Google
            </button>
          </>
        )}

        <p className="vy-sub" style={{ marginTop: 'var(--s3)' }}>
          {isSignUp ? 'Already have an account? ' : 'No account yet? '}
          <button
            className="vy-link"
            type="button"
            onClick={() => { setMode(isSignUp ? 'signin' : 'signup'); setError(null); setNotice(null); }}
          >
            {isSignUp ? 'Sign in' : 'Create one'}
          </button>
        </p>

        <footer className="vy-foot">
          Veyra is a demonstration. The decision engine is live; execution is deliberately
          gated — no institution is connected and no money can move.{' '}
          <a href="/legal">Terms, privacy &amp; disclosures</a>
        </footer>
      </main>
    </div>
  );
}
