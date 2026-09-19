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
 *   - retries 000 / 408 / 429 / 5xx with capped exponential backoff;
 *   - APPENDS to its log (never truncates), so the record survives a restart;
 *   - verifies the delivered .plain.html (200 + 0 about:error) before flipping a
 *     page to `live` — admin 200 != delivered (guardrail #6/#13);
 *   - two clocks (da-deploy-protocol.md § Two clocks): when --branch is not
 *     main, a HEAD per page counts documents that already exist on DA — they
 *     are SHARED with main, which renders them with main's code until the
 *     branch merges (one WARN line in the summary); when publishing, the
 *     summary states when the code cache window (max-age=7200) ends.
 *
 * Idempotent: PUT/preview/live are all safe to repeat. Safe to Ctrl-C and re-run.
 * The two-clocks HEAD answer is recorded once per page (`sharedWithMain`), so a
 * re-run never counts this branch's own earlier PUTs as shared documents; a
 * follow-up `--publish` run takes a page the ledger holds as `previewed` and
 * still delivering on aem.page straight to POST /live/ + verify (no re-PUT).
 *
 * One command = one intent. The default run PUTs and PREVIEWS only (D16: gate
 * on preview); live publish is a SEPARATE `--publish` run, taken when the
 * preview gate passed or the decision register says publish-to-live (D1).
 * A production-affecting action is never joined with edits, commits or
 * process kills in one shell string.
 *
 * Usage:
 *   DA_TOKEN=… node deploy-batch.mjs --org <org> --repo <repo> --branch <branch> \
 *     --content content [--paths list.txt] [--concurrency 4] [--publish] \
 *     [--force] [--ledger path] [--log path]
 *
 * --content   dir of *.html body-fragment files (default: content). Each file's
 *             path relative to this dir, minus .html, is its DA/web path.
 * --paths     optional newline-delimited file of web paths (no extension) to
 *             restrict the run to a subset (re-drive only these).
 * --publish   also POST /live/ after preview (the query-index builds against the
 *             LIVE tree — #2 — so a site with listings needs this run before
 *             the index is checked). Default: preview only.
 * --no-publish  accepted as a no-op (was the default until 0.24; remove from scripts).
 * --force     ignore the ledger; re-drive every page.
 * --concurrency  parallel pages in flight (default 4; DA admin tolerates ~4-6).
 *
 * No external deps — uses Node's global fetch/FormData/Blob (Node 18+).
 */
import { readFile, writeFile, appendFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DA_SRC = 'https://admin.da.live/source';
const ADMIN = 'https://admin.hlx.page';

function parseArgs(argv) {
  const a = { content: 'content', concurrency: 4, publish: false, force: false, retries: 4 };
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
    else if (k === '--publish') a.publish = true;
    else if (k === '--no-publish') { a.publish = false; console.error('[deploy-batch] --no-publish is the default since 0.24 and will be removed; drop the flag (publish is an explicit --publish run)'); }
    else if (k === '--force') a.force = true;
    else if (k === '--token-env') a.tokenEnv = next();
    else throw new Error(`unknown arg: ${k}`);
  }
  a.token = process.env[a.tokenEnv || 'DA_TOKEN'];
  if (!a.org || !a.repo || !a.branch) throw new Error('--org, --repo and --branch are required');
  if (!a.token) throw new Error(`missing token in env ${a.tokenEnv || 'DA_TOKEN'}`);
  a.ledger ||= path.join(a.content, '.deploy-ledger.json');
  a.log ||= path.join(a.content, '.deploy-log.jsonl');
  return a;
}

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

async function call(method, url, { token, body } = {}, retries = 4) {
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
    if (status > 0 && status < 400) return { status, text: '' };
    if (RETRYABLE.has(status) && attempt < retries) {
      await sleep(Math.min(15000, 500 * 2 ** attempt) + attempt * 137); // capped backoff + deterministic jitter
      continue;
    }
    return { status, text };
  }
}

