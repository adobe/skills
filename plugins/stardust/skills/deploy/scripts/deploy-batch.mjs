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
 * Path-safety (rollout delivery-gates.md § Gate 3; the rule is stardust/scripts/da-path.mjs):
 *   - no PUT ever goes to a path that differs from `normalizeDaPath(webPath)`. A page
 *     whose file-derived webPath is not delivery-safe (case, `_`, `--`, edge `-`, dots,
 *     diacritics, `%xx`, `.php` leaf, query) is PUT / previewed / published / verified at
 *     the safe path; the ledger row stays keyed on `webPath` and records `deployedPath`
 *     (the field update-coverage --from-ledger carries); one `webPath<TAB>safe` row is
 *     appended to --redirects-tsv (default stardust/redirects.tsv, deduped) once the page
 *     delivers. Two files folding to one safe path: the first (webPath order) is driven,
 *     the other is `path-collision` — no PUT, zero network. A segment with no safe form
 *     (non-Latin script) is `path-unsafe` — transliterate the file path. Gate 3 runs before
 *     the ledger's unchanged/hash decision: a page delivered alone at its folded path that later
 *     gains a colliding sibling is re-driven and parked, never skipped as `unchanged (hash)`.
 *   - `--strict-paths` turns every divergence into `path-unsafe` (no PUT): for pipelines
 *     where migrate already wrote safe paths, a divergence is a pipeline bug. No flag
 *     disables the fold.
 *
 * Publish hold (rollout publish-gate.md § Gate 8 — the release condition, D1 instrument):
 *   - a `--publish` run reads `stardust/rollout/gate-report.json` (gate-publish.mjs --report; `--gate-report
 *     <path>` names another file — a named file that is missing is exit 2, nothing read). Every row that
 *     would go live is HELD unless its report entry is `latest.pass === true` and its template is at the
 *     bar: plan reason `held (gate: 360 FAIL 12.4 % Δh -112)` / `held (gate: ungated — no published-origin
 *     number)` / `held (gate: unmeasured — 1440 exit 124)` / `held (gate: template program not at the bar)`;
 *     the ledger row stays `previewed`, no POST /live/, counts.held + SUMMARY `held=<n>`; the row re-drives on
 *     the next `--publish` once the report changes. `/index` ≡ `/` (the report is keyed by served path). A page
 *     with no template sits in the report's `untyped` group and takes that group's bar.
 *   - already-`live` rows are never unpublished: an unchanged live row (hash equal, or a hash-less legacy row —
 *     hash-unknown counts as unchanged here as in the rest of the plan) is skipped as today and its FAIL is
 *     reported `published-failing`; a CHANGED live row is a re-publish and goes through the hold.
 *   - escape hatches (operator / owner, never hands-off — D16): `--publish-no-regression` publishes a
 *     changed live row whose every breakpoint is ≤ its best-of-last-3 + 1 point (reason carries
 *     `no-regression: 1440 24.9→23.0`; the report status stays published-failing); `--publish-ungated`
 *     publishes rows with NO report entry (redesign flow / owner-decided `publish: live` row). No flag
 *     publishes a FAIL, unmeasured or not-at-bar row; `--force` re-drives but never lifts a hold.
 *   - no report file and no flag = today's behaviour, with one WARN line (`publishing ungated`). Hands-off
 *     (rollout Phase C) NAMES the default path — `--gate-report stardust/rollout/gate-report.json` — so an
 *     absent report is exit 2 there, never an ungated publish (publish-gate.md § Gate 8 → Hands-off); the
 *     driver enforces it as well: `stardust/state.json` `handsOff: true` + no report + `--publish` (plan or
 *     run) = fatal exit 2, nothing written — hands-off never weakens a gate.
 *
 * Token lifecycle (the one credential failure a run cannot self-recover; the
 * resolve/decode/smoke primitives are skills/deploy/scripts/lib.mjs):
 *   - preflight: DA_TOKEN is resolved shell → ./.env → ~/.claude/.env → ~/.env
 *     (the SOURCE CLASS is printed, never the value or a home path); its IMS
 *     expiry is decoded (`created_at` + `expires_in` ms; `exp` s as fallback;
 *     unknown → warn and run) and ONE authenticated GET admin.da.live/list/… is
 *     made before any PUT. Exit 2 when that GET is 401, the token is expired, or
 *     it will expire before `todo × --sec-per-page ÷ concurrency` (`--ignore-ttl`
 *     to run anyway; the default s/page is the median `ms` of this log ≥ 20 rows, else 6).
 *   - halt: the FIRST 401 from PUT/preview/live/DA GET stops the pool (401 is
 *     never retried), every in-flight row keeps its PREVIOUS status, the ledger
 *     is persisted, the log gets one `halt` line and stdout the one instruction
 *     with `next=<the same command minus --force>` — exit 3. Re-running `next`
 *     resumes (the delivered pages skip; `--force` would re-drive them all).
 *   - access-restricted: a delivered GET answering 401 `x-error: access-not-allowed`
 *     with no site token resolved halts (exit 3) with the remedy; with a site
 *     token (`--site-token-env`, default SITE_TOKEN_<REPO> then SITE_TOKEN, sent as
 *     `Authorization: token …` to the delivery host ONLY) a 401 is a per-page verify-fail.
 *   - content-bus reset: ≥ 3 previously delivered pages answering 404 at the
 *     startup re-verify print one warning sentinel (`log step:'sentinel'`) and are
 *     re-driven — no halt (the driver self-heals; the uppercase-path class also 404s).
 *
 * Completion contract (skills/stardust/scripts/progress.mjs): while running, the
 * driver writes stardust/.work/deploy/deploy-batch.progress.json (atomic; done/ok/
 * failed/lastPath) — the file the agent's ≤ 4-minute check reads; on every exit
 * (driving run, --plan/--report with mode=…, halt with halted=…, fatal with error=…)
 * the LAST stdout line is
 *   SUMMARY deploy-batch ok=<n> failed=<n> exit=<code> details=<ledger> skipped=<n> published=<n>|preview-only [held=<n>]
 * where ok/failed count the pages THIS run drove (a halt reports them too); `held=` appears when a
 * gate report was read.
 * Run it in the background (`nohup node … > stardust/.work/deploy/deploy-batch.log 2>&1 &`)
 * and read the progress file, then the SUMMARY line — never `sleep N; grep -c`.
 * Per driven page the stderr line prints https://<branch>--<repo>--<org>.aem.page<webPath>
 * (aem.live on a publish run) and the summary names the first URL — the deploy/replica
 * status line copies it (the URL is derived at print time, never written into the ledger).
 *
 * Usage:
 *   DA_TOKEN=… node skills/deploy/scripts/deploy-batch.mjs --org <org> --repo <repo> --branch <branch> \
 *     --content content [--paths <file|a,b,c>] [--exclude <file|a,b,c>] [--concurrency 4] \
 *     [--publish] [--force] [--allow-thin] [--allow-shrink] [--ledger path] [--log path] \
 *     [--progress path | --no-progress] [--token-env DA_TOKEN] [--site-token-env NAME] \
 *     [--sec-per-page 6] [--ignore-ttl] [--require-code-synced [--code-sync-record stardust/code-sync.json]] \
 *     [--strict-paths] [--redirects-tsv stardust/redirects.tsv] [--plan | --report] \
 *     [--gate-report stardust/rollout/gate-report.json] [--publish-no-regression] [--publish-ungated] \
 *     [--skip-code-sync-verify <reason>]
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
 *             `excluded` / `not in content tree` / `previewed (publish fast path)` / `held (gate: …)`.
 * --report    print the ledger grouped by status — no network, exit 0.
 * --allow-thin    PUT a body under 200 B / without `<main` anyway.
 * --allow-shrink  PUT over an existing DA document more than 5× larger anyway.
 * --progress <path>  progress JSON path (default stardust/.work/deploy/deploy-batch.progress.json);
 *             `--no-progress` writes none (the SUMMARY line still prints).
 * --token-env NAME     env name of the DA (IMS) token — default DA_TOKEN.
 * --site-token-env NAME  env name of the site token for an access-restricted
 *             delivery host — default SITE_TOKEN_<REPO> (uppercased, non-alphanumerics → _), then SITE_TOKEN.
 * --sec-per-page N     wall seconds per page for the TTL projection (default: log median, else 6).
 * --ignore-ttl         run although the token is projected to expire mid-batch.
 * --require-code-synced  refuse to open the ledger unless code-sync-verify.mjs's record
 *             (`--code-sync-record`, default stardust/code-sync.json) is `status: ok` for this
 *             --org/--repo/--branch — the served code IS the working tree before content is
 *             previewed against it (da-deploy-protocol.md § Code push gates). Exit 3, nothing
 *             read or written; default off so existing invocations are untouched.
 * --concurrency  parallel pages in flight (default 4; DA admin tolerates ~4-6).
 * --strict-paths       a webPath that differs from its safe form is `path-unsafe`, no PUT.
 * --redirects-tsv <f>  where `webPath<TAB>safe` rows go (default stardust/redirects.tsv).
 * --gate-report <f>    the gate-publish report a --publish run holds against (default
 *             stardust/rollout/gate-report.json when it exists; a named file must exist — exit 2).
 * --publish-no-regression  publish a changed already-live row whose every breakpoint is ≤ best-of-last-3 + 1.
 * --publish-ungated    publish rows with no report entry (owner-decided `publish: live`, redesign flow).
 * --skip-code-sync-verify <reason>  the recorded escape from the served == tree precondition: one log line
 *             `{ step: "instrument", instrument: "code-sync-verify", skipped: <reason> }` and one stderr line
 *             (da-deploy-protocol.md § Code push gates); refused together with --require-code-synced.
 *
 * Plan line: `N pages · U unchanged (hash) · C changed · K new · F failed-last-time
 * · X excluded · H held (gate) · T to drive`. Log (append-only jsonl) survives a restart.
 *
 * Exit codes: 0 = every driven page verified (held rows are not driven — read `held=`); 1 = one or more
 * FAILs (re-run the same command — verified pages are skipped); 2 = fatal (usage, missing/rejected/
 * expired token, a named --gate-report that does not exist — nothing was PUT); 3 = halted on the first 401 mid-batch or an
 * access-restricted delivery host (ledger checkpointed; re-run the printed `next`), or
 * refused by --require-code-synced before the ledger was read (record missing / stale / other ref).
 * A row flips to `live`/`previewed` only after the delivered GET — never on POST codes.
 *
 * Test hooks (fixture tests only): DEPLOY_BATCH_DA_SRC, DEPLOY_BATCH_ADMIN,
 * DEPLOY_BATCH_DELIVERY_BASE and DEPLOY_BATCH_DA_LIST override the hosts;
 * DEPLOY_BATCH_REPAIR_DELAY_MS shortens the 3 s repair/blip wait. The module is importable
 * (normalisePath, readPathList, walkHtml, annotateSafePaths, buildPlan, mergeLedger, serialPersister,
 * loadGateReport, gateEntry, gateVerdict, gateCoverageLine) — main() runs only as a CLI.
 * Pages are driven in webPath order (readdir order is filesystem-specific).
 *
 * No external deps — uses Node's global fetch/FormData/Blob (Node 18+).
 */
