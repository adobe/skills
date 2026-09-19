#!/usr/bin/env node
/**
 * skills/deploy/scripts/served-check.mjs — the one way to read a served asset.
 *
 * Served CSS/JS/HTML on aem.page / aem.live is gzip-encoded. A bare
 * `curl -s <url> | grep <marker>` scans compressed bytes and silently matches
 * nothing — the field record is repeated false alarms ("the fix is not
 * live"), needless Code Bus re-syncs and binary dumped into context. `fetch`
 * decompresses; this helper prints the facts and grep verdict on one line.
 *
 *   node skills/deploy/scripts/served-check.mjs <url> [--grep <pattern> | --absent <pattern>] [--wait <s>] [--no-cache]
 *
 *   --grep <pattern>  regex the decoded body must match (the verdict)
 *   --absent <pattern> regex the decoded body must NOT match — the negative verdict
 *                     (exit 0 only when the status is 2xx AND grep=0; a 404 or a
 *                     network failure is never a pass)
 *   --wait <s>        poll every 3 s up to <s> seconds until the pattern matches
 *                     (replaces the bash code-sync wait loop; fails loud at the cap)
 *   --no-cache        send `Cache-Control: no-cache` (default on; `--cache` to allow)
 *
 * Output (one line): status content-encoding raw→decoded bytes last-modified age grep=<n>
 * Exit codes: 0 = pattern matched (or --absent and 2xx with grep=0, or no pattern and
 * 2xx), 1 = not matched / present / non-2xx / wait expired, 2 = usage. `last-modified` + `age` say whether a re-sync was needed;
 * the grep count is the verdict. No dependencies (Node 18+ global fetch).
 */
const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log('usage: node skills/deploy/scripts/served-check.mjs <url> [--grep <pattern> | --absent <pattern>] [--wait <seconds>] [--no-cache|--cache]');
  process.exit(args.length ? 0 : 2);
}
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const url = args.find((a) => /^https?:\/\//.test(a));
if (!url) { console.error('served-check: a URL is required'); process.exit(2); }
const pattern = opt('--grep');
const absent = opt('--absent');
if (pattern && absent) { console.error('served-check: use --grep OR --absent, not both'); process.exit(2); }
const waitS = Number(opt('--wait') || 0);
const noCache = !args.includes('--cache');
const re = pattern || absent ? new RegExp(pattern || absent) : null;
const negative = Boolean(absent);

async function probe() {
  const headers = noCache ? { 'cache-control': 'no-cache', pragma: 'no-cache' } : {};
  let res;
  try {
    res = await fetch(url, { headers, redirect: 'follow' });
  } catch (err) {
    return { status: 0, line: `000 ${url} — ${err.message}`, ok: false };
  }
  const buf = Buffer.from(await res.arrayBuffer()); // already decoded by fetch
  const body = buf.toString('utf8');
  const rawLen = res.headers.get('content-length') || '?';
  const enc = res.headers.get('content-encoding') || 'identity';
  const lm = res.headers.get('last-modified') || '-';
  const age = res.headers.get('age') || '-';
  const served = res.headers.get('x-served-by') || res.headers.get('server') || '-';
  const hits = re ? (body.match(new RegExp(re.source, `${re.flags.replace('g', '')}g`)) || []).length : -1;
  const ok = res.status >= 200 && res.status < 300 && (re ? (negative ? hits === 0 : hits > 0) : true);
  const line = `${res.status} ${enc} ${rawLen}→${buf.length}B last-modified=${lm.replace(/ /g, '_')} age=${age} via=${served}${re ? ` grep=${hits}` : ''} ${url}`;
  return { status: res.status, line, ok };
}

const deadline = Date.now() + waitS * 1000;
for (;;) {
  const r = await probe();
  console.log(r.line);
  if (r.ok) process.exit(0);
  if (!waitS || Date.now() >= deadline) {
    if (waitS) console.error(`served-check: pattern ${negative ? 'still served' : 'not served'} after ${waitS}s — check the Code Sync POST / installation (da-deploy-protocol.md step 0)`);
    process.exit(1);
  }
  await new Promise((r2) => setTimeout(r2, 3000));
}
