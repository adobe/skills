#!/usr/bin/env node
/**
 * deploy/fresh-check.mjs — has the new version reached the delivery host? One bounded poll that compares the
 * decoded body, so propagation is measured instead of guessed.
 *
 * Why: propagation waits were bare `curl -sf` polls. Code and CSS on the delivery hosts are served gzip-encoded,
 * so `curl | grep` without --compressed scans the compressed bytes and silently never matches (a recorded
 * hands-off run had gzip-blind polls in seven agents), and deploy-batch.mjs checks status codes only. Node's
 * fetch decodes gzip / br / deflate per content-encoding, so this check sees the text a browser sees. One shipped
 * check replaces every hand-written poll.
 *
 * Usage: node stardust/scripts/deploy/fresh-check.mjs <url> (--expect-file <path> | --expect-sha <hex> | --grep <marker>)
 *          [--max-s 180] [--every-s 5] [--json]
 *   <url>          the http(s) URL to poll (redirects followed, no local cache, per-check timeout min(30 s, time left), ≥ 1 s)
 *   --expect-file  the file the URL should now serve: sha256 of its normalised text must equal the body's (read once)
 *   --expect-sha   sha256 hex of the normalised expected body, case-insensitive; a prefix of ≥ 12 hex chars is accepted
 *   --grep         a literal marker (not a regex) the normalised body must contain
 *   --max-s        deadline in seconds (default 180; 0 = exactly one check); decimals allowed
 *   --every-s      wait between checks in seconds (default 5, > 0); decimals allowed
 *   --json         print one JSON object instead of the line
 *   Exactly one of --expect-file, --expect-sha, --grep. Normalised = every whitespace run is one space, ends trimmed.
 *   A non-2xx answer or a fetch error makes that check not fresh. Never an unbounded wait.
 *
 * Output: one stdout line `fresh <url> after <n>s` or `stale <url> after <n>s` (n = whole seconds elapsed). On
 *   stale, one stderr line naming the last check: `last check: HTTP 404` | `last check: sha256 <12 hex>… ≠ expected
 *   <12 hex>…` | `last check: marker not found` | `last check: fetch error: <message>`.
 *   --json keys, in order: state ("fresh"|"stale"), url, after, checks, mode ("file"|"sha"|"grep"), status (last
 *   HTTP status or null), sha (sha256 of the last normalised body or null), expected (the expected sha, or the
 *   marker), error (last fetch error message or null).
 * Raw fallback without node: curl -s --compressed <url> | grep -F '<marker>' — never a bare `curl -sf <url> | grep`,
 *   which scans the compressed bytes.
 * Writes nothing.
 *
 * Exit: 0 fresh · 3 stale after the deadline · 2 usage (no mode or two, a non-http(s) url, a bad number, a sha not
 *   hex or shorter than 12 chars, an empty marker, an unreadable --expect-file).
 */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: fresh-check.mjs <url> (--expect-file <path> | --expect-sha <hex> | --grep <marker>) [--max-s 180] [--every-s 5] [--json]';
const MODES = { '--expect-file': 'file', '--expect-sha': 'sha', '--grep': 'grep' };
const NUMBER = /^(\d+(\.\d*)?|\.\d+)$/;
const MAX_TIMEOUT_MS = 30000;
const MIN_TIMEOUT_MS = 1000;

export const normalise = (text) => String(text).replace(/\s+/g, ' ').trim();
export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Parse argv (without node and the script). Returns { url, mode, value, maxS, everyS, json } or { error }.
 * `value` is the --expect-file path, the lower-cased --expect-sha hex or the --grep marker as given.
 */
export function parseArgs(argv) {
  const opts = { url: null, mode: null, value: null, maxS: 180, everyS: 5, json: false };
  const seen = new Set();
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') { opts.json = true; continue; }
    if (a in MODES || a === '--max-s' || a === '--every-s') {
      if (seen.has(a)) return { error: `${a} given twice` };
      seen.add(a);
      if (i + 1 >= argv.length) return { error: `${a} needs a value` };
      const v = argv[i += 1];
      if (a in MODES) {
        if (opts.mode) return { error: 'give exactly one of --expect-file, --expect-sha, --grep' };
        opts.mode = MODES[a];
        opts.value = v;
      } else {
        if (!NUMBER.test(v)) return { error: `${a} takes seconds, a number ≥ 0 (got ${v})` };
        const n = Number(v);
        if (a === '--every-s' && !(n > 0)) return { error: `--every-s must be > 0 (got ${v})` };
        opts[a === '--max-s' ? 'maxS' : 'everyS'] = n;
      }
      continue;
    }
    if (a.startsWith('-')) return { error: `unknown arg: ${a}` };
    positional.push(a);
  }
  if (positional.length !== 1) return { error: positional.length ? `one url only (got ${positional.length})` : 'missing <url>' };
  let parsed;
  try { parsed = new URL(positional[0]); } catch { parsed = null; }
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) return { error: `<url> must be http(s) (got ${positional[0]})` };
  opts.url = positional[0];
  if (!opts.mode) return { error: 'give exactly one of --expect-file, --expect-sha, --grep' };
  if (opts.mode === 'sha') {
    if (!/^[0-9a-f]{12,64}$/i.test(opts.value)) return { error: `--expect-sha takes 12 to 64 hex chars (got ${opts.value})` };
    opts.value = opts.value.toLowerCase();
  }
  // an empty marker is a substring of every body: it would report fresh without measuring anything
  if (opts.mode === 'grep' && !normalise(opts.value)) return { error: '--grep needs a non-blank marker' };
  if (opts.mode === 'file' && !opts.value) return { error: '--expect-file needs a path' };
  return opts;
}

