#!/usr/bin/env node
/**
 * deploy-batch.mjs — resumable, concurrent PUT → preview [→ live] driver for DA.
 *
 * The one bulk-delivery instrument (stardust finding #4): every hand-rolled
 * bash loop that replaced it lost its log on restart, re-PUT pages that were
 * already live, and — with `--force --paths` — erased the ledger rows of every
 * page outside the run (four field sites rebuilt a ledger from git + logs).
 *
 * Ledger (default content/.deploy-ledger.json), one row per web path:
 *   { status, attempts, ts, put, preview, live, verify, lastError,
 *     bodyHash, branch, sharedWithMain }
 *   - `bodyHash` = sha1 of the exact bytes PUT (sanitise writes in place, so file
 *     bytes and PUT body are the same object); `branch` = the code ref of that PUT.
 *   - a page is SKIPPED iff its row is `live` (publish run) or `live|previewed`
 *     (preview run), the delivered .plain.html is 200 without about:error, AND
 *     `bodyHash` equals the current file bytes. A changed file always re-drives;
 *     a row without a hash is verified-then-skipped and the hash backfilled.
 *   - the ledger is ALWAYS loaded; `--force` resets the SELECTED pages to
 *     `pending` and re-drives them; persist() re-reads the file and merges this
 *     run's rows into it — the row count never shrinks, two runs on disjoint
 *     `--paths` never overwrite each other.
 *   - `live` / `previewed` are set only after the delivered GET — POST codes
 *     never flip state (admin 200 ≠ delivered).
 *
 * Delivery-side repairs (each one was an operator re-drive turn in the field):
 *   - body guard: a file under 200 B or without `<main` is `body-invalid` before
 *     any request (a sanitise log line or an empty file was PUT as the page);
 *     `--allow-thin` bypasses.
 *   - shrink guard: the DA source is GET before the PUT; an existing document
 *     more than 5× the new bytes is `overwrite-guard`, no PUT (rich pages were
 *     overwritten by 700 B stubs); `--allow-shrink` bypasses. On a non-main
 *     branch the same GET is the two-clocks existence probe.
 *   - about:error repair: preview is re-POSTed ONCE, then the page is re-read;
 *     success is recorded `repaired: 're-preview'`; a persisting about:error is
 *     `verify-fail` "about:error (persists after re-preview)" — the image case.
 *   - verify blip: the delivered GET retries once after 3 s on a fetch error,
 *     5xx or 000 (a 404 is a verdict, not a blip).
 *
 * Usage:
 *   DA_TOKEN=… node skills/deploy/scripts/deploy-batch.mjs --org <org> --repo <repo> --branch <branch> \
 *     --content content [--paths <file|a,b,c>] [--exclude <file|a,b,c>] [--concurrency 4] \
 *     [--publish] [--force] [--allow-thin] [--allow-shrink] [--ledger path] [--log path] [--plan | --report]
 *
 * --content   dir of *.html body-fragment files (default: content). Each file's
 *             path relative to this dir, minus .html, is its DA/web path.
 * --paths     restrict the run: a newline-delimited file OR a comma list of web
 *             paths. Normalised (`//x` → `/x`, `.html` stripped); a requested path
 *             absent from --content is reported `not in content tree`, never dropped.
 * --exclude   same shape; matching pages are listed `excluded` and not driven.
 * --publish   also POST /live/ after preview (the query-index builds against the
 *             LIVE tree — #2). Default: preview only (D16). A publish run over a
 *             `previewed` + hash-equal row skips PUT+preview (POST /live/ + verify).
 * --no-publish  accepted as a no-op (was the default until 0.24; remove from scripts).
 * --force     reset the selected pages to `pending` and re-drive them (ledger kept).
 * --plan      build and print the plan with one reason per path — no network,
 *             exit 0. `unchanged (hash)` / `changed` / `new` / `failed-last-time` /
 *             `excluded` / `not in content tree` / `previewed (publish fast path)`.
 * --report    print the ledger grouped by status — no network, exit 0.
 * --allow-thin    PUT a body under 200 B / without `<main` anyway.
 * --allow-shrink  PUT over an existing DA document more than 5× larger anyway.
 * --concurrency  parallel pages in flight (default 4; DA admin tolerates ~4-6).
 *
 * Plan line: `N pages · U unchanged (hash) · C changed · K new · F failed-last-time
 * · X excluded · T to drive`. Log (append-only jsonl) survives a restart.
 *
 * Exit codes: 0 = every driven page verified; 1 = one or more FAILs (re-run the
 * same command — verified pages are skipped); 2 = fatal (usage, missing token).
 *
 * Test hooks (fixture tests only): DEPLOY_BATCH_DA_SRC, DEPLOY_BATCH_ADMIN and
 * DEPLOY_BATCH_DELIVERY_BASE override the three hosts; DEPLOY_BATCH_REPAIR_DELAY_MS
 * shortens the 3 s repair/blip wait. The module is importable
 * (normalisePath, readPathList, buildPlan, mergeLedger) — main() runs only as a CLI.
 *
 * No external deps — uses Node's global fetch/FormData/Blob (Node 18+).
 */