import { readFile, writeFile, appendFile, readdir, stat, rename, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createProgress, defaultProgressFile, summaryLine } from '../../stardust/scripts/progress.mjs';
import { resolveToken, tokenExpiry, daSmoke, siteTokenName } from './lib.mjs';
import { normalizeDaPath } from '../../stardust/scripts/da-path.mjs';

const DA_SRC = process.env.DEPLOY_BATCH_DA_SRC || 'https://admin.da.live/source';
const ADMIN = process.env.DEPLOY_BATCH_ADMIN || 'https://admin.hlx.page';
const DELIVERY_BASE = process.env.DEPLOY_BATCH_DELIVERY_BASE || null;
const HALT_EXIT = 3;
const NEXT_STRIP = new Set(['--force']); // one-shot flags never echoed into the resume command
const OK_STATUS = new Set(['live', 'previewed']);
const REPAIR_DELAY_MS = Number(process.env.DEPLOY_BATCH_REPAIR_DELAY_MS) || 3000;
const MIN_BODY_BYTES = 200;
const SHRINK_RATIO = 5;
const GATE_REPORT_DEFAULT = path.join('stardust', 'rollout', 'gate-report.json');

export const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

/** A 401 mid-batch or an access-restricted delivery host: stop, checkpoint, instruct. */
export class HaltError extends Error {
  constructor(why, remedy) { super(remedy); this.why = why; this.remedy = remedy; }
}

