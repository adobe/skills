#!/usr/bin/env node
/**
 * skills/stardust/scripts/progress.mjs — the batch-driver completion contract.
 *
 * Every driver that runs longer than a foreground turn (deploy-batch, crawl,
 * verify, gate sweeps) writes ONE small progress JSON while it runs and prints
 * ONE summary line when it ends. The agent's ≤ 4-minute check (master skill
 * § Wait discipline) is then a single read of a small file, and the background
 * launch has a single completion line — no `grep -c` arithmetic over logs.
 *
 * Progress file (atomic: tmp + rename, so a reader never sees a half write):
 *   { driver, total, done, ok, failed, noverdict, lastPath, startedAt, updatedAt, ...extra }
 *   default path: stardust/.work/<skill>/<driver>.progress.json (the run-only write
 *   boundary; `stardust/.gitignore` already excludes `.work/`).
 *
 * Summary line — the LAST line on stdout, exit code unchanged by this helper:
 *   SUMMARY <driver> ok=<n> failed=<n> [noverdict=<n>] exit=<code> details=<path> [k=v …]
 *   `noverdict` carries exit-124 (deadline) rows: a deadline is never folded into
 *   `failed` — no verdict is not a FAIL.
 *
 * API:
 *   import { createProgress, summaryLine, defaultProgressFile } from '…/stardust/scripts/progress.mjs';
 *   const p = createProgress({ file, driver: 'deploy-batch', total, extra: { publish: false } });
 *   p.tick({ ok: true, path: '/x' });          // ok | failed | noverdict, writes the file
 *   p.set({ total: 12 });                      // patch any field, writes the file
 *   console.log(p.summaryLine({ exit: 0, details: 'content/.deploy-ledger.json', extra: { skipped: 3 } }));
 *   file: null disables the file (SUMMARY still prints).
 *
 * CLI (read-back for the agent's check):
 *   node skills/stardust/scripts/progress.mjs read <file>   → one line: driver done/total ok failed noverdict updated <age>s ago
 *   Exit codes: 0 printed; 1 file missing or unreadable; 2 usage.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function defaultProgressFile(skill, driver, root = '.') {
  return join(root, 'stardust', '.work', skill, `${driver}.progress.json`);
}

export function summaryLine({ driver, ok = 0, failed = 0, noverdict = 0, exit = 0, details = '-', extra = {} }) {
  const parts = [`SUMMARY ${driver}`, `ok=${ok}`, `failed=${failed}`];
  if (noverdict) parts.push(`noverdict=${noverdict}`);
  parts.push(`exit=${exit}`, `details=${details}`);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== '') parts.push(`${k}=${String(v).replace(/\s+/g, '_')}`);
  return parts.join(' ');
}

export function writeAtomic(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, file);
}

export function createProgress({ file, driver, total = 0, extra = {} } = {}) {
  const state = { driver, total, done: 0, ok: 0, failed: 0, noverdict: 0, lastPath: null, startedAt: new Date().toISOString(), updatedAt: null, ...extra };
  const write = () => { if (!file) return; state.updatedAt = new Date().toISOString(); writeAtomic(file, state); };
  write();
  return {
    file,
    state,
    write,
    set(patch) { Object.assign(state, patch); write(); },
    tick({ ok, path, noverdict = false } = {}) {
      state.done += 1;
      if (noverdict) state.noverdict += 1;
      else if (ok) state.ok += 1;
      else state.failed += 1;
      if (path) state.lastPath = path;
      write();
    },
    summaryLine({ exit = 0, details = file || '-', extra: more = {} } = {}) {
      return summaryLine({ driver, ok: state.ok, failed: state.failed, noverdict: state.noverdict, exit, details, extra: more });
    },
  };
}

function cli(argv) {
  const [cmd, file] = argv.slice(2);
  if (cmd === '--help' || cmd === '-h' || !cmd) {
    console.log('usage: node skills/stardust/scripts/progress.mjs read <progress.json>');
    return cmd ? 0 : 2;
  }
  if (cmd !== 'read' || !file) { console.error('progress: usage: read <file>'); return 2; }
  let s;
  try { s = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`progress: cannot read ${file}: ${e.message}`); return 1; }
  const age = s.updatedAt ? Math.round((Date.now() - Date.parse(s.updatedAt)) / 1000) : '?';
  console.log(`${s.driver} ${s.done}/${s.total} ok=${s.ok} failed=${s.failed} noverdict=${s.noverdict || 0}${s.lastPath ? ` last=${s.lastPath}` : ''} updated ${age}s ago`);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) process.exit(cli(process.argv));
