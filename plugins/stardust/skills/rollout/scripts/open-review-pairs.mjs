#!/usr/bin/env node
/**
 * rollout/open-review-pairs.mjs — the wave-close review pack: one source ↔ delivered pair per row,
 * opened on the LIVE host for the human to compare 1:1 (Phase H review step).
 *
 * Field asks this replaces: "open 10 random migrated pages next to their originals", "one per page
 * type, not all articles", "why localhost and not the live host?". The pack is built from FILES only
 * — no request to the source origin, no request to the delivered origin (hit-minimisation): URLs,
 * gate numbers and reference capture dates are joined from the artifacts that already hold them.
 *
 * Join per delivered coverage row (deployed | verified | stale | failed — never content-pending):
 *   source URL   state.json pages[].url (archetypes + rostered pages) → migrate pageMap[].sourceUrl
 *                (siblings; relative → rollout.json site.sourceUrl + sourceUrl) → site.sourceUrl + path,
 *                marked `(derived)`
 *   EDS URL      https://<rollout.json site.liveHost><delivery.deployedPath | path>  — the live host,
 *                the reviewer authenticates in their own session (da-deploy-protocol.md § Site auth):
 *                never localhost, never a token in the URL — such a URL is refused (exit 2)
 *   gate         stardust/rollout/gate-report.json pages[path].latest (regime published-origin) when the
 *                page has an entry; else stardust/replica/progress.json by templateId → pageType →
 *                archetype breakpoints (published.<bp> first, else the prototype result with regime
 *                `prototype`); a type never gated prints `no verdict` — numbers are COPIED, never re-judged
 *
 * Selection: --per-template <n> (default 1: representative first, delivery order) · --random <n>
 *            [--seed <s>] (seeded, across templates — the seeded dice roll) · --slug a,b · --all
 * Output:    stardust/rollout/review-pack.md (+ review-pack.json): # · template · source → EDS · gate
 *            per breakpoint · regime · reference captured · status; then the login hint.
 * Opening:   `open` (macOS) / `xdg-open` (Linux) both URLs of the FIRST --batch <n> pairs (default 10, the
 *            cap — a human reviews ≤ 10 pairs per sitting); the remaining pairs stay in the pack, opened by a
 *            re-run narrowed with --slug a,b or --random <n> --seed <s>; --no-open writes the pack only
 *            (hands-off, CI, eval — the default when no opener exists).
 *
 * Usage: node skills/rollout/scripts/open-review-pairs.mjs [--per-template 1 | --random <n> [--seed <s>] | --slug a,b | --all]
 *          [--out stardust/rollout] [--state stardust/state.json] [--progress stardust/replica/progress.json]
 *          [--gate-report <out>/gate-report.json] [--batch 10] [--no-open]
 * Exit: 0 pack written · 1 coverage missing (run inventory.mjs) / no liveHost / no delivered row · 2 usage
 *       (a value flag without a value — the rollout family's usage code) or a pair that would open on
 *       localhost / 127.0.0.1 or carry a token — the pack is NOT written (never a token in a URL)
 */
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readJSON, writeJSON, siteBase, deliveredPathOf, isDelivered } from './lib.mjs';

function arg(argv, name, fallback) { const i = argv.indexOf(`--${name}`); if (i === -1) return fallback; const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) { console.error(`open-review-pairs: --${name} needs a value`); process.exit(2); } return v; }
const has = (argv, f) => argv.includes(`--${f}`);

