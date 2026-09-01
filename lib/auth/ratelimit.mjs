/**
 * Rate limiting for authentication.
 *
 * Two separate budgets, because they defend against different attacks:
 *
 *   - per identifier (the email being targeted) stops an attacker grinding one
 *     account from many addresses.
 *   - per source (IP) stops one client spraying many accounts.
 *
 * Both must pass. Checking only one leaves the other attack wide open, and
 * credential stuffing specifically uses many accounts from few sources.
 *
 * The store is injected so the same logic runs against an in-memory map in
 * tests and a shared table in production. On serverless, per-instance memory is
 * not a rate limiter — several instances each get their own budget — so the
 * production store must be shared state.
 */

/**
 * @typedef {Object} Bucket
 * @property {number} count
 * @property {number} resetAt  epoch ms
 *
 * @typedef {Object} LimitStore
 * @property {(key: string) => Promise<Bucket|null>} get
 * @property {(key: string, bucket: Bucket) => Promise<void>} set
 */

export const LIMITS = Object.freeze({
  /** Failed sign-ins against one account. */
  identifier: { max: 8, windowMs: 15 * 60 * 1000 },
  /** Attempts from one source address, across all accounts. */
  source: { max: 30, windowMs: 15 * 60 * 1000 },
  /** New accounts from one source. */
  signup: { max: 5, windowMs: 60 * 60 * 1000 },
});

/** A store backed by a Map. Correct for a single process; not for serverless. */
export function memoryStore() {
  /** @type {Map<string, Bucket>} */
  const map = new Map();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, bucket) {
      map.set(key, bucket);
    },
    /** test helper */
    _map: map,
  };
}

/**
 * Consume one unit from a budget.
 *
 * @param {LimitStore} store
 * @param {string} key
 * @param {{max:number, windowMs:number}} limit
 * @param {{ now?: number }} [opts]
 * @returns {Promise<{allowed:boolean, remaining:number, retryAfterMs:number}>}
 */
export async function consume(store, key, limit, opts = {}) {
  const now = opts.now ?? Date.now();
  const existing = await store.get(key);

  if (!existing || existing.resetAt <= now) {
    const bucket = { count: 1, resetAt: now + limit.windowMs };
    await store.set(key, bucket);
    return { allowed: true, remaining: limit.max - 1, retryAfterMs: 0 };
  }

  if (existing.count >= limit.max) {
    return { allowed: false, remaining: 0, retryAfterMs: existing.resetAt - now };
  }

  const bucket = { count: existing.count + 1, resetAt: existing.resetAt };
  await store.set(key, bucket);
  return { allowed: true, remaining: limit.max - bucket.count, retryAfterMs: 0 };
}

/**
 * Inspect a budget without consuming from it.
 * @param {LimitStore} store @param {string} key @param {{max:number}} limit
 */
export async function peek(store, key, limit, opts = {}) {
  const now = opts.now ?? Date.now();
  const existing = await store.get(key);
  if (!existing || existing.resetAt <= now) return { allowed: true, remaining: limit.max, retryAfterMs: 0 };
  return {
    allowed: existing.count < limit.max,
    remaining: Math.max(0, limit.max - existing.count),
    retryAfterMs: Math.max(0, existing.resetAt - now),
  };
}

/**
 * Clear a budget. Called after a *successful* sign-in so a person who
 * mistyped their password a few times is not left throttled.
 * @param {LimitStore} store @param {string} key
 */
export async function reset(store, key) {
  await store.set(key, { count: 0, resetAt: 0 });
}

/**
 * The full check for a sign-in attempt. Both budgets are consulted, and the
 * stricter outcome wins.
 *
 * @param {LimitStore} store
 * @param {{ identifier: string, source: string }} ctx
 * @param {{ now?: number }} [opts]
 */
export async function checkSignIn(store, ctx, opts = {}) {
  const id = await peek(store, `id:${ctx.identifier}`, LIMITS.identifier, opts);
  const src = await peek(store, `src:${ctx.source}`, LIMITS.source, opts);
  if (!id.allowed || !src.allowed) {
    return {
      allowed: false,
      retryAfterMs: Math.max(id.retryAfterMs, src.retryAfterMs),
      // Never say which budget tripped: that tells an attacker whether they
      // are being limited by account or by address, which is a free hint about
      // how to spread the attack.
      reason: 'Too many attempts. Try again later.',
    };
  }
  return { allowed: true, retryAfterMs: 0 };
}

/** Record a failed attempt against both budgets. */
export async function recordFailure(store, ctx, opts = {}) {
  await consume(store, `id:${ctx.identifier}`, LIMITS.identifier, opts);
  await consume(store, `src:${ctx.source}`, LIMITS.source, opts);
}

/** Record a success: clear the account budget, keep the source budget. */
export async function recordSuccess(store, ctx) {
  await reset(store, `id:${ctx.identifier}`);
}
