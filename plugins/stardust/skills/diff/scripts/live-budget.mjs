/**
 * skills/diff/scripts/live-budget.mjs
 *
 * The shared per-host live budget + live lock for the source-site instruments:
 * live-session.mjs `gotoLive` (every gate/diff/replica/reskin/dynamics caller)
 * imports it. Some origins score SESSIONS, not requests (admitted-then-
 * escalated): two tools on one origin within a minute, or a rate that climbs,
 * turns an admitted session into a block — so pacing and the lock are ONE
 * module, never per-instrument copies. extract/scripts/crawl.mjs ships alone
 * into projects and carries a crawl-local copy of HostBudget / tuneBudget /
 * persistBudget / acquireLiveLock (same shapes, same file formats; keep them in
 * step by hand). The published-origin tools do NOT import it: qa's paced browse
 * / fetch path uses qa/scripts/lib.mjs's per-host limiter and rollout verify an
 * inline 429/503 retry — the same 429-is-infrastructure rule, a separate budget.
 * Importers: skills/diff/scripts/live-session.mjs
 *   (the line above is checked by skills/diff/scripts/test/live-budget.test.mjs)
 *
 *   takeNavigation(host, { crawlDelay })
 *     Resolves when the next navigation to <host> may start: token bucket
 *     ≤ 10/min AND ≥ 3 s gap (BUDGET_DEFAULT), tightened by a ceiling learned
 *     earlier (stardust/live-budget.json) and by a robots.txt Crawl-delay when
 *     one is passed. One bucket per host per process, serialised across
 *     callers; a ceiling already halved by a 429 is never loosened.
 *   recordRateLimit(host, retryAfter, { tool })
 *     A BARE 429 (no edge signature — challengeMarker null): halve the rate,
 *     double the gap (≤ 60 s), drain the tokens and persist merge-by-host to
 *     stardust/live-budget.json. Returns the ms to wait before the ONE retry
 *     (Retry-After honoured, capped at 60 s).
 *   acquireLiveLock(host, tool)
 *     stardust/.work/live-<host>.lock (run-lock.mjs's shape and directory,
 *     pid liveness): a second live tool on the same origin throws
 *     LiveLockError (errorClass 'LiveLockError') unless STARDUST_LIVE_FORCE=1,
 *     which WARNs and proceeds. Idempotent per host per process; released on
 *     process exit or via `.release()`.
 *
 * stardust/live-budget.json — { "<host>": { navPerMin, minGapMs, learnedAt,
 *   learnedBy, lastStatus } } (tracked; stardust/reference/artifact-map.md).
 *   STARDUST_LIVE_BUDGET overrides the file, STARDUST_LIVE_LOCK_DIR the lock
 *   dir — both default cwd-relative, like live-session's STORAGE_STATE_PATH.
 *
 * Dependency-free (node:fs, node:path); importing this module runs nothing.
 * Exports (for evals/fixtures): BUDGET_DEFAULT, HostBudget, parseRetryAfter,
 *   mergeLiveBudget, tuneBudget, budgetFor, takeNavigation, recordRateLimit,
 *   acquireLiveLock, LIVE_BUDGET_PATH, LIVE_LOCK_DIR.
 */

/* eslint-disable no-await-in-loop, no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export const LIVE_BUDGET_PATH = process.env.STARDUST_LIVE_BUDGET || 'stardust/live-budget.json';
export const LIVE_LOCK_DIR = process.env.STARDUST_LIVE_LOCK_DIR || 'stardust/.work';

// ---- per-host live budget (crawl.mjs HostBudget — same shape) ----
export const BUDGET_DEFAULT = { navPerMin: 10, minGapMs: 3000 };
/**
 * Token bucket + minimum gap, serialised across callers. `now`/`sleep` are
 * injectable (fixtures drive it with a fake clock).
 */
