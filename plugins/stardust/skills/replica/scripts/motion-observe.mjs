#!/usr/bin/env node
/**
 * skills/replica/scripts/motion-observe.mjs
 *
 * RUNTIME motion observation for the stardust:replica interaction-parity
 * pass. Records what the live page actually DOES — animation/transition
 * events, class mutations (the trigger mechanism), scroll-state chrome,
 * widget mechanics, hover diffs — so the prototype implements ONLY motion
 * that measurably fired.
 *
 * Why observation, never inference (each is a field-recorded invention the
 * static-lift method produced, all caught in user review — recreation
 * procedure § Interaction parity owns the policy):
 *   - DEAD ANIMATION CLASSES: component CMSs stamp animation classes on many
 *     elements; the runtime JS adds the trigger class (.animate etc.) to only
 *     SOME (recorded: 2 of 8 caption-class families ever fired; 3 whole page
 *     types had zero firing entrances despite fully classed markup). Tagging
 *     from static classes animates elements the real site never animates.
 *   - DEAD-SCOPE HOVER RULES: a syntactically applicable :hover rule can be
 *     dead at runtime (scope condition, specificity loser, wrong variant).
 *     Only a measured hover diff justifies a hover rule in the prototype.
 *   - APPROXIMATED MECHANISMS: reproducing chrome morph as a different
 *     mechanism with a similar look (a cloned fixed bar) allows states
 *     impossible on live (double-rendered header). The class-mutation log +
 *     header timeline expose the REAL state machine to clone.
 * Static source CSS remains the authority for exact keyframe/duration/easing
 * VALUES of the animations this instrument proves fired.
 *
 * What one run records, per live URL:
 *   1. capture-phase animationstart/transitionstart listeners + a class-
 *      attribute MutationObserver (added classes only, capped) — installed
 *      BEFORE any scrolling, so the scroll traversal exposes every
 *      scroll-triggered behavior with its trigger class and scrollY;
 *   2. a full scroll traversal DOWN then UP with dense sampling near the top
 *      (scroll-chrome behavior differs by direction and near-top state),
 *      logging the header's computed state per position plus main/body
 *      paddingTop (layout compensation vs accepted content jump);
 *   3. --click <sel> (repeatable) widget pokes: scroll into view, click,
 *      sample 4 frames at 200ms — track transform/transition + indicator
 *      (dot) classes and computed size/color/transition;
 *   4. --hover <sel> (repeatable) hover diffs: computed transform/colors/
 *      shadow on the element + key sub-elements before and after a real
 *      pointer hover, with the changed property list precomputed. The mouse
 *      is PARKED after each probe (a :hover-styled element under the resting
 *      cursor poisons any later capture).
 *
 * Budget live hits like any other probe: ONE observation run per page,
 * reuse the JSON (bot-managed sites escalate to IP blocks within a few
 * automated hits — same rule as the gate captures). Autoplay widgets may
 * pause off-viewport: poke them with --click rather than waiting for
 * autoplay events.
 *
 * Usage:
 *   node skills/replica/scripts/motion-observe.mjs <url> <out.json> [options]
 *     --width <px>        viewport width                    (default 1440)
 *     --click <sel>       widget control to poke (repeatable)
 *     --hover <sel>       element family to hover-diff (repeatable)
 *     --consent <sel>     extra consent-accept selector
 *     --dismiss <sel,...> extra overlay-dismiss selectors
 *     --headed            escalation: headed stealth real Chrome
 *     --locale <tag>      pin Accept-Language + locale (e.g. en-GB)
 *     --ua <string>       user agent                        (default real-Chrome)
 *     --wait <ms>         initial post-load wait            (default 2500)
 *     --timeout <ms>      goto timeout                      (default 60000)
 *
 * Output JSON: { url, width, headerTimeline, widgetSamples, hoverSamples,
 * events: { animations, transitions, classMutations } }.
 * Exit codes: 0 written, 1 error, 3 bot challenge (fail loud, never observed
 * as if it were the source).
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len */
/* standalone dev tool: sequential page ops use awaited loops by design */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// live-session.mjs lives in the diff skill's scripts dir. Two layouts exist:
// the plugin tree (skills/replica/scripts ↔ skills/diff/scripts) and the
// documented project copy (scripts/replica ↔ scripts/diff) — resolve either,
// so a project re-copy can't silently sever the shared hardening.
const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_SESSION = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs']
  .map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));
