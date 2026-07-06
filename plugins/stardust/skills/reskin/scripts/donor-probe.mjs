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
 *   - tolerancePx: componentwise numeric comparison (each px component of
 *     the computed value within ±tolerancePx of the token's component) —
 *     for paddings (±2), container width (±20), section rhythm (±16)
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
 *                "tolerancePx": 2 }        (property in camelCase)
 *       [--report <path>]            markdown report
 *       [--shot <path>]              full-page screenshot at 1440 for the
 *                                    side-by-side eyeball vs donor screenshots
 *       [--widths 1440,360]          overflow-sanity viewport widths
 *       [--ua <string>]              user agent (default: live-session's
 *                                    real-Chrome UA + standard headers)
 *       [--wait-until <state>]       live-target goto waitUntil (default
 *                                    domcontentloaded; local/file targets
 *                                    keep networkidle)
 *       [--headed]                   headed stealth real Chrome (escalation
 *                                    for bot-managed sites)
 *       [--locale <tag>]             pin Accept-Language + locale
 *
 * Live --rendered targets (a staged deploy, a served page on a real host)
 * navigate via the shared diff live-session module (F-G/F-R1): a bot
 * challenge FAILS LOUD (exit 3) — probing an interstitial's computed styles
 * is a false measurement. Local/file targets keep legacy networkidle.
 *
 * Exit: 0 all assertions + sanity pass, 1 fail, 2 setup error,
 *       3 bot challenge / blocked live target (fail loud, never probed).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// live-session.mjs lives in the diff skill's scripts dir. Two layouts exist:
// the plugin tree (skills/reskin/scripts ↔ skills/diff/scripts) and the
// documented project copy (stardust/scripts/reskin ↔ stardust/scripts/diff).
const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_SESSION = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs']
  .map((p) => resolve(HERE, p)).find((p) => existsSync(p));
if (!LIVE_SESSION) {
  console.error('[donor-probe] live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/).');
  console.error('Copy the diff skill\'s live-session.mjs alongside the reskin scripts (SKILL.md § Setup).');
  process.exit(2);
}
const { isLiveHttpUrl, launchStealthHeaded, newLiveContext, gotoLive } = await import(pathToFileURL(LIVE_SESSION).href);

function parseArgs(argv) {
  const opts = { widths: '1440,360', 'wait-until': 'domcontentloaded' };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--headed') opts.headed = true;
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i];
    else { console.error(`[donor-probe] unknown arg: ${a}`); process.exit(2); }
  }
  return opts;
}

const args = parseArgs(process.argv);
if (args.help || !args.tokens || !args.rendered) {
  console.log('usage: node donor-probe.mjs --tokens <donor-tokens.json> --rendered <url|file>');
  console.log('         [--spec <probe-spec.json>] [--report <path>] [--shot <path>] [--widths 1440,360]');
  console.log('         [--ua <string>] [--wait-until domcontentloaded] [--headed] [--locale <tag>]');
  console.log('Asserts donor token values (computed styles) on the rendered reskin + overflow sanity.');
  console.log('Default spec expects: content in <main>, main .container measure, main .btn primary button.');
  console.log('Live --rendered targets get the shared live-session hardening; escalate with --headed.');
  console.log('Exit: 0 pass, 1 fail, 2 setup error, 3 bot challenge / blocked live target (never probed).');
  process.exit(args.help ? 0 : 2);
}

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  console.error('[donor-probe] playwright not importable from this script\'s directory.');
  console.error('Copy skills/reskin/scripts/* into the project (stardust/scripts/reskin/) and');
  console.error('run: npm i -D playwright --no-save --legacy-peer-deps  (extract SKILL.md § Setup)');
  process.exit(2);
}

const toUrl = (p) => (/^(https?|file):/.test(p) ? p : pathToFileURL(resolve(p)).href);
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

const normFamily = (s) => (s || '').replace(/["']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
function compare(entry, got, want) {
  if (entry.property === 'fontFamily') return normFamily(got) === normFamily(want);
  if (entry.tolerancePx != null) {
    const nums = (v) => String(v).match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const g = nums(got); const w = nums(want);
    if (!g.length || !w.length) return String(got) === String(want);
    // Componentwise; a shorthand may expand (e.g. "15.5px 24px 16.5px" →
    // computed "15.5px 24px 16.5px 24px") — compare up to the shorter list
    // cyclically against the longer.
    const len = Math.max(g.length, w.length);
    for (let i = 0; i < len; i += 1) {
      if (Math.abs(g[i % g.length] - w[i % w.length]) > entry.tolerancePx) return false;
    }
    return true;
  }
  return String(got) === String(want);
}

const browser = args.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
// UA + standard headers + webdriver spoof (live-session) — harmless on
// local/file targets, mandatory on live ones (F-G/F-R1).
const ctx = await newLiveContext(browser, {
  ua: args.ua, locale: args.locale, viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();
const renderedUrl = toUrl(args.rendered);
if (isLiveHttpUrl(renderedUrl)) {
  // A challenge/blocked interstitial must fail loud — its computed styles
  // are not the rendered page's.
  try {
    await gotoLive(page, renderedUrl, { waitUntil: args['wait-until'], timeoutMs: 60000, settleMs: 0 });
  } catch (e) {
    console.error(`[donor-probe] ${e.message}`);
    await browser.close();
    process.exit(e.name === 'BotChallengeError' ? 3 : 2);
  }
} else {
  await page.goto(renderedUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
}
await page.waitForTimeout(1500);

const results = []; // { check, status: 'PASS'|'FAIL'|'SKIP', detail }
for (const entry of spec) {
  const want = entry.value !== undefined ? entry.value : get(tokens, entry.token);
  if (want === undefined) {
    results.push({ check: entry.label, status: 'SKIP', detail: `token path "${entry.token}" absent from ${args.tokens}` });
    continue;
  }
  const got = await page.evaluate(([sel, prop]) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el)[prop] : null;
  }, [entry.selector, entry.property]);
  if (got === null) {
    // A missing selector is a FAIL: either the renderer broke the documented
    // conventions or the spec is stale — both need a human, not a silent skip.
    results.push({ check: entry.label, status: 'FAIL', detail: `selector "${entry.selector}" matched nothing` });
    continue;
  }
  const ok = compare(entry, got, want);
  results.push({ check: `${entry.label} = ${want}`, status: ok ? 'PASS' : 'FAIL', detail: got });
}

// ---- overflow sanity ---------------------------------------------------------
const widths = args.widths.split(',').map((w) => parseInt(w.trim(), 10)).filter(Boolean);
for (const w of widths) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(400);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  results.push({ check: `no horizontal overflow @${w}`, status: over <= 0 ? 'PASS' : 'FAIL', detail: `overflow=${over}px` });
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
  writeFileSync(args.report, md);
}
console.log(`[donor-probe] ${pass ? 'PASS' : 'FAIL'} — ${results.length - fails.length - skips.length}/${results.length - skips.length} assertions${skips.length ? `, ${skips.length} skipped` : ''}${args.report ? ` — report: ${args.report}` : ''}`);
for (const f of fails.slice(0, 15)) console.log(`  FAIL ${f.check} — ${f.detail}`);
for (const s of skips) console.log(`  SKIP ${s.check} — ${s.detail}`);
process.exit(pass ? 0 : 1);
