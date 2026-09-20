#!/usr/bin/env node
/**
 * skills/replica/scripts/anchor.mjs
 *
 * Section-anchor probe for the stardust:replica source-fidelity loop: prints
 * `[y, height]` for every top-level section (`main > section` /
 * `main > .section`), the footer, and the document height — one line per
 * box, same shape on the live page and on the build/prototype.
 *
 * Why it exists: the pixel probe's band table says WHERE drift is; this
 * probe says WHICH SECTION owns it. The fastest converging loop in the
 * field (a financial-services site, 2026-08-25/26 — roughly HALVED iterations vs
 * band-reading alone): run anchor.mjs on both sides, fix the FIRST
 * mismatched section top-down (everything below it is offset-contaminated,
 * same top-down rule as the band table), then re-run pixels. Build-side
 * anchor runs are free — they never navigate the live origin, so they don't
 * consume the live-hit budget (source-fidelity-gate.md § Hit minimization);
 * capture the live side once per fix round at most and diff against it.
 *
 * Hardening: live navigations go through the shared
 * ../../diff/scripts/live-session.mjs (real-Chrome UA + document-scoped
 * standard headers, challenge fail-loud exit 3, overlay dismissal, parked
 * pointer), and the height is read AFTER a slow-scroll settle pass —
 * pre-settle height is fake on entrance-animated sites
 * (recreation-procedure.md § Capture-state).
 *
 * LANDMARK Δy TABLE (--landmarks): the first diagnostic of every round.
 * Sections pair by index and say WHICH SECTION; landmarks pair by TEXT and
 * say which element inside it moved and by how much: visible h1–h4 (by
 * normalised text), the first visible image per top-level section (by section
 * index), CTAs (`a.button, .button a, button, [role=button], [class*=cta]`,
 * by text) and the footer top. --against <other-side.json> (the other side's
 * --json output or --cache file) prints `landmark | yA | yB | Δy | hA | hB |
 * Δh` sorted by yA, the unpaired lists (never counted), then ONE line:
 * `first non-zero Δ: <landmark> (+N px, section <label>) — fix its section
 * first` or `landmarks clean (all |Δy| ≤ 2 px)`. Field record: a 28-line
 * script of exactly this shape ran 92 times in one session and turned a 30 %
 * band into one padding value per round; a by-text box table converged in 12
 * passes after 10 image-based passes had killed the session. It is a
 * DIAGNOSIS ORDER inside a round — read it before the band table — not a
 * pass bar; build-side landmark passes are free.
 *
 * Usage:
 *   node skills/replica/scripts/anchor.mjs <url> [options]
 *     --width <px>        viewport width                    (default 1440)
 *     --main <sel>        content root to probe under       (default main)
 *     --landmarks         add the landmark table (headings / first image per
 *                         section / CTAs / footer, paired by text)
 *     --against <json>    pair THIS side's landmarks against the other side's
 *                         --json output or --cache file and print Δy/Δh + the
 *                         `first non-zero Δ` line (gate.sh: live cache vs build)
 *     --json-out <file>   write the --json object to <file> AND keep the human
 *                         tables on stdout (gate.sh's landmarks-<label>.json)
 *     --consent <sel>     extra consent-accept selector
 *     --dismiss <sel,...> extra overlay-dismiss selectors
 *     --block <substr,...> abort every request whose URL contains one of the
 *                         substrings (undismissable iframe/shadow widgets); the
 *                         main-frame navigation and the page's own origin are
 *                         never blocked. Run the SAME value on both sides —
 *                         stitch-shot's sidecar records `blocked` and
 *                         pixel-compare refuses an asymmetric pair (this probe writes no sidecar)
 *     --consent-mode <m>  accept | deny (default accept; deny clicks reject-all, never accept — live-session)
 *     --headed[=window]    bot-management ladder start: tier 2 (real Chrome headless); =window tier 3 (off-screen window). Default: the tier extract recorded
 *     --storage-state <file> | --fresh-state | --solve-wait <ms>  admitted-session reuse / clean start / interactive solve (live-session.mjs § Admitted-session reuse; --solve-wait implies a visible tier-3 window)
 *     --locale <tag>      pin Accept-Language + locale (e.g. en-GB)
 *     --json              machine-readable output on stdout
 *     --cache <file>      reuse this URL's measurement from <file> (JSON) when it
 *                         exists for the same URL, width and --main; probe and write
 *                         it otherwise. For the LIVE side only — build-side runs are
 *                         free and must re-measure. Same contract as gate.sh's
 *                         live.png: delete the file to re-probe. Convention:
 *                         stardust/replica/gates/<slug>-<w>/anchor-live.json
 *                         A cache written without --landmarks is re-probed once
 *                         (and rewritten, same key) when --landmarks is asked.
 *
 * Guard: when the `--main` root still contains a <header>/<footer> the section
 * list includes chrome and every number below is contaminated (recorded: the
 * AEM root wrapper matched on four archetypes at once — 24 false structural
 * reds, doc-height as mainHeight). The probe prints a ⚠ and sets
 * `rootWrapsChrome` in --json; fix the selector before reading the boxes.
 *
 * Example (one line per section; diff the two outputs side by side):
 *   node stardust/scripts/replica/anchor.mjs "https://<site>/<path>" --width 1440
 *   node stardust/scripts/replica/anchor.mjs "http://localhost:8791/<slug>-proposed.html" --width 1440
 *
 * Requires: playwright, and the diff skill's scripts dir alongside
 * (live-session.mjs — the replica Setup copies both).
 * Exit codes: 0 printed, 1 error, 3 bot challenge (live side blocked). The
 * landmark table never changes the exit code — it is a diagnostic, not a bar.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// Dependencies through the resolution chain (skills/stardust/scripts/lib/resolve.mjs — runtime-preflight.md
// § Resolution chain): plugin layout, then a project copy made as a set (harness-permissions.md § Two classes);
// a lone copy without the helper falls back to the bare import it resolved before. A miss at every link is one
// line naming preflight-runtime.mjs, exit 2 (no verdict — the same class as 124).
const CHAIN = await (async () => { for (const c of ['../../stardust/scripts/lib/resolve.mjs', '../stardust/lib/resolve.mjs']) { try { return await import(new URL(c, import.meta.url)); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; } } return null; })();
const loadDep = (name) => (CHAIN ? CHAIN.resolveDep(name, { from: import.meta.url }) : import(name).then((m) => ('module.exports' in m ? m['module.exports'] : (m.default && Object.keys(m).every((k) => k === 'default' || k === '__esModule' || k in m.default) ? m.default : m))));
const preflightExit = (e) => { console.error(e.message); process.exit(2); };
// live-session.mjs (the diff skill) through the chain's siblingScript — plugin tree, STARDUST_SKILLS_DIR, flat project
// copy (stardust/scripts/replica ↔ stardust/scripts/diff); a lone copy without the chain probes the two layouts itself.
const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_SESSION = (() => { try { return CHAIN ? CHAIN.siblingScript('diff', 'live-session.mjs', { from: import.meta.url }) : ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs'].map((p) => resolvePath(HERE, p)).find((p) => existsSync(p)); } catch { return null; } })();
if (!LIVE_SESSION) {
  console.error('anchor error: live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup).');
  process.exit(1);
}
const { chromium } = await loadDep('playwright').catch(preflightExit);
const { isLiveHttpUrl, launchTier, parseHeadedFlag, resolveStartTier, newLiveContext, gotoLive, sessionContextOptions, parseSolveWaitFlag, dismissOverlays, reportOverlayResidue, defaultWaitUntil } = await import(pathToFileURL(LIVE_SESSION).href);

const HELP = `anchor — per-section [y, height] probe (run on BOTH sides, fix the first mismatch top-down)

Usage: node anchor.mjs <url> [options]
  --width <px>      viewport width (default 1440)
  --main <sel>      content root to probe under (default main)
  --landmarks       add the landmark Δy table (h1–h4 / first image per section / CTAs / footer, paired by text)
  --against <json>  pair against the other side's --json output or --cache file; prints Δy + the 'first non-zero Δ' line
  --json-out <file> write the --json object to <file>, keep the tables on stdout
  --consent <sel>   extra consent-accept selector (clicked, not removed)
  --dismiss <sel,…> extra overlay-dismiss selectors
  --block <substr,…> abort requests whose URL contains a substring (3rd-party widgets with no close control; never the page's own origin) — SAME value on both sides
  --consent-mode <m>    accept | deny (default accept; deny clicks reject-all, never accept)
  --headed[=window]  bot-management ladder start: tier 2 (real Chrome headless); =window tier 3 (off-screen window). Default: the tier extract recorded
  --storage-state <file> | --fresh-state | --solve-wait <ms>  admitted-session reuse / clean start / interactive solve (live-session.mjs; --solve-wait implies a visible tier-3 window)
  --locale <tag>    pin Accept-Language + locale (e.g. en-GB)
  --json            machine-readable output
  --cache <file>    reuse/write this URL's measurement (JSON) — live side only
  --help            this text

Exit codes: 0 printed, 1 error, 3 bot challenge (live side blocked — fail loud).`;

function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { width: 1440, main: 'main', block: [], landmarks: false, against: null, jsonOut: null, consent: null, dismiss: [], consentMode: 'accept', headed: false, locale: null, json: false, cache: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--main') { opts.main = rest[i += 1]; }
    else if (a === '--consent') { opts.consent = rest[i += 1]; }
    else if (a === '--dismiss') { opts.dismiss = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--block') { opts.block = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--consent-mode') { opts.consentMode = rest[i += 1]; if (!['accept', 'deny'].includes(opts.consentMode)) { console.error(`--consent-mode must be accept or deny\n\n${HELP}`); process.exit(1); } }
    else if (a === '--headed' || a.startsWith('--headed=')) { opts.headed = parseHeadedFlag(a); }
    else if (a === '--storage-state') { opts.storageState = rest[i += 1]; }
    else if (a === '--fresh-state') { opts.freshState = true; }
    else if (a === '--solve-wait') { opts.solveWaitMs = parseSolveWaitFlag(rest[i += 1]); opts.headed = 3; }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
    else if (a === '--json') { opts.json = true; }
    else if (a === '--cache') { opts.cache = rest[i += 1]; }
    else if (a === '--landmarks') { opts.landmarks = true; }
    else if (a === '--against') { opts.against = rest[i += 1]; opts.landmarks = true; }
    else if (a === '--json-out') { opts.jsonOut = rest[i += 1]; }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else pos.push(a);
  }
  const [url] = pos;
  if (!url) { console.error(`need <url>\n\n${HELP}`); process.exit(1); }
  return { url, opts };
}

function print(url, opts, out, note) {
  const obj = { url, width: opts.width, main: opts.main, ...out };
  if (opts.jsonOut) { mkdirSync(dirname(opts.jsonOut), { recursive: true }); writeFileSync(opts.jsonOut, `${JSON.stringify(obj, null, 2)}\n`); }
  if (opts.json) {
    console.log(JSON.stringify(obj, null, 2));
    return;
  }
  console.log(`doc height ${out.doc}px  (${url} @ ${opts.width})${note || ''}`);
  if (out.rootMissing) console.log(`  ⚠ no element matches --main "${opts.main}" — measured <body>; pass the real content root`);
  if (out.rootWrapsChrome) console.log(`  ⚠ --main "${opts.main}" matched a wrapper that still contains <header>/<footer> — the list below includes chrome and its numbers are contaminated; pass the content root (source-fidelity-gate.md § Hardening rule 3)`);
  for (const s of out.sections) console.log(`  y ${String(s.box[0]).padStart(6)}  h ${String(s.box[1]).padStart(5)}  ${s.label}`);
  if (out.footer) console.log(`  y ${String(out.footer[0]).padStart(6)}  h ${String(out.footer[1]).padStart(5)}  footer`);
  if (out.landmarks && !out.pair) {
    console.log(`landmarks (${out.landmarks.rows.length}; pair with --against <other-side.json> for the Δ table):`);
    for (const r of out.landmarks.rows) console.log(`  y ${String(r.y).padStart(6)}  h ${String(r.h).padStart(5)}  ${r.key}${r.section ? `  [${r.section}]` : ''}`);
  }
  if (out.pair) {
    const p = out.pair;
    console.log(`landmark table (A = ${p.aUrl} · B = this side; Δ = B − A):`);
    const sg = (n) => (n > 0 ? `+${n}` : String(n));
    console.log(`  ${'landmark'.padEnd(46)} ${'yA'.padStart(6)} ${'yB'.padStart(6)} ${'Δy'.padStart(6)}  ${'hA'.padStart(5)} ${'hB'.padStart(5)} ${'Δh'.padStart(5)}`);
    for (const r of p.rows) console.log(`  ${r.key.slice(0, 46).padEnd(46)} ${String(r.yA).padStart(6)} ${String(r.yB).padStart(6)} ${sg(r.dy).padStart(6)}  ${String(r.hA).padStart(5)} ${String(r.hB).padStart(5)} ${sg(r.dh).padStart(5)}${Math.abs(r.dy) > 2 ? '  ◄' : ''}`);
    if (p.unpaired.a.length || p.unpaired.b.length) console.log(`  unpaired (never counted): A-only [${p.unpaired.a.join(', ')}]  B-only [${p.unpaired.b.join(', ')}]`);
    console.log(p.firstDelta
      ? `first non-zero Δ: ${p.firstDelta.key} (${p.firstDelta.dy > 0 ? '+' : ''}${p.firstDelta.dy} px${p.firstDelta.section ? `, section ${p.firstDelta.section}` : ''}) — fix its section first; every landmark below inherits the offset`
      : 'landmarks clean (all |Δy| ≤ 2 px) — read the band table');
  }
}

// ---- landmark pairing (pure; exported for tests) ----
export const normText = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
/** Pair two landmark row lists by key; rows sorted by yA; unpaired never counted. */
export function pairLandmarks(a, b) {
  const rowsA = (a && a.rows) || []; const rowsB = (b && b.rows) || [];
  const byKeyB = new Map(rowsB.map((r) => [r.key, r]));
  const usedB = new Set();
  const rows = [];
  for (const ra of rowsA) {
    const rb = byKeyB.get(ra.key);
    if (!rb) continue;
    usedB.add(ra.key);
    rows.push({ key: ra.key, kind: ra.kind, section: ra.section || rb.section || null, yA: ra.y, yB: rb.y, dy: rb.y - ra.y, hA: ra.h, hB: rb.h, dh: rb.h - ra.h });
  }
  rows.sort((p, q) => p.yA - q.yA);
  const unpaired = { a: rowsA.filter((r) => !byKeyB.has(r.key)).map((r) => r.key), b: rowsB.filter((r) => !usedB.has(r.key)).map((r) => r.key) };
  const first = rows.find((r) => Math.abs(r.dy) > 2) || null;
  return { rows, unpaired, firstDelta: first ? { key: first.key, dy: first.dy, section: first.section } : null, clean: !first };
}
/** Read the other side: a --json output ({url,…,landmarks}) or a --cache file ({key:{url},data:{landmarks}}). */
export function readAgainst(file) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  if (j.data) return { url: j.key && j.key.url, landmarks: j.data.landmarks, sections: j.data.sections };
  return { url: j.url, landmarks: j.landmarks, sections: j.sections };
}