// Credential primitives live in ./lib.mjs (one implementation for every deploy script); re-exported for existing importers.
export { resolveToken, tokenExpiry, daSmoke };

/** SITE_TOKEN_<REPO> (uppercased, non-alphanumerics → _) then SITE_TOKEN. */
export function siteTokenNames(repo) {
  return [siteTokenName(repo), 'SITE_TOKEN'];
}

/** median `ms` of the verify rows in an existing log — the s/page default (≥ 20 samples). */
export function medianSecPerPage(logFile, fallback = 6) {
  if (!existsSync(logFile)) return fallback;
  const ms = readFileSync(logFile, 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((o) => o && o.step === 'verify' && Number.isFinite(o.ms)).map((o) => o.ms).sort((a, b) => a - b);
  if (ms.length < 20) return fallback;
  return Math.max(1, Math.round(ms[Math.floor(ms.length / 2)] / 1000));
}

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
  console.log('usage: node skills/deploy/scripts/deploy-batch.mjs --org <org> --repo <repo> --branch <branch> [--content content] [--paths <file|a,b>] [--exclude <file|a,b>] [--concurrency 4] [--publish] [--force] [--allow-thin] [--allow-shrink] [--ledger <path>] [--log <path>] [--progress <path> | --no-progress] [--token-env DA_TOKEN] [--site-token-env NAME] [--sec-per-page 6] [--retries 4] [--ignore-ttl] [--require-code-synced] [--code-sync-record <path>] [--strict-paths] [--redirects-tsv <file>] [--plan | --report] [--gate-report <file>] [--publish-no-regression] [--publish-ungated] [--skip-code-sync-verify <reason>]');
}

export function parseArgs(argv) {
  const a = { content: 'content', concurrency: 4, publish: false, force: false, retries: 4, plan: false, report: false, allowThin: false, allowShrink: false, ignoreTtl: false, strictPaths: false, redirectsTsv: path.join('stardust', 'redirects.tsv') };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    const next = () => { const v = argv[i + 1]; if (v === undefined || /^--/.test(v)) throw new Error(`${k} needs a value`); i += 1; return v; }; // `--progress --plan` once recorded "--plan" as the progress path
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
    else if (k === '--progress') a.progress = next();
    else if (k === '--no-progress') a.progress = null;
    else if (k === '--token-env') a.tokenEnv = next();
    else if (k === '--site-token-env') a.siteTokenEnv = next();
    else if (k === '--sec-per-page') a.secPerPage = Math.max(0.1, +next() || 6);
    else if (k === '--ignore-ttl') a.ignoreTtl = true;
    else if (k === '--require-code-synced') a.requireCodeSynced = true;
    else if (k === '--code-sync-record') a.codeSyncRecord = next();
    else if (k === '--strict-paths') a.strictPaths = true;
    else if (k === '--redirects-tsv') a.redirectsTsv = next();
    else if (k === '--gate-report') a.gateReport = next();
    else if (k === '--publish-no-regression') a.publishNoRegression = true;
    else if (k === '--publish-ungated') a.publishUngated = true;
    else if (k === '--skip-code-sync-verify') a.skipCodeSyncVerify = next();
    else if (k === '--help' || k === '-h') { usage(); process.exit(0); }
    else throw new Error(`unknown arg: ${k}`);
  }
  if (!a.report && (!a.org || !a.repo || !a.branch)) throw new Error('--org, --repo and --branch are required'); // --report reads the ledger only
  if (!a.publish && (a.gateReport || a.publishNoRegression || a.publishUngated)) throw new Error('--gate-report, --publish-no-regression and --publish-ungated apply to a --publish run only (the hold acts on rows that would go live)');
  if (a.skipCodeSyncVerify !== undefined && a.requireCodeSynced) throw new Error('--skip-code-sync-verify and --require-code-synced are exclusive — skip with a reason, or require the record');
  a.offline = a.plan || a.report;
  const tok = resolveToken(a.tokenEnv || 'DA_TOKEN');
  a.token = tok ? tok.value : undefined;
  a.tokenSource = tok ? tok.source : null;
  if (!a.token && !a.offline) throw new Error(`missing token in env ${a.tokenEnv || 'DA_TOKEN'} (looked in the shell, ./.env, ~/.claude/.env, ~/.env)`);
  const siteNames = a.siteTokenEnv ? [a.siteTokenEnv] : siteTokenNames(a.repo);
  const site = siteNames.map((n) => resolveToken(n)).find(Boolean);
  a.siteAuth = site ? (/^(token|bearer) /i.test(site.value) ? site.value : `token ${site.value}`) : null;
  a.siteTokenName = siteNames[0];
  a.codeSyncRecord ||= 'stardust/code-sync.json';
  a.ledger ||= path.join(a.content, '.deploy-ledger.json');
  a.log ||= path.join(a.content, '.deploy-log.jsonl');
  if (a.progress === undefined) a.progress = defaultProgressFile('deploy', 'deploy-batch');
  return a;
}

/** Every *.html under dir, in webPath order — readdir order is filesystem-specific, the drive order must not be. `list` is injectable for the fixture test. */
export async function walkHtml(dir, base = dir, list = readdir) {
  const out = [];
  for (const name of await list(dir)) {
    const full = path.join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) out.push(...(await walkHtml(full, base, list)));
    else if (name.endsWith('.html')) {
      const rel = path.relative(base, full).replace(/\.html$/, '');
      out.push({ file: full, webPath: `/${rel}` });
    }
  }
  return out.sort((a, b) => (a.webPath < b.webPath ? -1 : a.webPath > b.webPath ? 1 : 0));
}

/**
 * Gate 3 before any network: `safePath` = normalizeDaPath(webPath) (null = no safe form),
 * `collision` = the webPath that already claimed the same safe path (first in webPath order
 * wins). Mutates the page records; returns the counts the header line prints.
 */
