/**
 * deploy/file-lock.mjs — cross-process safety for the shared JSON ledgers the deploy scripts
 * rewrite whole (the media ledger, the deploy-batch ledger). Library, no CLI.
 *
 *   acquireLock(target)        mkdir `<target>.lock` (atomic everywhere), `owner` = pid + time,
 *                              bounded wait (30 s), a lock older than 60 s reclaimed; returns release()
 *   withLock(target, fn)       run fn under the lock; re-read the file INSIDE fn, never before
 *   writeJSONAtomic(path, obj) sibling tmp file + rename, trailing newline
 *   mergeLedger(path, own)     under the lock: re-read the ledger on disk, lay this process's
 *                              entries over it (own keys win), write atomically; returns the merged
 *                              object. Several cluster subagents upload media at once during a
 *                              fan-out; a whole-file rewrite from one process's memory dropped the
 *                              others' rows, and the media gate then failed every page whose entry
 *                              was lost.
 * Same contract as rollout/lib.mjs acquireLock (each script set imports only its siblings).
 */
import { mkdirSync, writeFileSync, readFileSync, statSync, renameSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function acquireLock(target, { timeoutMs = 30000, staleMs = 60000, pollMs = 50 } = {}) {
  const dir = `${target}.lock`;
  mkdirSync(dirname(dir), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, 'owner'), `${process.pid} ${new Date().toISOString()}\n`);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let st = null;
      try { st = statSync(dir); } catch { continue; }
      if (Date.now() - st.mtimeMs > staleMs) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* raced */ } continue; }
      if (Date.now() > deadline) {
        let owner = '?'; try { owner = readFileSync(join(dir, 'owner'), 'utf8').trim(); } catch { /* none */ }
        throw new Error(`lock ${dir} held for over ${timeoutMs} ms (owner ${owner}) — a crashed writer leaves it; remove the directory when no such process runs`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs);
    }
  }
  let released = false;
  const release = () => { if (released) return; released = true; try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } };
  process.once('exit', release);
  return release;
}

export function withLock(target, fn, opts) {
  const release = acquireLock(target, opts);
  try { return fn(); } finally { release(); }
}

export function writeJSONAtomic(path, obj) {
  mkdirSync(dirname(path) || '.', { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, path);
}

/** Read a JSON object file; `{}` when absent; a malformed file is reported to `onBad` and treated as empty. */
export function readLedger(path, onBad = () => {}) {
  if (!existsSync(path)) return {};
  try {
    const l = JSON.parse(readFileSync(path, 'utf8'));
    return l && typeof l === 'object' && !Array.isArray(l) ? l : {};
  } catch (e) { onBad(e); return {}; }
}

export function mergeLedger(path, own, { onBad } = {}) {
  return withLock(path, () => {
    const disk = readLedger(path, onBad);
    const merged = { ...disk, ...own };
    writeJSONAtomic(path, merged);
    return merged;
  });
}
