/**
 * Blueprint §9–§10 — the investment plan and its health.
 *
 * A plan is a *standing intent*, not a standing permission. Each contribution
 * it generates is still a proposed action that goes through policy, risk, and
 * — depending on authorization level — the user.
 */

import { STRATEGIES, projectRange, assumptionsFor } from './strategies.mjs';
import { safeToDeploy, monthlyNetCashFlowCents, projectedBalanceCents } from './twin.mjs';

export const PLAN_HEALTH = /** @type {const} */ ({
  ON_TRACK: 'ON_TRACK',
  NEEDS_ATTENTION: 'NEEDS_ATTENTION',
  PAUSED: 'PAUSED',
});

/**
 * @typedef {Object} InvestmentPlan
 * @property {string} id
 * @property {string} goalId
 * @property {string} name
 * @property {string} accountId              destination investment account
 * @property {string} fundingAccountId       source of contributions
 * @property {import('./strategies.mjs').StrategyId} strategyId
 * @property {import('./strategies.mjs').Allocation} [customAllocation]
 * @property {number} monthlyContributionCents
 * @property {number} cashFloorCents         plan-level floor on the funding account
 * @property {'monthly'|'quarterly'} schedule
 * @property {'annual'|'semiannual'|'threshold'} rebalancing
 * @property {'reinvest'|'cash'} distributions
 * @property {boolean} active
 */

/**
 * The ten-step builder from §9, as a validator over a draft.
 * @param {Partial<InvestmentPlan>} draft
 * @returns {{ complete: boolean, missing: string[], steps: {key:string,label:string,done:boolean}[] }}
 */
export function planCompleteness(draft) {
  const steps = [
    { key: 'goalId', label: 'Choose goal' },
    { key: 'accountId', label: 'Choose account' },
    { key: 'strategyId', label: 'Choose strategy' },
    { key: 'monthlyContributionCents', label: 'Choose contribution' },
    { key: 'fundingAccountId', label: 'Choose funding source' },
    { key: 'cashFloorCents', label: 'Set cash floor' },
    { key: 'schedule', label: 'Choose schedule' },
  ].map((s) => ({ ...s, done: draft[s.key] !== undefined && draft[s.key] !== null && draft[s.key] !== '' }));

  const missing = steps.filter((s) => !s.done).map((s) => s.label);
  return { complete: missing.length === 0, missing, steps };
}

/**
 * Blueprint §10 — plan health.
 *
 * PAUSED is not a failure state and must never read as one: it means a
 * guardrail did its job and no money moved.
 *
 * @param {InvestmentPlan} plan
 * @param {import('./twin.mjs').TwinSnapshot} twin
 * @param {import('./policy.mjs').Constitution} constitution
 */
export function planHealth(plan, twin, constitution) {
  if (!plan.active) {
    return { status: PLAN_HEALTH.PAUSED, headline: 'Paused', detail: 'This plan is not currently active. No money is being moved.' };
  }

  const std = safeToDeploy(twin, constitution, { horizonDays: constitution.shortTermHorizonDays });
  const projected = projectedBalanceCents(twin, plan.fundingAccountId, 30);
  const afterContribution = projected - plan.monthlyContributionCents;

  if (afterContribution < plan.cashFloorCents || plan.monthlyContributionCents > std.amountCents) {
    return {
      status: PLAN_HEALTH.PAUSED,
      headline: 'Paused',
      detail: 'Your cash safety rule prevented this month’s contribution. No money was moved.',
      evidence: { safeToDeployCents: std.amountCents, projectedAfterCents: afterContribution, floorCents: plan.cashFloorCents },
    };
  }

  const surplus = monthlyNetCashFlowCents(twin);
  if (plan.monthlyContributionCents > surplus) {
    return {
      status: PLAN_HEALTH.NEEDS_ATTENTION,
      headline: 'Needs attention',
      detail: `Your recent cash flow suggests ${money(plan.monthlyContributionCents)}/month may no longer be comfortable.`,
      evidence: { monthlySurplusCents: surplus, contributionCents: plan.monthlyContributionCents },
    };
  }

  return {
    status: PLAN_HEALTH.ON_TRACK,
    headline: 'On track',
    detail: `Contribution of ${money(plan.monthlyContributionCents)}/month is within your projected surplus.`,
    evidence: { monthlySurplusCents: surplus, safeToDeployCents: std.amountCents },
  };
}

/**
 * @param {InvestmentPlan} plan
 * @param {number} currentCents
 * @param {number} years
 */
export function planProjection(plan, currentCents, years) {
  const strategy = STRATEGIES[plan.strategyId];
  const assumptions =
    plan.strategyId === 'custom' && plan.customAllocation
      ? assumptionsFor(plan.customAllocation)
      : { assumedRealReturn: strategy.assumedRealReturn, assumedVolatility: strategy.assumedVolatility };

  return projectRange({
    initialCents: currentCents,
    monthlyCents: plan.schedule === 'quarterly' ? Math.round(plan.monthlyContributionCents / 3) : plan.monthlyContributionCents,
    years,
    ...assumptions,
  });
}

function money(c) {
  const a = Math.abs(c);
  return `${c < 0 ? '-' : ''}$${String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
