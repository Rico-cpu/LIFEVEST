/**
 * Veyra — the orchestrator.
 *
 * Implements the pipeline from §45:
 *   PLAN → OPTIMIZE → EXPLAIN → ASK → APPROVE → EXECUTE → VERIFY → LEARN
 *
 * Everything consequential funnels through here so there is exactly one path
 * to money movement, and that path is instrumented end to end. There is no
 * second door.
 */

import { propose as proposeAction, approve as approveAction, reject as rejectAction, revalidate, execute as executeAction, STATE } from './actions.mjs';
import { evaluate, VERDICT } from './policy.mjs';
import { AuditLog } from './audit.mjs';
import { EventBus, EVENT } from './events.mjs';
import { gate, LEVEL } from './authorization.mjs';
import { safeToDeploy, netWorthCents, reserveStatus } from './twin.mjs';
import { readiness } from './readiness.mjs';
import { nextBestMoves } from './recommend.mjs';

const SYSTEM = { kind: 'system', id: 'veyra' };

export class Veyra {
  /**
   * @param {Object} cfg
   * @param {import('./twin.mjs').TwinSnapshot} cfg.twin
   * @param {import('./policy.mjs').Constitution} cfg.constitution
   * @param {import('./policy.mjs').EvalContext} cfg.context
   * @param {number} [cfg.authorizationLevel]
   * @param {(action: import('./policy.mjs').ProposedAction, key: string) => Promise<any>} [cfg.executor]
   */
  constructor({ twin, constitution, context, authorizationLevel = LEVEL.APPROVE_EACH, executor }) {
    this.twin = twin;
    this.constitution = constitution;
    this.context = { executedTodayCents: 0, ...context };
    this.authorizationLevel = authorizationLevel;
    this.audit = new AuditLog();
    this.bus = new EventBus();
    this.ledger = new Map();
    this.executor = executor ?? (async (action, key) => ({ ok: true, reference: `sim_${key}` }));
    /** @type {Map<string, import('./actions.mjs').ActionRecord>} */
    this.actions = new Map();
  }

  // ---- UNDERSTAND ---------------------------------------------------------

  snapshot() {
    return {
      netWorthCents: netWorthCents(this.twin),
      safeToDeploy: safeToDeploy(this.twin, this.constitution),
      reserve: reserveStatus(this.twin, this.constitution),
      readiness: readiness(this.twin, this.constitution),
      twinVersion: this.twin.version,
      constitutionVersion: this.constitution.version,
    };
  }

  // ---- OPTIMIZE + EXPLAIN -------------------------------------------------

  recommendations() {
    return nextBestMoves(this.twin, this.constitution);
  }

  /** Dry-run a decision without creating an action. Used by the UI to preview friction. */
  preview(action) {
    return evaluate(action, this.twin, this.constitution, this.context);
  }

  // ---- ASK ----------------------------------------------------------------

  /**
   * @param {import('./policy.mjs').ProposedAction} action
   * @param {import('./actions.mjs').Actor} by
   */
  async propose(action, by = SYSTEM) {
    const g = gate(this.authorizationLevel, action);
    if (!g.allowed) {
      await this.audit.append({ event: EVENT.TRANSFER_BLOCKED, actor: by, reason: g.reason });
      throw new Error(g.reason);
    }

    const rec = proposeAction(action, this.twin, this.constitution, this.context, by);
    this.actions.set(action.id, rec);

    await this.audit.append({
      event: rec.state === STATE.BLOCKED ? EVENT.TRANSFER_BLOCKED : EVENT.TRANSFER_PROPOSED,
      actor: by,
      record: rec,
      reason: rec.decision.determining[0]?.reason ?? 'within policy',
    });
    this.bus.emit(rec.state === STATE.BLOCKED ? EVENT.TRANSFER_BLOCKED : EVENT.TRANSFER_PROPOSED, rec);

    if (rec.risk.band === 'high') this.bus.emit(EVENT.RISK_ALERT, rec);
    return rec;
  }

  // ---- APPROVE ------------------------------------------------------------

