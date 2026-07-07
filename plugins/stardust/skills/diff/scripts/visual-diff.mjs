#!/usr/bin/env node
/**
 * skills/diff/scripts/visual-diff.mjs
 *
 * Prototype ↔ EDS visual reconcile probe for the stardust:deploy skill
 * (optional Step 10). Renders BOTH the source prototype and the converted EDS
 * page at a fixed viewport with reduced motion, captures screenshots, and emits
 * a STRUCTURED metrics report — not a pixel diff. Computed-style measurements
 * (container widths, image natural-vs-rendered dims, heading colors) are the
 * signal; pixels are noise (fonts, animation, dynamic mock data).
 *
 * It also self-diagnoses the EDS page for the known post-pipeline regressions
 * the skill keeps re-learning:
 *   - stretched images        (#36 — EDS <img> width/height attrs + no height:auto)
 *   - full-bleed content      (#37 — dropped max-width .wrap, worst on plain bg)
 * The prototype side is for the agent to compare headings/eyebrow colors etc.
 *
 * Usage:
 *   node skills/diff/scripts/visual-diff.mjs <prototypeURL> <edsURL> [options]
 *     --out <dir>           screenshot output dir            (default qa/vdiff)
 *     --width <px>          viewport width                   (default 1280)
 *     --sections <list>     comma-separated CSS selectors to also shoot per-section
 *                           (applied to whichever page has them)
 *     --main <selector>     content root for the main-scoped probes (default "main";
 *                           on live sites without a <main>, both sides false-flag
 *                           BLANK RENDER while the main-scoped checks no-op)
 *     --ua <string>         user agent                       (default: real-Chrome desktop UA)
 *     --wait-until <state>  goto wait state override. Default rule (three tiers,
 *                           decided per URL side by live-session's defaultWaitUntil):
 *                           localhost/127.0.0.1 → 'networkidle'; EDS build/preview
 *                           origins (*.aem.page, *.aem.live, *.hlx.page, *.hlx.live)
 *                           → 'networkidle' (they decorate async — measuring at
 *                           domcontentloaded reads the pre-decoration DOM); all
 *                           other live http(s) → 'domcontentloaded' (analytics
 *                           beacons never reach networkidle).
 *     --dismiss [sel,...]   dismiss overlays on both sides via live-session
 *                           (consent + timed marketing modals + optional extras)
 *     --headed              escalation: headed stealth real Chrome (bot-managed sites)
 *     --locale <tag>        pin Accept-Language + context locale (geo-redirect determinism)
 *
 * Every context gets the real-Chrome UA + the standard request headers via
 * live-session.mjs (UA alone still 403s on Akamai — F-R1). A bot-management
 * challenge on either navigation FAILS LOUD (exit 3) — a challenge page must
 * never be measured as the source. A plain HTTP error (e.g. a 404 build side
 * before preview propagation) is NOT fatal: it is measured with a loud
 * warning and the flags reflect it — the advisory contract Step 10 relies on.
 *
 * Example:
 *   node skills/diff/scripts/visual-diff.mjs \
 *     http://localhost:8791/prototypes/home-C-cinematic.html \
 *     https://<branch>--<repo>--<owner>.aem.page/<path> \
 *     --sections ".hero,.feature-tabs,.compare"
 *
 * Prereq: a RENDERABLE prototype. Static prototypes serve directly (python3 -m
 * http.server from the dir so relative ../assets resolve); JSX prototypes must be
 * pre-rendered first (skill #24/#27). Requires playwright (project devDependency).
 *
 * Exit codes: 0 ran (report on stdout; red flags do NOT fail the run — they are
 * advisory for the agent, and an HTTP-error side is measured + flagged, not
 * fatal), 1 error, 3 bot challenge/blocked live side
 * (BotChallengeError — escalate with --headed).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len */
/* standalone dev tool: playwright is a devDependency; sequential page ops use awaited loops by design */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { resolveProfile } from './diff-profiles.mjs';
import { REAL_CHROME_UA, isLiveHttpUrl, defaultWaitUntil, launchStealthHeaded, newLiveContext, gotoLive, dismissOverlays } from './live-session.mjs';

