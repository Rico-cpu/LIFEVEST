/**
 * The Financial Twin — the single normalized model every other engine reads.
 *
 * Design rule: the Twin is an immutable *snapshot*. Every policy evaluation,
 * approval, and execution binds to `snapshot.version`. If the underlying data
 * moves between "user approved" and "system executed", the approval is void.
 * This is the TOCTOU defence, and it is the thing that separates a real
 * financial authorization system from a dashboard with buttons.
 */

import { assertCents } from './money.mjs';

/**
 * @typedef {'checking'|'savings'|'brokerage'|'retirement'|'credit_card'|'loan'|'mortgage'|'property'} AccountType
 * @typedef {'liquid'|'semi_liquid'|'illiquid'} Liquidity
 *
 * @typedef {Object} Account
 * @property {string} id
 * @property {string} name
 * @property {string} institution
 * @property {AccountType} type
 * @property {number} balanceCents  positive = asset, positive on liabilities = amount owed
 * @property {Liquidity} liquidity
 * @property {number} [aprBps]      annual rate in basis points (liabilities)
 * @property {boolean} [isLiability]
 * @property {string} [earmarkedFor] goal id this balance is reserved for; earmarked
 *                                   cash is liquid but NOT deployable
 * @property {ConnectionState} [connectionState] link health; defaults to 'connected'
 * @property {string} [lastSyncedAt] ISO timestamp of the last successful sync
 *
 * @typedef {Object} Obligation  a known, dated outflow (bill, autopay, card statement)
 * @property {string} id
 * @property {string} label
 * @property {number} amountCents
 * @property {string} dueDate      ISO date
 * @property {string} accountId    account it will be drawn from
 * @property {boolean} essential
 *
 * @typedef {Object} RecurringFlow
 * @property {string} id
 * @property {string} label
 * @property {number} amountCents
 * @property {'in'|'out'} direction
 * @property {'weekly'|'biweekly'|'monthly'} cadence
 * @property {boolean} essential
 * @property {number} confidence   0..1 — detection confidence, surfaced in explanations
 *
 * @typedef {Object} Goal
 * @property {string} id
 * @property {string} name
 * @property {number} targetCents
 * @property {number} currentCents
 * @property {string} [targetDate]
 *
 * @typedef {Object} TwinSnapshot
 * @property {string} version      opaque, changes whenever any input changes
 * @property {string} asOf         ISO timestamp
 * @property {Account[]} accounts
 * @property {Obligation[]} obligations
 * @property {RecurringFlow[]} recurring
 * @property {Goal[]} goals
 * @property {number} discretionaryDailyCents  observed discretionary burn rate
 */

const CADENCE_PER_MONTH = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1 };

/**
 * @typedef {'connected'|'syncing'|'action_required'|'degraded'|'disconnected'|'error'} ConnectionState
 *
 * Every state other than 'connected' means the balance on screen may not be
 * what the institution holds. Stale data must never be presented as current,
 * and it must never authorize a transfer.
 */
export const CONNECTION_STATE = /** @type {const} */ ({
  CONNECTED: 'connected',
  SYNCING: 'syncing',
  ACTION_REQUIRED: 'action_required',
  DEGRADED: 'degraded',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
});

/** Beyond this, a balance is treated as unverified for authorization purposes. */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Freshness of every account, relative to a reference time.
 *
 * Returned rather than thrown so callers can decide: the UI shows an age, the
 * policy engine refuses to act on it.
 *
 * @param {TwinSnapshot} twin
 * @param {{ now?: number, staleAfterMs?: number }} [opts]
 */
export function freshness(twin, opts = {}) {
  const now = opts.now ?? Date.parse(twin.asOf);
  const staleAfterMs = opts.staleAfterMs ?? STALE_AFTER_MS;

  const accounts = twin.accounts.map((a) => {
    const state = a.connectionState ?? CONNECTION_STATE.CONNECTED;
    const syncedAt = a.lastSyncedAt ? Date.parse(a.lastSyncedAt) : Date.parse(twin.asOf);
    const ageMs = Math.max(0, now - syncedAt);
    return {
      id: a.id,
      name: a.name,
      state,
      ageMs,
      stale: ageMs > staleAfterMs,
      healthy: state === CONNECTION_STATE.CONNECTED && ageMs <= staleAfterMs,
    };
  });

  return {
    accounts,
    stale: accounts.filter((a) => a.stale),
    unhealthy: accounts.filter((a) => !a.healthy),
    allHealthy: accounts.every((a) => a.healthy),
    oldestAgeMs: accounts.reduce((m, a) => Math.max(m, a.ageMs), 0),
  };
}

