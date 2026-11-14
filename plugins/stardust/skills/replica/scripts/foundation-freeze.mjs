#!/usr/bin/env node
/**
 * skills/replica/scripts/foundation-freeze.mjs
 *
 * Mechanical freeze of the delivery foundation for rollout Phase C (`C-deliver`). The main
 * agent freezes the foundation once, at the end of unit C0 — `styles/`, fonts, `head.html`,
 * the header and footer blocks, `scripts/` — and every cluster subagent then builds on a base
 * that cannot move under it. `check` proves that nothing under the frozen set changed: in a
 * recorded run the main agent changed one foundation value and added one body-class rule
 * AFTER its cluster subagents had spawned, and paid two coordination messages plus 23 minutes
 * of rework in one cluster. A finding against the foundation is one appended line in
 * `stardust/rollout/foundation-requests.md`, applied once at C-final — never an edit while a
 * wave runs (`reference/handoff-contract.md` § 3, Fan-out discipline).
 *
 * Usage:
 *   node stardust/scripts/replica/foundation-freeze.mjs freeze [--root <dir>]
 *        [--out stardust/rollout/foundation-freeze.json] [--paths a,b,…]
 *   node stardust/scripts/replica/foundation-freeze.mjs check [--root <dir>]
 *        [--manifest stardust/rollout/foundation-freeze.json]
 *
 *   freeze   hash every file under the frozen set — default `styles/ fonts/ blocks/header/
 *            blocks/footer/ head.html scripts/`, keeping the entries that exist under --root;
 *            an explicit --paths entry (root-relative, comma-separated) must exist — and write
 *            the manifest, sorted by path:
 *            { "frozenAt": <ISO>, "root": <--root>, "paths": [...], "files": { <path>: <sha256> } }
 *            Prints `frozen N files → <out>`.
 *   check    recompute over the manifest's `paths`. Exit 0 and `foundation unchanged (N files)`
 *            when every recorded file exists with the same hash and no new file appeared under
 *            a frozen directory; otherwise one line per `changed <path>` / `missing <path>` /
 *            `added <path>`, then `foundation changed: c changed, m missing, a added`, exit 1.
 *            Revert the file (`git checkout -- <path>`) or turn the edit into a request line.
 *   --root   the project root the frozen paths are relative to (default `.`); --out and
 *            --manifest are resolved from the working directory like every other flag.
 *
 * Directories are walked recursively with lstat — a symlink is never followed: it is recorded as
 * `"symlink:<target>"` (its link text, not the target's hash) and compared as such, so a re-pointed
 * link reads `changed` and a link to a directory can never pull that tree in or loop (ELOOP).
 * `node_modules` and dot-entries (`.env`, `.DS_Store`, `.cache/`) are skipped, so `.env` is never
 * read. The manifest holds hashes only — never a file's contents — and is written through a temp
 * file + rename, so a crash mid-write leaves the previous manifest intact.
 * Exit codes: 0 ok · 1 check found a change · 2 usage OR a filesystem error while hashing
 * (EACCES, ENOENT on a path that vanished mid-walk, ELOOP …; one line on stderr naming the path)
 * — exit 1 always means "changed", never a crash. --help / -h prints this usage and touches no file.
 */

/* eslint-disable no-restricted-syntax, no-continue */
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_OUT = 'stardust/rollout/foundation-freeze.json';
export const DEFAULT_PATHS = [
  'styles/', 'fonts/', 'blocks/header/', 'blocks/footer/', 'head.html', 'scripts/',
];
const SKIP_DIRS = new Set(['node_modules']);
const FLAGS = { freeze: ['--root', '--out', '--paths'], check: ['--root', '--manifest'] };
const SELF = fileURLToPath(import.meta.url);

class UsageError extends Error {}
const usage = (msg) => { throw new UsageError(`foundation-freeze: ${msg} (see --help)`); };
const posix = (p) => p.split(sep).join('/');
const byPath = (a, b) => (a < b ? -1 : Number(a > b));

// The usage header above, verbatim — one source of truth for the flags.
export function help() {
  const m = readFileSync(SELF, 'utf8').match(/\/\*\*([\s\S]*?)\*\//);
  return m ? m[1].split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim() : SELF;
}

export const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
// A symlink's manifest value: its link text, never the target's contents (the link is what the
// foundation froze; a re-pointed link is a change, a dangling one is still the same link).
export const symlinkValue = (file) => `symlink:${readlinkSync(file)}`;
// lstat, or null when the path is not there (a frozen entry that does not exist contributes nothing).
function lstatOrNull(p) {
  try { return lstatSync(p); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; }
}

// Every entry under `dir`, recursively — { <root-relative POSIX path>: <sha256 | symlink:<target>> } in
// name order. lstat, never stat: a symlink is recorded, not followed. Dot-entries and node_modules are
// skipped: `.env` is never read, `.DS_Store` is never frozen.
export function walk(root, dir, out = {}) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) out[posix(relative(root, full))] = symlinkValue(full);
    else if (st.isDirectory()) walk(root, full, out);
    else if (st.isFile()) out[posix(relative(root, full))] = sha256(full);
  }
  return out;
}

