#!/usr/bin/env node
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len, no-console, no-continue */
/**
 * skills/diff/scripts/page-probe.mjs — the ONE ad-hoc browser probe.
 *
 * Why: in a recorded hands-off run the agent hand-wrote five browser scripts (screenshot, side-by-side, eval,
 * interact, mega-menu check). None went through live-session, so none dismissed the consent banner: they looked
 * at a different page than the gate does. This probe opens a page the way the gate instruments do — live-session's
 * context (real-Chrome UA, document-only standard headers, webdriver spoof), gotoLive (the per-host wait rule;
 * fail loud on a bot challenge or HTTP >= 400), the EDS delayed phase on build/preview hosts, dismissOverlays
 * (consent clicked, timed modals closed, mouse parked) — then runs the asked-for steps in a fixed order:
 * hide → click → eval → shot. `--sbs` composes two existing PNGs side by side in the browser (no pngjs).
 *
 * It is for looking, never for gating: numbers for gates still come from the gate instruments.
 *
 * Usage: node skills/diff/scripts/page-probe.mjs <url> [--width 1440] [--shot <out.png> [--full]] [--eval <expr>]
 *        [--click <sel>] [--hide <sel,…>] [--sbs <a.png> <b.png> <out.png>] [--dismiss <sel,…>] [--headed]
 *        [--locale <tag>] [--nav-timeout <ms>] [--max-chars <n>]
 * Exit: 0 ok, 1 error, 2 usage, 3 bot challenge. Requires playwright (imported lazily: --help answers without it).
 * Pure parts exported: parseArgs, sbsOutPath, splitSelectors, summaryLine, consoleLine, evalText, formatReport, hideCss,
 * hideRegionsFallback, pickHide, countHidden, distinctMatchesInPage, pngSize, sbsWidth, sbsHtml, exitCodeFor.
 */
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as session from './live-session.mjs';

export const HELP = `page-probe — the one ad-hoc browser probe: a page as the gate sees it (live-session navigation, consent and overlays dismissed)

Usage: node page-probe.mjs <url> [options]
       node page-probe.mjs [<url> [options]] --sbs <a.png> <b.png> <out.png>
  --width <px>          viewport width (default 1440; height 900)
  --hide <sel,…>        hide every match (inline display: none !important + a <style data-stardust-hide> rule
                        per selector) before click / eval / shot; repeatable. Through live-session's hideEntries +
                        hideRegions when it exports them, else a local fallback with the same semantics — one
                        stderr line names the path. hidden <n> counts distinct elements: one two selectors
                        match counts once
  --click <sel>         click the first match (5 s timeout, 500 ms settle); a selector matching nothing = exit 1
  --eval <expr>         evaluate a JS expression in the page (after --click); prints its JSON
  --max-chars <n>       cut the eval JSON at n characters (default 4000)
  --shot <out.png>      screenshot of the viewport after the steps above
  --full                full-page screenshot (needs --shot)
  --sbs <a> <b> <out>   compose two existing PNGs side by side, captioned with their paths, into <out>;
                        with --sbs the <url> is optional (compose only). An <out> that is --shot's file never
                        overwrites the shot: the side by side goes beside it as <name>-sbs.png (stderr says so)
  --dismiss <sel,…>     extra overlay-dismiss selectors, clicked before the consent candidates; repeatable
  --headed              stealth real-Chrome tier (bot-managed sites); runs the challenge-solve window
  --locale <tag>        pin Accept-Language + locale
  --nav-timeout <ms>    navigation timeout (default 60000)
  --help                this text
Selector lists split at top-level commas only (a comma inside () or [] stays in its selector).

Steps, in order: navigate (live-session gotoLive: the per-host wait rule, settle 2500 ms live / 1200 ms local)
→ EDS delayed phase (build/preview hosts) → dismiss overlays (consent clicked, timed modals closed)
→ hide → click → eval → shot → sbs. Console errors and uncaught page errors are collected from the start.

Output (stdout, in this order; each step line only when asked):
  page-probe <url> @<w>px: HTTP <status> · consent <sel|none> · hidden <n> · console errors <n>
  hidden: <sel> ×<n> (<h>px) [--hide]; …   per selector (live-session's formatHidden; the fallback prints none)
  click: <sel>
  eval: <json>
  shot: <path>
  sbs: <out>
  console error: <text>      the first 20, each cut at 200 chars; "pageerror: …" = an uncaught page error
Files written: the --shot and --sbs PNGs only (atomic tmp + rename); nothing else, no cache.

Exit codes: 0 ok, 1 error (navigation, HTTP >= 400, hide / click / eval / shot / compose failure),
2 usage, 3 bot challenge (escalate with --headed).

For looking, never for gating: numbers for gates still come from the gate instruments (gate-all and the probes it
runs). A page-probe screenshot or eval value is not gate evidence. Use it instead of a hand-written browser script:
a script that skips live-session skips the consent dismissal and looks at a different page than the gate does.`;