/** @param {TwinSnapshot} twin @param {string} accountId */
export function accountHealthy(twin, accountId, opts) {
  const f = freshness(twin, opts).accounts.find((a) => a.id === accountId);
  return Boolean(f && f.healthy);
}


/** @param {TwinSnapshot} twin @param {string} id */
export function account(twin, id) {
  const a = twin.accounts.find((x) => x.id === id);
  if (!a) throw new Error(`unknown account: ${id}`);
  return a;
}

/** Assets minus liabilities. @param {TwinSnapshot} twin */
export function netWorthCents(twin) {
  return twin.accounts.reduce(
    (sum, a) => sum + (a.isLiability ? -a.balanceCents : a.balanceCents),
    0
  );
}

/** Cash that can be moved today without selling anything. @param {TwinSnapshot} twin */
export function liquidCents(twin) {
  return twin.accounts
    .filter((a) => !a.isLiability && a.liquidity === 'liquid')
    .reduce((s, a) => s + a.balanceCents, 0);
}

/**
 * Cash that is liquid AND unspoken for.
 *
 * "Cash floor" and "emergency reserve" are different guardrails and must not be
 * conflated: the reserve is a *balance held elsewhere for a named purpose*, the
 * floor is a *minimum left in the account money moves out of*. Subtracting both
 * from the same pool would double-count and understate what the user can act on.
 * @param {TwinSnapshot} twin
 */
export function deployableCents(twin) {
  return twin.accounts
    .filter((a) => !a.isLiability && a.liquidity === 'liquid' && !a.earmarkedFor)
    .reduce((s, a) => s + a.balanceCents, 0);
}

/** Cash explicitly earmarked for a goal. @param {TwinSnapshot} twin @param {string} [goalId] */
export function earmarkedCents(twin, goalId) {
  return twin.accounts
    .filter((a) => !a.isLiability && a.earmarkedFor && (goalId ? a.earmarkedFor === goalId : true))
    .reduce((s, a) => s + a.balanceCents, 0);
}

/** Monthly cost of keeping the lights on — the basis for reserve sizing. @param {TwinSnapshot} twin */
export function essentialMonthlyBurnCents(twin) {
  return Math.round(
    twin.recurring
      .filter((r) => r.direction === 'out' && r.essential)
      .reduce((s, r) => s + r.amountCents * CADENCE_PER_MONTH[r.cadence], 0)
  );
}

/** @param {TwinSnapshot} twin */
export function monthlyNetCashFlowCents(twin) {
  return Math.round(
    twin.recurring.reduce(
      (s, r) => s + (r.direction === 'in' ? 1 : -1) * r.amountCents * CADENCE_PER_MONTH[r.cadence],
      0
    ) - twin.discretionaryDailyCents * (365 / 12)
  );
}

/**
 * Obligations hitting a given account inside `days`.
 * @param {TwinSnapshot} twin @param {string} accountId @param {number} days
 */
export function obligationsWithin(twin, accountId, days) {
  const cutoff = Date.parse(twin.asOf) + days * 86400_000;
  return twin.obligations.filter(
    (o) => o.accountId === accountId && Date.parse(o.dueDate) <= cutoff
  );
}

/**
 * Projected balance of an account `days` out, before any proposed action.
 *
 * Expected income is EXCLUDED by default, and that is deliberate. A cash floor
 * exists precisely to survive the case where the paycheck does not arrive;
 * crediting unearned income into the check that guards it would defeat the
 * guardrail. Pass `includeExpectedIncome` only for planning views, never for
 * authorization.
 *
 * @param {TwinSnapshot} twin
 * @param {string} accountId
 * @param {number} days
 * @param {{ includeExpectedIncome?: boolean }} [opts]
 */
