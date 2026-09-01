/**
 * Database access for authentication.
 *
 * Configuration is checked, never assumed. If the app is deployed without a
 * database it must say so plainly rather than throwing a stack trace at a user
 * trying to sign in — an unconfigured integration is a state to display, not a
 * crash. See §80 of the build specification.
 */

import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** @type {pg.Pool | null} */
let pool = null;

/** What must be present for authentication to function. */
export function authConfig() {
  const missing = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.AUTH_SECRET) missing.push('AUTH_SECRET');

  const providers = [];
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) providers.push('google');
  // Email + password needs no external service, so it is always available once
  // a database exists.
  if (process.env.DATABASE_URL) providers.push('credentials');

  return {
    configured: missing.length === 0,
    missing,
    providers,
    // Cookies are only marked Secure over HTTPS; forcing it in local http
    // development silently breaks sign-in.
    secureCookies: (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? '').startsWith('https://')
      || process.env.VERCEL === '1',
  };
}

export function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      // TLS is governed by `sslmode` in the connection string, which managed
      // providers set to `require` — pg resolves that to full verification.
      //
      // Deliberately NOT `rejectUnauthorized: false`. That disables
      // certificate validation and turns TLS into encryption without
      // authentication, which is exactly what a man-in-the-middle needs. It is
      // also unnecessary: Neon and every other managed Postgres presents a
      // certificate that verifies against the public roots.
      ssl: process.env.PGSSLMODE === 'disable' ? false : undefined,
      max: Number(process.env.PGPOOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => {
      console.error('[auth] idle postgres client error:', err.message);
    });
  }
  return pool;
}

/** @param {string} text @param {any[]} [params] */
export async function query(text, params = []) {
  const res = await getPool().query(text, params);
  return res;
}

/** Apply the schema. Idempotent — every statement is IF NOT EXISTS. */
export async function migrate() {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(join(here, 'schema.sql'), 'utf8');
  await getPool().query(sql);
  return { ok: true };
}

/**
 * Record a security-relevant authentication event.
 * Never throws into the caller: failing to write a log line must not break a
 * sign-in, but it must be visible in the server logs.
 */
export async function logAuthEvent({ event, userId = null, identifier = null, source = null, detail = null }) {
  try {
    await query(
      'INSERT INTO auth_events (event, user_id, identifier, source, detail) VALUES ($1,$2,$3,$4,$5)',
      [event, userId, identifier, source, detail]
    );
  } catch (err) {
    console.error('[auth] failed to record auth event', event, err.message);
  }
}
