#!/usr/bin/env node
/**
 * spec-build.mjs — S10 package: assemble every stage's output into <dir>/spec.sqlite, the read-only database the
 * consumers read (reference/database.md is the contract). Numbers in findings are computed, never typed:
 * judgement/findings.json entries may embed {{SELECT …}} which the build replaces with the query's value.
 *
 *   node --no-warnings spec-build.mjs [--config spec.config.json] [--out <sqlite>]
 *
 * Inputs (under <dir>): inventory/, fetch/, links/, parse/, rum/rum.json, martech/, judgement/{page-blocks.jsonl,
 * variants.json, catalog.json, implementation.json, findings.json, search-probes.json}, media/ (captures).
 * Recorded decisions (question_answer), chat logs and saved views live only in the deployed database.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { arg, helpAndExit, loadConfig, log, readJSON, readJSONL, templateOf, urlKey } from './lib.mjs';

helpAndExit(import.meta.url);

const SCHEMA = `
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE url(id INTEGER PRIMARY KEY, url TEXT UNIQUE, path TEXT, section TEXT, depth INTEGER, in_sitemap INTEGER, status INTEGER,
  final_url TEXT, final_status INTEGER, outcome TEXT, aem_template TEXT, variant_code TEXT, title TEXT, eds_path TEXT,
  needs_migration_redirect INTEGER, pageviews_90d INTEGER, rum_bundles INTEGER, traffic_band TEXT, block_count INTEGER,
  capture_key TEXT, main_chars INTEGER, flag TEXT);
CREATE TABLE template(id TEXT PRIMARY KEY, label TEXT, url_count INTEGER, pageviews_90d INTEGER, variant_count INTEGER, top_variants_share REAL, rep_url TEXT);
CREATE TABLE variant(code TEXT PRIMARY KEY, template_id TEXT, rank INTEGER, label TEXT, core TEXT, optional TEXT, url_count INTEGER,
  pageviews_90d INTEGER, distinct_sets INTEGER, rep_url TEXT, rep_capture_key TEXT);
CREATE TABLE block(name TEXT PRIMARY KEY, kind TEXT, description TEXT, aem TEXT, reference_block TEXT, verdict TEXT, rationale TEXT,
  url_count INTEGER, instance_count INTEGER, template_count INTEGER, pageviews_90d INTEGER, family TEXT);
CREATE TABLE block_variant(id INTEGER PRIMARY KEY, block TEXT, variant TEXT, verdict TEXT, rationale TEXT, url_count INTEGER, instance_count INTEGER, examples TEXT);
CREATE TABLE page_block(url_id INTEGER, pos INTEGER, block TEXT, variant TEXT, kind TEXT, aem TEXT, path TEXT, nested_in TEXT, section TEXT, crop TEXT);
CREATE TABLE aem_component(name TEXT PRIMARY KEY, url_count INTEGER, instance_count INTEGER, maps_to TEXT);
CREATE TABLE redirect(id INTEGER PRIMARY KEY, src TEXT, target TEXT, status INTEGER, hops INTEGER, kind TEXT, target_status INTEGER, external INTEGER,
  in_sitemap INTEGER, inbound_pages INTEGER, rum_views INTEGER, note TEXT);
CREATE TABLE broken(id INTEGER PRIMARY KEY, url TEXT, status INTEGER, source TEXT, kind TEXT, in_scope INTEGER, inbound_pages INTEGER, inbound_main INTEGER,
  rum_views INTEGER, rum_bundles INTEGER, referrers TEXT, note TEXT);
CREATE TABLE link(from_url_id INTEGER, to_url TEXT, zone TEXT);
CREATE TABLE rum_redirect_landing(path TEXT PRIMARY KEY, views INTEGER, bundles INTEGER);
CREATE TABLE page_signal(url_id INTEGER, signal TEXT);
CREATE TABLE feature(id TEXT PRIMARY KEY, class TEXT, class_name TEXT, name TEXT, evidence TEXT, disposition TEXT, reproducibility TEXT, status TEXT,
  pattern TEXT, eds TEXT, decisions TEXT, sitewide INTEGER, reach_pages INTEGER, reach_templates INTEGER, pageviews_90d INTEGER);
CREATE TABLE feature_page(feature_id TEXT, url_id INTEGER);
CREATE TABLE vendor(host TEXT PRIMARY KEY, role TEXT, class TEXT, seen_pages INTEGER, via TEXT, in_csp INTEGER, consent_group TEXT, launch_rules INTEGER);
CREATE TABLE launch_rule(id TEXT PRIMARY KEY, name TEXT, vendor TEXT, kind TEXT, events TEXT, path_values TEXT, html_paths INTEGER, selectors TEXT,
  hosts TEXT, needs_rewrite INTEGER, eds_paths TEXT, live_pages INTEGER);
CREATE TABLE datalayer_field(path TEXT PRIMARY KEY, data_elements TEXT, group_name TEXT, eds_source TEXT);
CREATE TABLE metadata_field(name TEXT PRIMARY KEY, aem_source TEXT, used_by TEXT, coverage_pages INTEGER, distinct_values INTEGER, top_values TEXT);
CREATE TABLE query_index(name TEXT PRIMARY KEY, include_paths TEXT, exclude_paths TEXT, filter TEXT, properties TEXT, consumers TEXT, source TEXT, yaml TEXT);
CREATE TABLE locale_tree(tree TEXT PRIMARY KEY, country TEXT, language TEXT, urls INTEGER, shared_with_scope INTEGER, shared_pct INTEGER, rum_views_90d INTEGER,
  deep_sampled INTEGER, live_pages INTEGER, templates INTEGER, blocks INTEGER, unmapped TEXT, sitemap TEXT);
CREATE TABLE site_config(key TEXT PRIMARY KEY, now TEXT, eds TEXT, decision TEXT);
CREATE TABLE search_probe(term TEXT PRIMARY KEY, expect_count INTEGER, expect_titles TEXT, expect_includes TEXT);
CREATE TABLE open_question(id TEXT PRIMARY KEY, area TEXT, owner TEXT, blocking INTEGER, question TEXT, context TEXT, options TEXT, default_assumption TEXT,
  impact INTEGER, link TEXT, features TEXT);
CREATE TABLE question_answer(id INTEGER PRIMARY KEY, question_id TEXT, answer TEXT, decided_option TEXT, answered_by TEXT, answered_at TEXT);
CREATE TABLE chat_log(id INTEGER PRIMARY KEY, at TEXT, question TEXT, sql TEXT, answer TEXT, ms INTEGER, tokens INTEGER);
CREATE TABLE usage(day TEXT PRIMARY KEY, tokens INTEGER, questions INTEGER);
CREATE TABLE view_spec(id TEXT PRIMARY KEY, title TEXT, summary TEXT, question TEXT, spec TEXT, created_at TEXT, tokens INTEGER);
CREATE INDEX pb_url ON page_block(url_id); CREATE INDEX pb_block ON page_block(block, variant); CREATE INDEX url_tpl ON url(aem_template);
CREATE INDEX url_var ON url(variant_code); CREATE INDEX link_to ON link(to_url); CREATE INDEX fp_f ON feature_page(feature_id); CREATE INDEX ps_u ON page_signal(url_id);
CREATE VIEW v_block_usage AS SELECT pb.block, pb.variant, COUNT(*) instances, COUNT(DISTINCT pb.url_id) urls, COUNT(DISTINCT u.aem_template) templates
  FROM page_block pb JOIN url u ON u.id = pb.url_id WHERE pb.kind IN ('block','dynamic','global') AND u.in_sitemap = 1 GROUP BY pb.block, pb.variant;
CREATE VIEW v_url_blocks AS SELECT u.path, u.aem_template, u.variant_code, pb.pos, pb.block, pb.variant, pb.kind, pb.nested_in, pb.section
  FROM page_block pb JOIN url u ON u.id = pb.url_id;
CREATE VIEW v_template_blocks AS SELECT u.aem_template, pb.block, COUNT(DISTINCT pb.url_id) urls FROM page_block pb JOIN url u ON u.id = pb.url_id
  WHERE pb.kind IN ('block','dynamic') AND u.in_sitemap = 1 GROUP BY u.aem_template, pb.block;
`;

const CLASS_NAMES = { L: 'listing', S: 'search', F: 'form', M: 'modal / interactive', V: 'media', T: 'tag / consent', A: 'API / settings', R: 'relationship', X: 'auth / commerce', I18N: 'locale', CR: 'client-rendered', D: 'data file' };

/** EDS path for a source path: lowercase, no .html, /index → folder, runs of non [a-z0-9] → '-'. Pure. */
export function edsPath(path) {
  let p = path.endsWith('.html') ? path.slice(0, -5) : path;
  if (p.endsWith('/index')) p = `${p.slice(0, -6)}/`;
  const out = p.split('/').map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).join('/');
  return out.startsWith('/') ? out : `/${out}`;
}
export const band = (v) => (!v ? 'none' : v >= 10000 ? 'high' : v >= 1000 ? 'medium' : 'low');
const J = JSON.stringify;

