#!/usr/bin/env node
/**
 * skills/reskin/scripts/source-normalize.mjs
 *
 * The shared, EXECUTABLE normalization ledger applied to the SOURCE page
 * before any text/image capture or comparison. The exact same script string
 * runs at capture time (capture-content.mjs) and at gate time
 * (dom-equality.mjs) so the gate measures precisely the normalization the
 * capture declared — the ledger is code, not prose.
 *
 * Default entries (generic, safe on most pages):
 *   N-D1  cookie/consent chrome removal (OneTrust, Cookiebot, Usercentrics,
 *         generic cookie-banner ids/classes, cookie/consent/gdpr-named overlay
 *         elements) — overlay chrome, not content.
 *   N-D2  de-carousel (slick / swiper / splide / glide): remove CLONE slides
 *         (they duplicate text), force real slides visible + static (hidden
 *         slides are absent from innerText), drop pager dots and arrows
 *         (carousel UI chrome, not content). Rotating carousels break byte
 *         determinism without this; the reskin side renders all slides as a
 *         static stack in DOM order, so both sides compare deterministically.
 *
 * Page-specific ledgers EXTEND the default. A ledger is an ES module:
 *
 *   // stardust/reskin/normalize/<slug>.mjs
 *   import { DEFAULT_NORMALIZE, DEFAULT_LEDGER } from '<path-to>/source-normalize.mjs';
 *   export const LEDGER = [
 *     ...DEFAULT_LEDGER,
 *     { id: 'N1', what: 'remove #newsletter-popup', why: 'timed overlay, not page content' },
 *   ];
 *   export const NORMALIZE = `${DEFAULT_NORMALIZE};(() => {
 *     // N1 — timed newsletter overlay
 *     document.querySelector('#newsletter-popup')?.remove();
 *   })()`;
 *
 * Every capture/gate invocation passes the SAME ledger file via
 * --normalize <ledger.mjs>. Contract details:
 * skills/reskin/reference/content-model.md § Normalization ledger.
 *
 * Run directly to print the default ledger:  node source-normalize.mjs
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const DEFAULT_LEDGER = [
  {
    id: 'N-D1',
    what: 'remove cookie/consent chrome (OneTrust, Cookiebot, Usercentrics, generic cookie-banner ids/classes, any cookie/consent/gdpr-named element inside a fixed/sticky/high-z overlay)',
    why: 'overlay chrome injected by a CMP, not page content; re-added at deploy time',
  },
  {
    id: 'N-D2',
    what: 'de-carousel slick/swiper/splide/glide: remove clone slides, force real slides visible+static, drop dots/arrows',
    why: 'hidden slides are absent from innerText and clones duplicate it — rotating carousels break byte determinism; the reskin renders all slides statically in DOM order',
  },
];

export const DEFAULT_NORMALIZE = `(() => {
  // N-D1 — cookie/consent chrome
  document.querySelector('#onetrust-consent-sdk')?.remove();
  document.querySelector('#CybotCookiebotDialog')?.remove();
  document.querySelector('#usercentrics-root')?.remove();
  document.querySelectorAll('[id*="cookie" i][id*="banner" i],[id*="cookie" i][id*="consent" i],[class*="cookie-banner" i],[class*="cookie-consent" i],[aria-label*="cookie" i][role="dialog"]')
    .forEach((e) => e.remove());
  // Overlay heuristic (field finding, M3 spike: a CMP panel id'd like '#CookieReportsPanel'
  // slipped every name pattern above): an element whose id/class names cookie/consent/gdpr
  // AND that sits in a fixed/sticky or high-z overlay is chrome. The overlay guard keeps an
  // in-content "cookie policy" section from being pruned.
  {
    const NAME = /cookie|consent|gdpr/i;
    const overlay = (el) => {
      for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.position === 'fixed' || cs.position === 'sticky') return true;
        if (cs.position !== 'static' && +cs.zIndex >= 100) return true;
      }
      return false;
    };
    for (const el of [...document.querySelectorAll('[id], [class]')]) {
      if (!el.isConnected || el.closest('main article')) continue;
      const name = (el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '');
      if (NAME.test(name) && overlay(el)) el.remove();
    }
  }
  // N-D2 — de-carousel
  document.querySelectorAll('.slick-cloned, .swiper-slide-duplicate, .splide__slide--clone, .glide__slide--clone')
    .forEach((e) => e.remove());
  document.querySelectorAll('.slick-track, .swiper-wrapper, .splide__list, .glide__slides').forEach((t) => {
    t.style.transform = 'none'; t.style.width = 'auto';
  });
  document.querySelectorAll('.slick-slide, .swiper-slide, .splide__slide, .glide__slide').forEach((s) => {
    s.style.display = 'block'; s.style.width = 'auto';
    s.removeAttribute('aria-hidden');
    s.style.position = 'static'; s.style.opacity = '1'; s.style.visibility = 'visible';
  });
  document.querySelectorAll('.slick-dots, .slick-arrow, .swiper-pagination, .swiper-button-prev, .swiper-button-next, .splide__pagination, .splide__arrows, .glide__bullets, .glide__arrows')
    .forEach((e) => e.remove());
})()`;

/**
 * Shared image-visibility predicate — the SINGLE definition used by both
 * capture-content.mjs (model images) and dom-equality.mjs (gate images), so
 * capture and gate can never drift on which images count as content
 * (reference/gates.md § dom-equality). It is a function-source string
 * because it runs inside page.evaluate() on both ends.
 *
 * Semantics:
 *   - hidden by style (display:none / visibility:hidden on the img) → out,
 *     lazy or not — a styled-away image is not visible content;
 *   - rendered at more than 1×1 px → in (1px tracking pixels are not content);
 *   - loading="lazy" and still zero-size (not yet intersected despite the
 *     scroll pass) → in — below-fold lazy images are content.
 */
