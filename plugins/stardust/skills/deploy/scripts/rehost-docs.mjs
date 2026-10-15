#!/usr/bin/env node
/**
 * skills/deploy/scripts/rehost-docs.mjs — re-host the documents the source site links (pdf, office files, …) into
 * the code repository, so a migrated link keeps working when the source site is gone.
 *
 * Input: every <a href> in the committed captures (stardust/current/pages/<slug>.html, resolved against the
 *   record's `url` in <slug>.json) whose path ends in a document extension and whose host is the site's own —
 *   the captured pages' hosts, `www.` either way, plus --source-host. Other hosts are external documents: left
 *   absolute and counted. Links inside <script>, <style>, <template> and comments are not links.
 * Fetch: each document once, with da-media-upload.mjs's source fetch (the same browser-shaped request, capped
 *   retries, and verdicts: 401/403 = bot wall, NOT missing; 404/410 = missing at origin; an HTML answer is not a
 *   document). Deploy-time network, gated like the uploader: --dry-run lists the plan and sends nothing.
 * Writes: docs/<file> under --root (the code repository; served at /docs/<file>) and the ledger
 *   stardust/deploy/asset-ledger.json — {"<absolute source URL>": {path, sha256, bytes}}, keys sorted, under the
 *   deploy ledger lock, tmp + rename, only when its bytes change (schema: skills/deploy/schemas/
 *   deploy-asset-ledger.schema.json). A FAIL is never recorded: that link stays absolute, and the encoder
 *   reports it. <file> = the last path segment up to its first document extension, lower-case [a-z0-9-]
 *   (`guide.pdf.coredownload.pdf` → guide.pdf); a name another URL already holds gets -<sha1(url)[0..8]>;
 *   bytes identical to a recorded document share its file. URLs are processed in sorted order, so the names
 *   depend on the set of links, never on file order.
 * Re-runs: a recorded document whose docs file still has the recorded sha256 is skipped without a request; a
 *   missing or changed file is fetched again (its path is kept).
 *
 * Usage: node skills/deploy/scripts/rehost-docs.mjs [--root <projectDir>] [--source-host <host[,host]>]
 *          [--dry-run] [--retries <n>] [--backoff-ms <n>]
 * Output: OK <url> -> /docs/<file> (<n> bytes) | SKIP <url> already rehosted (ledger) -> … | FAIL <url> … |
 *   DRY <url> -> /docs/<file>, then one summary line.
 * Exit codes: 0 no failures (or nothing to do), 1 any FAIL, 2 usage error.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSource } from './da-media-upload.mjs';
import { readLedger, withLock } from './file-lock.mjs';

const HELP = `rehost-docs — re-host the site's linked documents (pdf, office files…) into the code repository's docs/

Usage: node rehost-docs.mjs [--root <projectDir>] [--source-host <host[,host]>] [--dry-run] [--retries <n>] [--backoff-ms <n>]
  --root <dir>          the project root, i.e. the EDS code repository (default: the current directory)
  --source-host <h,…>   more hosts whose documents are the site's own (the captured pages' hosts always are)
  --dry-run             list what would be fetched and where it would go; no network, no write
  --retries <n>         attempts after the first for 408/425/429/5xx/network (default 4)
  --backoff-ms <n>      base delay of the capped backoff (default 500)
  --help                this text

Reads the <a href> document links (pdf, doc[x], xls[x], ppt[x], odt/ods/odp, rtf, csv, epub, zip) in
stardust/current/pages/*.html; fetches each same-site document once (browser-shaped request; 403 = bot wall,
404 = missing — both FAIL and stay absolute); writes docs/<file> and stardust/deploy/asset-ledger.json
({url: {path, sha256, bytes}}, keys sorted, only when it changes). A re-run skips a document whose docs file still
has the recorded sha256, without a request.
Exit 0 = no failures, 1 = any FAIL, 2 = usage.`;

const USAGE_EXIT = 2;
const PAGES = 'stardust/current/pages';
const LEDGER = 'stardust/deploy/asset-ledger.json';
// The document extensions a migration carries over — the one list the encoder classifies links by (it imports this).
// No .txt: a linked .txt is the site's plain-text plumbing (robots, llms, ads, humans, security), which the new
// origin serves itself; a copy frozen under /docs/ would be stale. Such a link stays absolute and is reported.
export const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|od[tsp]|rtf|csv|epub|zip)$/i;
const DOC_PATH = /^\/docs\/[a-z0-9][a-z0-9-]*\.[a-z0-9]+$/;
const HREF = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function usage(msg) { console.error(`rehost-docs error: ${msg}\n\n${HELP}`); process.exit(USAGE_EXIT); }

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const o = { root: '.', hosts: [], dryRun: false, retries: 4, backoffMs: 500 };
  const num = (flag, v, min) => { const x = Number(v); if (!Number.isFinite(x) || x < min) usage(`${flag} needs a number ≥ ${min}`); return x; };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    const next = () => { const v = rest[i + 1]; if (v === undefined || /^--/.test(v)) usage(`${a} needs a value${v === undefined ? '' : ` (got ${v})`}`); return rest[i += 1]; };
    if (a === '--root') o.root = next();
    else if (a === '--source-host') o.hosts.push(...next().split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--retries') o.retries = num(a, next(), 0);
    else if (a === '--backoff-ms') o.backoffMs = num(a, next(), 0);
    else usage(`unknown argument ${a}`);
  }
  return o;
}

const ENTITY = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k[0] !== '#') return ENTITY[k];
  const cp = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
  return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
});

/** The absolute URLs (WHATWG form, fragment dropped; sorted, unique) of the document links in one capture. */
export function docLinks(html, base) {
  const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, '');
  const out = new Set();
  for (const m of text.matchAll(HREF)) {
    let u;
    try { u = new URL(decode(m[1] ?? m[2] ?? m[3]).trim(), base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || !DOC_EXT.test(u.pathname)) continue;
    u.hash = '';
    out.add(u.href);
  }
  return [...out].sort(byCodePoint);
}

