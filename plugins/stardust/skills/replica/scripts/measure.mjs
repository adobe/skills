#!/usr/bin/env node
/**
 * skills/replica/scripts/measure.mjs
 *
 * Box-by-box measurement for the stardust:replica RECREATE phase: for a
 * caller-supplied selector list, at one or more viewport widths, the rect
 * (x, y, w, h — page-absolute, rounded), visibility, a text snippet and a
 * computed-style group of each match — on one page, or on two pages with a
 * delta line per selector (the live page against its served prototype).
 *
 * Why: comparing a section of the live page with its prototype needs exactly
 * this — rects + computed values for a few selectors at one width — and no
 * shipped script did it (anchor.mjs prints section y/height only,
 * sibling-variance.mjs diffs siblings, chrome-parity.mjs is header/footer
 * specific). Recorded: one run authored the same probe twice in two sessions.
 * This is the shipped one; the selectors are yours, the script embeds none.
 *
 * Usage:
 *   node skills/replica/scripts/measure.mjs <url> --selectors "<css>[,<css>…]" [options]
 *     --selectors <list>   comma-separated CSS selectors (required). A selector that
 *                          itself needs a comma (`:is(a, b)`) cannot be passed — write
 *                          it without the comma or as two selectors
 *     --width <px[,px…]>   viewport width(s); repeatable or comma-separated (default 1440)
 *     --props <list>       computed properties to read, camelCase, comma-separated —
 *                          REPLACES the default list (display, position, width, height,
 *                          maxWidth, margin, padding, gap, backgroundColor, color,
 *                          fontFamily, fontSize, fontWeight, lineHeight, letterSpacing,
 *                          textTransform, textAlign, borderRadius, border, boxShadow,
 *                          opacity, objectFit)
 *     --against <url2>     measure the same selectors on <url2> too and print, per
 *                          selector per width, `Δx Δy Δw Δh` in px (against − url) and
 *                          every property whose value differs (`prop: url → against`).
 *                          A selector missing on one side is reported, never skipped
 *     --all-matches        measure every match of each selector (capped at 12) instead
 *                          of the first; with --against matches are paired by index
 *     --json               the full structure on stdout instead of the table
 *     --out <file>         also write that JSON to <file> (directories created)
 *     --timeout-ms <ms>    per-page navigation timeout (default 20000)
 *     --ua <string>        user agent (default: the real-Chrome desktop UA)
 *
 * Per page: goto (domcontentloaded on a live origin, networkidle on localhost /
 * file), reduced motion, a slow-scroll settle from top to bottom and back so
 * lazy and entrance-animated content is at rest, then the read at each width.
 *
 * Output (table): one block per width, one line per match (`sel[i]  x y w h
 * vis "text"`) followed by its properties, then — with --against — the delta
 * line. --json: { _provenance: { writtenBy, writtenAt, urls[], widths[],
 * selectors[], props[], allMatches, failed[], warnings[] }, widths[],
 * selectors[], pages: { [url]: { [width]: { [selector]: [ { index, of, rect:
 * { x, y, w, h }, visible, text, props } ] } } }, deltas?: { [width]: {
 * [selector]: { status, countA, countB, pairs: [ { index, rect: { dx, dy, dw,
 * dh }, props: { [prop]: [a, b] } } ] } } } }.
 *
 * Writes: nothing — unless --out <file>, which receives the JSON above.
 *
 * Exit codes: 0 measured, 1 a page failed to load (named on stderr; what was
 * measured is still printed), 2 usage error or playwright not importable.
 * A delta never changes the exit code — this is a measurement, not a gate.
 *
 * Requires playwright importable from the script's location (replica SKILL.md
 * § Setup: copy the scripts dir into the project and run the copy). The
 * delta and table functions are exported and pure — the contract test runs
 * them without a browser.
 */
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

