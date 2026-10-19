#!/usr/bin/env node
/**
 * skills/replica/scripts/run-bg.mjs
 *
 * Run an instrument in the background and wait for it in bounded slices, so
 * that no single agent step blocks without a bound and no step returns an
 * instrument's whole output into the agent's context.
 *
 * Why: in a hands-off replica session (2026-09-18, 26-page site, 1440+360)
 * one gate batch was launched as three parallel shell steps — each
 * `sleep 5|10|15;` then two gate rounds and a content-diff — and the next
 * model call came 15 minutes later. That agent's prompt cache lived five
 * minutes from the start of the last call, so that call re-wrote the whole
 * 513k-token context at the cache-write price: $6.30 for one silent gap, more
 * than the gate rounds it waited for. The rule that falls out: an instrument
 * may run as long as it needs, but the STEP that waits for it must be bounded
 * and must return a verdict summary — the full output belongs in a log file
 * the agent reads by `log --grep`. The bound is five minutes by default and
 * 25 at most (wait, below); where the cache lives five minutes, pass --max 240.
 *
 * Usage:
 *   node run-bg.mjs start --name <job> [--kind job|server] [--timeout <s>] [--slots <n>] [--lock|--no-lock] -- <cmd> [args…]
 *   node run-bg.mjs wait   [--max <s> | --until <ISO>] [--all] [--tail <n>] [--grep <re>] [<job>…]
 *   node run-bg.mjs status [--all] [--tail <n>] [--grep <re>] [<job>…]
 *   node run-bg.mjs stop   <job>… | --servers [--all]
 *   node run-bg.mjs log    <job> [--tail <n>] [--grep <re>]
 *   node run-bg.mjs clean  [--all]
 *   (every form: [--dir <d>], default stardust/.work/replica/bg, env RUN_BG_DIR)
 *   A value flag (--name --kind --dir --timeout --slots --max --until --stall --tail --grep) followed by
 *   nothing or by another --flag is a usage error (exit 125) naming the flag —
 *   never a silently swallowed value. --timeout is a start flag: on wait or
 *   status it is a usage error (exit 125) naming --max, never silently ignored.
 *   --until is a wait flag: elsewhere, with --max, or not an ISO-8601 instant
 *   with an offset or Z, a usage error (exit 125). --kind is a start flag and
 *   --servers a stop flag: elsewhere a usage error (exit 125).
 *
 * start  returns at once. The job runs detached under run-capped.mjs
 *        (default --timeout 900 s, a server's 3600 s — a background job without a
 *        deadline is the hang class run-capped exists for; 0 disables) in its own process
 *        group, stdout+stderr in <dir>/<job>.log, state in <dir>/<job>.json.
 *        The deadline (from launch) is exported to the command as
 *        RUN_BG_DEADLINE_SEC (seconds; with 0 an inherited value stays) — gate-all
 *        refuses a roster it cannot finish in it. A gate-all.mjs job (an argv token,
 *        or a word of a `sh -c` string) started without --timeout gets
 *        max(900, 25 s × pages × widths): gate-all's roster estimate (rosterEstimate
 *        of the sibling gate-all.mjs, imported only for such a job), summed over its
 *        invocations, logged in one `run-bg:` line on start's stdout — a recorded
 *        99-page roster at one width needed 2152 s and was killed at 900 s. An
 *        explicit --timeout is never changed; every other job keeps 900 s (a
 *        server 3600 s).
 *        --slots (default 3; env RUN_BG_SLOTS, else STARDUST_BROWSER_SLOTS) is a
 *        soft concurrency cap: a job waits, first come first served, until fewer
 *        than that many jobs are running (servers count for nothing — Servers,
 *        below). Both sides of the number: each capture
 *        is a Chromium and one `gate.sh --full` round holds up to SIX of them at
 *        its peak (content-diff, visual-diff, chrome-parity, clip-probe,
 *        content-presence and unit-geometry run in parallel), so the cap bounds
 *        the Chromiums at six per slot; yet at 3 slots a recorded hands-off
 *        fan-out (several subagents and the main agent on one pool) still queued
 *        84 of its 272 jobs for more than 10 s (90th percentile 78 s, longest
 *        210 s) with no memory pressure. So 3 is the default; RUN_BG_SLOTS lowers
 *        it on a small machine. On a large one raise STARDUST_BROWSER_BUDGET —
 *        STARDUST_BROWSER_SLOTS follows it (below). STARDUST_BROWSER_SLOTS is the
 *        machine's concurrent browser jobs, and this default while RUN_BG_SLOTS
 *        is unset: browser jobs are bounded by it too, so RUN_BG_SLOTS above it
 *        adds no browser jobs. Start the jobs all at once and let the slots pace
 *        them — no `sleep N;` staggering.
 *        Two budgets: --slots paces THIS project's jobs (one run-bg dir); the
 *        machine's slots bound browser jobs across projects. Before it launches
 *        a browser instrument (an argv token naming one of BROWSER_SCRIPTS —
 *        gate.sh, gate-all.mjs, stitch-shot.mjs, the diff probes …; --lock
 *        forces, --no-lock skips and implies --kind server) the job takes a machine-wide slot from
 *        browser-lock.mjs (`../stardust/` beside a project copy, else the
 *        plugin's `skills/stardust/scripts/`): one slot file per job under
 *        ~/.stardust/locks/browser/ (env STARDUST_BROWSER_LOCK_DIR), at most
 *        STARDUST_BROWSER_SLOTS (default 3; 0 = off) at once, released when the
 *        job ends. While it waits the job stays queued (later jobs of its dir
 *        queue behind it) — without a limit, like this dir's own queue: a
 *        holder is a whole job (deadline --timeout, 900 s), longer than
 *        browser-lock's 600 s per-process wait, and the job's own deadline only
 *        starts at launch. STARDUST_BROWSER_WAIT (seconds), when set, bounds the
 *        wait: no slot within it ends the job with exit 124 — no verdict, the
 *        command never ran. The command and its
 *        children run inside the job's slot (env STARDUST_BROWSER_SLOTS=0,
 *        STARDUST_BROWSER_SLOT=<slot file>) and STARDUST_BROWSERS_PER_SLOT =
 *        max(1, floor(STARDUST_BROWSER_BUDGET (default 3) /
 *        STARDUST_BROWSER_SLOTS)): the contract's 3 browsers = budget 3 across
 *        all jobs; a larger machine raises STARDUST_BROWSER_BUDGET. Unset or
 *        blank, STARDUST_BROWSER_SLOTS is derived from a positive budget B
 *        (derivedBrowserSlots, once per run-bg call; the job logs one `run-bg:`
 *        line naming it when it takes its slot): 3 when B is 3 or 6, below 2
 *        max(1, floor(B)), else 2 — 3 → 3 × 1, 4 → 2 × 2, 5 → 2 × 2, 6 → 3 × 2
 *        (a fixed 3 slots left one browser of a budget of 4 idle); set, it
 *        wins (0 = off included). A budget below the slots cannot be held (one
 *        browser per slot is the floor): the job logs one `run-bg:` line saying
 *        so — set STARDUST_BROWSER_SLOTS to the budget to hold it. Without
 *        browser-lock.mjs the job runs unlocked after one log line saying so.
 * wait   polls until the selected jobs have ended — the named ones (a server
 *        too: it ends only when stopped or at its deadline); bare, the
 *        caller's own (Owner, below): those unfinished when the wait began, if
 *        none its latest batch (jobs ended within 10 min of its newest); --all:
 *        every owner's (every job unfinished when the wait began; if none, every
 *        job on disk); bare and --all leave servers out — or the bound passes: --max seconds (default 300) or
 *        --until an ISO-8601 instant with an offset or Z (a past one = one
 *        pass), both clamped to MAX_CEILING_SEC (1500 s = 25 minutes) from now;
 *        a --max over WAIT_NOTICE_SEC (600) adds one notice line on stderr. Rule:
 *        wait in steps of at most five minutes, lead and subagents alike — `run-bg.mjs wait` for jobs, `progress.mjs wait` for units; a `sleep` is never a wait.
 *        Why: in recorded hands-off runs the lead polled delegated units with
 *        foreground waits of 9–23 minutes (one 93-minute session held 15, 99
 *        minutes in all), and an ended job or unit waited for the current wait
 *        to end; with a one-hour cache a five-minute poll costs about three
 *        cents, so a longer wait buys nothing and costs up to twenty minutes per
 *        unit. A ceiling stays because in another run a single tool call waited
 *        57 minutes without a word to its runner. The agent's shell tool kills a
 *        call at its timeout (about two minutes where the call declares none):
 *        declare one longer than the wait (--max 300 → e.g. 360 s). Then it
 *        prints a first line naming the selection and its count
 *        (`run-bg: wait — yours (owner 4242), unfinished: 2 job(s); 3 other
 *        job(s) not shown — --all`: the jobs --all would add; `; 1 server(s)
 *        not waited for — status lists them`: the selection's servers queued or running), then
 *        one line per job and, for ended jobs, its verdict lines: log lines
 *        matching --grep (default: the gate instruments' verdict vocabulary),
 *        else the last --tail (8) lines.
 *        Exit 0 = every selected job ended; 75 = some still queued/running —
 *        run `wait` again as your NEXT step; 77 = the runner's wake file grew —
 *        a background agent finished: act on it, then wait again. Never loop on
 *        it inside one command; that recreates the blocked step this tool removes.
 *        Wake: the runner appends a line to WAKE_FILE (stardust/.labs/wake, from
 *        the cwd; absent = nothing) whenever a background agent finishes; every
 *        poll compares its size with the size at the start (after the pause and
 *        the jobs' end, before the bound), and growth ends the wait with
 *        `wake: <its last line>` before the report (also before an exit 0's).
 *        Pause: the runner writes $STARDUST_PAUSE_FILE (JSON {at, reason}; a
 *        relative path from the cwd, the project root) when it wants the
 *        session to stop — it alone writes, edits or deletes it. Unset or empty
 *        = no check. While the file exists wait ends at once — checked before
 *        the first poll and on every poll — with exit 76 and the one-pass
 *        report, preceded by `run-bg: paused — <path> present (reason: <r>, at
 *        <at>) — jobs keep running; finish the iteration, record it and return`
 *        (a file that is not such JSON still counts: reason `unreadable`). No
 *        job is signalled.
 * status one pass of the same report (the same selection), without waiting;
 *        the pause line first while the pause file exists (exit unchanged).
 *        Servers follow the jobs under a `servers:` heading (Servers, below) —
 *        a named server there too; with no server, the report is the jobs'
 *        alone.
 * stop   <job>… (either kind) or --servers (the caller's own running servers;
 *        --servers --all every owner's): SIGTERM to the wrapper (run-capped
 *        forwards it to the instrument's process group) and to the instrument's
 *        group, then after a 5 s grace SIGKILL to every member left in either
 *        group, pass after pass, until both are empty — a child that ignores
 *        SIGTERM outlives a parent that obeys it — the files kept. Then the
 *        state records the end with the deadline's no-verdict marker: endedAt,
 *        exit 124, timedOut, plus stopped and stoppedAt (status/wait say
 *        `stopped`, not deadline) — whatever the command exited with: a stopped
 *        job is no verdict, like a deadline; unless it recorded its own end
 *        before the signal. One line per job; a job not running is one line
 *        saying so, exit 0. An unknown name is exit 2 with nothing signalled; a
 *        process that survives SIGKILL, exit 1 (its state unchanged).
 * log    a bounded view of one job's log: the last --tail lines (default
 *        40) or the --grep matches (at most 200).
 * clean  deletes ended and lost jobs' files (a running server's stay, like a
 *        running job's — `stop` ends one); --all also stops queued/running
 *        jobs: SIGTERM to the wrapper (run-capped forwards it to the
 *        instrument's process group and escalates to SIGKILL after 3 s), then
 *        after a 4 s grace SIGKILL to every member left in the wrapper's process
 *        group and the instrument's (the same passes as stop), and the files go
 *        only once nothing of the job is left alive. A
 *        lost job (wrapper gone) whose instrument still runs is stopped the same
 *        way through the recorded childPid. Nothing is ever signalled unless its
 *        identity matches (below).
 *
 * Owner: start records the caller in the job state as ownerPid — RUN_BG_OWNER
 * when set (non-empty, stored as given), else the nearest ancestor of run-bg
 * (from its parent pid) whose command is not a shell or wrapper (sh bash zsh
 * dash ksh mksh ash fish tcsh csh env nohup timeout nice; a login shell's `-`
 * stripped): the agent process behind the tool call's shell, the same whether
 * that shell exec'd node or not; the parent pid itself where no process table
 * answers. The owner is a process: where agents share one (in-process
 * subagents), a fan-out subagent names its jobs (`wait <job>…`) or prefixes
 * each of its run-bg calls with RUN_BG_OWNER=<unit>. A
 * bare wait/status selects the jobs whose ownerPid is the caller's; a state
 * without one (older runs) is nobody's — reached by name or --all. Why: in a
 * recorded hands-off run a bare wait in one agent blocked on every other
 * agent's jobs, and --timeout on wait was silently ignored.
 *
 * Servers: start records the kind as runKind — `job` (default; a state without
 * one, from an older run, is a job) or `server`, a process that
 * runs until stopped (a static file server, a dev server). --no-lock implies
 * --kind server unless --kind job is given (explicit wins: an instrument run
 * without the browser slot); start says so in one line, and in another when a
 * server's command names a browser instrument. A server takes no slot: it never
 * waits for --slots, running servers do not count toward a job's --slots, and
 * it never takes the machine-wide browser slot (lock off; --lock with it is a
 * usage error). Deadline: --timeout, else 3600 s (gate-all's estimate sizes
 * jobs only). A bare or --all wait/status leaves servers out of its selection;
 * status lists them after the jobs under `servers: <n> of yours|of all
 * owners|named` — bare: the caller's queued or running (or lost with their
 * command still running) or ended within the last 10 min; --all: every server
 * state on disk; named: those — one line each by name: state and pid, age,
 * deadline, command. Why: in a recorded hands-off run a 26-second measure
 * queued 615 s behind a static file server, and a bare wait blocked 600 s on
 * the unit's own servers (deadline 3600 s) while its gates had ended seven
 * minutes earlier.
 *
 * Signals: every signal goes only to a pid that a fresh look at that pid, taken
 * right before it (never the report passes' cached snapshot), still shows alive
 * with the identity recorded (below) — for a member of a job's process group,
 * found by a census of the group, its start time and group.
 *
 * Liveness: a job's state records the wrapper pid AND its process start time
 * (`ps -o lstart`, the same on macOS and procps Linux) — a bare pid names a
 * recycled process after a reboot or a busy day, and EPERM answers for a
 * process that is not ours. A job counts as alive only when the pid exists, is
 * not a zombie, and its start time is the recorded one (state files from before
 * the identity was recorded fall back to the command line containing
 * `run-bg.mjs __run … --name <job>`). Anything else is `lost`: it blocks no
 * FIFO slot, never refuses its name to a new `start`, and is never signalled.
 * After spawn the wrapper is the state file's only writer while it lives
 * (the starter writes it once before spawn; `stop` writes the end only once
 * the wrapper is gone; the wrapper's first act is to write its own pid + start
 * time — a state younger than 15 s without a pid is still spawning). When the
 * wrapper launches the instrument it records childPid + childStart, found by
 * `ps` as its own child (run-capped's API does not expose the pid); where `ps`
 * is unavailable (and no /proc) they stay null and `clean --all` cannot reach
 * an orphaned instrument — the wrapper's own group is still killed.
 *
 * Per-job exit codes are the instrument's (gate.sh: 0 PASS, 2 FAIL, 3 bot
 * challenge, 4 identity, 1 error); 124 = deadline, or no machine-wide browser
 * slot within a set STARDUST_BROWSER_WAIT — no verdict, re-run; also 124 (with
 * stopped) = ended by `stop` — no verdict, like a deadline.
 *
 * Also importable: start(), wait(), status(), stop(), pickNames(), startKind(), mayLaunch(), isServer(), serverLine(), pauseState(), pauseLine(), callerOwner(), alive(), phase(), settled(), isBrowserJob(), lockWaitS(), browsersPerSlot(), derivedBrowserSlots(), gateAllInvocations(), gateAllTimeout(), stallNotices(), BROWSER_SCRIPTS, report helpers — see the tests.
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEADLINE_EXIT, runCapped } from './run-capped.mjs';

export const DEFAULT_DIR = 'stardust/.work/replica/bg';
export const DEFAULT_TIMEOUT_SEC = 900;
// A server (--kind server) runs until stopped: no slot, out of a bare wait, this deadline unless --timeout — the value the
// recorded hands-off runs gave their prototype and dev servers.
export const KINDS = ['job', 'server'];
export const SERVER_TIMEOUT_SEC = 3600;
// stop: SIGTERM, then SIGKILL every process left in the job's groups after this grace.
const STOP_GRACE_MS = 5000;
// After the grace: SIGKILL passes (100 ms apart) until a job's process groups are empty; members left after them survived.
const KILL_PASSES = 10;
// Each capture is a Chromium and a `gate.sh --full` round holds up to six at its peak, so the cap bounds the Chromiums at
// six per slot — yet at 3 slots a recorded hands-off fan-out still queued 84 of 272 jobs for more than 10 s (90th
// percentile 78 s), so 3 is the default. RUN_BG_SLOTS, else STARDUST_BROWSER_SLOTS, lowers it on a small machine. On a
// large one raise STARDUST_BROWSER_BUDGET — STARDUST_BROWSER_SLOTS, unset, follows it (derivedBrowserSlots) — the
// machine's slots bound browser jobs too, so RUN_BG_SLOTS above them adds none.
export const DEFAULT_SLOTS = 3;
// One wait's default 5 minutes, ceiling 25. Default: in recorded hands-off runs the lead polled delegated units with
// foreground waits of 9–23 minutes and an ended job or unit waited for the current wait to end; with a one-hour cache a
// five-minute poll costs about three cents, so a longer wait buys nothing — a --max over WAIT_NOTICE_SEC says so in one
// stderr line. Ceiling: in another run a single tool call waited 57 minutes; a supervised session asks its runner at least
// every 25 minutes and the pause file ends a wait at once. The shell tool call must declare a timeout longer than the
// wait — its default (about two minutes) would kill it first.
export const DEFAULT_MAX_SEC = 300;
export const MAX_CEILING_SEC = 1500;
export const WAIT_NOTICE_SEC = 600;
// wait flags a running job whose log has not grown for this many minutes (0 = off), so a lead kills a hung job instead
// of waiting out its deadline; a recorded hands-off lead sat 57 minutes on a silent call.
export const DEFAULT_STALL_MIN = 5;
const CLAMP_WHY = 'a supervised session asks its runner at least every 25 minutes, the pause file (STARDUST_PAUSE_FILE) ends a wait early, and the tool call must declare a timeout longer than the wait';
// --until: an instant, never a local wall-clock time — the offset (or Z) is required.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;
const UNTIL_USAGE = 'run-bg: --until needs an ISO-8601 instant with an offset or Z, e.g. 2026-10-18T12:25:00Z';
export const DEFAULT_TAIL = 8;
export const STILL_RUNNING_EXIT = 75;
export const PAUSED_EXIT = 76;
// The runner appends one line here (from the cwd, the project root) whenever a background agent finishes; a wait that
// sees it grow returns WAKE_EXIT so the lead acts at once. Read only — run-bg never writes it.
export const WAKE_FILE = 'stardust/.labs/wake';
export const WAKE_EXIT = 77;
// With nothing going and no names given, `wait`/`status` report the latest batch: jobs that ended
// within this window of the newest ending. Earlier sessions' jobs stay on disk (their logs are
// evidence) but out of the report — one session's wait had dumped every prior session's summary.
export const RECENT_WINDOW_SEC = 600;
// The starter writes the state without a pid; the wrapper's first act is to write its own. A pid-less state
// younger than this is still spawning (node startup on a loaded machine), older is lost.
export const SPAWN_GRACE_SEC = 15;
// clean --all: SIGTERM first (run-capped forwards it to the instrument's group and SIGKILLs that after 3 s), then
// SIGKILL every process left in the job's groups after this grace.
const CLEAN_GRACE_MS = 4000;
// One `ps` snapshot serves a whole report/poll pass.
const PROC_TTL_MS = 250;
// The gate instruments' verdict vocabulary: pixel-compare's size/height/percentage/band lines,
// stitch-shot's completion line, gate.sh's fail-loud prefixes, run-capped's deadline notice,
// content-diff's structural count, motion-compare's SUMMARY, the browser-lock's wait/hold notices.
// Override with --grep for another instrument.
export const VERDICT_RE = /differing pixels|height delta|hot band|\bPASS\b|\bFAIL(?:ED)?\b|WARNING|\berror\b|exceeded|IDENTITY|reaped|stitched \S+:|structural|🔴|run-capped:|gate\.sh:|\b(?:content-diff|visual-diff|chrome-parity|evidence): |DEADLINE|BLOCKED|ERROR \(exit|delta\(s\)|advisory|motion summary:|SUMMARY|browser-lock:/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const POLL_MS = Number(process.env.RUN_BG_POLL_MS) || 2000;
const SELF = fileURLToPath(import.meta.url);
// The machine-wide browser lock: beside a project copy (stardust/scripts/stardust/), else in the plugin tree.
const LOCK_CANDIDATES = [resolve(dirname(SELF), '../stardust/browser-lock.mjs'), resolve(dirname(SELF), '../../stardust/scripts/browser-lock.mjs')];
// The instruments that launch a browser — a script importing playwright, or calling its skill's lib.mjs loadPlaywright()
// itself or in a module it names (qa.mjs's checks); lib.mjs libraries aside — plus gate.sh and gate-all.mjs, which spawn
// them. A job whose argv names one takes a machine-wide slot unless --no-lock.
export const BROWSER_SCRIPTS = new Set([
  'ai-readability.mjs', 'block-roundtrip.mjs', 'ew-editability-probe.mjs', 'qa-gate.mjs', 'render-harness.mjs', 'section-schema.mjs', 'style-fingerprint.mjs', // deploy
  'chrome-explore.mjs', 'clip-probe.mjs', 'content-diff.mjs', 'content-presence.mjs', 'dom-probe.mjs', 'page-probe.mjs', 'unit-geometry.mjs', 'visual-diff.mjs', // diff
  'dynamics-check.mjs', 'dynamics-detect.mjs', 'snapshot-api.mjs', 'snapshot-forms.mjs', // dynamics
  'crawl.mjs', 'media-harvest.mjs', 'style-census.mjs', // extract
  'qa.mjs', // qa
  'anchor.mjs', 'cap-probe.mjs', 'chrome-parity.mjs', 'gate-all.mjs', 'gate.sh', 'measure.mjs', 'motion-observe.mjs', 'presence.mjs', 'sibling-variance.mjs', 'stitch-shot.mjs', // replica
  'capture-content.mjs', 'dom-equality.mjs', 'donor-probe.mjs', 'slot-coverage.mjs', // reskin
  'spec-capture.mjs', 'spec-fetch.mjs', 'spec-inventory.mjs', 'spec-sheet.mjs', // spec
]);
// The words of an argv token: a `sh -c` string splits into its command words, a plain token is one word.
const SHELL_SPLIT = /[\s;&|()<>'"`]+/;
// Any argv token (or a word of a `sh -c` string) whose basename is a browser instrument.
export function isBrowserJob(cmd, args = []) {
  return [cmd, ...args].some((t) => String(t ?? '').split(SHELL_SPLIT).some((w) => BROWSER_SCRIPTS.has(basename(w))));
}

// ---- a gate-all job's deadline -----------------------------------------------------------------
const GATE_ALL = 'gate-all.mjs';
// Beside this file in both layouts (the plugin's skills/replica/scripts/, a project's stardust/scripts/replica/).
const GATE_ALL_PATH = join(dirname(SELF), GATE_ALL);
// Every gate-all.mjs invocation in a job's argv → its args: an argv token, or a word of a `sh -c` string, whose basename
// is gate-all.mjs starts one; its args are the tokens / words after it up to the next one.
export function gateAllInvocations(cmd, args = []) {
  const words = [cmd, ...args].flatMap((t) => { const s = String(t ?? ''); if (basename(s) === GATE_ALL) return [s]; const w = s.split(SHELL_SPLIT).filter(Boolean); return w.some((x) => basename(x) === GATE_ALL) ? w : [s]; });
  const runs = [];
  for (const w of words) { if (basename(w) === GATE_ALL) runs.push([]); else if (runs.length) runs[runs.length - 1].push(w); }
  return runs;
}
// A gate-all job started without --timeout: its deadline becomes max(DEFAULT_TIMEOUT_SEC, gate-all's roster estimate summed
// over its invocations) — a recorded 99-page roster at one width needed 2152 s and was killed at the 900 s default.
// → { timeoutSec, note } (note: the one stdout line, after `run-bg: <job> `), or null: not a gate-all job, or --timeout
// given (never changed). The sibling gate-all.mjs is imported only here, only for a gate-all job.
export async function gateAllTimeout(cmd, args = [], { cwd = process.cwd(), given = false } = {}) {
  const runs = gateAllInvocations(cmd, args);
  if (given || !runs.length) return null;
  const kept = (why) => ({ timeoutSec: DEFAULT_TIMEOUT_SEC, note: `gate-all estimate unavailable (${why}) — ${DEFAULT_TIMEOUT_SEC} s default kept` });
  if (!existsSync(GATE_ALL_PATH)) return kept(`${GATE_ALL_PATH} not found`);
  let ga; let ests;
  try { ga = await import(pathToFileURL(GATE_ALL_PATH).href); } catch (e) { return kept(`importing ${GATE_ALL_PATH} failed: ${e?.message ?? e}`); }
  if (typeof ga.rosterEstimate !== 'function') return kept(`${GATE_ALL_PATH} exports no rosterEstimate`);
  try { ests = runs.map((a) => ga.rosterEstimate(a, { cwd })); } catch (e) { return kept(e?.message ?? String(e)); }
  const bad = ests.find((e) => e.error); if (bad) return kept(bad.error);
  const sec = ests.reduce((n, e) => n + e.estimatedSeconds, 0);
  const head = `gates ${ests.map((e) => `${e.pages} page(s) × ${e.widths} width${e.widths === 1 ? '' : 's'}`).join(' + ')} ≈ ${sec} s (gate-all estimate, ${ga.ESTIMATE_SEC_PER_PAGE} s per page per width)`;
  return sec > DEFAULT_TIMEOUT_SEC ? { timeoutSec: sec, note: `${head} — no --timeout given: deadline ${sec} s instead of the ${DEFAULT_TIMEOUT_SEC} s default` } : { timeoutSec: DEFAULT_TIMEOUT_SEC, note: `${head} — within the ${DEFAULT_TIMEOUT_SEC} s default — kept` };
}

const HELP = `Usage:
  node run-bg.mjs start --name <job> [--kind job|server] [--timeout <s>=${DEFAULT_TIMEOUT_SEC}, server ${SERVER_TIMEOUT_SEC}] [--slots <n>=${DEFAULT_SLOTS}] [--lock|--no-lock] -- <cmd> [args…]
  node run-bg.mjs wait   [--max <s>=${DEFAULT_MAX_SEC} | --until <ISO>] [--stall <min>=${DEFAULT_STALL_MIN}] [--all] [--tail <n>=${DEFAULT_TAIL}] [--grep <re>] [<job>…]
  node run-bg.mjs status [--all] [--tail <n>] [--grep <re>] [<job>…]
  node run-bg.mjs stop   <job>… | --servers [--all]
  node run-bg.mjs log    <job> [--tail <n>=40] [--grep <re>]
  node run-bg.mjs clean  [--all]
  (all: [--dir <d>], default ${DEFAULT_DIR})
  Selection (wait, status): <job>… = those; bare = the caller's own jobs — unfinished, else its latest batch; --all =
  every owner's — unfinished, else every job on disk; bare and --all leave servers out (Servers, below). The report's
  first line names the selection and its count. The owner, recorded by start: RUN_BG_OWNER, else the nearest ancestor
  that is not a shell or wrapper — the agent process
  behind the tool call's shell (agents sharing one process: wait <job>…, or RUN_BG_OWNER=<unit> before each run-bg
  call); a job state without one is reached by name or --all only. Why: in a recorded hands-off run a bare wait in one agent blocked on every other agent's jobs.
  --timeout is a start flag: on wait or status a usage error (exit 125), no longer silently ignored — wait takes --max
  or --until.
  Wait bound: --max seconds (default ${DEFAULT_MAX_SEC} = 5 min; over ${WAIT_NOTICE_SEC}, one notice line) or --until an ISO-8601 instant with an
  offset or Z (past = one pass; with --max, or on start/status, a usage error), both clamped to ${MAX_CEILING_SEC} s from now. Give the
  shell tool call a timeout longer than the wait (--max ${DEFAULT_MAX_SEC} → e.g. ${DEFAULT_MAX_SEC + 60} s): its default, about two minutes, would kill it
  first. --max 240 where the prompt cache lives five minutes.
  Rule: wait in steps of at most five minutes, lead and subagents alike — \`run-bg.mjs wait\` for jobs, \`progress.mjs wait\` for units; a \`sleep\` is never a wait.
  Stall: a running job whose log has not grown for --stall minutes (default ${DEFAULT_STALL_MIN}, 0 = off; servers excluded) adds one line
  \`stall: <job> no output for N min (deadline in M min)\` under its report line, so a hung job is killed, not waited out.
  Why: recorded hands-off leads waited 9–23 minutes per poll while ended units sat unseen; with a one-hour cache a
  five-minute poll costs about three cents. A ceiling stays: in another run one call waited 57 minutes.
  Pause: while $STARDUST_PAUSE_FILE (the runner's JSON {at, reason}; relative = from the cwd; unset or empty = no check)
  names a file that exists, wait ends at once — checked on every poll — with exit ${PAUSED_EXIT} and the one-pass report after a
  \`run-bg: paused — <path> present …\` line; status shows that line first. Jobs keep running; nothing is signalled.
  Wake: the runner appends a line to ${WAKE_FILE} (from the cwd; absent = nothing) when a background agent finishes; a
  wait that sees it grow ends with exit ${WAKE_EXIT} and the one-pass report after a \`wake: <its last line>\` line (an exit 0
  whose poll saw it grow prints that line too).
  Deadline: --timeout (0 = none) is exported to the job as RUN_BG_DEADLINE_SEC. A gate-all.mjs job started without
  --timeout gets max(${DEFAULT_TIMEOUT_SEC}, 25 s × pages × widths) — gate-all's roster estimate, summed over its invocations,
  logged on start's stdout; an explicit --timeout is never changed, every other job keeps ${DEFAULT_TIMEOUT_SEC} s (a server ${SERVER_TIMEOUT_SEC} s).
  Two budgets: --slots paces this project's jobs (env RUN_BG_SLOTS, else STARDUST_BROWSER_SLOTS); a browser job (gate.sh,
  gate-all.mjs, stitch-shot.mjs, the diff probes …; --lock forces, --no-lock skips and implies --kind server) first takes a machine-wide slot from
  browser-lock.mjs — STARDUST_BROWSER_SLOTS (default 3, 0 = off) across projects, slot files in ~/.stardust/locks/browser/
  (STARDUST_BROWSER_LOCK_DIR); the job waits for it queued, without a limit unless STARDUST_BROWSER_WAIT <s> is set (no
  slot within it = exit 124, no verdict). The job runs inside its slot (STARDUST_BROWSER_SLOTS=0, STARDUST_BROWSER_SLOT=<slot
  file>) and STARDUST_BROWSERS_PER_SLOT = max(1, floor(STARDUST_BROWSER_BUDGET (default 3) / STARDUST_BROWSER_SLOTS)): the
  contract's 3 browsers = budget 3 across all jobs; a larger machine raises STARDUST_BROWSER_BUDGET B and, unset,
  STARDUST_BROWSER_SLOTS follows it: 3 when B is 3 or 6, below 2 max(1, floor(B)), else 2 (4 → 2 × 2, 6 → 3 × 2; one run-bg:
  line in the job's log names it); set, it wins — RUN_BG_SLOTS above the slots adds none. A budget below the slots cannot
  be held (one browser per slot is the floor): one run-bg: line says so — set STARDUST_BROWSER_SLOTS to the budget to hold it.
  Servers: --kind server = a process that runs until stopped (a static file server, a dev server); --no-lock implies it
  unless --kind job is given (an instrument run without the browser slot), and start says so. A server takes no slot —
  neither --slots nor the machine's browser slot (--lock with it: usage error) — running servers do not count toward
  --slots, and its deadline is ${SERVER_TIMEOUT_SEC} s unless --timeout. A bare or --all wait never waits for one (its first line
  counts them); wait <name> does, and ends only when the server is stopped or at its deadline. status lists them after
  the jobs under \`servers:\` — bare: yours, queued or running or ended in the last ${RECENT_WINDOW_SEC / 60} min; --all: every server on disk;
  named: those; by name: state and pid, age, deadline, command. stop <job>… ends jobs of either kind — SIGTERM, then after
  ${STOP_GRACE_MS / 1000} s SIGKILL to every process left in the job's process groups until none is — and records the end with the
  deadline's no-verdict marker (exit ${DEADLINE_EXIT}, timedOut) plus stopped: a stopped job is no verdict, like a deadline. stop
  --servers = your running servers, --servers --all every owner's; a job not running is one line, exit 0. A signal goes
  only to a pid a fresh look still shows with its recorded identity. clean keeps running servers; clean --all stops them.
  Why: in a recorded hands-off run a 26-second measure queued 615 s behind a static file server, and a bare wait blocked
  600 s on the unit's own servers.
  Exit: 0 ok · ${STILL_RUNNING_EXIT} (wait) a selected job still queued/running — run wait again as the next step
  · ${PAUSED_EXIT} (wait) the pause file is present — stop waiting, finish the iteration and return
  · ${WAKE_EXIT} (wait) the runner's wake file grew — a background agent finished: act on it, then wait again
  · 2 (start) the name is still queued/running, (log) no log, (stop) no such job — nothing signalled · 125 usage
  · 1 error, (stop) a process survived SIGKILL. A job's own exit (124 = deadline, or stopped — no verdict) is on its line.`;

class UsageError extends Error { constructor(msg, code = 125) { super(msg); this.code = code; } }
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const statePath = (dir, name) => join(dir, `${name}.json`);
export const logPath = (dir, name) => join(dir, `${name}.log`);
const secondsBetween = (a, b) => Math.max(0, Math.round((new Date(b || Date.now()) - new Date(a)) / 1000));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

export function readState(dir, name) { try { return JSON.parse(readFileSync(statePath(dir, name), 'utf8')); } catch { return null; } }
function writeState(dir, st) { const p = statePath(dir, st.name); const tmp = `${p}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(st, null, 1)); renameSync(tmp, p); return st; }
export function listJobs(dir) { if (!existsSync(dir)) return []; return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readState(dir, f.slice(0, -5))).filter(Boolean); }

// ---- process identity --------------------------------------------------------------------------
// pid → { ppid, pgid, state, start, command } from `ps` (-ww: never truncate); lstart is 5 whitespace tokens ("Wed Sep 23
// 07:59:27 2026") on macOS and procps alike. Without ps: /proc (Linux; start = kernel start ticks).
const PS_FIELDS = 'pid=,ppid=,pgid=,state=,lstart=,command=';
function psRows(stdout) {
  const rows = new Map();
  for (const line of String(stdout || '').split('\n')) {
    const t = line.trim().split(/\s+/);
    if (t.length < 10) continue;
    rows.set(Number(t[0]), { ppid: Number(t[1]), pgid: Number(t[2]), state: t[3], start: t.slice(4, 9).join(' '), command: t.slice(9).join(' ') });
  }
  return rows;
}
function procStat(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { ppid: Number(f[1]), pgid: Number(f[2]), state: f[0], start: `ticks:${f[19]}`, command: readFileSync(`/proc/${pid}/cmdline`, 'latin1').split('\0').join(' ').trim() };
  } catch { return null; }
}
// The whole table from one `ps -e` run — cached PROC_TTL_MS for a report or poll pass, `fresh` on request; null when ps
// is unusable.
let procCache = { at: 0, table: null };
function procTable({ fresh = false } = {}) {
  if (!fresh && Date.now() - procCache.at < PROC_TTL_MS) return procCache.table;
  const r = spawnSync('ps', ['-e', '-ww', '-o', PS_FIELDS], { encoding: 'utf8' });
  procCache = { at: Date.now(), table: r.status === 0 && r.stdout ? psRows(r.stdout) : null };
  return procCache.table;
}
// One process's identity, else null: the cached snapshot — or, `fresh`, a `ps -p` of that pid alone at this instant (the
// look taken right before every signal) — else /proc.
export function procInfo(pid, { fresh = false } = {}) {
  if (fresh) {
    const r = spawnSync('ps', ['-ww', '-o', PS_FIELDS, '-p', String(pid)], { encoding: 'utf8' });
    if (!r.error && (r.status === 0 || r.status === 1)) return psRows(r.stdout).get(Number(pid)) || null; // 1: no such pid
    return procStat(pid);
  }
  const t = procTable();
  return t ? t.get(Number(pid)) || null : procStat(pid);
}
// The live members of process group `pgid` (zombies and this process aside), from a fresh census:
// [{ pid, ident: { start, pgid } }].
function groupMembers(pgid) {
  const t = procTable({ fresh: true });
  let rows;
  if (t) rows = [...t];
  else { let ids = []; try { ids = readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { /* no /proc */ } rows = ids.map((d) => [Number(d), procStat(d)]).filter(([, p]) => p); }
  return rows.filter(([pid, p]) => p.pgid === pgid && pid !== process.pid && !/^[ZX]/.test(p.state)).map(([pid, p]) => ({ pid, ident: { start: p.start, pgid } }));
}
// A pid alone is not a job: pids recycle, and EPERM answers for a process that is not ours. Ours = the pid exists,
// is not a zombie (a dead wrapper lingers as one under a PID 1 that does not reap), its group is `pgid` when one is
// given, and its start time is the one recorded at spawn — or, for state files without one, its command line is this
// script's `__run --name <job>`.
export function alive(pid, { start = null, name = null, pgid = null } = {}, opts) {
  if (!pid) return false;
  try { process.kill(pid, 0); } catch { return false; }
  const p = procInfo(pid, opts);
  if (!p || /^[ZX]/.test(p.state)) return false;
  if (pgid != null && p.pgid !== pgid) return false;
  if (start) return p.start === start;
  return Boolean(name) && new RegExp(`run-bg\\.mjs __run\\b.* --name ${escapeRe(name)}(?: |$)`).test(p.command);
}
const wrapperAlive = (st, opts) => alive(st.wrapperPid, { start: st.wrapperStart, name: st.name }, opts);
const childAlive = (st, opts) => Boolean(st.childStart) && alive(st.childPid, { start: st.childStart }, opts);
// The wrapper's own child right after runCapped spawned it (ps itself excluded) — run-capped does not expose the pid.
function childOf(ppid) {
  const t = procTable({ fresh: true }); if (!t) return null;
  for (const [pid, p] of t) if (p.ppid === ppid && !/^(?:\S*\/)?ps(?: |$)/.test(p.command)) return { pid, start: p.start };
  return null;
}
function signal(pid, sig, { group = false } = {}) { try { process.kill(group && process.platform !== 'win32' ? -pid : pid, sig); return true; } catch { return false; } }

