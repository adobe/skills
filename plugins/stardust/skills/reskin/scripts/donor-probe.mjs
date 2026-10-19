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
 * each spec entry: querySelector(selector) → getComputedStyle()[property]; an optional `exclude`
 *   selector skips elements that carry a declared override (SKIP when every match does)
 * compared to the token value.
 *
 * Comparison modes (see reference/gates.md § Tolerances):
 *   - default: exact string equality of the computed value
 *   - fontFamily: quote-stripped, case-insensitive family-string equality
 *   - compare "firstFamily": only the first family of the computed
 *     fontFamily, quote-stripped and case-folded, against the value treated
 *     the same way (a generated spec names one family, not the fallback stack)
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
 * With --model, a spec entry marked `"needs": "button"` (the default
 * `main .btn` entries) is a SKIP when the page's content model has nothing
 * the renderer turns into a button (stream-render's rendersButton) — a
 * page with no button is not drift; without --model it stays a FAIL.
 *
 * Usage:
 *   node donor-probe.mjs --tokens <donor-tokens.json> --rendered <url|file>
 *       [--spec <probe-spec.json>]   JSON array of spec entries:
 *              { "label": "...", "selector": "...", "property": "backgroundColor",
 *                "token": "buttons.primary.background" | "value": "rgb(...)",
 *                "tolerancePx": 2,         (property in camelCase, or a --custom-property)
 *                "compare": "firstFamily", "needs": "button",
 *                "match": "all" }          (every match of the selector, not the first)
 *       [--model <content-model.json>] the page's content model: button
 *                                    probes are SKIP when it has no button
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
 *       [--auth-header <value>]      Authorization header for the rendered origin
 *                                    only (a protected preview); never printed
 *       [--token-env <NAME>]         the same, read from the variable NAME
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
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { widths: '1440,360', 'wait-until': 'domcontentloaded' };
  // Enumerated value-taking flags — an unknown --flag (e.g. a typo like
  // --tokns) must be rejected, not silently stored and defaulted.
  const VALUE_FLAGS = new Set(['tokens', 'rendered', 'spec', 'model', 'report', 'shot', 'widths', 'ua', 'wait-until', 'locale', 'viewport', 'json', 'eds-timeout', 'auth-header', 'token-env']);
  // A blank value here would fall back to $SITE_TOKEN / .env and send a token nobody asked for.
  const AUTH_FLAGS = new Set(['auth-header', 'token-env']);
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--headed') opts.headed = true;
    else if (a === '--no-sanity') opts.noSanity = true;
    else if (a === '--wait-eds') opts.waitEds = true;
    else if (a.startsWith('--') && VALUE_FLAGS.has(a.slice(2))) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--') || (AUTH_FLAGS.has(a.slice(2)) && !v.trim())) { console.error(`[donor-probe] ${a} needs a value`); process.exit(2); }
      opts[a.slice(2)] = v; i += 1;
    }
    else {
      // Never echo the whole element: `--auth-header=<token>`, `--auth-header:<token>` or the stray half of an unquoted value is a secret.
      const name = a.match(/^--[\w-]+/)?.[0] ?? null;
      const hint = name && name !== a && VALUE_FLAGS.has(name.slice(2)) ? ` (write "${name} <value>")` : '';
      console.error(`[donor-probe] ${name ? `unknown arg: ${name}${hint}` : 'unknown arg (not a --flag, not echoed): a value flag takes its value as the next argument'}`);
      process.exit(2);
    }
  }
  return opts;
}

const args = parseArgs(process.argv);
if (args.help || !args.tokens || !args.rendered) {
  console.log('usage: node donor-probe.mjs --tokens <donor-tokens.json> --rendered <url|file>');
  console.log('         [--spec <probe-spec.json>] [--model <content-model.json>] [--report <path>] [--shot <path>] [--widths 1440,360]');
  console.log('         [--viewport <w>] [--no-sanity] [--json <path>]');
  console.log('         [--ua <string>] [--wait-until domcontentloaded] [--headed] [--locale <tag>]');
  console.log('         [--wait-eds] [--eds-timeout <ms>] [--auth-header <value>] [--token-env <NAME>]');
  console.log('Asserts donor token values (computed styles) on the rendered reskin + overflow sanity.');
  console.log('Default spec expects: content in <main>, main .container measure, main .btn primary button.');
  console.log('A --spec entry takes "match": "all" to assert every element its selector matches (default: the first);');
  console.log('a failure names each failing match as "match <i> of <n>: <computed value>".');
  console.log('Live --rendered targets get the shared live-session hardening; escalate with --headed.');
  console.log('--wait-eds settles the rendered page\'s EDS decoration first (default on for an EDS host,');
  console.log('bounded by --eds-timeout, 20000 ms); a stall exits 2 and probes nothing. --auth-header /');
  console.log('--token-env authenticate on the rendered origin only (a protected preview) and are never printed.');
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
const { edsSettle, isEdsHost, siteAuth, authContextOptions, redact } = eds;
const { isLiveHttpUrl, launchStealthHeaded, newLiveContext, gotoLive } = live;

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  console.error('[donor-probe] playwright not importable from this script\'s directory.');
  console.error('Copy skills/reskin/scripts/* into the project (stardust/scripts/reskin/) and');
  console.error('run: npm i -D playwright pixelmatch pngjs --legacy-peer-deps  (reskin SKILL.md § Setup)');
  process.exit(2);
}

