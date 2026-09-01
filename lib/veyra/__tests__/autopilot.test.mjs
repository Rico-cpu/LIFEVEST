/**
 * Autopilot, reconciliation, and the failure cases from §42.
 *
 * The governing rule under test: no action executes under uncertainty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { seal, CONNECTION_STATE } from '../twin.mjs';
import { demoTwin, demoConstitution, demoContext, AS_OF } from '../fixtures.mjs';
import { Veyra } from '../engine.mjs';
import { STATE, authorizeByStandingRule, TransitionError } from '../actions.mjs';
import { reconcile, actionIsAffected, affectedAccountIds, summarize } from '../reconciliation.mjs';
import {
  MODE, DEFAULT_POLICY, DEFAULT_MODE, ACTIVATION_ACKNOWLEDGEMENTS, activationConsentVersion,
  activate, deactivate, consentCurrent, assessPause, checkLimits,
  mayExecuteAutonomously, EmergencyStop, PAUSE,
} from '../autopilot.mjs';

const HUMAN = { kind: 'user', id: 'u_1' };
const AI = { kind: 'ai', id: 'assistant' };
const ROBOT = { kind: 'automation', id: 'autopilot' };
const ALL_ACKS = ACTIVATION_ACKNOWLEDGEMENTS.map((a) => a.id);

const basePolicy = { ...DEFAULT_POLICY, allowedDestinations: ['fidelity_brokerage', 'ally_savings'] };
const activePolicy = () => activate(basePolicy, ALL_ACKS, HUMAN, MODE.GUARDED);

const smallInvest = {
  id: 'ap1', kind: 'invest', amountCents: 50000,
  sourceAccountId: 'chase_checking', destinationAccountId: 'fidelity_brokerage',
  destinationKnown: true, origin: 'automation', automationRuleId: 'monthly_invest',
  rationale: 'scheduled contribution',
};
const usage = (over = {}) => ({ executedTodayCents: 0, executedThisMonthCents: 0, actionsToday: 0, ...over });

/* ------------------------------------------------------------- modes */

test('Full Autopilot is never the default', () => {
  assert.equal(DEFAULT_MODE, MODE.ASSISTED);
  assert.equal(DEFAULT_POLICY.enabled, false);
  assert.notEqual(DEFAULT_POLICY.mode, MODE.FULL);
});

/* -------------------------------------------------------- activation */

test('activation requires every acknowledgement, not most of them', () => {
  for (let i = 0; i < ALL_ACKS.length; i++) {
    const partial = ALL_ACKS.filter((_, j) => j !== i);
    assert.throws(() => activate(basePolicy, partial, HUMAN), /missing: /);
  }
  assert.equal(activate(basePolicy, ALL_ACKS, HUMAN).enabled, true);
});

test('only a person may enable Autopilot', () => {
  for (const actor of [AI, ROBOT, { kind: 'system', id: 'v' }]) {
    assert.throws(() => activate(basePolicy, ALL_ACKS, actor), /only the account holder/);
  }
});

test('Autopilot cannot be enabled with no approved destination', () => {
  assert.throws(() => activate({ ...basePolicy, allowedDestinations: [] }, ALL_ACKS, HUMAN), /approved destination/);
});

test('activate() refuses non-autonomous modes', () => {
  assert.throws(() => activate(basePolicy, ALL_ACKS, HUMAN, MODE.MANUAL), /autonomous modes/);
});

test('activation records which consent version it rests on', () => {
  const p = activePolicy();
  assert.equal(p.consentVersion, activationConsentVersion());
  assert.ok(consentCurrent(p));
  assert.ok(Date.parse(p.activatedAt) > 0);
});

test('changing the acknowledgement text invalidates existing activation consent', () => {
  const stale = { ...activePolicy(), consentVersion: 'ap_00000000' };
  assert.equal(consentCurrent(stale), false);
  const pause = assessPause(stale, demoTwin);
  assert.ok(pause.reasons.some((r) => r.code === PAUSE.CONSENT_OUTDATED));
});

test('deactivating drops back to asking, not to nothing', () => {
  const off = deactivate(activePolicy());
  assert.equal(off.enabled, false);
  assert.equal(off.mode, MODE.ASSISTED);
});