// ---- the caller (a job's owner) ----------------------------------------------------------------
// A bare wait/status covers the caller's own jobs: in a recorded hands-off run a bare wait in one agent blocked on every
// other agent's jobs. The caller is the agent process behind the tool call's shell — the shell (and any wrapper in front
// of node) is skipped, so the answer is the same whether the shell exec'd node or not.
const OWNER_SKIP = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'fish', 'tcsh', 'csh', 'env', 'nohup', 'timeout', 'nice']);
const commandName = (command) => basename(String(command ?? '').trim().split(/\s+/)[0].replace(/^-/, '')); // a login shell runs as `-zsh`
// One ancestor for the walk: the snapshot when one is fresh, else `ps -p` of that pid alone — start needs no full table
// for a new name, and the full `ps -e` costs several times more — else procInfo (the full table, or /proc).
function parentOf(pid) {
  if (procCache.table && Date.now() - procCache.at < PROC_TTL_MS) return procCache.table.get(Number(pid)) || null;
  const r = spawnSync('ps', ['-ww', '-o', 'ppid=,command=', '-p', String(pid)], { encoding: 'utf8' });
  const m = r.status === 0 ? /^\s*(\d+)\s+(.*\S)/.exec(r.stdout) : null;
  return m ? { ppid: Number(m[1]), command: m[2] } : procInfo(pid);
}
// → RUN_BG_OWNER (non-empty: stored as given — agents sharing one process prefix each run-bg call with it), else the pid
// of the nearest ancestor, starting at `ppid`, whose command is not in OWNER_SKIP; `ppid` itself when no process table
// answers (no ps, no /proc). `info(pid)` → { ppid, command } | null; tests inject one.
export function callerOwner(env = process.env, { ppid = process.ppid, info = parentOf } = {}) {
  const given = env.RUN_BG_OWNER;
  if (given !== undefined && String(given).trim() !== '') return given;
  let pid = ppid;
  for (let hop = 0; hop < 64; hop += 1) { // a bound, not a depth anyone reaches: a malformed table never loops
    const p = info(pid);
    if (!p || !OWNER_SKIP.has(commandName(p.command)) || !p.ppid || p.ppid === pid) return pid;
    pid = p.ppid;
  }
  return pid;
}

