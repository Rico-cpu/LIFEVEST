/**
 * Sign in / create account.
 *
 * Renders per request so the CSP nonce reaches Next's hydration scripts, and so
 * the configuration state is read fresh rather than baked in at build time.
 */
import { authConfig } from '../../lib/auth/db.mjs';
import SignInForm from './SignInForm';
import '../veyra/veyra.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Veyra — Sign in',
  description: 'Sign in to Veyra.',
};

export default function SignInPage() {
  const cfg = authConfig();
  return <SignInForm configured={cfg.configured} missing={cfg.missing} providers={cfg.providers} />;
}