  /**
   * @param {string} actionId
   * @param {import('./actions.mjs').Actor} actor  must be a human
   * @param {{ reauthenticatedAt?: number }} [opts]
   */
  async approve(actionId, actor, opts = {}) {
    const rec = this.#get(actionId);
    const next = approveAction(rec, actor, opts);
    this.actions.set(actionId, next);
    await this.audit.append({ event: EVENT.TRANSFER_APPROVED, actor, record: next, reason: 'user authorized' });
    this.bus.emit(EVENT.TRANSFER_APPROVED, next);
    return next;
  }

  /** @param {string} actionId @param {import('./actions.mjs').Actor} actor */
  async reject(actionId, actor, note = 'declined by user') {
    const next = rejectAction(this.#get(actionId), actor, note);
    this.actions.set(actionId, next);
    await this.audit.append({ event: EVENT.TRANSFER_REJECTED, actor, record: next, reason: note });
    this.bus.emit(EVENT.TRANSFER_REJECTED, next);
    return next;
  }

  // ---- EXECUTE + VERIFY ---------------------------------------------------

  /** @param {string} actionId @param {import('./actions.mjs').Actor} by */
  async execute(actionId, by = SYSTEM) {
    const rec = this.#get(actionId);

    // Calling execute on an unapproved action is a programming error, not a
    // state-drift condition. Fail loudly — a silent return here is exactly the
    // shape of bug that later reads as "the transfer went through".
    if (rec.state !== STATE.APPROVED) {
      await this.audit.append({ event: EVENT.TRANSFER_BLOCKED, actor: by, record: rec, reason: `execute called in state ${rec.state}` });
      throw new Error(`cannot execute: action ${actionId} is ${rec.state}, not APPROVED`);
    }

    const check = revalidate(rec, this.twin, this.constitution, this.context, by);
    if (!check.ok) {
      this.actions.set(actionId, check.record);
      await this.audit.append({ event: EVENT.APPROVAL_INVALIDATED, actor: by, record: check.record, reason: check.reason ?? '' });
      this.bus.emit(EVENT.APPROVAL_INVALIDATED, check.record);
      return check.record;
    }

    const done = await executeAction(check.record, this.executor, by, this.ledger);
    this.actions.set(actionId, done);

    if (done.state === STATE.EXECUTED) {
      this.context = { ...this.context, executedTodayCents: this.context.executedTodayCents + done.action.amountCents };
    }

    await this.audit.append({
      event: EVENT.TRANSFER_EXECUTED,
      actor: by,
      record: done,
      reason: done.state === STATE.EXECUTED ? 'executed' : `failed: ${done.result?.error ?? 'unknown'}`,
    });
    this.bus.emit(EVENT.TRANSFER_EXECUTED, done);
    return done;
  }

  // ---- LEARN / state changes ---------------------------------------------

  /**
   * Changing the constitution invalidates every outstanding approval — the user
   * approved actions under different rules, and those approvals do not carry
   * over to the new ones.
   * @param {import('./policy.mjs').Constitution} constitution
   * @param {import('./actions.mjs').Actor} actor
   */
  async updateConstitution(constitution, actor) {
    if (actor.kind !== 'user') throw new Error('only the account holder may change the constitution');
    const prev = this.constitution.version;
    this.constitution = constitution;

    for (const [id, rec] of this.actions) {
      if (rec.state === STATE.APPROVED || rec.state === STATE.PENDING_APPROVAL) {
        const fresh = proposeAction(rec.action, this.twin, this.constitution, this.context, { kind: 'system', id: 'veyra' });
        this.actions.set(id, fresh);
      }
    }

    await this.audit.append({ event: EVENT.POLICY_CHANGED, actor, reason: `${prev} → ${constitution.version}` });
    this.bus.emit(EVENT.POLICY_CHANGED, constitution);
    return this.constitution;
  }

  /** @param {import('./twin.mjs').TwinSnapshot} twin */
  async updateTwin(twin) {
    this.twin = twin;
    await this.audit.append({ event: EVENT.BALANCE_UPDATED, actor: SYSTEM, reason: twin.version });
    this.bus.emit(EVENT.BALANCE_UPDATED, twin);
  }

  #get(id) {
    const rec = this.actions.get(id);
    if (!rec) throw new Error(`unknown action: ${id}`);
    return rec;
  }
}

export { VERDICT, STATE, EVENT, LEVEL };
