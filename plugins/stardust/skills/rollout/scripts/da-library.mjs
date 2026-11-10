#!/usr/bin/env node
/**
 * rollout/da-library.mjs — publish the site's OWN block library to Document Authoring (#159), so authors insert
 * the blocks and templates the migration shipped instead of an inherited or empty library.
 *
 *   node da-library.mjs [--org <org>] [--site <site>] [--ref main] [--content content] [--blocks-dir blocks]
 *        [--coverage stardust/rollout/coverage] [--template <name>=<delivered path> ...]
 *        [--out stardust/rollout/library] [--dry-run] [--no-preview] [--token-env DA_TOKEN | --token-file <path>]
 *
 * Reads the authored DA bodies under --content (the files deploy PUT). With rollout's coverage, only delivered pages
 * (status deployed | verified), each template's representative page first; without it, every content file except
 * the chrome documents (nav, footer, nav-*, footer-*) and library/. --org / --site default to stardust/rollout/rollout.json `site.da`.
 *   blocks     one document per block (library/blocks/<name>): the first authored instance of every class
 *              combination (`cards dark` → the variant "cards (dark)"), one section each, followed by a
 *              library-metadata block (description = where it is used). Skipped: metadata, section-metadata,
 *              library-metadata, template-metadata, and a name with no blocks/<name>/ folder when --blocks-dir exists.
 *   templates  one document per template (library/templates/<id>): the representative page's body, its metadata
 *              block renamed template-metadata (DA turns it back into metadata on insert) with the page-specific
 *              values (Title, Description, Image, JSON-LD, Keywords, canonical, og:/twitter: title, description, image, url)
 *              emptied.
 *              --template adds or overrides one (name=/delivered/path); repeatable.
 *   sheets     library/blocks.json (name, path) and library/templates.json (key, value), paths on content.da.live.
 *   config     the `library` tab of the site config (admin.da.live/config/<org>/<site>/): the Blocks and Templates
 *              rows are replaced, every other row and every other tab is kept (a single-sheet config becomes a
 *              multi-sheet one with its sheet intact).
 * Writes <out>/{blocks/*.html, templates/*.html, blocks.json, templates.json, library-rows.json} always; without
 * --dry-run also PUTs the documents and sheets, previews the documents (never publishes: the library is an authoring
 * aid, not site content) and writes the merged config. Idempotent: every write replaces the previous one.
 *
 * Token: the variable named by --token-env (default DA_TOKEN) or --token-file; never printed. An expired JWT exits 3
 * before any request; a 401 exits 3. Exit 0 done; 1 a write failed or the config was not readable/writable (the rows
 * to add by hand are printed); 2 usage.
 */
/* eslint-disable no-await-in-loop, no-restricted-syntax, max-len */
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- pure part ------------------------------------------------------------------------------------------------

/** Top-level `<div …>…</div>` spans of an HTML fragment (comments ignored). Pure. */
export function topDivs(html) {
  const src = String(html).replace(/<!--[\s\S]*?-->/g, '');
  const out = []; let depth = 0; let start = -1; let open = '';
  for (const m of src.matchAll(/<(\/?)div\b[^>]*>/gi)) {
    if (!m[1]) { if (depth === 0) { start = m.index; [open] = m; } depth += 1; } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) { out.push({ open, html: src.slice(start, m.index + m[0].length), inner: src.slice(start + open.length, m.index) }); start = -1; }
    }
  }
  return out;
}

/** The inside of <main> (else of <body>, else the whole string). Pure. */
export function mainInner(html) {
  const s = String(html);
  const m = s.match(/<main\b[^>]*>([\s\S]*)<\/main>/i) || s.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  return m ? m[1] : s;
}

const classOf = (open) => { const m = open.match(/\bclass\s*=\s*"([^"]*)"/i) || open.match(/\bclass\s*=\s*'([^']*)'/i); return m ? m[1].trim().split(/\s+/).filter(Boolean) : []; };
export const SKIP = new Set(['metadata', 'section-metadata', 'library-metadata', 'template-metadata']);

