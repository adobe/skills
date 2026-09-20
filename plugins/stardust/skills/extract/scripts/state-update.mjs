#!/usr/bin/env node
/**
 * state-update.mjs — Phase 6 of stardust:extract: the mechanical state write.
 * Merges the crawled pages into stardust/state.json BY SLUG (state-machine.md
 * § Concurrency), marks a page `extracted` ONLY when its record carries live-render
 * provenance (crawl.mjs validateProvenance + validateRecord — the write-time half of
 * the synthesis guard, current-state-schema.md § Live-render evidence), appends
 * exactly one status.jsonl line, records Phase 2.5 vision verdicts into
 * _crawl-log.json#visionCheck[] and prints the per-page evidence table with the
 * mandatory `Provenance: <live>/<total> live` line (prep-mode.md § 5).
 *
 * Usage:
 *   node state-update.mjs [--out stardust/current] [--state stardust/state.json] [--prep] [--vision <file>] [--dry-run]
 *   node state-update.mjs --help
 *     --prep            prep-mode contract: exit 1 when live < total (the run is incomplete)
 *     --vision <file>   JSON: [{ slug, verdict, notes }] or { visionCheck: [...] } — merged
 *                       into _crawl-log.json#visionCheck[] by slug (union; an existing
 *                       slug's entry is kept, nothing else in the log is rewritten)
 *     --dry-run         print the table and the would-be writes; write nothing
 *
 * Reads:  <out>/pages/*.json (exit 2 when the dir is missing), <out>/_crawl-log.json
 *         (originUrl, discovery.count, runs[last].args.cap, visionCheck[]), the
 *         existing state.json, and the presence of _brand-extraction.json, PRODUCT.md,
 *         DESIGN.md, DESIGN.json, brand-review.html for site.extractPhases.
 * Writes: state.json — `_provenance` first; `site.{originUrl, deployUrl, extractedAt,
 *         pageCap, totalDiscovered, crawled, extractPhases{captured, visionChecked,
 *         brandSurface, docs, review, scripts: true}}`; `pages[]` merged by slug
 *         (status `extracted` + currentStatePath for live records only; existing
 *         status beyond `extracted` is never demoted; `type`, `prototypePath`,
 *         `migratedPath`, `history` preserved); every other top-level key (direction,
 *         handsOff, flow*, impeccable, credentials, designSource, unknown) preserved
 *         verbatim. stardust/status.jsonl — ONE line, skill stardust:extract, phase
 *         6-state, event `end` (or `blocked` under --prep with live < total), detail,
 *         artifact, next. _crawl-log.json — visionCheck[] union only.
 *
 * Exit codes: 0 written / dry-printed · 1 --prep and live < total (synthesis guard;
 *   state and status.jsonl are still written so the blocked line exists) · 2 usage
 *   or missing pages dir / unreadable state.json.
 * Exports (evals/fixtures/state-update.test.mjs): parseArgs, assessRecords,
 *   mergeState, mergeVisionCheck, evidenceTable — importing runs nothing; main()
 *   runs only when the file is the entry script.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateProvenance, validateRecord } from './crawl.mjs';

const HELP = `state-update — Phase 6: merge-by-slug state.json, one status.jsonl line, visionCheck[] merge, evidence table
Usage: node state-update.mjs [--out stardust/current] [--state stardust/state.json] [--prep] [--vision <file>] [--dry-run]
Exit codes: 0 ok · 1 --prep and live < total · 2 usage / missing pages dir.`;

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) return { help: true };
  const o = { out: 'stardust/current', state: null, prep: false, vision: null, dryRun: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--out') o.out = rest[++i];
    else if (a === '--state') o.state = rest[++i];
    else if (a === '--prep') o.prep = true;
    else if (a === '--vision') o.vision = rest[++i];
    else if (a === '--dry-run') o.dryRun = true;
    else throw new Error(`unknown flag ${a}`);
  }
  if (!o.out) throw new Error('--out needs a value');
  if (!o.state) o.state = path.join(o.out, '..', 'state.json');
  return o;
}
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Per record: { slug, rec, live, reasons[], warn[] } — live = provenance ok AND validateRecord(legacy) ok. */
export function assessRecords(records) {
  return records.map(({ file, rec }) => {
    const slug = (rec && rec.slug) || file.replace(/\.json$/, '');
    if (!rec || typeof rec !== 'object') return { slug, rec: null, live: false, reasons: ['unreadable JSON'], warn: [] };
    const prov = validateProvenance(rec._provenance); const v = validateRecord(rec, { legacy: true });
    const reasons = [...(prov.ok ? [] : prov.missing.map((m) => `_provenance.${m}`)), ...v.fail.filter((f) => !f.startsWith('_provenance.'))];
    return { slug, rec, live: prov.ok && v.ok, reasons: [...new Set(reasons)], warn: v.warn };
  });
}

const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };
/**
 * Merge-by-slug. `prev` = existing state (or null); `assessed` from assessRecords; `ctx` =
 * { log, outDir, now, artifacts: { brandSurface, docs, review }, visionCount }.
 * Returns { state, marked[], unmarked[] } — never mutates `prev`.
 */
