/**
 * Legal documents, versioned the same way disclosures are.
 *
 * READ THIS BEFORE RELYING ON ANY OF IT:
 *
 * These are DRAFTS written by an engineer, not by a lawyer, and they have not
 * been reviewed by counsel. They are drafted to do the one genuinely protective
 * thing available right now — describe accurately and conservatively what this
 * application actually does, which is nothing regulated — and to give a real
 * document structure that counsel can correct rather than start from nothing.
 *
 * They are NOT a compliance program. Publishing a Terms page does not make an
 * unlicensed financial product lawful, and text that overstates what Veyra is
 * or claims registrations it does not hold makes matters worse, not better.
 * See LEGAL_STATUS.md.
 */

function versionOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `v${h.toString(16).padStart(8, '0')}`;
}

function doc(id, title, updated, sections) {
  const text = sections.map((s) => `${s.heading}\n${s.body}`).join('\n\n');
  return Object.freeze({ id, title, updated, sections, version: versionOf(text), status: 'DRAFT — NOT REVIEWED BY COUNSEL' });
}

export const TERMS = doc('terms', 'Terms of Service', '2026-08-29', [
  {
    heading: 'What Veyra is',
    body: `Veyra is a software application for understanding and planning personal
finances. In its current form it is a demonstration: it is not connected to any
financial institution, it displays fictional sample data, and it cannot move
money. Approving an action inside Veyra performs a simulation and has no effect
on any real account.`,
  },
  {
    heading: 'What Veyra is not',
    body: `Veyra is not a bank, credit union, broker-dealer, registered investment
adviser, investment company, money transmitter, payment processor, lender, tax
adviser, or law firm. It does not hold, custody, transmit, or invest money, and
it does not provide investment, tax, or legal advice. Nothing in the application
is an offer or solicitation to buy or sell any security.`,
  },
  {
    heading: 'No advisory relationship',
    body: `Using Veyra does not create an advisory, fiduciary, brokerage, or
professional relationship of any kind. Strategy profiles, recommendations, and
scenario analyses are illustrative and general. They are not tailored
recommendations and must not be relied upon as such. Consult a qualified,
licensed professional before making financial decisions.`,
  },
  {
    heading: 'Your responsibility for decisions',
    body: `You are solely responsible for your financial decisions. Veyra requires
you to explicitly approve every consequential action, and that approval is
yours. Automated analysis may be incomplete, out of date, or wrong. Review
everything before acting on it.`,
  },
  {
    heading: 'Accuracy and availability',
    body: `Veyra makes no warranty that the application will be available,
uninterrupted, accurate, or error-free. Figures may be estimates or derived from
modelled assumptions rather than settled transactions, and are labelled where
that is the case. Data may be stale; timestamps are shown so you can judge.`,
  },
  {
    heading: 'Acceptable use',
    body: `Do not attempt to gain unauthorized access, disrupt the service, probe
its security without written permission, scrape it at scale, or use it to
violate any law. Do not upload content you lack the right to share.`,
  },
  {
    heading: 'Disclaimer of warranties',
    body: `The application is provided "as is" and "as available", without
warranties of any kind, express or implied, including merchantability, fitness
for a particular purpose, accuracy, and non-infringement, to the fullest extent
permitted by law.`,
  },
  {
    heading: 'Limitation of liability',
    body: `To the fullest extent permitted by law, Veyra and its operators are not
liable for indirect, incidental, special, consequential, exemplary, or punitive
damages, or for lost profits, lost savings, or investment losses, arising out of
or relating to your use of the application. Some jurisdictions do not allow
certain limitations, so parts of this may not apply to you.`,
  },
  {
    heading: 'Changes',
    body: `These terms may change. Material changes will be surfaced in the
application, and the document version shown below will change with the text.`,
  },
  {
    heading: 'Contact',
    body: `Questions about these terms should be directed to the operator of this
application.`,
  },
]);

export const PRIVACY = doc('privacy', 'Privacy Notice', '2026-08-29', [
  {
    heading: 'The short version',
    body: `In its current demonstration form, Veyra does not collect personal
information. There is no account system, no login, no connected institution, and
no server that receives your data. Everything on screen is fictional sample data
computed in your browser.`,
  },
  {
    heading: 'What would be collected in a connected version',
    body: `If and when Veyra connects real financial accounts, it would receive
account balances, transactions, account and institution names, and account
types. It would additionally hold identity information needed to create an
account and satisfy applicable verification requirements.`,
  },
  {
    heading: 'Why it would be collected',
    body: `Solely to produce the analysis you see: your financial picture, cash
flow, goals, recommendations, and the records of what you authorized. Financial
data would not be sold, and would not be used for advertising.`,
  },
  {
    heading: 'Data minimization',
    body: `Veyra is designed not to collect what it does not need. Credentials for
your financial institutions would never be entered into or held by Veyra;
connection would run through a dedicated financial connectivity provider.`,
  },
  {
    heading: 'Browser storage',
    body: `The demonstration stores nothing in your browser beyond what is needed
to render the page for the length of your visit. No cookies are set for
tracking, and there is no third-party analytics or advertising code.`,
  },
  {
    heading: 'Your choices',
    body: `Because no personal data is collected in the demonstration, there is
nothing to export or delete. A connected version would provide account data
export, account deletion, institution disconnection, and the access and deletion
rights available under applicable law in your jurisdiction.`,
  },
  {
    heading: 'Security',
    body: `See SECURITY.md in the source repository for the controls that are
implemented and, equally important, the ones that are not yet.`,
  },
]);

export const AI_NOTICE = doc('ai', 'How Veyra uses automation', '2026-08-29', [
  {
    heading: 'What the automation does',
    body: `Veyra analyzes your financial data to surface recommendations, explain
figures, and run scenarios. Every number it shows is reconstructible: the
calculation behind it can be displayed line by line.`,
  },
  {
    heading: 'What it cannot do',
    body: `Automated components cannot authorize or execute anything. They can
only propose. Approval requires a person, and the system refuses approval from
any non-human actor at every permission level. Automation cannot change your
limits, your rules, or your security settings.`,
  },
  {
    heading: 'Limitations',
    body: `Automated analysis can be incomplete or wrong. It works from the data
available to it, which may be stale or partial. It does not know your full
circumstances. Treat every recommendation as a prompt to think, not an
instruction to follow.`,
  },
  {
    heading: 'Untrusted content',
    body: `Text arriving from financial institutions — merchant names, transaction
descriptions, statement memos — is treated as data, never as instructions to the
system. See the untrusted-input boundary in the source repository.`,
  },
]);

export const DOCUMENTS = Object.freeze([TERMS, PRIVACY, AI_NOTICE]);

/** @param {string} id */
export function documentById(id) {
  return DOCUMENTS.find((d) => d.id === id);
}
