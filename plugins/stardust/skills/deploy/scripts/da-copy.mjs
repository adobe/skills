#!/usr/bin/env node
/**
 * skills/deploy/scripts/da-copy.mjs — copy a DA folder tree to another org/site (project move, step 4).
 * Contract: reference/project-move.md § Steps. Three field moves each hand-wrote this loop; the
 * generalised one keeps their shape: recursive list, media first, host rewrite, sheets as JSON,
 * retry on 429, a resumable ledger checkpointed after every file (a killed run resumes) — and previews only (D16):
 * live is a separate explicit run.
 *
 *   node skills/deploy/scripts/da-copy.mjs --from <org>/<site> --to <org>/<site>
 *        [--prefix <dir>] [--publish] [--dry] [--skip-copy] [--concurrency 4]
 *        [--ledger stardust/da-copy-ledger.json] [--token-env DA_TOKEN] [--help]
 *
 *   --from / --to     DA coordinates `<org>/<site>`; the same token must read the source and write the target.
 *   --prefix <dir>    copy one subtree (default: the whole site folder).
 *   --publish         after the preview POST, POST …/live/ as well (row → `live`). Default OFF: a move previews,
 *                     parity is checked on `.aem.page` (host-compare.mjs), live is a separate run on PASS (D1/D16).
 *   --dry             list and plan only — no GET/PUT/POST beyond the list calls, ledger untouched.
 *   --skip-copy       skip the GET+PUT half: preview/publish whatever the ledger already has as `copied`.
 *   --concurrency     parallel files (default 4 — zero 429s at 4 on 338 paths in the field).
 *   --ledger          own ledger, keyed by DA path (default stardust/da-copy-ledger.json); NEVER content/.deploy-ledger.json.
 *   --token-env       env NAME of the DA/IMS token (default DA_TOKEN; lib.mjs resolveToken — the class is printed, never the value).
 *
 * Order: three waves — media (every non-html/json file), then html documents, then json sheets — each
 * sorted by path and completed before the next wave starts, so a document never references media the
 * target does not hold yet. Rewrites inside html/json bodies:
 * `content.da.live/<from>/` → `content.da.live/<to>/` and `main--<site>--<org>` of the source → the target's
 * (a redirects sheet that names the old host moves with the tree). Sheets round-trip as `application/json`.
 * Read side: GET admin.da.live/list/<org>/<site>/<dir> (one level; recursed) and GET admin.da.live/source/<path>.
 *
 * Ledger row: { status: copied | previewed | live | failed, attempts, ts, lastError }. A re-run skips rows
 * already at the run's target status; `failed` rows are retried. Retry set {0, 408, 425, 429, 5xx} with
 * capped backoff (deploy-batch.mjs's), 401 halts at once. Last stdout line:
 *   SUMMARY da-copy <from> → <to> files=<n> copied=<n> previewed=<n> live=<n> skipped=<n> failed=<n> retries=<n> exit=<code>
 *
 * Exit codes:
 *   0  every file at the target status      1  one or more files `failed` (listed; re-run resumes)
 *   2  no verdict: usage · token missing · 401 · the source list call failed (nothing copied)
 * Never: deletes or edits anything under --from, publishes without --publish, prints a token value,
 * touches the customer site. Test hooks: DA_COPY_DA_BASE, DA_COPY_ADMIN_BASE (mock hosts), DA_COPY_BACKOFF_MS.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveToken } from './lib.mjs';

const DA = process.env.DA_COPY_DA_BASE || 'https://admin.da.live';
const ADMIN = process.env.DA_COPY_ADMIN_BASE || 'https://admin.hlx.page';
const BACKOFF = Number(process.env.DA_COPY_BACKOFF_MS) || 500;
const RETRYABLE = new Set([0, 408, 425, 429, 500, 502, 503, 504]);
const RANK = { failed: 0, copied: 1, previewed: 2, live: 3 };
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

export function parseArgs(argv) {
  const a = { from: '', to: '', prefix: '', publish: false, dry: false, skipCopy: false, concurrency: 4, ledger: path.join('stardust', 'da-copy-ledger.json'), tokenEnv: 'DA_TOKEN', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const need = () => { const v = argv[i + 1]; if (v === undefined || /^--/.test(v)) throw new Error(`${k} needs a value`); i += 1; return v; };
    if (k === '--from') a.from = need();
    else if (k === '--to') a.to = need();
    else if (k === '--prefix') a.prefix = need().replace(/^\/+|\/+$/g, '');
    else if (k === '--publish') a.publish = true;
    else if (k === '--dry') a.dry = true;
    else if (k === '--skip-copy') a.skipCopy = true;
    else if (k === '--concurrency') { a.concurrency = Number(need()); if (!Number.isInteger(a.concurrency) || a.concurrency < 1) throw new Error('--concurrency needs an integer ≥ 1'); }
    else if (k === '--ledger') a.ledger = need();
    else if (k === '--token-env') a.tokenEnv = need();
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`unknown arg: ${k}`);
  }
  if (!a.help) for (const k of ['from', 'to']) if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/i.test(a[k])) throw new Error(`--${k} must be <org>/<site>`);
  return a;
}

/** Text rewrites a moved document needs: the DA media host folder and the branch delivery host. */
export function rewrite(text, from, to) {
  const [fo, fs] = from.split('/'); const [to_, ts] = to.split('/');
  return text.split(`content.da.live/${from}/`).join(`content.da.live/${to}/`).split(`main--${fs}--${fo}`).join(`main--${ts}--${to_}`);
}

