#!/usr/bin/env node
/**
 * sync-sheets.mjs — copy sheet-backed JSON (placeholders, /data/*.json) from a
 * published source origin into the target Document Authoring repo, then preview
 * and publish, so library blocks read the same copy and settings off-origin
 * (reference/off-origin-data.md § sheet-backed data). Idempotent.
 *
 *   node sync-sheets.mjs --source https://main--site--org.aem.live --org <org> --repo <repo> --paths placeholders.json,data/hours.json [--ref main] [--log stardust/dynamics/sheets]
 *   env DA_TOKEN (IMS bearer) — used for admin.da.live and admin.hlx.page; never printed.
 */
/* eslint-disable no-await-in-loop, no-restricted-syntax, max-len */
import { join } from 'node:path';
import { arg, list, writeJSON, provenance } from './lib.mjs';

const SOURCE = (arg('source') || '').replace(/\/$/, ''); const ORG = arg('org'); const REPO = arg('repo'); const REF = arg('ref', 'main');
const PATHS = list(arg('paths', ''));
const TOKEN = process.env.DA_TOKEN;
if (!SOURCE || !ORG || !REPO || !PATHS.length) { console.error('usage: sync-sheets.mjs --source <origin> --org <org> --repo <repo> --paths a.json,b.json'); process.exit(2); }
if (!TOKEN) { console.error('DA_TOKEN missing in the environment'); process.exit(2); }
const log = [];
for (const p of PATHS) {
  const path = p.replace(/^\//, '');
  const r = await fetch(`${SOURCE}/${path}`);
  if (!r.ok) { console.error(`[sheets] ${path}: source ${r.status} — skipped`); log.push({ path, source: r.status }); continue; }
  const json = await r.json();
  const body = JSON.stringify(json);
  const fd = new FormData(); fd.append('data', new Blob([body], { type: 'application/json' }), path.split('/').pop());
  const put = await fetch(`https://admin.da.live/source/${ORG}/${REPO}/${path}`, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}` }, body: fd });
  if (put.status === 401) { console.error('[sheets] DA_TOKEN rejected (401) — re-login at https://da.live and refresh it'); process.exit(3); }
  const preview = await fetch(`https://admin.hlx.page/preview/${ORG}/${REPO}/${REF}/${path}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
  const live = await fetch(`https://admin.hlx.page/live/${ORG}/${REPO}/${REF}/${path}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
  const rows = Array.isArray(json.data) ? json.data.length : Object.keys(json).filter((k) => !k.startsWith(':')).length;
  console.error(`[sheets] ${path}: ${rows} rows · put ${put.status} · preview ${preview.status} · live ${live.status}`);
  log.push({ path, rows, put: put.status, preview: preview.status, live: live.status });
}
writeJSON(join(arg('log', 'stardust/dynamics/sheets'), '_sync.json'), { ...provenance('sync-sheets', { source: SOURCE, target: `${ORG}/${REPO}/${REF}` }), log });
