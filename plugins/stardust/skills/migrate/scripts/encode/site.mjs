/**
 * migrate/encode/site.mjs — the encoder's site inputs: the page roster and template membership, each page's paths, and
 * the resolvers for media, documents, chrome and internal links. A library module (no CLI); it reads committed project
 * artifacts only (no network), and nothing runs on import.
 *
 * Reads, under <projectRoot>/stardust/ (a missing file reads as empty; a malformed JSON file throws, naming it):
 *   rollout/coverage/templates.json  the roster: templates[].{id, representativeSlug, pages[]} (rollout inventory)
 *   current/pages/<slug>.json        the page record; its `url` (else state.json pages[].url by slug, resolved
 *                                    against site.originUrl)
 *   deploy/media-ledger.json         {"media/<scope>/<file>": {contentUrl, source, sources[], status, …}}
 *   deploy/asset-ledger.json         {"<absolute source URL>": {path: "/docs/<file>", sha256, bytes}}
 *   rollout/chrome-map.json          {groups: {<id>: {nav, footer, lang, pages[]}}}; other keys ignored
 *   redirects.tsv                    parsed by deploy's localize-links.mjs (redirectPairs)
 * Path rules are deploy's: eds-path.mjs (deliveredUrl, daPath, pathKey) and localize-links.mjs (localizeHref,
 * redirectPairs), loaded through deps.mjs in either layout. That load is why loadSite is async.
 *
 * const site = await loadSite(projectRoot) →
 *   projectRoot                 absolute
 *   slugs                       every roster slug, sorted
 *   templates                   [{id, archetype, pages[]}] sorted by id (archetype = representativeSlug, else id)
 *   templateOf(name)            the template whose archetype, else id, is `name`; null when none
 *   pageJson(slug)              the parsed page record, or null
 *   pageUrl(slug)               the absolute source URL, or null
 *   page(slug)                  {slug, url, template, deliveredUrl, daPath, capturePath, pageJsonPath, outputPath,
 *                               contentPath}, or null without a URL; paths are POSIX, relative to projectRoot
 *   capturePath(slug)           stardust/current/pages/<slug>.html
 *   outputPathFor(slug)         stardust/encoded/<da-path>.html (the root page: index.html), or null
 *   contentPathFor(slug)        content/<da-path>.html, or null
 *   resolveMedia(absUrl)        the ledger entry's contentUrl for a URL in its sources[] or source (a failed upload
 *                               never resolves), or null
 *   resolveDoc(absUrl)          the asset ledger's path for that URL, or null
 *   chromeFor(url)              {nav, footer, lang} of the chrome-map group holding the page (a source URL or a
 *                               delivered path, matched by pathKey of its delivered path); else /nav, /footer, null
 *   localizeHref(href, baseUrl) {href, internal, kind, unresolved?}; kind doc = a document link (.pdf …), page = any
 *                               other http(s) link to a source host, external, or skip:
 *                                 asset-ledger hit → its path (+ #fragment), internal
 *                                 source-host page in the roster or redirected to one → the delivered URL, internal
 *                                 source-host link to anything else, or a document (.pdf …) on any host with no
 *                                 ledger entry → kept absolute, unresolved: true
 *                                 another host → kept as written (made absolute when it was not); #, mailto:,
 *                                 tel:, javascript:, data: and empty hrefs → untouched (skip)
 *   sourceHosts                 the roster pages' hosts, lower case, `www.` and port dropped, sorted
 *   siteSha                     "sha256:<hex>" over what the encoder reads from these inputs, canonicalised: the
 *                               roster (slug, template, URL), media and document maps, chrome entries and redirect
 *                               pairs. Key order, upload timestamps and attempt counters never move it.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadDeploy } from './deps.mjs';

const DEFAULT_CHROME = { nav: '/nav', footer: '/footer', lang: null };
// a non-page link: rehosted through the asset ledger, reported in linksUnresolved when it has no entry
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|csv|zip|epub)$/i;
const SKIP = /^(#|mailto:|tel:|javascript:|data:)/i;
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : null);
const parseUrl = (u, base) => { try { return new URL(u, base); } catch { return null; } };
const normUrl = (u) => parseUrl(u)?.href ?? String(u);
const bareHost = (u) => u.hostname.toLowerCase().replace(/^www\./, '');

function readText(file) {
  try { return readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function readJson(file) {
  const raw = readText(file);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch (e) { throw new Error(`${file}: invalid JSON (${e.message})`); }
}

export async function loadSite(projectRoot) {
  const { deliveredUrl, daPath, pathKey } = await loadDeploy('eds-path.mjs');
  const links = await loadDeploy('localize-links.mjs');
  const root = resolve(projectRoot);
  const S = (...p) => join(root, 'stardust', ...p);

  // ---- roster and template membership (rollout's templates.json; main's plan walks the same pages[]) ----
  const tdoc = readJson(S('rollout', 'coverage', 'templates.json'));
  const templates = (Array.isArray(tdoc?.templates) ? tdoc.templates : [])
    .filter((t) => isObj(t) && str(t.id))
    .map((t) => ({ id: t.id, archetype: str(t.representativeSlug) || t.id, pages: [...new Set((Array.isArray(t.pages) ? t.pages : []).filter(str))].sort(byCodePoint) }))
    .sort((a, b) => byCodePoint(a.id, b.id));
  const templateBySlug = new Map();
  for (const t of templates) for (const s of t.pages) if (!templateBySlug.has(s)) templateBySlug.set(s, t.id);
  const slugs = [...templateBySlug.keys()].sort(byCodePoint);
  const templateOf = (name) => {
    const t = templates.find((x) => x.archetype === name) || templates.find((x) => x.id === name);
    return t ? { id: t.id, archetype: t.archetype, pages: [...t.pages] } : null;
  };

  // ---- pages: URL from the page record, else state.json ----
  const state = readJson(S('state.json'));
  const origin = str(state?.site?.originUrl);
  const stateUrls = new Map((Array.isArray(state?.pages) ? state.pages : []).filter((p) => isObj(p) && str(p.slug) && str(p.url)).map((p) => [p.slug, p.url]));
  const safeSlug = (s) => typeof s === 'string' && /^[^/\\]+$/.test(s) && !s.startsWith('.');
  const pageJsonCache = new Map();
  const pageJson = (slug) => {
    if (!safeSlug(slug)) return null;
    if (!pageJsonCache.has(slug)) pageJsonCache.set(slug, readJson(S('current', 'pages', `${slug}.json`)));
    return pageJsonCache.get(slug);
  };
  const pageUrl = (slug) => {
    for (const u of [str(pageJson(slug)?.url), stateUrls.get(slug)]) {
      const abs = u && parseUrl(u, origin || undefined);
      if (abs && /^https?:$/.test(abs.protocol)) return abs.href;
    }
    return null;
  };
  const page = (slug) => {
    const url = safeSlug(slug) ? pageUrl(slug) : null;
    if (!url) return null;
    const delivered = deliveredUrl(new URL(url).pathname);
    const da = daPath(delivered);
    return {
      slug, url, template: templateBySlug.get(slug) ?? null, deliveredUrl: delivered, daPath: da,
      capturePath: `stardust/current/pages/${slug}.html`, pageJsonPath: `stardust/current/pages/${slug}.json`,
      outputPath: `stardust/encoded${da}.html`, contentPath: `content${da}.html`,
    };
  };
  const rosterUrls = slugs.map((s) => [s, pageUrl(s)]).filter(([, u]) => u);
  const sourceHosts = [...new Set(rosterUrls.map(([, u]) => bareHost(new URL(u))))].sort(byCodePoint);

  // ---- media: every URL in an entry's sources[] (and its source) → its contentUrl ----
  const media = new Map();
  const mledger = readJson(S('deploy', 'media-ledger.json'));
  for (const key of Object.keys(isObj(mledger) ? mledger : {}).sort(byCodePoint)) {
    const e = mledger[key];
    if (!isObj(e) || !str(e.contentUrl) || e.status === 'failed') continue;
    for (const src of [...(Array.isArray(e.sources) ? e.sources : []), e.source].filter(str)) {
      const k = normUrl(src);
      if (!media.has(k)) media.set(k, e.contentUrl);
    }
  }
  const resolveMedia = (absUrl) => (str(absUrl) ? media.get(normUrl(absUrl)) ?? null : null);

  // ---- documents: the asset ledger ----
  const docs = new Map();
  const aledger = readJson(S('deploy', 'asset-ledger.json'));
  for (const key of Object.keys(isObj(aledger) ? aledger : {}).sort(byCodePoint)) {
    const e = aledger[key];
    if (isObj(e) && str(e.path)) { const k = normUrl(key); if (!docs.has(k)) docs.set(k, e.path); }
  }
  const resolveDoc = (absUrl) => (str(absUrl) ? docs.get(normUrl(absUrl)) ?? null : null);

  // ---- chrome: pathKey of each group page → the group's documents (groups in id order; the first claim wins) ----
  const chrome = new Map();
  const cmap = readJson(S('rollout', 'chrome-map.json'));
  const groups = isObj(cmap?.groups) ? cmap.groups : {};
  for (const id of Object.keys(groups).sort(byCodePoint)) {
    const g = groups[id];
    if (!isObj(g)) continue;
    const entry = { nav: str(g.nav) || DEFAULT_CHROME.nav, footer: str(g.footer) || DEFAULT_CHROME.footer, lang: str(g.lang) };
    for (const p of (Array.isArray(g.pages) ? g.pages : []).filter(str)) { const k = pathKey(p); if (!chrome.has(k)) chrome.set(k, entry); }
  }
  const pathOf = (url) => (String(url).startsWith('/') && !String(url).startsWith('//') ? String(url) : parseUrl(url)?.pathname ?? String(url));
  const chromeFor = (url) => ({ ...(chrome.get(pathKey(deliveredUrl(pathOf(url)))) || DEFAULT_CHROME) });

  // ---- internal links: localize-links' URL map, built from the roster instead of the content tree ----
  // Delivered keys first (what localize-links keys a content tree by), then the source paths, then redirects whose
  // destination is in the map and whose source is not (localize-links' own rule).
  const linkMap = new Map();
  const delivered = rosterUrls.map(([, u]) => { const p = new URL(u).pathname; return [p, deliveredUrl(p)]; });
  for (const [, d] of delivered) if (!linkMap.has(pathKey(d))) linkMap.set(pathKey(d), d);
  for (const [p, d] of delivered) if (!linkMap.has(pathKey(p))) linkMap.set(pathKey(p), d);
  const redirectsFile = S('redirects.tsv');
  const redirectsRaw = readText(redirectsFile);
  const redirects = redirectsRaw === null ? [] : links.redirectPairs(redirectsRaw, redirectsFile);
  const stripOrigin = (s) => s.replace(/^https?:\/\/[^/]+/i, '');
  for (const [s, d] of redirects) {
    const dst = linkMap.get(pathKey(stripOrigin(d)));
    const src = pathKey(stripOrigin(s));
    if (dst !== undefined && !linkMap.has(src)) linkMap.set(src, dst);
  }
  const linkCtx = { map: linkMap, hosts: sourceHosts };

  function localizeHref(href, baseUrl) {
    const raw = typeof href === 'string' ? href.trim() : '';
    if (!raw || SKIP.test(raw)) return { href: raw, internal: false, kind: 'skip' };
    const u = parseUrl(raw, baseUrl);
    if (!u || !/^https?:$/.test(u.protocol)) return { href: raw, internal: false, kind: 'skip' };
    const abs = /^https?:\/\//i.test(raw) ? raw : u.href;
    const isDoc = DOC_EXT.test(u.pathname);
    const hash = u.hash;
    u.hash = '';
    const doc = resolveDoc(u.href);
    if (doc) return { href: `${doc}${hash}`, internal: true, kind: 'doc' };
    u.hash = hash;
    // an absolute URL: localize-links answers localized (source host, in the map), kept-absolute (source host) or skip
    const r = links.localizeHref(u.href, linkCtx);
    if (r.action === 'localized') return { href: r.href, internal: true, kind: 'page' };
    if (r.action === 'kept-absolute' || isDoc) return { href: abs, internal: false, unresolved: true, kind: isDoc ? 'doc' : 'page' };
    return { href: abs, internal: false, kind: 'external' };
  }

  // ---- siteSha: the canonical form of everything above that can change an encoded document ----
  const canonical = {
    roster: slugs.map((s) => [s, templateBySlug.get(s), pageUrl(s)]),
    templates: templates.map((t) => [t.id, t.archetype]),
    media: [...media].sort((a, b) => byCodePoint(a[0], b[0])),
    docs: [...docs].sort((a, b) => byCodePoint(a[0], b[0])),
    chrome: [...chrome].sort((a, b) => byCodePoint(a[0], b[0])).map(([k, e]) => [k, e.nav, e.footer, e.lang]),
    redirects,
  };
  const siteSha = `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;

  return {
    projectRoot: root, slugs, templates: templates.map((t) => ({ ...t, pages: [...t.pages] })), templateOf,
    pageJson, pageUrl, page,
    capturePath: (slug) => (safeSlug(slug) ? `stardust/current/pages/${slug}.html` : null),
    outputPathFor: (slug) => page(slug)?.outputPath ?? null,
    contentPathFor: (slug) => page(slug)?.contentPath ?? null,
    resolveMedia, resolveDoc, chromeFor, localizeHref, sourceHosts, siteSha,
  };
}
