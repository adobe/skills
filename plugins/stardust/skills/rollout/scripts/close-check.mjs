#!/usr/bin/env node
/**
 * rollout/close-check.mjs — the wave-close checklist (rollout Phase H; Setup step 4's hands-off
 * wave close). Deterministic, file-only: the report may say "closed" / "ready for review" ONLY on
 * exit 0. It blocks nothing in delivery — no PUT, no publish, no gate verdict, no page status.
 *
 * "This wave" = everything since the last `stardust:rollout` `start` line of status.jsonl (no wave
 * id exists). Rows are artifact checks, never prose checks:
 *   1 status     a rollout `end` line with `next` (or `blocked` with `next`/`owner`) newer than the wave start
 *   2 journal    an entry with ts ≥ wave start whose `**Next:**` is that `next` (a `blocked` wave: `Blocked on owner:`)
 *   3 coverage   rollout.json lastRun.at ≥ the deploy ledger's newest row `ts` (update-coverage / verify ran after
 *                the last batch); ledger previewed|live vs coverage deployed|verified printed side by side — drift is a
 *                WARNING, never a fail; admin bulk-status only via --reconcile (informational: `not reconciled (no token)`)
 *   4 learnings  stardust/learnings.md: ≥ 1 entry carrying an ISO date ≥ wave start, OR one line
 *                `- none this run (<ts>): …` — accepted only when progress.json has no residual `flaggedFor: delivery`
 *                newer than the wave start under `breakpoints.<bp>` OR `published.<bp>` (both regimes) and
 *                direction.md names no deviation newer than it (else the rows are listed)
 *   5 review     stardust/rollout/review-pack.{md,json} generated ≥ the last deployedAt, ≥ 1 row per delivered
 *                templateId, every URL on site.liveHost or the source host (localhost / 127.0.0.1 / a token → fail)
 *   6 dashboard  dashboard/data.json generatedAt ≥ lastRun.at
 *   7 report     newest stardust/rollout/report/*.md written ≥ the wave start with a gate table and a `report-check:`
 *                line (handoff-report.md) — REQUIRED. `--fix` renders it with `skills/stardust/scripts/status.mjs
 *                --root <root> --markdown` when that script sits beside this skill (plugin layout) into
 *                report/<wave-ts>.md; a project copy without it writes the Phase H block by hand
 *   8 tracking   only when decisions.md row `tracking` ≠ none: tracking.json {issueUrl, commentUrl, at} updated this wave,
 *                or a `blocked` line with `owner: gh issue comment …` → `[~] blocked on owner` (exit 0)
 *   9 commit     when the project is a git repo AND decisions.md row `commit` = phase-end: a commit since the wave start
 *                touching stardust/; otherwise `[~] owner preference`
 *  [-] rows      informational, never failing: the artifact lines (published-origin coverage line, Readability,
 *                Editability) copied from their files — never re-judged here — and `usage` from stardust/usage.json
 *                (token-ledger.mjs; `usage: unknown` when absent).
 *
 * Marks: [x] met · [ ] required and not met (exit 1) · [~] skipped with a recorded reason / blocked on owner ·
 *        [-] informational. Exit 1 prints the pasteable command for each [ ] row.
 *
 * --fix       performs the MECHANICAL rows and re-checks: dashboard.mjs, open-review-pairs.mjs --per-template 1 --no-open
 *             (hands-off never opens a browser here). Journal, ledger entry, tracking and commit stay agent work.
 * --skip <row> --reason "<text>"   renders `[~] <row>: <reason>` and appends the reason to the journal (audit trail);
 *             never for `status` (row 1) or `learnings` (row 4 — the "none this run" line is its honest escape): exit 2.
 * --reconcile  informational only: with no DA_TOKEN prints `not reconciled (no token)`; never a fail, never a network call here.
 *
 * Usage: node skills/rollout/scripts/close-check.mjs [--fix] [--reconcile] [--skip <row> --reason "<text>"]
 *          [--out stardust/rollout] [--root .] [--ledger content/.deploy-ledger.json] [--json]
 * Exit: 0 closed (every required row [x] or [~]) · 1 a required row is [ ] · 2 usage (coverage missing — run
 *       inventory.mjs; --skip on row 1 / 4 or without --reason; unknown row)
 * The LAST stdout line is `SUMMARY close-check ok=<rows met> failed=<rows open> exit=<code> details=<status.jsonl>`.
 */