/** Replace {{SELECT …}} in a finding with the query's first value (thousands separators). Pure given run(). */
export function fillFinding(text, run) {
  return text.replace(/\{\{([\s\S]+?)\}\}/g, (_, sql) => { const v = run(sql.trim()); return typeof v === 'number' ? v.toLocaleString('en-US') : String(v ?? '–'); });
}

function main() {
  const cfg = loadConfig();
  const out = arg('out', cfg.p('spec.sqlite'));
  if (existsSync(out)) rmSync(out);
  const db = new DatabaseSync(out);
  db.exec(SCHEMA);
  const one = (sql, ...a) => { const r = db.prepare(sql).get(...a); return r ? Object.values(r)[0] : null; };
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const ins = (table, row) => db.prepare(`INSERT OR REPLACE INTO ${table}(${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row).map((v) => (v === undefined ? null : v)));
  const P = (...p) => cfg.p(...p);
  const rum = readJSON(P('rum', 'rum.json'), { available: false });
  const views = rum.available ? rum.pages : {};
  const sitemapUrls = new Set(readFileSync(P('inventory', 'urls.txt'), 'utf8').split('\n').filter(Boolean));
  const fetchRows = readJSONL(P('fetch', 'fetch.jsonl'));
  const disc = readJSONL(P('links', 'pages.jsonl'));
  const comps = new Map(readJSONL(P('parse', 'components.jsonl')).concat(readJSONL(P('links', 'components.jsonl'))).map((r) => [r.url, r]));
  const blocksOf = new Map(readJSONL(P('judgement', 'page-blocks.jsonl')).map((r) => [r.url, r]));
  const variants = readJSON(P('judgement', 'variants.json'), []);
  const varOf = new Map(variants.flatMap((v) => v.urls.map((u) => [u, v.code])));
  const catalog = readJSON(P('judgement', 'catalog.json'), { blocks: {} });
  const impl = readJSON(P('judgement', 'implementation.json'), {});
  const media = P('media');
  const captured = (u) => (existsSync(join(media, urlKey(u), 'boxes.json')) && !readJSON(join(media, urlKey(u), 'boxes.json')).error ? urlKey(u) : null);

  db.exec('BEGIN');
  // ---- url rows
  const outcome = (r) => (r.error ? (/loop/.test(r.error) ? 'loop' : 'error') : r.external ? 'redirect-external' : [301, 302, 303, 307, 308].includes(r.status) ? (r.final_status === 200 ? 'redirect' : 'redirect-broken') : r.status === 200 ? 'page' : `http-${r.status}`);
  const uid = new Map(); let id = 0;
  const addUrl = (r, inSitemap) => {
    const path = new URL(r.url).pathname; const segs = path.split('/').filter(Boolean); const oc = outcome(r); const isPage = oc === 'page';
    const pv = views[path] || {}; const pb = isPage ? blocksOf.get(r.url) : null; const c = comps.get(r.url);
    const nblocks = pb ? new Set(pb.blocks.filter((b) => b.kind === 'block' || b.kind === 'dynamic').map((b) => b.block)).size : null;
    const dyn = pb && pb.blocks.some((b) => b.kind === 'dynamic');
    let flag = null;
    if (isPage && /thank-?you/i.test(path)) flag = 'thank-you'; else if (isPage && c && c.main_chars < 50 && !nblocks && !dyn) flag = 'empty';
    const sp = cfg.scopePath.split('/').filter(Boolean).length;
    const e = edsPath(path);
    id += 1; uid.set(r.url, id);
    ins('url', { id, url: r.url, path, section: segs[sp] ? segs[sp].replace('.html', '') : '(root)', depth: segs.length, in_sitemap: inSitemap, status: r.status ?? null,
      final_url: r.final_url ?? null, final_status: r.final_status ?? null, outcome: oc, aem_template: isPage ? templateOf(r, cfg) : null,
      variant_code: isPage ? (varOf.get(r.final_url) || varOf.get(r.url) || null) : null, title: isPage ? (r.title || null) : null, eds_path: isPage ? e : null,
      needs_migration_redirect: isPage && e !== (path.endsWith('.html') ? path.slice(0, -5) : path) ? 1 : 0, pageviews_90d: Math.round(pv.views || 0),
      rum_bundles: pv.bundles || 0, traffic_band: rum.available ? band(pv.views) : null, block_count: nblocks, capture_key: isPage ? captured(r.url) : null,
      main_chars: c ? c.main_chars : null, flag });
  };
  fetchRows.forEach((r) => addUrl(r, sitemapUrls.has(r.url) ? 1 : 0));
  disc.filter((r) => !uid.has(r.url) && new URL(r.url).pathname.startsWith(cfg.scopePath)).forEach((r) => addUrl(r, 0));

  // ---- page blocks (+ chrome globals) with crops
  const examples = {};
  for (const [u, i] of uid) {
    const pb = blocksOf.get(u); if (!pb || one('SELECT outcome FROM url WHERE id=?', i) !== 'page') continue;
    const ck = one('SELECT capture_key FROM url WHERE id=?', i); const chrome = comps.get(u)?.chrome || {};
    let pos = -1;
    Object.entries(chrome).filter(([, v]) => v).forEach(([k]) => { if (k !== 'footer') ins('page_block', { url_id: i, pos: pos--, block: k, variant: null, kind: 'global', aem: '[]', path: null, nested_in: null, section: null, crop: null }); });
    let last = 0;
    for (const b of pb.blocks) {
      const crop = ck && b.path && existsSync(join(media, ck, `${b.path}.jpg`)) ? `${ck}/${b.path}.jpg` : null;
      if (crop && (b.kind === 'block' || b.kind === 'dynamic')) { const k = `${b.block}|${b.variant}`; (examples[k] = examples[k] || []).length < 4 && examples[k].push({ url: u, crop }); }
      ins('page_block', { url_id: i, pos: b.pos, block: b.block, variant: b.variant ?? null, kind: b.kind, aem: J(b.aem || []), path: b.path ?? null, nested_in: b.nested_in ?? null, section: b.section ?? null, crop });
      last = b.pos;
    }
    if (chrome.footer) ins('page_block', { url_id: i, pos: last + 1, block: 'footer', variant: null, kind: 'global', aem: '[]', path: null, nested_in: null, section: null, crop: null });
  }

  // ---- blocks + variants from the catalog
  for (const [name, b] of Object.entries(catalog.blocks || {})) {
    const st = db.prepare(`SELECT COUNT(DISTINCT pb.url_id) a, COUNT(*) b, COUNT(DISTINCT u.aem_template) c FROM page_block pb JOIN url u ON u.id=pb.url_id WHERE pb.block=? AND u.in_sitemap=1`).get(name);
    const pv = one('SELECT COALESCE(SUM(pageviews_90d),0) FROM url WHERE in_sitemap=1 AND id IN (SELECT DISTINCT url_id FROM page_block WHERE block=?)', name);
    ins('block', { name, kind: b.kind, description: b.description, aem: J(b.aem || []), reference_block: b.reference ?? null, verdict: b.verdict, rationale: b.rationale ?? null, url_count: st.a, instance_count: st.b, template_count: st.c, pageviews_90d: pv, family: b.family ?? null });
    for (const v of all(`SELECT pb.variant v, COUNT(DISTINCT pb.url_id) n, COUNT(*) i FROM page_block pb JOIN url u ON u.id=pb.url_id WHERE pb.block=? AND u.in_sitemap=1 GROUP BY pb.variant`, name)) {
      const vd = (b.variants || {})[v.v ?? ''] || {};
      ins('block_variant', { block: name, variant: v.v, verdict: vd.verdict || b.verdict, rationale: vd.rationale || b.rationale || null, url_count: v.n, instance_count: v.i, examples: J(examples[`${name}|${v.v}`] || []) });
    }
  }
  const missing = all(`SELECT DISTINCT block FROM page_block WHERE kind IN ('block','dynamic','global') AND block NOT IN (SELECT name FROM block)`).map((r) => r.block);
  if (missing.length) log(`WARNING blocks missing from judgement/catalog.json: ${missing.join(', ')}`);

  // ---- components → blocks
  const cp = {};
  for (const [u, pb] of blocksOf) { if (!uid.has(u)) continue; for (const b of pb.blocks) for (const a of b.aem || []) { const e = cp[a] || (cp[a] = { pages: new Set(), n: 0, to: {} }); e.pages.add(u); e.n += 1; const t = b.kind === 'default' ? 'default-content' : b.block; e.to[t] = (e.to[t] || 0) + 1; } }
  Object.entries(cp).forEach(([name, e]) => ins('aem_component', { name, url_count: e.pages.size, instance_count: e.n, maps_to: J(e.to) }));

  // ---- templates + variants
  const labels = impl.template_labels || {};
  for (const t of all(`SELECT aem_template t, COUNT(*) n, SUM(pageviews_90d) pv FROM url WHERE outcome='page' AND in_sitemap=1 GROUP BY 1`)) {
    const vs = variants.filter((v) => v.template === t.t);
    const share = vs.slice(0, 5).reduce((a, v) => a + v.pages, 0) / Math.max(1, vs.reduce((a, v) => a + v.pages, 0));
    ins('template', { id: t.t, label: labels[t.t] || t.t, url_count: t.n, pageviews_90d: t.pv, variant_count: vs.length, top_variants_share: Math.round(share * 1000) / 1000, rep_url: vs[0]?.representative ?? null });
  }
  variants.forEach((v) => {
    const pv = v.urls.reduce((a, u) => { try { return a + (views[new URL(u).pathname]?.views || 0); } catch { return a; } }, 0);
    ins('variant', { code: v.code, template_id: v.template, rank: Number(v.code.split('#')[1]), label: v.core.length ? v.core.join(' + ') : 'default content only', core: J(v.core), optional: J(v.optional), url_count: v.pages, pageviews_90d: Math.round(pv), distinct_sets: v.distinct_sets, rep_url: v.representative, rep_capture_key: captured(v.representative) });
  });

  // ---- redirects (legacy + migration), broken, links
  const inbound = new Map(); const inboundMain = new Map();
  for (const r of readJSONL(P('parse', 'links.jsonl')).concat(readJSONL(P('links', 'links.jsonl')))) {
    for (const [u, z] of Object.entries(r.links || {})) { if (!inbound.has(u)) { inbound.set(u, new Set()); inboundMain.set(u, new Set()); } inbound.get(u).add(r.url); if (z === 'main') inboundMain.get(u).add(r.url); }
  }
  const addRedirect = (r, inSm) => ins('redirect', { src: r.url, target: r.final_url ?? null, status: r.status ?? null, hops: (r.chain || []).length, kind: 'legacy', target_status: r.final_status ?? null, external: r.external ? 1 : 0, in_sitemap: inSm, inbound_pages: inbound.get(r.url)?.size || 0, rum_views: Math.round(views[new URL(r.url).pathname]?.views || 0), note: /loop/.test(r.error || '') ? 'redirect loop' : null });
  fetchRows.filter((r) => (r.chain || []).length).forEach((r) => addRedirect(r, sitemapUrls.has(r.url) ? 1 : 0));
  disc.filter((r) => (r.chain || []).length && !sitemapUrls.has(r.url)).forEach((r) => addRedirect(r, 0));
  all(`SELECT url, path, eds_path FROM url WHERE needs_migration_redirect=1`).forEach((u) => ins('redirect', { src: u.path, target: u.eds_path, status: 301, hops: 1, kind: 'migration', target_status: 200, external: 0, in_sitemap: 1, inbound_pages: inbound.get(u.url)?.size || 0, rum_views: Math.round(views[u.path]?.views || 0), note: 'EDS path normalisation' }));
  if (rum.available) Object.entries(rum.redirectLandings || {}).forEach(([p, v]) => ins('rum_redirect_landing', { path: p, views: Math.round(v.views), bundles: v.bundles }));
  const inScope = (u) => { try { return new URL(u).pathname.startsWith(cfg.scopePath) ? 1 : 0; } catch { return 0; } };
  const addBroken = (u, status, source, kind, note, rv = 0, rb = 0, refs = null) => ins('broken', { url: u, status, source, kind, in_scope: inScope(u), inbound_pages: inbound.get(u)?.size || 0, inbound_main: inboundMain.get(u)?.size || 0, rum_views: Math.round(rv), rum_bundles: rb, referrers: refs ? J(refs) : null, note: note ?? null });
  fetchRows.forEach((r) => { if (r.final_status >= 400) addBroken(r.url, r.final_status, 'sitemap', 'page', (r.chain || []).length ? 'sitemap URL redirects into a dead page' : null); if (/loop/.test(r.error || '')) addBroken(r.url, 310, 'sitemap', 'page', 'redirect loop'); });
  disc.forEach((r) => { if (r.final_status >= 400) addBroken(r.url, r.final_status, 'link', 'page', (r.chain || []).length ? 'linked page redirects into a dead page' : null); });
  readJSONL(P('links', 'assets.jsonl')).forEach((r) => { if (r.final_status >= 400) addBroken(r.url, r.final_status, 'link', 'asset'); });
  if (rum.available) Object.entries(rum.notFound || {}).forEach(([p, v]) => addBroken(`${cfg.origin}${p}`, 404, 'rum', 'page', null, v.views, v.bundles, Object.fromEntries(Object.entries(v.referrers || {}).sort((a, b) => b[1] - a[1]).slice(0, 10))));
  const bad = new Set([...all('SELECT url FROM broken').map((r) => r.url), ...all(`SELECT src FROM redirect WHERE kind='legacy'`).map((r) => r.src)]);
  for (const to of bad) for (const frm of inbound.get(to) || []) if (uid.has(frm)) ins('link', { from_url_id: uid.get(frm), to_url: to, zone: inboundMain.get(to)?.has(frm) ? 'main' : 'chrome' });
  db.exec('COMMIT');

  buildImplementation({ cfg, db, one, all, ins, impl, uid, rum, P });

  // ---- meta + findings (computed)
  db.exec('BEGIN');
  const meta = {
    site_name: cfg.site || new URL(cfg.origin).hostname, origin: cfg.origin, scope_path: cfg.scopePath, scope_label: cfg.scopeLabel || `${new URL(cfg.origin).hostname}${cfg.scopePath.replace(/\/$/, '')}`,
    reference_blocks_name: cfg.referenceBlocks?.name || null, reference_blocks_count: cfg.referenceBlocks?.count ?? null,
    rum_available: rum.available ? '1' : '0', rum_window: rum.window || null, rum_bundles: rum.bundles ?? null,
    sitemap_urls: sitemapUrls.size, built_at: new Date().toISOString().slice(0, 19), built_by: 'spec pipeline (stardust spec skill)',
    blind_rule: impl.provenance || 'built from the live site only; it uses no output from any migration work', variant_cut: 'Jaccard 0.5 average linkage',
    consent_summary: impl.consent_summary || null, loading_order: impl.loading_order ? J(impl.loading_order) : null, i18n_notes: J(impl.i18n_notes || []), media_ext: 'jpg',
  };
  // where the evidence came from: live, the headed tier (S2 --headed) or Internet Archive captures (S2 --archive)
  const src = {}; let arch = [];
  fetchRows.forEach((r) => { src[r.source || 'live'] = (src[r.source || 'live'] || 0) + 1; if (r.archived_at) arch.push(r.archived_at); });
  meta.fetch_sources = J(src);
  if (arch.length) { arch = arch.sort(); meta.evidence_note = `${arch.length.toLocaleString('en-US')} pages come from Internet Archive captures (${arch[0]} to ${arch[arch.length - 1]}), not the live site`; }
  const inv = readJSON(P('inventory', 'summary.json'), null);
  if (inv) {
    meta.inventory_total = inv.total; meta.inventory_source = inv.source;
    if (inv.sampled) meta.sample_note = `a sample of ${inv.kept.toLocaleString('en-US')} of ${inv.total.toLocaleString('en-US')} ${inv.source === 'crawl' ? 'crawled' : 'sitemap'} URLs, even per section`;
  }
  Object.entries(meta).forEach(([k, v]) => ins('meta', { key: k, value: v === null ? null : String(v) }));
  const findings = readJSON(P('judgement', 'findings.json'), []).map((f) => fillFinding(f, (sql) => one(sql)));
  ins('meta', { key: 'findings', value: J(findings) });
  db.exec('COMMIT');
  for (const t of ['url', 'page_block', 'block', 'variant', 'template', 'redirect', 'broken', 'feature', 'vendor', 'launch_rule', 'open_question', 'locale_tree']) log(`${t} ${one(`SELECT COUNT(*) FROM ${t}`)}`);
}

function buildImplementation({ cfg, one, all, ins, db, impl, uid, rum, P }) {
  db.exec('BEGIN');
  // page signals: built-in (from parse) + site regexes over raw HTML (impl.signals)
  const pages = all(`SELECT id, url FROM url WHERE outcome='page' AND in_sitemap=1`); const pageId = new Map(pages.map((p) => [p.url, p.id]));
  const sigRows = readJSONL(P('parse', 'signals.jsonl'));
  const custom = Object.entries(impl.signals || {}).map(([k, re]) => [k, new RegExp(re)]);
  const fetchRows = new Map(readJSONL(P('fetch', 'fetch.jsonl')).map((r) => [r.url, r]));
  const sig = (u, s) => ins('page_signal', { url_id: pageId.get(u), signal: s });
  for (const s of sigRows) {
    if (!pageId.has(s.url)) continue;
    sig(s.url, 'all');
    if (s.hreflang.length) sig(s.url, 'hreflang');
    s.scriptHosts.forEach((h) => sig(s.url, `script:${h}`)); s.iframeHosts.forEach((h) => sig(s.url, `iframe:${h}`));
    s.jsonld.forEach((t) => sig(s.url, `jsonld:${t}`));
    if (custom.length) {
      const r = fetchRows.get(s.url); if (!r?.html_key) continue;
      const html = gunzipSync(readFileSync(join(P('fetch', 'html'), `${r.html_key}.html.gz`))).toString('utf8');
      custom.forEach(([k, re]) => { if (re.test(html)) sig(s.url, k); });
    }
  }
  const nlive = pages.length;
  const reach = (rule) => {
    const [kind, ...rest] = String(rule || '').split(':'); const a = rest.join(':');
    const ids = (sql, ...x) => new Set(all(sql, ...x).map((r) => Object.values(r)[0]));
    if (kind === 'signal') return ids(`SELECT DISTINCT url_id FROM page_signal WHERE signal=?`, a);
    if (kind === 'block') return ids(`SELECT DISTINCT pb.url_id FROM page_block pb JOIN url u ON u.id=pb.url_id WHERE pb.block=? AND u.in_sitemap=1`, a);
    if (kind === 'bvariant') { const [b, v] = a.split('|'); return ids(`SELECT DISTINCT pb.url_id FROM page_block pb JOIN url u ON u.id=pb.url_id WHERE pb.block=? AND pb.variant=? AND u.in_sitemap=1`, b, v); }
    if (kind === 'url') return ids(`SELECT id FROM url WHERE path=?`, a);
    if (kind === 'sql') return ids(a);
    return new Set();
  };
  const featByQ = {};
  for (const f of impl.features || []) {
    const set = reach(f.reach); const sitewide = set.size >= 0.9 * nlive ? 1 : 0;
    const t = db.prepare(`SELECT COUNT(DISTINCT aem_template) a, COALESCE(SUM(pageviews_90d),0) b FROM url WHERE id IN (${[...set].join(',') || 0})`).get();
    ins('feature', { id: f.id, class: f.class, class_name: CLASS_NAMES[f.class] || f.class, name: f.name, evidence: f.evidence, disposition: f.disposition, reproducibility: f.reproducibility, status: f.status || 'pending', pattern: f.pattern, eds: f.eds, decisions: J(f.decisions || []), sitewide, reach_pages: set.size, reach_templates: t.a, pageviews_90d: t.b });
    if (!sitewide) set.forEach((u) => ins('feature_page', { feature_id: f.id, url_id: u }));
    (f.decisions || []).forEach((q) => { (featByQ[q] = featByQ[q] || []).push(f.id); });
  }
  // vendors
  const ven = readJSON(P('martech', 'vendors.json'), { vendors: [] });
  const launch = readJSON(P('martech', 'launch.json'), null);
  const ot = readJSON(P('martech', 'onetrust.json'), []);
  const otGroup = {}; ot.forEach((d) => d.ruleSets.forEach((rs) => rs.groups.forEach((g) => g.hosts.forEach((h) => { otGroup[h.replace(/^\./, '')] = otGroup[h.replace(/^\./, '')] || `${g.id} ${g.name}`; }))));
  const base = (h) => h.split('.').slice(-2).join('.');
  const launchHosts = {}; (launch?.rules || []).forEach((r) => (r.loads || []).forEach((h) => { launchHosts[h] = (launchHosts[h] || 0) + 1; }));
  const hosts = new Set([...ven.vendors.map((v) => v.host), ...Object.keys(launchHosts)]);
  for (const h of hosts) {
    const v = ven.vendors.find((x) => x.host === h) || {};
    ins('vendor', { host: h, role: v.role || (launchHosts[h] ? 'loaded by tag-manager custom code' : 'unclassified — inspect'), class: v.class || 'T', seen_pages: v.pages || 0, via: [v.pages ? 'page' : null, launchHosts[h] ? 'launch' : null].filter(Boolean).join(','), in_csp: v.inCsp ? 1 : 0, consent_group: otGroup[h] || otGroup[base(h)] || null, launch_rules: launchHosts[h] || 0 });
  }
  // launch rules + data layer
  for (const r of launch?.rules || []) {
    const m = r.name.match(/^(?:Event|Tracking Pixel|Pixel):\s*([A-Za-z0-9 .]+?)\s*[(\-|]/);
    const kind = r.paths.length ? 'campaign' : /^ACDL|data ?layer/i.test(r.name) ? 'acdl' : 'global';
    const eds = r.paths.map((p) => one('SELECT eds_path FROM url WHERE path=?', p.split('?')[0]));
    const live = r.paths.filter((p) => one(`SELECT COUNT(*) FROM url WHERE path=? AND outcome='page'`, p.split('?')[0])).length;
    const htmlPaths = r.paths.filter((p) => p.includes('.html')).length;
    ins('launch_rule', { id: r.id, name: r.name, vendor: m ? m[1].trim() : r.name.split(/[:|]/)[0].trim().slice(0, 40), kind, events: J(r.events), path_values: J(r.paths), html_paths: htmlPaths, selectors: J(r.selectors), hosts: J(r.loads || []), needs_rewrite: htmlPaths > 0 || r.selectors.length > 0 ? 1 : 0, eds_paths: J(eds), live_pages: live });
  }
  const byPath = {};
  (launch?.dataElements || []).forEach((d) => {
    const key = d.type === 'datalayerComputedState' ? d.source : d.selectors?.length ? `dom: ${d.selectors.join(' ; ')}` : null;
    if (key) (byPath[key] = byPath[key] || { names: [], dom: !!d.selectors?.length }).names.push(d.name);
  });
  Object.entries(byPath).forEach(([p, v]) => ins('datalayer_field', { path: p, data_elements: J(v.names), group_name: v.dom ? 'DOM-read (breaks when markup changes)' : (p.split('.')[1] || p.split('.')[0]), eds_source: v.dom ? 'rewrite the data element or emit the value in the data layer' : 'page metadata or block event' }));
  // metadata contract, coverage measured from the page signals
  const cov = (src) => sigRows.filter((s) => pageId.has(s.url) && (src.startsWith('body:') ? s.bodyData[src.slice(5)] : src.startsWith('meta:') ? s.meta[src.slice(5)] : false)).length;
  const vals = (src) => { const c = {}; sigRows.forEach((s) => { const v = src.startsWith('body:') ? s.bodyData[src.slice(5)] : src.startsWith('meta:') ? s.meta[src.slice(5)] : null; if (v) c[v] = (c[v] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]); };
  (impl.metadata_contract || []).forEach((m) => { const v = m.source ? vals(m.source) : []; ins('metadata_field', { name: m.name, aem_source: m.aem || m.source, used_by: J(m.used_by || []), coverage_pages: m.source ? cov(m.source) : null, distinct_values: v.length || null, top_values: v.length ? J(v.slice(0, 12)) : null }); });
  (impl.query_indexes || []).forEach((ix) => {
    const props = ix.properties.map((p) => p.split(' ')[0]);
    const yaml = [`  ${ix.name}:`, '    include:', ...ix.include.map((p) => `      - '${p}'`), ...(ix.exclude?.length ? ['    exclude:', ...ix.exclude.map((p) => `      - '${p}'`)] : []), `    target: ${ix.target || `${cfg.scopePath.replace(/\/$/, '')}/${ix.name === 'default' ? 'query-index' : ix.name}.json`}`, '    properties:',
      ...props.map((p) => (p === 'lastModified' ? `      lastModified:\n        select: none\n        value: parseTimestamp(headers["last-modified"], "ddd, DD MMM YYYY hh:mm:ss GMT")` : ['title', 'image', 'description'].includes(p) ? `      ${p}:\n        select: head > meta[property="og:${p}"]\n        value: attribute(el, "content")` : `      ${p}:\n        select: head > meta[name="${p}"]\n        value: attribute(el, "content")`))].join('\n');
    ins('query_index', { name: ix.name, include_paths: J(ix.include), exclude_paths: J(ix.exclude || []), filter: ix.filter ?? null, properties: J(ix.properties), consumers: J(ix.consumers || []), source: ix.source ?? null, yaml });
  });
  // locale trees from the sitemaps inventory
  const sm = readJSON(P('inventory', 'sitemaps.json'), {});
  const scopeRoot = cfg.scopePath.split('/').filter(Boolean).slice(0, 2).join('/');
  const trees = {}; Object.entries(sm).forEach(([file, s]) => Object.entries(s.roots).forEach(([root, n]) => { const t = root.replace(/^\//, ''); if (/^[a-z]{2}\/[a-z]{2}$/.test(t) || t === scopeRoot) { trees[t] = trees[t] || { urls: 0, file }; trees[t].urls += n; } }));
  const rumTrees = Object.fromEntries((rum.trees || []).map(([k, v]) => [k, v.views]));
  Object.entries(trees).forEach(([t, v]) => ins('locale_tree', { tree: t, country: t.split('/')[0], language: t.split('/')[1] || null, urls: v.urls, shared_with_scope: null, shared_pct: null, rum_views_90d: Math.round(rumTrees[t] || 0), deep_sampled: 0, live_pages: null, templates: null, blocks: null, unmapped: null, sitemap: v.file }));
  (impl.site_config || []).forEach((s) => ins('site_config', { key: s.key, now: s.now, eds: s.eds, decision: s.decision ?? null }));
  readJSON(P('judgement', 'search-probes.json'), []).forEach((p) => ins('search_probe', { term: p.term, expect_count: p.expectCount, expect_titles: J(p.expectTitles || []), expect_includes: p.expectIncludes ?? null }));
  (impl.open_questions || []).forEach((q) => {
    const rule = q.impact_rule || ''; const impact = rule.startsWith('sql:') ? one(rule.slice(4)) : rule.startsWith('value:') ? Number(rule.slice(6)) : null;
    ins('open_question', { id: q.id, area: q.area, owner: q.owner, blocking: q.blocking ? 1 : 0, question: q.question, context: q.context, options: J(q.options || []), default_assumption: q.default, impact, link: q.link ?? null, features: J(featByQ[q.id] || []) });
  });
  db.exec('COMMIT');
}

if (import.meta.url === `file://${process.argv[1]}`) { try { main(); } catch (e) { console.error(e.stack || e.message); process.exit(1); } }
