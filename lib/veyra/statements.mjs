/**
 * Monthly and annual financial statements, generated from the Financial Twin.
 *
 * Honesty rule enforced structurally: every line carries a `basis`.
 *   'observed' — read directly from a connected balance.
 *   'derived'  — computed from detected recurring flows and rates.
 * A statement that cannot say which of the two a number is has no business
 * being called a statement, so `basis` is required on every row and asserted
 * in the test suite.
 */

import {
  netWorthCents, liquidCents, deployableCents, earmarkedCents,
  essentialMonthlyBurnCents, monthlyNetCashFlowCents, reserveStatus,
} from './twin.mjs';

const CADENCE_PER_MONTH = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1 };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * @typedef {'observed'|'derived'} Basis
 * @typedef {Object} StatementRow
 * @property {string} label
 * @property {number} amountCents
 * @property {Basis} basis
 * @property {string} [note]
 *
 * @typedef {Object} StatementSection
 * @property {string} id
 * @property {string} title
 * @property {StatementRow[]} rows
 * @property {number} [totalCents]
 * @property {string} [totalLabel]
 *
 * @typedef {Object} Statement
 * @property {'monthly'|'annual'} kind
 * @property {string} periodLabel
 * @property {string} periodStart
 * @property {string} periodEnd
 * @property {string} generatedAt
 * @property {string} twinVersion
 * @property {StatementSection[]} sections
 * @property {'historical'|'current'|'projected'} standing
 * @property {string} standingNote
 * @property {string} basisNote
 */

/** @param {'monthly'|'annual'} kind @param {Date} d */
export function periodFor(kind, d) {
  const y = d.getUTCFullYear();
  if (kind === 'annual') {
    return {
      label: String(y),
      start: `${y}-01-01`,
      end: `${y}-12-31`,
      months: 12,
    };
  }
  const m = d.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return {
    label: `${MONTHS[m]} ${y}`,
    start: `${y}-${String(m + 1).padStart(2, '0')}-01`,
    end: `${y}-${String(m + 1).padStart(2, '0')}-${last}`,
    months: 1,
    days: last,
  };
}

/**
 * @param {import('./twin.mjs').TwinSnapshot} twin
 * @param {import('./policy.mjs').Constitution} constitution
 * @param {{ kind?: 'monthly'|'annual', asOf?: string }} [opts]
 * @returns {Statement}
 */
