#!/usr/bin/env node
/**
 * deploy-page.mjs — the per-page atomic delivery chain, as one command.
 *
 * The chain lived in prose (da-deploy-protocol.md § Per-page atomic delivery contract) and every
 * project re-wrote it as a shell loop — with staging copies that dropped the chrome documents the
 * localize pass had just rewritten, `set -e` traps and word-split file lists. This script IS the
 * chain; `deploy-batch.mjs` stays the transport it calls.
 *
 * Stages, in place on --content (never a staging copy — chrome documents must ship with the pages
 * that reference them):
 *   1. localize   `localize-links.mjs` WRITE pass over the whole tree, then `--check`. Exit 2
 *                 (a localizable link remains) → status `links-unlocalized` for the RUN, the check
 *                 output echoed in full (per-file counts, kept-absolute and unmigrated target lists),
 *                 no PUT for any page. Any nav / footer / fragments document the write pass changed
 *                 is appended to the deploy list. `--locale-alias`, `--append-redirects` (write pass
 *                 only) and `--unmigrated bounce|list` pass through to both passes, so the owner-
 *                 decided `links: list` row works through the chain. `--no-localize` skips the
 *                 stage (a tree with no source host — greenfield) and the LOCALIZE lint with it.
 *   2. lint       `davids-model-lint.mjs <file> --source-host … --content-root …` per file.
 *                 Exit 2 (a 🔴) → `lint-red`, no PUT for THAT file; exit 1 → `lint-error`.
 *   3. delivery   `../../rollout/scripts/delivery-lint.mjs --file <file> --path <delivered path>`
 *                 when the rollout skill is installed. Exit 1 (P0/P1) → `delivery-lint`, no PUT for
 *                 that file. The path linted is `normalizeDaPath(webPath)` — the path deploy-batch
 *                 PUTs to — so a file name Gate 3 folds (`Getting_Started.html` → `/getting-started`,
 *                 redirect row written by deploy-batch) is not blocked here; only a path with NO safe
 *                 form (non-Latin segment) is a stage-3 P0, the same verdict deploy-batch would give.
 *   4. sanitise   `sanitise.js <file>` in place (DA corrupts raw UTF-8).
 *   5. deploy     `deploy-batch.mjs --paths <list> [--publish] [--redirects-tsv <--redirects>]` —
 *                 preview by default, live only with an explicit --publish (D1/D16). The page's
 *                 outcome is deploy-batch's own ledger row (untouched by this script; Gate 3
 *                 path-safety runs inside it, its redirect rows go to the same sheet stage 1 reads).
 *                 A --publish run holds every row without a PASS in stardust/rollout/gate-report.json
 *                 (rollout publish-gate.md § Gate 8 — the hold, `held=` and the two owner escape flags
 *                 live in deploy-batch; this chain only forwards them).
 *   Every child runs under --timeout (default 600 s). A child killed at the deadline (or exiting
 *   124/143) is status `killed` — NO verdict, never a FAIL — and is listed for re-run.
 *   `--media` is reserved: only `skip` (the default) is available in this release.
 *
 * Usage:
 *   node skills/deploy/scripts/deploy-page.mjs --org <org> --repo <repo> --branch <branch> \
 *     --source-host <host[,host]> [--content content] [--redirects stardust/redirects.tsv] \
 *     [--locale-alias <prefix[,prefix]>] [--append-redirects] [--unmigrated bounce|list] \
 *     (<file…> | --all | --paths <file>) [--publish] [--media skip] [--timeout 600] \
 *     [--no-localize] [--icons-dir <dir>] [--styles <css>] [--allow-empty <a,b>] [--ledger <path>] \
 *     [--progress <path> | --no-progress] [--report <path>] \
 *     [--require-code-synced [--code-sync-record <f>] | --skip-code-sync-verify <reason>] [--site-token-env <NAME>] \
 *     [--token-env <NAME>] [--concurrency <n>] [--gate-report <f>] [--publish-ungated] [--publish-no-regression]
 *
 *   <file…>       content files (paths on disk) — or web paths (`/about`, resolved under --content)
 *   --all         every *.html under --content
 *   --paths <f>   a newline-delimited list of the same shapes (no shell word-splitting)
 *   --publish     also POST /live/ (passed through to deploy-batch); default preview only
 *   --media       reserved stage (default `skip`; any other value exits 2 — not shipped yet)
 *   --timeout     seconds per child (default 600, integer ≥ 1 — anything else is a usage error); 124/143/deadline → `killed`, no verdict
 *   --no-localize skip stage 1 and the LOCALIZE lint (no --source-host needed)
 *   --icons-dir / --styles / --allow-empty   passed to both lints
 *   --redirects   TSV for localize-links AND deploy-batch's Gate 3 rows (default stardust/redirects.tsv when it exists)
 *   --locale-alias / --append-redirects / --unmigrated   passed to localize-links (stage 1; see its header)
 *   --ledger      deploy-batch ledger (default <content>/.deploy-ledger.json)
 *   --report      chain report JSON (default stardust/.work/deploy/deploy-page.<ts>.json)
 *   --progress    progress JSON (default stardust/.work/deploy/deploy-page.progress.json)
 *   --require-code-synced / --code-sync-record / --skip-code-sync-verify / --site-token-env / --token-env /
 *   --concurrency / --gate-report / --publish-ungated / --publish-no-regression
 *                 passed through unchanged to deploy-batch (stage 5; see its header) — a refused
 *                 code-sync run is deploy-batch exit 3 → chain exit 3, zero PUT; the escape flags
 *                 are operator/owner flags (never hands-off) and need --publish
 *   Shared modules resolve as plugin siblings (`../../stardust/scripts/`, `../../rollout/scripts/`): the
 *   deploy scripts run from `<plugin>/skills/deploy/scripts/`; a missing rollout skill skips stage 3 with one
 *   printed line, never silently.
 *
 * Output: one line per page with its stage results; the chain report; the LAST stdout line is
 *   SUMMARY deploy-page ok=<n> failed=<n> [noverdict=<n>] exit=<code> details=<report> published=<n>|preview-only
 *
 * Exit codes: 0 = every listed page `previewed` (or `live` with --publish); 1 = a page blocked
 * (links-unlocalized, lint-red, lint-error, delivery-lint, sanitise-fail), FAILed in deploy-batch,
 * `held` by the publish gate (stays previewed; SUMMARY `held=<n>`), or `killed` (no verdict — re-run); 2 = usage / fatal (nothing was PUT); 3 = deploy-batch halted
 * on a 401 / access-restricted host (its `next=` line is echoed — re-run it).
 *
 * Test hook (fixture tests only): DEPLOY_PAGE_DEPLOY_BATCH overrides the deploy-batch script path;
 * deploy-batch's own DEPLOY_BATCH_* host overrides pass through the environment.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProgress, defaultProgressFile, summaryLine } from '../../stardust/scripts/progress.mjs';
import { normalizeDaPath } from '../../stardust/scripts/da-path.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = {
  localize: path.join(HERE, 'localize-links.mjs'),
  lint: path.join(HERE, 'davids-model-lint.mjs'),
  deliveryLint: path.join(HERE, '..', '..', 'rollout', 'scripts', 'delivery-lint.mjs'),
  sanitise: path.join(HERE, 'sanitise.js'),
  deployBatch: process.env.DEPLOY_PAGE_DEPLOY_BATCH || path.join(HERE, 'deploy-batch.mjs'),
};
const CHROME_FILE = /(^|\/)(nav|footer)[^/]*\.html$|(^|\/)fragments?\//i;
const OK_STATUS = new Set(['live', 'previewed']);
const BLOCKED = new Set(['links-unlocalized', 'lint-red', 'lint-error', 'delivery-lint', 'sanitise-fail']);

function usage() {
  console.log('usage: node skills/deploy/scripts/deploy-page.mjs --org <org> --repo <repo> --branch <branch> --source-host <host[,host]> [--content content] [--redirects <tsv>] [--locale-alias <prefix[,prefix]>] [--append-redirects] [--unmigrated bounce|list] (<file…> | --all | --paths <file>) [--publish] [--media skip] [--timeout 600] [--no-localize] [--icons-dir <dir>] [--styles <css>] [--allow-empty <a,b>] [--ledger <path>] [--progress <path> | --no-progress] [--report <path>] [--require-code-synced [--code-sync-record <f>] | --skip-code-sync-verify <reason>] [--site-token-env <NAME>] [--token-env <NAME>] [--concurrency <n>] [--gate-report <f>] [--publish-ungated] [--publish-no-regression]');
}

export function parseArgs(argv) {
  const a = { content: 'content', files: [], all: false, publish: false, media: 'skip', timeout: 600, localize: true, sourceHosts: [], localeAliases: [], appendRedirects: false, unmigrated: 'bounce' };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    const next = () => { const v = argv[i + 1]; if (v === undefined || /^--/.test(v)) throw new Error(`${k} needs a value`); i += 1; return v; };
    if (k === '--org') a.org = next();
    else if (k === '--repo') a.repo = next();
    else if (k === '--branch') a.branch = next();
    else if (k === '--content') a.content = next();
    else if (k === '--source-host') a.sourceHosts.push(...next().split(',').map((s) => s.trim()).filter(Boolean));
    else if (k === '--redirects') a.redirects = next();
    else if (k === '--locale-alias') a.localeAliases.push(...next().split(',').map((s) => s.trim()).filter(Boolean));
    else if (k === '--append-redirects') a.appendRedirects = true;
    else if (k === '--unmigrated') a.unmigrated = next();
    else if (k === '--paths') a.pathsFile = next();
    else if (k === '--all') a.all = true;
    else if (k === '--publish') a.publish = true;
    else if (k === '--media') a.media = next();
    else if (k === '--timeout') { const t = Number(next()); if (!Number.isInteger(t) || t < 1) throw new Error('--timeout takes whole seconds ≥ 1'); a.timeout = t; }
    else if (k === '--no-localize') a.localize = false;
    else if (k === '--icons-dir') a.iconsDir = next();
    else if (k === '--styles') a.styles = next();
    else if (k === '--allow-empty') a.allowEmpty = next();
    else if (k === '--ledger') a.ledger = next();
    else if (k === '--report') a.report = next();
    else if (k === '--progress') a.progress = next();
    else if (k === '--no-progress') a.progress = null;
    else if (k === '--require-code-synced') a.requireCodeSynced = true;
    else if (k === '--code-sync-record') a.codeSyncRecord = next();
    else if (k === '--site-token-env') a.siteTokenEnv = next();
    else if (k === '--token-env') a.tokenEnv = next();
    else if (k === '--concurrency') a.concurrency = Math.max(1, +next() || 4);
    else if (k === '--skip-code-sync-verify') a.skipCodeSyncVerify = next();
    else if (k === '--gate-report') a.gateReport = next();
    else if (k === '--publish-ungated') a.publishUngated = true;
    else if (k === '--publish-no-regression') a.publishNoRegression = true;
    else if (k === '--help' || k === '-h') { usage(); process.exit(0); }
    else if (k.startsWith('--')) throw new Error(`unknown arg: ${k}`);
    else a.files.push(k);
  }
  if (!a.org || !a.repo || !a.branch) throw new Error('--org, --repo and --branch are required');
  if (a.skipCodeSyncVerify !== undefined && a.requireCodeSynced) throw new Error('--skip-code-sync-verify and --require-code-synced are exclusive — skip with a reason, or require the record');
  if (!a.publish && (a.gateReport || a.publishUngated || a.publishNoRegression)) throw new Error('--gate-report, --publish-ungated and --publish-no-regression apply to a --publish run only');
  if (a.localize && !a.sourceHosts.length) throw new Error('--source-host is required (or --no-localize for a tree with no source host)');
  if (!['bounce', 'list'].includes(a.unmigrated)) throw new Error(`--unmigrated must be bounce or list (got ${a.unmigrated}); \`list\` is the owner-decided value of the \`links\` decisions row`);
  if (a.media !== 'skip') throw new Error(`--media ${a.media} is not available in this release (reserved) — run media-reconcile.mjs separately; the default is --media skip`);
  if (!existsSync(a.content) || !statSync(a.content).isDirectory()) throw new Error(`--content ${a.content} is not a directory`);
  if (a.pathsFile) {
    if (!existsSync(a.pathsFile)) throw new Error(`--paths ${a.pathsFile} not found`);
    a.files.push(...readFileSync(a.pathsFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')));
  }
  if (!a.files.length && !a.all) throw new Error('name at least one content file, or --all / --paths <file>');
  if (a.redirects === undefined && existsSync(path.join('stardust', 'redirects.tsv'))) a.redirects = path.join('stardust', 'redirects.tsv');
  if (a.appendRedirects && !a.redirects) throw new Error('--append-redirects needs --redirects <tsv> (the sheet the alias rows go to)');
  a.ledger ||= path.join(a.content, '.deploy-ledger.json');
  a.report ||= path.join('stardust', '.work', 'deploy', `deploy-page.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  if (a.progress === undefined) a.progress = defaultProgressFile('deploy', 'deploy-page');
  return a;
}

/** Every *.html under dir (sorted, relative posix paths). */
export function walkHtml(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkHtml(full, base, out);
    else if (name.endsWith('.html')) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/** `content/a/b.html` | `a/b.html` | `/a/b` → { file, webPath } under content, or null when absent. */
export function resolveEntry(entry, content) {
  const candidates = [];
  if (/^\//.test(entry)) candidates.push(path.join(content, `${entry.replace(/\.html$/i, '')}.html`), path.join(content, entry));
  candidates.push(entry, path.join(content, entry));
  const file = candidates.find((c) => existsSync(c) && statSync(c).isFile());
  if (!file) return null;
  const rel = path.relative(path.resolve(content), path.resolve(file)).split(path.sep).join('/');
  if (rel.startsWith('..')) return null;
  return { file, webPath: `/${rel.replace(/\.html$/i, '')}` };
}

/** spawn under a deadline: { code, signal, killed, stdout, stderr }. killed = deadline hit or exit 124/143. */
export function runCapped(cmd, args, { timeoutMs, env = process.env, cwd = process.cwd(), echo = null } = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let killed = false;
    c.stdout.on('data', (d) => { stdout += d; if (echo) echo(String(d)); });
    c.stderr.on('data', (d) => { stderr += d; if (echo) echo(String(d)); });
    const t = setTimeout(() => { killed = true; c.kill('SIGTERM'); setTimeout(() => c.kill('SIGKILL'), 5000).unref(); }, timeoutMs);
    c.on('close', (code, signal) => { clearTimeout(t); resolve({ code, signal, killed: killed || code === 124 || code === 143 || (code === null && !!signal), stdout, stderr }); });
    c.on('error', (e) => { clearTimeout(t); resolve({ code: null, signal: null, killed: false, stdout, stderr: `${stderr}${e.message}` }); });
  });
}

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');
const chromeHashes = (content) => new Map(walkHtml(content).filter((rel) => CHROME_FILE.test(rel)).map((rel) => [rel, sha1(readFileSync(path.join(content, rel)))]));