import { readFile, writeFile, appendFile, readdir, stat, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DA_SRC = process.env.DEPLOY_BATCH_DA_SRC || 'https://admin.da.live/source';
const ADMIN = process.env.DEPLOY_BATCH_ADMIN || 'https://admin.hlx.page';
const DELIVERY_BASE = process.env.DEPLOY_BATCH_DELIVERY_BASE || null;
const OK_STATUS = new Set(['live', 'previewed']);
const REPAIR_DELAY_MS = Number(process.env.DEPLOY_BATCH_REPAIR_DELAY_MS) || 3000;
const MIN_BODY_BYTES = 200;
const SHRINK_RATIO = 5;

export const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

/** `//x/y.html` → `/x/y`; empty → null. The one place a web path is shaped. */
export function normalisePath(p) {
  const s = String(p || '').trim();
  if (!s) return null;
  return `/${s.replace(/\.html$/i, '')}`.replace(/^\/+/, '/');
}

/** A newline-delimited file or a comma list → Set of normalised web paths. */
export async function readPathList(spec) {
  let text = spec;
  if (existsSync(spec) && (await stat(spec)).isFile()) text = await readFile(spec, 'utf8');
  return new Set(text.split(/[\n,]/).map(normalisePath).filter(Boolean));
}

export function deliveryUrl({ org, repo, branch, tld, webPath }) {
  return DELIVERY_BASE ? `${DELIVERY_BASE}/${tld}${webPath}.plain.html` : `https://${branch}--${repo}--${org}.${tld}${webPath}.plain.html`;
}

function usage() {
  console.log('usage: node skills/deploy/scripts/deploy-batch.mjs --org <org> --repo <repo> --branch <branch> [--content content] [--paths <file|a,b>] [--exclude <file|a,b>] [--concurrency 4] [--publish] [--force] [--allow-thin] [--allow-shrink] [--ledger <path>] [--log <path>] [--plan | --report]');
}

export function parseArgs(argv) {
  const a = { content: 'content', concurrency: 4, publish: false, force: false, retries: 4, plan: false, report: false, allowThin: false, allowShrink: false };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    const next = () => argv[(i += 1)];
    if (k === '--org') a.org = next();
    else if (k === '--repo') a.repo = next();
    else if (k === '--branch') a.branch = next();
    else if (k === '--content') a.content = next();
    else if (k === '--paths') a.paths = next();
    else if (k === '--exclude') a.exclude = next();
    else if (k === '--ledger') a.ledger = next();
    else if (k === '--log') a.log = next();
    else if (k === '--concurrency') a.concurrency = Math.max(1, +next() || 4);
    else if (k === '--retries') a.retries = Math.max(0, +next() || 4);
    else if (k === '--publish') a.publish = true;
    else if (k === '--no-publish') { a.publish = false; console.error('[deploy-batch] --no-publish is the default since 0.24 and will be removed; drop the flag (publish is an explicit --publish run)'); }
    else if (k === '--force') a.force = true;
    else if (k === '--plan') a.plan = true;
    else if (k === '--report') a.report = true;
    else if (k === '--allow-thin') a.allowThin = true;
    else if (k === '--allow-shrink') a.allowShrink = true;
    else if (k === '--token-env') a.tokenEnv = next();
    else if (k === '--help' || k === '-h') { usage(); process.exit(0); }
    else throw new Error(`unknown arg: ${k}`);
  }
  if (!a.org || !a.repo || !a.branch) throw new Error('--org, --repo and --branch are required');
  a.offline = a.plan || a.report;
  a.token = process.env[a.tokenEnv || 'DA_TOKEN'];
  if (!a.token && !a.offline) throw new Error(`missing token in env ${a.tokenEnv || 'DA_TOKEN'}`);
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
  // (live = aem.live; preview-only = aem.page). One retry after a blip (fetch
  // error, 5xx, 000) — a 404 or about:error is a verdict, never retried here.
  const url = deliveryUrl({ org, repo, branch, tld, webPath });
  for (let attempt = 0; ; attempt += 1) {
    let status = 0;
    let why;
    try {
      const res = await fetch(url, { headers: { 'accept-encoding': 'gzip' } });
      status = res.status;
      if (status === 200) {
        const html = await res.text();
        if (html.includes('about:error')) return { ok: false, why: 'about:error in delivered html', aboutError: true };
        return { ok: true };
      }
      why = `plain.html ${status}`;
    } catch (err) {
      why = String(err.message || err);
    }
    const blip = status === 0 || status >= 500;
    if (blip && attempt === 0) { await sleep(REPAIR_DELAY_MS); continue; }
    return { ok: false, why: blip ? `${why} (after retry)` : why };
  }
}

