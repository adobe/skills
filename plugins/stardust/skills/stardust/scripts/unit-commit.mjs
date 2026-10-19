#!/usr/bin/env node
// skills/stardust/scripts/unit-commit.mjs — commit ONE rollout unit's delivered pages, what the unit
// wrote beside them and the shared rollout bookkeeping by explicit path (never `git add -A`), under
// one project-wide git lock.
//
// Why: commits happened only at a unit's end and coverage rows were written after the gate, so on a
// recorded hands-off run a lost container lost 20 published pages' bookkeeping. Parallel unit
// subagents in one work tree collided: `git add content` swept another unit's pages into the wrong
// commit, `pull --rebase` refused, pushes raced. This script commits a unit's set the moment it is
// delivered, holds the lock from staging to the last push, and commits by pathspec, so whatever
// another process staged stays staged and out of the commit. The set is everything a unit writes:
// on a recorded hands-off run six units left their reports, the foundation requests, the variance
// verdicts, state.json and migrate's progress.json uncommitted, and the lead added four commits.
//
//   node stardust/scripts/stardust/unit-commit.mjs <unit> [--code blocks/<name>]… [--also <path>]…
//                                                   [--push] [--no-sidecar-check] [--message <m>] [--wait-s 120]
//
// Sidecar before commit: before staging, every delivered page (a coverage row matched to the unit's .paths)
// must have its stardust/eds-schema/<slug>.json — the run refuses (exit 2, nothing staged) and names the exact
// section-schema.mjs command per missing page. --no-sidecar-check overrides and records the override in the
// commit message. On a recorded hands-off run subagent units left their sidecars unwritten and done-check
// found them missing at the very end.
//
// Run from the project root, inside its git work tree. The stage set — only files that exist and are
// not git-ignored (`git check-ignore`), deduped, sorted; committed by pathspec, so a hand `git add` of
// these paths is never needed (a staged-only file is committed by the next unit-commit run, and
// nothing outside the set is swept):
//   1. per unit: stardust/rollout/units/<unit>.paths, stardust/rollout/units/<unit>.md (its report),
//      stardust/deploy/ledger-<unit>.json (its deploy-batch ledger), and per template of the unit
//      (stardust/rollout/progress.json units.<unit>.templates; an archetype-<t> unit adds <t>) the
//      encoder map stardust/import/<t>/, recursively;
//   2. per line of stardust/rollout/units/<unit>.paths, key = deploy's pathKey (eds-path.mjs):
//      content/<key>.html and/or content/<key>/index.html (root `/`: content/index.html), and the
//      encoder's documents beside them, stardust/encoded/<key>.html and/or …/<key>/index.html;
//   3. per coverage row (stardust/rollout/coverage/pages.json) whose pathKey(row.path) is that key:
//      stardust/eds-schema/<slug>.json and its gate sidecar — row.source.metaJson when set, else the
//      migrate sidecar beside row.source.migratedHtml (index.html → _meta.json, <name>.html →
//      <name>._meta.json, same dir); row.source.migratedHtml and row.source.encodedHtml;
//      stardust/patches/<slug>.json; gate-all's JSON for the page,
//      stardust/replica/gates/all-<w>/<slug>/**/*.json and all-<w>/runs/<ts>-<slug>.json (an --only
//      run is named for its first slug; the images and <slug>/rounds.lock are never staged), and in
//      each all-<w> the unit's pages were gated in, a fix round's triage.json and triage.md. A source
//      path stays inside its root (metaJson, migratedHtml: stardust/migrated/; encodedHtml:
//      stardust/encoded/; an absolute one is taken from the project root) and the slug names one file
//      — a row naming content/, styles/ or blocks/header/ there is left out with one stderr note;
//   4. shared bookkeeping (SHARED, SHARED_JSON_DIRS): stardust/rollout/coverage/*.json,
//      stardust/migrate/encode/*.json, stardust/rollout/variance/*.json, stardust/rollout/progress.json,
//      stardust/rollout/rollout.json, stardust/rollout/foundation-requests.md, stardust/state.json,
//      stardust/migrate/progress.json, stardust/deploy/media-ledger.json, stardust/redirects.tsv,
//      stardust/eds-conversion-log.md;
//   5. per --code blocks/<name> (repeatable): that block directory's files, recursively — a cluster's
//      block code goes through the same lock (a commit outside it collides with the units' commits);
//      blocks/header and blocks/footer are the frozen foundation and refused. The Code-stage push
//      before the first preview is `unit-commit.mjs <unit> --code blocks/<name> --push`;
//   6. per --also <path> (repeatable): a file — or, outside stardust/, a directory's files recursively
//      — for anything else the unit wrote. Refused (exit 2, nothing staged, the rule named): an
//      absolute path, a `..` segment, a path whose real location is outside the work tree, `.git`,
//      the project root, content/ (pages go through the .paths file), blocks/ (--code), the frozen
//      foundation (styles/, fonts/, head.html, scripts/, blocks/header/, blocks/footer/), a missing
//      path, a directory under stardust/ (it would sweep other units' reports, ledgers, maps) — all
//      before the lock — and, under it before staging, any file but the unit's own in a namespace the
//      set manages per unit or per page (perUnitArea: units/, ledger-*.json, import/, encoded/,
//      migrated/, patches/, eds-schema/, a gate dir's page dirs and runs/).
// The lock is a file, stardust/.work/git.lock, created with open(…, 'wx') and holding one JSON line
// {pid, host, at, unit}. A waiter polls every 200 ms up to --wait-s. A lock whose pid is not running
// on this host (kill -0 → ESRCH), or untouched for 300 s (the holder touches it every 30 s and before
// every git step, so only a frozen holder goes stale), is reaped by renaming it aside and checking the
// renamed file is the very one judged stale (inode, mtime, content); a lock another process took in
// between is put back, never removed. A lock that is no longer the holder's own stops its run before
// the next stage, commit or push.
// The commit takes the set's changed files only (`git commit -- <files>`); a failed commit unstages
// the set. --push: `git fetch`; only when the upstream has commits HEAD lacks, `git pull --rebase
// --autostash` (so other processes' uncommitted and staged edits are not sent through a stash when
// nothing moved); then `git push` — up to 3 retries, each after a backoff and a fresh fetch. A rebase
// conflict is aborted (no rebase left in progress, the autostash comes back) and the local commit
// kept; an autostash that rebased but did not re-apply cleanly (git keeps it in the stash list, the
// work tree holds conflict markers) stops before the push. The status line names the commit as it
// was pushed (a rebase rewrites it). A merge or rebase in progress, or unmerged index entries, refuse
// the run before anything is staged — staging a file with conflict markers would commit them.
// Every git step is bounded (fetch, pull, push 60 s; local steps 300 s) and runs in its own process
// group: a timed-out step's group is ended and the step failed (a timed-out rebase is aborted). Every
// network step (fetch, pull, push, a retry's) and every backoff also runs for at most the time left
// until 170 s after the script started (the lock wait included); with none left it is not started and
// the run stops, the local commit kept and named, not pushed — so --push returns under 240 s (the
// bound and its arithmetic: the comment at NET_DEADLINE_MS).
// SIGINT / SIGTERM / SIGHUP are handled after the current git step (a terminal's Ctrl-C reaches this
// script, not the step): the run stops at the next check with its exit-2 line and releases the lock;
// a second signal ends the running git step. Exactly one status line on stdout in every outcome;
// git's chatter is captured (a failing step's last git line goes to stderr, URL credentials redacted).
// Exit codes: 0 committed (and pushed with --push), or nothing new but pushed · 2 everything else —
// usage (a frozen or malformed --code and a refused --also included), not a git work tree, missing
// .paths, --code directory or --also path, unreadable coverage, lock timeout, nothing to commit, a
// merge/rebase in progress or unmerged files, commit failure, no upstream, rebase conflict, an
// autostash that did not re-apply, push failure, the push deadline, a timed-out step, a signal,
// deploy's eds-path.mjs not found.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STARTED = Date.now();
// deploy's path contract, in both layouts: plugin tree (skills/stardust/scripts → ../../deploy/scripts)
// and project copy (stardust/scripts/stardust → ../deploy). Loaded by main, after --help: a project copy
// made before the deploy scripts are copied still answers --help.
const EDS_PATH = [join(HERE, '..', '..', 'deploy', 'scripts', 'eds-path.mjs'), join(HERE, '..', 'deploy', 'eds-path.mjs')];
async function loadPathKey() {
  const found = EDS_PATH.find((x) => existsSync(x));
  return found ? (await import(pathToFileURL(found).href)).pathKey : null;
}

