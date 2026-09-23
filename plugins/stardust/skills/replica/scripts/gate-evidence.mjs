#!/usr/bin/env node
/**
 * skills/replica/scripts/gate-evidence.mjs
 *
 * Phase 5 handoff collector: fill every migrated page's `_meta.json` sidecar
 * (`gatesPassed[]` + `gateEvidence{}`) from the evidence the earlier phases already
 * left on disk, and roll the same facts into `stardust/replica/progress.json`.
 * Nothing is measured here. The collector reads run-bg's job state
 * (`<bg>/<job>.json`, through run-bg's own reader) and each job's log
 * (`<bg>/<job>.log`), attributes a job to a page by the job's ARGUMENTS — never by
 * grepping log prose — takes the LATEST ended job per page × instrument × width by
 * its `endedAt` (never by file mtime; jobs still running are skipped), and runs
 * delivery-lint in-process per page because it is static and fast. A gate is
 * added only when its instrument printed a pass; a fail or open verdict is still
 * written into `gateEvidence`, prefixed `FAIL: ` / `OPEN: `, so the reader sees why
 * the gate is missing. Existing entries are never removed.
 *
 * Gates derived (each evidence one-liner ends with its `(<job>.log)` pointer):
 *   pixel-gate-<width>  latest gate.sh round at that width (gate.sh <slug> … <width>) whose
 *                       pixel-compare line reads `→ PASS` with |height delta| ≤ --height-tolerance
 *   content-count       latest content-diff.mjs job for the page (`Findings: none …` or
 *                       `Findings: N (0 structural 🔴)`); when no such job exists, the newest
 *                       gate.sh --full round's `content-diff:` line; structural 🔴 > 0 → OPEN:
 *   media-reconcile     latest media-reconcile.mjs job whose counts line has no `omit` and no
 *                       `unresolved` (the instrument's own exit-1 rule); either → OPEN:
 *   delivery-lint       --lint run per page (`--file <html> --path </da/path>`), pass on
 *                       `0 P0 · 0 P1`; when --lint does not resolve, the latest delivery-lint.mjs
 *                       job for the page; P0/P1 → FAIL:
 *   variance-probe      siblings only: latest sibling-variance.mjs job (exit 0 or 2 = a verdict)
 *                       that named this page's URL or its archetype's; the page's `■` line is
 *                       the evidence; deltas reported with an empty `variants[]` → OPEN:
 *   content-fidelity    NEVER added here — it is the agent's declaration
 *                       (`migrate.mjs gate <slug> content-fidelity --evidence …`)
 *
 * Usage:
 *   node stardust/scripts/replica/gate-evidence.mjs [--migrated stardust/migrated]
 *        [--bg stardust/.work/replica/bg] [--progress stardust/replica/progress.json]
 *        [--lint stardust/scripts/rollout/delivery-lint.mjs] [--widths 1440,360]
 *        [--height-tolerance 8] [--slug <s>]… [--check] [--dry-run] [--json]
 *
 *   --slug <s>   only these pages (repeatable): rows and sidecar writes; the progress
 *                ledger's `migrate` totals are rewritten only by an unfiltered run
 *   --check      exit 2 when a sibling lacks a gate of the acceptance set: variance-probe,
 *                pixel-gate-<w> for EVERY --widths entry, delivery-lint, media-reconcile,
 *                content-fidelity, content-count. The pixel gates belong to the set: a recorded
 *                run published eleven siblings that had never been compared at 360, and they
 *                read 17–27 % against the ≤ 10 % bar on the published origin. Archetypes and
 *                thin pages are not held to this set here (their `missing` is always empty)
 *   --dry-run    compute and print, write nothing
 *   --json       the rows as a JSON array instead of the table
 *
 * Prints one row per page — `<slug>  <tier>  1440=<pct>%/Δ<px>  360=…  cd=<…>  lint=<…>
 * media=<…>  gates=<n>` — then `gate-evidence: <n> pages, <n> sidecars updated`.
 * Exit 0; 1 usage error; 2 --check found a sibling short of the acceptance set.
 *
 * Writes: each page's sidecar (`_meta.json` / `<name>._meta.json`): `gatesPassed[]` =
 * existing ∪ derived (existing first) and `gateEvidence{}` merged (derived lines overwrite
 * the same key) — nothing else, indent preserved. `--progress`: `migrate` {at, pages,
 * archetypes, siblings, thin, gates{<gate>: <pass count>}, missing{<slug>: [<gates>]}} and
 * `siblings{<slug>: {archetype, variants, pixel{<width>: {pct, px, heightDelta, verdict,
 * label}}, contentDiff, deliveryLint, media, gatesPassed, migrated}}`, other keys preserved.
 * Nothing with --dry-run or --help.
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len, no-continue */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listJobs, logPath } from './run-bg.mjs';

