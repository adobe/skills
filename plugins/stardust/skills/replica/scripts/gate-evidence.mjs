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
 * Gates derived (each evidence one-liner carries its `(<job>.log)` pointer):
 *   pixel-gate-<width>  latest gate.sh round at that width (gate.sh <slug> <live> <build> <width>
 *                       [label]) whose pixel-compare line reads `→ PASS` with |height delta| ≤
 *                       --height-tolerance AND whose overflow assert did not fire: a round whose log
 *                       carries gate.sh's `OVERFLOW at <w> — build scrollWidth <n> > viewport <n>
 *                       (+<n>px)` line is `FAIL: horizontal overflow +<n>px …` whatever the pixel
 *                       line says (a recorded run passed two pages 373 and 400 px wide at 360 as
 *                       residuals; the assert is the one no iteration cap waives). The line ends
 *                       with the round's REGIME, read from the
 *                       build URL argument: localhost / 127.0.0.1 / file: → `[prototype regime]`,
 *                       anything else → `[published regime]`. The prototype-regime bar is the
 *                       archetype's; siblings are gated in the published regime only (#126); it never replaces the published-origin gate
 *                       (gate.sh header: "the published-origin gate is the same command with the
 *                       preview URL") — a reader who needs the published verdict looks for that word.
 *                       A --full round's element lines outrank its pixel PASS the way the overflow
 *                       assert does (#125): `clip-probe: Clipped: <n>` with n > 0 or `content-
 *                       presence: Content: MISSING <n> … HIDDEN <n>` with a count > 0 → FAIL. THE
 *                       PIXEL TABLE IS THE SOURCE OF RECORD (#125 rule: every crafted prototype and
 *                       every deployed page is a row in `<tables>/prototypes-<w>/summary.json` or
 *                       `<tables>/all-<w>/summary.json`, written by gate-all.mjs): when a table
 *                       exists for the width, the page's row decides the gate (published row first)
 *                       and a page WITHOUT a row is OPEN: no table row — whatever a gate.sh log
 *                       says. Without any table the log rule above stands and one note names the
 *                       missing table.
 *   content-count       latest content-diff.mjs job for the page (`Findings: none …` or
 *                       `Findings: N (0 structural 🔴)` and nothing-lost 🟡 0); when no such job exists, the
 *                       newest gate.sh --full round's `content-diff:` line; structural 🔴 or nothing-lost > 0 → OPEN:
 *   media-reconcile     latest media-reconcile.mjs job whose counts line has no `omit` and no
 *                       `unresolved` (the instrument's own exit-1 rule); either → OPEN: — but only once
 *                       the page's DELIVERED content file exists (`<--content>/<da-path>.html`, or
 *                       `<da-path>/index.html`; the root page is `index.html`). Before that the gate is
 *                       not required: the evidence reads `n/a: no delivered content file yet (<file>) —
 *                       media-reconcile runs in the delivery chain (row C)`, the sibling acceptance set
 *                       skips it, and a passing job still passes. A recorded run demanded it on
 *                       prototype files and every sibling sidecar carried `media-reconcile: OPEN` until
 *                       delivery. Once the file exists the gate is required again.
 *   delivery-lint       --lint run per page (`--file <html> --path </da/path>`), pass on
 *                       `0 P0 · 0 P1`; when --lint does not resolve, the latest delivery-lint.mjs
 *                       job for the page; P0/P1 → FAIL:
 *   variance-probe      siblings only: latest sibling-variance.mjs job that named this page's URL
 *                       or its archetype's. ONLY the page's own `■ <url>` line is evidence: 0 deltas
 *                       pass, deltas pass only with a declared `variants[]`, deltas with an empty
 *                       `variants[]` → OPEN:. A probe whose output has no `■` line for the page
 *                       never passes — `OPEN: not in the probe — <✓|✗ summary>` — whatever the
 *                       summary says.
 *   content-fidelity    NEVER added here — it is the agent's declaration
 *                       (`migrate.mjs gate <slug> content-fidelity --evidence …`)
 *
 * The NEWEST ended job per page × instrument (× width) decides, and only a verdict can pass:
 *   • run-bg state `timedOut: true` or `exit 124` (the instrument's deadline) →
 *     `OPEN: deadline (<job>.log) — re-run` for that gate; an older pass is not resurrected.
 *   • a pixel round whose exit is not 0 or 2 (gate.sh: 1 = capture/compare error, 3 = bot
 *     challenge, 4 = build-side identity failed) → `OPEN: no verdict (exit N) (<job>.log)`.
 *     Exit 6 (a round refused at the cap) measured nothing and is skipped: the last measured round stands.
 *   • a sibling-variance probe with an exit other than 0 or 2 → the same `OPEN: no verdict`.
 *
 * Attribution: gate.sh by its slug argument; other instruments by an argument that names the page
 * (URL path, `<slug>-proposed.html`, a file resolved from the job's cwd). The job-name fallback
 * (`<slug>-…`) applies only when NO argument names ANY known page — a job whose arguments name
 * another page is that page's, whatever it was called.
 *
 * Usage:
 *   node stardust/scripts/replica/gate-evidence.mjs [--migrated stardust/migrated]
 *        [--bg stardust/.work/replica/bg] [--progress stardust/replica/progress.json]
 *        [--lint stardust/scripts/rollout/delivery-lint.mjs] [--content content] [--widths 1440,360]
 *        [--height-tolerance 8] [--tables stardust/replica/gates] [--slug <s>]… [--check] [--dry-run] [--json]
 *   node stardust/scripts/replica/gate-evidence.mjs --unit <slug,…|@file> [--tables …] [--widths 1440,360] [--json]
 *        [--content content] [--state stardust/state.json] [--coverage stardust/rollout/coverage/pages.json]
 *
 *   --unit <slug,…|@file>  the CLOSE CHECK of a delivery unit (handoff-contract.md § 1 row 5): no sidecar is read or
 *                written. Each named page (a comma list, or @file with one slug per line) needs a MEASURED row (a
 *                percentage and no probe error — gate-all's error row is no measurement) at every --widths entry, in `<tables>/all-<w>/`
 *                summary.json or runs/*.json (gate-all --only / --sample; the newest by _provenance.writtenAt).
 *                A page a `--sample` run left out (its run file's _provenance.sample: in `from`, not `picked`)
 *                is `sweep` — pending the all-pages run, not ungated — unless a row of the page is newer than that run. Prints `<slug>  1440=<pass|fail|sweep|stale|
 *                none|error> [<pct>%]  360=…`, one `<slug>: NOT gated at <w> — <why>` line per gap, then the totals
 *                (failing rows named: a measured FAIL is fixed within the round cap or decided, it does not hold
 *                the unit here). A PASS row counts only while the page's recorded pass (`<tables>/all-<w>/<slug>/
 *                pixel.json`, the key of gate-all's § REUSE) still matches the page's local build inputs: its
 *                content file and migrated HTML, the blocks it uses, the shared code (read from --content, --state
 *                and --coverage, as gate-all reads them). Else the cell is `stale`, NOT gated, naming what changed;
 *                so is a pass row whose page dir holds no pass with a key of this version (captured again since, an
 *                older version's record, a --compare-only pass). `gate-all.mjs --only <slugs> --skip-existing`
 *                gates exactly those again. A pass by override and a FAIL are not checked against the inputs, nor
 *                is a page gate-all cannot key (no content file or migrated HTML, no blocks/, no shared code: its
 *                passes are recorded without a key, and the table row stands alone).
 *                Exit 2 when a page is NOT gated at a width.
 *
 *   --tables <dir>  where gate-all.mjs writes the pixel tables (`prototypes-<w>/`, `all-<w>/`); when
 *                one exists for a width its rows decide pixel-gate-<w> and a page without a row is
 *                OPEN
 *   --slug <s>   only these pages (repeatable): rows and sidecar writes; the progress
 *                ledger's `migrate` totals are rewritten only by an unfiltered run
 *   --content <dir>  the delivered content tree (default `content`, the deploy driver's) — the
 *                media-reconcile gate is required only for a page whose file exists there
 *   --check      exit 2 when a sibling lacks a gate of the acceptance set: variance-probe,
 *                pixel-gate-<w> for EVERY --widths entry, delivery-lint, media-reconcile (only once
 *                the page's delivered content file exists — above), content-fidelity,
 *                content-count. The pixel gates belong to the set: a recorded
 *                run published eleven siblings that had never been compared at 360, and they
 *                read 17–27 % against the ≤ 10 % bar on the published origin. Archetypes and
 *                thin pages are not held to this set here (their `missing` is always empty).
 *                Also exit 2, for ANY tier, on a STALE gate: one that sits in gatesPassed[] while
 *                its latest evidence reads FAIL:/OPEN: — printed as `<slug>: stale <gates> — …`
 *                (the gate is never removed; the line names what must be re-earned)
 *   --dry-run    compute and print, write nothing
 *   --json       the rows as a JSON array instead of the table
 *
 * Prints one row per page — `<slug>  <tier>  1440=<pct>%/Δ<px>[/ovf+<px>]  360=…  cd=<…>  lint=<…>
 * media=<…>  gates=<n>` (`/ovf+<px>` only when the round's overflow assert fired) — then
 * `gate-evidence: <n> pages, <n> sidecars updated`.
 * Exit 0; 1 usage error (a malformed sidecar or progress.json included, and a progress.json whose
 * top level is one archetype's record naming no archetype — below); 2 --check found a sibling short
 * of the acceptance set or a stale gate, or --unit found a page with no measured row at a width.
 *
 * Writes: each page's sidecar (`_meta.json` / `<name>._meta.json`): `gatesPassed[]` =
 * existing ∪ derived (existing first) and `gateEvidence{}` merged (derived lines overwrite
 * the same key; `n/a: ` lines are neither passes nor stale) — nothing else, indent preserved.
 * `--progress`: `migrate` {at, pages, archetypes, siblings, thin, gates{<gate>: <pass count>},
 * missing{<slug>: [<gates>]}} and `siblings{<slug>: {archetype, variants, pixel{<width>:
 * {pct, px, heightDelta, overflowX, verdict, label, regime}}, contentDiff, deliveryLint, media,
 * gatesPassed, migrated}}` (`overflowX`: px over the viewport, 0 when the assert ran clean,
 * null when the round predates it), other keys
 * preserved. progress.json is read and parsed BEFORE the first sidecar is touched (a malformed
 * ledger aborts the run with nothing written). A ledger with no `types` map whose top level is one
 * archetype's record (`breakpoints`, or `pageType` + `archetype` — the old documented example) is
 * wrapped under `types.<archetype>` losslessly and noted on stderr, and only a record naming no
 * `archetype` is refused (source-fidelity-gate.md § Residual logging format); every sidecar and the
 * ledger are written through a temp file + rename. Nothing with --dry-run or --help.
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len, no-continue */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listJobs, logPath } from './run-bg.mjs';
import { parseSubstituted } from './reference-url.mjs';

// The shared rules (contracts.mjs) live beside browser.mjs in the master skill's scripts dir: the plugin tree or the Setup step 7 copy.
const CONTRACTS = ['../../stardust/scripts/contracts.mjs', '../stardust/contracts.mjs']
  .map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
if (!CONTRACTS) { console.error('gate-evidence: contracts.mjs not found (looked in ../../stardust/scripts/ and ../stardust/). Copy the master skill\'s scripts dir to stardust/scripts/stardust/ (skills/stardust/SKILL.md § Setup).'); process.exit(1); }
const { treePath, siblingPath } = await import(CONTRACTS.href);

export const DEFAULTS = { tables: 'stardust/replica/gates', migrated: 'stardust/migrated', bg: 'stardust/.work/replica/bg', progress: 'stardust/replica/progress.json', lint: 'stardust/scripts/rollout/delivery-lint.mjs', content: 'content', widths: [1440, 360], heightTolerance: 8 };
// The sibling acceptance set for one --widths list: a pixel gate per width, in the order given. Every reader of the set
// (--check, the row's `missing`, progress.json migrate.missing) goes through this; archetypes and thin pages are not held to it.
export const acceptanceFor = (widths) => ['variance-probe', ...widths.map((w) => `pixel-gate-${w}`), 'delivery-lint', 'media-reconcile', 'content-fidelity', 'content-count'];
// The set for the default widths (1440, 360) — kept for importers.
export const ACCEPTANCE = acceptanceFor(DEFAULTS.widths);
// Instrument script → job kind. The instrument is the first cmd/arg token with one of these basenames
// (a wrapper such as bash or run-capped may precede it); its own arguments follow.
export const INSTRUMENTS = { 'gate.sh': 'pixel', 'content-diff.mjs': 'content-diff', 'media-reconcile.mjs': 'media-reconcile', 'delivery-lint.mjs': 'delivery-lint', 'sibling-variance.mjs': 'variance' };
const SELF = fileURLToPath(import.meta.url);

class UsageError extends Error {}

function help() {
  const header = readFileSync(SELF, 'utf8').match(/\/\*\*[\s\S]*?\*\//);
  return header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header';
}

export function parseArgs(argv) {
  const o = { ...DEFAULTS, widths: [...DEFAULTS.widths], lintGiven: false, slugs: [], check: false, dryRun: false, json: false, unit: null, state: 'stardust/state.json', coverage: 'stardust/rollout/coverage/pages.json' };
  const val = (flag, v) => { if (v === undefined || v.startsWith('--')) throw new UsageError(`gate-evidence: ${flag} needs a value (see --help)`); return v; };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--migrated') o.migrated = val(a, argv[++i]);
    else if (a === '--bg') o.bg = val(a, argv[++i]);
    else if (a === '--progress') o.progress = val(a, argv[++i]);
    else if (a === '--lint') { o.lint = val(a, argv[++i]); o.lintGiven = true; }
    else if (a === '--content') o.content = val(a, argv[++i]);
    else if (a === '--tables') o.tables = val(a, argv[++i]);
    else if (a === '--widths') { o.widths = val(a, argv[++i]).split(',').map((w) => Number(w.trim())); if (!o.widths.length || o.widths.some((w) => !Number.isInteger(w) || w <= 0)) throw new UsageError(`gate-evidence: --widths needs a comma list of pixel widths (got "${argv[i]}")`); }
    else if (a === '--height-tolerance') { o.heightTolerance = Number(val(a, argv[++i])); if (!Number.isFinite(o.heightTolerance) || o.heightTolerance < 0) throw new UsageError('gate-evidence: --height-tolerance needs a number of pixels'); }
    else if (a === '--slug') o.slugs.push(val(a, argv[++i]));
    else if (a === '--check') o.check = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--json') o.json = true;
    else if (a === '--state') o.state = val(a, argv[++i]);
    else if (a === '--coverage') o.coverage = val(a, argv[++i]);
    else if (a === '--unit') { const v = val(a, argv[++i]); o.unit = v.startsWith('@') ? (() => { try { return readFileSync(v.slice(1), 'utf8'); } catch { throw new UsageError(`gate-evidence: --unit ${v}: file not readable`); } })().split(/[\s,]+/).filter(Boolean) : v.split(',').map((x) => x.trim()).filter(Boolean); if (!o.unit.length) throw new UsageError(`gate-evidence: --unit ${v} names no page`); }
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
// Temp file + rename: a crash mid-write never leaves a half-written sidecar or ledger behind.
function writeAtomic(file, text) { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, text); renameSync(tmp, file); }

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

// gate.sh: its first argument IS the slug. Other instruments: an argument names the page. The job-name fallback is
// the last resort and only when no argument names ANY known page (ctx.pages) — a job called `tours-north-lint` whose
// --file is about/history.html is about-history's, not tours-north's.
export function attribute(job, page, ctx = {}) {
  if (job.kind === 'pixel') return job.instArgs[0] === page.slug;
  if (job.instArgs.some((a) => argNamesPage(a, page, job, ctx.migrated))) return true;
  if ((ctx.pages || []).some((p) => p !== page && job.instArgs.some((a) => argNamesPage(a, p, job, ctx.migrated)))) return false;
  return ctx.slugs ? nameOwner(job.name, ctx.slugs) === page.slug : job.name.startsWith(`${page.slug}-`);
}
// The regime a gate.sh round ran in, from its build URL argument (gate.sh <slug> <live> <build> <width>): a served
// prototype (localhost / 127.0.0.1 / file:) is `prototype`, anything else — the preview or live origin — `published`.
export function regimeOf(job) {
  // the round says its own stage (gate.sh's `rounds: <dir> <stage> — …` line): a local AEM build is served from
  // localhost and is not a prototype. Without that line (an older gate.sh), the build URL decides as before.
  const said = /^rounds: \S+ (prototype|local-build|published) — /m.exec(String(job.log || ''));
  if (said) return said[1];
  const u = String(job.instArgs[2] || '');
  return /^file:/i.test(u) || /^https?:\/\/(localhost|127\.0\.0\.1)(?=[:/?#]|$)/i.test(u) ? 'prototype' : 'published';
}
// A job that ended on the instrument's deadline: run-bg's `timedOut` flag or exit 124. Not a verdict.
export const deadline = (job) => job.timedOut === true || job.exit === 124;

// ---- verdict parsers (pure) --------------------------------------------------------------------
// pixel-compare: `A WxH  B WxH  → compare WxH, height delta Npx` then `differing pixels: n / m = p%  (threshold t%) → PASS|FAIL…`.
// p is the UNALIGNED %; the PASS|FAIL is the pixel criterion's (gate.sh runs the compare aligned, --offset-max: aligned %
// and offsets), so a round that used alignment also prints `pixel: aligned a% (unaligned p%) → …` after it — `alignedPct`,
// present only then, with `offsets` (the step list) when the line carries one.
export function parseVerdict(text) {
  const v = [...text.matchAll(/differing pixels: (\d+) \/ (\d+) = ([\d.]+)%\s+\(threshold ([\d.]+)%\) → (PASS|FAIL)/g)].pop();
  if (!v) return null;
  const h = [...text.matchAll(/→ compare \d+x\d+, height delta (-?\d+)px/g)].pop();
  const al = /^pixel: aligned ([\d.]+)% \(unaligned [\d.]+%\)[^\n]*? → (?:PASS|FAIL)(?: — (offsets: [^\n]*))?$/m.exec(text.slice(v.index));
  return { px: Number(v[1]), total: Number(v[2]), pct: Number(v[3]), threshold: Number(v[4]), verdict: v[5], heightDelta: h ? Number(h[1]) : null, ...(al ? { alignedPct: Number(al[1]), ...(al[2] ? { offsets: al[2] } : {}) } : {}) };
}
// content-diff: `Findings: none — content + roles match` | `Findings: N (S structural 🔴)`, then `Tiers: looks-same 🔴 S ·
// nothing-lost 🟡 L · …`; gate.sh --full echoes both on one `content-diff: ` line. lost = the nothing-lost count of the
// SAME round as the last Findings line — on that line or the Tiers line right after it (0 when an older probe printed
// no tiers), never a count from another round of a multi-round log.
export function parseFindings(text) {
  const m = [...text.matchAll(/^(?:Findings|content-diff): (none[^\n]*|(\d+) \((\d+) structural[^\n]*)$(?:\r?\nTiers: [^\n]*)?/gm)].pop();
  if (!m) return null;
  const tiers = /nothing-lost 🟡 (\d+)/.exec(m[0]);
  return { total: m[2] === undefined ? 0 : Number(m[2]), structural: m[3] === undefined ? 0 : Number(m[3]), lost: tiers ? Number(tiers[1]) : 0, text: m[1].trim() };
}
// media-reconcile: last line `<n> keep · <n> optimize · <n> omit …` — one `<n> <decision>` per decision that occurred.
export function parseCounts(text) {
  const m = [...text.matchAll(/^((?:\d+ [a-z]+)(?: · \d+ [a-z]+)*)[ \t]*$/gm)].pop();
  if (!m) return null;
  const counts = {}; for (const part of m[1].split(' · ')) { const [n, k] = part.split(' '); counts[k] = Number(n); }
  return { counts, line: m[1] };
}
// gate.sh --full element lines (#125): `clip-probe: Clipped: <n> …`, `content-presence: Content: MISSING <n> … / HIDDEN <n> …`.
export function parseElements(text) {
  const clip = text.match(/^clip-probe: Clipped: (\d+)/m); const cp = text.match(/^content-presence: Content: MISSING (\d+).*?HIDDEN (\d+)/m);
  return { clipped: clip ? Number(clip[1]) : null, missing: cp ? Number(cp[1]) : null, hidden: cp ? Number(cp[2]) : null };
}
// The pixel tables gate-all.mjs writes: { published: { <slug>: row }, prototype: { <slug>: row }, any: boolean } per width.
export function loadTables(dir, widths) {
  const out = {};
  for (const w of widths) {
    const read = (name) => { const f = join(dir, `${name}-${w}`, 'summary.json'); if (!existsSync(f)) return null; try { return Object.fromEntries((JSON.parse(readFileSync(f, 'utf8')).rows || []).map((r) => [r.slug, { ...r, file: f }])); } catch { return null; } };
    const published = read('all'); const prototype = read('prototypes');
    out[w] = { published, prototype, any: !!(published || prototype) };
  }
  return out;
}
// gate.sh's overflow assert: `gate.sh: OVERFLOW at <w> — build scrollWidth <n> > viewport <n> (+<n>px) → FAIL …` fired;
// `gate.sh: overflow assert at <w> — … → ok` ran clean. The LAST of either decides; null when the round predates the assert.
export function parseOverflow(text) {
  const m = [...text.matchAll(/^gate\.sh: (?:OVERFLOW at (\d+) — build scrollWidth (\d+) > viewport (\d+) \(\+(\d+)px\)|overflow assert at (\d+) — [^\n]*→ ok)[^\n]*$/gm)].pop();
  if (!m) return null;
  if (m[5] !== undefined) return { width: Number(m[5]), px: 0, scrollWidth: null, viewport: null };
  return { width: Number(m[1]), px: Number(m[4]), scrollWidth: Number(m[2]), viewport: Number(m[3]) };
}
// delivery-lint: `<n> P0 · <n> P1 · <n> P2`.
export function parseLint(text) {
  const m = [...text.matchAll(/^(\d+) P0 · (\d+) P1 · (\d+) P2[ \t]*$/gm)].pop();
  return m ? { p0: Number(m[1]), p1: Number(m[2]), p2: Number(m[3]), line: `${m[1]} P0 · ${m[2]} P1 · ${m[3]} P2` } : null;
}
// sibling-variance: per sibling `■ <url>: ✓ matches the archetype | N delta(s)`, then a `✓|✗ … sibling(s) …` summary.
// `paths` = the page's own URL paths; its `■` line is the evidence when present (`own: true`), else the summary is
// returned with `own: false` and `deltas: null` — the caller must not pass on a summary alone.
export function parseVariance(text, paths = []) {
  const summary = [...text.matchAll(/^[✓✗] \d+ (?:of \d+ )?sibling\(s\) [^\n]*$/gm)].pop();
  const own = [...text.matchAll(/^■ (\S+): ([^\n]*)$/gm)].find((m) => { const p = urlPath(m[1]); return p !== null && paths.includes(p); });
  if (!summary && !own) return null;
  const d = own && own[2].match(/^(\d+) delta/);
  return { summary: summary ? summary[0] : null, line: own ? own[0] : summary[0], deltas: own ? (d ? Number(d[1]) : 0) : null, own: Boolean(own) };
}

// ---- derivation --------------------------------------------------------------------------------
const latest = (items, at = (x) => jobAt(x.j)) => items.reduce((best, x) => (!best || at(x) > at(best) ? x : best), null);
const fmtPct = (n) => `${n.toFixed(2)}%`;
// The `--path` delivery-lint expects: the output path without `.html` and without a trailing `/index`; the root page is `/` (lib/paths.mjs treePath).
export const daPath = treePath;
// The page's DELIVERED content file (the deploy driver's tree: a file's path minus `.html` is its DA path): `<content>/<da-path>.html`,
// or `<content>/<da-path>/index.html`; the root page is `<content>/index.html`. `file` names the first candidate (relative, for
// evidence lines) even when none exists.
export function contentFileFor(contentDir, outputPath) {
  const p = daPath(outputPath);
  const rel = p === '/' ? ['index.html'] : [`${p.slice(1)}.html`, `${p.slice(1)}/index.html`];
  const hit = rel.find((r) => existsSync(join(contentDir, r)));
  return { file: join(contentDir, hit || rel[0]), exists: Boolean(hit) };
}

export function runLint(lint, page) {
  const args = [lint, '--file', page.htmlFile, '--path', daPath(page.outputPath)];
  let out = ''; let code = 0;
  try { out = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }); }
  catch (e) { out = String(e.stdout || ''); code = typeof e.status === 'number' ? e.status : 1; if (!out.trim()) return { ok: false, line: `delivery-lint gave no output (exit ${code}): ${String(e.stderr || e.message).trim().split('\n')[0].slice(0, 160)}` }; }
  const l = parseLint(out);
  return l ? { ok: l.p0 === 0 && l.p1 === 0, line: l.line } : { ok: false, line: `delivery-lint printed no summary line (exit ${code})` };
}