if (!LIVE_SESSION) {
  console.error('motion-observe error: live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup).');
  process.exit(1);
}
const { REAL_CHROME_UA, isLiveHttpUrl, launchStealthHeaded, newLiveContext, gotoLive, dismissOverlays } = await import(pathToFileURL(LIVE_SESSION).href);

const HELP = `motion-observe — runtime motion observation (implement only what fired)

Usage: node motion-observe.mjs <url> <out.json> [options]
  --width <px>      viewport width (default 1440)
  --click <sel>     widget control to poke (repeatable)
  --hover <sel>     element family to hover-diff (repeatable)
  --consent <sel>   extra consent-accept selector (clicked, not removed)
  --dismiss <sel,…> extra overlay-dismiss selectors
  --headed          headed stealth real Chrome (escalation for bot-managed sites)
  --locale <tag>    pin Accept-Language + locale (e.g. en-GB)
  --ua <string>     user agent (default: real-Chrome desktop UA + standard headers)
  --wait <ms>       initial post-load wait (default 2500)
  --timeout <ms>    goto timeout (default 60000)
  --help            this text

One observation run per live page — reuse the JSON. Exit codes: 0 written,
1 error, 3 bot challenge (fail loud).`;

function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const opts = { width: 1440, clicks: [], hovers: [], consent: null, dismiss: [], headed: false, locale: null, ua: REAL_CHROME_UA, wait: 2500, timeout: 60000 };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--width') { opts.width = Number(rest[i += 1]); }
    else if (a === '--click') { opts.clicks.push(rest[i += 1]); }
    else if (a === '--hover') { opts.hovers.push(rest[i += 1]); }
    else if (a === '--consent') { opts.consent = rest[i += 1]; }
    else if (a === '--dismiss') { opts.dismiss = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--headed') { opts.headed = true; }
    else if (a === '--locale') { opts.locale = rest[i += 1]; }
    else if (a === '--ua') { opts.ua = rest[i += 1]; }
    else if (a === '--wait') { opts.wait = Number(rest[i += 1]); }
    else if (a === '--timeout') { opts.timeout = Number(rest[i += 1]); }
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else pos.push(a);
  }
  const [url, out] = pos;
  if (!url || !out) { console.error(`need <url> and <out.json>\n\n${HELP}`); process.exit(1); }
  return { url, out, opts };
}

