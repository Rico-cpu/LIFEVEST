/**
 * Blueprint §38 — Financial Readiness.
 *
 * Deliberately not a credit score. It is a set of five measurable dimensions,
 * each computed from the user's own data against their own stated targets, and
 * each fully reconstructible. It measures readiness against *their* rules —
 * never a person's worth, and never a comparison to other users.
 */

import { essentialMonthlyBurnCents, netWorthCents, monthlyNetCashFlowCents, reserveStatus } from './twin.mjs';

/** Map a ratio to 0..100 with a soft ceiling, so "more" stops paying off past the target. */
function scoreRatio(actual, target) {
  if (target <= 0) return 100;
  const r = actual / target;
  if (r >= 1) return Math.min(100, Math.round(90 + Math.min(r - 1, 1) * 10));
  return Math.max(0, Math.round(r * 90));
}

/**
 * @param {import('./twin.mjs').TwinSnapshot} twin
 * @param {import('./policy.mjs').Constitution} constitution
 */
export function readiness(twin, constitution) {
  const burn = Math.max(essentialMonthlyBurnCents(twin), 1);
  const reserve = reserveStatus(twin, constitution);
  const monthsHeld = reserve.monthsFunded;

  const liabilities = twin.accounts.filter((a) => a.isLiability);
  const debtCents = liabilities.reduce((s, a) => s + a.balanceCents, 0);
  const highApr = liabilities.filter((a) => (a.aprBps ?? 0) >= 1000).reduce((s, a) => s + a.balanceCents, 0);
  const assets = Math.max(netWorthCents(twin) + debtCents, 1);

  const invested = twin.accounts
    .filter((a) => !a.isLiability && (a.type === 'brokerage' || a.type === 'retirement'))
    .reduce((s, a) => s + a.balanceCents, 0);

  const goalProgress =
    twin.goals.length === 0
      ? 0
      : twin.goals.reduce((s, g) => s + Math.min(1, g.currentCents / Math.max(g.targetCents, 1)), 0) / twin.goals.length;

  const surplus = monthlyNetCashFlowCents(twin);

  const dimensions = [
    {
      id: 'liquidity',
      label: 'Liquidity',
      score: scoreRatio(monthsHeld, constitution.reserveMonths),
      explanation: `You hold ${monthsHeld.toFixed(1)} months of essential expenses in earmarked reserve against your ${constitution.reserveMonths}-month target.`,
    },
    {
      id: 'debt',
      label: 'Debt',
      score: debtCents === 0 ? 100 : Math.max(0, Math.round(100 - (highApr / assets) * 300 - (debtCents / assets) * 60)),
      explanation:
        debtCents === 0
          ? 'You carry no tracked debt.'
          : `${pct(debtCents / assets)} of assets is offset by debt; ${pct(highApr / Math.max(debtCents, 1))} of that debt is above 10% APR.`,
    },
    {
      id: 'savings',
      label: 'Savings',
      score: scoreRatio(Math.max(surplus, 0) * 12, burn * 3),
      explanation:
        surplus > 0
          ? `Your projected surplus is ${money(surplus)}/month.`
          : 'Your recurring outflows currently exceed inflows.',
    },
    {
      id: 'investing',
      label: 'Investing',
      score: scoreRatio(invested, burn * 12 * 3),
      explanation: `You hold ${money(invested)} in brokerage and retirement accounts.`,
    },
    {
      id: 'goals',
      label: 'Goals',
      score: Math.round(goalProgress * 100),
      explanation:
        twin.goals.length === 0
          ? 'No goals defined yet.'
          : `Average progress across ${twin.goals.length} goals is ${pct(goalProgress)}.`,
    },
  ];

  const overall = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);

  return {
    overall,
    dimensions,
    disclaimer:
      'Readiness measures your position against the targets you set. It is not a credit score, not a rating, and not a comparison to anyone else.',
  };
}

function pct(x) {
  return `${Math.round(x * 100)}%`;
}
function money(c) {
  const a = Math.abs(c);
  return `${c < 0 ? '-' : ''}$${String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
