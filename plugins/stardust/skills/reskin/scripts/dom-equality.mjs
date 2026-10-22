#!/usr/bin/env node
/**
 * skills/reskin/scripts/dom-equality.mjs — the reskin CONTENT GATE.
 *
 * Adapted from github.com/aemcoder/skills — skills/snowflake/scripts/
 * dom-equality.mjs (Apache-2.0). Attribution retained per that license.
 *
 * Adaptations for the reskin profile (validated in experiment UC2-E1):
 *   - PRIMARY (gating) checks: visible text (whitespace-normalized,
 *     BYTE-identical) and the visible-image src list (ORDER-sensitive,
 *     URL-normalized to host+path — query strings carry cache-busters; a
 *     localized image is compared by its data-source-src).
 *   - INFORMATIONAL (non-gating): element count, tag+class sequence — a
 *     reskin intentionally re-structures markup, so structure cannot gate.
 *   - Multi-scope SOURCE: comma-separated selectors captured in order and
 *     concatenated — real pages don't keep all content under one root (the
 *     experiment's hero + carousel lived inside <header>, not #content).
 *   - The shared normalization ledger (source-normalize.mjs / --normalize)
 *     is applied to the SOURCE side before capture — the SAME file the
 *     content-model capture used, so both ends measure identically.
 *   - Visible-only image comparison on both sides (hidden carousel clones /
 *     responsive duplicate menus poison raw img lists), using the SHARED
 *     predicate capture-content.mjs uses (source-normalize.mjs IMG_VISIBLE)
 *     so capture and gate can never drift on image counts.
 *   - Disclosure rest state (gating): the scopes' collapsed/expanded disclosures are counted on both
 *     sides BEFORE the ledger runs (source-normalize.mjs DISCLOSURE_STATE). A source with collapsed
 *     disclosures against a render with none collapsed FAILS — a capture ledger that expands every
 *     accordion is capture-only, it never makes the delivered block start open. The rendered side
 *     then runs REVEAL_DISCLOSURES (open <details>, unhide hidden="until-found") before its text is
 *     read, so a correctly collapsed panel still counts as present. Waived per page by the deltas
 *     file's "disclosures": { "restState": "open", "why": … }.
 *   - Live navigation via the shared diff live-session module (F-G/F-R1):
 *     real-Chrome UA + the standard request headers (UA alone still 403s on
 *     Akamai), domcontentloaded on live targets, webdriver spoof, challenge
 *     detection. This gate RE-CRAWLS the live source at gate time — a bot
 *     challenge or a degraded source page FAILS LOUD (exit 3), it is never
 *     gated against: measuring an interstitial as the source is the byte
 *     gate's own correctness bug. Local/file targets (including the
 *     rendered page and file-path sources) keep the legacy networkidle path.
 *
 * Usage:
 *   node dom-equality.mjs --source <url|file> --rendered <url|file> --report <path>
 *     [--source-scope 'selA,selB']   default "main" ("!" suffix tolerated, ignored)
 *     [--rendered-scope <sel>]       default "main"
 *     [--normalize <ledger.mjs>]     source-side ledger; MUST be the same
 *                                    file capture-content.mjs was given
 *     [--ua <string>]                user agent (default: live-session's
 *                                    real-Chrome UA + standard headers)
 *     [--wait-until <state>]         live-target goto waitUntil (default
 *                                    domcontentloaded; local/file keep
 *                                    networkidle)
 *     [--headed]                     headed stealth real Chrome (escalation
 *                                    for bot-managed sites)
 *     [--locale <tag>]               pin Accept-Language + locale
 *     [--wait-eds]                   settle the RENDERED page's EDS decoration (body.appear,
 *                                    every data-section-status / data-block-status "loaded")
 *                                    before measuring; on by default when --rendered is an EDS
 *                                    host (aem.page/live, hlx.page/live, DEPLOY_VERIFY_ORIGIN).
 *                                    A stall exits 2 "stalled decoration: …" and measures nothing
 *     [--eds-timeout <ms>]           settle bound (default 20000)
 *     [--deltas <json>]              the page's declared source → preview differences
 *                                    (reskin/deltas/<slug>.json, deployed/deltas.mjs): text.allow
 *                                    entries rewrite the SOURCE text before it is compared, and
 *                                    `images` swaps the host+path image list for count + alt +
 *                                    width (the rendered widths above 0). The report gains a
 *                                    "Declared deltas" section (applied with counts; unused = a
 *                                    declared entry that matched nothing, also a WARNING line on
 *                                    stdout). "blocking": false makes a failed check exit 0 with an
 *                                    ADVISORY line on stdout. "disclosures": { "restState": "open",
 *                                    "why": … } waives the rest-state check. Absent, nothing above
 *                                    changes.
 *
 * Writes: the markdown report to --report <path> (parent directories are created);
 * nothing else. The PASS/FAIL line goes to stderr.
 *
 * Exit: 0 PASS (text + images + disclosure rest state), 1 FAIL, 2 setup error (incl. a stalled decoration, an invalid
 *       --deltas file), 3 bot challenge / blocked live source (fail loud, never measured).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const opts = { 'source-scope': 'main', 'rendered-scope': 'main', 'wait-until': 'domcontentloaded' };
  // Enumerated value-taking flags — an unknown --flag (e.g. a typo like
  // --source-scpoe) must be rejected, not silently stored and defaulted.
  const VALUE_FLAGS = new Set(['source', 'rendered', 'report', 'source-scope', 'rendered-scope', 'normalize', 'ua', 'wait-until', 'locale', 'eds-timeout', 'deltas']);
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--headed') opts.headed = true;
    else if (a === '--wait-eds') opts.waitEds = true;
    else if (a.startsWith('--') && VALUE_FLAGS.has(a.slice(2))) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--') || (a === '--deltas' && !v.trim())) { console.error(`[dom-equality] ${a} needs a value`); process.exit(2); }
      opts[a.slice(2)] = v; i += 1;
    }
    else { console.error(`[dom-equality] unknown arg: ${a}`); process.exit(2); }
  }
  return opts;
}

const args = parseArgs(process.argv);
if (args.help || !args.source || !args.rendered || !args.report) {
  console.log('usage: node dom-equality.mjs --source <url|file> --rendered <url|file> --report <path>');
  console.log('         [--source-scope selA,selB] [--rendered-scope main] [--normalize ledger.mjs]');
  console.log('         [--ua <string>] [--wait-until domcontentloaded] [--headed] [--locale <tag>]');
  console.log('         [--wait-eds] [--eds-timeout <ms>] [--deltas <json>]');
  console.log('Gates on byte-equal normalized visible text + ordered visible-image set.');
  console.log('Structure (element count, tag sequence) is reported but informational.');
  console.log('Live targets get the shared live-session hardening (real-Chrome UA + standard headers,');
  console.log('domcontentloaded, challenge detection); escalate bot-managed sites with --headed.');
  console.log('--wait-eds settles the rendered page\'s EDS decoration first (default on for an EDS host,');
  console.log('bounded by --eds-timeout, 20000 ms); a stall exits 2 and measures nothing.');
  console.log('--deltas <json> applies the page\'s declared source → preview differences (text, images) and reports each one');
  console.log('applied or unused; "blocking": false in it makes a failure advisory (exit 0, ADVISORY on stdout).');
  console.log('Exit: 0 pass, 1 fail, 2 setup error, 3 bot challenge / blocked live source (never measured).');
  process.exit(args.help ? 0 : 2);
}
if (Object.hasOwn(args, 'eds-timeout') && !/^[1-9]\d*$/.test(args['eds-timeout'])) {
  console.error(`[dom-equality] --eds-timeout needs a positive integer (milliseconds), got "${args['eds-timeout']}"`);
  process.exit(2);
}

// Siblings are imported here, after the --help guard: --help answers from a directory holding only this script.
// live-session.mjs lives in the diff skill's scripts dir (two layouts, resolved by eds.mjs: the plugin tree and
// the documented project copy stardust/scripts/reskin ↔ stardust/scripts/diff).
let eds; let live; let normalizeLib;
try {
  eds = await import('./deployed/eds.mjs');
  live = await eds.loadLiveSession();
  normalizeLib = await import('./source-normalize.mjs');
} catch (e) {
  if (e.name !== 'UsageError' && e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  console.error(`[dom-equality] ${e.message.split('\n')[0]}`);
  console.error('Copy skills/reskin/scripts/* (deployed/ and figma/ included) and the diff skill\'s scripts into the project (SKILL.md § Setup).');
  process.exit(2);
}
const { edsSettle, isEdsHost } = eds;
const { isLiveHttpUrl, launchStealthHeaded, newLiveContext, gotoLive } = live;
const { loadNormalize, IMG_VISIBLE, DISCLOSURE_STATE, REVEAL_DISCLOSURES } = normalizeLib;

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  console.error('[dom-equality] playwright not importable from this script\'s directory.');
  console.error('Copy skills/reskin/scripts/* into the project (stardust/scripts/reskin/) and');
  console.error('run: npm i -D playwright pixelmatch pngjs --legacy-peer-deps  (reskin SKILL.md § Setup)');
  process.exit(2);
}

const toUrl = (p) => (/^(https?|file):/.test(p) ? p : pathToFileURL(resolve(p)).href);
const renderedUrl = toUrl(args.rendered);
const die = (m, c = 2) => { console.error(`[dom-equality] ${m}`); process.exit(c); };
const waitEds = !!args.waitEds || isEdsHost(renderedUrl);
const edsTimeoutMs = args['eds-timeout'] ? Number(args['eds-timeout']) : 20000;
// --deltas: loaded here, after the --help guard, and validated before a browser starts.
let deltasLib = null; let deltas = null;
if (args.deltas) {
  try {
    deltasLib = await import('./deployed/deltas.mjs');
    deltas = deltasLib.loadDeltas(args.deltas);
  } catch (e) {
    if (e.name !== 'UsageError' && e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    die(e.message);
  }
}
const { script: NORMALIZE, source: normalizeSource } = await loadNormalize(args.normalize);

const browser = args.headed ? await launchStealthHeaded(chromium) : await chromium.launch();

async function capture(url, scopeList, normalize, rendered = false) {
  // UA + standard headers + webdriver spoof (live-session) — harmless on
  // local/file targets, mandatory on live ones (F-G/F-R1).
  const ctx = await newLiveContext(browser, {
    ua: args.ua, locale: args.locale, viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  let navErr = null;
  if (isLiveHttpUrl(url)) {
    // The gate re-crawls the LIVE source here — a challenge/blocked
    // interstitial or an HTTP >= 400 page must fail loud, never be measured
    // as the source (the byte gate's correctness depends on it).
    // solveWindow only under --headed: headless clearance never lands, and
    // the solve loop would spend the Akamai block budget (1 hit vs up to 4).
    try {
      await gotoLive(page, url, { waitUntil: args['wait-until'], timeoutMs: 60000, settleMs: 0, solveWindow: !!args.headed });
    } catch (e) {
      console.error(`[dom-equality] ${e.message}`);
      await browser.close();
      process.exit(e.name === 'BotChallengeError' ? 3 : 2);
    }
  } else {
    // local/file target (rendered page, saved source snapshot) — legacy path.
    navErr = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).then(() => null, (e) => e);
  }
  if (rendered && waitEds) {
    const { stalled } = await edsSettle(page, { timeoutMs: edsTimeoutMs });
    if (stalled.length) { await browser.close(); die(`stalled decoration: ${stalled.join(', ')}`); }
  }
  await page.waitForTimeout(2000);
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 150));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1500);
  // Rest state first: the ledger (source) and the reveal (rendered) both change it.
  const rest = await page.evaluate(({ sl, stateSrc }) => {
    const state = (0, eval)(stateSrc);
    return sl.split(',').map((s) => document.querySelector(s.trim().replace(/!$/, ''))).filter(Boolean)
      .map(state).reduce((a, b) => ({ collapsed: a.collapsed + b.collapsed, expanded: a.expanded + b.expanded }), { collapsed: 0, expanded: 0 });
  }, { sl: scopeList, stateSrc: DISCLOSURE_STATE });
  if (normalize) { await page.evaluate(NORMALIZE); await page.waitForTimeout(300); }
  if (rendered) { await page.evaluate(REVEAL_DISCLOSURES); await page.waitForTimeout(100); }
  const data = await page.evaluate(({ sl, imgVisibleSrc }) => {
    const sels = sl.split(',').map((s) => s.trim().replace(/!$/, ''));
    const scopes = sels.map((s) => document.querySelector(s));
    if (scopes.some((s) => !s)) return { error: `scope missing among: ${sl}` };
    const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
    // Shared image predicate — the SAME code capture-content.mjs ran at
    // capture time (source-normalize.mjs IMG_VISIBLE): no capture↔gate drift.
    const imgVisible = (0, eval)(imgVisibleSrc);
    const all = scopes.flatMap((sc) => Array.from(sc.querySelectorAll('*')));
    return {
      elementCount: all.length,
      tagSequence: all.map((e) => e.tagName.toLowerCase() + ((typeof e.className === 'string' && e.className.trim()) ? '.' + e.className.trim().split(/\s+/)[0] : '')),
      visibleText: norm(scopes.map((sc) => sc.innerText || '').join(' ')),
      imageSrcs: scopes.flatMap((sc) => Array.from(sc.querySelectorAll('img')).filter(imgVisible).map((i) => i.dataset.sourceSrc || i.currentSrc || i.src || '')),
      images: scopes.flatMap((sc) => Array.from(sc.querySelectorAll('img')).filter(imgVisible).map((i) => ({ alt: i.getAttribute('alt') ?? '', width: Math.round(i.getBoundingClientRect().width) }))),
    };
  }, { sl: scopeList, imgVisibleSrc: IMG_VISIBLE });
  await page.close();
  if (data.error) die(`${data.error} (page: ${url}${navErr ? ` — navigation failed: ${navErr.message.split('\n')[0]}` : ''})`);
  return { ...data, rest };
}

console.error(`[dom-equality] capturing source ${args.source} scope=${args['source-scope']} normalize=${normalizeSource}`);
const src = await capture(toUrl(args.source), args['source-scope'], true);
console.error(`[dom-equality] capturing rendered ${args.rendered} scope=${args['rendered-scope']}`);
const rnd = await capture(renderedUrl, args['rendered-scope'], false, true);
await browser.close();

// --deltas: a text delta maps the source's text to what the preview renders, so it rewrites the SOURCE side before
// the comparison (everything below, the report's source length and divergence snippet included, reads that text).
const textDeltas = deltas ? deltasLib.applyText(src.visibleText, deltas) : null;
if (textDeltas) src.visibleText = textDeltas.text.replace(/\s+/g, ' ').trim();

// --- PRIMARY: visible text (byte-identical after whitespace normalization) ---
const textMatch = src.visibleText === rnd.visibleText;
let textDiff = null;
if (!textMatch) {
  let i = 0;
  const min = Math.min(src.visibleText.length, rnd.visibleText.length);
  while (i < min && src.visibleText[i] === rnd.visibleText[i]) i += 1;
  textDiff = {
    sourceLen: src.visibleText.length, renderedLen: rnd.visibleText.length, firstDivergence: i,
    sourceSnippet: src.visibleText.slice(Math.max(0, i - 40), i + 80),
    renderedSnippet: rnd.visibleText.slice(Math.max(0, i - 40), i + 80),
  };
}

// --- PRIMARY: visible image srcs (ordered; URL-normalized to host+path) -----
// With deltas.images: count + alt + rendered width instead (deployed/deltas.mjs compareImages).
const normSrc = (u) => { try { const x = new URL(u, 'http://x'); return x.hostname + x.pathname; } catch { return u; } };
const srcImgs = src.imageSrcs.map(normSrc);
const rndImgs = rnd.imageSrcs.map(normSrc);
const imgDiffs = [];
const imageCheck = deltas?.images ? deltasLib.compareImages(src.images, rnd.images, deltas.images) : null;
if (!imageCheck) {
  if (srcImgs.length !== rndImgs.length) imgDiffs.push({ type: 'count', source: srcImgs.length, rendered: rndImgs.length });
  for (let i = 0; i < Math.min(srcImgs.length, rndImgs.length); i += 1) {
    if (srcImgs[i] !== rndImgs[i]) imgDiffs.push({ type: 'mismatch', index: i, source: srcImgs[i], rendered: rndImgs[i] });
  }
}
const imageMatch = imageCheck ? imageCheck.pass : imgDiffs.length === 0;

// --- INFORMATIONAL: structure ----------------------------------------------
const countDelta = rnd.elementCount - src.elementCount;
let firstTagDivergence = -1;
const minT = Math.min(src.tagSequence.length, rnd.tagSequence.length);
for (let i = 0; i < minT; i += 1) if (src.tagSequence[i] !== rnd.tagSequence[i]) { firstTagDivergence = i; break; }

// --- PRIMARY: disclosure rest state ------------------------------------------
// The source starts (some) disclosures collapsed; the render must too. Everything open at rest means a capture-only
// "expand every accordion" ledger entry leaked into the delivered block.
const restWaived = deltas?.disclosures?.restState === 'open';
const restLeak = src.rest.collapsed > 0 && rnd.rest.collapsed === 0;
const restMatch = !restLeak || restWaived;

const pass = textMatch && imageMatch && restMatch;
const tick = (b) => (b ? 'PASS' : 'FAIL');
let md = `# Content gate — DOM equality report (reskin profile)\n\n`;
md += `- Source: ${args.source} (scopes: \`${args['source-scope']}\`, normalize: \`${normalizeSource}\`)\n`;
md += `- Rendered: ${args.rendered} (scope: \`${args['rendered-scope']}\`)\n`;
md += `- Generated: ${new Date().toISOString()}\n\n`;
md += `## Primary checks (gating)\n\n`;
md += `| Check | Source | Rendered | Status |\n|---|---|---|---|\n`;
md += `| Visible text (normalized chars) | ${src.visibleText.length} | ${rnd.visibleText.length} | ${tick(textMatch)} |\n`;
md += `| ${imageCheck ? `Visible images (${deltas.images})` : 'Visible image srcs (ordered)'} | ${srcImgs.length} | ${rndImgs.length} | ${tick(imageMatch)} |\n`;
md += `| Disclosures collapsed at rest${restLeak && restWaived ? ' (waived: deltas disclosures.restState "open")' : ''} | ${src.rest.collapsed} (${src.rest.expanded} open) | ${rnd.rest.collapsed} (${rnd.rest.expanded} open) | ${tick(restMatch)} |\n\n`;
md += `**Overall: ${pass ? 'PASS' : 'FAIL'}**\n\n`;
// deltas: blocking false turns a failure into an advisory (the exit code stays 0).
const advisory = !!deltas && !pass && !deltasLib.isBlocking(deltas);
if (advisory) md += `${deltasLib.ADVISORY}: the failed checks are reported, the exit code is 0\n\n`;
if (textDiff) {
  md += `### Text divergence\n\nFirst divergent char at ${textDiff.firstDivergence} (source ${textDiff.sourceLen} / rendered ${textDiff.renderedLen} chars).\n\n`;
  md += `Source:\n\n> …${textDiff.sourceSnippet}…\n\nRendered:\n\n> …${textDiff.renderedSnippet}…\n\n`;
}
if (!restMatch) {
  md += `### Disclosure rest state\n\nThe source starts ${src.rest.collapsed} disclosure(s) collapsed; the render starts none collapsed (${rnd.rest.expanded} open). `;
  md += 'A ledger entry that expands accordions is capture-only: the delivered block starts closed like the source, its panels `hidden="until-found"` (or a closed `<details>`), which this gate reveals before reading the text.\n\n';
}
if (!imageMatch) {
  md += `### Image divergences\n\n`;
  if (imageCheck) md += `- ${imageCheck.detail.split('; ').slice(0, 20).join('\n- ')}\n`;
  imgDiffs.slice(0, 20).forEach((d) => {
    md += d.type === 'count'
      ? `- count: source=${d.source} rendered=${d.rendered}\n`
      : `- [${d.index}] source=\`${d.source}\` rendered=\`${d.rendered}\`\n`;
  });
  md += `\n`;
}
md += `## Informational (non-gating — a reskin re-structures markup by design)\n\n`;
md += `- Element count: source=${src.elementCount} rendered=${rnd.elementCount} (delta ${countDelta >= 0 ? '+' : ''}${countDelta})\n`;
md += `- Tag+class sequence: ${firstTagDivergence === -1 && src.tagSequence.length === rnd.tagSequence.length ? 'identical' : `diverges at position ${firstTagDivergence === -1 ? minT : firstTagDivergence} of ${minT}`}\n`;
if (deltas) {
  const notes = ['The source text above is the text after the declared deltas'];
  if (deltas.images) notes.push(`Images: ${deltas.images} — the ${rnd.images.length} visible rendered image(s) against the ${src.images.length} on the source`);
  md += `\n${deltasLib.reportSection(deltas, { file: args.deltas, applied: textDeltas.applied, unused: textDeltas.unused, notes })}`;
}

mkdirSync(dirname(resolve(args.report)), { recursive: true });
writeFileSync(args.report, md);
console.error(`[dom-equality] ${pass ? 'PASS' : 'FAIL'} — report: ${args.report}`);
if (!restMatch) console.error(`  disclosures: source ${src.rest.collapsed} collapsed at rest, rendered 0 collapsed (${rnd.rest.expanded} open) — the delivered block must start closed like the source`);
if (textDiff) console.error(`  text diverges @${textDiff.firstDivergence}: src="…${textDiff.sourceSnippet.slice(30, 90)}…" rnd="…${textDiff.renderedSnippet.slice(30, 90)}…"`);
if (deltas) {
  console.log(`  deltas applied: ${textDeltas.applied.length ? textDeltas.applied.map((a) => `${a.id} ×${a.count}`).join(', ') : 'none'}`);
  for (const line of deltasLib.warningLines(deltas, textDeltas.unused)) console.log(`  ${line}`);
  if (advisory) console.log(`[dom-equality] ${deltasLib.ADVISORY}: the failed checks are reported, not enforced — exit 0`);
}
process.exit(pass || advisory ? 0 : 1);
