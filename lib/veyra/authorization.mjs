/**
 * Blueprint §5 — the authorization hierarchy.
 *
 * Veyra never ships unrestricted autonomous financial activity. Capability is
 * granted in explicit levels, and a level is a *ceiling*: the policy engine can
 * still demand more friction, never less.
 */

export const LEVEL = /** @type {const} */ ({
  READ_ONLY: 0,
  RECOMMEND: 1,
  PREPARE: 2,
  APPROVE_EACH: 3,
  RECURRING_RULE: 4,
  BOUNDED_AUTOMATION: 5,
});

export const LEVEL_META = [
  { level: 0, name: 'Read-only', summary: 'Veyra reads your accounts. Nothing else.' },
  { level: 1, name: 'Recommendations', summary: 'Veyra tells you what it would do.' },
  { level: 2, name: 'Prepare actions', summary: 'Veyra stages actions for you to review.' },
  { level: 3, name: 'Approve each action', summary: 'You approve every action individually.' },
  { level: 4, name: 'Recurring rules', summary: 'You approve a rule once; each run is still logged and reversible.' },
  { level: 5, name: 'Bounded automation', summary: 'Veyra acts inside hard constraints you set.' },
];

/**
 * What an origin is permitted to do at a given level.
 * @param {number} level
 * @param {import('./policy.mjs').Origin} origin
 */
export function capabilities(level, origin) {
  const canPrepare = level >= LEVEL.PREPARE;
  const canRunRule = level >= LEVEL.RECURRING_RULE;
  const canAutomate = level >= LEVEL.BOUNDED_AUTOMATION;
  return {
    canRead: true,
    canRecommend: level >= LEVEL.RECOMMEND,
    canPrepare,
    // The invariant that outranks every level: only a human authorizes.
    canAuthorize: origin === 'user',
    canRunApprovedRule: canRunRule && (origin === 'automation' || origin === 'user'),
    canActWithoutPerActionApproval: canAutomate && origin === 'automation',
  };
}

/**
 * Gate a proposal by level before it ever reaches the policy engine.
 * @param {number} level
 * @param {import('./policy.mjs').ProposedAction} action
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function gate(level, action) {
  const caps = capabilities(level, action.origin);
  if (!caps.canPrepare) {
    return {
      allowed: false,
      reason: `Your authorization level (${LEVEL_META[level].name}) does not permit Veyra to prepare actions.`,
    };
  }
  // Deliberately NOT gated on origin here.
  //
  // Preparing an action is not performing one. In Assisted mode Veyra prepares
  // scheduled, automation-originated actions and asks the user to approve them —
  // that is the whole point of the mode. Conflating "may prepare" with "may run
  // unattended" made the system throw when a user disabled Autopilot, because
  // the fallback path could no longer even stage the action for approval.
  //
  // Unattended execution is gated separately and far more strictly, by
  // autopilot.mayExecuteAutonomously(). Both must pass for money to move
  // without a prompt, so the split fails closed.
  return { allowed: true };
}
