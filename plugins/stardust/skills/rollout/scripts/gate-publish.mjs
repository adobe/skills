#!/usr/bin/env node
/**
 * rollout/gate-publish.mjs — the published-origin PAGE gate: one driver for every
 * delivered page (or a seeded sample), one report the publish run reads.
 *
 * It measures and writes; it never publishes. The release condition reads its report:
 * `stardust/rollout/gate-report.json` — every previewed row without a PASS is HELD
 * (reference/publish-gate.md § Gate 8; the hold inside `deploy-batch.mjs --publish` is the
 * deploy cluster's hunk — until it lands the operator reads the report's held rows before
 * the publish run). The gate status lives in rollout coverage (`delivery.gate`) and in the
 * report — never in `state.json` (`migrated` is migrate's lifecycle state) and never in the
 * deploy ledger.
 *
 * Per page × configured breakpoint the driver composes the replica instruments:
 *   gate.sh <slug> <live-url> <origin-url> <W> pub<k> --regime published-origin [--record] [--refresh] [--variance]
 *     (`--record` only on an archetype's own row: gate.sh upserts progress.json `<type>.published.<W>`;
 *     a sibling round never writes the archetype slot)
 *     → gates/<slug>-<W>/gate-pub<k>.json (live cached once per page × width; drift probe; 0/2/3/5/6/124)
 *   anchor.mjs both sides (live side: the cached gates/<slug>-<W>/anchor-live.json is READ, not
 *     re-probed — zero live hits whatever options gate.sh probed it with) → header + footer bands
 *   crop-compare live.png build.png --y 0 --height <hh> · --y <live fy> --y-b <build fy> --height <fh>
 *     → gates/<slug>-<W>/crop-{header,footer}-pub<k>.json
 * PASS at a breakpoint = record `pass` (pixel-compare's own bar) ∧ |Δh| ≤ 8 px ∧ both
 * chrome crops pass (crop-compare's own `pass`). No bar is restated or configurable here
 * (B29): the driver copies `pass` from both instruments and adds the one existing bar
 * pixel-compare does not apply (|Δh|); a crop record without a `pass` field is no verdict
 * (unmeasured), never re-judged from its percentage. A page PASSes only when every
 * configured breakpoint passes.
 *
 * Statuses (per page, `latest.status`):
 *   pass               every breakpoint PASS
 *   fail               a breakpoint FAIL (pixel, height or chrome)
 *   published-failing  fail on a page whose deploy-ledger row is already `live`
 *   unmeasured         a breakpoint has no verdict (exit 124 deadline, 5 invalid capture,
 *                      6 cap reached, crops not run) — never a FAIL, never counted (B32)
 *   ungated            a breakpoint has no published-origin record at all
 * A `prototype`-regime record is never read here (regime honesty). A RUN reads only the record of
 * the label it asked gate.sh for: when gate.sh wrote none (exit 1 / 125) the breakpoint is
 * `unmeasured` — never an older round's verdict. The residual door (publish-gate.md § Gate 8,
 * escape hatch (c)): a residual under progress.json `archetypes[].published.<W>.residuals[]` for
 * this page (the archetype's own row, or a row naming `page: <slug>` for a sibling of the type)
 * that passes § Residual logging format — judged by replica's gate-ledger-lint `judgeResiduals`
 * (named class or register:R-nn, artifacts[], acceptedBy; hands-off-policy only on a permanent
 * class) — turns an over-bar breakpoint into a PASS row with reason `residual <class>`; an invalid
 * residual leaves it FAIL and the reason names the defect. Prototype-regime residuals are not read.
 *
 * Selection (one of):
 *   --paths <file|/a,/b>      delivered paths (file: one per line)
 *   --slug <s>                one coverage row
 *   --all-delivered           every delivered coverage row (deployed | verified | stale | failed)
 *   --sample <n> [--seed <s>] [--exclude <slugs|file>]
 *                             per template: its archetype + n pages drawn at random with a
 *                             fixed seed from the delivered rows, never the delivery-order
 *                             head, never an excluded (fix-loop) slug — the coverage-regime
 *                             sample (publish-gate.md § Gate 8 → Coverage regime). Seed
 *                             and draw are recorded in the report.
 * Modes:
 *   (run)        drive the instruments sequentially — one gate.sh round at a time (hit-minimisation
 *                on the source site); --concurrency 2 runs two rounds at once ONLY over pages whose
 *                live capture is already cached (they follow the uncached pages) — then write the report
 *   --report     offline: read the round records + crop files already on disk, write
 *                gate-report.{json,md}, merge `delivery.gate` into coverage — no browser
 *   --dry-run    print the gate.sh command per page × width and exit 0 — nothing runs
 * Options:
 *   --origin <url>            the delivered origin (preview `*.aem.page` — D1 gates on preview;
 *                             `aem.live` only after an owner-decided publish) — required to run
 *   --widths 1440,360         default progress.json breakpointsConfigured, else 1440,360
 *   --gates-dir <dir>         default stardust/replica/gates; a RUN exports GATE_DIR_ROOT=<dir> to gate.sh so the
 *                             round writes where this driver reads (a project copy of gate.sh predating
 *                             GATE_DIR_ROOT refuses a non-default dir for a RUN, exit 1; --report / --dry-run read any dir)
 *   --out <dir>               default stardust/rollout
 *   --ledger <file>           default content/.deploy-ledger.json (wasLive from a `live` row — zero network)
 *   --state <file>            default stardust/state.json (live URL per page; else rollout.json site.sourceUrl + path)
 *   --refresh · --variance    passed through to gate.sh (drift probe / self-noise floor, where the doc names them)
 *
 * Report (`<out>/gate-report.json`, read-modify-write, history kept):
 *   { _provenance{writtenBy, writtenAt, bars}, generatedAt, breakpoints[], sample{seed,n,excluded[]}?,
 *     coverage{delivered, gated, pass, fail, publishedFailing, unmeasured, ungated},
 *     templates{<template>: {pages, pass, fail, unmeasured, ungated, atBar}}   ← atBar = every selected page of the
 *                            template PASSes (a named-class residual is a PASS row); a template not at the bar is
 *                            not published — its rows are held (coverage regime, publish-gate.md § Gate 8)
 *     neutralDiff{<template>: {<W>: {n, median, p90, under10}}}   ← reporting KPI from pixelPctUnmasked, not a bar
 *     pages{<path>: { path, slug, template, wasLive,
 *                     latest{ at, pass, status, breakpoints{<W>: {verdict, exit, pixelPct, pixelPctUnmasked,
 *                             heightDelta, heightOk, cropsOk, header, footer, pass, record, reason,
 *                             residual{class, cause, acceptedBy} | null}} },
 *                     bestOfLast3{<W>: pct}, history[{at, breakpoints{<W>: pct}}], reference{<W>: capturedAt} } } }
 *   + `<out>/gate-report.md`. Coverage line (stdout and md):
 *   `published-gated P of M · PASS p · FAIL f · unmeasured u · ungated r[ · published-failing x]`
 *
 * Completion contract (skills/stardust/scripts/progress.mjs): progress file
 * stardust/.work/rollout/gate-publish.progress.json while running; the LAST stdout line is
 * `SUMMARY gate-publish ok=<pass> failed=<fail> [noverdict=<unmeasured>] exit=<code> details=<report> ungated=<n>`.
 *
 * Exit: 0 every measured page PASS (unmeasured/ungated pages never fail the run) · 1 usage
 *       · 2 at least one page FAIL / published-failing · 3 a page was blocked (challenge / auth, gate.sh exit 3)
 *       — exit 124 from an instrument is `unmeasured`, never 2.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { readJSON, writeJSON, deliveredPathOf, isDelivered } from './lib.mjs';

const HEIGHT_BAR_PX = 8; // the existing |Δh| bar (pixel-compare prints ⚠ over it; the gate applies it)

/** replica's residual judge (gate-ledger-lint judgeResiduals + the § Residual classes table) — null when the
 *  replica scripts are not beside this skill: the residual door then stays closed and says so. */