// queued: waiting for a slot (or still spawning) · running · ended: wrote an exit · lost: the wrapper died without
// writing one (kill -9, reboot) or the stored pid now names some other process.
export function phase(st) {
  if (st.endedAt) return 'ended';
  if (!st.wrapperPid) return secondsBetween(st.queuedAt) < SPAWN_GRACE_SEC ? 'queued' : 'lost';
  if (!wrapperAlive(st)) return 'lost';
  return st.launchedAt ? 'running' : 'queued';
}
const isPending = (st) => ['queued', 'running'].includes(phase(st));
// lost, but the instrument the wrapper launched is still running.
const isOrphan = (st) => phase(st) === 'lost' && childAlive(st);
// A state read just before its wrapper wrote the exit, checked after the wrapper quit, looks lost: the wrapper writes
// endedAt before it exits, so a lost-looking state without endedAt is read once more → the fresh state when it now carries
// endedAt, else `st` (a truly lost job stays lost). Every report and selection classifies through it.
export function settled(dir, st) {
  if (!st || st.endedAt || phase(st) !== 'lost') return st;
  const fresh = readState(dir, st.name);
  return fresh?.endedAt ? fresh : st;
}

// ---- kinds -------------------------------------------------------------------------------------
// The kind is stored as runKind (gate-evidence's own `kind` names an instrument); a state without one (older runs) is a job.
export const isServer = (st) => st?.runKind === 'server';
// --kind as given wins; without it --no-lock (lock off) means a server — the recorded servers were started that way.
export function startKind(kind, lock) { return kind ?? (lock === 'off' ? 'server' : 'job'); }
// May `st` launch now? A job: fewer than its slots of this dir's other jobs are running and no job queued before it
// (queuedAt, then name) still waits. Servers neither count nor queue, and a server never waits. `phaseOf` → tests.
export function mayLaunch(st, jobs, phaseOf = phase) {
  if (isServer(st)) return true;
  const others = jobs.filter((j) => j.name !== st.name && !isServer(j));
  const running = others.filter((j) => phaseOf(j) === 'running').length;
  const ahead = others.filter((j) => phaseOf(j) === 'queued' && (j.queuedAt < st.queuedAt || (j.queuedAt === st.queuedAt && j.name < st.name))).length;
  return running < st.slots && ahead === 0;
}