import { existsSync, readFileSync, readdirSync, statSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readJSON, siteBase, deliveredPathOf, isDelivered } from './lib.mjs';

function arg(argv, name, fallback) { const i = argv.indexOf(`--${name}`); if (i === -1) return fallback; const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) { console.error(`close-check: --${name} needs a value`); process.exit(2); } return v; }
const has = (argv, f) => argv.includes(`--${f}`);
const ROWS = ['status', 'journal', 'coverage', 'learnings', 'review', 'dashboard', 'report', 'tracking', 'commit'];
const NO_SKIP = new Set(['status', 'learnings']);
const ISO = /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?/g;
const ts = (s) => { const t = Date.parse(String(s || '')); return Number.isFinite(t) ? t : null; };
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const mtimeIso = (p) => (existsSync(p) ? statSync(p).mtime.toISOString() : null);

/** status.jsonl → { start, close } for the current rollout wave (pure). */
export function waveOf(lines) {
  const rows = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.skill === 'stardust:rollout');
  const starts = rows.filter((r) => r.event === 'start');
  const start = starts.length ? starts[starts.length - 1] : null;
  const after = start ? rows.filter((r) => ts(r.ts) !== null && ts(r.ts) >= ts(start.ts) && r !== start) : [];
  const close = [...after].reverse().find((r) => (r.event === 'end' && r.next) || (r.event === 'blocked' && (r.next || r.owner))) || null;
  return { start, close, after };
}
/** journal.md entries (## <ts> — …) as { at, text } (pure). */
export function journalEntries(md) {
  const out = []; if (!md) return out;
  const parts = md.split(/^## /m).slice(1);
  for (const p of parts) { const m = p.match(ISO); out.push({ at: m ? m[0] : null, text: p }); }
  return out;
}
/** A URL the reviewer may open: live host or source host — never localhost, never a token (pure). */
export function reviewable(url, hosts) {
  try { const u = new URL(url); if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(u.hostname)) return false; if (/(^|[?&#])(token|access_token|auth|apikey)=/i.test(u.search + u.hash)) return false; return !hosts.length || hosts.includes(u.hostname); } catch { return false; }
}
/** learnings.md verdict for the wave (pure): { ok, reason, entries, none } */
export function learningsVerdict(md, { start, residuals, deviations }) {
  if (md === null) return { ok: false, reason: 'stardust/learnings.md missing' };
  const entries = md.split(/^### /m).slice(1).filter((e) => [...e.matchAll(ISO)].some((m) => ts(m[0]) !== null && ts(m[0]) >= start) && /- status:\s*(pending|folded)/.test(e));
  if (entries.length) return { ok: true, reason: `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} this wave`, entries: entries.length };
  const none = md.split('\n').map((l) => l.match(/^- none this run \(([^)]+)\)/)).find((m) => m && ts(m[1]) !== null && ts(m[1]) >= start);
  if (!none) return { ok: false, reason: 'no entry with a date ≥ wave start and no `- none this run (<ts>)` line' };
  const open = [...residuals.map((r) => `residual ${r.archetype}@${r.bp} ${r.band} flaggedFor delivery${r.regime === 'published-origin' ? ' (published-origin)' : ''}`), ...deviations.map((d) => `deviation: ${d}`)];
  if (open.length) return { ok: false, reason: `"none this run" refused — ${open.length} row(s) newer than the wave start need a ledger entry: ${open.slice(0, 3).join('; ')}`, none: true };
  return { ok: true, reason: 'none this run (no residual flagged for delivery, no named deviation this wave)', none: true };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
function main() {
  const argv = process.argv;
  const USAGE = `usage: close-check.mjs [--fix] [--reconcile] [--skip <${ROWS.join('|')}> --reason "<text>"] [--out stardust/rollout] [--root .] [--ledger content/.deploy-ledger.json] [--json]\n  exit 0 closed · 1 a required row is [ ] · 2 usage`;
  if (has(argv, 'help') || has(argv, 'h')) { console.log(USAGE); process.exit(0); }
  const ROOT = resolve(arg(argv, 'root', '.'));
  const OUT = resolve(ROOT, arg(argv, 'out', 'stardust/rollout'));
  const LEDGER = resolve(ROOT, arg(argv, 'ledger', 'content/.deploy-ledger.json'));
  const SD = join(OUT, '..');
  const HERE = new URL('.', import.meta.url).pathname;
  const skipRow = arg(argv, 'skip', null); const skipReason = arg(argv, 'reason', null);
  if (skipRow && (!ROWS.includes(skipRow) || NO_SKIP.has(skipRow) || !skipReason)) { console.error(`close-check: --skip needs a row of ${ROWS.filter((r) => !NO_SKIP.has(r)).join('|')} and --reason "<text>" (rows status and learnings cannot be skipped)\n${USAGE}`); process.exit(2); }

  const pagesDoc = readJSON(join(OUT, 'coverage', 'pages.json'));
  if (!pagesDoc) { console.error(`close-check: ${join(OUT, 'coverage', 'pages.json')} not found — run inventory.mjs first.`); process.exit(2); }
  const config = readJSON(join(OUT, 'rollout.json'), {});
  const statusPath = join(SD, 'status.jsonl');
  const { start, close } = waveOf((readText(statusPath) || '').split('\n').filter(Boolean));
  const startAt = start ? ts(start.ts) : null;

  const rows = []; // { id, mark, text, fix }
  const push = (id, mark, text, fix = null) => rows.push({ id, mark, text, fix });
  const required = (id, ok, text, fix) => push(id, ok ? 'x' : ' ', text, ok ? null : fix);

  const check = () => {
    rows.length = 0;
    const pages = pagesDoc.pages || [];
    const now = Date.now();
    // 1 status
    if (!start) required('status', false, 'status.jsonl: no `stardust:rollout` start line — the wave has no window', 'write the phase `start` line (skills/stardust/reference/run-status.md § Line shape)');
    else required('status', !!close, close ? `status.jsonl: ${close.event} ${close.ts}${close.next ? ` next = ${JSON.stringify(close.next)}` : ''}${close.owner ? ` owner = ${JSON.stringify(close.owner)}` : ''}` : `status.jsonl: no rollout \`end\` (with next) or \`blocked\` (with next/owner) line after the wave start ${start.ts}`, 'append the phase `end` line with `next` (run-status.md § Phase close)');
    // 2 journal
    const entries = journalEntries(readText(join(SD, 'journal.md'))).filter((e) => startAt !== null && ts(e.at) !== null && ts(e.at) >= startAt);
    const nextOf = (t) => (t.match(/\*\*Next:\*\*\s*(.+)/) || [])[1];
    const hit = close && entries.find((e) => (close.next ? (nextOf(e.text) || '').trim() === String(close.next).trim() : /\*\*Blocked on owner:\*\*/.test(e.text)));
    required('journal', !!hit, hit ? `journal.md: entry ${hit.at} carries **Next:** = status next` : `journal.md: no entry ≥ wave start whose **Next:** equals the status \`next\` (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} this wave)`, 'append the journal entry with **Next:** = the `next` command (skills/stardust/reference/journal-format.md § Entry format)');
    // 3 coverage current vs ledger
    const ledger = readJSON(LEDGER, null);
    const lastRunAt = ts(config.lastRun && config.lastRun.at);
    if (!ledger || typeof ledger !== 'object') push('coverage', 'x', `coverage: no deploy ledger at ${LEDGER} (nothing delivered by deploy-batch this wave)`);
    else {
      const recs = Object.values(ledger);
      const ledgerAt = recs.map((r) => ts(r && r.ts)).filter((t) => t !== null).sort().pop() ?? ts(mtimeIso(LEDGER));
      const led = recs.filter((r) => ['previewed', 'live'].includes(r && r.status)).length;
      const cov = pages.filter((p) => ['deployed', 'verified'].includes(p.delivery && p.delivery.status)).length;
      const current = lastRunAt !== null && (ledgerAt === null || lastRunAt >= ledgerAt);
      const drift = led !== cov ? ` · WARNING drift: ledger previewed|live ${led} vs coverage deployed|verified ${cov}` : ` · ledger previewed|live ${led} = coverage deployed|verified ${cov}`;
      required('coverage', current, `coverage: rollout.json lastRun.at ${config.lastRun && config.lastRun.at}${current ? ' ≥' : ' <'} ledger newest row ${ledgerAt ? new Date(ledgerAt).toISOString() : '—'}${drift}`, 'node skills/rollout/scripts/update-coverage.mjs --from-ledger content/.deploy-ledger.json --url-base <preview-origin>');
      if (has(argv, 'reconcile')) push('coverage', '-', process.env.DA_TOKEN ? 'reconcile: admin bulk-status is the status renderer\'s job (`--reconcile` there); local ledger ↔ coverage compared above' : 'reconcile: not reconciled (no token) — informational');
    }
    // 4 learnings
    const progress = readJSON(join(SD, 'replica', 'progress.json'), null);
    const residuals = [];
    // both regimes: the prototype gate's breakpoints.<bp>.residuals[] and the published-origin gate's published.<bp>.residuals[]
    for (const a of (progress && progress.archetypes) || []) for (const [regime, byBp] of [['prototype', a.breakpoints], ['published-origin', a.published]]) for (const [bp, b] of Object.entries(byBp || {})) for (const r of (b && b.residuals) || []) { const at = ts(r.at) ?? ts(a.approvedAt) ?? ts(progress._provenance && progress._provenance.writtenAt); if (r.flaggedFor === 'delivery' && startAt !== null && at !== null && at >= startAt) residuals.push({ archetype: a.archetype, bp, band: r.band, regime }); }
    const deviations = (readText(join(SD, 'direction.md')) || '').split('\n').filter((l) => /deviation/i.test(l) && [...l.matchAll(ISO)].some((m) => startAt !== null && ts(m[0]) >= startAt)).map((l) => l.trim().slice(0, 80));
    const lv = learningsVerdict(readText(join(SD, 'learnings.md')), { start: startAt ?? now, residuals, deviations });
    required('learnings', lv.ok, `learnings.md: ${lv.reason}`, residuals.length ? `append a ledger entry per row (evidence = the residual row; proposed change = the owning skill section) — skills/stardust/reference/learnings.md § Entry shape` : 'append one entry per failure class this wave, or `- none this run (<ts>): no new failure classes; residuals: <n> (all classed), deviations: <n>` — skills/stardust/reference/learnings.md');
    // 5 review pack
    const delivered = pages.filter(isDelivered);
    const packJson = readJSON(join(OUT, 'review-pack.json'), null);
    const packMd = readText(join(OUT, 'review-pack.md'));
    const lastDeployed = delivered.map((p) => ts(p.delivery && (p.delivery.verifiedAt || p.delivery.deployedAt))).filter((t) => t !== null).sort().pop() ?? null;
    if (!delivered.length) push('review', '-', 'review pack: no delivered rows yet — nothing to review');
    else if (!packJson && !packMd) required('review', false, 'review pack: stardust/rollout/review-pack.md missing', 'node skills/rollout/scripts/open-review-pairs.mjs --per-template 1 --no-open');
    else {
      const packAt = ts(packJson && packJson.generatedAt) ?? ts(mtimeIso(join(OUT, 'review-pack.md')));
      const fresh = lastDeployed === null || (packAt !== null && packAt >= lastDeployed);
      const prows = (packJson && packJson.rows) || [];
      const templates = new Set(delivered.map((p) => p.templateId || 'untyped'));
      const covered = new Set(prows.map((r) => r.template));
      const missingT = [...templates].filter((t) => !covered.has(t));
      const hosts = [siteBase(config, null), config.site && config.site.sourceUrl].filter(Boolean).map((u) => { try { return new URL(u).hostname; } catch { return null; } }).filter(Boolean);
      const urls = prows.length ? prows.flatMap((r) => [r.source, r.eds].filter(Boolean)) : [...(packMd || '').matchAll(/https?:\/\/[^\s|)]+/g)].map((m) => m[0]);
      const bad = urls.filter((u) => !reviewable(u, hosts));
      const ok = fresh && !missingT.length && !bad.length && (prows.length > 0 || urls.length > 0);
      required('review', ok, `review pack: ${prows.length || urls.length / 2} pair(s)${fresh ? '' : ' · STALE (older than the last deployedAt)'}${missingT.length ? ` · no row for template(s) ${missingT.join(', ')}` : ''}${bad.length ? ` · ${bad.length} URL(s) not on the live/source host or carrying a token` : ''}`, `node skills/rollout/scripts/open-review-pairs.mjs --per-template 1 --no-open${missingT.length ? ' (every delivered template gets a row)' : ''}`);
    }
    // 6 dashboard
    const dash = readJSON(join(OUT, 'dashboard', 'data.json'), null);
    const dashAt = ts(dash && dash.generatedAt);
    required('dashboard', dashAt !== null && (lastRunAt === null || dashAt >= lastRunAt), `dashboard: data.json generatedAt ${dash ? dash.generatedAt : 'missing'}${lastRunAt !== null ? ` vs lastRun.at ${config.lastRun.at}` : ''}`, 'node skills/rollout/scripts/dashboard.mjs');
    // 7 report — required: the newest report/*.md of this wave carries the gate table and the report-check line
    const repDir = join(OUT, 'report');
    const repFix = `write stardust/rollout/report/${start ? String(start.ts).replace(/[:.]/g, '-') : '<wave-ts>'}.md — the Phase H block: gate table first, coverage line, then \`report-check: <n> paths ls-verified · <m> counts re-read from <files>\` (skills/stardust/reference/handoff-report.md § Gate table first · § Residuals, links, report check)`;
    const files = existsSync(repDir) ? readdirSync(repDir).filter((f) => f.endsWith('.md')).sort() : [];
    const newestFile = files.length ? files[files.length - 1] : null;
    const newest = newestFile ? readText(join(repDir, newestFile)) : null;
    // <wave-ts>.md names its time with `-` for `:` (file-safe); a name without a time falls back to the file's mtime
    const nameTs = newestFile ? (newestFile.replace(/T(\d{2})-(\d{2})(?:-(\d{2}))?/, (m, h, mi, sec) => `T${h}:${mi}${sec ? `:${sec}` : ''}`).match(ISO) || [])[0] : null;
    const repAt = newestFile ? (nameTs && /T\d{2}:\d{2}/.test(nameTs) ? ts(nameTs) : ts(mtimeIso(join(repDir, newestFile)))) : null;
    const repFresh = repAt !== null && (startAt === null || repAt >= startAt);
    const repOk = !!newest && repFresh && /^\|.*gate/im.test(newest) && /report-check:/i.test(newest);
    required('report', repOk, !newestFile ? `report: no stardust/rollout/report/*.md for this wave` : `report: ${newestFile}${repOk ? ' (gate table + report-check line)' : !repFresh ? ' is older than the wave start' : ' lacks a gate table or a `report-check:` line'}`, repFix);
    // 8 tracking · 9 commit — decisions.md rows
    const decisions = readText(join(SD, 'decisions.md')) || '';
    const rowOf = (id) => { const m = decisions.split('\n').find((l) => new RegExp(`^\\|\\s*\`?${id}\`?\\s*\\|`).test(l)); return m ? m.split('|').map((c) => c.trim()) : null; };
    const trackingRow = rowOf('tracking');
    const trackingVal = trackingRow ? trackingRow[3] : 'none';
    if (!trackingRow || /^none\b|^—$|^-$/i.test(trackingVal)) push('tracking', '-', `tracking: ${trackingRow ? trackingVal : 'no decisions row'} — nothing to update`);
    else {
      const tj = readJSON(join(OUT, 'tracking.json'), null);
      const upd = tj && tj.commentUrl && ts(tj.at) !== null && startAt !== null && ts(tj.at) >= startAt;
      const blockedOwner = close && close.event === 'blocked' && /gh issue comment/.test(String(close.owner || ''));
      if (upd) push('tracking', 'x', `tracking: comment ${tj.commentUrl} at ${tj.at}`);
      else if (blockedOwner) push('tracking', '~', `tracking: blocked on owner — ${close.owner}`);
      else required('tracking', false, `tracking: row = ${trackingVal}; tracking.json not updated this wave`, 'gh issue comment <issue> --body-file <report> (then write stardust/rollout/tracking.json {issueUrl, commentUrl, at}); a denial → `blocked` + `owner:`');
    }
    const commitRow = rowOf('commit');
    const isRepo = spawnSync('git', ['-C', ROOT, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).status === 0;
    if (!isRepo) push('commit', '~', 'commit: not a git repository — owner preference');
    else if (!commitRow || !/phase-end|end of each phase/i.test(commitRow[3] || '')) push('commit', '~', `commit: decisions row = ${commitRow ? commitRow[3] : 'absent'} — owner preference (ask-before-commit stands)`);
    else {
      const since = startAt !== null ? new Date(startAt).toISOString() : '1 hour ago';
      const log = spawnSync('git', ['-C', ROOT, 'log', '-1', '--format=%h %s', `--since=${since}`, '--', 'stardust/'], { encoding: 'utf8' });
      const ok = log.status === 0 && log.stdout.trim().length > 0;
      required('commit', ok, ok ? `commit: ${log.stdout.trim()}` : `commit: no commit touching stardust/ since the wave start ${since}`, 'git add stardust/ && git commit -m "rollout: wave close"');
    }
    // informational artifact lines — copied, never re-judged
    const gr = readJSON(join(OUT, 'gate-report.json'), null);
    if (gr && gr.coverage) { const c = gr.coverage; push('artifacts', '-', `Pages gated  published-gated ${c.gated} of ${c.delivered} · PASS ${c.pass} · FAIL ${c.fail} · unmeasured ${c.unmeasured} · ungated ${c.ungated}   (gate-report.json)`); }
    const g = (config.lastRun && config.lastRun.gates) || {};
    if (g['ai-readability']) { const a = g['ai-readability']; push('artifacts', '-', `Readability  strict median ${a.strictMedian ?? '—'} · code median ${a.codeMedian ?? '—'} · pages < ${a.min}: ${a.below} · unmeasured: ${a.unmeasured}   (lastRun.gates.ai-readability)`); }
    if (g.editability) { const e = g.editability; push('artifacts', '-', `Editability  ${e.editable}/${e.authored} · dead ${e.dead} · exempt ${e.exempt} · unmeasured ${e.unmeasured}   (lastRun.gates.editability)`); }
    // [-] usage — T13.4's ledger, copied; advisory, never a row that fails
    const usage = readJSON(join(SD, 'usage.json'), null);
    const kt = (n) => (n === null || n === undefined ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n));
    if (usage && usage.total) { const t = usage.total; push('usage', '-', `Usage  ${Array.isArray(usage.windows) ? Math.max(0, usage.windows.length - 1) : 0} window(s) · ${t.turns ?? '—'} requests · fresh ${kt(t.fresh)} · cache read ${kt(t.cacheRead)} · output ${kt(t.output)}   (usage.json ${usage.generatedAt || ''})`); } else push('usage', '-', 'usage: unknown (no stardust/usage.json — node skills/stardust/scripts/token-ledger.mjs renders it)');
    // --skip
    if (skipRow) for (const r of rows) if (r.id === skipRow && r.mark === ' ') { r.mark = '~'; r.text = `${skipRow}: skipped — ${skipReason}`; r.fix = null; }
  };

  check();
  if (has(argv, 'fix')) {
    const open = new Set(rows.filter((r) => r.mark === ' ').map((r) => r.id));
    const runs = [];
    if (open.has('dashboard')) runs.push(['dashboard.mjs', [join(HERE, 'dashboard.mjs'), '--out', OUT]]);
    if (open.has('review') && siteBase(config, null)) runs.push(['open-review-pairs.mjs', [join(HERE, 'open-review-pairs.mjs'), '--per-template', '1', '--no-open', '--out', OUT, '--state', join(SD, 'state.json'), '--progress', join(SD, 'replica', 'progress.json')]]);
    // row 7: render the Phase H report with the master's read-only state renderer when it sits beside this skill
    const STATUS = resolve(HERE, '..', '..', 'stardust', 'scripts', 'status.mjs');
    if (open.has('report') && start && existsSync(STATUS)) {
      const rep = spawnSync(process.execPath, [STATUS, '--root', ROOT, '--markdown', '--no-probe'], { encoding: 'utf8', cwd: ROOT });
      if (rep.status === 0 && /report-check:/i.test(rep.stdout)) { mkdirSync(join(OUT, 'report'), { recursive: true }); const f = join(OUT, 'report', `${String(start.ts).replace(/[:.]/g, '-')}.md`); writeFileSync(f, rep.stdout); console.log(`--fix status.mjs --markdown → ${relative(ROOT, f)}`); } else console.log(`--fix status.mjs --markdown: exit ${rep.status} — report left to the agent\n${(rep.stderr || '').trim()}`);
    } else if (open.has('report') && !existsSync(STATUS)) console.log('--fix report: skills/stardust/scripts/status.mjs not beside this skill — write the Phase H block by hand');
    for (const [name, a] of runs) { const r = spawnSync(process.execPath, a, { encoding: 'utf8', cwd: ROOT }); console.log(`--fix ${name}: exit ${r.status}${r.status ? `\n${(r.stderr || r.stdout).trim()}` : ''}`); }
    check();
  }
  if (skipRow && rows.some((r) => r.id === skipRow && r.mark === '~')) {
    const jp = join(SD, 'journal.md');
    if (existsSync(jp)) appendFileSync(jp, `\n- close-check: row \`${skipRow}\` skipped — ${skipReason} (${new Date().toISOString()})\n`);
  }

  const openRows = rows.filter((r) => r.mark === ' ');
  const exit = openRows.length ? 1 : 0;
  if (has(argv, 'json')) console.log(JSON.stringify({ wave: start ? { start: start.ts, phase: start.phase } : null, rows, exit }, null, 2));
  else {
    console.log(`close-check — wave since ${start ? `${start.ts} (${start.phase} start)` : 'unknown (no rollout start line)'}`);
    for (const r of rows) console.log(`[${r.mark}] ${r.text}${r.fix ? `\n      → ${r.fix}` : ''}`);
    console.log(exit ? `not closed: ${openRows.length} required row(s) open — do the → commands, re-run; the report may not say "closed" or "ready for review".` : 'closed: every required row is met — journal `end` line, then the next wave (hands-off) or the hand-off.');
  }
  console.log(`SUMMARY close-check ok=${rows.filter((r) => r.mark === 'x').length} failed=${openRows.length} exit=${exit} details=${statusPath}`);
  process.exit(exit);
}
if (isMain) main();