export const DEFAULTS = { migrated: 'stardust/migrated', bg: 'stardust/.work/replica/bg', progress: 'stardust/replica/progress.json', lint: 'stardust/scripts/rollout/delivery-lint.mjs', widths: [1440, 360], heightTolerance: 8 };
// The sibling acceptance set for one --widths list: a pixel gate per width, in the order given. Every reader of the set
// (--check, the row's `missing`, progress.json migrate.missing) goes through this; archetypes and thin pages are not held to it.
export const acceptanceFor = (widths) => ['variance-probe', ...widths.map((w) => `pixel-gate-${w}`), 'delivery-lint', 'media-reconcile', 'content-fidelity', 'content-count'];
// The set for the default widths (1440, 360) — kept for importers.
export const ACCEPTANCE = acceptanceFor(DEFAULTS.widths);
// Instrument script → job kind. The instrument is the first cmd/arg token with one of these basenames
// (a wrapper such as bash or run-capped may precede it); its own arguments follow.
export const INSTRUMENTS = { 'gate.sh': 'pixel', 'content-diff.mjs': 'content-diff', 'media-reconcile.mjs': 'media-reconcile', 'delivery-lint.mjs': 'delivery-lint', 'sibling-variance.mjs': 'variance' };
const SELF = fileURLToPath(import.meta.url);
const HERE = dirname(SELF);

class UsageError extends Error {}

function help() {
  const header = readFileSync(SELF, 'utf8').match(/\/\*\*[\s\S]*?\*\//);
  return header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header';
}

export function parseArgs(argv) {
  const o = { ...DEFAULTS, widths: [...DEFAULTS.widths], lintGiven: false, slugs: [], check: false, dryRun: false, json: false };
  const val = (flag, v) => { if (v === undefined || v.startsWith('--')) throw new UsageError(`gate-evidence: ${flag} needs a value (see --help)`); return v; };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--migrated') o.migrated = val(a, argv[++i]);
    else if (a === '--bg') o.bg = val(a, argv[++i]);
    else if (a === '--progress') o.progress = val(a, argv[++i]);
    else if (a === '--lint') { o.lint = val(a, argv[++i]); o.lintGiven = true; }
    else if (a === '--widths') { o.widths = val(a, argv[++i]).split(',').map((w) => Number(w.trim())); if (!o.widths.length || o.widths.some((w) => !Number.isInteger(w) || w <= 0)) throw new UsageError(`gate-evidence: --widths needs a comma list of pixel widths (got "${argv[i]}")`); }
    else if (a === '--height-tolerance') { o.heightTolerance = Number(val(a, argv[++i])); if (!Number.isFinite(o.heightTolerance) || o.heightTolerance < 0) throw new UsageError('gate-evidence: --height-tolerance needs a number of pixels'); }
    else if (a === '--slug') o.slugs.push(val(a, argv[++i]));
    else if (a === '--check') o.check = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--json') o.json = true;
    else throw new UsageError(`gate-evidence: unknown argument ${a} (see --help)`);
  }
  return o;
}

