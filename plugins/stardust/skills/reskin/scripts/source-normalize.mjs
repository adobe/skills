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
    const srcY = s.fit === 'cover' ? yPos(s.position) : 50;
    // the render crops it top and bottom through object-fit (a 1px clip by a rounded container is not a crop; fill shows it all)
    const rCropsV = (r.fit === 'cover' || r.fit === 'none') && ry1 - ry0 < 0.98;
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

/* global document, window, location, getComputedStyle, fetch, DOMParser, AbortController, setTimeout, clearTimeout */
/**
 * MEASUREMENT NORMALISATION (reference/gates.md § dom-equality): content a page keeps behind a behaviour — a closed
 * <details>, a <dialog> not open, an aria-expanded="false" trigger's hidden aria-controls panel, and on the RENDERED
 * side an EDS fragment or modal (a same-origin link whose path holds /fragments/ or /modals/, loaded from
 * <path>.plain.html at runtime) or EDS content loaded outside main and the header/footer (a sticky tray) — is
 * revealed for the measurement only, wrapped in MARKS, and counted as OPTIONAL: it counts where the other side has
 * the same text (or image) at that position, and drops out of both sides where it does not (alignOptional). Text a
 * page shows stays required, so content one side shows and the other lacks still fails.
 *
 * measurePrep runs inside page.evaluate (self-contained): it reveals, splices and marks, keeps an undo list on
 * window, and returns what it did. measureRestore undoes it all. Each fragment/modal is fetched once (by path); a
 * resolved fragment whose text the scope already shows is not spliced again (deduped).
 */