// ---- start -------------------------------------------------------------------------------------
export function start(dir, name, cmd, args, { kind = 'job', timeoutSec = kind === 'server' ? SERVER_TIMEOUT_SEC : DEFAULT_TIMEOUT_SEC, slots = DEFAULT_SLOTS, lock = 'auto', owner = callerOwner() } = {}) {
  if (!name || !NAME_RE.test(name)) throw new UsageError(`run-bg: --name must match ${NAME_RE} (got "${name}")\n${HELP}`);
  if (!cmd) throw new UsageError(`run-bg: start needs a command after --\n${HELP}`);
  if (!KINDS.includes(kind)) throw new UsageError(`run-bg: --kind must be ${KINDS.join(' or ')} (got "${kind}")\n${HELP}`);
  if (!Number.isFinite(timeoutSec) || timeoutSec < 0) throw new UsageError(`run-bg: --timeout must be a number of seconds (0 disables)\n${HELP}`);
  if (!Number.isInteger(slots) || slots < 1) throw new UsageError(`run-bg: --slots must be a positive integer\n${HELP}`);
  if (!['auto', 'on', 'off'].includes(lock)) throw new UsageError(`run-bg: lock must be auto, on or off (got "${lock}")\n${HELP}`);
  if (kind === 'server' && lock === 'on') throw new UsageError(`run-bg: a server takes no browser slot — --lock is for a job (--kind job)\n${HELP}`);
  mkdirSync(dir, { recursive: true });
  const prev = readState(dir, name);
  if (prev && isPending(prev)) throw new UsageError(`run-bg: ${name} is still ${phase(prev)} (wrapper pid ${prev.wrapperPid}) — pick another --name, or \`stop ${name}\` ends it`, 2);
  // Written once, before the spawn; from here on the wrapper is the file's only writer while it lives (`stop` records an
  // end once it is gone). ownerPid: the caller (callerOwner). A server never takes the browser slot: lock off.
  const st = { name, runKind: kind, ownerPid: owner, cmd, args, cwd: process.cwd(), timeoutSec, slots, lock: kind === 'server' ? 'off' : lock, queuedAt: new Date().toISOString(), wrapperPid: null, wrapperStart: null, launchedAt: null, childPid: null, childStart: null, endedAt: null, exit: null, timedOut: false };
  writeState(dir, st);
  const fd = openSync(logPath(dir, name), 'w');
  const child = spawn(process.execPath, [SELF, '__run', '--dir', dir, '--name', name], { detached: true, stdio: ['ignore', fd, fd], cwd: process.cwd(), env: process.env });
  closeSync(fd);
  child.unref();
  return { name, log: logPath(dir, name), wrapperPid: child.pid };
}

