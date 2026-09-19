#!/usr/bin/env node
/**
 * skills/deploy/scripts/served-check.mjs — the one way to read a served asset.
 *
 * Served CSS/JS/HTML on aem.page / aem.live is gzip-encoded. A bare
 * `curl -s <url> | grep <marker>` scans compressed bytes and silently matches
 * nothing — the field record is repeated false alarms ("the fix is not
 * live"), needless Code Bus re-syncs and binary dumped into context. `fetch`
 * decompresses; this helper prints the facts and the verdict on one line, and
 * with `--wait` it IS the propagation waiter (replaces `sleep N; <gate>`).
 *
 *   node skills/deploy/scripts/served-check.mjs <url> [--grep <pattern> | --absent <pattern> | --same-as <file>] [--wait <s>] [--no-cache|--cache]
 *
 *   --grep <pattern>   regex the decoded body must match (the verdict)
 *   --absent <pattern> regex the decoded body must NOT match — the negative verdict
 *                      (exit 0 only when the status is 2xx AND grep=0; a 404 or a
 *                      network failure is never a pass)
 *   --same-as <file>   the decoded served bytes must equal the local file — the
 *                      "does the origin serve what I shipped" check for block CSS/JS
 *                      before a gate; prints `sha=match|differ (served N B / local M B)`
 *   --wait <s>         poll every 3 s up to <s> seconds until the verdict is a pass
 *   --no-cache         send `Cache-Control: no-cache` (default on; `--cache` to allow)
 *
 * Output (one line per probe): status content-encoding raw→decoded bytes last-modified age via grep=<n>|sha=…
 * Exit codes — the run-capped convention (no verdict is not a FAIL):
 *   0   pass (pattern matched / absent / bytes equal / no pattern and 2xx)
 *   1   served but WRONG — a verdict from the origin: 2xx without the pattern (or with
 *       the --absent one, or bytes differ), any 4xx, or an `x-error` header
 *   124 NO verdict — `--wait` expired, or (without --wait) a 5xx / network failure:
 *       re-run, or check the Code Sync POST / installation (da-deploy-protocol.md step 0)
 *   2   usage
 * `last-modified` + `age` say whether a re-sync was needed. No dependencies (Node 18+ fetch).
 * Polls the EDS origin only (aem.page / aem.live) — never the source site.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DEADLINE_EXIT = 124;
const POLL_MS = Number(process.env.SERVED_CHECK_POLL_MS) || 3000; // fixture tests shorten the poll
const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log('usage: node skills/deploy/scripts/served-check.mjs <url> [--grep <pattern> | --absent <pattern> | --same-as <file>] [--wait <seconds>] [--no-cache|--cache]\n  exit 0 pass · 1 served but wrong (pattern / bytes / 4xx / x-error) · 124 no verdict (wait expired, 5xx, network) · 2 usage');
  process.exit(args.length ? 0 : 2);
}
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const url = args.find((a) => /^https?:\/\//.test(a));
if (!url) { console.error('served-check: a URL is required'); process.exit(2); }
const pattern = opt('--grep');
const absent = opt('--absent');
const sameAs = opt('--same-as');
if ([pattern, absent, sameAs].filter(Boolean).length > 1) { console.error('served-check: use ONE of --grep, --absent, --same-as'); process.exit(2); }
const waitS = Number(opt('--wait') || 0);
const noCache = !args.includes('--cache');
const re = pattern || absent ? new RegExp(pattern || absent) : null;
const negative = Boolean(absent);
let local = null;
if (sameAs) {
  try { local = readFileSync(sameAs); } catch (err) { console.error(`served-check: cannot read --same-as file ${sameAs}: ${err.message}`); process.exit(2); }
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);

/** One probe → { verdict: 'pass' | 'wrong' | 'noverdict', line }. */
async function probe() {
  const headers = noCache ? { 'cache-control': 'no-cache', pragma: 'no-cache' } : {};
  let res;
  try {
    res = await fetch(url, { headers, redirect: 'follow' });
  } catch (err) {
    return { verdict: 'noverdict', line: `000 ${url} — ${err.message}` };
  }
  const buf = Buffer.from(await res.arrayBuffer()); // already decoded by fetch
  const body = buf.toString('utf8');
  const rawLen = res.headers.get('content-length') || '?';
  const enc = res.headers.get('content-encoding') || 'identity';
  const lm = res.headers.get('last-modified') || '-';
  const age = res.headers.get('age') || '-';
  const served = res.headers.get('x-served-by') || res.headers.get('server') || '-';
  const xerr = res.headers.get('x-error');
  const ok2xx = res.status >= 200 && res.status < 300;
  let verdictField = '';
  let matched = true;
  if (re) {
    const hits = (body.match(new RegExp(re.source, `${re.flags.replace('g', '')}g`)) || []).length;
    verdictField = ` grep=${hits}`;
    matched = negative ? hits === 0 : hits > 0;
  } else if (local) {
    const same = buf.equals(local);
    verdictField = ` sha=${same ? 'match' : `differ (served ${buf.length} B / local ${local.length} B)`} ${sha(buf)}/${sha(local)}`;
    matched = same;
  }
  const line = `${res.status} ${enc} ${rawLen}→${buf.length}B last-modified=${lm.replace(/ /g, '_')} age=${age} via=${served}${xerr ? ` x-error=${xerr}` : ''}${verdictField} ${url}`;
  if (xerr) return { verdict: 'wrong', line };
  if (ok2xx) return { verdict: matched ? 'pass' : 'wrong', line };
  if (res.status >= 500) return { verdict: 'noverdict', line };
  return { verdict: 'wrong', line }; // 3xx after redirects / 4xx — the origin answered, and not with the asset
}

const what = re ? (negative ? 'pattern still served' : 'pattern not served') : local ? 'served bytes differ from the local file' : 'asset not served 2xx';
const deadline = Date.now() + waitS * 1000;
for (;;) {
  const r = await probe();
  console.log(r.line);
  if (r.verdict === 'pass') process.exit(0);
  if (waitS && Date.now() < deadline) { await new Promise((r2) => setTimeout(r2, POLL_MS)); continue; }
  if (waitS) {
    console.error(`served-check: ${what} after ${waitS}s — no verdict (exit ${DEADLINE_EXIT}): re-run, or check the Code Sync POST / installation (da-deploy-protocol.md step 0)`);
    process.exit(DEADLINE_EXIT);
  }
  if (r.verdict === 'noverdict') {
    console.error(`served-check: no verdict (5xx / network) — exit ${DEADLINE_EXIT}; re-run or add --wait <s>`);
    process.exit(DEADLINE_EXIT);
  }
  console.error(`served-check: ${what} (exit 1 — the origin answered; what it serves is wrong)`);
  process.exit(1);
}