export class HostBudget {
  constructor({ navPerMin = BUDGET_DEFAULT.navPerMin, minGapMs = BUDGET_DEFAULT.minGapMs, source = 'default', now = Date.now, sleep = (ms) => new Promise((r) => { setTimeout(r, ms); }) } = {}) {
    Object.assign(this, { navPerMin, minGapMs, source, now, sleep, tokens: navPerMin, lastRefill: now(), lastNav: -Infinity, rateLimits: 0, waitedMs: 0, queue: Promise.resolve() });
  }
  /** Resolve when the next navigation may start (one caller at a time). */
  take() {
    const run = async () => {
      for (;;) {
        const t = this.now();
        this.tokens = Math.min(this.navPerMin, this.tokens + ((t - this.lastRefill) * this.navPerMin) / 60000);
        this.lastRefill = t;
        const wait = Math.max(0, this.lastNav + this.minGapMs - t, this.tokens >= 1 ? 0 : ((1 - this.tokens) * 60000) / this.navPerMin);
        if (wait <= 0) { this.tokens -= 1; this.lastNav = t; return; }
        this.waitedMs += wait;
        await this.sleep(Math.ceil(wait));
      }
    };
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    return p;
  }
  /** A bare 429: halve the rate, double the gap (≤ 60 s), drain tokens. Returns the ms to wait before the ONE retry. */
  rateLimited(retryAfterSec) {
    this.navPerMin = Math.max(1, Math.floor(this.navPerMin / 2));
    this.minGapMs = Math.min(60000, this.minGapMs * 2);
    this.tokens = 0; this.rateLimits += 1; this.source = 'rate-limited';
    return retryAfterSec ? Math.min(60, retryAfterSec) * 1000 : Math.min(60000, this.minGapMs * 4);
  }
  toJSON() { return { navPerMin: this.navPerMin, minGapMs: this.minGapMs, source: this.source }; }
}
/** Retry-After: seconds or an HTTP date → seconds (null when absent/unparseable). */
export function parseRetryAfter(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n >= 0 ? n : null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - Date.now()) / 1000)) : null;
}
/** stardust/live-budget.json — merge-by-host: { "<host>": { navPerMin, minGapMs, learnedAt, learnedBy, lastStatus } }. */
export function mergeLiveBudget(prev, host, entry) {
  const out = prev && typeof prev === 'object' ? { ...prev } : {};
  out[host] = { ...(out[host] || {}), ...entry };
  return out;
}
function readLearned(file, host) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8'))[host] || null : null; } catch { return null; }
}
/** Tighten `budget` in place: stricter of current / learned (live-budget.json) / robots Crawl-delay. A 429 already taken is never loosened. */
export function tuneBudget(budget, host, crawlDelay = null, file = LIVE_BUDGET_PATH) {
  const learned = readLearned(file, host);
  if (learned && ((learned.navPerMin || Infinity) < budget.navPerMin || (learned.minGapMs || 0) > budget.minGapMs)) {
    budget.navPerMin = Math.min(budget.navPerMin, learned.navPerMin || budget.navPerMin); budget.minGapMs = Math.max(budget.minGapMs, learned.minGapMs || 0);
    if (!budget.rateLimits) budget.source = 'live-budget.json';
  }
  if (crawlDelay && crawlDelay * 1000 > budget.minGapMs) { budget.minGapMs = crawlDelay * 1000; if (!budget.rateLimits) budget.source = 'robots Crawl-delay'; }
  budget.tokens = Math.min(budget.tokens, budget.navPerMin);
  return budget;
}
// one bucket per host per process — every page/context of one instrument shares it
const budgets = new Map();
/** The process-wide HostBudget for `host` (created and tuned on first use; re-tuned when a Crawl-delay arrives later). */
export function budgetFor(host, { crawlDelay = null, file = LIVE_BUDGET_PATH, now, sleep } = {}) {
  const key = String(host).toLowerCase();
  let b = budgets.get(key);
  if (!b) { b = new HostBudget({ ...BUDGET_DEFAULT, source: 'default', ...(now ? { now } : {}), ...(sleep ? { sleep } : {}) }); budgets.set(key, b); }
  return tuneBudget(b, key, crawlDelay, file);
}
/** Await the budget before EVERY navigation and solve-window reload to `host`. */
export function takeNavigation(host, opts = {}) { return budgetFor(host, opts).take(); }
/**
 * A bare 429 from `host`: halve + persist (merge-by-host). Returns the ms to
 * wait before the ONE retry. `retryAfter` is the raw header value (or null).
 */
export function recordRateLimit(host, retryAfter = null, { tool = 'live-session', file = LIVE_BUDGET_PATH } = {}) {
  const key = String(host).toLowerCase();
  const budget = budgetFor(key, { file });
  const waitMs = budget.rateLimited(parseRetryAfter(retryAfter));
  try {
    const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, `${JSON.stringify(mergeLiveBudget(prev, key, { navPerMin: budget.navPerMin, minGapMs: budget.minGapMs, learnedAt: new Date().toISOString(), learnedBy: tool, lastStatus: 429 }), null, 2)}\n`);
  } catch (e) { console.error(`[live-budget] WARN could not persist live budget: ${e.message}`); }
  return waitMs;
}

// ---- per-host live lock (stardust/.work/live-<host>.lock — run-lock.mjs's shape and directory) ----
const held = new Map();
/**
 * One live-hitting tool per origin at a time. Throws LiveLockError when another
 * live process holds `host` (STARDUST_LIVE_FORCE=1 → WARN and proceed).
 * Returns { file, host, release }; a second call for the same host in this
 * process returns the handle already held.
 */
export function acquireLiveLock(host, tool = 'live-session', { dir = LIVE_LOCK_DIR } = {}) {
  const key = String(host).toLowerCase();
  if (held.has(key)) return held.get(key);
  const file = join(dir, `live-${key}.lock`);
  mkdirSync(dir, { recursive: true });
  if (existsSync(file)) {
    let holder = null;
    try { holder = JSON.parse(readFileSync(file, 'utf8')); } catch { holder = null; }
    let alive = false;
    if (holder && holder.pid && holder.pid !== process.pid) { try { process.kill(holder.pid, 0); alive = true; } catch { alive = false; } }
    if (alive) {
      const msg = `${key} is being hit by ${holder.tool || 'another live tool'} (pid ${holder.pid}, since ${holder.startedAt}) — one live tool per origin at a time; wait for it, or STARDUST_LIVE_FORCE=1 to override`;
      if (process.env.STARDUST_LIVE_FORCE === '1') console.error(`[live-budget] WARN live lock overridden: ${msg}`);
      else { const err = new Error(msg); err.name = 'LiveLockError'; err.errorClass = 'LiveLockError'; err.host = key; err.holder = holder; throw err; }
    }
  }
  writeFileSync(file, JSON.stringify({ host: key, pid: process.pid, tool, startedAt: new Date().toISOString() }));
  const handle = { file, host: key, release: () => { held.delete(key); try { unlinkSync(file); } catch { /* already gone */ } } };
  held.set(key, handle);
  process.on('exit', handle.release);
  return handle;
}
