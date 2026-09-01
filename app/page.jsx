/**
 * Server entry for the LifeVest route. Renders per request so the CSP nonce in
 * middleware.js can be applied to Next's hydration scripts. The component
 * itself is unchanged, in ./LifeVest.jsx.
 */
import LifeVest from './LifeVest';

export const dynamic = 'force-dynamic';

export default function Page() {
  return <LifeVest />;
}
