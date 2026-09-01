/**
 * Statement export — CSV and a multi-sheet workbook, with no dependencies.
 *
 * The workbook is SpreadsheetML 2003 (a plain XML dialect Excel opens
 * natively), chosen so Veyra can emit a genuinely multi-sheet, formula-ready
 * file entirely in the browser without pulling in a zip/XLSX library. CSV is
 * offered alongside it because CSV opens anywhere.
 *
 * Money is emitted as decimal dollars so spreadsheet arithmetic works, but is
 * derived from integer cents so nothing is lost on the way out.
 */

/** @param {number} cents */
export function dollarsField(cents) {
  return (cents / 100).toFixed(2);
}

/** RFC 4180: quote when the value contains a comma, quote, CR or LF. */
export function csvCell(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** @param {(string|number)[][]} rows */
export function toCSV(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/**
 * Flatten a statement into tabular rows.
 * @param {import('./statements.mjs').Statement} statement
 */
export function statementRows(statement) {
  const rows = [
    ['Veyra statement', statement.kind === 'annual' ? 'Annual' : 'Monthly'],
    ['Period', statement.periodLabel],
    ['Period start', statement.periodStart],
    ['Period end', statement.periodEnd],
    ['Generated', statement.generatedAt],
    ['Twin version', statement.twinVersion],
    [],
    ['Section', 'Line', 'Amount (USD)', 'Basis', 'Note'],
  ];

  for (const section of statement.sections) {
    for (const row of section.rows) {
      rows.push([section.title, row.label, dollarsField(row.amountCents), row.basis, row.note ?? '']);
    }
    if (section.totalCents !== undefined) {
      rows.push([section.title, section.totalLabel ?? 'Total', dollarsField(section.totalCents), 'derived', 'Section total']);
    }
    rows.push([]);
  }

  rows.push(['Basis', statement.basisNote]);
  return rows;
}

/** One sheet per section — the shape a person actually wants to pivot on. */
export function statementSheets(statement) {
  const sheets = [
    {
      name: 'Overview',
      rows: [
        ['Veyra statement', statement.kind === 'annual' ? 'Annual' : 'Monthly'],
        ['Period', statement.periodLabel],
        ['Period start', statement.periodStart],
        ['Period end', statement.periodEnd],
        ['Generated', statement.generatedAt],
        ['Twin version', statement.twinVersion],
        [],
        ['Section', 'Total (USD)'],
        ...statement.sections
          .filter((s) => s.totalCents !== undefined)
          .map((s) => [s.title, dollarsField(s.totalCents)]),
        [],
        ['Basis', statement.basisNote],
      ],
    },
  ];

  for (const section of statement.sections) {
    sheets.push({
      name: sheetName(section.title),
      rows: [
        ['Line', 'Amount (USD)', 'Basis', 'Note'],
        ...section.rows.map((r) => [r.label, dollarsField(r.amountCents), r.basis, r.note ?? '']),
        ...(section.totalCents !== undefined
          ? [[section.totalLabel ?? 'Total', dollarsField(section.totalCents), 'derived', 'Section total']]
          : []),
      ],
    });
  }
  return sheets;
}

/** Excel sheet names: 31 chars, and none of : \ / ? * [ ] */
export function sheetName(title) {
  return title.replace(/[:\\/?*\[\]]/g, '-').slice(0, 31) || 'Sheet';
}

function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * @param {{name:string, rows:(string|number)[][]}[]} sheets
 * @returns {string} SpreadsheetML 2003 workbook
 */
export function toWorkbookXML(sheets) {
  const body = sheets
    .map((sheet) => {
      const rows = sheet.rows
        .map((row) => {
          if (row.length === 0) return '   <Row/>';
          const cells = row
            .map((cell) => {
              const raw = cell ?? '';
              const numeric = typeof raw === 'number' || (typeof raw === 'string' && raw !== '' && NUMERIC.test(raw));
              const type = numeric ? 'Number' : 'String';
              return `    <Cell><Data ss:Type="${type}">${xmlEscape(raw)}</Data></Cell>`;
            })
            .join('\n');
          return `   <Row>\n${cells}\n   </Row>`;
        })
        .join('\n');
      return ` <Worksheet ss:Name="${xmlEscape(sheet.name)}">\n  <Table>\n${rows}\n  </Table>\n </Worksheet>`;
    })
    .join('\n');

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${body}
</Workbook>`;
}

/** @param {import('./statements.mjs').Statement} statement @param {string} ext */
export function filenameFor(statement, ext) {
  const period = statement.periodLabel.toLowerCase().replace(/\s+/g, '-');
  return `veyra-${statement.kind}-statement-${period}.${ext}`;
}

/**
 * Trigger a client-side download. Browser-only; no network, nothing leaves the
 * device.
 * @param {string} filename @param {string} content @param {string} mime
 */
export function download(filename, content, mime) {
  if (typeof document === 'undefined') throw new Error('download() is browser-only');
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const MIME = {
  csv: 'text/csv;charset=utf-8',
  xls: 'application/vnd.ms-excel;charset=utf-8',
};
