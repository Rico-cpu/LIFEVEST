/**
 * Autopilot — modes, hard limits, automatic pause, and emergency stop.
 *
 * The governing rule is the one from the specification: *no action executes
 * under uncertainty*. Every function here is built to fail closed. When the
 * system cannot establish that an action is safe, it does not proceed, and it
 * says which condition stopped it.
 *
 * A deliberate design choice: pause conditions are evaluated from system state
 * rather than set as a flag somewhere. A flag can be stale; a derivation cannot
 * disagree with the data it is derived from. `resume()` therefore cannot force
 * automation back on while a blocking condition still holds — it only clears
 * the operator's own stop.
 */

import { freshness, CONNECTION_STATE } from './twin.mjs';
import { LEVEL } from './authorization.mjs';

/**
 * §14 — the trust ladder. Each rung is a ceiling on what may happen without a
 * person, never on who may authorize.
 */
export const MODE = /** @type {const} */ ({
  MANUAL: 'manual',
  ASSISTED: 'assisted',
  GUARDED: 'guarded',
  FULL: 'full',
});

export const MODE_META = [
  { mode: MODE.MANUAL, name: 'Manual', summary: 'Veyra recommends. You execute.', autonomous: false },
  { mode: MODE.ASSISTED, name: 'Assisted', summary: 'Veyra prepares the action. You approve it.', autonomous: false },
  { mode: MODE.GUARDED, name: 'Guarded Autopilot', summary: 'Veyra executes eligible actions inside your rules.', autonomous: true },
  { mode: MODE.FULL, name: 'Full Autopilot', summary: 'Veyra operates continuously inside your authorization policy.', autonomous: true },
];

/** Full Autopilot is off unless explicitly chosen. Never a default. */
export const DEFAULT_MODE = MODE.ASSISTED;

/**
 * The authorization level a mode implies.
 *
 * These were two separate permission systems, and they disagreed: the engine's
 * level said automation could not prepare an action while the autopilot policy
 * said it could. Two sources of truth for "may automation act" is the bug class
 * that moves money by accident, so the level is now derived from the mode and
 * has no independent existence.
 *
 * @param {AutopilotPolicy} policy
 */
export function levelForMode(policy) {
  if (!policy.enabled) {
    return policy.mode === MODE.MANUAL ? LEVEL.RECOMMEND : LEVEL.APPROVE_EACH;
  }
  return policy.mode === MODE.FULL ? LEVEL.BOUNDED_AUTOMATION : LEVEL.RECURRING_RULE;
}

/**
 * @typedef {Object} AutopilotPolicy
 * @property {'manual'|'assisted'|'guarded'|'full'} mode
 * @property {boolean} enabled
 * @property {number} maxPerActionCents
 * @property {number} maxPerDayCents
 * @property {number} maxPerMonthCents
 * @property {number} maxActionsPerDay          velocity cap
 * @property {import('./policy.mjs').ActionKind[]} allowedActionKinds
 * @property {string[]} allowedDestinations      destination allowlist
 * @property {string|null} activatedAt
 * @property {string|null} consentVersion        which activation consent was given
 *
 * @typedef {Object} AutopilotUsage
 * @property {number} executedTodayCents
 * @property {number} executedThisMonthCents
 * @property {number} actionsToday
 */

/** @type {AutopilotPolicy} */
export const DEFAULT_POLICY = Object.freeze({
  mode: DEFAULT_MODE,
  enabled: false,
  maxPerActionCents: 100000,
  maxPerDayCents: 200000,
  maxPerMonthCents: 300000,
  maxActionsPerDay: 4,
  allowedActionKinds: ['invest', 'goal_funding'],
  allowedDestinations: [],
  activatedAt: null,
  consentVersion: null,
});

/* -------------------------------------------------------------------------
 * §16 — activation consent
 * ---------------------------------------------------------------------- */

/**
 * The acknowledgements required before autonomous operation may begin.
 * Content-addressed as a set, so adding or reworording one invalidates prior
 * activation consent and forces re-acknowledgement.
 */
export const ACTIVATION_ACKNOWLEDGEMENTS = Object.freeze([
  { id: 'losses', text: 'I understand that automated financial actions can result in losses or other financial consequences.' },
  { id: 'past_performance', text: 'I understand that past performance does not guarantee future results.' },
  { id: 'rules_reviewed', text: 'I have reviewed my automation rules and limits.' },
  { id: 'can_stop', text: 'I understand how to pause or disable Autopilot.' },
]);

export function activationConsentVersion() {
  const s = ACTIVATION_ACKNOWLEDGEMENTS.map((a) => `${a.id}:${a.text}`).join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `ap_${h.toString(16).padStart(8, '0')}`;
}

/**
 * Turn autonomous operation on. Refuses unless a person acknowledged every
 * item — partial consent is not consent.
 *
 * @param {AutopilotPolicy} policy
 * @param {string[]} acknowledgedIds
 * @param {import('./actions.mjs').Actor} actor
 * @param {'guarded'|'full'} mode
 * @returns {AutopilotPolicy}
 */
