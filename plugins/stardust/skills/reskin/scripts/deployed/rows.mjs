// skills/reskin/scripts/deployed/rows.mjs — what the deployed steps that report a table of rows share (`parity`, `sanity`
// and `inherited`): the verdict of their rows, the lines the CLI prints for them, and a bounded list for a row's detail.
// A library, no CLI.
//   EXIT                  the exit code of each verdict
//   verdictOf(rows)       'ERROR' when a row gave no verdict, else 'FAIL' when one failed, else 'PASS'
//   labelOf(row)          the row's check, with " @<width>" when it has a width
//   detailLines(row, indent)  the row's detail, one indented line per line of it
//   listed(items)         at most MAX_LISTED of the items, one per line, then a count of the rest; null for none
//   stepLines(step, { verdict, rows }, { failHeading, failure, unrun })  the lines the CLI prints: a line for the rows that
//        gave no verdict, the verdict line, one indented line per failing row (its findings below), one line per ADVISORY
//        row, and one line per distinct reason a row was not run (the statuses in `unrun`, default n/a)
export const EXIT = { PASS: 0, FAIL: 1, ERROR: 124 };
const MAX_LISTED = 10;

export const verdictOf = (rows) => (rows.some((r) => r.status === 'ERROR') ? 'ERROR' : rows.some((r) => r.status === 'FAIL') ? 'FAIL' : 'PASS');

export const labelOf = (r) => `${r.check}${r.width ? ` @${r.width}` : ''}`;
export const detailLines = (r, indent) => (r.detail ? r.detail.split('\n').map((l) => `${indent}${l}`) : []);

export const listed = (items) => {
  if (!items.length) return null;
  const shown = items.slice(0, MAX_LISTED);
  if (items.length > shown.length) shown.push(`… ${items.length - shown.length} more`);
  return shown.join('\n');
};

const againstBar = (r) => `${labelOf(r)}: ${r.value} (bar ${r.bar})`;

export function stepLines(step, { verdict, rows }, { failHeading = `FAIL ${step}`, failure = againstBar, unrun = ['n/a'] } = {}) {
  const errors = rows.filter((r) => r.status === 'ERROR');
  const fails = rows.filter((r) => r.status === 'FAIL');
  const lines = [];
  if (errors.length) {
    lines.push(`ERROR (exit ${EXIT.ERROR}) ${step}: ${errors.length} check${errors.length === 1 ? '' : 's'} gave no verdict`);
    for (const r of errors) lines.push(`  ${labelOf(r)}: ${r.value}`, ...detailLines(r, '    '));
  }
  if (fails.length) {
    lines.push(failHeading);
    for (const r of fails) lines.push(`  ${failure(r)}`, ...detailLines(r, '    '));
  }
  if (verdict === 'PASS') lines.push(`PASS ${step}`);
  for (const r of rows.filter((x) => x.status === 'ADVISORY')) lines.push(`ADVISORY ${labelOf(r)}: ${r.value}`, ...detailLines(r, '  '));
  const reasons = new Map();
  for (const r of rows.filter((x) => unrun.includes(x.status))) reasons.set(r.value, [...(reasons.get(r.value) ?? []), labelOf(r)]);
  for (const [value, labels] of reasons) lines.push(`${value} (${labels.join(', ')})`);
  return lines;
}