const USAGE = `usage: node skills/diff/scripts/visual-diff.mjs <sourceURL> <buildURL> [options]
  --profile eds|generic  stack profile (default eds)
  --out <dir>            screenshot output dir (default qa/vdiff)
  --width <px>           viewport width (default 1280)
  --sections <a,b>       extra per-section screenshots
  --main <sel>           content root for main-scoped probes (default "main")
  --ua <string>          user agent (default: real-Chrome desktop UA)
  --wait-until <state>   goto wait state. Default (per URL side, three tiers):
                         networkidle for localhost/127.0.0.1; networkidle for EDS
                         build/preview origins (*.aem.page, *.aem.live, *.hlx.page,
                         *.hlx.live — they decorate async); domcontentloaded for all
                         other live http(s) (never reach networkidle).
  --dismiss [sel,...]    dismiss overlays (consent + timed marketing modals) on both
                         sides; optional comma-separated extra selectors
  --headed               headed stealth real Chrome (escalation for bot-managed sites)
  --locale <tag>         pin Accept-Language + locale (e.g. en-GB) for geo determinism
exit codes: 0 ran (flags advisory; an HTTP-error side, e.g. a 404 build pre-propagation,
            is measured + flagged with a warning, not fatal), 1 error,
            3 bot challenge (live side blocked — fail loud)
`;

function parseArgs(argv) {
  const [, , proto, eds, ...rest] = argv;
  if (rest.includes('--help') || proto === '--help' || proto === '-h') { process.stdout.write(USAGE); process.exit(0); }
  const opts = { out: 'qa/vdiff', width: 1280, sections: [], profile: 'eds', main: null, ua: REAL_CHROME_UA, waitUntil: null, dismiss: null, headed: false, locale: null };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--out') { opts.out = rest[i += 1]; }
    else if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--sections') { opts.sections = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--profile') { opts.profile = rest[i += 1]; }
    else if (a === '--main') { opts.main = rest[i += 1]; }
    else if (a === '--ua') { opts.ua = rest[i += 1]; }
    else if (a === '--wait-until') { opts.waitUntil = rest[i += 1]; }
    else if (a === '--dismiss') {
      // optional value: bare --dismiss enables overlay dismissal with no extras
      const next = rest[i + 1];
      opts.dismiss = (next && !next.startsWith('--')) ? rest[i += 1].split(',').map((s) => s.trim()).filter(Boolean) : [];
    }
    else if (a === '--headed') { opts.headed = true; }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
  }
  return { proto, eds, opts };
}

