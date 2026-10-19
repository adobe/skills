#!/usr/bin/env node
/**
 * skills/reskin/scripts/slot-coverage.mjs — content-gate half two.
 *
 * dom-equality.mjs proves the CONCATENATED text is byte-equal; this script
 * proves the model's STRUCTURE survived: every content-model slot is
 * present in the rendered page, addressed slot by slot. The two are
 * complementary — a renderer that dropped one slot and duplicated another
 * to the same total length would fool a length-based check; slot coverage
 * catches it (and localizes any failure to a named slot).
 *
 * Checks against stardust/reskin/content-model/<slug>/content-model.json:
 *   (1) SLOT TEXT   — each slot's normalized visibleText is substring-
 *                     present in the rendered scope's normalized text.
 *   (2) CTAs        — each captured CTA is present as a (text, ABSOLUTE
 *                     href) pair: an <a> whose href equals absHref and
 *                     whose text contains the captured label. A link
 *                     migrate rewrote is matched by its data-source-href.
 *                     A Figma-sourced model's CTA also matches the raw href
 *                     attribute (a page-relative or "#" placeholder link).
 *   (3) IMAGES      — each captured image src is present, URL-normalized
 *                     to host+path. A localized image (stream-render
 *                     --localize-images) is matched by its data-source-src.
 *   (3b) PAINT      — each present content image actually RENDERS
 *                     (naturalWidth > 0 after a lazy-load scroll pass).
 *                     The src check compares URL strings; an origin-locked
 *                     source CDN can 403 every hotlinked image while the
 *                     string gate passes (F-R4, a botanical-garden site: 19 images never
 *                     painted on a PASSing gate). Zero-painted → FAIL
 *                     naming the img; downgrade with --paint warn only
 *                     with a recorded reason.
 *   (4) METADATA    — title, description, canonical, every OG tag, every
 *                     Twitter tag carried VERBATIM; JSON-LD block count
 *                     matches (migrate's inserted data-migrate-default
 *                     block is not counted). Fidelity over repair: broken source values
 *                     must be carried too (flag them, don't fix them).
 *
 * Live --rendered targets (a staged deploy, a served page on a real host)
 * navigate via the shared diff live-session module (F-G/F-R1): real-Chrome
 * UA + the standard request headers, challenge detection, webdriver spoof.
 * A byte-adjacent gate must never measure a challenge interstitial or an
 * error page: a bot challenge FAILS LOUD (exit 3) and a non-challenge
 * HTTP >= 400 fails loud too (exit 2) — never gated against. Local/file
 * targets keep the legacy networkidle path.
 *
 * Usage:
 *   node slot-coverage.mjs --model <content-model.json> --rendered <url|file>
 *       [--rendered-scope <sel>]   default "main"
 *       [--report <path>]          markdown report
 *       [--paint fail|warn]        paint-assertion severity (default fail)
 *       [--ua <string>]            user agent (default: live-session's
 *                                  real-Chrome UA + standard headers)
 *       [--wait-until <state>]     live-target goto waitUntil (default
 *                                  domcontentloaded; local/file targets
 *                                  keep networkidle)
 *       [--headed]                 headed stealth real Chrome (escalation
 *                                  for bot-managed sites)
 *       [--locale <tag>]           pin Accept-Language + locale
 *       [--wait-eds]               settle the rendered page's EDS decoration
 *                                  (body.appear, every data-section-status /
 *                                  data-block-status "loaded") before measuring;
 *                                  on by default when --rendered is an EDS host
 *                                  (aem.page/live, hlx.page/live,
 *                                  DEPLOY_VERIFY_ORIGIN). A stall exits 2
 *                                  "stalled decoration: …", nothing measured
 *       [--eds-timeout <ms>]       settle bound (default 20000)
 *       [--auth-header <value>]    Authorization header for the rendered origin
 *                                  only (a protected preview); never printed
 *       [--token-env <NAME>]       the same, read from the variable NAME
 *       [--deltas <json>]          the page's declared source → preview differences
 *                                  (reskin/deltas/<slug>.json, deployed/deltas.mjs):
 *                                  text.allow entries rewrite each slot's model text;
 *                                  `images` swaps (3) for a count + alt + width comparison of
 *                                  the VISIBLE rendered images (source-normalize.mjs
 *                                  IMG_VISIBLE, the predicate the model capture and
 *                                  dom-equality use): attribution to a slot is positional by
 *                                  cumulative count (slot s takes the next k, k = its model
 *                                  images), so an image moved across a slot boundary, or
 *                                  replaced by one with the same alt, is not detected; one
 *                                  `images total` check compares every visible image in scope
 *                                  with the model's, so extras anywhere fail; (3b) paint stays;
 *                                  links.localize also accepts a CTA's href as deploy
 *                                  localizes it onto the --rendered origin; metadata.ignore
 *                                  keys skip their check, jsonLd "ignore" the count,
 *                                  metadata.absent keys are asserted NOT carried. The report
 *                                  gains a "Declared deltas" section (applied with counts,
 *                                  ignored, unused: a declared entry that matched nothing,
 *                                  also a WARNING line). "blocking": false makes a failed
 *                                  check exit 0 with an ADVISORY line. Absent, nothing above
 *                                  changes.
 *
 * Exit: 0 all checks pass, 1 any fail, 2 setup error (incl. a stalled
 *       decoration, an invalid --deltas file), 3 bot challenge / blocked live
 *       target (fail loud, never measured).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const opts = { 'rendered-scope': 'main', paint: 'fail', 'wait-until': 'domcontentloaded' };
  // Enumerated value-taking flags — an unknown --flag (e.g. a typo like
  // --rendered-scpoe) must be rejected, not silently stored and defaulted.
  const VALUE_FLAGS = new Set(['model', 'rendered', 'rendered-scope', 'report', 'paint', 'ua', 'wait-until', 'locale', 'eds-timeout', 'auth-header', 'token-env', 'deltas']);
  // A blank value here would fall back to $SITE_TOKEN / .env and send a token nobody asked for.
  const AUTH_FLAGS = new Set(['auth-header', 'token-env']);
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--headed') opts.headed = true;
    else if (a === '--wait-eds') opts.waitEds = true;
    else if (a.startsWith('--') && VALUE_FLAGS.has(a.slice(2))) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--') || ((AUTH_FLAGS.has(a.slice(2)) || a === '--deltas') && !v.trim())) { console.error(`[slot-coverage] ${a} needs a value`); process.exit(2); }
      opts[a.slice(2)] = v; i += 1;
    }
    else {
      // Never echo the whole element: `--auth-header=<token>`, `--auth-header:<token>` or the stray half of an unquoted value is a secret.
      const name = a.match(/^--[\w-]+/)?.[0] ?? null;
      const hint = name && name !== a && VALUE_FLAGS.has(name.slice(2)) ? ` (write "${name} <value>")` : '';
      console.error(`[slot-coverage] ${name ? `unknown arg: ${name}${hint}` : 'unknown arg (not a --flag, not echoed): a value flag takes its value as the next argument'}`);
      process.exit(2);
    }
  }
  if (!['fail', 'warn'].includes(opts.paint)) { console.error(`[slot-coverage] --paint must be fail|warn, got: ${opts.paint}`); process.exit(2); }
  return opts;
}

const args = parseArgs(process.argv);
if (args.help || !args.model || !args.rendered) {
  console.log('usage: node slot-coverage.mjs --model <content-model.json> --rendered <url|file>');
  console.log('         [--rendered-scope main] [--report <path>] [--paint fail|warn]');
  console.log('         [--ua <string>] [--wait-until domcontentloaded] [--headed] [--locale <tag>]');
  console.log('         [--wait-eds] [--eds-timeout <ms>] [--auth-header <value>] [--token-env <NAME>] [--deltas <json>]');
  console.log('Proves every model slot (text, CTAs, images) + all metadata present in the render,');
  console.log('and that every present content image actually PAINTS (naturalWidth > 0) — a URL-string');
  console.log('match can pass while an origin-locked source CDN 403s every image (gates.md § Image');
  console.log('paint). --paint warn downgrades paint failures to warnings (record why).');
  console.log('Live --rendered targets get the shared live-session hardening (real-Chrome UA + standard');
  console.log('headers, domcontentloaded, challenge detection); escalate bot-managed sites with --headed.');
  console.log('--wait-eds settles the rendered page\'s EDS decoration first (default on for an EDS host,');
  console.log('bounded by --eds-timeout, 20000 ms); a stall exits 2 and measures nothing. --auth-header /');
  console.log('--token-env authenticate on the rendered origin only (a protected preview) and are never printed.');
  console.log('--deltas <json> applies the page\'s declared source → preview differences (text, images, localized links,');
  console.log('metadata) and reports each one applied or unused; "blocking": false in it makes a failure advisory (exit 0).');
  console.log('Exit: 0 pass, 1 fail, 2 setup error, 3 bot challenge / blocked live target (never measured).');
  process.exit(args.help ? 0 : 2);
}
if (Object.hasOwn(args, 'eds-timeout') && !/^[1-9]\d*$/.test(args['eds-timeout'])) {
  console.error(`[slot-coverage] --eds-timeout needs a positive integer (milliseconds), got "${args['eds-timeout']}"`);
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
  console.error(`[slot-coverage] ${e.message.split('\n')[0]}`);
  console.error('Copy skills/reskin/scripts/* (deployed/ and figma/ included) and the diff skill\'s scripts into the project (SKILL.md § Setup).');
  process.exit(2);
}
const { edsSettle, isEdsHost, siteAuth, authContextOptions, redact } = eds;
const { isLiveHttpUrl, launchStealthHeaded, newLiveContext, gotoLive } = live;

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  console.error('[slot-coverage] playwright not importable from this script\'s directory.');
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
const die = (m, c = 2) => { console.error(`[slot-coverage] ${redact(m, auth)}`); process.exit(c); };
// Only --token-env can come up empty: a non-blank --auth-header is the header, and a blank one never gets here.
if (wantsAuth && !auth) die('no site token: the variable --token-env names is not set in the environment or .env');
const waitEds = !!args.waitEds || isEdsHost(renderedUrl);
const edsTimeoutMs = args['eds-timeout'] ? Number(args['eds-timeout']) : 20000;
// --deltas: loaded here, after the --help guard, and validated before a browser starts.
let deltasLib = null; let deltas = null; let imgVisibleSrc = null;
if (args.deltas) {
  try {
    deltasLib = await import('./deployed/deltas.mjs');
    deltas = deltasLib.loadDeltas(args.deltas);
    if (deltas.links.localize) deltasLib.requireEdsPath();
    if (deltas.images) ({ IMG_VISIBLE: imgVisibleSrc } = await import('./source-normalize.mjs'));
  } catch (e) {
    if (e.name !== 'UsageError' && e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    die(e.message);
  }
}
const model = JSON.parse(readFileSync(resolve(args.model), 'utf8'));
// A Figma-sourced model (content-model.md § Figma-sourced models) has page-relative or "#" link targets: match the raw attribute too.
const figmaSourced = model.source?.kind === 'figma' || model._provenance?.source?.kind === 'figma';

const browser = args.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
// UA + standard headers + webdriver spoof (live-session) — harmless on
// local/file targets, mandatory on live ones (F-G/F-R1).
const ctx = await newLiveContext(browser, {
  ua: args.ua, locale: args.locale, viewport: { width: 1440, height: 900 },
  ...authContextOptions(renderedUrl, auth),
});
const page = await ctx.newPage();
let navErr = null;
if (isLiveHttpUrl(renderedUrl)) {
  // A challenge interstitial or an HTTP >= 400 page must fail loud — this
  // byte-adjacent gate must never measure either as the rendered page
  // (gotoLive default httpError:'throw'). A nav failure is not swallowed.
  // solveWindow only under --headed: headless clearance never lands, and the
  // solve loop would spend the Akamai block budget (1 hit vs up to 4).
  try {
    await gotoLive(page, renderedUrl, { waitUntil: args['wait-until'], timeoutMs: 60000, settleMs: 0, solveWindow: !!args.headed });
  } catch (e) {
    console.error(`[slot-coverage] ${redact(e.message, auth)}`);
    await browser.close();
    process.exit(e.name === 'BotChallengeError' ? 3 : 2);
  }
} else {
  // local/file target (the usual --rendered: a rendered page file) — legacy
  // networkidle path, waits unchanged. The nav error is TOLERATED here only
  // for file:// quirks (subresource aborts), but captured and surfaced with
  // the scope-missing error below instead of being silently swallowed —
  // the dom-equality.mjs pattern.
  navErr = await page.goto(renderedUrl, { waitUntil: 'networkidle', timeout: 60000 }).then(() => null, (e) => e);
}
if (waitEds) {
  const { stalled } = await edsSettle(page, { timeoutMs: edsTimeoutMs });
  if (stalled.length) { await browser.close(); die(`stalled decoration: ${stalled.join(', ')}`); }
}
await page.waitForTimeout(1500);

// Paint assertion prep (F-R4): scroll so lazy images intersect and load,
// then wait (bounded) for every in-flight image to settle. An image that
// 403s fires `error` and stays naturalWidth=0 — exactly what we assert on.
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 700) {
    window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 150));
  }
  window.scrollTo(0, 0);
});
await page.evaluate(() => Promise.race([
  Promise.all(Array.from(document.images).map((img) => (img.complete ? null
    : new Promise((res) => { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); })))),
  new Promise((r) => setTimeout(r, 10000)),
]));
await page.waitForTimeout(300);

const results = []; // { gate, check, pass, detail }
const R = (gate, check, pass, detail = '') => results.push({ gate, check, pass, detail });

// ---- (1)(2)(3) slot coverage ------------------------------------------------
// With `images` declared, only the images the model capture counts as content are measured (imgVisibleSrc is
// source-normalize.mjs IMG_VISIBLE, the same code dom-equality runs); otherwise every <img> in scope, as before.
const rendered = await page.evaluate(({ scopeSel, imgVisibleSrc: visibleSrc }) => {
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const scope = document.querySelector(scopeSel);
  if (!scope) return { error: `rendered scope not found: ${scopeSel}` };
  const imgVisible = visibleSrc ? (0, eval)(visibleSrc) : () => true;
  return {
    text: norm(scope.innerText),
    hrefs: Array.from(scope.querySelectorAll('a[href]')).map((a) => ({ href: a.dataset.sourceHref || a.href, raw: a.getAttribute('href'), text: norm(a.innerText) })),
    imgs: Array.from(scope.querySelectorAll('img')).filter(imgVisible).map((i) => ({
      src: i.dataset.sourceSrc || i.currentSrc || i.src,
      alt: i.getAttribute('alt') ?? '',
      width: Math.round(i.getBoundingClientRect().width),
      painted: i.complete && i.naturalWidth > 0,
    })),
  };
}, { scopeSel: args['rendered-scope'], imgVisibleSrc });
if (rendered.error) { await browser.close(); die(`${rendered.error}${navErr ? ` (navigation failed: ${navErr.message.split('\n')[0]})` : ''}`); }

const normPath = (u) => { try { const x = new URL(u, 'http://x'); return x.hostname + x.pathname; } catch { return u; } };
const squash = (t) => t.replace(/\s+/g, ' ').trim();
// (3b) PAINT (F-R4): src-string presence is not rendering. A rendered content image that never painted
// (naturalWidth=0 — e.g. the source CDN 403s hotlinked requests) is a broken page the string gate cannot see.
const paintCheck = (label, painted) => {
  const hint = painted ? '' : 'naturalWidth=0 — never painted; origin-locked source CDN? localize assets (Phase 6, gates.md § Image paint)';
  if (!painted && args.paint === 'warn') {
    console.log(redact(`  WARN paint: ${label} — ${hint}`, auth));
    R('paint', `${label} painted (WARN-downgraded)`, true, hint);
  } else {
    R('paint', `${label} painted`, painted, hint);
  }
};
// --deltas: each slot's model text and each CTA's text after the text.allow entries (counted once across all of
// them), the CTA hrefs' localization onto the rendered origin, and the images taken slot by slot in document order.
const textsOf = (s) => [s.visibleText, ...s.ctas.map((c) => c.text)];
const textDeltas = deltas ? deltasLib.applyTexts(model.sections.flatMap(textsOf), deltas) : null;
const localize = deltas?.links.localize && /^https?:/.test(renderedUrl) ? { sourceHost: deltas.links.localize.sourceHost, renderedOrigin: new URL(renderedUrl).origin } : null;
let nextImg = 0; let nextText = 0;
for (const s of model.sections) {
  const [text, ...ctaTexts] = textDeltas ? textDeltas.texts.slice(nextText, nextText + 1 + s.ctas.length).map(squash) : textsOf(s);
  nextText += 1 + s.ctas.length;
  R('slot-coverage', `${s.slot} text present`, rendered.text.includes(text), text.slice(0, 50));
  for (const [ci, c] of s.ctas.entries()) {
    const hrefs = localize ? [c.absHref, deltasLib.normalizeHref(c.absHref, localize)] : [c.absHref];
    const hit = rendered.hrefs.find((h) => (hrefs.includes(h.href) || (figmaSourced && h.raw === c.absHref)) && h.text.includes(ctaTexts[ci]));
    R('slot-coverage', `${s.slot} CTA "${c.text.slice(0, 30)}" -> ${c.absHref.slice(0, 60)}`, !!hit);
  }
  if (deltas?.images) {
    // count + alt + width. Attribution is positional by cumulative count: slot s takes the next s.images.length
    // visible rendered images, so a missing, extra or reordered image fails the slot where the page diverges, but
    // an image moved across a slot boundary with the document order kept, or replaced by one with the same alt,
    // is not detected. The total check below covers everything after the last owned image.
    const owned = rendered.imgs.slice(nextImg, nextImg + s.images.length);
    nextImg += s.images.length;
    if (s.images.length) {
      const cmp = deltasLib.compareImages(s.images, owned, deltas.images);
      R('slot-coverage', `${s.slot} images (${deltas.images})`, cmp.pass, cmp.detail);
      owned.forEach((r2, i) => paintCheck(`${s.slot} image ${s.images[i].alt ? JSON.stringify(s.images[i].alt.slice(0, 40)) : `#${i + 1}`}`, r2.painted));
    }
    continue;
  }
  for (const im of s.images) {
    const matches = rendered.imgs.filter((r2) => normPath(r2.src) === normPath(im.currentSrc));
    R('slot-coverage', `${s.slot} image …${normPath(im.currentSrc).slice(-50)}`, matches.length > 0);
    if (matches.length > 0) paintCheck(`${s.slot} image …${normPath(im.currentSrc).slice(-50)}`, matches.some((r2) => r2.painted));
  }
}
if (deltas?.images) {
  const total = deltasLib.compareImages(model.sections.flatMap((s) => s.images), rendered.imgs, deltas.images);
  R('slot-coverage', `images total (${deltas.images})`, total.pass, total.detail);
}

// ---- (4) metadata carried verbatim -------------------------------------------
const meta = await page.evaluate(() => {
  const og = {}; const tw = {}; let description = '';
  const carried = [];
  document.querySelectorAll('meta').forEach((m) => {
    const p = m.getAttribute('property') || ''; const n = m.getAttribute('name') || '';
    const c = m.getAttribute('content'); if (c === null) return;
    carried.push(...[p, n].filter(Boolean));
    if (p.startsWith('og:')) og[p] = c;
    if (n.startsWith('twitter:') || p.startsWith('twitter:')) tw[n || p] = c;
    if (n === 'description') description = c;
  });
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null;
  if (canonical) carried.push('canonical');
  if (document.title) carried.push('title');
  return {
    title: document.title, description, canonical, carried,
    og, tw, jsonLdCount: document.querySelectorAll('script[type="application/ld+json"]:not([data-migrate-default])').length,
  };
});
const md0 = model.metadata;
// --deltas: an ignored key skips its check; a key the page must not carry is asserted absent instead of equal.
const plan = deltas ? deltasLib.metadataPlan(deltas) : null;
const ignored = new Set();
const metaCheck = (key, label, pass, detail = '') => {
  if (plan?.ignore.has(key)) ignored.add(key);
  else if (!plan?.absent.has(key)) R('metadata', label, pass, detail);
};
metaCheck('title', 'title', meta.title === md0.title, meta.title);
metaCheck('description', 'description', meta.description === md0.description);
metaCheck('canonical', 'canonical', meta.canonical === md0.canonical, `${meta.canonical}`);
for (const [k, v] of Object.entries(md0.ogTags)) metaCheck(k, `og ${k}`, meta.og[k] === v);
for (const [k, v] of Object.entries(md0.twitterTags)) metaCheck(k, `tw ${k}`, meta.tw[k] === v);
if (plan?.jsonLd === 'ignore') ignored.add('jsonLd');
else R('metadata', 'jsonLd block count', meta.jsonLdCount === md0.jsonLd.length, `${meta.jsonLdCount}/${md0.jsonLd.length}`);
for (const k of plan?.absent ?? []) R('metadata', `absent ${k}`, !meta.carried.includes(k), meta.carried.includes(k) ? 'the rendered page carries it' : '');

await browser.close();

// ---- report -------------------------------------------------------------------
const byGate = {};
for (const r of results) (byGate[r.gate] ??= []).push(r);
let md = `# Slot-coverage + metadata report\n\n- Model: ${args.model}\n- Rendered: ${args.rendered} (scope: \`${args['rendered-scope']}\`)\n- Generated: ${new Date().toISOString()}\n\n`;
let allPass = true;
for (const [gate, rs] of Object.entries(byGate)) {
  const fails = rs.filter((r) => !r.pass);
  if (fails.length) allPass = false;
  md += `## ${gate} — ${rs.length - fails.length}/${rs.length} pass\n\n`;
  for (const r of rs) md += `- [${r.pass ? 'x' : ' '}] ${r.check}${r.detail ? ` — ${r.detail}` : ''}\n`;
  md += `\n`;
}
md += `**Overall: ${allPass ? 'PASS' : 'FAIL'}**\n`;
// deltas: what applied, what was ignored, and what matched nothing (a declared entry nothing needed, or an ignore
// key that names no check); blocking false turns a failure into an advisory.
const advisory = !!deltas && !allPass && !deltasLib.isBlocking(deltas);
const applied = textDeltas?.applied ?? [];
const ignoredKeys = [...ignored];
const unused = deltas ? [...textDeltas.unused, ...[...plan.ignore].filter((k) => !ignored.has(k)).map((k) => `metadata.ignore ${JSON.stringify(k)}`)] : [];
if (deltas) {
  const notes = [];
  if (deltas.images) notes.push(`Images: ${deltas.images} over the visible images in scope (as the model capture counts them): per slot, positional by cumulative count (slot s takes the next k), plus one total over every image. An image moved across a slot boundary with the document order kept, or replaced by one with the same alt, is not detected`);
  if (deltas.links.localize) notes.push(localize ? `Links: CTA hrefs on \`${deltas.links.localize.sourceHost}\` also match as localized onto \`${localize.renderedOrigin}\`` : 'Links: localize not applied (the rendered target is not an http(s) origin)');
  if (deltas.metadata.jsonLd === 'count-only') notes.push('JSON-LD: count-only (the block count is compared, not the content)');
  if (advisory) md += `\n${deltasLib.ADVISORY}: the failed checks above are reported, the exit code is 0\n`;
  md += `\n${deltasLib.reportSection(deltas, { file: args.deltas, applied, unused, ignored: ignoredKeys, notes })}`;
}
if (args.report) {
  mkdirSync(dirname(resolve(args.report)), { recursive: true });
  writeFileSync(args.report, redact(md, auth));
}
const failLines = results.filter((r) => !r.pass);
console.log(redact(`[slot-coverage] ${allPass ? 'PASS' : 'FAIL'} — ${results.length - failLines.length}/${results.length} checks${args.report ? ` — report: ${args.report}` : ''}`, auth));
for (const f of failLines.slice(0, 15)) console.log(redact(`  FAIL ${f.gate}: ${f.check}${f.detail ? ` — ${f.detail}` : ''}`, auth));
if (deltas) {
  console.log(redact(`  deltas applied: ${applied.length ? applied.map((a) => `${a.id} ×${a.count}`).join(', ') : 'none'}`, auth));
  if (ignoredKeys.length) console.log(redact(`  ignored by delta: ${ignoredKeys.join(', ')}`, auth));
  for (const line of deltasLib.warningLines(deltas, unused)) console.log(redact(`  ${line}`, auth));
  if (advisory) console.log(redact(`[slot-coverage] ${deltasLib.ADVISORY}: ${failLines.length} failed check(s) reported, not enforced — exit 0`, auth));
}
process.exit(allPass || advisory ? 0 : 1);
