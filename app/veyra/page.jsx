/**
 * Server entry for the Veyra route.
 *
 * Exists so this segment can opt out of static prerendering. The strict CSP in
 * middleware.js stamps a per-request nonce onto Next's hydration scripts, and a
 * statically prerendered document cannot carry one — the nonce in the header
 * would match nothing and the page would never hydrate.
 *
 * Not a workaround: a page that will render someone's financial position
 * behind a login must not be served from a shared edge cache anyway.
 */
import { redirect } from 'next/navigation';
import { auth, authConfig } from '../../auth.js';
import VeyraApp from './VeyraApp';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Veyra',
  description: 'Connect your accounts. Set your rules. Make every dollar intentional.',
};

export default async function Page() {
  const cfg = authConfig();

  // Gate on the server, not in middleware. auth() runs in the Node runtime, so
  // it performs the full session check including the session_version lookup
  // that makes a JWT revocable — middleware on the Edge could only decode the
  // cookie, and would happily admit a session that had already been revoked.
  //
  // If this deployment has no authentication configured, there is nothing to
  // sign in with, and locking everyone out of a demonstration would be worse
  // than leaving it open. Fail open only in that specific case, and only
  // because no user data exists to protect.
  if (cfg.configured) {
    const session = await auth();
    if (!session?.user) {
      redirect(`/signin?callbackUrl=${encodeURIComponent('/veyra')}`);
    }
  }

  return <VeyraApp />;
}