// ---- sidecars ----------------------------------------------------------------------------------
// `_meta.json` sits beside `index.html`; `<name>._meta.json` beside `<name>.html` (migration-procedure.md § `_meta.json` sidecar).
export function sidecarHtml(file) {
  const b = basename(file);
  if (b === '_meta.json') return 'index.html';
  if (b.endsWith('._meta.json')) return `${b.slice(0, -'._meta.json'.length)}.html`;
  return null;
}
// The indent the file was written with (run-bg and the recorded migrations use 1 space, others 2) — or 2 for a one-line file.
export function detectIndent(text) { const m = text.match(/^[{[]\r?\n([ \t]+)/); return m ? m[1] : 2; }
function readJson(file) {
  const text = readFileSync(file, 'utf8');
  let data; try { data = JSON.parse(text); } catch (e) { throw new UsageError(`gate-evidence: ${file}: ${e.message}`); }
  return { data, text, indent: detectIndent(text), eol: text.endsWith('\n') };
}
const serialize = (data, indent, eol) => JSON.stringify(data, null, indent) + (eol ? '\n' : '');

export function findSidecars(migrated) {
  const out = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir).sort()) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      const html = sidecarHtml(p);
      if (!html) continue;
      const j = readJson(p);
      out.push({ file: p, meta: j.data, text: j.text, indent: j.indent, eol: j.eol, slug: j.data.slug, htmlFile: join(dir, html), outputPath: relative(migrated, join(dir, html)).split(sep).join('/') });
    }
  };
  if (existsSync(migrated)) walk(migrated);
  return out;
}

// ---- run-bg jobs -------------------------------------------------------------------------------
export function classify(job) {
  const tokens = [job.cmd, ...(Array.isArray(job.args) ? job.args : [])].filter((t) => typeof t === 'string');
  for (let i = 0; i < tokens.length; i += 1) {
    const kind = INSTRUMENTS[basename(tokens[i])];
    if (kind) return { kind, instArgs: tokens.slice(i + 1) };
  }
  return null;
}
export const jobAt = (job) => Date.parse(job.endedAt || job.launchedAt || job.queuedAt || '') || 0;

// Every ENDED job that ran a known instrument, with its log text. A job without `endedAt` (queued, running, or lost
// with its wrapper) has no verdict and is skipped — run-bg's state, never the log's mtime, decides.
export function loadJobs(bg) {
  const out = [];
  for (const st of listJobs(bg)) {
    if (!st.endedAt) continue;
    const c = classify(st);
    if (!c) continue;
    let log = ''; try { log = readFileSync(logPath(bg, st.name), 'utf8'); } catch { /* no log — nothing to parse */ }
    out.push({ ...st, ...c, log, logName: `${st.name}.log` });
  }
  return out.sort((a, b) => jobAt(a) - jobAt(b));
}

