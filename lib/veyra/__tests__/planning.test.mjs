import test from 'node:test';
import assert from 'node:assert/strict';
import { demoTwin, demoConstitution, demoPlan } from '../fixtures.mjs';
import { STRATEGIES, projectRange, validateAllocation, assumptionsFor, compare, allocationTotal } from '../strategies.mjs';
import { planHealth, planCompleteness, planProjection, PLAN_HEALTH } from '../plans.mjs';
import { readiness } from '../readiness.mjs';
import { run, increaseInvesting, majorPurchase, incomeChange, contributionImpact } from '../scenarios.mjs';
import { seal } from '../twin.mjs';

test('every shipped strategy allocates exactly 100%', () => {
  for (const s of Object.values(STRATEGIES)) {
    assert.equal(allocationTotal(s.allocation), 100, `${s.id} allocates ${allocationTotal(s.allocation)}%`);
  }
});

test('custom allocations must total 100 and cannot go negative', () => {
  assert.equal(validateAllocation({ usEquity: 50, intlEquity: 20, bonds: 20, other: 10 }).valid, true);
  assert.equal(validateAllocation({ usEquity: 50, intlEquity: 20, bonds: 20, other: 5 }).valid, false);
  assert.equal(validateAllocation({ usEquity: 110, intlEquity: 0, bonds: 0, other: -10 }).valid, false);
});

test('risk ordering of the profiles is monotonic', () => {
  const order = ['preservation', 'conservative', 'balanced', 'growth', 'aggressive'];
  for (let i = 1; i < order.length; i++) {
    assert.ok(STRATEGIES[order[i]].assumedRealReturn > STRATEGIES[order[i - 1]].assumedRealReturn);
    assert.ok(STRATEGIES[order[i]].assumedVolatility > STRATEGIES[order[i - 1]].assumedVolatility);
  }
});

test('projections return a range, never a point estimate', () => {
  const r = projectRange({ initialCents: 0, monthlyCents: 100000, years: 25, assumedRealReturn: 0.048, assumedVolatility: 0.135 });
  assert.ok(r.lowCents < r.midCents && r.midCents < r.highCents);
  assert.match(r.basis, /Not a prediction/);
});

test('a higher contribution never produces a worse range', () => {
  const base = { initialCents: 0, years: 20, assumedRealReturn: 0.04, assumedVolatility: 0.1 };
  const a = projectRange({ ...base, monthlyCents: 50000 });
  const b = projectRange({ ...base, monthlyCents: 100000 });
  assert.ok(b.lowCents > a.lowCents && b.midCents > a.midCents);
});

test('annualized dispersion narrows with horizon while terminal spread widens', () => {
  const at = (years) => {
    const r = projectRange({ initialCents: 1000000, monthlyCents: 0, years, assumedRealReturn: 0.05, assumedVolatility: 0.15 });
    return {
      annualized: Math.pow(r.highCents / r.midCents, 1 / years) - 1,
      terminal: (r.highCents - r.lowCents) / r.midCents,
    };
  };
  const short = at(5);
  const long = at(30);
  // σ/√T: the uncertainty in the *rate* shrinks with time...
  assert.ok(long.annualized < short.annualized, 'annualized dispersion must shrink with horizon');
  // ...while uncertainty in the *outcome* compounds and grows. Both are true,
  // and a product that shows only the first is lying by omission.
  assert.ok(long.terminal > short.terminal, 'terminal wealth dispersion must widen with horizon');
});

test('custom allocations get their own blended assumptions, not a default', () => {
  const allBonds = assumptionsFor({ usEquity: 0, intlEquity: 0, bonds: 100, other: 0 });
  const allEquity = assumptionsFor({ usEquity: 100, intlEquity: 0, bonds: 0, other: 0 });
  assert.ok(allEquity.assumedRealReturn > allBonds.assumedRealReturn);
  assert.ok(allEquity.assumedVolatility > allBonds.assumedVolatility);
});

test('strategy comparison holds the contribution plan constant', () => {
  const rows = compare(['conservative', 'balanced', 'growth'], { initialCents: 0, monthlyCents: 50000, years: 20 });
  assert.equal(rows.length, 3);
  assert.ok(rows[2].range.midCents > rows[0].range.midCents);
  assert.ok(rows[2].range.lowCents < rows[2].range.highCents);
});

test('the plan builder reports exactly which of the ten steps remain', () => {
  const c = planCompleteness({ goalId: 'g', accountId: 'a' });
  assert.equal(c.complete, false);
  assert.ok(c.missing.includes('Choose strategy'));
  assert.equal(planCompleteness(demoPlan).complete, true);
});

test('a plan within surplus and above the floor is on track', () => {
  const h = planHealth(demoPlan, demoTwin, demoConstitution);
  assert.equal(h.status, PLAN_HEALTH.ON_TRACK);
});

test('a plan the cash floor would breach reads as paused, not failed', () => {
  const thin = seal({ ...demoTwin, accounts: demoTwin.accounts.map((a) => (a.id === 'chase_checking' ? { ...a, balanceCents: 450000 } : a)) });
  const h = planHealth(demoPlan, thin, demoConstitution);
  assert.equal(h.status, PLAN_HEALTH.PAUSED);
  assert.match(h.detail, /No money was moved/);
});

