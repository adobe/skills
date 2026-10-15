#!/usr/bin/env node
/**
 * skills/reskin/scripts/stream-render.mjs — the generic Phase 4 renderer: any captured content model ×
 * any donor token sheet (Figma or URL donor) × one per-site mapping.json → a reskinned page.
 *
 * Every visible string, href and image URL is interpolated from content-model.json (never retyped);
 * every surface value is a CSS custom property generated from donor-tokens.json (each string leaf,
 * path-named: type.display.fontWeight → --type-display-font-weight; a missing token falls back to a
 * neutral default). Output follows the renderer contract the gates and the canon bridge read:
 * .site-header / .site-main / .site-footer (data-canon="header|footer", data-template on main), one
 * <section data-slot="sNN" [data-module]> per content-model slot with its stream in [data-slot-body],
 * page resets in :where() so a lifted canon never outranks block CSS, the primary button `.btn` inside
 * main (2nd+ button of a slot: `.btn btn-secondary`), heading alignment from type.display.textAlign
 * (default left). An unknown stream node kind throws — extend the renderer, never drop content.
 *
 * Images are hot-linked to the source by default (the gates compare host+path). --localize-images
 * downloads each one to <dir>/prototypes/assets/img/<host>/<path> (the migrate bundler's root), writes
 * src relative to --out and keeps data-source-src="<original>" — dom-equality and slot-coverage match
 * on it, so the gates hold on a localized page. A failed download keeps the remote src and is listed.
 *
 * mapping.json (the only per-site input):
 *   { "chrome": { "model": "<dir holding a content-model.json>", "header": ["s01"], "footer": ["s03"] },
 *     "pages": { "<slug>": { "template": "<archetype slug>",
 *       "slots": { "s01": { "module": "M2", "layout": "stack|grid-2|media-band[ grid-2]", "width": "narrow|wide" } } } } }
 *
 * Usage:
 *   node stream-render.mjs <slug> [--dir stardust] [--mapping <dir>/reskin/mapping.json]
 *     [--out <dir>/reskin/pages/<slug>.html] [--localize-images]
 *
 * Reads:  <dir>/reskin/content-model/<slug>/content-model.json, <dir>/reskin/donor-tokens.json,
 *         the mapping, the chrome model when mapped.
 * Writes: --out (parent dirs created); with --localize-images also <dir>/prototypes/assets/img/**.
 * Exit:   0 rendered, 1 render error (unknown node kind, label round-trip), 2 setup error.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HELP = `usage: node stream-render.mjs <slug> [--dir stardust] [--mapping <file>] [--out <file>] [--localize-images]

Render one page from <dir>/reskin/content-model/<slug>/content-model.json with the donor tokens in
<dir>/reskin/donor-tokens.json and the slot mapping in <dir>/reskin/mapping.json.
  --dir <d>            stardust state dir (default stardust)
  --mapping <file>     mapping.json (default <dir>/reskin/mapping.json)
  --out <file>         output HTML (default <dir>/reskin/pages/<slug>.html); to hand off to migrate,
                       write <dir>/prototypes/<slug>-proposed.html
  --localize-images    download images to <dir>/prototypes/assets/img/ and keep data-source-src
Exit 0 rendered, 1 render error, 2 setup error.`;

class SetupError extends Error {}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const url = (n) => esc(n.absHref || n.href);
const SKIP = new Set(['donor', 'curatedFrom', 'note', 'nodeRefs', 'coverage', 'motifs', '_provenance', 'familyNote']);

// Every string leaf of the donor sheet becomes a path-named CSS custom property (type.display.fontWeight →
// --type-display-font-weight). Pure; exported for tests.
export function tokenVars(tokens) {
  const vars = [];
  (function walk(o, path) {
    for (const [k, val] of Object.entries(o || {})) {
      if (SKIP.has(k)) continue;
      const p = [...path, k];
      if (val && typeof val === 'object' && !Array.isArray(val)) walk(val, p);
      else if (typeof val === 'string') vars.push([`--${p.join('-').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`, val]);
    }
  })(tokens, []);
  return vars;
}

// Pure: one page's HTML. resolveImg(url) → { src, source? } lets the CLI localize; the default hot-links.
export function render({ slug, model, tokens, mapping, chromeModel = null, now = new Date().toISOString(), resolveImg = (u) => ({ src: u }) }) {
  const pageMap = mapping?.pages?.[slug];
  if (!pageMap) throw new SetupError(`mapping.json has no pages.${slug}`);
  const vars = tokenVars(tokens);
  const has = (name) => vars.some(([n]) => n === name);
  const v = (name, fallback) => (has(name) ? `var(${name})` : fallback);
  const images = [];
  const img = (u) => {
    if (u && !images.includes(u)) images.push(u);
    const r = resolveImg(u || '');
    return `src="${esc(r.src)}"${r.source ? ` data-source-src="${esc(r.source)}"` : ''}`;
  };
  let uid = 0;

  // ---- the ordered stream → HTML -----------------------------------------------------------------------
  // A trailing required marker ("Email *", "Email*") is styled, never edited; the parse must round-trip.
  function labelHtml(text) {
    const m = text.match(/^(.*?)(\s?)\*$/);
    const out = m ? `${esc(m[1])}${m[2]}<span class="req">*</span>` : esc(text);
    if (unesc(out) !== text) throw new Error(`label parse lost text: ${JSON.stringify(text)}`);
    return out;
  }
  function controlHtml(n, id) {
    const name = n.name ? ` name="${esc(n.name)}"` : '';
    if (n.control === 'select') {
      const opts = Array.isArray(n.options) ? n.options : String(n.text || '').split('\n');
      return `<select id="${id}"${name}>${opts.map((o) => `<option>${esc(typeof o === 'string' ? o : o.text)}</option>`).join('')}</select>`;
    }
    if (n.control === 'textarea') return `<textarea id="${id}"${name}${n.placeholder ? ` placeholder="${esc(n.placeholder)}"` : ''}>${esc(n.text)}</textarea>`;
    const type = n.inputType || 'text';
    const val = n.value && /checkbox|radio|submit|button/.test(type) ? ` value="${esc(n.value)}"` : '';
    return `<input id="${id}" type="${esc(type)}"${name}${n.placeholder ? ` placeholder="${esc(n.placeholder)}"` : ''}${val}>`;
  }
  const isButtonish = (n) => n.kind === 'cta' && /\b(btn|button)\b/i.test(n.classes || '');
  function inlineHtml(nodes) {
    return nodes.map((n) => {
      const sep = n.sep ?? '';
      if (n.kind === 'cta') return `${sep}<a class="link" href="${url(n)}">${n.children ? inlineHtml(n.children) : esc(n.text)}</a>`;
      if (n.children) return `${sep}${inlineHtml(n.children)}`;
      return `${sep}${esc(n.text)}`;
    }).join('');
  }
  // The first button of a slot is primary; later ones take the donor's secondary spec (when it exists).
  const btnClass = (ctx) => (ctx.buttons++ === 0 ? 'btn' : 'btn btn-secondary');
  function streamHtml(ordered, ctx) {
    const out = [];
    for (let i = 0; i < ordered.length; i++) {
      const n = ordered[i]; const next = ordered[i + 1];
      switch (n.kind) {
        case 'heading': out.push(`<${n.level || 'h2'} class="heading">${esc(n.text)}</${n.level || 'h2'}>`); break;
        case 'paragraph': out.push(`<p class="${n.children?.some((c) => c.kind === 'cta') ? 'aux' : 'lead'}">${n.children ? inlineHtml(n.children) : esc(n.text)}</p>`); break;
        case 'listItem': {
          const items = [n]; while (ordered[i + 1]?.kind === 'listItem') items.push(ordered[++i]);
          out.push(`<ul class="list">${items.map((li) => `<li>${li.children ? inlineHtml(li.children) : esc(li.text)}</li>`).join('')}</ul>`); break;
        }
        case 'cta':
          out.push(isButtonish(n) ? `<div class="actions"><a class="${btnClass(ctx)}" href="${url(n)}">${esc(n.text)}</a></div>`
            : `<p class="aux"><a class="link" href="${url(n)}">${n.children ? inlineHtml(n.children) : esc(n.text)}</a></p>`); break;
        case 'image':
          if (ctx.band && !ctx.bandImage) ctx.bandImage = n; else out.push(`<figure class="media"><img ${img(n.currentSrc || n.src)} alt="${esc(n.alt)}"></figure>`); break;
        case 'formControl': {
          const id = `f${++uid}`;
          if (/checkbox|radio/.test(n.inputType || '') && next && (next.kind === 'text' || next.kind === 'cta')) {
            const txt = next.kind === 'cta' ? `<a class="link" href="${url(next)}">${esc(next.text)}</a>` : esc(next.text);
            out.push(`<div class="check">${controlHtml(n, id)}<label for="${id}">${txt}</label></div>`); i++;
          } else if (/submit|button/.test(n.inputType || '')) out.push(`<div class="actions"><button class="${btnClass(ctx)}" type="submit">${esc(n.value || n.text)}</button></div>`);
          else out.push(`<div class="field">${controlHtml(n, id)}</div>`);
          break;
        }
        case 'text':
          if (n.parentTag === 'label' && next?.kind === 'formControl' && !/checkbox|radio/.test(next.inputType || '')) {
            const id = `f${++uid}`; out.push(`<div class="field"><label for="${id}">${labelHtml(n.text)}</label>${controlHtml(next, id)}</div>`); i++;
          } else if (n.parentTag === 'button') out.push(`<div class="actions"><button class="${btnClass(ctx)}" type="submit">${esc(n.text)}</button></div>`);
          else out.push(`<p class="text">${esc(n.text)}</p>`);
          break;
        default: throw new Error(`unhandled stream node kind "${n.kind}" in ${slug} — extend stream-render, never drop content`);
      }
    }
    return out.join('\n        ');
  }

  // ---- chrome (donor shell carrying the source's links: a declared delta, outside the content gate) -----
  function chromeHtml(ids, role) {
    if (!chromeModel) return '';
    const slots = ids.map((id) => chromeModel.sections.find((s) => s.slot === id)).filter(Boolean);
    if (role === 'header') {
      return slots.map((s) => `<div class="chrome-row"><div class="container">
      ${s.images.map((im) => `<img class="logo" ${img(im.currentSrc || im.src)} alt="${esc(im.alt)}">`).join('')}
      <nav>${s.ctas.map((c) => `<a href="${url(c)}">${esc(c.text)}</a>`).join('')}</nav>
    </div></div>`).join('\n  ');
    }
    return slots.map((s) => {
      const texts = s.paragraphs.map((p) => (typeof p === 'string' ? p : p.text)).filter((t) => !s.ctas.some((c) => c.text === t));
      return `<div class="container chrome-footer">
      <div>${s.images.map((im) => `<img class="logo" ${img(im.currentSrc || im.src)} alt="${esc(im.alt)}">`).join('')}${texts.map((t) => `<p>${esc(t)}</p>`).join('')}</div>
      <ul>${s.ctas.map((c) => `<li><a href="${url(c)}">${esc(c.text)}</a></li>`).join('')}</ul>
    </div>`;
    }).join('\n  ');
  }

  // ---- page -------------------------------------------------------------------------------------------
  const sections = model.sections.map((s, i) => {
    const m = pageMap.slots?.[s.slot] || {};
    const layout = (m.layout || 'stack').split(/\s+/);
    const ctx = { band: layout.includes('media-band'), bandImage: null, buttons: 0 };
    const inner = streamHtml(s.ordered, ctx);
    const cls = ['band', ...layout.map((l) => `layout-${l}`), `width-${m.width || 'narrow'}`].join(' ');
    return `<section class="${cls}" data-slot="${esc(s.slot || `s${String(i + 1).padStart(2, '0')}`)}"${m.module ? ` data-module="${esc(m.module)}"` : ''}>
      ${ctx.bandImage ? `<img class="band-img" ${img(ctx.bandImage.currentSrc || ctx.bandImage.src)} alt="${esc(ctx.bandImage.alt)}">` : ''}
      <div class="container"><div class="panel"><div class="flow" data-slot-body>
          ${inner}
      </div></div></div>
    </section>`;
  });
  const md = model.metadata || {};
  const metaTags = [
    md.description != null ? `<meta name="description" content="${esc(md.description)}">` : '',
    md.canonical ? `<link rel="canonical" href="${esc(md.canonical)}">` : '',
    ...Object.entries(md.ogTags || {}).map(([k, val]) => `<meta property="${esc(k)}" content="${esc(val)}">`),
    ...Object.entries(md.twitterTags || {}).map(([k, val]) => `<meta name="${esc(k)}" content="${esc(val)}">`),
    ...(md.jsonLd || []).map((j) => `<script type="application/ld+json">${typeof j === 'string' ? j : JSON.stringify(j)}</script>`),
    md.favicon ? `<link rel="icon" href="${esc(md.favicon)}">` : '',
  ].filter(Boolean).join('\n');

  const css = `:root {
  ${vars.map(([n, val]) => `  ${n}: ${val};`).join('\n')}
  }
  :where(.site-header, .site-main, .site-footer), :where(.site-header, .site-main, .site-footer) *, :where(.site-header, .site-main, .site-footer) *::before, :where(.site-header, .site-main, .site-footer) *::after { box-sizing: border-box; }
  body:has(> .site-header, > .site-main, > .site-footer) { margin: 0; background: ${v('--palette-page-bg', '#fff')}; color: ${v('--palette-body-fg', 'inherit')}; font-family: ${v('--type-family', 'sans-serif')}; font-size: ${v('--type-body-font-size', '16px')}; line-height: ${v('--type-body-line-height', '1.5')}; }
  .container { max-width: ${v('--layout-container-max-width', '1200px')}; margin: 0 auto; padding: ${v('--layout-container-padding', '0 24px')}; }
  :where(.site-header, .site-main, .site-footer) a { color: inherit; }
  .link { color: ${v('--palette-accent', 'inherit')}; text-decoration: underline; }
  :where(.site-header, .site-main, .site-footer) img { max-width: 100%; height: auto; }
  .site-header .chrome-row { border-bottom: 1px solid ${v('--palette-light-band-bg', '#eee')}; }
  .site-header .chrome-row .container { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 56px; flex-wrap: wrap; }
  .site-header nav { display: flex; gap: 16px; flex-wrap: wrap; margin-left: auto; }
  .site-header nav a { text-decoration: none; }
  .logo { height: 32px; width: auto; }
  .site-main section { position: relative; padding-top: ${v('--layout-section-padding-y', '64px')}; padding-bottom: ${v('--layout-section-padding-y', '64px')}; }
  .site-main .layout-media-band { background: ${v('--palette-light-band-bg', 'transparent')}; overflow: hidden; }
  .site-main .band-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .site-main .panel { position: relative; }
  .site-main .layout-media-band .panel { background: ${v('--palette-page-bg', '#fff')}; border-radius: ${v('--radii-card', '0')}; padding: 40px; }
  .site-main .width-narrow .panel { max-width: 550px; }
  .site-main .layout-grid-2 .flow { display: grid; grid-template-columns: 1fr 1fr; column-gap: 24px; }
  .site-main .layout-grid-2 .flow > :not(.field) { grid-column: 1 / -1; }
  .site-main h1, .site-main h2, .site-main h3, .site-main h4 { font-family: ${v('--type-display-font-family', 'inherit')}; font-weight: ${v('--type-display-font-weight', '700')}; color: ${v('--palette-heading-fg', 'inherit')}; margin: 0 0 24px; }
  .site-main .heading { font-size: ${v('--type-display-font-size', '2em')}; line-height: ${v('--type-display-line-height', '1.2')}; text-align: ${v('--type-display-text-align', 'left')}; }
  .site-main p { margin: 0 0 16px; }
  .site-main .field { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
  .site-main .field label { font-weight: ${v('--type-label-font-weight', '600')}; }
  .site-main .req { color: ${v('--palette-accent', 'inherit')}; }
  .site-main input:not([type=checkbox]):not([type=radio]), .site-main select, .site-main textarea { font: inherit; min-height: 48px; padding: 0 16px; width: 100%; border: 1px solid ${v('--palette-light-band-bg', '#ccc')}; border-radius: ${v('--radii-control', '4px')}; color: inherit; background: ${v('--palette-page-bg', '#fff')}; }
  .site-main .check { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
  .site-main .check input { width: 20px; height: 20px; accent-color: ${v('--palette-accent', 'auto')}; }
  .site-main .actions { margin: 24px 0 0; }
  .site-main .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 40px; background: ${v('--buttons-primary-background', 'currentColor')}; color: ${v('--buttons-primary-color', '#fff')}; border: ${v('--buttons-primary-border', '0')}; border-radius: ${v('--buttons-primary-border-radius', '4px')}; padding: ${v('--buttons-primary-padding', '8px 16px')}; font-family: inherit; font-size: ${v('--buttons-primary-font-size', 'inherit')}; font-weight: ${v('--buttons-primary-font-weight', '700')}; text-decoration: none; cursor: pointer; }
  .site-main .btn-secondary { background: ${v('--buttons-secondary-background', 'transparent')}; color: ${v('--buttons-secondary-color', 'inherit')}; border: ${v('--buttons-secondary-border', '1px solid currentColor')}; }
  .site-main .width-narrow .btn { width: 100%; }

  .site-main .list { padding-left: 1.2em; }
  .site-footer { padding: 48px 0; }
  .site-footer .chrome-footer { display: grid; grid-template-columns: 1fr 2fr; gap: 40px; }
  .site-footer ul { list-style: none; margin: 0; padding: 0; columns: 2; }
  .site-footer li { margin-bottom: 16px; }
  .site-footer a { text-decoration: none; }
  @media (max-width: 900px) {
    .site-main .layout-grid-2 .flow { grid-template-columns: 1fr; }
    .site-footer .chrome-footer { grid-template-columns: 1fr; }
  }
  @media (max-width: 640px) {
    .site-main section { padding-top: 24px; padding-bottom: 24px; }
    .site-main .layout-media-band .panel { padding: 24px; }
    .site-footer ul { columns: 1; }
  }`;

  const html = `<!doctype html>
<html lang="${esc(md.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(md.title)}</title>
${metaTags}
<style>
${css}
</style>
<!-- stardust:prototype
  writtenBy:        stardust:reskin/stream-render
  writtenAt:        ${now}
  page:             ${slug}
  pageUrl:          ${md.canonical || ''}
  template:         ${pageMap.template || slug}
  readArtifacts:
    - reskin/content-model/${slug}/content-model.json
    - reskin/donor-tokens.json
    - reskin/mapping.json${mapping.chrome?.model ? `\n    - ${mapping.chrome.model}/content-model.json` : ''}
  unsourcedContent: []
-->
</head>
<body>
<header class="site-header" data-canon="header">
  ${chromeHtml(mapping.chrome?.header || [], 'header')}
</header>
<main class="site-main" data-template="${esc(pageMap.template || slug)}">
  ${sections.join('\n  ')}
</main>
<footer class="site-footer" data-canon="footer">
  ${chromeHtml(mapping.chrome?.footer || [], 'footer')}
</footer>
</body>
</html>
`;
  return { html, images, slots: model.sections.length, vars: vars.length };
}

// ---- image localization (CLI) -------------------------------------------------------------------------
// <host>/<path> under img/, query dropped, unsafe characters folded; an extensionless URL takes an
// extension from its content type. Pure; exported for tests.
export function localSubpath(u, contentType = '') {
  const x = new URL(u);
  const clean = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
  const parts = decodeURIComponent(x.pathname).split('/').filter(Boolean).map(clean);
  let file = parts.pop() || 'index';
  if (!/\.[a-z0-9]{2,5}$/i.test(file)) {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' }[contentType.split(';')[0].trim()];
    if (ext) file = `${file}.${ext}`;
  }
  return posix.join('img', clean(x.hostname), ...parts, file);
}

// Bot-managed CDNs 403 a bare fetch: send the shared live-session real-Chrome UA + headers and the page as
// Referer. live-session.mjs is the diff skill's (plugin tree or project-copy layout), loaded only here.
async function browserHeaders(referer) {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs'].map((p) => resolve(here, p)).find((p) => existsSync(p));
  const h = { Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8', ...(referer ? { Referer: referer } : {}) };
  if (!file) return h;
  const { REAL_CHROME_UA, standardHeaders } = await import(pathToFileURL(file).href);
  const { Accept, 'Upgrade-Insecure-Requests': _u, ...rest } = standardHeaders();
  return { 'User-Agent': REAL_CHROME_UA, ...rest, ...h };
}

async function localize(urls, assetsDir, referer) {
  const map = new Map(); const failed = [];
  const headers = await browserHeaders(referer);
  for (const u of urls) {
    if (!/^https?:/i.test(u)) continue;
    try {
      const res = await fetch(u, { redirect: 'follow', headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const file = join(assetsDir, ...localSubpath(u, res.headers.get('content-type') || '').split('/'));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      map.set(u, file);
    } catch (e) { failed.push({ url: u, why: e.message }); }
  }
  return { map, failed };
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  const flag = (n, d) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : d; };
  const slug = argv[0];
  if (!slug || slug.startsWith('--')) { console.error(HELP); return 2; }
  const dir = flag('--dir', 'stardust');
  const readJson = (p, what) => {
    if (!existsSync(p)) throw new SetupError(`missing ${what}: ${p}`);
    return JSON.parse(readFileSync(p, 'utf8'));
  };
  const mapping = readJson(flag('--mapping', join(dir, 'reskin', 'mapping.json')), 'mapping.json');
  const model = readJson(join(dir, 'reskin', 'content-model', slug, 'content-model.json'), `content model for ${slug}`);
  const tokens = readJson(join(dir, 'reskin', 'donor-tokens.json'), 'donor-tokens.json');
  const chromeModel = mapping.chrome?.model ? readJson(join(mapping.chrome.model, 'content-model.json'), 'chrome content model') : null;
  const out = resolve(flag('--out', join(dir, 'reskin', 'pages', `${slug}.html`)));
  const input = { slug, model, tokens, mapping, chromeModel };

  let result = render(input);
  if (argv.includes('--localize-images')) {
    const assetsDir = resolve(dir, 'prototypes', 'assets');
    const loc = await localize(result.images, assetsDir, model.metadata?.canonical || model.url || undefined);
    const rel = (file) => relative(dirname(out), file).split(sep).join('/');
    result = render({ ...input, resolveImg: (u) => (loc.map.has(u) ? { src: rel(loc.map.get(u)), source: u } : { src: u }) });
    console.log(`localized ${loc.map.size}/${result.images.length} image(s) → ${relative(process.cwd(), assetsDir)}/img/`);
    for (const f of loc.failed) console.error(`WARN image kept remote: ${f.url} (${f.why})`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, result.html);
  console.log(`rendered ${slug} → ${relative(process.cwd(), out)} (${result.slots} slot(s), ${result.vars} token vars)`);
  if (!existsSync(join(dir, 'reskin', 'mapping.md'))) console.error('note: reskin/mapping.md (the human mapping brief) is missing — Phase 3 requires it');
  return 0;
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && safeRealpath(fileURLToPath(import.meta.url)) === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.error(`stream-render: ${e.message}`);
    process.exit(e instanceof SetupError ? 2 : 1);
  });
}
