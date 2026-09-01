/**
 * Reconciliation — §27.
 *
 * Veyra's internal view of a balance is a belief, not a fact. The institution
 * holds the fact. Reconciliation compares the two and, on disagreement, raises
 * an exception rather than picking a winner.
 *
 * The rule that matters: a mismatch never resolves itself by trusting Veyra.
 * Automation pauses and a person decides.
 */

/**
 * @typedef {Object} InstitutionBalance
 * @property {string} accountId
 * @property {number} balanceCents
 * @property {string} asOf
 *
 * @typedef {Object} Discrepancy
 * @property {string} accountId
 * @property {string} name
 * @property {number} internalCents
 * @property {number} institutionCents
 * @property {number} deltaCents        institution minus internal
 * @property {'missing_at_institution'|'missing_internally'|'balance_mismatch'} kind
 *
 * @typedef {Object} ReconciliationResult
 * @property {boolean} clean
 * @property {Discrepancy[]} discrepancies
 * @property {number} comparedCount
 * @property {string} at
 * @property {string} twinVersion
 */

/**
 * Balances may legitimately differ by a rounding unit across systems. Anything
 * larger is a discrepancy. Zero tolerance on the cent would generate noise;
 * a wide tolerance would hide real breaks.
 */
export const TOLERANCE_CENTS = 0;

/**
 * @param {import('./twin.mjs').TwinSnapshot} twin
 * @param {InstitutionBalance[]} institutionBalances
 * @param {{ toleranceCents?: number }} [opts]
 * @returns {ReconciliationResult}
 */
export function reconcile(twin, institutionBalances, opts = {}) {
  const tolerance = opts.toleranceCents ?? TOLERANCE_CENTS;
  const byId = new Map(institutionBalances.map((b) => [b.accountId, b]));
  /** @type {Discrepancy[]} */
  const discrepancies = [];

  for (const account of twin.accounts) {
    const reported = byId.get(account.id);
    if (!reported) {
      discrepancies.push({
        accountId: account.id,
        name: account.name,
        internalCents: account.balanceCents,
        institutionCents: 0,
        deltaCents: -account.balanceCents,
        kind: 'missing_at_institution',
      });
      continue;
    }
    const delta = reported.balanceCents - account.balanceCents;
    if (Math.abs(delta) > tolerance) {
      discrepancies.push({
        accountId: account.id,
        name: account.name,
        internalCents: account.balanceCents,
        institutionCents: reported.balanceCents,
        deltaCents: delta,
        kind: 'balance_mismatch',
      });
    }
  }

  // An account the institution reports that Veyra has never seen is equally a
  // break: it means the picture Veyra is reasoning about is incomplete.
  const known = new Set(twin.accounts.map((a) => a.id));
  for (const reported of institutionBalances) {
    if (!known.has(reported.accountId)) {
      discrepancies.push({
        accountId: reported.accountId,
        name: reported.accountId,
        internalCents: 0,
        institutionCents: reported.balanceCents,
        deltaCents: reported.balanceCents,
        kind: 'missing_internally',
      });
    }
  }

  return {
    clean: discrepancies.length === 0,
    discrepancies,
    comparedCount: twin.accounts.length,
    at: new Date().toISOString(),
    twinVersion: twin.version,
  };
}

/**
 * Which accounts a reconciliation break touches. Automation involving any of
 * them must not run, even if other accounts reconciled cleanly.
 * @param {ReconciliationResult} result
 */
export function affectedAccountIds(result) {
  return [...new Set(result.discrepancies.map((d) => d.accountId))];
}

/**
 * Does this action touch an account with an unresolved break?
 * @param {import('./policy.mjs').ProposedAction} action
 * @param {ReconciliationResult} result
 */
export function actionIsAffected(action, result) {
  const ids = new Set(affectedAccountIds(result));
  return Boolean(
    (action.sourceAccountId && ids.has(action.sourceAccountId)) ||
    (action.destinationAccountId && ids.has(action.destinationAccountId))
  );
}

/** Human summary for the pause notice. @param {ReconciliationResult} result */
export function summarize(result) {
  if (result.clean) return `All ${result.comparedCount} accounts reconciled.`;
  const n = result.discrepancies.length;
  return `${n} account${n === 1 ? '' : 's'} did not reconcile. No automated action will run against ${n === 1 ? 'it' : 'them'} until reviewed.`;
}