// How long a job waits for its machine-wide slot: without a limit (Infinity) unless the owner sets STARDUST_BROWSER_WAIT.
// The holder is a whole job (deadline DEFAULT_TIMEOUT_SEC) and slots are not FIFO, so browser-lock's 600 s default — meant
// for a CLI holder — would end waiters with 124 while every holder is still inside its deadline; this dir's queue waits too.
export function lockWaitS(env = process.env) {
  const v = env.STARDUST_BROWSER_WAIT;
  const s = v === undefined || String(v).trim() === '' ? NaN : Number(v);
  return Number.isFinite(s) && s >= 0 ? s : Infinity;
}

// The browsers one machine-wide slot may run: the machine's browser budget shared by its slots. budget =
// STARDUST_BROWSER_BUDGET (a positive number, else the default 3 — the contract's 3 browsers across all jobs); slots =
// STARDUST_BROWSER_SLOTS as set before the wrapper zeroes it for the command (a positive number, rounded up — browser-lock
// keeps floor(S) holders, its re-check backs off any holder past floor(S); ceil(S) is kept as an upper bound so the
// per-slot share never overshoots the budget — else the default 3: 0 = lock off and junk alike; run-bg exports the value
// only while it holds a slot, so 0 never reaches a reader).
// perSlot = max(1, floor(budget / slots)): a budget below the slots cannot be held — one browser per slot is the floor.
const DEFAULT_BROWSER_BUDGET = 3;
const DEFAULT_MACHINE_SLOTS = 3; // browser-lock.mjs's default slot count
const envNum = (v) => { const t = String(v ?? '').trim(); return t === '' ? NaN : Number(t); };
function browserBudget(env) {
  const b = envNum(env.STARDUST_BROWSER_BUDGET); const s = envNum(env.STARDUST_BROWSER_SLOTS);
  const budget = Number.isFinite(b) && b > 0 ? b : DEFAULT_BROWSER_BUDGET;
  const slots = Number.isFinite(s) && s > 0 ? Math.ceil(s) : DEFAULT_MACHINE_SLOTS;
  return { budget, slots, perSlot: Math.max(1, Math.floor(budget / slots)) };
}
export function browsersPerSlot(env = process.env) { return browserBudget(env).perSlot; }
// STARDUST_BROWSER_SLOTS unset (undefined, empty, blank) → derived from a positive STARDUST_BROWSER_BUDGET B so the
// budget's browsers are at work: 3 when B is 3 or 6, below 2 max(1, floor(B)) (two slots would overshoot a budget of 1),
// else 2 — 3 → 3 × 1, 4 → 2 × 2, 5 → 2 × 2, 6 → 3 × 2; a fixed 3 slots left one browser of a budget of 4 idle. null: the
// slots set (any value, 0 = lock off included — it wins), or B unset or not a positive number (the defaults stay).
// cli() applies it once to process.env, so parse(), gateAllTimeout, browser-lock's acquire() and the wrapper agree.
export function derivedBrowserSlots(env = process.env) {
  if (String(env.STARDUST_BROWSER_SLOTS ?? '').trim() !== '') return null;
  const b = envNum(env.STARDUST_BROWSER_BUDGET);
  if (!Number.isFinite(b) || b <= 0) return null;
  if (b < 2) return Math.max(1, Math.floor(b));
  return b === 3 || b === 6 ? 3 : 2;
}

// The machine-wide browser slot for a browser job (lock on, or auto and the argv names a browser instrument); never for a
// server. Resolves { st, slot } (slot null = unlocked: a server, not a browser job, STARDUST_BROWSER_SLOTS=0, browser-lock.mjs absent or
// failing) or { st, timedOut: true } when browser-lock gave up (exit 124 — only under a set STARDUST_BROWSER_WAIT).
// Records lockWaitFrom / lockFile / lockWaitSec.
async function machineSlot(dir, st) {
  const lock = st.lock ?? 'auto';
  if (isServer(st) || lock === 'off' || (lock === 'auto' && !isBrowserJob(st.cmd, st.args))) return { st, slot: null };
  const mod = LOCK_CANDIDATES.find((p) => existsSync(p));
  if (!mod) { console.log(`run-bg: browser-lock.mjs not found (looked in ${LOCK_CANDIDATES.join(', ')}) — ${st.name} runs without a machine-wide browser slot`); return { st, slot: null }; }
  st = writeState(dir, { ...st, lockWaitFrom: new Date().toISOString() });
  let slot = null;
  try {
    const { acquire } = await import(pathToFileURL(mod).href);
    slot = await acquire({ pid: process.pid, script: st.name, project: st.cwd, waitS: lockWaitS() }); // an API holder: keeps its file fresh itself
  } catch (e) {
    if (e?.code !== DEADLINE_EXIT) { console.log(`run-bg: browser-lock.mjs failed (${e?.message ?? e}) — ${st.name} runs without a machine-wide browser slot`); return { st, slot: null }; }
    console.error(e.message);
    const endedAt = new Date().toISOString();
    return { st: writeState(dir, { ...st, endedAt, exit: DEADLINE_EXIT, lockTimeout: true, lockWaitSec: secondsBetween(st.lockWaitFrom, endedAt) }), timedOut: true };
  }
  if (slot) st = writeState(dir, { ...st, lockFile: slot.file, lockWaitSec: secondsBetween(st.lockWaitFrom) });
  return { st, slot };
}

// The detached wrapper: record its identity, take a slot (FIFO; a server none), then a machine-wide browser slot for a browser job, run
// the command under run-capped, record the exit, release the machine slot.
async function runWrapper(dir, name) {
  let st = readState(dir, name);
  if (!st) throw new Error(`run-bg: state for ${name} vanished from ${dir}`);
  st = writeState(dir, { ...st, wrapperPid: process.pid, wrapperStart: procInfo(process.pid, { fresh: true })?.start ?? null });
  while (!mayLaunch(st, listJobs(dir))) await sleep(Math.min(POLL_MS, 1000));
  const held = await machineSlot(dir, st);
  st = held.st;
  if (held.timedOut) { console.log(`run-bg: ${name} ended exit=${DEADLINE_EXIT} (no machine-wide browser slot)`); process.exitCode = DEADLINE_EXIT; return; }
  // The command spawns with this env: its children run inside the job's slot and never take a second one, and run at most
  // STARDUST_BROWSERS_PER_SLOT browsers — computed from the machine's slot count before it is zeroed here.
  if (held.slot) {
    const { budget, slots, perSlot } = browserBudget(process.env);
    // RUN_BG_SLOTS_DERIVED: the slot count cli() derived from the budget (in this process or the starter's).
    if (process.env.RUN_BG_SLOTS_DERIVED && process.env.RUN_BG_SLOTS_DERIVED === process.env.STARDUST_BROWSER_SLOTS) console.log(`run-bg: STARDUST_BROWSER_SLOTS=${slots} derived from STARDUST_BROWSER_BUDGET ${budget} — ${perSlot} browser${perSlot === 1 ? '' : 's'} per slot`);
    else if (budget < slots) console.log(`run-bg: STARDUST_BROWSER_BUDGET ${budget} is below STARDUST_BROWSER_SLOTS ${slots} — one browser per slot, ${slots} at most; set STARDUST_BROWSER_SLOTS=${Math.max(1, Math.floor(budget))} to hold the budget`);
    process.env.STARDUST_BROWSERS_PER_SLOT = String(perSlot);
    process.env.STARDUST_BROWSER_SLOTS = '0'; process.env.STARDUST_BROWSER_SLOT = held.slot.file; delete process.env.RUN_BG_SLOTS_DERIVED;
  }
  // The deadline (it starts at launch) is the time the command has; gate-all refuses a roster it cannot finish in it.
  // 0 = no deadline: an inherited value stays.
  if (st.timeoutSec > 0) process.env.RUN_BG_DEADLINE_SEC = String(st.timeoutSec);
  const run = runCapped(st.cmd, st.args, { timeoutSec: st.timeoutSec, label: name }); // spawns synchronously
  const child = childOf(process.pid);
  st = writeState(dir, { ...st, launchedAt: new Date().toISOString(), childPid: child?.pid ?? null, childStart: child?.start ?? null });
  console.log(`run-bg: ${name} launched ${st.launchedAt} (timeout ${st.timeoutSec || 'none'}s): ${[st.cmd, ...st.args].join(' ')}`);
  const code = await run;
  writeState(dir, { ...st, endedAt: new Date().toISOString(), exit: code, timedOut: code === DEADLINE_EXIT });
  held.slot?.release(); // a wrapper killed hard leaves a dead-pid slot file the next census reaps
  console.log(`run-bg: ${name} ended exit=${code}`);
  process.exitCode = code;
}

