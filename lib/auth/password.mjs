/**
 * Password hashing.
 *
 * scrypt from node:crypto — memory-hard, in the standard library, no
 * dependency to audit. Parameters are stored inside the hash string so cost
 * can be raised later without invalidating existing passwords: an old hash
 * still verifies against its own parameters, and can be transparently upgraded
 * on the next successful sign-in.
 *
 * Never store, log, or return a plaintext password. Nothing in this module
 * accepts a callback that could leak one.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

/**
 * OWASP's floor for scrypt is N=2^17, r=8, p=1. We use it. It costs ~130MB and
 * ~100ms per hash, which is the point: it makes offline cracking expensive.
 */
export const PARAMS = Object.freeze({ N: 1 << 17, r: 8, p: 1, keylen: 64, saltBytes: 16 });

/** Node's default maxmem (32MB) is below what these parameters need. */
const MAXMEM = 256 * 1024 * 1024;

/**
 * Minimum viable policy: length beats composition rules. NIST SP 800-63B
 * recommends length minimums and screening against known-breached passwords
 * rather than forcing symbol classes, which mostly produces "Passw0rd!".
 */
export const MIN_LENGTH = 12;
export const MAX_LENGTH = 256;

/** @param {string} password @returns {{ok:boolean, reason?:string}} */
export function validatePassword(password) {
  if (typeof password !== 'string') return { ok: false, reason: 'Password is required.' };
  if (password.length < MIN_LENGTH) {
    return { ok: false, reason: `Use at least ${MIN_LENGTH} characters.` };
  }
  if (password.length > MAX_LENGTH) {
    // Bounded to keep hashing cost predictable; unbounded input is a DoS vector.
    return { ok: false, reason: `Use at most ${MAX_LENGTH} characters.` };
  }
  if (/^\s+$/.test(password)) return { ok: false, reason: 'Password cannot be only whitespace.' };
  return { ok: true };
}

/**
 * @param {string} password
 * @returns {Promise<string>} `scrypt$N$r$p$saltB64$hashB64`
 */
export async function hashPassword(password) {
  const check = validatePassword(password);
  if (!check.ok) throw new Error(check.reason);

  const salt = randomBytes(PARAMS.saltBytes);
  const derived = await scrypt(normalize(password), salt, PARAMS.keylen, {
    N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAXMEM,
  });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), derived.toString('base64')].join('$');
}

/**
 * Constant-time verification.
 *
 * Returns false rather than throwing on a malformed stored hash: a corrupt row
 * must not become an authentication bypass or a distinguishable error.
 *
 * @param {string} password
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Refuse absurd parameters from a tampered row rather than trying to honour them.
  if (N < 1024 || N > (1 << 20) || r < 1 || r > 32 || p < 1 || p > 16) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const derived = await scrypt(normalize(password), salt, expected.length, { N, r, p, maxmem: MAXMEM });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Should this hash be re-computed with current parameters? Called after a
 * successful sign-in, which is the only moment the plaintext is available.
 * @param {string} stored
 */
export function needsRehash(stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < PARAMS.N || Number(parts[2]) < PARAMS.r || Number(parts[3]) < PARAMS.p;
}

/**
 * Unicode normalization so a password typed on a different keyboard or OS
 * still matches. Without this, an accented character can hash differently
 * depending on how the platform composed it.
 * @param {string} s
 */
function normalize(s) {
  return s.normalize('NFKC');
}

/** Normalize an email for storage and lookup, so case cannot fork an account. */
export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

/** @param {string} email */
export function validEmail(email) {
  const e = normalizeEmail(email);
  // Deliberately permissive: over-strict email regexes reject valid addresses.
  return e.length > 3 && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