/** Every authored block of a DA body, in order: { name, variants: [..], html }. Pure. */
export function blocksOf(html) {
  const out = [];
  for (const section of topDivs(mainInner(html))) {
    for (const child of topDivs(section.inner)) {
      const [name, ...variants] = classOf(child.open);
      if (name && !SKIP.has(name)) out.push({ name, variants, html: child.html });
    }
  }
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const body = (sections) => `<body>\n<header></header>\n<main>\n${sections.map((s) => `<div>\n${s}\n</div>`).join('\n')}\n</main>\n<footer></footer>\n</body>\n`;
const libraryMetadata = (description) => `<div class="library-metadata">\n  <div><div>description</div><div>${esc(description)}</div></div>\n</div>`;

/**
 * Distinct block instances across pages ({ path, html } in priority order): the first instance of each class
 * combination, plus the pages each block name is used on. `known` (a Set of block folder names) filters stray
 * classes when given. Pure.
 */
export function collectBlocks(pages, known = null) {
  const byName = new Map();
  for (const { path, html } of pages) {
    for (const b of blocksOf(html)) {
      if (known && !known.has(b.name)) continue;
      if (!byName.has(b.name)) byName.set(b.name, { name: b.name, variants: new Map(), pages: [] });
      const e = byName.get(b.name);
      if (!e.pages.includes(path)) e.pages.push(path);
      const key = [...b.variants].sort().join(' ');
      if (!e.variants.has(key)) e.variants.set(key, { variants: b.variants, html: b.html, from: path, pages: new Set() });
      e.variants.get(key).pages.add(path);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The library document of one collected block. Pure. */
export function blockDoc(block) {
  const sections = [...block.variants.values()].map((v) => {
    const label = v.variants.length ? `${block.name} (${v.variants.join(', ')})` : block.name;
    const used = v.pages.size;
    return `${v.html}\n${libraryMetadata(`${label}: as authored on ${v.from}; used on ${used} page${used === 1 ? '' : 's'}.`)}`;
  });
  return body(sections);
}

const PAGE_SPECIFIC = /^(title|description|image|json-ld|keywords|canonical|(og|twitter):(title|description|image.*|url))$/i;
/** A delivered page body → a template document: metadata → template-metadata, page-specific values emptied. Pure. */
export function templateDoc(html) {
  const inner = mainInner(html);
  const sections = topDivs(inner).map((section) => {
    let out = section.inner;
    for (const child of topDivs(section.inner)) {
      if (classOf(child.open)[0] !== 'metadata') continue;
      const rows = topDivs(child.inner).map((row) => {
        const cells = topDivs(row.inner);
        if (cells.length < 2) return row.html;
        const key = cells[0].inner.replace(/<[^>]+>/g, '').trim();
        return PAGE_SPECIFIC.test(key) ? `<div>${cells[0].html}<div></div></div>` : row.html;
      });
      out = out.replace(child.html, `<div class="template-metadata">\n  ${rows.join('\n  ')}\n</div>`);
    }
    return out.trim();
  });
  return body(sections);
}

/** A DA sheet document. Pure. */
export const sheet = (rows) => ({ total: rows.length, limit: rows.length, offset: 0, data: rows, ':type': 'sheet' });

/** The author-facing name of a template id (`products-itsm-html` → `Products itsm`). Pure. */
export const templateName = (t) => t.label || t.type || (String(t.id).replace(/-html?$/, '').replace(/[-_]+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase()) || String(t.id));

/** A safe document name for a library entry. Pure. */
export const docName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';

const OURS = new Set(['blocks', 'templates']);
/**
 * Merge the library rows into a site config (the JSON admin.da.live/config returns, or null): only the rows titled
 * Blocks / Templates in the `library` tab are replaced; other rows and other tabs are kept. Pure.
 */
export function mergeLibraryConfig(existing, rows) {
  const cfg = existing && typeof existing === 'object' && Object.keys(existing).length ? JSON.parse(JSON.stringify(existing)) : null;
  let multi;
  if (!cfg) multi = { ':names': [], ':version': 3, ':type': 'multi-sheet' };
  else if (cfg[':type'] === 'multi-sheet') multi = cfg;
  else {
    const name = cfg[':sheetname'] || 'data';
    const { ':type': t, ':sheetname': n, ...rest } = cfg;
    multi = { [name]: rest, ':names': [name], ':version': 3, ':type': 'multi-sheet' };
  }
  multi[':names'] = Array.isArray(multi[':names']) ? multi[':names'] : [];
  const kept = ((multi.library && multi.library.data) || []).filter((r) => !OURS.has(String(r.title || '').trim().toLowerCase()));
  const data = [...rows, ...kept];
  multi.library = { ...(multi.library || {}), total: data.length, limit: data.length, offset: 0, data };
  if (!multi[':names'].includes('library')) multi[':names'].push('library');
  return multi;
}

/** Content file of a delivered path under the content dir (`/` → index.html). Pure path logic, checks existence. */
export function contentFile(root, p) {
  const rel = p === '/' || p === '' ? 'index' : p.replace(/^\/|\/$/g, '');
  for (const c of [`${rel}.html`, `${rel}/index.html`]) { const f = join(root, c); if (existsSync(f) && statSync(f).isFile()) return f; }
  return null;
}

// ---- CLI ------------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const a = { ref: 'main', content: 'content', blocksDir: 'blocks', coverage: join('stardust', 'rollout', 'coverage'), out: join('stardust', 'rollout', 'library'), templates: [], dryRun: false, preview: true };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i]; const next = () => { i += 1; if (argv[i] === undefined) throw new Error(`${k} needs a value`); return argv[i]; };
    if (k === '--org') a.org = next(); else if (k === '--site') a.site = next(); else if (k === '--ref') a.ref = next();
    else if (k === '--content') a.content = next(); else if (k === '--blocks-dir') a.blocksDir = next();
    else if (k === '--coverage') a.coverage = next(); else if (k === '--out') a.out = next();
    else if (k === '--template') { const v = next(); const j = v.indexOf('='); if (j < 1) throw new Error('--template takes <name>=<delivered path>'); a.templates.push({ name: v.slice(0, j), path: v.slice(j + 1) }); }
    else if (k === '--dry-run') a.dryRun = true; else if (k === '--no-preview') a.preview = false;
    else if (k === '--token-env') a.tokenEnv = next(); else if (k === '--token-file') a.tokenFile = next();
    else throw new Error(`unknown arg: ${k}`);
  }
  return a;
}

const readJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const write = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const f = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(f)); else if (e.name.endsWith('.html')) out.push(f);
  }
  return out;
}

