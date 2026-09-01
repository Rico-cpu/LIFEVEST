/**
 * Blueprint §12 — the What-If engine.
 *
 * A scenario is a pure transformation of the twin plus a diff of the
 * consequences. It never mutates the real twin, and it never produces a single
 * confident number where a range is the honest answer.
 */

import { seal, safeToDeploy, netWorthCents, liquidCents, essentialMonthlyBurnCents, monthlyNetCashFlowCents, reserveStatus } from './twin.mjs';
import { projectRange, STRATEGIES } from './strategies.mjs';

/**
 * @typedef {Object} Scenario
 * @property {string} id
 * @property {string} label
 * @property {(twin: import('./twin.mjs').TwinSnapshot) => import('./twin.mjs').TwinSnapshot} apply
 */

/** "What if I invest $X more every month?" @param {number} deltaCents */
export function increaseInvesting(deltaCents) {
  return {
    id: 'increase_investing',
    label: `Invest ${money(deltaCents)} more each month`,
    apply: (twin) =>
      seal({
        ...twin,
        recurring: [
          ...twin.recurring,
          { id: 'scn_invest', label: 'Additional investing', amountCents: deltaCents, direction: 'out', cadence: 'monthly', essential: false, confidence: 1 },
        ],
      }),
  };
}

/** "What if I buy a $50,000 car?" @param {number} priceCents @param {string} fromAccountId */
export function majorPurchase(priceCents, fromAccountId, label = 'Major purchase') {
  return {
    id: 'major_purchase',
    label: `${label} of ${money(priceCents)}`,
    apply: (twin) =>
      seal({
        ...twin,
        accounts: twin.accounts.map((a) =>
          a.id === fromAccountId ? { ...a, balanceCents: a.balanceCents - priceCents } : a
        ),
      }),
  };
}

/** "What happens if my salary increases 10%?" @param {number} pct */
export function incomeChange(pct) {
  return {
    id: 'income_change',
    label: `Income ${pct >= 0 ? 'increases' : 'decreases'} ${Math.abs(pct)}%`,
    apply: (twin) =>
      seal({
        ...twin,
        recurring: twin.recurring.map((r) =>
          r.direction === 'in' ? { ...r, amountCents: Math.round(r.amountCents * (1 + pct / 100)) } : r
        ),
      }),
  };
}

/** "What if I stop investing for a year?" @param {number} monthlyCents @param {number} months */
export function pauseInvesting(monthlyCents, months = 12) {
  return {
    id: 'pause_investing',
    label: `Pause investing for ${months} months`,
    apply: (twin) => twin,
    foregoneCents: monthlyCents * months,
  };
}

/**
 * Run a scenario and diff it against the baseline.
 * @param {Scenario} scenario
 * @param {import('./twin.mjs').TwinSnapshot} twin
 * @param {import('./policy.mjs').Constitution} constitution
 */
export function run(scenario, twin, constitution) {
  const after = scenario.apply(twin);
  const before = {
    netWorthCents: netWorthCents(twin),
    liquidCents: liquidCents(twin),
    safeToDeployCents: safeToDeploy(twin, constitution).amountCents,
    monthlyNetCents: monthlyNetCashFlowCents(twin),
    reserveMonths: reserveStatus(twin, constitution).monthsFunded,
  };
  const afterMetrics = {
    netWorthCents: netWorthCents(after),
    liquidCents: liquidCents(after),
    safeToDeployCents: safeToDeploy(after, constitution).amountCents,
    monthlyNetCents: monthlyNetCashFlowCents(after),
    reserveMonths: reserveStatus(after, constitution).monthsFunded,
  };

  const reserveIntact = afterMetrics.reserveMonths >= constitution.reserveMonths;
  const liquidityDelta = afterMetrics.liquidCents - before.liquidCents;

  return {
    scenario: { id: scenario.id, label: scenario.label },
    before,
    after: afterMetrics,
    deltas: {
      netWorthCents: afterMetrics.netWorthCents - before.netWorthCents,
      liquidCents: liquidityDelta,
      safeToDeployCents: afterMetrics.safeToDeployCents - before.safeToDeployCents,
      monthlyNetCents: afterMetrics.monthlyNetCents - before.monthlyNetCents,
    },
    qualitative: {
      liquidity: liquidityDelta < 0 ? 'Lower' : liquidityDelta > 0 ? 'Higher' : 'Unchanged',
      emergencyReserve: reserveIntact ? 'Unaffected under current assumptions' : 'Reduced below your target',
      risk: !reserveIntact ? 'Elevated' : afterMetrics.monthlyNetCents < 0 ? 'Moderate' : 'Low',
    },
  };
}

/**
 * Goal-impact framing for a contribution change — expressed as a shift in an
 * illustrative range, never as a date certain.
 * @param {number} currentCents @param {number} monthlyCents @param {number} deltaCents
 * @param {number} years @param {import('./strategies.mjs').StrategyId} strategyId
 */
export function contributionImpact(currentCents, monthlyCents, deltaCents, years, strategyId) {
  const s = STRATEGIES[strategyId];
  const base = { initialCents: currentCents, years, assumedRealReturn: s.assumedRealReturn, assumedVolatility: s.assumedVolatility };
  return {
    current: projectRange({ ...base, monthlyCents }),
    proposed: projectRange({ ...base, monthlyCents: monthlyCents + deltaCents }),
    caveat: 'Both figures are illustrative ranges under the same assumptions. Actual outcomes will differ.',
  };
}

function money(c) {
  const a = Math.abs(c);
  return `${c < 0 ? '-' : ''}$${String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
