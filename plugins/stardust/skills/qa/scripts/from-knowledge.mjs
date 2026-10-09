#!/usr/bin/env node
/**
 * qa/from-knowledge.mjs — qa inputs from a spec's knowledge (stardust/spec/knowledge/), so the sweep knows the site
 * before it crawls:
 *   stardust/template-map.json { templates: { <layout variant>: { urls: [served URL…] } } } — the inventory and the
 *                             template assignment `qa.mjs --template-map` reads; limited to delivered pages when
 *                             rollout's coverage exists (a page of a later wave is not a defect yet)
 *   stardust/qa/allowlist.json + one entry per link the source site already had broken (source-inherited, not a
 *                             migration defect); existing entries kept, never duplicated
 *
 *   node from-knowledge.mjs [--knowledge stardust/spec/knowledge] [--template-map <file>] [--allowlist <file>]
 *        [--coverage stardust/rollout/coverage/pages.json] [--dry-run]
 *
 * Served URLs come from deploy's path contract (eds-path.mjs). Exit 1 when the knowledge folder is missing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const pathOf = (u) => { try { return new URL(u).pathname; } catch { return String(u || ''); } };

/** Live sitemap pages grouped by layout variant (else template), at their served URL; `keep(path)` filters. Pure. */
export function templateMap(urls, keep = () => true) {
  const templates = {};
  for (const u of urls) {
    if (u.outcome !== 'page' || u.in_sitemap !== 1 || !u.eds_path || !keep(u.eds_path)) continue;
    const t = u.variant_code || u.template || '(none)';
    (templates[t] = templates[t] || { urls: [] }).urls.push(u.eds_path);
  }
  return { templates };
}

/** Allowlist entries for links the source already had broken, minus paths already listed. Pure given the path functions. */
export function inheritedEntries(broken, existing, { deliveredUrl }, builtAt = '') {
  const have = new Set(existing.filter((e) => e.check === 'links').map((e) => e.path));
  const out = [];
  for (const b of broken) {
    if (b.source !== 'link' || b.kind !== 'page' || b.in_scope !== 1) continue;
    const p = pathOf(b.url);
    for (const path of new Set([p, deliveredUrl(p)])) {
      if (have.has(path)) continue;
      have.add(path);
      out.push({ check: 'links', id: 'broken-internal-link', path, reason: `source-inherited: ${b.url} answered ${b.status} on the source site (spec knowledge${builtAt ? `, built ${builtAt}` : ''}); not a migration defect` });
    }
  }
  return out;
}

async function main() {
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(`${readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n?/, '').replace(/^ \* ?/gm, '')}\n`); return; }
  const dir = arg('knowledge', join('stardust', 'spec', 'knowledge'));
  const mapFile = arg('template-map', join('stardust', 'template-map.json')); const allowFile = arg('allowlist', join('stardust', 'qa', 'allowlist.json'));
  if (!existsSync(join(dir, 'urls.jsonl'))) { console.error(`from-knowledge: ${join(dir, 'urls.jsonl')} missing — no spec knowledge`); process.exit(1); }
  const p = [join(HERE, '..', '..', 'deploy', 'scripts', 'eds-path.mjs'), join(HERE, '..', 'deploy', 'eds-path.mjs')].find((x) => existsSync(x));
  if (!p) throw new Error('eds-path.mjs not found (../../deploy/scripts/ or ../deploy/): copy the deploy skill\'s scripts next to these');
  const { deliveredUrl, pathKey } = await import(pathToFileURL(p).href);
  const jl = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const coverage = arg('coverage', join('stardust', 'rollout', 'coverage', 'pages.json'));
  const delivered = existsSync(coverage) ? new Set(JSON.parse(readFileSync(coverage, 'utf8')).pages.map((pg) => pathKey(pg.path || `/${pg.slug}`))) : null;
  const map = templateMap(jl('urls.jsonl'), delivered ? (e) => delivered.has(pathKey(e)) : undefined);
  const allow = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')) : { entries: [] };
  const site = existsSync(join(dir, 'site.json')) ? JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8')) : {};
  const added = inheritedEntries(jl('broken.jsonl'), allow.entries || [], { deliveredUrl }, site.built_at || '');
  const pages = Object.values(map.templates).reduce((a, t) => a + t.urls.length, 0);
  if (!argv.includes('--dry-run')) {
    mkdirSync(dirname(mapFile), { recursive: true }); writeFileSync(mapFile, `${JSON.stringify(map, null, 1)}\n`);
    if (added.length) mkdirSync(dirname(allowFile), { recursive: true });
    if (added.length) writeFileSync(allowFile, `${JSON.stringify({ ...allow, entries: [...(allow.entries || []), ...added] }, null, 1)}\n`);
  }
  console.log(`from-knowledge: ${pages} page(s) in ${Object.keys(map.templates).length} layout variant(s)${delivered ? ` (delivered only, ${coverage})` : ''}; ${added.length} source-inherited 404 allowlist entr${added.length === 1 ? 'y' : 'ies'}${argv.includes('--dry-run') ? ' [dry run]' : ` → ${mapFile}, ${allowFile}`}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e.message); process.exit(1); });