/** media first, then html documents, then json sheets — each sorted by path. */
export function copyOrder(files) {
  const kind = (f) => (f.ext === 'html' ? 1 : f.ext === 'json' ? 2 : 0);
  return [...files].sort((a, b) => kind(a) - kind(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Delivery web path of a DA file: `dir/index.html` → `/dir/`, `dir/page.html` → `/dir/page`, sheets keep `.json`. */
export function webPathOf(rel) {
  if (rel.endsWith('.json')) return `/${rel}`;
  const p = `/${rel.replace(/\.html$/, '')}`;
  return p.endsWith('/index') ? `${p.slice(0, -5)}` : p;
}

async function call(method, url, { token, body, headers = {} } = {}, stats) {
  for (let attempt = 0; ; attempt += 1) {
    let res; let status = 0; let text = '';
    try { res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...headers }, body }); status = res.status; } catch (e) { text = String(e.message || e); }
    if (status === 401) throw Object.assign(new Error(`${method} ${url}: 401 — the token in ${stats.tokenEnv} is rejected (expired or no access)`), { halt: true });
    if (status > 0 && status < 400) return res;
    if (status >= 400) text = (await res.text().catch(() => '')).slice(0, 120);
    if (RETRYABLE.has(status) && attempt < 4) { stats.retries += 1; console.log(`  retry ${attempt + 1} ${method} ${url.replace(DA, '').replace(ADMIN, '')} (${status || text})`); await sleep(Math.min(15000, BACKOFF * 2 ** attempt)); continue; }
    throw new Error(`${method} ${url.replace(DA, '').replace(ADMIN, '')}: ${status || text}`);
  }
}

/** Recursive listing of `<org>/<site>/<dir>` → [{ path: rel, ext }] sorted by path (folders have no ext). */
export async function listTree(from, dir, token, stats) {
  const out = [];
  const walk = async (d) => {
    const res = await call('GET', `${DA}/list/${from}/${d}`.replace(/\/+$/, ''), { token }, stats);
    const entries = await res.json();
    for (const e of [...entries].sort((a, b) => (a.path < b.path ? -1 : 1))) {
      let rel = String(e.path || '').replace(new RegExp(`^/${from}/`), '');
      const ext = e.ext ? String(e.ext).toLowerCase() : null;
      if (ext && !rel.toLowerCase().endsWith(`.${ext}`)) rel = `${rel}.${ext}`; // the list may name a file without its extension
      if (ext) out.push({ path: rel, ext }); else await walk(rel);
    }
  };
  await walk(dir);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const readLedger = (file, from, to) => {
  if (!existsSync(file)) return { _provenance: { writtenBy: 'stardust:deploy/da-copy' }, from, to, rows: {} };
  const l = JSON.parse(readFileSync(file, 'utf8'));
  if (l.from !== from || l.to !== to) throw new Error(`${file} belongs to ${l.from} → ${l.to}; use --ledger for a second move`);
  return l;
};
// checkpoint after EVERY file (progress.mjs pattern: tmp + rename, a reader never sees a half write) — a killed run
// keeps every finished row and the re-run skips them (defect: the ledger was written once, at run end)
const persist = (file, ledger) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(`${file}.tmp`, `${JSON.stringify(ledger, null, 2)}\n`); renameSync(`${file}.tmp`, file); };

async function pool(items, n, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { for (;;) { const k = i; i += 1; if (k >= items.length) return; await worker(items[k]); } }));
}

