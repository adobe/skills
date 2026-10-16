#!/usr/bin/env node
/* eslint-disable import/extensions, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue, no-nested-ternary, no-plusplus, no-underscore-dangle, object-property-newline */
/**
 * skills/replica/scripts/gate-triage.mjs — failing gate rows grouped by shared cause (advisory).
 *
 * A READ-ONLY advisory over existing published-gate evidence (gate-all.mjs tables): after a gate run,
 * group the failing rows by shared cause (source-fidelity-gate.md ¶ "What a failing row means",
 * mechanised across rows), diff the failing region's computed styles once per group (chrome-parity.mjs,
 * spawned on one representative page), name each group's re-gate scope (never smaller than its rows)
 * and route frozen-foundation causes as ONE appended line each to stardust/rollout/foundation-requests.md.
 * It writes <gate>/triage.{json,md} (+ <gate>/triage-parity/) into each gate table dir it reads and
 * appends to that queue — nothing else; it never applies a fix and never changes a verdict or threshold.
 * Field reason: a recorded real-site run spent its fix budget on per-page pixel rounds while most
 * failing rows shared a block, chrome or template cause.
 *
 * Inputs per gate dir: summary.json + runs/*.json (newest row per page, each row's source recorded),
 * per-page pixel / clip / content / units / origin / eds JSON; optional coverage blocks.json +
 * pages.json (share map, templates), state.json, replica units.json (families), capture pages, the
 * foundation-freeze manifest (frozen paths; DEFAULT_PATHS when absent), the gate's presence.json (passed to
 * chrome-parity as --presence --slug <rep>, with the rep row's `hide` list as --hide). Causes: block:<name>,
 * selector:<sel>, encoder:<template>, layout:<template> (re-prototype candidate), capture:<slug>,
 * page:<slug>@<w>, and token:<prop>:<from>→<to> from the property diff. Same inputs ⇒ byte-identical
 * outputs and no new request line; run-dependent status goes to stdout only, as does the unit view (--unit with
 * units/<unit>.paths: own vs another unit's groups, and `first pass <w>: x/y` for the cluster's verdict line).
 *
 * Exports: parseArgs, blockOf, parsePairMsg, classifyRow, firstPass, buildTriage, requestLine, formatTriage.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PATHS } from './foundation-freeze.mjs';

const HELP = `gate-triage — failing gate rows grouped by shared cause, re-gate scope per cause (advisory)

Usage: node stardust/scripts/replica/gate-triage.mjs [options]   (from the project root)
  --root <dir>              project root (default .); default paths below are relative to it,
                            explicit path flags resolve from the working directory
  --gate <dir>              a gate table dir (repeatable). Default: every stardust/replica/gates/all-*/
                            holding summary.json or runs/*.json. Writes <gate>/triage.{json,md}
  --no-runs                 read summary.json only (default: + runs/*.json, newest row per page)
  --blocks <f>              stardust/rollout/coverage/blocks.json   (optional share map)
  --pages <f>               stardust/rollout/coverage/pages.json    (optional templates)
  --state <f>               stardust/state.json                     (optional URL/template fallback)
  --units <f>               stardust/replica/units.json             (optional unit families)
  --captures <dir>          stardust/current/pages                  (optional "in the capture" check)
  --manifest <f>            stardust/rollout/foundation-freeze.json (frozen paths; default set if absent)
  --requests <f>            stardust/rollout/foundation-requests.md
  --unit <name>             unit named in routed request lines (default gate-triage); with
                            stardust/rollout/units/<name>.paths, stdout names the groups with rows there
                            (own) and the rest (another unit's), then \`first pass <w>: x/y\` — x of the
                            unit's y siblings (archetype out) whose oldest row at <w> passed; the shared
                            triage files stay unit-free
  --hot <pct>               a pixel band is hot above this (default 15)
  --no-parity               offline grouping only (no chrome-parity spawn, stored results ignored)
  --parity-max <n>          representative pages probed per run, all gate dirs (default 4; live navigations)
  --parity-script <f>       chrome-parity.mjs next to this file
  --parity-timeout <s>      300
  --refresh-parity          re-run parity although a stored result matches
  --region <cause>=<liveSel>[|<buildSel>]   explicit parity region for one cause (repeatable)
  --locale <tag> (en-US) --headed --consent <sel> --dismiss <sel,…>   passed to chrome-parity
                            + the gate's presence.json (--presence --slug) and the row's hide list (--hide)
  --no-route                compute request lines, append nothing
  --dry-run                 print triage.md + the lines it would append; write and spawn nothing
  --json                    print {totals, triages[]} (each = triage.json) instead of the md head
  --help, -h                this text
Advisory: the rows stay the verdict; fix by cause, re-gate the named scope; 3 fix rounds per page.
Exit: 0 triage computed, 1 usage / no gate table / malformed JSON / output inside a frozen path.`;

class UsageError extends Error {}
const fail = (msg) => { throw new UsageError(`gate-triage: ${msg}`); };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const clean = (s) => String(s).replace(/[|\r\n]+/g, '/').replace(/\s+/g, ' ').trim();
const posix = (p) => p.split(sep).join('/');
const uniqSorted = (xs) => [...new Set(xs)].sort(cmp);
// a web path's identity, as deploy's eds-path.mjs pathKey: no query, no .html, no trailing slash or /index, lower-case
const pathKey = (p) => { let x = String(p || '').split(/[?#]/)[0].replace(/\/{2,}/g, '/'); if (!x.startsWith('/')) x = `/${x}`; x = x.replace(/\.html?$/i, ''); if (x.length > 1) x = x.replace(/\/+$/, ''); x = x.replace(/\/index$/, ''); return x.toLowerCase() || '/'; };

const VALUE_FLAGS = { '--root': 'root', '--blocks': 'blocks', '--pages': 'pages', '--state': 'state', '--units': 'units', '--captures': 'captures', '--manifest': 'manifest', '--requests': 'requests', '--unit': 'unit', '--hot': 'hot', '--parity-max': 'parityMax', '--parity-script': 'parityScript', '--parity-timeout': 'parityTimeout', '--locale': 'locale', '--consent': 'consent', '--dismiss': 'dismiss' };
const BOOL_FLAGS = { '--no-runs': 'noRuns', '--no-parity': 'noParity', '--refresh-parity': 'refreshParity', '--headed': 'headed', '--no-route': 'noRoute', '--dry-run': 'dryRun', '--json': 'json' };

/** parseArgs(args) — args WITHOUT node + script; throws UsageError. Path flags stay raw (null = default). */
export function parseArgs(args) {
  const o = { root: '.', gates: [], noRuns: false, blocks: null, pages: null, state: null, units: null, captures: null, manifest: null, requests: null, unit: 'gate-triage', hot: 15, noParity: false, parityMax: 4, parityScript: null, parityTimeout: 300, refreshParity: false, regions: {}, locale: 'en-US', headed: false, consent: null, dismiss: null, noRoute: false, dryRun: false, json: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const v = () => { const x = args[++i]; if (x === undefined || x.startsWith('--')) fail(`${a} needs a value`); return x; };
    if (a === '--gate') o.gates.push(v());
    else if (a === '--region') {
      const spec = v(); const eq = spec.indexOf('=');
      const cause = eq > 0 ? spec.slice(0, eq) : ''; const sel = eq > 0 ? spec.slice(eq + 1) : '';
      if (!cause || !/^[^|]+(\|[^|]+)?$/.test(sel)) fail(`bad --region "${spec}" — expected <cause>=<liveSel>[|<buildSel>]`);
      o.regions[cause] = sel;
    }
    else if (VALUE_FLAGS[a]) o[VALUE_FLAGS[a]] = v();
    else if (BOOL_FLAGS[a]) o[BOOL_FLAGS[a]] = true;
    else fail(`unknown argument ${a}`);
  }
  for (const k of ['hot', 'parityMax', 'parityTimeout']) {
    o[k] = Number(o[k]);
    if (!Number.isFinite(o[k]) || o[k] < 0) fail(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} must be a non-negative number`);
  }
  if (/[|\r\n]/.test(o.unit) || !o.unit.trim()) fail('--unit must be a non-empty name without | or a newline');
  return o;
}

// ---- pure: block resolution ------------------------------------------------------------------------------
/** Block names from coverage blocks.json rows (edsBlockName ≠ default-content, id) + header/footer, longest first. */
function blockNames(blocks = []) {
  const names = ['header', 'footer'];
  for (const b of blocks || []) {
    const d = (b && b.delivery) || {};
    if (d.edsBlockName && d.edsBlockName !== 'default-content') names.push(d.edsBlockName);
    if (b && b.id) names.push(b.id);
  }
  return [...new Set(names)].sort((a, b) => b.length - a.length || cmp(a, b));
}

/** blockOf(selOrPath, names) — the block a `tag.c1.c2 > …` path or selector belongs to, or null. */
export function blockOf(selOrPath, names = []) {
  if (!selOrPath) return null;
  const sorted = [...new Set(names)].sort((a, b) => b.length - a.length || cmp(a, b));
  const segs = String(selOrPath).split(' > ').map((s) => s.trim()).filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i -= 1) {
    const seg = segs[i];
    const tag = seg.split(/[#.[:\s]/)[0].toLowerCase();
    const classes = seg.split('#')[0].split('.').slice(1).map((c) => c.split(/[[:\s]/)[0]).filter(Boolean);
    if (tag === 'header' || tag === 'footer') return tag;
    const n = sorted.find((name) => classes.some((c) => c === name || c.startsWith(`${name}-`)));
    if (n) return n;
    if (classes.includes('block')) { const other = classes.find((c) => c !== 'block'); if (other) return other; }
  }
  return null;
}

/** A served content.json item → its block: chrome items are header (upper half) / footer, else blockOf(path). */
const itemBlock = (item, docH, names) => (item.inChrome ? (Number(item.y) < (Number(docH) || 0) / 2 ? 'header' : 'footer') : blockOf(item.path, names));
const lastSeg = (p) => { const s = String(p || '').split(' > ').map((x) => x.trim()).filter(Boolean); return s[s.length - 1] || null; };
const lastClassedSeg = (p) => { const s = String(p || '').split(' > ').map((x) => x.trim()).filter(Boolean); return [...s].reverse().find((x) => x.includes('.')) || s[s.length - 1] || null; };

// ---- pure: chrome-parity PAIR messages -----------------------------------------------------------------------
const PAIR_RULES = [
  [/^Δ([xywh]) ([+-]?\d+)px \((-?\d+)→(-?\d+)\)$/, (m) => ({ prop: `Δ${m[1]}`, from: null, to: `${m[2]}px` })],
  [/^<(\w+)> box (\d+×\d+) → (\d+×\d+)$/, (m) => ({ prop: 'box', from: m[2], to: m[3] })],
  [/^<(\w+)> ([a-zA-Z]+) (.+) → (.+)$/, (m) => ({ prop: `box.${m[2]}`, from: m[3], to: m[4] })],
  [/^tag <(\w+)> → <(\w+)>$/, (m) => ({ prop: 'tag', from: m[1], to: m[2] })],
  [/^([a-zA-Z]+) (.+) → (.+)$/, (m) => ({ prop: m[1], from: m[2], to: m[3] })],
];
/** parsePairMsg(msg) — one chrome-parity PAIR message → [{prop, from, to}] (unparsed parts dropped). */
export function parsePairMsg(msg) {
  const out = [];
  for (const part of String(msg || '').split('; ')) {
    for (const [re, mk] of PAIR_RULES) { const m = part.trim().match(re); if (m) { out.push(mk(m)); break; } }
  }
  return out;
}

// ---- pure: one row's causes ---------------------------------------------------------------------------------
const WEIGHTS = { content: 3, clip: 3, units: 2, height: 2, pixel: 1 };
const CRITERIA = ['pixel', 'height', 'clip', 'content', 'units'];
const instrumentOf = (r) => (typeof r.origin === 'string' ? r.origin : (r.origin && r.origin.instrument) || null);
/** The criteria a row fails, in CRITERIA order. */
const PASS_KEY = { pixel: 'pixelPass', height: 'heightPass', clip: 'clipPass', content: 'contentPass', units: 'unitPass' };
const rowCriteria = (r) => CRITERIA.filter((c) => r[PASS_KEY[c]] === false);
/** Capture HTML → normalized text (tags stripped, the common entities decoded). */
const captureText = (html) => norm(String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
const parseHotBands = (list) => (list || []).map((s) => String(s).match(/^(-?\d+)-(-?\d+):([\d.]+)%$/)).filter(Boolean).map((m) => ({ y0: Number(m[1]), y1: Number(m[2]), pct: Number(m[3]) }));

/**
 * classifyRow(row, { pixel, clip, content, units }, ctx) → { causes: [{ cause, criteria[], evidence[] }] }.
 * ctx = { names, template, width, heightTol, hot, capture (normalized capture text | null), families }.
 * Every applicable cause is collected (rules 1–6); nothing collected → page:<slug>@<w>.
 */
export function classifyRow(row, ev = {}, ctx = {}) {
  const { names = [], template = 'untyped', width = null, heightTol = 0.05, hot = 15, capture = null, families = null } = ctx;
  const found = new Map();
  const add = (cause, criterion, evidence) => {
    const c = found.get(cause) || { cause, criteria: [], evidence: [] };
    if (!c.criteria.includes(criterion)) c.criteria.push(criterion);
    if (evidence && !c.evidence.includes(evidence)) c.evidence.push(evidence);
    found.set(cause, c);
  };
  const content = ev.content || null; const eds = (content && content.eds) || {};
  const items = Array.isArray(eds.items) ? eds.items : [];
  const findings = (content && Array.isArray(content.findings)) ? content.findings : [];
  const asym = !!row.originAsymmetric || instrumentOf(row) === 'crawl-fullpage';
  const contentFails = row.contentPass === false;
  // 1 clip: the row's non-advisory groups (else clip.json's), by clipper / path
  if (row.clipPass === false) {
    const groups = (row.clipGroups && row.clipGroups.length ? row.clipGroups : ((ev.clip && ev.clip.groups) || [])).filter((g) => g && !g.advisory);
    for (const g of groups) {
      const name = blockOf(g.clipper, names) ?? blockOf(g.path, names);
      const sel = g.clipper || lastSeg(g.path);
      if (!name && !sel) continue;
      add(name ? `block:${name}` : `selector:${sel}`, 'clip', `clip ${g.kind || 'group'} ×${g.n ?? 1} in ${g.clipper || g.path}`);
    }
  }
  // 2 content HIDDEN: the served hidden item with the finding's text
  if (contentFails) {
    for (const f of findings.filter((x) => (x.kind === 'HIDDEN LINK' || x.kind === 'HIDDEN HEADING') && norm(x.text))) {
      const item = items.find((it) => it.state === 'hidden' && norm(it.text) === norm(f.text));
      if (!item) continue;
      const name = itemBlock(item, eds.docH, names);
      add(name ? `block:${name}` : `selector:${lastClassedSeg(item.path)}`, 'content', `${f.kind} "${String(f.text).slice(0, 60)}"`);
    }
  }
  // 3 content MISSING: an encoder fault unless the capture lacks every missing text
  const missingHeadings = (content && content.totals && content.totals.missingHeadings) || 0;
  if (contentFails) {
    const miss = findings.filter((x) => x.kind === 'MISSING LINK' || (x.kind === 'MISSING HEADING' && missingHeadings === 1));
    if (miss.length) {
      const texts = miss.map((x) => norm(x.text)).filter(Boolean);
      const inCapture = capture == null ? null : texts.some((t) => capture.includes(t));
      const ev3 = `${miss.map((x) => `${x.kind} "${String(x.text || x.href || '').slice(0, 60)}"${x.n > 1 ? ` ×${x.n}` : ''}`).join(', ')}; in capture: ${inCapture == null ? 'unknown' : inCapture ? 'yes' : 'no'}`;
      if (inCapture === false) add(`capture:${row.slug}`, 'content', ev3); else add(`encoder:${template}`, 'content', ev3);
    }
  }
  // 4 units: every result with a unit off / hidden / missing
  const uv = row.units || {};
  if (row.unitPass === false || (uv.off || 0) + (uv.hidden || 0) + (uv.missing || 0) > 0) {
    for (const r of ((ev.units && ev.units.results) || [])) {
      const bad = (r.units || []).filter((u) => u.summary && (u.summary.off || 0) + (u.summary.hidden || 0) + (u.summary.missing || 0) > 0);
      if (!bad.length) continue;
      const edsSel = String(r.sel || '').includes('=') ? String(r.sel).slice(String(r.sel).indexOf('=') + 1) : String(r.sel || '');
      const name = blockOf(edsSel, names) ?? blockOf(r.units[0] && r.units[0].eds && r.units[0].eds.path, names);
      const fam = families ? Object.keys(families).sort(cmp).find((k) => { const f = families[k] || {}; return r.sel === `${f.origin}=${f.build || f.eds || f.origin}`; }) : null;
      const s = bad.reduce((a, u) => ({ off: a.off + (u.summary.off || 0), hidden: a.hidden + (u.summary.hidden || 0), missing: a.missing + (u.summary.missing || 0) }), { off: 0, hidden: 0, missing: 0 });
      add(name ? `block:${name}` : `selector:${edsSel}`, 'units', `units ${fam ? `family ${fam}` : edsSel}: off ${s.off} hidden ${s.hidden} missing ${s.missing}`);
    }
  }
  // 5 layout (re-prototype candidate): Δh far beyond the tolerance, hot bands over most of the page, ≥ 2 missing headings
  const bands = (ev.pixel && Array.isArray(ev.pixel.bands)) ? ev.pixel.bands : null;
  const hotBands = bands ? bands.filter((b) => b.pct > hot) : parseHotBands(row.hotBands).filter((b) => b.pct > hot);
  const dh = !asym && row.heightDelta != null && Number(row.originH) > 0 && Math.abs(row.heightDelta) > 2 * heightTol * row.originH;
  const hb = !asym && !!bands && bands.length > 0 && hotBands.length >= 0.5 * bands.length;
  const mh = contentFails && missingHeadings >= 2;
  if (dh || hb || mh) {
    const why = [dh ? `Δh ${row.heightDelta}px > ${Math.round(2 * heightTol * 100)}% of ${row.originH}` : null, hb ? `${hotBands.length}/${bands.length} bands > ${hot}%` : null, mh ? `${missingHeadings} missing headings` : null].filter(Boolean).join('; ');
    add(`layout:${template}`, dh ? 'height' : hb ? 'pixel' : 'content', why);
  }
  // 6 pixel / height localisation: the dominant block among the served items in the first 3 hot bands
  if ((row.pixelPass === false || row.heightPass === false) && !(dh || hb || mh) && !asym) {
    for (const b of [...hotBands].sort((x, y) => x.y0 - y.y0).slice(0, 3)) {
      const counts = new Map(); let n = 0;
      for (const it of items) {
        if (!(Number(it.y) >= b.y0 && Number(it.y) < b.y1)) continue;
        n += 1; const name = itemBlock(it, eds.docH, names);
        if (name) counts.set(name, (counts.get(name) || 0) + 1);
      }
      const top = [...counts.entries()].sort((x, y) => y[1] - x[1] || cmp(x[0], y[0]))[0];
      if (top) add(`block:${top[0]}`, row.heightPass === false ? 'height' : 'pixel', `band ${b.y0}-${b.y1} ${b.pct}%: ${top[0]} ${top[1]}/${n} items`);
    }
  }
  if (!found.size) add(`page:${row.slug}@${width}`, rowCriteria(row)[0] || 'pixel', (row.reasons || []).join('; ') || 'no attributable evidence');
  return { causes: [...found.values()] };
}

// ---- pure: rows, groups, parity findings, tokens, scope ---------------------------------------------------
/** Newest row per slug over the sources (read order: summary.json, then runs/ by name); gateRuns counts them all. */
function mergeRows(sources) {
  const order = sources.map((s, i) => ({ s, i })).sort((a, b) => cmp(String(a.s.writtenAt || ''), String(b.s.writtenAt || '')) || a.i - b.i);
  const map = new Map();
  for (const { s } of order) {
    for (const r of s.rows || []) {
      if (!r || !r.slug) continue;
      const prev = map.get(r.slug);
      map.set(r.slug, { row: r, src: s, gateRuns: (prev ? prev.gateRuns : 0) + 1 });
    }
  }
  return map;
}

/** The unit view's page match: a row's path (any table) or its coverage page's path is, as pathKey, in unitKeys. */
const unitMember = (sources, covPages, unitKeys) => {
  const paths = new Map(); for (const s of sources) for (const r of s.rows || []) if (r && r.slug && r.path) paths.set(r.slug, r.path);
  return (slug) => [paths.get(slug), ((covPages || []).find((x) => x.slug === slug) || {}).path].some((x) => x && unitKeys.has(pathKey(x)));
};

/**
 * firstPass(sources, { unitKeys, covPages }) → { x, y, pages: [{ slug, at, pass }] } — the unit's first pass in one gate
 * dir: y = its pages with a row there, the archetype out (first row's tier; none = sibling); x = those whose FIRST row
 * passed (pass === true; an override is no pass). First row = the oldest: its table's writtenAt, a whole-row reuse's
 * reused.at; a tie keeps read order.
 */
export function firstPass(sources, { unitKeys = new Set(), covPages = [] } = {}) {
  const mine = unitMember(sources, covPages, unitKeys); const first = new Map();
  for (const s of sources) {
    for (const r of s.rows || []) {
      if (!r || !r.slug || !mine(r.slug)) continue;
      const at = String((r.reused && r.reused.what === 'row' && r.reused.at) || s.writtenAt || '');
      if (!first.has(r.slug) || cmp(at, first.get(r.slug).at) < 0) first.set(r.slug, { at, row: r });
    }
  }
  const pages = [...first.entries()].filter(([, f]) => f.row.tier !== 'archetype').sort((a, b) => cmp(a[0], b[0])).map(([slug, f]) => ({ slug, at: f.at || null, pass: f.row.pass === true }));
  return { x: pages.filter((p) => p.pass).length, y: pages.length, pages };
}

const KIND_RANK = { token: 0, block: 1, selector: 2, encoder: 3, layout: 4 };
const KINDS = ['PAIR', 'MISSING', 'EXTRA', 'ICONS', 'ICON', 'REGION', 'REGION BOX', 'REGION STYLE'];
const TOKEN_PROPS = new Set(['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textTransform', 'color', 'backgroundColor', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderRadius', 'textDecorationLine'].flatMap((p) => [p, `box.${p}`]));
const kindOf = (cause) => cause.slice(0, cause.indexOf(':'));
const nameOf = (cause) => cause.slice(cause.indexOf(':') + 1);
const rowOrder = (a, b) => (b.width ?? 0) - (a.width ?? 0) || (a.pct == null ? 1 : 0) - (b.pct == null ? 1 : 0) || (b.pct ?? 0) - (a.pct ?? 0) || cmp(a.slug, b.slug);
const groupOrder = (a, b) => b.score - a.score || KIND_RANK[a.kind] - KIND_RANK[b.kind] || cmp(a.cause, b.cause);
const severityOf = (rows) => Math.max(0, ...rows.flatMap((r) => r.criteria.map((c) => WEIGHTS[c] || 0)));
const criteriaCounts = (rows) => Object.fromEntries(CRITERIA.map((c) => [c, rows.filter((r) => r.criteria.includes(c)).length]).filter(([, n]) => n));
const textMatch = (a, b) => { if (!a || !b) return false; if (a === b) return true; const [s, l] = a.length <= b.length ? [a, b] : [b, a]; return s.length >= 12 && l.includes(s); };
const isFrozenBlock = (name, frozen) => frozen.some((p) => { const q = String(p).replace(/^\.\/+/, '').replace(/\/+$/, ''); const b = `blocks/${name}/`; return b === `${q}/` || b.startsWith(`${q}/`); });
const regionOf = (g, overrides) => (overrides[g.cause] != null ? g.cause.replace(/[^\w-]+/g, '-') : g.kind === 'block' && (g.name === 'header' || g.name === 'footer') ? g.name : 'main');
/** A gate row's hide list (gate-all's `hide: [sel, …]`; absent = none): trimmed, empty dropped, de-duplicated in order. */
const rowHide = (r) => [...new Set((Array.isArray(r && r.hide) ? r.hide : []).filter((s) => typeof s === 'string').map((s) => s.trim()).filter(Boolean))];

/** The deltas of one parity result that concern one group (header/footer/override: the whole region; main: text anchors). */
function groupFindings(g, result, { region, items = [], docH = 0, names = [], clipGroups = [] } = {}) {
  const reg = ((result && result.regions) || []).find((r) => r.name === region) || { findings: [] };
  let matched = reg.findings || []; let note = null;
  if (region === 'main') {
    const anchors = new Set();
    for (const it of items) if (norm(it.text) && (g.kind === 'block' ? itemBlock(it, docH, names) === g.name : String(it.path || '').includes(g.name))) anchors.add(norm(it.text));
    for (const c of clipGroups) if (norm(c.text) && (g.kind === 'block' ? (blockOf(c.clipper, names) ?? blockOf(c.path, names)) === g.name : c.clipper === g.name)) anchors.add(norm(c.text));
    if (!anchors.size) { matched = []; note = 'no text anchors'; }
    else matched = matched.filter((f) => f.text && [...anchors].some((a) => textMatch(norm(f.text), a)));
  }
  const counts = new Map();
  for (const f of matched.filter((x) => x.kind === 'PAIR')) {
    for (const d of parsePairMsg(f.msg)) { const k = JSON.stringify([d.prop, d.from, d.to]); counts.set(k, (counts.get(k) || 0) + 1); }
  }
  const all = [...counts.entries()].map(([k, n]) => { const [prop, from, to] = JSON.parse(k); return { prop, from, to, n }; })
    .sort((a, b) => b.n - a.n || cmp(a.prop, b.prop) || cmp(a.from ?? '', b.from ?? '') || cmp(a.to ?? '', b.to ?? ''));
  const kinds = Object.fromEntries(KINDS.map((k) => [k, matched.filter((f) => f.kind === k).length]).filter(([, n]) => n));
  return { total: matched.length, deltas: all.slice(0, 12), kinds, all, ...(note ? { note } : {}) };
}

/** The slugs a group's fix can move — rows ∪ share map ∪ template siblings ∪ observed DOM (∪ roster for chrome/tokens). */
function scopeOf(g, ctx) {
  const { blocks = [], covPages = [], tableRows = [], roster = [], names = [], itemsOf = () => [], mapSlug = (s) => s, templateOf = () => null } = ctx;
  const set = new Set(g.rows.map((r) => r.slug)); const sources = {};
  const addAll = (key, xs) => { const u = uniqSorted(xs.filter(Boolean)); sources[key] = u.length; for (const s of u) set.add(s); };
  if (g.kind === 'token' || (g.kind === 'block' && (g.name === 'header' || g.name === 'footer'))) addAll('roster', roster);
  else if (g.kind === 'block') {
    const own = blocks.filter((b) => b && (b.id === g.name || (b.delivery && b.delivery.edsBlockName === g.name)));
    addAll('usedByPages', own.flatMap((b) => b.usedByPages || []).map(mapSlug));
    const tpls = new Set(own.flatMap((b) => b.usedByTemplates || []));
    addAll('templates', covPages.filter((p) => tpls.has(p.templateId)).map((p) => mapSlug(p.slug)));
    addAll('observed', tableRows.filter((r) => itemsOf(r.slug).some((it) => blockOf(it.path, names) === g.name)).map((r) => r.slug));
  } else if (g.kind === 'selector') addAll('observed', tableRows.filter((r) => itemsOf(r.slug).some((it) => String(it.path || '').includes(g.name))).map((r) => r.slug));
  else addAll('templates', [...covPages.filter((p) => p.templateId === g.name).map((p) => mapSlug(p.slug)), ...tableRows.filter((r) => templateOf(r) === g.name).map((r) => r.slug)]);
  const pages = [...set].sort(cmp);
  if (!g.rows.every((r) => set.has(r.slug))) throw new Error(`scope of ${g.cause} is smaller than its rows`);
  return { pages, sources };
}

function routeOf(g) {
  if (g.kind === 'token' || g.frozen) return ['foundation-request', 'one request line; the cluster ships a scoped override in its OWN block CSS meanwhile; applied once at C-final'];
  if (g.kind === 'block') return ['cluster', `fix blocks/${g.name}/ (CSS or encoder) once, re-gate the scope`];
  if (g.kind === 'selector') return ['cluster', `fix the block holding ${g.name} (CSS or encoder) once, re-gate the scope`];
  if (g.kind === 'encoder') return ['cluster', 'fix the template\'s encoder, re-render its siblings, re-gate'];
  return ['re-prototype', g.rows.some((r) => r.gateRuns - 1 >= 3) ? 'cap reached: re-prototype decision now' : 're-prototype candidate — the variance probe decides; cap: 3 fix rounds per page'];
}

function tokenGroups(groups) {
  const byDelta = new Map();
  for (const g of groups) {
    for (const d of g.allDeltas || []) {
      if (!TOKEN_PROPS.has(d.prop) || d.from == null) continue;
      const k = JSON.stringify([d.prop, d.from, d.to]);
      const t = byDelta.get(k) || { prop: d.prop, from: d.from, to: d.to, n: 0, groups: [] };
      t.n += d.n; t.groups.push(g); byDelta.set(k, t);
    }
  }
  const ws = (s) => String(s).replace(/\s+/g, ' ').trim().replace(/\|/g, '/');
  const out = [];
  for (const t of byDelta.values()) {
    const from = uniqSorted(t.groups.map((g) => g.cause));
    if (from.length < 2) continue;
    const cause = `token:${ws(t.prop)}:${ws(t.from)}→${ws(t.to)}`;
    const rows = new Map();
    for (const g of t.groups) {
      for (const r of g.rows) {
        const why = `${t.prop} ${t.from} → ${t.to} in ${g.cause}`; const prev = rows.get(r.row);
        if (prev) { prev.criteria = CRITERIA.filter((c) => prev.criteria.includes(c) || r.criteria.includes(c)); prev.evidence.push(why); }
        else rows.set(r.row, { ...r, criteria: [...r.criteria], evidence: [why] });
      }
    }
    const list = [...rows.values()].sort(rowOrder); const severity = severityOf(list);
    for (const g of t.groups) g.tokens = uniqSorted([...(g.tokens || []), cause]);
    out.push({ cause, kind: 'token', name: `${t.prop} ${t.from} → ${t.to}`, frozen: true, severity, score: list.length * severity, rows: list, parity: { fromGroups: from, deltas: [{ prop: t.prop, from: t.from, to: t.to, n: t.n }] } });
  }
  return out;
}

/**
 * One gate-all command per eds host: a page with a gate row keeps the host its newest row was measured on; a page
 * without one takes the group's host when the group's rows share one, else none (named in `note`).
 */
function regateCommands(pages, rows, { width, hostOf, hasRow }) {
  const hosts = [...new Set(rows.map((r) => hostOf(r.slug)))];
  const buckets = new Map(); const orphans = [];
  for (const s of pages) {
    const h = hasRow(s) ? hostOf(s) : hosts.length === 1 ? hosts[0] : null;
    if (!hasRow(s) && hosts.length > 1) orphans.push(s);
    if (!buckets.has(h || '')) buckets.set(h || '', []);
    buckets.get(h || '').push(s);
  }
  const commands = [...buckets.keys()].sort(cmp).map((h) => `node stardust/scripts/replica/gate-all.mjs --only ${buckets.get(h).join(',')} --width ${width}${h ? ` --eds-host ${h}` : ''}`);
  return { commands, ...(orphans.length ? { note: `no gate row for ${orphans.join(', ')} and the group's rows used ${hosts.length} eds hosts — gated without --eds-host; pass the host it is served from` } : {}) };
}

/**
 * buildTriage(input, runParity) — the pure core over one gate table dir. input = { gate (root-relative dir),
 * sources [{ file, writtenAt, prov, rows }] in read order, ev(slug, kind) → parsed JSON | null (kind: pixel,
 * clip, content, units, origin, eds), capture(slug) → normalized text | null, blocks, covPages, statePages,
 * families, frozen, hot, regions {cause: spec}, parity (bool), unit, coverageFiles, presence (root-relative
 * <gate>/presence.json | null) }.
 * runParity({ slug, width, live, build, regions, rowAt, hide, presence }) → { file, exit, result } | { error } | { skipped }
 * (it owns the --parity-max budget, one per run; hide = the rep row's list, presence = the file or null). Re-gate commands
 * keep each page's own --eds-host (its newest row's table).
 */
export function buildTriage(input, runParity = null) {
  const { gate, sources = [], ev = () => null, capture = () => null, blocks = [], covPages = [], statePages = [], families = null, frozen = DEFAULT_PATHS, hot = 15, regions = {}, parity = false, unit = 'gate-triage', coverageFiles = { blocks: null, pages: null }, presence = null } = input;
  const merged = mergeRows(sources);
  const newest = [...sources].map((s, i) => ({ s, i })).sort((a, b) => cmp(String(a.s.writtenAt || ''), String(b.s.writtenAt || '')) || a.i - b.i).map((x) => x.s).pop();
  const width = (newest && newest.prov && newest.prov.breakpoint) ?? (Number((String(gate).match(/-(\d+)\/?$/) || [])[1]) || null);
  const hostOf = (slug) => { const m = merged.get(slug); return (m && m.src.prov && m.src.prov.edsHostOverride) || null; };
  const tableRows = [...merged.values()].map((m) => m.row).sort((a, b) => cmp(a.slug, b.slug));
  const names = blockNames(blocks);
  const bySlug = new Map(tableRows.map((r) => [r.slug, r]));
  const byPath = new Map(tableRows.filter((r) => r.path).map((r) => [r.path, r.slug]));
  const covBySlug = new Map(covPages.map((p) => [p.slug, p]));
  const mapSlug = (s) => (bySlug.has(s) ? s : ((covBySlug.get(s) && byPath.get(covBySlug.get(s).path)) || s));
  const covOf = (r) => covPages.find((x) => x.slug === r.slug || (r.path && x.path === r.path)) || {};
  const stOf = (r) => statePages.find((x) => x.slug === r.slug) || {};
  const templateOf = (r) => r.template ?? covOf(r).templateId ?? stOf(r).template ?? 'untyped';
  const itemsOf = (slug) => (((ev(slug, 'content') || {}).eds || {}).items || []);
  const clipGroupsOf = (r) => ((r.clipGroups && r.clipGroups.length ? r.clipGroups : ((ev(r.slug, 'clip') || {}).groups || [])).filter((g) => g && !g.advisory));
  const failing = []; const errors = []; const byCause = new Map(); const rowCauses = new Map();
  for (const r of tableRows) {
    const m = merged.get(r.slug); const id = `${r.slug}@${width}`;
    if (r.override) continue;
    if (r.pct == null) { errors.push({ row: id, error: r.error ? String(r.error) : 'no verdict — re-run', source: m.src.file }); continue; }
    if (r.pass) continue;
    failing.push(id);
    const template = templateOf(r); const heightTol = (m.src.prov && m.src.prov.heightTolerance) ?? 0.05;
    const { causes } = classifyRow(r, { pixel: ev(r.slug, 'pixel'), clip: ev(r.slug, 'clip'), content: ev(r.slug, 'content'), units: ev(r.slug, 'units') }, { names, template, width, heightTol, hot, capture: capture(r.slug), families });
    rowCauses.set(id, causes.map((c) => ({ ...c, criteria: CRITERIA.filter((x) => c.criteria.includes(x)), source: m.src.file })));
    for (const c of rowCauses.get(id)) {
      if (!byCause.has(c.cause)) byCause.set(c.cause, []);
      byCause.get(c.cause).push({ row: id, slug: r.slug, width, template, pct: r.pct, heightDelta: r.heightDelta ?? null, criteria: c.criteria, evidence: c.evidence, gateRuns: m.gateRuns, source: m.src.file });
    }
  }
  let groups = [];
  for (const [cause, rows] of byCause) {
    const kind = kindOf(cause);
    if (kind === 'capture' || kind === 'page' || new Set(rows.map((r) => r.row)).size < 2) continue;
    rows.sort(rowOrder); const severity = severityOf(rows);
    groups.push({ cause, kind, name: nameOf(cause), frozen: kind === 'block' && isFrozenBlock(nameOf(cause), frozen), severity, score: rows.length * severity, rows, parity: null });
  }
  groups.sort(groupOrder);
  const reps = new Set();
  for (const g of groups) { g.rep = g.rows.find((r) => reps.has(r.row)) || g.rows[0]; reps.add(g.rep.row); }
  // property diff: one chrome-parity run per distinct representative of the block / selector groups
  if (parity && runParity) {
    const byRep = new Map();
    for (const g of groups.filter((x) => x.kind === 'block' || x.kind === 'selector')) { if (!byRep.has(g.rep.row)) byRep.set(g.rep.row, []); byRep.get(g.rep.row).push(g); }
    for (const gs of byRep.values()) {
      const rep = gs[0].rep; const row = bySlug.get(rep.slug); const content = ev(rep.slug, 'content') || {};
      const o = content.origin || {}; const e = content.eds || {}; const cov = covOf(row); const st = stOf(row);
      const live = o.url || (ev(rep.slug, 'origin') || {}).url || (cov.source || {}).sourceUrl || st.url || null;
      const build = e.url || (ev(rep.slug, 'eds') || {}).url || st.liveUrl || (cov.delivery || {}).deployedUrl || null;
      if (!live || !build) { for (const g of gs) g.parity = { skipped: 'no live/build URL' }; continue; }
      const regs = new Map();
      for (const g of gs) { const name = regionOf(g, regions); regs.set(name, regions[g.cause] ?? (name === 'main' ? `${o.root || 'body'}|${e.root || 'body'}` : name)); }
      const list = [...regs.entries()].sort((a, b) => cmp(a[0], b[0])).map(([name, spec]) => ({ name, spec }));
      // the gate's in-flow hides reach the run (a per-visitor bar above the header would offset every box)
      const hideList = rowHide(row); const hide = hideList.length || presence ? { list: hideList, presence: presence || null } : null;
      const rec = runParity({ slug: rep.slug, width, live, build, regions: list, rowAt: merged.get(rep.slug).src.writtenAt || null, hide: hideList, presence: presence || null }) || { skipped: 'not run' };
      for (const g of gs) {
        if (rec.error || rec.skipped) { g.parity = rec.error ? { error: rec.error, ...(hide ? { hide } : {}) } : { skipped: rec.skipped }; continue; }
        const f = groupFindings(g, rec.result, { region: regionOf(g, regions), items: e.items || [], docH: e.docH, names, clipGroups: clipGroupsOf(row) });
        g.allDeltas = f.all;
        g.parity = { page: rep.row, file: rec.file, regions: list.map((r) => r.name), exit: rec.exit, total: f.total, deltas: f.deltas, kinds: f.kinds, ...(f.note ? { note: f.note } : {}), ...(hide ? { hide } : {}) };
      }
    }
  }
  groups = [...groups, ...tokenGroups(groups)].sort(groupOrder);
  const roster = uniqSorted([...tableRows.map((r) => r.slug), ...covPages.map((p) => mapSlug(p.slug))]);
  const out = groups.map((g, i) => {
    const [route, action] = routeOf(g);
    const scope = scopeOf(g, { blocks, covPages, tableRows, roster, names, itemsOf, mapSlug, templateOf });
    const res = { id: `G${i + 1}`, cause: g.cause, kind: g.kind, name: g.name, frozen: g.frozen, severity: g.severity, score: g.score,
      rows: g.rows.map((r) => ({ row: r.row, slug: r.slug, width: r.width, template: r.template, pct: r.pct, heightDelta: r.heightDelta, criteria: r.criteria, evidence: r.evidence, gateRuns: r.gateRuns, source: r.source })),
      pages: uniqSorted(g.rows.map((r) => r.slug)), templates: uniqSorted(g.rows.map((r) => r.template)), criteria: criteriaCounts(g.rows),
      ...(g.tokens ? { tokens: g.tokens } : {}), parity: g.parity, route, action, requestLine: null,
      scope: { pages: scope.pages, sources: scope.sources, ...regateCommands(scope.pages, g.rows, { width, hostOf, hasRow: (s) => merged.has(s) }), ...(route === 'foundation-request' ? { when: 'C-final, after the queue is applied' } : {}) } };
    res.requestLine = requestLine(res, { unit });
    return res;
  });
  const groupCauses = new Set(out.map((g) => g.cause));
  const ungrouped = failing.flatMap((id) => rowCauses.get(id).filter((c) => !groupCauses.has(c.cause)).map((c) => ({ row: id, cause: c.cause, criteria: c.criteria, evidence: c.evidence, source: c.source })));
  const grouped = new Set(out.flatMap((g) => g.rows.map((r) => r.row))).size;
  return {
    _provenance: { writtenBy: 'gate-triage.mjs', gate, width, inputs: sources.map((s) => ({ file: s.file, writtenAt: s.writtenAt ?? null, width: (s.prov && s.prov.breakpoint) ?? null, edsHost: (s.prov && s.prov.edsHostOverride) || null, rows: (s.rows || []).length })), coverage: coverageFiles, frozen: [...frozen], hot, parity: parity ? 'on' : 'off', presence: (parity && presence) || null },
    totals: { rows: tableRows.length, failing: failing.length, errors: errors.length, grouped, share: failing.length ? Math.round((grouped / failing.length) * 1000) / 1000 : null, groups: out.length, routed: out.filter((g) => g.route === 'foundation-request').length },
    groups: out, ungrouped, errors,
  };
}

const NOT_RUN = 'property diff not run (';
/** requestLine(group, { unit }) — the contract's four-field change-request line, or null when not routed; a block line
 * whose comparison did not run says why (parity off, skipped, error) — never "no property diff". */
export function requestLine(g, { unit = 'gate-triage' } = {}) {
  if (g.route !== 'foundation-request') return null;
  const p = g.parity || {}; const ds = p.deltas || [];
  const fmt = (d) => (d.from == null ? `${d.prop} ${d.to} ×${d.n}` : `${d.prop} ${d.from} → ${d.to} ×${d.n}`);
  const notRun = g.kind === 'token' || p.page ? null : g.parity == null ? 'parity off' : String(p.skipped || p.error || 'not run').slice(0, 100);
  const diff = notRun ? `${NOT_RUN}${notRun})` : ds.slice(0, 3).map(fmt).join('; ') || `no property diff${p.note ? ` (${p.note})` : ''}`;
  const what = g.kind === 'token' ? `token ${ds[0].prop} ${ds[0].from} → ${ds[0].to} (styles/)` : `${g.name} block (blocks/${g.name}/): ${diff}`;
  const widths = [...new Set(g.rows.map((r) => r.width))].sort((a, b) => (b ?? 0) - (a ?? 0)).map((w) => `${w} ×${g.rows.filter((r) => r.width === w).length}`).join(', ');
  const crit = CRITERIA.filter((c) => g.criteria[c]).map((c) => `${c} ${g.criteria[c]}`).join(', ');
  const tail = g.kind === 'token' ? `; chrome-parity in ${p.fromGroups.length} groups (${p.fromGroups.join(', ')})` : p.page ? `; chrome-parity ${p.page}: findings ${p.total}` : '';
  const at = [...new Set(g.rows.map((r) => r.width))].join('+');
  const evidence = `gate-triage ${g.cause}@${at}: ${g.rows.length} failing rows (${widths}), ${crit}${tail}`;
  return `- ${clean(unit)} | ${clean(what)} | ${clean(evidence)} | ${clean(g.templates.length ? g.templates.join(', ') : '-')}`;
}

// ---- pure: triage.md --------------------------------------------------------------------------------------
const cell = (s) => String(s ?? '-').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const fmtDelta = (d) => (d.from == null ? `${d.prop} ${d.to} ×${d.n}` : `${d.prop} ${d.from} → ${d.to} ×${d.n}`);
const fmtCrit = (c) => CRITERIA.filter((k) => c[k]).map((k) => `${k} ${c[k]}`).join(', ') || '-';
const listSome = (xs, n = 6) => (xs.length > n ? `${xs.slice(0, n).join(', ')} +${xs.length - n}` : xs.join(', '));
const hideText = (h) => `hiding ${[h.list.join(', '), h.presence ? 'presence.json regions' : ''].filter(Boolean).join(' + ')}`;
function parityText(p) {
  if (!p) return null;
  if (p.skipped) return `skipped (${p.skipped})`;
  if (p.error) return `error (${p.error})${p.hide ? `; ${hideText(p.hide)}` : ''}`;
  if (p.fromGroups) return `${p.deltas.map(fmtDelta).join('; ')} shared by ${p.fromGroups.join(', ')}`;
  const kinds = Object.entries(p.kinds || {}).map(([k, n]) => `${k} ${n}`).join(', ');
  return `chrome-parity on ${p.page} (regions ${p.regions.join(', ')}; exit ${p.exit}; ${p.file}${p.hide ? `; ${hideText(p.hide)}` : ''}): ${p.total} finding(s)${kinds ? ` (${kinds})` : ''}${p.note ? ` — ${p.note}` : ''}${p.deltas.length ? `; ${p.deltas.map(fmtDelta).join('; ')}` : ''}`;
}
const deltaCell = (p) => (!p ? '-' : p.skipped ? `skipped: ${p.skipped}` : p.error ? 'parity error' : (p.deltas || []).slice(0, 3).map(fmtDelta).join('; ') || (p.note || 'no property diff'));

/** formatTriage(triage) → triage.md (ends with a newline; no wall-clock). */
export function formatTriage(t) {
  const { totals: tt, _provenance: pv } = t;
  const share = tt.share == null ? 'n/a' : `${(tt.share * 100).toFixed(1)} %`;
  const nSummary = pv.inputs.filter((i) => basename(i.file) === 'summary.json').length; const nRuns = pv.inputs.length - nSummary;
  const newest = pv.inputs.map((i) => i.writtenAt || '').sort(cmp).pop() || '-';
  const L = [`# Gate triage — ${tt.failing} failing rows, ${tt.grouped} in ${tt.groups} shared-cause groups (${share})`, '',
    `Gate table \`${pv.gate}\` at ${pv.width} px · ${pv.inputs.length} table(s) (${nSummary} summary.json, ${nRuns} runs/*.json; newest ${newest}) · ${tt.rows} pages, ${tt.errors} without verdict · parity ${pv.parity} · hot band > ${pv.hot} % · frozen ${pv.frozen.join(' ')}`, '',
    'Advisory — the rows stay the verdict; act on causes with rows on your own pages: fix by cause, re-gate the named scope; 3 fix rounds per page, then the re-prototype decision. Foundation requests are re-gated at C-final, after the queue is applied.', '',
    '| # | cause | rows | pages | criteria | route | property deltas | re-gate scope |', '|---|---|---|---|---|---|---|---|'];
  for (const g of t.groups) L.push(`| ${g.id} | \`${cell(g.cause)}\` | ${g.rows.length} | ${cell(listSome(g.pages))} | ${fmtCrit(g.criteria)} | ${g.route}${g.frozen ? ' (frozen)' : ''} | ${cell(deltaCell(g.parity))} | ${g.scope.when ? 'C-final: ' : ''}${g.scope.pages.length} pages |`);
  if (!t.groups.length) L.push('| - | no shared cause | 0 | - | - | - | - | - |');
  for (const g of t.groups) {
    L.push('', `## ${g.id} \`${g.cause}\` — ${g.action}`, '', `- rows (${g.rows.length}, severity ${g.severity}, score ${g.score}): ${g.rows.map((r) => `${r.row} ${r.pct ?? 'n/a'} % Δh ${r.heightDelta ?? 'n/a'} (${r.criteria.join('+')}; ${r.template}; gate runs ${r.gateRuns})`).join(', ')}`);
    L.push('- evidence:', ...g.rows.map((r) => `  - ${r.row}: ${r.evidence.join('; ')}`));
    if (g.tokens) L.push(`- shared tokens: ${g.tokens.map((k) => `\`${k}\``).join(', ')}`);
    const pt = parityText(g.parity); if (pt) L.push(`- property diff: ${pt}`);
    if (g.requestLine) L.push(`- request line (foundation-requests.md): \`${g.requestLine}\``);
    const src = Object.entries(g.scope.sources).map(([k, n]) => `${k} ${n}`).join(', ');
    L.push(`- re-gate scope${g.scope.when ? ` (${g.scope.when} — not a cluster step)` : ''}: ${g.scope.pages.length} pages (rows ${g.pages.length}${src ? `, ${src}` : ''}) — ${listSome(g.scope.pages, 12)}`, ...g.scope.commands.map((c) => `  - \`${c}\``));
    if (g.scope.note) L.push(`  - note: ${g.scope.note}`);
  }
  L.push('', '## Not grouped', '');
  if (t.ungrouped.length) { L.push('| row | cause | criteria | evidence |', '|---|---|---|---|'); for (const u of t.ungrouped) L.push(`| ${u.row} | \`${cell(u.cause)}\` | ${u.criteria.join('+')} | ${cell(u.evidence.join('; '))} |`); }
  else L.push('none');
  L.push('', '## No verdict (re-run)', '');
  if (t.errors.length) for (const e of t.errors) L.push(`- ${e.row} — ${cell(e.error)} (${e.source})`); else L.push('none');
  return `${L.join('\n')}\n`;
}

