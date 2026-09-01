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

import { propose as proposeAction, approve as approveAction, authorizeByStandingRule, reject as rejectAction, revalidate, execute as executeAction, STATE } from './actions.mjs';
import { evaluate, VERDICT } from './policy.mjs';
import { AuditLog } from './audit.mjs';
import { EventBus, EVENT } from './events.mjs';
import { gate, LEVEL } from './authorization.mjs';
import { safeToDeploy, netWorthCents, reserveStatus } from './twin.mjs';
import { readiness } from './readiness.mjs';
import { nextBestMoves } from './recommend.mjs';
import { ConsentLedger, assertDisclosed, requiredFor, DISCLOSURES } from './disclosures.mjs';
import {
  DEFAULT_POLICY, EmergencyStop, assessPause, mayExecuteAutonomously,
  activate as activateAutopilot, deactivate as deactivateAutopilot, MODE, levelForMode,
} from './autopilot.mjs';
import { reconcile, actionIsAffected, summarize as summarizeReconciliation } from './reconciliation.mjs';

const SYSTEM = { kind: 'system', id: 'veyra' };

export class Veyra {
  /**
   * @param {Object} cfg
   * @param {import('./twin.mjs').TwinSnapshot} cfg.twin
   * @param {import('./policy.mjs').Constitution} cfg.constitution
   * @param {import('./policy.mjs').EvalContext} cfg.context
   * @param {number} [cfg.authorizationLevel]
   * @param {(action: import('./policy.mjs').ProposedAction, key: string) => Promise<any>} [cfg.executor]
   * @param {boolean} [cfg.demonstrationMode] true while no institution is connected
   * @param {import('./autopilot.mjs').AutopilotPolicy} [cfg.autopilot]
   */
  constructor({ twin, constitution, context, authorizationLevel = LEVEL.APPROVE_EACH, executor, demonstrationMode = true, autopilot }) {
    this.twin = twin;
    this.constitution = constitution;
    this.context = { executedTodayCents: 0, ...context };
    this.authorizationLevel = authorizationLevel;
    this.demonstrationMode = demonstrationMode;
    this.consents = new ConsentLedger();
    this.autopilot = autopilot ?? DEFAULT_POLICY;
    /** The person whose standing rule authorizes autonomous actions. */
    this.autopilotOwner = null;
    this.emergencyStop = new EmergencyStop();
    /** @type {import('./reconciliation.mjs').ReconciliationResult|null} */
    this.reconciliation = null;
    /** @type {import('./autopilot.mjs').AutopilotUsage} */
    this.usage = { executedTodayCents: 0, executedThisMonthCents: 0, actionsToday: 0 };
    this.unreviewedExecutionFailure = false;
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

    // A disclosure that can be skipped is not a disclosure. This throws before
    // any state changes, so a partially disclosed action never reaches APPROVED.
    assertDisclosed(rec.action, this.consents, { demonstrationMode: this.demonstrationMode });

    const next = approveAction(rec, actor, opts);
    this.actions.set(actionId, next);
    await this.audit.append({ event: EVENT.TRANSFER_APPROVED, actor, record: next, reason: 'user authorized' });
    this.bus.emit(EVENT.TRANSFER_APPROVED, next);
    return next;
  }

  /**
   * Record that a person acknowledged a disclosure, and put it in the audit
   * trail alongside the action it gates.
   * @param {string} disclosureId
   * @param {import('./actions.mjs').Actor} actor
   * @param {string} surface
   */
  async acknowledge(disclosureId, actor, surface = 'approval-card') {
    const disclosure = DISCLOSURES[disclosureId];
    if (!disclosure) throw new Error(`unknown disclosure: ${disclosureId}`);
    const record = this.consents.acknowledge(disclosure, actor, surface);
    await this.audit.append({
      event: 'DISCLOSURE_ACKNOWLEDGED',
      actor,
      reason: `${record.id}@${record.version} on ${surface}`,
    });
    return record;
  }

