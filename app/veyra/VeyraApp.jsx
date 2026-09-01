'use client';

/**
 * VEYRA — the financial operating system, as a working interface over the
 * engine in lib/veyra.
 *
 * Nothing on this screen is decorative. Every figure is produced by the engine
 * and reconstructible line by line; every consequential control routes through
 * propose → policy → risk → human approval → execute → audit. There is no
 * second path.
 */

import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import './veyra.css';
import { Veyra } from '../../lib/veyra/engine.mjs';
import { VERDICT, sealConstitution } from '../../lib/veyra/policy.mjs';
import { STATE } from '../../lib/veyra/actions.mjs';
import { LEVEL, LEVEL_META } from '../../lib/veyra/authorization.mjs';
import { demoTwin, demoConstitution, demoContext, demoPlan, demoAutopilot, constitutionLines } from '../../lib/veyra/fixtures.mjs';
import { fmt } from '../../lib/veyra/money.mjs';
import { monthlyNetCashFlowCents, account } from '../../lib/veyra/twin.mjs';
import { planHealth, planProjection, PLAN_HEALTH } from '../../lib/veyra/plans.mjs';
import { compare } from '../../lib/veyra/strategies.mjs';
import { run, increaseInvesting, majorPurchase, incomeChange } from '../../lib/veyra/scenarios.mjs';
import { buildStatement } from '../../lib/veyra/statements.mjs';
import { ACTIVATION_ACKNOWLEDGEMENTS, MODE, MODE_META } from '../../lib/veyra/autopilot.mjs';
import { statementRows, statementSheets, toCSV, toWorkbookXML, filenameFor, download, MIME } from '../../lib/veyra/export.mjs';

const HUMAN = { kind: 'user', id: 'u_demo' };
const ASSISTANT = { kind: 'ai', id: 'assistant' };

/**
 * Nav icons. Inline stroke SVGs rather than an icon package: six glyphs do not
 * justify a dependency, and drawing them here keeps weight and stroke matched
 * to the type.
 */
const Icon = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
  plan: 'M3 19h18M6 19v-7M11 19V8M16 19v-4M21 19V5',
  explore: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15.5 8.5l-2 5-5 2 2-5 5-2Z',
  statements: 'M6 3h8l4 4v14H6V3ZM14 3v4h4M9 12h6M9 16h6',
  rules: 'M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6l7-3Z',
  activity: 'M3 12h4l3 7 4-16 3 9h4',
};

/**
 * Veyra mark: three streams converging into one. Flow, direction and
 * consolidation — which is the product's actual promise — without reaching for
 * a dollar sign, a coin, or a rising chart. Legible down to 16px.
 */
function Mark({ size = 18 }) {
  return (
    <svg className="vy-mark" viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M3 6.2c6.2 0 5.2 5.8 10.4 5.8" />
      <path d="M3 12h10.4" />
      <path d="M3 17.8c6.2 0 5.2-5.8 10.4-5.8" />
      <circle cx="18.4" cy="12" r="2.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function NavIcon({ name }) {
  return (
    <svg className="vy-nav-icon" viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={Icon[name]} />
    </svg>
  );
}

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'plan', label: 'Plan' },
  { id: 'explore', label: 'Explore' },
  { id: 'statements', label: 'Statements' },
  { id: 'rules', label: 'Rules' },
  { id: 'activity', label: 'Activity' },
];

