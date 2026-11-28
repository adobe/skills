// Formats activation summaries as one markdown table plus a grouping of repeated errors.
// Error and log text comes from the action and its callers, so it is untrusted: control characters are removed and
// markdown/HTML syntax is escaped, so a log line can't render links, images or formatting.
const cell = (text) => String(text ?? '')
  // eslint-disable-next-line no-control-regex
  .replace(/\x1b\[[0-9;?]*[A-Za-z]|[\x00-\x08\x0b-\x1f\x7f]/g, '')
  .replace(/\s+/g, ' ').trim()
  .replace(/[\\`*_[\]()<>!|#]/g, '\\$&') || '–';
// Long numbers and hex ids differ between otherwise identical errors; short numbers (HTTP codes) are kept.
const normalize = (error) => (error || '(no error text)').replace(/\b(?:\d{5,}|[0-9a-f]{12,})\b/gi, '#');

function logCell(row) {
  if (row.logStatus === 'failed') return `(logs could not be fetched: ${row.logError || 'unknown reason'})`;
  if (row.logStatus === 'not-fetched') return '(logs not fetched for this row)';
  if (row.logStatus === 'empty') return '(no log lines)';
  return row.logs.join(' ⏎ ');
}

export function toMarkdown(rows, { range }) {
  if (rows.length === 0) return `No matching runs between ${range.since} and ${range.upto}.`;

  const table = [
    '| Time | Action | Outcome | Duration | Error | Relevant log lines | Activation |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${cell(r.time)} | ${cell(r.action)} | ${cell(r.outcome)} | ${r.durationMs === null ? '–' : `${r.durationMs} ms`}${r.startType ? ` (${r.startType})` : ''} | ${cell(r.error)} | ${cell(logCell(r))} | ${cell(r.id)} |`),
  ];

  const groups = new Map();
  for (const r of rows.filter((row) => row.failed)) {
    const key = `${r.action} · ${r.outcome} · ${normalize(r.error)}`;
    const group = groups.get(key) ?? { count: 0, first: r, last: r };
    group.count += 1;
    if (r.startMs < group.first.startMs) group.first = r;
    if (r.startMs > group.last.startMs) group.last = r;
    groups.set(key, group);
  }
  const repeated = [...groups].filter(([, g]) => g.count > 1)
    .map(([key, g]) => `- ${g.count}× ${cell(key)} (${g.first.time} → ${g.last.time})`);

  return [...table, '', ...(repeated.length ? ['Repeated errors:', ...repeated] : [])].join('\n');
}