/* ------------------------------------------------------------- pause */

test('a healthy, activated system is not paused', () => {
  const pause = assessPause(activePolicy(), demoTwin);
  assert.equal(pause.paused, false, JSON.stringify(pause.reasons));
  assert.equal(pause.canRun, true);
});

test('an unactivated policy is paused', () => {
  assert.ok(assessPause(basePolicy, demoTwin).reasons.some((r) => r.code === PAUSE.NOT_ENABLED));
});

test('stale balances pause automation', () => {
  const stale = seal({
    ...demoTwin,
    accounts: demoTwin.accounts.map((a) =>
      a.id === 'chase_checking'
        ? { ...a, lastSyncedAt: new Date(Date.parse(AS_OF) - 24 * 3600_000).toISOString() }
        : a
    ),
  });
  const pause = assessPause(activePolicy(), stale);
  assert.ok(pause.paused);
  const r = pause.reasons.find((x) => x.code === PAUSE.STALE_DATA);
  assert.ok(r && r.detail.includes('Chase Checking'), 'must name the offending account');
});

test('an unhealthy connection pauses automation', () => {
  for (const state of [CONNECTION_STATE.DISCONNECTED, CONNECTION_STATE.ERROR, CONNECTION_STATE.ACTION_REQUIRED, CONNECTION_STATE.DEGRADED]) {
    const twin = seal({
      ...demoTwin,
      accounts: demoTwin.accounts.map((a) => (a.id === 'chase_checking' ? { ...a, connectionState: state } : a)),
    });
    const pause = assessPause(activePolicy(), twin);
    assert.ok(pause.reasons.some((r) => r.code === PAUSE.CONNECTION_UNHEALTHY), `${state} did not pause`);
  }
});

test('reconciliation breaks, unreviewed failures and security events each pause', () => {
  const p = activePolicy();
  assert.ok(assessPause(p, demoTwin, { reconciliationException: true }).reasons.some((r) => r.code === PAUSE.RECONCILIATION_EXCEPTION));
  assert.ok(assessPause(p, demoTwin, { unreviewedExecutionFailure: true }).reasons.some((r) => r.code === PAUSE.RECENT_EXECUTION_FAILURE));
  assert.ok(assessPause(p, demoTwin, { securityEvent: true }).reasons.some((r) => r.code === PAUSE.SECURITY_EVENT));
});

test('every pause reason carries readable detail', () => {
  const pause = assessPause(basePolicy, demoTwin, { emergencyStop: true, reconciliationException: true });
  assert.ok(pause.reasons.length >= 2);
  for (const r of pause.reasons) assert.ok(r.detail && r.detail.length > 0, `${r.code} has no detail`);
});

/* ------------------------------------------------------------ limits */

test('limits reject over-sized, over-budget and over-frequent actions', () => {
  const p = activePolicy();
  assert.equal(checkLimits(smallInvest, p, usage()).allowed, true);

  const codes = (u, a = smallInvest) => checkLimits(a, p, u).failures.map((f) => f.code);
  assert.ok(codes(usage(), { ...smallInvest, amountCents: p.maxPerActionCents + 1 }).includes('OVER_PER_ACTION_LIMIT'));
  assert.ok(codes(usage({ executedTodayCents: p.maxPerDayCents })).includes('OVER_DAILY_LIMIT'));
  assert.ok(codes(usage({ executedThisMonthCents: p.maxPerMonthCents })).includes('OVER_MONTHLY_LIMIT'));
  assert.ok(codes(usage({ actionsToday: p.maxActionsPerDay })).includes('OVER_VELOCITY_LIMIT'));
});

test('destination and action-type allowlists are enforced', () => {
  const p = activePolicy();
  const offList = { ...smallInvest, destinationAccountId: 'someone_elses_account' };
  assert.ok(checkLimits(offList, p, usage()).failures.some((f) => f.code === 'DESTINATION_NOT_ALLOWED'));
  const wrongKind = { ...smallInvest, kind: 'transfer' };
  assert.ok(checkLimits(wrongKind, p, usage()).failures.some((f) => f.code === 'ACTION_NOT_ALLOWED'));
});