export const UNIT_RE = /^[\w.-]+$/;
export const LOCK_REL = 'stardust/.work/git.lock';
export const STALE_MS = 300_000;
export const POLL_MS = 200;
export const DEFAULT_WAIT_S = 120;
export const PUSH_RETRIES = 3;
export const NET_TIMEOUT_MS = 60_000; // fetch, pull, push
export const LOCAL_TIMEOUT_MS = 300_000; // add, commit (hooks), reset, …
export const KILL_GRACE_MS = 5_000; // a timed-out step's process group: SIGTERM, then SIGKILL this much later
// The --push bound. The deadline counts from the script's start, the lock wait included, so it holds from
// the first git step too (only a --wait-s over 170 s lets the wait itself run longer — then no network
// step starts at all). Every network step and every backoff runs for netBudget() = min(its own limit, the
// time left until NET_DEADLINE_MS) and none starts with 0 left, so the last one's timer fires by 170 s;
// ending its process group takes ≤ KILL_GRACE_MS more: 170 s + 5 s = 175 s (worstPushSchedule()). What
// follows is local (a rev-list or rev-parse, a rebase --abort, the sha) with 240 − 175 = 65 s to spare:
// --push returns under 240 s, the 4-minute tool-call limit. (At 180 s with an uncapped 60 s step it was
// 180 + 60 + 5 = 245 s.) Local git steps keep their own LOCAL_TIMEOUT_MS: a hung commit hook is not cut.
export const NET_DEADLINE_MS = 170_000;
const HEARTBEAT_MS = 30_000;
const BACKOFF_MS = 750;
const JITTER_MS = 250; // a retry's backoff: BACKOFF_MS × attempt + up to this much at random
const GIT_LOCK_RETRIES = 20; // × 500 ms: another git command in the same work tree holding index.lock / a ref lock
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const PAGES_REL = 'stardust/rollout/coverage/pages.json';
const COVERAGE_DIR = 'stardust/rollout/coverage';
const PROGRESS_REL = 'stardust/rollout/progress.json';
// the shared bookkeeping a unit writes: these files, and every *.json directly in SHARED_JSON_DIRS
export const SHARED = [
  'stardust/deploy/media-ledger.json', 'stardust/eds-conversion-log.md', 'stardust/migrate/progress.json',
  'stardust/redirects.tsv', 'stardust/rollout/foundation-requests.md', PROGRESS_REL,
  'stardust/rollout/rollout.json', 'stardust/state.json',
];
export const SHARED_JSON_DIRS = [COVERAGE_DIR, 'stardust/migrate/encode', 'stardust/rollout/variance'];
const GATES_DIR = 'stardust/replica/gates';
// the roots a coverage row's source paths must stay in
export const MIGRATED_DIR = 'stardust/migrated';
export const ENCODED_DIR = 'stardust/encoded';
export const EDS_SCHEMA_DIR = 'stardust/eds-schema';
export const GATE_DIR_RE = /^all-\d+$/; // gate-all's published-stage out dirs, all-<w>
export const RUN_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(.+)\.json$/; // an --only run: runs/<ts>-<first slug>.json
export const CODE_RE = /^blocks\/[a-z0-9][a-z0-9-]*\/?$/;
const FROZEN_BLOCKS = ['blocks/header', 'blocks/footer'];
// --also: first path segments refused (compared case-insensitively) and the rule each error line names
const FROZEN_RULE = 'the frozen foundation (styles/, fonts/, head.html, scripts/, blocks/header/, blocks/footer/) — a unit never commits it';
const ALSO_REFUSED = {
  content: 'refused — a unit\'s pages go through stardust/rollout/units/<unit>.paths',
  blocks: 'refused — block code goes through --code blocks/<name>',
  styles: FROZEN_RULE,
  fonts: FROZEN_RULE,
  scripts: FROZEN_RULE,
  'head.html': FROZEN_RULE,
};
const SELF = fileURLToPath(import.meta.url);
const SHARED_HELP = [...SHARED_JSON_DIRS.map((d) => `${d}/*.json`), ...SHARED];

