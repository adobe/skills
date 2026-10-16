#!/usr/bin/env node
// skills/stardust/scripts/unit-commit.mjs — commit ONE rollout unit's delivered pages and the shared
// rollout bookkeeping by explicit path (never `git add -A`), under one project-wide git lock.
//
// Why: commits happened only at a unit's end and coverage rows were written after the gate, so on a
// recorded hands-off run a lost container lost 20 published pages' bookkeeping. Parallel unit
// subagents in one work tree collided: `git add content` swept another unit's pages into the wrong
// commit, `pull --rebase` refused, pushes raced. This script commits a unit's set the moment it is
// delivered, holds the lock from staging to the last push, and commits by pathspec, so whatever
// another process staged stays staged and out of the commit.
//
//   node stardust/scripts/stardust/unit-commit.mjs <unit> [--push] [--message <m>] [--wait-s 120]
//
// Run from the project root, inside its git work tree. The stage set — only files that exist and are
// not git-ignored (`git check-ignore`), deduped, sorted:
//   1. per line of stardust/rollout/units/<unit>.paths, key = deploy's pathKey (eds-path.mjs):
//      content/<key>.html and/or content/<key>/index.html (root `/`: content/index.html);
//   2. per coverage row (stardust/rollout/coverage/pages.json) whose pathKey(row.path) is that key:
//      stardust/eds-schema/<slug>.json and its gate sidecar — row.source.metaJson when set, else the
//      migrate sidecar beside row.source.migratedHtml (index.html → _meta.json, <name>.html →
//      <name>._meta.json, same dir);
//   3. shared bookkeeping: stardust/rollout/coverage/*.json, stardust/rollout/progress.json,
//      stardust/deploy/media-ledger.json and the unit's own stardust/rollout/units/<unit>.paths.
// The lock is a file, stardust/.work/git.lock, created with open(…, 'wx') and holding one JSON line
// {pid, host, at, unit}. A waiter polls every 200 ms up to --wait-s. A lock whose pid is not running
// on this host (kill -0 → ESRCH), or untouched for 300 s, is reaped by renaming it aside and checking
// the renamed file is the very one judged stale (inode, mtime, content); a lock another process took
// in between is put back, never removed. The holder touches the lock before every git step and
// re-reads it: a lock that is no longer its own stops the run before the next stage, commit or push.
// The commit takes the set's changed files only (`git commit -- <files>`); a failed commit unstages
// the set. --push: `git pull --rebase --autostash` then `git push`, up to 3 retries each after a
// backoff and a fresh pull; a rebase conflict is aborted (no rebase left in progress, the autostash
// comes back) and the local commit kept; an autostash that rebased but did not re-apply cleanly (git
// keeps it in the stash list, the work tree holds conflict markers) stops before the push. A merge or
// rebase in progress, or unmerged index entries, refuse the run before anything is staged — staging
// a file with conflict markers would commit them. Exactly one status line on stdout in every outcome;
// git's chatter is captured (a failing step's last git line goes to stderr, URL credentials redacted).
// Exit codes: 0 committed (and pushed with --push), or nothing new but pushed · 2 everything else —
// usage, not a git work tree, missing .paths, unreadable coverage, lock timeout, nothing to commit,
// a merge/rebase in progress or unmerged files, commit failure, no upstream, rebase conflict, an
// autostash that did not re-apply, push failure.
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// deploy's path contract, in both layouts: plugin tree (skills/stardust/scripts → ../../deploy/scripts)
// and project copy (stardust/scripts/stardust → ../deploy)
const { pathKey } = await import(pathToFileURL([join(HERE, '..', '..', 'deploy', 'scripts', 'eds-path.mjs'), join(HERE, '..', 'deploy', 'eds-path.mjs')].find((x) => existsSync(x)) || join(HERE, '..', '..', 'deploy', 'scripts', 'eds-path.mjs')).href);

