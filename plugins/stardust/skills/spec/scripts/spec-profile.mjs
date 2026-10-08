#!/usr/bin/env node
/**
 * spec-profile.mjs — judgement aid: profile every component in the parsed trees so the mapping can be decided
 * from evidence — pages, instances, median size (chars, imgs, videos, forms, links), parent context, children,
 * templates, an example URL — plus row shapes (columns × child kinds).
 *
 *   node spec-profile.mjs [--config spec.config.json] [--in <components.jsonl>] [--json <out>] [--top 200]
 *
 * Prints one block per component, most pages first; --json also writes the profile for tooling.
 */
import { arg, helpAndExit, loadConfig, readJSONL, writeJSON } from './lib.mjs';

helpAndExit(import.meta.url);

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/** Profile rows of the neutral component contract. Pure. */
export function profile(rows) {
  const seen = new Set(); const P = {};
  const add = (n, url, tpl, parent) => {
    const p = P[n.c] || (P[n.c] = { pages: new Set(), inst: 0, chars: [], imgs: [], videos: [], forms: [], links: [], parents: {}, kids: {}, templates: {}, mods: {}, example: url });
    p.pages.add(url); p.inst += 1;
    ['chars', 'imgs', 'videos', 'forms', 'links'].forEach((k) => p[k].push(n[k] || 0));
    p.parents[parent] = (p.parents[parent] || 0) + 1;
    p.templates[tpl] = (p.templates[tpl] || 0) + 1;
    (n.mods || []).forEach((m) => { p.mods[m] = (p.mods[m] || 0) + 1; });
    (n.kids || []).forEach((k) => { p.kids[k.c] = (p.kids[k.c] || 0) + 1; });
    if (n.cols) { const shape = `${n.c}/${n.ncols}:${[...new Set(n.cols.flat().map((k) => k.c))].sort().join('+')}`; P[shape] = P[shape] || { pages: new Set(), inst: 0, chars: [], imgs: [], videos: [], forms: [], links: [], parents: {}, kids: {}, templates: {}, mods: {}, example: url, shape: true }; P[shape].pages.add(url); P[shape].inst += 1; }
    (n.kids || []).forEach((k) => add(k, url, tpl, n.c));
    (n.cols || []).forEach((col) => col.forEach((k) => add(k, url, tpl, `${n.c}/${n.ncols}`)));
  };
  for (const r of rows) {
    if (seen.has(r.final_url)) continue; seen.add(r.final_url);
    r.comps.forEach((n) => add(n, r.url, r.template ?? '(none)', 'main'));
  }
  const top = (o, k = 3) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k);
  return Object.entries(P).map(([c, p]) => ({
    component: c, shape: !!p.shape, pages: p.pages.size, instances: p.inst,
    median: { chars: median(p.chars), imgs: median(p.imgs), videos: median(p.videos), forms: median(p.forms), links: median(p.links) },
    parents: top(p.parents), kids: top(p.kids), templates: top(p.templates), mods: top(p.mods, 5), example: p.example,
  })).sort((a, b) => b.pages - a.pages);
}

function main() {
  const cfg = loadConfig();
  const rows = readJSONL(arg('in', cfg.p('parse', 'components.jsonl')));
  const prof = profile(rows);
  if (arg('json')) writeJSON(arg('json'), prof);
  for (const p of prof.slice(0, Number(arg('top', 200)))) {
    const m = p.median;
    console.log(`${p.component}${p.shape ? ' [row shape]' : ''}  pages=${p.pages} inst=${p.instances} med(chars,imgs,vid,forms,links)=(${m.chars},${m.imgs},${m.videos},${m.forms},${m.links})`);
    console.log(`   parents=${JSON.stringify(p.parents)} kids=${JSON.stringify(p.kids)} templates=${JSON.stringify(p.templates)} mods=${JSON.stringify(p.mods)}`);
    console.log(`   example=${p.example}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