export const MARKS = ['\uFDD0', '\uFDD1'];
export async function measurePrep({ scopes: scopeList, resolve = false, timeoutMs = 10000 }) {
  const [OPEN, CLOSE] = ['\uFDD0', '\uFDD1'];
  const undo = []; window.__stardustMeasureUndo = undo;
  const stats = { details: 0, dialogs: 0, panels: 0, fragments: [], modals: [], outside: 0, deduped: [], failed: [] };
  const scopes = scopeList.split(',').map((s) => document.querySelector(s.trim().replace(/!$/, ''))).filter(Boolean);
  if (!scopes.length) return stats;
  const norm = (t) => (t || '').replace(/[\uFDD0\uFDD1]/g, '').replace(/\s+/g, ' ').trim();
  const inScope = (el) => scopes.some((s) => s.contains(el));
  const all = (sel) => scopes.flatMap((s) => [...s.querySelectorAll(sel)]);
  let gid = 0;
  // an optional region: a mark pair inside root (after `after`, e.g. a <summary>), and its group id for images
  const mark = (root, after = null) => {
    const mk = (c) => { const s = document.createElement('span'); s.setAttribute('data-stardust-mark', ''); s.style.setProperty('display', 'inline', 'important'); s.textContent = c; return s; };
    const a = mk(OPEN); const b = mk(CLOSE);
    if (after) after.after(a); else root.prepend(a);
    root.append(b);
    gid += 1; root.setAttribute('data-stardust-opt', String(gid));
    undo.push(() => { a.remove(); b.remove(); root.removeAttribute('data-stardust-opt'); });
  };
  // a page's own toggle handlers (an exclusive accordion closing its siblings) must not undo the reveal
  const stop = (e) => e.stopImmediatePropagation();
  for (const t of ['toggle', 'beforetoggle']) { window.addEventListener(t, stop, true); undo.push(() => window.removeEventListener(t, stop, true)); }
  for (const d of all('details:not([open])')) {
    const name = d.getAttribute('name');
    if (name !== null) { d.removeAttribute('name'); undo.push(() => d.setAttribute('name', name)); }
    mark(d, d.querySelector(':scope > summary'));
    d.open = true; stats.details += 1;
    undo.push(() => { d.open = false; });
  }
  for (const dl of all('dialog:not([open])')) {
    mark(dl); dl.setAttribute('open', ''); stats.dialogs += 1;
    undo.push(() => dl.removeAttribute('open'));
  }
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  for (const t of all('[aria-expanded="false"][aria-controls]')) {
    for (const id of t.getAttribute('aria-controls').split(/\s+/).filter(Boolean)) {
      const p = document.getElementById(id);
      if (!p || !inScope(p) || p.hasAttribute('data-stardust-opt') || shown(p)) continue;
      const before = { hidden: p.getAttribute('hidden'), style: p.getAttribute('style') };
      const put = () => {
        if (before.hidden !== null) p.setAttribute('hidden', before.hidden);
        if (before.style === null) p.removeAttribute('style'); else p.setAttribute('style', before.style);
      };
      p.removeAttribute('hidden');
      if (getComputedStyle(p).display === 'none') p.style.setProperty('display', 'block', 'important');
      if (getComputedStyle(p).visibility === 'hidden') p.style.setProperty('visibility', 'visible', 'important');
      if (!shown(p)) { put(); continue; } // an ancestor hides it: not a collapsed panel of this scope
      mark(p); stats.panels += 1; undo.push(put);
    }
  }
  if (resolve) {
    const baseline = norm(scopes.map((s) => s.innerText).join(' '));
    const seen = [];
    const refOf = (href) => {
      try {
        const u = new URL(href, location.href);
        if (u.origin !== location.origin || !/^https?:$/.test(u.protocol)) return null;
        const kind = /\/fragments\//.test(u.pathname) ? 'fragment' : /\/modals\//.test(u.pathname) ? 'modal' : null;
        return kind && { kind, path: u.pathname.replace(/(\.plain)?\.html$/, '') };
      } catch { return null; }
    };
    // EDS fragment.js: strip (.plain).html, fetch <path>.plain.html, reset ./media_ to the fragment's base
    const fetchPlain = async (path) => {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const r = await fetch(`${path.endsWith('/') ? `${path}index` : path}.plain.html`, { signal: ctl.signal });
        return r.ok ? await r.text() : null;
      } catch { return null; } finally { clearTimeout(t); }
    };
    // fetched markup is data: parsed inert, scripts / handlers / metadata blocks dropped
    const splice = (html, kind, path) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script, style, .metadata, .section-metadata').forEach((e) => e.remove());
      doc.querySelectorAll('*').forEach((e) => [...e.attributes].forEach((a) => { if (/^on/i.test(a.name)) e.removeAttribute(a.name); }));
      const base = new URL(path, location.href);
      doc.querySelectorAll('img[src^="./media_"]').forEach((i) => i.setAttribute('src', new URL(i.getAttribute('src'), base).href));
      doc.querySelectorAll('source[srcset^="./media_"]').forEach((s) => s.setAttribute('srcset', new URL(s.getAttribute('srcset'), base).href));
      const c = document.createElement('div'); c.setAttribute('data-stardust-splice', kind);
      c.append(...doc.body.childNodes);
      return c;
    };
    // finer groups inside a spliced region: tray chrome (a toggle label) must not sink the content beside it
    const place = (c, at, label, list) => {
      at(c);
      const text = norm(c.innerText);
      if (!text || baseline.includes(text) || seen.some((s) => s.includes(text))) { c.remove(); if (text) stats.deduped.push(label); return; }
      seen.push(text);
      const leaves = [...c.querySelectorAll('.section, p, h1, h2, h3, h4, h5, h6, li, button, blockquote, figcaption, dt, dd')]
        .filter((e) => !e.querySelector('.section, p, h1, h2, h3, h4, h5, h6, li, button, blockquote, figcaption, dt, dd'));
      mark(c); leaves.forEach((e) => mark(e));
      undo.push(() => c.remove());
      if (list) list.push(label); else stats.outside += 1;
    };
    const done = new Set();
    const resolveRef = async (ref, at) => {
      if (done.has(ref.path) || done.size >= 30) return;
      done.add(ref.path);
      const html = await fetchPlain(ref.path);
      if (html == null) { stats.failed.push(ref.path); return; }
      place(splice(html, ref.kind, ref.path), at, ref.path, ref.kind === 'modal' ? stats.modals : stats.fragments);
    };
    const BLOCKISH = 'p, li, h1, h2, h3, h4, h5, h6, dt, dd, td, th, blockquote';
    for (const a of all('a[href]')) {
      const ref = refOf(a.getAttribute('href'));
      if (!ref || a.closest('[data-stardust-splice]')) continue;
      const host = a.closest(BLOCKISH);
      await resolveRef(ref, (c) => (host && inScope(host) ? host : a).after(c));
    }
    const last = scopes[scopes.length - 1];
    const appendLast = (c) => last.append(c);
    // EDS content loaded outside the scope (not header/footer): a sticky tray's sections or blocks, measured after the scope
    const out = [...document.querySelectorAll('.section, [data-block-name]')]
      .filter((el) => !el.closest('main, header, footer, [data-stardust-splice]') && !scopes.some((s) => s.contains(el) || el.contains(s)));
    for (const el of out.filter((e) => !out.some((o) => o !== e && o.contains(e)))) {
      const c = document.createElement('div'); c.setAttribute('data-stardust-splice', 'outside');
      const clone = el.cloneNode(true); clone.removeAttribute('style'); c.append(clone);
      place(c, appendLast, 'outside', null);
    }
    // fragments named outside the scope (a <meta> a tray script reads, a link outside main) that the page did not load yet
    const named = [...document.querySelectorAll('meta[content]:not([name="nav"]):not([name="footer"])')].map((m) => m.getAttribute('content'))
      .concat([...document.querySelectorAll('a[href]')].filter((a) => !inScope(a) && !a.closest('header, footer')).map((a) => a.getAttribute('href')));
    for (const href of named) {
      const ref = /^(\/|https?:)/.test(href || '') ? refOf(href) : null;
      if (ref && ref.kind === 'fragment') await resolveRef(ref, appendLast);
    }
  }
  // revealed images were never in view: load them (bounded) so the image checks measure them
  const imgs = [...document.querySelectorAll('[data-stardust-opt] img')].filter((i) => !i.complete || i.loading === 'lazy');
  imgs.forEach((i) => { const l = i.getAttribute('loading'); i.loading = 'eager'; undo.push(() => (l === null ? i.removeAttribute('loading') : i.setAttribute('loading', l))); });
  await Promise.race([
    Promise.all(imgs.map((i) => (i.complete ? 0 : new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); })))),
    new Promise((r) => setTimeout(r, Math.min(timeoutMs, 5000))),
  ]);
  return stats;
}
export function measureRestore() {
  const undo = window.__stardustMeasureUndo || [];
  while (undo.length) { try { undo.pop()(); } catch { /* keep restoring */ } }
  delete window.__stardustMeasureUndo;
}
/**
 * IMG_GROUP — runs inside page.evaluate: an img → the id of the innermost optional region holding it (0: required).
 * A closed <details>' summary is not part of its optional region.
 */