/** GET the DA source document: status + byte length (body discarded). */
async function daSourceSize(url, token) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const buf = res.status === 200 ? Buffer.from(await res.arrayBuffer()) : null;
    return { status: res.status, length: buf ? buf.length : 0 };
  } catch (err) {
    return { status: 0, length: 0, text: String(err.message || err) };
  }
}

/**
 * Decide, per page, drive or skip — and why. `verify` is the delivered-GET
 * probe (null in --plan mode: no network, hash-unknown rows count as unchanged
 * and say so). Mutates `ledger` only for --force resets and hash backfills;
 * every touched path is added to `touched` so persist() merges just those rows.
 */
export async function buildPlan({ pages, ledger, want, exclude, publish, force, branch, verify, touched }) {
  const rows = [];
  const todo = [];
  const counts = { pages: 0, unchanged: 0, changed: 0, new: 0, failedLast: 0, excluded: 0, missing: 0, forced: 0, fastPublish: 0, reverify: 0 };
  const seen = new Set();
  const tld = publish ? 'aem.live' : 'aem.page';
  const drive = (p, reason, key) => { rows.push({ webPath: p.webPath, action: 'drive', reason }); todo.push(p); if (key) counts[key] += 1; };
  const skip = (p, reason, key) => { rows.push({ webPath: p.webPath, action: 'skip', reason }); if (key) counts[key] += 1; };

  for (const p of pages) {
    if (want && !want.has(p.webPath)) continue;
    seen.add(p.webPath);
    counts.pages += 1;
    if (exclude && exclude.has(p.webPath)) { skip(p, 'excluded', 'excluded'); continue; }
    p.hash = sha1(await readFile(p.file));
    const rec = ledger[p.webPath];
    if (force) {
      if (rec) { rec.status = 'pending'; touched.add(p.webPath); }
      drive(p, 'forced (--force)', 'forced');
      continue;
    }
    if (!rec) { drive(p, 'new', 'new'); continue; }
    if (!OK_STATUS.has(rec.status)) { drive(p, `failed-last-time (${rec.status})`, 'failedLast'); continue; }
    if (rec.bodyHash && rec.bodyHash !== p.hash) { drive(p, 'changed', 'changed'); continue; }
    if (publish && rec.status === 'previewed') {
      drive(p, rec.bodyHash ? 'previewed (publish fast path)' : 'previewed (no hash — full drive)', 'fastPublish');
      continue;
    }
    // hash equal or unknown, status matches the run → verify the delivered page
    if (!verify) {
      skip(p, rec.bodyHash ? 'unchanged (hash)' : 'unchanged (no hash — a live run verifies the delivered page first)', 'unchanged');
      continue;
    }
    const v = await verify({ webPath: p.webPath, tld });
    if (!v.ok) { drive(p, `re-verify failed (${v.why})`, 'reverify'); continue; }
    if (!rec.bodyHash) { rec.bodyHash = p.hash; rec.branch ||= branch; touched.add(p.webPath); }
    skip(p, rec.status === 'previewed' && !publish ? 'unchanged (hash; previewed-only — needs --publish to go live)' : 'unchanged (hash)', 'unchanged');
  }
  if (want) {
    for (const w of want) if (!seen.has(w)) { rows.push({ webPath: w, action: 'missing', reason: 'not in content tree' }); counts.missing += 1; }
  }
  counts.toDrive = todo.length;
  return { rows, todo, counts };
}