test('limits report every failure, not just the first', () => {
  const p = activePolicy();
  const bad = { ...smallInvest, kind: 'transfer', destinationAccountId: 'unknown', amountCents: p.maxPerActionCents + 1 };
  assert.ok(checkLimits(bad, p, usage()).failures.length >= 3);
});

test('a non-autonomous mode never executes without asking', () => {
  const assisted = { ...activePolicy(), mode: MODE.ASSISTED };
  const v = mayExecuteAutonomously(smallInvest, assisted, demoTwin, usage());
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => r.code === 'MODE_REQUIRES_APPROVAL'));
});

test('pause outranks limits — a paused system does not even reach them', () => {
  const v = mayExecuteAutonomously(smallInvest, activePolicy(), demoTwin, usage(), { emergencyStop: true });
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => r.code === PAUSE.EMERGENCY_STOP));
});

/* --------------------------------------------------- emergency stop */

test('emergency stop engages immediately and blocks autonomous execution', () => {
  const stop = new EmergencyStop();
  stop.engage(HUMAN, 'card lost');
  assert.equal(stop.engaged, true);
  assert.equal(stop.history.at(-1).action, 'engage');
  assert.equal(mayExecuteAutonomously(smallInvest, activePolicy(), demoTwin, usage(), { emergencyStop: true }).allowed, false);
});

test('automation can never clear an emergency stop', () => {
  const stop = new EmergencyStop().engage(HUMAN);
  for (const actor of [ROBOT, AI, { kind: 'system', id: 'v' }]) {
    assert.throws(() => stop.resume(actor, { reauthenticatedAt: Date.now() }), /only the account holder/);
  }
  assert.equal(stop.engaged, true);
});

test('resuming requires fresh re-authentication', () => {
  const stop = new EmergencyStop().engage(HUMAN);
  const now = Date.now();
  assert.throws(() => stop.resume(HUMAN), /requires re-authentication/);
  assert.throws(() => stop.resume(HUMAN, { reauthenticatedAt: now - 10 * 60 * 1000, now }), /stale/);
  stop.resume(HUMAN, { reauthenticatedAt: now - 1000, now });
  assert.equal(stop.engaged, false);
});

/* -------------------------------------------------- standing rules */

test('a standing rule cannot satisfy a step-up requirement', () => {
  const rec = {
    state: STATE.PENDING_APPROVAL,
    decision: { verdict: 'REQUIRE_REAUTH', twinVersion: 't', constitutionVersion: 'c' },
    history: [],
  };
  assert.throws(
    () => authorizeByStandingRule(rec, { actor: HUMAN, policy: activePolicy() }),
    /requires re-authentication, which a standing rule cannot supply/
  );
});

test('a standing rule cannot authorize a blocked action', () => {
  const rec = { state: STATE.PENDING_APPROVAL, decision: { verdict: 'BLOCK', twinVersion: 't', constitutionVersion: 'c' }, history: [] };
  assert.throws(() => authorizeByStandingRule(rec, { actor: HUMAN, policy: activePolicy() }), /blocked this action/);
});

test('a standing rule must name the person who set it, and be active', () => {
  const rec = { state: STATE.PENDING_APPROVAL, decision: { verdict: 'ALLOW', twinVersion: 't', constitutionVersion: 'c' }, history: [] };
  assert.throws(() => authorizeByStandingRule(rec, { actor: ROBOT, policy: activePolicy() }), /must name the person/);
  assert.throws(() => authorizeByStandingRule(rec, { actor: HUMAN, policy: basePolicy }), /no active standing rule/);
});

test('a standing-rule authorization is recorded as such, with its consent version', () => {
  const rec = { state: STATE.PENDING_APPROVAL, decision: { verdict: 'ALLOW', twinVersion: 't', constitutionVersion: 'c' }, history: [] };
  const p = activePolicy();
  const out = authorizeByStandingRule(rec, { actor: HUMAN, policy: p });
  assert.equal(out.state, STATE.APPROVED);
  assert.equal(out.authorization.basis, 'standing_rule');
  assert.equal(out.authorization.actor.id, 'u_1');
  assert.equal(out.authorization.policyConsentVersion, p.consentVersion);
});

/* ------------------------------------------------- reconciliation */

