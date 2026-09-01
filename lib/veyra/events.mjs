/**
 * Blueprint §34 — the event vocabulary.
 *
 * Domains talk to each other through these and nothing else. Keeping the
 * catalogue in one file is what makes the "modular monolith now, services
 * later" plan (§35) actually survive contact with growth: the seams are
 * already drawn.
 */

export const EVENT = /** @type {const} */ ({
  ACCOUNT_CONNECTED: 'ACCOUNT_CONNECTED',
  BALANCE_UPDATED: 'BALANCE_UPDATED',
  PAYCHECK_RECEIVED: 'PAYCHECK_RECEIVED',
  BILL_DETECTED: 'BILL_DETECTED',
  GOAL_UPDATED: 'GOAL_UPDATED',
  GOAL_COMPLETED: 'GOAL_COMPLETED',
  DEBT_CHANGED: 'DEBT_CHANGED',
  INVESTMENT_PLAN_CREATED: 'INVESTMENT_PLAN_CREATED',
  INVESTMENT_PLAN_PAUSED: 'INVESTMENT_PLAN_PAUSED',
  AUTOPILOT_ENABLED: 'AUTOPILOT_ENABLED',
  AUTOPILOT_PAUSED: 'AUTOPILOT_PAUSED',
  RECONCILIATION_EXCEPTION: 'RECONCILIATION_EXCEPTION',
  TRANSFER_PROPOSED: 'TRANSFER_PROPOSED',
  TRANSFER_APPROVED: 'TRANSFER_APPROVED',
  TRANSFER_EXECUTED: 'TRANSFER_EXECUTED',
  TRANSFER_REJECTED: 'TRANSFER_REJECTED',
  TRANSFER_BLOCKED: 'TRANSFER_BLOCKED',
  APPROVAL_INVALIDATED: 'APPROVAL_INVALIDATED',
  POLICY_CHANGED: 'POLICY_CHANGED',
  RISK_ALERT: 'RISK_ALERT',
});

export class EventBus {
  constructor() {
    /** @type {Map<string, Function[]>} */
    this.handlers = new Map();
    /** @type {{ type:string, at:string, payload:any }[]} */
    this.emitted = [];
  }

  /** @param {string} type @param {(payload:any)=>void} fn */
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return () => {
      const list = this.handlers.get(type) ?? [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  /**
   * Handler failures are isolated: one bad subscriber must never abort a
   * financial workflow that has already been authorized.
   * @param {string} type @param {any} payload
   */
  emit(type, payload) {
    this.emitted.push({ type, at: new Date().toISOString(), payload });
    for (const fn of this.handlers.get(type) ?? []) {
      try {
        fn(payload);
      } catch {
        /* isolated by design */
      }
    }
  }
}