async function deliveredOk({ org, repo, branch, webPath, tld = 'aem.live' }) {
  // admin 200 != delivered; GET the rendered .plain.html on the delivery tree
  // (live = aem.live; preview-only = aem.page).
  const url = `https://${branch}--${repo}--${org}.${tld}${webPath}.plain.html`;
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

async function deployOne(page, args, ledger, logLine, shared) {
  const { org, repo, branch, token, publish } = args;
  const enc = encodeURI(page.webPath);
  const rec = ledger[page.webPath] || (ledger[page.webPath] = { status: 'pending', attempts: 0 });
  rec.attempts += 1;
  rec.ts = new Date().toISOString();

  // Publish fast path: a page this ledger already holds as `previewed` and that
  // still delivers on aem.page needs only POST /live/ + verify — re-running
  // PUT → preview for every page would double the admin traffic of a 1k-page run.
  const fastPublish = publish && !args.force && rec.status === 'previewed'
    && (await deliveredOk({ org, repo, branch, webPath: page.webPath, tld: 'aem.page' })).ok;

  // 0. two clocks — a DA document is shared across every code ref. On a
  //    non-main branch, a document that already exists is also main's. The
  //    answer is recorded once per page so a re-run of this branch does not
  //    count its own earlier PUTs.
  if (branch !== 'main' && shared) {
    if (rec.sharedWithMain === undefined) {
      const head = await call('HEAD', `${DA_SRC}/${org}/${repo}${enc}.html`, { token }, 1);
      rec.sharedWithMain = head.status === 200;
    }
    if (rec.sharedWithMain) shared.push(page.webPath);
  }

  if (!fastPublish) {
    // 1. PUT body fragment (multipart, field name MUST be `data`, type text/html)
    const buf = await readFile(page.file);
    const fd = new FormData();
    fd.append('data', new Blob([buf], { type: 'text/html' }), path.basename(page.file));
    const put = await call('PUT', `${DA_SRC}/${org}/${repo}${enc}.html`, { token, body: fd }, args.retries);
    rec.put = put.status;
    if (put.status >= 400) {
      rec.status = 'put-fail';
      rec.lastError = `PUT ${put.status} ${put.text}`;
      await logLine({ path: page.webPath, step: 'put', ...put });
      return rec;
    }

    // 2. preview (path WITHOUT extension; ref = code branch)
    const prev = await call('POST', `${ADMIN}/preview/${org}/${repo}/${branch}${enc}`, { token }, args.retries);
    rec.preview = prev.status;
    if (prev.status >= 400) {
      rec.status = 'preview-fail';
      rec.lastError = `preview ${prev.status} ${prev.text}`;
      await logLine({ path: page.webPath, step: 'preview', ...prev });
      return rec;
    }
  } else {
    await logLine({ path: page.webPath, step: 'preview', reused: true });
  }

  // 3. publish to live (query-index builds against the LIVE tree — #2)
  if (publish) {
    const live = await call('POST', `${ADMIN}/live/${org}/${repo}/${branch}${enc}`, { token }, args.retries);
    rec.live = live.status;
    if (live.status >= 400) {
      rec.status = 'live-fail';
      rec.lastError = `live ${live.status} ${live.text}`;
      await logLine({ path: page.webPath, step: 'live', ...live });
      return rec;
    }
  }

  // 4. verify delivery (admin 200 != delivered)
  const v = await deliveredOk({ org, repo, branch, webPath: page.webPath, tld: publish ? 'aem.live' : 'aem.page' });
  rec.verify = v.ok ? 'ok' : v.why;
  rec.status = v.ok ? (publish ? 'live' : 'previewed') : 'verify-fail';
  if (!v.ok) rec.lastError = v.why;
  await logLine({ path: page.webPath, step: 'verify', ok: v.ok, why: v.why });
  return rec;
}

async function pool(items, n, worker) {
  const q = [...items];
  const run = async () => { while (q.length) await worker(q.shift()); };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

async function main() {
  const args = parseArgs(process.argv);
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

  const persist = async () => writeFile(args.ledger, JSON.stringify(ledger, null, 2));
  const logLine = async (o) => appendFile(args.log, `${JSON.stringify({ t: new Date().toISOString(), ...o })}\n`);

  console.error(`[deploy-batch] ${pages.length} pages, ${skipped} already live, ${todo.length} to drive (concurrency ${args.concurrency}, publish=${args.publish})`);
  const shared = args.branch !== 'main' ? [] : null;
  let done = 0;
  await pool(todo, args.concurrency, async (p) => {
    const rec = await deployOne(p, args, ledger, logLine, shared);
    done += 1;
    const ok = rec.status === 'live' || rec.status === 'previewed';
    console.error(`[${done}/${todo.length}] ${ok ? 'OK  ' : 'FAIL'} ${p.webPath} (${rec.status})`);
    if (done % 5 === 0) await persist();
  });
  await persist();

  const fails = Object.entries(ledger).filter(([, r]) => !['live', 'previewed'].includes(r.status));
  console.error(`[deploy-batch] done. ${todo.length - fails.length} ok, ${fails.length} failed.`);
  if (shared && shared.length) {
    console.error(`[deploy-batch] WARN two clocks: ${shared.length} document(s) already on DA are shared with main — main renders them with main's code until branch "${args.branch}" is merged (da-deploy-protocol.md § Two clocks).`);
  }
  if (args.publish && todo.length) {
    const until = new Date(Date.now() + 7200 * 1000).toISOString().slice(0, 16).replace('T', ' ');
    console.error(`[deploy-batch] code is served with max-age=7200 — visitors may hold old code until ${until} UTC; report that window end with the publish.`);
  }
  if (fails.length) {
    console.error('FAILS (re-run the same command to re-drive — succeeded pages are skipped):');
    for (const [p, r] of fails) console.error(`  ${p}  ${r.status}  ${r.lastError || ''}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(`[deploy-batch] fatal: ${e.message}`); process.exit(2); });
