/**
 * Blueprint §15 + §17 — the optimization engine and "Next Best Move".
 *
 * Every recommendation carries the six fields §15 requires: what, why, impact,
 * risk, confidence, source. A recommendation that cannot fill all six is a
 * recommendation Veyra should not make.
 *
 * Recommendations are *proposals only*. They construct actions with
 * origin:'ai', which the policy engine structurally refuses to let
 * self-authorize.
 */

import { safeToDeploy, essentialMonthlyBurnCents, reserveStatus } from './twin.mjs';

/**
 * @typedef {Object} Recommendation
 * @property {string} id
 * @property {string} what
 * @property {string} why
 * @property {string} impact
 * @property {string} risk
 * @property {'high'|'medium'|'low'} confidence
 * @property {string} source
 * @property {import('./policy.mjs').ProposedAction} action
 * @property {number} rank        higher = better next move
 */

/**
 * Safe-to-deploy is a modelled figure: the discretionary spend rate inside it
 * is an estimate, not a fact. Recommending the whole of it would land the user
 * exactly on their floor with no absorption for that estimation error, so
 * every recommendation holds back a margin and rounds down to a clean figure.
 * Veyra should never push someone to the precise edge of their own guardrail.
 */
const DEPLOY_MARGIN = 0.9;
const ROUND_TO_CENTS = 5000; // $50

/** @param {number} safeCents */
export function recommendableCents(safeCents) {
  return Math.max(0, Math.floor((safeCents * DEPLOY_MARGIN) / ROUND_TO_CENTS) * ROUND_TO_CENTS);
}

/**
 * @param {import('./twin.mjs').TwinSnapshot} twin
 * @param {import('./policy.mjs').Constitution} constitution
 * @returns {Recommendation[]}
 */
export function nextBestMoves(twin, constitution) {
  /** @type {Recommendation[]} */
  const out = [];
  const std = safeToDeploy(twin, constitution);
  const budget = recommendableCents(std.amountCents);
  const burn = essentialMonthlyBurnCents(twin);
  const source = twin.accounts.find((a) => a.type === 'checking');

  // 1. Underfunded emergency reserve outranks everything else.
  const monthsHeld = reserveStatus(twin, constitution).monthsFunded;
  const reserveGoal = twin.goals.find((g) => /emergency/i.test(g.name));
  if (monthsHeld < constitution.reserveMonths && reserveGoal && budget > 0 && source) {
    const amount = Math.min(budget, reserveGoal.targetCents - reserveGoal.currentCents);
    if (amount > 0) {
      out.push({
        id: 'rec_reserve',
        what: `Move ${money(amount)} into your emergency reserve.`,
        why: `You hold ${monthsHeld.toFixed(1)} months of essential expenses against your ${constitution.reserveMonths}-month target.`,
        impact: `Raises your reserve toward ${constitution.reserveMonths} months. Liquid cash is unchanged in total.`,
        risk: 'Low. Funds remain liquid and accessible.',
        confidence: 'high',
        source: 'Connected account balances and detected recurring expenses.',
        rank: 100,
        action: {
          id: 'act_reserve',
          kind: 'goal_funding',
          amountCents: amount,
          sourceAccountId: source.id,
          destinationAccountId: twin.accounts.find((a) => a.type === 'savings')?.id,
          destinationKnown: true,
          origin: 'ai',
          rationale: 'Emergency reserve below target.',
        },
      });
    }
  }

  // 2. High-APR debt. Interest avoided is the clearest value Veyra can create.
  const highApr = twin.accounts
    .filter((a) => a.isLiability && a.balanceCents > 0 && (a.aprBps ?? 0) >= 1000)
    .sort((a, b) => (b.aprBps ?? 0) - (a.aprBps ?? 0))[0];
  if (highApr && budget > 0 && source) {
    const amount = Math.min(budget, highApr.balanceCents);
    const apr = (highApr.aprBps ?? 0) / 10000;
    const saved = Math.round(amount * apr);
    out.push({
      id: 'rec_debt',
      what: `Pay ${money(amount)} toward ${highApr.name}.`,
      why: `${highApr.name} carries ${(apr * 100).toFixed(2)}% APR — the highest rate you are paying. This leaves ${money(std.amountCents - amount)} of your safe-to-deploy budget unspent as margin.`,
      impact: `Estimated ${money(saved)} of interest avoided over 12 months at the current rate.`,
      risk: 'Payments to lenders generally cannot be recalled. Your cash floor is preserved.',
      confidence: 'high',
      source: 'Card APR and balance reported by your connected account.',
      rank: 90 + Math.round(apr * 100),
      action: {
        id: 'act_debt',
        kind: 'debt_payment',
        amountCents: amount,
        sourceAccountId: source.id,
        destinationAccountId: highApr.id,
        destinationKnown: true,
        origin: 'ai',
        rationale: 'Highest-APR liability.',
      },
    });
  }

  // 3. Cash sitting idle above every guardrail.
  if (budget > burn && source) {
    const brokerage = twin.accounts.find((a) => a.type === 'brokerage');
    if (brokerage) {
      const amount = budget;
      out.push({
        id: 'rec_invest',
        what: `Invest ${money(amount)} into ${brokerage.name}.`,
        why: `Your checking balance is projected to remain above your ${money(constitution.cashFloorCents)} floor after this transfer.`,
        impact: 'Moves idle cash into your long-term strategy. Reduces liquid buffer by the same amount.',
        risk: 'Investments can lose value. Past performance does not guarantee future results.',
        confidence: 'medium',
        source: 'Safe-to-deploy calculation from your connected balances and detected obligations.',
        rank: 60,
        action: {
          id: 'act_invest',
          kind: 'invest',
          amountCents: amount,
          sourceAccountId: source.id,
          destinationAccountId: brokerage.id,
          destinationKnown: true,
          origin: 'ai',
          rationale: 'Excess cash above all guardrails.',
        },
      });
    }
  }

  return out.sort((a, b) => b.rank - a.rank);
}

function money(c) {
  const a = Math.abs(c);
  return `${c < 0 ? '-' : ''}$${String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