export const UNIT_RE = /^[\w.-]+$/;
export const LOCK_REL = 'stardust/.work/git.lock';
export const STALE_MS = 300_000;
export const POLL_MS = 200;
export const DEFAULT_WAIT_S = 120;
export const PUSH_RETRIES = 3;
const BACKOFF_MS = 750;
const GIT_LOCK_RETRIES = 20; // × 500 ms: another git command in the same work tree holding index.lock / a ref lock
const PAGES_REL = 'stardust/rollout/coverage/pages.json';
const COVERAGE_DIR = 'stardust/rollout/coverage';
const SHARED = ['stardust/rollout/progress.json', 'stardust/deploy/media-ledger.json'];
const SELF = fileURLToPath(import.meta.url);

const HELP = `Usage:
  node stardust/scripts/stardust/unit-commit.mjs <unit> [--push] [--message <m>] [--wait-s ${DEFAULT_WAIT_S}]
  (run from the project root, inside its git work tree; <unit> matches ${UNIT_RE})

Commits ONE unit's delivered pages and the shared rollout bookkeeping — by explicit path, never
git add -A — under a project-wide lock, so parallel units in one work tree cannot sweep each
other's files into a commit or race each other's pull and push.

Inputs:
  stardust/rollout/units/<unit>.paths  one web/DA path per line, blank and # lines skipped (required)
  ${PAGES_REL}  rows matched to those paths by deploy's pathKey
The stage set (only files that exist and are not git-ignored; deduped, sorted):
  per path (key = pathKey): content/<key>.html and/or content/<key>/index.html (/: content/index.html)
  per coverage row with that key: stardust/eds-schema/<slug>.json and the gate sidecar —
    row.source.metaJson, else the _meta.json beside row.source.migratedHtml
    (index.html → _meta.json, <name>.html → <name>._meta.json)
  shared: ${COVERAGE_DIR}/*.json, ${SHARED.join(', ')},
    stardust/rollout/units/<unit>.paths
Lock: ${LOCK_REL} (one JSON line: pid, host, ISO time, unit), created atomically and waited
  for up to --wait-s seconds (default ${DEFAULT_WAIT_S}, polled every ${POLL_MS} ms). A lock whose pid is not
  running on this host, or untouched for ${STALE_MS / 1000} s, is reaped (a lock another process just took is
  never removed). Held from staging to the last push; released on every exit.
Steps: git add -- <set>; nothing in the set differs from HEAD → exit 2 "nothing to commit" (with
  --push and the branch ahead of its upstream: push only, "nothing new; pushed"). Otherwise
  git commit -q -m <msg> -- <changed files of the set>: anything else staged stays staged and out
  of the commit; a failed commit (hook, identity) unstages the set. Default message
  "C-deliver unit <unit>: <p> pages, <f> files" (p = path lines, f = files committed).
  --push: git pull --rebase --autostash, then git push; on failure up to ${PUSH_RETRIES} retries, each after a
  backoff and a fresh pull. A rebase conflict is aborted (no rebase left in progress, the
  autostash comes back) and the local commit kept; an autostash that does not re-apply cleanly
  (git keeps it in the stash list) stops before the push.
  Refused before staging: a merge or rebase in progress, unmerged files in the index.
Output: exactly one status line on stdout, e.g.
  "unit-commit c1: committed 1a2b3c4 (5 files), pushed"
  git's own output is captured; a failing git step's last line goes to stderr (credentials redacted).
Writes: a git commit (and a push with --push); the lock file under stardust/.work/ while it runs.
Exit codes: 0 committed (and pushed with --push), or nothing new but pushed · 2 usage, not a git
  work tree, missing units/<unit>.paths, unreadable coverage, lock timeout, nothing to commit, a
  merge or rebase in progress or unmerged files, commit failure, no upstream, rebase conflict, an
  autostash that did not re-apply, push failure — nothing half-done (a commit that could not be
  pushed is kept locally and named).`;

export class UsageError extends Error {}

// ---- pure helpers (exported for tests) ---------------------------------------------------------
/** The path lines of a units/<unit>.paths file: trimmed, blank and `#` lines skipped. */
export const parsePaths = (text) => String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