/** docs/<file> for a document URL: the last segment up to its first document extension, lower-case [a-z0-9-]. */
export function docFileName(url) {
  const last = new URL(url).pathname.split('/').pop();
  let name = last;
  try { name = decodeURIComponent(last); } catch { /* keep it encoded */ }
  const ext = DOC_EXT.exec(name)[1].toLowerCase();
  const stem = name.slice(0, new RegExp(`\\.${ext}(?=\\.|$)`, 'i').exec(name).index)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${stem || 'document'}.${ext}`;
}
const hashedFileName = (url) => docFileName(url).replace(/(\.[a-z0-9]+)$/, `-${createHash('sha1').update(url).digest('hex').slice(0, 8)}$1`);

const hostKey = (h) => h.toLowerCase().replace(/^www\./, '');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const fileSha = (p) => (existsSync(p) && statSync(p).isFile() ? sha256(readFileSync(p)) : null);
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort(byCodePoint).map((k) => [k, sortKeys(v[k])])) : v);
const stableJSON = (obj) => `${JSON.stringify(sortKeys(obj), null, 2)}\n`;
function writeIfChanged(path, data) {
  if (existsSync(path) && readFileSync(path).equals(Buffer.from(data))) return false;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
  return true;
}

/** The same-site document links of every capture (sorted) and the count of external ones. */
export function collectDocLinks(pagesDir, extraHosts = []) {
  const records = [];
  if (existsSync(pagesDir) && statSync(pagesDir).isDirectory()) {
    for (const name of readdirSync(pagesDir).filter((f) => f.endsWith('.json')).sort(byCodePoint)) {
      const html = join(pagesDir, `${name.slice(0, -5)}.html`);
      let url;
      try { url = new URL(JSON.parse(readFileSync(join(pagesDir, name), 'utf8')).url); } catch { continue; }
      if (/^https?:$/.test(url.protocol)) records.push({ url, html });
    }
  }
  const hosts = new Set([...records.map((r) => hostKey(r.url.host)), ...extraHosts.map(hostKey)]);
  const own = new Set(); const external = new Set();
  for (const r of records) {
    if (!existsSync(r.html)) continue;
    for (const u of docLinks(readFileSync(r.html, 'utf8'), r.url.href)) (hosts.has(hostKey(new URL(u).host)) ? own : external).add(u);
  }
  return { pages: records.length, links: [...own].sort(byCodePoint), external: external.size };
}

/** One run. opts: root, hosts, dryRun, retries, backoffMs, fetch (injectable), say (line sink). */
export async function rehostDocs({ root = '.', hosts = [], dryRun = false, retries = 4, backoffMs = 500, fetch: doFetch, say = console.log } = {}) {
  const { pages, links, external } = collectDocLinks(join(root, PAGES), hosts);
  const counts = { links: links.length, rehosted: 0, skipped: 0, failed: 0, dry: 0, external };
  const ledgerPath = join(root, LEDGER);
  const ledger = readLedger(ledgerPath, (e) => say(`NOTE ${LEDGER} is not readable JSON (${e.message}) — it is rebuilt from this run`));
  const pathOf = (e) => (e && typeof e.path === 'string' && DOC_PATH.test(e.path) ? e.path : null);
  const recorded = Object.keys(ledger).filter((u) => pathOf(ledger[u])).sort(byCodePoint);
  const claimed = new Map(recorded.map((u) => [ledger[u].path, u]));
  const bySha = new Map([...recorded].reverse().map((u) => [ledger[u].sha256, ledger[u].path]));
  const own = {};
  const choose = (url, sha) => {
    const plain = `/docs/${docFileName(url)}`;
    const holder = claimed.get(plain);
    if ((!holder || holder === url) && (sha === null || [null, sha].includes(fileSha(join(root, plain.slice(1)))))) return plain;
    return `/docs/${hashedFileName(url)}`;
  };
  for (const url of links) {
    const recPath = pathOf(ledger[url]);
    if (recPath && fileSha(join(root, recPath.slice(1))) === ledger[url].sha256) {
      counts.skipped += 1; say(`SKIP ${url} already rehosted (ledger) -> ${recPath}`); continue;
    }
    if (dryRun) {
      const path = recPath || choose(url, null);
      claimed.set(path, url);
      counts.dry += 1; say(`DRY ${url} -> ${path}`); continue;
    }
    const got = await fetchSource(url, { retries, backoffMs, fetch: doFetch, accept: '*/*', expect: (ct) => !/^text\/html$/i.test(ct) });
    const fail = (what, why) => { counts.failed += 1; say(`FAIL ${url} ${what} (${why})`); };
    if (got.kind === 'bot-wall') { fail(`source ${got.status}`, 'bot wall: blocked for a script, NOT missing — never drop the link; it stays absolute until the document is re-hosted'); continue; }
    if (got.kind === 'missing') { fail(`source ${got.status}`, 'missing at origin — the link stays absolute and is reported; never substitute'); continue; }
    if (got.kind === 'unexpected-type') { fail(`source ${got.status}`, `answered ${got.contentType}, not a document`); continue; }
    if (got.kind !== 'ok') { fail(`source ${got.status || got.kind}`, got.why || 'fetch failed'); continue; }
    const sha = sha256(got.bytes);
    const shared = !recPath && bySha.get(sha);
    const path = recPath || shared || choose(url, sha);
    writeIfChanged(join(root, path.slice(1)), got.bytes);
    own[url] = { path, sha256: sha, bytes: got.bytes.length };
    claimed.set(path, url);
    if (!bySha.has(sha)) bySha.set(sha, path);
    counts.rehosted += 1;
    say(`OK ${url} -> ${path} ${shared ? '(same bytes as an earlier document)' : `(${got.bytes.length} bytes)`}`);
  }
  if (!dryRun && Object.keys(own).length) {
    // Under the deploy ledger lock: re-read, lay this run's entries over the file, write only when bytes change.
    withLock(ledgerPath, () => writeIfChanged(ledgerPath, stableJSON({ ...readLedger(ledgerPath), ...own })));
  }
  return { pages, counts };
}

async function main() {
  const o = parseArgs(process.argv);
  const { pages, counts } = await rehostDocs({ root: resolve(o.root), hosts: o.hosts, dryRun: o.dryRun, retries: o.retries, backoffMs: o.backoffMs });
  if (!pages) { console.log(`rehost-docs: no captured pages under ${PAGES} — nothing to rehost`); return; }
  console.log(`rehost-docs: ${counts.links} document link(s) — ${counts.rehosted} rehosted, ${counts.skipped} skipped, ${counts.failed} failed${counts.dry ? `, ${counts.dry} dry-run` : ''}${counts.external ? ` · ${counts.external} external left absolute` : ''}${o.dryRun ? '' : ` · ledger ${LEDGER}`}`);
  process.exitCode = counts.failed ? 1 : 0;
}

// Compare by real path (a symlinked checkout would otherwise turn the CLI into a silent no-op).
function isMainModule() {
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}
if (process.argv[1] && isMainModule()) {
  main().catch((e) => { console.error(`rehost-docs error: ${e.message}`); process.exit(USAGE_EXIT); });
}