export function lcg(seed) { let s = (Number(seed) >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; }; }
/** A URL the reviewer may open: the live host or the source host — never localhost, never a token. */
export function reviewable(url) {
  if (!url) return false;
  try { const u = new URL(url); if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(u.hostname)) return false; if (/(^|[?&#])(token|access_token|auth|apikey)=/i.test(u.search + u.hash)) return false; return /^https?:$/.test(u.protocol); } catch { return false; }
}

/** Build the pair rows (pure). */
export function buildPairs({ pages, config, state, progress, gateReport, templates }) {
  const base = siteBase(config, null);
  const srcBase = ((config && config.site && config.site.sourceUrl) || '').replace(/\/+$/, '');
  const statePages = new Map(((state && state.pages) || []).map((p) => [p.slug, p]));
  const pageMap = new Map((((state && state.migrate) || {}).pageMap || []).map((m) => [m.slug, m]));
  const typeOfTemplate = new Map(); // templateId → progress archetype entry
  for (const a of (progress && progress.archetypes) || []) typeOfTemplate.set(a.pageType, a);
  const repOf = new Map(((templates && templates.templates) || []).map((t) => [t.id, t.representativeSlug]));
  const bps = (progress && progress.breakpointsConfigured) || [1440, 360];
  const rows = [];
  for (const p of pages.filter(isDelivered)) {
    const sp = statePages.get(p.slug); const pm = pageMap.get(p.slug);
    let source = sp && sp.url ? sp.url : null; let derived = false;
    if (!source && pm && pm.sourceUrl) source = /^https?:/i.test(pm.sourceUrl) ? pm.sourceUrl : (srcBase ? `${srcBase}${pm.sourceUrl.startsWith('/') ? '' : '/'}${pm.sourceUrl}` : null);
    if (!source && srcBase) { source = `${srcBase}${p.path || '/'}`; derived = true; }
    const eds = base ? `${base}${deliveredPathOf(p)}` : null;
    // gate numbers: the page's own published-origin entry first, else the archetype's ledger (copied, never re-judged)
    const gate = {}; let regime = null; let refAt = null;
    const gr = gateReport && gateReport.pages && (gateReport.pages[deliveredPathOf(p)] || gateReport.pages[p.path] || Object.values(gateReport.pages).find((x) => x.slug === p.slug));
    if (gr && gr.latest) {
      regime = 'published-origin';
      for (const W of bps) { const b = gr.latest.breakpoints && gr.latest.breakpoints[W]; gate[W] = !b || b.status === 'ungated' ? 'ungated' : b.status === 'unmeasured' || b.status === 'blocked' ? 'unmeasured' : `${b.pass ? 'PASS' : 'FAIL'} ${b.pixelPct} %`; }
      refAt = Object.values(gr.reference || {})[0] || null;
    } else {
      const a = typeOfTemplate.get(p.templateId);
      if (a && a.gated && a.breakpoints && Object.keys(a.breakpoints).length) {
        for (const W of bps) {
          const pub = a.published && a.published[W]; const bp = a.breakpoints[W];
          if (pub && pub.result) { gate[W] = `${pub.result.pass ? 'PASS' : 'FAIL'} ${pub.result.pixelPct} %`; regime = 'published-origin'; refAt = refAt || (pub.result.ref && pub.result.ref.capturedAt) || null; }
          else if (bp && bp.result) { gate[W] = `${bp.result.pass ? 'PASS' : 'FAIL'} ${bp.result.pixelPct} %`; regime = regime || (bp.result.regime || 'prototype'); refAt = refAt || (bp.result.ref && bp.result.ref.capturedAt) || null; }
          else gate[W] = 'ungated';
        }
        if (a.archetype !== p.slug) gate.inherited = a.archetype; // a sibling prints its archetype's number, labelled
      } else for (const W of bps) gate[W] = 'no verdict';
    }
    rows.push({ slug: p.slug, template: p.templateId || 'untyped', representative: repOf.get(p.templateId) === p.slug, status: (p.delivery && p.delivery.status) || 'pending', source, sourceDerived: derived, eds, gate, regime, referenceCapturedAt: refAt });
  }
  return { rows, bps };
}

export function selectRows(rows, { perTemplate = 1, random = 0, seed = 1, slugs = null, all = false }) {
  if (all) return rows;
  if (slugs) return rows.filter((r) => slugs.includes(r.slug));
  if (random > 0) { const rnd = lcg(seed); const pool = [...rows].sort((a, b) => a.slug.localeCompare(b.slug)); for (let i = pool.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; } return pool.slice(0, random); }
  const byT = new Map();
  for (const r of rows) { const l = byT.get(r.template) || []; l.push(r); byT.set(r.template, l); }
  const out = [];
  for (const [, l] of byT) { l.sort((a, b) => (b.representative ? 1 : 0) - (a.representative ? 1 : 0)); out.push(...l.slice(0, perTemplate)); }
  return out;
}

export function renderPack(rows, bps, { at = new Date().toISOString(), selection = '' } = {}) {
  const md = ['# Review pack — source ↔ delivered pairs', '', `Generated ${at}${selection ? ` · ${selection}` : ''}. Open both links of a row side by side on the live host; log in to the delivered site in your own session (skills/deploy/da-deploy-protocol.md § Site auth) — never a localhost proxy, never a token in a URL. Gate numbers are copied from the ledgers (regime shown), never re-judged here.`, '',
    `| # | template | source | delivered | ${bps.map((W) => `gate ${W}`).join(' | ')} | regime | reference captured | status |`, `|---|---|---|---|${bps.map(() => '---').join('|')}|---|---|---|`];
  rows.forEach((r, i) => md.push(`| ${i + 1} | ${r.template}${r.representative ? ' (archetype)' : ''} | ${r.source ? `${r.source}${r.sourceDerived ? ' (derived)' : ''}` : '—'} | ${r.eds || '—'} | ${bps.map((W) => r.gate[W] || 'no verdict').join(' | ')}${r.gate.inherited ? ` (archetype ${r.gate.inherited})` : ''} | ${r.regime || '—'} | ${r.referenceCapturedAt || '—'} | ${r.status} |`));
  md.push('', 'Defects found here go through the gate, not around it: name the class, fix once, re-gate the mapped pages (reference/sweep-protocol.md).', '');
  return md.join('\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
function main() {
  const argv = process.argv;
  const USAGE = 'usage: open-review-pairs.mjs [--per-template 1 | --random <n> [--seed <s>] | --slug a,b | --all] [--out stardust/rollout] [--state stardust/state.json] [--progress stardust/replica/progress.json] [--gate-report <file>] [--batch 10] [--no-open]\n  exit 0 pack written · 1 coverage missing / no liveHost / no delivered row · 2 usage, or a pair would open on localhost or carry a token (pack not written)';
  if (has(argv, 'help') || has(argv, 'h')) { console.log(USAGE); process.exit(0); }
  const OUT = arg(argv, 'out', 'stardust/rollout');
  const pagesDoc = readJSON(join(OUT, 'coverage', 'pages.json'));
  if (!pagesDoc) { console.error(`open-review-pairs: ${join(OUT, 'coverage', 'pages.json')} not found — run inventory.mjs first.`); process.exit(1); }
  const config = readJSON(join(OUT, 'rollout.json'), {});
  if (!siteBase(config, null)) { console.error('open-review-pairs: rollout.json site.liveHost is not set — review links open on the live host, never localhost.'); process.exit(1); }
  const state = readJSON(arg(argv, 'state', 'stardust/state.json'), null);
  const progress = readJSON(arg(argv, 'progress', 'stardust/replica/progress.json'), null);
  const gateReport = readJSON(arg(argv, 'gate-report', join(OUT, 'gate-report.json')), null);
  const templates = readJSON(join(OUT, 'coverage', 'templates.json'), null);
  const { rows: all, bps } = buildPairs({ pages: pagesDoc.pages || [], config, state, progress, gateReport, templates });
  const random = Number(arg(argv, 'random', '0')) || 0; const seed = arg(argv, 'seed', '1'); const perTemplate = Number(arg(argv, 'per-template', '1')) || 1;
  const slugs = arg(argv, 'slug', null) ? arg(argv, 'slug', null).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const rows = selectRows(all, { perTemplate, random, seed, slugs, all: has(argv, 'all') });
  if (!rows.length) { console.error('open-review-pairs: no delivered rows to review (deployed | verified | stale | failed).'); process.exit(1); }
  const bad = rows.filter((r) => !reviewable(r.eds) || (r.source && !reviewable(r.source)));
  if (bad.length) { console.error(`open-review-pairs: refused — ${bad.length} pair(s) would open on localhost / 127.0.0.1 or carry a token (${bad.slice(0, 3).map((r) => r.slug).join(', ')}). Review links open on the live host, the human logs in; nothing written.`); process.exit(2); }
  const selection = has(argv, 'all') ? 'all delivered rows' : slugs ? `slugs ${slugs.join(',')}` : random ? `random ${random} (seed ${seed})` : `${perTemplate} per template, representative first`;
  const at = new Date().toISOString();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'review-pack.md'), renderPack(rows, bps, { at, selection }));
  writeJSON(join(OUT, 'review-pack.json'), { generatedAt: at, selection, seed: random ? seed : null, liveHost: siteBase(config, null), rows });
  console.log(`review pack: ${rows.length} pair(s) (${selection}) → ${join(OUT, 'review-pack.md')} · ${join(OUT, 'review-pack.json')}`);
  for (const r of rows) console.log(`  ${r.template}${r.representative ? '*' : ''}  ${r.source || '—'}${r.sourceDerived ? ' (derived)' : ''}  ↔  ${r.eds}   ${bps.map((W) => `${W}: ${r.gate[W] || 'no verdict'}`).join(' · ')}${r.regime ? ` (${r.regime})` : ''}`);
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const canOpen = !has(argv, 'no-open') && spawnSync('which', [opener], { encoding: 'utf8' }).status === 0;
  if (!canOpen) { console.log(has(argv, 'no-open') ? 'not opened (--no-open): the pack is the deliverable.' : `no opener (${opener}) on this host — pack written, open the links from review-pack.md.`); process.exit(0); }
  const batch = Math.min(10, Math.max(1, Number(arg(argv, 'batch', '10')) || 10));
  const urls = rows.flatMap((r) => [r.source, r.eds].filter(Boolean));
  // one batch per run (a human reviews ≤ --batch pairs per sitting); the rest stay in the pack — re-run with --slug / --random
  for (const u of urls.slice(0, batch * 2)) spawnSync(opener, [u], { stdio: 'ignore' });
  if (urls.length > batch * 2) console.log(`opened ${batch} of ${urls.length / 2} pair(s) — the rest are in review-pack.md; open them with --slug a,b or --random <n> --seed <s>`);
  console.log('log in to the delivered site in the opened browser session (da-deploy-protocol.md § Site auth); compare each pair side by side.');
  process.exit(0);
}
if (isMain) main();