export async function main(argv = process.argv.slice(2)) {
  let a;
  try { a = parseArgs(argv); } catch (e) { console.error(`da-copy: ${e.message}`); return 2; }
  if (a.help) { console.log(readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim()); return 0; }
  const tok = resolveToken(a.tokenEnv);
  if (!tok) { console.error(`da-copy: missing token in env ${a.tokenEnv} (looked in the shell, ./.env, ~/.claude/.env, ~/.env) — nothing copied`); return 2; }
  console.log(`da-copy ${a.from} → ${a.to}${a.prefix ? ` (${a.prefix}/)` : ''} · token ${a.tokenEnv} from ${tok.source} · ${a.publish ? 'preview + publish' : 'preview only (publish is a separate run)'}${a.dry ? ' · DRY' : ''}`);
  const stats = { retries: 0, tokenEnv: a.tokenEnv };
  const counts = { copied: 0, previewed: 0, live: 0, skipped: 0, failed: 0 };
  const summary = (code) => `SUMMARY da-copy ${a.from} → ${a.to} files=${counts.files ?? 0} copied=${counts.copied} previewed=${counts.previewed} live=${counts.live} skipped=${counts.skipped} failed=${counts.failed} retries=${stats.retries} exit=${code}`;
  let ledger;
  try { ledger = readLedger(a.ledger, a.from, a.to); } catch (e) { console.error(`da-copy: ${e.message}`); return 2; }
  let files;
  try { files = copyOrder(await listTree(a.from, a.prefix, tok.value, stats)); } catch (e) { console.error(`da-copy: list failed — ${e.message}`); console.log(summary(2)); return 2; }
  counts.files = files.length;
  const target = a.publish ? 'live' : 'previewed';
  const targetOf = (f) => (f.ext === 'html' || f.ext === 'json' ? target : 'copied'); // media is served from content.da.live — no preview/live step
  const [toOrg, toSite] = a.to.split('/');
  if (a.dry) {
    for (const f of files) { const row = ledger.rows[f.path]; console.log(`  ${row && RANK[row.status] >= RANK[targetOf(f)] ? 'skip ' : 'plan '} ${f.path}${row ? ` (${row.status})` : ''}`); }
    console.log(summary(0)); return 0;
  }
  let halted = null;
  const kindOf = (f) => (f.ext === 'html' ? 'html' : f.ext === 'json' ? 'json' : 'media');
  const waves = ['media', 'html', 'json'].map((k) => files.filter((f) => kindOf(f) === k)).filter((w) => w.length); // a wave completes before the next starts: no document ever precedes its media
  for (const wave of waves) await pool(wave, a.concurrency, async (f) => {
    if (halted) return;
    const want = targetOf(f);
    const row = ledger.rows[f.path] || { status: null, attempts: 0 };
    if (row.status && RANK[row.status] >= RANK[want]) { counts.skipped += 1; console.log(`  skip     ${f.path} (${row.status})`); return; }
    row.attempts += 1;
    try {
      if (!a.skipCopy && (!row.status || row.status === 'failed')) {
        const src = await call('GET', `${DA}/source/${a.from}/${f.path}`, { token: tok.value }, stats);
        const type = src.headers.get('content-type') || (f.ext === 'json' ? 'application/json' : f.ext === 'html' ? 'text/html' : 'application/octet-stream');
        let body;
        if (f.ext === 'html' || f.ext === 'json') body = new Blob([rewrite(await src.text(), a.from, a.to)], { type: f.ext === 'json' ? 'application/json' : 'text/html' });
        else body = new Blob([await src.arrayBuffer()], { type: type.split(';')[0] });
        const form = new FormData(); form.append('data', body, path.basename(f.path));
        await call('PUT', `${DA}/source/${a.to}/${f.path}`, { token: tok.value, body: form }, stats);
        row.status = 'copied'; counts.copied += 1; console.log(`  copied   ${f.path}`);
      } else if (a.skipCopy && !row.status) { console.log(`  skip     ${f.path} (not copied yet; --skip-copy)`); counts.skipped += 1; return; }
      if (want !== 'copied' && RANK[row.status] < RANK.previewed) {
        await call('POST', `${ADMIN}/preview/${toOrg}/${toSite}/main${webPathOf(f.path)}`, { token: tok.value }, stats);
        row.status = 'previewed'; counts.previewed += 1; console.log(`  previewed ${webPathOf(f.path)}`);
      }
      if (want === 'live' && RANK[row.status] < RANK.live) {
        await call('POST', `${ADMIN}/live/${toOrg}/${toSite}/main${webPathOf(f.path)}`, { token: tok.value }, stats);
        row.status = 'live'; counts.live += 1; console.log(`  live      ${webPathOf(f.path)}`);
      }
      delete row.lastError;
    } catch (e) {
      if (e.halt) { halted = e; return; }
      row.status = 'failed'; row.lastError = e.message; counts.failed += 1; console.log(`  FAILED   ${f.path}: ${e.message}`);
    } finally { row.ts = new Date().toISOString(); ledger.rows[f.path] = row; persist(a.ledger, ledger); }
  });
  persist(a.ledger, ledger);
  if (halted) { console.error(`da-copy: halted — ${halted.message}; ledger checkpointed at ${a.ledger}, re-run the same command after the refresh`); console.log(summary(2)); return 2; }
  const code = counts.failed ? 1 : 0;
  console.log(`ledger ${a.ledger} · old tree ${a.from} untouched · next: node skills/deploy/scripts/host-compare.mjs --old https://main--<old-site>--<old-org>.aem.live --new https://main--${toSite}--${toOrg}.aem.page --paths <roster>`);
  console.log(summary(code));
  return code;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main().then((c) => process.exit(c)).catch((e) => { console.error(`da-copy: ${e.message}`); process.exit(2); });