const HELP = `Usage:
  node stardust/scripts/stardust/unit-commit.mjs <unit> [--code blocks/<name>]… [--also <path>]…
                                                  [--push] [--no-sidecar-check] [--message <m>] [--wait-s ${DEFAULT_WAIT_S}]
  (run from the project root, inside its git work tree; <unit> matches ${UNIT_RE})

Commits ONE unit's delivered pages, what the unit wrote beside them and the shared rollout
bookkeeping — by explicit path, never git add -A — under a project-wide lock, so parallel units
in one work tree cannot sweep each other's files into a commit or race each other's pull and push.

Inputs:
  stardust/rollout/units/<unit>.paths  one web/DA path per line, blank and # lines skipped (required)
  ${PAGES_REL}  rows matched to those paths by deploy's pathKey
  ${PROGRESS_REL}  units.<unit>.templates — the unit's templates (optional)
The stage set (only files that exist and are not git-ignored; deduped, sorted). The script commits
it by pathspec: a hand git add of these paths is never needed (a staged-only file is committed by
the next unit-commit run, and nothing outside the set is swept).
  per unit: stardust/rollout/units/<unit>.paths, stardust/rollout/units/<unit>.md (its report),
    stardust/deploy/ledger-<unit>.json (its deploy-batch ledger); per template of the unit
    (progress.json units.<unit>.templates; an archetype-<t> unit adds <t>): the encoder map
    stardust/import/<t>/, recursively
  per path (key = pathKey): content/<key>.html and/or content/<key>/index.html (/: content/index.html);
    the encoder's stardust/encoded/<key>.html and/or stardust/encoded/<key>/index.html
  per coverage row with that key: stardust/eds-schema/<slug>.json and the gate sidecar —
    row.source.metaJson, else the _meta.json beside row.source.migratedHtml
    (index.html → _meta.json, <name>.html → <name>._meta.json); row.source.migratedHtml and
    row.source.encodedHtml; stardust/patches/<slug>.json; the published gate's JSON,
    ${GATES_DIR}/all-<w>/<slug>/**/*.json and all-<w>/runs/<ts>-<slug>.json, and in each
    all-<w> the unit's pages were gated in, a fix round's all-<w>/triage.json and triage.md
    (images and lock files never). A source path stays inside its root — metaJson and
    migratedHtml ${MIGRATED_DIR}/, encodedHtml ${ENCODED_DIR}/ (an absolute one taken from the
    project root) — and the slug names one file; anything else is left out, one stderr note per row.
  shared: ${SHARED_HELP.slice(0, 2).join(', ')},
    ${SHARED_HELP.slice(2, 5).join(', ')},
    ${SHARED_HELP.slice(5, 8).join(', ')},
    ${SHARED_HELP.slice(8).join(', ')}
  --code blocks/<name> (repeatable, ${CODE_RE}): that block directory's files,
    recursively — a cluster's block code commits under the same lock. blocks/header and
    blocks/footer (the frozen foundation) and anything that is not blocks/<kebab-name> → exit 2,
    nothing staged; a directory that does not exist → exit 2. The Code-stage push before the
    first preview: unit-commit.mjs <unit> --code blocks/<name> --push
  --also <path> (repeatable): anything else the unit wrote, relative to the project root — a file,
    or outside stardust/ a directory's files recursively (a git-ignored file is named on stderr,
    not staged). Refused → exit 2, nothing staged, the rule named: an absolute path, a .. segment,
    a path that resolves outside the work tree, .git, the project root, content/ (pages go through
    units/<unit>.paths), blocks/ (--code), the frozen foundation (styles/, fonts/, head.html,
    scripts/, blocks/header/, blocks/footer/), a directory under stardust/ (it would sweep other
    units' files — name the file), and in a namespace the set manages per unit or per page
    (stardust/rollout/units/, stardust/deploy/ledger-*.json, stardust/import/, ${ENCODED_DIR}/,
    ${MIGRATED_DIR}/, stardust/patches/, stardust/eds-schema/, all-<w>/<page>/ and runs/) any file
    but the unit's own; a path that does not exist → exit 2.
Lock: ${LOCK_REL} (one JSON line: pid, host, ISO time, unit), created atomically and waited
  for up to --wait-s seconds (default ${DEFAULT_WAIT_S}, polled every ${POLL_MS} ms). A lock whose pid is not
  running on this host, or untouched for ${STALE_MS / 1000} s (the holder touches it every ${HEARTBEAT_MS / 1000} s), is reaped
  (a lock another process just took is never removed). Held from staging to the last push;
  released on every exit.
Sidecar before commit: before staging, every delivered page (a coverage row matched to the unit's
  .paths with a one-name slug) must have its ${EDS_SCHEMA_DIR}/<slug>.json. A missing one → exit 2,
  nothing staged, the exact command on stderr:
    node stardust/scripts/deploy/section-schema.mjs <protoURL> --out ${EDS_SCHEMA_DIR}/<slug>.json
  --no-sidecar-check commits anyway and records the override in the commit message.
Steps: git add -- <set>; nothing in the set differs from HEAD → exit 2 "nothing to commit" (with
  --push and the branch ahead of its upstream: push only, "nothing new; pushed"). Otherwise
  git commit -q -m <msg> -- <changed files of the set>: anything else staged stays staged and out
  of the commit; a failed commit (hook, identity) unstages the set. Default message
  "C-deliver unit <unit>: <p> pages, <f> files" (p = path lines, f = files committed);
  a --no-sidecar-check that skipped a real gap appends "[--no-sidecar-check: <n> page(s) …]".
  --push: git fetch; git pull --rebase --autostash only when the upstream has commits HEAD lacks
  (nothing moved → no stash round trip for other processes' edits); then git push. On failure up
  to ${PUSH_RETRIES} retries, each after a backoff and a fresh fetch. A rebase conflict is aborted (no rebase
  left in progress, the autostash comes back) and the local commit kept; an autostash that does
  not re-apply cleanly (git keeps it in the stash list) stops before the push.
  Refused before staging: a merge or rebase in progress, unmerged files in the index.
Time limits: fetch, pull and push ${NET_TIMEOUT_MS / 1000} s each, local git steps ${LOCAL_TIMEOUT_MS / 1000} s; a step over its limit
  failed — its process group (git, hooks, transport) is ended; a timed-out rebase is aborted.
  Deadline: ${NET_DEADLINE_MS / 1000} s after the script started, the lock wait included. Every network step (fetch,
  pull, push, a retry's) and every backoff runs for at most min(its own limit, the time left until
  the deadline); with no time left it is not started → exit 2 "push deadline reached; local commit
  <sha7> kept, not pushed" (lock released).
  Bound with --push: the last network step's timer fires by ${NET_DEADLINE_MS / 1000} s, and ending a timed-out step's
  process group takes ≤ ${KILL_GRACE_MS / 1000} s more: ${NET_DEADLINE_MS / 1000} s + ${KILL_GRACE_MS / 1000} s = ${(NET_DEADLINE_MS + KILL_GRACE_MS) / 1000} s; the local steps after it (a rev-list
  or rev-parse, a rebase --abort, the sha) have the remaining ${(240_000 - NET_DEADLINE_MS - KILL_GRACE_MS) / 1000} s — --push returns under 240 s,
  the 4-minute tool-call limit. A --wait-s over ${NET_DEADLINE_MS / 1000} s can stretch only the lock wait (no network
  step starts after it); a hung local step (a commit hook) is bounded by its own ${LOCAL_TIMEOUT_MS / 1000} s.
Signals: SIGINT / SIGTERM / SIGHUP are handled after the current git step (each step runs in its
  own process group, so a terminal's Ctrl-C does not cut it short) — the run stops at the next
  check with its exit-2 line (the set unstaged, or the local commit kept and named) and releases
  the lock; a second signal ends the running git step.
Output: exactly one status line on stdout, e.g.
  "unit-commit c1: committed 1a2b3c4 (5 files), pushed" (the commit as pushed, after any rebase)
  git's own output is captured; a failing git step's last line goes to stderr (credentials redacted).
Writes: a git commit (and a push with --push); the lock file under stardust/.work/ while it runs.
Exit codes: 0 committed (and pushed with --push), or nothing new but pushed · 2 usage (a refused
  --code or --also included), not a git work tree, missing units/<unit>.paths, --code directory
  or --also path, unreadable coverage, a delivered page without its eds-schema sidecar (unless
  --no-sidecar-check), lock timeout,
  nothing to commit, a merge or rebase in progress or unmerged files, commit failure, no
  upstream, rebase conflict, an autostash that did not re-apply, push failure, the push deadline,
  a timed-out step, a signal, deploy's eds-path.mjs not found beside this script — nothing
  half-done (a commit that could not be pushed is kept locally and named).`;

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