export function mergeState(prev, assessed, ctx) {
  const now = ctx.now || new Date().toISOString(); const p = prev && typeof prev === 'object' ? prev : {};
  const live = assessed.filter((a) => a.live); const run = ctx.log && Array.isArray(ctx.log.runs) ? ctx.log.runs[ctx.log.runs.length - 1] : null;
  const originUrl = (p.site && p.site.originUrl) || ((run && run.args && run.args.url && originOf(run.args.url))) || (live[0] && originOf(live[0].rec.finalUrl || live[0].rec.url)) || null;
  const site = { ...(p.site || {}), originUrl, deployUrl: (p.site && p.site.deployUrl) ?? null, extractedAt: now, pageCap: run && run.args ? (run.args.cap ?? null) : (p.site ? p.site.pageCap ?? null : null), totalDiscovered: (ctx.log && ctx.log.discovery && ctx.log.discovery.count) ?? (p.site ? p.site.totalDiscovered ?? null : null), crawled: live.length,
    extractPhases: { captured: live.length > 0, visionChecked: (ctx.visionCount || 0) > 0, brandSurface: !!(ctx.artifacts && ctx.artifacts.brandSurface), docs: !!(ctx.artifacts && ctx.artifacts.docs), review: !!(ctx.artifacts && ctx.artifacts.review), scripts: true } };
  const { _provenance, site: _s, pages: prevPages, direction, ...others } = p;
  const bySlug = new Map((Array.isArray(prevPages) ? prevPages : []).map((e) => [e.slug, e]));
  const marked = []; const unmarked = [];
  for (const a of assessed) {
    if (!a.live) { unmarked.push({ slug: a.slug, reasons: a.reasons }); continue; }
    const rec = a.rec; const cur = bySlug.get(a.slug) || {};
    const history = Array.isArray(cur.history) ? [...cur.history] : [];
    if (!history.some((h) => h.status === 'extracted')) history.push({ status: 'extracted', at: now });
    const entry = { slug: a.slug, url: rec.url || cur.url || null, title: rec.title ?? cur.title ?? null, type: cur.type ?? null, status: cur.status && cur.status !== 'extracted' ? cur.status : 'extracted', history, stale: cur.stale ?? false, staleReason: cur.staleReason ?? null, currentStatePath: path.join(ctx.outDir || 'stardust/current', 'pages', `${a.slug}.json`), prototypePath: cur.prototypePath ?? null, migratedPath: cur.migratedPath ?? null };
    for (const [k, v] of Object.entries(cur)) if (!(k in entry)) entry[k] = v; // unknown per-page keys ride along
    bySlug.set(a.slug, entry); marked.push(a.slug);
  }
  const state = { _provenance: { writtenBy: 'stardust:extract', writtenAt: now, script: 'state-update.mjs', ...(_provenance && _provenance.stardustVersion ? { stardustVersion: _provenance.stardustVersion } : {}) }, site, direction: direction === undefined ? null : direction, ...others, pages: [...bySlug.values()] };
  return { state, marked, unmarked };
}

/** Union by slug — existing entries kept, new slugs appended; returns { visionCheck, added, kept }. */
export function mergeVisionCheck(existing, incoming) {
  const out = Array.isArray(existing) ? [...existing] : []; const have = new Set(out.map((v) => v.slug)); let added = 0; let kept = 0;
  const list = Array.isArray(incoming) ? incoming : (incoming && Array.isArray(incoming.visionCheck) ? incoming.visionCheck : []);
  for (const v of list) { if (!v || !v.slug) continue; if (have.has(v.slug)) { kept += 1; continue; } out.push({ slug: v.slug, verdict: v.verdict ?? null, notes: v.notes ?? '' }); have.add(v.slug); added += 1; }
  return { visionCheck: out, added, kept };
}

/** The Phase 6 evidence table (extract/SKILL.md § Phase 6) as lines. */
export function evidenceTable(assessed) {
  const rows = assessed.map((a) => { const pr = (a.rec && a.rec._provenance) || {}; const m = (a.rec && a.rec.media) || {}; const imgs = Array.isArray(m.images) ? m.images.length : Array.isArray(m.imgs) ? m.imgs.length : 0; const bgs = Array.isArray(m.cssBackgrounds) ? m.cssBackgrounds.length : 0; return [a.slug, a.live ? 'yes' : 'no', String(pr.waitMode || '-').replace('(fallback)', '(fb)'), String(pr.waitMs ?? '-'), String(pr.httpStatus ?? '-'), `${imgs}/${bgs}`, a.live ? (a.warn.length ? `⚠ ${a.warn.join('; ')}` : '') : `✗ ${a.reasons.join(', ')}`]; });
  const head = ['slug', 'live', 'waitMode', 'waitMs', 'status', 'media(img/bg)', ''];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  return [head, ...rows].map((r) => r.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd());
}