  /** Disclosures an action requires, and which are still outstanding. */
  disclosuresFor(action) {
    const ctx = { demonstrationMode: this.demonstrationMode };
    return {
      required: requiredFor(action, ctx),
      outstanding: this.consents.outstandingFor(action, ctx),
    };
  }

  // ---- AUTOPILOT ---------------------------------------------------------

  /** Everything the control centre needs, derived rather than cached. */
  autopilotStatus() {
    return {
      policy: this.autopilot,
      usage: this.usage,
      pause: assessPause(this.autopilot, this.twin, this.#systemState()),
      emergencyStopEngaged: this.emergencyStop.engaged,
      reconciliation: this.reconciliation,
    };
  }

  #systemState() {
    return {
      emergencyStop: this.emergencyStop.engaged,
      reconciliationException: Boolean(this.reconciliation && !this.reconciliation.clean),
      unreviewedExecutionFailure: this.unreviewedExecutionFailure,
      securityEvent: false,
    };
  }

  /**
   * @param {string[]} acknowledgedIds
   * @param {import('./actions.mjs').Actor} actor
   * @param {'guarded'|'full'} mode
   */
  async enableAutopilot(acknowledgedIds, actor, mode = MODE.GUARDED) {
    this.autopilot = activateAutopilot(this.autopilot, acknowledgedIds, actor, mode);
    this.autopilotOwner = actor;
    // The level is derived from the mode; it must never be set independently.
    this.authorizationLevel = levelForMode(this.autopilot);
    await this.audit.append({
      event: EVENT.AUTOPILOT_ENABLED,
      actor,
      reason: `mode=${mode} consent=${this.autopilot.consentVersion}`,
    });
    this.bus.emit(EVENT.AUTOPILOT_ENABLED, this.autopilot);
    return this.autopilot;
  }

  /** @param {import('./actions.mjs').Actor} actor */
  async disableAutopilot(actor, reason = 'disabled by user') {
    if (actor.kind !== 'user') throw new Error('only the account holder may disable Autopilot');
    this.autopilot = deactivateAutopilot(this.autopilot);
    this.authorizationLevel = levelForMode(this.autopilot);
    await this.audit.append({ event: EVENT.AUTOPILOT_PAUSED, actor, reason });
    this.bus.emit(EVENT.AUTOPILOT_PAUSED, this.autopilot);
    return this.autopilot;
  }

  /** §46 — stop everything now. @param {import('./actions.mjs').Actor} actor */
  async engageEmergencyStop(actor, reason = 'user requested') {
    this.emergencyStop.engage(actor, reason);
    // Anything staged but not yet executed is withdrawn rather than left armed.
    let cancelled = 0;
    for (const [id, rec] of this.actions) {
      if (rec.state === STATE.APPROVED || rec.state === STATE.PENDING_APPROVAL) {
        this.actions.set(id, rejectAction(rec, actor, 'cancelled by emergency stop'));
        cancelled += 1;
      }
    }
    await this.audit.append({ event: EVENT.AUTOPILOT_PAUSED, actor, reason: `emergency stop: ${reason}; ${cancelled} pending action(s) cancelled` });
    this.bus.emit(EVENT.AUTOPILOT_PAUSED, { emergencyStop: true, cancelled });
    return { engaged: true, cancelled };
  }

  /** @param {import('./actions.mjs').Actor} actor @param {{reauthenticatedAt?:number, now?:number}} opts */
  async resumeAutomation(actor, opts = {}) {
    this.emergencyStop.resume(actor, opts);
    await this.audit.append({ event: EVENT.AUTOPILOT_ENABLED, actor, reason: 'emergency stop cleared' });
    return this.autopilotStatus();
  }