// Current stable desktop Chrome on macOS — the platform token and minor version are frozen by
// Chrome's UA reduction, so only the major matters.
export const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
export const DEFAULT_PROPS = ['display', 'position', 'width', 'height', 'maxWidth', 'margin', 'padding', 'gap', 'backgroundColor', 'color', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform', 'textAlign', 'borderRadius', 'border', 'boxShadow', 'opacity', 'objectFit'];
export const MATCH_CAP = 12;
export const TEXT_MAX = 40;
const VIEWPORT_H = 900;

export class UsageError extends Error { constructor(msg) { super(msg); this.code = 2; } }

const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export function parseArgs(argv) {
  const o = { url: null, against: null, selectors: [], widths: [], props: DEFAULT_PROPS, allMatches: false, json: false, out: null, timeoutMs: 20000, ua: DEFAULT_UA };
  const need = (i, flag) => { if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new UsageError(`${flag} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--selectors') { o.selectors.push(...splitList(need(i, a))); i += 1; }
    else if (a === '--width') { o.widths.push(...splitList(need(i, a)).map(Number)); i += 1; }
    else if (a === '--props') { o.props = splitList(need(i, a)); i += 1; }
    else if (a === '--against') { o.against = need(i, a); i += 1; }
    else if (a === '--all-matches') { o.allMatches = true; }
    else if (a === '--json') { o.json = true; }
    else if (a === '--out') { o.out = need(i, a); i += 1; }
    else if (a === '--timeout-ms') { o.timeoutMs = Number(need(i, a)); i += 1; }
    else if (a === '--ua') { o.ua = need(i, a); i += 1; }
    else if (a.startsWith('--')) { throw new UsageError(`unknown flag ${a} (see --help)`); }
    else if (o.url) { throw new UsageError(`unexpected argument "${a}" — one <url>; the second page goes in --against`); }
    else { o.url = a; }
  }
  if (!o.url) throw new UsageError('need <url> (see --help)');
  if (!o.selectors.length) throw new UsageError('need --selectors "<css>[,<css>…]"');
  if (!o.widths.length) o.widths = [1440];
  if (o.widths.some((w) => !Number.isInteger(w) || w <= 0)) throw new UsageError(`--width must be positive integers, got ${o.widths.join(',')}`);
  if (!o.props.length) throw new UsageError('--props must name at least one property');
  if (!Number.isFinite(o.timeoutMs) || o.timeoutMs <= 0) throw new UsageError('--timeout-ms must be a positive number');
  o.widths = [...new Set(o.widths)];
  return o;
}

// ---- browser + in-page measurement ---------------------------------------------------------------

// A live origin gets domcontentloaded + a longer settle; localhost / file are networkidle.
export function isLiveHttpUrl(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) && !/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(u.hostname); } catch { return false; }
}

// Runs inside the page (serialised by playwright — no outer-scope references).
/* eslint-disable no-undef */
function measureInPage({ selectors, props, allMatches, cap, textMax }) {
  const out = {};
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  for (const sel of selectors) {
    let nodes;
    try { nodes = [...document.querySelectorAll(sel)]; } catch (e) { out[sel] = { total: 0, error: e.message, matches: [] }; continue; }
    const picked = allMatches ? nodes.slice(0, cap) : nodes.slice(0, 1);
    out[sel] = {
      total: nodes.length,
      matches: picked.map((el, index) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const text = norm(el.innerText !== undefined ? el.innerText : el.textContent);
        const p = {};
        for (const k of props) p[k] = cs[k] === undefined ? null : String(cs[k]);
        return {
          index,
          of: nodes.length,
          rect: { x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) },
          visible: el.getClientRects().length > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
          text: text.length > textMax ? `${text.slice(0, textMax - 1)}…` : text,
          props: p,
        };
      }),
    };
  }
  return out;
}
/* eslint-enable no-undef */

// Slow-scroll settle before measuring — pre-settle boxes are wrong on lazy-loading and
// entrance-animated pages; the read is taken at rest from the top.
async function settle(page) {
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 80); }); }
    window.scrollTo(0, 0);
    await new Promise((r) => { setTimeout(r, 400); });
  });
  await page.waitForTimeout(300);
}

async function measurePage(browser, url, o) {
  const live = isLiveHttpUrl(url);
  const context = await browser.newContext({ userAgent: o.ua, viewport: { width: o.widths[0], height: VIEWPORT_H }, reducedMotion: 'reduce', locale: 'en-US', colorScheme: 'light', ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const byWidth = {};
  try {
    const resp = await page.goto(url, { waitUntil: live ? 'domcontentloaded' : 'networkidle', timeout: o.timeoutMs });
    if (resp && resp.status() >= 400) throw new Error(`HTTP ${resp.status()}`);
    await page.waitForTimeout(live ? 1500 : 300);
    for (const width of o.widths) {
      await page.setViewportSize({ width, height: VIEWPORT_H });
      await settle(page);
      byWidth[width] = await page.evaluate(measureInPage, { selectors: o.selectors, props: o.props, allMatches: o.allMatches, cap: MATCH_CAP, textMax: TEXT_MAX });
    }
  } finally {
    await context.close().catch(() => {});
  }
  return byWidth;
}

async function main(argv) {
  const o = parseArgs(argv);
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch (e) {
    throw new UsageError(`playwright is not importable from ${dirname(fileURLToPath(import.meta.url))} (${e.code || e.message}) — replica SKILL.md § Setup: copy the scripts dir into the project and run the copy`);
  }
  const urls = o.against ? [o.url, o.against] : [o.url];
  const result = { _provenance: { writtenBy: 'skills/replica/scripts/measure.mjs', writtenAt: new Date().toISOString(), urls, widths: o.widths, selectors: o.selectors, props: o.props, allMatches: o.allMatches, failed: [], warnings: [] }, widths: o.widths, selectors: o.selectors, pages: {} };
  const browser = await chromium.launch({ headless: true });
  try {
    for (const url of urls) {
      try { result.pages[url] = await measurePage(browser, url, o); } catch (e) {
        const msg = String(e.message || e).split('\n')[0];
        result._provenance.failed.push({ url, error: msg });
        console.error(`measure: ${url} failed to load — ${msg}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  // Per selector the JSON carries the match array; an invalid selector becomes a warning.
  for (const [url, byWidth] of Object.entries(result.pages)) {
    for (const [width, bySel] of Object.entries(byWidth)) {
      for (const sel of o.selectors) {
        if (bySel[sel].error) result._provenance.warnings.push(`${url} @${width}: selector "${sel}" — ${bySel[sel].error}`);
        bySel[sel] = bySel[sel].matches;
      }
    }
  }
  if (o.against) result.deltas = buildDeltas(result, o.url, o.against);
  for (const w of result._provenance.warnings) console.error(`measure: ${w}`);
  if (o.out) { mkdirSync(dirname(o.out), { recursive: true }); writeFileSync(o.out, JSON.stringify(result, null, 2)); }
  console.log(o.json ? JSON.stringify(result, null, 2) : formatTable(result));
  return result._provenance.failed.length ? 1 : 0;
}

// ---- deltas + table (pure) -----------------------------------------------------------------------

// Two match arrays for one selector → status, counts and per-index pairs (B − A for the rect,
// [a, b] for every property whose value differs). A side with no match is a status, not a skip.
export function computeDeltas(a, b) {
  const A = a || []; const B = b || [];
  let status = 'ok';
  if (!A.length && !B.length) status = 'missing-both';
  else if (!A.length) status = 'missing-a';
  else if (!B.length) status = 'missing-b';
  const pairs = [];
  for (let i = 0; i < Math.min(A.length, B.length); i += 1) {
    const ra = A[i].rect; const rb = B[i].rect;
    const props = {};
    for (const k of new Set([...Object.keys(A[i].props || {}), ...Object.keys(B[i].props || {})])) {
      const va = A[i].props ? A[i].props[k] : undefined; const vb = B[i].props ? B[i].props[k] : undefined;
      if (va !== vb) props[k] = [va === undefined ? null : va, vb === undefined ? null : vb];
    }
    pairs.push({ index: i, rect: { dx: rb.x - ra.x, dy: rb.y - ra.y, dw: rb.w - ra.w, dh: rb.h - ra.h }, props });
  }
  return { status, countA: A.length, countB: B.length, pairs };
}

// deltas[width][selector]; null when either page failed to load (no half-comparison).
export function buildDeltas(result, urlA, urlB) {
  const PA = result.pages[urlA]; const PB = result.pages[urlB];
  if (!PA || !PB) return null;
  const out = {};
  for (const width of result.widths) {
    out[width] = {};
    for (const sel of result.selectors) out[width][sel] = computeDeltas((PA[width] || {})[sel], (PB[width] || {})[sel]);
  }
  return out;
}

const signed = (n) => (n > 0 ? `+${n}` : String(n));
const pad = (v, n) => String(v).padStart(n);

export function formatDelta(pair) {
  const r = pair.rect;
  const rect = `Δx ${signed(r.dx)} Δy ${signed(r.dy)} Δw ${signed(r.dw)} Δh ${signed(r.dh)}`;
  const props = Object.entries(pair.props).map(([k, [a, b]]) => `${k}: ${a} → ${b}`);
  return `${rect}  ${props.length ? props.join('; ') : 'props equal'}`;
}

function matchLine(tag, m) {
  return `${tag}  x ${pad(m.rect.x, 5)}  y ${pad(m.rect.y, 6)}  w ${pad(m.rect.w, 5)}  h ${pad(m.rect.h, 5)}  ${m.visible ? 'vis' : 'hid'}  "${m.text}"`;
}

export function formatTable(result) {
  const { urls, failed } = result._provenance;
  const [urlA, urlB] = urls;
  const lines = [];
  lines.push(urlB ? `measure  A = ${urlA}\n         B = ${urlB}` : `measure  ${urlA}`);
  lines.push(`  widths ${result.widths.join(', ')} · ${result.selectors.length} selector(s) · ${result._provenance.props.length} props${result._provenance.allMatches ? ` · all matches (≤ ${MATCH_CAP})` : ' · first match'}`);
  for (const f of failed) lines.push(`  ✗ ${f.url} failed to load — ${f.error}`);
  for (const width of result.widths) {
    lines.push(`\n@ ${width}px`);
    for (const sel of result.selectors) {
      const A = ((result.pages[urlA] || {})[width] || {})[sel];
      // One page, or two with a side that failed: print each loaded side on its own.
      if (!urlB || !result.deltas) {
        for (const [tag, url] of (urlB ? [['A', urlA], ['B', urlB]] : [[' ', urlA]])) {
          const M = ((result.pages[url] || {})[width] || {})[sel];
          if (!M) continue;
          if (!M.length) { lines.push(`  ${sel}   no match${urlB ? ` on ${tag}` : ''}`); continue; }
          for (const m of M) {
            lines.push(`  ${m.of > 1 ? `${sel} [${m.index + 1} of ${m.of}]` : sel}`);
            lines.push(`    ${matchLine(tag, m)}`);
            lines.push(`      ${Object.entries(m.props).map(([k, v]) => `${k}: ${v}`).join('; ')}`);
          }
        }
        continue;
      }
      const d = result.deltas[width][sel];
      const B = ((result.pages[urlB] || {})[width] || {})[sel] || [];
      if (d.status !== 'ok') {
        const side = d.status === 'missing-both' ? 'A and B' : (d.status === 'missing-a' ? `A (${d.countB} on B)` : `B (${d.countA} on A)`);
        lines.push(`  ${sel}   MISSING on ${side}`);
        continue;
      }
      lines.push(`  ${sel}${d.countA !== d.countB ? `   matches ${d.countA} vs ${d.countB} — paired ${d.pairs.length}` : (d.countA > 1 ? `   ${d.countA} matches` : '')}`);
      for (const p of d.pairs) {
        if (d.pairs.length > 1) lines.push(`    [${p.index + 1}]`);
        lines.push(`    ${matchLine('A', A[p.index])}`);
        lines.push(`    ${matchLine('B', B[p.index])}`);
        lines.push(`    Δ  ${formatDelta(p)}`);
      }
    }
  }
  if (urlB && !result.deltas) lines.push('\n  deltas not computed — a side failed to load');
  return lines.join('\n');
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`measure: ${e.message}`);
    process.exitCode = e.code || 1;
  });
}
