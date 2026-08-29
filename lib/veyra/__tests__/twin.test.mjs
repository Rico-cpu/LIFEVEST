import test from 'node:test';
import assert from 'node:assert/strict';
import { demoTwin, demoConstitution } from '../fixtures.mjs';
import {
  netWorthCents, liquidCents, deployableCents, essentialMonthlyBurnCents,
  safeToDeploy, reserveStatus, projectedBalanceCents, seal, fingerprint,
} from '../twin.mjs';

test('net worth nets liabilities against assets', () => {
  assert.equal(netWorthCents(demoTwin), 8642100);
});

test('earmarked cash is liquid but not deployable', () => {
  assert.equal(liquidCents(demoTwin), 842000 + 2160000);
  assert.equal(deployableCents(demoTwin), 842000);
});

test('safe-to-deploy reproduces the blueprint §16 trace line for line', () => {
  const std = safeToDeploy(demoTwin, demoConstitution);
  assert.deepEqual(
    std.trace.map((t) => t.amountCents),
    [842000, -210000, -400000, -18000]
  );
  assert.equal(std.amountCents, 214000);
});

test('safe-to-deploy never reports a negative headroom, but keeps the honest number', () => {
  const broke = seal({ ...demoTwin, accounts: demoTwin.accounts.map((a) => (a.id === 'chase_checking' ? { ...a, balanceCents: 10000 } : a)) });
  const std = safeToDeploy(broke, demoConstitution);
  assert.equal(std.amountCents, 0);
  assert.ok(std.rawCents < 0);
});

test('reserve is measured from earmarked cash against essential burn', () => {
  assert.equal(essentialMonthlyBurnCents(demoTwin), 360000);
  const r = reserveStatus(demoTwin, demoConstitution);
  assert.equal(r.monthsFunded, 6);
  assert.ok(r.fullyFunded);
});

test('authorization projections exclude expected income by default', () => {
  const guard = projectedBalanceCents(demoTwin, 'chase_checking', 30);
  const planning = projectedBalanceCents(demoTwin, 'chase_checking', 30, { includeExpectedIncome: true });
  assert.equal(guard, 842000 - 210000 - 18000);
  assert.ok(planning > guard, 'planning view may credit income; the guardrail may not');
});

test('the floor check and safe-to-deploy agree on the maximum safe action', () => {
  const std = safeToDeploy(demoTwin, demoConstitution).amountCents;
  const after = projectedBalanceCents(demoTwin, 'chase_checking', 30) - std;
  assert.equal(after, demoConstitution.cashFloorCents);
});

test('fingerprint changes when any material figure changes', () => {
  const a = fingerprint(demoTwin);
  const b = fingerprint({ ...demoTwin, accounts: demoTwin.accounts.map((x) => (x.id === 'chase_checking' ? { ...x, balanceCents: 842001 } : x)) });
  assert.notEqual(a, b);
});

test('sealed twins reject non-integer money', () => {
  assert.throws(() => seal({ ...demoTwin, accounts: [{ ...demoTwin.accounts[0], balanceCents: 12.5 }] }), TypeError);
});
