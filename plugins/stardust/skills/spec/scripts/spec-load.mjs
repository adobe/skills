#!/usr/bin/env node
/**
 * spec-load.mjs — S11 publish: render the viewer template into the project, create (once) the D1 database and the
 * R2 bucket, replace the spec tables in D1 with spec.sqlite (keeping recorded decisions, chat logs, usage and saved
 * views), upload the captured media, and deploy. Runs wrangler from the project's viewer copy.
 *
 *   node spec-load.mjs [--config spec.config.json] [--step render|data|media|deploy|all] [--media-workers 8]
 *
 * Config: viewer.{worker, d1, r2, foundryEndpoint, chatModel}. Secrets are set by the operator, never stored here:
 * FOUNDRY_API_KEY (chat), EDITOR_KEY (recording decisions), ADMIN_TOKEN (only while uploading media; the media step
 * reads it from $SPEC_ADMIN_TOKEN, and the route answers 404 once the secret is deleted).
 * Writes <root>/viewer/ (the template + wrangler.jsonc), <dir>/spec-d1.sql.
 */
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { HERE, arg, helpAndExit, loadConfig, log, pool } from './lib.mjs';

helpAndExit(import.meta.url);

const KEEP = new Set(['question_answer', 'chat_log', 'usage', 'view_spec']);

/** SQL that replaces the spec tables and keeps the operator-owned ones. Pure given the database. */
export function dumpSQL(db) {
  const objs = db.prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`).all();
  const lines = [];
  objs.filter((o) => o.type === 'view').forEach((o) => lines.push(`DROP VIEW IF EXISTS ${o.name};`));
  objs.filter((o) => o.type === 'table' && !KEEP.has(o.name)).forEach((o) => lines.push(`DROP TABLE IF EXISTS ${o.name};`));
  for (const o of objs.filter((x) => x.type === 'table')) {
    if (KEEP.has(o.name)) { lines.push(`${o.sql.replace(/^CREATE TABLE/, 'CREATE TABLE IF NOT EXISTS')};`); continue; }
    lines.push(`${o.sql};`);
    const rows = db.prepare(`SELECT * FROM ${o.name}`).all();
    for (const r of rows) lines.push(`INSERT INTO ${o.name} VALUES (${Object.values(r).map((v) => (v === null ? 'NULL' : typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`)).join(',')});`);
  }
  objs.filter((o) => o.type === 'index').forEach((o) => lines.push(`${o.sql.replace(/^CREATE INDEX/, 'CREATE INDEX IF NOT EXISTS')};`));
  objs.filter((o) => o.type === 'view').forEach((o) => lines.push(`${o.sql};`));
  return lines.join('\n');
}

const wr = (cwd, args, opts = {}) => execFileSync('npx', ['wrangler', ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });

async function main() {
  const cfg = loadConfig(); const v = cfg.viewer || {};
  if (!v.worker || !v.d1 || !v.r2) throw new Error('config.viewer.{worker,d1,r2} are required');
  const step = arg('step', 'all'); const app = join(cfg.root, 'viewer');
  const tmpl = [join(HERE, '..', 'viewer'), join(HERE, '..', '..', 'viewer')].find((p) => existsSync(join(p, 'wrangler.template.jsonc')));
  if (step === 'render' || step === 'all') {
    if (!tmpl) throw new Error('viewer template not found next to the scripts');
    cpSync(tmpl, app, { recursive: true, filter: (s) => !/node_modules|dist|\.wrangler/.test(s) });
    if (!existsSync(join(app, 'node_modules'))) spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: app, stdio: 'inherit' });
    let id = null;
    const list = JSON.parse(wr(app, ['d1', 'list', '--json']));
    id = list.find((d) => d.name === v.d1)?.uuid;
    if (!id) { const outp = wr(app, ['d1', 'create', v.d1]); id = (outp.match(/"database_id":\s*"([^"]+)"/) || outp.match(/database_id\s*=\s*"([^"]+)"/) || [])[1]; }
    try { wr(app, ['r2', 'bucket', 'create', v.r2]); } catch (e) { if (!/already exists/i.test(String(e.stderr || e.message))) throw e; }
    const t = readFileSync(join(app, 'wrangler.template.jsonc'), 'utf8')
      .replaceAll('__WORKER__', v.worker).replaceAll('__D1_NAME__', v.d1).replaceAll('__D1_ID__', id).replaceAll('__R2_BUCKET__', v.r2)
      .replaceAll('__FOUNDRY_ENDPOINT__', v.foundryEndpoint || '').replaceAll('__CHAT_MODEL__', v.chatModel || '');
    writeFileSync(join(app, 'wrangler.jsonc'), t);
    log(`viewer rendered: worker ${v.worker}, D1 ${v.d1} (${id}), R2 ${v.r2}`);
  }
  if (step === 'data' || step === 'all') {
    const sql = dumpSQL(new DatabaseSync(cfg.p('spec.sqlite'), { readOnly: true }));
    writeFileSync(cfg.p('spec-d1.sql'), sql);
    wr(app, ['d1', 'execute', v.d1, '--remote', '--file', cfg.p('spec-d1.sql'), '-y'], { maxBuffer: 1 << 26 });
    log(`D1 loaded (${(sql.length / 1e6).toFixed(1)} MB)`);
  }
  if (step === 'deploy' || step === 'all') {
    spawnSync('npm', ['run', 'deploy'], { cwd: app, stdio: 'inherit' });
  }
  if (step === 'media' || step === 'all') {
    const token = process.env.SPEC_ADMIN_TOKEN; const base = arg('base', v.url);
    if (!token || !base) { log('media step skipped: set $SPEC_ADMIN_TOKEN (same value as the ADMIN_TOKEN secret) and viewer.url'); return; }
    const media = cfg.p('media'); const files = [];
    for (const k of readdirSync(media)) for (const f of readdirSync(join(media, k))) if (f.endsWith('.jpg')) files.push(`${k}/${f}`);
    let ok = 0;
    await pool(files, Number(arg('media-workers', 8)), async (f) => {
      for (let a = 0; a < 3; a += 1) {
        const r = await fetch(`${base}/api/admin/media/crops/${f}`, { method: 'PUT', headers: { 'x-admin-token': token, 'content-type': 'image/jpeg' }, body: readFileSync(join(media, f)) }).catch(() => null);
        if (r?.ok) { ok += 1; return; }
      }
    }, (d, n) => { if (d % 500 === 0 || d === n) log(`${d}/${n}`); });
    log(`${ok}/${files.length} media files uploaded — now delete the ADMIN_TOKEN secret`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(String(e.stderr || e.message).slice(0, 2000)); process.exit(1); });