// ---- report ------------------------------------------------------------------------------------
// The pause file: the runner that supervises a hands-off run writes it (JSON {at, reason}) when it wants the session to
// stop, and alone writes, edits or deletes it. → { path, reason, at } while `file` (relative: from `cwd`, the project
// root) exists, else null; unset or empty = no check. A file that is not JSON {at, reason} still counts: reason unreadable.
export function pauseState(file = process.env.STARDUST_PAUSE_FILE, { cwd = process.cwd() } = {}) {
  if (file == null || String(file).trim() === '') return null;
  const p = resolve(cwd, String(file));
  if (!existsSync(p)) return null;
  let j = null; try { j = JSON.parse(readFileSync(p, 'utf8')); } catch { /* present, unreadable */ }
  const ok = j !== null && typeof j === 'object' && !Array.isArray(j);
  const field = (v, none) => { const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, 200); return s || none; };
  return { path: String(file), reason: ok ? field(j.reason, 'unspecified') : 'unreadable', at: ok ? field(j.at, 'unknown') : 'unknown' };
}
export const pauseLine = (p) => `run-bg: paused — ${p.path} present (reason: ${p.reason}, at ${p.at}) — jobs keep running; finish the iteration, record it and return`;
// The wake file (WAKE_FILE): its size in bytes — absent or unreadable = 0 — and, on a wake, its last non-empty line,
// whitespace folded, at most 200 chars.
const wakeSize = (p) => { try { return statSync(p).size; } catch { return 0; } };
function wakeText(p) {
  let text = ''; try { text = readFileSync(p, 'utf8'); } catch { /* gone again */ }
  const last = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).at(-1);
  return last ? last.slice(0, 200) : '(no text)';
}

export function verdictLines(p, { tail = DEFAULT_TAIL, grep = null } = {}) {
  let text; try { text = readFileSync(p, 'utf8'); } catch { return ['(no log)']; }
  const own = /^run-bg: /;
  const all = text.split('\n').filter((l) => l.trim() && !own.test(l));
  const re = grep || VERDICT_RE;
  const hits = all.filter((l) => re.test(l));
  const pick = hits.length ? hits : all;
  const out = pick.slice(-tail).map((l) => (l.length > 240 ? `${l.slice(0, 237)}…` : l));
  if (pick.length > tail) out.unshift(`… ${pick.length - tail} earlier ${hits.length ? 'verdict ' : ''}lines in ${p}`);
  if (!hits.length && all.length) out.unshift(`(no verdict-vocabulary line; last ${Math.min(tail, all.length)} lines — \`log --grep <re>\` for more)`);
  return out;
}

export function describe(st) {
  const ph = phase(st);
  if (ph === 'queued') return `${st.name}  queued ${secondsBetween(st.queuedAt)}s (${isServer(st) ? 'a server, starting' : st.lockWaitFrom ? 'waiting for a machine-wide browser slot — browser-lock.mjs status' : 'waiting for a slot'})`;
  if (ph === 'running') return isServer(st) ? `${st.name}  server running ${secondsBetween(st.launchedAt)}s (ends at \`stop ${st.name}\`${st.timeoutSec > 0 ? ` or its ${st.timeoutSec}s deadline` : ''})` : `${st.name}  running ${secondsBetween(st.launchedAt)}s`;
  if (ph === 'lost') return `${st.name}  lost — wrapper gone without an exit (kill -9? reboot?)${isOrphan(st) ? `; its instrument (pid ${st.childPid}) still runs — \`clean --all\` stops it` : ''} — re-run`;
  if (st.stopped) return `${st.name}  stopped ${st.launchedAt ? `after ${secondsBetween(st.launchedAt, st.endedAt)}s` : 'before launch'} (no verdict, exit ${st.exit})`;
  if (st.lockTimeout) return `${st.name}  no machine-wide browser slot within ${st.lockWaitSec ?? secondsBetween(st.lockWaitFrom, st.endedAt)}s (exit ${DEADLINE_EXIT}: no verdict — re-run)`;
  const took = st.launchedAt ? ` in ${secondsBetween(st.launchedAt, st.endedAt)}s` : '';
  return st.timedOut ? `${st.name}  deadline ${st.timeoutSec}s exceeded (exit ${DEADLINE_EXIT}: no verdict — re-run, or raise --timeout for a legitimately huge page)${took}` : `${st.name}  done exit=${st.exit}${took}`;
}

// One `servers:` line: name, state and pid, age (ran, once ended), deadline, command (at most 160 characters).
export function serverLine(st) {
  const ph = phase(st); const from = st.launchedAt || st.queuedAt;
  let what;
  if (ph === 'running') what = `running pid ${st.childPid ?? st.wrapperPid}  age ${secondsBetween(from)}s`;
  else if (ph === 'queued') what = `starting  age ${secondsBetween(st.queuedAt)}s`;
  else if (ph === 'lost') what = `lost — wrapper gone${isOrphan(st) ? `, pid ${st.childPid} still runs` : ''}  age ${secondsBetween(from)}s`;
  else what = `${st.stopped ? 'stopped' : st.timedOut ? 'deadline exceeded' : 'ended'} exit=${st.exit}  ran ${secondsBetween(from, st.endedAt)}s`;
  const cmd = [st.cmd, ...(st.args ?? [])].join(' ');
  return `  ${st.name}  ${what}  ${st.timeoutSec > 0 ? `deadline ${st.timeoutSec}s` : 'no deadline'}  — ${cmd.length > 160 ? `${cmd.slice(0, 159)}…` : cmd}`;
}

// The first line names the selection and its count — `sub`: wait | status, `scope`: pickNames' — plus `hidden`, the jobs
// --all would add (it folds in the former trailing "earlier job(s) not shown" line), and `skipped`, the servers a bare or
// --all wait leaves out. `pause` (pauseState): its line comes first, and a pending job gets no "wait again". `wake` (the
// wake file's last line): its `wake:` line comes first. `servers` (names; `serversOf`: yours | all | named): a `servers:`
// section after the jobs, one serverLine each — a named one is counted on the first line too.
const SERVERS_HEAD = {
  yours: 'of yours — not waited for; `stop <name>` or `stop --servers` ends them',
  all: 'of all owners — not waited for; `stop <name>` or `stop --servers --all` ends them',
  named: 'named — `stop <name>` ends one; `wait <name>` waits until it is stopped or at its deadline',
};
// name → `stall: <job> no output for N min (deadline in M min)` for every selected RUNNING job (never a server, which
// runs quiet by design) whose log has not grown for `stallMin` minutes (0 = off). A lead reads it and kills the hung job
// instead of waiting out the deadline. mtime, not a byte count: the wrapper's last write to the log is the last output.
export function stallNotices(dir, names, stallMin, { now = Date.now() } = {}) {
  const out = new Map();
  if (!(stallMin > 0)) return out;
  for (const name of names) {
    const st = readState(dir, name);
    if (!st || isServer(st) || phase(st) !== 'running') continue;
    let mtimeMs; try { mtimeMs = statSync(logPath(dir, name)).mtimeMs; } catch { continue; }
    const idleMs = now - mtimeMs;
    if (idleMs < stallMin * 60000) continue;
    const deadlineMs = st.launchedAt && st.timeoutSec > 0 ? Date.parse(st.launchedAt) + st.timeoutSec * 1000 : null;
    const left = deadlineMs != null ? `deadline in ${Math.max(0, Math.floor((deadlineMs - now) / 60000))} min` : 'no deadline';
    out.set(name, `stall: ${name} no output for ${Math.floor(idleMs / 60000)} min (${left})`);
  }
  return out;
}
export function report(dir, names, { tail = DEFAULT_TAIL, grep = null, sub = 'status', scope = 'named', hidden = 0, skipped = 0, servers = [], serversOf = 'yours', elapsedSec = 0, ceilingSec = 0, pause = null, wake = null, stalls = new Map() } = {}) {
  const sts = servers.map((n) => readState(dir, n)).filter(Boolean);
  const lines = [`run-bg: ${sub} — ${scope}: ${names.length} job(s)${serversOf === 'named' && sts.length ? `, ${sts.length} server(s)` : ''}${hidden ? `; ${hidden} other job(s) not shown — --all` : ''}${skipped ? `; ${skipped} server(s) not waited for — status lists them` : ''}`]; let pending = 0;
  if (pause) lines.unshift(pauseLine(pause));
  else if (wake != null) lines.unshift(`wake: ${wake}`);
  for (const name of names) {
    const st = settled(dir, readState(dir, name));
    if (!st) { lines.push(`${name}  no such job in ${dir}`); continue; }
    if (isPending(st)) pending += 1;
    lines.push(describe(st));
    if (!isPending(st)) for (const l of verdictLines(logPath(dir, name), { tail, grep })) lines.push(`  ${l}`);
    if (stalls.has(name)) lines.push(stalls.get(name));
  }
  if (!names.length) { if (!sts.length) lines.push(hidden ? `run-bg: no jobs of yours in ${dir}` : `run-bg: no jobs in ${dir}`); }
  else if (pending && pause) lines.push(`run-bg: ${names.length - pending}/${names.length} ended, ${pending} still going — paused: no further wait; they keep running, \`status\` reads them later; logs: ${dir}/<job>.log`);
  else if (pending && wake != null) lines.push(`run-bg: ${names.length - pending}/${names.length} ended, ${pending} still going — woken (a background agent finished): run \`wait\` again as your next step; logs: ${dir}/<job>.log`);
  else if (pending) lines.push(`run-bg: ${names.length - pending}/${names.length} ended, ${pending} still going${elapsedSec ? ` after ${Math.round(elapsedSec)}s (ceiling ${ceilingSec}s)` : ''} — run \`wait\` again as your next step; logs: ${dir}/<job>.log`);
  else lines.push(`run-bg: all ${names.length} ended — full output per job: \`log <job> --grep <re>\` (${dir}/<job>.log)`);
  if (sts.length) lines.push(`servers: ${sts.length} ${SERVERS_HEAD[serversOf]}`, ...sts.map(serverLine));
  return { text: lines.join('\n'), pending, paused: Boolean(pause), woken: wake ?? null };
}

// Among `jobs` (queue order): the unfinished ones, else every job (`onDisk`), else the latest batch — the jobs that ended
// within RECENT_WINDOW_SEC of the newest ending.
function current(jobs, pending, { onDisk = false } = {}) {
  const unfinished = jobs.filter((j) => pending.has(j.name));
  if (unfinished.length) return { picked: unfinished, what: 'unfinished' };
  if (onDisk || !jobs.length) return { picked: jobs, what: 'on disk' };
  const at = (j) => new Date(j.endedAt || j.queuedAt).getTime();
  const newest = Math.max(...jobs.map(at));
  return { picked: jobs.filter((j) => newest - at(j) <= RECENT_WINDOW_SEC * 1000), what: 'latest batch' };
}

