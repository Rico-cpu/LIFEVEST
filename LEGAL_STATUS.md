# Legal status — read before launching anything

**I am not a lawyer, and nothing here is legal advice.** This document exists
because the request that produced it was "make us lawsuit-proof and fully legal
in all 50 states," and the honest engineering answer to that request is that it
cannot be satisfied by writing documents. Getting it wrong here is far more
expensive than getting the code wrong.

## The core misconception

A Terms of Service page is not a compliance program.

The activities Veyra is designed to perform — recommending how someone should
invest, and moving their money — are **licensed activities**. Licensure is a
question of registration, capital, bonding, examination, and supervision. No
disclaimer creates it, and no wording avoids it. A well-drafted agreement
allocates risk *between you and your user*; it does nothing about a regulator,
who is not a party to it.

Worse, boilerplate actively increases risk in two specific ways:

1. **Describing activity you are not licensed for is evidence.** A Terms page
   that says Veyra "invests your money according to your strategy" is a written
   admission of unregistered activity.
2. **Misstating registration status is itself a violation**, independent of
   whatever else you were doing.

This is why the drafts in `lib/veyra/legal.mjs` are written in the negative —
what Veyra is *not*, what it does *not* do. Right now that is accurate, and
accuracy is the only real protection available.

## What triggers what

| Activity | What it triggers | Can a disclaimer avoid it? |
| --- | --- | --- |
| Personalized investment recommendations, allocations, contribution plans | Investment Advisers Act; SEC or state RIA registration | **No** |
| Executing securities trades | Broker-dealer registration, FINRA membership | **No** |
| Moving customer funds | State money transmitter licensing (~50 jurisdictions), surety bonds, minimum net worth, BSA/AML program | **No** |
| Holding customer funds | Custody rules; almost certainly a bank partner | **No** |
| Consumer electronic fund transfers | Reg E — error resolution, liability limits, disclosures | **No** |
| Handling consumer financial data | GLBA Safeguards Rule; state privacy law (CA, VA, CO, CT, UT, TX, and rising) | **No** |
| Aggregating accounts | CFPB §1033 open-banking rules; provider contractual terms | **No** |
| Marketing claims about returns or savings | UDAAP; FTC Act §5; state consumer protection | Partly — accuracy is the defence |

"All 50 states" is not a box to tick. Money transmission is licensed
state-by-state, each with its own application, bond, net-worth minimum, and
examination cycle. Firms budget millions and 18–24 months for full coverage, or
they don't do it themselves.

## The structural decision that actually matters

You do not have to become licensed to ship. You have to decide **who holds the
license for each regulated activity**, and architect so that is swappable:

- **Advice** → partner with an RIA, or stay strictly non-personalized
  (educational categories, no tailored recommendations), or register.
- **Money movement** → a licensed partner (Unit, Increase, Treasury Prime,
  Synapse-style BaaS) or a bank sponsor. Veyra orchestrates; the partner is the
  regulated actor.
- **Brokerage execution** → an executing broker-dealer via API.
- **Aggregation** → a provider such as Plaid, under their terms.

Under that model Veyra sells *decisioning and control software*. That is also
exactly the B2B business with the higher ceiling — which is the strategic point
made earlier in this project's history: the licensing burden pushes you toward
the better business.

## What the code already does that helps

These are genuine, and they are engineering rather than paperwork:

- **The product does not do the regulated things.** The executor is a stub.
  This is the single most protective fact today, and the `demonstration`
  disclosure states it on every consequential screen.
- **Versioned disclosure and consent** (`lib/veyra/disclosures.mjs`). You can
  prove *which exact text* was shown and acknowledged, at what version, by whom,
  when, and on what screen. Rewording invalidates prior consent automatically.
  This is the artifact that matters in a dispute.
- **A hard gate.** An action cannot reach `APPROVED` while a required disclosure
  is unacknowledged. Enforced in the engine and covered by tests.
- **Human-only authorization.** No automated actor can approve anything, at any
  permission level.
- **A tamper-evident audit trail** recording who authorized what, under which
  policy version, against which financial state.
- **No promises in the copy.** Projections are ranges labelled as estimates;
  readiness explicitly is not a credit score; savings figures say "estimated".
  A test asserts no disclosure text promises an outcome.

## What is missing, in priority order

1. **Counsel.** A fintech regulatory attorney, before anything connects. Not a
   general business lawyer, and not a template service.
2. **A decision on the licensing model** above — it determines the architecture.
3. **Entity and insurance.** Formation, E&O / tech E&O, cyber liability.
4. **Real documents** replacing these drafts: Terms, Privacy Notice, E-SIGN
   consent, Reg E disclosures if applicable, Form ADV if you register, partner
   flow-down terms.
5. **A written information security program** (GLBA Safeguards requires one),
   incident response, and vendor diligence.
6. **KYC/AML program** if money moves, with a designated compliance officer.
7. **Marketing review.** Every performance-adjacent claim, including the ones in
   the product UI.

## Rules for this repository

- Do not enable real money movement behind a feature flag "just to test."
- Do not add copy that implies advice, guaranteed outcomes, or registration.
- Do not remove the `demonstration` disclosure while the executor is a stub.
- Any change to disclosure text is a compliance change: it bumps the version and
  invalidates consent by design. Review it as such.
- If a future version connects real accounts, `demonstrationMode` must be set to
  `false` **and** the remaining disclosures reviewed by counsel first.
