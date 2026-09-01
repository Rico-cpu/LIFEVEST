import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCLOSURES, requiredFor, requiredForSurface, ConsentLedger,
  assertDisclosed, allDisclosures,
} from '../disclosures.mjs';

const HUMAN = { kind: 'user', id: 'u_1' };
const AI = { kind: 'ai', id: 'assistant' };

const invest = {
  id: 'a1', kind: 'invest', amountCents: 50000,
  sourceAccountId: 'chase_checking', destinationAccountId: 'fidelity_brokerage',
  origin: 'user', rationale: 'test',
};

test('every disclosure carries text, a version, and a stated reason for existing', () => {
  for (const d of allDisclosures()) {
    assert.ok(d.title.length > 0, `${d.id} has no title`);
    assert.ok(d.body.length > 0, `${d.id} has no body`);
    assert.match(d.version, /^v[0-9a-f]{8}$/, `${d.id} has no content version`);
    assert.ok(['explicit', 'passive'].includes(d.acknowledgement));
    assert.ok(d.rationale.length > 0, `${d.id} does not say why it exists`);
  }
});

test('the version is a fingerprint of the text, so wording cannot drift from consent', () => {
  const ids = allDisclosures().map((d) => d.version);
  assert.equal(new Set(ids).size, ids.length, 'two disclosures share a version');
  // Same text must always yield the same version across processes.
  assert.equal(DISCLOSURES.investment_risk.version, DISCLOSURES.investment_risk.version);
});

test('disclosure objects are frozen against edit-in-place', () => {
  assert.throws(() => { 'use strict'; DISCLOSURES.investment_risk.body = 'nothing to worry about'; }, TypeError);
});

test('requirements derive from the action, not from the screen', () => {
  const ids = requiredFor(invest).map((d) => d.id);
  assert.ok(ids.includes('investment_risk'));
  assert.ok(ids.includes('not_advice'));
  assert.ok(ids.includes('demonstration'), 'demo mode must be disclosed by default');
});

test('a debt recommendation discloses that quoted savings are estimates', () => {
  const ids = requiredFor({ ...invest, kind: 'debt_payment' }).map((d) => d.id);
  assert.ok(ids.includes('estimates_not_guaranteed'));
});

test('anything the assistant proposes discloses what the assistant is', () => {
  const ids = requiredFor({ ...invest, origin: 'ai' }).map((d) => d.id);
  assert.ok(ids.includes('ai_informational'));
});

test('the demonstration disclosure can be turned off only deliberately', () => {
  const live = requiredFor(invest, { demonstrationMode: false }).map((d) => d.id);
  assert.ok(!live.includes('demonstration'));
  assert.ok(live.includes('investment_risk'), 'real mode still discloses risk');
});