// The URL paths a page answers to: `tours/north/index.html` → /tours/north/index.html, /tours/north/, /tours/north;
// `about/history.html` → /about/history.html, /about/history; `index.html` → /index.html, /.
export function pagePaths(outputPath) {
  const full = `/${outputPath}`;
  const set = new Set([full]);
  if (full.endsWith('/index.html')) { const d = full.slice(0, -'index.html'.length); set.add(d); if (d !== '/') set.add(d.slice(0, -1)); }
  else if (full.endsWith('.html')) set.add(full.slice(0, -5));
  return [...set];
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isUrl = (s) => /^https?:\/\//i.test(s);
const urlPath = (s) => { try { return decodeURIComponent(new URL(s).pathname) || '/'; } catch { return null; } };

// Does one argument name the page? A URL by its path, the prototype file `<slug>-proposed.html` (slug at a word
// boundary, so `north` does not claim `tours-north-proposed.html`), or a file by where it resolves from the job's cwd.
export function argNamesPage(arg, page, job, migrated) {
  if (typeof arg !== 'string') return false;
  if (isUrl(arg)) { const p = urlPath(arg); return p !== null && pagePaths(page.outputPath).includes(p); }
  if (new RegExp(`(^|[^A-Za-z0-9_-])${escapeRe(page.slug)}-proposed\\.html`).test(arg)) return true;
  if (!migrated) return false;
  return resolve(job.cwd || process.cwd(), arg) === resolve(migrated, page.outputPath);
}
// The slug a job name `<slug>-…` belongs to: the LONGEST known slug that prefixes it (`tours-north-1440` is tours-north's, not tours').
export function nameOwner(name, slugs) { return slugs.filter((s) => name.startsWith(`${s}-`)).sort((a, b) => b.length - a.length)[0] || null; }

// gate.sh: its first argument IS the slug. Other instruments: an argument names the page; last resort, the job name.
export function attribute(job, page, ctx = {}) {
  if (job.kind === 'pixel') return job.instArgs[0] === page.slug;
  if (job.instArgs.some((a) => argNamesPage(a, page, job, ctx.migrated))) return true;
  return ctx.slugs ? nameOwner(job.name, ctx.slugs) === page.slug : job.name.startsWith(`${page.slug}-`);
}

// ---- verdict parsers (pure) --------------------------------------------------------------------
// pixel-compare: `A WxH  B WxH  → compare WxH, height delta Npx` then `differing pixels: n / m = p%  (threshold t%) → PASS|FAIL…`.
export function parseVerdict(text) {
  const v = [...text.matchAll(/differing pixels: (\d+) \/ (\d+) = ([\d.]+)%\s+\(threshold ([\d.]+)%\) → (PASS|FAIL)/g)].pop();
  if (!v) return null;
  const h = [...text.matchAll(/→ compare \d+x\d+, height delta (-?\d+)px/g)].pop();
  return { px: Number(v[1]), total: Number(v[2]), pct: Number(v[3]), threshold: Number(v[4]), verdict: v[5], heightDelta: h ? Number(h[1]) : null };
}
// content-diff: `Findings: none — content + roles match` | `Findings: N (S structural 🔴)`; gate.sh --full echoes the same after `content-diff: `.
export function parseFindings(text) {
  const m = [...text.matchAll(/^(?:Findings|content-diff): (none[^\n]*|(\d+) \((\d+) structural[^\n]*)$/gm)].pop();
  if (!m) return null;
  return { total: m[2] === undefined ? 0 : Number(m[2]), structural: m[3] === undefined ? 0 : Number(m[3]), text: m[1].trim() };
}
// media-reconcile: last line `<n> keep · <n> optimize · <n> omit …` — one `<n> <decision>` per decision that occurred.
export function parseCounts(text) {
  const m = [...text.matchAll(/^((?:\d+ [a-z]+)(?: · \d+ [a-z]+)*)[ \t]*$/gm)].pop();
  if (!m) return null;
  const counts = {}; for (const part of m[1].split(' · ')) { const [n, k] = part.split(' '); counts[k] = Number(n); }
  return { counts, line: m[1] };
}
// delivery-lint: `<n> P0 · <n> P1 · <n> P2`.
export function parseLint(text) {
  const m = [...text.matchAll(/^(\d+) P0 · (\d+) P1 · (\d+) P2[ \t]*$/gm)].pop();
  return m ? { p0: Number(m[1]), p1: Number(m[2]), p2: Number(m[3]), line: `${m[1]} P0 · ${m[2]} P1 · ${m[3]} P2` } : null;
}
// sibling-variance: per sibling `■ <url>: ✓ matches the archetype | N delta(s)`, then a `✓|✗ … sibling(s) …` summary.
// `paths` = the page's own URL paths; its `■` line is the evidence when present, else the summary.
export function parseVariance(text, paths = []) {
  const summary = [...text.matchAll(/^[✓✗] \d+ (?:of \d+ )?sibling\(s\) [^\n]*$/gm)].pop();
  const own = [...text.matchAll(/^■ (\S+): ([^\n]*)$/gm)].find((m) => { const p = urlPath(m[1]); return p !== null && paths.includes(p); });
  if (!summary && !own) return null;
  const d = own && own[2].match(/^(\d+) delta/);
  return { summary: summary ? summary[0] : null, line: own ? own[0] : summary[0], deltas: own ? (d ? Number(d[1]) : 0) : null };
}

// ---- derivation --------------------------------------------------------------------------------
const latest = (items, at = (x) => jobAt(x.j)) => items.reduce((best, x) => (!best || at(x) > at(best) ? x : best), null);
const fmtPct = (n) => `${n.toFixed(2)}%`;
// The `--path` delivery-lint expects: the output path without `.html` and without a trailing `/index`; the root page is `/`.
export function daPath(outputPath) { return `/${outputPath}`.replace(/\.html$/, '').replace(/\/index$/, '') || '/'; }

export function runLint(lint, page) {
  const args = [lint, '--file', page.htmlFile, '--path', daPath(page.outputPath)];
  let out = ''; let code = 0;
  try { out = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }); }
  catch (e) { out = String(e.stdout || ''); code = typeof e.status === 'number' ? e.status : 1; if (!out.trim()) return { ok: false, line: `delivery-lint gave no output (exit ${code}): ${String(e.stderr || e.message).trim().split('\n')[0].slice(0, 160)}` }; }
  const l = parseLint(out);
  return l ? { ok: l.p0 === 0 && l.p1 === 0, line: l.line } : { ok: false, line: `delivery-lint printed no summary line (exit ${code})` };
}