export const IMG_GROUP = `((img) => {
  for (let n = img.parentElement; n; n = n.parentElement) {
    const g = n.getAttribute && n.getAttribute('data-stardust-opt');
    if (g && !(n.tagName === 'DETAILS' && img.closest('summary') && img.closest('summary').parentElement === n)) return +g;
  }
  return 0;
})`;

/** Split marked text into segments: { t, opt } — opt when inside any mark pair; every mark starts a new segment. */
export function parseMarked(raw) {
  const segs = []; let depth = 0; let buf = '';
  const flush = () => { if (buf) segs.push({ t: buf, opt: depth > 0 }); buf = ''; };
  for (const c of raw || '') {
    if (c === MARKS[0] || c === MARKS[1]) { flush(); depth = Math.max(0, depth + (c === MARKS[0] ? 1 : -1)); } else buf += c;
  }
  flush();
  return segs;
}

/**
 * Whitespace-normalize segments into words: { text (the words joined by single spaces — the page's normalized
 * innerText), words, groups (per word: 0 required, else 1 + the index of the optional segment it is read from),
 * opt (groupRanges of groups) }. Comparing word lists keeps the separators out of the optional ranges: dropping a
 * range leaves the text the page would read without that region. A word straddling a mark is required.
 */
export function flattenSegments(segs) {
  const words = []; const groups = []; let cur = null;
  segs.forEach(({ t, opt }, k) => {
    for (const c of t) {
      if (/\s/.test(c)) { cur = null; continue; }
      if (!cur) { cur = { w: '', g: opt ? k + 1 : 0 }; words.push(cur); }
      else if (cur.g !== (opt ? k + 1 : 0)) cur.g = 0;
      cur.w += c;
    }
  });
  for (const x of words) groups.push(x.g);
  const list = words.map((x) => x.w);
  return { text: list.join(' '), words: list, groups, opt: groupRanges(groups) };
}

