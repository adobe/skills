#!/usr/bin/env node
/**
 * spec-pick.mjs — choose the pages S6 and S8 capture: every layout variant's representative, plus at least one page for
 * every block × variant (most-trafficked first when views exist), plus N example pages per component type for
 * judgement (before mapping exists, use --components-only).
 *
 *   node spec-pick.mjs [--config spec.config.json] [--components-only] [--per-component 2] [--out <file>]
 *
 * Reads <dir>/judgement/variants.json + page-blocks.jsonl (unless --components-only) and parse/components.jsonl.
 * Writes <dir>/judgement/capture-urls.txt (or --out).
 */
import { arg, flag, helpAndExit, loadConfig, log, readJSON, readJSONL, writeText } from './lib.mjs';

helpAndExit(import.meta.url);

/** Up to `per` example URLs per component type (top-level and nested), spread across templates. Pure. */
export function componentExamples(rows, per = 2) {
  const ex = {}; const seen = new Set();
  const walk = (n, r) => {
    const e = ex[n.c] || (ex[n.c] = { urls: [], templates: new Set() });
    if (e.urls.length < per && !e.urls.includes(r.url) && (!e.templates.has(r.template) || e.urls.length + 1 < per)) { e.urls.push(r.url); e.templates.add(r.template); }
    (n.kids || []).forEach((k) => walk(k, r)); (n.cols || []).forEach((c) => c.forEach((k) => walk(k, r)));
  };
  for (const r of rows) { if (seen.has(r.final_url)) continue; seen.add(r.final_url); r.comps.forEach((n) => walk(n, r)); }
  return [...new Set(Object.values(ex).flatMap((e) => e.urls))];
}

function main() {
  const cfg = loadConfig();
  const comps = readJSONL(cfg.p('parse', 'components.jsonl'));
  const urls = new Set(componentExamples(comps, Number(arg('per-component', 2))));
  if (!flag('components-only')) {
    readJSON(cfg.p('judgement', 'variants.json')).forEach((v) => urls.add(v.representative));
    const views = readJSON(cfg.p('rum', 'rum.json'), { pages: {} }).pages || {};
    const vOf = (u) => { try { return views[new URL(u).pathname]?.views || 0; } catch { return 0; } };
    const best = {};
    for (const r of readJSONL(cfg.p('judgement', 'page-blocks.jsonl'))) {
      for (const b of r.blocks) {
        if (b.kind !== 'block' && b.kind !== 'dynamic') continue;
        const k = `${b.block}|${b.variant}`;
        if (!best[k] || vOf(r.url) > vOf(best[k])) best[k] = r.url;
      }
    }
    Object.values(best).forEach((u) => urls.add(u));
  }
  writeText(arg('out', cfg.p('judgement', 'capture-urls.txt')), [...urls].join('\n'));
  log(`${urls.size} pages to capture`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
