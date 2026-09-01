/**
 * Postgres-backed rate-limit store.
 *
 * Implements the same interface as the in-memory store used in tests, so the
 * limiting logic in ratelimit.mjs is identical in both. The difference that
 * matters is that this one is shared across serverless instances.
 */

import { query } from './db.mjs';

export function postgresStore() {
  return {
    async get(key) {
      const { rows } = await query('SELECT count, reset_at FROM auth_rate_limits WHERE key = $1', [key]);
      if (rows.length === 0) return null;
      return { count: rows[0].count, resetAt: new Date(rows[0].reset_at).getTime() };
    },
    async set(key, bucket) {
      // Upsert so concurrent instances converge rather than racing on
      // read-then-write.
      await query(
        `INSERT INTO auth_rate_limits (key, count, reset_at) VALUES ($1, $2, to_timestamp($3 / 1000.0))
         ON CONFLICT (key) DO UPDATE SET count = EXCLUDED.count, reset_at = EXCLUDED.reset_at`,
        [key, bucket.count, bucket.resetAt]
      );
    },
  };
}

/** Housekeeping for expired buckets. Safe to call on a schedule. */
export async function pruneRateLimits() {
  const { rowCount } = await query('DELETE FROM auth_rate_limits WHERE reset_at < now()');
  return rowCount;
}
