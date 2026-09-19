#!/usr/bin/env node
/**
 * skills/stardust/scripts/class-report.mjs — findings[] → ranked class roll-up.
 *
 * Batch runners (rollout `verify.mjs`, qa `qa.mjs`, gate sweeps) hand their
 * per-page findings here; the helper prints the ranked class table the
 * conversation may hold and writes the per-page rows to files, so nothing
 * per-page is pasted into the transcript (`reference/context-hygiene.md`
 * § Runner reports and session hand-off).
 *
 * Input: a JSON file (or `-` for stdin) that is an array of findings, or an
 * object whose `findings` / `results` / `pages` key is one. A finding is any
 * object; rows with `ok: true` or `allowlisted: true` are skipped. Keys are
 * resolved by first match:
 *   class    --class-key  (default: class,id,check,reason,type)
 *   page     --page-key   (default: path,slug,page,url)
 *   message  --message-key (default: message,reason,detail)
 *   pointer  --pointer-key (default: file,evidence,artifact,screenshot)
 *   severity `severity` (error > warn > info; absent = unranked)
 *
 * Output:
 *   stdout            ranked class table, at most --max-lines lines (default 60)
 *   <out>/summary.json { generatedAt, source, total, classes[], pages[] }
 *   <out>/summary.md   the same table plus one section per class listing its pages
 *
 * Usage:
 *   node skills/stardust/scripts/class-report.mjs <findings.json|-> --out <dir> [--title <s>] [--max-lines 60] [--class-key a,b] [--page-key a,b]
 *
 * Exit codes: 0 report written (also when there are no findings); 2 usage or
 * read error. The verdict is the runner's, not this helper's.
 *
 * Also importable: `classReport(findings, opts)` → { classes, pages, total }
 * and `renderTable(report, { title, maxLines })` / `writeSummary(dir, report, opts)`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SEV = { error: 3, fail: 3, warn: 2, warning: 2, info: 1 };
const split = (s, d) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : d);
const pick = (row, keys) => { for (const k of keys) if (row[k] !== undefined && row[k] !== null && row[k] !== '') return String(row[k]); return undefined; };

export function classReport(input, opts = {}) {
  const classKey = opts.classKey ?? ['class', 'id', 'check', 'reason', 'type'];
  const pageKey = opts.pageKey ?? ['path', 'slug', 'page', 'url'];
  const messageKey = opts.messageKey ?? ['message', 'reason', 'detail'];
  const pointerKey = opts.pointerKey ?? ['file', 'evidence', 'artifact', 'screenshot'];
  const rows = (Array.isArray(input) ? input : input?.findings ?? input?.results ?? input?.pages ?? [])
    .filter((r) => r && typeof r === 'object' && r.ok !== true && r.allowlisted !== true);
  const byClass = new Map();
  const byPage = new Map();
  for (const r of rows) {
    const cls = pick(r, classKey) ?? 'unclassified';
    const page = pick(r, pageKey) ?? '';
    const message = pick(r, messageKey) ?? '';
    const pointer = pick(r, pointerKey) ?? page;
    const severity = typeof r.severity === 'string' ? r.severity.toLowerCase() : undefined;
    const item = { page, message, pointer, severity };
    const c = byClass.get(cls) ?? { class: cls, count: 0, severity: undefined, worst: null, pages: [] };
    c.count += 1;
    c.pages.push(item);
    if (!c.worst || (SEV[severity] ?? 0) > (SEV[c.worst.severity] ?? 0)) c.worst = item;
    if ((SEV[severity] ?? 0) > (SEV[c.severity] ?? 0)) c.severity = severity;
    byClass.set(cls, c);
    const p = byPage.get(page) ?? { page, findings: [] };
    p.findings.push({ class: cls, severity, message, pointer });
    byPage.set(page, p);
  }
  const classes = [...byClass.values()].sort((a, b) => b.count - a.count || (SEV[b.severity] ?? 0) - (SEV[a.severity] ?? 0) || a.class.localeCompare(b.class));
  return { generatedAt: new Date().toISOString(), source: opts.source ?? '', total: rows.length, classes, pages: [...byPage.values()] };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function renderTable(report, { title = 'Findings by class', maxLines = 60 } = {}) {
  const lines = [`${title}: ${report.total} finding(s) in ${report.classes.length} class(es), ${report.pages.length} page(s)`];
  if (!report.classes.length) return lines;
  lines.push('| class | count | severity | worst example | pointer |', '|---|---|---|---|---|');
  const budget = Math.max(1, maxLines - lines.length - 1);
  for (const c of report.classes.slice(0, budget)) {
    const ex = c.worst ? `${clip(cell(c.worst.page), 40)}${c.worst.message ? ` — ${clip(cell(c.worst.message), 80)}` : ''}` : '';
    lines.push(`| ${cell(c.class)} | ${c.count} | ${c.severity ?? '—'} | ${ex} | ${clip(cell(c.worst?.pointer), 60)} |`);
  }
  if (report.classes.length > budget) lines.push(`… ${report.classes.length - budget} more class(es) in summary.md`);
  return lines;
}

export function writeSummary(dir, report, opts = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
  const md = [`# ${opts.title ?? 'Findings by class'}`, '', `Generated ${report.generatedAt}${report.source ? ` from \`${report.source}\`` : ''}.`, '', ...renderTable(report, { title: opts.title, maxLines: Infinity }), ''];
  for (const c of report.classes) {
    md.push(`## ${c.class} (${c.count})`, '');
    for (const p of c.pages) md.push(`- ${cell(p.page) || '(no page)'}${p.severity ? ` [${p.severity}]` : ''}${p.message ? ` — ${cell(p.message)}` : ''}${p.pointer && p.pointer !== p.page ? ` → ${cell(p.pointer)}` : ''}`);
    md.push('');
  }
  writeFileSync(join(dir, 'summary.md'), md.join('\n'));
  return { json: join(dir, 'summary.json'), md: join(dir, 'summary.md') };
}

// ---- CLI ---------------------------------------------------------------
const isMain = process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const src = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
  if (args.includes('--help') || !src) {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith(' * ')).map((l) => l.slice(3)).join('\n'));
    process.exit(args.includes('--help') ? 0 : 2);
  }
  let input;
  try { input = JSON.parse(src === '-' ? readFileSync(0, 'utf8') : readFileSync(src, 'utf8')); } catch (e) { console.error(`class-report: cannot read ${src}: ${e.message}`); process.exit(2); }
  const title = opt('title') ?? 'Findings by class';
  const report = classReport(input, {
    source: src === '-' ? 'stdin' : src,
    classKey: split(opt('class-key')), pageKey: split(opt('page-key')), messageKey: split(opt('message-key')), pointerKey: split(opt('pointer-key')),
  });
  const maxLines = Number(opt('max-lines') ?? 60);
  const out = opt('out');
  const lines = renderTable(report, { title, maxLines });
  if (out) { const w = writeSummary(resolve(out), report, { title }); lines.push(`files: ${w.json} · ${w.md}`); }
  console.log(lines.join('\n'));
  process.exit(0);
}
