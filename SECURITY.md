# Security

## What this application is today

A static client-side Next.js app with a deterministic decision core. Be precise
about the surface, because everything else follows from it:

- **No backend.** No API routes, no server actions, no database.
- **No credentials.** No environment variables, no API keys, no tokens.
- **No user data.** The Financial Twin on screen is a fixture: a fictional
  person, no connected institution, no PII.
- **No network egress.** The app makes no outbound requests. `connect-src` is
  `'self'` and there is nothing for it to call.
- **The executor is a stub.** Approving an action returns a simulated
  reference. No code path in this repository can move money.

So the honest threat model *today* is: XSS against the app's own code,
clickjacking, supply-chain compromise via dependencies, and a publicly
reachable deployment URL. It is not "a fintech holding your money." Defences
below are sized to that, plus the surface that arrives when institutions
connect.

## What is implemented

### Transport and browser hardening

`middleware.js` sets, on every HTML document:

| Header | Value | Why |
| --- | --- | --- |
| `Content-Security-Policy` | per-request nonce, `strict-dynamic` | No inline script executes without a nonce the server minted this request. |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Removes the downgrade window. |
| `X-Content-Type-Options` | `nosniff` | No MIME confusion. |
| `X-Frame-Options` / `frame-ancestors` | `DENY` / `'none'` | Clickjacking, belt and braces. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | No path leakage to third parties. |
| `Permissions-Policy` | camera, mic, geolocation, payment, USB all `()` | The app needs none of them. |
| `Cross-Origin-Opener-Policy` | `same-origin` | No cross-origin window handles. |
| `Cross-Origin-Resource-Policy` | `same-origin` | No hotlinking of app resources. |

The CSP carries no `'unsafe-inline'` for scripts and none for styles. Getting
there required real changes, not just a header:

- Both pages injected CSS through `dangerouslySetInnerHTML`. That is gone;
  styles are real stylesheets, and there is now no `dangerouslySetInnerHTML`
  anywhere in `app/`.
- `<body>` no longer carries a `style` attribute.
- Both routes render per request, because a prerendered document cannot carry
  a nonce. This was verified rather than assumed: with static rendering the
  header nonce matched **zero** script tags and the app would have shipped a
  CSP that silently broke hydration.

`COEP` is deliberately **not** set. `require-corp` would break the Google Fonts
fetch, and cross-origin isolation buys nothing until the app uses
`SharedArrayBuffer`.

### Dependencies

`next@14.2.35` carried 20+ advisories (to CVSS 8.6). Upgraded to `next@16`
with React 19; `npm audit` reports zero vulnerabilities. Most of those
advisories targeted Server Components, Server Actions, middleware, and image
optimization — unused then, but middleware is in use now.

### The untrusted-input boundary

`lib/veyra/untrusted.mjs` — blueprint §30–§31. Every string arriving from an
institution is attacker-chosen. Two hazards, handled separately:

- **Display.** Bidi overrides and zero-width characters make text render as
  something other than what it is (Trojan Source). In a ledger that turns a
  payee into a lie. `sanitizeForDisplay()` strips them.
- **Prompt injection.** Untrusted values are branded on entry and cannot reach
  a prompt except through `toPromptBlock()`, which fences them, neutralizes
  fence-breaking payloads, and labels provenance. `assertPromptSafe()` throws
  if a raw value was interpolated.

The heuristic `screen()` is explicitly **advisory only**. A denylist of
"ignore previous instructions" phrasings is not a security control; the
structural boundary is what provides the guarantee.

### Autopilot safety

`lib/veyra/autopilot.mjs` — the rule is that no action executes under
uncertainty, and it is enforced by derivation rather than by a flag. Pause
conditions are computed from system state, so nothing can be "resumed" while a
blocking condition still holds; resuming only clears an operator's own stop.

- Full Autopilot is never a default, and activation requires all four risk
  acknowledgements from a person, plus at least one pre-approved destination.
- Activation consent is content-addressed: reword an acknowledgement and every
  existing activation is invalidated.
- Hard limits: per-action, per-day, per-month, actions-per-day velocity,
  destination allowlist, action-type allowlist. All failures are reported, not
  just the first.
- Automatic pause on stale balances, unhealthy connections, reconciliation
  breaks, unreviewed execution failures, security events, or outdated consent.
- A standing rule can never satisfy a step-up requirement. Consent given last
  month is not a passkey tap now, so `REQUIRE_REAUTH` always falls back to
  asking.
- Emergency stop cancels staged actions and can only be cleared by the account
  holder with fresh re-authentication.

`lib/veyra/reconciliation.mjs` compares Veyra's belief against the institution's
fact. On disagreement it raises an exception and refuses automation against the
affected accounts — it never resolves the difference by trusting Veyra.

### Authorization invariants

`lib/veyra/actions.mjs`, covered by `__tests__/authorization.test.mjs`:
only a human can approve; approvals bind to the twin fingerprint and
constitution version and are void if either moves; approvals expire;
re-authentication must be fresh; execution is idempotent; illegal state
transitions throw. See `lib/veyra/README.md`.