// Every gate one page earns from the jobs attributed to it. Returns { gates, evidence, facts, notes }; the caller merges.
export function derive(page, jobs, o, ctx) {
  const mine = jobs.filter((j) => attribute(j, page, ctx));
  const gates = []; const evidence = {}; const notes = [];
  const facts = { pixel: {}, contentDiff: null, deliveryLint: null, media: null, variance: null };
  const pass = (g, line) => { gates.push(g); evidence[g] = line; };
  const open = (g, line, prefix = 'OPEN') => { evidence[g] = `${prefix}: ${line}`; };
  const cite = (j) => `(${j.logName})`;
  const parsed = (kinds, parse) => mine.filter((j) => kinds.includes(j.kind)).map((j) => ({ j, v: parse(j.log) })).filter((x) => x.v);

  for (const w of o.widths) {
    const best = latest(parsed(['pixel'], parseVerdict).filter((x) => Number(x.j.instArgs[3]) === w));
    if (!best) continue;
    const { j, v } = best;
    const label = j.instArgs[4] && !j.instArgs[4].startsWith('--') ? j.instArgs[4] : 'iter';
    facts.pixel[w] = { pct: v.pct, px: v.px, heightDelta: v.heightDelta, verdict: v.verdict, label };
    const line = `${fmtPct(v.pct)} (${v.px} px, threshold ${v.threshold}%), height delta ${v.heightDelta === null ? '?' : v.heightDelta}px, round ${label} @${w} ${cite(j)}`;
    const withinHeight = v.heightDelta !== null && Math.abs(v.heightDelta) <= o.heightTolerance;
    if (v.verdict === 'PASS' && withinHeight) pass(`pixel-gate-${w}`, line);
    else open(`pixel-gate-${w}`, v.verdict === 'PASS' ? `|height delta| > ${o.heightTolerance}px tolerance — ${line}` : line, 'FAIL');
  }

  // The dedicated content-diff run is the acceptance check; a gate.sh --full round's line stands in only when there is none.
  const dedicated = parsed(['content-diff'], parseFindings);
  const cd = latest(dedicated.length ? dedicated : parsed(['pixel'], parseFindings));
  if (cd) {
    facts.contentDiff = cd.v.text;
    const line = `content-diff: ${cd.v.text} ${cite(cd.j)}`;
    if (cd.v.structural === 0) pass('content-count', line); else open('content-count', line);
  }

  const md = latest(parsed(['media-reconcile'], parseCounts));
  if (md) {
    facts.media = md.v.line;
    const held = ['omit', 'unresolved'].filter((k) => md.v.counts[k] > 0).map((k) => `${md.v.counts[k]} ${k}`);
    const line = `${md.v.line} ${cite(md.j)}`;
    if (!held.length) pass('media-reconcile', line); else open('media-reconcile', `${held.join(', ')} hold the gate — ${line}`);
  }

  if (ctx.lint) {
    if (!existsSync(page.htmlFile)) notes.push(`${page.slug}: ${page.htmlFile} missing — delivery-lint skipped`);
    else {
      const r = runLint(ctx.lint, page); facts.deliveryLint = r.line;
      const line = `${r.line} (delivery-lint --path ${daPath(page.outputPath)})`;
      if (r.ok) pass('delivery-lint', line); else open('delivery-lint', line, 'FAIL');
    }
  } else {
    const lj = latest(parsed(['delivery-lint'], parseLint));
    if (lj) { facts.deliveryLint = lj.v.line; const line = `${lj.v.line} ${cite(lj.j)}`; if (lj.v.p0 === 0 && lj.v.p1 === 0) pass('delivery-lint', line); else open('delivery-lint', line, 'FAIL'); }
  }

  if (page.meta.fidelityTier === 'sibling') {
    const archSlug = page.meta.archetypeSource || page.meta.template || null;
    const arch = archSlug ? (ctx.pages || []).find((p) => p.slug === archSlug) || null : null;
    const paths = pagePaths(page.outputPath);
    const probes = jobs.filter((j) => j.kind === 'variance' && [0, 2].includes(j.exit) && (mine.includes(j) || (arch && attribute(j, arch, ctx))));
    const vj = latest(probes.map((j) => ({ j, v: parseVariance(j.log, paths) })).filter((x) => x.v));
    if (vj) {
      facts.variance = vj.v.line;
      const variants = Array.isArray(page.meta.variants) ? page.meta.variants : [];
      const line = `${vj.v.line}${variants.length ? ` — variants [${variants.join(', ')}]` : ''} ${cite(vj.j)}`;
      if (vj.v.deltas && !variants.length) open('variance-probe', `${vj.v.deltas} delta(s) and no variants[] declared — ${line}`); else pass('variance-probe', line);
    }
  }
  return { gates, evidence, facts, notes };
}

