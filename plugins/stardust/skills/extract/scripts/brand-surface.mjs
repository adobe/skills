#!/usr/bin/env node
/**
 * brand-surface.mjs — Phase 3 of stardust:extract: OFFLINE aggregation of the
 * Phase 2 page records into stardust/current/_brand-extraction.json, per
 * extract/reference/brand-surface.md. Zero network: every value comes from the
 * settled render crawl.mjs already saved (pages/<slug>.json + .html sidecar),
 * the crawl log and the fonts manifest — never from a second live pass.
 *
 * Usage:
 *   node brand-surface.mjs [--out stardust/current] [--home index] [--bounded] [--lift <dir>] [--dry-run]
 *   node brand-surface.mjs --help
 *     --out <dir>    the extract output dir (default stardust/current)
 *     --home <slug>  home-page slug (default index; `home` is the legacy alias, D6)
 *     --bounded      palette/type/motifs only — voice, voiceTable, crossPromo and
 *                    register are OMITTED (never guessed) and _provenance.mode is
 *                    "bounded". Automatic when the last _crawl-log.json run had
 *                    --pages / --single (cap 1) and no --prep.
 *     --lift <dir>   optional replica CSS lift (T23.5): its files are listed in
 *                    readArtifacts and its @font-face entries fill type.files when
 *                    assets/_fonts-manifest.json is absent. Never required.
 *     --dry-run      print the file, write nothing
 *
 * Reads:  <out>/pages/*.json (schema 2; records failing validateProvenance are
 *         skipped and noted), <out>/pages/<home>.html (banner inline SVG, icon links),
 *         <out>/_crawl-log.json (runs[].args, favicon, discovery.count),
 *         <out>/assets/_fonts-manifest.json (type.files, iconFont — absent → []),
 *         <out>/brand-sources/<host>/pages/*.json (origins[] only).
 * Writes: <out>/_brand-extraction.json (_provenance first: writtenBy, writtenAt,
 *         script, readArtifacts, synthesizedInputs: [], mode, notes[]) and, when the
 *         logo chain lands on an inline SVG, <out>/assets/logo.svg.
 *
 * Rules implemented (brand-surface.md): palette area-weighted from perSectionStyle /
 * headings[].style / ctas[].style, non-colours dropped, ΔE < 5 (CIE76) clustering,
 * role naming, usedAs, cap 8; third-party chrome EXCLUDED — a CTA whose label is in
 * crawl.mjs CONSENT_LABELS (one source, B28) or matches
 * /^(accept|reject|allow|decline|agree)\b|cookie/i, or whose domPath hits a CMP
 * selector, never enters the palette or the button clusters. Type: heading vs body
 * family, per-level size by score = px × (weight/400) × √count, modular-scale audit.
 * Motifs: mode of non-zero radii weighted by stats.motifs element counts, top-3
 * shadows, gradients, patterns; home-vs-cross-page divergence → _provenance.notes.
 * System components: landmark heading-sequence + CTA-label fingerprint on
 * ≥ min(3, ceil(pages/2)) pages (skipped below 3 pages), plus cross-page CSS
 * background reuse. Logo chain: 1 inline SVG in the banner · 1b largest <img>/<svg>
 * rendered inside the banner landmark (rect ≥ 40×16 CSS px, aspect 0.5–6) ·
 * 2 <img> with a logo-ish src/alt · 3 apple-touch-icon · 4 og:image · 5 favicon ·
 * 6 synthesized (basis recorded, no file written).
 *
 * Exit codes: 0 written / dry-printed · 1 no page records, or every record fails
 *   provenance · 2 usage (unknown flag, --out is not a directory).
 * Exports (evals/fixtures/brand-surface.test.mjs): parseArgs, parseColor, toHex,
 *   deltaE, clusterColors, isThirdPartyChrome, pxOf, scaleAudit, headingSizes,
 *   buildBrandSurface, resolveLogo, isBoundedRun — importing runs nothing; main()
 *   runs only when the file is the entry script.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { CONSENT_LABELS, validateProvenance } from './crawl.mjs';

const HELP = `brand-surface — offline Phase 3 aggregation of pages/*.json into _brand-extraction.json
Usage: node brand-surface.mjs [--out stardust/current] [--home index] [--bounded] [--lift <dir>] [--dry-run]
Exit codes: 0 written/dry · 1 no usable page records · 2 usage.`;

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) return { help: true };
  const o = { out: 'stardust/current', home: 'index', bounded: false, lift: null, dryRun: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    const val = () => { const v = rest[i + 1]; if (v === undefined || /^--/.test(v)) throw new UsageError(`${a} needs a value`); i += 1; return v; }; // a following flag is not a value (`--out --prep`)
    if (a === '--out') o.out = val();
    else if (a === '--home') o.home = val();
    else if (a === '--bounded') o.bounded = true;
    else if (a === '--lift') o.lift = val();
    else if (a === '--dry-run') o.dryRun = true;
    else throw new UsageError(`unknown flag ${a}`);
  }
  return o;
}
class UsageError extends Error {}
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const uniq = (a) => [...new Set(a.filter((x) => x !== undefined && x !== null && x !== ''))];
const mode = (table) => Object.entries(table).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
const inc = (t, k, n = 1) => { if (k) t[k] = (t[k] || 0) + n; };
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// ---- colour utils --------------------------------------------------------
const NAMED = { white: [255, 255, 255], black: [0, 0, 0] };
/** CSS colour → [r,g,b,a] or null for non-colours (transparent, alpha 0, none, unparseable). */
export function parseColor(s) {
  const v = norm(s);
  if (!v || v === 'transparent' || v === 'none' || v === 'inherit' || v === 'currentcolor') return null;
  if (NAMED[v]) return [...NAMED[v], 1];
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1]; if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16); const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return a === 0 ? null : [n >> 16, (n >> 8) & 255, n & 255, a];
  }
  m = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) { const a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])); return a === 0 ? null : [+m[1], +m[2], +m[3], a].map((x, i) => (i < 3 ? Math.round(x) : x)); }
  m = v.match(/^hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] === undefined ? 1 : parseFloat(m[4]) / (m[4].endsWith('%') ? 100 : 1); if (a === 0) return null;
    const h = +m[1] / 360; const sat = +m[2] / 100; const l = +m[3] / 100; const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat; const p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((x) => Math.round(x * 255)).concat(a);
  }
  return null;
}
export const toHex = (rgb) => `#${rgb.slice(0, 3).map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
function toLab([r, g, b]) {
  const lin = (c) => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const xyz = [(R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, (R * 0.2126 + G * 0.7152 + B * 0.0722), (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883];
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = xyz.map(f);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** CIE76 ΔE between two CSS colours (already-parsed [r,g,b] accepted). */
export function deltaE(a, b) {
  const A = Array.isArray(a) ? a : parseColor(a); const B = Array.isArray(b) ? b : parseColor(b);
  if (!A || !B) return Infinity;
  const [l1, a1, b1] = toLab(A); const [l2, a2, b2] = toLab(B);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
/**
 * Cluster observations { value, weight, usedAs, selector, page } within ΔE < 5; the
 * most frequent member of each cluster is its representative. Returns clusters
 * sorted by total weight: { value, occurrences, usedAs[], sourceSelectors[], sources[], members[] }.
 */
export function clusterColors(obs, threshold = 5) {
  const clusters = [];
  for (const o of obs) {
    const rgb = parseColor(o.value); if (!rgb) continue;
    const hex = toHex(rgb);
    let c = clusters.find((k) => deltaE(k.rgb, rgb) < threshold);
    if (!c) { c = { rgb, members: {}, occurrences: 0, usedAs: {}, selectors: {}, pages: {} }; clusters.push(c); }
    c.members[hex] = (c.members[hex] || 0) + o.weight; c.occurrences += o.weight;
    inc(c.usedAs, o.usedAs, o.weight); inc(c.selectors, o.selector, o.weight); inc(c.pages, o.page, o.weight);
  }
  return clusters.map((c) => {
    const value = mode(c.members)[0][0];
    return { value, occurrences: Math.round(c.occurrences), usedAs: mode(c.usedAs).map(([k]) => k), sourceSelectors: mode(c.selectors).slice(0, 6).map(([k]) => k), sources: mode(c.pages).slice(0, 3).map(([k]) => k), members: Object.keys(c.members), rgb: parseColor(value) };
  }).sort((a, b) => b.occurrences - a.occurrences);
}

// ---- third-party chrome (brand-surface.md § Palette) ----------------------
const CMP_LABEL_RE = /^(accept|reject|allow|decline|agree)\b|cookie/i;
const CMP_PATH_RE = /onetrust|cybot|cookiebot|usercentrics|didomi|cookie-banner|cookie-consent|cookie_banner|cookieconsent|truste|consent-manager|qc-cmp|sp_message|cmp-container/i;
const CONSENT_SET = new Set(CONSENT_LABELS.map(norm));
/** A CTA that belongs to a consent manager / feedback widget, not the brand. */
export function isThirdPartyChrome(cta) {
  const label = norm(cta && cta.label);
  return CONSENT_SET.has(label) || CMP_LABEL_RE.test(label) || CMP_PATH_RE.test(String((cta && cta.domPath) || ''));
}

// ---- length / type utils --------------------------------------------------
/** CSS length → px (rem/em at 16, clamp() → its preferred value, else the largest px inside); null when unparseable. */
export function pxOf(v) {
  const s = norm(v); if (!s) return null;
  let m = s.match(/^clamp\(([^,]+),([^,]+),([^)]+)\)$/);
  if (m) { const mid = /vw|vh|%/.test(m[2]) ? null : pxOf(m[2].trim()); return mid !== null ? mid : pxOf(m[3].trim()); }
  m = s.match(/^(-?[\d.]+)(px|rem|em|pt)?$/);
  if (m) { const n = parseFloat(m[1]); const u = m[2] || 'px'; return u === 'px' ? n : u === 'pt' ? n * 4 / 3 : n * 16; }
  const all = [...s.matchAll(/(-?[\d.]+)px/g)].map((x) => parseFloat(x[1]));
  return all.length ? Math.max(...all) : null;
}
const familyOf = (stack) => { const f = String(stack || '').split(',')[0].trim().replace(/^["']|["']$/g, ''); return f || null; };
const SCALES = [['minor-second', 1.067], ['major-second', 1.125], ['minor-third', 1.2], ['major-third', 1.25], ['perfect-fourth', 1.333], ['augmented-fourth', 1.414], ['perfect-fifth', 1.5], ['golden', 1.618]];
/** § Modular-scale audit over heading sizes in px (any order). */
export function scaleAudit(sizesPx) {
  const sizes = uniq(sizesPx.filter((n) => Number.isFinite(n) && n > 0)).sort((a, b) => b - a);
  const ratios = sizes.slice(1).map((s, i) => round(sizes[i] / s, 3));
  if (ratios.length) {
    const hit = SCALES.find(([, r]) => ratios.every((x) => Math.abs(x - r) <= 0.025));
    if (hit) return { kind: 'modular', ratios, matchedScale: hit[0], scaleRatio: hit[1] };
  }
  return { kind: 'ad-hoc', ratios, matchedScale: null, scaleRatio: null };
}
/** § Type-size aggregation: per level, the (size, weight) group with the top score = px × (weight/400) × √count. */
export function headingSizes(headings) {
  const byLevel = {};
  for (const h of headings) {
    const lvl = h.level || parseInt(String(h.tag || 'h2').replace(/\D/g, ''), 10) || 2; const st = h.style || {}; const px = pxOf(st.fontSize); if (px === null) continue;
    const w = parseInt(st.fontWeight, 10) || 400; const k = `${st.fontSize}|${w}`;
    byLevel[lvl] = byLevel[lvl] || {}; byLevel[lvl][k] = byLevel[lvl][k] || { fontSize: st.fontSize, px, weight: w, count: 0, lineHeight: st.lineHeight, letterSpacing: st.letterSpacing };
    byLevel[lvl][k].count += 1;
  }
  return Object.keys(byLevel).map(Number).sort((a, b) => a - b).map((lvl) => {
    const best = Object.values(byLevel[lvl]).map((g) => ({ ...g, score: g.px * (g.weight / 400) * Math.sqrt(g.count) })).sort((a, b) => b.score - a.score)[0];
    return { level: lvl, ...best };
  });
}

// ---- bounded detection ----------------------------------------------------
/** Auto-bounded: the last run's args carry --pages (non-null) or cap 1 (--single) and no --prep. */
export function isBoundedRun(log) {
  const run = log && Array.isArray(log.runs) && log.runs[log.runs.length - 1]; const a = (run && run.args) || {};
  if (a.prep) return false;
  return (Array.isArray(a.pages) && a.pages.length > 0) || a.cap === 1;
}

// ---- logo chain -----------------------------------------------------------
const LOGO_MIN = { w: 40, h: 16 }; const logoShaped = (r) => r && r.width >= LOGO_MIN.w && r.height >= LOGO_MIN.h && r.width / r.height >= 0.5 && r.width / r.height <= 6;
const extOf = (u) => { const m = String(u || '').split(/[?#]/)[0].match(/\.(svg|png|jpe?g|ico|webp|avif|gif)$/i); return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : null; };
function bannerBounds(home) {
  const banner = (home.landmarks || []).find((l) => l.tag === 'header' || l.role === 'banner');
  const rects = ((banner && banner.children) || []).map((c) => c.rect).filter(Boolean);
  if (!rects.length) return { x: 0, y: 0, width: 1440, height: 120 };
  const x = Math.min(...rects.map((r) => r.x)); const y = Math.min(...rects.map((r) => r.y));
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y };
}
const inside = (r, b) => r && r.x + r.width / 2 >= b.x && r.x + r.width / 2 <= b.x + b.width && r.y + r.height / 2 >= b.y && r.y + r.height / 2 <= b.y + b.height;
function headerSvgMarkup(html) {
  const h = String(html || '').match(/<header\b[\s\S]*?<\/header>/i) || String(html || '').match(/<[a-z]+\b[^>]*role=["']banner["'][\s\S]*?<\/[a-z]+>/i);
  const svgs = h ? [...h[0].matchAll(/<svg\b[\s\S]*?<\/svg>/gi)].map((m) => m[0]) : [];
  return svgs;
}
/** § Logo chain (steps 1 · 1b · 2 · 3 · 4 · 5 · 6). `html` is the home .html sidecar text (may be ''). */
export function resolveLogo(home, html, log, outDir) {
  const bounds = bannerBounds(home); const media = home.media || {};
  const viewBoxWH = (vb) => { const p = String(vb || '').trim().split(/[\s,]+/).map(Number); return p.length === 4 && p.every(Number.isFinite) ? [p[2], p[3]] : [null, null]; };
  const svgs = headerSvgMarkup(html);
  // 1 — inline SVG in the banner, logo-shaped (an icon-sized svg is not a logo)
  const svgCands = (media.inlineSvgs || []).filter((s) => (/^(header|\[role=.banner)/i.test(s.domPath || '') || inside(s.rect, bounds)) && logoShaped(s.rect)).sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
  if (svgCands.length) {
    const s = svgCands[0]; const [vw, vh] = viewBoxWH(s.viewBox); const markup = svgs.find((m) => s.viewBox && m.includes(s.viewBox)) || svgs.find((m) => logoShaped((() => { const [w, h] = viewBoxWH((m.match(/viewBox=["']([^"']+)/i) || [])[1]); return w ? { width: w, height: h } : null; })())) || null;
    return { source: 'inline-svg', step: '1', sourceSelector: s.domPath || 'header svg', url: null, localPath: markup ? `${outDir}/assets/logo.svg` : null, markup, format: 'svg', intrinsicWidth: vw, intrinsicHeight: vh, renderedWidth: s.rect.width, renderedHeight: s.rect.height, synthesized: false, synthesizedBasis: null };
  }
  // 1b — largest <img> / inline <svg> rendered inside the banner landmark (rect ≥ 40×16 CSS px, aspect 0.5–6)
  const imgs = (media.images || []).filter((i) => inside(i.rect, bounds) && logoShaped(i.rect)).map((i) => ({ kind: 'img', ...i }));
  const insvg = (media.inlineSvgs || []).filter((s) => inside(s.rect, bounds) && logoShaped(s.rect)).map((s) => ({ kind: 'inline-svg', ...s }));
  const best = [...imgs, ...insvg].sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
  if (best) {
    const url = best.currentSrc || best.src || null;
    return { source: best.kind, step: '1b', sourceSelector: best.kind === 'img' ? `img[src="${best.src}"]` : best.domPath, url, localPath: best.localPath || null, format: extOf(url) || (best.mime ? String(best.mime).split('/')[1] : null) || (best.kind === 'inline-svg' ? 'svg' : null), intrinsicWidth: best.naturalWidth || null, intrinsicHeight: best.naturalHeight || null, renderedWidth: best.rect.width, renderedHeight: best.rect.height, alt: best.alt || null, synthesized: false, synthesizedBasis: null };
  }
  // 2 — <img> with a logo-ish src / alt anywhere on the home page
  const logoish = (media.images || []).find((i) => /logo|wordmark|brand/i.test(`${i.src || ''} ${i.alt || ''}`));
  if (logoish) return { source: 'img', step: '2', sourceSelector: `img[src="${logoish.src}"]`, url: logoish.currentSrc || logoish.src, localPath: logoish.localPath || null, format: extOf(logoish.src), intrinsicWidth: logoish.naturalWidth || null, intrinsicHeight: logoish.naturalHeight || null, renderedWidth: logoish.rect ? logoish.rect.width : null, renderedHeight: logoish.rect ? logoish.rect.height : null, alt: logoish.alt || null, synthesized: false, synthesizedBasis: null };
  // 3 — apple-touch-icon · 4 — og:image · 5 — favicon
  const touch = (String(html || '').match(/<link\b[^>]*rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/i) || [''])[0].match(/href=["']([^"']+)/i);
  if (touch) return { source: 'apple-touch-icon', step: '3', sourceSelector: touch[1], url: touch[1], localPath: null, format: extOf(touch[1]) || 'png', intrinsicWidth: null, intrinsicHeight: null, renderedWidth: null, renderedHeight: null, synthesized: false, synthesizedBasis: null };
  if (home.og && home.og.image) return { source: 'og-image', step: '4', sourceSelector: home.og.image, url: home.og.image, localPath: null, format: extOf(home.og.image), intrinsicWidth: null, intrinsicHeight: null, renderedWidth: null, renderedHeight: null, synthesized: false, synthesizedBasis: null };
  const fav = (log && log.favicon && (log.favicon.url || log.favicon.file)) ? log.favicon : null;
  if (fav) return { source: 'favicon', step: '5', sourceSelector: fav.url || fav.file, url: fav.url || null, localPath: fav.file || null, format: extOf(fav.url || fav.file) || 'ico', intrinsicWidth: null, intrinsicHeight: null, renderedWidth: null, renderedHeight: null, synthesized: false, synthesizedBasis: null };
  const initials = String(home.title || home.slug || 'X').split(/[\s|–-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return { source: 'synthesized', step: '6', sourceSelector: null, url: null, localPath: null, format: null, intrinsicWidth: null, intrinsicHeight: null, renderedWidth: null, renderedHeight: null, synthesized: true, synthesizedBasis: `Brand initials ${initials}, derived from page title — no logo asset found in the chain` };
}

// ---- aggregation ------------------------------------------------------------
const CTA_LIST = new Set(['donate', 'donate now', 'give', 'give now', 'support us', 'contribute', 'read more', 'learn more', 'more info', 'see more', 'view more', 'view', 'more', 'discover more', 'explore', 'overview', 'sign up', 'signup', 'subscribe', 'register', 'join', 'create account', 'contact', 'contact us', 'get in touch', 'talk to us', 'reach out', 'say hello', 'get help', 'get involved', 'find help', 'volunteer', 'share', 'download', 'submit', 'here', 'click here', 'read this', 'this']);
const OPEN_FONTS = /^(inter|roboto|open sans|lato|montserrat|poppins|source sans|source serif|noto|nunito|raleway|work sans|playfair|merriweather|dm sans|manrope|ibm plex|fira|space grotesk|rubik|oswald|pt sans|pt serif|libre|karla|mulish|jost|outfit|figtree|lora|barlow|cabin|ubuntu|arimo|tinos|cousine|public sans|atkinson)/i;
const areaOf = (r) => (r && r.width > 0 && r.height > 0 ? Math.max(1, Math.round((r.width * r.height) / 10000)) : null);

/**
 * Pure aggregation. `pages` = live records; `sidecars` = { slug: html }; returns the
 * _brand-extraction.json object (_provenance first). `opts`: { home, bounded, log, fonts, lift, outDir, brandSources }.
 */
export function buildBrandSurface(pages, sidecars, opts) {
  const notes = []; const outDir = opts.outDir || 'stardust/current';
  const homeSlug = pages.some((p) => p.slug === opts.home) ? opts.home : (opts.home === 'index' && pages.some((p) => p.slug === 'home') ? 'home' : opts.home);
  const home = pages.find((p) => p.slug === homeSlug) || pages[0];
  if (home.slug !== opts.home) notes.push(`home page: --home ${opts.home} not found; using ${home.slug}`);
  const bounded = !!opts.bounded; const n = pages.length;
  const cta = (p) => (p.ctas || []).filter((c) => !isThirdPartyChrome(c));
  const excluded = pages.reduce((k, p) => k + (p.ctas || []).length - cta(p).length, 0);
  if (excluded) notes.push(`third-party chrome: ${excluded} CTA(s) excluded from palette/button aggregation (consent table crawl.mjs CONSENT_LABELS + CMP selectors)`);

  // palette — area-weighted observations
  const obs = [];
  for (const p of pages) {
    const mainKids = (((p.landmarks || []).find((l) => l.tag === 'main' || l.role === 'main') || {}).children) || [];
    (p.perSectionStyle || []).forEach((s, i) => {
      const area = (mainKids.length === (p.perSectionStyle || []).length && areaOf(mainKids[i] && mainKids[i].rect)) || 100;
      if (s.background && s.background.color) obs.push({ value: s.background.color, weight: area, usedAs: 'background', selector: s.sectionRef, page: p.slug });
      if (s.text && s.text.dominantColor) obs.push({ value: s.text.dominantColor, weight: Math.max(1, Math.round(area * 0.4)), usedAs: 'text', selector: s.sectionRef, page: p.slug });
    });
    for (const h of p.headings || []) if (h.style && h.style.color) obs.push({ value: h.style.color, weight: Math.max(2, Math.round((pxOf(h.style.fontSize) || 16) / 4)), usedAs: 'text', selector: (h.domPath || '').split(' > ').pop() || h.tag || `h${h.level}`, page: p.slug });
    for (const c of cta(p)) { if (c.style && c.style.backgroundColor) obs.push({ value: c.style.backgroundColor, weight: 20, usedAs: 'background', selector: c.domPath, page: p.slug }); if (c.style && c.style.color) obs.push({ value: c.style.color, weight: 5, usedAs: 'text', selector: c.domPath, page: p.slug }); }
  }
  const clusters = clusterColors(obs);
  const ctaBg = clusterColors(pages.flatMap((p) => cta(p).filter((c) => c.style && c.style.backgroundColor).map((c) => ({ value: c.style.backgroundColor, weight: 1, usedAs: 'background', selector: c.domPath, page: p.slug }))));
  const bgs = clusterColors(obs.filter((o) => o.usedAs === 'background' && !/(^|> )a\.|button|btn|cta/i.test(String(o.selector || ''))));
  const texts = clusterColors(obs.filter((o) => o.usedAs === 'text'));
  const roleOf = new Map(); const assign = (c, role) => { if (!c) return; const k = clusters.find((x) => deltaE(x.rgb, c.rgb) < 5); if (k && !roleOf.has(k.value) && ![...roleOf.values()].includes(role)) roleOf.set(k.value, role); };
  assign(bgs[0], 'background'); assign(texts[0], 'text-primary'); assign(ctaBg[0], 'primary'); assign(ctaBg[1], 'secondary'); assign(bgs[1], 'surface'); assign(texts[1], 'text-secondary');
  let accent = 0;
  const palette = clusters.map((c) => ({ role: roleOf.get(c.value) || `accent-${++accent}`, value: c.value, occurrences: c.occurrences, usedAs: c.usedAs, sourceSelectors: c.sourceSelectors, sources: c.sources }));
  if (palette.length > 8) notes.push(`palette capped at 8; dropped: ${palette.slice(8).map((c) => `${c.value} (${c.occurrences})`).join(', ')}`);
  const paletteOut = palette.slice(0, 8);

  // type
  const allHeadings = pages.flatMap((p) => (p.headings || []).map((h) => ({ ...h, slug: p.slug })));
  const famCount = {}; for (const h of allHeadings) inc(famCount, familyOf(h.style && h.style.fontFamily));
  const headingFam = mode(famCount)[0] ? mode(famCount)[0][0] : null;
  const bodyCount = {}; for (const p of pages) for (const s of p.perSectionStyle || []) for (const f of s.fontFamilies || []) inc(bodyCount, familyOf(f));
  for (const p of pages) for (const c of cta(p)) inc(bodyCount, familyOf(c.style && c.style.fontFamily), 0.5);
  const bodyFam = (mode(bodyCount).find(([f]) => f !== headingFam) || mode(bodyCount)[0] || [headingFam])[0] || headingFam;
  const stackOf = (fam) => (allHeadings.find((h) => familyOf(h.style && h.style.fontFamily) === fam) || {}).style?.fontFamily || pages.flatMap((p) => cta(p)).find((c) => familyOf(c.style && c.style.fontFamily) === fam)?.style.fontFamily || fam;
  const hs = headingFam ? allHeadings.filter((h) => familyOf(h.style && h.style.fontFamily) === headingFam) : allHeadings;
  const levels = headingSizes(hs);
  const audit = scaleAudit(levels.map((l) => l.px));
  const fonts = opts.fonts || null; const liftFaces = (opts.lift && opts.lift.fontFaces) || [];
  if (!fonts) notes.push(`assets/_fonts-manifest.json absent — type.files = []${liftFaces.length ? ` (${liftFaces.length} @font-face from --lift listed instead)` : ''}`);
  const files = ((fonts && fonts.fonts) || liftFaces).map((f) => ({ url: f.url || null, family: f.family || null, weight: f.weight ?? null, style: f.style || 'normal', unicodeRange: f.unicodeRange || null, localPath: f.localPath || null, sourceCssRule: f.sourceCssRule || null, licensingFlag: f.licensingFlag ?? (f.family ? (OPEN_FONTS.test(f.family) ? 'open' : 'private') : null), ...(f.mime ? { mime: f.mime } : {}), ...(f.bytes ? { bytes: f.bytes } : {}) }));
  const display = files.map((f) => (String(f.sourceCssRule || '').match(/font-display\s*:\s*(swap|block|fallback|optional|auto)/i) || [])[1]).find(Boolean) || null;
  const bodyStyles = pages.flatMap((p) => cta(p).map((c) => c.style || {}));
  const type = {
    headingFamily: headingFam ? { name: headingFam, stack: stackOf(headingFam), weights: uniq(hs.map((h) => parseInt(h.style && h.style.fontWeight, 10) || null)).sort((a, b) => a - b), sizes: levels.map((l) => l.fontSize), lineHeights: uniq(levels.map((l) => l.lineHeight)), letterSpacing: uniq(levels.map((l) => l.letterSpacing)), sourceSelectors: uniq(levels.map((l) => `h${l.level}`)), sources: uniq(hs.map((h) => h.slug)).slice(0, 3) } : null,
    bodyFamily: bodyFam ? { name: bodyFam, stack: stackOf(bodyFam), weights: uniq(bodyStyles.map((s) => parseInt(s.fontWeight, 10) || null)).sort((a, b) => a - b), sizes: [], lineHeights: [], letterSpacing: [], sourceSelectors: uniq(pages.flatMap((p) => (p.perSectionStyle || []).filter((s) => (s.fontFamilies || []).some((f) => familyOf(f) === bodyFam)).map((s) => s.sectionRef))).slice(0, 6), sources: uniq(pages.filter((p) => (p.perSectionStyle || []).some((s) => (s.fontFamilies || []).some((f) => familyOf(f) === bodyFam))).map((p) => p.slug)).slice(0, 3) } : null,
    monoFamily: uniq([...Object.keys(famCount), ...Object.keys(bodyCount)]).find((f) => /mono|courier|consolas|menlo|code/i.test(f)) || null,
    scaleRatio: audit.scaleRatio, scaleAudit: { kind: audit.kind, ratios: audit.ratios, matchedScale: audit.matchedScale }, loadStrategy: display, files,
  };
  if (!bodyStyles.length) notes.push('body sizes/line-heights not captured in schema 2 (no paragraph style snapshot) — bodyFamily.sizes = []');

  // icon font
  const iconSrc = (fonts && (fonts.iconFonts || [])[0]) || pages.flatMap((p) => (p._signals && p._signals.iconFont) || []).find(Boolean) || null;
  const iconFont = iconSrc ? { family: iconSrc.family, localPath: (files.find((f) => f.family === iconSrc.family) || {}).localPath || null, sourceCss: (files.find((f) => f.family === iconSrc.family) || {}).sourceCssRule || null, glyphCount: (iconSrc.classes || []).length, glyphs: (iconSrc.classes || []).map((cls, i) => ({ class: cls, codepoint: (iconSrc.codepoints || [])[i] || null, name: /^(?:icon|glyph|fa|i)[-_]?([a-z][a-z-]*)$/i.test(cls) && !/\d/.test(cls) ? cls.replace(/^(?:icon|glyph|fa|i)[-_]?/i, '') : null })) } : null;

  // spacing
  const spacePx = {}; const padBlock = {}; const gaps = {};
  for (const p of pages) for (const s of p.perSectionStyle || []) { const sp = s.spacing || {}; for (const [k, t] of [['paddingBlock', padBlock], ['gap', gaps], ['paddingInline', null]]) for (const part of String(sp[k] || '').split(/\s+/)) { const px = pxOf(part); if (px !== null && px > 0) { inc(spacePx, String(Math.round(px))); if (t) inc(t, part); } } }
  const vals = Object.keys(spacePx).map(Number); const baseUnit = vals.length && vals.every((v) => v % 8 === 0) ? 8 : vals.length && vals.every((v) => v % 4 === 0) ? 4 : null;
  const widths = {}; for (const p of pages) for (const l of p.landmarks || []) for (const c of l.children || []) if (c.rect && c.rect.width >= 600 && c.rect.width < 1440) inc(widths, `${Math.round(c.rect.width)}px`);
  const cw = pages.flatMap((p) => p.cssCustomProperties || []).find((c) => /container|max-width|content-width/i.test(c.name) && pxOf(c.value));
  const spacing = { baseUnit, scale: baseUnit ? vals.sort((a, b) => a - b).slice(0, 12) : [], sectionPadding: mode(padBlock)[0] ? mode(padBlock)[0][0] : null, containerMaxWidth: cw ? cw.value : (mode(widths)[0] ? mode(widths)[0][0] : null), gridGap: mode(gaps)[0] ? mode(gaps)[0][0] : null };
  if (!baseUnit) notes.push('spacing: no 4/8 rhythm detected across section paddings/gaps — scale = []');

  // motifs
  const radii = {}; const shadows = {}; const grads = {}; const radiiPages = {}; let statsSeen = 0; const homeRadii = {};
  for (const p of pages) {
    const m = (p.stats && p.stats.motifs) || null;
    if (m) { statsSeen += 1; for (const [k, v] of Object.entries(m.radii || {})) { if (pxOf(k) === 0) continue; inc(radii, k, v); (radiiPages[k] = radiiPages[k] || {})[p.slug] = v; if (p.slug === home.slug) inc(homeRadii, k, v); } for (const [k, v] of Object.entries(m.shadows || {})) inc(shadows, k, v); for (const [k, v] of Object.entries(m.gradients || {})) inc(grads, k, v); } else {
      for (const s of p.perSectionStyle || []) { if (s.borderRadius && pxOf(s.borderRadius) !== 0) { inc(radii, s.borderRadius); (radiiPages[s.borderRadius] = radiiPages[s.borderRadius] || {})[p.slug] = 1; if (p.slug === home.slug) inc(homeRadii, s.borderRadius); } for (const sh of s.shadowsUsed || []) inc(shadows, sh); }
      for (const c of cta(p)) { const st = c.style || {}; if (st.borderRadius && pxOf(st.borderRadius) !== 0) { inc(radii, st.borderRadius); (radiiPages[st.borderRadius] = radiiPages[st.borderRadius] || {})[p.slug] = 1; if (p.slug === home.slug) inc(homeRadii, st.borderRadius); } if (st.boxShadow && st.boxShadow !== 'none') inc(shadows, st.boxShadow); }
    }
  }
  if (statsSeen < n) notes.push(`motifs: ${n - statsSeen} page(s) without stats.motifs — counted per section/CTA (1 each) instead of per element`);
  const isPill = (k) => /%$/.test(k) ? parseFloat(k) >= 50 : (pxOf(k) || 0) >= 9999;
  const ranked = mode(radii).filter(([k]) => !isPill(k)); const pill = mode(radii).find(([k]) => isPill(k));
  const primaryR = ranked[0] ? ranked[0][0] : null; const homeR = mode(homeRadii).filter(([k]) => !isPill(k))[0];
  if (primaryR && homeR && homeR[0] !== primaryR) notes.push(`home suggested borderRadius=${homeR[0]} (${homeR[1]} occurrences on ${home.slug}); cross-page mode is ${primaryR} (${ranked[0][1]} occurrences)`);
  const ctaShadows = new Set(pages.flatMap((p) => cta(p).map((c) => c.style && c.style.boxShadow))); const sectionShadows = new Set(pages.flatMap((p) => (p.perSectionStyle || []).flatMap((s) => s.shadowsUsed || [])));
  const heroGrad = pages.some((p) => (p.perSectionStyle || []).some((s) => s.purpose === 'hero' && s.background && s.background.hasGradient));
  const comp = (key) => pages.filter((p) => p.components && p.components[key] && p.components[key].count > 0);
  const patterns = [];
  const pat = (name, ps, ev) => { if (ps.length) patterns.push({ name, evidence: ev, pages: ps.map((p) => p.slug).slice(0, 5) }); };
  pat('card-grid', comp('cards').filter((p) => p.components.cards.count >= 3), `${comp('cards').filter((p) => p.components.cards.count >= 3).length} page(s) with ≥ 3 cards (${comp('cards').reduce((k, p) => k + p.components.cards.count, 0)} total)`);
  pat('hero-with-image', pages.filter((p) => (p.perSectionStyle || []).some((s) => s.purpose === 'hero' && s.background && s.background.hasImage)), 'hero section carries a background image');
  for (const [key, name] of [['logoStrip', 'social-proof-logos'], ['statRow', 'stat-row'], ['pricingTiles', 'pricing-tiles'], ['testimonialCards', 'testimonials'], ['ctaBand', 'cta-band'], ['timeline', 'timeline'], ['breadcrumbs', 'breadcrumb'], ['carousels', 'carousel'], ['accordions', 'accordion-faq']]) pat(name, comp(key), `${comp(key).length} page(s) list components.${key}`);
  const motifs = {
    borderRadius: { primary: primaryR, secondary: ranked[1] ? ranked[1][0] : null, pill: pill ? pill[0] : null, primarySources: primaryR ? mode(radiiPages[primaryR] || {}).slice(0, 3).map(([k]) => k) : [], occurrences: Object.fromEntries(mode(radii)) },
    shadows: mode(shadows).filter(([k]) => k && k !== 'none').slice(0, 3).map(([value, count]) => ({ value, uses: ctaShadows.has(value) ? 'buttons' : sectionShadows.has(value) ? 'sections' : 'cards', count })),
    gradients: mode(grads).slice(0, 3).map(([value, count]) => ({ value, uses: heroGrad ? 'hero-background' : 'section-background', count })),
    patterns,
  };

  // component style (v1 fields) — buttons clustered by (background, colour), CMP chrome already excluded
  const btnGroups = {}; const rep = (v) => { const rgb = parseColor(v); if (!rgb) return 'transparent'; const k = ctaBg.find((c) => deltaE(c.rgb, rgb) < 5); return k ? k.value : toHex(rgb); };
  for (const p of pages) for (const c of cta(p)) { const st = c.style || {}; const bg = rep(st.backgroundColor); const k = `${bg}|${parseColor(st.color) ? toHex(parseColor(st.color)) : '-'}`; btnGroups[k] = btnGroups[k] || { st, bg, n: 0, transparent: bg === 'transparent', fold: 0 }; btnGroups[k].n += 1; if (c.appearsAbove === 'fold' && p.slug === home.slug) btnGroups[k].fold += 1; }
  const btns = Object.values(btnGroups).sort((a, b) => b.n - a.n); const solid = btns.filter((b) => !b.transparent); const ghost = btns.find((b) => b.transparent);
  const btn = (b) => (b ? { background: b.bg, color: parseColor(b.st.color) ? toHex(parseColor(b.st.color)) : null, borderRadius: b.st.borderRadius || null, padding: b.st.padding || null, fontWeight: parseInt(b.st.fontWeight, 10) || null, shadow: b.st.boxShadow && b.st.boxShadow !== 'none' ? b.st.boxShadow : null, hoverDelta: null, occurrences: b.n } : null);
  const cardSec = pages.flatMap((p) => (p.perSectionStyle || []).filter((s) => s.borderRadius && pxOf(s.borderRadius) > 0 && /feature|card|list|social|unknown/.test(s.purpose || '')))[0] || null;
  const componentStyle = { buttons: { primary: btn(solid[0]), secondary: btn(solid[1]), ghost: btn(ghost) }, dualCTAPattern: solid[0] && solid[0].fold && ((solid[1] && solid[1].fold) || (ghost && ghost.fold)) ? (solid[1] && solid[1].fold ? 'primary-then-secondary' : 'primary-then-secondary-link') : null, cards: cardSec ? { background: cardSec.background && cardSec.background.color ? toHex(parseColor(cardSec.background.color) || [0, 0, 0]) : null, borderRadius: cardSec.borderRadius, padding: cardSec.spacing ? cardSec.spacing.paddingBlock : null, shadow: (cardSec.shadowsUsed || [])[0] || null, border: null, sourceSelector: cardSec.sectionRef } : null, inputs: null };
  if (!componentStyle.cards) notes.push('componentStyle.cards: no card-like section style captured'); notes.push('componentStyle.inputs: input styles are not in the schema 2 record — null');

  // system components — heading-sequence + CTA-label fingerprint per landmark
  const systemComponents = [];
  const threshold = Math.min(3, Math.ceil(n / 2));
  if (n < 3) notes.push(`system component detection requires ≥ 3 pages; crawl too small (${n})`);
  else {
    const fp = {};
    for (const p of pages) for (const l of p.landmarks || []) {
      if (l.tag === 'main' || l.role === 'main') continue;
      const tagRe = new RegExp(`^(${l.tag}|\\[role=.?${l.role}|${l.id ? `#${l.id}` : 'NOPE'})`, 'i');
      const seq = uniq([...(l.children || []).map((c) => (Number.isInteger(c.headlineRef) && p.headings[c.headlineRef] ? p.headings[c.headlineRef].text : null)), ...((p.links && p.links.internal) || []).filter((k) => tagRe.test(k.domPath || '')).map((k) => k.text)]).slice(0, 12);
      const labels = uniq(cta(p).filter((c) => tagRe.test(c.domPath || '')).map((c) => c.label));
      if (!seq.length && !labels.length) continue;
      const key = `${l.tag || l.role}|${seq.join('|')}|${labels.join('|')}`;
      fp[key] = fp[key] || { l, seq, labels, pages: [], sel: l.id ? `${l.tag}#${l.id}` : (l.classes && l.classes[0] ? `${l.tag}.${l.classes[0]}` : l.tag || `[role="${l.role}"]`) };
      fp[key].pages.push(p.slug);
    }
    let k = 0;
    for (const [key, g] of Object.entries(fp)) {
      if (g.pages.length < threshold) continue;
      const kind = g.l.tag === 'header' || g.l.role === 'banner' ? 'header' : g.l.tag === 'footer' || g.l.role === 'contentinfo' ? 'footer' : g.l.tag === 'nav' || g.l.role === 'navigation' ? 'nav-secondary' : g.l.tag === 'aside' || g.l.role === 'complementary' ? 'sidebar' : (g.labels.length && g.seq.length >= 3 && !g.pages.includes(home.slug) ? 'cross-promo' : 'other');
      systemComponents.push({ name: kind === 'header' ? 'site-header' : kind === 'footer' ? 'site-footer' : `${kind}-${++k}`, kind, occurrences: g.pages.length, headingSequence: g.seq, ctaLabels: g.labels, domFingerprintHash: `sha256:${crypto.createHash('sha256').update(key).digest('hex')}`, exampleSlug: g.pages.includes(home.slug) ? home.slug : g.pages[0], exampleSelector: g.sel, examplePages: g.pages.slice(0, 5) });
    }
    const bgUrls = {};
    for (const p of pages) for (const b of (p.media && p.media.cssBackgrounds) || []) if (b.url) { bgUrls[b.url] = bgUrls[b.url] || { pages: [], ex: b }; if (!bgUrls[b.url].pages.includes(p.slug)) bgUrls[b.url].pages.push(p.slug); }
    let m = 0;
    for (const [url, g] of Object.entries(bgUrls)) if (g.pages.length >= 2) systemComponents.push({ name: `background-motif-${++m}`, kind: 'background-motif', occurrences: g.pages.length, headingSequence: [], ctaLabels: [], domFingerprintHash: `sha256:${crypto.createHash('sha256').update(url).digest('hex')}`, exampleSlug: g.pages[0], exampleSelector: g.ex.domPath, examplePages: g.pages.slice(0, 5), exampleBlock: { url, domPath: g.ex.domPath, boundingClientRect: g.ex.boundingClientRect || null, backgroundSize: g.ex.backgroundSize || null, backgroundPosition: g.ex.backgroundPosition || null } });
  }

  // logo (home-only) + origins + site
  const logo = resolveLogo(home, sidecars[home.slug] || '', opts.log, outDir);
  const origin = (() => { try { return new URL(home.finalUrl || home.url).origin; } catch { return null; } })();
  const origins = [{ origin, role: 'primary', pagesCaptured: n, contributedSignals: [] }, ...((opts.brandSources || []).map((b) => ({ origin: b.origin, role: 'brand-source', pagesCaptured: b.pages, contributedSignals: [] })))];
  if (opts.brandSources && opts.brandSources.length) notes.push(`brand-sources: ${opts.brandSources.length} origin(s) counted in origins[]; their evidence is not merged into the frequency tables by this script`);
  const site = { name: (home.og && home.og.siteName) || String(home.title || '').split(/\s[|–—-]\s/).pop().trim() || origin, tagline: home.metaDescription || (home.og && home.og.description) || null, originUrl: origin };

  const out = { _provenance: null, site, origins, logo: (({ markup, ...rest }) => rest)(logo), palette: paletteOut, type, spacing, motifs, componentStyle, systemComponents, iconFont };
  if (bounded) notes.push(`bounded: ${n} page(s); palette/type/motifs only — voice, voiceTable, crossPromo and register omitted`);
  else Object.assign(out, voiceBlocks(pages, home, cta, notes));
  const readArtifacts = [...pages.map((p) => `${outDir}/pages/${p.slug}.json`), ...Object.keys(sidecars).map((s) => `${outDir}/pages/${s}.html`), ...(opts.log ? [`${outDir}/_crawl-log.json`] : []), ...(fonts ? [`${outDir}/assets/_fonts-manifest.json`] : []), ...((opts.lift && opts.lift.files) || [])];
  out._provenance = { writtenBy: 'stardust:extract', writtenAt: new Date().toISOString(), script: 'brand-surface.mjs', readArtifacts, synthesizedInputs: [], mode: bounded ? 'bounded' : 'full', pagesAggregated: n, notes };
  return { surface: out, logoMarkup: logo.markup || null };
}