function main() {
  let args;
  try { args = parseArgs(process.argv); } catch (e) { console.error(`state-update: ${e.message}\n\n${HELP}`); process.exit(2); }
  if (args.help) { console.log(HELP); process.exit(0); }
  const pagesDir = path.join(args.out, 'pages');
  if (!existsSync(pagesDir) || !statSync(pagesDir).isDirectory()) { console.error(`state-update: ${pagesDir} is not a directory — run crawl.mjs first\n\n${HELP}`); process.exit(2); }
  const records = readdirSync(pagesDir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort().map((file) => { let rec = null; try { rec = readJson(path.join(pagesDir, file)); } catch { rec = null; } return { file, rec }; });
  const assessed = assessRecords(records);
  let prev = null; if (existsSync(args.state)) { try { prev = readJson(args.state); } catch (e) { console.error(`state-update: ${args.state} is not valid JSON (${e.message}) — not writing`); process.exit(2); } }
  const logPath = path.join(args.out, '_crawl-log.json'); let log = null; if (existsSync(logPath)) { try { log = readJson(logPath); } catch { log = null; } }
  let vision = null; if (args.vision) { try { vision = readJson(args.vision); } catch (e) { console.error(`state-update: --vision ${args.vision} unreadable: ${e.message}`); process.exit(2); } }
  const vc = mergeVisionCheck(log ? log.visionCheck : [], vision || []);
  const has = (f) => existsSync(path.join(args.out, f));
  const artifacts = { brandSurface: has('_brand-extraction.json'), docs: has('PRODUCT.md') && has('DESIGN.md') && has('DESIGN.json'), review: has('brand-review.html') };
  const { state, marked, unmarked } = mergeState(prev, assessed, { log, outDir: args.out, artifacts, visionCount: vc.visionCheck.length });
  const live = assessed.filter((a) => a.live).length; const total = assessed.length; const incomplete = args.prep && live < total;
  console.log('Per-page evidence:'); for (const l of evidenceTable(assessed)) console.log(`  ${l}`);
  const modes = {}; for (const a of assessed) if (a.live) { const m = a.rec._provenance.waitMode; modes[m] = modes[m] || { n: 0, ms: 0 }; modes[m].n += 1; modes[m].ms += a.rec._provenance.waitMs; }
  console.log(`Wait summary: ${Object.entries(modes).map(([m, v]) => `${v.n} at ${m} (avg ${(v.ms / v.n / 1000).toFixed(1)}s)`).join(', ') || 'no live page'}`);
  console.log(`Vision check: ${vc.visionCheck.length} entr${vc.visionCheck.length === 1 ? 'y' : 'ies'}${vision ? ` (+${vc.added} added, ${vc.kept} existing kept)` : ''} — _crawl-log.json#visionCheck`);
  console.log(`Provenance: ${live}/${total} live${live < total ? ` — not marked extracted: ${unmarked.map((u) => `${u.slug} (${u.reasons.join(', ')})`).join('; ')}` : ' (every page has Playwright evidence)'}`);
  const detail = `${live}/${total} live · ${marked.length} marked extracted${unmarked.length ? ` · not marked: ${unmarked.map((u) => u.slug).join(', ')}` : ''}${incomplete ? ' — prep run incomplete (synthesis guard)' : ''}`;
  const line = { ts: state._provenance.writtenAt, skill: 'stardust:extract', phase: '6-state', event: incomplete ? 'blocked' : 'end', detail, artifact: args.state, next: incomplete ? `$stardust extract --refresh ${unmarked.map((u) => u.slug).join(',')}` : (args.prep ? '$stardust direct --prep' : '$stardust direct') };
  const statusPath = path.join(path.dirname(args.state), 'status.jsonl');
  if (args.dryRun) { console.log(`state-update (dry-run): would write ${args.state} (${state.pages.length} page entries), append to ${statusPath}: ${JSON.stringify(line)}${vision ? `, merge ${vc.added} visionCheck entr${vc.added === 1 ? 'y' : 'ies'} into ${logPath}` : ''}`); process.exit(incomplete ? 1 : 0); }
  mkdirSync(path.dirname(args.state), { recursive: true });
  writeFileSync(args.state, `${JSON.stringify(state, null, 2)}\n`);
  appendFileSync(statusPath, `${JSON.stringify(line)}\n`);
  if (vision && log) { const { _provenance, ...rest } = log; writeFileSync(logPath, `${JSON.stringify({ ...(_provenance ? { _provenance } : {}), ...rest, visionCheck: vc.visionCheck }, null, 2)}\n`); } else if (vision && !log) console.error(`state-update: WARN --vision given but ${logPath} is missing — verdicts not recorded`);
  console.log(`state-update: ${args.state} ← ${marked.length} extracted (${state.pages.length} entries) · ${statusPath} +1 ${line.event} line${vision && log ? ` · ${logPath}#visionCheck ${vc.visionCheck.length}` : ''} · extractPhases ${Object.entries(state.site.extractPhases).filter(([, v]) => v).map(([k]) => k).join(',')}`);
  process.exit(incomplete ? 1 : 0);
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entry === import.meta.url) main();