// A pixel gate measured against a substituted reference (reference-url.mjs: an inconsistency-register entry let another
// rendering stand in for the inventory URL) says so in its evidence line: a pass, but not against the page visitors see.
export const substitutedNote = (s) => (s ? ` [SUBSTITUTED reference: ${s.url} for ${s.inventoryUrl} (${s.entry}): a pass against that rendering, not the page visitors see]` : '');
// Every gate one page earns from the jobs attributed to it. Returns { gates, evidence, facts, notes }; the caller merges.
export function derive(page, jobs, o, ctx) {
  const mine = jobs.filter((j) => attribute(j, page, ctx));
  const gates = []; const evidence = {}; const notes = [];
  const facts = { pixel: {}, contentDiff: null, deliveryLint: null, media: null, variance: null, delivered: null };
  const pass = (g, line) => { gates.push(g); evidence[g] = line; };
  const open = (g, line, prefix = 'OPEN') => { evidence[g] = `${prefix}: ${line}`; };
  const cite = (j) => `(${j.logName})`;
  // The newest job of a set decides the gate: on a deadline, or (when `verdictExits` is given) an exit that is not a
  // verdict, the gate is recorded OPEN and null is returned — an older pass never stands in. Otherwise the latest job
  // with a parsable verdict line among the jobs that could carry one.
  const pick = (all, parse, gate, verdictExits = null) => {
    // gate.sh exit 6 = the round was refused at the cap: nothing was measured, so it is not the newest round.
    const list = verdictExits ? all.filter((j) => j.exit !== 6) : all;
    const newest = latest(list.map((j) => ({ j })));
    if (!newest) return null;
    if (deadline(newest.j)) { open(gate, `deadline ${cite(newest.j)} — re-run`); return null; }
    if (verdictExits && !verdictExits.includes(newest.j.exit)) { open(gate, `no verdict (exit ${newest.j.exit}) ${cite(newest.j)}`); return null; }
    const usable = list.filter((j) => !deadline(j) && (!verdictExits || verdictExits.includes(j.exit)));
    return latest(usable.map((j) => ({ j, v: parse(j.log) })).filter((x) => x.v));
  };
  const ofKind = (...kinds) => mine.filter((j) => kinds.includes(j.kind));

  for (const w of o.widths) {
    const t = ctx.tables && ctx.tables[w];
    if (t && t.any) {
      // the table rule: the row decides; no row = ungated, whatever a log says
      const row = (t.published && t.published[page.slug]) || (t.prototype && t.prototype[page.slug]) || null;
      if (!row) { open(`pixel-gate-${w}`, `no row in the pixel table (${[t.published && 'all', t.prototype && 'prototypes'].filter(Boolean).map((n) => `${n}-${w}`).join(', ')}) — run gate-all.mjs${t.published ? '' : ' --stage prototype'} so the page is measured`); continue; }
      const regime = t.published && t.published[page.slug] ? 'published' : 'prototype';
      const sub = row.referenceSubstitution || null;
      facts.pixel[w] = { pct: row.pct, px: null, heightDelta: row.heightDelta, overflowX: null, clipped: row.clipped ?? null, content: row.content || null, verdict: row.pass ? 'PASS' : 'FAIL', label: 'table', regime, ...(sub ? { referenceSubstitution: sub } : {}) };
      const line = `${row.alignedUsed && row.alignedPct != null ? `aligned ${fmtPct(row.alignedPct)} (unaligned ${fmtPct(row.pct)}), offsets ${row.totalShift}px` : fmtPct(row.pct)}, height delta ${row.heightDelta ?? '?'}px, clipped ${row.clipped ?? 'n/a'}, content ${row.contentNA ? 'n/a' : row.content ? `MISSING ${row.content.missing} / HIDDEN ${row.content.hidden}` : 'n/a'} (${relative(process.cwd(), row.file).replace(/\.json$/, '.md')}) [${regime} regime]${substitutedNote(sub)}`;
      if (row.pass) pass(`pixel-gate-${w}`, line); else open(`pixel-gate-${w}`, `${(row.reasons || []).join('; ') || 'FAIL'} — ${line}`, 'FAIL');
      continue;
    }
    const best = pick(ofKind('pixel').filter((j) => Number(j.instArgs[3]) === w), parseVerdict, `pixel-gate-${w}`, [0, 2]);
    if (!best) continue;
    const { j, v } = best;
    const label = j.instArgs[4] && !j.instArgs[4].startsWith('--') ? j.instArgs[4] : 'iter';
    const regime = regimeOf(j);
    const ov = parseOverflow(j.log);
    const sub = parseSubstituted(j.log);
    facts.pixel[w] = { pct: v.pct, px: v.px, heightDelta: v.heightDelta, overflowX: ov ? ov.px : null, verdict: v.verdict, label, regime, ...(sub ? { referenceSubstitution: sub } : {}) };
    const line = `${v.alignedPct != null ? `aligned ${fmtPct(v.alignedPct)} (unaligned ${fmtPct(v.pct)}${v.offsets ? `; ${v.offsets}` : ''}) (` : `${fmtPct(v.pct)} (`}${v.px} px, threshold ${v.threshold}%), height delta ${v.heightDelta === null ? '?' : v.heightDelta}px, round ${label} @${w} ${cite(j)} [${regime} regime]${substitutedNote(sub)}`;
    const withinHeight = v.heightDelta !== null && Math.abs(v.heightDelta) <= o.heightTolerance;
    // The overflow assert and the --full element lines outrank the pixel line: a build wider than its viewport, a
    // clipped text / control or a MISSING / HIDDEN link never earns the gate (#125).
    const el = parseElements(j.log);
    if (ov && ov.px > 0) open(`pixel-gate-${w}`, `horizontal overflow +${ov.px}px at ${w} (scrollWidth ${ov.scrollWidth} > viewport ${ov.viewport}) — ${line}`, 'FAIL');
    else if (el.clipped > 0) open(`pixel-gate-${w}`, `clipped ${el.clipped} on the build (clip-probe) — ${line}`, 'FAIL');
    else if (el.missing + el.hidden > 0) open(`pixel-gate-${w}`, `content MISSING ${el.missing} / HIDDEN ${el.hidden} (content-presence) — ${line}`, 'FAIL');
    else if (v.verdict === 'PASS' && withinHeight) pass(`pixel-gate-${w}`, line);
    else open(`pixel-gate-${w}`, v.verdict === 'PASS' ? `|height delta| > ${o.heightTolerance}px tolerance — ${line}` : line, 'FAIL');
  }

  // The dedicated content-diff run is the acceptance check; a gate.sh --full round's line stands in only when there is none.
  const dedicated = ofKind('content-diff');
  const cd = dedicated.length ? pick(dedicated, parseFindings, 'content-count') : pick(ofKind('pixel').filter((j) => j.instArgs.includes('--full')), parseFindings, 'content-count');
  if (cd) {
    facts.contentDiff = cd.v.text;
    const line = `content-diff: ${cd.v.text} ${cite(cd.j)}`;
    if (cd.v.structural === 0 && cd.v.lost === 0) pass('content-count', line); else open('content-count', line);
  }

  const md = pick(ofKind('media-reconcile'), parseCounts, 'media-reconcile');
  if (md) {
    facts.media = md.v.line;
    const held = ['omit', 'unresolved'].filter((k) => md.v.counts[k] > 0).map((k) => `${md.v.counts[k]} ${k}`);
    const line = `${md.v.line} ${cite(md.j)}`;
    if (!held.length) pass('media-reconcile', line); else open('media-reconcile', `${held.join(', ')} hold the gate — ${line}`);
  }
  // media-reconcile belongs to the delivery chain: without the page's delivered content file it is not required — an
  // OPEN (or a deadline / a missing job) reads `n/a:` instead, a pass still stands. The caller drops it from the set.
  const delivered = ctx.contentFile ? ctx.contentFile(page) : { file: null, exists: true };
  facts.delivered = delivered.exists;
  if (!delivered.exists && !gates.includes('media-reconcile')) {
    const latest_ = md ? ` — latest run ${md.v.line} ${cite(md.j)} is advisory until then` : '';
    evidence['media-reconcile'] = `n/a: no delivered content file yet (${delivered.file}) — media-reconcile runs in the delivery chain (row C)${latest_}`;
  }

  if (ctx.lint) {
    if (!existsSync(page.htmlFile)) notes.push(`${page.slug}: ${page.htmlFile} missing — delivery-lint skipped`);
    else {
      const r = runLint(ctx.lint, page); facts.deliveryLint = r.line;
      const line = `${r.line} (delivery-lint --path ${daPath(page.outputPath)})`;
      if (r.ok) pass('delivery-lint', line); else open('delivery-lint', line, 'FAIL');
    }
  } else {
    const lj = pick(ofKind('delivery-lint'), parseLint, 'delivery-lint');
    if (lj) { facts.deliveryLint = lj.v.line; const line = `${lj.v.line} ${cite(lj.j)}`; if (lj.v.p0 === 0 && lj.v.p1 === 0) pass('delivery-lint', line); else open('delivery-lint', line, 'FAIL'); }
  }

  if (page.meta.fidelityTier === 'sibling') {
    const archSlug = page.meta.archetypeSource || page.meta.template || null;
    const arch = archSlug ? (ctx.pages || []).find((p) => p.slug === archSlug) || null : null;
    const paths = pagePaths(page.outputPath);
    const probes = jobs.filter((j) => j.kind === 'variance' && (mine.includes(j) || (arch && attribute(j, arch, ctx))));
    const vj = pick(probes, (log) => parseVariance(log, paths), 'variance-probe', [0, 2]);
    if (vj) {
      facts.variance = vj.v.line;
      const variants = Array.isArray(page.meta.variants) ? page.meta.variants : [];
      const line = `${vj.v.line}${variants.length ? ` — variants [${variants.join(', ')}]` : ''} ${cite(vj.j)}`;
      // Only the page's own `■` line is evidence: a summary alone — ✓ or ✗ — says nothing about this page.
      if (!vj.v.own) open('variance-probe', `not in the probe — ${vj.v.summary} ${cite(vj.j)}`);
      else if (vj.v.deltas && !variants.length) open('variance-probe', `${vj.v.deltas} delta(s) and no variants[] declared — ${line}`);
      else pass('variance-probe', line);
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
  const px = widths.map((w) => `${w}=${r.pixel[w] ? `${fmtPct(r.pixel[w].pct)}/Δ${r.pixel[w].heightDelta}${r.pixel[w].overflowX > 0 ? `/ovf+${r.pixel[w].overflowX}` : ''}` : '—'}`).join('  ');
  const cd = r.contentDiff === null ? '—' : (/^none/.test(r.contentDiff) ? 'none' : compact(r.contentDiff.replace(/ structural 🔴\)/, '🔴)')));
  return `${r.slug}  ${r.tier || '—'}  ${px}  cd=${cd}  lint=${compact(r.deliveryLint)}  media=${compact(r.media)}  gates=${r.gatesPassed.length}`;
}

function resolveLint(o) {
  // --lint (or its default path) first; otherwise the rollout skill's own copy, in whichever layout holds it (lib/resolve.mjs).
  if (existsSync(o.lint) && statSync(o.lint).isFile()) return o.lint;
  return o.lintGiven ? null : siblingPath('rollout', 'delivery-lint.mjs');
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
  const contentDir = resolve(o.content);
  const tables = loadTables(o.tables, o.widths);
  if (o.check) for (const w of o.widths) if (!tables[w].any) notes.push(`no pixel table for ${w} under ${o.tables}/ (prototypes-${w} or all-${w}/summary.json) — the #125 rule wants every prototype and deployed page as a row: run gate-all.mjs [--stage prototype]; the gate.sh logs stand in until then`);
  const ctx = { tables, migrated, pages, slugs: pages.map((p) => p.slug), lint, contentFile: (page) => { const c = contentFileFor(contentDir, page.outputPath); return { ...c, file: relative(process.cwd(), c.file).split(sep).join('/') }; } };
  const acceptance = acceptanceFor(o.widths);
  // The ledger is parsed before any sidecar is touched: a malformed progress.json aborts with nothing written.
  const prior = existsSync(o.progress) ? readJson(o.progress) : { data: {}, indent: 2, eol: true };
  if (!prior.data || typeof prior.data !== 'object' || Array.isArray(prior.data)) throw new UsageError(`gate-evidence: ${o.progress} is not a JSON object`);
  // The ledger is the map of every archetype: the agent's records under `types.<slug>`, this script's `siblings` /
  // `migrate`, `_provenance`. A file whose top level is one archetype's record (the old documented example) is wrapped
  // under its own slug, losslessly; only a record without a slug is refused.
  if (!('types' in prior.data)) {
    const single = ['breakpoints', 'pageType', 'archetype'].filter((k) => k in prior.data);
    const looksLikeRecord = single.includes('breakpoints') || (single.includes('pageType') && single.includes('archetype'));
    if (looksLikeRecord) {
      const slug = typeof prior.data.archetype === 'string' ? prior.data.archetype.trim() : '';
      if (!slug) throw new UsageError(`gate-evidence: ${o.progress} is one archetype's residual record at the top level (${single.join(', ')}) and names no archetype — move it under types.<archetype> (source-fidelity-gate.md § Residual logging format)`);
      prior.data = { types: { [slug]: prior.data } };
      notes.push(`${o.progress}: one archetype's record at the top level was wrapped under types.${slug} (source-fidelity-gate.md § Residual logging format)`);
    }
  }
  const rows = []; let updated = 0;
  for (const page of selected) {
    const d = derive(page, jobs, o, ctx);
    notes.push(...d.notes);
    const { meta, stale } = mergeMeta(page.meta, d);
    for (const g of stale) notes.push(`${page.slug}: ${g} stays in gatesPassed, but the latest evidence reads "${meta.gateEvidence[g].slice(0, 100)}"`);
    const text = serialize(meta, page.indent, page.eol);
    if (text !== page.text) { updated += 1; if (!o.dryRun) writeAtomic(page.file, text); }
    const tier = meta.fidelityTier || null;
    // A sibling is not held to media-reconcile before its delivered content file exists (derive() recorded `n/a:` for it).
    const required = acceptance.filter((g) => g !== 'media-reconcile' || d.facts.delivered !== false);
    rows.push({ slug: page.slug, tier, archetype: meta.archetypeSource || meta.template || null, variants: Array.isArray(meta.variants) ? meta.variants : [], outputPath: page.outputPath, migrated: join(o.migrated, page.outputPath), ...d.facts, gatesPassed: meta.gatesPassed, gateEvidence: meta.gateEvidence, missing: tier === 'sibling' ? required.filter((g) => !meta.gatesPassed.includes(g)) : [], stale });
  }
  if (rows.length && !o.dryRun) {
    mkdirSync(dirname(resolve(o.progress)), { recursive: true });
    writeAtomic(o.progress, serialize(buildProgress(prior.data, rows, { partial: o.slugs.length > 0 }), prior.indent, prior.eol));
  }
  return { rows, updated, notes };
}

// ---- --unit: the delivery unit's close check -----------------------------------------------------
// The published table of one width as gate-all writes it: summary.json plus every runs/*.json (--only, --sample).
// → { rows: Map<slug, { row, at, file }> (the newest by _provenance.writtenAt), samples: [{ from, picked, at, file }] }.
export function publishedRuns(dir, width) {
  const base = join(dir, `all-${width}`);
  const files = [join(base, 'summary.json')];
  try { files.push(...readdirSync(join(base, 'runs')).filter((f) => f.endsWith('.json')).sort().map((f) => join(base, 'runs', f))); } catch { /* no runs */ }
  const rows = new Map(); const samples = [];
  for (const file of files) {
    let data; try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    const prov = (data && data._provenance) || {}; const at = Date.parse(prov.writtenAt || '') || 0;
    for (const row of Array.isArray(data && data.rows) ? data.rows : []) {
      if (!row || !row.slug) continue;
      const prev = rows.get(row.slug);
      if (!prev || at >= prev.at) rows.set(row.slug, { row, at, file });
    }
    const smp = prov.sample;
    if (smp && Array.isArray(smp.from) && Array.isArray(smp.picked)) samples.push({ from: new Set(smp.from), picked: new Set(smp.picked.map((x) => (x && typeof x === 'object' ? x.slug : x))), at, file });
  }
  return { rows, samples };
}
// unitCheck(slugs, { tables, widths, runs, verify }) → { pages: [{ slug, widths: { <w>: { state, pct, why } } }], ungated, pending, failing }.
// state: pass | fail (a measured row) | sweep (sampled out by a --sample run) | stale (a pass row `verify(slug, w)`
// answers a reason for: its recorded pass no longer holds) | error (a row without a percentage) | none.
export function unitCheck(slugs, { tables = DEFAULTS.tables, widths = DEFAULTS.widths, runs = publishedRuns, verify = null } = {}) {
  const byWidth = Object.fromEntries(widths.map((w) => [w, runs(tables, w)]));
  const pages = []; const ungated = []; const pending = []; const failing = [];
  for (const slug of slugs) {
    const out = {};
    for (const w of widths) {
      const { rows, samples } = byWidth[w];
      const hit = rows.get(slug); const row = hit && hit.row;
      // measured = gate-all's own rule (isErrorRow): a percentage and no probe error
      const probeErrors = row && Array.isArray(row.probeErrors) ? row.probeErrors : [];
      const measured = !!row && row.pct != null && !probeErrors.length;
      // sampled out only by a sample run NEWER than the page's newest row: a later error row is not hidden by an older pick
      const sampledOut = samples.some((x) => x.from.has(slug) && !x.picked.has(slug) && (!hit || x.at > hit.at));
      let cell;
      const stale = measured && row.pass && verify ? verify(slug, w) : null; // a pass by override has no record to check
      if (stale) cell = { state: 'stale', pct: row.pct, why: `the pass in ${hit.file} no longer holds: ${stale}` };
      else if (measured) cell = { state: row.pass || row.passWithOverride ? 'pass' : 'fail', pct: row.pct, why: (row.reasons || []).join('; ') || null, file: hit.file };
      else if (sampledOut) cell = { state: 'sweep', pct: null, why: 'sampled out — pending the all-pages run' };
      else if (row) cell = { state: 'error', pct: row.pct ?? null, why: `row without a measurement (${row.error || (probeErrors.length ? `probe-error: ${probeErrors.map((e) => (e && e.probe) || e).join(', ')}` : 'no percentage')}) in ${hit.file}` };
      else cell = { state: 'none', pct: null, why: `no row in ${join(tables, `all-${w}`)} (summary.json or runs/)` };
      out[w] = cell;
      if (cell.state === 'none' || cell.state === 'error' || cell.state === 'stale') ungated.push({ slug, width: w, why: cell.why });
    }
    if (Object.values(out).some((c) => c.state === 'sweep')) pending.push(slug);
    if (Object.values(out).some((c) => c.state === 'fail')) failing.push(slug);
    pages.push({ slug, widths: out });
  }
  return { pages, ungated, pending, failing };
}
// The unit check's view of gate-all's § REUSE (passInputs): a pass row stands while its page's recorded pass matches the
// page's local build inputs now. gate-all.mjs is imported here only, so the sidecar run never loads it.
async function passVerifier(o) {
  const { inputsPage, localInputs, passInputs } = await import('./gate-all.mjs');
  const quiet = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
  const state = quiet(o.state); const coverage = quiet(o.coverage);
  const inputsOf = localInputs({ contentDir: o.content, stage: 'published', coverage });
  const seen = new Map();
  return (slug, w) => {
    if (!seen.has(slug)) seen.set(slug, inputsOf(inputsPage(slug, { state, coverage })));
    const r = passInputs(join(o.tables, `all-${w}`, slug), seen.get(slug));
    if (r.miss) return r.miss;
    return r.changed.length ? `${r.changed.join(', ')} since the pass${r.at ? ` of ${r.at}` : ''}` : null;
  };
}
async function unitCli(o) {
  const r = unitCheck(o.unit, { tables: o.tables, widths: o.widths, verify: await passVerifier(o) });
  if (o.json) console.log(JSON.stringify(r, null, 2));
  else {
    for (const p of r.pages) console.log(`${p.slug}  ${o.widths.map((w) => `${w}=${p.widths[w].state}${p.widths[w].pct != null ? ` ${p.widths[w].pct}%` : ''}`).join('  ')}`);
    for (const g of r.ungated) console.log(`${g.slug}: NOT gated at ${g.width} — ${g.why}`);
    const gated = r.pages.length - new Set(r.ungated.map((g) => g.slug)).size;
    console.log(`gate-evidence --unit: ${r.pages.length} page(s) — ${gated} with a row or sampled out at every width${r.failing.length ? ` (${r.failing.length} failing: ${r.failing.slice(0, 8).join(', ')}${r.failing.length > 8 ? ', …' : ''} — fix within the round cap or record the decision)` : ''}, ${r.pending.length} pending the all-pages run, ${new Set(r.ungated.map((g) => g.slug)).size} NOT gated${r.ungated.length ? ' — the unit is not done: gate them (gate-all.mjs --only <slugs> --eds-host <host>, both widths; --skip-existing gates again only what is not a standing pass), or run the unit with --sample' : ''}`);
  }
  return r.ungated.length ? 2 : 0;
}

// ---- cli ---------------------------------------------------------------------------------------
function cli(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(help()); return 0; }
  const o = parseArgs(argv);
  if (o.unit) return unitCli(o);
  const r = collect(o);
  for (const n of r.notes) console.error(`gate-evidence: ${n}`);
  if (!r.rows.length) { console.log(`gate-evidence: no _meta.json sidecars${o.slugs.length ? ` for --slug ${o.slugs.join(', ')}` : ''} under ${o.migrated} — nothing to collect`); return 0; }
  const short = r.rows.filter((row) => row.missing.length);
  const stale = r.rows.filter((row) => row.stale.length);
  if (o.json) console.log(JSON.stringify(r.rows, null, 2));
  else {
    for (const row of r.rows) console.log(formatRow(row, o.widths));
    for (const row of short) console.log(`${row.slug}: missing ${row.missing.join(', ')}`);
    for (const row of stale) console.log(`${row.slug}: stale ${row.stale.join(', ')} — in gatesPassed, but the latest evidence reads FAIL/OPEN (re-earn it, or drop the gate)`);
    const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
    console.log(`gate-evidence: ${n(r.rows.length, 'page')}, ${n(r.updated, 'sidecar')} ${o.dryRun ? 'would be updated (dry-run: nothing written)' : 'updated'}`);
  }
  return o.check && (short.length || stale.length) ? 2 : 0;
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  const fail = (e) => { console.error(e instanceof UsageError ? e.message : `gate-evidence: ${e.stack || e.message}`); process.exitCode = 1; };
  try { const code = cli(process.argv.slice(2)); if (code instanceof Promise) code.then((c) => { process.exitCode = c; }, fail); else process.exitCode = code; } // --unit answers a promise
  catch (e) { fail(e); }
}
