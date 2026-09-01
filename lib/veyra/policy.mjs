/**
 * The Policy Engine.
 *
 * Answers exactly one question: *may this action happen, and on what terms?*
 * It is pure, deterministic, and versioned. Same (action, twin, constitution)
 * always yields the same decision — which is what makes decisions replayable
 * in an audit, testable in CI, and explainable to a user.
 *
 * It never executes anything. It never mutates. It has no I/O.
 */

import { safeToDeploy, projectedBalanceCents, essentialMonthlyBurnCents, reserveStatus, account } from './twin.mjs';

/** Ordered least → most restrictive. Merge takes the max. */
export const VERDICT = /** @type {const} */ ({
  ALLOW: 'ALLOW',
  REQUIRE_APPROVAL: 'REQUIRE_APPROVAL',
  REQUIRE_REAUTH: 'REQUIRE_REAUTH',
  BLOCK: 'BLOCK',
});

const SEVERITY = { ALLOW: 0, REQUIRE_APPROVAL: 1, REQUIRE_REAUTH: 2, BLOCK: 3 };

/**
 * @typedef {'ALLOW'|'REQUIRE_APPROVAL'|'REQUIRE_REAUTH'|'BLOCK'} Verdict
 *
 * @typedef {Object} Constitution  the user's written financial rules
 * @property {string} version
 * @property {number} cashFloorCents            never let liquid cash fall below this
 * @property {number} reserveMonths             months of essential expenses to hold
 * @property {number} shortTermHorizonDays      money needed inside this window is untouchable
 * @property {number} reauthAboveCents          actions above this need re-authentication
 * @property {number} dailyOutflowLimitCents    hard velocity cap per day
 * @property {boolean} highestAprFirst          debt strategy preference
 * @property {boolean} requireApprovalForInvestmentChanges
 *
 * @typedef {'transfer'|'invest'|'debt_payment'|'goal_funding'|'policy_change'} ActionKind
 * @typedef {'user'|'ai'|'automation'|'system'} Origin
 *
 * @typedef {Object} ProposedAction
 * @property {string} id
 * @property {ActionKind} kind
 * @property {number} amountCents
 * @property {string} [sourceAccountId]
 * @property {string} [destinationAccountId]
 * @property {boolean} [destinationKnown]
 * @property {Origin} origin
 * @property {string} [automationRuleId]
 * @property {boolean} [weakensProtection]
 * @property {string} rationale
 *
 * @typedef {Object} EvalContext
 * @property {number} executedTodayCents
 * @property {string[]} [knownDestinations]
 * @property {Record<string, {maxPerActionCents:number, kinds:ActionKind[]}>} [automationRules]
 *
 * @typedef {Object} RuleResult
 * @property {string} ruleId
 * @property {string} title
 * @property {Verdict} verdict
 * @property {string} reason
 * @property {Record<string, number|string|boolean>} evidence
 *
 * @typedef {Object} Decision
 * @property {Verdict} verdict
 * @property {RuleResult[]} results        every rule that ran, in order
 * @property {RuleResult[]} determining    the rule(s) that set the verdict
 * @property {string} twinVersion
 * @property {string} constitutionVersion
 * @property {string} evaluatedAt
 */

