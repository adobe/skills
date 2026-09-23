#!/usr/bin/env node
/**
 * deploy-batch.mjs — resumable, concurrent PUT → preview → live driver for DA.
 *
 * Solves the "no bundled batch driver" gap (stardust multitest finding #4):
 * the deploy/rollout docs say "long batches run in the background, re-drive
 * FAILs" but shipped no runnable driver, so every operator hand-rolled a serial
 * bash loop that (a) doesn't parallelise, (b) loses its log on restart, and
 * (c) re-PUTs pages that are already live. A transient API blip mid-run then
 * left a half-deployed tree with no record of what succeeded.
 *
 * This driver:
 *   - reads/writes a PERSISTENT ledger (default content/.deploy-ledger.json) so
 *     a re-run skips pages already LIVE (verified on the delivery tree), and
 *     only re-drives the failures;
 *   - runs PUT → preview → live with a bounded concurrency pool;
 *   - retries 000 / 408 / 429 / 5xx with capped exponential backoff — and, on
 *     the admin calls (PUT source, POST preview, POST live), a 401 the same way;
 *   - APPENDS to its log (never truncates), so the record survives a restart;
 *   - verifies the delivered .plain.html (200 + 0 about:error) before flipping a
 *     page to `live` — admin 200 != delivered (guardrail #6/#13).
 *
 * 401 policy — the same as da-media-upload.mjs (an expired token once left an
 * 894-row batch failing file by file for hours; a valid token can be answered
 * 401 under a concurrent burst, so one 401 must not halt):
 *   preflight — if the token is a JWT whose `exp` has passed, exit 3 before any
 *       request, naming the expiry (a non-JWT token, or one without exp, is
 *       simply tried).
 *   any 401 from the admin API — retried with the same bounded backoff as a 429.
 *   a 401 that persists through its retries on ANY page HALTS the batch: no new
 *       page starts, pages already in flight finish, the ledger is persisted
 *       (lock-safe), one stderr line
 *         HALT <path> 401 after <n> attempts — refresh <the token's variable or file> and re-run: <the same command>
 *       and exit 3. The halted page keeps its previous ledger status (`attempts`
 *       incremented), the pages not attempted keep theirs — no page is ever
 *       marked put-fail / preview-fail / live-fail because of a 401 (it prints
 *       HALT, not FAIL). The same command resumes from the ledger.
 *
 * Exit codes: 0 every page live (previewed with --no-publish); 1 some pages
 *   failed for a reason other than a 401 (re-run the same command to re-drive
 *   them — succeeded pages are skipped); 2 usage error or fatal; 3 token halt
 *   (expired JWT before any request, or a 401 that persisted through its
 *   retries — refresh the token and re-run the same command).
 *
 * Token: from the environment variable named by --token-env (default DA_TOKEN),
 * or from --token-file <path> (read once at start, trimmed; never both flags — the
 * same two sources as da-media-upload.mjs). Never printed, never part of the
 * re-run command, never written to the ledger or the log; the expiry and HALT
 * lines name the variable or the file, never the value.
 *
 * Idempotent: PUT/preview/live are all safe to repeat. Safe to Ctrl-C and re-run.
 *
 * Usage:
 *   DA_TOKEN=… node deploy-batch.mjs --org <org> --repo <repo> --branch <branch> \
 *     --content content [--paths list.txt] [--concurrency 4] [--no-publish] \
 *     [--force] [--ledger path] [--log path] [--retries 4] [--backoff-ms 500] \
 *     [--token-env DA_TOKEN | --token-file <path>]
 *
 * --content   dir of *.html body-fragment files (default: content). Each file's
 *             path relative to this dir, minus .html, is its DA/web path.
 * --paths     optional newline-delimited file of web paths (no extension) to
 *             restrict the run to a subset (re-drive only these).
 * --no-publish  preview only; do not POST /live/ (query-index won't build — see #2).
 * --force     ignore the ledger; re-drive every page.
 * --concurrency  parallel pages in flight (default 4; DA admin tolerates ~4-6).
 * --retries   attempts after the first for 000/408/429/5xx and 401 (default 4).
 * --backoff-ms  base delay of the capped exponential backoff (default 500).
 * --token-env  environment variable holding the token (default DA_TOKEN).
 * --token-file read the token from this file instead (one of the two flags, never
 *             both; a missing or empty file is a usage error, exit 2).
 *
 * Test hooks (environment, read once at start; the production defaults are
 * unchanged when unset):
 *   DA_SOURCE_BASE        DA source API base    (default https://admin.da.live/source)
 *   AEM_ADMIN_BASE        admin API base        (default https://admin.hlx.page)
 *   DEPLOY_VERIFY_ORIGIN  origin for the delivered .plain.html check
 *                         (default https://<branch>--<repo>--<org>.aem.live, .aem.page with --no-publish)
 *
 * No external deps — uses Node's global fetch/FormData/Blob (Node 18+).
 */