export function activate(policy, acknowledgedIds, actor, mode = MODE.GUARDED) {
  if (actor.kind !== 'user') {
    throw new Error('only the account holder may enable Autopilot');
  }
  if (mode !== MODE.GUARDED && mode !== MODE.FULL) {
    throw new Error(`activate() is for autonomous modes; got "${mode}"`);
  }
  const missing = ACTIVATION_ACKNOWLEDGEMENTS
    .filter((a) => !acknowledgedIds.includes(a.id))
    .map((a) => a.id);
  if (missing.length > 0) {
    throw new Error(`autopilot activation requires all acknowledgements; missing: ${missing.join(', ')}`);
  }
  if (policy.allowedDestinations.length === 0) {
    throw new Error('autopilot requires at least one approved destination');
  }
  return Object.freeze({
    ...policy,
    mode,
    enabled: true,
    activatedAt: new Date().toISOString(),
    consentVersion: activationConsentVersion(),
  });
}

/** @param {AutopilotPolicy} policy */
export function deactivate(policy) {
  return Object.freeze({ ...policy, enabled: false, mode: MODE.ASSISTED, activatedAt: null });
}

/**
 * Consent given to a previous set of acknowledgements does not carry to a new
 * set. Checked at evaluation time, not only at activation.
 * @param {AutopilotPolicy} policy
 */
export function consentCurrent(policy) {
  return policy.consentVersion === activationConsentVersion();
}

/* -------------------------------------------------------------------------
 * §19 — automatic pause
 * ---------------------------------------------------------------------- */

export const PAUSE = /** @type {const} */ ({
  EMERGENCY_STOP: 'EMERGENCY_STOP',
  STALE_DATA: 'STALE_DATA',
  CONNECTION_UNHEALTHY: 'CONNECTION_UNHEALTHY',
  RECONCILIATION_EXCEPTION: 'RECONCILIATION_EXCEPTION',
  RECENT_EXECUTION_FAILURE: 'RECENT_EXECUTION_FAILURE',
  SECURITY_EVENT: 'SECURITY_EVENT',
  CONSENT_OUTDATED: 'CONSENT_OUTDATED',
  NOT_ENABLED: 'NOT_ENABLED',
});

const PAUSE_DETAIL = {
  [PAUSE.EMERGENCY_STOP]: 'You stopped all automation. It stays off until you resume it.',
  [PAUSE.STALE_DATA]: 'At least one balance is too old to act on.',
  [PAUSE.CONNECTION_UNHEALTHY]: 'A connected institution needs attention.',
  [PAUSE.RECONCILIATION_EXCEPTION]: 'Veyra’s records disagree with an institution.',
  [PAUSE.RECENT_EXECUTION_FAILURE]: 'A recent action failed and has not been reviewed.',
  [PAUSE.SECURITY_EVENT]: 'A security event needs your attention.',
  [PAUSE.CONSENT_OUTDATED]: 'The automation terms changed since you enabled Autopilot.',
  [PAUSE.NOT_ENABLED]: 'Autopilot is not enabled.',
};

/**
 * @typedef {Object} SystemState
 * @property {boolean} [emergencyStop]
 * @property {boolean} [reconciliationException]
 * @property {boolean} [unreviewedExecutionFailure]
 * @property {boolean} [securityEvent]
 * @property {number} [now]
 *
 * @typedef {Object} PauseAssessment
 * @property {boolean} paused
 * @property {{ code: string, detail: string }[]} reasons
 * @property {boolean} canRun
 */

/**
 * Derive whether automation may run right now.
 *
 * @param {AutopilotPolicy} policy
 * @param {import('./twin.mjs').TwinSnapshot} twin
 * @param {SystemState} [state]
 * @returns {PauseAssessment}
 */
export function assessPause(policy, twin, state = {}) {
  /** @type {{code:string, detail:string}[]} */
  const reasons = [];
  const add = (code, detail) => reasons.push({ code, detail: detail ?? PAUSE_DETAIL[code] });

  if (state.emergencyStop) add(PAUSE.EMERGENCY_STOP);
  if (!policy.enabled) add(PAUSE.NOT_ENABLED);
  else if (!consentCurrent(policy)) add(PAUSE.CONSENT_OUTDATED);

  const f = freshness(twin, { now: state.now });
  const stale = f.stale.map((a) => a.name);
  if (stale.length) add(PAUSE.STALE_DATA, `Balance not verified recently: ${stale.join(', ')}.`);

  const unhealthy = f.accounts.filter((a) => a.state !== CONNECTION_STATE.CONNECTED);
  if (unhealthy.length) {
    add(PAUSE.CONNECTION_UNHEALTHY, `${unhealthy.map((a) => `${a.name} (${a.state})`).join(', ')}.`);
  }

  if (state.reconciliationException) add(PAUSE.RECONCILIATION_EXCEPTION);
  if (state.unreviewedExecutionFailure) add(PAUSE.RECENT_EXECUTION_FAILURE);
  if (state.securityEvent) add(PAUSE.SECURITY_EVENT);

  return { paused: reasons.length > 0, reasons, canRun: reasons.length === 0 };
}

