/**
 * Authentication primitives. These are the parts where a mistake is a breach
 * rather than a bug, so they are tested directly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword, verifyPassword, needsRehash, validatePassword,
  normalizeEmail, validEmail, MIN_LENGTH, PARAMS,
} from '../../auth/password.mjs';
import {
  memoryStore, consume, peek, reset, checkSignIn, recordFailure, recordSuccess, LIMITS,
} from '../../auth/ratelimit.mjs';

/* -------------------------------------------------------------- hashing */

test('a hash never contains the password and is salted per call', async () => {
  const pw = 'correct horse battery staple';
  const a = await hashPassword(pw);
  const b = await hashPassword(pw);
  assert.ok(!a.includes(pw), 'plaintext leaked into the hash');
  assert.notEqual(a, b, 'same password produced the same hash — salt is missing or fixed');
  assert.ok(await verifyPassword(pw, a));
  assert.ok(await verifyPassword(pw, b));
});

test('the hash records its own parameters so cost can be raised later', async () => {
  const h = await hashPassword('correct horse battery staple');
  const [scheme, N, r, p] = h.split('$');
  assert.equal(scheme, 'scrypt');
  assert.equal(Number(N), PARAMS.N);
  assert.equal(Number(r), PARAMS.r);
  assert.equal(Number(p), PARAMS.p);
});

test('verification rejects the wrong password', async () => {
  const h = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('Correct horse battery staple', h), false);
  assert.equal(await verifyPassword('', h), false);
  assert.equal(await verifyPassword('correct horse battery stapl', h), false);
});

test('a corrupt or tampered hash fails closed, it does not throw or pass', async () => {
  const cases = [
    '', 'garbage', 'scrypt$$$$$', 'bcrypt$1$2$3$4$5',
    'scrypt$16384$8$1$notbase64!!$alsonot!!',
    'scrypt$999999999$8$1$AAAA$AAAA',   // absurd N
    'scrypt$16384$0$1$AAAA$AAAA',       // invalid r
    'scrypt$16384$8$1$$',               // empty salt and hash
  ];
  for (const stored of cases) {
    assert.equal(await verifyPassword('anything', stored), false, `accepted: ${stored}`);
  }
  assert.equal(await verifyPassword('x', null), false);
  assert.equal(await verifyPassword(null, 'x'), false);
});

test('unicode passwords match regardless of how the platform composed them', async () => {
  // Same string, decomposed vs precomposed. Without NFKC these hash differently.
  const decomposed = 'café latte machine';
  const precomposed = 'café latte machine';
  assert.notEqual(decomposed, precomposed);
  const h = await hashPassword(decomposed);
  assert.ok(await verifyPassword(precomposed, h), 'equivalent unicode failed to verify');
});

test('password policy enforces length, not symbol theatre', async () => {
  assert.equal(validatePassword('short').ok, false);
  assert.equal(validatePassword('a'.repeat(MIN_LENGTH - 1)).ok, false);
  assert.equal(validatePassword('a'.repeat(MIN_LENGTH)).ok, true);
  assert.equal(validatePassword('            ').ok, false, 'whitespace-only accepted');
  assert.equal(validatePassword('a'.repeat(300)).ok, false, 'unbounded input is a DoS vector');
  // A long passphrase with no symbols is fine.
  assert.equal(validatePassword('the quick brown fox jumps').ok, true);
});

test('hashing refuses a password that fails policy', async () => {
  await assert.rejects(() => hashPassword('short'), /at least 12/);
});

test('needsRehash flags hashes weaker than current parameters', async () => {
  assert.equal(needsRehash(await hashPassword('correct horse battery staple')), false);
  assert.equal(needsRehash('scrypt$16384$8$1$AAAA$AAAA'), true);
  assert.equal(needsRehash('bcrypt$whatever'), true);
});

/* --------------------------------------------------------------- email */

test('email is normalized so case cannot fork an account', () => {
  assert.equal(normalizeEmail('  Rico@Example.COM '), 'rico@example.com');
  assert.equal(normalizeEmail(null), '');
});