// ---- runner ----------------------------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const lastLine = (s) => String(s || '').trim().split('\n').filter(Boolean).pop() || '';
// tmp + rename: a concurrent run (another cluster unit) never reads a half-written file
const writeAtomic = (file, text) => { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, text); renameSync(tmp, file); };
function readJson(p) {
  if (!existsSync(p) || !statSync(p).isFile()) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return fail(`malformed JSON in ${p}: ${e.message}`); }
}
const frozenHit = (rootAbs, abs, frozen) => {
  const r = posix(relative(rootAbs, abs));
  if (!r || r === '..' || r.startsWith('../')) return null;
  return frozen.find((p) => { const q = String(p).replace(/^\.\/+/, '').replace(/\/+$/, ''); return r === q || r.startsWith(`${q}/`); }) || null;
};
const hasTable = (d, noRuns) => existsSync(join(d, 'summary.json')) || (!noRuns && existsSync(join(d, 'runs')) && readdirSync(join(d, 'runs')).some((f) => f.endsWith('.json')));
function discoverGates(rootAbs, noRuns) {
  const base = join(rootAbs, 'stardust', 'replica', 'gates');
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((n) => n.startsWith('all-')).map((n) => join(base, n)).filter((d) => statSync(d).isDirectory() && hasTable(d, noRuns)).sort(cmp);
}

