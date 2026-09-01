/**
 * Authentication configuration.
 *
 * Auth.js rather than a hand-rolled session system. Writing your own auth is
 * the classic way to put a subtle, expensive hole in a financial product, and
 * nothing here is novel enough to justify it.
 *
 * Session strategy is JWT, with one addition that matters: every token carries
 * the user's `session_version`, and it is re-checked against the database on
 * each request. Bumping that column signs the user out everywhere immediately.
 * Plain JWTs cannot be revoked, which is unacceptable for an application that
 * will eventually authorize money movement.
 */

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { query, logAuthEvent, authConfig } from './lib/auth/db.mjs';
import { postgresStore } from './lib/auth/store.mjs';
import { verifyPassword, hashPassword, needsRehash, normalizeEmail, validEmail } from './lib/auth/password.mjs';
import { checkSignIn, recordFailure, recordSuccess } from './lib/auth/ratelimit.mjs';

const cfg = authConfig();

/** Providers are assembled from what is actually configured. */
function providers() {
  const list = [];

  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    list.push(Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: false,
    }));
  }

  if (process.env.DATABASE_URL) {
    list.push(Credentials({
      id: 'credentials',
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw, request) {
        const email = normalizeEmail(raw?.email);
        const password = typeof raw?.password === 'string' ? raw.password : '';
        const source = sourceAddress(request);
        const store = postgresStore();

        if (!validEmail(email) || password.length === 0) return null;

        const gate = await checkSignIn(store, { identifier: email, source });
        if (!gate.allowed) {
          await logAuthEvent({ event: 'SIGNIN_RATE_LIMITED', identifier: email, source });
          // Auth.js surfaces this as a generic failure to the client, which is
          // what we want: the message must not distinguish rate limiting from
          // a wrong password.
          return null;
        }

        const { rows } = await query(
          'SELECT id, name, email, image, password_hash, session_version FROM users WHERE LOWER(email) = $1',
          [email]
        );
        const user = rows[0];

        // Hash even when the account does not exist, so the response time does
        // not reveal whether an email is registered.
        const stored = user?.password_hash ?? DUMMY_HASH;
        const ok = await verifyPassword(password, stored);

        if (!user || !user.password_hash || !ok) {
          await recordFailure(store, { identifier: email, source });
          await logAuthEvent({ event: 'SIGNIN_FAILED', userId: user?.id ?? null, identifier: email, source });
          return null;
        }

        await recordSuccess(store, { identifier: email, source });

        // The plaintext is only available here, so this is the one moment a
        // hash can be upgraded to current parameters.
        if (needsRehash(user.password_hash)) {
          try {
            const upgraded = await hashPassword(password);
            await query('UPDATE users SET password_hash = $1 WHERE id = $2', [upgraded, user.id]);
          } catch (err) {
            console.error('[auth] rehash failed:', err.message);
          }
        }

        await logAuthEvent({ event: 'SIGNIN_SUCCESS', userId: user.id, identifier: email, source });
        return {
          id: String(user.id),
          email: user.email,
          name: user.name,
          image: user.image,
          sessionVersion: user.session_version,
        };
      },
    }));
  }

  return list;
}

/**
 * A well-formed hash of a value nobody can supply. Verifying against it costs
 * the same as verifying a real one, which is the point.
 */
const DUMMY_HASH =
  'scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

function sourceAddress(request) {
  try {
    const h = request?.headers;
    if (!h) return 'unknown';
    const get = typeof h.get === 'function' ? (k) => h.get(k) : (k) => h[k];
    // Vercel sets x-forwarded-for; take the first hop, which is the client.
    const fwd = get('x-forwarded-for');
    if (fwd) return String(fwd).split(',')[0].trim();
    return get('x-real-ip') || 'unknown';
  } catch {
    return 'unknown';
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Auth.js needs a secret to sign tokens. Without one it must fail loudly at
  // boot rather than silently issuing forgeable sessions.
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  providers: providers(),

  session: {
    strategy: 'jwt',
    // Short enough that a stolen token has limited value; long enough not to
    // interrupt a working session.
    maxAge: 60 * 60 * 12,
    updateAge: 60 * 15,
  },

  pages: {
    signIn: '/signin',
    error: '/signin',
  },

  cookies: {
    sessionToken: {
      name: cfg.secureCookies ? '__Secure-veyra.session' : 'veyra.session',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: cfg.secureCookies,
      },
    },
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.sv = user.sessionVersion ?? 1;
        return token;
      }

      // Re-check the version on subsequent requests. This is what makes a JWT
      // session revocable: bump session_version and every existing token stops
      // validating on its next use.
      if (token?.uid) {
        try {
          const { rows } = await query('SELECT session_version FROM users WHERE id = $1', [token.uid]);
          if (rows.length === 0 || rows[0].session_version !== token.sv) {
            return null; // forces sign-out
          }
        } catch (err) {
          // A database outage must not silently extend a session that may have
          // been revoked. Fail closed.
          console.error('[auth] session version check failed:', err.message);
          return null;
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token?.uid && session.user) session.user.id = String(token.uid);
      return session;
    },
  },

  events: {
    async signOut(message) {
      const userId = message?.token?.uid ?? null;
      if (userId) await logAuthEvent({ event: 'SIGNOUT', userId });
    },
  },
});

export { authConfig };