/** @type {Array<{id:string, title:string, run:(a:ProposedAction, twin:import('./twin.mjs').TwinSnapshot, c:Constitution, ctx:EvalContext)=>RuleResult|null}>} */
const RULES = [
  {
    id: 'ai_never_self_authorizes',
    title: 'AI cannot authorize its own actions',
    run: (a) => {
      if (a.origin !== 'ai') return null;
      return {
        ruleId: 'ai_never_self_authorizes',
        title: 'AI cannot authorize its own actions',
        verdict: VERDICT.REQUIRE_APPROVAL,
        reason: 'This action was proposed by the assistant. It requires your explicit approval.',
        evidence: { origin: a.origin },
      };
    },
  },

  {
    id: 'cash_floor',
    title: 'Cash floor protection',
    run: (a, twin, c) => {
      if (!a.sourceAccountId || a.kind === 'policy_change') return null;
      const projected = projectedBalanceCents(twin, a.sourceAccountId, c.shortTermHorizonDays);
      const after = projected - a.amountCents;
      const ok = after >= c.cashFloorCents;
      return {
        ruleId: 'cash_floor',
        title: 'Cash floor protection',
        verdict: ok ? VERDICT.ALLOW : VERDICT.BLOCK,
        reason: !ok
          ? `Projected balance of ${money(after)} would fall below your ${money(c.cashFloorCents)} floor.`
          : after === c.cashFloorCents
            ? `Lands exactly on your ${money(c.cashFloorCents)} floor, with no margin left.`
            : `Projected balance stays ${money(after - c.cashFloorCents)} above your floor.`,
        evidence: {
          projectedBeforeCents: projected,
          projectedAfterCents: after,
          floorCents: c.cashFloorCents,
          horizonDays: c.shortTermHorizonDays,
        },
      };
    },
  },

  {
    id: 'emergency_reserve',
    title: 'Emergency reserve',
    run: (a, twin, c) => {
      if (a.kind === 'policy_change') return null;
      const before = reserveStatus(twin, c);
      // Only an action that draws *from* earmarked cash can damage the reserve.
      const drawsFromReserve = a.sourceAccountId
        ? Boolean(account(twin, a.sourceAccountId).earmarkedFor)
        : false;
      const afterCents = before.heldCents - (drawsFromReserve ? a.amountCents : 0);
      const burn = essentialMonthlyBurnCents(twin);
      const ok = afterCents >= before.requiredCents;
      return {
        ruleId: 'emergency_reserve',
        title: 'Emergency reserve',
        verdict: ok ? VERDICT.ALLOW : VERDICT.REQUIRE_APPROVAL,
        reason: ok
          ? `Reserve remains funded at ${(afterCents / Math.max(burn, 1)).toFixed(1)} months.`
          : `This would leave ${(afterCents / Math.max(burn, 1)).toFixed(1)} months of reserve, under your ${c.reserveMonths}-month target.`,
        evidence: {
          requiredCents: before.requiredCents,
          heldCents: before.heldCents,
          afterCents,
          drawsFromReserve,
          essentialMonthlyBurnCents: burn,
        },
      };
    },
  },

  {
    id: 'short_term_cash',
    title: 'Never invest short-term cash',
    run: (a, twin, c) => {
      if (a.kind !== 'invest' && a.kind !== 'goal_funding') return null;
      const std = safeToDeploy(twin, c, { horizonDays: c.shortTermHorizonDays });
      const ok = a.amountCents <= std.amountCents;
      return {
        ruleId: 'short_term_cash',
        title: 'Never invest short-term cash',
        verdict: ok ? VERDICT.ALLOW : VERDICT.BLOCK,
        reason: ok
          ? `Within your ${money(std.amountCents)} safe-to-deploy budget.`
          : `Exceeds safe-to-deploy by ${money(a.amountCents - std.amountCents)}. This money is committed within ${c.shortTermHorizonDays} days.`,
        evidence: { safeToDeployCents: std.amountCents, requestedCents: a.amountCents },
      };
    },
  },

  {
    id: 'large_action_reauth',
    title: 'Large action re-authentication',
    run: (a, _twin, c) => {
      if (a.amountCents <= c.reauthAboveCents) return null;
      return {
        ruleId: 'large_action_reauth',
        title: 'Large action re-authentication',
        verdict: VERDICT.REQUIRE_REAUTH,
        reason: `Above your ${money(c.reauthAboveCents)} re-authentication threshold.`,
        evidence: { thresholdCents: c.reauthAboveCents, amountCents: a.amountCents },
      };
    },
  },

  {
    id: 'daily_velocity',
    title: 'Daily outflow limit',
    run: (a, _twin, c, ctx) => {
      if (a.kind === 'policy_change') return null;
      const total = ctx.executedTodayCents + a.amountCents;
      const ok = total <= c.dailyOutflowLimitCents;
      return {
        ruleId: 'daily_velocity',
        title: 'Daily outflow limit',
        verdict: ok ? VERDICT.ALLOW : VERDICT.BLOCK,
        reason: ok
          ? `${money(total)} of ${money(c.dailyOutflowLimitCents)} daily limit used.`
          : `Would put today's total at ${money(total)}, over your ${money(c.dailyOutflowLimitCents)} limit.`,
        evidence: { executedTodayCents: ctx.executedTodayCents, wouldTotalCents: total, limitCents: c.dailyOutflowLimitCents },
      };
    },
  },

  {
    id: 'new_destination',
    title: 'Unrecognized destination',
    run: (a, _twin, _c, ctx) => {
      if (!a.destinationAccountId) return null;
      const known = a.destinationKnown ?? (ctx.knownDestinations ?? []).includes(a.destinationAccountId);
      if (known) return null;
      return {
        ruleId: 'new_destination',
        title: 'Unrecognized destination',
        verdict: VERDICT.REQUIRE_REAUTH,
        reason: 'Money has never moved to this destination before.',
        evidence: { destinationAccountId: a.destinationAccountId },
      };
    },
  },

  {
    id: 'automation_scope',
    title: 'Automation stays inside its mandate',
    run: (a, _twin, _c, ctx) => {
      if (a.origin !== 'automation') return null;
      const rule = a.automationRuleId ? (ctx.automationRules ?? {})[a.automationRuleId] : undefined;
      if (!rule) {
        return {
          ruleId: 'automation_scope',
          title: 'Automation stays inside its mandate',
          verdict: VERDICT.REQUIRE_APPROVAL,
          reason: 'No approved automation rule covers this action.',
          evidence: { automationRuleId: a.automationRuleId ?? 'none' },
        };
      }
      const inScope = rule.kinds.includes(a.kind) && a.amountCents <= rule.maxPerActionCents;
      return {
        ruleId: 'automation_scope',
        title: 'Automation stays inside its mandate',
        verdict: inScope ? VERDICT.ALLOW : VERDICT.REQUIRE_APPROVAL,
        reason: inScope
          ? `Covered by your "${a.automationRuleId}" rule.`
          : `Outside the limits of "${a.automationRuleId}" (cap ${money(rule.maxPerActionCents)}).`,
        evidence: { capCents: rule.maxPerActionCents, amountCents: a.amountCents, kind: a.kind },
      };
    },
  },

  {
    id: 'debt_priority',
    title: 'Debt strategy',
    run: (a, twin, c) => {
      if (a.kind !== 'debt_payment' || !c.highestAprFirst || !a.destinationAccountId) return null;
      const target = account(twin, a.destinationAccountId);
      const liabilities = twin.accounts.filter((x) => x.isLiability && x.balanceCents > 0);
      const highest = liabilities.reduce((m, x) => ((x.aprBps ?? 0) > (m?.aprBps ?? -1) ? x : m), liabilities[0]);
      if (!highest || highest.id === target.id) return null;
      return {
        ruleId: 'debt_priority',
        title: 'Debt strategy',
        verdict: VERDICT.REQUIRE_APPROVAL,
        reason: `Your constitution prioritizes highest-APR debt first. ${highest.name} is at ${((highest.aprBps ?? 0) / 100).toFixed(2)}%, above ${target.name}.`,
        evidence: { preferredAccountId: highest.id, targetAprBps: target.aprBps ?? 0, preferredAprBps: highest.aprBps ?? 0 },
      };
    },
  },

  {
    id: 'protection_downgrade',
    title: 'Weakening a protection',
    run: (a) => {
      if (a.kind !== 'policy_change' || !a.weakensProtection) return null;
      return {
        ruleId: 'protection_downgrade',
        title: 'Weakening a protection',
        verdict: VERDICT.REQUIRE_REAUTH,
        reason: 'This removes a guardrail that currently constrains future automated actions.',
        evidence: { weakensProtection: true },
      };
    },
  },

  {
    id: 'investment_change_approval',
    title: 'Investment changes require approval',
    run: (a, _twin, c) => {
      if (a.kind !== 'invest' || !c.requireApprovalForInvestmentChanges) return null;
      if (a.origin === 'user') return null;
      return {
        ruleId: 'investment_change_approval',
        title: 'Investment changes require approval',
        verdict: VERDICT.REQUIRE_APPROVAL,
        reason: 'You require explicit approval for every investment action.',
        evidence: { origin: a.origin },
      };
    },
  },
];