export const RESIDUAL_JUDGE = await (async () => {
  for (const c of ['../../replica/scripts/', '../replica/']) {
    try {
      const lint = await import(new URL(`${c}gate-ledger-lint.mjs`, import.meta.url));
      const rec = await import(new URL(`${c}progress-record.mjs`, import.meta.url));
      return { judge: lint.judgeResiduals, classes: rec.residualClasses() };
    } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
  }
  return null;
})();
/** Residuals of progress.json that may open the door for this page × width: published-origin regime only. */
export function residualsFor(progress, { slug, template, W }) {
  const arche = (progress && progress.archetypes) || [];
  const entry = arche.find((a) => a.archetype === slug) || arche.find((a) => template && a.pageType === template);
  if (!entry) return [];
  const list = entry.published && entry.published[W] && Array.isArray(entry.published[W].residuals) ? entry.published[W].residuals : [];
  return list.filter((r) => (r && r.page ? r.page === slug : entry.archetype === slug));
}
/** The cached live anchor probe (anchor.mjs --cache file: { key, probedAt, data }) — read as-is, never re-probed here. */
export function readAnchorCache(file) {
  try { const c = JSON.parse(readFileSync(file, 'utf8')); return c && c.data && Array.isArray(c.data.sections) ? c.data : null; } catch { return null; }
}

export function arg(argv, name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) { console.error(`rollout gate-publish: --${name} needs a value`); process.exit(1); }
  return v;
}
const has = (argv, f) => argv.includes(`--${f}`);

