/**
 * Append-only, hash-chained audit log.
 *
 * Tamper-evidence, not tamper-proofing: each record commits to the hash of the
 * one before it, so any retroactive edit or deletion breaks verification from
 * that point forward. In production this chain head gets anchored externally
 * (a WORM store or a notarization service) — that is what turns "evident" into
 * "provable to a third party".
 *
 * Uses Web Crypto, so the same module runs in Node and in the browser.
 */

const GENESIS = '0'.repeat(64);

/**
 * @typedef {Object} AuditRecord
 * @property {number} seq
 * @property {string} at
 * @property {string} event
 * @property {string} actorId
 * @property {string} actorKind
 * @property {string|null} actionId
 * @property {number|null} amountCents
 * @property {string|null} sourceAccountId
 * @property {string|null} destinationAccountId
 * @property {string|null} verdict
 * @property {number|null} riskScore
 * @property {string|null} twinVersion
 * @property {string|null} constitutionVersion
 * @property {string} reason
 * @property {string} prevHash
 * @property {string} hash
 */

async function sha256Hex(s) {
  const bytes = new TextEncoder().encode(s);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Canonical serialization — key order must never depend on object construction. */
function canonical(rec) {
  const { hash, ...rest } = rec;
  return JSON.stringify(Object.keys(rest).sort().map((k) => [k, rest[k]]));
}

export class AuditLog {
  constructor() {
    /** @type {AuditRecord[]} */
    this.records = [];
  }

  get head() {
    return this.records.length ? this.records[this.records.length - 1].hash : GENESIS;
  }

  /**
   * @param {Object} entry
   * @param {string} entry.event
   * @param {import('./actions.mjs').Actor} entry.actor
   * @param {string} [entry.reason]
   * @param {import('./actions.mjs').ActionRecord} [entry.record]
   * @returns {Promise<AuditRecord>}
   */
  async append({ event, actor, reason = '', record }) {
    const a = record?.action;
    /** @type {Omit<AuditRecord,'hash'>} */
    const base = {
      seq: this.records.length,
      at: new Date().toISOString(),
      event,
      actorId: actor.id,
      actorKind: actor.kind,
      actionId: a?.id ?? null,
      amountCents: a?.amountCents ?? null,
      sourceAccountId: a?.sourceAccountId ?? null,
      destinationAccountId: a?.destinationAccountId ?? null,
      verdict: record?.decision?.verdict ?? null,
      riskScore: record?.risk?.score ?? null,
      twinVersion: record?.decision?.twinVersion ?? null,
      constitutionVersion: record?.decision?.constitutionVersion ?? null,
      reason,
      prevHash: this.head,
    };
    const hash = await sha256Hex(canonical(base));
    const full = Object.freeze({ ...base, hash });
    this.records.push(full);
    return full;
  }

  /** @returns {Promise<{ valid: boolean, brokeAt?: number }>} */
  async verify() {
    let prev = GENESIS;
    for (const rec of this.records) {
      if (rec.prevHash !== prev) return { valid: false, brokeAt: rec.seq };
      const expected = await sha256Hex(canonical(rec));
      if (expected !== rec.hash) return { valid: false, brokeAt: rec.seq };
      prev = rec.hash;
    }
    return { valid: true };
  }
}