/** Pages in priority order and the templates, from coverage when present, else from the content tree. */
function sources(a) {
  const pagesDoc = readJSON(join(a.coverage, 'pages.json'));
  const tplDoc = readJSON(join(a.coverage, 'templates.json'));
  const pages = []; const templates = [];
  if (pagesDoc && Array.isArray(pagesDoc.pages)) {
    const delivered = pagesDoc.pages.filter((p) => p.path && p.delivery && ['deployed', 'verified'].includes(p.delivery.status));
    const bySlug = new Map(delivered.map((p) => [p.slug, p]));
    const reps = ((tplDoc && tplDoc.templates) || []).map((t) => ({ t, page: bySlug.get(t.representativeSlug) })).filter((x) => x.page);
    const order = [...reps.map((x) => x.page), ...delivered.filter((p) => !reps.some((x) => x.page === p))];
    for (const p of order) { const f = contentFile(a.content, p.path); if (f) pages.push({ path: p.path, file: f }); }
    for (const { t, page } of reps) templates.push({ name: templateName(t), path: page.path });
  } else if (existsSync(a.content)) {
    for (const f of walk(a.content).sort()) {
      const rel = relative(a.content, f).replace(/\\/g, '/').replace(/\.html$/, '');
      if (/^library\/|(^|\/)(nav|footer)(-[^/]*)?$/.test(rel)) continue;
      pages.push({ path: rel === 'index' ? '/' : `/${rel.replace(/\/index$/, '/')}`, file: f });
    }
  }
  for (const t of a.templates) {
    const i = templates.findIndex((x) => docName(x.name) === docName(t.name));
    if (i >= 0) templates[i] = t; else templates.push(t);
  }
  return { pages, templates };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    console.log(src.match(/\/\*\*[\s\S]*?\*\//)[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim());
    return 0;
  }
  let a;
  try { a = parseArgs(argv); } catch (e) { console.error(`da-library: ${e.message} (--help for usage)`); return 2; }
  const cfg = readJSON(join('stardust', 'rollout', 'rollout.json'));
  const da = (cfg && cfg.site && cfg.site.da) || {};
  a.org ||= da.org; a.site ||= da.site; if (!argv.includes('--ref') && da.ref) a.ref = da.ref;
  if (!a.org || !a.site) { console.error('da-library: --org and --site are required (or site.da in stardust/rollout/rollout.json)'); return 2; }
  if (!existsSync(a.content)) { console.error(`da-library: content dir ${a.content} missing — run after deploy has authored the pages`); return 2; }

  const { pages, templates } = sources(a);
  const known = existsSync(a.blocksDir) ? new Set(readdirSync(a.blocksDir).filter((n) => statSync(join(a.blocksDir, n)).isDirectory())) : null;
  const blocks = collectBlocks(pages.map((p) => ({ path: p.path, html: readFileSync(p.file, 'utf8') })), known);
  const base = `https://content.da.live/${a.org}/${a.site}/library`;
  const docs = [];
  for (const b of blocks) docs.push({ path: `library/blocks/${docName(b.name)}`, html: blockDoc(b) });
  const tplRows = [];
  for (const t of templates) {
    const f = contentFile(a.content, t.path);
    if (!f) { console.error(`da-library: template ${t.name}: no content file for ${t.path} — skipped`); continue; }
    docs.push({ path: `library/templates/${docName(t.name)}`, html: templateDoc(readFileSync(f, 'utf8')) });
    tplRows.push({ key: t.name, value: `${base}/templates/${docName(t.name)}` });
  }
  const blockRows = blocks.map((b) => ({ name: b.name, path: `${base}/blocks/${docName(b.name)}` }));
  const rows = [{ title: 'Blocks', path: `${base}/blocks.json` }, ...(tplRows.length ? [{ title: 'Templates', path: `${base}/templates.json` }] : [])];

  for (const d of docs) write(join(a.out, `${d.path.replace(/^library\//, '')}.html`), d.html);
  write(join(a.out, 'blocks.json'), `${JSON.stringify(sheet(blockRows), null, 2)}\n`);
  write(join(a.out, 'templates.json'), `${JSON.stringify(sheet(tplRows), null, 2)}\n`);
  write(join(a.out, 'library-rows.json'), `${JSON.stringify(rows, null, 2)}\n`);
  const variants = blocks.reduce((n, b) => n + b.variants.size, 0);
  console.log(`da-library: ${blocks.length} blocks (${variants} variants) from ${pages.length} pages, ${tplRows.length} templates → ${a.out}`);
  if (!blocks.length) console.error('da-library: WARN no authored block found — is --content the deployed DA bodies?');
  if (a.dryRun) { console.log('da-library: --dry-run — nothing written to DA'); return 0; }

  // token (same sources and expiry preflight as deploy-batch / da-media-upload)
  if (a.tokenEnv && a.tokenFile) { console.error('da-library: give at most one of --token-env / --token-file'); return 2; }
  const label = a.tokenFile || a.tokenEnv || 'DA_TOKEN';
  const token = a.tokenFile ? (existsSync(a.tokenFile) ? readFileSync(a.tokenFile, 'utf8').trim() : '') : (process.env[label] || '').trim();
  if (!token) { console.error(`da-library: no token in ${label}`); return 2; }
  const up = [join(HERE, '..', '..', 'deploy', 'scripts', 'da-media-upload.mjs'), join(HERE, '..', 'deploy', 'da-media-upload.mjs')].find((p) => existsSync(p));
  if (up) {
    const { jwtExpiry } = await import(pathToFileURL(up).href);
    const exp = jwtExpiry(token);
    if (exp && exp * 1000 < Date.now()) { console.error(`da-library: the token in ${label} expired at ${new Date(exp * 1000).toISOString()} — refresh it and re-run`); return 3; }
  }
  const SRC = process.env.DA_SOURCE_BASE || 'https://admin.da.live/source';
  const CONF = process.env.DA_CONFIG_BASE || 'https://admin.da.live/config';
  const ADMIN = process.env.AEM_ADMIN_BASE || 'https://admin.hlx.page';
  const auth = { Authorization: `Bearer ${token}` };
  const call = async (url, opts) => {
    for (let i = 0; ; i += 1) {
      const res = await fetch(url, { ...opts, headers: auth });
      if (res.status === 401) { console.error(`da-library: 401 from ${new URL(url).host} — refresh ${label} and re-run the same command`); process.exit(3); }
      if (i < 3 && (res.status === 429 || res.status >= 500)) { await new Promise((r) => { setTimeout(r, 500 * 2 ** i); }); continue; }
      return res;
    }
  };
  const put = (path, text, type) => { const fd = new FormData(); fd.append('data', new Blob([text], { type }), path.split('/').pop()); return call(`${SRC}/${a.org}/${a.site}/${path}`, { method: 'PUT', body: fd }); };
  let failed = 0;
  for (const d of docs) {
    const r = await put(`${d.path}.html`, d.html, 'text/html');
    let pv = '';
    if (r.ok && a.preview) pv = ` · preview ${(await call(`${ADMIN}/preview/${a.org}/${a.site}/${a.ref}/${d.path}`, { method: 'POST' })).status}`;
    if (!r.ok) failed += 1;
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${d.path} · put ${r.status}${pv}`);
  }
  for (const [name, rowsOf] of [['blocks', blockRows], ['templates', tplRows]]) {
    const r = await put(`library/${name}.json`, JSON.stringify(sheet(rowsOf)), 'application/json');
    if (!r.ok) failed += 1;
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} library/${name}.json · put ${r.status}`);
  }
  const confUrl = `${CONF}/${a.org}/${a.site}/`;
  const got = await call(confUrl, { method: 'GET' });
  if (got.status !== 200 && got.status !== 404) {
    console.error(`FAIL config read ${got.status} — add these rows to the "library" tab of https://da.live/config#/${a.org}/${a.site}/ by hand:\n${JSON.stringify(rows, null, 2)}`);
    return 1;
  }
  const merged = mergeLibraryConfig(got.status === 200 ? await got.json() : null, rows);
  const fd = new FormData(); fd.append('config', JSON.stringify(merged));
  const w = await call(confUrl, { method: 'POST', body: fd });
  console.log(`${w.ok ? 'OK  ' : 'FAIL'} config library tab (${rows.map((r) => r.title).join(', ')}) · post ${w.status}`);
  if (!w.ok) { failed += 1; console.error(`rows to add by hand:\n${JSON.stringify(rows, null, 2)}`); }
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main().then((code) => process.exit(code), (e) => { console.error(`da-library: ${e.message}`); process.exit(2); });
