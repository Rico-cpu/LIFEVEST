# Veyra — master build prompt

Source of truth for any builder, human or automated, working on Veyra. Paste it
whole; do not feed it in fragments, because the invariants only make sense
together.

It differs deliberately from earlier drafts of this spec in a few places. Those
differences are marked **[corrected]** and are not stylistic — each one was a
defect that would have shipped.

---

## 0. Role

You are a principal product designer, staff software architect, fintech
engineer, and security architect. Build **Veyra**, a financial operating system:
it connects a person's accounts, maintains a continuously updated model of their
finances, explains what it sees, proposes actions, and executes only what the
person explicitly authorizes within rules they set.

**Positioning:** Your money, intelligently routed.
**Philosophy:** Extremely sophisticated underneath. Extremely simple on top.

Do not build a prototype that merely looks finished.

---

## 1. The invariant that outranks everything

> Intelligence proposes. Policy permits. A human authorizes. Execution happens.
> Verification confirms. Audit records.

These are four separate layers **in code**, not four paragraphs in a design doc:

| Layer | Question it answers |
| --- | --- |
| Intelligence | Is this a good idea? |
| Policy | Is this permitted under the user's rules? |
| Authorization | Did the user explicitly approve it? |
| Execution | Did the institution actually do it? |

Enforce these as testable properties. Each must fail closed:

1. **Only a human approves.** `approve()` throws for any actor whose kind is not
   `user` — AI, automation, and the system itself, at every permission level.
2. **A blocked action cannot be approved by anyone**, by any route.
3. **An approval binds to the state the human saw** — a fingerprint of the
   financial snapshot *and* the policy version. If either changed before
   execution, the approval is void and the action returns for re-approval.
   **[corrected]** — earlier drafts omitted this; without it there is a
   time-of-check/time-of-use hole exactly where money moves.
4. **Approvals expire**, and step-up re-authentication must be fresh.
5. **Execution is idempotent by key.** A replayed request returns the original
   result rather than moving money twice.
6. **Illegal state transitions throw**, never degrade.
7. **The engine never talks to a bank.** It calls an injected executor.

If a change breaks one of these, the build is broken. Test each explicitly.

---

## 2. Do not fake functionality

Never present simulated balances, connections, executions, or automation as
real. If an integration is not configured, say so:

```
Integration unavailable — Connect [Provider]
```

While the executor is a stub, every consequential screen must carry a
demonstration disclosure stating that nothing can move. Do not remove it to make
a demo look better.

---

## 3. Legal reality — read before designing anything regulated

**[corrected]** Earlier drafts asked for the product to be "lawsuit-proof" and
"legal in all 50 states." That is not achievable by writing documents, and
pursuing it that way makes things worse.

- Personalized investment recommendations require **RIA registration**.
- Moving money requires **money transmitter licensing** (state-by-state) or a
  licensed partner.
- Executing trades requires a **broker-dealer**.
- Handling consumer financial data triggers **GLBA** and state privacy law.

A disclaimer avoids none of these. Text describing activity you are not licensed
for is evidence against you, and misstating registration status is itself a
violation.

**Therefore:** architect so that *who holds each license* is swappable. Veyra
orchestrates; regulated partners perform regulated acts. Build the disclosure
and consent infrastructure (below) as real, versioned, auditable engineering —
that part genuinely helps. Get counsel before anything connects.

---

## 4. Disclosure and consent infrastructure

Not a Terms page. A system:

- Disclosures are **content-addressed**: the version is a fingerprint of the
  text, so rewording automatically invalidates prior acknowledgements.
- Requirements are **derived from the action**, not chosen by the screen, so a
  UI cannot forget one.
- Enforcement is a **hard gate**: an action cannot be approved while a required
  disclosure is unacknowledged at its current version.
- Each explicit disclosure is a **separate act**. Never one blanket "I agree" —
  a single checkbox proves nothing about what was read.
- Acknowledgements record id, version, actor, timestamp, and surface, and land
  in the audit trail.

Never write copy that promises an outcome. Assert this in a test.

---

## 5. Financial modelling rules

**Money is integer minor units.** Never floats. A rounding error in a policy
engine is a wrong allow/block decision.

**[corrected] Cash floor and emergency reserve are different guardrails.**
Earlier drafts conflated them and subtracted both from the same pool, which
double-counts and understates available cash. The reserve is *earmarked balance
held for a named goal*; the floor is *a minimum left in the account money leaves
from*.

**[corrected] Authorization projections must exclude expected income.** A cash
floor exists precisely to survive the paycheck not arriving. Crediting unearned
income into the check that guards it defeats the guardrail. Planning views may
opt in; authorization checks may not.

**[corrected] Recommendations must hold back a margin.** Safe-to-deploy contains
an *estimated* spend rate. Recommending all of it lands the user exactly on
their floor with nothing absorbing the estimation error. Reserve a margin and
round to a clean figure.

**Every figure is reconstructible.** Safe-to-deploy returns an arithmetic trace,
line by line with provenance, so a "Why?" control can always show the derivation.

**No projection is ever a point estimate.** Ranges only, with assumptions
stated. Note that annualized *rate* dispersion narrows with horizon while
*outcome* dispersion widens — both are true, and showing only the first is lying
by omission.

**Every statement line declares its basis** — `observed` (read from a balance)
or `derived` (computed from a rate).

---

## 6. Core services

Modular monolith with strict domain boundaries. Extract services only when
scale or isolation justifies it — not on day one.

```
Identity · Accounts · Transactions · Financial Twin · Cash Flow · Goals · Debt
Investments · Optimization · AI · Policy · Risk · Authorization · Execution
Reconciliation · Notifications · Audit · Analytics
```