import { readFile, appendFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { mergeLedger } from './file-lock.mjs';
// The sibling uploader guards its CLI behind a main-module check, so the import runs nothing.
import { jwtExpiry } from './da-media-upload.mjs';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

const DA_SRC = process.env.DA_SOURCE_BASE || 'https://admin.da.live/source';
const ADMIN = process.env.AEM_ADMIN_BASE || 'https://admin.hlx.page';
const VERIFY_ORIGIN = process.env.DEPLOY_VERIFY_ORIGIN || '';
const TOKEN_EXIT = 3;

function parseArgs(argv) {
  const a = { content: 'content', concurrency: 4, publish: true, force: false, retries: 4, backoffMs: 500 };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    const next = () => argv[(i += 1)];
    if (k === '--org') a.org = next();
    else if (k === '--repo') a.repo = next();
    else if (k === '--branch') a.branch = next();
    else if (k === '--content') a.content = next();
    else if (k === '--paths') a.paths = next();
    else if (k === '--ledger') a.ledger = next();
    else if (k === '--log') a.log = next();
    else if (k === '--concurrency') a.concurrency = Math.max(1, +next() || 4);
    else if (k === '--retries') a.retries = Math.max(0, +next() || 4);
    else if (k === '--backoff-ms') a.backoffMs = Math.max(0, +next() || 500);
    else if (k === '--no-publish') a.publish = false;
    else if (k === '--force') a.force = true;
    else if (k === '--token-env') a.tokenEnv = next();
    else if (k === '--token-file') a.tokenFile = next();
    else throw new Error(`unknown arg: ${k}`);
  }
  if (!a.org || !a.repo || !a.branch) throw new Error('--org, --repo and --branch are required');
  // The token source: one variable (default DA_TOKEN) or one file, never both — the uploader's rule. The
  // file is read here, once, before anything else runs; the value lives on `token` only and every message
  // names the source (tokenLabel), never the value.
  if (a.tokenEnv && a.tokenFile) throw new Error('give at most one of --token-env / --token-file');
  a.tokenEnv ||= 'DA_TOKEN';
  if (a.tokenFile) {
    let raw;
    try { raw = readFileSync(a.tokenFile, 'utf8'); } catch (e) { throw new Error(`cannot read --token-file ${a.tokenFile}: ${e.message}`); }
    a.token = raw.trim();
    if (!a.token) throw new Error(`--token-file ${a.tokenFile} is empty`);
  } else {
    a.token = process.env[a.tokenEnv];
    if (!a.token) throw new Error(`missing token in env ${a.tokenEnv}`);
  }
  a.ledger ||= path.join(a.content, '.deploy-ledger.json');
  a.log ||= path.join(a.content, '.deploy-log.jsonl');
  return a;
}

