#!/usr/bin/env node
// wave.test stub for deploy-batch.mjs: keys the content tree EXACTLY as deploy-batch does (walkHtml: content/<rel>.html →
// `/<rel>`, so content/index.html is `/index`, never `/`) and writes ledger rows for the --paths it finds there
// (previewed, or live with --publish); a wanted path that is not in the tree prints `missing <p> not in content tree`
// and gets NO row — the real driver's behaviour, and the negative fixture for a `/` written into the paths file.
// $WAVE_T/deploy-mode.json { mode: "ok" | "exit3" | "fail", failPath, bigStdout } — exit3 writes the FIRST row then halts
// with a `next=` line and exit 3 (the token halt; bigStdout prints ~300 KB of log lines first, past the pipe buffer);
// fail marks failPath `put-fail`. Records every argv.
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
const T = process.env.WAVE_T; const argv = process.argv.slice(2);
appendFileSync(join(T, 'calls.jsonl'), `${JSON.stringify({ stage: 'deploy-batch', argv })}\n`);
const val = (k) => { const i = argv.indexOf(k); return i === -1 ? null : argv[i + 1]; };
const normalise = (p) => { const s = String(p || '').trim(); return s ? `/${s.replace(/\.html$/i, '')}`.replace(/^\/+/, '/') : null; };
const want = new Set(readFileSync(val('--paths'), 'utf8').split(/[\n,]/).map(normalise).filter(Boolean));
const publish = argv.includes('--publish');
const content = val('--content') || 'content';
const tree = new Map();
const walk = (d) => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) walk(f); else if (n.endsWith('.html')) tree.set(`/${relative(content, f).replace(/\.html$/, '')}`, f); } };
walk(content);
const ledgerFile = join(content, '.deploy-ledger.json');
const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, 'utf8')) : {};
const mode = existsSync(join(T, 'deploy-mode.json')) ? JSON.parse(readFileSync(join(T, 'deploy-mode.json'), 'utf8')) : { mode: 'ok' };
let n = 0;
for (const p of [...want].sort()) {
  if (!tree.has(p)) { console.log(`  missing ${p}  not in content tree`); continue; }
  if (mode.mode === 'exit3' && n === 1) break;
  if (mode.mode === 'fail' && p === mode.failPath) { ledger[p] = { status: 'put-fail', lastError: 'DA 500', attempts: 1, ts: new Date().toISOString() }; n += 1; continue; }
  ledger[p] = { status: publish ? 'live' : 'previewed', bodyHash: createHash('sha1').update(readFileSync(tree.get(p))).digest('hex'), branch: 'main', attempts: 1, ts: new Date().toISOString() };
  n += 1;
}
writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
if (mode.mode === 'exit3') {
  if (mode.bigStdout) for (let i = 0; i < 3000; i += 1) console.log(`{"ts":"2026-01-01T00:00:00.000Z","path":"/p${i}","step":"verify","ok":true,"ms":123,"pad":"${'x'.repeat(60)}"}`);
  console.log(`halt: DA_TOKEN 401 — next=node skills/deploy/scripts/deploy-batch.mjs --paths ${val('--paths')}`); console.log(`SUMMARY deploy-batch ok=${n} failed=0 exit=3 details=${ledgerFile}`); process.exit(3);
}
console.log(`SUMMARY deploy-batch ok=${n} failed=0 exit=0 details=${ledgerFile}`);