export class UsageError extends Error {
  constructor(msg) { super(msg); this.name = 'UsageError'; this.code = 2; }
}

const REPEATABLE = new Set(['--hide', '--dismiss']);
// Flags that act on a page: meaningless (so refused) when --sbs composes without a <url>.
const PAGE_FLAGS = ['--width', '--hide', '--click', '--eval', '--max-chars', '--shot', '--full', '--dismiss', '--headed', '--locale', '--nav-timeout'];

/** Split a comma-separated selector list at top-level commas (not inside (), [] or quotes); trimmed, empties dropped. */
export function splitSelectors(s) {
  const out = []; let cur = ''; let depth = 0; let quote = null;
  const str = String(s);
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && i + 1 < str.length) { i += 1; cur += str[i]; }
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth += 1;
    else if ((ch === ')' || ch === ']') && depth > 0) depth -= 1;
    else if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function positiveInt(flag, v, max, unit = '') {
  if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > max) throw new UsageError(`${flag} must be a whole number${unit} from 1 to ${max}, got "${v}"`);
  return Number(v);
}

/** --sbs <out> when it is --shot's file (by resolved path): beside it as `<name>-sbs.<ext>`, so the composition never
 * overwrites the shot; any other path (or no --shot) is kept as given. */
export function sbsOutPath(shot, out) {
  if (!shot || resolve(shot) !== resolve(out)) return out;
  return out.replace(/(\.[^./\\]*)?$/, (ext) => `-sbs${ext}`);
}

function pngPath(flag, v) {
  if (!/\.png$/i.test(v)) throw new UsageError(`${flag} writes a PNG: the path must end in .png, got "${v}"`);
  return v;
}

