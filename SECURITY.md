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

### Authorization invariants

`lib/veyra/actions.mjs`, covered by `__tests__/authorization.test.mjs`:
only a human can approve; approvals bind to the twin fingerprint and
constitution version and are void if either moves; approvals expire;
re-authentication must be fresh; execution is idempotent; illegal state
transitions throw. See `lib/veyra/README.md`.

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
