/**
 * LifeVest, the earlier prototype. Moved off `/` so the root can send visitors
 * straight to Veyra, and kept intact on its own route rather than deleted —
 * it is a separate app, not something to merge into Veyra.
 *
 * Renders per request so the CSP nonce in middleware.js reaches Next's
 * hydration scripts. The component itself is unchanged.
 */
import LifeVest from './LifeVest';

export const dynamic = 'force-dynamic';

export default function Page() {
  return <LifeVest />;
}
