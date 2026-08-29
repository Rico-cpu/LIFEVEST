# `lib/veyra` — the Veyra decision core

Pure, dependency-free ES modules implementing the parts of the Veyra blueprint
that can be built and proven today: the Financial Twin, the policy engine, the
risk engine, the authorization lifecycle, the audit chain, and the planning,
scenario, statement, and export layers.

No network. No I/O. No framework. Runs identically in Node and the browser, so
the same code can back an API route, a background job, and the UI.

```bash
npm test     # node --test, 90+ cases, no dependencies
```

## Modules

| Module | Blueprint | Responsibility |
| --- | --- | --- |
| `money.mjs` | — | Integer-cent primitives. Money is never a float. |
| `twin.mjs` | §11 | The Financial Twin: an immutable, fingerprinted snapshot. Net worth, liquidity, burn, projections, safe-to-deploy with a full arithmetic trace. |
| `policy.mjs` | §36 | The policy engine. 11 rules → `ALLOW` / `REQUIRE_APPROVAL` / `REQUIRE_REAUTH` / `BLOCK`. Pure and deterministic. |
| `risk.mjs` | §4 | Risk scoring and the friction ladder. |
| `authorization.mjs` | §5 | Levels 0–5. A level is a ceiling on what may be *prepared*, never on who may authorize. |
| `actions.mjs` | §2, §14 | The action lifecycle and its invariants. |
| `audit.mjs` | §32 | Hash-chained, tamper-evident audit log. |
| `events.mjs` | §34 | The event vocabulary and an isolating bus. |
| `recommend.mjs` | §15, §17 | Next Best Move. Every recommendation carries what / why / impact / risk / confidence / source. |
| `strategies.mjs` | §6–§8 | Strategy profiles, custom allocations, illustrative ranges, comparison. |
| `plans.mjs` | §9–§10 | Investment plans and plan health. |
| `scenarios.mjs` | §12 | The What-If engine. |
| `readiness.mjs` | §38 | Financial Readiness — five explainable dimensions, explicitly not a credit score. |
| `statements.mjs` | — | Monthly and annual statements, every line marked `observed` or `derived`. |
| `export.mjs` | — | CSV (RFC 4180) and multi-sheet SpreadsheetML workbooks. Zero dependencies. |
| `engine.mjs` | §45 | The orchestrator. One path to money movement, instrumented end to end. |

## The invariants

These are enforced in code and covered by `__tests__/authorization.test.mjs`.
They are the reason the core exists.

1. **Only a human authorizes.** `approve()` throws for any actor whose kind is
   not `user` — AI, automation, and the system itself included, at every
   authorization level.
2. **A blocked action cannot be approved.** Not by anyone, by any route.
3. **An approval is bound to what the human saw.** It commits to the twin
   fingerprint *and* the constitution version. If either moves before
   execution, the approval is void and the action returns for re-approval.
4. **Approvals expire**, and `REQUIRE_REAUTH` needs a re-authentication no more
   than two minutes old.
5. **Execution is idempotent.** A settled idempotency key replays its original
   result instead of moving money twice.
6. **State cannot be skipped.** Illegal transitions throw rather than degrade.
7. **The engine never executes.** It calls an injected executor; it has no
   knowledge of any bank.

## Design decisions worth knowing

- **Cash floor ≠ emergency reserve.** The blueprint conflates them; subtracting
  both from the same pool double-counts. The reserve is earmarked cash held for
  a named goal; the floor is a minimum left in the account money leaves from.
- **Authorization projections exclude expected income.** A floor exists to
  survive the paycheck not arriving. Crediting unearned income into the check
  that guards it would defeat it. Planning views may opt in.
- **Recommendations hold back a margin.** Safe-to-deploy contains an estimated
  spend rate, so recommending all of it would land the user exactly on their
  floor with nothing absorbing the estimation error.
- **No projection is ever a point estimate.** Ranges only, with the assumptions
  stated and dispersion narrowing as `σ/√T` in the rate while widening in the
  outcome. Both are true and a product that shows only the first is lying by
  omission.
- **Every statement line declares its basis.** `observed` came from a balance;
  `derived` was computed from a rate. Required on every row.