export const IMG_VISIBLE = `((img) => {
  const st = getComputedStyle(img);
  if (st.display === 'none' || st.visibility === 'hidden') return false;
  const r = img.getBoundingClientRect();
  if (r.width > 1 && r.height > 1) return true;
  return img.loading === 'lazy';
})`;

/**
 * The fraction (0–1) of an image's own pixels that its box shows: the crop measure dom-equality.mjs compares
 * between source and rendered (reference/gates.md § Image crop). object-fit `cover` scales the image to fill the
 * box and trims the overflow; `none` draws it at natural size; `fill`, `contain` and `scale-down` draw every pixel.
 * clipFraction is the share of the box left visible by clipping ancestors (overflow other than visible). null when
 * a size is unknown (a lazy image that never loaded): unmeasured, never a failure.
 */
export function visibleFraction({ naturalWidth, naturalHeight, boxWidth, boxHeight, fit = 'fill', clipFraction = 1 }) {
  if (!(naturalWidth > 0 && naturalHeight > 0 && boxWidth > 0 && boxHeight > 0)) return null;
  let shown = 1;
  if (fit === 'cover') {
    const scale = Math.max(boxWidth / naturalWidth, boxHeight / naturalHeight);
    shown = (boxWidth * boxHeight) / (naturalWidth * naturalHeight * scale * scale);
  } else if (fit === 'none') {
    shown = (Math.min(boxWidth, naturalWidth) * Math.min(boxHeight, naturalHeight)) / (naturalWidth * naturalHeight);
  }
  return Math.max(0, Math.min(1, shown * clipFraction));
}

/**
 * IMG_CROP — runs inside page.evaluate(): an img → { fraction, fit, box, natural }. The box is the img's content box;
 * each ancestor whose overflow is not visible clips it on that axis (a fixed-height wrapper with overflow hidden
 * crops exactly like object-fit: cover).
 */
