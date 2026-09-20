#!/usr/bin/env node
/**
 * brand-review.mjs — Phase 5 of stardust:extract: render stardust/current/
 * brand-review.html per extract/reference/brand-review-template.md — the first
 * surface a human eyeballs to verify the extraction. Descriptive only; the 13
 * Tensions detectors are mechanical and ALWAYS run (the review may ship with zero
 * tensions, never without the detectors).
 *
 * Usage:
 *   node brand-review.mjs [--out stardust/current] [--dry-run]
 *   node brand-review.mjs --help
 *
 * Reads:  <out>/_brand-extraction.json (required — exit 2 when missing or without
 *         _provenance: the review never fabricates a brand surface), <out>/pages/*.json
 *         (detectors over ctas / links / cssCustomProperties / media / embedDominance /
 *         landmarks; screenshots; optional), <out>/_crawl-log.json (coverage; optional),
 *         <out>/pages/<home>.html (only to mirror a font <link> the live site already loads).
 * Writes: <out>/brand-review.html — `<!-- stardust:provenance … -->` as the FIRST head
 *         child, ALL CSS embedded, no external JavaScript, no external font unless the
 *         captured home page loads one (its own <link> is mirrored), sticky top nav,
 *         canonical section order (masthead · coverage · pages · palette · typography ·
 *         voice · tensions · motifs · components · cross-promo? · system components? ·
 *         logo · spacing & shape · embed-dominated? · footer); a section whose source
 *         data is missing is OMITTED, never padded. Brand-faithful chrome: :root vars
 *         from the captured palette (most-frequent saturated colour → --primary,
 *         hue-anchored --primary-dark, ≥ 60° --accent, bare-stack fallback chains,
 *         uppercase rule at ≥ 25 %). Consolidation: a per-element rule firing > 3 times
 *         collapses to one card.
 *
 * Exit codes: 0 rendered / dry-printed (detector results printed as `T-xxx: fired|quiet`)
 *   · 2 usage, or _brand-extraction.json missing / unreadable / without _provenance.
 * Exports (evals/fixtures/brand-review.test.mjs): parseArgs, runDetectors, consolidate,
 *   cssVars, renderReview, DETECTOR_IDS — importing runs nothing; main() runs only when
 *   the file is the entry script.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HELP = `brand-review — render brand-review.html from _brand-extraction.json (+ pages/*.json, _crawl-log.json)
Usage: node brand-review.mjs [--out stardust/current] [--dry-run]
Exit codes: 0 rendered/dry (prints T-xxx: fired|quiet) · 2 usage or missing _brand-extraction.json.`;

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) return { help: true };
  const o = { out: 'stardust/current', dryRun: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    const val = () => { const v = rest[i + 1]; if (v === undefined || /^--/.test(v)) throw new Error(`${a} needs a value`); i += 1; return v; }; // a following flag is not a value (`--out --prep`)
    if (a === '--out') o.out = val();
    else if (a === '--dry-run') o.dryRun = true;
    else throw new Error(`unknown flag ${a}`);
  }
  return o;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const count = (arr) => arr.reduce((t, k) => { t[k] = (t[k] || 0) + 1; return t; }, {});
const fmtCounts = (t) => Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(', ');

// ---- colour helpers (hex only — the brand surface already normalised to #rrggbb) ----
const rgbOf = (hex) => { const m = String(hex || '').match(/^#([0-9a-f]{6})$/i); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const hexOf = (rgb) => `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
const hueOf = ([r, g, b]) => { const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); if (mx === mn) return 0; const d = mx - mn; let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return h * 60; };
const hueDist = (a, b) => { const d = Math.abs(hueOf(a) - hueOf(b)) % 360; return d > 180 ? 360 - d : d; };
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const A = rgbOf(a); const B = rgbOf(b); if (!A || !B) return null; const [l1, l2] = [lum(A), lum(B)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
const saturated = (rgb) => rgb && Math.max(...rgb) - Math.min(...rgb) > 30 && Math.max(...rgb) < 240;
const darken = (rgb, f = 0.3) => hexOf(rgb.map((c) => c * (1 - f)));
const withFallback = (stack, serif = false) => (!stack ? null : /\b(sans-serif|serif|monospace|system-ui)\b/i.test(stack) ? stack : `${stack}, ${serif ? 'Georgia, "Times New Roman", serif' : '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif'}`);

/** § Visual language: the :root variables, all from the brand surface. Returns { vars, notes }. */
export function cssVars(brand) {
  const notes = []; const pal = (brand.palette || []).map((p) => ({ ...p, rgb: rgbOf(p.value) })).filter((p) => p.rgb);
  const role = (r) => (pal.find((p) => p.role === r) || {}).value || null;
  const sat = pal.filter((p) => saturated(p.rgb));
  let primary = sat[0] ? sat[0].value : role('primary');
  if (!primary) { primary = '#147aff'; notes.push('no saturated brand colour in the palette — --primary falls back to the renderer default #147aff'); } else if (!sat.length) notes.push('no saturated palette entry — --primary is the role-tagged primary');
  const pr = rgbOf(primary);
  const darkCand = sat.find((p) => p.value !== primary && hueDist(p.rgb, pr) <= 30 && lum(p.rgb) < lum(pr));
  const primaryDark = darkCand ? darkCand.value : darken(pr);
  const accCand = sat.find((p) => p.value !== primary && p.value !== primaryDark && hueDist(p.rgb, pr) > 60);
  const accent = accCand ? accCand.value : role('secondary') || primary;
  const t = brand.type || {}; const serif = /serif|georgia|times|garamond|playfair|merriweather|lora/i.test((t.headingFamily || {}).name || '') && !/sans/i.test((t.headingFamily || {}).name || '');
  const text = role('text-primary') || '#0f1217'; const surface = role('background') || '#ffffff';
  const c = contrast(text, surface); let textOut = text; let surfaceOut = surface;
  if (c !== null && c < 4.5) { textOut = '#0f1217'; surfaceOut = '#ffffff'; notes.push(`captured text ${text} on ${surface} is ${c.toFixed(2)}:1 (< 4.5) — review body overridden to #0f1217 on #ffffff`); }
  return { vars: { '--primary': primary, '--primary-dark': primaryDark, '--accent': accent, '--secondary': role('secondary') || accent, '--text': textOut, '--text-muted': role('text-secondary') || '#5b6470', '--surface': surfaceOut, '--surface-alt': role('surface') || '#f7f8fa', '--border': role('border') || '#e5e7eb', '--display': withFallback((t.headingFamily || {}).stack || (t.headingFamily || {}).name, serif) || 'system-ui, sans-serif', '--body': withFallback((t.bodyFamily || {}).stack || (t.bodyFamily || {}).name) || 'system-ui, sans-serif' }, notes, contrast: c };
}