// wait/status → { names, scope, hidden, servers, skipped }: named → those (a server too); --all → every owner's jobs
// (unfinished, else every job on disk); bare → the caller's own (unfinished, else its latest batch). Servers stay out of
// bare and --all: `servers` = bare: the caller's servers queued or running, lost with their command still running, or
// ended within RECENT_WINDOW_SEC; --all: every server state on disk — by name, for status's section; `skipped` = those
// queued or running, for wait's first line.
// A state without ownerPid (older runs) is nobody's: by name or --all only. hidden = the jobs --all would add.
export function pickNames(dir, requested, { all = false, owner = null } = {}) {
  if (requested.length) return { names: requested, scope: 'named', hidden: 0, servers: [], skipped: 0 };
  const states = listJobs(dir).map((j) => settled(dir, j)).sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : 1));
  const pending = new Set(states.filter(isPending).map((j) => j.name)); // one phase per job: both selections see the same
  const isMine = (j) => j.ownerPid != null && j.ownerPid === owner;
  const theirs = states.filter((j) => isServer(j) && (all || isMine(j)));
  const recent = (j) => Boolean(j.endedAt) && Date.now() - Date.parse(j.endedAt) <= RECENT_WINDOW_SEC * 1000;
  const servers = (all ? theirs : theirs.filter((j) => pending.has(j.name) || recent(j) || isOrphan(j))).map((j) => j.name).sort();
  const skipped = theirs.filter((j) => pending.has(j.name)).length;
  const jobs = states.filter((j) => !isServer(j));
  const everyone = current(jobs, pending, { onDisk: true });
  if (all) return { names: everyone.picked.map((j) => j.name), scope: `all owners, ${everyone.what}`, hidden: 0, servers, skipped };
  const mine = jobs.filter(isMine);
  const own = current(mine, pending);
  const shown = new Set(own.picked.map((j) => j.name));
  return { names: [...shown], scope: `yours (owner ${owner})${mine.length ? `, ${own.what}` : ''}`, hidden: everyone.picked.filter((j) => !shown.has(j.name)).length, servers, skipped };
}

// The bound is --max seconds or --until an instant (untilMs; past = one pass), clamped to MAX_CEILING_SEC from now. Each
// poll, the first included, in order: the pause file present (pauseState) → `paused`; every job ended (`woken` too when
// the wake file grew in that poll); the wake file (relative: from the cwd) grown past its size at the start → `woken` (a
// shrunk file lowers that size); the bound.
export async function wait(dir, requested, { maxSec = DEFAULT_MAX_SEC, untilMs = null, stallMin = DEFAULT_STALL_MIN, pauseFile = process.env.STARDUST_PAUSE_FILE, wakeFile = WAKE_FILE, tail, grep, all = false, owner = callerOwner() } = {}) {
  let ceilingSec;
  if (untilMs != null) {
    if (!Number.isFinite(untilMs)) throw new UsageError(`${UNTIL_USAGE} (got ${untilMs})\n${HELP}`);
    ceilingSec = Math.max(0, (untilMs - Date.now()) / 1000);
    if (ceilingSec > MAX_CEILING_SEC) { ceilingSec = MAX_CEILING_SEC; console.error(`run-bg: --until ${new Date(untilMs).toISOString()} clamped to ${MAX_CEILING_SEC}s from now — ${CLAMP_WHY}.`); }
  } else {
    if (!Number.isFinite(maxSec) || maxSec < 0) throw new UsageError(`run-bg: --max must be a number of seconds\n${HELP}`);
    ceilingSec = maxSec;
    if (maxSec > WAIT_NOTICE_SEC) console.error(`run-bg: --max ${maxSec} — a wait over ${WAIT_NOTICE_SEC} s buys nothing; a one-hour cache does not need it (a ${DEFAULT_MAX_SEC} s step costs about three cents and sees an ended job up to 20 minutes sooner)`);
    if (maxSec > MAX_CEILING_SEC) { ceilingSec = MAX_CEILING_SEC; console.error(`run-bg: --max ${maxSec} clamped to ${MAX_CEILING_SEC}s — ${CLAMP_WHY}.`); }
  }
  const { names, scope, hidden, skipped } = pickNames(dir, requested, { all, owner });
  const wakePath = resolve(String(wakeFile)); let wakeBase = wakeSize(wakePath); let woken = null;
  const t0 = Date.now(); let pause = null;
  for (;;) {
    pause = pauseState(pauseFile);
    if (pause) break;
    const pending = names.map((n) => settled(dir, readState(dir, n))).filter((st) => st && isPending(st));
    const size = wakeSize(wakePath);
    if (size > wakeBase) woken = wakeText(wakePath); // also with every job ended: a coincident wake is reported, not swallowed
    if (!pending.length || woken != null) break;
    wakeBase = Math.min(wakeBase, size);
    if ((Date.now() - t0) / 1000 >= ceilingSec) break;
    await sleep(Math.min(POLL_MS, Math.max(50, ceilingSec * 1000 - (Date.now() - t0))));
  }
  return report(dir, names, { tail, grep, sub: 'wait', scope, hidden, skipped, elapsedSec: (Date.now() - t0) / 1000, ceilingSec: untilMs != null ? Math.round(ceilingSec) : ceilingSec, pause, wake: woken, stalls: stallNotices(dir, names, stallMin) });
}

// Named, a server goes under servers: too (by name), with the fields a bare or --all status gives it.
export function status(dir, requested, { tail, grep, all = false, owner = callerOwner(), pauseFile = process.env.STARDUST_PAUSE_FILE } = {}) {
  const { names, scope, hidden, servers } = pickNames(dir, requested, { all, owner });
  const named = requested.length ? [...new Set(names.filter((n) => isServer(readState(dir, n))))].sort() : [];
  return report(dir, names.filter((n) => !named.includes(n)), { tail, grep, sub: 'status', scope, hidden, servers: requested.length ? named : servers, serversOf: requested.length ? 'named' : all ? 'all' : 'yours', pause: pauseState(pauseFile) });
}

export function showLog(dir, name, { tail = 40, grep = null } = {}) {
  if (!name) throw new UsageError(`run-bg: log needs a <job>\n${HELP}`);
  const p = logPath(dir, name);
  let text; try { text = readFileSync(p, 'utf8'); } catch { throw new UsageError(`run-bg: no log for ${name} at ${p}`, 2); }
  const all = text.split('\n'); if (all.length && all[all.length - 1] === '') all.pop();
  const pick = grep ? all.filter((l) => grep.test(l)) : all;
  const cap = grep ? Math.min(200, Math.max(tail, 1)) : tail;
  const out = pick.slice(-cap);
  const head = `${p}: ${all.length} lines${grep ? `, ${pick.length} match ${grep}` : ''}${pick.length > cap ? `, showing the last ${cap}` : ''}`;
  return `${head}\n${out.join('\n')}`;
}

// ---- stop, clean -------------------------------------------------------------------------------
// What of a job is alive to signal: its wrapper while queued/running (run-capped forwards a SIGTERM to the instrument's
// group), and its instrument while the recorded identity matches.
const instrumentTarget = (j) => (childAlive(j) ? [{ pid: j.childPid, ident: { start: j.childStart }, what: 'instrument' }] : []);
function jobTargets(j) {
  return [...(isPending(j) ? [{ pid: j.wrapperPid, ident: { start: j.wrapperStart, name: j.name }, what: 'wrapper' }] : []), ...instrumentTarget(j)];
}
// targets: name → [{ pid, ident, what }] — a wrapper (signalled alone: run-capped forwards a SIGTERM to the instrument's
// group) and an instrument (its whole group). Each leads its own process group (both spawn detached) and every member of
// those groups counts: a child that ignores SIGTERM outlives a leader that obeys it. SIGTERM, up to `graceMs` for the
// groups to empty, then SIGKILL to every member a fresh census finds, pass after pass, until they are empty. A signal goes
// only where a fresh look at that pid right before it still shows the identity recorded (a leader) or censused (a member:
// start time and group); a group that empties, or whose leader's pid now names another process, is not looked at again.
// `more(name)` → targets recorded since (an instrument launched as its wrapper was signalled), added and signalled the
// same way. → the members left after the last pass: [{ pid, pgid }].
async function terminate(targets, graceMs, more = () => []) {
  const groups = new Map(); // pgid → the leader's recorded start (null: an older state without one)
  const send = (x, sig, group = false) => alive(x.pid, x.ident, { fresh: true }) && signal(x.pid, sig, { group });
  const term = (x) => { groups.set(x.pid, x.ident.start ?? null); send(x, 'SIGTERM', x.what === 'instrument'); };
  const add = () => { for (const [name, t] of targets) for (const x of more(name)) if (!t.some((y) => y.pid === x.pid)) { t.push(x); term(x); } };
  const left = () => [...groups].flatMap(([pgid, start]) => {
    const m = groupMembers(pgid); const leader = m.find((x) => x.pid === pgid);
    if (!m.length || (leader && start && leader.ident.start !== start)) { groups.delete(pgid); return []; }
    return m;
  });
  for (const x of [...targets.values()].flat()) if (x.pid) term(x);
  if (!groups.size) return [];
  const t0 = Date.now();
  for (add(); left().length && Date.now() - t0 < graceMs; add()) await sleep(100);
  for (let pass = 0; pass < KILL_PASSES; pass += 1) {
    add(); const rest = left(); if (!rest.length) break;
    for (const m of rest) send(m, 'SIGKILL');
    await sleep(100);
  }
  return left().map((m) => ({ pid: m.pid, pgid: m.ident.pgid }));
}
// The survivors among a job's targets' groups, and how a line names them.
const stuckIn = (survivors, t) => survivors.filter((m) => t.some((x) => x.pid === m.pgid));
const stuckText = (stuck) => stuck.map((m) => `pid ${m.pid}${m.pid === m.pgid ? '' : ` (group ${m.pgid})`}`).join(', ');

