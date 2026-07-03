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
 *         generic cookie-banner ids/classes) — overlay chrome, not content.
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
    what: 'remove cookie/consent chrome (OneTrust, Cookiebot, Usercentrics, generic cookie-banner ids/classes)',
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
    console.log('As a module: import { DEFAULT_NORMALIZE, DEFAULT_LEDGER, loadNormalize, IMG_VISIBLE } from it.');
    console.log('Page ledgers: export NORMALIZE (string) and LEDGER; pass via --normalize to');
    console.log('capture-content.mjs and dom-equality.mjs — the SAME file to both.');
    process.exit(0);
  }
  console.log('# Default ledger entries');
  for (const e of DEFAULT_LEDGER) console.log(`- ${e.id}: ${e.what}\n    why: ${e.why}`);
  console.log('\n# Default NORMALIZE script\n');
  console.log(DEFAULT_NORMALIZE);
}