// ---- detectors (brand-review-template.md § Detector rules) ------------------
export const DETECTOR_IDS = ['T-scale', 'T-radius-vocab', 'T-cta-vocab', 'T-link-content-free', 'T-logo-variants', 'T-color-imbalance', 'T-no-tokens', 'T-tokens-unused', 'T-img-alt-generic', 'T-embed-dominance', 'T-img-alt-empty', 'T-nav-conflict', 'T-temporal-mark'];
const BUCKETS = { 'see-more': ['see more', 'learn more', 'more info', 'more', 'read more', 'view more', 'discover more', 'explore'], start: ['get started', 'start now', 'start free', 'try it', 'try now', 'try free', 'try for free', 'begin'], contact: ['contact', 'contact us', 'get in touch', 'talk to us', 'reach out', 'say hello'], buy: ['buy now', 'purchase', 'order now', 'order', 'add to cart', 'checkout'], signup: ['sign up', 'signup', 'create account', 'register', 'join', 'subscribe'], donate: ['donate', 'donate now', 'give', 'give now', 'support us', 'contribute'], 'vague-here': ['here', 'click here', 'read this', 'this', 'more'] };
const CONTENT_FREE = new Set(['here', 'click here', 'read this', 'more', 'this']);
const GENERIC_ALT = new Set(['logo', 'image', 'picture', 'photo', 'img', 'icon']);
const FRAMEWORK_DEFAULTS = { '#007bff': 'Bootstrap 4', '#0d6efd': 'Bootstrap 5', '#6c757d': 'Bootstrap', '#28a745': 'Bootstrap 4', '#198754': 'Bootstrap 5', '#17a2b8': 'Bootstrap 4', '#0dcaf0': 'Bootstrap 5', '#ffc107': 'Bootstrap', '#dc3545': 'Bootstrap', '#64748b': 'Tailwind slate-500', '#6b7280': 'Tailwind gray-500', '#6200ee': 'Material', '#3f51b5': 'Material', '#1976d2': 'Material', '#03dac6': 'Material' };
const CONFLICTS = [[['donate'], ['crisis', 'get help', 'find help']], [['pricing'], ['contact sales']], [['sign up'], ['start free trial']], [['book a demo'], ['talk to sales']], [['sign in'], ['log in', 'login']]];
const TEMPORAL = [/anniversary/i, /centennial/i, /\b20\d\d edition\b/i, /year-in-review/i];
const card = (id, title, body, source) => ({ id, title, body, source });
const propsOf = (p) => (Array.isArray(p.cssCustomProperties) ? p.cssCustomProperties : Object.entries(p.customProps || {}).map(([name, value]) => ({ name, value })));
const navLabels = (p) => { const out = []; for (const l of p.landmarks || []) if (l.tag === 'header' || l.tag === 'nav' || l.role === 'banner' || l.role === 'navigation') for (const c of l.children || []) if (Number.isInteger(c.headlineRef) && (p.headings || [])[c.headlineRef]) out.push(p.headings[c.headlineRef].text); for (const k of (p.links && p.links.internal) || []) if (/^(header|nav|\[role=.?(banner|navigation))/i.test(k.domPath || '')) out.push(k.text); for (const c of p.ctas || []) if (/^(header|nav|\[role=.?(banner|navigation))/i.test(c.domPath || '')) out.push(c.label); return out.map(norm).filter(Boolean); };

/** Run the 13 rules; `pages` may be []. Returns raw cards (before consolidation). */
export function runDetectors(brand, pages = []) {
  const T = []; const t = brand.type || {}; const m = brand.motifs || {}; const logo = brand.logo || null;
  if (t.scaleAudit && t.scaleAudit.kind === 'ad-hoc') T.push(card('T-scale', 'Type scale is ad-hoc', `${((t.headingFamily || {}).sizes || []).join(' → ') || 'captured heading sizes'}, no consistent ratio${(t.scaleAudit.ratios || []).length ? ` (ratios ${t.scaleAudit.ratios.join(', ')})` : ''}. Direct will need to decide whether the target adopts a modular scale.`, '_brand-extraction.json § type.scaleAudit'));
  const occ = (m.borderRadius || {}).occurrences || {};
  const small = Object.entries(occ).filter(([k, n]) => /px$/.test(k) && parseFloat(k) < 16 && parseFloat(k) > 0 && n >= 10);
  if (small.length > 2) T.push(card('T-radius-vocab', 'Radius vocabulary is fragmented', `${small.map(([k, n]) => `${k} ×${n}`).join(', ')}. Direct will need to pick a single small-radius value or accept the variance.`, '_brand-extraction.json § motifs.borderRadius.occurrences'));
  const labels = count(pages.flatMap((p) => (p.ctas || []).map((c) => norm(c.label))).filter(Boolean));
  for (const [bucket, members] of Object.entries(BUCKETS)) { const hit = members.filter((x) => labels[x]); if (hit.length >= 2) T.push(card('T-cta-vocab', `CTA voice is fragmented (${bucket})`, `${hit.map((x) => `"${x}" ×${labels[x]}`).join(', ')}. Direct will need to pick a canonical voice for ${bucket} affordances.`, 'pages/*.json § ctas[].label')); }
  const linkHits = {}; for (const p of pages) for (const k of [...((p.links && p.links.internal) || []), ...((p.links && p.links.external) || [])]) { const x = norm(k.text); if (CONTENT_FREE.has(x)) { linkHits[x] = linkHits[x] || { n: 0, pages: new Set() }; linkHits[x].n += 1; linkHits[x].pages.add(p.slug); } }
  for (const [x, v] of Object.entries(linkHits)) T.push(card('T-link-content-free', `Content-free link label "${x}"`, `"${x}" ×${v.n} on ${[...v.pages].slice(0, 3).join(', ')}. Accessibility issue — screen readers and crawlers cannot tell what these point to.`, 'pages/*.json § links'));
  if (logo && ['apple-touch-icon', 'og-image', 'favicon', 'synthesized'].includes(logo.source)) T.push(card('T-logo-variants', 'Logo chain landed below the banner wordmark', `Only one logo variant captured (${logo.source}, chain step ${logo.step || '?'}) — no wordmark was found rendered in the banner. The redesign will need a monochrome / inverted / SVG variant set; direct should plan that.`, '_brand-extraction.json § logo'));
  for (const p of brand.palette || []) { const u = p.usedAs || []; if (['#000000', '#ffffff'].includes(String(p.value).toLowerCase()) || ['text-primary', 'text-secondary'].includes(p.role)) continue; if (u.length === 1 && (u[0] === 'text' || u[0] === 'background')) T.push(card('T-color-imbalance', `Color ${p.value} (${p.role}) appears as ${u[0]} only`, `Never as ${u[0] === 'text' ? 'background / border / fill' : 'text / border / fill'}. Direct will need to decide: drop, expand, or keep as accent.`, '_brand-extraction.json § palette[].usedAs')); }
  if (pages.length && pages.every((p) => propsOf(p).length === 0)) T.push(card('T-no-tokens', 'Site ships no design tokens', 'No CSS custom properties defined on any page. The migration target will introduce tokens — a structural change worth calling out to the user.', 'pages/*.json § cssCustomProperties'));
  const primary = ((brand.palette || []).find((p) => p.role === 'primary') || {}).value;
  const seen = new Set();
  for (const p of pages) for (const c of propsOf(p)) { const mm = String(c.name).match(/^--(?:bs-|mdc-theme-)?(primary|secondary|success|info|warning|danger)$/); const v = norm(c.value); if (!mm || seen.has(c.name) || !FRAMEWORK_DEFAULTS[v]) continue; if (mm[1] === 'primary' && primary && norm(primary) === v) continue; seen.add(c.name); T.push(card('T-tokens-unused', `Design token ${c.name} defined but unused`, `${c.name} ships as ${c.value} (likely a ${FRAMEWORK_DEFAULTS[v]} default) while the brand's actual primary is ${primary || 'n/a'}. The token layer exists in name only — rewire components to consume tokens or replace the values to match the brand.`, 'pages/*.json § cssCustomProperties + _brand-extraction.json § palette[primary]')); }
  const imgs = pages.flatMap((p) => ((p.media && p.media.images) || []));
  const gen = imgs.map((i) => norm(i.alt)).filter((a) => GENERIC_ALT.has(a));
  if (gen.length) T.push(card('T-img-alt-generic', 'Generic alt text found', `${gen.length} image(s) carry alt text equal to a stock placeholder (${fmtCounts(count(gen))}). Distinct from empty alt — these images claim a label but the label is content-free.`, 'pages/*.json § media.images[].alt'));
  const dom = pages.filter((p) => p.embedDominance && p.embedDominance.dominated);
  if (dom.length) T.push(card('T-embed-dominance', 'Embed-dominated page(s)', `${dom.map((p) => p.slug).join(', ')} have primary content inside a cross-origin embed (${[...new Set(dom.map((p) => { try { return new URL(p.embedDominance.iframeSrc).host; } catch { return p.embedDominance.iframeSrc; } }))].join(', ')}); brand-surface tokens for those pages were not captured. Direct will need to decide whether the redesign targets the host page or the embed surface.`, 'pages/*.json § embedDominance'));
  if (imgs.length) { const empty = imgs.filter((i) => !String(i.alt ?? '').trim()).length; const pct = Math.round((empty / imgs.length) * 100); if (pct >= 30) T.push(card('T-img-alt-empty', 'Empty alt text widespread', `${pct}% of images (${empty}/${imgs.length}) carry empty alt text. Accessibility issue and a content-sourcing decision for direct.`, 'pages/*.json § media.images[].alt')); }
  const nav = new Set(pages.flatMap(navLabels));
  for (const [a, b] of CONFLICTS) { const A = a.find((x) => nav.has(x)); const B = b.find((x) => nav.has(x)); if (A && B) T.push(card('T-nav-conflict', `Top-nav contains both "${A}" and "${B}"`, 'These typically compete for the same user moment. Direct should resolve which is primary.', 'pages/*.json § landmarks[banner|navigation]')); }
  const hay = [logo && logo.sourceSelector, logo && logo.alt, logo && logo.url, brand.voice && brand.voice.heroHeadline].filter(Boolean).join(' ');
  const tm = TEMPORAL.map((re) => (hay.match(re) || [])[0]).find(Boolean);
  if (tm) T.push(card('T-temporal-mark', 'A temporal mark was detected', `"${tm}" appears in the logo or hero. Direct will need to decide whether the redesign carries the temporal flag forward or returns to an evergreen brand.`, '_brand-extraction.json § logo + voice.heroHeadline'));
  return T;
}
/** § Card consolidation — a rule firing > 3 times collapses to one card. */
export function consolidate(tensions) {
  const by = {}; for (const t of tensions) (by[t.id] = by[t.id] || []).push(t);
  return Object.values(by).flatMap((g) => (g.length > 3 ? [card(g[0].id, `${g[0].id === 'T-color-imbalance' ? 'Multiple palette colors used in only one context' : `${g[0].id.replace('T-', '').replace(/-/g, ' ')} — ${g.length} findings`}`, `${g.length} matches: ${g.map((x) => x.title.replace(/^(Color |Content-free link label |Design token )/, '')).join('; ')}.`, g[0].source)] : g));
}

// ---- rendering ---------------------------------------------------------------
const badge = (b) => `<span class="badge">${esc(b)}</span>`;
const section = (id, title, badges, body) => (body ? `<section id="${id}"><h2>${esc(title)} ${badges.map(badge).join('')}</h2>${body}</section>` : '');
const stat = (n, l) => `<div class="stat"><strong>${esc(n)}</strong><span>${esc(l)}</span></div>`;
/** href for a captured asset relative to the review's own dir: <out>/assets/… → assets/…; otherwise the URL. */
const assetHref = (localPath, url, outDir) => { if (localPath) { const rel = path.relative(outDir, localPath); if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel; const i = String(localPath).indexOf('assets/'); if (i >= 0) return String(localPath).slice(i); } return url || null; };

/** Pure render → { html, tensions, notes }. `pages` / `log` optional; `fontLink` = a <link> the live home page already loads (or null). */
export function renderReview(brand, pages = [], log = null, { fontLink = null, outDir = 'stardust/current', now = new Date().toISOString() } = {}) {
  const { vars, notes } = cssVars(brand); const site = brand.site || {}; const t = brand.type || {}; const v = brand.voice || null; const vt = brand.voiceTable || null; const m = brand.motifs || {}; const sp = brand.spacing || {}; const logo = brand.logo || null;
  const upper = vt && vt.toneMetrics && vt.toneMetrics.headingsUppercasePercent >= 25;
  const raw = runDetectors(brand, pages); const tensions = consolidate(raw);
  const { contrast: c } = cssVars(brand); if (c !== null && c < 4.5) tensions.push(card('T-contrast', 'Captured text on background fails WCAG AA', `${c.toFixed(2)}:1 — the review overrides its own body copy to #0f1217 on #ffffff.`, '_brand-extraction.json § palette'));
  const homeSlug = pages.some((p) => p.slug === 'index') ? 'index' : (pages[0] || {}).slug;
  const runs = (log && log.runs) || []; const waits = pages.map((p) => (p._provenance || {})).filter((p) => p.waitMs);
  const avg = waits.length ? Math.round(waits.reduce((k, p) => k + p.waitMs, 0) / waits.length) : null;
  const modes = [...new Set(waits.map((p) => p.waitMode))].join(', ');
  const failures = (log && log.crawl && log.crawl.failures) || [];
  const sections = [];
  sections.push(`<header class="masthead" id="masthead">${logo && (logo.localPath || logo.url) ? `<img class="mark" src="${esc(assetHref(logo.localPath, logo.url, outDir))}" alt="">` : ''}<h1>${esc(site.name || site.originUrl || 'Current state')}</h1>${v && v.heroHeadline ? `<p class="hero-line">${esc(v.heroHeadline)}</p>` : ''}${site.tagline ? `<p class="tagline">${esc(site.tagline)}</p>` : ''}${site.originUrl ? `<p class="origin"><code>${esc(site.originUrl)}</code></p>` : ''}</header>`);
  if (pages.length || log) sections.push(section('coverage', 'Coverage', ['observed'], `<div class="stats">${stat(String(pages.length || (log && log.crawl && log.crawl.successes) || 0), `pages extracted${log && log.discovery && log.discovery.count ? ` of ${log.discovery.count} discovered` : ''}`)}${stat(avg !== null ? `${modes} · ${avg} ms` : (runs.length ? runs[runs.length - 1].args.wait || '—' : '—'), 'wait strategy · avg')}${stat(`${(brand.palette || []).length} colours · ${t.headingFamily ? t.headingFamily.name : '—'} / ${t.bodyFamily ? t.bodyFamily.name : '—'} · ${brand._provenance.mode || 'full'}`, 'brand surface')}</div>${failures.length ? `<p class="fail">Failures: ${failures.map((f) => `${esc(f.slug)} (${esc(f.errorClass)})`).join(', ')}</p>` : ''}${brand._provenance.notes && brand._provenance.notes.length ? `<ul class="notes">${brand._provenance.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`));
  const shots = pages.filter((p) => p.screenshot);
  if (shots.length) sections.push(section('pages', 'Pages', ['cross-page'], `<div class="grid4">${shots.map((p) => `<figure><img src="${esc(p.screenshot)}" alt="${esc(p.title)}" loading="lazy"><figcaption>${esc(p.title)}<br><code>/${esc(p.slug === 'index' ? '' : p.slug)}</code></figcaption></figure>`).join('')}</div>`));
  if ((brand.palette || []).length) sections.push(section('palette', 'Color palette', ['cross-page'], `<div class="swatches">${brand.palette.map((p) => `<div class="swatch"><div class="chip" style="background:${esc(p.value)}"></div><div class="role">${esc(p.role)}</div><code>${esc(p.value)}</code><div class="meta">${p.occurrences} · ${(p.usedAs || []).map((u) => `<span class="pill">${esc(u)}</span>`).join('')}</div><div class="meta">${(p.sources || []).slice(0, 3).map(esc).join(', ')}</div></div>`).join('')}</div>`));
  if (t.headingFamily) { const hf = t.headingFamily; sections.push(section('typography', 'Typography', ['cross-page', t.scaleAudit ? 'synthesized' : 'observed'], `${t.scaleAudit ? `<p>${badge(t.scaleAudit.kind === 'modular' ? `modular ${t.scaleAudit.matchedScale}` : 'No modular scale')}</p>` : ''}${(hf.sizes || []).map((s, i) => `<div class="specimen"><code>H${i + 1} · ${esc(hf.name)} ${esc((hf.weights || [])[Math.min(i, (hf.weights || []).length - 1)] || '')} / ${esc(s)} / ${esc((hf.lineHeights || [])[Math.min(i, (hf.lineHeights || []).length - 1)] || '')}</code><div style="font-family:var(--display);font-size:${esc(s)};font-weight:${esc((hf.weights || []).slice(-1)[0] || 700)};line-height:${esc((hf.lineHeights || [])[0] || 1.1)}">${esc((v && v.heroHeadline) || site.name || 'Specimen')}</div></div>`).join('')}${t.bodyFamily ? `<div class="specimen"><code>Body · ${esc(t.bodyFamily.name)}</code><p style="font-family:var(--body)">${esc((v && v.firstParagraph) || (v && v.heroSubcopy) || site.tagline || t.bodyFamily.stack)}</p></div>` : ''}${(t.files || []).length ? `<p class="meta">${t.files.length} font file(s) captured · load strategy ${esc(t.loadStrategy || 'n/a')}</p>` : ''}`)); }
  if (v) sections.push(section('voice', 'Voice', ['home-only', 'cross-page', 'inferred'], `${v.tone ? `<p>${badge(`tone guess: ${v.tone.guess}`)} <span class="meta">${esc(v.tone.evidence)}</span></p>` : ''}<div class="cards">${[['Hero headline', v.heroHeadline], ['Tagline', site.tagline], ['First paragraph', v.firstParagraph]].filter(([, x]) => x).map(([l, x]) => `<div class="vcard"><span class="label">${l}</span><p>${esc(x)}</p></div>`).join('')}</div>${vt && vt.ctaFrequency && vt.ctaFrequency.length ? `<h3>CTA frequency</h3><table><tr><th>label</th><th>total</th><th>pages</th></tr>${vt.ctaFrequency.slice(0, 8).map((c) => `<tr><td><span class="pill">${esc(c.label)}</span></td><td>${c.total}</td><td>${c.pageCount}</td></tr>`).join('')}</table>` : ''}${vt && vt.headingFrequency && vt.headingFrequency.length ? `<h3>Repeated headings (≥ 3 pages)</h3><ul class="two">${vt.headingFrequency.map((h) => `<li>H${h.level} ${esc(h.text)} <span class="meta">×${h.total} / ${h.pageCount} pages</span></li>`).join('')}</ul>` : ''}${vt && vt.toneMetrics ? `<div class="stats">${stat(`${vt.toneMetrics.headingsUppercasePercent}%`, 'headings uppercase')}${stat(String(vt.toneMetrics.distinctHeadings), 'distinct headings')}${stat(String(vt.toneMetrics.distinctCtaLabels), 'distinct CTA labels')}</div>` : ''}`));
  sections.push(section('tensions', 'Tensions', ['observed'], tensions.length ? `<div class="tensions">${tensions.map((x) => `<article class="tension"><span class="tag">${esc(x.id)}</span><h4>${esc(x.title)}</h4><p>${esc(x.body)}</p><footer>Source: ${esc(x.source)}</footer></article>`).join('')}</div>` : '<p class="meta">No detector fired — the data was too thin to evaluate, or the site is internally consistent on the 13 mechanical rules.</p>'));
  const occ = (m.borderRadius || {}).occurrences || {};
  if (Object.keys(occ).length || (m.shadows || []).length) sections.push(section('motifs', 'Motifs', ['cross-page'], `<div class="radii">${Object.entries(occ).sort((a, b) => b[1] - a[1]).map(([r, n]) => `<div class="rcard"><div class="box" style="border-radius:${esc(r)}"></div><code>${esc(r)}</code><span class="meta">×${n}${r === (m.borderRadius || {}).primary ? ' · primary' : ''}</span></div>`).join('')}${(m.shadows || []).map((s) => `<div class="rcard"><div class="box shadow" style="box-shadow:${esc(s.value)};background:var(--surface)"></div><code>${esc(s.value)}</code><span class="meta">${esc(s.uses)}</span></div>`).join('')}</div>${(m.gradients || []).length ? `<p class="meta">Gradients: ${m.gradients.map((g) => `<code>${esc(g.value)}</code>`).join(' · ')}</p>` : ''}`));
  const compCounts = {}; for (const p of pages) for (const [k, val] of Object.entries(p.components || {})) if (val && typeof val === 'object' && val.count > 0) compCounts[k] = (compCounts[k] || 0) + val.count;
  if (Object.keys(compCounts).length || (m.patterns || []).length) sections.push(section('components', 'Components', ['cross-page'], `<ul class="lb">${Object.entries(compCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<li><strong>${esc(k)}</strong> <span class="meta">×${n} across pages</span></li>`).join('')}${(m.patterns || []).map((p) => `<li><strong>${esc(p.name)}</strong> <span class="meta">${esc(p.evidence)}</span></li>`).join('')}</ul>`));
  if (brand.crossPromo && brand.crossPromo.detected) sections.push(section('cross-promo', 'Cross-promo reproduction', ['cross-page'], `<div class="promo"><span class="tag">Reproduction · approximate</span><h3>${esc(brand.crossPromo.anchorHeading)}</h3><div class="tiles">${(brand.crossPromo.cluster || []).slice(1).map((x) => `<div class="tile">${esc(x.text)}</div>`).join('')}</div><p class="meta">${brand.crossPromo.pageCount}/${brand.crossPromo.totalPages} pages</p></div>`));
  if ((brand.systemComponents || []).length) sections.push(section('system-components', 'System components', ['cross-page'], `<ul class="lb">${brand.systemComponents.map((s) => `<li><span class="tag">${esc(s.kind)}</span> <strong>${esc(s.name)}</strong> <span class="meta">×${s.occurrences} pages · ${esc(s.exampleSelector || '')}</span>${(s.headingSequence || []).length ? `<div class="meta">${s.headingSequence.map(esc).join(' › ')}</div>` : ''}${(s.ctaLabels || []).length ? `<div>${s.ctaLabels.map((l) => `<span class="pill">${esc(l)}</span>`).join('')}</div>` : ''}</li>`).join('')}</ul>`));
  if (logo) sections.push(section('logo', 'Logo & favicons', ['home-only'], `<div class="logo-row">${logo.localPath || logo.url ? `<img src="${esc(assetHref(logo.localPath, logo.url, outDir))}" alt="captured logo">` : '<div class="meta">no asset</div>'}<dl><dt>Source</dt><dd>${esc(logo.source)}${logo.step ? ` (chain step ${esc(logo.step)})` : ''} · <code>${esc(logo.sourceSelector || '—')}</code></dd><dt>File</dt><dd>${esc(logo.format || '—')}${logo.intrinsicWidth ? ` · ${logo.intrinsicWidth}×${logo.intrinsicHeight} intrinsic` : ''}${logo.renderedWidth ? ` · ${logo.renderedWidth}×${logo.renderedHeight} rendered @1440` : ''}</dd><dt>Variants captured</dt><dd>1 (${esc(logo.source)})</dd><dt>Variants not captured</dt><dd>monochrome, inverted${logo.format === 'svg' ? '' : ', SVG'}</dd>${log && log.favicon ? `<dt>Favicon</dt><dd><code>${esc(log.favicon.url || log.favicon.file)}</code></dd>` : ''}</dl></div>`));
  if (sp.baseUnit || (sp.scale || []).length || Object.keys(occ).length) sections.push(section('spacing', 'Spacing & shape', ['cross-page'], `<p>${badge(sp.baseUnit ? `base unit ${sp.baseUnit}px` : 'no detectable base unit')}${sp.sectionPadding ? ` ${badge(`section padding ${sp.sectionPadding}`)}` : ''}${sp.containerMaxWidth ? ` ${badge(`container ${sp.containerMaxWidth}`)}` : ''}</p>${(sp.scale || []).length ? `<div class="bars">${sp.scale.map((n) => `<div class="bar" style="height:${Math.min(160, n)}px" title="${n}px"><span>${n}</span></div>`).join('')}</div>` : ''}${Object.keys(occ).length ? `<h3>Radii revisited</h3><p>${Object.keys(occ).map((r) => `<span class="pill" style="border-radius:${esc(r)}">${esc(r)}</span>`).join(' ')}</p>` : ''}`));
  const dom = pages.filter((p) => p.embedDominance && p.embedDominance.dominated);
  if (dom.length) sections.push(section('embeds', 'Embed-dominated pages', ['observed'], dom.map((p) => `<div class="vcard"><strong>${esc(p.slug)}</strong> <code>${esc(p.embedDominance.iframeSrc)}</code><p class="meta">primary content lives in a third-party embed — visual style not captured.</p>${p.screenshot ? `<img src="${esc(p.screenshot)}" alt="" loading="lazy">` : ''}</div>`).join('')));
  const read = [`${outDir}/_brand-extraction.json`, ...(pages.length ? [`${outDir}/pages/*.json (${pages.length})`] : []), ...(log ? [`${outDir}/_crawl-log.json`] : [])];
  sections.push(`<footer id="footer"><p>Provenance: this review read ${read.map((r) => `<code>${esc(r)}</code>`).join(', ')}; brand surface written by ${esc(brand._provenance.script || brand._provenance.writtenBy)} at ${esc(brand._provenance.writtenAt)} (mode ${esc(brand._provenance.mode || 'full')}).</p><p>What's next: <code>$stardust direct</code> — resolve a redesign direction; the tensions above are its decision agenda.</p><p class="meta">Badges: observed = frequency-counted across ≥ 3 pages · home-only = one page · cross-page = aggregated over every extracted page · inferred = a judgment call · synthesized = constructed from extracted inputs.</p></footer>`);
  const navIds = sections.map((s) => (s.match(/id="([^"]+)"/) || [])[1]).filter((id) => id && id !== 'masthead');
  const css = `:root{${Object.entries(vars).map(([k, val]) => `${k}:${val}`).join(';')}}*{box-sizing:border-box}body{margin:0;font-family:var(--body);color:var(--text);background:var(--surface);line-height:1.5}h1,h2,h3,h4,.badge,.pill,.tag,th,nav a,.role,.label{font-family:var(--display)${upper ? ';text-transform:uppercase' : ''}}nav.top{position:sticky;top:0;z-index:9;display:flex;flex-wrap:wrap;gap:4px;align-items:center;background:var(--primary-dark);color:#fff;padding:10px 24px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase}nav.top strong{margin-right:16px}nav.top a{color:#fff;text-decoration:none;padding:6px 12px;border-radius:150px}nav.top a:hover{background:rgba(255,255,255,.18)}section,header.masthead,footer#footer{padding:40px 24px;max-width:1280px;margin:0 auto}section{border-top:1px solid var(--border)}.masthead h1{font-size:2.5rem;margin:0}.hero-line{color:var(--accent);font-size:1.5rem;font-family:var(--display);margin:8px 0}.tagline{color:var(--text-muted)}.mark{max-height:48px;display:block;margin-bottom:12px}.badge{display:inline-block;font-size:11px;letter-spacing:1px;padding:2px 8px;border-radius:150px;background:var(--primary);color:#fff;margin-left:6px;vertical-align:middle}.pill{display:inline-block;padding:2px 10px;border-radius:150px;background:var(--surface-alt);border:1px solid var(--border);font-size:12px;margin:2px}.tag{display:inline-block;font-size:11px;letter-spacing:1px;color:var(--accent)}.stats{display:flex;gap:16px;flex-wrap:wrap}.stat{flex:1;min-width:220px;background:var(--surface-alt);padding:20px;border-radius:8px}.stat strong{display:block;font-size:1.4rem;font-family:var(--display)}.fail{color:var(--accent)}.notes{color:var(--text-muted);font-size:.9rem}.grid4{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}@media(min-width:1024px){.grid4{grid-template-columns:repeat(4,1fr)}}figure{margin:0}figure img{width:100%;aspect-ratio:16/10;object-fit:cover;object-position:top;border:1px solid var(--border)}figcaption{font-size:.85rem}.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}.swatch{min-height:200px;background:var(--surface-alt);padding:12px;border-radius:8px}.chip{height:96px;border-radius:6px;border:1px solid var(--border)}.role{text-transform:uppercase;font-size:12px;letter-spacing:1px;margin-top:8px}.meta{color:var(--text-muted);font-size:.85rem}.specimen{margin:16px 0;border-bottom:1px solid var(--border);padding-bottom:12px}.cards{display:grid;gap:12px}.vcard{background:var(--surface-alt);padding:22px;border-radius:8px}.label{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--text-muted)}table{border-collapse:collapse}td,th{padding:6px 12px;border-bottom:1px solid var(--border);text-align:left}.two{columns:2;column-gap:32px}.tensions{display:grid;gap:16px}@media(min-width:720px){.tensions{grid-template-columns:1fr 1fr}}.tension{border-left:4px solid var(--accent);background:var(--surface-alt);padding:16px 20px;border-radius:0 8px 8px 0}.tension h4{margin:4px 0}.tension footer{font-size:.8rem;color:var(--text-muted)}.radii{display:flex;flex-wrap:wrap;gap:16px}.rcard{text-align:center}.box{width:80px;height:80px;background:var(--primary);margin:0 auto 6px}.box.shadow{background:var(--surface);border:1px solid var(--border)}.lb{list-style:none;padding:0}.lb li{border-left:3px solid var(--primary);padding:8px 12px;margin:8px 0}.promo{background:var(--primary-dark);color:#fff;border:4px dashed var(--primary);padding:32px;border-radius:12px}.tiles{display:flex;gap:12px;flex-wrap:wrap}.tile{background:rgba(255,255,255,.12);padding:16px;border-radius:8px}.logo-row{display:flex;gap:32px;align-items:flex-start}.logo-row img{max-width:280px;background:var(--surface-alt);padding:12px}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px}dt{color:var(--text-muted)}.bars{display:flex;gap:12px;align-items:flex-end;height:170px}.bar{width:32px;background:var(--primary);position:relative;border-radius:2px}.bar span{position:absolute;top:-20px;left:0;font-size:11px}@media print{nav.top{position:static}section{break-inside:avoid}}`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<!-- stardust:provenance
  writtenBy:        stardust:extract
  writtenAt:        ${now}
  script:           brand-review.mjs
  readArtifacts:
${read.map((r) => `    - ${r}`).join('\n')}
  synthesizedInputs: []
  mode:             ${brand._provenance.mode || 'full'}
-->
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site.name || 'Current state')} · Current state</title>
${fontLink ? `${fontLink}\n` : ''}<style>${css}</style>
</head>
<body>
<nav class="top"><strong>${esc(site.name || 'Site')} · Current state</strong>${navIds.map((id) => `<a href="#${id}">${esc(id.replace(/-/g, ' '))}</a>`).join('')}</nav>
${sections.join('\n')}
</body>
</html>
`;
  return { html, tensions, notes };
}

function main() {
  let args;
  try { args = parseArgs(process.argv); } catch (e) { console.error(`brand-review: ${e.message}\n\n${HELP}`); process.exit(2); }
  if (args.help) { console.log(HELP); process.exit(0); }
  const src = path.join(args.out, '_brand-extraction.json');
  if (!existsSync(src)) { console.error(`brand-review: ${src} missing — run brand-surface.mjs first; the review never fabricates a brand surface`); process.exit(2); }
  let brand; try { brand = JSON.parse(readFileSync(src, 'utf8')); } catch (e) { console.error(`brand-review: ${src} unreadable: ${e.message}`); process.exit(2); }
  if (!brand || typeof brand !== 'object' || !brand._provenance || typeof brand._provenance !== 'object') { console.error(`brand-review: ${src} has no _provenance — not a stardust brand surface (never invent one)`); process.exit(2); }
  const pagesDir = path.join(args.out, 'pages');
  const pages = existsSync(pagesDir) ? readdirSync(pagesDir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort().map((f) => { try { const r = JSON.parse(readFileSync(path.join(pagesDir, f), 'utf8')); if (!r.slug) r.slug = f.replace(/\.json$/, ''); return r; } catch { return null; } }).filter(Boolean) : [];
  const logPath = path.join(args.out, '_crawl-log.json'); let log = null; if (existsSync(logPath)) { try { log = JSON.parse(readFileSync(logPath, 'utf8')); } catch { log = null; } }
  const homeHtml = path.join(pagesDir, `${pages.some((p) => p.slug === 'index') ? 'index' : 'home'}.html`);
  const fontLink = existsSync(homeHtml) ? ((readFileSync(homeHtml, 'utf8').match(/<link\b[^>]*href=["']https?:\/\/(?:fonts\.googleapis\.com|use\.typekit\.net|fonts\.bunny\.net)[^>]*>/i) || [])[0] || null) : null;
  const { html, tensions, notes } = renderReview(brand, pages, log, { fontLink, outDir: args.out });
  const fired = new Set(tensions.map((x) => x.id));
  for (const id of DETECTOR_IDS) console.log(`${id}: ${fired.has(id) ? 'fired' : 'quiet'}`);
  if (fired.has('T-contrast')) console.log('T-contrast: fired (contextual)');
  for (const n of notes) console.log(`  note: ${n}`);
  const target = path.join(args.out, 'brand-review.html');
  if (args.dryRun) { console.log(`brand-review (dry-run): would write ${target} (${html.length} bytes, ${tensions.length} tension card(s), ${pages.length} page record(s)${fontLink ? ', mirrors the live font <link>' : ''})`); return; }
  writeFileSync(target, html);
  console.log(`brand-review: ${target} ← ${src} (${tensions.length} tension card(s), ${pages.length} page record(s)${fontLink ? ', mirrors the live font <link>' : ', no external font'})`);
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entry === import.meta.url) main();