const balances = (over = {}) =>
  demoTwin.accounts.map((a) => ({ accountId: a.id, balanceCents: over[a.id] ?? a.balanceCents, asOf: AS_OF }));

test('matching balances reconcile clean', () => {
  const r = reconcile(demoTwin, balances());
  assert.equal(r.clean, true);
  assert.equal(r.discrepancies.length, 0);
  assert.match(summarize(r), /reconciled/);
});

test('a balance mismatch is an exception, not a correction', () => {
  const r = reconcile(demoTwin, balances({ chase_checking: 999900 }));
  assert.equal(r.clean, false);
  const d = r.discrepancies[0];
  assert.equal(d.kind, 'balance_mismatch');
  assert.equal(d.accountId, 'chase_checking');
  assert.equal(d.deltaCents, 999900 - 842000);
  // Veyra's own number is left untouched; nobody silently wins.
  assert.equal(demoTwin.accounts.find((a) => a.id === 'chase_checking').balanceCents, 842000);
});

test('accounts missing on either side are breaks', () => {
  const missingAtInstitution = reconcile(demoTwin, balances().filter((b) => b.accountId !== 'ally_savings'));
  assert.ok(missingAtInstitution.discrepancies.some((d) => d.kind === 'missing_at_institution'));

  const extra = reconcile(demoTwin, [...balances(), { accountId: 'ghost', balanceCents: 100, asOf: AS_OF }]);
  assert.ok(extra.discrepancies.some((d) => d.kind === 'missing_internally'));
});

test('only actions touching a broken account are held back', () => {
  const r = reconcile(demoTwin, balances({ chase_checking: 1 }));
  assert.deepEqual(affectedAccountIds(r), ['chase_checking']);
  assert.equal(actionIsAffected(smallInvest, r), true, 'source is broken');
  assert.equal(actionIsAffected({ ...smallInvest, sourceAccountId: 'ally_savings', destinationAccountId: 'fidelity_brokerage' }, r), false);
});

/* ------------------------------------------ engine integration */

function engine(opts = {}) {
  return new Veyra({ twin: demoTwin, constitution: demoConstitution, context: demoContext, autopilot: basePolicy, ...opts });
}

async function enabled() {
  const v = engine();
  await v.enableAutopilot(ALL_ACKS, HUMAN, MODE.GUARDED);
  for (const d of v.disclosuresFor(smallInvest).outstanding) await v.acknowledge(d.id, HUMAN);
  return v;
}

test('the engine reports autopilot status without caching it', async () => {
  const v = await enabled();
  assert.equal(v.autopilotStatus().pause.canRun, true);
  await v.engageEmergencyStop(HUMAN);
  assert.equal(v.autopilotStatus().pause.canRun, false, 'status must reflect state, not a stale flag');
});

test('an eligible action executes under the standing rule and is audited as such', async () => {
  const v = await enabled();
  const out = await v.runAutonomously({ ...smallInvest, id: 'auto_ok' });
  assert.equal(out.executed, true, JSON.stringify(out.reasons));
  assert.equal(out.record.state, STATE.EXECUTED);
  assert.equal(out.record.authorization.basis, 'standing_rule');
  assert.equal(out.record.authorization.actor.id, 'u_1');
  assert.deepEqual(await v.audit.verify(), { valid: true });
});

test('usage accrues so limits actually bite over the day', async () => {
  const v = await enabled();
  await v.runAutonomously({ ...smallInvest, id: 'a' });
  assert.equal(v.usage.actionsToday, 1);
  assert.equal(v.usage.executedTodayCents, 50000);
});

test('an over-limit action falls back to asking rather than failing', async () => {
  const v = await enabled();
  const out = await v.runAutonomously({ ...smallInvest, id: 'too_big', amountCents: 150000 });
  assert.equal(out.executed, false);
  assert.ok(out.reasons.some((r) => r.code === 'OVER_PER_ACTION_LIMIT'));
  assert.equal(v.actions.get('too_big').state, STATE.PENDING_APPROVAL, 'still available for the user to approve');
});