// { <relative path>: <sha256 | symlink:<target>> } over the frozen entries (files, directories or
// symlinks) that exist under root, sorted by path. An entry that does not exist contributes nothing.
export function snapshot(root, paths) {
  const files = {};
  for (const p of paths) {
    const full = join(root, p).replace(/[\\/]+$/, ''); // `fonts/` must lstat the entry itself, not follow a symlinked fonts
    const st = lstatOrNull(full);
    if (!st) continue;
    const rel = posix(relative(root, full));
    if (st.isSymbolicLink()) files[rel] = symlinkValue(full);
    else if (st.isDirectory()) Object.assign(files, walk(root, full));
    else if (st.isFile()) files[rel] = sha256(full);
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => byPath(a, b)));
}

// manifest.files vs a fresh snapshot: recorded files that moved or vanished, files that appeared.
export function compare(manifest, current) {
  const changed = []; const missing = []; const added = [];
  for (const [p, hash] of Object.entries(manifest.files)) {
    if (!(p in current)) missing.push(p);
    else if (current[p] !== hash) changed.push(p);
  }
  for (const p of Object.keys(current)) if (!(p in manifest.files)) added.push(p);
  const sorted = (l) => l.sort(byPath);
  return { changed: sorted(changed), missing: sorted(missing), added: sorted(added) };
}

// `freeze`/`check` + its flags. Every flag takes one value; the other command's flag is an error.
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd) usage('command required: freeze | check');
  if (!FLAGS[cmd]) usage(`unknown command ${cmd}`);
  const opts = { cmd, root: '.', out: DEFAULT_OUT, manifest: DEFAULT_OUT, paths: null };
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]; const v = rest[i + 1];
    if (!FLAGS[cmd].includes(flag)) usage(`unknown argument for ${cmd}: ${flag}`);
    if (v === undefined || v.startsWith('--')) usage(`${flag} needs a value`);
    opts[flag.slice(2)] = v;
  }
  return opts;
}

// Root-relative frozen entries: strip a leading `./`; never absolute, never climbing out of root.
function frozenEntries(root, spec) {
  const list = spec.split(',').map((p) => p.trim()).filter(Boolean);
  if (!list.length) usage('--paths lists no entry');
  return list.map((p) => {
    const rel = posix(normalize(p)).replace(/^\.\/+/, '');
    const outside = isAbsolute(p) || rel === '..' || rel.startsWith('../');
    if (outside) usage(`--paths entry is not under --root: ${p}`);
    if (!existsSync(join(root, rel))) usage(`--paths entry not found under ${posix(root)}: ${p}`);
    return rel;
  });
}

const rootDir = (root) => {
  const abs = resolve(root);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) usage(`--root is not a directory: ${root}`);
  return abs;
};

export function freeze({ root, out, paths }) {
  const rootAbs = rootDir(root);
  const list = paths
    ? frozenEntries(rootAbs, paths)
    : DEFAULT_PATHS.filter((p) => existsSync(join(rootAbs, p)));
  const files = snapshot(rootAbs, list);
  const manifest = { frozenAt: new Date().toISOString(), root, paths: list, files };
  mkdirSync(dirname(resolve(out)), { recursive: true });
  const tmp = `${out}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(tmp, out);
  console.log(`frozen ${Object.keys(files).length} files → ${out}`);
  return 0;
}

export function readManifest(file) {
  if (!existsSync(file)) usage(`manifest not found: ${file} — run \`freeze\` first`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    usage(`manifest is not JSON: ${file}`);
  }
  const ok = manifest && Array.isArray(manifest.paths)
    && manifest.files && typeof manifest.files === 'object';
  if (!ok) usage(`not a foundation-freeze manifest (needs paths[] and files{}): ${file}`);
  return manifest;
}

export function check({ root, manifest: file }) {
  const manifest = readManifest(file);
  const { changed, missing, added } = compare(manifest, snapshot(rootDir(root), manifest.paths));
  if (!changed.length && !missing.length && !added.length) {
    console.log(`foundation unchanged (${Object.keys(manifest.files).length} files)`);
    return 0;
  }
  for (const p of changed) console.log(`changed ${p}`);
  for (const p of missing) console.log(`missing ${p}`);
  for (const p of added) console.log(`added ${p}`);
  const [c, m, a] = [changed.length, missing.length, added.length];
  console.log(`foundation changed: ${c} changed, ${m} missing, ${a} added`);
  return 1;
}

export function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(help()); return 0; }
  try {
    const opts = parseArgs(argv);
    return opts.cmd === 'freeze' ? freeze(opts) : check(opts);
  } catch (e) {
    if (e instanceof UsageError) { console.error(e.message); return 2; }
    // A filesystem error while hashing (EACCES, ENOENT on a path that vanished mid-walk, ELOOP, …) is
    // not a foundation change: name the path, exit 2, so exit 1 keeps meaning "changed".
    if (e && typeof e.code === 'string') { console.error(`foundation-freeze: ${e.code}${e.path ? ` ${e.path}` : ''}: ${e.message}`); return 2; }
    throw e;
  }
}

let isMain = false;
try {
  isMain = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === SELF;
} catch { /* not run as a script */ }
if (isMain) process.exit(main(process.argv.slice(2)));