// ---- sidecar merge -----------------------------------------------------------------------------
// gatesPassed = existing ∪ derived (existing first, deduped); gateEvidence merged, derived lines overwrite the same key.
// `stale` names gates the sidecar already lists whose LATEST evidence now reads FAIL/OPEN — kept (never removed), but reported.
export function mergeMeta(meta, derived) {
  const existing = Array.isArray(meta.gatesPassed) ? meta.gatesPassed : [];
  const gatesPassed = [...existing];
  for (const g of derived.gates) if (!gatesPassed.includes(g)) gatesPassed.push(g);
  const stale = existing.filter((g) => /^(FAIL|OPEN): /.test(derived.evidence[g] || ''));
  const prior = meta.gateEvidence && typeof meta.gateEvidence === 'object' && !Array.isArray(meta.gateEvidence) ? meta.gateEvidence : {};
  return { meta: { ...meta, gatesPassed, gateEvidence: { ...prior, ...derived.evidence } }, stale };
}

// ---- progress ledger ---------------------------------------------------------------------------
// `siblings` is merged per slug; `migrate` (totals, per-gate pass counts, the siblings' missing gates) is rebuilt only by
// an unfiltered run — a --slug run must not shrink the ledger's totals. Every other key in the file is preserved.
export function buildProgress(existing, rows, { partial = false } = {}) {
  const out = { ...existing };
  const sib = rows.filter((r) => r.tier === 'sibling');
  out.siblings = { ...(existing.siblings || {}) };
  for (const r of sib) out.siblings[r.slug] = { archetype: r.archetype, variants: r.variants, pixel: r.pixel, contentDiff: r.contentDiff, deliveryLint: r.deliveryLint, media: r.media, gatesPassed: r.gatesPassed, migrated: r.migrated };
  if (partial) return out;
  const gates = {}; for (const r of rows) for (const g of r.gatesPassed) gates[g] = (gates[g] || 0) + 1;
  const missing = {}; for (const r of sib) if (r.missing.length) missing[r.slug] = r.missing;
  const count = (tier) => rows.filter((r) => r.tier === tier).length;
  out.migrate = { ...(existing.migrate || {}), at: new Date().toISOString(), pages: rows.length, archetypes: count('archetype'), siblings: sib.length, thin: count('thin'), gates, missing };
  return out;
}

// ---- rows --------------------------------------------------------------------------------------
const compact = (s) => (s === null || s === undefined ? '—' : String(s).replace(/ /g, ''));
export function formatRow(r, widths) {
  const px = widths.map((w) => `${w}=${r.pixel[w] ? `${fmtPct(r.pixel[w].pct)}/Δ${r.pixel[w].heightDelta}` : '—'}`).join('  ');
  const cd = r.contentDiff === null ? '—' : (/^none/.test(r.contentDiff) ? 'none' : compact(r.contentDiff.replace(/ structural 🔴\)/, '🔴)')));
  return `${r.slug}  ${r.tier || '—'}  ${px}  cd=${cd}  lint=${compact(r.deliveryLint)}  media=${compact(r.media)}  gates=${r.gatesPassed.length}`;
}

