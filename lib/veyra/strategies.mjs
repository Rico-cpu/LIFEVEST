/**
 * Blueprint §6–§8 — strategy profiles, customization, comparison.
 *
 * These are *strategy profiles*, not products and not promises. Every number
 * this module produces is an illustrative range derived from stated
 * assumptions, and it is labelled as such everywhere it surfaces. No point
 * estimate is ever presented as a forecast — §8 is explicit that
 * "you'll have $2,483,291 in 2050" is the failure mode to avoid.
 */

/**
 * @typedef {'preservation'|'conservative'|'balanced'|'growth'|'aggressive'|'custom'} StrategyId
 *
 * @typedef {Object} Allocation
 * @property {number} usEquity
 * @property {number} intlEquity
 * @property {number} bonds
 * @property {number} other
 *
 * @typedef {Object} StrategyProfile
 * @property {StrategyId} id
 * @property {string} name
 * @property {string} description
 * @property {Allocation} allocation
 * @property {'low'|'moderate'|'high'} riskLevel
 * @property {number} assumedRealReturn   annual, decimal — an assumption, not a forecast
 * @property {number} assumedVolatility   annual stdev, decimal
 * @property {'high'|'medium'} liquidity
 */

/** @type {Record<StrategyId, StrategyProfile>} */
export const STRATEGIES = {
  preservation: {
    id: 'preservation',
    name: 'Capital Preservation',
    description: 'Prioritize stability and liquidity.',
    allocation: { usEquity: 10, intlEquity: 5, bonds: 75, other: 10 },
    riskLevel: 'low',
    assumedRealReturn: 0.012,
    assumedVolatility: 0.035,
    liquidity: 'high',
  },
  conservative: {
    id: 'conservative',
    name: 'Conservative',
    description: 'Lower volatility with moderate growth objectives.',
    allocation: { usEquity: 25, intlEquity: 10, bonds: 55, other: 10 },
    riskLevel: 'low',
    assumedRealReturn: 0.025,
    assumedVolatility: 0.065,
    liquidity: 'high',
  },
  balanced: {
    id: 'balanced',
    name: 'Balanced',
    description: 'Blend growth and stability.',
    allocation: { usEquity: 40, intlEquity: 20, bonds: 30, other: 10 },
    riskLevel: 'moderate',
    assumedRealReturn: 0.038,
    assumedVolatility: 0.098,
    liquidity: 'high',
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    description: 'Higher long-term growth potential with greater volatility.',
    allocation: { usEquity: 55, intlEquity: 25, bonds: 10, other: 10 },
    riskLevel: 'high',
    assumedRealReturn: 0.048,
    assumedVolatility: 0.135,
    liquidity: 'high',
  },
  aggressive: {
    id: 'aggressive',
    name: 'Aggressive Growth',
    description: 'Prioritize long-term growth while accepting significant volatility.',
    allocation: { usEquity: 65, intlEquity: 30, bonds: 0, other: 5 },
    riskLevel: 'high',
    assumedRealReturn: 0.056,
    assumedVolatility: 0.168,
    liquidity: 'high',
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    description: 'Build your own allocation.',
    allocation: { usEquity: 40, intlEquity: 20, bonds: 30, other: 10 },
    riskLevel: 'moderate',
    assumedRealReturn: 0.038,
    assumedVolatility: 0.098,
    liquidity: 'high',
  },
};

/** @param {Allocation} a */
export function allocationTotal(a) {
  return a.usEquity + a.intlEquity + a.bonds + a.other;
}

/** @param {Allocation} a @returns {{valid:boolean, reason?:string}} */
export function validateAllocation(a) {
  const total = allocationTotal(a);
  if (Object.values(a).some((v) => v < 0)) return { valid: false, reason: 'Allocations cannot be negative.' };
  if (total !== 100) return { valid: false, reason: `Allocation totals ${total}%. It must total 100%.` };
  return { valid: true };
}

/**
 * Blend assumptions for a custom allocation from its sleeves, so a custom
 * portfolio is never silently modelled with a default's assumptions.
 * @param {Allocation} a
 */
export function assumptionsFor(a) {
  const sleeves = {
    usEquity: { r: 0.055, v: 0.16 },
    intlEquity: { r: 0.05, v: 0.18 },
    bonds: { r: 0.012, v: 0.05 },
    other: { r: 0.03, v: 0.12 },
  };
  let r = 0;
  let v = 0;
  for (const k of Object.keys(sleeves)) {
    const w = a[k] / 100;
    r += w * sleeves[k].r;
    v += w * sleeves[k].v; // deliberately ignores correlation — overstates dispersion, which is the safe direction
  }
  return { assumedRealReturn: Number(r.toFixed(4)), assumedVolatility: Number(v.toFixed(4)) };
}

const Z_80 = 1.2816; // 10th–90th percentile

/**
 * Illustrative outcome range for a contribution plan.
 *
 * Method: annualized-return dispersion narrows with the square root of the
 * horizon, so the band is μ ± z·σ/√years. Three future values are computed at
 * the low, central, and high annualized rates. This is a modelled range under
 * stated assumptions — not a prediction, and never presented as one.
 *
 * @param {Object} p
 * @param {number} p.initialCents
 * @param {number} p.monthlyCents
 * @param {number} p.years
 * @param {number} p.assumedRealReturn
 * @param {number} p.assumedVolatility
 */
export function projectRange({ initialCents, monthlyCents, years, assumedRealReturn, assumedVolatility }) {
  if (years <= 0) {
    return { lowCents: initialCents, midCents: initialCents, highCents: initialCents, contributedCents: initialCents, years, basis: 'no horizon' };
  }
  const spread = (Z_80 * assumedVolatility) / Math.sqrt(years);
  const rates = {
    low: assumedRealReturn - spread,
    mid: assumedRealReturn,
    high: assumedRealReturn + spread,
  };

  const fv = (annual) => {
    const n = Math.round(years * 12);
    const m = Math.pow(1 + Math.max(annual, -0.9), 1 / 12) - 1;
    const growthOfInitial = initialCents * Math.pow(1 + m, n);
    const growthOfContribs =
      Math.abs(m) < 1e-9 ? monthlyCents * n : monthlyCents * ((Math.pow(1 + m, n) - 1) / m);
    return Math.round(growthOfInitial + growthOfContribs);
  };

  return {
    lowCents: fv(rates.low),
    midCents: fv(rates.mid),
    highCents: fv(rates.high),
    contributedCents: initialCents + monthlyCents * Math.round(years * 12),
    years,
    basis: 'Illustrative range in today’s dollars under stated assumptions. Not a prediction.',
  };
}

/**
 * Blueprint §8 — comparison across strategies on the same contribution plan.
 * @param {StrategyId[]} ids
 * @param {{initialCents:number, monthlyCents:number, years:number}} plan
 */
export function compare(ids, plan) {
  return ids.map((id) => {
    const s = STRATEGIES[id];
    return {
      strategy: s,
      range: projectRange({ ...plan, assumedRealReturn: s.assumedRealReturn, assumedVolatility: s.assumedVolatility }),
    };
  });
}