/** The migrate sidecar beside a migrated HTML path (index.html → _meta.json; x.html → x._meta.json); null for a non-path. */
export function sidecarFor(migratedHtml) {
  if (typeof migratedHtml !== 'string') return null;
  const p = migratedHtml.trim().replace(/\\/g, '/');
  // an origin marker (`<origin>:<slug>`, rows built outside the migrated tree) has no slash and no sidecar
  if (!p.endsWith('.html') || !p.includes('/')) return null;
  const dir = posix.dirname(p);
  const leaf = posix.basename(p);
  const name = leaf === 'index.html' ? '_meta.json' : `${leaf.replace(/\.html$/, '')}._meta.json`;
  return dir === '.' ? name : `${dir}/${name}`;
}

/** The content documents a path key may live in. */
export const contentDocs = (key) => (key === '/' ? ['content/index.html'] : [`content${key}.html`, `content${key}/index.html`]);

/**
 * Every candidate file of a unit's stage set, before the exists / ignored filter. Pure.
 * rows = coverage pages rows; coverageFiles = the stardust/rollout/coverage/*.json files present.
 * Returns { files, notes } — notes name path lines skipped as unusable keys.
 */
export function stageCandidates({ unit, lines, rows = [], coverageFiles = [] }) {
  const files = []; const notes = [];
  for (const key of [...new Set(lines.map((l) => pathKey(l)))]) {
    if (key.split('/').some((s) => s === '..' || s === '.')) { notes.push(`path ${key} has a . or .. segment — skipped`); continue; }
    files.push(...contentDocs(key));
    for (const row of rows) {
      if (!row || typeof row !== 'object' || typeof row.path !== 'string' || pathKey(row.path) !== key) continue;
      if (typeof row.slug === 'string' && row.slug) files.push(`stardust/eds-schema/${row.slug}.json`);
      const src = row.source && typeof row.source === 'object' ? row.source : {};
      const side = typeof src.metaJson === 'string' && src.metaJson.trim() ? src.metaJson.trim() : sidecarFor(src.migratedHtml);
      if (side) files.push(side);
    }
  }
  files.push(...coverageFiles, ...SHARED, `stardust/rollout/units/${unit}.paths`);
  return { files, notes };
}

/** A candidate as a clean work-tree-relative posix path, or null when it is empty or leaves the tree. */
export function safeRel(p, cwd) {
  if (typeof p !== 'string' || !p.trim()) return null;
  let s = p.trim();
  if (isAbsolute(s)) {
    const real = (x) => { try { return realpathSync(x); } catch { return x; } };
    s = relative(real(cwd), real(s)).split(sep).join('/');
  }
  s = posix.normalize(s.replace(/\\/g, '/'));
  if (!s || s === '.' || s === '..' || s.startsWith('../') || posix.isAbsolute(s)) return null;
  return s;
}

/** The owner record of a lock file: JSON {pid, host, at, unit}, or a plain `pid host iso` line; null when unreadable. */
export function parseOwner(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const pidOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object') return { pid: pidOf(o.pid), host: o.host ? String(o.host) : null, at: o.at ? String(o.at) : null, unit: o.unit ? String(o.unit) : null };
  } catch { /* the plain form */ }
  const [pid, host, at] = s.split(/\s+/);
  return pidOf(pid) ? { pid: pidOf(pid), host: host || null, at: at || null, unit: null } : null;
}

/** Why a lock is stale (a string), or null while it must be respected. Pure: `alive(pid)` is injected. */
export function judgeLock({ owner, ageMs, host, alive }) {
  if (ageMs > STALE_MS) return `untouched for over ${STALE_MS / 1000} s`;
  if (owner && owner.pid && owner.host && owner.host === host && !alive(owner.pid)) return `pid ${owner.pid} is not running on ${host}`;
  return null;
}

export const describeOwner = (o) => (o ? `pid ${o.pid ?? '?'} on ${o.host ?? '?'}${o.at ? ` since ${o.at}` : ''}${o.unit ? ` (unit ${o.unit})` : ''}` : 'an owner that left no record');

const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
const redact = (s) => String(s || '').replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1***@');
const lastLine = (s) => redact(s).trim().split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';