function money(c) {
  const neg = c < 0;
  const a = Math.abs(c);
  return `${neg ? '-' : ''}$${String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(a % 100).padStart(2, '0')}`;
}

/**
 * Evaluate an action against the twin and the user's constitution.
 * @param {ProposedAction} action
 * @param {import('./twin.mjs').TwinSnapshot} twin
 * @param {Constitution} constitution
 * @param {EvalContext} [ctx]
 * @returns {Decision}
 */
export function evaluate(action, twin, constitution, ctx = { executedTodayCents: 0 }) {
  if (!Number.isInteger(action.amountCents) || action.amountCents < 0) {
    throw new TypeError(`action.amountCents must be a non-negative integer, got ${action.amountCents}`);
  }

  /** @type {RuleResult[]} */
  const results = [];
  for (const rule of RULES) {
    const r = rule.run(action, twin, constitution, ctx);
    if (r) results.push(r);
  }

  const verdict = results.reduce(
    (worst, r) => (SEVERITY[r.verdict] > SEVERITY[worst] ? r.verdict : worst),
    /** @type {Verdict} */ (VERDICT.ALLOW)
  );

  return {
    verdict,
    results,
    determining: results.filter((r) => r.verdict === verdict && verdict !== VERDICT.ALLOW),
    twinVersion: twin.version,
    constitutionVersion: constitution.version,
    evaluatedAt: new Date().toISOString(),
  };
}

/** Stable id for a constitution's material contents, so changes invalidate approvals. @param {Omit<Constitution,'version'>} c */
export function constitutionVersion(c) {
  const s = JSON.stringify(Object.keys(c).sort().map((k) => [k, c[k]]));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `pol_${h.toString(16).padStart(8, '0')}`;
}

/** @param {Omit<Constitution,'version'>} c @returns {Constitution} */
export function sealConstitution(c) {
  return Object.freeze({ ...c, version: constitutionVersion(c) });
}

export const ALL_RULE_IDS = RULES.map((r) => r.id);
