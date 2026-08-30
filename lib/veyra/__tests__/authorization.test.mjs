/**
 * The invariants that make "AI can think with your money, it cannot control
 * your money" a property of the system rather than a slogan.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { demoTwin, demoConstitution, demoContext } from '../fixtures.mjs';
import { sealConstitution } from '../policy.mjs';
import { seal } from '../twin.mjs';
import { propose, approve, execute, revalidate, STATE, TransitionError, REAUTH_FRESHNESS_MS, APPROVAL_TTL_MS } from '../actions.mjs';
import { Veyra } from '../engine.mjs';
import { LEVEL, capabilities, gate } from '../authorization.mjs';

const HUMAN = { kind: 'user', id: 'u_1' };
const AI = { kind: 'ai', id: 'assistant' };
const ROBOT = { kind: 'automation', id: 'rule_runner' };
const SYS = { kind: 'system', id: 'veyra' };

const smallInvest = {
  id: 'a1', kind: 'invest', amountCents: 50000,
  sourceAccountId: 'chase_checking', destinationAccountId: 'fidelity_brokerage',
  destinationKnown: true, origin: 'user', rationale: 'test',
};

const mk = (over = {}) => propose({ ...smallInvest, ...over }, demoTwin, demoConstitution, demoContext, SYS);

test('no non-human actor may ever approve — not AI, not automation, not the system', () => {
  const rec = mk();
  for (const actor of [AI, ROBOT, SYS]) {
    assert.throws(() => approve(rec, actor), /may never approve/, `${actor.kind} was allowed to approve`);
  }
  assert.equal(approve(rec, HUMAN).state, STATE.APPROVED);
});

test('a blocked action cannot be approved by anyone', () => {
  const rec = mk({ amountCents: 400000 });
  assert.equal(rec.state, STATE.BLOCKED);
  assert.throws(() => approve(rec, HUMAN), TransitionError);
});

test('REQUIRE_REAUTH will not accept a bare approval', () => {
  const rec = mk({ destinationAccountId: 'new_acct', destinationKnown: false, amountCents: 10000 });
  assert.throws(() => approve(rec, HUMAN), /re-authentication required/);
});

test('a stale re-authentication is refused', () => {
  const rec = mk({ destinationAccountId: 'new_acct', destinationKnown: false, amountCents: 10000 });
  const now = Date.now();
  assert.throws(() => approve(rec, HUMAN, { reauthenticatedAt: now - REAUTH_FRESHNESS_MS - 1, now }), /stale/);
  assert.equal(approve(rec, HUMAN, { reauthenticatedAt: now - 1000, now }).state, STATE.APPROVED);
});

test('an approval is void once the financial state moves underneath it', () => {
  const approved = approve(mk(), HUMAN);
  const drained = seal({
    ...demoTwin,
    accounts: demoTwin.accounts.map((a) => (a.id === 'chase_checking' ? { ...a, balanceCents: 50000 } : a)),
  });
  const res = revalidate(approved, drained, demoConstitution, demoContext, SYS);
  assert.equal(res.ok, false);
  assert.match(res.reason, /state changed/);
  assert.equal(res.record.state, STATE.BLOCKED, 're-evaluation under the new reality blocks it');
});

test('an approval is void once the constitution changes', () => {
  const approved = approve(mk(), HUMAN);
  const stricter = sealConstitution({ ...demoConstitution, cashFloorCents: 800000 });
  const res = revalidate(approved, demoTwin, stricter, demoContext, SYS);
  assert.equal(res.ok, false);
  assert.equal(res.record.authorization, null, 'the old authorization does not carry over');
});

test('an approval expires', () => {
  const approved = approve(mk(), HUMAN);
  const res = revalidate(approved, demoTwin, demoConstitution, demoContext, SYS, { now: Date.now() + APPROVAL_TTL_MS + 1 });
  assert.equal(res.ok, false);
  assert.equal(res.record.state, STATE.EXPIRED);
});

test('execution refuses anything that is not an approved action', async () => {
  await assert.rejects(() => execute(mk(), async () => ({}), SYS, new Map()), TransitionError);
});

test('execution is idempotent — a replayed key never moves money twice', async () => {
  const ledger = new Map();
  let calls = 0;
  const executor = async () => { calls += 1; return { ref: calls }; };
  const approved = approve(mk(), HUMAN);

  const first = await execute(approved, executor, SYS, ledger);
  const replay = await execute(approved, executor, SYS, ledger);

  assert.equal(calls, 1);
  assert.equal(first.state, STATE.EXECUTED);
  assert.equal(replay.state, STATE.EXECUTED);
  assert.deepEqual(replay.result, first.result);
});

test('an executor failure lands in FAILED, never in EXECUTED', async () => {
  const done = await execute(approve(mk(), HUMAN), async () => { throw new Error('bank timeout'); }, SYS, new Map());
  assert.equal(done.state, STATE.FAILED);
  assert.match(done.result.error, /bank timeout/);
});

test('state cannot be skipped', () => {
  const rec = mk();
  assert.equal(rec.state, STATE.PENDING_APPROVAL);
  const approved = approve(rec, HUMAN);
  assert.throws(() => approve(approved, HUMAN), TransitionError);
});

test('every record carries a full transition history with its actors', () => {
  const approved = approve(mk(), HUMAN);
  assert.ok(approved.history.length >= 2);
  assert.equal(approved.history.at(-1).to, STATE.APPROVED);
  assert.equal(approved.history.at(-1).by.kind, 'user');
  assert.equal(approved.authorization.actor.id, 'u_1');
  assert.equal(approved.authorization.twinVersion, demoTwin.version);
});

test('authorization levels cap what may be prepared, and never who may authorize', () => {
  assert.equal(gate(LEVEL.READ_ONLY, smallInvest).allowed, false);
  assert.equal(gate(LEVEL.RECOMMEND, smallInvest).allowed, false);
  assert.equal(gate(LEVEL.PREPARE, smallInvest).allowed, true);
  assert.equal(gate(LEVEL.APPROVE_EACH, { ...smallInvest, origin: 'automation' }).allowed, false);
  assert.equal(gate(LEVEL.RECURRING_RULE, { ...smallInvest, origin: 'automation' }).allowed, true);

  for (const level of [0, 1, 2, 3, 4, 5]) {
    assert.equal(capabilities(level, 'ai').canAuthorize, false);
    assert.equal(capabilities(level, 'automation').canAuthorize, false);
    assert.equal(capabilities(level, 'user').canAuthorize, true);
  }
});

test('the engine refuses to prepare below level 2', async () => {
  const v = new Veyra({ twin: demoTwin, constitution: demoConstitution, context: demoContext, authorizationLevel: LEVEL.RECOMMEND });
  await assert.rejects(() => v.propose(smallInvest), /does not permit/);
});

test('end to end: propose, disclose, approve, execute — with a complete audit chain', async () => {
  const v = new Veyra({ twin: demoTwin, constitution: demoConstitution, context: demoContext });
  await v.propose(smallInvest, HUMAN);
  for (const d of v.disclosuresFor(smallInvest).outstanding) await v.acknowledge(d.id, HUMAN);
  await v.approve('a1', HUMAN);
  const done = await v.execute('a1');

  assert.equal(done.state, STATE.EXECUTED);
  assert.equal(v.context.executedTodayCents, 50000);
  assert.deepEqual(await v.audit.verify(), { valid: true });
  assert.deepEqual(
    v.audit.records.map((r) => r.event).filter((e) => e !== 'DISCLOSURE_ACKNOWLEDGED'),
    ['TRANSFER_PROPOSED', 'TRANSFER_APPROVED', 'TRANSFER_EXECUTED']
  );
  assert.ok(v.audit.records.some((r) => r.event === 'DISCLOSURE_ACKNOWLEDGED'));
});

test('changing the constitution invalidates outstanding approvals', async () => {
  const v = new Veyra({ twin: demoTwin, constitution: demoConstitution, context: demoContext });
  await v.propose(smallInvest, HUMAN);
  for (const d of v.disclosuresFor(smallInvest).outstanding) await v.acknowledge(d.id, HUMAN);
  await v.approve('a1', HUMAN);
  assert.equal(v.actions.get('a1').state, STATE.APPROVED);

  await v.updateConstitution(sealConstitution({ ...demoConstitution, cashFloorCents: 800000 }), HUMAN);
  assert.equal(v.actions.get('a1').state, STATE.BLOCKED);
  assert.equal(v.actions.get('a1').authorization, null);
});

test('only the account holder may change the constitution', async () => {
  const v = new Veyra({ twin: demoTwin, constitution: demoConstitution, context: demoContext });
  await assert.rejects(() => v.updateConstitution(demoConstitution, AI), /only the account holder/);
});

test('an assistant proposal reaches the user, never the executor', async () => {
  const v = new Veyra({ twin: demoTwin, constitution: demoConstitution, context: demoContext });
  const rec = await v.propose({ ...smallInvest, origin: 'ai' }, AI);
  assert.equal(rec.state, STATE.PENDING_APPROVAL);
  assert.notEqual(rec.decision.verdict, 'ALLOW');
  await assert.rejects(() => v.execute('a1'), /is PENDING_APPROVAL, not APPROVED/);
});
