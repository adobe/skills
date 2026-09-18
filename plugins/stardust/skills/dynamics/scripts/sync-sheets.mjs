#!/usr/bin/env node
/**
 * sync-sheets.mjs — copy sheet-backed JSON (placeholders, /data/*.json) from a
 * published source origin into the target Document Authoring repo, then preview
 * and publish, so library blocks read the same copy and settings off-origin
 * (reference/off-origin-data.md § sheet-backed data). Idempotent.
 *
 *   node sync-sheets.mjs --source https://main--site--org.aem.live --org <org> --repo <repo> --paths placeholders.json,data/hours.json [--ref main] [--log stardust/dynamics/sheets]
 *   env DA_TOKEN (IMS bearer) — used for admin.da.live and admin.hlx.page; never printed.
 *
 * Writes: <log>/_sync.json (default stardust/dynamics/sheets) — per path the source status,
 * row count and the PUT / preview / live statuses, with _provenance. Network side effects:
 * one PUT to the DA admin API plus a preview and a publish POST per path on the target repo.
 * Per-path lines go to stderr. Exit 0 on completion, 2 on usage or a missing DA_TOKEN,
 * 3 when the token is rejected (401).
 */
/* eslint-disable no-await-in-loop, no-restricted-syntax, max-len */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { arg, list, writeJSON, provenance } from './lib.mjs';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

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
