#!/usr/bin/env node
/**
 * skills/reskin/scripts/donor-probe.mjs — the DESIGN-ADOPTION GATE.
 *
 * Computed-style assertions of donor token values against the rendered
 * reskin page, plus the overflow sanity check. Ported and generalized from
 * the UC2-E1 experiment's probe.mjs / measure.mjs.
 *
 * Reads stardust/reskin/donor-tokens.json (shape documented in
 * skills/reskin/reference/donor-sources.md § donor-tokens.json) and asserts
 * each spec entry: querySelector(selector) → getComputedStyle()[property]
 * compared to the token value.
 *
 * Comparison modes (see reference/gates.md § Tolerances):
 *   - default: exact string equality of the computed value
 *   - fontFamily: quote-stripped, case-insensitive family-string equality
 *   - compare "firstFamily": only the first family of the computed
 *     fontFamily, quote-stripped and case-folded, against the value treated
 *     the same way (a generated spec names one family, not the fallback stack)
 *   - served: true (a fontFamily entry): the declared first family must also
 *     be the font the element renders from: a generic family, a loaded
 *     @font-face of that family covering the element's weight and style, or
 *     (no @font-face of it) a family installed where the page is measured.
 *     A family that matches but is not served is status UNSERVED, detail
 *     "declared <family>, served fallback" (or "... no <weight> <style> face
 *     loaded"): never a FAIL, the exit code is unchanged, but it is no PASS
 *   - custom property (property starts with `--`): the computed
 *     getPropertyValue, trimmed, compared whitespace-collapsed
 *   - tolerancePx: componentwise numeric comparison (each px component of
 *     the computed value within ±tolerancePx of the token's component) —
 *     for paddings (±2), container width (±20), section rhythm (±16)
 *   - match "all": the entry is asserted on EVERY element the selector
 *     matches (default: the first match only). One result per entry; it
 *     passes when all matches do, and a failure names each failing match
 *     as "match <i> of <n>: <computed value>" (1-based, document order)
 *
 * The DEFAULT SPEC assumes the rendered-page conventions the reskin
 * renderer must follow (reference/gates.md § Rendered-page conventions):
 * content in <main>, `main .container` for the page measure, `main .btn`
 * for the donor primary button (chrome buttons outside <main> are ignored
 * — nav CTAs carry trimmed overrides and would fail the button spec
 * spuriously). A selector that resolves to nothing is a FAIL,
 * not a skip — silent skips fake passes. A token path absent from
 * donor-tokens.json is a SKIP (reported). Override or extend with --spec.
 *
 * Usage:
 *   node donor-probe.mjs --tokens <donor-tokens.json> --rendered <url|file>
 *       [--spec <probe-spec.json>]   JSON array of spec entries:
 *              { "label": "...", "selector": "...", "property": "backgroundColor",
 *                "token": "buttons.primary.background" | "value": "rgb(...)",
 *                "tolerancePx": 2,         (property in camelCase, or a --custom-property)
 *                "compare": "firstFamily",
 *                "served": true,           (fontFamily: the family must be served, else UNSERVED)
 *                "match": "all" }          (every match of the selector, not the first)
 *       [--report <path>]            markdown report
 *       [--shot <path>]              full-page screenshot at 1440 for the
 *                                    side-by-side eyeball vs donor screenshots
 *       [--viewport <w>]             load the page at width <w> (positive
 *                                    integer, default 1440) and measure the
 *                                    assertions there
 *       [--no-sanity]                skip the overflow sanity checks
 *       [--json <path>]              write { pass, results: [{ check, label,
 *                                    status, detail }] } — label is the spec
 *                                    entry's label (null for overflow checks)
 *       [--widths 1440,360]          overflow-sanity viewport widths
 *       [--ua <string>]              user agent (default: live-session's
 *                                    real-Chrome UA + standard headers)
 *       [--wait-until <state>]       live-target goto waitUntil (default
 *                                    domcontentloaded; local/file targets
 *                                    keep networkidle)
 *       [--headed]                   headed stealth real Chrome (escalation
 *                                    for bot-managed sites)
 *       [--locale <tag>]             pin Accept-Language + locale
 *       [--wait-eds]                 settle the rendered page's EDS decoration
 *                                    (body.appear, every data-section-status /
 *                                    data-block-status "loaded") before probing;
 *                                    on by default when --rendered is an EDS host
 *                                    (aem.page/live, hlx.page/live,
 *                                    DEPLOY_VERIFY_ORIGIN). A stall exits 2
 *                                    "stalled decoration: …", nothing probed
 *       [--eds-timeout <ms>]         settle bound (default 20000)
 *
 * Live --rendered targets (a staged deploy, a served page on a real host)
 * navigate via the shared diff live-session module (F-G/F-R1): a bot
 * challenge FAILS LOUD (exit 3) — probing an interstitial's computed styles
 * is a false measurement. Local/file targets keep legacy networkidle.
 *
 * Exit: 0 all assertions + sanity pass, 1 fail, 2 setup error (incl. a stalled
 *       decoration), 3 bot challenge / blocked live target (fail loud, never
 *       probed).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const opts = { widths: '1440,360', 'wait-until': 'domcontentloaded' };
  // Enumerated value-taking flags — an unknown --flag (e.g. a typo like
  // --tokns) must be rejected, not silently stored and defaulted.
  const VALUE_FLAGS = new Set(['tokens', 'rendered', 'spec', 'report', 'shot', 'widths', 'ua', 'wait-until', 'locale', 'viewport', 'json', 'eds-timeout']);
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--headed') opts.headed = true;
    else if (a === '--no-sanity') opts.noSanity = true;
    else if (a === '--wait-eds') opts.waitEds = true;
    else if (a.startsWith('--') && VALUE_FLAGS.has(a.slice(2))) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) { console.error(`[donor-probe] ${a} needs a value`); process.exit(2); }
      opts[a.slice(2)] = v; i += 1;
    }
    else { console.error(`[donor-probe] unknown arg: ${a}`); process.exit(2); }
  }
  return opts;
}

const args = parseArgs(process.argv);
if (args.help || !args.tokens || !args.rendered) {
  console.log('usage: node donor-probe.mjs --tokens <donor-tokens.json> --rendered <url|file>');
  console.log('         [--spec <probe-spec.json>] [--report <path>] [--shot <path>] [--widths 1440,360]');
  console.log('         [--viewport <w>] [--no-sanity] [--json <path>]');
  console.log('         [--ua <string>] [--wait-until domcontentloaded] [--headed] [--locale <tag>]');
  console.log('         [--wait-eds] [--eds-timeout <ms>]');
  console.log('Asserts donor token values (computed styles) on the rendered reskin + overflow sanity.');
  console.log('Default spec expects: content in <main>, main .container measure, main .btn primary button.');
  console.log('A --spec entry takes "match": "all" to assert every element its selector matches (default: the first);');
  console.log('a failure names each failing match as "match <i> of <n>: <computed value>".');
  console.log('Live --rendered targets get the shared live-session hardening; escalate with --headed.');
  console.log('--wait-eds settles the rendered page\'s EDS decoration first (default on for an EDS host,');
  console.log('bounded by --eds-timeout, 20000 ms); a stall exits 2 and probes nothing.');
  console.log('Exit: 0 pass, 1 fail, 2 setup error, 3 bot challenge / blocked live target (never probed).');
  process.exit(args.help ? 0 : 2);
}
if (Object.hasOwn(args, 'viewport') && !/^[1-9]\d*$/.test(args.viewport ?? '')) {
  console.error(`[donor-probe] --viewport needs a positive integer width, got "${args.viewport ?? ''}"`);
  process.exit(2);
}
const viewportWidth = args.viewport ? Number(args.viewport) : 1440;
if (Object.hasOwn(args, 'eds-timeout') && !/^[1-9]\d*$/.test(args['eds-timeout'])) {
  console.error(`[donor-probe] --eds-timeout needs a positive integer (milliseconds), got "${args['eds-timeout']}"`);
  process.exit(2);
}

// Siblings are imported here, after the --help guard: --help answers from a directory holding only this script.
// live-session.mjs lives in the diff skill's scripts dir (two layouts, resolved by eds.mjs: the plugin tree and
// the documented project copy stardust/scripts/reskin ↔ stardust/scripts/diff).
let eds; let live;
try {
  eds = await import('./deployed/eds.mjs');
  live = await eds.loadLiveSession();
} catch (e) {
  if (e.name !== 'UsageError' && e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  console.error(`[donor-probe] ${e.message.split('\n')[0]}`);
  console.error('Copy skills/reskin/scripts/* (deployed/ and figma/ included) and the diff skill\'s scripts into the project (SKILL.md § Setup).');
  process.exit(2);
}
const { edsSettle, isEdsHost } = eds;
const { isLiveHttpUrl, launchStealthHeaded, newLiveContext, gotoLive } = live;

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  console.error('[donor-probe] playwright not importable from this script\'s directory.');
  console.error('Copy skills/reskin/scripts/* into the project (stardust/scripts/reskin/) and');
  console.error('run in stardust/ (its own package root, not the project): npm i -D playwright pixelmatch pngjs  (reskin SKILL.md § Setup step 2)');
  process.exit(2);
}

const toUrl = (p) => (/^(https?|file):/.test(p) ? p : pathToFileURL(resolve(p)).href);
const renderedUrl = toUrl(args.rendered);
const die = (m, c = 2) => { console.error(`[donor-probe] ${m}`); process.exit(c); };
const waitEds = !!args.waitEds || isEdsHost(renderedUrl);
const edsTimeoutMs = args['eds-timeout'] ? Number(args['eds-timeout']) : 20000;
const tokens = JSON.parse(readFileSync(resolve(args.tokens), 'utf8'));
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

// Default spec — donor-tokens.json paths × rendered-page conventions.
const DEFAULT_SPEC = [
  { label: 'page bg', selector: 'body', property: 'backgroundColor', token: 'palette.pageBg' },
  { label: 'body fg', selector: 'body', property: 'color', token: 'palette.bodyFg' },
  { label: 'font-family token string', selector: 'body', property: 'fontFamily', token: 'type.family' },
  { label: 'body font size', selector: 'body', property: 'fontSize', token: 'type.body.fontSize' },
  { label: 'display weight', selector: 'main h1', property: 'fontWeight', token: 'type.display.fontWeight' },
  { label: 'heading color', selector: 'main h2', property: 'color', token: 'palette.headingFg' },
  { label: 'primary button bg', selector: 'main .btn', property: 'backgroundColor', token: 'buttons.primary.background' },
  { label: 'primary button fg', selector: 'main .btn', property: 'color', token: 'buttons.primary.color' },
  { label: 'primary button radius', selector: 'main .btn', property: 'borderRadius', token: 'buttons.primary.borderRadius' },
  { label: 'primary button padding (±2px)', selector: 'main .btn', property: 'padding', token: 'buttons.primary.padding', tolerancePx: 2 },
  { label: 'primary button font size', selector: 'main .btn', property: 'fontSize', token: 'buttons.primary.fontSize' },
  { label: 'container max-width (±20px)', selector: 'main .container', property: 'maxWidth', token: 'layout.containerMaxWidth', tolerancePx: 20 },
  { label: 'section rhythm (±16px)', selector: 'main section', property: 'paddingTop', token: 'layout.sectionPaddingY', tolerancePx: 16 },
];
const spec = args.spec ? JSON.parse(readFileSync(resolve(args.spec), 'utf8')) : DEFAULT_SPEC;
for (const entry of spec) {
  if (entry.match !== undefined && entry.match !== 'all' && entry.match !== 'first') die(`spec entry "${entry.label}": match must be "all" (every match) or "first" (the default), got ${JSON.stringify(entry.match)}`);
}

const normFamily = (s) => (s || '').replace(/["']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const firstFamily = (s) => normFamily(String(s || '').split(',')[0]);
const collapse = (s) => String(s).replace(/\s+/g, ' ').trim();
function compare(entry, got, want) {
  if (entry.compare === 'firstFamily') return firstFamily(got) === firstFamily(want);
  if (entry.property === 'fontFamily') return normFamily(got) === normFamily(want);
  if (String(entry.property ?? '').startsWith('--')) { got = collapse(got); want = collapse(want); }
  if (entry.tolerancePx != null) {
    const nums = (v) => String(v).match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const g = nums(got); const w = nums(want);
    if (!g.length || !w.length) return String(got) === String(want);
    // Componentwise, with CSS BOX-SHORTHAND expansion: a 1–4-value side is
    // expanded to the canonical [top, right, bottom, left] per the CSS rules
    // (1 → [v,v,v,v]; 2 → [v1,v2,v1,v2]; 3 → [v1,v2,v3,v2] — the 4th copies
    // the 2nd, NOT the 1st) so "15.5px 24px 16.5px" matches the computed
    // "15.5px 24px 16.5px 24px". A side with >4 components is not a box
    // shorthand (multi-part value): strict positional comparison, and a
    // component-count mismatch is a FAIL.
    if (g.length > 4 || w.length > 4) {
      if (g.length !== w.length) return false; // not a box shorthand; component counts differ
      return g.every((v, i) => Math.abs(v - w[i]) <= entry.tolerancePx);
    }
    const expand = (n) => {
      if (n.length === 1) return [n[0], n[0], n[0], n[0]];
      if (n.length === 2) return [n[0], n[1], n[0], n[1]];
      if (n.length === 3) return [n[0], n[1], n[2], n[1]];
      return n;
    };
    const ge = expand(g); const we = expand(w);
    return ge.every((v, i) => Math.abs(v - we[i]) <= entry.tolerancePx);
  }
  return String(got) === String(want);
}

const browser = args.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
// UA + standard headers + webdriver spoof (live-session) — harmless on
// local/file targets, mandatory on live ones (F-G/F-R1).
const ctx = await newLiveContext(browser, {
  ua: args.ua, locale: args.locale, viewport: { width: viewportWidth, height: 900 },
});
const page = await ctx.newPage();
if (isLiveHttpUrl(renderedUrl)) {
  // A challenge/blocked interstitial must fail loud — its computed styles
  // are not the rendered page's.
  // solveWindow only under --headed: headless clearance never lands, and the
  // solve loop would spend the Akamai block budget (1 hit vs up to 4).
  try {
    await gotoLive(page, renderedUrl, { waitUntil: args['wait-until'], timeoutMs: 60000, settleMs: 0, solveWindow: !!args.headed });
  } catch (e) {
    console.error(`[donor-probe] ${e.message}`);
    await browser.close();
    process.exit(e.name === 'BotChallengeError' ? 3 : 2);
  }
} else {
  await page.goto(renderedUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
}
if (waitEds) {
  const { stalled } = await edsSettle(page, { timeoutMs: edsTimeoutMs });
  if (stalled.length) { await browser.close(); die(`stalled decoration: ${stalled.join(', ')}`); }
}
await page.waitForTimeout(1500);
if (spec.some((e) => e.served)) await page.evaluate(() => document.fonts.ready);

// In the page: whether the element renders from its declared first family → null (served), or why not.
// document.fonts.check() is no test: it answers true for a family no face declares.
const unservedWhy = (el) => {
  const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', 'inherit', 'initial']);
  const unquote = (v) => v.trim().replace(/^["']|["']$/g, '');
  const cs = getComputedStyle(el);
  const family = unquote(cs.fontFamily.split(',')[0]);
  if (!family || GENERIC.has(family.toLowerCase())) return null;
  const weight = Number(cs.fontWeight) || 400;
  const italic = cs.fontStyle !== 'normal';
  const range = (w) => {
    const n = String(w).trim().split(/\s+/).map((x) => (x === 'normal' ? 400 : x === 'bold' ? 700 : Number(x)));
    return [n[0], n[1] ?? n[0]];
  };
  const faces = [...document.fonts].filter((f) => unquote(f.family).toLowerCase() === family.toLowerCase());
  if (!faces.length) {
    const ctx = document.createElement('canvas').getContext('2d');
    const widthIn = (font) => { ctx.font = font; return ctx.measureText('mmmmmmmmmmlli1WQ@#').width; };
    const installed = ['monospace', 'serif', 'sans-serif'].some((base) => widthIn(`72px ${base}`) !== widthIn(`72px "${family}", ${base}`));
    return installed ? null : `declared ${family}, served fallback`;
  }
  const loaded = faces.filter((f) => f.status === 'loaded');
  if (!loaded.length) return `declared ${family}, served fallback`;
  const fits = loaded.some((f) => { const [lo, hi] = range(f.weight); return weight >= lo && weight <= hi && ((f.style !== 'normal') === italic); });
  return fits ? null : `declared ${family}, no ${weight}${italic ? ' italic' : ''} face loaded (synthesized)`;
};

const results = []; // { check, label, status: 'PASS'|'FAIL'|'SKIP'|'UNSERVED', detail }
const MAX_NAMED = 5; // failing matches an "all" entry names; the rest are counted
for (const entry of spec) {
  const want = entry.value !== undefined ? entry.value : get(tokens, entry.token);
  if (want === undefined) {
    results.push({ check: entry.label, label: entry.label, status: 'SKIP', detail: `token path "${entry.token}" absent from ${args.tokens}` });
    continue;
  }
  const every = entry.match === 'all';
  const gots = await page.evaluate(([sel, prop, all]) => {
    const els = all ? [...document.querySelectorAll(sel)] : [document.querySelector(sel)].filter(Boolean);
    if (!els.length) return null;
    return els.map((el) => (String(prop ?? '').startsWith('--') ? getComputedStyle(el).getPropertyValue(prop).trim() : getComputedStyle(el)[prop]));
  }, [entry.selector, entry.property, every]);
  // The first unserved match's why (a matching family only: a mismatch is a FAIL anyway).
  const unserved = entry.served && entry.property === 'fontFamily' && gots !== null
    ? await page.evaluate(`(() => {
      const why = ${unservedWhy.toString()};
      const sel = ${JSON.stringify(entry.selector)};
      const els = ${every} ? [...document.querySelectorAll(sel)] : [document.querySelector(sel)].filter(Boolean);
      return els.map(why).find(Boolean) ?? null;
    })()`)
    : null;
  if (gots === null) {
    // A missing selector is a FAIL: either the renderer broke the documented
    // conventions or the spec is stale — both need a human, not a silent skip.
    results.push({ check: entry.label, label: entry.label, status: 'FAIL', detail: `selector "${entry.selector}" matched nothing` });
    continue;
  }
  if (!every) {
    const ok = compare(entry, gots[0], want);
    results.push({ check: `${entry.label} = ${want}`, label: entry.label, status: !ok ? 'FAIL' : unserved ? 'UNSERVED' : 'PASS', detail: ok && unserved ? unserved : gots[0] });
    continue;
  }
  const off = gots.map((got, i) => ({ got, at: i + 1 })).filter(({ got }) => !compare(entry, got, want));
  const shown = off.slice(0, MAX_NAMED).map(({ got, at }) => `match ${at} of ${gots.length}: ${got}`);
  if (off.length > shown.length) shown.push(`… ${off.length - shown.length} more`);
  results.push({
    check: `${entry.label} = ${want}`,
    label: entry.label,
    status: off.length ? 'FAIL' : unserved ? 'UNSERVED' : 'PASS',
    detail: off.length ? shown.join('; ') : unserved || `all ${gots.length} matches: ${[...new Set(gots)].join(', ')}`,
  });
}

// ---- overflow sanity ---------------------------------------------------------
const widths = args.noSanity ? [] : args.widths.split(',').map((w) => parseInt(w.trim(), 10)).filter(Boolean);
for (const w of widths) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(400);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  results.push({ check: `no horizontal overflow @${w}`, label: null, status: over <= 0 ? 'PASS' : 'FAIL', detail: `overflow=${over}px` });
}

if (args.shot) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  mkdirSync(dirname(resolve(args.shot)), { recursive: true });
  await page.screenshot({ path: args.shot, fullPage: true });
}
await browser.close();

// ---- report -------------------------------------------------------------------
const fails = results.filter((r) => r.status === 'FAIL');
const skips = results.filter((r) => r.status === 'SKIP');
const unservedRows = results.filter((r) => r.status === 'UNSERVED');
const pass = fails.length === 0;
let md = `# Design-adoption gate — donor token probe\n\n- Tokens: ${args.tokens}\n- Rendered: ${args.rendered}\n- Spec: ${args.spec || 'default (rendered-page conventions)'}\n- Generated: ${new Date().toISOString()}\n\n`;
const passed = results.length - fails.length - skips.length - unservedRows.length;
md += `## Assertions — ${passed}/${results.length - skips.length} pass${skips.length ? ` (${skips.length} skipped)` : ''}${unservedRows.length ? ` (${unservedRows.length} font not served)` : ''}\n\n`;
for (const r of results) md += `- [${r.status === 'PASS' ? 'x' : ' '}]${r.status === 'SKIP' || r.status === 'UNSERVED' ? ` (${r.status})` : ''} ${r.check}${r.detail ? ` — ${r.detail}` : ''}\n`;
md += `\n**Overall: ${pass ? 'PASS' : 'FAIL'}**\n\n`;
md += `> The probe proves tokens; it does not prove the page READS as the donor.\n`;
md += `> Complete the gate with the side-by-side eyeball vs the donor screenshots\n`;
md += `> (stardust/canon-source/assets/screenshots/) per reference/gates.md.\n`;
if (args.report) {
  mkdirSync(dirname(resolve(args.report)), { recursive: true });
  writeFileSync(args.report, md);
}
if (args.json) {
  mkdirSync(dirname(resolve(args.json)), { recursive: true });
  writeFileSync(args.json, `${JSON.stringify({ pass, results: results.map(({ check, label, status, detail }) => ({ check, label, status, detail })) }, null, 2)}\n`);
}
console.log(`[donor-probe] ${pass ? 'PASS' : 'FAIL'} — ${passed}/${results.length - skips.length} assertions${skips.length ? `, ${skips.length} skipped` : ''}${unservedRows.length ? `, ${unservedRows.length} font not served` : ''}${args.report ? ` — report: ${args.report}` : ''}`);
for (const f of fails.slice(0, 15)) console.log(`  FAIL ${f.check} — ${f.detail}`);
for (const u of unservedRows) console.log(`  UNSERVED ${u.check} — ${u.detail}`);
for (const s of skips) console.log(`  SKIP ${s.check} — ${s.detail}`);
process.exit(pass ? 0 : 1);