/** A --code value as `blocks/<name>` (trailing slash dropped); throws UsageError for anything else or a frozen block. */
export function codeDir(value) {
  const v = String(value ?? '');
  if (!CODE_RE.test(v)) throw new UsageError(`--code ${v} must be blocks/<kebab-name> (${CODE_RE})`);
  const dir = v.replace(/\/$/, '');
  if (FROZEN_BLOCKS.includes(dir)) throw new UsageError(`--code ${dir} is the frozen foundation (blocks/header, blocks/footer) — a unit never commits it`);
  return dir;
}

/**
 * Why a clean project-relative path may not be an --also path (a string naming the rule), or null. Pure; the
 * segments compare case-insensitively (a case-insensitive file system maps Content/ onto content/).
 */
export function alsoRefusal(rel) {
  if (!rel || rel === '.') return 'the project root is refused — name a file or directory under it';
  const parts = rel.split('/').map((s) => s.toLowerCase());
  if (parts.includes('.git')) return '.git is refused';
  const rule = Object.hasOwn(ALSO_REFUSED, parts[0]) ? ALSO_REFUSED[parts[0]] : null;
  return rule ? `${parts[0] === 'head.html' ? 'head.html' : `${parts[0]}/`} is ${rule}` : null;
}

/** An --also value as a clean project-relative posix path (trailing slash dropped); throws UsageError naming the rule it breaks. */
export function alsoPath(value) {
  const raw = String(value ?? '');
  const v = raw.replace(/\\/g, '/');
  if (!v.trim()) throw new UsageError('--also needs a path');
  if (posix.isAbsolute(v) || isAbsolute(raw) || /^[a-z]:/i.test(v)) throw new UsageError(`--also ${raw}: an absolute path is refused — give it relative to the project root`);
  if (v.split('/').includes('..')) throw new UsageError(`--also ${raw}: a .. segment is refused — the path stays inside the work tree`);
  const rel = posix.normalize(v).replace(/\/+$/, '');
  const why = alsoRefusal(rel);
  if (why) throw new UsageError(`--also ${raw}: ${why}`);
  return rel;
}

/** Every file under a directory, recursively (posix paths, sorted); symlinked directories are not followed. */
export function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => byCodePoint(a.name, b.name))) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p); else out.push(p);
    }
  };
  walk(dir);
  return out;
}

/**
 * The timeout a network step (or a backoff sleep) gets: min(its own limit `stepMs`, the time left until
 * `limitMs` after the script started); 0 = no time left, the step is not started. Pure.
 */
export const netBudget = (startedMs, nowMs, stepMs, limitMs = NET_DEADLINE_MS) => Math.max(0, Math.min(stepMs, startedMs + limitMs - nowMs));

/**
 * The worst-case --push network schedule, in pullAndPush's order (per attempt: a backoff before a retry,
 * fetch, pull, push): every step runs its whole netBudget and every git step then needs KILL_GRACE_MS to
 * end its process group (an upper bound — a step that finishes or fails sooner leaves more time).
 * `firstMs` = when the first network step may start, ms after the script started. Pure.
 * Returns { steps: [{ step, attempt, startMs, ms }], endMs } — endMs when the last one has ended.
 */
export function worstPushSchedule(firstMs = 0, limitMs = NET_DEADLINE_MS) {
  const steps = [];
  let t = firstMs;
  for (let attempt = 0; attempt <= PUSH_RETRIES; attempt += 1) {
    for (const step of [...(attempt ? ['backoff'] : []), 'fetch', 'pull', 'push']) {
      const ms = netBudget(0, t, step === 'backoff' ? BACKOFF_MS * attempt + JITTER_MS : NET_TIMEOUT_MS, limitMs);
      if (!ms) { if (step === 'backoff') continue; return { steps, endMs: t }; }
      steps.push({ step, attempt, startMs: t, ms });
      t += ms + (step === 'backoff' ? 0 : KILL_GRACE_MS);
    }
  }
  return { steps, endMs: t };
}

/** The content documents a path key may live in. */
export const contentDocs = (key) => (key === '/' ? ['content/index.html'] : [`content${key}.html`, `content${key}/index.html`]);

/** The encoder's documents for a path key (encode.mjs: stardust/encoded/<da-path>.html, beside content/<da-path>.html). */
export const encodedDocs = (key) => contentDocs(key).map((f) => `stardust/encoded${f.slice('content'.length)}`);

// a slug or template that names one directory: no separator, not . or ..
const oneName = (s) => typeof s === 'string' && s !== '' && s !== '.' && s !== '..' && !/[/\\\0]/.test(s);
const htmlPath = (p) => typeof p === 'string' && p.trim().endsWith('.html') && p.includes('/');

/**
 * A coverage source path as a clean project-relative path when it lies under `dir`, else null. An absolute path
 * (inventory writes encodedHtml from the project path) is taken relative to `root`; without a root it is null.
 */
export function sourceUnder(p, dir, root = null) {
  if (typeof p !== 'string' || !p.trim()) return null;
  if (isAbsolute(p.trim()) && !root) return null;
  const rel = safeRel(p, root || '.');
  return rel && rel.startsWith(`${dir}/`) ? rel : null;
}

/**
 * Every candidate file of a unit's stage set, before the exists / ignored filter — deduped, sorted by code
 * point. Pure but for safeRel's realpath of an absolute source path.
 * rows = coverage pages rows; sharedJson = the *.json files present directly in SHARED_JSON_DIRS;
 * templates = the unit's templates (progress.json units.<unit>.templates; an archetype-<t> unit adds <t>);
 * gateDirs = the stardust/replica/gates/all-<w> dirs present; walk(dir) = the files under dir, recursively,
 * sorted ([] when absent); root = the project root an absolute source path is taken against;
 * pathKey = deploy's eds-path key.
 * A row's source paths stay inside their roots (metaJson and migratedHtml stardust/migrated/, encodedHtml
 * stardust/encoded/) and its slug names one file; what does not is left out, one note per row.
 * Returns { files, notes } — notes name path lines skipped as unusable keys and rows with paths left out.
 */