// stop <job>… (either kind; an unknown name: exit 2 before anything is signalled) or `servers` (the caller's own servers
// queued, running, or lost with their command still running; `all`: every owner's). Once nothing of a job is left alive —
// the wrapper gone writes no more, its process groups are empty — its state records the end with the deadline's no-verdict
// marker (exit DEADLINE_EXIT, timedOut: what gate-evidence reads as no verdict) plus stopped and stoppedAt (the signal),
// whatever the command exited with — a server too: one started as a server may still have run an instrument. A job that
// recorded its own end before the signal keeps it. → { text: one line per job, code: 0, or 1 when a process survived
// SIGKILL (its state unchanged) }.
export async function stop(dir, requested, { servers = false, all = false, owner = callerOwner(), graceMs = STOP_GRACE_MS } = {}) {
  if (servers && requested.length) throw new UsageError(`run-bg: stop takes <job>… or --servers, not both\n${HELP}`);
  if (all && !servers) throw new UsageError(`run-bg: stop --all needs --servers (every owner's servers) — jobs are stopped by name\n${HELP}`);
  if (!servers && !requested.length) throw new UsageError(`run-bg: stop needs <job>… or --servers\n${HELP}`);
  let names;
  if (servers) names = listJobs(dir).filter((j) => isServer(j) && (all || (j.ownerPid != null && j.ownerPid === owner)) && (isPending(j) || isOrphan(j))).map((j) => j.name).sort();
  else {
    const unknown = requested.filter((n) => !NAME_RE.test(n) || !readState(dir, n));
    if (unknown.length) throw new UsageError(`run-bg: no such job in ${dir}: ${unknown.join(', ')} — nothing stopped`, 2);
    names = [...new Set(requested)];
  }
  if (!names.length) return { text: `run-bg: stop — no running servers ${all ? 'of any owner' : 'of yours'} in ${dir}`, code: 0 };
  // A state still spawning (no wrapper pid yet) gets one within SPAWN_GRACE_SEC, or turns lost.
  const spawning = () => names.some((n) => { const s = readState(dir, n); return s && !s.wrapperPid && phase(s) === 'queued'; });
  for (const t0 = Date.now(); spawning() && Date.now() - t0 < SPAWN_GRACE_SEC * 1000;) await sleep(100);
  const out = new Map(); const targets = new Map();
  for (const n of names) {
    const st = readState(dir, n);
    if (st && (isPending(st) || isOrphan(st))) targets.set(n, jobTargets(st));
    else out.set(n, `run-bg: ${n} is not running — ${st ? describe(st).slice(n.length).trim() : 'its state is gone'}; nothing to stop`);
  }
  const at = new Date().toISOString();
  const survivors = await terminate(targets, graceMs, (n) => { const s = readState(dir, n); return s ? instrumentTarget(s) : []; });
  let code = 0;
  for (const [n, t] of targets) {
    const stuck = stuckIn(survivors, t);
    const st = readState(dir, n);
    if (stuck.length) { code = 1; out.set(n, `run-bg: could not stop ${n} (${stuckText(stuck)} survived SIGKILL) — state unchanged`); continue; }
    if (!st) { out.set(n, `run-bg: stopped ${n} — its state file went meanwhile, nothing recorded`); continue; }
    if (st.endedAt && st.endedAt < at) { out.set(n, `run-bg: ${n} ended on its own before the stop (exit ${st.exit}) — kept`); continue; }
    const endedAt = st.endedAt ?? new Date().toISOString();
    writeState(dir, { ...st, endedAt, exit: DEADLINE_EXIT, timedOut: true, stopped: true, stoppedAt: at });
    try { appendFileSync(logPath(dir, n), `run-bg: ${n} stopped ${at} (no verdict, exit ${DEADLINE_EXIT})\n`); } catch { /* no log */ }
    out.set(n, `run-bg: stopped ${n} (${isServer(st) ? 'server' : 'job'}${st.launchedAt ? `, ran ${secondsBetween(st.launchedAt, endedAt)}s` : ', before launch'}; no verdict, exit ${DEADLINE_EXIT} recorded)`);
  }
  return { text: names.map((n) => out.get(n)).join('\n'), code };
}

// Without --all: ended and lost jobs' files go; queued/running jobs and servers, and lost jobs whose instrument still runs, stay.
// With --all: every live wrapper (own group) and every identity-matched instrument (own group) is stopped — SIGTERM,
// grace, SIGKILL — and a job's files go only once nothing of it is left alive.
export async function clean(dir, { all = false } = {}) {
  const out = []; const targets = new Map(); // name → [{ pid, ident, what }]
  for (const j of listJobs(dir)) {
    const pending = isPending(j); const orphan = !pending && isOrphan(j);
    if (!pending && !orphan) continue;
    if (!all) { out.push(`run-bg: keeping ${j.name} (${isServer(j) ? 'server, ' : ''}${pending ? phase(j) : `lost, instrument pid ${j.childPid} still running`}) — ${isServer(j) ? `\`stop ${j.name}\` or ` : ''}\`clean --all\` stops it`); continue; }
    targets.set(j.name, jobTargets(j));
  }
  const survivors = await terminate(targets, CLEAN_GRACE_MS);
  for (const [name, t] of targets) {
    const stuck = stuckIn(survivors, t);
    out.push(stuck.length ? `run-bg: could not stop ${name} (${stuckText(stuck)} survived SIGKILL) — files kept` : `run-bg: stopped ${name}`);
  }
  for (const j of listJobs(dir)) {
    if ((isPending(j) || isOrphan(j)) && (!all || stuckIn(survivors, targets.get(j.name) || []).length)) continue;
    for (const p of [statePath(dir, j.name), logPath(dir, j.name)]) { try { unlinkSync(p); } catch { /* gone */ } }
    if (!targets.has(j.name)) out.push(`run-bg: removed ${j.name}`);
  }
  return out.join('\n');
}

// ---- cli ---------------------------------------------------------------------------------------
function parse(argv) {
  const [sub, ...rest] = argv;
  const o = { dir: process.env.RUN_BG_DIR || DEFAULT_DIR, names: [], name: null, timeoutSec: DEFAULT_TIMEOUT_SEC, timeoutGiven: false, slots: Number(process.env.RUN_BG_SLOTS) || Number(process.env.STARDUST_BROWSER_SLOTS) || DEFAULT_SLOTS, lock: 'auto', kind: null, maxSec: DEFAULT_MAX_SEC, maxGiven: false, untilMs: null, tail: undefined, grep: null, all: false, servers: false, cmd: [] };
  const num = (flag, v) => { const n = Number(v); if (!Number.isFinite(n)) throw new UsageError(`run-bg: ${flag} needs a number (got ${v})\n${HELP}`); return n; };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    // A value flag never swallows a following flag (or nothing) as its value.
    const value = () => { const v = rest[i + 1]; if (v === undefined || v.startsWith('--')) throw new UsageError(`run-bg: ${a} needs a value${v === undefined ? '' : ` (got ${v})`}\n${HELP}`); i += 1; return v; };
    if (a === '--') { o.cmd = rest.slice(i + 1); break; }
    if (a === '--dir') o.dir = value();
    else if (a === '--name') o.name = value();
    else if (a === '--kind') {
      if (sub !== 'start') throw new UsageError(`run-bg: --kind is a start flag — status lists servers under servers:, stop --servers ends them\n${HELP}`);
      const v = value(); if (!KINDS.includes(v)) throw new UsageError(`run-bg: --kind must be ${KINDS.join(' or ')} (got ${v})\n${HELP}`);
      o.kind = v;
    }
    else if (a === '--servers') {
      if (sub !== 'stop') throw new UsageError(`run-bg: --servers is a stop flag — status lists servers under servers:\n${HELP}`);
      o.servers = true;
    }
    else if (a === '--timeout') {
      // wait/status once ignored it silently; wait's bound is --max, status never waits.
      if (sub === 'wait' || sub === 'status') throw new UsageError(`run-bg: --timeout is a start flag — wait takes --max <s> (default ${DEFAULT_MAX_SEC}, at most ${MAX_CEILING_SEC}) or --until <ISO>; status reports at once\n${HELP}`);
      o.timeoutSec = num(a, value()); o.timeoutGiven = true;
    }
    else if (a === '--slots') o.slots = num(a, value());
    else if (a === '--stall') {
      if (sub !== 'wait') throw new UsageError(`run-bg: --stall is a wait flag — it flags a running job whose log has not grown\n${HELP}`);
      o.stallMin = num(a, value());
    }
    else if (a === '--max') { o.maxSec = num(a, value()); o.maxGiven = true; }
    else if (a === '--until') {
      if (sub !== 'wait') throw new UsageError(`run-bg: --until is a wait flag — status reports at once; start takes --timeout <s>\n${HELP}`);
      const v = value(); o.untilMs = ISO_INSTANT.test(v) ? Date.parse(v) : NaN;
      if (!Number.isFinite(o.untilMs)) throw new UsageError(`${UNTIL_USAGE} (got ${v})\n${HELP}`);
    }
    else if (a === '--tail') o.tail = num(a, value());
    else if (a === '--grep') { const v = value(); try { o.grep = new RegExp(v); } catch (e) { throw new UsageError(`run-bg: bad --grep ${v}: ${e.message}`); } }
    else if (a === '--all') o.all = true;
    else if (a === '--lock') o.lock = 'on';
    else if (a === '--no-lock') o.lock = 'off';
    else if (a.startsWith('--')) throw new UsageError(`run-bg: unknown flag ${a}\n${HELP}`);
    else o.names.push(a);
  }
  if (!o.dir) throw new UsageError(`run-bg: --dir needs a path\n${HELP}`);
  if (o.maxGiven && o.untilMs != null) throw new UsageError(`run-bg: --max and --until are alternatives — give one\n${HELP}`);
  o.dir = resolve(o.dir);
  return { sub, o };
}

async function cli(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  const derived = derivedBrowserSlots(process.env);
  if (derived != null) { process.env.STARDUST_BROWSER_SLOTS = String(derived); process.env.RUN_BG_SLOTS_DERIVED = String(derived); }
  const { sub, o } = parse(argv);
  switch (sub) {
    case 'start': {
      const [cmd, ...args] = o.cmd;
      const kind = startKind(o.kind, o.lock);
      const sized = kind === 'job' ? await gateAllTimeout(cmd, args, { cwd: process.cwd(), given: o.timeoutGiven }) : null;
      const timeoutSec = sized ? sized.timeoutSec : o.timeoutGiven || kind === 'job' ? o.timeoutSec : SERVER_TIMEOUT_SEC;
      const r = start(o.dir, o.name, cmd, args, { kind, timeoutSec, slots: o.slots, lock: o.lock });
      if (sized) console.log(`run-bg: ${r.name} ${sized.note}`);
      if (kind === 'job') { console.log(`run-bg: queued ${r.name} → ${r.log}   (next step: node stardust/scripts/replica/run-bg.mjs wait)`); return 0; }
      if (o.kind == null) console.log(`run-bg: ${r.name}: --no-lock implies --kind server — no slot, out of a bare wait; --kind job keeps an instrument run a job`);
      if (isBrowserJob(cmd, args)) console.log(`run-bg: ${r.name}: a server whose command names a browser instrument takes no browser slot and no bare wait waits for it — --kind job if it is an instrument run`);
      console.log(`run-bg: started server ${r.name} → ${r.log}   (not waited for: \`status\` lists it under servers:, \`stop ${r.name}\` ends it${timeoutSec ? `, else its ${timeoutSec} s deadline` : ''})`);
      return 0;
    }
    case 'wait': { const r = await wait(o.dir, o.names, { maxSec: o.maxSec, untilMs: o.untilMs, stallMin: o.stallMin, tail: o.tail, grep: o.grep, all: o.all }); console.log(r.text); if (r.paused) return PAUSED_EXIT; if (!r.pending) return 0; return r.woken != null ? WAKE_EXIT : STILL_RUNNING_EXIT; }
    case 'status': { const r = status(o.dir, o.names, { tail: o.tail, grep: o.grep, all: o.all }); console.log(r.text); return 0; }
    case 'stop': { const r = await stop(o.dir, o.names, { servers: o.servers, all: o.all }); console.log(r.text); return r.code; }
    case 'log': console.log(showLog(o.dir, o.names[0], { tail: o.tail ?? 40, grep: o.grep })); return 0;
    case 'clean': console.log(await clean(o.dir, { all: o.all })); return 0;
    case '__run': await runWrapper(o.dir, o.name); return process.exitCode ?? 0;
    default: throw new UsageError(`run-bg: unknown command "${sub}"\n${HELP}`);
  }
}

// Compare by real path: a symlinked checkout or temp dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  // exitCode, not process.exit(): see run-capped.mjs — a forced exit can hang Node's platform shutdown.
  cli(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e instanceof UsageError ? e.message : `run-bg: ${e.stack || e.message}`); process.exitCode = e instanceof UsageError ? e.code : 1; });
}