export default function VeyraPage() {
  const engineRef = useRef(null);
  const [, rerender] = useReducer((n) => n + 1, 0);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('home');
  const [review, setReview] = useState(null); // { actionId, step }

  useEffect(() => {
    // Constructed on the client so timestamps never differ between the server
    // render and the hydrated one.
    engineRef.current = new Veyra({
      twin: demoTwin,
      constitution: demoConstitution,
      context: demoContext,
      authorizationLevel: LEVEL.APPROVE_EACH,
      autopilot: demoAutopilot,
    });
    setReady(true);
  }, []);

  const v = engineRef.current;
  if (!ready || !v) {
    return (
      <div className="vy">
          <div className="vy-layout">
          <main className="vy-shell">
            <p className="vy-greeting vy-boot">Understanding your financial picture…</p>
          </main>
        </div>
      </div>
    );
  }

  const snap = v.snapshot();
  const recs = v.recommendations();
  const record = review ? v.actions.get(review.actionId) : null;

  async function openReview(rec) {
    const existing = v.actions.get(rec.action.id);
    if (!existing) await v.propose(rec.action, ASSISTANT);
    setReview({ actionId: rec.action.id, step: 'review' });
    rerender();
  }

  async function proposeDirect(action, by = HUMAN) {
    if (!v.actions.get(action.id)) await v.propose(action, by);
    setReview({ actionId: action.id, step: 'review' });
    rerender();
  }

  async function enableAutopilot(ackIds) {
    await v.enableAutopilot(ackIds, HUMAN, MODE.GUARDED);
    rerender();
  }
  async function disableAutopilot() {
    await v.disableAutopilot(HUMAN);
    rerender();
  }
  async function emergencyStop() {
    await v.engageEmergencyStop(HUMAN, 'stopped from the control centre');
    rerender();
  }
  async function resumeAutomation() {
    await v.resumeAutomation(HUMAN, { reauthenticatedAt: Date.now() });
    rerender();
  }

  async function acknowledge(disclosureId) {
    await v.acknowledge(disclosureId, HUMAN, 'approval-card');
    rerender();
  }

  async function confirmApproval() {
    const rec = v.actions.get(review.actionId);
    const opts = rec.decision.verdict === VERDICT.REQUIRE_REAUTH ? { reauthenticatedAt: Date.now() } : {};
    await v.approve(review.actionId, HUMAN, opts);
    await v.execute(review.actionId);
    setReview({ ...review, step: 'done' });
    rerender();
  }

  async function declineAction() {
    await v.reject(review.actionId, HUMAN);
    setReview(null);
    rerender();
  }

  async function setConstitution(patch) {
    await v.updateConstitution(sealConstitution({ ...v.constitution, ...patch }), HUMAN);
    rerender();
  }

  return (
    <div className="vy">

      <header className="vy-topbar">
        <div className="vy-topbar-in">
          <span className="vy-wordmark"><Mark /> Veyra</span>
          <span className="vy-chip" title={LEVEL_META[v.authorizationLevel].summary}>
            {LEVEL_META[v.authorizationLevel].name}
          </span>
        </div>
      </header>

      <div className="vy-layout">
        {/* One nav: a sidebar beside the content on desktop, a bottom bar on
            mobile. Same markup and the same accessibility tree in both. */}
        <nav className="vy-nav" aria-label="Primary">
          {TABS.map((t) => (
            <button
              key={t.id}
              className="vy-nav-item"
              aria-current={tab === t.id}
              onClick={() => { setTab(t.id); window.scrollTo({ top: 0 }); }}
            >
              <NavIcon name={t.id} />
              <span className="vy-nav-label">{t.label}</span>
            </button>
          ))}
        </nav>

        <main className="vy-shell">
        <p className="vy-sim">
          <strong>Demonstration.</strong>
          <span>No institution is connected and no money can move.</span>
        </p>

        {tab === 'home' && <Home v={v} snap={snap} recs={recs} onReview={openReview} />}
        {tab === 'plan' && <Plan v={v} />}
        {tab === 'explore' && <Explore v={v} />}
        {tab === 'statements' && <Statements v={v} />}
        {tab === 'rules' && (
          <Rules
            v={v}
            onChange={setConstitution}
            onPropose={proposeDirect}
            autopilot={{ enable: enableAutopilot, disable: disableAutopilot, stop: emergencyStop, resume: resumeAutomation }}
          />
        )}
        {tab === 'activity' && <Activity v={v} />}

        <footer className="vy-foot">
          <p style={{ margin: '0 0 8px' }}>
            <a href="/legal">Terms, privacy &amp; disclosures</a> · Veyra is a demonstration.
            It is not a bank, broker-dealer, or registered investment adviser, gives no
            investment advice, and cannot move money.
          </p>
          Twin <code>{snap.twinVersion}</code> · Constitution <code>{snap.constitutionVersion}</code>.
          Every figure above is computed by <code>lib/veyra</code> and covered by its test suite.
          </footer>
        </main>
      </div>

      {record && (
        <ApprovalModal
          record={record}
          step={review.step}
          twin={v.twin}
          disclosures={v.disclosuresFor(record.action)}
          onAcknowledge={acknowledge}
          onAdvance={() => setReview({ ...review, step: 'confirm' })}
          onConfirm={confirmApproval}
          onDecline={declineAction}
          onClose={() => { setReview(null); rerender(); }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- §17 Home */

function Home({ v, snap, recs, onReview }) {
  const [showWhy, setShowWhy] = useState(false);
  const monthly = monthlyNetCashFlowCents(v.twin);
  const health = planHealth(demoPlan, v.twin, v.constitution);
  const blocked = [...v.actions.values()].filter((r) => r.state === STATE.BLOCKED);
  const [primary, ...rest] = recs;

  return (
    <>
      <p className="vy-greeting">Good afternoon</p>
      <h1 className="vy-headline">
        {health.status === PLAN_HEALTH.ON_TRACK && blocked.length === 0
          ? 'Your financial system is running smoothly.'
          : 'A few things need your attention.'}
      </h1>

      {/* The one number that answers "how am I doing?". It gets the page, not a tile. */}
      <section className="vy-hero">
        <div className="vy-hero-label">Net worth</div>
        <div className="vy-hero-value">{fmt(snap.netWorthCents, { cents: false })}</div>
        <div className="vy-hero-sub">
          <span className={monthly >= 0 ? 'vy-pos' : ''}>
            {fmt(monthly, { sign: monthly >= 0, cents: false })}
          </span>{' '}
          projected monthly net
        </div>
      </section>

      <div className="vy-card">
        <div className="vy-spread">
          <div>
            <div className="vy-card-label" style={{ marginBottom: 6 }}>Safe to deploy</div>
            <div className="vy-figure">{fmt(snap.safeToDeploy.amountCents, { cents: false })}</div>
          </div>
          <button className="vy-link" onClick={() => setShowWhy((x) => !x)} aria-expanded={showWhy}>
            {showWhy ? 'Hide' : 'Why?'}
          </button>
        </div>

        {showWhy && (
          <div className="vy-trace">
            {snap.safeToDeploy.trace.map((line) => (
              <div className="vy-trace-row" key={line.label}>
                <span>
                  {line.label}
                  <span className="vy-trace-src">{line.source}</span>
                </span>
                <span className="vy-trace-num">{fmt(line.amountCents, { cents: false })}</span>
              </div>
            ))}
            <div className="vy-trace-total">
              <span>Safe to deploy</span>
              <span className="vy-trace-num">{fmt(snap.safeToDeploy.amountCents, { cents: false })}</span>
            </div>
          </div>
        )}
      </div>

      {/* One recommendation gets the emphasis. Anything else is a quiet list. */}
      {primary ? (
        <div className="vy-card vy-primary-card">
          <div className="vy-card-label">Next best move</div>
          <div style={{ fontSize: 'var(--t-body)', fontWeight: 540, marginBottom: 4 }}>{primary.what}</div>
          <div className="vy-sub" style={{ marginBottom: 16 }}>{primary.impact}</div>
          <button className="vy-btn vy-btn-primary" onClick={() => onReview(primary)}>Review</button>
        </div>
      ) : (
        <div className="vy-card">
          <div className="vy-card-label">Next best move</div>
          <p className="vy-sub" style={{ margin: 0 }}>
            Nothing to do right now. Veyra will tell you when that changes.
          </p>
        </div>
      )}

      {rest.length > 0 && (
        <div className="vy-card">
          <div className="vy-card-label">Also worth considering</div>
          {rest.map((r) => (
            <div className="vy-item" key={r.id}>
              <span>
                <span className="vy-item-title">{r.what}</span>
                <span className="vy-item-sub">{r.impact}</span>
              </span>
              <button className="vy-btn" onClick={() => onReview(r)}>Review</button>
            </div>
          ))}
        </div>
      )}

      <div className="vy-card">
        <div className="vy-card-label">Autopilot</div>
        <div className="vy-item">
          <span>
            <span className="vy-item-title">{demoPlan.name}</span>
            <span className="vy-item-sub">{health.detail}</span>
          </span>
          <span className="vy-status">
            <span className={`vy-dot ${health.status === PLAN_HEALTH.ON_TRACK ? 'vy-dot-ok' : health.status === PLAN_HEALTH.PAUSED ? 'vy-dot-idle' : 'vy-dot-review'}`} />
            {health.headline}
          </span>
        </div>
        <div className="vy-item">
          <span>
            <span className="vy-item-title">Emergency reserve</span>
            <span className="vy-item-sub">
              {snap.reserve.monthsFunded.toFixed(1)} of {v.constitution.reserveMonths} months of essential expenses
            </span>
          </span>
          <span className="vy-status">
            <span className={`vy-dot ${snap.reserve.fullyFunded ? 'vy-dot-ok' : 'vy-dot-review'}`} />
            {snap.reserve.fullyFunded ? 'Funded' : 'Below target'}
          </span>
        </div>
      </div>

      <Goals goals={v.twin.goals} />
      <Readiness readiness={snap.readiness} />
    </>
  );
}

function Goals({ goals }) {
  if (!goals?.length) return null;
  return (
    <div className="vy-card">
      <div className="vy-card-label">Goals</div>
      {goals.map((g) => {
        const pct = Math.min(100, Math.round((g.currentCents / Math.max(g.targetCents, 1)) * 100));
        return (
          <div className="vy-goal" key={g.id}>
            <div className="vy-goal-head">
              <span className="vy-item-title">{g.name}</span>
              <span className="vy-metric">{pct}%</span>
            </div>
            <div className="vy-meter"><div className="vy-meter-fill" style={{ width: `${pct}%` }} /></div>
            <div className="vy-item-sub" style={{ marginTop: 6 }}>
              {fmt(g.currentCents, { cents: false })} of {fmt(g.targetCents, { cents: false })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- §38 Score */

function Readiness({ readiness }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="vy-card">
      <div className="vy-spread">
        <div>
          <div className="vy-card-label" style={{ marginBottom: 6 }}>Financial readiness</div>
          <div className="vy-figure-sm">{readiness.overall}</div>
        </div>
        <button className="vy-link" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
          {open ? 'Hide' : 'Breakdown'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 18 }}>
          {readiness.dimensions.map((d) => (
            <div key={d.id} style={{ marginBottom: 14 }}>
              <div className="vy-spread" style={{ marginBottom: 5 }}>
                <span style={{ fontSize: 'var(--t-small)' }}>{d.label}</span>
                <span className="vy-metric" style={{ fontSize: 'var(--t-small)' }}>{d.score}</span>
              </div>
              <div className="vy-meter"><div className="vy-meter-fill" style={{ width: `${d.score}%` }} /></div>
              <div className="vy-item-sub" style={{ marginTop: 5 }}>{d.explanation}</div>
            </div>
          ))}
          <p className="vy-sub" style={{ fontSize: 'var(--t-micro)' }}>{readiness.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------- §8–§10 Plan + compare */

function Plan({ v }) {
  const health = planHealth(demoPlan, v.twin, v.constitution);
  const years = 30;
  const rows = useMemo(
    () => compare(['conservative', 'balanced', 'growth', 'aggressive'], {
      initialCents: account(v.twin, demoPlan.accountId).balanceCents,
      monthlyCents: demoPlan.monthlyContributionCents,
      years,
    }),
    [v.twin]
  );
  const projection = planProjection(demoPlan, account(v.twin, demoPlan.accountId).balanceCents, years);

  return (
    <>
      <p className="vy-greeting">Investment plan</p>
      <h1 className="vy-headline">{demoPlan.name}</h1>

      <div className="vy-card">
        <div className="vy-spread">
          <span className="vy-status">
            <span className={`vy-dot ${health.status === PLAN_HEALTH.ON_TRACK ? 'vy-dot-ok' : health.status === PLAN_HEALTH.PAUSED ? 'vy-dot-idle' : 'vy-dot-review'}`} />
            {health.headline}
          </span>
        </div>
        <p className="vy-sub" style={{ marginTop: 8 }}>{health.detail}</p>
        <dl className="vy-kv">
          <dt>Strategy</dt><dd>Growth — 55% US equity, 25% international, 10% bonds, 10% other</dd>
          <dt>Contribution</dt><dd>{fmt(demoPlan.monthlyContributionCents, { cents: false })} monthly</dd>
          <dt>Funding source</dt><dd>{account(v.twin, demoPlan.fundingAccountId).name}</dd>
          <dt>Cash floor</dt><dd>{fmt(demoPlan.cashFloorCents, { cents: false })}</dd>
          <dt>Rebalancing</dt><dd>Annual</dd>
          <dt>Distributions</dt><dd>Reinvest</dd>
        </dl>
      </div>

      <div className="vy-card">
        <div className="vy-card-label">Illustrative range over {years} years</div>
        <div className="vy-spread" style={{ alignItems: 'flex-end' }}>
          <div><div className="vy-sub">Lower</div><div className="vy-figure-sm">{fmt(projection.lowCents, { cents: false })}</div></div>
          <div style={{ textAlign: 'center' }}><div className="vy-sub">Central</div><div className="vy-figure-sm">{fmt(projection.midCents, { cents: false })}</div></div>
          <div style={{ textAlign: 'right' }}><div className="vy-sub">Higher</div><div className="vy-figure-sm">{fmt(projection.highCents, { cents: false })}</div></div>
        </div>
        <p className="vy-sub" style={{ marginTop: 14, fontSize: 12 }}>
          {projection.basis} Contributions total {fmt(projection.contributedCents, { cents: false })} over the period.
          Investments can lose value; past performance does not guarantee future results.
        </p>
      </div>

      <div className="vy-card">
        <div className="vy-card-label">Compare strategies</div>
        <div className="vy-scroll">
          <table className="vy-table">
            <thead>
              <tr><th>Strategy</th><th>Risk</th><th>Lower</th><th>Central</th><th>Higher</th></tr>
            </thead>
            <tbody>
              {rows.map(({ strategy, range }) => (
                <tr key={strategy.id}>
                  <td>{strategy.name}</td>
                  <td style={{ textTransform: 'capitalize' }}>{strategy.riskLevel}</td>
                  <td>{fmt(range.lowCents, { cents: false })}</td>
                  <td>{fmt(range.midCents, { cents: false })}</td>
                  <td>{fmt(range.highCents, { cents: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="vy-sub" style={{ marginTop: 12, fontSize: 12 }}>
          Ranges are modelled from stated assumptions on the same contribution plan, in today’s dollars.
          They are not forecasts, and no strategy is recommended here.
        </p>
      </div>
    </>
  );
}

/* ------------------------------------------------------- §12 What-If engine */

const SCENARIOS = [
  { id: 'invest_more', label: 'Invest $500 more each month', make: () => increaseInvesting(50000) },
  { id: 'car', label: 'Buy a $50,000 car', make: () => majorPurchase(5000000, 'chase_checking', 'Car') },
  { id: 'raise', label: 'Salary increases 10%', make: () => incomeChange(10) },
  { id: 'cut', label: 'Income drops 20%', make: () => incomeChange(-20) },
];

function Explore({ v }) {
  const [active, setActive] = useState('invest_more');
  const result = useMemo(() => {
    const s = SCENARIOS.find((x) => x.id === active);
    return run(s.make(), v.twin, v.constitution);
  }, [active, v.twin, v.constitution]);

  return (
    <>
      <p className="vy-greeting">What if</p>
      <h1 className="vy-headline">Test a decision before you make it.</h1>

      <div className="vy-card">
        <div className="vy-card-label">Scenario</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              className={`vy-btn${active === s.id ? ' vy-btn-primary' : ''}`}
              style={{ fontSize: 13 }}
              onClick={() => setActive(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="vy-card">
        <div className="vy-card-label">{result.scenario.label}</div>
        <div className="vy-scroll">
          <table className="vy-table">
            <thead><tr><th>Measure</th><th>Now</th><th>After</th><th>Change</th></tr></thead>
            <tbody>
              <Row label="Net worth" a={result.before.netWorthCents} b={result.after.netWorthCents} d={result.deltas.netWorthCents} />
              <Row label="Liquid cash" a={result.before.liquidCents} b={result.after.liquidCents} d={result.deltas.liquidCents} />
              <Row label="Safe to deploy" a={result.before.safeToDeployCents} b={result.after.safeToDeployCents} d={result.deltas.safeToDeployCents} />
              <Row label="Monthly net" a={result.before.monthlyNetCents} b={result.after.monthlyNetCents} d={result.deltas.monthlyNetCents} />
            </tbody>
          </table>
        </div>
        <dl className="vy-kv" style={{ marginTop: 6 }}>
          <dt>Liquidity</dt><dd>{result.qualitative.liquidity}</dd>
          <dt>Emergency reserve</dt><dd>{result.qualitative.emergencyReserve}</dd>
          <dt>Risk</dt><dd>{result.qualitative.risk}</dd>
        </dl>
        <p className="vy-sub" style={{ fontSize: 12 }}>
          Scenarios are computed against a copy of your financial twin. Nothing here changes your accounts or your plans.
        </p>
      </div>
    </>
  );
}

function Row({ label, a, b, d }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{fmt(a, { cents: false })}</td>
      <td>{fmt(b, { cents: false })}</td>
      <td style={{ color: d === 0 ? 'var(--ink-3)' : d > 0 ? 'var(--positive)' : 'var(--risk)' }}>
        {d === 0 ? '—' : fmt(d, { sign: d > 0, cents: false })}
      </td>
    </tr>
  );
}

/* ------------------------------------- Statements: monthly, annual, exports */

const STANDING_STYLE = { historical: 'vy-notice-review', current: 'vy-notice-info', projected: 'vy-notice-review' };

function Statements({ v }) {
  const [kind, setKind] = useState('monthly');
  const [month, setMonth] = useState(v.twin.asOf.slice(0, 7));
  const [year, setYear] = useState(Number(v.twin.asOf.slice(0, 4)));

  const anchor = kind === 'monthly' ? `${month}-15T12:00:00Z` : `${year}-06-15T12:00:00Z`;
  const statement = useMemo(
    () => buildStatement(v.twin, v.constitution, { kind, asOf: anchor }),
    [v.twin, v.constitution, kind, anchor]
  );

  const saveCSV = () => download(filenameFor(statement, 'csv'), toCSV(statementRows(statement)), MIME.csv);
  const saveWorkbook = () => download(filenameFor(statement, 'xls'), toWorkbookXML(statementSheets(statement)), MIME.xls);

  return (
    <>
      <p className="vy-greeting">Statements</p>
      <h1 className="vy-headline">{statement.periodLabel}</h1>

      <div className="vy-card">
        <div className="vy-card-label">Period</div>
        <div className="vy-row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <button className={`vy-btn${kind === 'monthly' ? ' vy-btn-primary' : ''}`} onClick={() => setKind('monthly')}>Monthly</button>
          <button className={`vy-btn${kind === 'annual' ? ' vy-btn-primary' : ''}`} onClick={() => setKind('annual')}>Yearly</button>
          {kind === 'monthly' ? (
            <input className="vy-input" style={{ width: 170 }} type="month" value={month} onChange={(e) => setMonth(e.target.value || month)} aria-label="Statement month" />
          ) : (
            <input className="vy-input" style={{ width: 110 }} type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value) || year)} aria-label="Statement year" />
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button className="vy-btn" onClick={saveCSV}>Download CSV</button>
            <button className="vy-btn vy-btn-primary" onClick={saveWorkbook}>Download spreadsheet</button>
          </span>
        </div>
        <p className="vy-sub" style={{ fontSize: 12, marginTop: 12 }}>
          The spreadsheet is a multi-sheet Excel workbook — one sheet per section, amounts as numbers so they sum.
          CSV is a single flat sheet that opens anywhere. Both are generated on your device; nothing is uploaded.
        </p>
      </div>

      <div className={`vy-notice ${STANDING_STYLE[statement.standing]}`}>
        <div className="vy-notice-title">
          {statement.standing === 'historical' ? 'Reconstructed period' : statement.standing === 'projected' ? 'Projected period' : 'Period in progress'}
        </div>
        {statement.standingNote}
      </div>

      {statement.sections.map((section) => (
        <div className="vy-card" key={section.id}>
          <div className="vy-card-label">{section.title}</div>
          <div className="vy-scroll">
            <table className="vy-table">
              <thead><tr><th>Line</th><th style={{ textAlign: 'right' }}>Amount</th><th>Basis</th></tr></thead>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row.label}>
                    <td>
                      {row.label}
                      {row.note && <span className="vy-trace-src">{row.note}</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(row.amountCents)}</td>
                    <td style={{ color: row.basis === 'observed' ? 'var(--positive)' : 'var(--ink-3)', fontSize: 12 }}>{row.basis}</td>
                  </tr>
                ))}
                {section.totalCents !== undefined && (
                  <tr>
                    <td style={{ fontWeight: 600 }}>{section.totalLabel}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{fmt(section.totalCents)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <p className="vy-sub" style={{ fontSize: 12 }}>{statement.basisNote}</p>
    </>
  );
}

/* ------------------------------------- Autopilot control centre (§45, §46) */

function Autopilot({ v, controls }) {
  const status = v.autopilotStatus();
  const [acks, setAcks] = useState([]);
  const { policy, pause, usage, emergencyStopEngaged } = status;
  const meta = MODE_META.find((m) => m.mode === policy.mode);
  const ready = ACTIVATION_ACKNOWLEDGEMENTS.every((a) => acks.includes(a.id));

  const toggle = (id) => setAcks((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="vy-card">
      <div className="vy-spread" style={{ marginBottom: 14 }}>
        <div className="vy-card-label" style={{ margin: 0 }}>Autopilot</div>
        <span className="vy-status">
          <span className={`vy-dot ${pause.canRun ? 'vy-dot-ok' : emergencyStopEngaged ? 'vy-dot-risk' : 'vy-dot-review'}`} />
          {pause.canRun ? 'Active' : emergencyStopEngaged ? 'Stopped' : 'Paused'}
        </span>
      </div>

      <div className="vy-item-sub" style={{ marginBottom: 12 }}>{meta?.name} — {meta?.summary}</div>

      {/* Never leave a pause unexplained. Each reason names itself. */}
      {pause.paused && (
        <div className={`vy-notice ${emergencyStopEngaged ? 'vy-notice-risk' : 'vy-notice-review'}`}>
          <div className="vy-notice-title">
            {emergencyStopEngaged ? 'All automation stopped' : 'Autopilot paused'}
          </div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {pause.reasons.map((r) => <li key={r.code} style={{ marginTop: 3 }}>{r.detail}</li>)}
          </ul>
          <div style={{ marginTop: 8 }}>No automated action will run while this is true.</div>
        </div>
      )}

      {policy.enabled && (
        <>
          <dl className="vy-kv">
            <dt>Per action</dt><dd>{fmt(policy.maxPerActionCents, { cents: false })}</dd>
            <dt>Per day</dt><dd>{fmt(usage.executedTodayCents, { cents: false })} of {fmt(policy.maxPerDayCents, { cents: false })}</dd>
            <dt>Per month</dt><dd>{fmt(usage.executedThisMonthCents, { cents: false })} of {fmt(policy.maxPerMonthCents, { cents: false })}</dd>
            <dt>Actions today</dt><dd>{usage.actionsToday} of {policy.maxActionsPerDay}</dd>
            <dt>Allowed</dt><dd>{policy.allowedActionKinds.join(', ').replace(/_/g, ' ')}</dd>
            <dt>Destinations</dt><dd>{policy.allowedDestinations.map((id) => safeName(v.twin, id)).join(', ') || 'none'}</dd>
          </dl>
          <div className="vy-row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <button className="vy-btn" onClick={controls.disable}>Disable Autopilot</button>
            {emergencyStopEngaged ? (
              <button className="vy-btn vy-btn-primary" onClick={controls.resume}>Resume automation</button>
            ) : (
              <button className="vy-btn vy-btn-risk" onClick={controls.stop}>Pause all automation</button>
            )}
          </div>
        </>
      )}

      {!policy.enabled && (
        <>
          <div className="vy-notice vy-notice-review">
            <div className="vy-notice-title">Automated financial actions involve risk</div>
            Veyra&rsquo;s calculations, account data, institution availability and transaction
            timing may contain errors, delays or outages. Automated actions can result in
            unintended transfers, missed opportunities, investment losses, fees, tax
            consequences or overdrafts. Investment values can decline, including loss of
            principal. No automated strategy guarantees a profit or prevents loss.
          </div>

          {ACTIVATION_ACKNOWLEDGEMENTS.map((a) => (
            <div className="vy-ack" key={a.id}>
              <label className="vy-ack-row">
                <input type="checkbox" checked={acks.includes(a.id)} onChange={() => toggle(a.id)} />
                <span>{a.text}</span>
              </label>
            </div>
          ))}

          <button
            className="vy-btn vy-btn-primary"
            style={{ marginTop: 14 }}
            disabled={!ready}
            title={ready ? undefined : 'Acknowledge each item to continue'}
            onClick={() => controls.enable(acks)}
          >
            Enable Guarded Autopilot
          </button>
          <p className="vy-sub" style={{ fontSize: 'var(--t-micro)' }}>
            Full Autopilot is off by default and is never enabled for you. Guarded Autopilot
            acts only inside the limits above, and pauses itself whenever anything is uncertain.
          </p>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------- §37 The Financial Constitution */

function Rules({ v, onChange, onPropose, autopilot }) {
  const c = v.constitution;
  const pending = [...v.actions.values()].filter((r) => r.state !== STATE.EXECUTED && r.state !== STATE.REJECTED);

  return (
    <>
      <p className="vy-greeting">Rules &amp; autopilot</p>
      <h1 className="vy-headline">Veyra operates strictly inside these rules.</h1>

      <Autopilot v={v} controls={autopilot} />

      <div className="vy-card">
        <div className="vy-card-label">In your words</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {constitutionLines(c).map((line) => (
            <li key={line} style={{ margin: '6px 0', fontSize: 14 }}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="vy-card">
        <div className="vy-card-label">Adjust</div>

        <div className="vy-field">
          <label htmlFor="floor">Cash floor — {fmt(c.cashFloorCents, { cents: false })}</label>
          <input
            id="floor" className="vy-range" type="range" min={0} max={1000000} step={25000}
            value={c.cashFloorCents}
            onChange={(e) => onChange({ cashFloorCents: Number(e.target.value) })}
          />
        </div>

        <div className="vy-field">
          <label htmlFor="reserve">Emergency reserve — {c.reserveMonths} months of essential expenses</label>
          <input
            id="reserve" className="vy-range" type="range" min={0} max={12} step={1}
            value={c.reserveMonths}
            onChange={(e) => onChange({ reserveMonths: Number(e.target.value) })}
          />
        </div>

        <div className="vy-field">
          <label htmlFor="reauth">Re-authenticate above — {fmt(c.reauthAboveCents, { cents: false })}</label>
          <input
            id="reauth" className="vy-range" type="range" min={25000} max={1000000} step={25000}
            value={c.reauthAboveCents}
            onChange={(e) => onChange({ reauthAboveCents: Number(e.target.value) })}
          />
        </div>

        <p className="vy-sub" style={{ fontSize: 12 }}>
          Changing a rule immediately re-evaluates every outstanding action and voids approvals
          taken under the old rules. Safe to deploy is now{' '}
          <strong>{fmt(v.snapshot().safeToDeploy.amountCents, { cents: false })}</strong>.
        </p>
      </div>

      {pending.length > 0 && (
        <div className="vy-card">
          <div className="vy-card-label">Outstanding actions under these rules</div>
          {pending.map((r) => (
            <div className="vy-rule" key={r.action.id}>
              <span className={`vy-dot ${r.state === STATE.BLOCKED ? 'vy-dot-risk' : 'vy-dot-review'}`} style={{ marginTop: 6 }} />
              <span>
                <span className="vy-rule-name">{fmt(r.action.amountCents, { cents: false })} · {r.action.kind.replace('_', ' ')}</span>
                <span className="vy-rule-reason">{r.state} — {r.decision.determining[0]?.reason ?? 'within policy'}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="vy-card">
        <div className="vy-card-label">Protections</div>
        <div className="vy-spread">
          <div>
            <div style={{ fontWeight: 500 }}>Emergency reserve protection</div>
            <div className="vy-sub">Prevents automated actions from drawing down your reserve.</div>
          </div>
          <button
            className="vy-btn"
            onClick={() =>
              onPropose({
                id: 'act_disable_reserve',
                kind: 'policy_change',
                amountCents: 0,
                origin: 'user',
                weakensProtection: true,
                rationale: 'Disable emergency reserve protection',
              })
            }
          >
            Disable
          </button>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------ §32 The audit trail */

function Activity({ v }) {
  const [verified, setVerified] = useState(null);
  const records = [...v.audit.records].reverse();

  return (
    <>
      <p className="vy-greeting">Activity</p>
      <h1 className="vy-headline">Every decision, in order, with its reason.</h1>

      <div className="vy-card">
        <div className="vy-spread">
          <div className="vy-card-label" style={{ margin: 0 }}>Hash-chained audit log · {v.audit.records.length} records</div>
          <button className="vy-btn" onClick={async () => setVerified(await v.audit.verify())}>Verify chain</button>
        </div>
        {verified && (
          <p className="vy-sub" style={{ marginTop: 10, color: verified.valid ? 'var(--positive)' : 'var(--risk)' }}>
            {verified.valid ? 'Chain intact — no record has been altered or removed.' : `Chain broken at record ${verified.brokeAt}.`}
          </p>
        )}
      </div>

      <div className="vy-card vy-log">
        {records.length === 0 && <p className="vy-sub">No activity yet.</p>}
        {records.map((r) => (
          <div className="vy-log-row" key={r.hash}>
            <div className="vy-spread">
              <strong>{r.event}</strong>
              <span className="vy-hash">#{r.seq}</span>
            </div>
            <div>
              {r.actorKind}:{r.actorId}
              {r.amountCents != null && ` · ${fmt(r.amountCents)}`}
              {r.verdict && ` · ${r.verdict}`}
              {r.riskScore != null && ` · risk ${r.riskScore}`}
            </div>
            <div className="vy-hash">{r.reason}</div>
            <div className="vy-hash">{r.hash.slice(0, 32)}…</div>
          </div>
        ))}
      </div>
    </>
  );
}

/* -------------------------------------------- §3 approval card, §4 friction */

/**
 * §4 — friction proportional to risk. The copy names the specific reason the
 * step exists, taken from the rules that actually determined the verdict. A
 * generic "this may be risky" teaches users to click through.
 */
const FRICTION_COPY = {
  info: { cls: 'vy-notice-info', title: 'Review' },
  caution: { cls: 'vy-notice-info', title: 'Review carefully' },
  warning: { cls: 'vy-notice-review', title: 'Important' },
  final_confirmation: { cls: 'vy-notice-risk', title: 'Final confirmation' },
};

function frictionBody(record) {
  if (record.action.weakensProtection) {
    return 'You are about to remove a guardrail. Future automated actions will have more latitude than they do now, and Veyra will stop refusing the actions this rule currently blocks.';
  }
  const money = fmt(record.action.amountCents);
  switch (record.risk.friction) {
    case 'info':
      return `You are authorizing ${money}. Veyra will not execute this action until you approve it.`;
    case 'caution':
      return `This moves ${money} and reduces the buffer you have available for the rest of the month.`;
    case 'warning':
      return `This moves ${money} and materially changes your position${record.risk.reversible ? '' : '. It cannot easily be reversed'}.`;
    default:
      return `Confirm you intend to move ${money}.`;
  }
}

/** The specific factors driving the friction, so the warning is checkable. */
function frictionReasons(record) {
  const fromPolicy = record.decision.determining.map((r) => r.reason);
  const fromRisk = record.risk.factors
    // The body already states the guardrail case in full; repeating it as a
    // bullet trains people to skim the list they most need to read.
    .filter((f) => f.points >= 15 && f.id !== 'protection_downgrade')
    .map((f) => `${f.label}: ${f.detail}`);
  return [...new Set([...fromPolicy, ...fromRisk])];
}

function ApprovalModal({ record, step, twin, disclosures, onAcknowledge, onAdvance, onConfirm, onDecline, onClose }) {
  const blocked = record.state === STATE.BLOCKED;
  const done = step === 'done';
  const friction = FRICTION_COPY[record.risk.friction];
  const isInvestment = record.action.kind === 'invest';

  return (
    <div className="vy-modal-wrap" onClick={onClose}>
      <div className="vy-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="vy-modal-head">
          <div className="vy-card-label" style={{ margin: 0 }}>
            {done ? 'Executed' : blocked ? 'Blocked by your rules' : record.action.kind === 'policy_change' ? 'Change to your rules' : `${record.action.kind.replace('_', ' ')} action`}
          </div>
          <div className="vy-figure" style={{ marginTop: 6 }}>
            {record.action.kind === 'policy_change' ? record.action.rationale : fmt(record.action.amountCents, { cents: false })}
          </div>
        </div>

        <div className="vy-modal-body">
          {!done && (
            <dl className="vy-kv">
              {record.action.sourceAccountId && (<><dt>From</dt><dd>{account(twin, record.action.sourceAccountId).name}</dd></>)}
              {record.action.destinationAccountId && (<><dt>To</dt><dd>{safeName(twin, record.action.destinationAccountId)}</dd></>)}
              <dt>Requested by</dt><dd>{record.action.origin === 'ai' ? 'Veyra assistant' : record.action.origin}</dd>
              <dt>Risk</dt><dd>{record.risk.score}/100 · {record.risk.band}{record.risk.reversible ? '' : ' · not easily reversible'}</dd>
            </dl>
          )}

          {blocked && (
            <div className="vy-notice vy-notice-risk">
              <div className="vy-notice-title">Veyra will not proceed</div>
              {record.decision.determining.map((r) => <div key={r.ruleId}>{r.reason}</div>)}
            </div>
          )}

          {step === 'review' && !blocked && (
            <>
              <div className="vy-notice vy-notice-info">
                <div className="vy-notice-title">Why</div>
                {record.action.rationale}
                {record.decision.results.filter((r) => r.verdict === VERDICT.ALLOW).slice(0, 1).map((r) => (
                  <div key={r.ruleId} style={{ marginTop: 6 }}>{r.reason}</div>
                ))}
              </div>

              <div className="vy-card-label" style={{ marginTop: 18 }}>Policy evaluation</div>
              {record.decision.results.map((r) => (
                <div className="vy-rule" key={r.ruleId}>
                  <span className={`vy-dot ${dotFor(r.verdict)}`} style={{ marginTop: 6 }} />
                  <span>
                    <span className="vy-rule-name">{r.title}</span>
                    <span className="vy-rule-reason">{r.reason}</span>
                  </span>
                </div>
              ))}

              {disclosures.required.length > 0 && (
                <>
                  <div className="vy-card-label" style={{ marginTop: 18 }}>Disclosures</div>
                  {disclosures.required.map((d) => (
                    <div key={d.id} className="vy-notice vy-notice-review" style={{ marginTop: 10 }}>
                      <div className="vy-notice-title">{d.title}</div>
                      {d.body}
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {step === 'confirm' && !blocked && (
            <div className={`vy-notice ${friction.cls}`}>
              <div className="vy-notice-title">{friction.title}</div>
              {frictionBody(record)}
              {frictionReasons(record).length > 0 && (
                <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
                  {frictionReasons(record).map((reason) => <li key={reason} style={{ marginTop: 3 }}>{reason}</li>)}
                </ul>
              )}
              {record.decision.verdict === VERDICT.REQUIRE_REAUTH && (
                <div style={{ marginTop: 10 }}>
                  Re-authentication is required. In production this is a passkey prompt; here it is simulated.
                </div>
              )}
            </div>
          )}

          {step === 'confirm' && !blocked && disclosures.required.map((d) => {
            const explicit = d.acknowledgement === 'explicit';
            const done = !disclosures.outstanding.some((o) => o.id === d.id);
            return (
              <div key={d.id} className="vy-ack">
                {explicit ? (
                  <label className="vy-ack-row">
                    <input
                      type="checkbox"
                      checked={done}
                      disabled={done}
                      onChange={() => onAcknowledge(d.id)}
                    />
                    <span>
                      <strong>{d.title}</strong>
                      <span className="vy-ack-body">{d.body}</span>
                    </span>
                  </label>
                ) : (
                  <div className="vy-ack-row vy-ack-passive">
                    <span>
                      <strong>{d.title}</strong>
                      <span className="vy-ack-body">{d.body}</span>
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {done && (
            <>
              <div className="vy-notice vy-notice-info">
                <div className="vy-notice-title">Recorded</div>
                Authorized by you at {new Date(record.authorization?.at ?? Date.now()).toLocaleTimeString()}.
                {record.result?.reference && <> Reference <code>{record.result.reference}</code>.</>}
              </div>
              <p className="vy-sub" style={{ fontSize: 12 }}>
                The full decision, its evidence, and your authorization are in the audit log under Activity.
              </p>
            </>
          )}
        </div>

        <div className="vy-modal-foot">
          {done ? (
            <button className="vy-btn vy-btn-primary" onClick={onClose}>Done</button>
          ) : blocked ? (
            <button className="vy-btn" onClick={onClose}>Close</button>
          ) : step === 'review' ? (
            <>
              <button className="vy-btn" onClick={onDecline}>Cancel</button>
              <button className="vy-btn vy-btn-primary" onClick={onAdvance}>Review &amp; approve</button>
            </>
          ) : (
            <>
              <button className="vy-btn" onClick={onDecline}>
                {record.action.weakensProtection ? 'Keep protection' : 'Cancel'}
              </button>
              <button
                className={`vy-btn ${record.risk.friction === 'final_confirmation' ? 'vy-btn-risk' : 'vy-btn-primary'}`}
                onClick={onConfirm}
                disabled={disclosures.outstanding.length > 0}
                title={disclosures.outstanding.length > 0 ? 'Acknowledge the disclosures above to continue' : undefined}
              >
                {record.action.weakensProtection ? 'Disable' : 'Authorize'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function dotFor(verdict) {
  if (verdict === VERDICT.ALLOW) return 'vy-dot-ok';
  if (verdict === VERDICT.BLOCK) return 'vy-dot-risk';
  return 'vy-dot-review';
}

function safeName(twin, id) {
  try {
    return account(twin, id).name;
  } catch {
    return id;
  }
}