async function main() {
  const { url, out, opts } = parseArgs(process.argv);
  const VH = 900;
  const browser = opts.headed ? await launchStealthHeaded(chromium) : await chromium.launch();
  try {
    const ctx = await newLiveContext(browser, {
      ua: opts.ua, locale: opts.locale,
      viewport: { width: opts.width, height: VH },
    });
    const page = await ctx.newPage();
    // Challenge/blocked interstitial → loud BotChallengeError (exit 3); a
    // challenge page's "motion" must never be recorded as the source's.
    await gotoLive(page, url, { waitUntil: 'domcontentloaded', timeoutMs: opts.timeout, settleMs: 0, solveWindow: opts.headed });
    await page.waitForTimeout(opts.wait);
    // Dismiss BEFORE instrumenting: the dismissal's own class churn must not
    // pollute the mutation log, and an overlay intercepts hover/click probes.
    // dismissOverlays parks the mouse afterwards.
    const extra = [...(opts.consent ? [opts.consent] : []), ...opts.dismiss];
    const d = await dismissOverlays(page, { extra, lateWindowMs: isLiveHttpUrl(url) ? 6000 : 0 });
    if (d.consent) console.error(`consent dismissed via ${d.consent}`);

    // ---- instrument BEFORE any scrolling, so the traversal exposes every
    // scroll-triggered behavior with its trigger class and scrollY ----
    await page.evaluate(() => {
      // elementPath: 5 ancestors with up to 3 classes each, stopping at a
      // data-tpl component marker — enough to map an event to its module.
      // The text snippet is the cross-DOM key: prototype classes are clean
      // re-authored names, so class-based mapping cannot work.
      const path = (el) => {
        const bits = [];
        for (let e = el; e && e.nodeType === 1 && bits.length < 5; e = e.parentElement) {
          let b = e.tagName.toLowerCase();
          const cls = (e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className) || '';
          if (cls) b += `.${String(cls).trim().split(/\s+/).slice(0, 3).join('.')}`;
          bits.unshift(b);
          if (e.dataset && e.dataset.tpl) { bits[0] += `[data-tpl=${e.dataset.tpl}]`; break; }
        }
        return bits.join(' > ');
      };
      window.__motion = { animations: [], transitions: [], classMutations: [] };
      document.addEventListener('animationstart', (ev) => {
        window.__motion.animations.push({
          name: ev.animationName,
          el: path(ev.target),
          txt: (ev.target.textContent || '').trim().slice(0, 50),
          y: window.pageYOffset,
        });
      }, true);
      document.addEventListener('transitionstart', (ev) => {
        if (window.__motion.transitions.length > 400) return;
        window.__motion.transitions.push({
          prop: ev.propertyName,
          el: path(ev.target),
          y: window.pageYOffset,
          dur: getComputedStyle(ev.target).transitionDuration,
        });
      }, true);
      // Added classes only: this is what exposes the trigger mechanism
      // (.animate, slick-current, has-scrolled-up/down) and its thresholds.
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
          const oldC = new Set(String(m.oldValue || '').split(/\s+/));
          const newC = String((m.target.className && m.target.className.baseVal !== undefined
            ? m.target.className.baseVal : m.target.className) || '').split(/\s+/);
          const added = newC.filter((c) => c && !oldC.has(c));
          if (!added.length) continue;
          if (window.__motion.classMutations.length > 600) return;
          window.__motion.classMutations.push({ added, el: path(m.target), y: window.pageYOffset });
        }
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
    });

    // ---- header state sampler: the chrome state machine is only visible as
    // computed state per scroll position + direction. headerCount catches the
    // double-render class of defect (live morphs ONE header in place; a
    // recreation that clones a second bar can render both at once — a state
    // impossible on live). mainPadTop/bodyPadTop distinguish layout
    // compensation from an accepted content jump.
    const headerState = () => page.evaluate(() => {
      const h = document.querySelector('.header-container, header');
      if (!h) return null;
      const cs = getComputedStyle(h);
      const main = document.querySelector('main, #main-content, body > .content');
      return {
        y: window.pageYOffset,
        cls: String(h.className).trim(),
        position: cs.position, height: cs.height, transform: cs.transform,
        transition: cs.transition,
        mainPadTop: main ? getComputedStyle(main).paddingTop : null,
        bodyPadTop: getComputedStyle(document.body).paddingTop,
        headerCount: document.querySelectorAll('header, .header-container').length,
      };
    });

    const headerTimeline = [];
    headerTimeline.push(await headerState());

    // Scroll DOWN to the bottom in steps (fires scroll-triggered entrances the
    // way a real visit does), then back UP with dense sampling near the top —
    // scroll-chrome behavior differs by direction and near-top state (the
    // full-header restore threshold is often exactly y=0).
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < docH - VH; y += 400) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(180);
      if (y % 1200 === 0) headerTimeline.push(await headerState());
    }
    await page.waitForTimeout(400);
    for (const y of [docH - 2000, docH - 3500, 2400, 1200, 800, 500, 300, 200, 150, 120, 90, 60, 30, 0]) {
      if (y < 0) continue;
      await page.evaluate((yy) => window.scrollTo(0, yy), Math.max(0, y));
      await page.waitForTimeout(180);
      headerTimeline.push(await headerState());
    }

    // ---- widget pokes: click each control, sample its neighborhood over
    // time. 4 frames at 200ms bracket a typical slide transition — enough to
    // read fade-vs-translate, duration, and indicator mechanics (slick
    // magic-dots animate left/transform on the li). Sampling covers the slick
    // conventions plus the clicked control's own widget container.
    const widgetSamples = [];
    for (const sel of opts.clicks) {
      const found = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        return true;
      }, sel);
      if (!found) { widgetSamples.push({ sel, error: 'not found' }); continue; }
      await page.waitForTimeout(800);
      await page.evaluate((s) => document.querySelector(s).click(), sel);
      const frames = [];
      for (let t = 0; t < 4; t += 1) {
        frames.push(await page.evaluate((s) => {
          const el = document.querySelector(s);
          const box = el && el.closest('[class*="slick"],[class*="swiper"],[class*="carousel"],[class*="slider"],section');
          const track = (box || document).querySelector('.slick-track, .swiper-wrapper');
          const trackCs = track ? getComputedStyle(track) : null;
          const boxCs = box ? getComputedStyle(box) : null;
          const dots = [...(box || document).querySelectorAll('.slick-dots li')].slice(0, 8).map((li) => {
            const b = li.querySelector('button');
            const cs = b ? getComputedStyle(b) : null;
            return { cls: li.className, w: cs && cs.width, h: cs && cs.height, bg: cs && cs.backgroundColor, transition: cs && cs.transition };
          });
          return {
            t: performance.now(),
            trackTransform: trackCs && trackCs.transform,
            trackTransition: trackCs && trackCs.transition,
            boxScrollLeft: box ? box.scrollLeft : null,
            boxTransform: boxCs && boxCs.transform,
            dots,
          };
        }, sel));
        await page.waitForTimeout(200);
      }
      widgetSamples.push({ sel, frames });
    }

    // ---- hover diffs: only a measured change justifies a hover rule in the
    // prototype (:hover rules lifted from CSS are routinely dead at runtime).
    // Real pointer hover via mouse.move; the changed-property list is
    // precomputed so the operator reads a verdict, not two style dumps.
    const hoverSamples = [];
    const readHoverState = (sel) => page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const read = (e) => {
        const cs = getComputedStyle(e);
        return { transform: cs.transform, color: cs.color, background: cs.backgroundColor, boxShadow: cs.boxShadow, opacity: cs.opacity, transition: cs.transition };
      };
      const subs = [...el.querySelectorAll('img, h1, h2, h3, h4, a, [class*="icon"], [class*="arrow"]')].slice(0, 5);
      return {
        self: read(el),
        subs: subs.map((x) => ({ el: `${x.tagName.toLowerCase()}.${String(x.className).trim().split(/\s+/).slice(0, 2).join('.')}`, ...read(x) })),
      };
    }, sel);
    for (const sel of opts.hovers) {
      const found = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        return true;
      }, sel);
      if (!found) { hoverSamples.push({ sel, error: 'not found' }); continue; }
      await page.waitForTimeout(400);
      const before = await readHoverState(sel);
      const box = await page.locator(sel).first().boundingBox();
      if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(300);
      const after = await readHoverState(sel);
      // park the pointer between probes — a :hover-styled element under the
      // resting cursor poisons the next probe and any later capture.
      await page.mouse.move(10, VH - 10);
      const changed = [];
      if (before && after) {
        for (const k of Object.keys(before.self)) { if (before.self[k] !== after.self[k]) changed.push(`self.${k}`); }
        before.subs.forEach((sub, i) => {
          const aSub = after.subs[i];
          if (!aSub) return;
          for (const k of Object.keys(sub)) { if (k !== 'el' && sub[k] !== aSub[k]) changed.push(`${sub.el}.${k}`); }
        });
      }
      hoverSamples.push({ sel, changed, before, after });
    }

    const events = await page.evaluate(() => window.__motion);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ url, width: opts.width, headerTimeline, widgetSamples, hoverSamples, events }, null, 2));
    console.error(`motion-observe ${out}: ${events.animations.length} animations, ${events.transitions.length} transitions, ${events.classMutations.length} class mutations, ${widgetSamples.length} widget pokes, ${hoverSamples.length} hover probes`);
  } finally {
    await browser.close();
  }
}

// exit 3 = bot challenge on the live side (distinct from generic errors, so a
// runner can tell "blocked — escalate with --headed" from "probe broke").
main().catch((e) => { console.error(`motion-observe error: ${e.message}`); process.exit(e.name === 'BotChallengeError' ? 3 : 1); });