export function annotateSafePaths(pages) {
  const claimed = new Map();
  const counts = { normalised: 0, collisions: 0, unsafe: 0 };
  for (const p of pages) {
    p.safePath = normalizeDaPath(p.webPath);
    p.collision = null;
    if (p.safePath === null) { counts.unsafe += 1; continue; }
    const owner = claimed.get(p.safePath);
    if (owner !== undefined) { p.collision = owner; counts.collisions += 1; continue; }
    claimed.set(p.safePath, p.webPath);
    if (p.safePath !== p.webPath) counts.normalised += 1;
  }
  return counts;
}

/** `source<TAB>destination` rows of an existing redirects sheet, as a Set of `src\tdst`. */
function readRedirectRows(file) {
  if (!existsSync(file)) return new Set();
  return new Set(readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\t+|\s{2,}/).slice(0, 2).join('\t')));
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
    if (status === 401) throw new HaltError('401', 'DA_TOKEN rejected (401) — expired or revoked');
    if (RETRYABLE.has(status) && attempt < retries) {
      await sleep(Math.min(15000, 500 * 2 ** attempt) + attempt * 137); // capped backoff + deterministic jitter
      continue;
    }
    return { status, text };
  }
}

async function deliveredOk({ org, repo, branch, webPath, tld = 'aem.live', siteAuth = null, siteTokenName = 'SITE_TOKEN' }) {
  // admin 200 != delivered; GET the rendered .plain.html on the delivery tree
  // (live = aem.live; preview-only = aem.page). One retry after a blip (fetch
  // error, 5xx, 000) — a 404 or about:error is a verdict, never retried here.
  // The site token (if any) goes to THIS host only — never to admin.
  const url = deliveryUrl({ org, repo, branch, tld, webPath });
  for (let attempt = 0; ; attempt += 1) {
    let status = 0;
    let why;
    try {
      const res = await fetch(url, { headers: { 'accept-encoding': 'gzip', ...(siteAuth ? { authorization: siteAuth } : {}) } });
      status = res.status;
      if (status === 200) {
        const html = await res.text();
        if (html.includes('about:error')) return { ok: false, why: 'about:error in delivered html', aboutError: true };
        return { ok: true };
      }
      const xerr = res.headers.get('x-error') || '';
      if (status === 401 && /access-not-allowed/.test(xerr) && !siteAuth) {
        throw new HaltError('access-restricted', `delivery host answers 401 x-error: access-not-allowed and no site token is set — put ${siteTokenName} in .env (sent as \`Authorization: token …\` to the delivery host only), or ask the owner to widen access.site.allow`);
      }
      why = `plain.html ${status}${xerr ? ` (x-error: ${xerr})` : ''}`;
    } catch (err) {
      if (err instanceof HaltError) throw err;
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
    if (res.status === 401) throw new HaltError('401', 'DA_TOKEN rejected (401) — expired or revoked');
    const buf = res.status === 200 ? Buffer.from(await res.arrayBuffer()) : null;
    return { status: res.status, length: buf ? buf.length : 0 };
  } catch (err) {
    if (err instanceof HaltError) throw err;
    return { status: 0, length: 0, text: String(err.message || err) };
  }
}

/* ------------------------------------------------------------ publish hold (Gate 8) -- */

/** The gate-publish report a --publish run holds against; null when the default file is absent. A NAMED file must exist. */
export function loadGateReport(file = GATE_REPORT_DEFAULT, explicit = false) {
  if (!existsSync(file)) {
    if (explicit) throw new Error(`--gate-report ${file} not found — run gate-publish.mjs --report first (publish-gate.md § Gate 8); nothing was read`);
    return null;
  }
  let report;
  try { report = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`gate report ${file} is not valid JSON (${e.message})`); }
  if (!report || typeof report.pages !== 'object' || report.pages === null) throw new Error(`gate report ${file} has no pages{} — not a gate-publish.mjs report`);
  return { file, report };
}

/** Hands-off never weakens a gate: state.json `handsOff: true` with no gate report refuses an ungated --publish (exit 2). */
export function handsOffProject(file = path.join('stardust', 'state.json')) {
  try { return JSON.parse(readFileSync(file, 'utf8')).handsOff === true; } catch { return false; }
}

/** The report entry for a ledger webPath; `/index` folds to `/` (the report is keyed by served path). */
export function gateEntry(report, webPath) {
  const pages = report.pages || {};
  if (pages[webPath]) return pages[webPath];
  if (/\/index$/.test(webPath)) { const folded = webPath.slice(0, -'/index'.length) || '/'; if (pages[folded]) return pages[folded]; }
  return null;
}

const gateBp = (W, b) => {
  if (b.status === 'fail') return `${W} FAIL${Number.isFinite(b.pixelPct) ? ` ${b.pixelPct} %` : ''}${Number.isFinite(b.heightDelta) ? ` Δh ${b.heightDelta}` : ''}`;
  if (b.status === 'unmeasured' || b.status === 'blocked') return `${W}${Number.isFinite(b.exit) ? ` exit ${b.exit}` : ' no verdict'}`;
  return `${W} ${b.status}`;
};

/**
 * May this row go live under the report? { allow: true, note? } | { allow: false, why }.
 * PASS = latest.pass with the page's template at the bar; ungated rows publish only under --publish-ungated;
 * a FAIL on an already-live row (a re-publish) only under --publish-no-regression when no breakpoint sits
 * above its best-of-last-3 + 1 point; unmeasured / blocked never (B32 — no verdict is not a pass).
 */