// ---- seeded sample (T15.2): LCG over the SORTED slugs of a template, archetypes always in ----
export function lcg(seed) {
  let s = (Number(seed) >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}
export function drawSample(pages, { n, seed, exclude = new Set(), archetypes = new Set() }) {
  const byTemplate = new Map();
  for (const p of pages) { const t = p.templateId || 'untyped'; if (!byTemplate.has(t)) byTemplate.set(t, []); byTemplate.get(t).push(p); }
  const rnd = lcg(seed);
  const picked = [];
  for (const [, list] of [...byTemplate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...list].sort((a, b) => a.slug.localeCompare(b.slug));
    const arche = sorted.filter((p) => archetypes.has(p.slug) && !exclude.has(p.slug));
    const pool = sorted.filter((p) => !archetypes.has(p.slug) && !exclude.has(p.slug));
    for (let i = pool.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; } // Fisher–Yates, seeded
    picked.push(...arche, ...pool.slice(0, n));
  }
  return picked;
}

// ---- records ----
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
/** Published-origin round records of one gate dir, oldest first; prototype rounds and excluded records are not read. */
export function publishedRecords(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^gate-.*\.json$/.test(f)).map((f) => ({ file: join(dir, f), rec: readJson(join(dir, f)) }))
    .filter(({ rec }) => rec && rec.regime === 'published-origin' && !rec.excluded)
    .sort((a, b) => String(a.rec.at || '').localeCompare(String(b.rec.at || '')));
}
const cropOf = (dir, kind, label) => readJson(join(dir, `crop-${kind}-${label}.json`));
/** crop-compare's own verdict; a record without `pass` is no verdict (never re-judged from matchPct — B29). */
const cropOk = (c) => (c && typeof c.pass === 'boolean' ? c.pass : null);

/**
 * One breakpoint's verdict from the newest published-origin record (+ its crop files) — or, with
 * `label`, from THAT round only (a RUN never reads an older round when its own wrote no record).
 * `residuals` (residualsFor) + the judge open the residual door on an over-bar breakpoint.
 */
export function breakpointVerdict(dir, { label = null, exit = null, residuals = [], judge = RESIDUAL_JUDGE } = {}) {
  const recs = publishedRecords(dir);
  const history = recs.filter(({ rec: r }) => ['PASS', 'FAIL'].includes(r.verdict)).map(({ rec: r }) => ({ at: r.at, label: r.label, pixelPct: r.pixelPct, verdict: r.verdict }));
  if (!recs.length && !label) return { status: 'ungated', pass: false, reason: 'no published-origin record', history: [] };
  const pick = label ? recs.find(({ rec: r }) => r.label === label) : recs[recs.length - 1];
  if (!pick) {
    if (exit === 3) return { status: 'blocked', pass: false, reason: `blocked (challenge / auth) — gate.sh wrote no record for ${label}`, history };
    return { status: 'unmeasured', pass: false, reason: `gate.sh wrote no record for ${label}${exit === null ? '' : ` (exit ${exit})`} — no verdict this round`, history };
  }
  const { file, rec } = pick;
  const door = (out) => {
    if (!residuals.length) return out;
    if (!judge) return { ...out, reason: `${out.reason} — residual door closed: replica scripts not found beside this skill` };
    const problems = judge.judge(residuals, judge.classes);
    if (problems.length) return { ...out, reason: `${out.reason} — residual door closed: ${problems.join(', ')}` };
    const r = residuals[0];
    const cause = String(r.cause || '');
    const cls = (cause.match(/^register:R-\d+/i) || [cause.split(/[:\s]/)[0]])[0];
    return { ...out, status: 'pass', pass: true, reason: `residual ${cls} accepted by ${r.acceptedBy} (was: ${out.reason})`, residual: { class: cls, cause: r.cause, acceptedBy: r.acceptedBy } };
  };
  const base = { record: file, label: rec.label, at: rec.at, verdict: rec.verdict, exit: rec.exit, pixelPct: rec.pixelPct ?? null, pixelPctUnmasked: rec.pixelPctUnmasked ?? null, heightDelta: rec.heightDelta ?? null, capturedAt: rec.ref && rec.ref.capturedAt, history };
  if (rec.exit === 3) return { ...base, status: 'blocked', pass: false, reason: 'blocked (challenge / auth) — no verdict' };
  if (!['PASS', 'FAIL'].includes(rec.verdict)) return { ...base, status: 'unmeasured', pass: false, reason: `no verdict (exit ${rec.exit})` };
  const heightOk = Math.abs(Number(rec.heightDelta) || 0) <= HEIGHT_BAR_PX;
  const header = cropOf(dir, 'header', rec.label); const footer = cropOf(dir, 'footer', rec.label);
  const hOk = cropOk(header); const fOk = cropOk(footer);
  const cropsOk = hOk === null || fOk === null ? null : hOk && fOk;
  const out = { ...base, heightOk, cropsOk, header: header ? { matchPct: header.matchPct, pass: hOk } : null, footer: footer ? { matchPct: footer.matchPct, pass: fOk } : null };
  if (rec.verdict === 'FAIL') return door({ ...out, status: 'fail', pass: false, reason: `pixel ${rec.pixelPct} % (record FAIL)` });
  if (!heightOk) return door({ ...out, status: 'fail', pass: false, reason: `|Δh| ${rec.heightDelta} px > ${HEIGHT_BAR_PX}` });
  if (cropsOk === null) return { ...out, status: 'unmeasured', pass: false, reason: header && footer ? 'chrome crop record carries no pass verdict (re-run crop-compare)' : 'chrome crops not run (header/footer crop files missing)' };
  if (!cropsOk) { const k = hOk ? 'footer' : 'header'; const c = hOk ? footer : header; return door({ ...out, status: 'fail', pass: false, reason: `chrome crop ${k} match ${c.matchPct} % — crop-compare FAIL${Number.isFinite(Number(c.threshold)) ? ` (its bar ${c.threshold} % diff)` : ''}` }); }
  return { ...out, status: 'pass', pass: true, reason: null };
}