/**
 * Does this body match? `expected` is the full sha (file), the sha or prefix (sha) or the marker (grep).
 * Returns { fresh, sha } — sha is the sha256 of the normalised body.
 */
export function isFresh(mode, expected, body) {
  const text = normalise(body);
  const sha = sha256(text);
  if (mode === 'grep') return { fresh: text.includes(normalise(expected)), sha };
  if (mode === 'sha') return { fresh: sha.startsWith(String(expected).toLowerCase()), sha };
  return { fresh: sha === expected, sha };
}

/** The stderr line for a stale verdict, from the last observation. */
export function lastCheckLine(mode, expected, last) {
  if (last.error) return `last check: fetch error: ${last.error}`;
  if (last.status === null || last.status < 200 || last.status > 299) return `last check: HTTP ${last.status}`;
  if (mode === 'grep') return 'last check: marker not found';
  return `last check: sha256 ${last.sha.slice(0, 12)}… ≠ expected ${String(expected).slice(0, 12)}…`;
}

const errorMessage = (e) => {
  const cause = e && e.cause ? (e.cause.code || e.cause.message) : '';
  const msg = (e && e.message) || String(e);
  return (cause && !msg.includes(cause) ? `${msg} (${cause})` : msg).replace(/\s+/g, ' ').trim();
};

/** One check: { fresh, status, sha, error }. */
async function checkOnce(url, mode, expected, timeoutMs, fetchImpl) {
  try {
    const res = await fetchImpl(url, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (res.status < 200 || res.status > 299) {
      try { await res.body?.cancel(); } catch { /* the status is the observation */ }
      return { fresh: false, status: res.status, sha: null, error: null };
    }
    const { fresh, sha } = isFresh(mode, expected, await res.text());
    return { fresh, status: res.status, sha, error: null };
  } catch (e) {
    return { fresh: false, status: null, sha: null, error: errorMessage(e) };
  }
}

/**
 * Poll until fresh or until the next check would pass maxS: the first check at once, then one every everyS.
 * Returns { fresh, checks, elapsedMs, last }.
 */
export async function poll({ url, mode, expected, maxS, everyS }, { fetchImpl = fetch, now = Date.now } = {}) {
  const start = now();
  const deadline = maxS * 1000;
  let checks = 0;
  let last;
  for (;;) {
    const left = deadline - (now() - start);
    last = await checkOnce(url, mode, expected, Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, left)), fetchImpl);
    checks += 1;
    if (last.fresh || now() - start + everyS * 1000 > deadline) break;
    await new Promise((r) => setTimeout(r, everyS * 1000));
  }
  return { fresh: last.fresh, checks, elapsedMs: now() - start, last };
}

/** The CLI: returns the exit code. */
async function main(argv) {
  // --help prints this file's usage header, so an agent never reads the source to learn the flags.
  if (argv.includes('--help') || argv.includes('-h')) {
    const src = readFileSync(new URL(import.meta.url), 'utf8');
    const header = src.match(/\/\*\*[\s\S]*?\*\//);
    console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
    return 0;
  }
  const opts = parseArgs(argv);
  if (opts.error) { console.error(`fresh-check: ${opts.error} — ${USAGE}`); return 2; }
  let expected = opts.value;
  if (opts.mode === 'file') {
    try { expected = sha256(normalise(readFileSync(opts.value, 'utf8'))); } catch (e) {
      console.error(`fresh-check: cannot read --expect-file ${opts.value} (${e.code || e.message}) — ${USAGE}`);
      return 2;
    }
  }
  const r = await poll({ ...opts, expected });
  const state = r.fresh ? 'fresh' : 'stale';
  const after = Math.round(r.elapsedMs / 1000);
  if (opts.json) {
    console.log(JSON.stringify({ state, url: opts.url, after, checks: r.checks, mode: opts.mode, status: r.last.status, sha: r.last.sha, expected, error: r.last.error }));
  } else {
    console.log(`${state} ${opts.url} after ${after}s`);
  }
  if (!r.fresh) console.error(lastCheckLine(opts.mode, expected, r.last));
  return r.fresh ? 0 : 3;
}

const SELF = fileURLToPath(import.meta.url);
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