export function buildStatement(twin, constitution, opts = {}) {
  const kind = opts.kind ?? 'monthly';
  const at = new Date(opts.asOf ?? twin.asOf);
  const period = periodFor(kind, at);
  const standing = standingOf(period, twin.asOf);
  const k = period.months; // scale factor from monthly figures

  const income = twin.recurring.filter((r) => r.direction === 'in');
  const essential = twin.recurring.filter((r) => r.direction === 'out' && r.essential);
  const discretionary = twin.recurring.filter((r) => r.direction === 'out' && !r.essential);

  const perPeriod = (r) => Math.round(r.amountCents * CADENCE_PER_MONTH[r.cadence] * k);
  const sum = (rows) => rows.reduce((s, r) => s + r.amountCents, 0);

  const incomeRows = income.map((r) => ({
    label: r.label,
    amountCents: perPeriod(r),
    basis: 'derived',
    note: `${r.cadence}, detection confidence ${(r.confidence * 100).toFixed(0)}%`,
  }));

  const essentialRows = essential.map((r) => ({
    label: r.label,
    amountCents: perPeriod(r),
    basis: 'derived',
    note: `${r.cadence}, essential`,
  }));

  const discretionaryRows = [
    ...discretionary.map((r) => ({
      label: r.label,
      amountCents: perPeriod(r),
      basis: 'derived',
      note: `${r.cadence}, discretionary`,
    })),
    {
      label: 'Unclassified discretionary spending',
      amountCents: Math.round(twin.discretionaryDailyCents * (365 / 12) * k),
      basis: 'derived',
      note: 'Observed daily spend rate, annualized to the period',
    },
  ];

  const assetRows = twin.accounts
    .filter((a) => !a.isLiability)
    .map((a) => ({
      label: `${a.name} (${a.institution})`,
      amountCents: a.balanceCents,
      basis: 'observed',
      note: a.earmarkedFor ? `${a.type}, earmarked` : a.type,
    }));

  const liabilityRows = twin.accounts
    .filter((a) => a.isLiability)
    .map((a) => ({
      label: `${a.name} (${a.institution})`,
      amountCents: a.balanceCents,
      basis: 'observed',
      note: a.aprBps ? `${(a.aprBps / 100).toFixed(2)}% APR` : a.type,
    }));

  const interestRows = twin.accounts
    .filter((a) => a.isLiability && a.aprBps)
    .map((a) => ({
      label: `${a.name} interest`,
      amountCents: Math.round((a.balanceCents * (a.aprBps / 10000)) / 12 * k),
      basis: 'derived',
      note: `At ${(a.aprBps / 100).toFixed(2)}% APR on the current balance`,
    }));

  const goalRows = twin.goals.map((g) => ({
    label: g.name,
    amountCents: g.currentCents,
    basis: 'observed',
    note: `${Math.round((g.currentCents / Math.max(g.targetCents, 1)) * 100)}% of ${money(g.targetCents)} target${g.targetDate ? `, by ${g.targetDate}` : ''}`,
  }));

  const totalIncome = sum(incomeRows);
  const totalEssential = sum(essentialRows);
  const totalDiscretionary = sum(discretionaryRows);
  const totalAssets = sum(assetRows);
  const totalLiabilities = sum(liabilityRows);
  const reserve = reserveStatus(twin, constitution);

  /** @type {StatementSection[]} */
  const sections = [
    {
      id: 'summary',
      title: 'Summary',
      rows: [
        { label: 'Net worth', amountCents: netWorthCents(twin), basis: 'observed', note: 'Assets less liabilities' },
        { label: 'Total assets', amountCents: totalAssets, basis: 'observed' },
        { label: 'Total liabilities', amountCents: -totalLiabilities, basis: 'observed' },
        { label: 'Liquid cash', amountCents: liquidCents(twin), basis: 'observed' },
        { label: 'Deployable cash', amountCents: deployableCents(twin), basis: 'observed', note: 'Excludes cash earmarked for goals' },
        { label: 'Earmarked for goals', amountCents: earmarkedCents(twin), basis: 'observed' },
        { label: 'Net cash flow', amountCents: monthlyNetCashFlowCents(twin) * k, basis: 'derived', note: 'Income less all detected outflows' },
      ],
    },
    { id: 'income', title: 'Income', rows: incomeRows, totalCents: totalIncome, totalLabel: 'Total income' },
    { id: 'essential', title: 'Essential expenses', rows: essentialRows, totalCents: totalEssential, totalLabel: 'Total essential' },
    { id: 'discretionary', title: 'Discretionary expenses', rows: discretionaryRows, totalCents: totalDiscretionary, totalLabel: 'Total discretionary' },
    {
      id: 'cashflow',
      title: 'Cash flow',
      rows: [
        { label: 'Income', amountCents: totalIncome, basis: 'derived' },
        { label: 'Essential expenses', amountCents: -totalEssential, basis: 'derived' },
        { label: 'Discretionary expenses', amountCents: -totalDiscretionary, basis: 'derived' },
      ],
      totalCents: totalIncome - totalEssential - totalDiscretionary,
      totalLabel: 'Net',
    },
    { id: 'assets', title: 'Assets', rows: assetRows, totalCents: totalAssets, totalLabel: 'Total assets' },
    { id: 'liabilities', title: 'Liabilities', rows: liabilityRows, totalCents: totalLiabilities, totalLabel: 'Total liabilities' },
    { id: 'interest', title: 'Interest cost', rows: interestRows, totalCents: sum(interestRows), totalLabel: 'Total interest' },
    { id: 'goals', title: 'Goals', rows: goalRows, totalCents: sum(goalRows), totalLabel: 'Total saved toward goals' },
    {
      id: 'guardrails',
      title: 'Guardrails',
      rows: [
        { label: 'Cash floor', amountCents: constitution.cashFloorCents, basis: 'observed', note: 'Your configured minimum' },
        { label: 'Emergency reserve held', amountCents: reserve.heldCents, basis: 'observed', note: `${reserve.monthsFunded.toFixed(1)} months of essential expenses` },
        { label: 'Emergency reserve required', amountCents: reserve.requiredCents, basis: 'derived', note: `${constitution.reserveMonths} months at ${money(essentialMonthlyBurnCents(twin))}/month` },
        { label: 'Reserve shortfall', amountCents: reserve.shortfallCents, basis: 'derived' },
      ],
    },
  ];

  return {
    kind,
    periodLabel: period.label,
    periodStart: period.start,
    periodEnd: period.end,
    generatedAt: new Date().toISOString(),
    twinVersion: twin.version,
    sections,
    standing,
    standingNote: STANDING_NOTE[standing],
    basisNote:
      'Observed lines are read directly from connected balances. Derived lines are computed from detected recurring flows and current rates, and are estimates rather than settled transactions.',
  };
}

/** Both statements at once, for the common "give me everything" export. */
export function buildBoth(twin, constitution, opts = {}) {
  return {
    monthly: buildStatement(twin, constitution, { ...opts, kind: 'monthly' }),
    annual: buildStatement(twin, constitution, { ...opts, kind: 'annual' }),
  };
}

/**
 * Where the requested period sits relative to the data Veyra actually holds.
 * A statement for a past period built from today's run rates is a
 * reconstruction, not a record, and must never be presented as the latter.
 * @param {{start:string,end:string}} period @param {string} asOf
 */
export function standingOf(period, asOf) {
  const now = Date.parse(asOf);
  if (Date.parse(`${period.end}T23:59:59Z`) < now) return 'historical';
  if (Date.parse(`${period.start}T00:00:00Z`) > now) return 'projected';
  return 'current';
}

const STANDING_NOTE = {
  historical:
    'This period has already closed. Veyra is reconstructing it from current balances and run rates, not from recorded transactions — connect transaction history for a settled statement.',
  current: 'This period is in progress. Flow figures are run-rate estimates for the full period.',
  projected: 'This period has not started. Every figure is a projection from current rates.',
};

function money(c) {
  const a = Math.abs(c);
  return `${c < 0 ? '-' : ''}$${String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
