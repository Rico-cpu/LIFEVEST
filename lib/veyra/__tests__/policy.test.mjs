import test from 'node:test';
import assert from 'node:assert/strict';
import { demoTwin, demoConstitution, demoContext } from '../fixtures.mjs';
import { evaluate, VERDICT, sealConstitution } from '../policy.mjs';

const base = {
  id: 'a1', kind: 'invest', amountCents: 50000,
  sourceAccountId: 'chase_checking', destinationAccountId: 'fidelity_brokerage',
  destinationKnown: true, origin: 'user', rationale: 'test',
};

const evalIt = (over = {}, c = demoConstitution, ctx = demoContext) =>
  evaluate({ ...base, ...over }, demoTwin, c, ctx);

test('an in-policy user investment is allowed outright', () => {
  assert.equal(evalIt().verdict, VERDICT.ALLOW);
});

test('an action that would breach the cash floor is blocked', () => {
  const d = evalIt({ amountCents: 300000 });
  assert.equal(d.verdict, VERDICT.BLOCK);
  assert.ok(d.determining.some((r) => r.ruleId === 'cash_floor' || r.ruleId === 'short_term_cash'));
});

test('investing beyond safe-to-deploy is blocked even one cent over', () => {
  const at = evalIt({ amountCents: 214000 });
  assert.equal(at.results.find((r) => r.ruleId === 'short_term_cash').verdict, VERDICT.ALLOW);
  assert.equal(at.verdict, VERDICT.REQUIRE_REAUTH, 'still above the $2,000 re-auth threshold');

  const over = evalIt({ amountCents: 214001 });
  assert.equal(over.results.find((r) => r.ruleId === 'short_term_cash').verdict, VERDICT.BLOCK);
  assert.equal(over.verdict, VERDICT.BLOCK);
});

test('the assistant can never produce an ALLOW', () => {
  const d = evalIt({ origin: 'ai', amountCents: 1000 });
  assert.notEqual(d.verdict, VERDICT.ALLOW);
  assert.ok(d.results.some((r) => r.ruleId === 'ai_never_self_authorizes'));
});

test('amounts over the re-auth threshold escalate rather than pass', () => {
  const generous = sealConstitution({ ...demoConstitution, cashFloorCents: 0, reauthAboveCents: 200000 });
  assert.equal(evalIt({ kind: 'transfer', amountCents: 200001 }, generous).verdict, VERDICT.REQUIRE_REAUTH);
});

test('the daily velocity cap counts what already moved today', () => {
  const d = evalIt({ kind: 'transfer', amountCents: 100000 }, demoConstitution, { ...demoContext, executedTodayCents: 450000 });
  assert.equal(d.verdict, VERDICT.BLOCK);
  assert.equal(d.determining[0].ruleId, 'daily_velocity');
});

test('a never-before-seen destination demands re-authentication', () => {
  const d = evalIt({ destinationAccountId: 'unknown_acct', destinationKnown: false, amountCents: 1000 });
  assert.equal(d.verdict, VERDICT.REQUIRE_REAUTH);
});

test('automation outside its mandate falls back to asking the user', () => {
  const over = evalIt({ origin: 'automation', automationRuleId: 'monthly_invest', amountCents: 150000 });
  assert.equal(over.verdict, VERDICT.REQUIRE_APPROVAL);
  const within = evalIt({ origin: 'automation', automationRuleId: 'monthly_invest', amountCents: 100000 });
  assert.equal(within.verdict, VERDICT.REQUIRE_APPROVAL, 'still gated by the investment-approval rule');
  assert.ok(within.results.find((r) => r.ruleId === 'automation_scope').verdict === VERDICT.ALLOW);
});

test('automation with no approved rule is never allowed', () => {
  const d = evalIt({ origin: 'automation', automationRuleId: undefined, kind: 'transfer', amountCents: 1000 });
  assert.equal(d.results.find((r) => r.ruleId === 'automation_scope').verdict, VERDICT.REQUIRE_APPROVAL);
});

test('paying the wrong debt first surfaces the user’s own stated strategy', () => {
  const d = evalIt({ kind: 'debt_payment', destinationAccountId: 'student_loan', amountCents: 50000 });
  const r = d.results.find((x) => x.ruleId === 'debt_priority');
  assert.equal(r.verdict, VERDICT.REQUIRE_APPROVAL);
  assert.equal(r.evidence.preferredAccountId, 'sapphire_card');
});

test('paying the highest-APR debt raises no strategy objection', () => {
  const d = evalIt({ kind: 'debt_payment', destinationAccountId: 'sapphire_card', amountCents: 50000 });
  assert.equal(d.results.find((x) => x.ruleId === 'debt_priority'), undefined);
});

test('weakening a guardrail always requires re-authentication', () => {
  const d = evalIt({ kind: 'policy_change', amountCents: 0, weakensProtection: true, sourceAccountId: undefined, destinationAccountId: undefined });
  assert.equal(d.verdict, VERDICT.REQUIRE_REAUTH);
});

test('the strictest rule always wins the merge', () => {
  const d = evalIt({ amountCents: 300000, destinationAccountId: 'unknown_acct', destinationKnown: false });
  assert.equal(d.verdict, VERDICT.BLOCK);
});

test('evaluation is deterministic and bound to both versions', () => {
  const a = evalIt();
  const b = evalIt();
  assert.deepEqual(a.results, b.results);
  assert.equal(a.twinVersion, demoTwin.version);
  assert.equal(a.constitutionVersion, demoConstitution.version);
});

test('malformed amounts are rejected, not coerced', () => {
  assert.throws(() => evalIt({ amountCents: 10.5 }), TypeError);
  assert.throws(() => evalIt({ amountCents: -100 }), TypeError);
  assert.throws(() => evalIt({ amountCents: NaN }), TypeError);
});

test('every rule that runs carries a reason and evidence', () => {
  for (const r of evalIt({ amountCents: 300000 }).results) {
    assert.ok(r.reason.length > 0, `${r.ruleId} has no reason`);
    assert.ok(r.evidence && typeof r.evidence === 'object', `${r.ruleId} has no evidence`);
  }
});
