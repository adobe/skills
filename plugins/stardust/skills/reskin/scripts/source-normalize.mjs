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
 * The region of an image (normalized image coordinates [x0, y0, x1, y1], 0–1) that its box shows: the area measure
 * dom-equality.mjs compares between source and rendered (reference/gates.md § Image crop). object-fit sets the drawn
 * size (cover scales to fill, contain / scale-down to fit, none draws at natural size, fill stretches to the box);
 * object-position places it ({ v, px }: a percentage of the free space, or pixels); clip is the part of the box
 * clipping ancestors leave ([l, t, r, b] in box pixels, default the whole box). null when a size is unknown.
 */
export function visibleRegion({ naturalWidth: nw, naturalHeight: nh, boxWidth: bw, boxHeight: bh, fit = 'fill', position = [{ v: 50 }, { v: 50 }], clip = null }) {
  if (!(nw > 0 && nh > 0 && bw > 0 && bh > 0)) return null;
  let dw = bw; let dh = bh;
  if (fit !== 'fill') {
    const fitScale = Math.min(bw / nw, bh / nh);
    const s = fit === 'cover' ? Math.max(bw / nw, bh / nh) : fit === 'none' ? 1 : fit === 'scale-down' ? Math.min(1, fitScale) : fitScale;
    dw = nw * s; dh = nh * s;
  }
  const off = (p, free) => (p && p.px ? p.v : free * ((p ? p.v : 50) / 100));
  const ox = off(position[0], bw - dw); const oy = off(position[1], bh - dh);
  const [cl, ct, cr, cb] = clip || [0, 0, bw, bh];
  const c01 = (x) => Math.max(0, Math.min(1, x));
  return [c01((Math.max(0, cl) - ox) / dw), c01((Math.max(0, ct) - oy) / dh), c01((Math.min(bw, cr) - ox) / dw), c01((Math.min(bh, cb) - oy) / dh)];
}

/**
 * IMG_CROP — runs inside page.evaluate(): an img → { region, fraction, fit, position, box, natural }. The box is the
 * img's content box; each ancestor whose overflow is not visible clips it on that axis (a fixed-height wrapper with
 * overflow hidden crops exactly like object-fit: cover). fraction (how much of the image shows) is informational.
 */