/** Page status from its breakpoint verdicts (+ wasLive). */
export function pageStatus(bps, wasLive) {
  const st = Object.values(bps).map((b) => b.status);
  if (st.includes('fail')) return wasLive ? 'published-failing' : 'fail';
  if (st.includes('blocked')) return 'blocked';
  if (st.includes('unmeasured')) return 'unmeasured';
  if (st.includes('ungated')) return 'ungated';
  return 'pass';
}
export const bestOfLast3 = (history) => { const l = history.slice(-3).map((h) => Number(h.pixelPct)).filter(Number.isFinite); return l.length ? Math.min(...l) : null; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const p90 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)] : null; };
const r2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);

/** Build the report object from the pages' verdicts (pure). */
export function buildReport(entries, { widths, previous = null, sample = null, at = new Date().toISOString() } = {}) {
  const pages = { ...((previous && previous.pages) || {}) };
  const counts = { delivered: entries.length, gated: 0, pass: 0, fail: 0, publishedFailing: 0, unmeasured: 0, ungated: 0, blocked: 0 };
  const nd = {};
  for (const e of entries) {
    const status = pageStatus(e.breakpoints, e.wasLive);
    const prev = pages[e.path];
    // newest record timestamp; a page with no record at all (ungated / dry) keeps its previous `at` while its
    // status is unchanged — so a re-run over the same records adds no history row for it either
    const latestAt = Object.values(e.breakpoints).map((b) => b.at).filter(Boolean).sort().pop() || (prev && prev.latest && prev.latest.status === status ? prev.latest.at : at);
    const bp = {};
    const bol3 = {}; const reference = {};
    for (const W of widths) {
      const b = e.breakpoints[W];
      bp[W] = { verdict: b.verdict ?? null, exit: b.exit ?? null, pixelPct: b.pixelPct ?? null, pixelPctUnmasked: b.pixelPctUnmasked ?? null, heightDelta: b.heightDelta ?? null, heightOk: b.heightOk ?? null, cropsOk: b.cropsOk ?? null, header: b.header ?? null, footer: b.footer ?? null, pass: b.pass, status: b.status, record: b.record ?? null, reason: b.reason, residual: b.residual ?? null };
      bol3[W] = bestOfLast3(b.history || []);
      if (b.capturedAt) reference[W] = b.capturedAt;
    }
    const history = [...((prev && prev.history) || [])];
    if (!prev || !prev.latest || prev.latest.at !== latestAt) history.push({ at: latestAt, status, breakpoints: Object.fromEntries(widths.map((W) => [W, bp[W].pixelPct])) });
    pages[e.path] = { path: e.path, slug: e.slug, template: e.template || null, wasLive: !!e.wasLive, latest: { at: latestAt, pass: status === 'pass', status, breakpoints: bp }, bestOfLast3: bol3, history: history.slice(-10), reference };
    if (status === 'pass') counts.pass += 1; else if (status === 'fail') counts.fail += 1; else if (status === 'published-failing') counts.publishedFailing += 1; else if (status === 'unmeasured') counts.unmeasured += 1; else if (status === 'blocked') counts.blocked += 1; else counts.ungated += 1;
    if (['pass', 'fail', 'published-failing'].includes(status)) counts.gated += 1;
    const t = e.template || 'untyped';
    for (const W of widths) { const v = bp[W].pixelPctUnmasked; if (Number.isFinite(v)) { nd[t] ??= {}; (nd[t][W] ??= []).push(v); } }
  }
  const templates = {};
  for (const e of [...entries].sort((x, y) => String(x.template || 'untyped').localeCompare(String(y.template || 'untyped')))) {
    const t = e.template || 'untyped'; const st = pages[e.path].latest.status;
    const T = templates[t] ??= { pages: 0, pass: 0, fail: 0, unmeasured: 0, ungated: 0, atBar: true };
    T.pages += 1;
    if (st === 'pass') T.pass += 1; else if (st === 'fail' || st === 'published-failing') T.fail += 1; else if (st === 'ungated') T.ungated += 1; else T.unmeasured += 1;
    if (st !== 'pass') T.atBar = false;
  }
  const neutralDiff = {};
  for (const [t, byW] of Object.entries(nd)) { neutralDiff[t] = {}; for (const [W, arr] of Object.entries(byW)) neutralDiff[t][W] = { n: arr.length, median: r2(median(arr)), p90: r2(p90(arr)), under10: r2(arr.filter((v) => v < 10).length / arr.length) }; }
  return {
    _provenance: { writtenBy: 'stardust:rollout gate-publish.mjs', writtenAt: at, bars: { pixel: 'pixel-compare record pass (unchanged)', heightDeltaPx: HEIGHT_BAR_PX, chromeCrops: 'crop-compare pass (unchanged)' }, regime: 'published-origin' },
    generatedAt: at, breakpoints: widths, ...(sample ? { sample } : {}), coverage: counts, templates, neutralDiff, pages,
  };
}
export function coverageLine(c) {
  return `published-gated ${c.gated} of ${c.delivered} · PASS ${c.pass} · FAIL ${c.fail} · unmeasured ${c.unmeasured} · ungated ${c.ungated}${c.publishedFailing ? ` · published-failing ${c.publishedFailing}` : ''}${c.blocked ? ` · blocked ${c.blocked}` : ''}`;
}
export function renderMd(report, selectedPaths) {
  const widths = report.breakpoints;
  const rows = selectedPaths.map((p) => report.pages[p]).filter(Boolean).sort((a, b) => ['published-failing', 'fail', 'blocked', 'unmeasured', 'ungated', 'pass'].indexOf(a.latest.status) - ['published-failing', 'fail', 'blocked', 'unmeasured', 'ungated', 'pass'].indexOf(b.latest.status));
  const md = ['# gate-report — published-origin page gate', '', `Generated ${report.generatedAt}. Regime published-origin. Bars: pixel = record pass · |Δh| ≤ ${HEIGHT_BAR_PX} px · chrome crops = crop-compare pass (none restated here).`, '', `**${coverageLine(report.coverage)}**`, ''];
  if (report.sample) md.push(`Sample: seed ${report.sample.seed} · n ${report.sample.n} per template${report.sample.excluded.length ? ` · excluded ${report.sample.excluded.join(', ')}` : ''}`, '');
  md.push('| template | pages | PASS | FAIL | unmeasured | ungated | at the bar |', '|---|---|---|---|---|---|---|');
  for (const [t, T] of Object.entries(report.templates || {})) md.push(`| ${t} | ${T.pages} | ${T.pass} | ${T.fail} | ${T.unmeasured} | ${T.ungated} | ${T.atBar ? 'yes' : 'no — not published'} |`);
  md.push('');
  md.push(`| page | status | ${widths.map((W) => `${W}`).join(' | ')} | wasLive | at |`, `|---|---|${widths.map(() => '---').join('|')}|---|---|`);
  for (const r of rows) md.push(`| ${r.path} | ${r.latest.status} | ${widths.map((W) => { const b = r.latest.breakpoints[W]; return b.status === 'ungated' ? 'ungated' : b.status === 'unmeasured' || b.status === 'blocked' ? `${b.status} (${b.reason})` : `${b.status.toUpperCase()} ${b.pixelPct} % Δh ${b.heightDelta}${b.cropsOk === false ? ' chrome✗' : ''}${b.residual ? ` (residual ${b.residual.class})` : ''}`; }).join(' | ')} | ${r.wasLive ? 'yes' : 'no'} | ${r.latest.at} |`);
  md.push('', '## neutralDiff (reporting KPI, not a bar)', '', '| template | bp | n | median | p90 | share < 10 % |', '|---|---|---|---|---|---|');
  for (const [t, byW] of Object.entries(report.neutralDiff)) for (const [W, v] of Object.entries(byW)) md.push(`| ${t} | ${W} | ${v.n} | ${v.median} | ${v.p90} | ${v.under10} |`);
  if (!Object.keys(report.neutralDiff).length) md.push('| — | — | 0 | not measured | not measured | not measured |');
  md.push('', 'Rows without a PASS are held from the publish run and re-drive with the same run once this report changes; the escape flags are operator/owner flags, never hands-off (publish-gate.md § Gate 8 — the hold inside deploy-batch --publish is pending the deploy hunk; until then read the held rows here before publishing).', '');
  return md.join('\n');
}