/** Item groups → ranges: consecutive items sharing one non-zero group id form one optional range. */
export function groupRanges(groups) {
  const out = [];
  groups.forEach((g, i) => {
    if (!g) return;
    const last = out[out.length - 1];
    if (last && last[1] === i && groups[i - 1] === g) last[1] = i + 1; else out.push([i, i + 1]);
  });
  return out;
}

/**
 * alignOptional — do a and b (strings or arrays, compared item by item) agree once optional ranges are counted or
 * dropped? An optional range is counted when the other side holds the same items at that position (required or
 * optional there), else dropped; greedy, left to right. Returns { pass, i, j (where they diverge), skipA, skipB (the
 * dropped range indices), keptA, keptB (lengths counted) }. With no optional ranges it is plain equality.
 */
export function alignOptional(a, b, aOpt = [], bOpt = []) {
  const same = (i, j, n) => {
    if (i + n > a.length || j + n > b.length) return false;
    for (let k = 0; k < n; k += 1) if (a[i + k] !== b[j + k]) return false;
    return true;
  };
  const skipA = new Set(); const skipB = new Set();
  let i = 0; let j = 0; let ka = 0; let kb = 0;
  for (;;) {
    while (ka < aOpt.length && aOpt[ka][0] < i) ka += 1;
    while (kb < bOpt.length && bOpt[kb][0] < j) kb += 1;
    const ra = ka < aOpt.length && aOpt[ka][0] === i ? aOpt[ka] : null;
    const rb = kb < bOpt.length && bOpt[kb][0] === j ? bOpt[kb] : null;
    if (ra || rb) {
      const na = ra ? ra[1] - ra[0] : 0; const nb = rb ? rb[1] - rb[0] : 0;
      if (ra && same(i, j, na)) { i += na; j += na; continue; }
      if (rb && same(i, j, nb)) { i += nb; j += nb; continue; }
      if (ra) { skipA.add(ka); i = ra[1]; continue; }
      skipB.add(kb); j = rb[1]; continue;
    }
    if (i >= a.length || j >= b.length || a[i] !== b[j]) break;
    i += 1; j += 1;
  }
  const kept = (len, opt, skip) => len - [...skip].reduce((n, k) => n + opt[k][1] - opt[k][0], 0);
  return { pass: i >= a.length && j >= b.length, i, j, skipA, skipB, keptA: kept(a.length, aOpt, skipA), keptB: kept(b.length, bOpt, skipB) };
}

/** The items whose index falls in no dropped range. */
export function keptItems(list, ranges, skip) {
  return list.filter((_, idx) => !ranges.some(([s, e], k) => skip.has(k) && idx >= s && idx < e));
}