export const IMG_CROP = `((img) => {
  const visibleFraction = ${visibleFraction.toString()};
  const visibleRegion = ${visibleRegion.toString()};
  const st = getComputedStyle(img);
  const r = img.getBoundingClientRect();
  const padL = parseFloat(st.paddingLeft); const padT = parseFloat(st.paddingTop);
  const boxWidth = img.clientWidth - padL - parseFloat(st.paddingRight);
  const boxHeight = img.clientHeight - padT - parseFloat(st.paddingBottom);
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
  const x0 = r.left + img.clientLeft + padL; const y0 = r.top + img.clientTop + padT;
  const pos = (st.objectPosition || '50% 50%').split(/\s+/).slice(0, 2).map((p) => (/px$/.test(p) ? { v: parseFloat(p), px: true } : { v: /%$/.test(p) ? parseFloat(p) : 50 }));
  const dims = { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, boxWidth, boxHeight, fit: st.objectFit };
  return {
    region: visibleRegion({ ...dims, position: pos, clip: [l - x0, t - y0, rr - x0, b - y0] }),
    fraction: visibleFraction({ ...dims, clipFraction }),
    fit: st.objectFit,
    position: st.objectPosition,
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

const yPos = (p) => { const v = String(p || '').split(/\s+/)[1]; return v && /%$/.test(v) ? parseFloat(v) : 50; };
/**
 * compareRegions — the gate's crop check: image i of the rendered page must show the area the source shows of it.
 * Per axis, a rendered window no larger than the source's must lie inside it, and a larger one must contain it (a
 * wider donor frame necessarily shows more width; no position can help). Fails (a) when the worse axis matches under
 * 1 − tolerance (the render shows a part the source cut away: a centred crop of a post the source frames at its upper
 * third), and (b) when the source anchors the image off-centre vertically (object-position y ≠ 50%), the render crops
 * it top and bottom, and the render's y is more than 15 points from the source's (the designer's anchor, kept even
 * where the source's own box shows the whole image). How much shows is not held (fraction stays informational). Each
 * failure carries the object-position that fixes it. Pairs by order, and only images of the same shape (natural
 * ratios within 2%): a live feed that re-orders between capture and gate leaves the pair unpaired, its area not
 * judged — only the anchor (b), which belongs to the source's component, not to the photo.
 * Skipped when the counts differ (the image-set check already fails).
 */
export function compareRegions(source, rendered, { tolerance = 0.1 } = {}) {
  if (source.length !== rendered.length) return { pass: true, measured: 0, unmeasured: source.length, unpaired: 0, wrong: [], skipped: 'image counts differ' };
  const ratio = (n) => { const [w, h] = String(n || '').split('x').map(Number); return w > 0 && h > 0 ? w / h : null; };
  const axis = (a0, a1, b0, b1) => { const sw = a1 - a0; const rw = b1 - b0; const ov = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)); return rw <= sw + 1e-9 ? (rw > 0 ? ov / rw : 1) : (sw > 0 ? ov / sw : 1); };
  // the object-position that puts the rendered window (its size unchanged) on the source's area: centred on it, inside it when smaller
  const place = (a0, a1, b0, b1) => { const w = b1 - b0; const c = (a0 + a1) / 2; let t = w >= a1 - a0 ? c - w / 2 : Math.min(Math.max(c - w / 2, a0), a1 - w); t = Math.min(Math.max(t, 0), 1 - w); return 1 - w > 1e-6 ? Math.round((t / (1 - w)) * 100) : 50; };
  const wrong = []; let measured = 0; let unmeasured = 0; let unpaired = 0;
  source.forEach((s, i) => {
    const r = rendered[i];
    if (!s.region || !r.region) { unmeasured += 1; return; }
    const [sx0, sy0, sx1, sy1] = s.region; const [rx0, ry0, rx1, ry1] = r.region;
    const srcY = s.fit === 'cover' ? yPos(s.position) : 50; const rCropsV = ry1 - ry0 < 0.999;
    const anchorOff = Math.abs(srcY - 50) > 1e-6 && rCropsV && Math.abs(yPos(r.position) - srcY) > 15;
    const rs = ratio(s.natural); const rr = ratio(r.natural);
    if (rs && rr && Math.abs(rs / rr - 1) > 0.02) {
      // another image at this position (a re-ordered live feed): the area cannot be compared, the component's anchor can
      unpaired += 1;
      if (anchorOff) wrong.push({ index: i, label: r.label || s.label || `image ${i + 1}`, inside: null, anchorOff, unpaired: true, fix: `50% ${srcY}%`, source: s, rendered: r });
      return;
    }
    measured += 1;
    const inside = Math.min(axis(sx0, sx1, rx0, rx1), axis(sy0, sy1, ry0, ry1));
    if (inside < 1 - tolerance || anchorOff) {
      const fix = anchorOff && inside >= 1 - tolerance ? `${place(sx0, sx1, rx0, rx1)}% ${srcY}%` : `${place(sx0, sx1, rx0, rx1)}% ${place(sy0, sy1, ry0, ry1)}%`;
      wrong.push({ index: i, label: r.label || s.label || `image ${i + 1}`, inside, anchorOff, fix, source: s, rendered: r });
    }
  });
  return { pass: wrong.length === 0, measured, unmeasured, unpaired, wrong };
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
    console.log('As a module: import { DEFAULT_NORMALIZE, DEFAULT_LEDGER, loadNormalize, IMG_VISIBLE, IMG_CROP, visibleFraction, visibleRegion, compareCrops, compareRegions } from it.');
    console.log('Page ledgers: export NORMALIZE (string) and LEDGER; pass via --normalize to');
    console.log('capture-content.mjs and dom-equality.mjs — the SAME file to both.');
    process.exit(0);
  }
  console.log('# Default ledger entries');
  for (const e of DEFAULT_LEDGER) console.log(`- ${e.id}: ${e.what}\n    why: ${e.why}`);
  console.log('\n# Default NORMALIZE script\n');
  console.log(DEFAULT_NORMALIZE);
}