test('emergency stop cancels staged actions and blocks new autonomous ones', async () => {
  const v = await enabled();
  await v.propose({ ...smallInvest, id: 'staged', origin: 'user' }, HUMAN);
  const { cancelled } = await v.engageEmergencyStop(HUMAN, 'lost phone');
  assert.equal(cancelled, 1);
  assert.equal(v.actions.get('staged').state, STATE.REJECTED);

  const out = await v.runAutonomously({ ...smallInvest, id: 'after_stop' });
  assert.equal(out.executed, false);
  assert.ok(out.reasons.some((r) => r.code === PAUSE.EMERGENCY_STOP));
});

test('resuming after an emergency stop needs the account holder and fresh auth', async () => {
  const v = await enabled();
  await v.engageEmergencyStop(HUMAN);
  await assert.rejects(() => v.resumeAutomation(ROBOT, { reauthenticatedAt: Date.now() }), /only the account holder/);
  await assert.rejects(() => v.resumeAutomation(HUMAN), /requires re-authentication/);
  const status = await v.resumeAutomation(HUMAN, { reauthenticatedAt: Date.now() });
  assert.equal(status.emergencyStopEngaged, false);
});

test('a reconciliation break stops autonomous action on the affected account', async () => {
  const v = await enabled();
  await v.runReconciliation(balances({ chase_checking: 1 }));
  assert.equal(v.reconciliation.clean, false);

  const out = await v.runAutonomously({ ...smallInvest, id: 'after_break' });
  assert.equal(out.executed, false);
  assert.ok(out.reasons.some((r) => r.code === PAUSE.RECONCILIATION_EXCEPTION));
  assert.ok(v.audit.records.some((r) => r.event === 'RECONCILIATION_EXCEPTION'));
});

test('a clean reconciliation leaves automation running', async () => {
  const v = await enabled();
  await v.runReconciliation(balances());
  assert.equal(v.autopilotStatus().pause.canRun, true);
});

test('an unacknowledged disclosure stops autonomous execution', async () => {
  const v = engine();
  await v.enableAutopilot(ALL_ACKS, HUMAN, MODE.GUARDED); // no disclosure acks
  const out = await v.runAutonomously({ ...smallInvest, id: 'undisclosed' });
  assert.equal(out.executed, false);
  assert.ok(out.reasons.some((r) => r.code === 'DISCLOSURE_REQUIRED'));
});

test('§42: a failed execution stops further automation until reviewed', async () => {
  const v = new Veyra({
    twin: demoTwin, constitution: demoConstitution, context: demoContext, autopilot: basePolicy,
    executor: async () => { throw new Error('bank timeout'); },
  });
  await v.enableAutopilot(ALL_ACKS, HUMAN, MODE.GUARDED);
  for (const d of v.disclosuresFor(smallInvest).outstanding) await v.acknowledge(d.id, HUMAN);

  const first = await v.runAutonomously({ ...smallInvest, id: 'will_fail' });
  assert.equal(first.executed, false);
  assert.equal(first.record.state, STATE.FAILED);
  assert.equal(v.unreviewedExecutionFailure, true);

  const second = await v.runAutonomously({ ...smallInvest, id: 'after_failure' });
  assert.equal(second.executed, false);
  assert.ok(second.reasons.some((r) => r.code === PAUSE.RECENT_EXECUTION_FAILURE));
});

test('§42: automation never runs against a stale balance', async () => {
  const stale = seal({
    ...demoTwin,
    accounts: demoTwin.accounts.map((a) =>
      a.id === 'chase_checking' ? { ...a, lastSyncedAt: new Date(Date.parse(AS_OF) - 48 * 3600_000).toISOString() } : a
    ),
  });
  const v = new Veyra({ twin: stale, constitution: demoConstitution, context: demoContext, autopilot: basePolicy });
  await v.enableAutopilot(ALL_ACKS, HUMAN, MODE.GUARDED);
  for (const d of v.disclosuresFor(smallInvest).outstanding) await v.acknowledge(d.id, HUMAN);

  const out = await v.runAutonomously({ ...smallInvest, id: 'stale_run' });
  assert.equal(out.executed, false);
  assert.ok(out.reasons.some((r) => r.code === PAUSE.STALE_DATA));
});