export function planLine(c, extra = '') {
  return `[deploy-batch] ${c.pages} pages · ${c.unchanged} unchanged (hash) · ${c.changed} changed · ${c.new} new · ${c.failedLast} failed-last-time`
    + `${c.forced ? ` · ${c.forced} forced` : ''}${c.fastPublish ? ` · ${c.fastPublish} previewed→publish` : ''}${c.reverify ? ` · ${c.reverify} re-verify failed` : ''}`
    + ` · ${c.excluded} excluded${c.missing ? ` · ${c.missing} not in content tree` : ''} · ${c.toDrive} to drive${extra}`;
}

/** on-disk rows ∪ this run's rows — never a subset of what was there. */
export function mergeLedger(onDisk, ledger, touched) {
  const merged = { ...onDisk };
  for (const p of touched) if (ledger[p]) merged[p] = ledger[p];
  for (const [k, v] of Object.entries(ledger)) if (!(k in merged)) merged[k] = v;
  return merged;
}

async function readLedger(file) {
  if (!existsSync(file)) return {};
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { throw new Error(`ledger ${file} is not valid JSON (${e.message}) — fix or move it; never start from an empty ledger`); }
}

async function persistLedger(file, ledger, touched) {
  const merged = mergeLedger(await readLedger(file), ledger, touched);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(merged, null, 2));
  await rename(tmp, file);
  return merged;
}

