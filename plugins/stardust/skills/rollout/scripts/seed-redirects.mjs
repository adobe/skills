#!/usr/bin/env node
/**
 * rollout/seed-redirects.mjs — seed stardust/redirects.tsv from a spec's knowledge (stardust/spec/knowledge/), so the
 * redirects sheet carries every source URL that changes on EDS before the path-safety gate adds its own rows.
 *
 *   node seed-redirects.mjs [--knowledge stardust/spec/knowledge] [--out stardust/redirects.tsv] [--dry-run]
 *
 * Rows (source path → delivered URL, eds-path.mjs):
 *   migration  every page whose delivered URL differs from its source path (`.html` dropped, segments sanitised)
 *   legacy     a redirect the source serves today, when its target is a page of the knowledge: the source path → that
 *              page's delivered URL (one hop on EDS instead of two)
 * Skipped and counted: external targets, targets that are not pages of the knowledge, loops. Rows already in the file
 * win (the path-safety gate's and the owner's decisions); comments and order are kept; new rows are appended under
 * one comment line. Exit 1 when the knowledge folder is missing.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

/** deploy's path contract, in the plugin tree or a project copy (stardust/scripts/<skill>/). */
async function edsPath() {
  const p = [join(HERE, '..', '..', 'deploy', 'scripts', 'eds-path.mjs'), join(HERE, '..', 'deploy', 'eds-path.mjs')].find((x) => existsSync(x));
  if (!p) throw new Error('eds-path.mjs not found (../../deploy/scripts/ or ../deploy/): copy the deploy skill\'s scripts next to these');
  return import(pathToFileURL(p).href);
}

const pathOf = (u) => { try { return new URL(u).pathname; } catch { return String(u || ''); } };

/**
 * New [source, destination] rows from knowledge redirects and urls, minus sources already present (by lookup key).
 * Returns { rows, counts }. Pure given the path functions.
 */
export function seedRows(redirects, urls, existingSources, { pathKey }) {
  const have = new Set([...existingSources].map(pathKey));
  const pageAt = new Map();
  for (const u of urls) if (u.outcome === 'page' && u.eds_path) { pageAt.set(u.url, u.eds_path); if (u.final_url) pageAt.set(u.final_url, u.eds_path); }
  const counts = { migration: 0, legacy: 0, present: 0, external: 0, 'not-a-page': 0, loop: 0 };
  const rows = []; const seen = new Set();
  const add = (src, dst, kind) => {
    const k = pathKey(src);
    if (have.has(k) || seen.has(k)) { counts.present += 1; return; }
    if (src === dst) return;
    seen.add(k); rows.push([src, dst]); counts[kind] += 1;
  };
  for (const r of redirects) {
    if (r.kind === 'migration') add(r.src, r.target, 'migration');
    else if (r.kind === 'legacy') {
      if (!r.target) counts.loop += 1;
      else if (r.external) counts.external += 1;
      else if (!pageAt.has(r.target)) counts['not-a-page'] += 1;
      else add(pathOf(r.src), pageAt.get(r.target), 'legacy');
    }
  }
  return { rows, counts };
}

async function main() {
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(`${readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n?/, '').replace(/^ \* ?/gm, '')}\n`); return; }
  const dir = arg('knowledge', join('stardust', 'spec', 'knowledge')); const out = arg('out', join('stardust', 'redirects.tsv'));
  if (!existsSync(join(dir, 'redirects.jsonl'))) { console.error(`seed-redirects: ${join(dir, 'redirects.jsonl')} missing — no spec knowledge to seed from`); process.exit(1); }
  const jl = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const { pathKey } = await edsPath();
  const existing = existsSync(out) ? readFileSync(out, 'utf8') : '';
  const sources = existing.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\t+|\s{2,}/)[0]);
  const { rows, counts } = seedRows(jl('redirects.jsonl'), jl('urls.jsonl'), sources, { pathKey });
  const summary = `${rows.length} added (migration ${counts.migration}, legacy ${counts.legacy}); kept ${counts.present} already present or repeated; skipped external ${counts.external}, not-a-page ${counts['not-a-page']}, loop ${counts.loop}`;
  if (rows.length && !argv.includes('--dry-run')) {
    mkdirSync(dirname(out), { recursive: true });
    const head = existing && !existing.endsWith('\n') ? `${existing}\n` : existing;
    writeFileSync(out, `${head}# seeded from ${dir}/redirects.jsonl (${new Date().toISOString().slice(0, 10)})\n${rows.map(([s, d]) => `${s}\t${d}`).join('\n')}\n`);
  }
  console.log(`seed-redirects: ${summary}${argv.includes('--dry-run') ? ' [dry run]' : ` → ${out}`}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e.message); process.exit(1); });