// Runs IN the page. Returns the structured metric set + intra-page red flags.
// mainSel = --main content-root override (live sites often have no <main>;
// without the override both sides false-flag BLANK RENDER while every
// main-scoped check silently no-ops — the F-B partial-adaptation trap).
/* eslint-disable no-undef */
function analyse(mainSel) {
  const vw = window.innerWidth;
  const round = (n) => Math.round(n);

  // Blank-render guard: an off-pipeline render can stay hidden (e.g. a foundation
  // body{display:none}/body.appear gate the runtime never satisfies) — the page
  // is empty but every other metric is trivially "fine", so the probe would
  // false-pass. Detect a hidden/zero-height/textless <main> explicitly.
  const mainEl = document.querySelector(mainSel || 'main');
  const bodyHidden = getComputedStyle(document.body).display === 'none';
  const mainH = mainEl ? mainEl.getBoundingClientRect().height : 0;
  const textLen = mainEl ? mainEl.innerText.trim().length : 0;
  const blankRender = bodyHidden || mainH < 5 || textLen < 20;

  const images = [...document.querySelectorAll('img')].map((img) => {
    const r = img.getBoundingClientRect();
    const nW = img.naturalWidth; const nH = img.naturalHeight;
    const natAR = nW && nH ? nW / nH : 0;
    const renAR = r.width && r.height ? r.width / r.height : 0;
    const isSvg = /\.svg(\?|$)/i.test(img.currentSrc || img.src || '');
    // rendered a box but natural 0x0 = the asset failed to load (e.g. an absolute
    // aem.page URL that 404s in the local harness) — the #36 stretch check then
    // silently short-circuits to false. Flag it instead of false-passing.
    const failedToLoad = r.width > 1 && r.height > 1 && (nW === 0 || nH === 0);
    const stretched = !isSvg && natAR && renAR && Math.abs(natAR - renAR) / natAR > 0.04;
    return {
      src: (img.currentSrc || img.src || '').split('/').pop(),
      natural: `${nW}x${nH}`,
      rendered: `${round(r.width)}x${round(r.height)}`,
      stretched,
      failedToLoad,
    };
  });

  // scope to <main> so the prototype's nav/footer chrome headings don't skew the
  // proto-vs-EDS count (chrome is fragments in EDS, outside main) — #60.
  const headings = [...(mainEl || document).querySelectorAll('h1, h2, h3')].map((h) => {
    const cs = getComputedStyle(h);
    // the first QUOTED (named) family in the stack, and whether it actually loaded
    // — a named --display face with no @font-face silently falls back (#65/#66).
    // Detect with a WIDTH PROBE, never document.fonts.check: that returns true for
    // ANY family name the page references, installed or not (#77), so it false-
    // passes. The named face "loaded" iff its glyph widths differ from a
    // guaranteed-absent name at the same size/weight.
    const named = (cs.fontFamily.match(/"([^"]+)"|'([^']+)'/) || [])[1];
    let fontLoaded = true;
    if (named) {
      const probeW = (fam) => {
        const s = document.createElement('span');
        s.style.cssText = `position:absolute;left:-9999px;visibility:hidden;white-space:nowrap;font-size:${cs.fontSize};font-weight:${cs.fontWeight};font-family:${fam}`;
        s.textContent = (h.textContent.trim().slice(0, 24) || 'Agw1996');
        document.body.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return w;
      };
      fontLoaded = probeW(`"${named}",monospace`) !== probeW('__no_such_face__,monospace');
    }
    return {
      tag: h.tagName.toLowerCase(),
      text: h.textContent.trim().slice(0, 32),
      color: cs.color,
      fontSize: cs.fontSize,
      family: named || cs.fontFamily.split(',')[0].trim(),
      fontLoaded,
    };
  });

  // small UPPERCASE labels (eyebrow-like) — catches dropped shared primitives
  const eyebrows = [...document.querySelectorAll('p, span, div')].filter((el) => {
    const cs = getComputedStyle(el);
    return cs.textTransform === 'uppercase' && parseFloat(cs.fontSize) <= 16
      && el.textContent.trim().length > 0 && el.textContent.trim().length < 60
      && el.children.length === 0;
  }).slice(0, 8).map((el) => {
    const cs = getComputedStyle(el);
    return { text: el.textContent.trim().slice(0, 24), color: cs.color };
  });

  // Dropped-max-width-wrap symptom (#37): LEFT-ANCHORED text flush to the
  // viewport edge. A block root spanning full width is fine (EDS sections do
  // that — the wrap is on an inner element); the visible bug is a heading/para
  // whose own left edge sits at ~0 with no padding. Skip centered text (a
  // centered element is legitimately full-width with left 0) and skip elements
  // that span nearly the whole width (centered/justified blocks, not left-anchored).
  const flushText = [...(mainEl || document).querySelectorAll('h1, h2, h3, p')].filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false; // skip hidden (display:none → 0 rect)
    const cs = getComputedStyle(el);
    return r.left < 12 && r.right < vw - 40 && cs.textAlign !== 'center' && el.textContent.trim().length > 0;
  }).slice(0, 8).map((el) => ({
    tag: el.tagName.toLowerCase(),
    text: el.textContent.trim().slice(0, 28),
    left: round(el.getBoundingClientRect().left),
  }));

  // Advisory: the widest text-bearing block content boxes + left offset, so the
  // agent can eyeball proto vs eds (a wrapped block sits at left≈(vw-maxw)/2+pad).
  const STRUCT = /(^|[\s-])(section|block-content|default-content|wrapper)([\s-]|$)/i;
  let boxes = [...(mainEl ? mainEl.querySelectorAll('[class]') : document.querySelectorAll('main [class]'))].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width >= vw * 0.6 && el.querySelector('h1, h2, h3, p') && !STRUCT.test((el.className || '').toString());
  });
  boxes = boxes.filter((el) => !boxes.some((o) => o !== el && el.contains(o))).slice(0, 12).map((el) => {
    const r = el.getBoundingClientRect();
    return { sel: (el.className || '').toString().trim().split(/\s+/)[0], width: round(r.width), left: round(r.left) };
  });

  return { viewport: vw, blankRender, mainHeight: round(mainH), textLen, images, headings, eyebrows, flushText, contentBoxes: boxes };
}
/* eslint-enable no-undef */

