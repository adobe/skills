#!/usr/bin/env node
// wave.test stub for deploy-batch.mjs: writes ledger rows for --paths (previewed, or live with --publish);
// $WAVE_T/deploy-mode.json { mode: "ok" | "exit3" | "fail", failPath } — exit3 writes the FIRST row then halts
// with a `next=` line and exit 3 (the token halt); fail marks failPath `put-fail`. Records every argv.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const T = process.env.WAVE_T; const argv = process.argv.slice(2);
appendFileSync(join(T, 'calls.jsonl'), `${JSON.stringify({ stage: 'deploy-batch', argv })}\n`);
const val = (k) => { const i = argv.indexOf(k); return i === -1 ? null : argv[i + 1]; };
const paths = readFileSync(val('--paths'), 'utf8').split('\n').map((x) => x.trim()).filter(Boolean);
const publish = argv.includes('--publish');
const ledgerFile = join(val('--content') || 'content', '.deploy-ledger.json');
const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, 'utf8')) : {};
const mode = existsSync(join(T, 'deploy-mode.json')) ? JSON.parse(readFileSync(join(T, 'deploy-mode.json'), 'utf8')) : { mode: 'ok' };
let n = 0;
for (const p of paths) {
  if (mode.mode === 'exit3' && n === 1) break;
  if (mode.mode === 'fail' && p === mode.failPath) { ledger[p] = { status: 'put-fail', lastError: 'DA 500', attempts: 1, ts: new Date().toISOString() }; n += 1; continue; }
  const file = join(val('--content') || 'content', p === '/' ? 'index.html' : `${p.slice(1)}.html`);
  ledger[p] = { status: publish ? 'live' : 'previewed', bodyHash: createHash('sha1').update(readFileSync(file)).digest('hex'), branch: 'main', attempts: 1, ts: new Date().toISOString() };
  n += 1;
}
writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
if (mode.mode === 'exit3') { console.log(`halt: DA_TOKEN 401 — next=node skills/deploy/scripts/deploy-batch.mjs --paths ${val('--paths')}`); console.log(`SUMMARY deploy-batch ok=${n} failed=0 exit=3 details=${ledgerFile}`); process.exit(3); }
console.log(`SUMMARY deploy-batch ok=${n} failed=0 exit=0 details=${ledgerFile}`);