// --against: attach the paired Δ table to this side's data (the other side is A).
function withPair(data, opts) {
  if (!opts.against || !data.landmarks) return data;
  const other = readAgainst(opts.against);
  if (!other.landmarks) { console.error(`anchor: --against ${opts.against} carries no landmarks — probe that side with --landmarks first`); return data; }
  return { ...data, pair: { aUrl: other.url || opts.against, aFile: opts.against, ...pairLandmarks(other.landmarks, data.landmarks) } };
}

// --cache: keyed on URL + width + --main; a key mismatch re-probes and overwrites.
function cacheKey(url, opts) { return { url, width: opts.width, main: opts.main }; }

async function main() {
  const { url, opts } = parseArgs(process.argv);
  if (opts.cache && existsSync(opts.cache)) {
    try {
      const c = JSON.parse(readFileSync(opts.cache, 'utf8'));
      if (JSON.stringify(c.key) === JSON.stringify(cacheKey(url, opts))) {
        if (opts.landmarks && !c.data.landmarks) console.error(`anchor: --cache ${opts.cache} has no landmarks (probed without --landmarks) — re-probing once and rewriting it`);
        else { print(url, opts, withPair(c.data, opts), `  [from cache ${opts.cache}, probed ${c.probedAt} — delete to re-probe]`); return; }
      } else
      console.error(`anchor: --cache ${opts.cache} was probed for a different url/width/--main — re-probing`);
    } catch (e) { console.error(`anchor: --cache ${opts.cache} unreadable (${e.message}) — re-probing`); }
  }
  opts.tier = resolveStartTier(opts.headed); // ladder start = max(--headed tier, tier extract recorded) — live-session.mjs
  const browser = await launchTier(chromium, opts.tier);
  try {
    const ctx = await newLiveContext(browser, { locale: opts.locale, viewport: { width: opts.width, height: 900 }, block: opts.block, ...sessionContextOptions(url, opts) });
    const page = await ctx.newPage();
    await gotoLive(page, url, { waitUntil: defaultWaitUntil(url), settleMs: isLiveHttpUrl(url) ? 2500 : 1200, tier: opts.tier, solveWaitMs: opts.solveWaitMs });
    const dOv = await dismissOverlays(page, { mode: opts.consentMode, reject: opts.consentMode === 'deny' && opts.consent ? [opts.consent] : [], extra: [...(opts.consent && opts.consentMode !== 'deny' ? [opts.consent] : []), ...opts.dismiss], lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
    reportOverlayResidue('anchor', dOv);

    // Slow-scroll settle before measuring — pre-settle heights are fake on
    // entrance-animated / lazy-loading pages (recreation-procedure.md
    // § Capture-state), and the boxes must be read at rest from the top.
    await page.evaluate(async () => {
      const h = document.documentElement.scrollHeight;
      for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 80); }); }
      window.scrollTo(0, 0);
      await new Promise((r) => { setTimeout(r, 400); });
    });
    await page.waitForTimeout(600);

    const out = await page.evaluate(({ rootSel, wantLandmarks }) => {
      const box = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.y + window.scrollY), Math.round(r.height)]; };
      const matched = document.querySelector(rootSel);
      const root = matched || document.body;
      // top-level sections: <section> children and .section-classed children
      // (EDS emits div.section) — plain divs excluded to keep the two sides'
      // lists comparable at the granularity the replica authors at.
      const nodes = [...root.querySelectorAll(':scope > section, :scope > .section')];
      const label = (el, i) => {
        const cls = String(el.className || '').split(/\s+/).filter((c) => c && c !== 'section').slice(0, 2).join('.');
        return cls || `${el.tagName.toLowerCase()}[${i}]`;
      };
      const footer = document.querySelector('footer');
      // Landmarks: same visibility filter as chrome-parity; keys are normalised
      // text (headings, CTAs) or the section index (first image per section);
      // a repeated text gets #2, #3 so both sides pair the same instance.
      let landmarks = null;
      if (wantLandmarks) {
        const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
        const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const seen = new Map();
        const uniq = (k) => { const n = (seen.get(k) || 0) + 1; seen.set(k, n); return n === 1 ? k : `${k}#${n}`; };
        const sectionOf = (el) => { const i = nodes.findIndex((sec) => sec.contains(el)); return i >= 0 ? label(nodes[i], i) : null; };
        const rows = [];
        for (const h of root.querySelectorAll('h1, h2, h3, h4')) {
          if (!visible(h)) continue;
          const t = norm(h.textContent).slice(0, 60); if (!t) continue;
          const [y, hh] = box(h); rows.push({ kind: 'heading', key: uniq(`${h.tagName.toLowerCase()} "${t}"`), y, h: hh, section: sectionOf(h) });
        }
        nodes.forEach((sec, i) => {
          const img = [...sec.querySelectorAll('img, picture img, svg[width], video')].find((im) => visible(im) && im.getBoundingClientRect().width >= 120);
          if (img) { const [y, hh] = box(img); rows.push({ kind: 'image', key: `img[section ${i}]`, y, h: hh, section: label(sec, i) }); }
        });
        for (const c of root.querySelectorAll('a.button, .button a, button, [role="button"], [class*="cta" i] a, a[class*="btn" i]')) {
          if (!visible(c) || c.closest('h1, h2, h3, h4')) continue;
          const t = norm(c.textContent || c.getAttribute('aria-label')).slice(0, 40); if (!t) continue;
          const [y, hh] = box(c); rows.push({ kind: 'cta', key: uniq(`cta "${t}"`), y, h: hh, section: sectionOf(c) });
        }
        if (footer) { const [y, hh] = box(footer); rows.push({ kind: 'footer', key: 'footer', y, h: hh, section: null }); }
        rows.sort((p, q) => p.y - q.y);
        landmarks = { rows };
      }
      return {
        doc: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        rootMissing: !matched,
        rootWrapsChrome: !!(matched && matched !== document.body && matched.querySelector('header, footer')),
        sections: nodes.map((el, i) => ({ label: label(el, i), box: box(el) })),
        footer: footer ? box(footer) : null,
        ...(landmarks ? { landmarks } : {}),
      };
    }, { rootSel: opts.main, wantLandmarks: opts.landmarks });

    if (opts.cache) {
      mkdirSync(dirname(opts.cache), { recursive: true });
      writeFileSync(opts.cache, JSON.stringify({ key: cacheKey(url, opts), probedAt: new Date().toISOString(), data: out }, null, 2));
    }
    print(url, opts, withPair(out, opts));
  } finally {
    await browser.close();
  }
}

// exit 3 = bot challenge on the live side (fail loud, never measured).
// CLI only when invoked directly (real paths — a symlinked tmpdir differs); the
// pairing helpers are importable as a library.
const isMain = (() => { try { return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) main().catch((e) => { console.error(`anchor error: ${e.message}`); process.exit(e.code === 124 ? 124 : e.name === 'BotChallengeError' ? 3 : 1); }); // 124 = no browser slot (no verdict)
