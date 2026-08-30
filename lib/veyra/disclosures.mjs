/**
 * Disclosure and consent infrastructure.
 *
 * The thing that helps in an enforcement action or a dispute is not the
 * existence of a Terms page. It is being able to show, for a specific action a
 * specific user took at a specific moment: *this exact disclosure text, at this
 * version, was presented, and they acknowledged it.* That is an engineering
 * problem, and it is the part worth building.
 *
 * Three properties make it work:
 *
 *   1. Disclosures are content-addressed. Editing the text changes its version,
 *      which invalidates prior acknowledgements. You cannot silently reword a
 *      risk warning and keep everyone's old consent.
 *   2. Requirements are derived from the action, not chosen by the UI. A screen
 *      cannot forget to show one.
 *   3. Enforcement is a hard gate: an action whose required disclosures are not
 *      acknowledged at their current version cannot be approved.
 *
 * The text below is drafted to describe what this application actually does
 * today and has NOT been reviewed by counsel. See LEGAL_STATUS.md.
 */

/**
 * @typedef {Object} Disclosure
 * @property {string} id
 * @property {string} version           derived from the text; changes when text changes
 * @property {string} title
 * @property {string} body
 * @property {'explicit'|'passive'} acknowledgement  explicit = user must act
 * @property {string} rationale         why this disclosure exists
 */

/** Content fingerprint, so text and version cannot drift apart. */
function versionOf(title, body) {
  const s = `${title}\n${body}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `v${h.toString(16).padStart(8, '0')}`;
}

function define(id, title, body, acknowledgement, rationale) {
  return Object.freeze({ id, title, body: body.trim(), acknowledgement, rationale, version: versionOf(title, body.trim()) });
}

export const DISCLOSURES = Object.freeze({
  demonstration: define(
    'demonstration',
    'This is a demonstration',
    `Veyra is not connected to any financial institution. The figures shown are
fictional sample data. No account is linked, no money can move, and approving an
action here performs a simulation only.`,
    'passive',
    'The single most protective statement available today: the product does not do the regulated things it depicts.'
  ),

  not_advice: define(
    'not_advice',
    'Not investment advice',
    `Veyra is not a registered investment adviser, broker-dealer, bank, or money
transmitter. Nothing presented here is investment, tax, legal, or financial
advice, or a recommendation to buy or sell any security. Strategy profiles are
illustrative categories, not personalized recommendations.`,
    'explicit',
    'Personalized investment advice is a regulated activity. This states plainly that none is being given.'
  ),

  investment_risk: define(
    'investment_risk',
    'Investment risk',
    `Investing involves risk, including possible loss of principal. Past
performance does not guarantee future results. Veyra does not guarantee any
investment outcome.`,
    'explicit',
    'Required framing wherever an investment action is presented.'
  ),

  projections_are_estimates: define(
    'projections_are_estimates',
    'Projections are estimates',
    `Projected ranges are modelled from stated assumptions in today's dollars.
They are not forecasts, predictions, or guarantees, and actual outcomes will
differ — potentially by a wide margin.`,
    'explicit',
    'Shown wherever a forward-looking range appears, so no figure reads as a promise.'
  ),

  ai_informational: define(
    'ai_informational',
    'About Veyra AI',
    `Veyra's analysis is generated automatically from available account data and
may be incomplete or wrong. It cannot authorize or execute anything. Review
every recommendation before approving a financial action.`,
    'explicit',
    'Sets expectations for automated analysis and states that it holds no authority.'
  ),

  estimates_not_guaranteed: define(
    'estimates_not_guaranteed',
    'Estimated savings are not guaranteed',
    `Figures such as "interest avoided" are estimates calculated from current
balances and rates. Actual amounts depend on rates, timing, and your own
activity, and will differ.`,
    'explicit',
    'Attaches to debt recommendations, which are the ones that quote a dollar benefit.'
  ),

  data_use: define(
    'data_use',
    'How your data is used',
    `Veyra reads account balances and transactions to build your financial
picture. It does not sell your data. Financial data is processed to produce the
analysis you see and for no other purpose.`,
    'passive',
    'Plain-language statement of processing purpose.'
  ),
});

/**
 * Which disclosures an action requires. Derived from the action itself so a
 * screen cannot omit one by forgetting to render it.
 *
 * @param {import('./policy.mjs').ProposedAction} action
 * @param {{ demonstrationMode?: boolean }} [context]
 * @returns {Disclosure[]}
 */
export function requiredFor(action, context = {}) {
  /** @type {Disclosure[]} */
  const out = [];
  const demo = context.demonstrationMode ?? true;

  if (demo) out.push(DISCLOSURES.demonstration);

  if (action.kind === 'invest') {
    out.push(DISCLOSURES.not_advice, DISCLOSURES.investment_risk);
  }
  if (action.kind === 'debt_payment') {
    out.push(DISCLOSURES.estimates_not_guaranteed);
  }
  if (action.origin === 'ai') {
    out.push(DISCLOSURES.ai_informational);
  }
  return dedupe(out);
}

/** Disclosures a surface must carry, independent of any single action. */
export function requiredForSurface(surface) {
  switch (surface) {
    case 'projection':
      return [DISCLOSURES.projections_are_estimates];
    case 'strategy':
      return [DISCLOSURES.not_advice, DISCLOSURES.investment_risk, DISCLOSURES.projections_are_estimates];
    case 'assistant':
      return [DISCLOSURES.ai_informational];
    default:
      return [];
  }
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
}

/**
 * Records of what a user acknowledged, and when.
 *
 * Acknowledgements are keyed by disclosure id *and* version, so editing a
 * disclosure necessarily invalidates consent to the previous wording.
 */
export class ConsentLedger {
  constructor() {
    /** @type {{ id:string, version:string, at:string, actorId:string, surface:string }[]} */
    this.records = [];
  }

  /**
   * @param {Disclosure} disclosure
   * @param {import('./actions.mjs').Actor} actor  must be a person
   * @param {string} surface  where it was presented
   */
  acknowledge(disclosure, actor, surface = 'unknown') {
    if (actor.kind !== 'user') {
      throw new Error('only a person may acknowledge a disclosure');
    }
    const record = Object.freeze({
      id: disclosure.id,
      version: disclosure.version,
      at: new Date().toISOString(),
      actorId: actor.id,
      surface,
    });
    this.records.push(record);
    return record;
  }

  /** @param {Disclosure} disclosure */
  has(disclosure) {
    return this.records.some((r) => r.id === disclosure.id && r.version === disclosure.version);
  }

  /**
   * Which of an action's required, explicit disclosures are still outstanding.
   * Passive disclosures must be displayed but need no affirmative act.
   * @param {import('./policy.mjs').ProposedAction} action
   * @param {{ demonstrationMode?: boolean }} [context]
   */
  outstandingFor(action, context) {
    return requiredFor(action, context).filter(
      (d) => d.acknowledgement === 'explicit' && !this.has(d)
    );
  }
}

/**
 * Hard gate. An action cannot be approved while a required disclosure is
 * unacknowledged at its current version.
 *
 * @param {import('./policy.mjs').ProposedAction} action
 * @param {ConsentLedger} ledger
 * @param {{ demonstrationMode?: boolean }} [context]
 */
export function assertDisclosed(action, ledger, context) {
  const missing = ledger.outstandingFor(action, context);
  if (missing.length > 0) {
    throw new Error(
      `disclosures not acknowledged: ${missing.map((d) => `${d.id}@${d.version}`).join(', ')}`
    );
  }
  return true;
}

/** Every disclosure, for the legal centre. */
export function allDisclosures() {
  return Object.values(DISCLOSURES);
}