async function capture(browser, url, tag, opts) {
  // UA + standard headers on EVERY context (live-session; F-R1 — UA alone
  // still 403s on Akamai), webdriver spoof included for the --headed tier.
  const ctx = await newLiveContext(browser, {
    ua: opts.ua, locale: opts.locale,
    viewport: { width: opts.width, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  // challenge detection on every navigation — a blocked live side throws
  // BotChallengeError (exit 3), it is never measured as the source. A plain
  // HTTP error side is MEASURED (advisory contract): a 404 build is normal on
  // aem.page before preview propagation — the flags carry the signal, exit 0.
  // solveWindow only under --headed: headless clearance never lands, and the
  // solve loop would spend the Akamai block budget (1 hit vs up to 4).
  await gotoLive(page, url, { waitUntil: opts.waitUntil || defaultWaitUntil(url), timeoutMs: 60000, settleMs: 0, httpError: 'measure', solveWindow: opts.headed });
  await page.waitForTimeout(2000);
  // late-modal poll window only on live targets — local prototypes' overlays
  // are not timed third-party scripts, they render immediately.
  if (opts.dismiss) await dismissOverlays(page, { extra: opts.dismiss, lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
  // scroll through to trigger reveal-on-scroll / lazy images, then return to top
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 50); });
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${opts.out}/${tag}-full.png`, fullPage: true });
  for (const sel of opts.sections) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(200);
      const safe = sel.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
      await loc.screenshot({ path: `${opts.out}/${tag}-${safe}.png` }).catch(() => {});
    }
  }
  const metrics = await page.evaluate(analyse, opts.main);
  await ctx.close();
  return metrics;
}

function redFlags(eds, proto, prof) {
  const flags = [];
  const S = prof.source; const T = prof.target; const H = prof.hints;
  if (eds.blankRender) {
    flags.push(`BLANK RENDER: the ${T} page is hidden/empty (main height ${eds.mainHeight}px, text ${eds.textLen} chars). NOT a pass. ${H.BLANK_RENDER}`);
    return flags; // every other metric is meaningless on a blank page
  }
  // Imagery gap: the target renders far fewer images than the source — often an
  // image-less content fallback. Expected, but a broken fallback looks identical
  // to "red flags none", so force an eyeball rather than a silent pass.
  if (proto) {
    const pN = proto.images.length;
    const eN = eds.images.length;
    if (pN >= 3 && eN < Math.max(1, pN * 0.5)) {
      flags.push(`IMAGERY GAP: ${S} renders ${pN} images, ${T} renders ${eN}. ${H.IMAGERY_GAP}`);
    }
    // Content gap: the target dropped/duplicated authored content. Metrics-only
    // checks can't see a missing section or a dropped CTA; a heading/contentBox
    // count or main-height shortfall vs the source is a reliable signal.
    const hp = proto.headings.length;
    const he = eds.headings.length;
    const cp = proto.contentBoxes.length;
    const ce = eds.contentBoxes.length;
    // a source whose <main> measures ~0 (sticky/scroll-choreography artifact) makes
    // the height/box ratios meaningless — caveat #60: trust only the heading delta then.
    const protoBlankish = proto.blankRender || proto.mainHeight < 50;
    const mhRatio = !protoBlankish && proto.mainHeight && eds.mainHeight ? eds.mainHeight / proto.mainHeight : 1;
    if (hp - he >= 3 || (!protoBlankish && cp >= 4 && ce < cp * 0.6) || mhRatio < 0.6) {
      flags.push(`CONTENT GAP: ${S} ${hp} headings / ${cp} content-boxes / main ${proto.mainHeight}px vs ${T} ${he} / ${ce} / ${eds.mainHeight}px. ${H.CONTENT_GAP}`);
    }
    // Surface/ground mismatch: a matched heading rendered on the wrong ground
    // (dark band vs light band) — the probe records colors but never compared
    // them, so a full inversion printed "none".
    const lum = (c) => {
      const m = (c || '').match(/(\d+)\D+(\d+)\D+(\d+)/);
      return m ? 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3] : null;
    };
    const pByText = new Map(proto.headings.map((h) => [h.text.toLowerCase(), h.color]));
    eds.headings.forEach((h) => {
      const pc = pByText.get(h.text.toLowerCase());
      if (!pc) return;
      const lp = lum(pc);
      const le = lum(h.color);
      if (lp !== null && le !== null && Math.abs(lp - le) > 90) {
        flags.push(`SURFACE/GROUND MISMATCH: heading "${h.text}" is ${h.color} in ${T} vs ${pc} in ${S} (luminance ${Math.round(le)} vs ${Math.round(lp)}). ${H.SURFACE_GROUND}`);
      }
    });
    // Font mismatch: a named display/body face that loaded in the source but not
    // the target = a missing @font-face silently falling back to serif/sans.
    const pFont = new Map(proto.headings.map((h) => [h.text.toLowerCase(), h]));
    eds.headings.forEach((h) => {
      const p = pFont.get(h.text.toLowerCase());
      if (p && p.fontLoaded && !h.fontLoaded && h.family) {
        flags.push(`FONT MISMATCH: heading "${h.text}" wants "${h.family}" but it did NOT load in ${T} (silent fallback). ${H.FONT_MISMATCH}`);
      }
    });
  }
  eds.images.filter((i) => i.failedToLoad).forEach((i) => {
    flags.push(`IMAGE DID NOT LOAD: ${i.src} rendered ${i.rendered} but natural 0x0. ${H.IMAGE_NO_LOAD}`);
  });
  eds.images.filter((i) => i.stretched).forEach((i) => {
    flags.push(`STRETCHED IMAGE: ${i.src} natural ${i.natural} → rendered ${i.rendered}. ${H.STRETCHED}`);
  });
  eds.flushText.forEach((f) => {
    flags.push(`FLUSH-LEFT TEXT: <${f.tag}> "${f.text}" sits at left ${f.left}px (no padding). ${H.FLUSH_LEFT}`);
  });
  return flags;
}

async function main() {
  const { proto, eds, opts } = parseArgs(process.argv);
  if (!proto || !eds) {
    process.stderr.write(USAGE);
    process.exit(1);
  }
  const prof = resolveProfile(opts.profile);
  mkdirSync(resolve(opts.out), { recursive: true });
  const browser = opts.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
  let report;
  try {
    const [protoM, edsM] = [await capture(browser, proto, 'proto', opts), await capture(browser, eds, 'eds', opts)];
    report = { viewport: opts.width, out: opts.out, proto: protoM, eds: edsM, redFlags: redFlags(edsM, protoM, prof) };
  } finally {
    await browser.close();
  }

  const f = report.redFlags;
  process.stdout.write(`\nVisual diff @ ${opts.width}px (profile "${prof.name}") — screenshots in ${opts.out}/\n`);
  process.stdout.write(`\n${prof.target} red flags (advisory): ${f.length ? '' : 'none'}\n`);
  f.forEach((x) => process.stdout.write(`  • ${x}\n`));
  process.stdout.write(`\nFull metrics JSON (compare ${prof.source} vs ${prof.target}: heading colors, eyebrow colors, image dims, full-bleed):\n`);
  process.stdout.write(`${JSON.stringify({ [prof.source]: report.proto, [prof.target]: report.eds }, null, 1)}\n`);
}

// exit 3 = bot challenge on a live side (distinct from generic errors, so a
// gate runner can tell "blocked — escalate with --headed" from "probe broke").
main().catch((e) => { process.stderr.write(`visual-diff error: ${e.message}\n`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });
