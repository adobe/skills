#!/usr/bin/env node
/**
 * spec-knowledge.mjs — S10 knowledge: turn the run's raw material and the judgement files into knowledge/, the
 * committed output every client reads (reference/knowledge.md is the contract). Figures in findings, feature reach
 * and question impact are computed with the rule format (rules.mjs), never typed.
 *
 *   node spec-knowledge.mjs [--config stardust/spec/spec.config.json]
 *
 * Reads <work>: inventory/, fetch/ (+ html/ for implementation.json#signals), parse/, links/, rum/rum.json, martech/,
 * map/{page-blocks.jsonl, variants.json}, media/ (which captures and crops exist). Reads <dir>/judgement/:
 * catalog.json, implementation.json, findings.json, search-probes.json, answers.json. Writes <dir>/knowledge/.
 * Exit 1 when a rule cannot be computed (the message names it).
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { arg, helpAndExit, loadConfig, loadSibling, log, readJSON, readJSONL, templateOf, urlKey, writeJSON, writeText } from './lib.mjs';
import { evalRule, fillText, selectUrls, tokens } from './rules.mjs';

helpAndExit(import.meta.url);

const CLASS_NAMES = { L: 'listing', S: 'search', F: 'form', M: 'modal / interactive', V: 'media', T: 'tag / consent', A: 'API / settings', R: 'relationship', X: 'auth / commerce', I18N: 'locale', CR: 'client-rendered', D: 'data file' };

export const band = (v) => (!v ? 'none' : v >= 10000 ? 'high' : v >= 1000 ? 'medium' : 'low');
export const outcome = (r) => (r.error ? (/loop/.test(r.error) ? 'loop' : 'error') : r.external ? 'redirect-external' : [301, 302, 303, 307, 308].includes(r.status) ? (r.final_status === 200 ? 'redirect' : 'redirect-broken') : r.status === 200 ? 'page' : `http-${r.status}`);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const nullFirst = (a, b) => (a === b ? 0 : a === null || a === undefined ? -1 : b === null || b === undefined ? 1 : byText(a, b));
const writeJSONL = (file, rows) => writeText(file, rows.map((r) => JSON.stringify(r)).join('\n'));

/**
 * One index of helix-query.yaml, in the dynamics skeleton (../../dynamics/reference/listings.md § Getting an index):
 * og title and image (as a path), the description meta, lastModified from the header, robots, `text` from main,
 * any other property from its own meta name. The target is scoped to the scope path unless the index names one. Pure.
 */
export function indexYaml(ix, scopePath) {
  const prop = (p) => {
    const q = (sel, val) => `      ${p}:\n        select: ${sel}\n        value: ${val}`;
    if (p === 'title') return q('head > meta[property="og:title"]', "attribute(el, 'content')");
    if (p === 'image') return q('head > meta[property="og:image"]', "match(attribute(el, 'content'), 'https:\\/\\/[^/]+(\\/.*)')");
    if (p === 'lastModified') return q('none', "parseTimestamp(headers['last-modified'], 'ddd, DD MMM YYYY hh:mm:ss GMT')");
    if (p === 'text') return q('main', 'textContent(el)');
    return q(`head > meta[name="${p.toLowerCase()}"]`, "attribute(el, 'content')");
  };
  const target = ix.target || `${scopePath.replace(/\/$/, '')}/${ix.name === 'default' ? 'query-index' : ix.name}.json`;
  return [`  ${ix.name}:`, '    include:', ...ix.include.map((p) => `      - '${p}'`), ...(ix.exclude?.length ? ['    exclude:', ...ix.exclude.map((p) => `      - '${p}'`)] : []),
    `    target: ${target}`, '    properties:', ...ix.properties.map((p) => prop(p.split(' ')[0]))].join('\n');
}

/**
 * The URL each page is served at: its delivered URL, with the trailing slash of a folder index when other pages live
 * below it (on EDS `/a` 404s and `/a/` serves the folder's index document). Pure given deliveredUrl.
 */
export function servedUrls(pagePaths, deliveredUrl) {
  const parents = new Set();
  for (const p of pagePaths) { const segs = deliveredUrl(p).split('/').filter(Boolean); for (let i = 1; i < segs.length; i += 1) parents.add(`/${segs.slice(0, i).join('/')}`); }
  return new Map(pagePaths.map((p) => { const e = deliveredUrl(p); return [p, e !== '/' && !e.endsWith('/') && parents.has(e) ? `${e}/` : e]; }));
}

/**
 * Page types for the archetype pickers (extract --prep, prototype --prep, replica, reskin): within each template the
 * layout variants that cover `cut` of its pages (the largest always, then variants of two pages or more) are types,
 * the tail folds into the template's largest type, a one-page template is `unique`. One representative per type,
 * so migrate's one-archetype-per-type rule holds by construction. Pure.
 */
export function archetypes(urls, variants, cut = 0.8) {
  const pages = urls.filter((u) => u.outcome === 'page' && u.in_sitemap === 1);
  const byVariant = new Map(); pages.forEach((u) => { const k = u.variant_code || null; if (!byVariant.has(k)) byVariant.set(k, []); byVariant.get(k).push(u); });
  const byTemplate = new Map(); pages.forEach((u) => { const t = u.template || '(none)'; byTemplate.set(t, (byTemplate.get(t) || 0) + 1); });
  const slugOf = (t) => (String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'other');
  const types = []; const unique = { type: 'unique', template: null, variant_codes: [], rep_url: null, urls: [] };
  for (const [t, n] of [...byTemplate].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
    const vs = variants.filter((v) => (v.template_id || '(none)') === t).sort((a, b) => a.rank - b.rank);
    const members = (code) => (byVariant.get(code) || []).map((u) => u.url);
    if (n === 1) { unique.urls.push(...pages.filter((u) => (u.template || '(none)') === t).map((u) => u.url)); continue; }
    let covered = 0; let top = null;
    for (const v of vs) {
      const urlsOf = members(v.code);
      if (top && (covered / n >= cut || urlsOf.length < 2)) { top.variant_codes.push(v.code); top.urls.push(...urlsOf); continue; }
      const row = { type: top ? `${slugOf(t)}-${v.rank}` : slugOf(t), template: t, variant_codes: [v.code], rep_url: v.rep_url, urls: urlsOf };
      types.push(row); top = top || row; covered += urlsOf.length;
    }
    const all = pages.filter((u) => (u.template || '(none)') === t).map((u) => u.url);
    if (!top) { types.push({ type: slugOf(t), template: t, variant_codes: [], rep_url: all[0], urls: all }); continue; }
    const placed = new Set(types.filter((x) => x.template === t).flatMap((x) => x.urls));
    top.urls.push(...all.filter((u) => !placed.has(u))); // pages without a layout variant join the template's largest type
  }
  if (unique.urls.length) types.push(unique);
  return { cut, types: types.map((x) => ({ ...x, url_count: x.urls.length })) };
}

/** A reach rule from implementation.json: the rule format only; SQL and the retired kinds fail loudly. Pure. */
export function reachRule(rule) {
  const r = String(rule || '').trim();
  if (/^(sql|url|bvariant):/.test(r)) throw new Error(`reach "${r}": ${r.split(':')[0]}: is retired — write it in the rule format (reference/knowledge.md § Rules)`);
  return tokens(r);
}

/** Feature rows whose class, disposition, reproducibility or status is outside the dynamics vocabulary. Pure. */
export function offVocabulary(features, taxonomy) {
  const out = [];
  for (const f of features) for (const k of ['class', 'disposition', 'reproducibility', 'status']) {
    const v = k === 'status' ? (f.status || 'pending') : f[k];
    if (!taxonomy[k].includes(v)) out.push(`${f.id}: ${k} "${v}" (one of ${taxonomy[k].join(', ')})`);
  }
  return out;
}

/** The latest recorded answer per question id, from judgement/answers.json. Pure. */
export function latestAnswers(list) {
  const out = {};
  for (const a of list || []) if (a && a.question) out[a.question] = { answer: a.answer ?? null, option: a.option ?? null, by: a.by ?? null, at: a.at ?? null };
  return out;
}