**Financial Twin** — one immutable, fingerprinted snapshot every other engine
reads. Assets, liabilities, cash flow, goals, policies.

**Policy Engine** — pure, deterministic, versioned. Returns `ALLOW`,
`REQUIRE_APPROVAL`, `REQUIRE_REAUTH`, or `BLOCK`. Strictest rule wins. Every
rule returns its reason *and the numbers it used*. No I/O, no mutation.

**Risk Engine** — separate from policy. Policy answers "may this happen"; risk
answers "how hard should it be to say yes". Score from factors relative to the
user's own liquidity, with each contributing factor returned so friction can be
explained rather than merely imposed.

**Friction ladder** — more risk, more friction; never less than the policy
verdict demands. Name the *specific* reason. A generic "this may be risky"
teaches people to click through.

**Execution** — stateful, never a fire-and-forget balance update:
`REQUESTED → SOURCE_PENDING → DESTINATION_PENDING → SETTLED | FAILED`.

**Reconciliation** — continuously compare internal ledger to institution state.
On disagreement raise an exception and pause affected automation.

**Audit** — hash-chained, append-only, tamper-evident. Anchor the chain head
externally to make it provable to a third party.

---

## 7. The user's rules

A **Financial Constitution** the user writes: cash floor, reserve months,
short-term horizon, re-auth threshold, daily limits, debt strategy, approval
requirements. These are hard constraints, not preferences.

Changing a rule immediately re-evaluates every outstanding action and voids
approvals taken under the old rules. Only the account holder may change it.

Authorization levels 0–5 (read-only → bounded automation) cap what may be
*prepared*. They never change who may authorize.

---

## 8. Failure principle

When uncertain, **stop**. Never "we weren't sure, so we executed anyway."

```
Automation paused.
We couldn't confidently verify your financial state.
No action was taken.
```

Handle explicitly: connection expired, institution unavailable, transfer failed
or timed out, duplicate request, balance changed during approval, balance changed
during execution, policy or risk engine unavailable, account compromised. Fail
safe in every one.

Never show stale data as current. Always timestamp.

---

## 9. Interface

Calm, precise, restrained. Closer to Apple / Linear / Stripe / private banking
than a crypto terminal or an AI dashboard.

- Near-black, white, muted neutrals. **One** accent.
- Colour only communicates meaning: green positive, amber review, red risk.
  Never decoration.
- Generous whitespace. One primary action per screen.
- Numbers scan instantly; tabular figures; strong hierarchy.
- Motion communicates state changes only. Respect reduced-motion.
- Every important number has a **Why?**.

Home answers exactly three questions: *How am I doing? What should I do? What is
Veyra doing?*

Every flow needs loading, empty, and error states. Never "No data" or "Something
went wrong" — say what happened, what still works, and what to do next.

Accessibility is not optional: keyboard navigation, semantic HTML, focus states,
contrast, no colour-only status.

---

## 10. Security

Size defences to the actual surface; reject security theatre.

- Strict CSP with per-request nonces and no `unsafe-inline`. Achieve it by
  removing inline styles and scripts, not by weakening the policy.
  **Verify the nonce actually reaches the script tags** — a statically
  prerendered document cannot carry one, and the result is a policy that looks
  correct in headers while silently breaking the app.
- HSTS preload, `nosniff`, `frame-ancestors 'none'`, Referrer-Policy,
  Permissions-Policy, COOP/CORP.
- Passkeys, MFA, device binding, session rotation, step-up tied to the
  `REQUIRE_REAUTH` verdict.
- Envelope encryption with per-tenant keys; institution tokens in a vault the
  application tier cannot read.
- **Do not claim end-to-end encryption.** E2EE means the provider cannot read
  the data, which is incompatible with computing on it. Promise encrypted in
  transit and at rest, key isolation, and audited access.
- Treat all institution text as untrusted: strip bidi and zero-width characters
  before display; brand untrusted values so they cannot reach a model prompt
  except through a fence that neutralizes escape attempts. Heuristic phrase
  denylists are advisory telemetry, never a barrier.
- Dependencies: keep the framework current and audits clean.

---

## 11. Build order

1. Brand, design system, auth, security, onboarding, connectivity, data model,
   dashboard.
2. Financial Twin, cash flow, safe-to-deploy, goals, debt.
3. Brokerage connectivity, strategies, plans, constitution, automation rules.
4. Recommendations, optimization, scenarios, approval centre.
5. Assistant + AI security gateway + explainability.
6. Policy engine, risk engine, execution, reconciliation, audit.
7. Advanced automation, infrastructure APIs, B2B platform.

Do not enable automated execution before authorization, risk, reconciliation,
audit, and compliance foundations exist. Gate every financial capability behind
its own flag and roll out internal → 1% → 5% → 25% → 50% → 100%.

---

## 12. Definition of done

Every flow has loading, empty, and error states. Every financial action has
authorization, an audit record, and idempotency protection. Every automation has
explicit limits. Every connection has recovery handling. Every dangerous action
fails safely. Every page is responsive and accessible. The invariants in §1 are
covered by tests.

Ask at every screen: What must the user know? What can they ignore? What is the
one action? Can they understand why? Can they undo it? Can they see what will
happen before it happens?

If something doesn't help answer those, remove it.

---

## 13. Strategic frame

The consumer app is the first product, not the company. The Financial Twin,
optimization, policy, and risk infrastructure can power Veyra Consumer, an API,
and platforms for fintechs and wealth managers. Because the licensing burden
falls on regulated activity and not on decisioning software, the B2B layer is
both easier to ship and has the higher ceiling.

Build the architecture so that expansion is a packaging decision, not a rewrite.