test('a contribution above surplus needs attention', () => {
  const h = planHealth({ ...demoPlan, monthlyContributionCents: 190000 }, demoTwin, demoConstitution);
  assert.equal(h.status, PLAN_HEALTH.NEEDS_ATTENTION);
});

test('an inactive plan is paused and moves nothing', () => {
  assert.equal(planHealth({ ...demoPlan, active: false }, demoTwin, demoConstitution).status, PLAN_HEALTH.PAUSED);
});

test('plan projections respect the schedule', () => {
  const monthly = planProjection(demoPlan, 6130000, 30);
  const quarterly = planProjection({ ...demoPlan, schedule: 'quarterly' }, 6130000, 30);
  assert.ok(quarterly.midCents < monthly.midCents);
});

test('scenarios never mutate the baseline twin', () => {
  const before = JSON.stringify(demoTwin);
  run(majorPurchase(5000000, 'chase_checking', 'Car'), demoTwin, demoConstitution);
  assert.equal(JSON.stringify(demoTwin), before);
});

test('a major purchase shows lower liquidity and lower safe-to-deploy', () => {
  const r = run(majorPurchase(500000, 'chase_checking', 'Car'), demoTwin, demoConstitution);
  assert.ok(r.deltas.liquidCents < 0);
  assert.ok(r.deltas.safeToDeployCents < 0);
  assert.equal(r.qualitative.liquidity, 'Lower');
});

test('a purchase that leaves the reserve alone says so', () => {
  const r = run(majorPurchase(100000, 'chase_checking', 'Laptop'), demoTwin, demoConstitution);
  assert.equal(r.qualitative.emergencyReserve, 'Unaffected under current assumptions');
});

test('a raise improves monthly net cash flow', () => {
  const r = run(incomeChange(10), demoTwin, demoConstitution);
  assert.ok(r.deltas.monthlyNetCents > 0);
});

test('investing more reduces monthly net without touching the reserve', () => {
  const r = run(increaseInvesting(50000), demoTwin, demoConstitution);
  assert.ok(r.deltas.monthlyNetCents < 0);
  assert.equal(r.qualitative.emergencyReserve, 'Unaffected under current assumptions');
});

test('contribution impact is expressed as two ranges plus a caveat', () => {
  const i = contributionImpact(6130000, 100000, 50000, 25, 'growth');
  assert.ok(i.proposed.midCents > i.current.midCents);
  assert.match(i.caveat, /illustrative/);
});

test('readiness is five explainable dimensions, bounded, and not a credit score', () => {
  const r = readiness(demoTwin, demoConstitution);
  assert.equal(r.dimensions.length, 5);
  for (const d of r.dimensions) {
    assert.ok(d.score >= 0 && d.score <= 100, `${d.id} out of bounds: ${d.score}`);
    assert.ok(d.explanation.length > 0);
  }
  assert.ok(r.overall >= 0 && r.overall <= 100);
  assert.match(r.disclaimer, /not a credit score/);
});

/* --------------------------------------------------------- recommendations */
import { nextBestMoves, recommendableCents } from '../recommend.mjs';
import { safeToDeploy } from '../twin.mjs';
import { evaluate, VERDICT } from '../policy.mjs';
import { demoContext } from '../fixtures.mjs';

test('recommendations hold back a margin instead of spending to the floor', () => {
  const std = safeToDeploy(demoTwin, demoConstitution).amountCents;
  const recs = nextBestMoves(demoTwin, demoConstitution);
  assert.ok(recs.length > 0);
  for (const r of recs) {
    assert.ok(r.action.amountCents < std, `${r.id} consumes the entire safe-to-deploy budget`);
    assert.equal(r.action.amountCents % 5000, 0, `${r.id} is not rounded to a clean figure`);
  }
});

test('the margin degrades gracefully at small balances', () => {
  assert.equal(recommendableCents(0), 0);
  assert.equal(recommendableCents(1000), 0);
  assert.equal(recommendableCents(214000), 190000);
});

test('every recommendation carries all six §15 fields and is never self-authorizing', () => {
  for (const r of nextBestMoves(demoTwin, demoConstitution)) {
    for (const f of ['what', 'why', 'impact', 'risk', 'confidence', 'source']) {
      assert.ok(r[f] && String(r[f]).length > 0, `${r.id} missing ${f}`);
    }
    assert.equal(r.action.origin, 'ai');
    assert.notEqual(evaluate(r.action, demoTwin, demoConstitution, demoContext).verdict, VERDICT.ALLOW);
  }
});

test('no recommendation is ever blocked by the policy engine that produced it', () => {
  for (const r of nextBestMoves(demoTwin, demoConstitution)) {
    const d = evaluate(r.action, demoTwin, demoConstitution, demoContext);
    assert.notEqual(d.verdict, VERDICT.BLOCK, `${r.id} recommends something its own rules forbid`);
  }
});