/** Run `fn` over `items` with at most `n` in flight (order of results = order of items). */
export async function runPool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  const worker = async () => { while (next < items.length) { const k = next; next += 1; out[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, n | 0), items.length || 1) }, worker));
  return out;
}
const spawnP = (cmd, args, env) => new Promise((res) => {
  let stdout = ''; let stderr = '';
  const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  c.on('error', (e) => res({ status: null, stdout, stderr: `${stderr}${e.message}` }));
  c.on('close', (status) => res({ status, stdout, stderr }));
});

// ---- CLI ----
const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
async function main() {
  const argv = process.argv;
  const USAGE = [
    'usage: gate-publish.mjs (--paths <file|/a,/b> | --slug <s> | --all-delivered | --sample <n> [--seed <s>] [--exclude <slugs|file>])',
    '         --origin <delivered origin> [--widths 1440,360] [--gates-dir <dir>] [--out <rolloutDir>] [--ledger <file>] [--state <file>]',
    '         [--refresh] [--variance] [--concurrency 1|2] [--report] [--dry-run]',
    '  exit 0 every measured page PASS · 1 usage · 2 a page FAIL / published-failing · 3 a page blocked (challenge/auth); 124 from an instrument = unmeasured, never 2',
  ].join('\n');
  if (has(argv, 'help') || has(argv, 'h')) { console.log(USAGE); process.exit(0); }
  const OUT = arg(argv, 'out', 'stardust/rollout');
  const GATES = arg(argv, 'gates-dir', 'stardust/replica/gates');
  const LEDGER = arg(argv, 'ledger', 'content/.deploy-ledger.json');
  const STATE = arg(argv, 'state', 'stardust/state.json');
  const REPORT_ONLY = has(argv, 'report');
  const DRY = has(argv, 'dry-run');
  const ORIGIN = (arg(argv, 'origin', null) || '').replace(/\/+$/, '');
  const config = readJSON(join(OUT, 'rollout.json'), {});
  const pagesDoc = readJSON(join(OUT, 'coverage', 'pages.json'));
  if (!pagesDoc) { console.error(`rollout gate-publish: ${join(OUT, 'coverage', 'pages.json')} not found — run inventory.mjs first.`); process.exit(1); }
  const progress = readJSON(join(dirname(GATES), 'progress.json'), null) || readJSON('stardust/replica/progress.json', null);
  const widths = (arg(argv, 'widths', null) || (progress && Array.isArray(progress.breakpointsConfigured) && progress.breakpointsConfigured.join(',')) || '1440,360').split(',').map((w) => Number(w.trim())).filter(Number.isFinite);
  const pages = pagesDoc.pages || [];
  const state = readJSON(STATE, null);
  const liveUrlOf = (p) => { const sp = state && (state.pages || []).find((x) => x.slug === p.slug); if (sp && sp.url) return sp.url; const src = config.site && config.site.sourceUrl; return src ? `${String(src).replace(/\/+$/, '')}${p.path || '/'}` : null; };
  const ledger = readJSON(LEDGER, {}) || {};
  const wasLiveOf = (p) => { const r = ledger[deliveredPathOf(p)] || ledger[p.path]; return !!(r && r.status === 'live'); };
  const archetypes = new Set((progress && (progress.archetypes || []).map((a) => a.archetype)) || []);
  const templateOf = (p) => p.templateId || (readJson(p.source && p.source.metaJson) || {}).type || null;

  // selection
  let selected; let sample = null;
  const delivered = pages.filter((p) => isDelivered(p) && (p.delivery && p.delivery.type ? p.delivery.type === 'page' : true));
  if (arg(argv, 'paths', null)) {
    const raw = arg(argv, 'paths', null);
    const list = existsSync(raw) ? readFileSync(raw, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : raw.split(',').map((s) => s.trim()).filter(Boolean);
    const want = new Set(list);
    selected = pages.filter((p) => want.has(deliveredPathOf(p)) || want.has(p.path));
    const missing = list.filter((w) => !pages.some((p) => deliveredPathOf(p) === w || p.path === w));
    if (missing.length) console.error(`rollout gate-publish: no coverage row for ${missing.join(' ')} (not invented)`);
  } else if (arg(argv, 'slug', null)) {
    selected = pages.filter((p) => p.slug === arg(argv, 'slug', null));
    if (!selected.length) { console.error(`rollout gate-publish: no page with slug "${arg(argv, 'slug', null)}"`); process.exit(1); }
  } else if (has(argv, 'all-delivered')) selected = delivered;
  else if (arg(argv, 'sample', null)) {
    const n = Number(arg(argv, 'sample', null)); if (!Number.isInteger(n) || n < 1) { console.error('rollout gate-publish: --sample needs a positive integer'); process.exit(1); }
    const seed = arg(argv, 'seed', String(Date.now() % 100000));
    const exRaw = arg(argv, 'exclude', ''); const excluded = exRaw ? (existsSync(exRaw) ? readFileSync(exRaw, 'utf8').split('\n') : exRaw.split(',')).map((s) => s.trim()).filter(Boolean) : [];
    selected = drawSample(delivered, { n, seed, exclude: new Set(excluded), archetypes });
    sample = { seed, n, excluded, drawn: selected.map((p) => p.slug) };
  } else { console.error(USAGE); process.exit(1); }
  if (!REPORT_ONLY && !DRY && !ORIGIN) { console.error(`rollout gate-publish: --origin <delivered origin> is required to run the gate (or use --report / --dry-run).\n${USAGE}`); process.exit(1); }
  if (!REPORT_ONLY && !DRY && !/\.aem\.page$|\.aem\.page\/|\.aem\.live/.test(ORIGIN)) console.error('rollout gate-publish: note — the D1 default gates the PREVIEW origin (*.aem.page); aem.live only after an owner-decided publish.');

  const HERE = dirname(new URL(import.meta.url).pathname);
  const REPLICA = [join(HERE, '..', '..', 'replica', 'scripts'), join(HERE, '..', 'replica')].find((d) => existsSync(join(d, 'gate.sh'))) || join(HERE, '..', '..', 'replica', 'scripts');
  // STARDUST_GATE_SH: the fixture test's stub round runner (writes a record under $GATE_DIR_ROOT, no browser)
  const GATE_SH = process.env.STARDUST_GATE_SH || join(REPLICA, 'gate.sh');
  // gate.sh honours GATE_DIR_ROOT (its DIR = $GATE_DIR_ROOT/<slug>-<W>); a project copy predating it would read
  // verdicts from one place and write records to another → a RUN into a non-default dir is refused for that copy only
  const DEFAULT_GATES = 'stardust/replica/gates';
  const gateShHonoursDir = existsSync(GATE_SH) && /GATE_DIR_ROOT/.test(readFileSync(GATE_SH, 'utf8'));
  if (!REPORT_ONLY && !DRY && resolve(GATES) !== resolve(DEFAULT_GATES) && !gateShHonoursDir) {
    console.error(`rollout gate-publish: --gates-dir ${GATES} cannot be used for a RUN — ${GATE_SH} writes ${DEFAULT_GATES}/<slug>-<W> and does not honour GATE_DIR_ROOT (a copy predating it). Update the copy, run with the default dir, or use --report / --dry-run, which read any dir.`);
    process.exit(1);
  }
  const gateEnv = resolve(GATES) !== resolve(DEFAULT_GATES) ? { GATE_DIR_ROOT: GATES } : {};
  const nextLabel = (dir) => `pub${(existsSync(dir) ? readdirSync(dir).filter((f) => /^gate-pub\d+\.json$/.test(f)).length : 0) + 1}`;
  const cached = (dir) => existsSync(join(dir, 'live.png'));

  // progress (file disabled under --report / --dry-run — one offline pass)
  const { createProgress } = await (async () => { for (const c of ['../../stardust/scripts/progress.mjs', '../stardust/progress.mjs']) { try { return await import(new URL(c, import.meta.url)); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; } } return { createProgress: ({ driver, total }) => { const s = { ok: 0, failed: 0, noverdict: 0, done: 0, total }; return { state: s, tick({ ok, noverdict }) { s.done += 1; if (noverdict) s.noverdict += 1; else if (ok) s.ok += 1; else s.failed += 1; }, set() {}, summaryLine({ exit, details, extra = {} }) { return [`SUMMARY ${driver}`, `ok=${s.ok}`, `failed=${s.failed}`, ...(s.noverdict ? [`noverdict=${s.noverdict}`] : []), `exit=${exit}`, `details=${details}`, ...Object.entries(extra).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${v}`)].join(' '); } }; } }; })();
  const prog = createProgress({ file: REPORT_ONLY || DRY ? null : 'stardust/.work/rollout/gate-publish.progress.json', driver: 'gate-publish', total: selected.length, extra: { regime: 'published-origin', origin: ORIGIN || null } });

  let blocked = false;
  const entries = [];
  const commands = [];
  const runOne = async (p) => {
    const live = liveUrlOf(p);
    const served = deliveredPathOf(p);
    const bps = {};
    for (const W of widths) {
      const dir = join(GATES, `${p.slug}-${W}`);
      const residuals = residualsFor(progress, { slug: p.slug, template: templateOf(p), W });
      let label = null; let exit = null;
      if (!REPORT_ONLY) {
        label = nextLabel(dir);
        const cmd = ['bash', GATE_SH, p.slug, live || '<live url missing>', `${ORIGIN}${served}`, String(W), label, '--regime', 'published-origin', ...(archetypes.has(p.slug) ? ['--record'] : []), ...(has(argv, 'refresh') ? ['--refresh'] : []), ...(has(argv, 'variance') ? ['--variance'] : [])];
        commands.push(cmd.join(' '));
        if (!DRY) {
          if (!live) { bps[W] = { status: 'unmeasured', pass: false, reason: 'no live URL (state.json pages[].url / rollout.json site.sourceUrl)', history: [] }; continue; }
          const r = await spawnP(cmd[0], cmd.slice(1), gateEnv);
          exit = r.status;
          process.stdout.write(r.stdout || '');
          if (r.status === 3) blocked = true;
          if ((r.status === 0 || r.status === 2) && existsSync(join(dir, 'live.png')) && existsSync(join(dir, 'build.png'))) {
            // chrome crops: header band from the first section's top, footer bands aligned per side (anchor.mjs; live via --cache = zero extra hits)
            const anchor = (url, extra) => { const a = spawnSync(process.execPath, [join(REPLICA, 'anchor.mjs'), url, '--width', String(W), '--json', ...extra], { encoding: 'utf8' }); try { return JSON.parse(a.stdout.trim().split('\n').pop()); } catch { return null; } };
            // live side: read gate.sh's cached probe as-is (its key may carry options this driver does not pass — a key
            // mismatch inside anchor.mjs would re-probe = one extra source-site hit); probe only when no cache exists
            const la = readAnchorCache(join(dir, 'anchor-live.json')) || anchor(live, ['--cache', join(dir, 'anchor-live.json')]); const ba = anchor(`${ORIGIN}${served}`, []);
            const crop = (kind, args) => { const c = spawnSync(process.execPath, [join(REPLICA, 'crop-compare.mjs'), join(dir, 'live.png'), join(dir, 'build.png'), ...args, '--json', '--out', join(dir, `crop-${kind}-${label}.png`)], { encoding: 'utf8' }); try { const j = JSON.parse(c.stdout.trim().split('\n').find((l) => l.startsWith('{')) || 'null'); if (j) { j.pass = c.status === 0; writeFileSync(join(dir, `crop-${kind}-${label}.json`), `${JSON.stringify(j, null, 2)}\n`); } } catch { /* no crop record → unmeasured */ } };
            if (la && ba) {
              const hh = Math.max(40, Math.min(400, (la.sections && la.sections[0] && la.sections[0].box && la.sections[0].box[0]) || 80));
              crop('header', ['--y', '0', '--height', String(hh)]);
              if (la.footer && ba.footer) crop('footer', ['--y', String(la.footer[0]), '--y-b', String(ba.footer[0]), '--height', String(Math.min(la.footer[1], ba.footer[1]))]);
            }
          }
        }
      }
      bps[W] = DRY ? { status: 'ungated', pass: false, reason: 'dry-run', history: [] } : breakpointVerdict(dir, { label, exit, residuals });
    }
    const e = { path: served, slug: p.slug, template: templateOf(p), wasLive: wasLiveOf(p), breakpoints: bps };
    const st = pageStatus(bps, e.wasLive);
    prog.tick({ ok: st === 'pass', noverdict: ['unmeasured', 'ungated', 'blocked'].includes(st), path: served });
    return e;
  };
  // sequential by default (hit-minimisation on the source site: one gate.sh round at a time); --concurrency 2 runs
  // two rounds at once ONLY over pages whose live capture is already cached at every width — they go last
  const conc = Math.min(2, Math.max(1, Number(arg(argv, 'concurrency', '1')) || 1));
  const cachedOnly = conc === 2 ? selected.filter((p) => widths.every((W) => cached(join(GATES, `${p.slug}-${W}`)))) : [];
  const uncached = selected.filter((p) => !cachedOnly.includes(p));
  entries.push(...await runPool(uncached, 1, runOne));
  entries.push(...await runPool(cachedOnly, conc, runOne));
  if (!REPORT_ONLY && !DRY && conc === 2) console.log(`gate-publish: ${uncached.length} page(s) sequential (live capture) · ${cachedOnly.length} at concurrency 2 (live cached)`);

  if (DRY) { console.log(commands.join('\n')); console.log(`gate-publish --dry-run: ${selected.length} page(s) × ${widths.length} breakpoint(s) — ${commands.length} sequential gate.sh rounds, nothing ran`); process.exit(0); }

  const reportPath = join(OUT, 'gate-report.json');
  const previous = readJSON(reportPath, null);
  const report = buildReport(entries, { widths, previous, sample });
  writeJSON(reportPath, report);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'gate-report.md'), renderMd(report, entries.map((e) => e.path)));
  // delivery.gate into coverage (the row's gate status; verify.mjs --gate-report applies the verified rule)
  let merged = 0;
  for (const e of entries) {
    const row = pages.find((p) => deliveredPathOf(p) === e.path || p.path === e.path); if (!row) continue;
    const r = report.pages[e.path];
    row.delivery = row.delivery || { status: 'pending' };
    row.delivery.gate = { status: r.latest.status, at: r.latest.at, breakpoints: Object.fromEntries(widths.map((W) => [W, { pixelPct: r.latest.breakpoints[W].pixelPct, heightDelta: r.latest.breakpoints[W].heightDelta, cropsOk: r.latest.breakpoints[W].cropsOk, pass: r.latest.breakpoints[W].pass }])), report: reportPath };
    merged += 1;
  }
  pagesDoc.generatedAt = new Date().toISOString();
  writeJSON(join(OUT, 'coverage', 'pages.json'), pagesDoc);

  const c = report.coverage;
  const failing = Object.values(report.pages).filter((r) => entries.some((e) => e.path === r.path) && ['fail', 'published-failing'].includes(r.latest.status));
  console.log(`gate-publish (${REPORT_ONLY ? 'report from records' : ORIGIN}) — ${entries.length} page(s) × ${widths.join('/')}`);
  console.log(coverageLine(c));
  const notAtBar = Object.entries(report.templates).filter(([, T]) => !T.atBar);
  if (notAtBar.length) console.log(`templates not at the bar (not published): ${notAtBar.map(([t, T]) => `${t} (${T.pass}/${T.pages} PASS)`).join(' · ')}`);
  for (const r of failing.slice(0, 10)) console.log(`  ✗ ${r.path} ${r.latest.status}: ${widths.map((W) => `${W} ${r.latest.breakpoints[W].status}${r.latest.breakpoints[W].reason ? ` (${r.latest.breakpoints[W].reason})` : ''}`).join(' · ')}`);
  if (failing.length > 10) console.log(`  … +${failing.length - 10} (see ${join(OUT, 'gate-report.md')})`);
  console.log(`report: ${reportPath} · ${join(OUT, 'gate-report.md')} · delivery.gate merged on ${merged} coverage row(s)`);
  const exitCode = blocked || c.blocked ? 3 : (c.fail + c.publishedFailing) ? 2 : 0;
  console.log(prog.summaryLine({ exit: exitCode, details: reportPath, extra: { ungated: c.ungated, regime: 'published-origin' } }));
  process.exit(exitCode);
}
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
