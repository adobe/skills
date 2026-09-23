#!/usr/bin/env node
/**
 * migrate/migrate.mjs — the migrate driver: places a page whose HTML is ready.
 *
 * It never decides content. The agent supplies one rendered HTML file per page (the
 * prototype, or the sibling built from an archetype) and records its judgments; this
 * script does every generic step of reference/migration-procedure.md after the render
 * decision: page map (built once from every state page), output path (URL-literal rule),
 * depth-aware internal links via the page map, asset bundling with rewritten references
 * (six detection shapes, CSS files rewritten inside), provenance comment first in <head>,
 * canon `:root` first in the first <style>, default JSON-LD when the page has none,
 * data-template / data-section attributes, the _meta.json sidecar, strict validation
 * (refuse = nothing written), and the sha-based idempotent skip.
 *
 * Usage:
 *   node migrate.mjs render <slug…|--all> [--force] [--state stardust/state.json]
 *        [--proto-dir stardust/prototypes] [--current stardust/current] [--out stardust/migrated]
 *        [--canon-css <file>] [--inline-canon] [--source <slug>=<file>]…
 *        [--archetype <slug>=<archetype-slug>]… [--branch-b <slug,…>] [--stardust-version <v>]
 *   node migrate.mjs gate <slug> <gate-name> [--evidence "…"]          → gatesPassed[] / gateEvidence
 *   node migrate.mjs deviation <slug> --kind <k> [--source <s>] [--target <t>] --reason <r>
 *                                                                    → contentDeviations[]
 *   node migrate.mjs decision <slug> --kind <k> [--json '{…}']        → migrationDecisions[]
 *   node migrate.mjs variant <slug> <class…>                          → variants[] (one entry)
 *   node migrate.mjs modules <slug> <id…> | --clear                   → modules[]
 *   node migrate.mjs summary [--json]                                 one row per state page
 *   node migrate.mjs pagemap                                          prints the page map, writes nothing
 *   (every form takes --state / --out; paths are project-relative from the project root)
 *
 * render — page set: --all = every page whose status is approved, migrated or directed (others
 *   print one `skip` line); explicit slugs must exist. Branch: approved/migrated with a source
 *   file → A (fidelityTier archetype); directed → A' (sibling) of the single approved/migrated
 *   page of the same type that has a source file — zero or several: the page is refused until
 *   --archetype <slug>=<archetype-slug> names one; a slug in --branch-b → B (thin). Source HTML:
 *   --source, else page.prototypePath, else <proto-dir>/<slug>-proposed.html. Canon CSS:
 *   --canon-css, else stardust/canon/canon.css, else the single *canon*.css under --proto-dir.
 *   Per page one line `A  <slug> → <path>  (<type>; n assets, n links, n broken, n sections)`,
 *   `unchanged` when the recorded shas match (--force overrides), `passthrough` for a non-HTML
 *   leaf, `refused <slug>: strict <n> — <what> — <fix>` on stderr. Page status is NOT advanced
 *   here — that is `state.mjs advance <slug…> --to migrated`.
 *
 * Writes:
 *   <out>/<output-path>              the migrated HTML (URL-literal rule; default stardust/migrated/)
 *   <out>/<dir>/_meta.json           sidecar next to index.html; <name>._meta.json next to <name>.html
 *   <out>/assets/**                  every bundled asset (copied only when missing or changed)
 *   state.json.migrate               pageMap[], bundledAssets[], pages[], missingAssets[], lastRun
 *                                    — the only key touched; every other key is preserved
 *   gate/deviation/decision/variant/modules rewrite one sidecar; summary and pagemap write nothing.
 * Exit: 0 clean · 2 any page refused · 1 usage error (message on stderr).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h') || process.argv.length < 3) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

export const DRIVER_VERSION = '1';
export const DEFAULTS = { state: 'stardust/state.json', protoDir: 'stardust/prototypes', current: 'stardust/current', out: 'stardust/migrated', canonCss: null };
export const RENDERABLE = new Set(['approved', 'migrated', 'directed']);
// asset-bundling.md § Prefix resolution — the default set, longest first.
export const ASSET_PREFIXES = ['../current/assets/', '../../../assets/', '../../assets/', '../assets/', './assets/', '/assets/', 'assets/'];
const SKIP_SCHEMES = /^(#|mailto:|tel:|javascript:|data:)/i;
const SIDECAR_KEYS = ['slug', 'type', 'renderBranch', 'template', 'modules', 'slotsFilled', 'canonShas', 'deviations', 'migrationDecisions', 'metadata', 'jsonLd', 'migratedAt', 'designMdSha', 'designJsonSha', 'sourceCurrentSha', 'sourceProposedSha',
  'fidelityTier', 'archetypeSource', 'archetypeSha', 'variants', 'gatesPassed', 'gateEvidence', 'contentDeviations', 'assetsBundled', 'missingAssets', 'brokenInternalLinks', 'outputPath', 'outputPathDefault', 'sidecar', 'driverVersion'];
const CARRIED = ['gatesPassed', 'gateEvidence', 'variants', 'contentDeviations', 'deviations'];
const SELF = fileURLToPath(import.meta.url);

export class UsageError extends Error { constructor(msg) { super(msg); this.code = 1; } }
// A strict refusal: the page is not written, other pages continue, the run exits 2.
export class Refusal extends Error { constructor(slug, rule, what, fix) { super(`refused ${slug}: strict ${rule} — ${what} — ${fix}`); this.slug = slug; } }

// ---- io helpers ---------------------------------------------------------------------------------
export const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
export const fsha = (file) => (file && existsSync(file) && statSync(file).isFile() ? sha(readFileSync(file)) : null);
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const toPosix = (p) => p.split('\\').join('/');
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
function writeIfChanged(dst, data) {
  if (existsSync(dst) && Buffer.compare(readFileSync(dst), Buffer.from(data)) === 0) return false;
  mkdirSync(dirname(dst), { recursive: true }); writeFileSync(dst, data); return true;
}

// ---- output path mapping (migration-procedure.md § Output path mapping) -------------------------
export const pathnameOf = (url, origin = 'https://origin.invalid') => { try { return new URL(url, origin).pathname || '/'; } catch { return String(url).startsWith('/') ? url : `/${url}`; } };
export function outputPathFor(urlOrPath) {
  const p = urlOrPath.startsWith('/') && !urlOrPath.startsWith('//') ? urlOrPath : pathnameOf(urlOrPath);
  const bare = p.replace(/^\/+/, '');
  if (bare === '') return { outputPath: 'index.html', outputPathDefault: null, passthrough: false };
  if (p.endsWith('/')) return { outputPath: `${bare}index.html`, outputPathDefault: null, passthrough: false };
  const leaf = bare.split('/').pop();
  if (/\.html?$/i.test(leaf)) return { outputPath: bare, outputPathDefault: null, passthrough: false };
  if (/\.[a-z0-9]+$/i.test(leaf)) return { outputPath: bare, outputPathDefault: null, passthrough: true };
  return { outputPath: `${bare}/index.html`, outputPathDefault: 'trailing-slash', passthrough: false };
}
export const sidecarFor = (outputPath) => { const d = posix.dirname(outputPath); const b = posix.basename(outputPath); const s = b === 'index.html' ? '_meta.json' : `${b.replace(/\.html?$/i, '')}._meta.json`; return d === '.' ? s : `${d}/${s}`; };
export const depthOf = (outputPath) => outputPath.split('/').length - 1;
export const relPrefix = (depth) => (depth === 0 ? './' : '../'.repeat(depth));
export const urlFormOf = (outputPath) => outputPath.replace(/(^|\/)index\.html$/, '$1');

// The page map — every state page, built once per run; strict 8 refuses colliding slugs.
export function buildPageMap(pages, originUrl) {
  const entries = []; const bySlug = new Map(); const byPath = new Map(); const seen = new Map(); const collisions = new Map();
  for (const page of pages) {
    const sourceUrl = pathnameOf(page.url, originUrl || undefined);
    const o = outputPathFor(sourceUrl);
    const e = { sourceUrl, outputPath: o.outputPath, slug: page.slug, outputPathDefault: o.outputPathDefault, passthrough: o.passthrough };
    entries.push(e); bySlug.set(page.slug, e); byPath.set(sourceUrl, e);
    if (seen.has(o.outputPath)) { const list = collisions.get(o.outputPath) || [seen.get(o.outputPath)]; list.push(page.slug); collisions.set(o.outputPath, list); } else seen.set(o.outputPath, page.slug);
  }
  return { entries, bySlug, byPath, collisions };
}
export const lookupPath = (byPath, p) => byPath.get(p) || byPath.get(p.endsWith('/') ? p.slice(0, -1) : `${p}/`) || null;

// ---- internal links (content-preservation.md § Internal link rewriting; shape per migration-procedure.md) ----
export const normHost = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
export function stripTracking(search) {
  if (!search || search === '?') return '';
  const kept = search.slice(1).split('&').filter((kv) => kv && !/^(utm_[^=]*|gclid|fbclid)(=|$)/i.test(kv));
  return kept.length ? `?${kept.join('&')}` : '';
}
const isSchemeRef = (p) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(p);
export const matchPrefix = (p) => ASSET_PREFIXES.find((x) => p.startsWith(x)) || null;
// → { kind: 'skip' | 'external' | 'internal', pathname, search, hash }
export function classifyHref(href, { base, originHosts }) {
  if (!href || SKIP_SCHEMES.test(href)) return { kind: 'skip' };
  let u; try { u = new URL(href, base); } catch { return { kind: 'skip' }; }
  if (!/^https?:$/.test(u.protocol)) return { kind: 'skip' };
  if (!originHosts.has(normHost(u.host))) return { kind: 'external' };
  if (matchPrefix(u.pathname)) return { kind: 'skip' }; // an asset href — the bundling pass owns it
  return { kind: 'internal', pathname: u.pathname, search: stripTracking(u.search), hash: u.hash };
}
// ctx: { base, originHosts, origin, byPath, depth, available(entry) }. Returns { html, links, broken[] }.
export function rewriteLinks(html, ctx) {
  const prefix = relPrefix(ctx.depth); const broken = []; let links = 0;
  const out = html.replace(/<(a|area)\b([^>]*)>/gi, (m, tag, attrs) => {
    const hm = attrs.match(/(?<![\w-])href\s*=\s*(["'])(.*?)\1/s);
    if (!hm) return m;
    const raw = hm[2]; const hadAmp = raw.includes('&amp;'); const href = raw.replace(/&amp;/g, '&').trim();
    const c = classifyHref(href, ctx);
    if (c.kind !== 'internal') return m;
    links += 1;
    const entry = lookupPath(ctx.byPath, c.pathname); let next; let reason = null;
    if (entry && ctx.available(entry)) next = `${prefix}${entry.outputPath}${c.search}${c.hash}`;
    else if (entry) { next = `${ctx.origin}${c.pathname}${c.search}${c.hash}`; reason = 'in-inventory-not-migrated'; } // partial-inventory carve-out
    else { next = `${prefix}${outputPathFor(c.pathname).outputPath}${c.search}${c.hash}`; reason = 'not-in-inventory'; }
    if (reason) broken.push({ href, reason });
    let a = attrs.replace(hm[0], `href=${hm[1]}${hadAmp ? next.replace(/&/g, '&amp;') : next}${hm[1]}`);
    if (reason && !/(?<![\w-])data-broken-link=/.test(a)) a += ' data-broken-link="true"';
    return `<${tag}${a}>`;
  });
  return { html: out, links, broken };
}

// ---- <main>: data-template + data-section (attributes only; markup is never reordered) --------------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'template', 'textarea', 'title']); // never a section; contents skipped
export function tagSections(main, template) {
  const open = main.match(/^<main\b([^>]*)>/i);
  if (!open) return null;
  let attrs = open[1].replace(/\s+$/, '');
  if (!/(?<![\w-])data-template=/.test(attrs)) attrs += ` data-template="${template}"`;
  const end = main.toLowerCase().lastIndexOf('</main>');
  const inner = main.slice(open[0].length, end < 0 ? main.length : end);
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  let depth = 0; let n = 0; let out = ''; let last = 0; let m; const slots = [];
  while ((m = re.exec(inner))) {
    if (m[0].startsWith('<!--')) continue;
    const [full, close, tagRaw, a, self] = m; const tag = tagRaw.toLowerCase();
    if (close) { if (depth > 0) depth -= 1; continue; }
    if (RAW.has(tag)) { if (!self) { const c = inner.toLowerCase().indexOf(`</${tag}>`, re.lastIndex); if (c >= 0) re.lastIndex = c + tag.length + 3; } continue; }
    if (depth === 0) {
      n += 1;
      const cls = a.match(/(?<![\w-])class\s*=\s*(["'])(.*?)\1/s);
      slots.push(cls && cls[2].trim() ? cls[2].trim().split(/\s+/)[0] : tag);
      if (!/(?<![\w-])data-section=/.test(a)) { out += `${inner.slice(last, m.index)}<${tagRaw}${a.replace(/\s+$/, '')} data-section="${n}"${self}>`; last = m.index + full.length; }
    }
    if (!VOID.has(tag) && !self) depth += 1;
  }
  return { html: `<main${attrs}>${out}${inner.slice(last)}</main>`, slots, sections: n };
}
export const modulesIn = (main) => [...new Set([...main.matchAll(/(?<![\w-])data-module\s*=\s*(["'])(.*?)\1/gs)].map((x) => x[2].trim()).filter(Boolean))];

// ---- assets (asset-bundling.md § Detection / Prefix resolution / Copy / Rewrite / Edge cases) ------
export const splitRef = (ref) => { const m = ref.match(/^([^?#]*)(.*)$/s); return { path: m[1], suffix: m[2] }; };
export function rewriteCssUrls(css, fn) {
  return css.replace(/url\(\s*(["']?)([^)"'\s]+)\1\s*\)/g, (m, q, ref) => { const r = fn(ref); return r == null ? m : `url(${q}${r}${q})`; });
}
export class Bundler {
  constructor({ protoDir, currentDir, outDir, seed = [] }) {
    Object.assign(this, { protoDir: resolve(protoDir), currentDir: resolve(currentDir), outDir: resolve(outDir) });
    this.bundled = new Set(seed); this.done = new Set(); this.copied = 0; this.page = null;
  }
  begin(report) { this.page = report; } // per page: { refs:Set, missing:[], traversal:[] }
  // Which known root holds this file → its subpath under assets/ (one leading assets/ stripped).
  subpathUnder(abs) {
    for (const root of [join(this.protoDir, 'assets'), this.protoDir, join(this.currentDir, 'assets'), join(this.outDir, 'assets')]) {
      const rel = relative(root, abs);
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return toPosix(rel);
    }
    return null;
  }
  // A reference is bundled when it matches a default prefix, or (protoRelative) is a relative path
  // that resolves against baseDir to an existing file under a known root. → { subpath, candidates } | null
  resolveRef(refPath, baseDir, protoRelative) {
    if (!refPath || isSchemeRef(refPath)) return null;
    const decoded = safeDecode(refPath); const prefix = matchPrefix(refPath); let subpath; const candidates = [];
    if (prefix) {
      subpath = safeDecode(refPath.slice(prefix.length));
      if (!decoded.startsWith('/')) candidates.push(resolve(baseDir, decoded));
      candidates.push(join(this.protoDir, decoded.replace(/^\/+/, '')), join(this.protoDir, 'assets', subpath));
    } else if (protoRelative && !refPath.startsWith('/')) {
      const abs = resolve(baseDir, decoded);
      if (!isFile(abs)) return null;
      subpath = this.subpathUnder(abs); if (subpath == null) return null;
      candidates.push(abs);
    } else return null;
    if (!subpath || subpath.startsWith('/') || subpath.split('/').includes('..')) return { traversal: refPath };
    candidates.push(join(this.currentDir, 'assets', subpath), join(this.outDir, 'assets', subpath));
    return { subpath, candidates };
  }
  // Copy (or rewrite, for CSS) into <out>/assets/<subpath>; false when no source exists.
  ensure(subpath, candidates) {
    const dst = join(this.outDir, 'assets', subpath);
    if (this.done.has(subpath)) return true;
    const src = candidates.find((c) => isFile(c));
    if (!src) return false;
    this.done.add(subpath); this.bundled.add(subpath);
    if (resolve(src) === dst) return true;
    if (/\.css$/i.test(subpath)) {
      const css = this.rewriteCss(readFileSync(src, 'utf8'), dirname(src), subpath);
      if (writeIfChanged(dst, css)) this.copied += 1;
    } else if (!existsSync(dst) || Buffer.compare(readFileSync(src), readFileSync(dst)) !== 0) {
      mkdirSync(dirname(dst), { recursive: true }); copyFileSync(src, dst); this.copied += 1;
    }
    return true;
  }
  // One reference → its rewritten form (or null = leave as is), recording refs/missing/traversal on the page.
  rewriteRef(ref, baseDir, protoRelative, toNew) {
    const { path, suffix } = splitRef(ref.trim());
    const r = this.resolveRef(path, baseDir, protoRelative);
    if (!r) return null;
    if (r.traversal) { this.page?.traversal.push(ref); return null; }
    if (!this.ensure(r.subpath, r.candidates)) { this.page?.missing.push({ ref, subpath: r.subpath }); return null; }
    this.page?.refs.add(r.subpath);
    return toNew(r.subpath) + suffix;
  }
  // url() inside a CSS file: resolved against the file's OLD dir, rewritten relative to its NEW location.
  rewriteCss(css, oldDir, newSubpath) {
    const newDir = posix.dirname(`assets/${newSubpath}`);
    return rewriteCssUrls(css, (ref) => this.rewriteRef(ref, oldDir, true, (s) => posix.relative(newDir, `assets/${s}`)));
  }
  // The five HTML shapes on a page at `depth`: src/href/poster, srcset, inline style, <style> blocks.
  rewriteHtml(html, depth) {
    const prefix = relPrefix(depth);
    const toNew = (s) => `${prefix}assets/${s}`;
    const one = (ref, protoRelative) => this.rewriteRef(ref, this.protoDir, protoRelative, toNew);
    const css = (text) => rewriteCssUrls(text, (ref) => one(ref, true));
    let out = html.replace(/<([a-zA-Z][\w-]*)(\s[^>]*)?>/g, (m, tag, attrs) => {
      if (!attrs) return m;
      const link = /^(a|area)$/i.test(tag); // page links: only a prefixed href is an asset here
      const a = attrs.replace(/(?<![\w-])(src|href|poster|srcset|style)\s*=\s*(["'])(.*?)\2/gs, (mm, name, q, val) => {
        let next = null;
        if (name === 'srcset') next = val.split(/(\s*,\s*)/).map((part, i) => { if (i % 2) return part; const [u, ...d] = part.trim().split(/\s+/); if (!u) return part; const r = one(u, true); return r == null ? part : [r, ...d].join(' '); }).join('');
        else if (name === 'style') next = val.includes('url(') ? css(val) : null;
        else next = one(val, !(link && name === 'href'));
        return next == null || next === val ? mm : `${name}=${q}${next}${q}`;
      });
      return a === attrs ? m : `<${tag}${a}>`;
    });
    out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, o, text, c) => `${o}${css(text)}${c}`);
    return out;
  }
}

// ---- <head> (metadata-and-jsonld.md; migration-procedure.md § Provenance, § :root block) -----------
export const rootBlockOf = (css) => { const m = css.match(/:root\s*\{[^}]*\}/); return m ? m[0] : null; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const tagWith = (html, tag, test) => (html.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi')) || []).find((t) => test.test(t)) || null;
const attrOf = (tag, name) => { const m = tag && tag.match(new RegExp(`(?<![\\w-])${name}\\s*=\\s*(["'])(.*?)\\1`, 's')); return m ? m[2] : null; };
export function provenanceComment(f) {
  const line = (k, v) => `  ${`${k}:`.padEnd(17)} ${v}`;
  const rows = [line('writtenBy', 'stardust:migrate'), line('writtenAt', f.at), line('page', f.title), line('slug', f.slug), line('pagePath', f.pagePath), line('renderBranch', f.branch)];
  if (f.branch === "A'") rows.push(line('template', f.template), line('archetypePath', f.archetypePath), line('archetypeSha', f.archetypeSha));
  if (f.branch === 'A') rows.push(line('sourceProposed', f.sourceProposed));
  rows.push(line('sourceCurrent', f.sourceCurrent), line('againstDirection', f.direction), line('designMd', `DESIGN.md (sha: ${f.designMdSha})`), line('designJson', `DESIGN.json (sha: ${f.designJsonSha})`),
    line('canonShas', `header:${f.canonShas.header} footer:${f.canonShas.footer} css:${f.canonShas.css}`), line('decisionTrace', f.decisionTrace), line('brokenInternalLinks', String(f.broken)), line('stardustVersion', f.stardustVersion));
  return `<!-- stardust:migrate\n${rows.join('\n')}\n-->`;
}
// Resolves title / description / canonical / lang / JSON-LD against the capture, rewrites canonical +
// og:url to the deploy host when set, and inserts the provenance + :root <style> (+ defaults) first.
export function composeHead(html, h) {
  const headOpen = html.match(/<head\b[^>]*>/i);
  if (!headOpen) return null;
  const tm = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  let title = tm ? tm[1].trim() : '';
  const inserts = [];
  if (!title && h.capture?.title) { title = String(h.capture.title).trim(); if (tm) html = html.replace(tm[0], `<title>${esc(title)}</title>`); else inserts.push(`<title>${esc(title)}</title>`); }
  const descTag = tagWith(html, 'meta', /(?<![\w-])name\s*=\s*["']description["']/i);
  let description = attrOf(descTag, 'content');
  if (description == null && h.capture?.metaDescription) { description = String(h.capture.metaDescription); inserts.push(`<meta name="description" content="${esc(description)}">`); }
  let canonical = attrOf(tagWith(html, 'link', /(?<![\w-])rel\s*=\s*["']canonical["']/i), 'href');
  if (h.deployHost) {
    canonical = `https://${h.deployHost}/${urlFormOf(h.outputPath)}`;
    html = html.replace(/<link\b[^>]*>/gi, (m) => (/(?<![\w-])rel\s*=\s*["']canonical["']/i.test(m) ? m.replace(/((?<![\w-])href\s*=\s*["'])[^"']*/i, `$1${canonical}`) : m));
    html = html.replace(/<meta\b[^>]*>/gi, (m) => (/(?<![\w-])property\s*=\s*["']og:url["']/i.test(m) ? m.replace(/((?<![\w-])content\s*=\s*["'])[^"']*/i, `$1${canonical}`) : m));
    if (!tagWith(html, 'link', /(?<![\w-])rel\s*=\s*["']canonical["']/i)) inserts.push(`<link rel="canonical" href="${canonical}">`);
    if (!tagWith(html, 'meta', /(?<![\w-])property\s*=\s*["']og:url["']/i)) inserts.push(`<meta property="og:url" content="${canonical}">`);
  }
  const lang = (html.match(/<html\b[^>]*?(?<![\w-])lang\s*=\s*["']([^"']*)/i) || [])[1] || h.capture?.language || null;
  const existingLd = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
  let jsonLd = null; let insertedLd = null;
  if (existingLd) { try { jsonLd = JSON.parse(existingLd[1]); } catch { jsonLd = existingLd[1].trim(); } } else {
    const url = canonical || h.pageUrl;
    insertedLd = h.type === 'article' ? { '@context': 'https://schema.org', '@type': 'Article', headline: title, description: description ?? undefined, mainEntityOfPage: url }
      : { '@context': 'https://schema.org', '@type': 'WebPage', name: title, description: description ?? undefined, url };
    jsonLd = JSON.parse(JSON.stringify(insertedLd));
  }
  const parts = [h.prov, `<style>\n${h.rootBlock}${h.inlineCss ? `\n${h.inlineCss}` : ''}\n</style>`];
  if (h.canonLink) parts.push(`<link rel="stylesheet" href="${h.canonLink}">`);
  if (insertedLd) parts.push(`<script type="application/ld+json">${JSON.stringify(insertedLd)}</script>`);
  const at = headOpen.index + headOpen[0].length;
  return { html: `${html.slice(0, at)}\n${[...parts, ...inserts].join('\n')}${html.slice(at)}`, metadata: { title, description: description ?? null, canonical: canonical ?? null, lang }, jsonLd };
}
// Strict validation on the final string, before anything is written (migration-procedure.md § Validation).
export function validatePage(slug, html, sidecar, outDir, refs) {
  const head = (html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i) || [])[1] ?? '';
  const firstStyle = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i);
  if (!firstStyle || !firstStyle[1].trim().startsWith(':root')) throw new Refusal(slug, 1, ':root block is not first in the first <style>', 'the source must not open a <style> before <head>');
  if (!/<main\b[^>]*\sdata-template=/i.test(html) || !/(?<![\w-])data-section=/.test(html)) throw new Refusal(slug, 2, 'data-template / data-section missing', 'the source needs a <main> with at least one element child');
  if (!/^\s*<!-- stardust:migrate/.test(head)) throw new Refusal(slug, 3, 'provenance comment is not the first child of <head>', 'the source needs a plain <head> element');
  if (!sidecar.metadata.title) throw new Refusal(slug, 'metadata', '<title> is empty and the capture has no title', 'add a <title> to the source');
  try { JSON.parse(JSON.stringify(sidecar)); } catch (e) { throw new Refusal(slug, 7, `sidecar does not round-trip (${e.message})`, 'check the recorded judgments for non-JSON values'); }
  for (const s of refs) if (!isFile(join(outDir, 'assets', s))) throw new Refusal(slug, 'asset', `bundled reference assets/${s} is not on disk`, 'check the file under --proto-dir or --current');
}

// ---- render branch and canon ---------------------------------------------------------------------
export function sourceFor(run, page) {
  const explicit = run.sources.get(page.slug);
  if (explicit) return explicit;
  if (page.prototypePath && isFile(page.prototypePath)) return page.prototypePath;
  return join(run.protoDir, `${page.slug}-proposed.html`);
}
// approved/migrated → A; directed → A' of the single approved/migrated sibling of its type (or --archetype); --branch-b → B.
export function chooseBranch(run, page) {
  const source = sourceFor(run, page);
  if (!isFile(source)) throw new Refusal(page.slug, 'source', `no source HTML at ${source}`, 'pass --source <slug>=<file> or build the page first');
  if (run.branchB.has(page.slug)) return { branch: 'B', tier: 'thin', archetype: null, source };
  if (page.status !== 'directed') return { branch: 'A', tier: 'archetype', archetype: null, source };
  const named = run.archetypes.get(page.slug);
  let archetype = null;
  if (named) { archetype = run.bySlug.get(named); if (!archetype || !isFile(sourceFor(run, archetype))) throw new Refusal(page.slug, 'branch', `--archetype names ${named}, which has no source HTML`, 'name an approved page of the same type that has a source file'); } else {
    const c = run.pages.filter((p) => p.slug !== page.slug && p.type === page.type && ['approved', 'migrated'].includes(p.status) && isFile(sourceFor(run, p)));
    if (c.length !== 1) throw new Refusal(page.slug, 'branch', `${c.length} archetype candidate(s) of type ${page.type}${c.length ? ` (${c.map((p) => p.slug).join(', ')})` : ''}`, `--archetype ${page.slug}=<archetype-slug> (or --branch-b ${page.slug} for a one-off render)`);
    archetype = c[0];
  }
  return { branch: "A'", tier: 'sibling', archetype, source };
}
export function resolveCanon(o) {
  const dflt = join(dirname(o.state), 'canon', 'canon.css');
  let file = o.canonCss;
  if (file) { if (!isFile(file)) throw new UsageError(`--canon-css ${file} does not exist`); } else if (isFile(dflt)) file = dflt; else {
    const c = existsSync(o.protoDir) ? readdirSync(o.protoDir).filter((f) => /canon.*\.css$/i.test(f)) : [];
    if (c.length !== 1) throw new UsageError(`no canon CSS: ${dflt} is absent and ${o.protoDir} has ${c.length} *canon*.css file(s) — pass --canon-css <file>`);
    file = join(o.protoDir, c[0]);
  }
  const css = readFileSync(file, 'utf8'); const rootBlock = rootBlockOf(css);
  if (!rootBlock) throw new UsageError(`${file} has no :root{…} block (strict 1) — pass --canon-css <file> whose first block is the canon :root`);
  const rel = relative(resolve(o.protoDir), resolve(file));
  const subpath = rel && !rel.startsWith('..') && !isAbsolute(rel) ? toPosix(rel).replace(/^assets\//, '') : basename(file);
  return { file: resolve(file), css, rootBlock, sha: sha(css), subpath };
}

// ---- one page ----------------------------------------------------------------------------------
export function renderPage(run, page, entry) {
  const { slug } = page; const { outputPath, outputPathDefault } = entry;
  const { branch, tier, archetype, source } = chooseBranch(run, page);
  const outFile = join(run.outDir, outputPath); const sideRel = sidecarFor(outputPath); const sideFile = join(run.outDir, sideRel);
  const sourceHtml = readFileSync(source, 'utf8');
  const capturePath = join(run.currentDir, 'pages', `${slug}.json`); const capture = readJson(capturePath);
  const canonDir = join(dirname(run.stateFile), 'canon');
  const ownSlice = (tag) => { const m = sourceHtml.match(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'i')); return m ? sha(m[0]) : null; };
  const canonShas = { header: fsha(join(canonDir, 'header.html')) ?? ownSlice('header'), footer: fsha(join(canonDir, 'footer.html')) ?? ownSlice('footer'), css: run.canon.sha };
  const archetypeSource = archetype ? sourceFor(run, archetype) : null;
  const keys = { designMdSha: run.designMdSha, designJsonSha: run.designJsonSha, sourceCurrentSha: fsha(capturePath), sourceProposedSha: sha(sourceHtml), canonShas, archetypeSha: archetype ? fsha(archetypeSource) : null, driverVersion: DRIVER_VERSION };
  const old = readJson(sideFile);
  // idempotent skip (migration-procedure.md § Idempotent skip) — the recorded input shas equal the current set
  if (!run.force && old && isFile(outFile) && JSON.stringify(Object.fromEntries(Object.keys(keys).map((k) => [k, old[k] ?? null]))) === JSON.stringify(keys)) return { status: 'unchanged', outputPath };
  // placeholder gate — no bypass flag
  if (/(?<![\w-])data-placeholder(?![\w-])/.test(sourceHtml)) throw new Refusal(slug, 'placeholder-gate', '[data-placeholder] present in the source', 'fill the missing content in the source file, then re-run');
  if (capture?._provenance?.unsourcedContent?.length) throw new Refusal(slug, 'placeholder-gate', `the capture lists ${capture._provenance.unsourcedContent.length} unsourced content item(s)`, 'source the content, re-extract, then re-run');
  // <main>: data-template + data-section
  const mi = sourceHtml.search(/<main\b/i); const mj = sourceHtml.toLowerCase().lastIndexOf('</main>');
  if (mi < 0 || mj < mi) throw new Refusal(slug, 2, 'no <main> element', 'wrap the page content in <main>');
  const template = branch === 'A' ? slug : branch === "A'" ? archetype.slug : (page.type || 'unique');
  const tagged = tagSections(sourceHtml.slice(mi, mj + 7), template);
  let html = sourceHtml.slice(0, mi) + tagged.html + sourceHtml.slice(mj + 7);
  const modules = modulesIn(tagged.html); const modulesOut = modules.length ? modules : (old?.modules?.length ? old.modules : []);
  const depth = depthOf(outputPath); const prefix = relPrefix(depth);
  // internal links via the page map
  let pageUrl; try { pageUrl = new URL(page.url, run.originUrl || 'https://origin.invalid').href; } catch { pageUrl = page.url; }
  const hosts = new Set(run.originHosts); try { hosts.add(normHost(new URL(pageUrl).host)); } catch { /* relative url — origin hosts only */ }
  const linked = rewriteLinks(html, { base: pageUrl, originHosts: hosts, origin: run.origin, byPath: run.pageMap.byPath, depth, available: run.available });
  html = linked.html;
  // assets (the canon CSS is bundled like any other asset unless --inline-canon)
  const report = { refs: new Set(), missing: [], traversal: [] }; run.bundler.begin(report);
  html = run.bundler.rewriteHtml(html, depth);
  let canonLink = null;
  if (!run.inlineCanon && !report.refs.has(run.canon.subpath)) { run.bundler.ensure(run.canon.subpath, [run.canon.file]); report.refs.add(run.canon.subpath); canonLink = `${prefix}assets/${run.canon.subpath}`; }
  // <head>
  const at = nowIso();
  const prov = provenanceComment({ at, title: String(page.title || slug).replace(/\s+/g, ' ').replace(/--/g, '-'), slug, pagePath: posix.join(basename(run.outDir), outputPath), branch, template: archetype?.slug, archetypePath: archetypeSource && toPosix(archetypeSource), archetypeSha: keys.archetypeSha, sourceProposed: toPosix(source), sourceCurrent: toPosix(capturePath), direction: run.direction, designMdSha: run.designMdSha, designJsonSha: run.designJsonSha, canonShas, decisionTrace: posix.basename(sideRel), broken: linked.broken.length, stardustVersion: run.stardustVersion });
  const head = composeHead(html, { prov, rootBlock: run.canon.rootBlock, inlineCss: run.inlineCanon ? run.canon.css : null, canonLink, capture, deployHost: run.deployHost, outputPath, pageUrl, type: page.type });
  if (!head) throw new Refusal(slug, 3, 'no <head> element', 'add <head> to the source');
  html = head.html;
  // sidecar: spec keys first, then the tier/judgment fields; recorded judgments are carried over
  const carried = (old?.migrationDecisions || []).filter((d) => !(d && d._driver));
  const driverDecisions = [...report.missing.map((m) => ({ kind: 'asset-missing', ref: m.ref, subpath: m.subpath, _driver: true })), ...report.traversal.map((ref) => ({ kind: 'asset-path-traversal', ref, _driver: true }))];
  const meta = { slug, type: page.type ?? null, renderBranch: branch, template: archetype ? archetype.slug : null, modules: modulesOut, slotsFilled: tagged.slots, canonShas, migrationDecisions: [...carried, ...driverDecisions], metadata: head.metadata, jsonLd: head.jsonLd, migratedAt: at, ...keys,
    fidelityTier: tier, archetypeSource: archetype ? archetype.slug : null, assetsBundled: report.refs.size, missingAssets: report.missing, brokenInternalLinks: linked.broken, outputPath, outputPathDefault, sidecar: sideRel };
  const defaults = { gatesPassed: [], gateEvidence: {}, variants: [], contentDeviations: [], deviations: [] };
  for (const k of CARRIED) meta[k] = old?.[k] ?? defaults[k];
  const sidecar = Object.fromEntries(SIDECAR_KEYS.map((k) => [k, meta[k] ?? null]));
  validatePage(slug, html, sidecar, run.outDir, report.refs);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, html); writeFileSync(sideFile, `${JSON.stringify(sidecar, null, 2)}\n`);
  return { status: 'rendered', branch, outputPath, type: page.type, assets: report.refs.size, links: linked.links, broken: linked.broken.length, sections: tagged.sections, missing: report.missing, modulesEmpty: modulesOut.length === 0 };
}

// ---- the run -----------------------------------------------------------------------------------
export function loadState(file) {
  if (!isFile(file)) throw new UsageError(`${file} does not exist — extract creates it (pass --state <file>)`);
  const state = readJson(file);
  if (!state || !Array.isArray(state.pages)) throw new UsageError(`${file} is not valid JSON with a pages[] array`);
  return state;
}
// The only key touched is `migrate`; the parsed key order is kept and `migrate` is appended when new.
function writeMigrateBlock(file, state, block) {
  state.migrate = block;
  const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`); renameSync(tmp, file);
}
function directionLine(stateFile) {
  const f = toPosix(join(dirname(stateFile), 'direction.md'));
  if (!isFile(f)) return `${f} (absent)`;
  const m = readFileSync(f, 'utf8').match(/Active[^\n]*?(\d{4}-\d{2}-\d{2}T[\d:]{8}Z)/);
  return `${f} (Active${m ? ` ${m[1]}` : ''})`;
}
export function renderRun(o) {
  const state = loadState(o.state); const pages = state.pages; const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const originUrl = state.site?.originUrl || null;
  const pageMap = buildPageMap(pages, originUrl);
  let set;
  if (o.all) { set = []; for (const p of pages) { if (RENDERABLE.has(p.status)) set.push(p.slug); else console.log(`skip ${p.slug}: status ${p.status}`); } } else {
    const unknown = o.slugs.filter((s) => !bySlug.has(s));
    if (unknown.length) throw new UsageError(`unknown slug(s): ${unknown.join(', ')}`);
    if (!o.slugs.length) throw new UsageError('render needs <slug…> or --all');
    set = [...new Set(o.slugs)];
  }
  const counts = { rendered: [], unchanged: [], refused: [], passthrough: [] };
  for (const [path, slugs] of pageMap.collisions) for (const s of slugs) if (set.includes(s)) { console.error(`refused ${s}: strict 8 — output path ${path} collides with ${slugs.filter((x) => x !== s).join(', ')} — fix page.url of one of them`); counts.refused.push(s); }
  set = set.filter((s) => !counts.refused.includes(s));
  const canon = resolveCanon(o);
  const renderSet = new Set(set.filter((s) => !pageMap.bySlug.get(s).passthrough));
  let origin = 'https://origin.invalid'; const originHosts = new Set();
  if (originUrl) { try { const u = new URL(originUrl); origin = u.origin; originHosts.add(normHost(u.host)); } catch { /* keep the placeholder origin */ } }
  let deployHost = null;
  if (state.site?.deployUrl) { try { deployHost = new URL(/^[a-z]+:\/\//i.test(state.site.deployUrl) ? state.site.deployUrl : `https://${state.site.deployUrl}`).host; } catch { deployHost = state.site.deployUrl; } }
  const bundler = new Bundler({ protoDir: o.protoDir, currentDir: o.current, outDir: o.out, seed: state.migrate?.bundledAssets || [] });
  const run = { stateFile: o.state, pages, bySlug, pageMap, bundler, canon, inlineCanon: o.inlineCanon, force: o.force, sources: new Map(Object.entries(o.sources || {})), archetypes: new Map(Object.entries(o.archetypes || {})), branchB: o.branchB instanceof Set ? o.branchB : new Set(o.branchB || []), protoDir: o.protoDir, currentDir: o.current, outDir: o.out, originUrl, origin, originHosts, deployHost,
    designMdSha: fsha('DESIGN.md'), designJsonSha: fsha('DESIGN.json'), direction: directionLine(o.state), stardustVersion: o.stardustVersion || process.env.STARDUST_VERSION || 'local',
    available: (e) => isFile(join(o.out, e.outputPath)) || (renderSet.has(e.slug) && !e.passthrough) };
  const missing = []; const modulesEmpty = []; const rendered = new Map();
  for (const slug of set) {
    const page = bySlug.get(slug); const entry = pageMap.bySlug.get(slug);
    if (entry.passthrough) { console.log(`passthrough ${slug}: ${entry.outputPath} (non-HTML leaf; no render, no sidecar)`); counts.passthrough.push(slug); continue; }
    let r;
    try { r = renderPage(run, page, entry); } catch (e) { if (!(e instanceof Refusal)) throw e; console.error(e.message); counts.refused.push(slug); continue; }
    if (r.status === 'unchanged') { console.log(`unchanged ${slug} → ${r.outputPath}`); counts.unchanged.push(slug); continue; }
    counts.rendered.push(slug); rendered.set(slug, r);
    for (const m of r.missing) missing.push({ slug, ...m });
    if (r.modulesEmpty) modulesEmpty.push(slug);
    console.log(`${r.branch.padEnd(2)} ${slug} → ${r.outputPath}  (${r.type || 'untyped'}; ${r.assets} assets, ${r.links} links, ${r.broken} broken, ${r.sections} sections)`);
  }
  const prev = state.migrate || {}; const at = nowIso(); const outRel = toPosix(o.out).replace(/\/+$/, '');
  const pageRecs = new Map((prev.pages || []).map((p) => [p.slug, p]));
  for (const [slug, r] of rendered) pageRecs.set(slug, { slug, file: `${outRel}/${r.outputPath}`, assetsBundled: r.assets });
  const missRec = new Map((prev.missingAssets || []).map((m) => [m.subpath, new Set((m.referencedBy || []).filter((s) => !rendered.has(s)))]));
  for (const m of missing) { if (!missRec.has(m.subpath)) missRec.set(m.subpath, new Set()); missRec.get(m.subpath).add(m.slug); }
  writeMigrateBlock(o.state, state, { at, outputDir: `${outRel}/`, selfContained: true, pageMap: pageMap.entries.map(({ sourceUrl, outputPath, slug, outputPathDefault }) => ({ sourceUrl, outputPath, slug, outputPathDefault })),
    totalAssetsBundled: bundler.bundled.size, bundledAssets: [...bundler.bundled].sort(), pages: [...pageRecs.values()], missingAssets: [...missRec].filter(([, s]) => s.size).map(([subpath, s]) => ({ subpath, referencedBy: [...s].sort() })), cleanedAssets: prev.cleanedAssets || [], lastRun: { at, ...counts } });
  if (missing.length) console.log(`missing assets: ${missing.length} reference(s) left as is — ${[...new Set(missing.map((m) => m.subpath))].slice(0, 6).join(', ')}`);
  if (modulesEmpty.length) console.log(`modules[] empty on ${modulesEmpty.length} page(s) — migrate.mjs modules <slug> <id…> (${modulesEmpty.slice(0, 6).join(', ')})`);
  console.log(`rendered ${counts.rendered.length}, unchanged ${counts.unchanged.length}, refused ${counts.refused.length}, passthrough ${counts.passthrough.length} → ${outRel}/`);
  return counts.refused.length ? 2 : 0;
}

// ---- sidecar subcommands: judgments the driver cannot make ------------------------------------
function sidecarPath(o, slug) {
  const state = loadState(o.state); const page = state.pages.find((p) => p.slug === slug);
  if (!page) throw new UsageError(`unknown slug: ${slug}`);
  const { outputPath, passthrough } = outputPathFor(page.url || page.path || `/${slug}/`);
  if (passthrough) throw new UsageError(`${slug} is a passthrough leaf (${outputPath}); it has no sidecar`);
  const file = join(o.out, sidecarFor(outputPath));
  if (!isFile(file)) throw new UsageError(`${file} does not exist — render ${slug} first`);
  return { file, sidecar: readJson(file), state };
}
function saveSidecar(file, sidecar) { writeFileSync(file, `${JSON.stringify(sidecar, null, 2)}\n`); }
const pushUnique = (arr, v) => { const key = JSON.stringify(v); if (!arr.some((x) => JSON.stringify(x) === key)) arr.push(v); return arr; };
export function gateCmd(o, slug, gate) {
  if (!slug || !gate) throw new UsageError('gate <slug> <gate> [--evidence <text>]');
  const { file, sidecar } = sidecarPath(o, slug);
  sidecar.gatesPassed = pushUnique(sidecar.gatesPassed || [], gate);
  sidecar.gateEvidence = sidecar.gateEvidence || {}; sidecar.gateEvidence[gate] = o.evidence || sidecar.gateEvidence[gate] || 'passed';
  saveSidecar(file, sidecar); console.log(`gate ${slug}: ${gate} (${sidecar.gatesPassed.length} passed)`); return 0;
}
export function deviationCmd(o, slug) {
  if (!slug || !o.kind || !o.reason) throw new UsageError('deviation <slug> --kind <k> --source <text> --target <text> --reason <why>');
  const { file, sidecar } = sidecarPath(o, slug);
  sidecar.contentDeviations = pushUnique(sidecar.contentDeviations || [], { kind: o.kind, source: o.source || null, target: o.target || null, reason: o.reason });
  saveSidecar(file, sidecar); console.log(`deviation ${slug}: ${o.kind} (${sidecar.contentDeviations.length} recorded)`); return 0;
}
export function decisionCmd(o, slug) {
  if (!slug || !o.kind) throw new UsageError('decision <slug> --kind <k> [--json <object>]');
  const { file, sidecar } = sidecarPath(o, slug);
  let extra = {}; if (o.json) { try { extra = JSON.parse(o.json); } catch { throw new UsageError('--json must be a JSON object'); } }
  sidecar.migrationDecisions = pushUnique((sidecar.migrationDecisions || []), { kind: o.kind, ...extra });
  saveSidecar(file, sidecar); console.log(`decision ${slug}: ${o.kind} (${sidecar.migrationDecisions.length} recorded)`); return 0;
}
export function variantCmd(o, slug, classes) {
  if (!slug || !classes.length) throw new UsageError('variant <slug> <class…>');
  const { file, sidecar } = sidecarPath(o, slug);
  sidecar.variants = pushUnique(sidecar.variants || [], classes.join(' '));
  saveSidecar(file, sidecar); console.log(`variant ${slug}: ${classes.join(' ')} (${sidecar.variants.length} recorded)`); return 0;
}
export function modulesCmd(o, slug, ids) {
  if (!slug || (!ids.length && !o.clear)) throw new UsageError('modules <slug> <id…> | --clear');
  const { file, sidecar } = sidecarPath(o, slug);
  sidecar.modules = o.clear ? [] : [...new Set([...(sidecar.modules || []), ...ids])];
  saveSidecar(file, sidecar); console.log(`modules ${slug}: [${sidecar.modules.join(', ')}]`); return 0;
}
export function summaryCmd(o) {
  const state = loadState(o.state); const rows = [];
  for (const p of state.pages) {
    const { outputPath, passthrough } = outputPathFor(p.url || p.path || `/${p.slug}/`);
    const file = passthrough ? null : join(o.out, sidecarFor(outputPath)); const s = file && isFile(file) ? readJson(file) : null;
    rows.push({ slug: p.slug, status: p.status, branch: s ? s.renderBranch : null, tier: s ? s.fidelityTier : null, gates: s ? (s.gatesPassed || []).length : null, variants: s ? (s.variants || []).length : null, deviations: s ? (s.contentDeviations || []).length : null, broken: s ? (s.brokenInternalLinks || []).length : null, outputPath: passthrough ? `${outputPath} (passthrough)` : outputPath, sidecar: !!s });
  }
  if (o.json) { console.log(JSON.stringify(rows, null, 2)); return 0; }
  const d = (v) => (v === null || v === undefined ? '—' : String(v));
  const cols = ['slug', 'status', 'branch', 'tier', 'gates', 'variants', 'deviations', 'broken', 'outputPath'];
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => d(r[c]).length)));
  console.log(cols.map((c, i) => c.padEnd(w[i])).join('  '));
  for (const r of rows) console.log(cols.map((c, i) => d(r[c]).padEnd(w[i])).join('  '));
  console.log(`${rows.filter((r) => r.sidecar).length} of ${rows.length} pages have a sidecar under ${toPosix(o.out)}/`);
  return 0;
}
export function pagemapCmd(o) {
  const state = loadState(o.state); const m = buildPageMap(state.pages, state.site?.originUrl || null);
  for (const e of m.entries) console.log(`${e.slug.padEnd(24)} ${e.sourceUrl.padEnd(36)} → ${e.outputPath}${e.passthrough ? '  (passthrough)' : ''}${m.collisions.has(e.outputPath) ? '  COLLISION' : ''}`);
  console.log(`${m.entries.length} entries, ${m.collisions.size} collision(s)`);
  return m.collisions.size ? 2 : 0;
}

// ---- argv and entry point ----------------------------------------------------------------------
const BOOL = new Set(['all', 'force', 'inline-canon', 'json', 'clear']);
const REPEAT = new Set(['source', 'archetype']); // slug=value pairs on render; --source is free text elsewhere
export function parseArgs(argv) {
  const o = { ...DEFAULTS, slugs: [], sources: {}, archetypes: {}, branchB: new Set(), all: false, force: false, inlineCanon: false, json: false, clear: false, evidence: null, kind: null, source: null, target: null, reason: null, stardustVersion: null };
  const positional = []; const raw = { source: [], archetype: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const eq = a.indexOf('='); const name = (eq > 0 ? a.slice(2, eq) : a.slice(2)); let val = eq > 0 ? a.slice(eq + 1) : undefined;
    // --json is a switch on summary and takes an object on decision
    if (name === 'json' && val === undefined && argv[i + 1]?.startsWith('{')) val = argv[++i];
    if (BOOL.has(name) && val === undefined) { o[name === 'inline-canon' ? 'inlineCanon' : name] = true; continue; }
    if (val === undefined) { val = argv[++i]; if (val === undefined) throw new UsageError(`--${name} needs a value`); }
    if (REPEAT.has(name)) { raw[name].push(val); continue; }
    if (name === 'branch-b') { for (const t of val.split(',')) if (t.trim()) o.branchB.add(t.trim()); continue; }
    const key = { 'proto-dir': 'protoDir', 'canon-css': 'canonCss', 'stardust-version': 'stardustVersion' }[name] || name;
    if (!(key in o)) throw new UsageError(`unknown flag --${name}`);
    o[key] = val;
  }
  if (positional[0] === 'render') {
    for (const name of REPEAT) for (const v of raw[name]) { const m = v.match(/^([^=]+)=(.+)$/); if (!m) throw new UsageError(`--${name} takes slug=value`); o[`${name}s`][m[1]] = m[2]; }
  } else if (raw.source.length) o.source = raw.source.join(' ');
  return { o, positional };
}
export function main(argv) {
  const { o, positional } = parseArgs(argv);
  const [cmd, ...rest] = positional;
  switch (cmd) {
    case 'render': o.slugs = rest; return renderRun(o);
    case 'gate': return gateCmd(o, rest[0], rest[1]);
    case 'deviation': return deviationCmd(o, rest[0]);
    case 'decision': return decisionCmd(o, rest[0]);
    case 'variant': return variantCmd(o, rest[0], rest.slice(1));
    case 'modules': return modulesCmd(o, rest[0], rest.slice(1));
    case 'summary': return summaryCmd(o);
    case 'pagemap': return pagemapCmd(o);
    default: throw new UsageError(`unknown command: ${cmd || '(none)'} — see --help`);
  }
}
// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && safeRealpath(SELF) === safeRealpath(process.argv[1])) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) {
    if (e instanceof UsageError) { console.error(`usage error: ${e.message}`); process.exit(1); }
    if (e instanceof Refusal) { console.error(e.message); process.exit(2); }
    throw e;
  }
}