function resolveLint(o) {
  // The project copy sits beside this script's copy (stardust/scripts/rollout/); in the plugin tree it is the rollout skill's.
  const candidates = [o.lint];
  if (!o.lintGiven) candidates.push(resolve(HERE, '../rollout/delivery-lint.mjs'), resolve(HERE, '../../rollout/scripts/delivery-lint.mjs'));
  return candidates.find((p) => existsSync(p) && statSync(p).isFile()) || null;
}

export function collect(o) {
  const migrated = resolve(o.migrated);
  const notes = [];
  const pages = findSidecars(migrated).filter((s) => { if (s.slug) return true; notes.push(`${relative(process.cwd(), s.file)}: no slug — skipped`); return false; });
  const unknown = o.slugs.filter((s) => !pages.some((p) => p.slug === s));
  if (unknown.length) throw new UsageError(`gate-evidence: no sidecar with slug ${unknown.join(', ')} under ${o.migrated}`);
  const selected = o.slugs.length ? pages.filter((p) => o.slugs.includes(p.slug)) : pages;
  const jobs = loadJobs(resolve(o.bg));
  const lint = resolveLint(o);
  if (!lint) notes.push(`delivery-lint: ${o.lint} not found — pass --lint (using run-bg delivery-lint jobs, if any)`);
  const ctx = { migrated, pages, slugs: pages.map((p) => p.slug), lint };
  const acceptance = acceptanceFor(o.widths);
  const rows = []; let updated = 0;
  for (const page of selected) {
    const d = derive(page, jobs, o, ctx);
    notes.push(...d.notes);
    const { meta, stale } = mergeMeta(page.meta, d);
    for (const g of stale) notes.push(`${page.slug}: ${g} stays in gatesPassed, but the latest evidence reads "${meta.gateEvidence[g].slice(0, 100)}"`);
    const text = serialize(meta, page.indent, page.eol);
    if (text !== page.text) { updated += 1; if (!o.dryRun) writeFileSync(page.file, text); }
    const tier = meta.fidelityTier || null;
    rows.push({ slug: page.slug, tier, archetype: meta.archetypeSource || meta.template || null, variants: Array.isArray(meta.variants) ? meta.variants : [], outputPath: page.outputPath, migrated: join(o.migrated, page.outputPath), ...d.facts, gatesPassed: meta.gatesPassed, gateEvidence: meta.gateEvidence, missing: tier === 'sibling' ? acceptance.filter((g) => !meta.gatesPassed.includes(g)) : [] });
  }
  if (rows.length && !o.dryRun) {
    const prior = existsSync(o.progress) ? readJson(o.progress) : { data: {}, indent: 2, eol: true };
    mkdirSync(dirname(resolve(o.progress)), { recursive: true });
    writeFileSync(o.progress, serialize(buildProgress(prior.data, rows, { partial: o.slugs.length > 0 }), prior.indent, prior.eol));
  }
  return { rows, updated, notes };
}

// ---- cli ---------------------------------------------------------------------------------------
function cli(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(help()); return 0; }
  const o = parseArgs(argv);
  const r = collect(o);
  for (const n of r.notes) console.error(`gate-evidence: ${n}`);
  if (!r.rows.length) { console.log(`gate-evidence: no _meta.json sidecars${o.slugs.length ? ` for --slug ${o.slugs.join(', ')}` : ''} under ${o.migrated} — nothing to collect`); return 0; }
  const short = r.rows.filter((row) => row.missing.length);
  if (o.json) console.log(JSON.stringify(r.rows, null, 2));
  else {
    for (const row of r.rows) console.log(formatRow(row, o.widths));
    for (const row of short) console.log(`${row.slug}: missing ${row.missing.join(', ')}`);
    const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
    console.log(`gate-evidence: ${n(r.rows.length, 'page')}, ${n(r.updated, 'sidecar')} ${o.dryRun ? 'would be updated (dry-run: nothing written)' : 'updated'}`);
  }
  return o.check && short.length ? 2 : 0;
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  try { process.exitCode = cli(process.argv.slice(2)); }
  catch (e) { console.error(e instanceof UsageError ? e.message : `gate-evidence: ${e.stack || e.message}`); process.exitCode = 1; }
}