// How the messages name the token and say how to refresh it — the variable or the file, never the value.
const tokenLabel = (a) => (a.tokenFile ? `the token in ${a.tokenFile}` : a.tokenEnv);
const refreshHint = (a) => (a.tokenFile ? `write a fresh token to ${a.tokenFile}` : `refresh ${a.tokenEnv}`);
// The exact command to re-run once the token is fresh: same script, same arguments (the token itself is
// never on the command line — it comes from the environment variable, or from the --token-file path).
// Same helpers as da-media-upload.
const shellQuote = (s) => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);
const rerunCommand = (a) => (a.tokenFile
  ? `node ${process.argv.slice(1).map(shellQuote).join(' ')}   (after writing the fresh token to ${a.tokenFile})`
  : `${a.tokenEnv}=<fresh token> node ${process.argv.slice(1).map(shellQuote).join(' ')}`);

async function walkHtml(dir, base = dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const full = path.join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) out.push(...(await walkHtml(full, base)));
    else if (name.endsWith('.html')) {
      const rel = path.relative(base, full).replace(/\.html$/, '');
      out.push({ file: full, webPath: `/${rel}` });
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set([0, 408, 425, 429, 500, 502, 503, 504]);
// The admin calls also retry a 401: a valid token can be answered 401 under a concurrent burst (recorded
// on the media uploader — a whole first burst at concurrency 4, while a lone sequential PUT went through).
// A 401 that survives every retry is the token, not the page — deployOne turns it into the batch halt.
const ADMIN_RETRYABLE = new Set([...RETRYABLE, 401]);

async function call(method, url, { token, body } = {}, { retries = 4, backoffMs = 500, retryStatuses = ADMIN_RETRYABLE } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    let status = 0;
    let text = '';
    try {
      const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` }, body });
      status = res.status;
      text = status >= 400 ? (await res.text()).slice(0, 200) : '';
    } catch (err) {
      status = 0;
      text = String(err.message || err);
    }
    if (status > 0 && status < 400) return { status, text: '', attempts: attempt + 1 };
    if (retryStatuses.has(status) && attempt < retries) {
      await sleep(Math.min(15000, backoffMs * 2 ** attempt) + attempt * 137); // capped backoff + deterministic jitter
      continue;
    }
    return { status, text, attempts: attempt + 1 };
  }
}

async function deliveredOk({ org, repo, branch, webPath, tld = 'aem.live' }) {
  // admin 200 != delivered; GET the rendered .plain.html on the delivery tree
  // (live = aem.live; preview-only = aem.page).
  const origin = VERIFY_ORIGIN || `https://${branch}--${repo}--${org}.${tld}`;
  const url = `${origin}${webPath}.plain.html`;
  try {
    const res = await fetch(url, { headers: { 'accept-encoding': 'gzip' } });
    if (res.status !== 200) return { ok: false, why: `plain.html ${res.status}` };
    const html = await res.text();
    if (html.includes('about:error')) return { ok: false, why: 'about:error in delivered html' };
    return { ok: true };
  } catch (err) {
    return { ok: false, why: String(err.message || err) };
  }
}

// Returns { rec, halt }: `halt` is null on a normal outcome (rec.status is live / previewed / *-fail) and
// { step, attempts } when a 401 persisted through its retries — then rec.status is left as it was.
async function deployOne(page, args, ledger, logLine) {
  const { org, repo, branch, token, publish } = args;
  const enc = encodeURI(page.webPath);
  const rec = ledger[page.webPath] || (ledger[page.webPath] = { status: 'pending', attempts: 0 });
  rec.attempts += 1;
  rec.ts = new Date().toISOString();
  const tokenHalt = async (step, r) => {
    // A 401 that survived every retry is the token, not this page: the status is kept (never *-fail),
    // the log records the halt, and the same command resumes exactly here once the token is fresh.
    await logLine({ path: page.webPath, step, status: 401, attempts: r.attempts, halt: true });
    return { rec, halt: { step, attempts: r.attempts } };
  };

  // 1. PUT body fragment (multipart, field name MUST be `data`, type text/html)
  const buf = await readFile(page.file);
  const fd = new FormData();
  fd.append('data', new Blob([buf], { type: 'text/html' }), path.basename(page.file));
  const put = await call('PUT', `${DA_SRC}/${org}/${repo}${enc}.html`, { token, body: fd }, args);
  if (put.status === 401) return tokenHalt('put', put);
  rec.put = put.status;
  if (put.status >= 400) {
    rec.status = 'put-fail';
    rec.lastError = `PUT ${put.status} ${put.text}`;
    await logLine({ path: page.webPath, step: 'put', status: put.status, text: put.text, attempts: put.attempts });
    return { rec, halt: null };
  }

  // 2. preview (path WITHOUT extension; ref = code branch)
  const prev = await call('POST', `${ADMIN}/preview/${org}/${repo}/${branch}${enc}`, { token }, args);
  if (prev.status === 401) return tokenHalt('preview', prev);
  rec.preview = prev.status;
  if (prev.status >= 400) {
    rec.status = 'preview-fail';
    rec.lastError = `preview ${prev.status} ${prev.text}`;
    await logLine({ path: page.webPath, step: 'preview', status: prev.status, text: prev.text, attempts: prev.attempts });
    return { rec, halt: null };
  }

  // 3. publish to live (query-index builds against the LIVE tree — #2)
  if (publish) {
    const live = await call('POST', `${ADMIN}/live/${org}/${repo}/${branch}${enc}`, { token }, args);
    if (live.status === 401) return tokenHalt('live', live);
    rec.live = live.status;
    if (live.status >= 400) {
      rec.status = 'live-fail';
      rec.lastError = `live ${live.status} ${live.text}`;
      await logLine({ path: page.webPath, step: 'live', status: live.status, text: live.text, attempts: live.attempts });
      return { rec, halt: null };
    }
  }

  // 4. verify delivery (admin 200 != delivered)
  const v = await deliveredOk({ org, repo, branch, webPath: page.webPath, tld: publish ? 'aem.live' : 'aem.page' });
  rec.verify = v.ok ? 'ok' : v.why;
  rec.status = v.ok ? (publish ? 'live' : 'previewed') : 'verify-fail';
  if (!v.ok) rec.lastError = v.why;
  await logLine({ path: page.webPath, step: 'verify', ok: v.ok, why: v.why });
  return { rec, halt: null };
}

// `stop()` is consulted before each new item: a halted batch starts nothing new while the workers
// already inside `worker` finish their item.
async function pool(items, n, worker, stop = () => false) {
  const q = [...items];
  const run = async () => { while (q.length && !stop()) await worker(q.shift()); };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

async function main() {
  const args = parseArgs(process.argv);
  // Preflight: an expired JWT never reaches the network — not even the already-live check below.
  // Anything that is not a JWT with an exp is simply tried.
  const exp = jwtExpiry(args.token);
  if (exp !== null && exp * 1000 <= Date.now()) {
    const ago = Math.max(1, Math.round((Date.now() - exp * 1000) / 60000));
    console.error(`[deploy-batch] ${tokenLabel(args)} is expired — its exp claim is ${new Date(exp * 1000).toISOString()} (${ago} min ago); nothing was sent. Refresh it and re-run: ${rerunCommand(args)}`);
    process.exit(TOKEN_EXIT);
  }
  let pages = await walkHtml(args.content);
  if (args.paths) {
    const want = new Set((await readFile(args.paths, 'utf8')).split('\n').map((s) => s.trim()).filter(Boolean)
      .map((p) => (p.startsWith('/') ? p : `/${p}`)));
    pages = pages.filter((p) => want.has(p.webPath));
  }
  const ledger = (!args.force && existsSync(args.ledger))
    ? JSON.parse(await readFile(args.ledger, 'utf8')) : {};

  // Skip pages already live AND still delivering 200 (verify, don't trust the ledger blindly).
  const todo = [];
  let skipped = 0;
  for (const p of pages) {
    const rec = ledger[p.webPath];
    if (!args.force && rec && rec.status === 'live') {
      const v = await deliveredOk({ ...args, webPath: p.webPath });
      if (v.ok) { skipped += 1; continue; }
    }
    todo.push(p);
  }

  // Shared file: lock + re-read + merge (this run's rows win) + tmp/rename, so a second batch or a
  // kill mid-write never loses rows or leaves a ledger the next run refuses to parse.
  const persist = async () => {
    try { mergeLedger(args.ledger, ledger, { onBad: (e) => console.error(`[deploy-batch] ledger on disk unreadable (${e.message}) — this run's rows are written over it`) }); }
    catch (e) { console.error(`[deploy-batch] ${e.message}`); }
  };
  const logLine = async (o) => appendFile(args.log, `${JSON.stringify({ t: new Date().toISOString(), ...o })}\n`);

  console.error(`[deploy-batch] ${pages.length} pages, ${skipped} already live, ${todo.length} to drive (concurrency ${args.concurrency}, publish=${args.publish})`);
  let done = 0;
  let halted = null; // { path, step, attempts } — the first page whose 401 persisted through its retries
  const results = [];
  await pool(todo, args.concurrency, async (p) => {
    const { rec, halt } = await deployOne(p, args, ledger, logLine);
    done += 1;
    results.push({ path: p.webPath, rec, halt });
    if (halt) {
      console.error(`[${done}/${todo.length}] HALT ${p.webPath} (${halt.step} 401 after ${halt.attempts} attempt${halt.attempts === 1 ? '' : 's'} — status kept ${rec.status}, not failed)`);
      if (!halted) { halted = { path: p.webPath, ...halt }; await persist(); }
      return;
    }
    const ok = rec.status === 'live' || rec.status === 'previewed';
    console.error(`[${done}/${todo.length}] ${ok ? 'OK  ' : 'FAIL'} ${p.webPath} (${rec.status})`);
    if (done % 5 === 0) await persist();
  }, () => halted !== null);
  await persist();

  if (halted) {
    // The token halt: pages that finished are in the ledger (ok or failed on their own account), the
    // halted page(s) and the pages never started keep their status — the same command resumes them.
    const isOk = (r) => r.rec.status === 'live' || r.rec.status === 'previewed';
    const okCount = results.filter((r) => !r.halt && isOk(r)).length;
    const failedRows = results.filter((r) => !r.halt && !isOk(r));
    const left = todo.length - okCount - failedRows.length;
    console.error(`[deploy-batch] halted on a 401. ${okCount} ok, ${failedRows.length} failed, ${left} left for the re-run (the halted page and the pages not started keep their status; the ledger resumes them).`);
    if (failedRows.length) {
      console.error('FAILS (not the token — the same re-run re-drives them):');
      for (const r of failedRows) console.error(`  ${r.path}  ${r.rec.status}  ${r.rec.lastError || ''}`);
    }
    console.error(`HALT ${halted.path} 401 after ${halted.attempts} attempt${halted.attempts === 1 ? '' : 's'} — ${refreshHint(args)} and re-run: ${rerunCommand(args)}`);
    process.exit(TOKEN_EXIT);
  }

  const fails = Object.entries(ledger).filter(([, r]) => !['live', 'previewed'].includes(r.status));
  console.error(`[deploy-batch] done. ${todo.length - fails.length} ok, ${fails.length} failed.`);
  if (fails.length) {
    console.error('FAILS (re-run the same command to re-drive — succeeded pages are skipped):');
    for (const [p, r] of fails) console.error(`  ${p}  ${r.status}  ${r.lastError || ''}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(`[deploy-batch] fatal: ${e.message}`); process.exit(2); });