const toUrl = (p) => (/^(https?|file):/.test(p) ? p : pathToFileURL(resolve(p)).href);
const renderedUrl = toUrl(args.rendered);
// The preview's token: only when asked for (--auth-header / --token-env) and only for an http(s) rendered target.
const wantsAuth = /^https?:/.test(renderedUrl) && (args['auth-header'] !== undefined || args['token-env'] !== undefined);
const auth = wantsAuth ? siteAuth({ authHeader: args['auth-header'], tokenEnv: args['token-env'] }) : null;
// Anything printed passes through here, so the token cannot reach stderr by way of an error text.
const die = (m, c = 2) => { console.error(`[donor-probe] ${redact(m, auth)}`); process.exit(c); };
// Only --token-env can come up empty: a non-blank --auth-header is the header, and a blank one never gets here.
if (wantsAuth && !auth) die('no site token: the variable --token-env names is not set in the environment or .env');
const waitEds = !!args.waitEds || isEdsHost(renderedUrl);
const edsTimeoutMs = args['eds-timeout'] ? Number(args['eds-timeout']) : 20000;
const tokens = JSON.parse(readFileSync(resolve(args.tokens), 'utf8'));
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

// Default spec — donor-tokens.json paths × rendered-page conventions. Heading probes take the first heading
// of any level: form and auth pages often have no h1/h2 (a card titled with an h3).
const DEFAULT_SPEC = [
  { label: 'page bg', selector: 'body', property: 'backgroundColor', token: 'palette.pageBg' },
  { label: 'body fg', selector: 'body', property: 'color', token: 'palette.bodyFg' },
  { label: 'font-family token string', selector: 'body', property: 'fontFamily', token: 'type.family' },
  { label: 'body font size', selector: 'body', property: 'fontSize', token: 'type.body.fontSize' },
  { label: 'display weight', selector: 'main :is(h1, h2, h3)', property: 'fontWeight', token: 'type.display.fontWeight' },
  { label: 'heading color', selector: 'main :is(h1, h2, h3, h4, h5, h6)', exclude: '.tone-dark *', property: 'color', token: 'palette.headingFg' },
  { label: 'primary button bg', selector: 'main .btn', property: 'backgroundColor', token: 'buttons.primary.background', needs: 'button' },
  { label: 'primary button fg', selector: 'main .btn', property: 'color', token: 'buttons.primary.color', needs: 'button' },
  { label: 'primary button radius', selector: 'main .btn', property: 'borderRadius', token: 'buttons.primary.borderRadius', needs: 'button' },
  { label: 'primary button padding (±2px)', selector: 'main .btn', property: 'padding', token: 'buttons.primary.padding', tolerancePx: 2, needs: 'button' },
  { label: 'primary button font size', selector: 'main .btn', property: 'fontSize', token: 'buttons.primary.fontSize', needs: 'button' },
  { label: 'container max-width (±20px)', selector: 'main .container', exclude: '.inset > .container', property: 'maxWidth', token: 'layout.containerMaxWidth', tolerancePx: 20 },
  { label: 'section rhythm (±16px)', selector: 'main section', property: 'paddingTop', token: 'layout.sectionPaddingY', tolerancePx: 16 },
];
const spec = args.spec ? JSON.parse(readFileSync(resolve(args.spec), 'utf8')) : DEFAULT_SPEC;
for (const entry of spec) {
  if (entry.match !== undefined && entry.match !== 'all' && entry.match !== 'first') die(`spec entry "${entry.label}": match must be "all" (every match) or "first" (the default), got ${JSON.stringify(entry.match)}`);
}
let noButton = false;
if (args.model) {
  const { modelHasButton } = await import(pathToFileURL(resolve(HERE, 'stream-render.mjs')).href);
  noButton = !modelHasButton(JSON.parse(readFileSync(resolve(args.model), 'utf8')));
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
  ...authContextOptions(renderedUrl, auth),
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
    console.error(`[donor-probe] ${redact(e.message, auth)}`);
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

const results = []; // { check, label, status: 'PASS'|'FAIL'|'SKIP', detail }
const MAX_NAMED = 5; // failing matches an "all" entry names; the rest are counted
for (const entry of spec) {
  const want = entry.value !== undefined ? entry.value : get(tokens, entry.token);
  if (want === undefined) {
    results.push({ check: entry.label, label: entry.label, status: 'SKIP', detail: `token path "${entry.token}" absent from ${args.tokens}` });
    continue;
  }
  if (entry.needs === 'button' && noButton) {
    results.push({ check: entry.label, label: entry.label, status: 'SKIP', detail: `the page's content (${args.model}) has no button` });
    continue;
  }
  const every = entry.match === 'all';
  const gots = await page.evaluate(([sel, prop, all, exclude]) => {
    const found = [...document.querySelectorAll(sel)];
    const kept = exclude ? found.filter((e) => !e.matches(exclude)) : found;
    if (!kept.length) return found.length ? { excluded: found.length } : null;
    const els = all ? kept : [kept[0]];
    return els.map((el) => (String(prop ?? '').startsWith('--') ? getComputedStyle(el).getPropertyValue(prop).trim() : getComputedStyle(el)[prop]));
  }, [entry.selector, entry.property, every, entry.exclude]);
  if (gots && !Array.isArray(gots)) {
    // Every match carries a declared per-slot override (e.g. mapping.json `inset`), which
    // figma-gate geometry measures instead; the token has no undeclared surface to check.
    results.push({ check: entry.label, label: entry.label, status: 'SKIP', detail: `all ${gots.excluded} match(es) declare an override (${entry.exclude})` });
    continue;
  }
  if (gots === null) {
    // A missing selector is a FAIL: either the renderer broke the documented
    // conventions or the spec is stale — both need a human, not a silent skip.
    results.push({ check: entry.label, label: entry.label, status: 'FAIL', detail: `selector "${entry.selector}" matched nothing` });
    continue;
  }
  if (!every) {
    results.push({ check: `${entry.label} = ${want}`, label: entry.label, status: compare(entry, gots[0], want) ? 'PASS' : 'FAIL', detail: gots[0] });
    continue;
  }
  const off = gots.map((got, i) => ({ got, at: i + 1 })).filter(({ got }) => !compare(entry, got, want));
  const shown = off.slice(0, MAX_NAMED).map(({ got, at }) => `match ${at} of ${gots.length}: ${got}`);
  if (off.length > shown.length) shown.push(`… ${off.length - shown.length} more`);
  results.push({
    check: `${entry.label} = ${want}`,
    label: entry.label,
    status: off.length ? 'FAIL' : 'PASS',
    detail: off.length ? shown.join('; ') : `all ${gots.length} matches: ${[...new Set(gots)].join(', ')}`,
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
const pass = fails.length === 0;
let md = `# Design-adoption gate — donor token probe\n\n- Tokens: ${args.tokens}\n- Rendered: ${args.rendered}\n- Spec: ${args.spec || 'default (rendered-page conventions)'}\n- Generated: ${new Date().toISOString()}\n\n`;
md += `## Assertions — ${results.length - fails.length - skips.length}/${results.length - skips.length} pass${skips.length ? ` (${skips.length} skipped)` : ''}\n\n`;
for (const r of results) md += `- [${r.status === 'PASS' ? 'x' : ' '}]${r.status === 'SKIP' ? ' (SKIP)' : ''} ${r.check}${r.detail ? ` — ${r.detail}` : ''}\n`;
md += `\n**Overall: ${pass ? 'PASS' : 'FAIL'}**\n\n`;
md += `> The probe proves tokens; it does not prove the page READS as the donor.\n`;
md += `> Complete the gate with the side-by-side eyeball vs the donor screenshots\n`;
md += `> (stardust/canon-source/assets/screenshots/) per reference/gates.md.\n`;
if (args.report) {
  mkdirSync(dirname(resolve(args.report)), { recursive: true });
  writeFileSync(args.report, redact(md, auth));
}
if (args.json) {
  mkdirSync(dirname(resolve(args.json)), { recursive: true });
  writeFileSync(args.json, redact(`${JSON.stringify({ pass, results: results.map(({ check, label, status, detail }) => ({ check, label, status, detail })) }, null, 2)}\n`, auth));
}
console.log(redact(`[donor-probe] ${pass ? 'PASS' : 'FAIL'} — ${results.length - fails.length - skips.length}/${results.length - skips.length} assertions${skips.length ? `, ${skips.length} skipped` : ''}${args.report ? ` — report: ${args.report}` : ''}`, auth));
for (const f of fails.slice(0, 15)) console.log(redact(`  FAIL ${f.check} — ${f.detail}`, auth));
for (const s of skips) console.log(redact(`  SKIP ${s.check} — ${s.detail}`, auth));
process.exit(pass ? 0 : 1);