async function deployOne(page, args, ledger, logLine, shared) {
  const { org, repo, branch, token, publish } = args;
  const enc = encodeURI(page.webPath);
  const rec = ledger[page.webPath] || (ledger[page.webPath] = { status: 'pending', attempts: 0 });
  rec.attempts += 1;
  rec.ts = new Date().toISOString();

  // Publish fast path: a page this ledger already holds as `previewed`, whose
  // bytes are unchanged (hash) and that still delivers on aem.page needs only
  // POST /live/ + verify — re-running PUT → preview for every page would double
  // the admin traffic of a 1k-page run.
  const fastPublish = publish && !args.force && rec.status === 'previewed' && rec.bodyHash && rec.bodyHash === page.hash
    && (await deliveredOk({ org, repo, branch, webPath: page.webPath, tld: 'aem.page' })).ok;

  if (!fastPublish) {
    const buf = await readFile(page.file);

    // 0a. body guard — zero network. A sanitise log line captured as the body,
    //     or an empty file, must never become the page.
    if (!args.allowThin && (buf.length < MIN_BODY_BYTES || !/<main[\s>]/.test(buf.toString('utf8')))) {
      rec.status = 'body-invalid';
      rec.lastError = `body ${buf.length} B${/<main[\s>]/.test(buf.toString('utf8')) ? '' : ' / no <main>'} — --allow-thin to PUT anyway`;
      await logLine({ path: page.webPath, step: 'body-guard', bytes: buf.length });
      return rec;
    }

    // 0b. existing DA document — one GET serves two purposes: the shrink guard
    //     (a rich page must not be overwritten by a stub) and, on a non-main
    //     branch, the two-clocks existence probe (a document that already
    //     exists is also main's; recorded once per page so a re-run of this
    //     branch does not count its own earlier PUTs).
    const existing = await daSourceSize(`${DA_SRC}/${org}/${repo}${enc}.html`, token);
    if (branch !== 'main' && shared) {
      if (rec.sharedWithMain === undefined && existing.status !== 0) rec.sharedWithMain = existing.status === 200;
      if (rec.sharedWithMain) shared.push(page.webPath);
    }
    if (!args.allowShrink && existing.status === 200 && existing.length > SHRINK_RATIO * buf.length) {
      rec.status = 'overwrite-guard';
      rec.lastError = `existing ${existing.length} B vs new ${buf.length} B (> ${SHRINK_RATIO}×) — --allow-shrink to overwrite`;
      await logLine({ path: page.webPath, step: 'shrink-guard', existing: existing.length, bytes: buf.length });
      return rec;
    }

    // 1. PUT body fragment (multipart, field name MUST be `data`, type text/html)
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
    rec.bodyHash = sha1(buf);
    rec.branch = branch;

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

  // 4. verify delivery (admin 200 != delivered). An about:error is first
  //    repaired by ONE idempotent re-preview (an image lost the ingest race
  //    with Code Sync); only a persisting about:error is a FAIL.
  const tld = publish ? 'aem.live' : 'aem.page';
  let v = await deliveredOk({ org, repo, branch, webPath: page.webPath, tld });
  if (!v.ok && v.aboutError) {
    const again = await call('POST', `${ADMIN}/preview/${org}/${repo}/${branch}${enc}`, { token }, 1);
    if (again.status < 400 && publish) await call('POST', `${ADMIN}/live/${org}/${repo}/${branch}${enc}`, { token }, 1);
    await sleep(REPAIR_DELAY_MS);
    const v2 = again.status < 400 ? await deliveredOk({ org, repo, branch, webPath: page.webPath, tld }) : { ok: false, why: `re-preview ${again.status}` };
    await logLine({ path: page.webPath, step: 'repreview', status: again.status, ok: v2.ok });
    if (v2.ok) rec.repaired = 're-preview';
    else delete rec.repaired;
    v = v2.ok ? v2 : { ok: false, why: v2.aboutError ? 'about:error (persists after re-preview)' : v2.why };
  } else if (v.ok) delete rec.repaired;
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

function report(ledger) {
  const by = {};
  for (const [p, r] of Object.entries(ledger)) (by[r.status] ||= []).push([p, r]);
  const order = Object.keys(by).sort((a, b) => by[b].length - by[a].length);
  console.log(`[deploy-batch] ledger: ${Object.keys(ledger).length} rows`);
  for (const s of order) console.log(`  ${s}: ${by[s].length}`);
  for (const s of order) {
    if (OK_STATUS.has(s)) continue;
    for (const [p, r] of by[s]) console.log(`  ${s}  ${p}  ${r.lastError || ''}`.trimEnd());
  }
}

export async function main(argv = process.argv) {
  const args = parseArgs(argv);
  const ledger = await readLedger(args.ledger);
  if (args.report) { report(ledger); return 0; }

  const pages = await walkHtml(args.content);
  const want = args.paths ? await readPathList(args.paths) : null;
  const exclude = args.exclude ? await readPathList(args.exclude) : null;
  const touched = new Set();
  const verify = args.plan ? null : ({ webPath, tld }) => deliveredOk({ ...args, webPath, tld });
  const plan = await buildPlan({ pages, ledger, want, exclude, publish: args.publish, force: args.force, branch: args.branch, verify, touched });
  const { todo, counts } = plan;

  if (args.plan) {
    console.log(planLine(counts, ` (plan only, publish=${args.publish})`));
    for (const r of plan.rows) console.log(`  ${r.action.padEnd(7)} ${r.webPath}  ${r.reason}`);
    return 0;
  }

  const persist = async () => persistLedger(args.ledger, ledger, touched);
  const logLine = async (o) => appendFile(args.log, `${JSON.stringify({ t: new Date().toISOString(), ...o })}\n`);
  console.error(planLine(counts, ` (concurrency ${args.concurrency}, publish=${args.publish})`));
  if (!todo.length) {
    const show = plan.rows.slice(0, 50); // one reason per path — why nothing moves
    for (const r of show) console.error(`  ${r.action.padEnd(7)} ${r.webPath}  ${r.reason}`);
    if (plan.rows.length > show.length) console.error(`  (${plan.rows.length - show.length} more — \`--plan\` prints every reason)`);
  }
  if (touched.size) await persist(); // hash backfills / --force resets

  const shared = args.branch !== 'main' ? [] : null;
  let done = 0;
  await pool(todo, args.concurrency, async (p) => {
    touched.add(p.webPath);
    const rec = await deployOne(p, args, ledger, logLine, shared);
    done += 1;
    const ok = OK_STATUS.has(rec.status);
    console.error(`[${done}/${todo.length}] ${ok ? 'OK  ' : 'FAIL'} ${p.webPath} (${rec.status})`);
    if (done % 5 === 0) await persist();
  });
  await persist();

  const fails = todo.map((p) => [p.webPath, ledger[p.webPath]]).filter(([, r]) => !OK_STATUS.has(r.status));
  console.error(`[deploy-batch] done. ${todo.length - fails.length} ok, ${fails.length} failed.`);
  if (shared && shared.length) {
    console.error(`[deploy-batch] WARN two clocks: ${shared.length} document(s) already on DA are shared with main — main renders them with main's code until branch "${args.branch}" is merged (da-deploy-protocol.md § Two clocks).`);
  }
  if (args.publish && todo.length) {
    const until = new Date(Date.now() + 7200 * 1000).toISOString().slice(0, 16).replace('T', ' ');
    console.error(`[deploy-batch] code is served with max-age=7200 — visitors may hold old code until ${until} UTC; report that window end with the publish.`);
  }
  if (fails.length) {
    console.error('FAILS (re-run the same command to re-drive — verified pages are skipped):');
    for (const [p, r] of fails) console.error(`  ${p}  ${r.status}  ${r.lastError || ''}`);
    return 1;
  }
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(`[deploy-batch] fatal: ${e.message}`); process.exit(2); });
}