export function projectedBalanceCents(twin, accountId, days, opts = {}) {
  const acct = account(twin, accountId);
  const out = obligationsWithin(twin, accountId, days).reduce((s, o) => s + o.amountCents, 0);
  const inflow = opts.includeExpectedIncome
    ? Math.round(
        twin.recurring
          .filter((r) => r.direction === 'in' && r.confidence >= 0.8)
          .reduce((s, r) => s + r.amountCents * CADENCE_PER_MONTH[r.cadence], 0) *
          (days / 30)
      )
    : 0;
  const discretionary = twin.discretionaryDailyCents * days;
  return acct.balanceCents - out + inflow - discretionary;
}

/**
 * @typedef {Object} TraceLine
 * @property {string} label
 * @property {number} amountCents  signed
 * @property {string} source       provenance, shown in the "Why?" panel
 *
 * @typedef {Object} SafeToDeploy
 * @property {number} amountCents  never negative
 * @property {number} rawCents     may be negative — the honest number
 * @property {TraceLine[]} trace
 * @property {number} horizonDays
 */

/**
 * "Safe to deploy" with a full arithmetic trace.
 *
 * Every number Veyra shows a user must be reconstructible line by line —
 * that is what makes the Why? button possible and what makes the figure
 * defensible when a user disputes it.
 *
 * @param {TwinSnapshot} twin
 * @param {import('./policy.mjs').Constitution} constitution
 * @param {{ horizonDays?: number }} [opts]
 * @returns {SafeToDeploy}
 */
export function safeToDeploy(twin, constitution, opts = {}) {
  const horizonDays = opts.horizonDays ?? 30;
  const cash = deployableCents(twin);

  const obligations = twin.obligations
    .filter((o) => Date.parse(o.dueDate) <= Date.parse(twin.asOf) + horizonDays * 86400_000)
    .reduce((s, o) => s + o.amountCents, 0);

  const discretionary = twin.discretionaryDailyCents * horizonDays;

  /** @type {TraceLine[]} */
  const trace = [
    {
      label: 'Liquid cash',
      amountCents: cash,
      source: 'Connected balances, excluding cash earmarked for goals',
    },
    {
      label: `Upcoming obligations (${horizonDays} days)`,
      amountCents: -obligations,
      source: `${twin.obligations.length} detected bills and scheduled payments`,
    },
    {
      label: 'Safety reserve',
      amountCents: -constitution.cashFloorCents,
      source: 'Your configured cash floor',
    },
    {
      label: 'Projected spending buffer',
      amountCents: -discretionary,
      source: 'Observed discretionary spend rate',
    },
  ];

  const rawCents = trace.reduce((s, t) => s + t.amountCents, 0);
  return { amountCents: Math.max(0, rawCents), rawCents, trace, horizonDays };
}

/**
 * How well funded the emergency reserve is, measured against essential burn.
 * @param {TwinSnapshot} twin
 * @param {import('./policy.mjs').Constitution} constitution
 * @param {string} [reserveGoalId]
 */
export function reserveStatus(twin, constitution, reserveGoalId) {
  const burn = essentialMonthlyBurnCents(twin);
  const held = earmarkedCents(twin, reserveGoalId);
  const requiredCents = burn * constitution.reserveMonths;
  return {
    heldCents: held,
    requiredCents,
    monthsFunded: burn > 0 ? held / burn : Infinity,
    fullyFunded: held >= requiredCents,
    shortfallCents: Math.max(0, requiredCents - held),
  };
}

/**
 * Derive a stable version string from the twin's material contents.
 * Cheap structural fingerprint — sufficient to detect drift between
 * proposal and execution.
 * @param {Omit<TwinSnapshot,'version'>} input
 */
export function fingerprint(input) {
  const material = JSON.stringify({
    asOf: input.asOf,
    accounts: input.accounts.map((a) => [a.id, a.balanceCents]),
    obligations: input.obligations.map((o) => [o.id, o.amountCents, o.dueDate]),
    recurring: input.recurring.map((r) => [r.id, r.amountCents, r.direction]),
    discretionaryDailyCents: input.discretionaryDailyCents,
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `twin_${h.toString(16).padStart(8, '0')}`;
}

/** @param {Omit<TwinSnapshot,'version'>} input @returns {TwinSnapshot} */
export function seal(input) {
  for (const a of input.accounts) assertCents(a.balanceCents, `account ${a.id} balance`);
  for (const o of input.obligations) assertCents(o.amountCents, `obligation ${o.id}`);
  return Object.freeze({ ...input, version: fingerprint(input) });
}