test('email validation is permissive but bounded', () => {
  for (const good of ['a@b.co', 'rico.green+veyra@example.com', 'x@sub.domain.io']) {
    assert.ok(validEmail(good), `rejected valid: ${good}`);
  }
  for (const bad of ['', 'nope', 'a@b', 'a b@c.com', '@b.com', 'a@'.repeat(200)]) {
    assert.equal(validEmail(bad), false, `accepted invalid: ${bad}`);
  }
});

/* --------------------------------------------------------- rate limits */

test('a budget allows up to its maximum, then refuses', async () => {
  const store = memoryStore();
  const limit = { max: 3, windowMs: 1000 };
  for (let i = 0; i < 3; i++) {
    assert.equal((await consume(store, 'k', limit)).allowed, true, `attempt ${i + 1} refused`);
  }
  const blocked = await consume(store, 'k', limit);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0, 'must say when to retry');
});

test('a budget refills after its window', async () => {
  const store = memoryStore();
  const limit = { max: 1, windowMs: 1000 };
  const t0 = 1_000_000;
  assert.equal((await consume(store, 'k', limit, { now: t0 })).allowed, true);
  assert.equal((await consume(store, 'k', limit, { now: t0 + 500 })).allowed, false);
  assert.equal((await consume(store, 'k', limit, { now: t0 + 1001 })).allowed, true);
});

test('peek does not consume', async () => {
  const store = memoryStore();
  const limit = { max: 2, windowMs: 1000 };
  await peek(store, 'k', limit);
  await peek(store, 'k', limit);
  assert.equal((await consume(store, 'k', limit)).allowed, true);
});

test('grinding one account trips the identifier budget', async () => {
  const store = memoryStore();
  const ctx = { identifier: 'victim@example.com', source: '' };
  for (let i = 0; i < LIMITS.identifier.max; i++) {
    // Each failure comes from a different address, so only the account budget bites.
    await recordFailure(store, { ...ctx, source: `10.0.0.${i}` });
  }
  const check = await checkSignIn(store, { ...ctx, source: '10.0.0.99' });
  assert.equal(check.allowed, false);
});

test('spraying many accounts from one source trips the source budget', async () => {
  const store = memoryStore();
  const source = '203.0.113.7';
  for (let i = 0; i < LIMITS.source.max; i++) {
    await recordFailure(store, { identifier: `user${i}@example.com`, source });
  }
  const check = await checkSignIn(store, { identifier: 'fresh@example.com', source });
  assert.equal(check.allowed, false, 'a never-targeted account was still reachable from a spraying source');
});

test('the refusal message does not reveal which budget tripped', async () => {
  const store = memoryStore();
  const ctx = { identifier: 'a@b.com', source: '1.2.3.4' };
  for (let i = 0; i < LIMITS.identifier.max; i++) await recordFailure(store, ctx);
  const check = await checkSignIn(store, ctx);
  assert.equal(check.allowed, false);
  assert.match(check.reason, /Too many attempts/);
  assert.ok(!/identifier|source|ip|account/i.test(check.reason), `leaks the budget: ${check.reason}`);
});

test('a successful sign-in clears the account budget but not the source budget', async () => {
  const store = memoryStore();
  const ctx = { identifier: 'a@b.com', source: '1.2.3.4' };
  for (let i = 0; i < LIMITS.identifier.max - 1; i++) await recordFailure(store, ctx);

  await recordSuccess(store, ctx);
  assert.equal((await peek(store, `id:${ctx.identifier}`, LIMITS.identifier)).remaining, LIMITS.identifier.max);
  // The source has still spent attempts — a success on one account must not
  // hand a spraying client a fresh budget.
  assert.ok((await peek(store, `src:${ctx.source}`, LIMITS.source)).remaining < LIMITS.source.max);
});

test('budgets are independent across keys', async () => {
  const store = memoryStore();
  const limit = { max: 1, windowMs: 1000 };
  await consume(store, 'a', limit);
  assert.equal((await consume(store, 'b', limit)).allowed, true);
});
