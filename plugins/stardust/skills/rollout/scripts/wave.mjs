#!/usr/bin/env node
/**
 * rollout/wave.mjs — the resumable wave driver (Phase C) + the mapped re-gate list.
 *
 * One process drives one wave: a roster of pages through a DECLARED stage table,
 * per page, resumably. It composes the primitives that already exist and owns
 * none of their contracts: deploy-batch.mjs (hash skip, merge-safe ledger, exit 3
 * halt), progress.mjs (progress file + SUMMARY line), the lint/gate instruments
 * (each verdict is the instrument's own — no threshold lives here), run-status
 * `blocked` + `next`. What was prose ("central deploy, re-drive the FAILs, poll
 * the ledger") is a runnable stage runner; the LLM touches only the parked table.
 *
 * Stage table (class fixed; a project overrides a stage's COMMAND, never its class):
 *   name        class  satisfied when (idempotent skip)            default command
 *   capture     hard   stardust/current/pages/<slug>.html exists   extract/scripts/crawl.mjs --url {url} --pages {path}
 *   build       hard   the migrated document exists                (none — migrate is the skill; project command)
 *   convert     hard   content/<path>.html exists                  (none — deploy methodology / project converter)
 *   lint        hard   contentHash recorded == file                rollout/scripts/delivery-lint.mjs --file {file} --path {path}
 *   local-gate  hard   localOk with contentHash + codeHash current deploy/scripts/davids-model-lint.mjs {file}
 *   deploy      hard   ledger row live|previewed (batch, --paths)  deploy/scripts/deploy-batch.mjs … --paths {pathsFile}
 *   live-gate   hard   liveOk (against the PREVIEW origin)         deploy/scripts/served-check.mjs {previewOrigin}{path}.plain.html --absent about:error
 *   publish     hard   ledger row live (batch; --publish only)     deploy-batch.mjs … --publish --paths {pathsFile}
 *   pixel       soft   —  (--pixel all|sample|none, default none)  (none — project gate command; logs and proceeds)
 *   close       —      wave-level: update-coverage --from-ledger, report, parked table
 * A hard stage with no command whose artefact is missing on any active page is a
 * start-time exit 2 (config error) — never a silent pass. Overrides:
 *   rollout.json  waves.stages.<name>.cmd  (placeholders {slug} {path} {url} {type} {file}
 *                 {migrated} {pathsFile} {previewOrigin} {waveId} {org} {repo} {branch})
 *                 waves.ledger (default content/.deploy-ledger.json) · waves.content (default content)
 *                 waves.previewOrigin (default https://<ref>--<site>--<org>.aem.page from site.da)
 *                 waves.close[] (extra close commands)
 *
 * Verdicts: a page is PARKED (never the wave) when a hard stage fails —
 *   reasons: capture · build · convert · lint · local-gate · preview (non-ok ledger
 *   row: put-fail, body-invalid, overwrite-guard, path-collision, verify-fail) ·
 *   live-gate · publish · da-token (deploy-batch exit 3) · config.
 *   Child exit 124/143 = NO VERDICT: the page keeps its stage, counts `noverdict`,
 *   is listed for re-run, is never parked. Soft stages log and proceed.
 * Hash re-gate: contentHash = sha1 of content/<path>.html (recorded at lint pass);
 *   a change clears localOk + liveOk for that page (deploy-batch's own hash decides
 *   the re-PUT). codeHash = sha1 over blocks/ styles/ scripts/ head.html; a change
 *   clears localOk on every page (local gate re-runs; nothing re-converts).
 * Order (D1/D16): deploy = preview · live gate on the preview origin · publish only
 *   with --publish, only for pages whose live gate passed · never --force.
 * State: stardust/rollout/waves/<wave>.state.json — ONE writer per file; shards are
 *   separate rosters + state files. Progress: stardust/.work/rollout/wave.progress.json.
 *
 * Usage:
 *   node skills/rollout/scripts/wave.mjs <waveId> <roster> [--stage <name>] [--unpark <reason|all>]
 *        [--publish] [--pixel all|sample|none] [--concurrency N] [--timeout <s>] [--stages <json>]
 *        [--out <rolloutDir>] [--repo <eds-root>] [--dry-run]
 *   node skills/rollout/scripts/wave.mjs regate-list [--since <ref> | --files <list|file>] [--out <rolloutDir>]
 *        [--repo <eds-root>] [--json] [--all]
 *   roster: one page per line `slug|type|url` (or tab-separated; `#` comments).
 * Exit: 0 every active page deployed (published with --publish) · 1 a page parked or FAIL ·
 *       2 usage / config · 3 token halt (status.jsonl `blocked` + `next` written) ·
 *       regate-list: 0 printed (empty list is exit 0) · 2 missing git / coverage.
 * Contract: reference/sweep-protocol.md § Wave driver.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readJSON, writeJSON } from './lib.mjs';
import { createProgress, defaultProgressFile } from '../../stardust/scripts/progress.mjs';

const HERE = import.meta.dirname;
const SKILLS = resolve(HERE, '..', '..');
export const DEADLINE_EXIT = 124;
export const PARK_REASONS = ['capture', 'build', 'convert', 'lint', 'local-gate', 'preview', 'live-gate', 'publish', 'da-token', 'config'];
const DEPLOY_CLASS = new Set(['preview', 'publish', 'da-token']);
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');
const rel = (p) => p; // defaults spawn by absolute plugin path — the project cwd has no skills/ tree

// ---- stage table -------------------------------------------------------------------
export const STAGES = [
  { name: 'capture', cls: 'hard', scope: 'page', cmd: `node ${rel(join(SKILLS, 'extract/scripts/crawl.mjs'))} --url {url} --pages {path}`, satisfied: (ctx, p) => existsSync(join(ctx.root, 'stardust', 'current', 'pages', `${p.slug}.html`)) },
  { name: 'build', cls: 'hard', scope: 'page', cmd: null, satisfied: (ctx, p) => Boolean(migratedFile(ctx, p)) },
  { name: 'convert', cls: 'hard', scope: 'page', cmd: null, satisfied: (ctx, p) => existsSync(contentFile(ctx, p)) },
  { name: 'lint', cls: 'hard', scope: 'page', cmd: `node ${rel(join(SKILLS, 'rollout/scripts/delivery-lint.mjs'))} --file {file} --path {path}`, satisfied: (ctx, p, s) => Boolean(s.contentHash) && s.contentHash === fileHash(contentFile(ctx, p)) },
  { name: 'local-gate', cls: 'hard', scope: 'page', cmd: `node ${rel(join(SKILLS, 'deploy/scripts/davids-model-lint.mjs'))} {file}`, satisfied: (ctx, p, s) => Boolean(s.localOk) && s.codeHash === ctx.codeHash && s.contentHash === fileHash(contentFile(ctx, p)) },
  { name: 'deploy', cls: 'hard', scope: 'batch', cmd: `node ${rel(join(SKILLS, 'deploy/scripts/deploy-batch.mjs'))} --org {org} --repo {repo} --branch {branch} --content {content} --paths {pathsFile}`, satisfied: (ctx, p, s) => Boolean(s.deployed) && s.deployedHash === fileHash(contentFile(ctx, p)) },
  { name: 'live-gate', cls: 'hard', scope: 'page', cmd: `node ${rel(join(SKILLS, 'deploy/scripts/served-check.mjs'))} {previewOrigin}{path}.plain.html --absent about:error`, satisfied: (ctx, p, s) => Boolean(s.liveOk) && s.liveOkHash === s.deployedHash },
  { name: 'publish', cls: 'hard', scope: 'batch', cmd: `node ${rel(join(SKILLS, 'deploy/scripts/deploy-batch.mjs'))} --org {org} --repo {repo} --branch {branch} --content {content} --publish --paths {pathsFile}`, satisfied: (ctx, p, s) => Boolean(s.published) && s.publishedHash === s.deployedHash, when: (ctx) => ctx.publish },
  { name: 'pixel', cls: 'soft', scope: 'page', cmd: null, satisfied: (ctx, p, s) => ctx.pixel === 'none' || Boolean(s.pixelDone), when: (ctx) => ctx.pixel !== 'none' },
];
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.name, i]));

// ---- helpers ------------------------------------------------------------------------
function usage(code) {
  const out = code ? console.error : console.log;
  out('Usage: node skills/rollout/scripts/wave.mjs <waveId> <roster> [--stage <name>] [--unpark <reason|all>] [--publish] [--pixel all|sample|none] [--concurrency N] [--timeout <s>] [--stages <json>] [--out <rolloutDir>] [--repo <eds-root>] [--dry-run]\n       node skills/rollout/scripts/wave.mjs regate-list [--since <ref> | --files <list|file>] [--out <rolloutDir>] [--repo <eds-root>] [--json] [--all]\n  exit 0 all deployed · 1 parked/FAIL · 2 usage/config · 3 token halt');
  process.exit(code);
}
export function parseArgs(argv) {
  const a = { positional: [], stage: null, unpark: null, publish: false, pixel: 'none', concurrency: 2, timeout: 600, stagesJson: null, out: 'stardust/rollout', repo: '.', dryRun: false, since: null, files: null, json: false, all: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const next = () => { const v = argv[i + 1]; if (v === undefined || /^--/.test(v)) throw new Error(`${k} needs a value`); i += 1; return v; };
    if (k === '--help' || k === '-h') a.help = true;
    else if (k === '--stage') a.stage = next();
    else if (k === '--unpark') a.unpark = next();
    else if (k === '--publish') a.publish = true;
    else if (k === '--pixel') a.pixel = next();
    else if (k === '--concurrency') a.concurrency = Math.max(1, Number(next()) || 1);
    else if (k === '--timeout') a.timeout = Math.max(1, Number(next()) || 600);
    else if (k === '--stages') a.stagesJson = next();
    else if (k === '--out') a.out = next();
    else if (k === '--repo') a.repo = next();
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--since') a.since = next();
    else if (k === '--files') a.files = next();
    else if (k === '--json') a.json = true;
    else if (k === '--all') a.all = true;
    else if (k.startsWith('--')) throw new Error(`unknown flag ${k}`);
    else a.positional.push(k);
  }
  if (!['all', 'sample', 'none'].includes(a.pixel)) throw new Error('--pixel takes all | sample | none');
  return a;
}

export function parseRoster(text, coverage = new Map()) {
  const rows = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [slug, type, url] = line.split(/\s*[|\t]\s*/).map((x) => (x || '').trim());
    if (!slug) continue;
    rows.push({ slug, type: type || 'untyped', url: url || null, path: pathFor(slug, url, coverage) });
  }
  return rows;
}
/** Delivered web path: the coverage row's path, else the URL's pathname, else the slug with `__` → `/` (D6: roster slug ≠ DA path — deploy-batch normalises the final form). */
export function pathFor(slug, url, coverage = new Map()) {
  const cov = coverage.get(slug);
  let p = cov && cov.path ? cov.path : null;
  if (!p && url) { try { p = new URL(url).pathname; } catch { p = null; } }
  if (!p) p = slug === 'index' ? '/' : `/${slug.replace(/^\/+/, '').replace(/__/g, '/')}`;
  p = p.replace(/\.html?$/i, '').replace(/\/index$/, '').replace(/\/+$/, '').toLowerCase();
  return p || '/';
}
const contentFile = (ctx, p) => join(ctx.root, ctx.content, p.path === '/' ? 'index.html' : `${p.path.slice(1)}.html`);
function migratedFile(ctx, p) {
  const cov = ctx.coverage.get(p.slug);
  if (cov && cov.source && cov.source.migratedHtml && existsSync(join(ctx.root, cov.source.migratedHtml))) return join(ctx.root, cov.source.migratedHtml);
  const base = join(ctx.root, 'stardust', 'migrated');
  for (const c of p.path === '/' ? ['index.html'] : [`${p.path.slice(1)}/index.html`, `${p.path.slice(1)}.html`]) if (existsSync(join(base, c))) return join(base, c);
  return null;
}
const fileHash = (f) => { try { return sha1(readFileSync(f)); } catch { return null; } };
/** sha1 over the code tree (blocks/ styles/ scripts/ head.html) — rel path + bytes, sorted; null when none exists. */
export function codeTreeHash(root) {
  const h = createHash('sha1'); let n = 0;
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) { if (e.name.startsWith('.')) continue; const f = join(d, e.name); if (e.isDirectory()) walk(f); else { h.update(relative(root, f)); h.update(readFileSync(f)); n += 1; } } };
  for (const part of ['blocks', 'styles', 'scripts', 'head.html']) { const f = join(root, part); if (!existsSync(f)) continue; if (statSync(f).isDirectory()) walk(f); else { h.update(part); h.update(readFileSync(f)); n += 1; } }
  return n ? h.digest('hex') : null;
}
/** Split a command template into argv (quotes honoured) after placeholder substitution. */
export function renderCmd(tpl, vars) {
  const s = tpl.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
  const out = []; const re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
/** Run argv under a wall-clock deadline; 124 on the deadline (run-capped semantics), stdout/stderr captured. */
export function runCapped(argv, { cwd, timeoutSec, env }) {
  return new Promise((done) => {
    let child;
    try { child = spawn(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...(env || {}) }, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { done({ code: 127, stdout: '', stderr: e.message, timedOut: false }); return; }
    let stdout = ''; let stderr = ''; let timedOut = false;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = timeoutSec > 0 ? setTimeout(() => { timedOut = true; try { child.kill('SIGTERM'); } catch { /* gone */ } setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 3000).unref(); }, timeoutSec * 1000) : null;
    child.on('error', (e) => { if (timer) clearTimeout(timer); done({ code: 127, stdout, stderr: `${stderr}${e.message}`, timedOut: false }); });
    child.on('exit', (code, signal) => { if (timer) clearTimeout(timer); done({ code: timedOut ? DEADLINE_EXIT : (code === null ? (signal === 'SIGTERM' ? 143 : 1) : code), stdout, stderr, timedOut }); });
  });
}
const noVerdict = (code) => code === DEADLINE_EXIT || code === 143;
const nowIso = () => new Date().toISOString();
function statusLine(root, obj) {
  try { mkdirSync(join(root, 'stardust'), { recursive: true }); appendFileSync(join(root, 'stardust', 'status.jsonl'), `${JSON.stringify({ ts: nowIso(), skill: 'stardust:rollout', phase: 'C-deliver', ...obj })}\n`); } catch { /* status file is best effort */ }
}

// ---- state ----------------------------------------------------------------------------
export function loadState(file, waveId, roster) {
  const st = readJSON(file, null) || { waveId, startedAt: nowIso(), pages: {} };
  st.waveId = waveId; st.updatedAt = nowIso(); st.pages = st.pages || {};
  for (const r of roster) {
    const s = st.pages[r.slug] || { stage: null };
    st.pages[r.slug] = { ...s, type: r.type, url: r.url, path: r.path };
  }
  return st;
}
export function park(st, slug, reason, detail) {
  const s = st.pages[slug];
  s.parked = reason; s.parkedDetail = String(detail || '').split('\n').filter(Boolean).slice(-1)[0] || reason; s.parkedAt = nowIso();
  s.next = DEPLOY_CLASS.has(reason) ? `node skills/rollout/scripts/wave.mjs ${st.waveId} <roster> --unpark ${reason}` : `fix ${reason} for ${slug}, then node skills/rollout/scripts/wave.mjs ${st.waveId} <roster> --unpark ${reason}`;
}
export function unpark(st, which) {
  let n = 0;
  for (const s of Object.values(st.pages)) {
    if (!s.parked || (which !== 'all' && s.parked !== which)) continue;
    const reason = s.parked;
    delete s.parked; delete s.parkedDetail; delete s.parkedAt; delete s.next;
    if (DEPLOY_CLASS.has(reason)) { s.deployed = false; s.published = false; s.liveOk = false; s.stage = 'local-gate'; } else { s.stage = reason === 'capture' ? null : 'capture'; s.localOk = false; s.liveOk = false; delete s.contentHash; }
    n += 1;
  }
  return n;
}

// ---- the run --------------------------------------------------------------------------
export async function runWave(args) {
  const [waveId, rosterFile] = args.positional;
  if (!waveId || !rosterFile) usage(2);
  const root = resolve(args.repo);
  const rolloutDir = resolve(root, args.out);
  const config = readJSON(join(rolloutDir, 'rollout.json'), {}) || {};
  const waves = config.waves || {};
  let overrides = waves.stages || {};
  if (args.stagesJson) { try { overrides = { ...overrides, ...JSON.parse(args.stagesJson) }; } catch (e) { console.error(`rollout wave: --stages is not JSON: ${e.message}`); return 2; } }
  const da = (config.site && config.site.da) || {};
  const ctx = {
    root, rolloutDir, waveId, publish: args.publish, pixel: args.pixel, timeout: args.timeout, dryRun: args.dryRun,
    content: waves.content || 'content', ledger: waves.ledger || join(waves.content || 'content', '.deploy-ledger.json'),
    org: da.org || '', repo: da.site || '', branch: da.ref || 'main',
    coverage: new Map(((readJSON(join(rolloutDir, 'coverage', 'pages.json'), {}) || {}).pages || []).map((p) => [p.slug, p])),
  };
  ctx.previewOrigin = waves.previewOrigin || `https://${ctx.branch}--${ctx.repo}--${ctx.org}.aem.page`;
  ctx.codeHash = codeTreeHash(root);
  if (!existsSync(rosterFile)) { console.error(`rollout wave: roster not found: ${rosterFile}`); return 2; }
  const roster = parseRoster(readFileSync(rosterFile, 'utf8'), ctx.coverage);
  if (!roster.length) { console.error('rollout wave: roster is empty'); return 2; }
  if (args.stage && !STAGE_INDEX[args.stage] && STAGE_INDEX[args.stage] !== 0) { console.error(`rollout wave: unknown stage ${args.stage} (${STAGES.map((s) => s.name).join(', ')})`); return 2; }
  // effective stage table: class is fixed here; only `cmd` may be overridden
  const table = STAGES.map((s) => { const o = overrides[s.name]; if (o && o.class && o.class !== s.cls) console.error(`rollout wave: stage ${s.name} is ${s.cls} — a config cannot change a stage's class (ignored)`); return { ...s, cmd: o && Object.prototype.hasOwnProperty.call(o, 'cmd') ? o.cmd : s.cmd }; });

  const stateFile = join(rolloutDir, 'waves', `${waveId}.state.json`);
  const st = loadState(stateFile, waveId, roster);
  if (args.unpark) { const n = unpark(st, args.unpark); console.log(`wave ${waveId}: unparked ${n} page(s) (${args.unpark})`); }
  const active = () => roster.filter((r) => !st.pages[r.slug].parked);
  const save = () => { st.updatedAt = nowIso(); writeJSON(stateFile, st); };

  // config check: a hard stage with no command must already be satisfied on every active page
  for (const s of table) {
    if (s.cls !== 'hard' || s.cmd || (s.when && !s.when(ctx))) continue;
    const missing = active().filter((r) => !s.satisfied(ctx, r, st.pages[r.slug]));
    if (missing.length) { console.error(`rollout wave: hard stage "${s.name}" has no command and ${missing.length} page(s) lack its artefact (${missing.slice(0, 5).map((m) => m.slug).join(', ')}${missing.length > 5 ? ' …' : ''}) — set rollout.json waves.stages.${s.name}.cmd or produce the artefact; nothing ran (exit 2)`); return 2; }
  }
  save();
  const progress = createProgress({ file: args.dryRun ? null : defaultProgressFile('rollout', 'wave', root), driver: 'wave', total: roster.length, extra: { waveId, stage: args.stage || 'all' } });
  statusLine(root, { event: 'start', detail: `wave ${waveId}: ${roster.length} pages, ${roster.length - active().length} parked`, artifact: relative(root, progress.file || stateFile) });
  // effective stage list (publish only with --publish, pixel only with --pixel); a page enters stage i only
  // when it completed stage i-1 (recorded or satisfied) — a no-verdict page therefore never reaches the batch
  const effective = table.filter((s) => !s.when || s.when(ctx));
  const effOrder = (name) => { if (name === null || name === undefined) return -1; const k = STAGE_INDEX[name]; return effective.filter((s) => STAGE_INDEX[s.name] <= k).length - 1; };
  const stagesToRun = args.stage ? effective.filter((s) => s.name === args.stage) : effective;
  if (args.stage && !stagesToRun.length) { console.error(`rollout wave: --stage ${args.stage} is not active in this run (publish needs --publish, pixel needs --pixel)`); return 2; }
  const results = { invocations: 0, halted: false };
  const vars = (p) => ({ slug: p.slug, path: p.path, url: p.url || '', type: p.type, file: relative(root, contentFile(ctx, p)), migrated: (() => { const m = migratedFile(ctx, p); return m ? relative(root, m) : ''; })(), previewOrigin: ctx.previewOrigin, waveId, org: ctx.org, repo: ctx.repo, branch: ctx.branch, content: ctx.content });
  const exec = async (stage, argvList, cwd) => { results.invocations += 1; if (ctx.dryRun) { console.log(`[dry-run] ${stage.name}: ${argvList.join(' ')}`); return { code: 0, stdout: '', stderr: '' }; } return runCapped(argvList, { cwd, timeoutSec: ctx.timeout }); };
  // invalidation before anything runs: content hash and code hash re-gate
  for (const r of active()) {
    const s = st.pages[r.slug]; const ch = fileHash(contentFile(ctx, r));
    if (s.contentHash && ch && s.contentHash !== ch) { s.localOk = false; s.liveOk = false; s.stage = stageBefore('lint'); s.invalidated = 'content'; }
    else if (s.localOk && s.codeHash !== ctx.codeHash) { s.localOk = false; s.stage = stageBefore('local-gate'); s.invalidated = 'code'; }
  }

  for (const stage of stagesToRun) {
    const i = effective.indexOf(stage);
    const ready = (s) => effOrder(s.stage) === i - 1;
    if (!args.stage) for (const r of active()) { const s = st.pages[r.slug]; if (ready(s) && stage.satisfied(ctx, r, s)) advance(s, stage, ctx, r); }
    const todo = active().filter((r) => { const s = st.pages[r.slug]; return !stage.satisfied(ctx, r, s) && (args.stage || ready(s)); });
    if (!todo.length) { save(); continue; }
    if (stage.scope === 'batch') {
      if (stage.name === 'publish') { const notGated = todo.filter((r) => !st.pages[r.slug].liveOk); for (const r of notGated) console.error(`wave ${waveId}: ${r.slug} not published — live gate did not pass`); }
      const batch = stage.name === 'publish' ? todo.filter((r) => st.pages[r.slug].liveOk) : todo;
      if (!batch.length) continue;
      if (!stage.cmd) { for (const r of batch) park(st, r.slug, 'config', `stage ${stage.name} has no command`); save(); continue; }
      const pathsFile = join(rolloutDir, 'waves', `${waveId}.${stage.name}-paths.txt`);
      mkdirSync(dirname(pathsFile), { recursive: true });
      writeFileSync(pathsFile, `${batch.map((r) => r.path).join('\n')}\n`);
      const argvList = renderCmd(stage.cmd, { ...vars(batch[0]), pathsFile: relative(root, pathsFile) });
      if (argvList.includes('--force')) { console.error(`rollout wave: ${stage.name} command carries --force — refused (the ledger's hash skip is the re-drive rule)`); return 2; }
      const t0 = Date.now();
      const r = await exec(stage, argvList, root);
      const ledger = readJSON(join(root, ctx.ledger), {}) || {};
      for (const p of batch) {
        const s = st.pages[p.slug]; const row = ledger[p.path] || ledger[`${p.path}/`] || null; const wantLive = stage.name === 'publish';
        // a row counts only when it is THIS file's: bodyHash = sha1 of the bytes PUT (deploy-batch contract); a stale row from an earlier run is not a delivery
        const fresh = row && ((row.bodyHash && row.bodyHash === fileHash(contentFile(ctx, p))) || (!row.bodyHash && row.ts && Date.parse(row.ts) >= t0 - 1000));
        const ok = fresh && (row.status === 'live' || (!wantLive && row.status === 'previewed'));
        if (ok) { if (wantLive) { s.published = true; s.publishedHash = s.deployedHash; } else { s.deployed = true; s.deployedHash = fileHash(contentFile(ctx, p)); } advance(s, stage, ctx, p); }
        else if (r.code === 3 || ctx.dryRun) { if (!ctx.dryRun) park(st, p.slug, 'da-token', `deploy-batch exit 3 (token halt) at ${stage.name}`); }
        else if (noVerdict(r.code)) { s.noverdict = true; }
        else park(st, p.slug, wantLive ? 'publish' : 'preview', row ? `${row.status}${row.lastError ? `: ${row.lastError}` : ''}` : `no ledger row (exit ${r.code})`);
      }
      if (r.code === 3) {
        results.halted = true;
        const next = (r.stdout.match(/next=(.+)/) || [])[1] || argvList.join(' ');
        statusLine(root, { event: 'blocked', detail: `DA_TOKEN halt at ${stage.name} (deploy-batch exit 3) — ${batch.filter((p) => st.pages[p.slug].parked === 'da-token').length} pages parked da-token`, next: next.trim() });
        console.error(`wave ${waveId}: token halt — parked da-token; next=${next.trim()}`);
      }
      save();
      continue;
    }
    // per-page stage with a concurrency pool
    const queue = todo.slice(); const workers = [];
    const one = async (p) => {
      const s = st.pages[p.slug];
      if (!stage.cmd) { if (stage.cls === 'soft') { s[`${stage.name}Skipped`] = 'no command'; advance(s, stage, ctx, p); return; } park(st, p.slug, 'config', `stage ${stage.name} has no command`); return; }
      const r = await exec(stage, renderCmd(stage.cmd, vars(p)), root);
      if (noVerdict(r.code)) { s.noverdict = true; console.error(`wave ${waveId}: ${p.slug} ${stage.name} → no verdict (exit ${r.code}); keeps stage ${s.stage || 'start'}`); return; }
      if (r.code === 0 || stage.cls === 'soft') {
        if (r.code !== 0) s[`${stage.name}Note`] = `soft stage exit ${r.code}`;
        advance(s, stage, ctx, p);
      } else park(st, p.slug, stage.name, r.stderr || r.stdout || `exit ${r.code}`);
    };
    for (let i = 0; i < Math.max(1, args.concurrency); i += 1) workers.push((async () => { while (queue.length) { await one(queue.shift()); save(); } })());
    await Promise.all(workers);
    save();
  }

  // close: coverage reconcile + report + parked table
  const ledgerAbs = join(root, ctx.ledger);
  if (!args.stage && !ctx.dryRun && existsSync(ledgerAbs) && existsSync(join(rolloutDir, 'coverage', 'pages.json')) && existsSync(join(rolloutDir, 'coverage', 'blocks.json'))) {
    await exec({ name: 'close' }, ['node', join(HERE, 'update-coverage.mjs'), '--from-ledger', ctx.ledger, '--url-base', ctx.previewOrigin, '--out', relative(root, rolloutDir) || 'stardust/rollout'], root);
  }
  for (const c of (waves.close || [])) await exec({ name: 'close' }, renderCmd(c, { ...vars(roster[0]), pathsFile: '' }), root);
  const parked = roster.filter((r) => st.pages[r.slug].parked);
  const nov = roster.filter((r) => st.pages[r.slug].noverdict);
  for (const r of roster) { const s = st.pages[r.slug]; if (s.parked) progress.tick({ ok: false, path: r.path }); else if (s.noverdict) progress.tick({ noverdict: true, path: r.path }); else progress.tick({ ok: true, path: r.path }); }
  const done = roster.filter((r) => { const s = st.pages[r.slug]; return !s.parked && !s.noverdict && (ctx.publish ? s.published : s.deployed); });
  const report = [`# wave ${waveId} — ${nowIso()}`, '', `pages ${roster.length} · deployed ${roster.filter((r) => st.pages[r.slug].deployed).length} · published ${roster.filter((r) => st.pages[r.slug].published).length} · parked ${parked.length} · no verdict ${nov.length} · invocations ${results.invocations}`, ''];
  if (parked.length) { report.push('| slug | reason | detail | next |', '|---|---|---|---|'); for (const r of parked) { const s = st.pages[r.slug]; report.push(`| ${r.slug} | ${s.parked} | ${String(s.parkedDetail).replace(/\|/g, '\\|').slice(0, 160)} | ${s.next} |`); } report.push(''); }
  if (nov.length) report.push(`no verdict (re-run the same command): ${nov.map((r) => r.slug).join(', ')}`, '');
  const reportFile = join(rolloutDir, 'waves', `${waveId}.report.md`);
  if (!ctx.dryRun) writeFileSync(reportFile, `${report.join('\n')}\n`);
  for (const r of roster) delete st.pages[r.slug].noverdict;
  save();
  console.log(report.join('\n'));
  const exit = results.halted ? 3 : parked.length ? 1 : (args.stage || ctx.dryRun ? 0 : (done.length < roster.length - nov.length ? 1 : 0));
  statusLine(root, { event: 'end', detail: `wave ${waveId}: ${done.length}/${roster.length} ${ctx.publish ? 'published' : 'deployed'}, ${parked.length} parked, ${nov.length} no verdict`, artifact: relative(root, reportFile), next: `node skills/rollout/scripts/wave.mjs ${waveId} ${relative(root, resolve(rosterFile))}${ctx.publish ? ' --publish' : ''}` });
  console.log(progress.summaryLine({ exit, details: relative(root, stateFile), extra: { parked: parked.length, wave: waveId } }));
  return exit;
}
const stageOrder = (name) => (name === null || name === undefined ? -1 : STAGE_INDEX[name]);
const stageBefore = (name) => (STAGE_INDEX[name] > 0 ? STAGES[STAGE_INDEX[name] - 1].name : null);
function advance(s, stage, ctx, p) {
  if (stage.name === 'lint') s.contentHash = fileHash(contentFile(ctx, p));
  if (stage.name === 'local-gate') { s.localOk = true; s.codeHash = ctx.codeHash; s.contentHash = s.contentHash || fileHash(contentFile(ctx, p)); }
  if (stage.name === 'live-gate') { s.liveOk = true; s.liveOkHash = s.deployedHash; }
  if (stage.name === 'pixel') s.pixelDone = true;
  if (stageOrder(s.stage) < STAGE_INDEX[stage.name]) s.stage = stage.name;
  delete s.invalidated;
}

// ---- regate-list: git range → pages, fail-open to all ---------------------------------
export function classifyTouched(files, blocks, pages) {
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const byPath = new Map(pages.map((p) => [String(p.path || '').replace(/\/+$/, '') || '/', p]));
  const out = new Map(); const counts = { block: 0, content: 0, siteWide: 0, unmapped: 0 };
  const addAll = (reason) => { for (const p of pages) if (!out.has(p.slug)) out.set(p.slug, reason); };
  for (const f of files) {
    const n = f.replace(/^\.\//, '');
    let m;
    if ((m = n.match(/^blocks\/([^/]+)\//))) {
      const hits = blocks.filter((b) => (b.delivery && b.delivery.edsBlockName) === m[1] || b.id === m[1]);
      if (!hits.length) { counts.unmapped += 1; addAll('unmapped→all'); continue; }
      counts.block += 1;
      for (const b of hits) for (const slug of b.usedByPages || []) if (bySlug.has(slug) && !out.has(slug)) out.set(slug, `block:${m[1]}`);
    } else if (/^(styles|scripts)\//.test(n) || /^(head\.html|fstab\.yaml|helix-query\.yaml|helix-sitemap\.yaml)$/.test(n) || /^content\/(nav|footer)[^/]*\.html$/.test(n) || /^content\/fragments\//.test(n) || blocks.some((b) => b.delivery && b.delivery.blockPath && n.endsWith(b.delivery.blockPath))) { counts.siteWide += 1; addAll('site-wide'); }
    else if ((m = n.match(/^content\/(.+)\.html$/)) || (m = n.match(/^stardust\/migrated\/(.+?)(?:\/index)?\.html$/))) {
      const p = m[1] === 'index' ? '/' : `/${m[1].replace(/\/index$/, '')}`;
      const row = byPath.get(p.toLowerCase()) || pages.find((x) => x.delivery && x.delivery.deployedPath === p) || pages.find((x) => x.source && x.source.migratedHtml && n.endsWith(x.source.migratedHtml.replace(/^stardust\//, '')));
      if (row) { counts.content += 1; if (!out.has(row.slug)) out.set(row.slug, 'content'); } else { counts.unmapped += 1; addAll('unmapped→all'); }
    } else { counts.unmapped += 1; addAll('unmapped→all'); }
  }
  return { selected: out, counts };
}
export function regateList(args) {
  const root = resolve(args.repo); const rolloutDir = resolve(root, args.out);
  const pages = ((readJSON(join(rolloutDir, 'coverage', 'pages.json'), null) || {}).pages) || null;
  const blocks = ((readJSON(join(rolloutDir, 'coverage', 'blocks.json'), null) || {}).blocks) || null;
  if (!pages || !blocks) { console.error(`rollout wave regate-list: coverage/pages.json + coverage/blocks.json missing under ${rolloutDir} — run inventory.mjs and blocks.mjs first`); return 2; }
  let files;
  if (args.all) files = null;
  else if (args.files) { files = existsSync(args.files) && statSync(args.files).isFile() ? readFileSync(args.files, 'utf8').split('\n') : args.files.split(','); files = files.map((x) => x.trim()).filter(Boolean); }
  else {
    const g = spawnSync('git', ['diff', '--name-only', args.since || 'HEAD~1'], { cwd: root, encoding: 'utf8' });
    if (g.status !== 0) { console.error(`rollout wave regate-list: git diff failed in ${root}: ${(g.stderr || '').trim() || 'not a git repository'}`); return 2; }
    files = g.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
  }
  let selected; let counts = { block: 0, content: 0, siteWide: 0, unmapped: 0 };
  if (files === null) selected = new Map(pages.map((p) => [p.slug, 'forced']));
  else if (!files.length) { console.error('rollout wave regate-list: empty diff → empty list'); selected = new Map(); }
  else ({ selected, counts } = classifyTouched(files, blocks, pages));
  const plan = readJSON(join(rolloutDir, 'plan.json'), null);
  const order = new Map((plan && plan.steps ? plan.steps.map((s) => s.slug) : []).map((s, i) => [s, i]));
  const rows = [...selected.entries()].map(([slug, reason]) => ({ slug, reason, page: pages.find((p) => p.slug === slug) })).filter((r) => r.page)
    .sort((a, b) => (order.has(a.slug) ? order.get(a.slug) : 1e9) - (order.has(b.slug) ? order.get(b.slug) : 1e9) || a.slug.localeCompare(b.slug));
  const ledger = readJSON(join(root, 'content', '.deploy-ledger.json'), {}) || {};
  for (const r of rows) {
    const path = (r.page.delivery && r.page.delivery.deployedPath) || r.page.path;
    if (args.json) { const row = ledger[path] || {}; console.log(JSON.stringify({ slug: r.slug, path, reason: r.reason, bodyHash: row.bodyHash || null, branch: row.branch || null })); } else console.log(`${r.slug}\t${path}\t${r.reason}`);
  }
  console.error(`${files === null ? 'all' : files.length} touched files → ${rows.length} pages (${counts.block} block-mapped · ${counts.content} content · ${counts.siteWide} site-wide · ${counts.unmapped} unmapped→all)`);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`rollout wave: ${e.message}`); usage(2); }
  if (args.help) usage(0);
  if (args.positional[0] === 'regate-list') process.exit(regateList(args));
  runWave(args).then((code) => process.exit(code), (e) => { console.error(`rollout wave: ${e.stack || e.message}`); process.exit(2); });
}
