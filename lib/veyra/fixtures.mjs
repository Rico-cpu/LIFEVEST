/**
 * A complete demo Financial Twin.
 *
 * Numbers are chosen to reproduce the blueprint's own worked example in §16
 * exactly:
 *
 *   8,420 cash − 2,100 obligations − 4,000 reserve − 180 buffer = 2,140
 *
 * Note: the source document is internally inconsistent about the cash floor
 * ($4,000 in §16, $5,000 in §36/§37). §16 is the specification of the "Why?"
 * panel, so its figure is the one modelled here — and the floor is editable at
 * runtime precisely so the effect of changing it is visible.
 */

import { seal } from './twin.mjs';
import { sealConstitution } from './policy.mjs';

export const AS_OF = '2026-08-29T12:00:00.000Z';
const day = (n) => new Date(Date.parse(AS_OF) + n * 86400_000).toISOString().slice(0, 10);

export const demoTwin = seal({
  asOf: AS_OF,
  discretionaryDailyCents: 600, // $6.00/day → $180 over 30 days
  accounts: [
    { id: 'chase_checking', name: 'Chase Checking', institution: 'Chase', type: 'checking', balanceCents: 842000, liquidity: 'liquid' },
    { id: 'ally_savings', name: 'Ally Savings', institution: 'Ally', type: 'savings', balanceCents: 2160000, liquidity: 'liquid', earmarkedFor: 'goal_emergency' },
    { id: 'fidelity_brokerage', name: 'Fidelity Brokerage', institution: 'Fidelity', type: 'brokerage', balanceCents: 2480000, liquidity: 'semi_liquid' },
    { id: 'fidelity_ira', name: 'Fidelity IRA', institution: 'Fidelity', type: 'retirement', balanceCents: 6130000, liquidity: 'illiquid' },
    { id: 'sapphire_card', name: 'Chase Sapphire', institution: 'Chase', type: 'credit_card', balanceCents: 429900, liquidity: 'liquid', isLiability: true, aprBps: 2499 },
    { id: 'student_loan', name: 'Student Loan', institution: 'Nelnet', type: 'loan', balanceCents: 2240000, liquidity: 'illiquid', isLiability: true, aprBps: 550 },
    { id: 'car_loan', name: 'Auto Loan', institution: 'Capital One', type: 'loan', balanceCents: 300000, liquidity: 'illiquid', isLiability: true, aprBps: 690 },
  ],
  obligations: [
    { id: 'ob_card', label: 'Chase Sapphire statement', amountCents: 124000, dueDate: day(12), accountId: 'chase_checking', essential: true },
    { id: 'ob_electric', label: 'Electric', amountCents: 18600, dueDate: day(6), accountId: 'chase_checking', essential: true },
    { id: 'ob_insurance', label: 'Auto insurance', amountCents: 27400, dueDate: day(21), accountId: 'chase_checking', essential: true },
    { id: 'ob_telecom', label: 'Phone + internet', amountCents: 40000, dueDate: day(9), accountId: 'chase_checking', essential: true },
  ],
  recurring: [
    { id: 'rc_salary', label: 'Salary', amountCents: 265000, direction: 'in', cadence: 'biweekly', essential: false, confidence: 0.98 },
    { id: 'rc_rent', label: 'Rent', amountCents: 220000, direction: 'out', cadence: 'monthly', essential: true, confidence: 0.99 },
    { id: 'rc_groceries', label: 'Groceries', amountCents: 52000, direction: 'out', cadence: 'monthly', essential: true, confidence: 0.86 },
    { id: 'rc_utilities', label: 'Utilities', amountCents: 18000, direction: 'out', cadence: 'monthly', essential: true, confidence: 0.94 },
    { id: 'rc_telecom', label: 'Phone + internet', amountCents: 16000, direction: 'out', cadence: 'monthly', essential: true, confidence: 0.97 },
    { id: 'rc_insurance', label: 'Insurance', amountCents: 14000, direction: 'out', cadence: 'monthly', essential: true, confidence: 0.95 },
    { id: 'rc_student', label: 'Student loan payment', amountCents: 26000, direction: 'out', cadence: 'monthly', essential: true, confidence: 0.99 },
    { id: 'rc_car', label: 'Auto loan payment', amountCents: 14000, direction: 'out', cadence: 'monthly', essential: true, confidence: 0.99 },
    { id: 'rc_streaming', label: 'Streaming', amountCents: 4500, direction: 'out', cadence: 'monthly', essential: false, confidence: 0.91 },
    { id: 'rc_gym', label: 'Gym', amountCents: 6000, direction: 'out', cadence: 'monthly', essential: false, confidence: 0.93 },
  ],
  goals: [
    { id: 'goal_emergency', name: 'Emergency Fund', targetCents: 2160000, currentCents: 2160000 },
    { id: 'goal_house', name: 'House', targetCents: 6000000, currentCents: 3780000, targetDate: '2030-06-01' },
    { id: 'goal_retirement', name: 'Retirement', targetCents: 22000000, currentCents: 6130000, targetDate: '2055-01-01' },
  ],
});

export const demoConstitution = sealConstitution({
  cashFloorCents: 400000,
  reserveMonths: 6,
  shortTermHorizonDays: 30,
  reauthAboveCents: 200000,
  dailyOutflowLimitCents: 500000,
  highestAprFirst: true,
  requireApprovalForInvestmentChanges: true,
});

/** Blueprint §37 — the constitution rendered as the user wrote it. */
export function constitutionLines(c) {
  return [
    `Never let checking fall below ${money(c.cashFloorCents)}.`,
    `Maintain ${c.reserveMonths} months of essential expenses.`,
    `Never invest money required for the next ${c.shortTermHorizonDays} days.`,
    c.highestAprFirst ? 'Pay highest-interest debt first.' : 'Pay smallest balance first.',
    c.requireApprovalForInvestmentChanges ? 'Never make an investment change without approval.' : 'Investment changes may run automatically.',
    `Never transfer more than ${money(c.reauthAboveCents)} without additional confirmation.`,
    `Never move more than ${money(c.dailyOutflowLimitCents)} in a single day.`,
  ];
}

export const demoContext = {
  executedTodayCents: 0,
  knownDestinations: ['ally_savings', 'fidelity_brokerage', 'sapphire_card', 'student_loan', 'car_loan'],
  automationRules: {
    monthly_invest: { maxPerActionCents: 100000, kinds: ['invest', 'goal_funding'] },
  },
};

/** @type {import('./plans.mjs').InvestmentPlan} */
export const demoPlan = {
  id: 'plan_retirement',
  goalId: 'goal_retirement',
  name: 'Long-Term Growth',
  accountId: 'fidelity_ira',
  fundingAccountId: 'chase_checking',
  strategyId: 'growth',
  monthlyContributionCents: 100000,
  cashFloorCents: 400000,
  schedule: 'monthly',
  rebalancing: 'annual',
  distributions: 'reinvest',
  active: true,
};

function money(c) {
  const a = Math.abs(c);
  return `$${String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