/**
 * EMBED_SOURCES — runs inside page.evaluate: root → [{ kind, src, node }] for the embeds under it: iframes (a
 * non-player iframe only when it shows, unless counterpart), <video> (a blob:/data: stream is identified by its
 * player instead), player elements (Wistia wistia_async_<id> / <wistia-player media-id>, data-youtube-id,
 * data-vimeo-id, data-wistia-id, Brightcove data-video-id) as provider:id, script srcs (opts.scripts) and, for a
 * counterpart search, every link (an EDS embed/video block is authored as a link).
 */
export const EMBED_SOURCES = `((root, opts = {}) => {
  const out = []; const add = (kind, src, node) => { if (src && !/^(blob|data|about|javascript):/i.test(src)) out.push({ kind, src, node }); };
  const PLAYER = /youtube|youtu\\.be|vimeo|wistia|brightcove|dailymotion|vidyard|loom\\.com|jwplayer|kaltura/i;
  root.querySelectorAll('iframe').forEach((f) => {
    const src = f.getAttribute('src') || f.getAttribute('data-src') || f.getAttribute('data-lazy-src') || '';
    if (!opts.counterpart && !PLAYER.test(src)) { const r = f.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) return; }
    add('iframe', src, f);
  });
  root.querySelectorAll('video').forEach((v) => {
    const s = v.currentSrc || v.getAttribute('src') || v.querySelector('source[src]')?.getAttribute('src') || v.getAttribute('data-src');
    add('video', s && new URL(s, document.baseURI).href, v);
  });
  root.querySelectorAll('[class*="wistia_async_"], wistia-player[media-id], [data-wistia-id], [data-youtube-id], [data-vimeo-id], video-js[data-video-id], [data-video-id][data-account]').forEach((e) => {
    const w = /wistia_async_([a-z0-9]+)/i.exec(typeof e.className === 'string' ? e.className : '');
    if (w) add('player', 'wistia:' + w[1], e);
    if (e.getAttribute('media-id')) add('player', 'wistia:' + e.getAttribute('media-id'), e);
    if (e.getAttribute('data-wistia-id')) add('player', 'wistia:' + e.getAttribute('data-wistia-id'), e);
    if (e.getAttribute('data-youtube-id')) add('player', 'youtube:' + e.getAttribute('data-youtube-id'), e);
    if (e.getAttribute('data-vimeo-id')) add('player', 'vimeo:' + e.getAttribute('data-vimeo-id'), e);
    if (e.getAttribute('data-video-id') && (e.tagName === 'VIDEO-JS' || e.hasAttribute('data-account'))) add('player', 'brightcove:' + e.getAttribute('data-video-id'), e);
  });
  if (opts.scripts) root.querySelectorAll('script[src]').forEach((s) => add('script', s.src || s.getAttribute('src'), s));
  if (opts.counterpart) root.querySelectorAll('a[href], source[src]').forEach((a) => add('link', a.href || a.getAttribute('href') || a.getAttribute('src'), a));
  return out;
})`;

/**
 * An embed's identity: { provider, id, key } — YouTube, Vimeo, Wistia and Brightcove by video id (a player script
 * names Wistia's), anything else by host + path (provider 'url'). null when the src names no video (a provider's
 * API script, a bare host).
 */
