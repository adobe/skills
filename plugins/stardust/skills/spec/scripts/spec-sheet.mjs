#!/usr/bin/env node
/**
 * spec-sheet.mjs — judgement aid: a contact sheet of captured crops for one component (or row shape), to decide
 * its mapping by looking at real instances. Lays the crops out as an HTML page and screenshots it (no image library).
 *
 *   node spec-sheet.mjs <component | row-shape> [--config spec.config.json] [--max 8] [--out <file.jpg>]
 *
 * <component>: a component name from spec-profile (e.g. "text", "c-promo-tiles"); a row shape such as
 * "row/3:image+text" matches rows with that column count and child kinds. Writes <dir>/sheets/<name>.jpg.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { arg, helpAndExit, loadConfig, loadPlaywright, log, readJSONL, urlKey } from './lib.mjs';

helpAndExit(import.meta.url);

/** Does node n match the wanted component or row shape? Pure. */
export function matchesWant(n, want) {
  const m = want.match(/^(row|colctrl:[\w-]+)\/(\d+):(.+)$/);
  if (!m) return n.c === want;
  if (n.c !== m[1] || n.ncols !== Number(m[2])) return false;
  return [...new Set((n.cols || []).flat().map((k) => k.c))].sort().join('+') === m[3];
}

async function main() {
  const want = process.argv[2];
  if (!want || want.startsWith('--')) { console.error('usage: spec-sheet.mjs <component|row-shape> [--max 8]'); process.exit(2); }
  const cfg = loadConfig(); const media = cfg.p('media'); const max = Number(arg('max', 8));
  const tiles = [];
  const nodes = function* nodes(n) { yield n; for (const c of n.cols || []) for (const k of c) yield* nodes(k); for (const k of n.kids || []) yield* nodes(k); };
  for (const r of readJSONL(cfg.p('parse', 'components.jsonl'))) {
    const key = urlKey(r.url);
    if (!existsSync(join(media, key))) continue;
    for (const top of r.comps) {
      const hit = [...nodes(top)].find((n) => matchesWant(n, want) && existsSync(join(media, key, `${n.p}.jpg`)));
      if (hit) { tiles.push({ label: `${new URL(r.url).pathname} #${hit.p}`, src: pathToFileURL(join(media, key, `${hit.p}.jpg`)).href }); break; }
    }
    if (tiles.length >= max) break;
  }
  if (!tiles.length) { log(`no captured crops for ${want} (run spec-pick + spec-capture first)`); process.exit(1); }
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:12px system-ui;background:#fff;width:900px">${tiles.map((t) => `<div style="background:#222;color:#fff;padding:6px 8px">${t.label.replace(/</g, '&lt;')}</div><img src="${t.src}" style="width:900px;max-height:700px;object-fit:cover;object-position:top;display:block">`).join('')}</body>`;
  const file = join(cfg.p('sheets'), `${want.replace(/[^\w.-]+/g, '_')}.html`);
  await import('node:fs').then((fs) => fs.mkdirSync(cfg.p('sheets'), { recursive: true }));
  writeFileSync(file, html);
  const { chromium } = await loadPlaywright();
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 900, height: 800 } });
  await p.goto(pathToFileURL(file).href); await p.waitForLoadState('load');
  const out = arg('out', file.replace(/\.html$/, '.jpg'));
  await p.screenshot({ path: out, fullPage: true, type: 'jpeg', quality: 70 });
  await b.close();
  log(`${tiles.length} crops → ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