// ---- the lock ----------------------------------------------------------------------------------
function readRaw(p, st) {
  try { return st.isDirectory() ? readFileSync(join(p, 'owner'), 'utf8') : readFileSync(p, 'utf8'); } catch { return ''; }
}

function inspectLock(lockAbs) {
  let st;
  try { st = statSync(lockAbs); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const raw = readRaw(lockAbs, st);
  return { raw, owner: parseOwner(raw), ino: st.ino, mtimeMs: st.mtimeMs };
}

// Rename the stale lock aside, then make sure the renamed file is the one judged stale. If another process
// took the lock between the look and the rename, put its lock back (link never overwrites) and keep it.
function reapLock(lockAbs, seen) {
  const aside = `${lockAbs}.reap-${process.pid}-${Date.now()}`;
  try { renameSync(lockAbs, aside); } catch (e) { if (e.code === 'ENOENT') return 'gone'; throw e; }
  let st = null;
  try { st = statSync(aside); } catch { return 'gone'; }
  if (st.ino === seen.ino && st.mtimeMs === seen.mtimeMs && readRaw(aside, st) === seen.raw) {
    rmSync(aside, { recursive: true, force: true });
    return 'reaped';
  }
  try { linkSync(aside, lockAbs); rmSync(aside, { force: true }); return 'restored'; } catch (e) {
    if (e.code !== 'EEXIST') {
      let free = false;
      try { lstatSync(lockAbs); } catch { free = true; }
      if (free) { try { renameSync(aside, lockAbs); return 'restored'; } catch { /* fall through */ } }
    }
    rmSync(aside, { recursive: true, force: true });
    return 'lost-race';
  }
}

/** Take the git lock: { ok: true, record } or { ok: false, owner } after waitMs. */
export function acquireGitLock(lockAbs, { unit, waitMs, onWait = () => {}, onReap = () => {} }) {
  mkdirSync(dirname(lockAbs), { recursive: true });
  const host = hostname();
  const deadline = Date.now() + waitMs;
  let told = false;
  for (;;) {
    const record = `${JSON.stringify({ pid: process.pid, host, at: new Date().toISOString(), unit })}\n`;
    let fd = null;
    try { fd = openSync(lockAbs, 'wx'); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (fd !== null) {
      try { writeSync(fd, record); closeSync(fd); } catch (e) {
        try { closeSync(fd); } catch { /* closed */ }
        rmSync(lockAbs, { force: true });
        throw e;
      }
      return { ok: true, record };
    }
    const seen = inspectLock(lockAbs);
    if (!seen) continue;
    const why = judgeLock({ owner: seen.owner, ageMs: Date.now() - seen.mtimeMs, host, alive: pidAlive });
    if (why) {
      const res = reapLock(lockAbs, seen);
      if (res === 'reaped') { onReap(seen.owner, why); continue; }
      if (res === 'gone') continue;
      // restored / lost the race: someone holds a live lock now — wait for it like any other
    }
    if (Date.now() >= deadline) return { ok: false, owner: seen.owner };
    if (!told) { told = true; onWait(seen.owner); }
    sleep(POLL_MS);
  }
}

// ---- git ---------------------------------------------------------------------------------------
const GIT_ENV = { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' };
function git(args, { input, retryLocks = false } = {}) {
  for (let i = 0; ; i += 1) {
    const r = spawnSync('git', args, { encoding: 'utf8', env: GIT_ENV, input, maxBuffer: 256 * 1024 * 1024 });
    if (r.error && r.error.code === 'ENOENT') throw new Error('git not found on PATH');
    const res = { code: r.status ?? -1, out: r.stdout || '', err: `${r.stderr || ''}${r.error ? r.error.message : ''}` };
    if (res.code !== 0 && retryLocks && i < GIT_LOCK_RETRIES && /index\.lock|cannot lock ref|unable to create '[^']*\.lock'/i.test(res.err)) { sleep(500); continue; }
    return res;
  }
}
const L = ['--literal-pathspecs'];
function inProgress() {
  const names = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];
  const r = git(['rev-parse', ...names.flatMap((n) => ['--git-path', n])]);
  if (r.code !== 0) return [];
  const paths = r.out.split('\n').map((l) => l.trim()).filter(Boolean);
  return names.filter((n, i) => paths[i] && existsSync(paths[i]));
}
const sha7 = () => { const r = git(['rev-parse', '--short=7', 'HEAD']); return r.code === 0 ? r.out.trim() : '???????'; };
const currentBranch = () => { const r = git(['symbolic-ref', '-q', '--short', 'HEAD']); return r.code === 0 && r.out.trim() ? r.out.trim() : 'HEAD (detached)'; };
const upstreamOf = () => { const r = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']); return r.code === 0 && r.out.trim() ? r.out.trim() : null; };

// pull --rebase --autostash, then push; up to PUSH_RETRIES retries. Returns { ok } or { fail, err }.
function pullAndPush(guard) {
  let err = '';
  for (let attempt = 0; attempt <= PUSH_RETRIES; attempt += 1) {
    if (attempt) sleep(BACKOFF_MS * attempt + Math.floor(Math.random() * 250));
    if (!guard()) return { fail: 'lost' };
    const pull = git(['pull', '--rebase', '--autostash', '-q']);
    if (inProgress().some((n) => n.startsWith('rebase-'))) {
      const abort = git(['rebase', '--abort']);
      return { fail: abort.code === 0 && !inProgress().some((n) => n.startsWith('rebase-')) ? 'conflict' : 'abort-failed', err: abort.code === 0 ? pull.err : abort.err };
    }
    if (/Applying autostash resulted in conflicts/i.test(pull.err)) return { fail: 'autostash', err: pull.err };
    if (pull.code !== 0) { err = pull.err; continue; }
    if (!guard()) return { fail: 'lost' };
    const push = git(['push', '-q']);
    if (push.code === 0) return { ok: true };
    err = push.err;
  }
  return { fail: 'push', err };
}

function pushOutcome(res, okLine) {
  if (res.ok) return [0, okLine];
  const sha = sha7();
  if (res.err) console.error(`unit-commit: git: ${lastLine(res.err)}`);
  if (res.fail === 'conflict') return [2, `rebase conflict: aborted; local commit ${sha} kept, not pushed`];
  if (res.fail === 'abort-failed') return [2, `rebase conflict: git rebase --abort failed — a rebase is still in progress; resolve it by hand; local commit ${sha} kept, not pushed`];
  if (res.fail === 'autostash') return [2, `rebased, but the autostash did not re-apply cleanly (kept in git stash list); local commit ${sha} kept, not pushed`];
  if (res.fail === 'lost') return [2, `lock ${LOCK_REL} was taken over by another process; local commit ${sha} kept, not pushed`];
  return [2, `push failed after ${PUSH_RETRIES} retries; local commit ${sha} kept`];
}

// ---- argv --------------------------------------------------------------------------------------
export function parseArgs(argv) {
  const opts = { unit: null, push: false, message: null, waitS: DEFAULT_WAIT_S };
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    // a value flag never swallows the next flag: `--message --push` is a forgotten value
    const need = () => {
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      if (argv[i + 1].startsWith('--')) throw new UsageError(`${a} needs a value (got ${argv[i + 1]}, which is a flag)`);
      i += 1; return argv[i];
    };
    if (a === '--push') opts.push = true;
    else if (a === '--message') { opts.message = need(); if (!opts.message.trim()) throw new UsageError('--message is empty'); }
    else if (a === '--wait-s') {
      const v = need();
      if (!/^\d+(\.\d+)?$/.test(v)) throw new UsageError(`--wait-s needs a number of seconds ≥ 0, got ${v}`);
      opts.waitS = Number(v);
    } else if (a.startsWith('-') && a !== '-') throw new UsageError(`unknown option ${a}`);
    else pos.push(a);
  }
  if (pos.length !== 1) throw new UsageError(`expected one <unit>, got ${pos.length}`);
  [opts.unit] = pos;
  if (!UNIT_RE.test(opts.unit)) throw new UsageError(`unit "${opts.unit}" must match ${UNIT_RE}`);
  return opts;
}

// ---- the run (returns [exitCode, status]) ------------------------------------------------------
function underLock(opts, lines, guard) {
  const { unit } = opts;
  const cwd = process.cwd();
  const busy = inProgress();
  if (busy.length) return [2, `a ${busy.join(' / ')} is in progress in this work tree — finish it first; nothing staged`];
  // unmerged entries (e.g. an autostash that did not re-apply): staging one would commit its conflict markers
  const um = git(['ls-files', '-u', '-z']);
  const unmerged = [...new Set(um.out.split('\0').filter(Boolean).map((l) => l.split('\t')[1]).filter(Boolean))].sort(byCodePoint);
  if (unmerged.length) return [2, `unmerged files in the index (${unmerged.slice(0, 3).join(', ')}${unmerged.length > 3 ? ', …' : ''}) — resolve them first; nothing staged`];

  let rows = [];
  if (existsSync(PAGES_REL)) {
    let doc;
    try { doc = JSON.parse(readFileSync(PAGES_REL, 'utf8')); } catch (e) { return [2, `${PAGES_REL} is not valid JSON (${e.message}); nothing staged`]; }
    rows = Array.isArray(doc) ? doc : doc && Array.isArray(doc.pages) ? doc.pages : null;
    if (!rows) return [2, `${PAGES_REL} has no pages[] — not a coverage pages file; nothing staged`];
  }
  const coverageFiles = existsSync(COVERAGE_DIR) && statSync(COVERAGE_DIR).isDirectory()
    ? readdirSync(COVERAGE_DIR).filter((f) => f.endsWith('.json')).sort(byCodePoint).map((f) => `${COVERAGE_DIR}/${f}`) : [];
  const { files, notes } = stageCandidates({ unit, lines, rows, coverageFiles });
  for (const n of notes) console.error(`unit-commit ${unit}: note: ${n}`);
  const present = [...new Set(files.map((f) => safeRel(f, cwd)).filter(Boolean))]
    .filter((f) => { try { return statSync(f).isFile(); } catch { return false; } });
  const docless = [...new Set(lines.map((l) => pathKey(l)))].filter((k) => !contentDocs(k).some((f) => present.includes(f)));
  if (docless.length) console.error(`unit-commit ${unit}: note: ${docless.length} path(s) without a content document: ${docless.slice(0, 5).join(', ')}${docless.length > 5 ? ', …' : ''}`);
  let set = present;
  if (set.length) {
    // check-ignore takes plain paths (it rejects pathspec magic, --literal-pathspecs included)
    const ig = git(['check-ignore', '-z', '--stdin'], { input: `${set.join('\0')}\0` });
    if (ig.code !== 0 && ig.code !== 1) { console.error(`unit-commit: git: ${lastLine(ig.err)}`); return [2, 'git check-ignore failed; nothing staged']; }
    const ignored = new Set(ig.code === 0 ? ig.out.split('\0').filter(Boolean) : []);
    set = set.filter((f) => !ignored.has(f));
  }
  set.sort(byCodePoint);

  let changed = [];
  if (set.length) {
    if (!guard()) return [2, `lock ${LOCK_REL} was taken over by another process; nothing staged`];
    const add = git([...L, 'add', '--', ...set], { retryLocks: true });
    if (add.code !== 0) { console.error(`unit-commit: git: ${lastLine(add.err)}`); return [2, 'git add failed; nothing committed']; }
    const diff = git([...L, 'diff', '--cached', '--relative', '--no-renames', '--name-only', '-z', '--', ...set]);
    if (diff.code !== 0) {
      git([...L, 'reset', '-q', '--', ...set], { retryLocks: true });
      console.error(`unit-commit: git: ${lastLine(diff.err)}`);
      return [2, 'git diff failed; the set was unstaged, nothing committed'];
    }
    changed = diff.out.split('\0').filter(Boolean).sort(byCodePoint);
  }

  if (!changed.length) {
    if (!opts.push) return [2, 'nothing to commit'];
    const up = upstreamOf();
    if (!up) return [2, `nothing to commit; no upstream for ${currentBranch()}`];
    const ahead = git(['rev-list', '--count', '@{u}..HEAD']);
    if (ahead.code !== 0 || !(Number(ahead.out.trim()) > 0)) return [2, `nothing to commit; ${currentBranch()} is not ahead of ${up}`];
    return pushOutcome(pullAndPush(guard), 'nothing new; pushed');
  }

  const message = opts.message ?? `C-deliver unit ${unit}: ${lines.length} pages, ${changed.length} files`;
  if (!guard()) {
    git([...L, 'reset', '-q', '--', ...set], { retryLocks: true });
    return [2, `lock ${LOCK_REL} was taken over by another process; the set was unstaged, nothing committed`];
  }
  const commit = git([...L, 'commit', '-q', '-m', message, '--', ...changed], { retryLocks: true });
  if (commit.code !== 0) {
    git([...L, 'reset', '-q', '--', ...set], { retryLocks: true });
    console.error(`unit-commit: git: ${lastLine(commit.err || commit.out)}`);
    return [2, 'commit failed; the set was unstaged, nothing committed'];
  }
  const sha = sha7();
  const done = `committed ${sha} (${changed.length} files)`;
  if (!opts.push) return [0, done];
  if (!upstreamOf()) return [2, `no upstream for ${currentBranch()}: committed ${sha}, not pushed`];
  return pushOutcome(pullAndPush(guard), `${done}, pushed`);
}

export function main(argv) {
  let printed = false;
  const emit = (unit, line) => { if (printed) return; printed = true; console.log(`unit-commit${unit ? ` ${unit}` : ''}: ${line}`); };
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  let opts;
  try { opts = parseArgs(argv); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    emit(null, `${e.message} — usage: unit-commit.mjs <unit> [--push] [--message <m>] [--wait-s ${DEFAULT_WAIT_S}] (--help)`);
    return 2;
  }
  const { unit } = opts;
  let release = () => {};
  try {
    const top = git(['rev-parse', '--is-inside-work-tree']);
    if (top.code !== 0 || top.out.trim() !== 'true') { emit(unit, 'not inside a git work tree — run from the project root; nothing staged'); return 2; }
    const pathsRel = `stardust/rollout/units/${unit}.paths`;
    let isFile = false;
    try { isFile = statSync(pathsRel).isFile(); } catch { /* missing */ }
    if (!isFile) { emit(unit, `no ${pathsRel} — write the unit's page list first; nothing staged`); return 2; }
    const lines = parsePaths(readFileSync(pathsRel, 'utf8'));

    const lockAbs = resolve(LOCK_REL);
    const got = acquireGitLock(lockAbs, {
      unit,
      waitMs: opts.waitS * 1000,
      onWait: (o) => console.error(`unit-commit ${unit}: waiting up to ${opts.waitS}s for ${LOCK_REL}, held by ${describeOwner(o)}`),
      onReap: (o, why) => console.error(`unit-commit ${unit}: reaped a stale ${LOCK_REL} (${describeOwner(o)}): ${why}`),
    });
    if (!got.ok) { emit(unit, `lock ${LOCK_REL} held by ${describeOwner(got.owner)}; waited ${opts.waitS}s — nothing staged`); return 2; }
    const own = () => { try { return readFileSync(lockAbs, 'utf8') === got.record; } catch { return false; } };
    let released = false;
    release = () => { if (released) return; released = true; try { if (own()) rmSync(lockAbs, { force: true }); } catch { /* gone */ } };
    process.once('exit', release);
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { release(); emit(unit, `interrupted by ${sig}; lock released`); process.exit(2); });
    // the holder's heartbeat: still ours → touch (a long push is not "untouched for 300 s") and go on
    const guard = () => { if (!own()) return false; try { const t = new Date(); utimesSync(lockAbs, t, t); } catch { /* best effort */ } return true; };
    const [code, line] = underLock(opts, lines, guard);
    emit(unit, line);
    return code;
  } catch (e) {
    emit(unit, `error: ${redact(e.message).split('\n')[0]}`);
    return 2;
  } finally {
    release();
  }
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) process.exit(main(process.argv.slice(2)));