async function main() {
  const cfg = loadConfig();
  // the delivered URL of a source page: deploy's one path contract (../../deploy/scripts/eds-path.mjs)
  const { deliveredUrl: edsPath } = await loadSibling('deploy', 'eds-path.mjs');
  const W = (...p) => cfg.w(...p); const J = (...p) => cfg.p('judgement', ...p); const OUT = (...p) => cfg.p('knowledge', ...p);
  const rum = readJSON(W('rum', 'rum.json'), { available: false });
  const views = rum.available ? rum.pages : {};
  const sitemapUrls = new Set(readFileSync(W('inventory', 'urls.txt'), 'utf8').split('\n').filter(Boolean));
  const fetchRows = readJSONL(W('fetch', 'fetch.jsonl'));
  const disc = readJSONL(W('links', 'pages.jsonl'));
  const comps = new Map(readJSONL(W('parse', 'components.jsonl')).concat(readJSONL(W('links', 'components.jsonl'))).map((r) => [r.url, r]));
  const blocksOf = new Map(readJSONL(W('map', 'page-blocks.jsonl')).map((r) => [r.url, r]));
  const variants = readJSON(W('map', 'variants.json'), []);
  const varOf = new Map(variants.flatMap((v) => v.urls.map((u) => [u, v.code])));
  const catalog = readJSON(J('catalog.json'), { blocks: {} });
  const impl = readJSON(J('implementation.json'), {});
  const media = W('media');
  const captured = (u) => (existsSync(join(media, urlKey(u), 'boxes.json')) && !readJSON(join(media, urlKey(u), 'boxes.json')).error ? urlKey(u) : null);

  // ---- urls
  const livePaths = [...fetchRows, ...disc].filter((r) => outcome(r) === 'page').map((r) => { try { return new URL(r.url).pathname; } catch { return null; } }).filter(Boolean);
  const served = servedUrls([...new Set(livePaths)], edsPath);
  const urls = []; const uid = new Map(); const byUrl = new Map(); let id = 0;
  const sp = cfg.scopePath.split('/').filter(Boolean).length;
  const addUrl = (r, inSitemap) => {
    const path = new URL(r.url).pathname; const segs = path.split('/').filter(Boolean); const oc = outcome(r); const isPage = oc === 'page';
    const pv = views[path] || {}; const pb = isPage ? blocksOf.get(r.url) : null; const c = comps.get(r.url);
    const nblocks = pb ? new Set(pb.blocks.filter((b) => b.kind === 'block' || b.kind === 'dynamic').map((b) => b.block)).size : null;
    const dyn = pb && pb.blocks.some((b) => b.kind === 'dynamic');
    let flag = null;
    if (isPage && /thank-?you/i.test(path)) flag = 'thank-you'; else if (isPage && c && c.main_chars < 50 && !nblocks && !dyn) flag = 'empty';
    const e = served.get(path) || edsPath(path);
    id += 1;
    const row = { id, url: r.url, path, section: segs[sp] ? segs[sp].replace('.html', '') : '(root)', depth: segs.length, in_sitemap: inSitemap, status: r.status ?? null,
      final_url: r.final_url ?? null, final_status: r.final_status ?? null, outcome: oc, template: isPage ? templateOf(r, cfg) : null,
      variant_code: isPage ? (varOf.get(r.final_url) || varOf.get(r.url) || null) : null, title: isPage ? (r.title || null) : null, eds_path: isPage ? e : null,
      needs_migration_redirect: isPage && e !== path ? 1 : 0, pageviews_90d: Math.round(pv.views || 0),
      rum_bundles: pv.bundles || 0, traffic_band: rum.available ? band(pv.views) : null, block_count: nblocks, capture_key: isPage ? captured(r.url) : null,
      main_chars: c ? c.main_chars : null, flag, blocked: r.blocked ?? null };
    if (byUrl.has(r.url)) urls.splice(urls.indexOf(byUrl.get(r.url)), 1); // a URL listed twice keeps its last row
    urls.push(row); byUrl.set(r.url, row); uid.set(r.url, id);
  };
  fetchRows.forEach((r) => addUrl(r, sitemapUrls.has(r.url) ? 1 : 0));
  disc.filter((r) => !uid.has(r.url) && new URL(r.url).pathname.startsWith(cfg.scopePath)).forEach((r) => addUrl(r, 0));
  const urlById = new Map(urls.map((u) => [u.id, u]));

  // ---- page blocks (+ chrome globals) with crops
  const pageBlocks = []; const examples = {};
  for (const [u, i] of uid) {
    const pb = blocksOf.get(u); const row = urlById.get(i);
    if (!pb || !row || row.outcome !== 'page') continue;
    const ck = row.capture_key; const chrome = comps.get(u)?.chrome || {};
    const out = []; let pos = -1;
    Object.entries(chrome).filter(([, v]) => v).forEach(([k]) => { if (k !== 'footer') out.push({ pos: pos--, block: k, variant: null, kind: 'global', source: [], path: null, nested_in: null, section: null, crop: null }); });
    let last = 0;
    for (const b of pb.blocks) {
      const crop = ck && b.path && existsSync(join(media, ck, `${b.path}.jpg`)) ? `${ck}/${b.path}.jpg` : null;
      if (crop && (b.kind === 'block' || b.kind === 'dynamic')) { const k = `${b.block}|${b.variant}`; (examples[k] = examples[k] || []).length < 4 && examples[k].push({ url: u, crop }); }
      out.push({ pos: b.pos, block: b.block, variant: b.variant ?? null, kind: b.kind, source: b.aem || [], path: b.path ?? null, nested_in: b.nested_in ?? null, section: b.section ?? null, crop });
      last = b.pos;
    }
    if (chrome.footer) out.push({ pos: last + 1, block: 'footer', variant: null, kind: 'global', source: [], path: null, nested_in: null, section: null, crop: null });
    pageBlocks.push({ url_id: i, url: u, blocks: out });
  }
  const sitemapPages = pageBlocks.filter((p) => urlById.get(p.url_id).in_sitemap === 1);

  // ---- blocks + variants from the catalog
  const blocks = [];
  for (const [name, b] of Object.entries(catalog.blocks || {})) {
    const on = sitemapPages.filter((p) => p.blocks.some((x) => x.block === name));
    const inst = on.flatMap((p) => p.blocks.filter((x) => x.block === name).map((x) => ({ ...x, url_id: p.url_id })));
    const tpl = new Set(on.map((p) => urlById.get(p.url_id).template).filter((t) => t !== null && t !== undefined));
    const byVar = new Map();
    inst.forEach((x) => { const k = x.variant ?? null; if (!byVar.has(k)) byVar.set(k, { pages: new Set(), n: 0 }); byVar.get(k).pages.add(x.url_id); byVar.get(k).n += 1; });
    const vs = [...byVar.keys()].sort(nullFirst).map((v) => {
      const vd = (b.variants || {})[v ?? ''] || {};
      return { variant: v, verdict: vd.verdict || b.verdict, rationale: vd.rationale || b.rationale || null, url_count: byVar.get(v).pages.size, instance_count: byVar.get(v).n, examples: examples[`${name}|${v}`] || [] };
    });
    blocks.push({ name, kind: b.kind, family: b.family ?? null, description: b.description, source: b.aem || [], reference_block: b.reference ?? null, verdict: b.verdict, rationale: b.rationale ?? null,
      url_count: on.length, instance_count: inst.length, template_count: tpl.size, pageviews_90d: on.reduce((a, p) => a + (urlById.get(p.url_id).pageviews_90d || 0), 0), variants: vs });
  }
  const named = new Set(blocks.map((b) => b.name));
  const missing = [...new Set(pageBlocks.flatMap((p) => p.blocks.filter((x) => ['block', 'dynamic', 'global'].includes(x.kind) && !named.has(x.block)).map((x) => x.block)))];
  if (missing.length) log(`WARNING blocks missing from judgement/catalog.json: ${missing.join(', ')}`);

  // ---- source components → blocks
  const cp = {};
  for (const [u, pb] of blocksOf) { if (!uid.has(u)) continue; for (const b of pb.blocks) for (const a of b.aem || []) { const e = cp[a] || (cp[a] = { pages: new Set(), n: 0, to: {} }); e.pages.add(u); e.n += 1; const t = b.kind === 'default' ? 'default-content' : b.block; e.to[t] = (e.to[t] || 0) + 1; } }
  const sourceComponents = Object.entries(cp).map(([name, e]) => ({ name, url_count: e.pages.size, instance_count: e.n, maps_to: e.to }));

  // ---- templates + variants
  const labels = impl.template_labels || {};
  const tg = new Map();
  urls.filter((u) => u.outcome === 'page' && u.in_sitemap === 1).forEach((u) => { const g = tg.get(u.template) || { n: 0, pv: 0 }; g.n += 1; g.pv += u.pageviews_90d; tg.set(u.template, g); });
  const templates = [...tg.keys()].sort(nullFirst).map((t) => {
    const vs = variants.filter((v) => v.template === t);
    const share = vs.slice(0, 5).reduce((a, v) => a + v.pages, 0) / Math.max(1, vs.reduce((a, v) => a + v.pages, 0));
    return { id: t, label: labels[t] || t, url_count: tg.get(t).n, pageviews_90d: tg.get(t).pv, variant_count: vs.length, top_variants_share: Math.round(share * 1000) / 1000, rep_url: vs[0]?.representative ?? null };
  });
  const variantRows = variants.map((v) => {
    const pv = v.urls.reduce((a, u) => { try { return a + (views[new URL(u).pathname]?.views || 0); } catch { return a; } }, 0);
    return { code: v.code, template_id: v.template, rank: Number(v.code.split('#')[1]), label: v.core.length ? v.core.join(' + ') : 'default content only', core: v.core, optional: v.optional, url_count: v.pages, pageviews_90d: Math.round(pv), distinct_sets: v.distinct_sets, rep_url: v.representative, rep_capture_key: captured(v.representative) };
  });

  // ---- redirects (legacy + migration), broken, bad links
  const inbound = new Map(); const inboundMain = new Map();
  for (const r of readJSONL(W('parse', 'links.jsonl')).concat(readJSONL(W('links', 'links.jsonl')))) {
    for (const [u, z] of Object.entries(r.links || {})) { if (!inbound.has(u)) { inbound.set(u, new Set()); inboundMain.set(u, new Set()); } inbound.get(u).add(r.url); if (z === 'main') inboundMain.get(u).add(r.url); }
  }
  const redirects = [];
  const addRedirect = (r, inSm) => redirects.push({ src: r.url, target: r.final_url ?? null, status: r.status ?? null, hops: (r.chain || []).length, kind: 'legacy', target_status: r.final_status ?? null, external: r.external ? 1 : 0, in_sitemap: inSm, inbound_pages: inbound.get(r.url)?.size || 0, rum_views: Math.round(views[new URL(r.url).pathname]?.views || 0), note: /loop/.test(r.error || '') ? 'redirect loop' : null });
  fetchRows.filter((r) => (r.chain || []).length).forEach((r) => addRedirect(r, sitemapUrls.has(r.url) ? 1 : 0));
  disc.filter((r) => (r.chain || []).length && !sitemapUrls.has(r.url)).forEach((r) => addRedirect(r, 0));
  urls.filter((u) => u.needs_migration_redirect === 1).forEach((u) => redirects.push({ src: u.path, target: u.eds_path, status: 301, hops: 1, kind: 'migration', target_status: 200, external: 0, in_sitemap: 1, inbound_pages: inbound.get(u.url)?.size || 0, rum_views: Math.round(views[u.path]?.views || 0), note: 'EDS path normalisation' }));
  const redirectLandings = rum.available ? Object.entries(rum.redirectLandings || {}).map(([p, v]) => ({ path: p, views: Math.round(v.views), bundles: v.bundles })) : [];
  const inScope = (u) => { try { return new URL(u).pathname.startsWith(cfg.scopePath) ? 1 : 0; } catch { return 0; } };
  const broken = [];
  const addBroken = (u, status, source, kind, note, rv = 0, rb = 0, refs = null) => broken.push({ url: u, status, source, kind, in_scope: inScope(u), inbound_pages: inbound.get(u)?.size || 0, inbound_main: inboundMain.get(u)?.size || 0, rum_views: Math.round(rv), rum_bundles: rb, referrers: refs, note: note ?? null });
  fetchRows.forEach((r) => { if (r.final_status >= 400) addBroken(r.url, r.final_status, 'sitemap', 'page', (r.chain || []).length ? 'sitemap URL redirects into a dead page' : null); if (/loop/.test(r.error || '')) addBroken(r.url, 310, 'sitemap', 'page', 'redirect loop'); });
  disc.forEach((r) => { if (r.final_status >= 400) addBroken(r.url, r.final_status, 'link', 'page', (r.chain || []).length ? 'linked page redirects into a dead page' : null); });
  readJSONL(W('links', 'assets.jsonl')).forEach((r) => { if (r.final_status >= 400) addBroken(r.url, r.final_status, 'link', 'asset'); });
  if (rum.available) Object.entries(rum.notFound || {}).forEach(([p, v]) => addBroken(`${cfg.origin}${p}`, 404, 'rum', 'page', null, v.views, v.bundles, Object.fromEntries(Object.entries(v.referrers || {}).sort((a, b) => b[1] - a[1]).slice(0, 10))));
  const bad = new Set([...broken.map((r) => r.url), ...redirects.filter((r) => r.kind === 'legacy').map((r) => r.src)]);
  // one row per dead or redirected target: the pages linking to it from their main content and from the chrome
  const badLinks = [];
  for (const to of bad) {
    const row = { to_url: to, main: [], chrome: [] };
    for (const frm of inbound.get(to) || []) if (uid.has(frm)) row[inboundMain.get(to)?.has(frm) ? 'main' : 'chrome'].push(uid.get(frm));
    if (row.main.length || row.chrome.length) badLinks.push(row);
  }

  // ---- page signals: built-in (from parse) + site regexes over the raw HTML (implementation.json#signals)
  const live = urls.filter((u) => u.outcome === 'page' && u.in_sitemap === 1); const pageId = new Map(live.map((p) => [p.url, p.id]));
  const sigRows = readJSONL(W('parse', 'signals.jsonl'));
  const custom = Object.entries(impl.signals || {}).map(([k, re]) => [k, new RegExp(re)]);
  const fetchByUrl = new Map(fetchRows.map((r) => [r.url, r]));
  const signals = [];
  for (const s of sigRows) {
    if (!pageId.has(s.url)) continue;
    const list = [];
    if (s.hreflang.length) list.push('hreflang');
    s.scriptHosts.forEach((h) => list.push(`script:${h}`)); s.iframeHosts.forEach((h) => list.push(`iframe:${h}`));
    s.jsonld.forEach((t) => list.push(`jsonld:${t}`));
    if (custom.length) {
      const r = fetchByUrl.get(s.url);
      if (r?.html_key) { const html = gunzipSync(readFileSync(join(W('fetch', 'html'), `${r.html_key}.html.gz`))).toString('utf8'); custom.forEach(([k, re]) => { if (re.test(html)) list.push(k); }); }
    }
    signals.push({ url_id: pageId.get(s.url), url: s.url, signals: list });
  }

  const K = { urls, pageBlocks, signals, blocks, variants: variantRows, templates, redirects, broken, badLinks, features: [] };

  // ---- features: reach in the rule format
  // dynamics consumes these rows: they use its vocabulary (../../dynamics/reference/triage.md) or the stage stops
  const { TAXONOMY } = await loadSibling('dynamics', 'lib.mjs');
  const off = offVocabulary(impl.features || [], TAXONOMY);
  if (off.length) throw new Error(`implementation.json features outside the dynamics vocabulary:\n  ${off.join('\n  ')}`);
  const nlive = live.length; const featByQ = {}; const features = [];
  for (const f of impl.features || []) {
    const set = selectUrls(K, reachRule(f.reach), f.reach); const sitewide = set.length >= 0.9 * nlive ? 1 : 0;
    features.push({ id: f.id, class: f.class, class_name: CLASS_NAMES[f.class] || f.class, name: f.name, evidence: f.evidence, disposition: f.disposition, reproducibility: f.reproducibility, status: f.status || 'pending', pattern: f.pattern, eds: f.eds, decisions: f.decisions || [],
      sitewide, reach: f.reach, reach_pages: set.length, reach_templates: new Set(set.map((u) => u.template).filter((t) => t !== null && t !== undefined)).size, pageviews_90d: set.reduce((a, u) => a + (u.pageviews_90d || 0), 0), pages: sitewide ? [] : set.map((u) => u.id) });
    (f.decisions || []).forEach((q) => { (featByQ[q] = featByQ[q] || []).push(f.id); });
  }
  K.features = features;

  // ---- martech: vendors, tag-manager rules, data layer
  const ven = readJSON(W('martech', 'vendors.json'), { vendors: [] });
  const launch = readJSON(W('martech', 'launch.json'), null);
  const ot = readJSON(W('martech', 'onetrust.json'), []);
  const otGroup = {}; ot.forEach((d) => d.ruleSets.forEach((rs) => rs.groups.forEach((g) => g.hosts.forEach((h) => { otGroup[h.replace(/^\./, '')] = otGroup[h.replace(/^\./, '')] || `${g.id} ${g.name}`; }))));
  const base = (h) => h.split('.').slice(-2).join('.');
  const launchHosts = {}; (launch?.rules || []).forEach((r) => (r.loads || []).forEach((h) => { launchHosts[h] = (launchHosts[h] || 0) + 1; }));
  const vendors = [...new Set([...ven.vendors.map((v) => v.host), ...Object.keys(launchHosts)])].map((h) => {
    const v = ven.vendors.find((x) => x.host === h) || {};
    return { host: h, role: v.role || (launchHosts[h] ? 'loaded by tag-manager custom code' : 'unclassified — inspect'), class: v.class || 'T', seen_pages: v.pages || 0, via: [v.pages ? 'page' : null, launchHosts[h] ? 'launch' : null].filter(Boolean).join(','), in_csp: v.inCsp ? 1 : 0, consent_group: otGroup[h] || otGroup[base(h)] || null, launch_rules: launchHosts[h] || 0 };
  });
  const byPathRow = new Map(); urls.forEach((u) => { if (!byPathRow.has(u.path)) byPathRow.set(u.path, u); });
  const pagePaths = new Set(urls.filter((u) => u.outcome === 'page').map((u) => u.path));
  const lr = new Map();
  for (const r of launch?.rules || []) {
    const m = r.name.match(/^(?:Event|Tracking Pixel|Pixel):\s*([A-Za-z0-9 .]+?)\s*[(\-|]/);
    const kind = r.paths.length ? 'campaign' : /^ACDL|data ?layer/i.test(r.name) ? 'acdl' : 'global';
    const htmlPaths = r.paths.filter((p) => p.includes('.html')).length;
    lr.set(r.id, { id: r.id, name: r.name, vendor: m ? m[1].trim() : r.name.split(/[:|]/)[0].trim().slice(0, 40), kind, events: r.events, path_values: r.paths, html_paths: htmlPaths, selectors: r.selectors, hosts: r.loads || [],
      needs_rewrite: htmlPaths > 0 || r.selectors.length > 0 ? 1 : 0, eds_paths: r.paths.map((p) => byPathRow.get(p.split('?')[0])?.eds_path ?? null), live_pages: r.paths.filter((p) => pagePaths.has(p.split('?')[0])).length });
  }
  const launchRules = [...lr.values()];
  const byPath = {};
  (launch?.dataElements || []).forEach((d) => {
    const key = d.type === 'datalayerComputedState' ? d.source : d.selectors?.length ? `dom: ${d.selectors.join(' ; ')}` : null;
    if (key) (byPath[key] = byPath[key] || { names: [], dom: !!d.selectors?.length }).names.push(d.name);
  });
  const datalayer = Object.entries(byPath).map(([p, v]) => ({ path: p, data_elements: v.names, group_name: v.dom ? 'DOM-read (breaks when markup changes)' : (p.split('.')[1] || p.split('.')[0]), eds_source: v.dom ? 'rewrite the data element or emit the value in the data layer' : 'page metadata or block event' }));

  // ---- metadata contract (coverage from the page signals), query indexes, locales, site config, probes
  const valOf = (s, src) => (src.startsWith('body:') ? s.bodyData[src.slice(5)] : src.startsWith('meta:') ? s.meta[src.slice(5)] : null);
  const cov = (src) => sigRows.filter((s) => pageId.has(s.url) && valOf(s, src)).length;
  const vals = (src) => { const c = {}; sigRows.forEach((s) => { const v = valOf(s, src); if (v) c[v] = (c[v] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]); };
  const metadata = (impl.metadata_contract || []).map((m) => { const v = m.source ? vals(m.source) : []; return { name: m.name, source: m.aem || m.source, used_by: m.used_by || [], coverage_pages: m.source ? cov(m.source) : null, distinct_values: v.length || null, top_values: v.length ? v.slice(0, 12) : null }; });
  const queryIndexes = (impl.query_indexes || []).map((ix) => ({ name: ix.name, include_paths: ix.include, exclude_paths: ix.exclude || [], filter: ix.filter ?? null, properties: ix.properties, consumers: ix.consumers || [], source: ix.source ?? null, yaml: indexYaml(ix, cfg.scopePath) }));
  const sm = readJSON(W('inventory', 'sitemaps.json'), {});
  const scopeRoot = cfg.scopePath.split('/').filter(Boolean).slice(0, 2).join('/');
  const trees = {}; Object.entries(sm).forEach(([file, s]) => Object.entries(s.roots).forEach(([root, n]) => { const t = root.replace(/^\//, ''); if (/^[a-z]{2}\/[a-z]{2}$/.test(t) || t === scopeRoot) { trees[t] = trees[t] || { urls: 0, file }; trees[t].urls += n; } }));
  const rumTrees = Object.fromEntries((rum.trees || []).map(([k, v]) => [k, v.views]));
  const locales = Object.entries(trees).map(([t, v]) => ({ tree: t, country: t.split('/')[0], language: t.split('/')[1] || null, urls: v.urls, shared_with_scope: null, shared_pct: null, rum_views_90d: Math.round(rumTrees[t] || 0), deep_sampled: 0, live_pages: null, templates: null, blocks: null, unmapped: null, sitemap: v.file }));
  const siteConfig = (impl.site_config || []).map((s) => ({ key: s.key, now: s.now, eds: s.eds, decision: s.decision ?? null }));
  const searchProbes = readJSON(J('search-probes.json'), []).map((p) => ({ term: p.term, expect_count: p.expectCount, expect_titles: p.expectTitles || [], expect_includes: p.expectIncludes ?? null, feature: p.feature ?? null, path: p.path ?? null, param: p.param ?? null }));
  Object.assign(K, { vendors, launchRules, datalayer, metadata, queryIndexes, locales, siteConfig, searchProbes, sourceComponents });

  // ---- open questions: impact in the rule format, recorded answers applied
  const answers = latestAnswers(readJSON(J('answers.json'), []));
  const openQuestions = (impl.open_questions || []).map((q) => {
    const rule = q.impact ?? q.impact_rule ?? null;
    if (rule && /^sql:/.test(rule)) throw new Error(`open question ${q.id}: sql: impact rules are retired — write it in the rule format (reference/knowledge.md § Rules)`);
    const a = answers[q.id] || null;
    return { id: q.id, area: q.area, owner: q.owner, blocking: q.blocking ? 1 : 0, question: q.question, context: q.context, options: q.options || [], default_assumption: q.default,
      impact_rule: rule, impact: rule ? evalRule(K, rule) : null, link: q.link ?? null, features: featByQ[q.id] || [], answer: a, effective: a?.answer ?? q.default };
  });
  K.openQuestions = openQuestions;

  // ---- findings: { title, text } with every {{rule}} computed
  const findings = readJSON(J('findings.json'), []).map((f) => { const o = typeof f === 'string' ? { title: null, text: f } : f; const t = fillText(K, o.text); return { title: o.title ?? null, text: t.text, numbers: t.numbers }; });

  // ---- site facts
  const src = {}; let arch = [];
  fetchRows.forEach((r) => { src[r.source || 'live'] = (src[r.source || 'live'] || 0) + 1; if (r.archived_at) arch.push(r.archived_at); });
  arch = arch.sort();
  const inv = readJSON(W('inventory', 'summary.json'), null);
  const site = {
    site: cfg.site || new URL(cfg.origin).hostname, origin: cfg.origin, scope_path: cfg.scopePath,
    reference_blocks: cfg.referenceBlocks ? { name: cfg.referenceBlocks.name ?? null, count: cfg.referenceBlocks.count ?? null } : null,
    rum: { available: !!rum.available, window: rum.window || null, bundles: rum.bundles ?? null },
    sitemap_urls: sitemapUrls.size, inventory_total: inv?.total ?? null, inventory_source: inv?.source ?? null,
    sample_note: inv?.sampled ? `a sample of ${inv.kept.toLocaleString('en-US')} of ${inv.total.toLocaleString('en-US')} ${inv.source === 'crawl' ? 'crawled' : 'sitemap'} URLs, even per section` : null,
    fetch_sources: src, evidence_note: arch.length ? `${arch.length.toLocaleString('en-US')} pages come from Internet Archive captures (${arch[0]} to ${arch[arch.length - 1]}), not the live site` : null,
    built_at: new Date().toISOString().slice(0, 19), built_by: 'stardust spec skill', provenance: impl.provenance || 'built from the live site only; it uses no output from any migration work',
    variant_cut: 'Jaccard 0.5 average linkage', capture_format: 'jpg', i18n_notes: impl.i18n_notes || [],
  };

  // ---- write: the folder is replaced whole, so a removed row never lingers
  rmSync(OUT(), { recursive: true, force: true });
  writeJSON(OUT('site.json'), site);
  writeJSONL(OUT('urls.jsonl'), urls); writeJSONL(OUT('page-blocks.jsonl'), pageBlocks); writeJSONL(OUT('signals.jsonl'), signals);
  writeJSON(OUT('blocks.json'), blocks); writeJSON(OUT('variants.json'), variantRows); writeJSON(OUT('templates.json'), templates); writeJSON(OUT('source-components.json'), sourceComponents);
  writeJSONL(OUT('redirects.jsonl'), redirects); writeJSONL(OUT('broken.jsonl'), broken); writeJSONL(OUT('bad-links.jsonl'), badLinks); writeJSON(OUT('redirect-landings.json'), redirectLandings);
  writeJSON(OUT('features.json'), features);
  // evidence: spec-martech's own files, unchanged, so the dynamics martech contract builds from knowledge alone
  writeJSON(OUT('martech.json'), { consent_summary: impl.consent_summary || null, loading_order: impl.loading_order || null, vendors, launch_rules: launchRules, datalayer, evidence: { launch, onetrust: ot } });
  writeJSON(OUT('metadata.json'), metadata); writeJSON(OUT('query-indexes.json'), queryIndexes);
  if (queryIndexes.length) writeText(OUT('helix-query.yaml'), ['version: 1', 'indices:', ...queryIndexes.map((q) => q.yaml)].join('\n')); writeJSON(OUT('locales.json'), locales); writeJSON(OUT('site-config.json'), siteConfig);
  writeJSON(OUT('archetypes.json'), archetypes(urls, variantRows));
  writeJSON(OUT('search-probes.json'), searchProbes); writeJSON(OUT('open-questions.json'), openQuestions); writeJSON(OUT('findings.json'), findings);
  for (const [k, v] of Object.entries({ urls, pageBlocks, blocks, variants: variantRows, templates, redirects, broken, features, vendors, launchRules, openQuestions, locales })) log(`${k} ${v.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