/** The chrome-parity spawn behind buildTriage: one --parity-max budget per run, stored result reused on an equal key,
 * own live cache (never the gate's); the gate's presence.json and the rep row's hide list ride in the argv (= the key). */
function parityRunner({ rootAbs, gateAbs, rel, opts, say, budget }) {
  const script = opts.parityScript ? resolve(opts.parityScript) : join(HERE, 'chrome-parity.mjs');
  return ({ slug, width, live, build, regions, rowAt, hide = [], presence = null }) => {
    if (budget.left <= 0) { say(`parity ${slug}@${width}: skipped (over --parity-max ${opts.parityMax})`); return { skipped: `over --parity-max ${opts.parityMax}` }; }
    budget.left -= 1;
    const dir = join(gateAbs, 'triage-parity'); const base = `${String(slug).replace(/[^\w.-]+/g, '-')}-${width}`;
    const stored = join(dir, `${base}.json`); const file = rel(stored);
    const args = [live, build, '--no-defaults', ...regions.flatMap((r) => ['--region', `${r.name}=${r.spec}`]), '--width', String(width), '--json', '--live-cache', rel(join(dir, `${base}.live.json`)), '--locale', opts.locale, ...(opts.headed ? ['--headed'] : []), ...(opts.consent ? ['--consent', opts.consent] : []), ...(opts.dismiss ? ['--dismiss', opts.dismiss] : []), ...(hide.length ? ['--hide', hide.join(',')] : []), ...(presence ? ['--presence', presence, '--slug', String(slug)] : [])];
    const key = { argv: ['chrome-parity.mjs', ...args], rowAt };
    if (!opts.refreshParity || opts.dryRun) {
      let s = null; try { s = existsSync(stored) ? JSON.parse(readFileSync(stored, 'utf8')) : null; } catch { s = null; }
      if (s && s.result && JSON.stringify(s.key) === JSON.stringify(key)) { say(`parity ${slug}@${width}: reused ${file}`); return { file, exit: s.exit, result: s.result }; }
    }
    if (opts.dryRun) { say(`parity ${slug}@${width}: not run (--dry-run, no stored result)`); return { skipped: 'dry-run: no stored result' }; }
    const r = spawnSync(process.execPath, [script, ...args], { cwd: rootAbs, encoding: 'utf8', timeout: opts.parityTimeout * 1000, maxBuffer: 512 * 1024 * 1024 });
    const code = r.error && r.error.code === 'ETIMEDOUT' ? 'timeout' : r.status ?? r.signal;
    let out = null;
    if (code === 0 || code === 2) { try { out = JSON.parse(r.stdout); } catch { out = null; } }
    if (!out || !Array.isArray(out.regions)) {
      const error = `chrome-parity exit ${code}: ${out === null && (code === 0 || code === 2) ? 'unparsable output' : lastLine(r.stderr) || (r.error && r.error.message) || 'no output'}`;
      say(`parity ${slug}@${width}: error ${error}`); return { error };
    }
    const result = { live: out.live, build: out.build, width: out.width, tolerance: out.tolerance, regions: out.regions };
    mkdirSync(dir, { recursive: true });
    writeAtomic(stored, `${JSON.stringify({ key, exit: code, result }, null, 2)}\n`);
    say(`parity ${slug}@${width}: ran exit ${code}`);
    return { file, exit: code, result };
  };
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  const opts = parseArgs(argv);
  const rootAbs = resolve(opts.root);
  if (!existsSync(rootAbs) || !statSync(rootAbs).isDirectory()) fail(`--root is not a directory: ${opts.root}`);
  const rel = (p) => posix(relative(rootAbs, p)) || '.';
  const at = (flag, def) => (flag ? resolve(flag) : join(rootAbs, def));
  const P = { blocks: at(opts.blocks, 'stardust/rollout/coverage/blocks.json'), pages: at(opts.pages, 'stardust/rollout/coverage/pages.json'), state: at(opts.state, 'stardust/state.json'), units: at(opts.units, 'stardust/replica/units.json'), captures: at(opts.captures, 'stardust/current/pages'), manifest: at(opts.manifest, 'stardust/rollout/foundation-freeze.json'), requests: at(opts.requests, 'stardust/rollout/foundation-requests.md') };
  const manifest = readJson(P.manifest);
  const frozen = manifest && Array.isArray(manifest.paths) ? manifest.paths.map(String) : [...DEFAULT_PATHS];
  const gates = opts.gates.length ? opts.gates.map((g) => resolve(g)) : discoverGates(rootAbs, opts.noRuns);
  if (!gates.length) fail('no gate table found (stardust/replica/gates/all-*/ with summary.json or runs/*.json) — run gate-all.mjs first or pass --gate');
  for (const g of gates) { if (!existsSync(g) || !hasTable(g, opts.noRuns)) fail(`no gate table in ${g} (summary.json${opts.noRuns ? '' : ' or runs/*.json'})`); }
  for (const p of [...gates, P.requests]) { const z = frozenHit(rootAbs, p, frozen); if (z) fail(`${rel(p)} is inside the frozen path ${z} — triage writes nothing there`); }
  const blocksDoc = readJson(P.blocks); const pagesDoc = readJson(P.pages); const stateDoc = readJson(P.state); const families = readJson(P.units);
  // the unit's own pages (handoff contract § 3 row C: units/<cluster>.paths, one web path per line)
  const unitFile = /^[\w.-]+$/.test(opts.unit) ? join(rootAbs, 'stardust', 'rollout', 'units', `${opts.unit}.paths`) : null;
  const unitPaths = unitFile && existsSync(unitFile) && statSync(unitFile).isFile() ? { file: rel(unitFile), keys: new Set(readFileSync(unitFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map(pathKey)) } : null;
  const log = []; const say = (s) => log.push(s);
  const triages = []; const budget = { left: opts.parityMax };
  for (const g of gates) {
    const files = [...(existsSync(join(g, 'summary.json')) ? [join(g, 'summary.json')] : []), ...(!opts.noRuns && existsSync(join(g, 'runs')) ? readdirSync(join(g, 'runs')).filter((f) => f.endsWith('.json')).sort(cmp).map((f) => join(g, 'runs', f)) : [])];
    const sources = files.map((f) => { const d = readJson(f); if (!d || !Array.isArray(d.rows)) fail(`${f} is not a gate table (needs rows[])`); const prov = d._provenance || {}; return { file: rel(f), writtenAt: prov.writtenAt || null, prov, rows: d.rows }; });
    const cache = new Map();
    const ev = (slug, kind) => { const k = `${slug}\u0000${kind}`; if (!cache.has(k)) cache.set(k, readJson(join(g, String(slug), `${kind}.json`))); return cache.get(k); };
    const capture = (slug) => { const f = join(P.captures, `${slug}.html`); return existsSync(f) && statSync(f).isFile() ? captureText(readFileSync(f, 'utf8')) : null; };
    const gateLog = [];
    const presAbs = join(g, 'presence.json'); const presence = existsSync(presAbs) && statSync(presAbs).isFile() ? rel(presAbs) : null;
    const t = buildTriage({ gate: rel(g), sources, ev, capture, blocks: (blocksDoc && blocksDoc.blocks) || [], covPages: (pagesDoc && pagesDoc.pages) || [], statePages: (stateDoc && stateDoc.pages) || [], families, frozen, hot: opts.hot, regions: opts.regions, parity: !opts.noParity, unit: opts.unit, coverageFiles: { blocks: blocksDoc ? rel(P.blocks) : null, pages: pagesDoc ? rel(P.pages) : null }, presence },
      parityRunner({ rootAbs, gateAbs: g, rel, opts, say: (s) => gateLog.push(s), budget }));
    // the unit view (stdout only — concurrent clusters share triage.{json,md}): groups with a row on the unit's pages,
    // then the unit's first pass at this width (the cluster verdict's `first pass 360: x/y`)
    if (unitPaths) {
      const covPages = (pagesDoc && pagesDoc.pages) || []; const mine = unitMember(sources, covPages, unitPaths.keys);
      const own = (grp) => grp.rows.some((r) => mine(r.slug));
      const list = (xs) => xs.map((x) => x.id).join(', ') || 'none';
      const w = t._provenance.width; const fp = firstPass(sources, { unitKeys: unitPaths.keys, covPages });
      gateLog.unshift(`unit ${opts.unit} @${w}: own: ${list(t.groups.filter(own))} · another unit's: ${list(t.groups.filter((x) => !own(x)))} · first pass ${w}: ${fp.x}/${fp.y}`);
    }
    triages.push({ g, t, md: formatTriage(t), gateLog });
  }
  const out = (s) => (opts.json ? console.error(s) : console.log(s));
  for (const { g, t, md, gateLog } of triages) {
    if (!opts.dryRun) { writeAtomic(join(g, 'triage.json'), `${JSON.stringify(t, null, 2)}\n`); writeAtomic(join(g, 'triage.md'), md); }
    if (!opts.json) console.log(opts.dryRun ? md : md.split('\n').slice(0, 12).join('\n'));
    if (!opts.dryRun) out(`triage → ${rel(join(g, 'triage.md'))}`);
    for (const s of gateLog) out(s);
  }
  // routing: one appended line per frozen-foundation cause and width — whichever unit queued it first (the line
  // describes the whole table); the queue is re-read before each append so a concurrent run's line counts
  const readQueue = () => (existsSync(P.requests) ? readFileSync(P.requests, 'utf8') : '');
  let queue = readQueue();
  for (const { g, w } of triages.flatMap((x) => x.t.groups.filter((y) => y.requestLine).map((y) => ({ g: y, w: x.t._provenance.width })))) {
    const key = `${g.cause}@${w}`;
    if (!opts.dryRun) queue = readQueue();
    // queued once per cause@width; a line backed by a real property diff is added once beside lines that say it did not run
    const mine = queue.split('\n').filter((l) => l.startsWith('- ') && l.includes(`| gate-triage ${clean(key)}:`));
    const upgrade = mine.length > 0 && !g.requestLine.includes(NOT_RUN) && mine.every((l) => l.includes(NOT_RUN));
    if (mine.length && !upgrade) { say(`request already queued: ${key}`); continue; }
    if (opts.noRoute) { say(`request not routed: ${key} (--no-route)`); continue; }
    const add = `${queue && !queue.endsWith('\n') ? '\n' : ''}${g.requestLine}\n`;
    if (opts.dryRun) say(`would append: ${g.requestLine}`);
    else { mkdirSync(dirname(P.requests), { recursive: true }); appendFileSync(P.requests, add); say(`request appended${upgrade ? ' (property diff now run)' : ''}: ${key}`); }
    queue += add;
  }
  for (const s of log) out(s);
  const sum = (k) => triages.reduce((a, x) => a + x.t.totals[k], 0);
  const totals = { failing: sum('failing'), grouped: sum('grouped'), share: sum('failing') ? Math.round((sum('grouped') / sum('failing')) * 1000) / 1000 : null, groups: sum('groups'), routed: sum('routed') };
  if (opts.json) console.log(JSON.stringify({ totals, triages: triages.map((x) => x.t) }, null, 2));
  else console.log(JSON.stringify(totals));
  return 0;
}

let isMain = false;
try { isMain = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { /* imported */ }
if (isMain) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) {
    console.error(e instanceof UsageError ? `${e.message} (see --help)` : `gate-triage error: ${e.message}`);
    process.exitCode = 1;
  }
}