  /**
   * Attempt to run an action without asking. Falls back to a proposal whenever
   * anything is uncertain — the fallback is the normal outcome, not an error.
   *
   * @param {import('./policy.mjs').ProposedAction} action
   * @param {import('./actions.mjs').Actor} by
   */
  async runAutonomously(action, by = { kind: 'automation', id: 'autopilot' }) {
    const verdict = mayExecuteAutonomously(action, this.autopilot, this.twin, this.usage, this.#systemState());

    if (this.reconciliation && !this.reconciliation.clean && actionIsAffected(action, this.reconciliation)) {
      verdict.allowed = false;
      verdict.reasons = [...verdict.reasons, { code: 'RECONCILIATION_EXCEPTION', detail: 'This action touches an account that did not reconcile.' }];
    }

    if (!verdict.allowed) {
      const rec = await this.propose(action, by);
      await this.audit.append({
        event: EVENT.AUTOPILOT_PAUSED,
        actor: by,
        record: rec,
        reason: `autonomous execution declined: ${verdict.reasons.map((r) => r.code).join(', ')}`,
      });
      return { executed: false, record: rec, reasons: verdict.reasons };
    }

    // Eligible. It still goes through the same pipeline — proposal, policy,
    // risk, disclosure — and is authorized under the standing rule rather than
    // by a prompt.
    const rec = await this.propose(action, by);
    if (rec.state === STATE.BLOCKED) {
      return { executed: false, record: rec, reasons: rec.decision.determining };
    }

    const outstanding = this.consents.outstandingFor(rec.action, { demonstrationMode: this.demonstrationMode });
    if (outstanding.length > 0) {
      return {
        executed: false,
        record: rec,
        reasons: [{ code: 'DISCLOSURE_REQUIRED', detail: `Needs your acknowledgement: ${outstanding.map((d) => d.title).join(', ')}.` }],
      };
    }

    let authorized;
    try {
      authorized = authorizeByStandingRule(rec, { actor: this.autopilotOwner, policy: this.autopilot });
    } catch (err) {
      return { executed: false, record: rec, reasons: [{ code: 'STANDING_RULE_REFUSED', detail: String(err.message) }] };
    }
    this.actions.set(action.id, authorized);
    await this.audit.append({ event: EVENT.TRANSFER_APPROVED, actor: this.autopilotOwner, record: authorized, reason: 'authorized by standing rule' });

    const done = await this.execute(action.id, by);
    return { executed: done.state === STATE.EXECUTED, record: done, reasons: [] };
  }

  // ---- RECONCILIATION ----------------------------------------------------

  /**
   * @param {import('./reconciliation.mjs').InstitutionBalance[]} institutionBalances
   * @param {import('./actions.mjs').Actor} [by]
   */
  async runReconciliation(institutionBalances, by = SYSTEM) {
    this.reconciliation = reconcile(this.twin, institutionBalances);
    if (!this.reconciliation.clean) {
      await this.audit.append({
        event: EVENT.RECONCILIATION_EXCEPTION,
        actor: by,
        reason: summarizeReconciliation(this.reconciliation),
      });
      this.bus.emit(EVENT.RECONCILIATION_EXCEPTION, this.reconciliation);
    }
    return this.reconciliation;
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

    // Only a real execution accrues. An idempotent replay moved nothing, and
    // counting it would corrupt the very limits that govern automation.
    if (done.state === STATE.EXECUTED && !done.replayed) {
      this.context = { ...this.context, executedTodayCents: this.context.executedTodayCents + done.action.amountCents };
      this.usage = {
        executedTodayCents: this.usage.executedTodayCents + done.action.amountCents,
        executedThisMonthCents: this.usage.executedThisMonthCents + done.action.amountCents,
        actionsToday: this.usage.actionsToday + 1,
      };
    }
    if (done.state === STATE.FAILED) {
      // A failure that nobody has looked at is itself a reason to stop.
      this.unreviewedExecutionFailure = true;
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

export { VERDICT, STATE, EVENT, LEVEL, MODE };
