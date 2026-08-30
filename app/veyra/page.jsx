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
import VeyraApp from './VeyraApp';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Veyra',
  description: 'Connect your accounts. Set your rules. Make every dollar intentional.',
};

export default function Page() {
  return <VeyraApp />;
}