export function stageCandidates({ unit, lines, rows = [], sharedJson = [], templates = [], gateDirs = [], walk = () => [], root = null, pathKey }) {
  const files = []; const notes = []; const slugs = new Set();
  for (const key of [...new Set(lines.map((l) => pathKey(l)))]) {
    if (key.split('/').some((s) => s === '..' || s === '.')) { notes.push(`path ${key} has a . or .. segment — skipped`); continue; }
    files.push(...contentDocs(key), ...encodedDocs(key));
    for (const row of rows) {
      if (!row || typeof row !== 'object' || typeof row.path !== 'string' || pathKey(row.path) !== key) continue;
      const left = [];
      if (oneName(row.slug)) { files.push(`stardust/eds-schema/${row.slug}.json`); slugs.add(row.slug); } else if (typeof row.slug === 'string' && row.slug) left.push(`slug ${row.slug} (not one name)`);
      const src = row.source && typeof row.source === 'object' ? row.source : {};
      const meta = typeof src.metaJson === 'string' && src.metaJson.trim() ? src.metaJson.trim() : null;
      const sources = [
        [meta ? 'source.metaJson' : 'the sidecar', meta ?? sidecarFor(src.migratedHtml), MIGRATED_DIR],
        ['source.migratedHtml', htmlPath(src.migratedHtml) ? src.migratedHtml.trim() : null, MIGRATED_DIR],
        ['source.encodedHtml', htmlPath(src.encodedHtml) ? src.encodedHtml.trim() : null, ENCODED_DIR],
      ];
      for (const [field, p, dir] of sources) {
        if (!p) continue;
        const rel = sourceUnder(p, dir, root);
        if (rel) files.push(rel); else left.push(`${field} ${p} (not under ${dir}/)`);
      }
      if (left.length) notes.push(`coverage row ${typeof row.slug === 'string' && row.slug ? row.slug : '?'} (${row.path}): left out ${left.join(', ')}`);
    }
  }
  for (const slug of slugs) files.push(`stardust/patches/${slug}.json`);
  for (const d of gateDirs) {
    // gate-all's per-page files (JSON only: images stay untracked, <slug>/rounds.lock is a live lock) and the
    // unit's own --only runs
    const pages = [...slugs].filter((s) => s !== 'runs').flatMap((s) => walk(`${d}/${s}`));
    const runs = walk(`${d}/runs`).filter((f) => {
      const m = posix.dirname(f) === `${d}/runs` && RUN_RE.exec(posix.basename(f));
      return m && slugs.has(m[1]);
    });
    files.push(...pages.filter((f) => f.endsWith('.json')), ...runs);
    // a fix round's triage, <out>/triage.{json,md}: shared per gate dir, taken where the unit's pages were gated
    if (pages.length || runs.length) files.push(`${d}/triage.json`, `${d}/triage.md`);
  }
  files.push(`stardust/rollout/units/${unit}.paths`, `stardust/rollout/units/${unit}.md`, `stardust/deploy/ledger-${unit}.json`);
  for (const t of unitTemplates(unit, templates)) files.push(...walk(`stardust/import/${t}`));
  files.push(...sharedJson, ...SHARED);
  return { files: [...new Set(files)].sort(byCodePoint), notes };
}

/** The unit's templates: the recorded ones plus <t> of an archetype-<t> unit, each naming one directory; sorted. */
export function unitTemplates(unit, templates = []) {
  const arch = /^archetype-(.+)$/.exec(unit);
  return [...new Set([...templates, ...(arch ? [arch[1]] : [])])].filter(oneName).sort(byCodePoint);
}

// The exact command that writes a page's sidecar (handoff-contract § sidecars_missing; the project-copy layout,
// as this script runs from the project root). <protoURL> is the page's render source.
export const sidecarCommand = (slug) => `node stardust/scripts/deploy/section-schema.mjs <protoURL> --out ${EDS_SCHEMA_DIR}/${slug}.json`;

/**
 * The slugs of the unit's delivered pages — coverage rows matched to its .paths by pathKey, with a one-name
 * slug (the rows whose stardust/eds-schema/<slug>.json the stage set carries) — whose sidecar does not exist;
 * deduped, sorted by code point. Pure: `exists(rel)` is injected. unit-commit refuses to commit while this is
 * non-empty unless --no-sidecar-check (then the override is recorded in the commit message).
 */
export function missingSidecars({ lines = [], rows = [], pathKey, exists = () => false, dir = EDS_SCHEMA_DIR }) {
  const keys = new Set(lines.map((l) => pathKey(l)));
  const slugs = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.path !== 'string' || !keys.has(pathKey(row.path))) continue;
    if (oneName(row.slug)) slugs.add(row.slug);
  }
  return [...slugs].filter((s) => !exists(`${dir}/${s}.json`)).sort(byCodePoint);
}

// the namespaces the default set manages per unit or per page: an --also file there must be the unit's own
const PER_UNIT_DIRS = ['stardust/rollout/units', 'stardust/import', ENCODED_DIR, MIGRATED_DIR, 'stardust/patches', 'stardust/eds-schema'];