export function gateVerdict(report, webPath, { wasLive = false, publishUngated = false, publishNoRegression = false } = {}) {
  const ungated = () => (publishUngated ? { allow: true, note: 'ungated — --publish-ungated' } : { allow: false, why: 'ungated — no published-origin number' });
  const e = gateEntry(report, webPath);
  if (!e) return ungated();
  const l = e.latest || {};
  const bps = l.breakpoints || {};
  const rows = (pred) => Object.entries(bps).filter(([, b]) => b && pred(b)).map(([W, b]) => gateBp(W, b)).join(', ');
  if (l.pass === true && l.status === 'pass') {
    const tplName = e.template || 'untyped'; // gate-publish groups template-less pages under `untyped` with its own bar
    const tpl = report.templates ? report.templates[tplName] : null;
    if (tpl && tpl.atBar === false) return { allow: false, why: `template ${tplName} not at the bar` };
    return { allow: true };
  }
  if (l.status === 'ungated') return ungated();
  if (l.status === 'unmeasured' || l.status === 'blocked') return { allow: false, why: `${l.status} — ${rows((b) => b.status === l.status) || 'no verdict'}` };
  const failing = rows((b) => b.status === 'fail') || `${l.status || 'no PASS'}`;
  const live = wasLive || e.wasLive === true;
  if (live && publishNoRegression) {
    const best = e.bestOfLast3 || {};
    const widths = Object.keys(bps);
    const within = widths.length > 0 && widths.every((W) => Number.isFinite(bps[W].pixelPct) && Number.isFinite(best[W]) && bps[W].pixelPct <= best[W] + 1);
    if (within) return { allow: true, note: `no-regression: ${widths.map((W) => `${W} ${best[W]}→${bps[W].pixelPct}`).join(' ')}` };
    return { allow: false, why: `${failing} — regressed past best-of-last-3 + 1 (--publish-no-regression does not apply)` };
  }
  return { allow: false, why: `${failing}${live ? ' — published-failing; a re-publish takes --publish-no-regression (owner)' : ''}` };
}

/** The report's coverage line with this run's held count appended. */
export function gateCoverageLine(report, held) {
  const c = report.coverage || {};
  const n = (k) => (Number.isFinite(c[k]) ? c[k] : 0);
  return `published-gated ${n('gated')} of ${n('delivered')} · PASS ${n('pass')} · FAIL ${n('fail')} · unmeasured ${n('unmeasured')} · ungated ${n('ungated')}${n('publishedFailing') ? ` · published-failing ${n('publishedFailing')}` : ''}${n('blocked') ? ` · blocked ${n('blocked')}` : ''} · held ${held}`;
}

/**
 * Decide, per page, drive or skip — and why. `verify` is the delivered-GET
 * probe (null in --plan mode: no network, hash-unknown rows count as unchanged
 * and say so). Mutates `ledger` only for --force resets and hash backfills;
 * every touched path is added to `touched` so persist() merges just those rows.
 */