/* -------------------------------------------------------------------------
 * §18 — hard limits
 * ---------------------------------------------------------------------- */

/**
 * Evaluate an action against the autopilot policy.
 *
 * Applies only to actions Veyra would take on its own. A person's own action
 * is governed by the Financial Constitution, not by the automation budget.
 *
 * @param {import('./policy.mjs').ProposedAction} action
 * @param {AutopilotPolicy} policy
 * @param {AutopilotUsage} usage
 * @returns {{ allowed: boolean, failures: {code:string, detail:string}[] }}
 */
export function checkLimits(action, policy, usage) {
  /** @type {{code:string, detail:string}[]} */
  const failures = [];
  const money = (c) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (!policy.allowedActionKinds.includes(action.kind)) {
    failures.push({ code: 'ACTION_NOT_ALLOWED', detail: `"${action.kind}" is not in your approved action types.` });
  }
  if (action.destinationAccountId && !policy.allowedDestinations.includes(action.destinationAccountId)) {
    failures.push({ code: 'DESTINATION_NOT_ALLOWED', detail: 'Destination is not on your approved list.' });
  }
  if (action.amountCents > policy.maxPerActionCents) {
    failures.push({ code: 'OVER_PER_ACTION_LIMIT', detail: `Exceeds your ${money(policy.maxPerActionCents)} per-action limit.` });
  }
  if (usage.executedTodayCents + action.amountCents > policy.maxPerDayCents) {
    failures.push({ code: 'OVER_DAILY_LIMIT', detail: `Would exceed your ${money(policy.maxPerDayCents)} daily limit.` });
  }
  if (usage.executedThisMonthCents + action.amountCents > policy.maxPerMonthCents) {
    failures.push({ code: 'OVER_MONTHLY_LIMIT', detail: `Would exceed your ${money(policy.maxPerMonthCents)} monthly limit.` });
  }
  if (usage.actionsToday + 1 > policy.maxActionsPerDay) {
    failures.push({ code: 'OVER_VELOCITY_LIMIT', detail: `Would exceed ${policy.maxActionsPerDay} automated actions in a day.` });
  }

  return { allowed: failures.length === 0, failures };
}

/**
 * The whole gate: may Veyra execute this action without asking?
 *
 * Returns a decision rather than a boolean, because "no" always needs a reason
 * the user can read.
 *
 * @param {import('./policy.mjs').ProposedAction} action
 * @param {AutopilotPolicy} policy
 * @param {import('./twin.mjs').TwinSnapshot} twin
 * @param {AutopilotUsage} usage
 * @param {SystemState} [state]
 */
export function mayExecuteAutonomously(action, policy, twin, usage, state = {}) {
  const pause = assessPause(policy, twin, state);
  if (pause.paused) {
    return { allowed: false, requiresApproval: true, reasons: pause.reasons, pause };
  }
  if (!MODE_META.find((m) => m.mode === policy.mode)?.autonomous) {
    return {
      allowed: false,
      requiresApproval: true,
      reasons: [{ code: 'MODE_REQUIRES_APPROVAL', detail: `${policy.mode} mode asks you before acting.` }],
      pause,
    };
  }
  const limits = checkLimits(action, policy, usage);
  if (!limits.allowed) {
    return { allowed: false, requiresApproval: true, reasons: limits.failures, pause };
  }
  return { allowed: true, requiresApproval: false, reasons: [], pause };
}

/* -------------------------------------------------------------------------
 * §46 — emergency stop
 * ---------------------------------------------------------------------- */

/**
 * A latch, not a computation. It is set by a person and cleared only by a
 * person; nothing in the system may clear it as a side effect.
 */
export class EmergencyStop {
  constructor() {
    this.engaged = false;
    /** @type {{ at:string, actorId:string, action:'engage'|'resume' }[]} */
    this.history = [];
  }

  /** @param {import('./actions.mjs').Actor} actor */
  engage(actor, reason = 'user requested') {
    this.engaged = true;
    this.history.push({ at: new Date().toISOString(), actorId: actor.id, action: 'engage', reason });
    return this;
  }

  /**
   * Resuming requires a person and fresh re-authentication. Automation must
   * never be able to turn itself back on.
   * @param {import('./actions.mjs').Actor} actor
   * @param {{ reauthenticatedAt?: number, now?: number, freshnessMs?: number }} [opts]
   */
  resume(actor, opts = {}) {
    if (actor.kind !== 'user') throw new Error('only the account holder may resume automation');
    const now = opts.now ?? Date.now();
    const freshnessMs = opts.freshnessMs ?? 2 * 60 * 1000;
    if (opts.reauthenticatedAt === undefined) {
      throw new Error('resuming automation requires re-authentication');
    }
    if (now - opts.reauthenticatedAt > freshnessMs) {
      throw new Error('re-authentication is stale');
    }
    this.engaged = false;
    this.history.push({ at: new Date(now).toISOString(), actorId: actor.id, action: 'resume' });
    return this;
  }
}