/** The per-unit namespace a clean project-relative path falls in (named for an error line), or null. Pure. */
export function perUnitArea(rel) {
  const l = String(rel).toLowerCase();
  const dir = PER_UNIT_DIRS.find((d) => l.startsWith(`${d}/`));
  if (dir) return `${dir}/`;
  if (/^stardust\/deploy\/ledger-[^/]*\.json$/.test(l)) return 'stardust/deploy/ledger-<unit>.json';
  const g = /^(stardust\/replica\/gates\/all-\d+)\/[^/]+\//.exec(l);
  return g ? `${g[1]}/<page>/ and runs/` : null;
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
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
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

/** Take the git lock: { ok: true, record }, { ok: false, owner } after waitMs, or { ok: false, stopped } when `stopped()` says so. */
export async function acquireGitLock(lockAbs, { unit, waitMs, onWait = () => {}, onReap = () => {}, stopped = () => null }) {
  mkdirSync(dirname(lockAbs), { recursive: true });
  const host = hostname();
  const deadline = Date.now() + waitMs;
  let told = false;
  for (;;) {
    const why = stopped();
    if (why) return { ok: false, stopped: why };
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
    const stale = judgeLock({ owner: seen.owner, ageMs: Date.now() - seen.mtimeMs, host, alive: pidAlive });
    if (stale) {
      const res = reapLock(lockAbs, seen);
      if (res === 'reaped') { onReap(seen.owner, stale); continue; }
      if (res === 'gone') continue;
      // restored / lost the race: someone holds a live lock now — wait for it like any other
    }
    if (Date.now() >= deadline) return { ok: false, owner: seen.owner };
    if (!told) { told = true; onWait(seen.owner); }
    await sleep(POLL_MS);
  }
}

// ---- git ---------------------------------------------------------------------------------------
const GIT_ENV = { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' };
const RUN = { child: null, signal: null }; // the running git step; the first signal received
const LOCKED_RE = /index\.lock|cannot lock ref|unable to create '[^']*\.lock'/i;

// One git step, bounded: past timeoutMs its whole process group (git, its hooks, its transport) gets
// SIGTERM, SIGKILL KILL_GRACE_MS later, and the step counts as failed. Each step runs in its own
// process group, so a terminal's Ctrl-C reaches this script only — the step finishes unless a second
// signal stops it.
const GROUPS = process.platform !== 'win32';
function gitOnce(args, input, timeoutMs) {
  return new Promise((done, fail) => {
    const child = spawn('git', args, { env: GIT_ENV, stdio: ['pipe', 'pipe', 'pipe'], detached: GROUPS });
    let out = ''; let err = ''; let killedBy = null; let settled = false;
    const signalTree = (sig) => { try { if (GROUPS) process.kill(-child.pid, sig); else child.kill(sig); } catch { /* already gone */ } };
    const stopStep = (why) => {
      if (killedBy) return;
      killedBy = why;
      signalTree('SIGTERM');
      setTimeout(() => { if (child.exitCode === null && child.signalCode === null) signalTree('SIGKILL'); }, KILL_GRACE_MS).unref();
    };
    RUN.child = { stop: stopStep };
    child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
    child.stdin.on('error', () => { /* git exited before reading its input */ });
    const timer = setTimeout(() => stopStep('timeout'), timeoutMs);
    const settle = () => { settled = true; clearTimeout(timer); if (RUN.child && RUN.child.stop === stopStep) RUN.child = null; };
    // a stopped step: do not wait for a straggler that still holds the output pipes
    child.on('exit', () => { if (killedBy) { child.stdout.destroy(); child.stderr.destroy(); } });
    child.on('error', (e) => {
      if (settled) return; settle();
      if (e.code === 'ENOENT') fail(new Error('git not found on PATH'));
      else done({ code: -1, out, err: `${err}${e.message}\n`, killed: false });
    });
    child.on('close', (code, signal) => {
      if (settled) return; settle();
      const step = args.find((a) => !a.startsWith('-')) || 'step';
      const why = killedBy === 'timeout' ? `git ${step} timed out after ${timeoutMs / 1000} s\n` : killedBy ? `git ${step} stopped by a second signal\n` : signal ? `git ${step} ended by ${signal}\n` : '';
      done({ code: code ?? -1, out, err: `${err}${why}`, killed: !!killedBy || !!signal, timedOut: killedBy === 'timeout' });
    });
    child.stdin.end(input ?? '');
  });
}

async function git(args, { input, retryLocks = false, timeoutMs = LOCAL_TIMEOUT_MS } = {}) {
  for (let i = 0; ; i += 1) {
    const res = await gitOnce(args, input, timeoutMs);
    if (res.code !== 0 && !res.killed && retryLocks && i < GIT_LOCK_RETRIES && LOCKED_RE.test(res.err)) { await sleep(500); continue; }
    return res;
  }
}
const L = ['--literal-pathspecs'];
async function inProgress() {
  const names = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];
  const r = await git(['rev-parse', ...names.flatMap((n) => ['--git-path', n])]);
  if (r.code !== 0) return [];
  const paths = r.out.split('\n').map((l) => l.trim()).filter(Boolean);
  return names.filter((n, i) => paths[i] && existsSync(paths[i]));
}
const rebasing = async () => (await inProgress()).some((n) => n.startsWith('rebase-'));
const sha7 = async () => { const r = await git(['rev-parse', '--short=7', 'HEAD']); return r.code === 0 ? r.out.trim() : '???????'; };
const currentBranch = async () => { const r = await git(['symbolic-ref', '-q', '--short', 'HEAD']); return r.code === 0 && r.out.trim() ? r.out.trim() : 'HEAD (detached)'; };
const upstreamOf = async () => { const r = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']); return r.code === 0 && r.out.trim() ? r.out.trim() : null; };

// fetch; rebase (pull --rebase --autostash) only when the upstream moved; push. Up to PUSH_RETRIES
// retries. Returns { ok, sha } (sha = the commit as pushed) or { fail, err, why }.
async function pullAndPush(stop) {
  let err = '';
  const left = (stepMs) => netBudget(STARTED, Date.now(), stepMs); // 0 → the step is not started
  for (let attempt = 0; attempt <= PUSH_RETRIES; attempt += 1) {
    if (attempt) { const pause = left(BACKOFF_MS * attempt + Math.floor(Math.random() * JITTER_MS)); if (pause) await sleep(pause); }
    let why = stop();
    if (why) return { fail: 'stopped', why };
    let ms = left(NET_TIMEOUT_MS);
    if (!ms) return { fail: 'deadline', err };
    const fetch = await git(['fetch', '-q'], { timeoutMs: ms });
    if (fetch.code !== 0) { err = fetch.err; continue; }
    const behind = await git(['rev-list', '--count', 'HEAD..@{u}']);
    if (behind.code !== 0) { err = behind.err; continue; }
    if (Number(behind.out.trim()) > 0) {
      why = stop();
      if (why) return { fail: 'stopped', why };
      ms = left(NET_TIMEOUT_MS);
      if (!ms) return { fail: 'deadline', err };
      const pull = await git(['pull', '--rebase', '--autostash', '-q'], { timeoutMs: ms });
      if (await rebasing()) {
        const abort = await git(['rebase', '--abort']);
        if (abort.code !== 0 || await rebasing()) return { fail: 'abort-failed', err: abort.err || pull.err };
        if (pull.killed) { err = pull.err; continue; } // a timed-out or stopped rebase: aborted, then the next attempt
        return { fail: 'conflict', err: pull.err };
      }
      if (/Applying autostash resulted in conflicts/i.test(pull.err)) return { fail: 'autostash', err: pull.err };
      if (pull.code !== 0) { err = pull.err; continue; }
    }
    why = stop();
    if (why) return { fail: 'stopped', why };
    const sha = await sha7(); // the commit as it is pushed — after a rebase it is not the one committed
    ms = left(NET_TIMEOUT_MS);
    if (!ms) return { fail: 'deadline', err };
    const push = await git(['push', '-q'], { timeoutMs: ms });
    if (push.code === 0) return { ok: true, sha };
    err = push.err;
  }
  return { fail: 'push', err };
}

async function pushOutcome(res, okLine) {
  if (res.ok) return [0, okLine(res.sha)];
  const sha = await sha7();
  if (res.err) console.error(`unit-commit: git: ${lastLine(res.err)}`);
  if (res.fail === 'conflict') return [2, `rebase conflict: aborted; local commit ${sha} kept, not pushed`];
  if (res.fail === 'abort-failed') return [2, `rebase conflict: git rebase --abort failed — a rebase is still in progress; resolve it by hand; local commit ${sha} kept, not pushed`];
  if (res.fail === 'autostash') return [2, `rebased, but the autostash did not re-apply cleanly (kept in git stash list); local commit ${sha} kept, not pushed`];
  if (res.fail === 'stopped') return [2, `${res.why}; local commit ${sha} kept, not pushed`];
  if (res.fail === 'deadline') return [2, `push deadline reached; local commit ${sha} kept, not pushed`];
  return [2, `push failed after ${PUSH_RETRIES} retries; local commit ${sha} kept`];
}

// ---- argv --------------------------------------------------------------------------------------
export function parseArgs(argv) {
  const opts = { unit: null, push: false, message: null, waitS: DEFAULT_WAIT_S, code: [], also: [], alsoReal: new Map(), noSidecarCheck: false };
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
    else if (a === '--no-sidecar-check') opts.noSidecarCheck = true;
    else if (a === '--message') { opts.message = need(); if (!opts.message.trim()) throw new UsageError('--message is empty'); }
    else if (a === '--code') { const d = codeDir(need()); if (!opts.code.includes(d)) opts.code.push(d); } else if (a === '--also') {
      const p = alsoPath(need());
      if (!opts.also.includes(p)) opts.also.push(p);
    } else if (a === '--wait-s') {
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
async function underLock(opts, lines, stop, pathKey) {
  const { unit } = opts;
  const cwd = process.cwd();
  const busy = await inProgress();
  if (busy.length) return [2, `a ${busy.join(' / ')} is in progress in this work tree — finish it first; nothing staged`];
  // unmerged entries (e.g. an autostash that did not re-apply): staging one would commit its conflict markers
  const um = await git(['ls-files', '-u', '-z']);
  const unmerged = [...new Set(um.out.split('\0').filter(Boolean).map((l) => l.split('\t')[1]).filter(Boolean))].sort(byCodePoint);
  if (unmerged.length) return [2, `unmerged files in the index (${unmerged.slice(0, 3).join(', ')}${unmerged.length > 3 ? ', …' : ''}) — resolve them first; nothing staged`];

  let rows = [];
  if (existsSync(PAGES_REL)) {
    let doc;
    try { doc = JSON.parse(readFileSync(PAGES_REL, 'utf8')); } catch (e) { return [2, `${PAGES_REL} is not valid JSON (${e.message}); nothing staged`]; }
    rows = Array.isArray(doc) ? doc : doc && Array.isArray(doc.pages) ? doc.pages : null;
    if (!rows) return [2, `${PAGES_REL} has no pages[] — not a coverage pages file; nothing staged`];
  }
  const isDir = (d) => { try { return lstatSync(d).isDirectory(); } catch { return false; } };
  const jsonIn = (d) => {
    try { if (!statSync(d).isDirectory()) return []; } catch { return []; }
    return readdirSync(d).filter((f) => f.endsWith('.json')).sort(byCodePoint).map((f) => `${d}/${f}`);
  };
  // a nested repository's .git is never walked into
  const walk = (d) => (isDir(d) ? filesUnder(d).filter((f) => !f.split('/').some((s) => s.toLowerCase() === '.git')) : []);
  let templates = [];
  if (existsSync(PROGRESS_REL)) {
    try {
      const doc = JSON.parse(readFileSync(PROGRESS_REL, 'utf8'));
      const rec = doc && doc.units && typeof doc.units === 'object' && Object.hasOwn(doc.units, unit) ? doc.units[unit] : null;
      if (rec && Array.isArray(rec.templates)) templates = rec.templates.filter((t) => typeof t === 'string');
    } catch (e) {
      console.error(`unit-commit ${unit}: note: ${PROGRESS_REL} is not valid JSON (${e.message}) — the unit's templates are unknown, their stardust/import/<template>/ maps not staged (--also adds one)`);
    }
  }
  const gateDirs = isDir(GATES_DIR) ? readdirSync(GATES_DIR).filter((n) => GATE_DIR_RE.test(n)).sort(byCodePoint).map((n) => `${GATES_DIR}/${n}`) : [];
  const sharedJson = SHARED_JSON_DIRS.flatMap(jsonIn);
  const { files, notes } = stageCandidates({ unit, lines, rows, sharedJson, templates, gateDirs, walk, root: cwd, pathKey });
  for (const n of notes) console.error(`unit-commit ${unit}: note: ${n}`);
  // Sidecar before commit: every delivered page needs its stardust/eds-schema/<slug>.json. On a recorded
  // hands-off run the subagent units left theirs unwritten and done-check found sidecars_missing at the very
  // end. Refuse (nothing staged) and name the exact section-schema.mjs command per page, unless
  // --no-sidecar-check (then the override is recorded in the commit message, below).
  const miss = missingSidecars({ lines, rows, pathKey, exists: (rel) => { try { return statSync(rel).isFile(); } catch { return false; } } });
  if (miss.length && !opts.noSidecarCheck) {
    console.error(`unit-commit ${unit}: ${miss.length} delivered page(s) have no ${EDS_SCHEMA_DIR}/<slug>.json sidecar — write each before commit:`);
    for (const slug of miss) console.error(`  ${sidecarCommand(slug)}`);
    return [2, `${miss.length} page(s) without their ${EDS_SCHEMA_DIR}/<slug>.json sidecar (${miss.slice(0, 5).join(', ')}${miss.length > 5 ? ', …' : ''}) — write it with the section-schema.mjs command on stderr, or pass --no-sidecar-check to commit anyway (recorded in the commit message); nothing staged`];
  }
  // an --also path inside a namespace the default set manages per unit or per page must be this unit's own
  // file (already in its set): another unit's report, ledger, map or page files are never swept in
  const own = new Set(files.map((f) => safeRel(f, cwd)).filter(Boolean));
  for (const p of opts.also) {
    for (const rel of new Set([p, (opts.alsoReal && opts.alsoReal.get(p)) || p])) {
      const area = perUnitArea(rel);
      if (area && !own.has(rel)) return [2, `--also ${p}: not this unit's own file — ${area} is managed per unit (the unit's own files there are in its set already); nothing staged`];
    }
  }
  for (const d of opts.code) files.push(...filesUnder(d));
  const alsoFiles = new Set(opts.also.flatMap((p) => (isDir(p) ? walk(p) : [p])));
  files.push(...alsoFiles);
  const present = [...new Set(files.map((f) => safeRel(f, cwd)).filter(Boolean))]
    .filter((f) => { try { return statSync(f).isFile(); } catch { return false; } });
  const docless = [...new Set(lines.map((l) => pathKey(l)))].filter((k) => !contentDocs(k).some((f) => present.includes(f)));
  if (docless.length) console.error(`unit-commit ${unit}: note: ${docless.length} path(s) without a content document: ${docless.slice(0, 5).join(', ')}${docless.length > 5 ? ', …' : ''}`);
  let set = present;
  if (set.length) {
    // check-ignore takes plain paths (it rejects pathspec magic, --literal-pathspecs included)
    const ig = await git(['check-ignore', '-z', '--stdin'], { input: `${set.join('\0')}\0` });
    if (ig.code !== 0 && ig.code !== 1) { console.error(`unit-commit: git: ${lastLine(ig.err)}`); return [2, 'git check-ignore failed; nothing staged']; }
    const ignored = new Set(ig.code === 0 ? ig.out.split('\0').filter(Boolean) : []);
    const alsoIgnored = [...ignored].filter((f) => alsoFiles.has(f)).sort(byCodePoint);
    if (alsoIgnored.length) console.error(`unit-commit ${unit}: note: --also: ${alsoIgnored.length} git-ignored file(s) not staged: ${alsoIgnored.slice(0, 5).join(', ')}${alsoIgnored.length > 5 ? ', …' : ''}`);
    set = set.filter((f) => !ignored.has(f));
  }
  set.sort(byCodePoint);

  let changed = [];
  if (set.length) {
    const why = stop();
    if (why) return [2, `${why}; nothing staged`];
    const add = await git([...L, 'add', '--', ...set], { retryLocks: true });
    if (add.code !== 0) {
      console.error(`unit-commit: git: ${lastLine(add.err)}`);
      return [2, 'git add failed; nothing committed'];
    }
    const diff = await git([...L, 'diff', '--cached', '--relative', '--no-renames', '--name-only', '-z', '--', ...set]);
    if (diff.code !== 0) {
      await git([...L, 'reset', '-q', '--', ...set], { retryLocks: true });
      console.error(`unit-commit: git: ${lastLine(diff.err)}`);
      return [2, 'git diff failed; the set was unstaged, nothing committed'];
    }
    changed = diff.out.split('\0').filter(Boolean).sort(byCodePoint);
  }

  if (!changed.length) {
    if (!opts.push) return [2, 'nothing to commit'];
    const up = await upstreamOf();
    if (!up) return [2, `nothing to commit; no upstream for ${await currentBranch()}`];
    const ahead = await git(['rev-list', '--count', '@{u}..HEAD']);
    if (ahead.code !== 0 || !(Number(ahead.out.trim()) > 0)) return [2, `nothing to commit; ${await currentBranch()} is not ahead of ${up}`];
    return pushOutcome(await pullAndPush(stop), () => 'nothing new; pushed');
  }

  // --no-sidecar-check that skipped a real gap is recorded in the commit message (default or explicit), so the
  // override is always auditable in the history.
  const override = miss.length && opts.noSidecarCheck ? ` [--no-sidecar-check: ${miss.length} page(s) without an eds-schema sidecar: ${miss.slice(0, 5).join(', ')}${miss.length > 5 ? ', …' : ''}]` : '';
  const message = (opts.message ?? `C-deliver unit ${unit}: ${lines.length} pages, ${changed.length} files`) + override;
  const why = stop();
  if (why) {
    await git([...L, 'reset', '-q', '--', ...set], { retryLocks: true });
    return [2, `${why}; the set was unstaged, nothing committed`];
  }
  const commit = await git([...L, 'commit', '-q', '-m', message, '--', ...changed], { retryLocks: true });
  if (commit.code !== 0) {
    await git([...L, 'reset', '-q', '--', ...set], { retryLocks: true });
    console.error(`unit-commit: git: ${lastLine(commit.err || commit.out)}`);
    return [2, 'commit failed; the set was unstaged, nothing committed'];
  }
  if (!opts.push) return [0, `committed ${await sha7()} (${changed.length} files)`];
  if (!(await upstreamOf())) return [2, `no upstream for ${await currentBranch()}: committed ${await sha7()}, not pushed`];
  return pushOutcome(await pullAndPush(stop), (sha) => `committed ${sha} (${changed.length} files), pushed`);
}

export async function main(argv) {
  let printed = false;
  const emit = (unit, line) => { if (printed) return; printed = true; console.log(`unit-commit${unit ? ` ${unit}` : ''}: ${line}`); };
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  let opts;
  try { opts = parseArgs(argv); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    emit(null, `${e.message} — usage: unit-commit.mjs <unit> [--code blocks/<name>]… [--also <path>]… [--push] [--no-sidecar-check] [--message <m>] [--wait-s ${DEFAULT_WAIT_S}] (--help)`);
    return 2;
  }
  const { unit } = opts;
  let pathKey;
  try { pathKey = await loadPathKey(); } catch (e) { pathKey = null; console.error(`unit-commit: ${redact(e.message).split('\n')[0]}`); }
  if (typeof pathKey !== 'function') { emit(unit, `deploy's eds-path.mjs not found beside this script (${EDS_PATH.map((x) => relative(process.cwd(), x) || '.').join(' or ')}) — copy the deploy scripts first; nothing staged`); return 2; }
  // a signal is handled after the current git step (every step is bounded); a second one ends that step
  const onSignal = (sig) => {
    if (!RUN.signal) { RUN.signal = sig; console.error(`unit-commit ${unit}: ${sig} received — stopping after the current git step`); } else if (RUN.child) RUN.child.stop('signal');
  };
  for (const s of SIGNALS) process.on(s, onSignal);
  let release = () => {};
  try {
    const top = await git(['rev-parse', '--is-inside-work-tree']);
    if (top.code !== 0 || top.out.trim() !== 'true') { emit(unit, 'not inside a git work tree — run from the project root; nothing staged'); return 2; }
    const pathsRel = `stardust/rollout/units/${unit}.paths`;
    let isFile = false;
    try { isFile = statSync(pathsRel).isFile(); } catch { /* missing */ }
    if (!isFile) { emit(unit, `no ${pathsRel} — write the unit's page list first; nothing staged`); return 2; }
    const lines = parsePaths(readFileSync(pathsRel, 'utf8'));
    for (const d of opts.code) {
      let isDir = false;
      try { isDir = lstatSync(d).isDirectory(); } catch { /* missing */ }
      if (!isDir) { emit(unit, `--code ${d}: no such directory — nothing staged`); return 2; }
    }
    // --also: it exists, and where it really lives (symlinks resolved) passes the same rules
    const root = opts.also.length ? realpathSync(process.cwd()) : null;
    for (const p of opts.also) {
      try { lstatSync(p); } catch { emit(unit, `--also ${p}: no such file or directory — nothing staged`); return 2; }
      let real = null;
      try { real = relative(root, realpathSync(p)).split(sep).join('/'); } catch { /* a dangling link */ }
      if (real === null) { emit(unit, `--also ${p}: no such file or directory (a link to nothing) — nothing staged`); return 2; }
      if (real === '..' || real.startsWith('../') || isAbsolute(real)) { emit(unit, `--also ${p}: resolves outside the work tree — nothing staged`); return 2; }
      const why = alsoRefusal(real);
      if (why) { emit(unit, `--also ${p}: resolves to ${real || '.'} — ${why}; nothing staged`); return 2; }
      // under stardust/ a directory holds other units' files (reports, ledgers, maps, gate rows): files only
      let dir = false;
      try { dir = statSync(p).isDirectory(); } catch { /* checked above */ }
      if (dir && [p, real].some((r) => r.toLowerCase() === 'stardust' || r.toLowerCase().startsWith('stardust/'))) {
        emit(unit, `--also ${p}: a directory under stardust/ would sweep other units' files — name the file; nothing staged`);
        return 2;
      }
      opts.alsoReal.set(p, real);
    }

    const lockAbs = resolve(LOCK_REL);
    const got = await acquireGitLock(lockAbs, {
      unit,
      waitMs: opts.waitS * 1000,
      onWait: (o) => console.error(`unit-commit ${unit}: waiting up to ${opts.waitS}s for ${LOCK_REL}, held by ${describeOwner(o)}`),
      onReap: (o, why) => console.error(`unit-commit ${unit}: reaped a stale ${LOCK_REL} (${describeOwner(o)}): ${why}`),
      stopped: () => (RUN.signal ? `interrupted by ${RUN.signal}` : null),
    });
    if (got.stopped) { emit(unit, `${got.stopped} while waiting for ${LOCK_REL}; nothing staged`); return 2; }
    if (!got.ok) { emit(unit, `lock ${LOCK_REL} held by ${describeOwner(got.owner)}; waited ${opts.waitS}s — nothing staged`); return 2; }
    const own = () => { try { return readFileSync(lockAbs, 'utf8') === got.record; } catch { return false; } };
    const touch = () => { try { const t = new Date(); utimesSync(lockAbs, t, t); } catch { /* best effort */ } };
    // the holder's heartbeat: a live holder never looks "untouched for 300 s", however long a git step runs
    const beat = setInterval(() => { if (own()) touch(); }, HEARTBEAT_MS);
    beat.unref();
    let released = false;
    release = () => { if (released) return; released = true; clearInterval(beat); try { if (own()) rmSync(lockAbs, { force: true }); } catch { /* gone */ } };
    process.once('exit', release);
    // before every git step that changes something: no signal received, and the lock is still ours
    const stop = () => {
      if (RUN.signal) return `interrupted by ${RUN.signal}`;
      if (!own()) return `lock ${LOCK_REL} was taken over by another process`;
      touch();
      return null;
    };
    const [code, line] = await underLock(opts, lines, stop, pathKey);
    emit(unit, RUN.signal && !line.includes('interrupted') ? `${line} (${RUN.signal} received during the last git step)` : line);
    return code;
  } catch (e) {
    emit(unit, `error: ${redact(e.message).split('\n')[0]}`);
    return 2;
  } finally {
    release();
    for (const s of SIGNALS) process.off(s, onSignal);
  }
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) process.exit(await main(process.argv.slice(2)));