export async function main(argv = process.argv) {
  const args = parseArgs(argv);
  const timeoutMs = args.timeout * 1000;
  const node = process.execPath;
  const lintExtra = [...(args.iconsDir ? ['--icons-dir', args.iconsDir] : []), ...(args.styles ? ['--styles', args.styles] : []), ...(args.allowEmpty ? ['--allow-empty', args.allowEmpty] : [])];
  const dlExtra = [...(args.iconsDir ? ['--icons-dir', args.iconsDir] : []), ...(args.allowEmpty ? ['--allow-empty', args.allowEmpty] : [])];

  // the deploy set
  const entries = args.all ? walkHtml(args.content).map((rel) => ({ file: path.join(args.content, rel), webPath: `/${rel.replace(/\.html$/i, '')}` })) : [];
  const missing = [];
  for (const e of args.files) { const r = resolveEntry(e, args.content); if (r) entries.push(r); else missing.push(e); }
  if (missing.length) throw new Error(`not under --content ${args.content}: ${missing.join(', ')}`);
  const pages = new Map(); // webPath → { file, stages: {}, status }
  for (const e of entries) if (!pages.has(e.webPath)) pages.set(e.webPath, { file: e.file, stages: {}, status: 'pending' });
  const report = { driver: 'deploy-page', startedAt: new Date().toISOString(), org: args.org, repo: args.repo, branch: args.branch, content: args.content, publish: args.publish, run: {}, chromeAppended: [], pages: {} };
  const writeReport = (exit) => { report.exit = exit; report.finishedAt = new Date().toISOString(); for (const [wp, p] of pages) report.pages[wp] = p; mkdirSync(path.dirname(args.report), { recursive: true }); writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`); };
  const progress = createProgress({ file: args.progress, driver: 'deploy-page', total: pages.size, extra: { publish: args.publish, report: args.report } });
  const finish = (exit, extra = {}) => { writeReport(exit); console.log(progress.summaryLine({ exit, details: args.report, extra: { published: args.publish ? [...pages.values()].filter((p) => p.status === 'live').length : 'preview-only', ...extra } })); return exit; };
  const line = (wp, p) => console.error(`[deploy-page] ${wp}  ${Object.entries(p.stages).map(([k, v]) => `${k} ${v}`).join(' · ')}${p.url ? `  ${p.url}` : ''}`);

  // 1. localize — write pass over the WHOLE tree, then --check (the gate)
  if (args.localize) {
    const base = ['--source-host', args.sourceHosts.join(','), '--content', args.content, ...(args.redirects ? ['--redirects', args.redirects] : []), ...(args.localeAliases.length ? ['--locale-alias', args.localeAliases.join(',')] : []), '--unmigrated', args.unmigrated];
    const before = chromeHashes(args.content);
    const w = await runCapped(node, [SCRIPTS.localize, ...base, ...(args.appendRedirects ? ['--append-redirects'] : [])], { timeoutMs });
    if (w.killed) { report.run.localize = 'killed'; for (const p of pages.values()) { p.stages.localize = 'killed'; p.status = 'killed'; progress.tick({ noverdict: true }); } console.error(`[deploy-page] localize write pass killed at the ${args.timeout} s deadline — no verdict, nothing was PUT; re-run`); return finish(1); }
    if (w.code !== 0) { report.run.localize = `error ${w.code}`; console.error(w.stderr.trim()); throw new Error(`localize-links write pass exited ${w.code}`); }
    const after = chromeHashes(args.content);
    for (const [rel, h] of after) {
      if (before.get(rel) === h) continue;
      const wp = `/${rel.replace(/\.html$/i, '')}`;
      if (!pages.has(wp)) { pages.set(wp, { file: path.join(args.content, rel), stages: {}, status: 'pending', appended: 'chrome changed by localize' }); report.chromeAppended.push(wp); progress.set({ total: pages.size }); }
    }
    const c = await runCapped(node, [SCRIPTS.localize, ...base, '--check'], { timeoutMs });
    if (c.killed) { report.run.localize = 'killed'; for (const p of pages.values()) { p.stages.localize = 'killed'; p.status = 'killed'; progress.tick({ noverdict: true }); } console.error(`[deploy-page] localize --check killed at the deadline — no verdict; re-run`); return finish(1); }
    if (c.code === 2) {
      report.run.localize = 'links-unlocalized';
      // the whole check output: per-file counts, the kept-absolute and unmigrated target lists, the CHECK line
      console.error(`[deploy-page] links-unlocalized — a localizable link remains after the write pass; no page is PUT this run. Residue:\n${c.stdout.trim()}`);
      for (const p of pages.values()) { p.stages.localize = 'links-unlocalized'; p.status = 'links-unlocalized'; progress.tick({ ok: false }); }
      return finish(1);
    }
    if (c.code !== 0) { console.error(c.stderr.trim()); throw new Error(`localize-links --check exited ${c.code}`); }
    report.run.localize = `ok${report.chromeAppended.length ? ` (+${report.chromeAppended.length} chrome document(s) appended)` : ''}`;
    for (const p of pages.values()) p.stages.localize = 'ok';
  } else {
    report.run.localize = 'skipped (--no-localize)';
  }

  // 2–4. per file: lint → delivery-lint → sanitise (offline; a blocked page never reaches the PUT list)
  const hasDeliveryLint = existsSync(SCRIPTS.deliveryLint);
  if (!hasDeliveryLint) { console.error(`[deploy-page] delivery-lint: skipped — rollout skill not installed at ${SCRIPTS.deliveryLint}`); report.run['delivery-lint'] = 'skipped — rollout skill not installed'; }
  const toDeploy = [];
  for (const [wp, p] of pages) {
    const lintArgs = [SCRIPTS.lint, p.file, ...lintExtra, ...(args.localize ? ['--source-host', args.sourceHosts.join(','), '--content-root', args.content] : [])];
    const l = await runCapped(node, lintArgs, { timeoutMs });
    if (l.killed) { p.stages.lint = 'killed'; p.status = 'killed'; progress.tick({ noverdict: true, path: wp }); line(wp, p); continue; }
    if (l.code === 2) { p.stages.lint = 'red'; p.status = 'lint-red'; p.detail = l.stdout.split('\n').filter((x) => x.includes('🔴')).slice(0, 5).join('\n'); progress.tick({ ok: false, path: wp }); line(wp, p); if (p.detail) console.error(p.detail); continue; }
    if (l.code !== 0) { p.stages.lint = `error ${l.code}`; p.status = 'lint-error'; p.detail = l.stderr.trim().slice(0, 300); progress.tick({ ok: false, path: wp }); line(wp, p); continue; }
    p.stages.lint = 'ok';
    if (hasDeliveryLint) {
      // lint the DELIVERED path (Gate 3's fold, applied by deploy-batch before the PUT) — a foldable file name is not a stage-3 block
      const d = await runCapped(node, [SCRIPTS.deliveryLint, '--file', p.file, '--path', normalizeDaPath(wp) ?? wp, ...dlExtra], { timeoutMs });
      if (d.killed) { p.stages['delivery-lint'] = 'killed'; p.status = 'killed'; progress.tick({ noverdict: true, path: wp }); line(wp, p); continue; }
      if (d.code === 1) { p.stages['delivery-lint'] = 'P0/P1'; p.status = 'delivery-lint'; p.detail = d.stdout.split('\n').filter((x) => /^\s+P[01] /.test(x)).join('\n'); progress.tick({ ok: false, path: wp }); line(wp, p); if (p.detail) console.error(p.detail); continue; }
      if (d.code !== 0) { p.stages['delivery-lint'] = `error ${d.code}`; p.status = 'lint-error'; p.detail = d.stderr.trim().slice(0, 300); progress.tick({ ok: false, path: wp }); line(wp, p); continue; }
      p.stages['delivery-lint'] = 'ok';
    }
    const s = await runCapped(node, [SCRIPTS.sanitise, p.file], { timeoutMs });
    if (s.killed) { p.stages.sanitise = 'killed'; p.status = 'killed'; progress.tick({ noverdict: true, path: wp }); line(wp, p); continue; }
    if (s.code !== 0) { p.stages.sanitise = `fail ${s.code}`; p.status = 'sanitise-fail'; p.detail = s.stderr.trim().slice(0, 300); progress.tick({ ok: false, path: wp }); line(wp, p); continue; }
    p.stages.sanitise = 'ok';
    toDeploy.push(wp);
  }

  // 5. deploy — the transport; its ledger is the verdict per page
  let exit = 0;
  if (toDeploy.length) {
    mkdirSync(path.dirname(args.report), { recursive: true });
    const listFile = path.join(path.dirname(args.report), `paths.${Date.now()}.txt`);
    writeFileSync(listFile, `${toDeploy.join('\n')}\n`);
    const dbArgs = [SCRIPTS.deployBatch, '--org', args.org, '--repo', args.repo, '--branch', args.branch, '--content', args.content, '--paths', listFile, '--ledger', args.ledger, '--no-progress', ...(args.redirects ? ['--redirects-tsv', args.redirects] : []), ...(args.publish ? ['--publish'] : []),
      // transport pass-through (documented on the row-D command): the served==tree precondition and token names
      ...(args.requireCodeSynced ? ['--require-code-synced'] : []), ...(args.codeSyncRecord ? ['--code-sync-record', args.codeSyncRecord] : []),
      ...(args.siteTokenEnv ? ['--site-token-env', args.siteTokenEnv] : []), ...(args.tokenEnv ? ['--token-env', args.tokenEnv] : []),
      ...(args.concurrency ? ['--concurrency', String(args.concurrency)] : []),
      ...(args.skipCodeSyncVerify !== undefined ? ['--skip-code-sync-verify', args.skipCodeSyncVerify] : []),
      // Gate 8 pass-through: the report path and the two owner escape flags (the hold itself is deploy-batch's)
      ...(args.gateReport ? ['--gate-report', args.gateReport] : []), ...(args.publishUngated ? ['--publish-ungated'] : []), ...(args.publishNoRegression ? ['--publish-no-regression'] : [])];
    const d = await runCapped(node, dbArgs, { timeoutMs, echo: (t) => process.stderr.write(t) });
    const ledger = existsSync(args.ledger) ? JSON.parse(readFileSync(args.ledger, 'utf8')) : {};
    const nextLine = (d.stdout.match(/^next=.*$/m) || [])[0];
    const heldRows = new Set([...d.stderr.matchAll(/^ {2}held {4}(\S+) {2}held \(gate:/gm)].map((m) => m[1])); // Gate 8: rows deploy-batch held from going live
    for (const wp of toDeploy) {
      const p = pages.get(wp);
      const rec = ledger[wp];
      if (d.killed) { p.stages.deploy = 'killed'; p.status = 'killed'; progress.tick({ noverdict: true, path: wp }); line(wp, p); continue; }
      if (heldRows.has(wp)) { p.stages.deploy = `held (gate) — row ${rec ? rec.status : 'absent'}`; p.status = 'held'; progress.tick({ noverdict: true, path: wp }); line(wp, p); continue; }
      if (d.code === 3 && !(rec && OK_STATUS.has(rec.status))) { p.stages.deploy = 'halted'; p.status = 'halted'; progress.tick({ noverdict: true, path: wp }); line(wp, p); continue; }
      p.stages.deploy = rec ? rec.status : 'not-in-ledger';
      p.status = rec ? rec.status : 'not-in-ledger';
      if (rec && rec.lastError) p.detail = rec.lastError;
      if (rec && OK_STATUS.has(rec.status)) p.url = `https://${args.branch}--${args.repo}--${args.org}.${rec.status === 'live' ? 'aem.live' : 'aem.page'}${rec.deployedPath || wp}`;
      progress.tick({ ok: !!(rec && OK_STATUS.has(rec.status)), path: wp });
      line(wp, p);
    }
    if (d.killed) console.error(`[deploy-page] deploy-batch killed at the ${args.timeout} s deadline — no verdict for ${toDeploy.length} page(s); the ledger keeps what was delivered, re-run the same command`);
    if (d.code === 3) { console.error(`[deploy-page] deploy-batch HALTED (exit 3) — fix the credential and re-run${nextLine ? `; its resume command:\n${nextLine}` : ''}`); exit = 3; }
    else if (d.code === 2) { console.error(`[deploy-page] deploy-batch fatal (exit 2): ${(d.stderr.match(/fatal: .*/) || [''])[0]}`); exit = 2; }
    report.run.deploy = d.killed ? 'killed' : `exit ${d.code}`;
  } else report.run.deploy = 'nothing to deploy';

  const all = [...pages.values()];
  const blocked = all.filter((p) => BLOCKED.has(p.status));
  const killed = all.filter((p) => p.status === 'killed' || p.status === 'halted');
  const held = all.filter((p) => p.status === 'held');
  const failed = all.filter((p) => !BLOCKED.has(p.status) && !OK_STATUS.has(p.status) && p.status !== 'killed' && p.status !== 'halted' && p.status !== 'held');
  if (blocked.length) { console.error(`BLOCKED before any PUT (fix the page, re-run the same command):`); for (const [wp, p] of pages) if (BLOCKED.has(p.status)) console.error(`  ${wp}  ${p.status}`); }
  if (failed.length) { console.error(`FAILED in deploy-batch (re-run the same command — verified pages are skipped):`); for (const [wp, p] of pages) if (failed.includes(p)) console.error(`  ${wp}  ${p.status}  ${p.detail || ''}`.trimEnd()); }
  if (killed.length) { console.error(`NO VERDICT (deadline or halt — re-run the same command):`); for (const [wp, p] of pages) if (killed.includes(p)) console.error(`  ${wp}  ${p.status}`); }
  if (held.length) { console.error(`HELD by the publish gate (rollout publish-gate.md § Gate 8 — re-gate with gate-publish.mjs, then re-run the same command; the escape flags are owner flags):`); for (const [wp, p] of pages) if (held.includes(p)) console.error(`  ${wp}  ${p.stages.deploy}`); }
  if (exit === 0 && (blocked.length || failed.length || killed.length || held.length)) exit = 1;
  console.error(`[deploy-page] ${all.length - blocked.length - failed.length - killed.length - held.length} ok · ${blocked.length} blocked · ${failed.length} failed · ${killed.length} no verdict${held.length ? ` · ${held.length} held (gate)` : ''}`);
  return finish(exit, held.length ? { held: held.length } : {});
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error(`[deploy-page] fatal: ${e.message}`);
    console.log(summaryLine({ driver: 'deploy-page', exit: 2, details: '-', extra: { error: e.message.slice(0, 80) } }));
    process.exit(2);
  });
}
