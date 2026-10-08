#!/usr/bin/env node
/**
 * spec-variants.mjs — S8 layout variants: within each template, cluster pages by their EDS block set
 * (average-linkage agglomerative clustering on Jaccard distance over distinct sets, weighted by pages).
 *
 *   node spec-variants.mjs [--config spec.config.json] [--in <page-blocks.jsonl>] [--views <rum.json>] [--cut 0.5] [--keep-variant hero,carousel]
 *
 * Tokens = block names; blocks listed in --keep-variant keep their variant (a single-slide hero and a page hero
 * are different builds). Core = block on ≥ 50% of a variant's pages; the representative is a page with the most
 * common exact set, highest traffic first when views exist. Writes <dir>/judgement/variants.json.
 */
import { arg, helpAndExit, list, loadConfig, readJSON, readJSONL, writeJSON } from './lib.mjs';

helpAndExit(import.meta.url);

export const jaccard = (a, b) => { if (!a.size && !b.size) return 0; let i = 0; a.forEach((x) => { if (b.has(x)) i += 1; }); return 1 - i / (a.size + b.size - i); };

/** sets: Map<key, { set:Set, pages:string[] }> → clusters (arrays of keys). Pure.
 * Average linkage weighted by pages, Lance-Williams update on one distance matrix (fast for hundreds of sets). */
export function cluster(sets, cut) {
  const keys = [...sets.keys()]; const n = keys.length;
  const w = keys.map((k) => sets.get(k).pages.length);
  const D = Array.from({ length: n }, (_, i) => Float64Array.from({ length: n }, (__, j) => (i === j ? Infinity : jaccard(sets.get(keys[i]).set, sets.get(keys[j]).set))));
  const members = keys.map((k) => [k]); const alive = new Set(keys.map((_, i) => i));
  for (;;) {
    let bi = -1; let bj = -1; let bd = Infinity;
    for (const i of alive) for (const j of alive) if (j > i && D[i][j] < bd) { bd = D[i][j]; bi = i; bj = j; }
    if (bi < 0 || bd > cut) break;
    for (const k of alive) if (k !== bi && k !== bj) { D[bi][k] = (w[bi] * D[bi][k] + w[bj] * D[bj][k]) / (w[bi] + w[bj]); D[k][bi] = D[bi][k]; }
    w[bi] += w[bj]; members[bi].push(...members[bj]); alive.delete(bj);
  }
  return [...alive].map((i) => members[i]);
}

function main() {
  const cfg = loadConfig();
  const rows = readJSONL(arg('in', cfg.p('judgement', 'page-blocks.jsonl')));
  const views = readJSON(arg('views', cfg.p('rum', 'rum.json')), { pages: {} }).pages || {};
  const keep = new Set(list(arg('keep-variant', 'hero,carousel')));
  const cut = Number(arg('cut', 0.5));
  const seen = new Set(); const byT = new Map();
  for (const r of rows) {
    if (seen.has(r.final_url)) continue; seen.add(r.final_url);
    const toks = new Set(r.blocks.filter((b) => (b.kind === 'block' || b.kind === 'dynamic') && !b.nested_in).map((b) => (keep.has(b.block) && b.variant ? `${b.block}:${b.variant}` : b.block)));
    const t = r.template || '(none)'; const key = [...toks].sort().join('|');
    if (!byT.has(t)) byT.set(t, new Map());
    const m = byT.get(t); if (!m.has(key)) m.set(key, { set: toks, pages: [] });
    m.get(key).pages.push(r.final_url);
  }
  const vOf = (u) => { try { return views[new URL(u).pathname]?.views || 0; } catch { return 0; } };
  const out = [];
  for (const [t, sets] of [...byT].sort((a, b) => [...b[1].values()].reduce((s, x) => s + x.pages.length, 0) - [...a[1].values()].reduce((s, x) => s + x.pages.length, 0))) {
    const cls = cluster(sets, cut).map((c) => ({ keys: c, n: c.reduce((s, k) => s + sets.get(k).pages.length, 0) })).sort((a, b) => b.n - a.n);
    cls.forEach(({ keys }, i) => {
      const urls = keys.flatMap((k) => sets.get(k).pages); const freq = {};
      keys.forEach((k) => sets.get(k).set.forEach((tok) => { freq[tok] = (freq[tok] || 0) + sets.get(k).pages.length; }));
      const n = urls.length;
      const top = keys.reduce((a, k) => (sets.get(k).pages.length > sets.get(a).pages.length ? k : a), keys[0]);
      out.push({ template: t, code: `${t}#${i + 1}`, pages: n, core: Object.keys(freq).filter((x) => freq[x] / n >= 0.5).sort(),
        optional: Object.entries(freq).filter(([, f]) => f / n < 0.5).map(([x, f]) => [x, Math.round((f / n) * 100) / 100]).sort((a, b) => b[1] - a[1]),
        distinct_sets: keys.length, representative: [...sets.get(top).pages].sort((a, b) => vOf(b) - vOf(a))[0], urls });
    });
  }
  writeJSON(arg('out', cfg.p('judgement', 'variants.json')), out);
  console.error(`[spec] ${out.length} variants across ${byT.size} templates`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
