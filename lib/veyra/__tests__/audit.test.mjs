import test from 'node:test';
import assert from 'node:assert/strict';
import { AuditLog } from '../audit.mjs';

const HUMAN = { kind: 'user', id: 'u_1' };

async function chainOf(n) {
  const log = new AuditLog();
  for (let i = 0; i < n; i++) await log.append({ event: 'E' + i, actor: HUMAN, reason: 'r' + i });
  return log;
}

test('records chain to their predecessor and verify clean', async () => {
  const log = await chainOf(5);
  assert.equal(log.records[0].prevHash, '0'.repeat(64));
  for (let i = 1; i < 5; i++) assert.equal(log.records[i].prevHash, log.records[i - 1].hash);
  assert.deepEqual(await log.verify(), { valid: true });
});

test('editing a past record is detected at that record', async () => {
  const log = await chainOf(5);
  log.records[2] = { ...log.records[2], reason: 'tampered' };
  const res = await log.verify();
  assert.equal(res.valid, false);
  assert.equal(res.brokeAt, 2);
});

test('deleting a record is detected', async () => {
  const log = await chainOf(5);
  log.records.splice(2, 1);
  assert.equal((await log.verify()).valid, false);
});

test('records are frozen against in-place mutation', async () => {
  const log = await chainOf(1);
  assert.throws(() => { 'use strict'; log.records[0].reason = 'x'; }, TypeError);
});

test('an action record contributes the full §32 field set', async () => {
  const log = new AuditLog();
  const rec = await log.append({
    event: 'TRANSFER_EXECUTED',
    actor: HUMAN,
    reason: 'executed',
    record: {
      action: { id: 'a1', amountCents: 50000, sourceAccountId: 'chase_checking', destinationAccountId: 'fidelity_brokerage' },
      decision: { verdict: 'ALLOW', twinVersion: 'twin_1', constitutionVersion: 'pol_1' },
      risk: { score: 12 },
    },
  });
  for (const field of ['seq', 'at', 'event', 'actorId', 'actorKind', 'actionId', 'amountCents',
    'sourceAccountId', 'destinationAccountId', 'verdict', 'riskScore', 'twinVersion',
    'constitutionVersion', 'reason', 'prevHash', 'hash']) {
    assert.ok(field in rec, `missing audit field: ${field}`);
  }
});

test('hashing is order-independent over keys, so serialization order cannot break verification', async () => {
  const log = await chainOf(3);
  const reordered = Object.fromEntries(Object.entries(log.records[1]).reverse());
  log.records[1] = Object.freeze(reordered);
  assert.deepEqual(await log.verify(), { valid: true });
});
