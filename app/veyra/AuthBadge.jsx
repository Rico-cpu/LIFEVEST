'use client';

/**
 * Session state in the top bar.
 *
 * Reads /api/auth/session directly rather than pulling in a SessionProvider:
 * one fetch, no context wrapping the whole tree, and it degrades to the
 * signed-out state if auth is not configured on this deployment.
 */

import { useEffect, useState } from 'react';

export default function AuthBadge() {
  const [state, setState] = useState({ status: 'loading', user: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/session', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setState({ status: 'ready', user: data?.user ?? null });
      } catch {
        if (!cancelled) setState({ status: 'ready', user: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function signOut() {
    const { csrfToken } = await (await fetch('/api/auth/csrf')).json();
    await fetch('/api/auth/signout', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, callbackUrl: '/veyra' }),
    });
    window.location.reload();
  }

  // Render nothing until known, rather than flashing "Sign in" at someone who
  // is already signed in.
  if (state.status === 'loading') return null;

  if (!state.user) {
    return <a className="vy-tab vy-authbadge" href="/signin">Sign in</a>;
  }

  return (
    <span className="vy-authbadge">
      <span className="vy-authbadge-who" title={state.user.email}>{state.user.email}</span>
      <button className="vy-link" onClick={signOut}>Sign out</button>
    </span>
  );
}
