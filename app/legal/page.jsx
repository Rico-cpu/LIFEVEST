/**
 * Legal centre. Renders on the server per request so the CSP nonce applies.
 */
import Link from 'next/link';
import { DOCUMENTS } from '../../lib/veyra/legal.mjs';
import { allDisclosures } from '../../lib/veyra/disclosures.mjs';
import '../veyra/veyra.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Veyra — Legal',
  description: 'Terms, privacy notice, automation notice, and disclosures.',
};

export default function LegalPage() {
  return (
    <div className="vy">
      <header className="vy-topbar">
        <div className="vy-topbar-in">
          <span className="vy-wordmark">Veyra</span>
          <nav className="vy-tabs">
            <Link className="vy-tab" href="/veyra">Back to app</Link>
          </nav>
        </div>
      </header>

      <main className="vy-shell">
        <p className="vy-greeting" style={{ marginTop: 30 }}>Legal</p>
        <h1 className="vy-headline">Terms, privacy, and disclosures.</h1>

        <div className="vy-notice vy-notice-risk">
          <div className="vy-notice-title">These documents are drafts</div>
          They were written by an engineer and have <strong>not been reviewed by a
          lawyer</strong>. They are published so the application states accurately what it
          is and does not claim to be something it isn’t. They are not a compliance
          program, and they do not make this application lawful for regulated activity.
          Have qualified counsel review and replace them before this product handles
          real money or real financial data.
        </div>

        <div className="vy-card">
          <div className="vy-card-label">Current status</div>
          <p style={{ margin: 0 }}>
            Veyra is a <strong>demonstration</strong>. It is not connected to any financial
            institution, all figures are fictional sample data, and no action taken inside
            it can move money. It is not a bank, broker-dealer, registered investment
            adviser, or money transmitter, and it provides no investment, tax, or legal
            advice.
          </p>
        </div>

        {DOCUMENTS.map((d) => (
          <section className="vy-card" key={d.id} id={d.id}>
            <div className="vy-spread">
              <div className="vy-card-label" style={{ margin: 0 }}>{d.title}</div>
              <span className="vy-chip">{d.version} · {d.updated}</span>
            </div>
            {d.sections.map((s) => (
              <div key={s.heading} style={{ marginTop: 16 }}>
                <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>{s.heading}</h2>
                <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 14 }}>{s.body}</p>
              </div>
            ))}
            <p className="vy-sub" style={{ marginTop: 18, fontSize: 12 }}>{d.status}</p>
          </section>
        ))}

        <section className="vy-card" id="disclosures">
          <div className="vy-card-label">Disclosures shown in the application</div>
          <p className="vy-sub" style={{ marginTop: 0 }}>
            Each is content-versioned. Changing the wording changes its version and
            invalidates any prior acknowledgement, so consent always refers to the exact
            text that was shown.
          </p>
          {allDisclosures().map((d) => (
            <div key={d.id} style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <div className="vy-spread">
                <strong style={{ fontSize: 14 }}>{d.title}</strong>
                <span className="vy-chip">{d.acknowledgement} · {d.version}</span>
              </div>
              <p style={{ margin: '6px 0 0', color: 'var(--ink-2)', fontSize: 14 }}>{d.body}</p>
              <p className="vy-sub" style={{ fontSize: 12 }}>Why this exists: {d.rationale}</p>
            </div>
          ))}
        </section>

        <footer className="vy-foot">
          Nothing on this page is legal advice.
        </footer>
      </main>
    </div>
  );
}