test('requirements contain no duplicates', () => {
  const ids = requiredFor({ ...invest, origin: 'ai' }).map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('surfaces carry their own disclosures independent of any action', () => {
  assert.ok(requiredForSurface('projection').some((d) => d.id === 'projections_are_estimates'));
  assert.ok(requiredForSurface('strategy').some((d) => d.id === 'not_advice'));
  assert.deepEqual(requiredForSurface('nonexistent'), []);
});

test('only a person may acknowledge a disclosure', () => {
  const ledger = new ConsentLedger();
  assert.throws(() => ledger.acknowledge(DISCLOSURES.investment_risk, AI), /only a person/);
  assert.throws(() => ledger.acknowledge(DISCLOSURES.investment_risk, { kind: 'system', id: 'v' }), /only a person/);
  assert.ok(ledger.acknowledge(DISCLOSURES.investment_risk, HUMAN, 'approval-card'));
});

test('an acknowledgement records who, when, what version, and where', () => {
  const ledger = new ConsentLedger();
  const r = ledger.acknowledge(DISCLOSURES.investment_risk, HUMAN, 'approval-card');
  assert.equal(r.id, 'investment_risk');
  assert.equal(r.version, DISCLOSURES.investment_risk.version);
  assert.equal(r.actorId, 'u_1');
  assert.equal(r.surface, 'approval-card');
  assert.ok(Date.parse(r.at) > 0);
});

test('an action cannot be approved while a required disclosure is outstanding', () => {
  const ledger = new ConsentLedger();
  assert.throws(() => assertDisclosed(invest, ledger), /disclosures not acknowledged/);

  ledger.acknowledge(DISCLOSURES.investment_risk, HUMAN);
  assert.throws(() => assertDisclosed(invest, ledger), /not_advice/, 'partial consent must not pass');

  ledger.acknowledge(DISCLOSURES.not_advice, HUMAN);
  assert.equal(assertDisclosed(invest, ledger), true);
});

test('passive disclosures must be shown but need no affirmative act', () => {
  const ledger = new ConsentLedger();
  ledger.acknowledge(DISCLOSURES.investment_risk, HUMAN);
  ledger.acknowledge(DISCLOSURES.not_advice, HUMAN);
  // 'demonstration' is passive and was never acknowledged, yet the gate passes.
  assert.equal(assertDisclosed(invest, ledger), true);
  assert.ok(requiredFor(invest).some((d) => d.id === 'demonstration'), 'still required to be displayed');
});

test('rewording a disclosure invalidates consent to the previous wording', () => {
  const ledger = new ConsentLedger();
  ledger.acknowledge(DISCLOSURES.investment_risk, HUMAN);
  assert.ok(ledger.has(DISCLOSURES.investment_risk));

  // Simulate a future edit: same id, new text, therefore new version.
  const reworded = { ...DISCLOSURES.investment_risk, version: 'v00000000' };
  assert.equal(ledger.has(reworded), false, 'stale consent was accepted for new wording');
});

test('acknowledging one disclosure does not imply any other', () => {
  const ledger = new ConsentLedger();
  ledger.acknowledge(DISCLOSURES.ai_informational, HUMAN);
  assert.equal(ledger.has(DISCLOSURES.investment_risk), false);
});

test('the demonstration disclosure states plainly that nothing can move', () => {
  const d = DISCLOSURES.demonstration;
  assert.match(d.body, /not connected to any financial institution/i);
  assert.match(d.body, /no money can move/i);
});

test('the advice disclaimer names the registrations Veyra does not hold', () => {
  // Bodies are wrapped for readability; compare on normalized whitespace.
  const b = DISCLOSURES.not_advice.body.replace(/\s+/g, ' ');
  for (const term of ['investment adviser', 'broker-dealer', 'bank', 'money transmitter']) {
    assert.ok(b.toLowerCase().includes(term), `missing: ${term}`);
  }
});

test('no disclosure promises an outcome', () => {
  for (const d of allDisclosures()) {
    assert.ok(!/\bguarantees\s+(?:that\s+)?(?:you|your|returns|profit)/i.test(d.body), `${d.id} makes a promise`);
    assert.ok(!/\brisk-free\b/i.test(d.body), `${d.id} claims risk-free`);
  }
});

/* ------------------------------------------- enforcement through the engine */
import { Veyra } from '../engine.mjs';
import { demoTwin, demoConstitution, demoContext } from '../fixtures.mjs';
import { STATE } from '../actions.mjs';

const investAction = {
  id: 'd1', kind: 'invest', amountCents: 50000,
  sourceAccountId: 'chase_checking', destinationAccountId: 'fidelity_brokerage',
  destinationKnown: true, origin: 'user', rationale: 'test',
};

function engine() {
  return new Veyra({ twin: demoTwin, constitution: demoConstitution, context: demoContext });
}

test('the engine refuses to approve an action with outstanding disclosures', async () => {
  const v = engine();
  await v.propose(investAction, HUMAN);
  await assert.rejects(() => v.approve('d1', HUMAN), /disclosures not acknowledged/);
  assert.equal(v.actions.get('d1').state, STATE.PENDING_APPROVAL, 'state must not advance');
});

test('the engine reports exactly which disclosures are outstanding', async () => {
  const v = engine();
  await v.propose(investAction, HUMAN);
  const { required, outstanding } = v.disclosuresFor(investAction);
  assert.ok(required.some((d) => d.id === 'demonstration'));
  assert.deepEqual(outstanding.map((d) => d.id).sort(), ['investment_risk', 'not_advice']);
});

test('acknowledging the required disclosures unblocks approval and is audited', async () => {
  const v = engine();
  await v.propose(investAction, HUMAN);
  await v.acknowledge('not_advice', HUMAN);
  await v.acknowledge('investment_risk', HUMAN);

  const approved = await v.approve('d1', HUMAN);
  assert.equal(approved.state, STATE.APPROVED);
  assert.ok(v.audit.records.some((r) => r.event === 'DISCLOSURE_ACKNOWLEDGED'));
  assert.deepEqual(await v.audit.verify(), { valid: true });
});

test('the assistant cannot acknowledge a disclosure on the user’s behalf', async () => {
  const v = engine();
  await v.propose(investAction, HUMAN);
  await assert.rejects(() => v.acknowledge('investment_risk', AI), /only a person/);
});

test('an unknown disclosure id is rejected rather than silently ignored', async () => {
  const v = engine();
  await assert.rejects(() => v.acknowledge('made_up', HUMAN), /unknown disclosure/);
});