export function embedIdentity(src) {
  if (!src) return null;
  const pseudo = /^(youtube|vimeo|wistia|brightcove):([\w-]+)$/.exec(src);
  if (pseudo) return { provider: pseudo[1], id: pseudo[2], key: `${pseudo[1]}:${pseudo[2]}` };
  let u; try { u = new URL(src, 'https://x.invalid'); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, ''); const p = u.pathname;
  const vid = (provider, id) => (id ? { provider, id, key: `${provider}:${id}` } : null);
  if (host === 'youtu.be') return vid('youtube', p.split('/')[1]);
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return vid('youtube', /^\/(?:embed|shorts|v|live)\/([\w-]{6,})/.exec(p)?.[1] || u.searchParams.get('v'));
  if (/(^|\.)vimeo\.com$/.test(host)) return vid('vimeo', /\/(\d{5,})(?:\/|$)/.exec(p)?.[1]);
  if (/(^|\.)wistia\.(com|net)$/.test(host) || host === 'wi.st') return vid('wistia', (/\/(?:medias|iframe)\/([a-z0-9]{6,})/i.exec(p) || /^\/embed\/([a-z0-9]{6,})\.js$/i.exec(p))?.[1]);
  if (/(^|\.)brightcove\.(net|com)$/.test(host)) return vid('brightcove', u.searchParams.get('videoId'));
  if (u.hostname === 'x.invalid') return null;
  return { provider: 'url', id: null, key: `url:${u.hostname}${p}` };
}

/**
 * Non-descriptive alt text on content images: [{ slot, src, alt, reason }]. reason: 'generic' ("icon", "image",
 * "photo 2"…), 'file-name' (an image file name, a camera name like IMG_1234, a slug like team_photo or hero-banner-2x), or
 * 'repeated' (one alt on `repeat` or more different images). An empty alt is not flagged (decorative is a choice).
 */
export function altFlags(images, { repeat = 3 } = {}) {
  const GENERIC = /^(icon|image|img|photo|photograph|picture|pic|banner|logo|graphic|placeholder|thumbnail|thumb|hero|untitled|alt|alt text|null|undefined|default|spacer|figure)(\s*[-_#]?\s*\d+)?$/;
  const FILE = /\.(jpe?g|png|gif|webp|svg|avif|bmp|tiff?|heic)$|^(img|dsc|dscn|dcim|pxl|screenshot|screen shot)[\s_-]*\d/i;
  const SLUG = (a) => /^[a-z0-9]+([_-][a-z0-9]+)+$/i.test(a) && (/_/.test(a) || (/\d/.test(a) && a.split('-').length > 2)); // team_photo, hero-banner-2x — not well-being, covid-19
  const pathOf = (s) => { try { const u = new URL(s, 'https://x.invalid'); return u.hostname + u.pathname; } catch { return s; } };
  const bySrcs = new Map();
  for (const im of images) {
    const k = (im.alt || '').trim().toLowerCase();
    if (k) (bySrcs.get(k) || bySrcs.set(k, new Set()).get(k)).add(pathOf(im.src));
  }
  const out = [];
  for (const im of images) {
    const alt = (im.alt || '').trim(); const k = alt.toLowerCase();
    if (!alt) continue;
    const bare = k.replace(/[.,:;!?'"()]+/g, '').trim();
    const reason = GENERIC.test(bare) ? 'generic' : FILE.test(alt) || SLUG(alt) ? 'file-name' : bySrcs.get(k).size >= repeat ? 'repeated' : null;
    if (reason) out.push({ slot: im.slot ?? null, src: im.src, alt, reason });
  }
  return out;
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
    console.log('As a module: import { DEFAULT_NORMALIZE, DEFAULT_LEDGER, loadNormalize, IMG_VISIBLE, IMG_CROP, visibleFraction, visibleRegion, compareCrops, compareRegions,');
    console.log('  measurePrep, measureRestore, IMG_GROUP, parseMarked, flattenSegments, groupRanges, alignOptional, keptItems, EMBED_SOURCES, embedIdentity, altFlags } from it.');
    console.log('Page ledgers: export NORMALIZE (string) and LEDGER; pass via --normalize to');
    console.log('capture-content.mjs and dom-equality.mjs — the SAME file to both.');
    process.exit(0);
  }
  console.log('# Default ledger entries');
  for (const e of DEFAULT_LEDGER) console.log(`- ${e.id}: ${e.what}\n    why: ${e.why}`);
  console.log('\n# Default NORMALIZE script\n');
  console.log(DEFAULT_NORMALIZE);
}