/** Home-only voice + cross-page voiceTable, crossPromo, register (omitted under --bounded). */
function voiceBlocks(pages, home, cta, notes) {
  const n = pages.length; const media = home.media || {};
  const cands = [...(media.images || []).map((i) => ({ ...i, rect: i.rect, kind: 'img', url: i.currentSrc || i.src, domPath: i.domPath || null })), ...(media.cssBackgrounds || []).map((b) => ({ ...b, rect: b.boundingClientRect || b.rect, kind: b.pseudo ? 'css-pseudo-background' : 'css-background' }))]
    .filter((c) => c.rect && c.rect.y < 800 && c.rect.width * c.rect.height >= 100000 && c.rect.width / c.rect.height >= 0.3 && c.rect.width / c.rect.height <= 3)
    .sort((a, b) => (b.rect.width * b.rect.height - a.rect.width * a.rect.height) || (['img', 'css-background', 'css-pseudo-background'].indexOf(a.kind) - ['img', 'css-background', 'css-pseudo-background'].indexOf(b.kind)));
  const hi = cands[0] ? { url: cands[0].url, alt: cands[0].alt || null, source: cands[0].kind, domPath: cands[0].domPath || null, localPath: cands[0].localPath || null, rect: cands[0].rect } : null;
  if (!hi) notes.push(`voice.heroImage: no candidate in the first viewport of ${home.slug} (≥ 100 000 px², aspect 0.3–3)`);
  const vid = (media.videos || []).find((v) => !v.rect || v.rect.y < 800) || (media.iframes || []).find((f) => /youtube|vimeo|wistia|cloudflarestream/i.test(f.src || '') && f.rect && f.rect.y < 800);
  const hm = vid ? { kind: 'video', mechanism: /\.m3u8/.test(vid.src || '') ? 'hls' : /youtube|vimeo/i.test(vid.src || '') ? 'youtube/vimeo-embed' : 'video-file', src: vid.src || null, domPath: vid.domPath || null, loader: null, rect: vid.rect || null } : null;
  const homeCtas = cta(home); const fold = homeCtas.find((c) => c.appearsAbove === 'fold') || homeCtas[0];
  const labelTable = {}; const labelPages = {};
  for (const p of pages) { const seen = new Set(); for (const l of [...cta(p).map((c) => c.label), ...[...((p.links && p.links.internal) || []), ...((p.links && p.links.external) || [])].map((k) => k.text).filter((t) => CTA_LIST.has(norm(t)))]) { const k = String(l || '').trim(); if (!k) continue; inc(labelTable, k); (labelPages[k] = labelPages[k] || new Set()).add(p.slug); seen.add(k); } }
  const ctaFrequency = mode(labelTable).map(([label, total]) => ({ label, total, pageCount: labelPages[label].size, pages: [...labelPages[label]] })).sort((a, b) => b.total - a.total || b.pageCount - a.pageCount).slice(0, 8);
  const headTable = {}; const headPages = {}; const headLevel = {}; let upper = 0; let total = 0;
  for (const p of pages) for (const h of p.headings || []) { const t = String(h.text || '').trim(); if (!t) continue; total += 1; if (t === t.toUpperCase() && /[A-Z]/.test(t)) upper += 1; inc(headTable, t); (headPages[t] = headPages[t] || new Set()).add(p.slug); headLevel[t] = h.level; }
  const headingFrequency = mode(headTable).map(([text, tot]) => ({ text, total: tot, pageCount: headPages[text].size, level: headLevel[text] })).filter((h) => h.pageCount >= 3).sort((a, b) => b.total - a.total || b.pageCount - a.pageCount);
  const navRe = /^(header|nav|\[role=.?(banner|navigation))/i;
  const navItems = uniq(((home.links && home.links.internal) || []).filter((k) => navRe.test(k.domPath || '')).map((k) => k.text)).slice(0, 10);
  const footer = (home.landmarks || []).find((l) => l.tag === 'footer' || l.role === 'contentinfo');
  const footerHeadings = uniq([...((footer && footer.children) || []).map((c) => (Number.isInteger(c.headlineRef) && home.headings[c.headlineRef] ? home.headings[c.headlineRef].text : null)), ...(home.headings || []).filter((h) => /^footer/i.test(h.domPath || '')).map((h) => h.text)]);
  const paras = pages.flatMap((p) => (p.landmarks || []).flatMap((l) => (l.children || []).flatMap((c) => c.body || [])));
  const firstParagraph = ((home.landmarks || []).find((l) => l.tag === 'main' || l.role === 'main') || { children: [] }).children.flatMap((c) => c.body || []).find((b) => String(b).length > 40) || home.heroLede || null;
  const words = paras.join(' ').split(/\s+/).filter(Boolean); const sentences = paras.join(' ').split(/[.!?]+\s/).filter((s) => s.trim()).length || 1;
  const avgLen = words.length / sentences; const second = words.filter((w) => /^(you|your|you're|yours)$/i.test(w)).length / Math.max(1, words.length); const bangs = paras.join(' ').split('!').length - 1;
  const guess = !paras.length ? 'other' : bangs > sentences * 0.1 ? 'playful-bright' : second > 0.02 && avgLen < 18 ? 'professional-warm' : avgLen > 24 ? 'professional-formal' : /\b(api|sdk|deploy|integrat|configure|latency)\b/i.test(paras.join(' ')) ? 'technical-precise' : second > 0.02 ? 'bold-direct' : 'professional-formal';
  const tone = { guess, evidence: `avg sentence ${round(avgLen, 1)} words · second-person ${round(second * 100, 1)} % of words · ${bangs} exclamation(s) across ${paras.length} paragraph(s)` };
  const voice = { heroHeadline: home.heroHeadline || null, heroSubcopy: home.heroLede || null, heroImage: hi, heroMedium: hm, primaryCTALabel: fold ? fold.label : null, ctaSamples: ctaFrequency.slice(0, 4).map((c) => c.label), navItems, footerHeadings, firstParagraph, tone };
  const voiceTable = { ctaFrequency, headingFrequency, toneMetrics: { headingsTotal: total, headingsUppercasePercent: total ? Math.round((upper / total) * 100) : 0, distinctHeadings: Object.keys(headTable).length, distinctCtaLabels: uniq(pages.flatMap((p) => cta(p).map((c) => String(c.label || '').trim()))).length } };
  let crossPromo = { detected: false, anchorHeading: null, cluster: null, pages: null, pageCount: null, totalPages: n };
  const chromeHeads = new Set(pages.flatMap((p) => (p.headings || []).filter((h) => /^(header|footer|nav|\[role=.?(banner|contentinfo|navigation))/i.test(h.domPath || '')).map((h) => String(h.text || '').trim())));
  const promoFreq = headingFrequency.filter((h) => !chromeHeads.has(h.text)); // header/footer headings are system components, not a cross-promo anchor
  if (promoFreq.length) {
    const anchor = promoFreq[0]; const anchorPages = headPages[anchor.text];
    const cluster = promoFreq.slice(0, 12).map((h) => ({ text: h.text, total: h.total, pageCount: h.pageCount, overlap: [...headPages[h.text]].filter((s) => anchorPages.has(s)).length })).filter((h) => h.overlap / anchorPages.size >= 0.6);
    if (cluster.length >= 2) crossPromo = { detected: true, anchorHeading: anchor.text, cluster, pages: [...anchorPages], pageCount: anchorPages.size, totalPages: n };
  }
  const hasHero = (home.perSectionStyle || []).some((s) => s.purpose === 'hero') || !!home.heroHeadline;
  const brandScore = (hasHero ? 1 : 0) + (homeCtas.some((c) => c.appearsAbove === 'fold') ? 1 : 0) + (homeCtas.some((c) => /sign up|get started|start|trial|pricing|donate|buy|shop|book/i.test(c.label || '')) ? 1 : 0) + ((home.components && ((home.components.logoStrip || {}).count || (home.components.testimonialCards || {}).count || (home.components.pricingTiles || {}).count)) ? 1 : 0);
  const productScore = ((home.components && (home.components.tables || {}).count >= 2) ? 1 : 0) + ((home.forms || []).some((f) => (f.fields || []).some((x) => x.type === 'password')) ? 1 : 0) + ((home.widgets && ((home.widgets.tabs || []).length + (home.widgets.accordions || []).length) >= 2) ? 1 : 0) + (((home.links && home.links.internal) || []).some((k) => /^(log in|login|sign in|dashboard|my account)$/i.test(String(k.text || '').trim())) ? 1 : 0);
  const register = brandScore >= 2 && productScore <= 1 ? 'brand' : productScore >= 2 && brandScore <= 1 ? 'product' : 'ambiguous';
  return { voice, voiceTable, crossPromo, register };
}

// ---- IO -----------------------------------------------------------------------
function readLift(dir) {
  if (!dir) return null;
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new UsageError(`--lift ${dir} is not a directory`);
  const files = []; const fontFaces = [];
  (function walk(d) { for (const e of readdirSync(d)) { const p = path.join(d, e); if (statSync(p).isDirectory()) walk(p); else files.push(p); } })(dir);
  for (const f of files.filter((x) => x.endsWith('.json'))) { const j = readJson(f); for (const arr of [j && j.fontFaces, j && j.fonts]) if (Array.isArray(arr)) for (const face of arr) if (face && face.family) fontFaces.push(face); }
  return { dir, files, fontFaces };
}
function main() {
  let args;
  try { args = parseArgs(process.argv); } catch (e) { console.error(`brand-surface: ${e.message}\n\n${HELP}`); process.exit(2); }
  if (args.help) { console.log(HELP); process.exit(0); }
  const out = args.out; const pagesDir = path.join(out, 'pages');
  if (!existsSync(out) || !statSync(out).isDirectory()) { console.error(`brand-surface: --out ${out} is not a directory\n\n${HELP}`); process.exit(2); }
  let lift = null; try { lift = readLift(args.lift); } catch (e) { console.error(`brand-surface: ${e.message}`); process.exit(2); }
  const files = existsSync(pagesDir) ? readdirSync(pagesDir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort() : [];
  const pages = []; const skipped = [];
  for (const f of files) { const rec = readJson(path.join(pagesDir, f)); if (!rec) { skipped.push(`${f}: unreadable`); continue; } const v = validateProvenance(rec._provenance); if (!v.ok) { skipped.push(`${rec.slug || f}: _provenance.${v.missing.join(', _provenance.')}`); continue; } if (!rec.slug) rec.slug = f.replace(/\.json$/, ''); pages.push(rec); }
  if (!pages.length) { console.error(`brand-surface: no live page record under ${pagesDir}${skipped.length ? ` (${skipped.length} skipped: ${skipped.join('; ')})` : ''} — run crawl.mjs first`); process.exit(1); }
  const sidecars = {}; for (const p of pages) { const h = path.join(pagesDir, `${p.slug}.html`); if (existsSync(h)) sidecars[p.slug] = readFileSync(h, 'utf8'); }
  const log = readJson(path.join(out, '_crawl-log.json')); const fonts = readJson(path.join(out, 'assets', '_fonts-manifest.json'));
  const bounded = args.bounded || isBoundedRun(log);
  const bsDir = path.join(out, 'brand-sources'); const brandSources = existsSync(bsDir) ? readdirSync(bsDir).filter((h) => existsSync(path.join(bsDir, h, 'pages'))).map((h) => ({ origin: `https://${h}`, pages: readdirSync(path.join(bsDir, h, 'pages')).filter((f) => f.endsWith('.json')).length })) : [];
  const { surface, logoMarkup } = buildBrandSurface(pages, sidecars, { home: args.home, bounded, log, fonts, lift, outDir: out, brandSources });
  if (skipped.length) surface._provenance.notes.push(`skipped ${skipped.length} record(s) without live-render provenance: ${skipped.join('; ')}`);
  const target = path.join(out, '_brand-extraction.json');
  if (args.dryRun) { console.log(JSON.stringify(surface, null, 2)); console.log(`brand-surface (dry-run): would write ${target}${logoMarkup ? ` + ${surface.logo.localPath}` : ''}`); return; }
  if (logoMarkup && surface.logo.localPath) { mkdirSync(path.dirname(surface.logo.localPath), { recursive: true }); writeFileSync(surface.logo.localPath, `${logoMarkup}\n`); }
  writeFileSync(target, `${JSON.stringify(surface, null, 2)}\n`);
  const t = surface.type;
  console.log(`brand-surface: ${target} ← ${pages.length} page(s), mode ${surface._provenance.mode} · palette ${surface.palette.length} · type ${t.headingFamily ? t.headingFamily.name : '-'} / ${t.bodyFamily ? t.bodyFamily.name : '-'} (${t.scaleAudit.kind}${t.scaleAudit.matchedScale ? ` ${t.scaleAudit.matchedScale}` : ''}) · radius ${surface.motifs.borderRadius.primary || '-'} · logo ${surface.logo.source} (step ${surface.logo.step}) · systemComponents ${surface.systemComponents.length} · notes ${surface._provenance.notes.length}`);
  for (const nline of surface._provenance.notes) console.log(`  note: ${nline}`);
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entry === import.meta.url) main();
