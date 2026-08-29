/**
 * The action lifecycle.
 *
 * This module exists to make one sentence enforceable in code rather than in
 * a design doc: *the assistant can propose, but only a human can authorize,
 * and an authorization is bound to the exact financial state it was shown.*
 *
 * Every guarantee below is covered by a test. If a change breaks one, the
 * suite fails — which is the point.
 *
 *   PROPOSED ──► PENDING_APPROVAL ──► APPROVED ──► EXECUTING ──► EXECUTED
 *       │              │                  │                          │
 *       └──► BLOCKED   ├──► REJECTED      └──► STALE ──► (re-eval)   └──► FAILED
 *                      └──► EXPIRED
 */

import { evaluate, VERDICT } from './policy.mjs';
import { assess } from './risk.mjs';

export const STATE = /** @type {const} */ ({
  PROPOSED: 'PROPOSED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  EXECUTING: 'EXECUTING',
  EXECUTED: 'EXECUTED',
  BLOCKED: 'BLOCKED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  STALE: 'STALE',
  FAILED: 'FAILED',
});

/** Legal transitions. Anything not listed here throws. */
const TRANSITIONS = {
  PROPOSED: ['PENDING_APPROVAL', 'BLOCKED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'EXPIRED', 'BLOCKED', 'STALE'],
  APPROVED: ['EXECUTING', 'STALE', 'EXPIRED', 'REJECTED'],
  EXECUTING: ['EXECUTED', 'FAILED'],
  STALE: ['PENDING_APPROVAL', 'BLOCKED', 'REJECTED'],
  EXECUTED: [],
  BLOCKED: [],
  REJECTED: [],
  EXPIRED: [],
  FAILED: [],
};

/** How long a human approval stays valid before it must be re-taken. */
export const APPROVAL_TTL_MS = 5 * 60 * 1000;
/** How fresh a re-authentication must be to satisfy REQUIRE_REAUTH. */
export const REAUTH_FRESHNESS_MS = 2 * 60 * 1000;

/**
 * @typedef {Object} Actor
 * @property {'user'|'ai'|'automation'|'system'} kind
 * @property {string} id
 *
 * @typedef {Object} Authorization
 * @property {Actor} actor
 * @property {string} at                ISO
 * @property {string} twinVersion       state the human actually saw
 * @property {string} constitutionVersion
 * @property {string} decisionVerdict
 * @property {number} [reauthenticatedAt] epoch ms
 *
 * @typedef {Object} ActionRecord
 * @property {import('./policy.mjs').ProposedAction} action
 * @property {keyof typeof STATE} state
 * @property {import('./policy.mjs').Decision} decision
 * @property {import('./risk.mjs').RiskAssessment} risk
 * @property {Authorization|null} authorization
 * @property {string} idempotencyKey
 * @property {{ at:string, from:string, to:string, by:Actor, note?:string }[]} history
 * @property {any} [result]
 */

class TransitionError extends Error {
  constructor(from, to) {
    super(`illegal transition ${from} -> ${to}`);
    this.name = 'TransitionError';
    this.from = from;
    this.to = to;
  }
}
export { TransitionError };

/** @param {ActionRecord} rec @param {keyof typeof STATE} to @param {Actor} by @param {string} [note] */
function transition(rec, to, by, note) {
  if (!TRANSITIONS[rec.state].includes(to)) throw new TransitionError(rec.state, to);
  const next = {
    ...rec,
    state: to,
    history: [...rec.history, { at: new Date().toISOString(), from: rec.state, to, by, note }],
  };
  return next;
}

/**
 * Create an action record. Anything may *propose*; nothing is authorized here.
 * @param {import('./policy.mjs').ProposedAction} action
 * @param {import('./twin.mjs').TwinSnapshot} twin
 * @param {import('./policy.mjs').Constitution} constitution
 * @param {import('./policy.mjs').EvalContext} ctx
 * @param {Actor} by
 * @returns {ActionRecord}
 */
export function propose(action, twin, constitution, ctx, by) {
  const decision = evaluate(action, twin, constitution, ctx);
  const risk = assess(action, twin, constitution, decision);

  /** @type {ActionRecord} */
  let rec = {
    action,
    state: STATE.PROPOSED,
    decision,
    risk,
    authorization: null,
    idempotencyKey: `${action.id}:${twin.version}:${constitution.version}`,
    history: [{ at: new Date().toISOString(), from: '-', to: STATE.PROPOSED, by }],
  };

  return decision.verdict === VERDICT.BLOCK
    ? transition(rec, STATE.BLOCKED, by, decision.determining[0]?.reason)
    : transition(rec, STATE.PENDING_APPROVAL, by);
}

/**
 * Approve an action. This is the only door into APPROVED, and it is barred to
 * every actor that is not a human being.
 *
 * @param {ActionRecord} rec
 * @param {Actor} actor
 * @param {{ reauthenticatedAt?: number, now?: number }} [opts]
 * @returns {ActionRecord}
 */
export function approve(rec, actor, opts = {}) {
  if (actor.kind !== 'user') {
    throw new Error(
      `authorization denied: actor kind "${actor.kind}" may never approve a financial action`
    );
  }
  if (rec.state !== STATE.PENDING_APPROVAL) {
    throw new TransitionError(rec.state, STATE.APPROVED);
  }
  if (rec.decision.verdict === VERDICT.BLOCK) {
    throw new Error('authorization denied: policy engine blocked this action');
  }
  if (rec.decision.verdict === VERDICT.REQUIRE_REAUTH) {
    const now = opts.now ?? Date.now();
    const at = opts.reauthenticatedAt;
    if (at === undefined) throw new Error('authorization denied: re-authentication required');
    if (now - at > REAUTH_FRESHNESS_MS) {
      throw new Error('authorization denied: re-authentication is stale');
    }
  }

  const next = transition(rec, STATE.APPROVED, actor);
  next.authorization = {
    actor,
    at: new Date(opts.now ?? Date.now()).toISOString(),
    twinVersion: rec.decision.twinVersion,
    constitutionVersion: rec.decision.constitutionVersion,
    decisionVerdict: rec.decision.verdict,
    reauthenticatedAt: opts.reauthenticatedAt,
  };
  return next;
}

/** @param {ActionRecord} rec @param {Actor} actor @param {string} [note] */
export function reject(rec, actor, note) {
  return transition(rec, STATE.REJECTED, actor, note);
}

/**
 * Re-check an approval against current reality immediately before execution.
 * If the twin or the constitution moved since the human said yes, the approval
 * is void — the user authorized a different situation than the one in front of
 * us now.
 *
 * @param {ActionRecord} rec
 * @param {import('./twin.mjs').TwinSnapshot} twin
 * @param {import('./policy.mjs').Constitution} constitution
 * @param {import('./policy.mjs').EvalContext} ctx
 * @param {Actor} by
 * @param {{ now?: number }} [opts]
 * @returns {{ ok: boolean, record: ActionRecord, reason?: string }}
 */
export function revalidate(rec, twin, constitution, ctx, by, opts = {}) {
  if (rec.state !== STATE.APPROVED || !rec.authorization) {
    return { ok: false, record: rec, reason: 'not in an approved state' };
  }

  const now = opts.now ?? Date.now();
  if (now - Date.parse(rec.authorization.at) > APPROVAL_TTL_MS) {
    return { ok: false, record: transition(rec, STATE.EXPIRED, by, 'approval expired'), reason: 'approval expired' };
  }

  if (
    twin.version !== rec.authorization.twinVersion ||
    constitution.version !== rec.authorization.constitutionVersion
  ) {
    const decision = evaluate(rec.action, twin, constitution, ctx);
    const risk = assess(rec.action, twin, constitution, decision);
    const stale = { ...transition(rec, STATE.STALE, by, 'state changed since approval'), decision, risk, authorization: null };
    const reEvaluated =
      decision.verdict === VERDICT.BLOCK
        ? transition(stale, STATE.BLOCKED, by, decision.determining[0]?.reason)
        : transition(stale, STATE.PENDING_APPROVAL, by, 're-approval required');
    return { ok: false, record: reEvaluated, reason: 'financial state changed since you approved' };
  }

  return { ok: true, record: rec };
}

/**
 * Execute. The executor is injected — this module never talks to a bank.
 * Idempotent by construction: a settled key returns its original result.
 *
 * @param {ActionRecord} rec
 * @param {(action: import('./policy.mjs').ProposedAction, key: string) => Promise<any>} executor
 * @param {Actor} by
 * @param {Map<string, any>} ledger  idempotency ledger
 * @returns {Promise<ActionRecord>}
 */
export async function execute(rec, executor, by, ledger) {
  if (rec.state !== STATE.APPROVED) throw new TransitionError(rec.state, STATE.EXECUTING);
  if (!rec.authorization) throw new Error('refusing to execute an action with no authorization record');

  if (ledger.has(rec.idempotencyKey)) {
    const prior = ledger.get(rec.idempotencyKey);
    return { ...rec, state: STATE.EXECUTED, result: prior, history: [...rec.history, { at: new Date().toISOString(), from: rec.state, to: STATE.EXECUTED, by, note: 'idempotent replay' }] };
  }

  let running = transition(rec, STATE.EXECUTING, by);
  try {
    const result = await executor(rec.action, rec.idempotencyKey);
    ledger.set(rec.idempotencyKey, result);
    return { ...transition(running, STATE.EXECUTED, by), result };
  } catch (err) {
    return { ...transition(running, STATE.FAILED, by, String(err?.message ?? err)), result: { error: String(err?.message ?? err) } };
  }
}