export async function buildPlan({ pages, ledger, want, exclude, publish, force, branch, verify, touched, strictPaths = false, gate = null, publishUngated = false, publishNoRegression = false }) {
  const rows = [];
  const todo = [];
  const counts = { pages: 0, unchanged: 0, changed: 0, new: 0, failedLast: 0, excluded: 0, missing: 0, forced: 0, fastPublish: 0, reverify: 0, pathSafety: 0, held: 0, publishedFailing: 0 };
  const seen = new Set();
  const tld = publish ? 'aem.live' : 'aem.page';
  let gateNote = ''; // per page: the escape that let a drive through, or the published-failing note on a skip
  const drive = (p, reason, key) => { rows.push({ webPath: p.webPath, action: 'drive', reason: `${reason}${gateNote}` }); todo.push(p); if (key) counts[key] += 1; };
  const skip = (p, reason, key) => { rows.push({ webPath: p.webPath, action: 'skip', reason: `${reason}${gateNote}` }); if (key) counts[key] += 1; };

  for (const p of pages) {
    if (want && !want.has(p.webPath)) continue;
    seen.add(p.webPath);
    counts.pages += 1;
    if (exclude && exclude.has(p.webPath)) { skip(p, 'excluded', 'excluded'); continue; }
    p.hash = sha1(await readFile(p.file));
    // Gate 3 first: a page with no safe form, a collision, or a --strict-paths divergence is
    // always driven so deployOne parks it offline (path-unsafe / path-collision, zero network) —
    // even when its ledger row is OK and its bytes are unchanged (a sibling may have appeared
    // since it was delivered; the delivered GET at the folded path would be the OTHER page).
    gateNote = '';
    if (p.safePath === null || p.collision || (strictPaths && p.safePath !== undefined && p.safePath !== p.webPath)) {
      drive(p, p.collision ? `path-collision (${p.collision})` : 'path-unsafe', 'pathSafety');
      continue;
    }
    const rec = ledger[p.webPath];
    // Gate 8 — the publish hold (publish-gate.md): a row that would go live needs a PASS in the report. An
    // unchanged live row is never touched (unpublishing is an owner decision — its FAIL is reported); a
    // changed live row is a re-publish and is held like any other. Before `force`: --force never lifts a hold.
    // A hash-less (legacy) live row counts as unchanged, as everywhere else in this plan (the live run's
    // delivered GET decides, and backfills the hash).
    if (publish && gate) {
      const liveUnchanged = !!(rec && rec.status === 'live' && (!rec.bodyHash || rec.bodyHash === p.hash) && !force);
      if (liveUnchanged) {
        const e = gateEntry(gate.report, p.webPath);
        if (e && e.latest && e.latest.status === 'published-failing') { counts.publishedFailing += 1; gateNote = ` · published-failing (gate: ${gateVerdict(gate.report, p.webPath, { wasLive: true }).why.replace(/ — published-failing.*$/, '')})`; }
      } else {
        const v = gateVerdict(gate.report, p.webPath, { wasLive: !!(rec && rec.status === 'live'), publishUngated, publishNoRegression });
        if (!v.allow) { skip(p, `held (gate: ${v.why})`, 'held'); continue; }
        if (v.note) gateNote = ` (gate: ${v.note})`;
      }
    }
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
    const v = await verify({ webPath: p.safePath || p.webPath, tld });
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
    + `${c.forced ? ` · ${c.forced} forced` : ''}${c.fastPublish ? ` · ${c.fastPublish} previewed→publish` : ''}${c.reverify ? ` · ${c.reverify} re-verify failed` : ''}${c.pathSafety ? ` · ${c.pathSafety} path-safety` : ''}${c.held ? ` · ${c.held} held (gate)` : ''}${c.publishedFailing ? ` · ${c.publishedFailing} published-failing` : ''}`
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

/**
 * Serialise writes: two workers reaching a checkpoint inside one persist's await
 * window must not race the tmp+rename. A REJECTED write reaches only its own
 * awaiter — the chain resets, so the next checkpoint (and the final write) still
 * runs instead of every later persist being skipped behind the first failure.
 */
export function serialPersister(fn) {
  let chain = Promise.resolve();
  return () => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };
}

let persistSeq = 0;
async function persistLedger(file, ledger, touched) {
  const merged = mergeLedger(await readLedger(file), ledger, touched);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${(persistSeq += 1)}.tmp`;
  await writeFile(tmp, JSON.stringify(merged, null, 2));
  await rename(tmp, file);
  return merged;
}

async function deployOne(page, args, ledger, logLine, shared, redirects = null) {
  const { org, repo, branch, token, publish, siteAuth, siteTokenName } = args;
  const rec = ledger[page.webPath] || (ledger[page.webPath] = { status: 'pending', attempts: 0 });
  const t0 = Date.now();
  rec.attempts += 1;
  rec.ts = new Date().toISOString();
  let putHash = null; // recorded on the row only once the delivered GET passes

  // 0. path-safety (Gate 3) — zero network. The ledger stays keyed on the file-derived
  //    webPath; the page is driven at its safe path and the row records `deployedPath`.
  const safe = page.safePath === undefined ? normalizeDaPath(page.webPath) : page.safePath;
  if (safe === null) {
    rec.status = 'path-unsafe';
    rec.lastError = 'no delivery-safe form (a segment empties after folding — non-Latin script): transliterate the file path (delivery-gates.md § Gate 3)';
    await logLine({ path: page.webPath, step: 'path-safety', status: rec.status });
    return rec;
  }
  if (page.collision) {
    rec.status = 'path-collision';
    rec.lastError = `normalises to ${safe}, already claimed by ${page.collision} — give one of them a distinct path (no PUT)`;
    await logLine({ path: page.webPath, step: 'path-safety', status: rec.status, safe, claimedBy: page.collision });
    return rec;
  }
  if (args.strictPaths && safe !== page.webPath) {
    rec.status = 'path-unsafe';
    rec.lastError = `path differs from its safe form ${safe} (--strict-paths: migrate must write safe paths)`;
    await logLine({ path: page.webPath, step: 'path-safety', status: rec.status, safe });
    return rec;
  }
  if (safe !== page.webPath) rec.deployedPath = safe; else delete rec.deployedPath;
  const enc = encodeURI(safe);

  // Publish fast path: a page this ledger already holds as `previewed`, whose
  // bytes are unchanged (hash) and that still delivers on aem.page needs only
  // POST /live/ + verify — re-running PUT → preview for every page would double
  // the admin traffic of a 1k-page run.
  const fastPublish = publish && !args.force && rec.status === 'previewed' && rec.bodyHash && rec.bodyHash === page.hash
    && (await deliveredOk({ org, repo, branch, webPath: safe, tld: 'aem.page', siteAuth, siteTokenName })).ok;

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
    putHash = sha1(buf);

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
  let v = await deliveredOk({ org, repo, branch, webPath: safe, tld, siteAuth, siteTokenName });
  if (!v.ok && v.aboutError) {
    const again = await call('POST', `${ADMIN}/preview/${org}/${repo}/${branch}${enc}`, { token }, 1);
    if (again.status < 400 && publish) await call('POST', `${ADMIN}/live/${org}/${repo}/${branch}${enc}`, { token }, 1);
    await sleep(REPAIR_DELAY_MS);
    const v2 = again.status < 400 ? await deliveredOk({ org, repo, branch, webPath: safe, tld, siteAuth, siteTokenName }) : { ok: false, why: `re-preview ${again.status}` };
    await logLine({ path: page.webPath, step: 'repreview', status: again.status, ok: v2.ok });
    if (v2.ok) rec.repaired = 're-preview';
    else delete rec.repaired;
    v = v2.ok ? v2 : { ok: false, why: v2.aboutError ? 'about:error (persists after re-preview)' : v2.why };
  } else if (v.ok) delete rec.repaired;
  rec.verify = v.ok ? 'ok' : v.why;
  rec.status = v.ok ? (publish ? 'live' : 'previewed') : 'verify-fail';
  if (v.ok) {
    delete rec.lastError; // a stale "PUT 401" must not outlive the page's recovery
    if (putHash) { rec.bodyHash = putHash; rec.branch = branch; }
    if (safe !== page.webPath && redirects) await redirects.add(page.webPath, safe);
  } else rec.lastError = v.why;
  await logLine({ path: page.webPath, step: 'verify', ok: v.ok, why: v.why, ms: Date.now() - t0 });
  return rec;
}

/** Bounded pool; a HaltError from any worker drains the queue and is re-thrown once all in-flight pages settle. */
async function pool(items, n, worker) {
  const q = [...items];
  let halted = null;
  const run = async () => {
    while (q.length && !halted) {
      try { await worker(q.shift()); } catch (err) {
        if (!(err instanceof HaltError)) throw err;
        halted = err; q.length = 0;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
  if (halted) throw halted;
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

/** --require-code-synced: the reason to refuse, or null when the record proves served == tree for this org/repo/branch. */
export function codeSyncRefusal({ codeSyncRecord, org, repo, branch }) {
  const rerun = `run node skills/deploy/scripts/code-sync-verify.mjs --org ${org} --repo ${repo} --ref ${branch} (exit 0) first`;
  if (!existsSync(codeSyncRecord)) return `no code-sync record at ${codeSyncRecord} — ${rerun}`;
  let rec;
  try { rec = JSON.parse(readFileSync(codeSyncRecord, 'utf8')); } catch (e) { return `${codeSyncRecord} is not valid JSON (${e.message}) — ${rerun}`; }
  if (rec.org !== org || rec.repo !== repo) return `${codeSyncRecord} is for ${rec.org}/${rec.repo}, not ${org}/${repo} — ${rerun}`;
  if (rec.ref !== branch) return `${codeSyncRecord} verified ref "${rec.ref}", this run previews on "${branch}" — ${rerun}`;
  if (rec.status !== 'ok') return `${codeSyncRecord} status is "${rec.status}" (HEAD ${String(rec.headSha).slice(0, 7)}, ${rec.ts}) — served code ≠ working tree; ${rerun}`;
  return null;
}

let summaryCtx = null; // set once args are known, so a fatal exit still prints a SUMMARY line

export async function main(argv = process.argv) {
  const args = parseArgs(argv);
  summaryCtx = { details: args.ledger };
  if (args.requireCodeSynced && !args.offline) {
    const why = codeSyncRefusal(args);
    if (why) {
      console.error(`[deploy-batch] REFUSED (--require-code-synced): ${why}. Nothing read or written.`);
      console.log(summaryLine({ driver: 'deploy-batch', exit: HALT_EXIT, details: args.ledger, extra: { refused: 'code-sync' } }));
      return HALT_EXIT;
    }
  }
  const ledger = await readLedger(args.ledger);
  if (args.report) {
    report(ledger);
    console.log(summaryLine({ driver: 'deploy-batch', exit: 0, details: args.ledger, extra: { mode: 'report', rows: Object.keys(ledger).length } }));
    return 0;
  }

  // Gate 8: the publish hold reads gate-publish's report; a named file must exist (exit 2), the default may be absent (WARN)
  const gate = args.publish ? loadGateReport(args.gateReport || GATE_REPORT_DEFAULT, !!args.gateReport) : null;
  const say = args.plan ? console.log : console.error;
  if (args.publish && !gate && handsOffProject()) throw new Error(`hands-off project (stardust/state.json handsOff: true) and no gate report at ${GATE_REPORT_DEFAULT} — an ungated publish is never hands-off (publish-gate.md § Gate 8 → Hands-off): run gate-publish.mjs --report first. Nothing written`);
  if (args.publish && !gate) say(`[deploy-batch] WARN no gate report at ${GATE_REPORT_DEFAULT} — publishing ungated: every previewed row goes live (publish-gate.md § Gate 8: under flow: replica run gate-publish.mjs --report first)`);
  if (gate) say(`[deploy-batch] gate-report ${gate.file} (${gate.report.generatedAt || 'undated'}) — rows without a PASS at every breakpoint are held${args.publishUngated ? ' · --publish-ungated: rows with no entry publish' : ''}${args.publishNoRegression ? ' · --publish-no-regression: changed live rows within best-of-last-3 + 1 publish' : ''}`);
  if (args.skipCodeSyncVerify !== undefined && !args.offline) {
    console.error(`[deploy-batch] instrument: code-sync-verify skipped — ${args.skipCodeSyncVerify}`);
    await mkdir(path.dirname(args.log), { recursive: true });
    await appendFile(args.log, `${JSON.stringify({ t: new Date().toISOString(), step: 'instrument', instrument: 'code-sync-verify', skipped: args.skipCodeSyncVerify })}\n`);
  }

  const pages = await walkHtml(args.content);
  const pathCounts = annotateSafePaths(pages);
  const pathLine = pathCounts.normalised || pathCounts.collisions || pathCounts.unsafe
    ? `[deploy-batch] paths: ${pathCounts.normalised} normalised (rows → ${args.redirectsTsv})${pathCounts.collisions ? ` · ${pathCounts.collisions} collision(s)` : ''}${pathCounts.unsafe ? ` · ${pathCounts.unsafe} with no safe form` : ''}${args.strictPaths ? ' · --strict-paths: divergent pages are path-unsafe' : ''}`
    : null;
  // redirect rows: one `webPath<TAB>safe` per normalised page, appended once it delivers, deduped against the sheet
  const redirectRows = args.plan ? null : readRedirectRows(args.redirectsTsv);
  const redirects = args.plan ? null : {
    add: async (src, dst) => {
      const row = `${src}\t${dst}`;
      if (redirectRows.has(row)) return;
      redirectRows.add(row);
      await mkdir(path.dirname(args.redirectsTsv), { recursive: true });
      await appendFile(args.redirectsTsv, `${row}\n`);
    },
  };
  const want = args.paths ? await readPathList(args.paths) : null;
  const exclude = args.exclude ? await readPathList(args.exclude) : null;
  const touched = new Set();
  const logLine = async (o) => appendFile(args.log, `${JSON.stringify({ t: new Date().toISOString(), ...o })}\n`);
  const persist = serialPersister(() => persistLedger(args.ledger, ledger, touched));
  let progress = null; // created once the plan is known; halt() reads it so the SUMMARY counts what this run drove
  // `next` is the resume command: the same argv minus the one-shot flags — a re-run with `--force` would re-drive every selected page, including the ones this run already delivered
  const next = `node ${path.relative(process.cwd(), argv[1]) || argv[1]} ${argv.slice(2).filter((x) => !NEXT_STRIP.has(x)).map((x) => (/[\s"']/.test(x) ? JSON.stringify(x) : x)).join(' ')}`;
  const halt = async (err, driven, remaining) => {
    await persist();
    await logLine({ step: 'halt', why: err.why, driven, remaining });
    console.error(`[deploy-batch] HALT (${err.why}): ${err.remedy}${err.why === '401' ? ` (token source: ${args.tokenSource})` : ''}. ${driven} page(s) driven this run, ${remaining} remaining — their rows keep their previous status. Fix the credential, then re-run:`);
    console.log(`next=${next}`);
    const extra = { halted: err.why, remaining };
    console.log(progress ? progress.summaryLine({ exit: HALT_EXIT, details: args.ledger, extra }) : summaryLine({ driver: 'deploy-batch', exit: HALT_EXIT, details: args.ledger, extra }));
    return HALT_EXIT;
  };

  // preflight — one authenticated call before any page; a 401 here is exit 2, not a red batch
  let exp = null;
  if (!args.plan) {
    const list = await daSmoke(args.token, args.org, args.repo);
    exp = tokenExpiry(args.token);
    const hours = exp === null ? 'unknown' : `${((exp - Date.now() / 1000) / 3600).toFixed(1)}h`;
    console.error(`[deploy-batch] token source=${args.tokenSource} valid≈${hours} list=${list}`);
    if (list === 401) throw new Error(`DA_TOKEN rejected (401) at preflight — refresh it (source: ${args.tokenSource}) and re-run; nothing was PUT`);
    if (exp === null) console.error('[deploy-batch] WARN token expiry unknown (no created_at/expires_in or exp claim) — running; a mid-batch 401 halts with exit 3');
  }

  let plan;
  try {
    const verify = args.plan ? null : ({ webPath, tld }) => deliveredOk({ ...args, webPath, tld });
    plan = await buildPlan({ pages, ledger, want, exclude, publish: args.publish, force: args.force, branch: args.branch, verify, touched, strictPaths: args.strictPaths, gate, publishUngated: args.publishUngated, publishNoRegression: args.publishNoRegression });
  } catch (err) {
    if (err instanceof HaltError) return halt(err, 0, '?');
    throw err;
  }
  const { todo, counts } = plan;

  // content-bus reset sentinel: previously delivered pages now 404 → warn, re-drive (no halt)
  const gone = plan.rows.filter((r) => /^re-verify failed \(plain\.html 404/.test(r.reason)).length;
  if (gone >= 3 && !args.plan) {
    console.error(`[deploy-batch] WARN ${gone} previously delivered pages now 404 — content-bus reset or config change; re-driving them (bulk alternative: POST /preview|live/{org}/{repo}/{ref}/* with a paths body)`);
    await logLine({ step: 'sentinel', why: 'content-bus-reset', n: gone });
  }

  // TTL projection — exit 2 before any PUT when the token cannot outlive the run
  if (!args.plan && exp !== null && todo.length) {
    const remaining = exp - Date.now() / 1000;
    const sec = args.secPerPage || medianSecPerPage(args.log);
    const projection = (todo.length * sec) / args.concurrency;
    if (remaining <= 0) throw new Error(`DA_TOKEN expired ${Math.round(-remaining / 60)} min ago (source: ${args.tokenSource}) — refresh it and re-run; nothing was PUT`);
    if (remaining < projection && !args.ignoreTtl) throw new Error(`DA_TOKEN has ${(remaining / 60).toFixed(0)} min left but ${todo.length} pages × ${sec}s ÷ ${args.concurrency} ≈ ${(projection / 60).toFixed(0)} min — refresh it first, narrow --paths, or --ignore-ttl; nothing was PUT`);
  }

  const gateLine = gate ? `[deploy-batch] ${gateCoverageLine(gate.report, counts.held)}` : null;
  const heldRows = plan.rows.filter((r) => r.action === 'skip' && r.reason.startsWith('held (gate:'));
  if (args.plan) {
    console.log(planLine(counts, ` (plan only, publish=${args.publish})`));
    if (pathLine) console.log(pathLine);
    if (gateLine) console.log(gateLine);
    const byPath = new Map(pages.map((p) => [p.webPath, p]));
    for (const r of plan.rows) {
      const p = byPath.get(r.webPath);
      const note = p && p.safePath === null ? '  [path-unsafe: no safe form]' : p && p.collision ? `  [path-collision with ${p.collision} → ${p.safePath}]` : p && p.safePath !== p.webPath ? `  [→ ${p.safePath}${args.strictPaths ? ' path-unsafe (--strict-paths)' : ''}]` : '';
      console.log(`  ${r.action.padEnd(7)} ${r.webPath}  ${r.reason}${note}`);
    }
    console.log(summaryLine({ driver: 'deploy-batch', exit: 0, details: args.ledger, extra: { mode: 'plan', toDrive: counts.toDrive, held: gate ? counts.held : undefined } }));
    return 0;
  }

  console.error(planLine(counts, ` (concurrency ${args.concurrency}, publish=${args.publish})`));
  if (pathLine) console.error(pathLine);
  if (gateLine) console.error(gateLine);
  for (const r of heldRows) console.error(`  held    ${r.webPath}  ${r.reason}`); // every held row, every run — the re-drive is the same command once the report changes
  if (gate) for (const r of plan.rows) if (r.action === 'drive' && / \(gate: /.test(r.reason)) console.error(`  drive   ${r.webPath}  ${r.reason}`); // a row going live under an escape flag is always printed
  if (!todo.length) {
    const show = plan.rows.slice(0, 50); // one reason per path — why nothing moves
    for (const r of show) console.error(`  ${r.action.padEnd(7)} ${r.webPath}  ${r.reason}`);
    if (plan.rows.length > show.length) console.error(`  (${plan.rows.length - show.length} more — \`--plan\` prints every reason)`);
  }
  if (touched.size) await persist(); // hash backfills / --force resets

  progress = createProgress({ file: args.progress, driver: 'deploy-batch', total: todo.length, extra: { publish: args.publish, skipped: counts.unchanged, ledger: args.ledger, ...(gate ? { held: counts.held, gateReport: gate.file } : {}) } });
  const shared = args.branch !== 'main' ? [] : null;
  let done = 0;
  let firstUrl = null;
  try {
    await pool(todo, args.concurrency, async (p) => {
      touched.add(p.webPath);
      const rec = await deployOne(p, args, ledger, logLine, shared, redirects);
      done += 1;
      const ok = OK_STATUS.has(rec.status);
      progress.tick({ ok, path: p.webPath });
      const url = ok ? `https://${args.branch}--${args.repo}--${args.org}.${rec.status === 'live' ? 'aem.live' : 'aem.page'}${rec.deployedPath || p.webPath}` : null;
      if (url && !firstUrl) firstUrl = url;
      console.error(`[${done}/${todo.length}] ${ok ? 'OK  ' : 'FAIL'} ${p.webPath} (${rec.status})${url ? `  ${url}` : ''}`);
      // a failed checkpoint is not a page failure: warn, keep driving — the final write (below) is the one that must succeed
      if (done % 5 === 0) await persist().catch((e) => console.error(`[deploy-batch] WARN ledger checkpoint failed (${e.message}) — rows are kept in memory and written at the next checkpoint`));
    });
  } catch (err) {
    if (err instanceof HaltError) { progress.set({ halted: err.why }); return halt(err, done, todo.length - done); }
    await persist().catch(() => {}); // a non-halt worker error is fatal (exit 2) — but the rows driven so far are kept
    throw err;
  }
  await persist();

  const fails = todo.map((p) => [p.webPath, ledger[p.webPath]]).filter(([, r]) => !OK_STATUS.has(r.status));
  console.error(`[deploy-batch] done. ${todo.length - fails.length} ok, ${fails.length} failed.${firstUrl ? `  first: ${firstUrl}` : ''}`);
  const summary = (exit) => progress.summaryLine({ exit, details: args.ledger, extra: { skipped: counts.unchanged, published: args.publish ? todo.length - fails.length : 'preview-only', held: gate ? counts.held : undefined } });
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
    console.log(summary(1));
    return 1;
  }
  console.log(summary(0));
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error(`[deploy-batch] fatal: ${e.message}`);
    console.log(summaryLine({ driver: 'deploy-batch', exit: 2, details: summaryCtx ? summaryCtx.details : '-', extra: { error: e.message.slice(0, 80) } }));
    process.exit(2);
  });
}