export const IMG_CROP = `((img) => {
  const visibleFraction = ${visibleFraction.toString()};
  const st = getComputedStyle(img);
  const r = img.getBoundingClientRect();
  const boxWidth = img.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
  const boxHeight = img.clientHeight - parseFloat(st.paddingTop) - parseFloat(st.paddingBottom);
  let [l, t, rr, b] = [r.left, r.top, r.right, r.bottom];
  for (let a = img.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const ar = a.getBoundingClientRect();
    const al = ar.left + a.clientLeft; const at = ar.top + a.clientTop;
    if (s.overflowX !== 'visible') { l = Math.max(l, al); rr = Math.min(rr, al + a.clientWidth); }
    if (s.overflowY !== 'visible') { t = Math.max(t, at); b = Math.min(b, at + a.clientHeight); }
  }
  const area = r.width * r.height;
  const clipFraction = area > 0 ? Math.max(0, rr - l) * Math.max(0, b - t) / area : 1;
  return {
    fraction: visibleFraction({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, boxWidth, boxHeight, fit: st.objectFit, clipFraction }),
    fit: st.objectFit,
    box: Math.round(boxWidth) + 'x' + Math.round(boxHeight),
    natural: img.naturalWidth + 'x' + img.naturalHeight,
  };
})`;

/**
 * compareCrops — the gate's crop check: image i of the rendered page must show at least the source's visible
 * fraction minus tolerance (0–1). Pairs by order, so it only runs when both sides list the same number of images
 * (a count difference already fails the image check). Returns { pass, measured, unmeasured, worse[], skipped? }.
 */
export function compareCrops(source, rendered, { tolerance = 0.1 } = {}) {
  if (source.length !== rendered.length) return { pass: true, measured: 0, unmeasured: source.length, worse: [], skipped: 'image counts differ' };
  const worse = []; let measured = 0; let unmeasured = 0;
  source.forEach((s, i) => {
    const r = rendered[i];
    if (s.fraction == null || r.fraction == null) { unmeasured += 1; return; }
    measured += 1;
    if (r.fraction < s.fraction - tolerance) worse.push({ index: i, label: r.label || s.label || `image ${i + 1}`, source: s, rendered: r });
  });
  return { pass: worse.length === 0, measured, unmeasured, worse };
}

/**
 * Resolve the normalization to use: a page ledger module (--normalize path)
 * or the default. Returns { script, ledger, source }.
 * A ledger module MUST export NORMALIZE (string); LEDGER ([{id,what,why}])
 * is strongly recommended — it feeds the mapping brief's deltas section.
 */
export async function loadNormalize(ledgerPath) {
  if (!ledgerPath) return { script: DEFAULT_NORMALIZE, ledger: DEFAULT_LEDGER, source: 'default' };
  const mod = await import(pathToFileURL(resolve(ledgerPath)).href);
  if (typeof mod.NORMALIZE !== 'string') {
    throw new Error(`normalize ledger ${ledgerPath} does not export a NORMALIZE string`);
  }
  return { script: mod.NORMALIZE, ledger: mod.LEDGER ?? null, source: resolve(ledgerPath) };
}

// Direct invocation: print the default ledger (handy for authoring page ledgers).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = process.argv[2];
  if (arg === '--help' || arg === '-h') {
    console.log('source-normalize.mjs — shared executable normalization ledger (reskin).');
    console.log('Usage: node source-normalize.mjs        # print default ledger entries + script');
    console.log('As a module: import { DEFAULT_NORMALIZE, DEFAULT_LEDGER, loadNormalize, IMG_VISIBLE, IMG_CROP, visibleFraction, compareCrops } from it.');
    console.log('Page ledgers: export NORMALIZE (string) and LEDGER; pass via --normalize to');
    console.log('capture-content.mjs and dom-equality.mjs — the SAME file to both.');
    process.exit(0);
  }
  console.log('# Default ledger entries');
  for (const e of DEFAULT_LEDGER) console.log(`- ${e.id}: ${e.what}\n    why: ${e.why}`);
  console.log('\n# Default NORMALIZE script\n');
  console.log(DEFAULT_NORMALIZE);
}
