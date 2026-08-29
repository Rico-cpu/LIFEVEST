import test from 'node:test';
import assert from 'node:assert/strict';
import { demoTwin, demoConstitution } from '../fixtures.mjs';
import { buildStatement, buildBoth, periodFor } from '../statements.mjs';
import { netWorthCents, monthlyNetCashFlowCents } from '../twin.mjs';
import { toCSV, csvCell, statementRows, statementSheets, sheetName, toWorkbookXML, filenameFor, dollarsField } from '../export.mjs';

const monthly = buildStatement(demoTwin, demoConstitution, { kind: 'monthly' });
const annual = buildStatement(demoTwin, demoConstitution, { kind: 'annual' });
const find = (st, id) => st.sections.find((s) => s.id === id);

test('periods are derived correctly, including month length', () => {
  const feb = periodFor('monthly', new Date('2024-02-15T00:00:00Z'));
  assert.equal(feb.label, 'February 2024');
  assert.equal(feb.end, '2024-02-29', 'leap year');
  const yr = periodFor('annual', new Date('2026-08-29T00:00:00Z'));
  assert.deepEqual([yr.label, yr.start, yr.end], ['2026', '2026-01-01', '2026-12-31']);
});

test('every line declares whether it is observed or derived', () => {
  for (const st of [monthly, annual]) {
    for (const section of st.sections) {
      for (const row of section.rows) {
        assert.ok(['observed', 'derived'].includes(row.basis), `${section.id}/${row.label} has basis "${row.basis}"`);
      }
    }
  }
});

test('every amount is integer cents', () => {
  for (const st of [monthly, annual]) {
    for (const section of st.sections) {
      for (const row of section.rows) {
        assert.ok(Number.isInteger(row.amountCents), `${section.id}/${row.label} = ${row.amountCents}`);
      }
      if (section.totalCents !== undefined) assert.ok(Number.isInteger(section.totalCents));
    }
  }
});

test('the balance sheet ties out to net worth', () => {
  const assets = find(monthly, 'assets').totalCents;
  const liabilities = find(monthly, 'liabilities').totalCents;
  assert.equal(assets - liabilities, netWorthCents(demoTwin));
});

test('the cash flow section reconciles with the twin’s own net figure', () => {
  const cf = find(monthly, 'cashflow');
  const [income, essential, discretionary] = cf.rows.map((r) => r.amountCents);
  assert.equal(cf.totalCents, income + essential + discretionary);
  assert.ok(Math.abs(cf.totalCents - monthlyNetCashFlowCents(demoTwin)) <= 2, 'within rounding of the twin');
});

test('annual flow sections scale from monthly, balances do not', () => {
  assert.ok(Math.abs(find(annual, 'income').totalCents - find(monthly, 'income').totalCents * 12) <= 12);
  assert.equal(find(annual, 'assets').totalCents, find(monthly, 'assets').totalCents);
});

test('buildBoth returns a matched pair', () => {
  const both = buildBoth(demoTwin, demoConstitution);
  assert.equal(both.monthly.kind, 'monthly');
  assert.equal(both.annual.kind, 'annual');
});

test('CSV quoting follows RFC 4180', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('has,comma'), '"has,comma"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell(null), '');
});

test('a label containing a comma cannot corrupt the CSV grid', () => {
  const csv = toCSV([['Section', 'Line'], ['Assets', 'Chase Checking, Primary']]);
  const lines = csv.split('\r\n');
  assert.equal(lines[1], 'Assets,"Chase Checking, Primary"');
});

test('CSV export carries every line of every section', () => {
  const rows = statementRows(monthly);
  const lineCount = monthly.sections.reduce((n, s) => n + s.rows.length, 0);
  const dataRows = rows.filter((r) => r.length === 5 && r[3] !== 'Basis');
  const totals = monthly.sections.filter((s) => s.totalCents !== undefined).length;
  assert.equal(dataRows.length, lineCount + totals);
});

test('money is emitted as decimal dollars so spreadsheets can sum it', () => {
  assert.equal(dollarsField(574167), '5741.67');
  assert.equal(dollarsField(-29699_00), '-29699.00');
  assert.equal(dollarsField(0), '0.00');
});

test('the workbook has one sheet per section plus an overview', () => {
  const sheets = statementSheets(monthly);
  assert.equal(sheets.length, monthly.sections.length + 1);
  assert.equal(sheets[0].name, 'Overview');
  for (const s of sheets) {
    assert.ok(s.name.length <= 31, `sheet name too long: ${s.name}`);
    assert.ok(!/[:\\/?*\[\]]/.test(s.name), `illegal character in sheet name: ${s.name}`);
  }
});

test('sheet names are sanitized and truncated', () => {
  assert.equal(sheetName('Cash/Flow: [2026]'), 'Cash-Flow- -2026-');
  assert.equal(sheetName('x'.repeat(40)).length, 31);
  assert.equal(sheetName(''), 'Sheet');
});

test('workbook XML types numbers as numbers and text as text', () => {
  const xml = toWorkbookXML([{ name: 'S', rows: [['Label', '12.50'], ['Neg', '-3.00']] }]);
  assert.match(xml, /<Data ss:Type="String">Label<\/Data>/);
  assert.match(xml, /<Data ss:Type="Number">12\.50<\/Data>/);
  assert.match(xml, /<Data ss:Type="Number">-3\.00<\/Data>/);
});

test('workbook XML escapes markup in user-controlled text', () => {
  const xml = toWorkbookXML([{ name: 'A&B', rows: [['<script>alert(1)</script>', 'Tom & "Jerry"']] }]);
  assert.ok(!xml.includes('<script>'), 'raw markup leaked into the workbook');
  assert.match(xml, /&lt;script&gt;/);
  assert.match(xml, /A&amp;B/);
  assert.match(xml, /Tom &amp; &quot;Jerry&quot;/);
});

test('a real statement produces a well-formed workbook', () => {
  const xml = toWorkbookXML(statementSheets(annual));
  assert.match(xml, /^<\?xml version="1\.0"\?>/);
  assert.match(xml, /mso-application progid="Excel\.Sheet"/);
  assert.equal((xml.match(/<Worksheet /g) ?? []).length, annual.sections.length + 1);
  assert.equal((xml.match(/<Worksheet /g) ?? []).length, (xml.match(/<\/Worksheet>/g) ?? []).length);
});

test('filenames are safe and describe the period', () => {
  assert.equal(filenameFor(monthly, 'csv'), 'veyra-monthly-statement-august-2026.csv');
  assert.equal(filenameFor(annual, 'xls'), 'veyra-annual-statement-2026.xls');
});

test('a statement declares where its period sits relative to the data held', () => {
  const past = buildStatement(demoTwin, demoConstitution, { kind: 'monthly', asOf: '2026-01-15T00:00:00Z' });
  const now = buildStatement(demoTwin, demoConstitution, { kind: 'monthly', asOf: '2026-08-29T00:00:00Z' });
  const future = buildStatement(demoTwin, demoConstitution, { kind: 'monthly', asOf: '2026-12-15T00:00:00Z' });

  assert.equal(past.standing, 'historical');
  assert.equal(now.standing, 'current');
  assert.equal(future.standing, 'projected');
  assert.match(past.standingNote, /not from recorded transactions/);
});