test('§42: a duplicate autonomous request moves money once', async () => {
  const v = await enabled();
  let calls = 0;
  v.executor = async (a, key) => { calls += 1; return { ok: true, reference: key }; };

  // The same scheduled action delivered twice — a retried job, a replayed
  // webhook — must not move money twice.
  const first = await v.runAutonomously({ ...smallInvest, id: 'dup' });
  const second = await v.runAutonomously({ ...smallInvest, id: 'dup' });

  assert.equal(first.executed, true);
  assert.equal(second.executed, true, 'the replay still reports success');
  assert.equal(calls, 1, 'executor ran more than once for one action');
  assert.deepEqual(second.record.result, first.record.result, 'replay returns the original result');
  assert.equal(v.usage.executedTodayCents, 50000, 'usage must not double-count');
});

test('calling execute() on a settled action is a loud error, not a silent no-op', async () => {
  const v = await enabled();
  await v.runAutonomously({ ...smallInvest, id: 'settled' });
  await assert.rejects(() => v.execute('settled'), /is EXECUTED, not APPROVED/);
});

test('disabling Autopilot stops autonomous execution immediately', async () => {
  const v = await enabled();
  await v.disableAutopilot(HUMAN);
  const out = await v.runAutonomously({ ...smallInvest, id: 'after_disable' });
  assert.equal(out.executed, false);
  assert.ok(out.reasons.some((r) => r.code === PAUSE.NOT_ENABLED));
});

/* --------------------------------- the two permission systems must agree */

import { levelForMode } from '../autopilot.mjs';
import { LEVEL, gate } from '../authorization.mjs';

test('the authorization level is derived from the mode, never set beside it', () => {
  assert.equal(levelForMode({ ...basePolicy, enabled: false, mode: MODE.MANUAL }), LEVEL.RECOMMEND);
  assert.equal(levelForMode({ ...basePolicy, enabled: false, mode: MODE.ASSISTED }), LEVEL.APPROVE_EACH);
  assert.equal(levelForMode({ ...basePolicy, enabled: true, mode: MODE.GUARDED }), LEVEL.RECURRING_RULE);
  assert.equal(levelForMode({ ...basePolicy, enabled: true, mode: MODE.FULL }), LEVEL.BOUNDED_AUTOMATION);
});

test('enabling autopilot raises the level, and disabling lowers it', async () => {
  const v = engine();
  assert.equal(v.authorizationLevel, LEVEL.APPROVE_EACH);
  await v.enableAutopilot(ALL_ACKS, HUMAN, MODE.GUARDED);
  assert.equal(v.authorizationLevel, LEVEL.RECURRING_RULE);
  await v.disableAutopilot(HUMAN);
  assert.equal(v.authorizationLevel, LEVEL.APPROVE_EACH);
});

test('after disabling, a scheduled action is still staged for approval rather than throwing', async () => {
  const v = await enabled();
  await v.disableAutopilot(HUMAN);
  const out = await v.runAutonomously({ ...smallInvest, id: 'after_disable_staged' });
  assert.equal(out.executed, false);
  assert.ok(out.reasons.some((r) => r.code === PAUSE.NOT_ENABLED));
  assert.equal(v.actions.get('after_disable_staged').state, STATE.PENDING_APPROVAL,
    'the user must still be able to approve it by hand');
});

test('raising the level alone does not let automation act', async () => {
  // Fails closed: the gate opens but the pause assessment still says NOT_ENABLED.
  const v = new Veyra({
    twin: demoTwin, constitution: demoConstitution, context: demoContext,
    autopilot: basePolicy, authorizationLevel: LEVEL.BOUNDED_AUTOMATION,
  });
  const out = await v.runAutonomously({ ...smallInvest, id: 'level_only' });
  assert.equal(out.executed, false);
  assert.ok(out.reasons.some((r) => r.code === PAUSE.NOT_ENABLED));
});

test('an idempotent replay is flagged, so nothing downstream accrues twice', async () => {
  const v = await enabled();
  await v.runAutonomously({ ...smallInvest, id: 'flag_check' });
  const replay = await v.runAutonomously({ ...smallInvest, id: 'flag_check' });
  assert.equal(replay.record.replayed, true);
  assert.equal(v.context.executedTodayCents, 50000, 'constitution velocity counter must not double-count either');
});
