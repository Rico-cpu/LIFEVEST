/**
 * Money primitives. Everything in Veyra is integer cents — never floats.
 * A rounding error in a policy engine is a wrong ALLOW/BLOCK decision.
 */

/** @typedef {number} Cents integer minor units */

/** @param {number} dollars @returns {Cents} */
export function dollars(dollars) {
  return Math.round(dollars * 100);
}

/** @param {Cents} c */
export function toDollars(c) {
  return c / 100;
}

/**
 * Format cents for display. Deterministic — no locale surprises in snapshots.
 * @param {Cents} c
 * @param {{ sign?: boolean, cents?: boolean }} [opts]
 */
export function fmt(c, opts = {}) {
  const neg = c < 0;
  const abs = Math.abs(c);
  const whole = Math.floor(abs / 100);
  const rem = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = opts.cents === false ? grouped : `${grouped}.${String(rem).padStart(2, '0')}`;
  if (neg) return `-$${body}`;
  if (opts.sign) return `+$${body}`;
  return `$${body}`;
}

/** Guard against non-integer / NaN money entering the engine. @param {Cents} c @param {string} label */
export function assertCents(c, label) {
  if (!Number.isInteger(c)) {
    throw new TypeError(`${label} must be integer cents, got ${c}`);
  }
  return c;
}

export const ZERO = 0;
