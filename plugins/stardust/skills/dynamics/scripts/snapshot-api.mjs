#!/usr/bin/env node
/**
 * snapshot-api.mjs — record live same-origin API responses from a browser
 * context on the SOURCE host (cookies and bot management pass; curl does not)
 * into `<out>/<name>.json` with a `_provenance.json` and response shapes. The
 * recordings feed an existing library off-origin through endpoint indirection
 * (reference/off-origin-data.md, tier 2) or a `Source` row.
 *
 *   node snapshot-api.mjs --origin https://www.source.example --calls calls.json [--out data/<feature>] [--entry /]
 *   calls.json: [{ "name": "airports", "method": "GET", "path": "/api/airports" },
 *                { "name": "suggest-a", "method": "POST", "path": "/api/suggest", "body": { "term": "a" } }]
 */
/* eslint-disable no-await-in-loop, no-restricted-syntax, max-len */
import { join } from 'node:path';
import { arg, readJSON, writeJSON, provenance, loadPlaywright, settlePage } from './lib.mjs';

const ORIGIN = (arg('origin') || '').replace(/\/$/, '');
const CALLS = arg('calls') && readJSON(arg('calls'));
if (!ORIGIN || !CALLS) { console.error('usage: snapshot-api.mjs --origin <source origin> --calls calls.json [--out dir]'); process.exit(2); }
const OUT = arg('out', 'data/snapshot');
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(ORIGIN + (arg('entry', '/')), { waitUntil: 'domcontentloaded', timeout: 60000 });
await settlePage(page, { settleMs: 2000, maxScroll: 0 });
const describe = (v, d = 0) => { if (d > 3 || v === null || typeof v !== 'object') return typeof v; if (Array.isArray(v)) return `[${v.length}] of ${v.length ? describe(v[0], d + 1) : '?'}`; return `{${Object.keys(v).slice(0, 14).map((k) => `${k}: ${describe(v[k], d + 1)}`).join(', ')}}`; };
const shapes = {};
for (const c of CALLS) {
  const r = await page.evaluate(async ({ method, path, body }) => { const t0 = Date.now(); try { const res = await fetch(path, { method: method || 'GET', headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, ms: Date.now() - t0, text: await res.text() }; } catch (e) { return { status: 0, error: String(e.message) }; } }, c);
  if (r.status !== 200) { shapes[c.name] = { ...c, status: r.status, error: r.error }; console.error(`[snapshot] ${c.name}: FAIL ${r.error || r.status}`); continue; }
  let json = null; try { json = JSON.parse(r.text); } catch { /* not json */ }
  shapes[c.name] = { ...c, status: r.status, ms: r.ms, bytes: r.text.length, shape: describe(json) };
  if (json !== null) writeJSON(join(OUT, `${c.name}.json`), json);
  console.error(`[snapshot] ${c.name}: ${r.status} ${r.text.length}b ${r.ms}ms · ${shapes[c.name].shape.slice(0, 160)}`);
}
writeJSON(join(OUT, '_provenance.json'), { ...provenance('snapshot-api', { origin: ORIGIN }), calls: shapes });
await browser.close().catch(() => {});
console.error(`[snapshot] ${Object.values(shapes).filter((s) => s.status === 200).length}/${CALLS.length} recorded → ${OUT}`);
setTimeout(() => process.exit(0), 200).unref();