/** argv after the script → options, or a UsageError (exit 2). `help: true` when --help / -h is present. */
export function parseArgs(args) {
  const opts = { url: null, width: 1440, hide: [], click: null, eval: null, maxChars: 4000, shot: null, full: false, sbs: null, dismiss: [], headed: false, locale: null, navTimeout: 60000, help: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    // A value flag never swallows the next flag: `--shot --full` is a forgotten path, not the path "--full".
    const need = () => {
      if (i + 1 >= args.length) throw new UsageError(`${a} needs a value`);
      if (args[i + 1].startsWith('--')) throw new UsageError(`${a} needs a value (got ${args[i + 1]}, which is a flag)`);
      i += 1; return args[i];
    };
    const list = () => {
      const sels = splitSelectors(need());
      if (!sels.length) throw new UsageError(`${a} needs at least one selector`);
      return sels;
    };
    if (a.startsWith('--')) {
      if (seen.has(a) && !REPEATABLE.has(a)) throw new UsageError(`${a} given more than once`);
      seen.add(a);
    }
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--width') opts.width = positiveInt(a, need(), 10000, ' of px');
    else if (a === '--hide') opts.hide.push(...list());
    else if (a === '--click') opts.click = need();
    else if (a === '--eval') opts.eval = need();
    else if (a === '--max-chars') opts.maxChars = positiveInt(a, need(), 10000000);
    else if (a === '--shot') opts.shot = pngPath(a, need());
    else if (a === '--full') opts.full = true;
    else if (a === '--sbs') {
      const vals = args.slice(i + 1, i + 4);
      const flagAt = vals.findIndex((v) => v.startsWith('--'));
      const got = flagAt < 0 ? vals.length : flagAt;
      if (got < 3) throw new UsageError(`--sbs needs three values <a.png> <b.png> <out.png> (got ${got}${flagAt >= 0 ? `, then the flag ${vals[flagAt]}` : ''})`);
      opts.sbs = { a: vals[0], b: vals[1], out: pngPath('--sbs <out.png>', vals[2]) };
      i += 3;
    }
    else if (a === '--dismiss') opts.dismiss.push(...list());
    else if (a === '--headed') opts.headed = true;
    else if (a === '--locale') opts.locale = need();
    else if (a === '--nav-timeout') opts.navTimeout = positiveInt(a, need(), 600000, ' of ms');
    else if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`);
    else if (opts.url) throw new UsageError(`unexpected argument "${a}" — one <url> per probe`);
    else opts.url = a;
  }
  if (opts.help) return opts;
  opts.hide = [...new Set(opts.hide)];
  opts.dismiss = [...new Set(opts.dismiss)];
  if (!opts.url && !opts.sbs) throw new UsageError('need <url> (or --sbs <a.png> <b.png> <out.png> to compose only)');
  if (opts.full && !opts.shot) throw new UsageError('--full needs --shot <out.png>');
  if (!opts.url) {
    const used = PAGE_FLAGS.filter((f) => seen.has(f));
    if (used.length) throw new UsageError(`${used.join(', ')} act${used.length === 1 ? 's' : ''} on a page and need${used.length === 1 ? 's' : ''} a <url>; --sbs alone composes two PNGs and opens no page`);
  }
  if (opts.url) {
    let u = null;
    try { u = new URL(opts.url); } catch { /* reported below */ }
    if (!u || !['http:', 'https:', 'file:'].includes(u.protocol)) throw new UsageError(`<url> must be an absolute http(s) or file: URL, got "${opts.url}"`);
  }
  if (opts.sbs) {
    const moved = sbsOutPath(opts.shot, opts.sbs.out);
    if (moved !== opts.sbs.out) opts.sbs = { ...opts.sbs, out: moved, askedOut: opts.sbs.out };
    const out = resolve(opts.sbs.out);
    if (out === resolve(opts.sbs.a) || out === resolve(opts.sbs.b)) throw new UsageError(`--sbs <out.png> must differ from its inputs (got ${opts.sbs.out}${opts.sbs.askedOut ? `, moved beside --shot ${opts.shot}` : ''})`);
  }
  return opts;
}

// ---- output -------------------------------------------------------------------------------------------

const MAX_CONSOLE_LINES = 20;
const MAX_CONSOLE_CHARS = 200;

export const summaryLine = ({ url, width, status, consent, hidden, consoleErrors }) => `page-probe ${url} @${width}px: HTTP ${status ?? '-'} · consent ${consent || 'none'} · hidden ${hidden} · console errors ${consoleErrors}`;

/** One console line: whitespace collapsed (a multi-line stack stays one line), cut at 200 chars ending in "…". */
export function consoleLine(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return `console error: ${t.length > MAX_CONSOLE_CHARS ? `${t.slice(0, MAX_CONSOLE_CHARS - 1)}…` : t}`;
}

/** The eval result as compact JSON (`undefined` when there is none), cut at maxChars with a marker naming the full length. */
export function evalText(value, maxChars = 4000) {
  let json;
  try { json = JSON.stringify(value); } catch { json = undefined; }
  if (json === undefined) json = value === undefined ? 'undefined' : String(value);
  return json.length > maxChars ? `${json.slice(0, maxChars)}… [${json.length} chars, cut at --max-chars ${maxChars}]` : json;
}

/** stdout lines in the fixed order: summary, click, eval, shot, sbs, then ≤ 20 console lines (summary + console
 * lines only once a page was opened: a failed navigation prints nothing here, its error goes to stderr). */
export function formatReport(r) {
  const opened = Boolean(r.url) && r.status != null;
  const lines = [];
  if (opened) lines.push(summaryLine({ ...r, consoleErrors: r.consoleErrors.length }));
  if (opened && r.hiddenText) lines.push(`hidden: ${r.hiddenText}`);
  if (r.click) lines.push(`click: ${r.click}`);
  if (r.evalJson != null) lines.push(`eval: ${r.evalJson}`);
  if (r.shot) lines.push(`shot: ${r.shot}`);
  if (r.sbs) lines.push(`sbs: ${r.sbs}`);
  if (opened) for (const t of r.consoleErrors.slice(0, MAX_CONSOLE_LINES)) lines.push(consoleLine(t));
  return lines;
}

export const exitCodeFor = (e) => (e instanceof UsageError ? 2 : e && e.name === 'BotChallengeError' ? 3 : 1);

const firstLine = (s) => String(s).split('\n')[0];

// ---- hide list ----------------------------------------------------------------------------------------

export const hideCss = (sel) => `${sel} { display: none !important; }`;

/* eslint-disable no-undef */
function hideInPage(list) {
  return list.map(({ sel, source, css }) => {
    let els;
    try { els = [...document.querySelectorAll(sel)]; } catch (e) { return { sel, source, n: 0, h: 0, error: String(e.message).split('\n')[0] }; }
    const h = Math.round(els.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0));
    for (const el of els) el.style.setProperty('display', 'none', 'important');
    const style = document.createElement('style');
    style.setAttribute('data-stardust-hide', '');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    return { sel, source, n: els.length, h };
  });
}
/* eslint-enable no-undef */

/**
 * The hide list when live-session has no `hideRegions` export yet — the same semantics: every match gets an inline
 * `display: none !important` and each selector one `<style data-stardust-hide>` rule (it also catches matches that
 * render later). `entries` = [{ sel, source }] → [{ sel, source, n, h, error? }] (h = the matches' summed height before).
 */
export async function hideRegionsFallback(page, entries) {
  return page.evaluate(hideInPage, entries.map(({ sel, source }) => ({ sel, source, css: hideCss(sel) })));
}

/**
 * The hide path, by feature detection (no version pin): live-session's `hideEntries` + `hideRegions` when it exports
 * both — the gate tools' helper, called as they call it — else the local fallback. → { via, note (the one stderr line
 * naming the path), run(page, sels) → records [{ sel, source, n, h, error? }], format (formatHidden or null) }.
 */
export function pickHide(mod) {
  const has = (k) => Boolean(mod) && typeof mod[k] === 'function';
  if (has('hideEntries') && has('hideRegions')) {
    return {
      via: 'live-session',
      note: 'page-probe: hide via live-session',
      // { sel, source } objects, not strings: hideEntries reads a string as a comma list split at every comma, which
      // would cut a selector splitSelectors kept whole (`:is(.a, .b)`); an object keeps its sel.
      run: (page, sels) => mod.hideRegions(page, mod.hideEntries(sels.map((sel) => ({ sel, source: '--hide' })), '--hide')),
      format: has('formatHidden') ? mod.formatHidden : null,
    };
  }
  return {
    via: 'fallback',
    note: `page-probe: hide via the local fallback (live-session has no ${has('hideRegions') ? 'hideEntries' : 'hideRegions'})`,
    run: (page, sels) => hideRegionsFallback(page, sels.map((sel) => ({ sel, source: '--hide' }))),
    format: null,
  };
}

/* eslint-disable no-undef */
/** Runs in the page: how many distinct elements the selectors match — a Set, so an element two overlapping selectors
 * match counts once; a selector the query refuses adds nothing. */
export function distinctMatchesInPage(sels) {
  const seen = new Set();
  for (const sel of sels) {
    let els = [];
    try { els = document.querySelectorAll(sel); } catch { /* its record carries the error */ }
    for (const el of els) seen.add(el);
  }
  return seen.size;
}
/* eslint-enable no-undef */

/**
 * `hidden <n>`: distinct elements. Both paths' records count per selector (n), so their sum counts an element two
 * overlapping selectors match twice — and live-session's records carry counts, not elements, so they cannot
 * de-duplicate. For both paths the count is therefore one page call right after the hide: a Set over the matches of
 * every record that matched without an error. Nothing matched → 0 without touching the page.
 */
export async function countHidden(page, records) {
  const sels = records.filter((x) => !x.error && x.n > 0).map((x) => x.sel);
  return sels.length ? page.evaluate(distinctMatchesInPage, sels) : 0;
}

// ---- side by side -------------------------------------------------------------------------------------

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SBS_PAD = 16;
const SBS_GAP = 16;

/** { w, h } from a PNG's IHDR, or null when the buffer is not a PNG. */
export function pngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG) || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** The composed page's width: both images at their natural size, padded, one gap between. */
export const sbsWidth = (a, b) => SBS_PAD * 2 + a.w + SBS_GAP + b.w;

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The compose page: two captioned figures side by side; `src` is a data: URI, captions are escaped. */
export function sbsHtml(items) {
  const fig = ({ caption, src, w, h }) => `<figure style="width:${w}px"><figcaption>${escapeHtml(caption)}</figcaption><img src="${src}" width="${w}" height="${h}" alt=""></figure>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#fff}
.sbs{display:flex;align-items:flex-start;gap:${SBS_GAP}px;padding:${SBS_PAD}px;width:max-content}
figure{margin:0}
figcaption{font:600 14px/20px Arial,Helvetica,sans-serif;color:#111;padding:0 0 8px;overflow-wrap:anywhere}
img{display:block;outline:1px solid #bbb}
</style></head><body><div class="sbs">${items.map(fig).join('')}</div></body></html>`;
}

function readPng(file, Err = Error) {
  let buf;
  try { buf = readFileSync(file); } catch (e) { throw new Err(`--sbs input ${file} is not readable (${e.code || firstLine(e.message)})`); }
  const size = pngSize(buf);
  if (!size) throw new Err(`--sbs input ${file} is not a PNG`);
  return { buf, ...size };
}

function writeAtomic(file, buf) {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, buf);
  renameSync(tmp, file);
}

async function compose(browser, sbs) {
  const [a, b] = [sbs.a, sbs.b].map((f) => ({ caption: f, ...readPng(f) }));
  const ctx = await browser.newContext({ viewport: { width: sbsWidth(a, b), height: 900 }, deviceScaleFactor: 1 });
  try {
    const page = await ctx.newPage();
    await page.setContent(sbsHtml([a, b].map(({ caption, buf, w, h }) => ({ caption, w, h, src: `data:image/png;base64,${buf.toString('base64')}` }))), { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode()))); // eslint-disable-line no-undef
    writeAtomic(sbs.out, await page.screenshot({ fullPage: true, type: 'png' }));
  } finally { await ctx.close().catch(() => {}); }
}

// ---- probe --------------------------------------------------------------------------------------------

async function probe(browser, opts, r) {
  const ctx = await session.newLiveContext(browser, { locale: opts.locale || undefined, viewport: { width: opts.width, height: 900 } });
  try {
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') r.consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => { r.consoleErrors.push(`pageerror: ${e.message || e}`); });
    const resp = await session.gotoLive(page, opts.url, { waitUntil: session.defaultWaitUntil(opts.url), timeoutMs: opts.navTimeout, settleMs: session.isLiveHttpUrl(opts.url) ? 2500 : 1200, solveWindow: opts.headed });
    r.status = resp.status();
    // An EDS build/preview host gets no timed poll (lateWindowFor → 0): wait for its delayed phase, where a consent
    // manager the build enables loads, so the one sweep sees it (stitch-shot does the same).
    if (session.isEdsHost(opts.url)) await session.waitEdsDelayedPhase(page);
    const d = await session.dismissOverlays(page, { extra: opts.dismiss, lateWindowMs: session.lateWindowFor(opts.url) });
    r.consent = d.consent;

    if (opts.hide.length) {
      const hide = pickHide(session);
      console.error(hide.note);
      const res = await hide.run(page, opts.hide);
      r.hidden = await countHidden(page, res);
      if (hide.format) r.hiddenText = hide.format(res);
      for (const x of res) if (!x.error && !x.n) console.error(`page-probe: --hide ${x.sel} matched nothing (its rule stays for late matches)`);
      const bad = res.find((x) => x.error);
      if (bad) throw new Error(`hide: ${bad.sel} ${bad.error}`);
    }

    if (opts.click) {
      const loc = page.locator(opts.click);
      let n;
      try { n = await loc.count(); } catch (e) { throw new Error(`click: ${opts.click} ${firstLine(e.message)}`); }
      if (!n) throw new Error(`click: ${opts.click} matched nothing`);
      try { await loc.first().click({ timeout: 5000 }); } catch (e) { throw new Error(`click: ${opts.click} ${firstLine(e.message)}`); }
      await page.waitForTimeout(500);
      r.click = opts.click;
    }

    if (opts.eval != null) {
      let v;
      try { v = await page.evaluate(opts.eval); } catch (e) { throw new Error(`eval: ${firstLine(e.message).replace(/^page\.evaluate: /, '')}`); }
      r.evalJson = evalText(v, opts.maxChars);
    }

    if (opts.shot) {
      writeAtomic(opts.shot, await page.screenshot({ fullPage: opts.full, type: 'png' }));
      r.shot = opts.shot;
    }
  } finally { await ctx.close().catch(() => {}); }
}

export async function main(args) {
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return 0; }
  const opts = parseArgs(args);
  // Fail before any navigation (each live hit spends block budget) when an --sbs input is already unusable; an
  // input that IS this run's --shot is written first, so it is read at compose time.
  if (opts.sbs) for (const f of [opts.sbs.a, opts.sbs.b]) if (!opts.shot || resolve(f) !== resolve(opts.shot)) readPng(f, UsageError);
  if (opts.sbs && opts.sbs.askedOut) console.error(`page-probe: --sbs ${opts.sbs.askedOut} is --shot's file — the side by side goes beside it: ${opts.sbs.out}`);
  const { chromium } = await import('playwright');
  const browser = opts.headed ? await session.launchStealthHeaded(chromium) : await chromium.launch();
  const r = { url: opts.url, width: opts.width, status: null, consent: null, hidden: 0, hiddenText: null, consoleErrors: [], click: null, evalJson: null, shot: null, sbs: null };
  let err = null;
  try {
    if (opts.url) await probe(browser, opts, r);
    if (opts.sbs) { await compose(browser, opts.sbs); r.sbs = opts.sbs.out; }
  } catch (e) { err = e; }
  finally { await browser.close().catch(() => {}); }
  for (const line of formatReport(r)) console.log(line);
  if (err) throw err;
  return 0;
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(e instanceof UsageError ? `page-probe: ${e.message} (--help for usage)` : `page-probe error: ${firstLine(e.message)}`);
    process.exitCode = exitCodeFor(e);
  });
}