## Framework baseline: NIST CSF 2.0

The security program is organised against NIST CSF 2.0 rather than described
with marketing language. "Bank-level" and "military-grade" are not claims that
can be audited; a framework mapping can be. The honest state today, with gaps
named rather than hidden:

| Function | Implemented | Not yet |
| --- | --- | --- |
| **GOVERN** | Threat model and scope written down; the untrusted-input boundary and authorization invariants are stated as testable policy; `LEGAL_STATUS.md` records regulatory posture. | No named security owner, no risk register, no vendor management, no policy review cadence. |
| **IDENTIFY** | Asset surface is small and enumerated above; dependencies tracked and audited; data flows documented (there are none off-device today). | No formal asset inventory or business-impact analysis for a connected system. |
| **PROTECT** | Strict CSP with per-request nonces, HSTS preload, framing denied, COOP/CORP, Permissions-Policy; integer-cent arithmetic; human-only authorization; approvals bound to the state shown; idempotent execution; hard automation limits, allowlists and velocity caps; disclosure gate. | Identity (passkeys, MFA, sessions), key management, token vault, least-privilege access control — none exist because there is no backend. |
| **DETECT** | Tamper-evident hash-chained audit log; reconciliation raises exceptions; unreviewed execution failures and stale data are detected and pause automation; `screen()` flags injection probes as telemetry. | No SIEM, no alerting, no anomaly baselining across users. |
| **RESPOND** | Emergency stop halts all automation and cancels staged actions; resuming requires a person plus fresh re-authentication; every pause names its cause. | No incident response plan, no on-call, no breach notification process. |
| **RECOVER** | Deterministic engine with no persisted state to corrupt; reconciliation is the mechanism for restoring agreement with institutions. | No backups, no restore procedure, no RTO/RPO — nothing is persisted yet. |

The pattern is deliberate: PROTECT and DETECT are strong where the product
actually is (a deterministic decision core), and empty where the product does
not yet exist (identity, storage, operations). Claiming otherwise would be the
security theatre this document is meant to avoid.

## On "end-to-end encrypted"

This needs saying plainly, because the phrase is often sold and rarely true.

**End-to-end encryption means the service provider cannot read the data.** That
is incompatible with what Veyra is specified to do. The policy engine evaluates
your balances. The optimization engine reads your transactions. The B2B
decisioning layer (§40) is *sold* on the server reading financial state. An
aggregator such as Plaid sees the data before Veyra ever does. A product that
computes on your finances cannot also be blind to them, and any vendor claiming
both is describing something else.

What is achievable, and what serious fintechs actually mean:

| Layer | Mechanism | Provider can read? |
| --- | --- | --- |
| In transit | TLS 1.3, HSTS preload, mTLS to partners | No |
| At rest | Envelope encryption, per-tenant data keys in a KMS/HSM | Yes, with authorization |
| Institution tokens | Field-level encryption, dedicated vault, keys never at app tier | Only the token-exchange service |
| Client-held secrets | Encrypted client-side, key never sent | **No** — genuinely end-to-end |

Only the last row is E2EE, and it applies only to data Veyra never needs to
compute on — a user's private notes, for instance. Claiming it more broadly
would be false, and in a regulated context, false in a way regulators care
about. What should be promised instead: encrypted in transit and at rest,
per-tenant key isolation, institution tokens in a vault the application tier
cannot read, and an auditable record of every access.

## Before this touches real money

None of the following exists yet. All are prerequisites, not enhancements.

**Regulatory** — the largest gap, and no amount of engineering substitutes for
it. Personalized investment advice (strategy selection, allocations,
contribution plans) requires RIA registration. Moving money requires money
transmitter licensing or a licensed partner, plus Reg E liability for consumer
EFTs. GLBA and state privacy law attach the moment real financial data lands.

**Identity** — passkeys as the primary factor; step-up re-authentication wired
to the `REQUIRE_REAUTH` verdict the policy engine already emits; device binding;
session revocation.

**Key management** — envelope encryption with per-tenant data keys, automated
rotation, and no long-lived key material in application memory.

**Token vault** — institution access tokens isolated from the application tier,
reachable only through a narrow service with its own authorization and audit.

**Audit anchoring** — the hash chain in `lib/veyra/audit.mjs` is
tamper-*evident*. Anchoring the chain head to WORM storage or a notarization
service is what makes it tamper-*proof to a third party*.

**Detection** — the policy engine already emits structured decisions and the
risk engine emits scores. They need to reach a SIEM with alerting on
authorization failures, velocity anomalies, and repeated blocks.

**Assurance** — threat modelling per service, dependency and secret scanning in
CI, and independent penetration testing before any real balance is displayed.

## What is deliberately not claimed

- Nothing here "prevents hacking." No system does. These controls reduce
  attack surface and make compromise detectable; they do not make it
  impossible.
- The deployed URL is public. Repository visibility and deployment visibility
  are separate controls, and a private repo does not gate the site.
- No penetration test has been performed.
- `screen()` catches unsophisticated probes only, by design.

## Reporting

Security issues should go to the repository owner privately, not through public
issues.
