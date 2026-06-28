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
 *     page to `live` — admin 200 != delivered (guardrail #6/#13).
 *
 * Idempotent: PUT/preview/live are all safe to repeat. Safe to Ctrl-C and re-run.
 *
 * Usage:
 *   DA_TOKEN=… node deploy-batch.mjs --org <org> --repo <repo> --branch <branch> \
 *     --content content [--paths list.txt] [--concurrency 4] [--no-publish] \
 *     [--force] [--ledger path] [--log path]
 *
 * --content   dir of *.html body-fragment files (default: content). Each file's
 *             path relative to this dir, minus .html, is its DA/web path.
 * --paths     optional newline-delimited file of web paths (no extension) to
 *             restrict the run to a subset (re-drive only these).
 * --no-publish  preview only; do not POST /live/ (query-index won't build — see #2).
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
  const a = { content: 'content', concurrency: 4, publish: true, force: false, retries: 4 };
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
    else if (k === '--no-publish') a.publish = false;
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

async function deployOne(page, args, ledger, logLine) {
  const { org, repo, branch, token, publish } = args;
  const enc = encodeURI(page.webPath);
  const rec = ledger[page.webPath] || (ledger[page.webPath] = { status: 'pending', attempts: 0 });
  rec.attempts += 1;
  rec.ts = new Date().toISOString();

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
  let done = 0;
  await pool(todo, args.concurrency, async (p) => {
    const rec = await deployOne(p, args, ledger, logLine);
    done += 1;
    const ok = rec.status === 'live' || rec.status === 'previewed';
    console.error(`[${done}/${todo.length}] ${ok ? 'OK  ' : 'FAIL'} ${p.webPath} (${rec.status})`);
    if (done % 5 === 0) await persist();
  });
  await persist();

  const fails = Object.entries(ledger).filter(([, r]) => !['live', 'previewed'].includes(r.status));
  console.error(`[deploy-batch] done. ${todo.length - fails.length} ok, ${fails.length} failed.`);
  if (fails.length) {
    console.error('FAILS (re-run the same command to re-drive — succeeded pages are skipped):');
    for (const [p, r] of fails) console.error(`  ${p}  ${r.status}  ${r.lastError || ''}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(`[deploy-batch] fatal: ${e.message}`); process.exit(2); });
