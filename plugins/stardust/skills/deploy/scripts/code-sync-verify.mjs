#!/usr/bin/env node
/**
 * skills/deploy/scripts/code-sync-verify.mjs — the two gates around a code push.
 *
 * VERIFY (default): prove the served code IS the working tree before any capture.
 *   Two staleness classes hid behind "the fix is not live" in the field: the CDN
 *   (`x-cache: HIT`, code CSS served under `max-age=7200` for hours) and the Code
 *   Bus (`last-modified` pinned — neither `?cb=` nor `Cache-Control: no-cache` busts
 *   it). Each has its own lever, run in this order per changed path:
 *   `POST admin.hlx.page/code/<org>/<repo>/<ref>/<path>` (re-sync, 202) then
 *   `POST admin.hlx.page/cache/<org>/<repo>/<ref>/<path>` (purge, 200). Then the
 *   DECODED served body's SHA-256 must equal the WORKING-TREE file (not the HEAD
 *   blob — one recorded phantom round was uncommitted CSS with served == HEAD).
 *
 *   node skills/deploy/scripts/code-sync-verify.mjs --org <org> --repo <repo> --ref <branch>
 *        [--since <sha> | --all] [--wait 180] [--no-purge] [--root <eds-root>] [--remote origin]
 *        [--record stardust/code-sync.json] [--token-env DA_TOKEN] [--site-token-env NAME]
 *        [--served-base <url>] [--admin-base <url>] [--json]
 *
 *   step 0  `git status --porcelain` and `git rev-list <remote>/<ref>..HEAD` over the code paths
 *           (blocks/ styles/ scripts/ head.html) — dirty or unpushed → exit 3, ZERO requests.
 *   step 1  changed paths: `git diff --name-only --diff-filter=ACMR <since>..HEAD -- <code paths>`;
 *           <since> defaults to the record's last verified `headSha`, else every tracked file
 *           (`--all`; the first run). A run with no changed path is exit 0 (record refreshed).
 *   step 2  per path: POST /code/ (first run or --all: `/*` once) then POST /cache/ (--no-purge skips).
 *   step 3  decoded GET on `https://<ref>--<repo>--<org>.aem.page/<path>` vs the file bytes, polled
 *           every 3 s until --wait (default 180 s).
 *   step 4  one table row per path: `path · code · cache · last-modified · age · x-cache · sha`;
 *           the record `{org, repo, ref, headSha, status, ts, paths}` is written to --record.
 *
 * LINT (`--lint`): the syntax + lint gate before any `git commit` of code the run wrote.
 *   node skills/deploy/scripts/code-sync-verify.mjs --lint [--root <eds-root>] [--files <a,b,…>]
 *        [--syntax-only] [--fix] [--json]
 *   Files: the changed + untracked files under blocks/ scripts/*.js styles/ (or --files). Stages:
 *   (1) every .js through `node --input-type=module --check` — ESM-safe; a plain `node --check
 *   <file>.js` passed a duplicate `const` on a boilerplate repo (no "type":"module") and shipped a
 *   22-minute site-wide chrome outage; (2) `<root>/node_modules/.bin/eslint` when it and its parser
 *   resolve; (3) `<root>/node_modules/.bin/stylelint` when it resolves. Local `.bin` only — never
 *   `npx` (it may fetch). Errors block, warnings pass. A missing tool for a file class present in the
 *   list (eslint with .js, stylelint with .css) is exit 2 "lint unavailable — npm ci --legacy-peer-deps
 *   in <root>", never a pass; a tool no listed file needs is not required. `--syntax-only` is allowed
 *   only when installing it was denied or impossible (the line `lint: unavailable (<reason>)` goes
 *   to the journal and the finish report). Files the run touched are the run's — "pre-existing"
 *   never applies to them; the boilerplate's `npm run lint` over `.` is the site's CI, not this gate.
 *   Without --files the list comes from git: a root that is not a work tree, has no commit yet, or
 *   whose listing fails is exit 1 "cannot list changed files — pass --files" — never "nothing to lint".
 *   A tool that runs but reaches no verdict — eslint exit ≥ 2 (config it cannot load, internal error),
 *   stylelint 78 / 64 — is `lint: unavailable (<tool> exited <n> — <first line>)`, exit 2, never clean;
 *   any other non-zero exit without a finding line is one finding `exited <n> — <first line>`. A
 *   --files entry that does not exist is a `not found` finding (syntax FAIL) and never reaches a tool.
 *
 * Exit codes (both modes; 124 = no verdict, never a FAIL — the run-capped convention):
 *   0    verify: every changed path served == tree (record status `ok`) · lint: clean / nothing to lint
 *   1    usage (unknown flag, missing --org/--repo/--ref, unreadable root) · lint: the changed-file listing
 *        failed (not a git work tree / no HEAD) and no --files was given — no verdict, never a pass
 *   2    verify: admin POST 401/403/404 (token or Code Sync installation — definitive) · lint: findings
 *        in touched files, or toolchain unavailable
 *   3    verify: local precondition — uncommitted or unpushed changes under the code paths ("push first")
 *   124  verify: served ≠ tree at the deadline after re-sync + purge — propagation pending; re-run once
 *        (bounded), then book the round instrument-invalidated; never a mismatch verdict
 * No dependencies (Node 18+). Requests go to admin.hlx.page and the target's aem.page host only —
 * never the source site. Test hooks: CODE_SYNC_POLL_MS shortens the 3 s poll; --served-base /
 * --admin-base point at a fixture origin.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchDecoded, resolveToken, siteTokenName } from './lib.mjs';

const CODE_PATHS = ['blocks', 'styles', 'scripts', 'head.html'];
const LINT_PATHS = ['blocks', 'scripts', 'styles'];
const POLL_MS = Number(process.env.CODE_SYNC_POLL_MS) || 3000;
const DEADLINE_EXIT = 124;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function usage() {
  console.log('usage: node skills/deploy/scripts/code-sync-verify.mjs --org <org> --repo <repo> --ref <branch> [--since <sha> | --all] [--wait 180] [--no-purge] [--root <dir>] [--remote origin] [--record stardust/code-sync.json] [--token-env DA_TOKEN] [--site-token-env NAME] [--served-base <url>] [--admin-base <url>] [--json]\n'
    + '       node skills/deploy/scripts/code-sync-verify.mjs --lint [--root <dir>] [--files <a,b,…>] [--syntax-only] [--fix] [--json]\n'
    + '  exit 0 served == tree / lint clean · 1 usage · 2 admin 401/403/404 / lint findings or toolchain unavailable · 3 dirty or unpushed code paths · 124 propagation pending (no verdict)');
}

export function parseArgs(argv) {
  const a = { wait: 180, purge: true, all: false, root: process.cwd(), remote: 'origin', record: 'stardust/code-sync.json', tokenEnv: 'DA_TOKEN', json: false, lint: false, syntaxOnly: false, fix: false, files: null };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const next = () => { const v = argv[i + 1]; if (v === undefined || /^--/.test(v)) throw new Error(`${k} needs a value`); i += 1; return v; };
    if (k === '--org') a.org = next();
    else if (k === '--repo') a.repo = next();
    else if (k === '--ref') a.ref = next();
    else if (k === '--since') a.since = next();
    else if (k === '--all') a.all = true;
    else if (k === '--wait') { a.wait = Number(next()); if (!Number.isFinite(a.wait) || a.wait < 0) throw new Error('--wait takes seconds'); }
    else if (k === '--no-purge') a.purge = false;
    else if (k === '--root') a.root = path.resolve(next());
    else if (k === '--remote') a.remote = next();
    else if (k === '--record') a.record = next();
    else if (k === '--token-env') a.tokenEnv = next();
    else if (k === '--site-token-env') a.siteTokenEnv = next();
    else if (k === '--served-base') a.servedBase = next().replace(/\/$/, '');
    else if (k === '--admin-base') a.adminBase = next().replace(/\/$/, '');
    else if (k === '--json') a.json = true;
    else if (k === '--lint') a.lint = true;
    else if (k === '--files') a.files = next().split(',').map((f) => f.trim()).filter(Boolean);
    else if (k === '--syntax-only') a.syntaxOnly = true;
    else if (k === '--fix') a.fix = true;
    else if (k === '--help' || k === '-h') { usage(); process.exit(0); }
    else throw new Error(`unknown arg: ${k}`);
  }
  if (!existsSync(a.root) || !statSync(a.root).isDirectory()) throw new Error(`--root ${a.root} is not a directory`);
  if (!a.lint) {
    if (!a.org || !a.repo || !a.ref) throw new Error('--org, --repo and --ref are required (or --lint)');
    a.servedBase ||= `https://${a.ref}--${a.repo}--${a.org}.aem.page`;
    a.adminBase ||= 'https://admin.hlx.page';
    if (!path.isAbsolute(a.record)) a.record = path.join(a.root, a.record);
  }
  return a;
}

const git = (root, args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

/** step 0 — the local precondition: dirty or unpushed code paths decide exit 3 with zero requests. */
export function localPrecondition(root, ref, remote) {
  if (!git(root, ['rev-parse', '--is-inside-work-tree']).ok) return { ok: false, why: `${root} is not a git work tree` };
  const dirty = lines(git(root, ['status', '--porcelain', '--', ...CODE_PATHS]).out);
  if (dirty.length) return { ok: false, why: `uncommitted changes under the code paths — commit and push first:\n  ${dirty.join('\n  ')}` };
  const remoteRef = `${remote}/${ref}`;
  if (!git(root, ['rev-parse', '--verify', '--quiet', remoteRef]).ok) return { ok: false, why: `${remoteRef} is unknown here — \`git fetch ${remote} ${ref}\` (or push the branch) first` };
  const ahead = lines(git(root, ['rev-list', `${remoteRef}..HEAD`]).out);
  if (ahead.length) return { ok: false, why: `${ahead.length} commit(s) not on ${remoteRef} — push first (${ahead[0].slice(0, 7)}…)` };
  return { ok: true, headSha: git(root, ['rev-parse', 'HEAD']).out };
}

/** step 1 — the paths to prove: changed since <since> (ACMR), or every tracked code file. */
export function changedPaths(root, { since, all }) {
  if (all || !since) return { paths: lines(git(root, ['ls-files', '--', ...CODE_PATHS]).out), full: true };
  const r = git(root, ['diff', '--name-only', '--diff-filter=ACMR', `${since}..HEAD`, '--', ...CODE_PATHS]);
  if (!r.ok) return { paths: lines(git(root, ['ls-files', '--', ...CODE_PATHS]).out), full: true, note: `${since} unknown — comparing every tracked code file` };
  return { paths: lines(r.out), full: false };
}

export function readRecord(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

async function adminPost(url, token) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    return res.status;
  } catch { return 0; }
}

async function verify(a) {
  const pre = localPrecondition(a.root, a.ref, a.remote);
  if (!pre.ok) { console.error(`code-sync-verify: ${pre.why}`); return 3; }
  const prev = readRecord(a.record);
  const since = a.since || (prev && prev.status === 'ok' && prev.ref === a.ref && prev.org === a.org && prev.repo === a.repo ? prev.headSha : null);
  const { paths, full, note } = changedPaths(a.root, { since, all: a.all });
  if (note) console.error(`code-sync-verify: ${note}`);
  const record = { org: a.org, repo: a.repo, ref: a.ref, headSha: pre.headSha, status: 'pending', ts: new Date().toISOString(), paths: {} };
  const write = () => { mkdirSync(path.dirname(a.record), { recursive: true }); writeFileSync(a.record, `${JSON.stringify(record, null, 2)}\n`); };
  if (!paths.length) {
    record.status = 'ok';
    write();
    console.log(`code-sync-verify: no code path changed since ${since ? since.slice(0, 7) : 'the last record'} — ${a.record} refreshed (HEAD ${pre.headSha.slice(0, 7)})`);
    return 0;
  }
  const tok = resolveToken(a.tokenEnv);
  if (!tok) { console.error(`code-sync-verify: ${a.tokenEnv} missing — run node skills/deploy/scripts/da-token-check.mjs first; nothing POSTed`); return 2; }
  const siteNames = a.siteTokenEnv ? [a.siteTokenEnv] : [siteTokenName(a.repo), 'SITE_TOKEN'];
  const site = siteNames.map((n) => resolveToken(n)).find(Boolean);
  const servedHeaders = { 'cache-control': 'no-cache', pragma: 'no-cache', ...(site ? { authorization: /^(token|bearer) /i.test(site.value) ? site.value : `token ${site.value}` } : {}) };

  // step 2 — levers, code then cache, per path (a full run re-syncs the whole ref once)
  const codeStatus = {};
  const cacheStatus = {};
  const definitive = (st, url) => { if ([401, 403, 404].includes(st)) { console.error(`code-sync-verify: admin ${st} on ${url} — ${st === 404 ? 'the ref or the Code Sync installation is missing (da-deploy-protocol.md step 0)' : `${a.tokenEnv} rejected or no admin access — refresh it / ask the owner`}; verdict: cannot re-sync`); return true; } return false; };
  if (full) {
    const url = `${a.adminBase}/code/${a.org}/${a.repo}/${a.ref}/*`;
    const st = await adminPost(url, tok.value);
    if (definitive(st, url)) return 2;
    for (const p of paths) codeStatus[p] = st;
  } else {
    for (const p of paths) {
      const url = `${a.adminBase}/code/${a.org}/${a.repo}/${a.ref}/${p}`;
      codeStatus[p] = await adminPost(url, tok.value);
      if (definitive(codeStatus[p], url)) return 2;
    }
  }
  if (a.purge) {
    for (const p of paths) {
      const url = `${a.adminBase}/cache/${a.org}/${a.repo}/${a.ref}/${p}`;
      cacheStatus[p] = await adminPost(url, tok.value);
      if (definitive(cacheStatus[p], url)) return 2;
    }
  }

  // step 3 — served SHA-256 vs the working tree, polled to the cap
  const local = Object.fromEntries(paths.map((p) => [p, sha256(readFileSync(path.join(a.root, p)))]));
  const facts = {};
  const deadline = Date.now() + a.wait * 1000;
  let pending = [...paths];
  for (;;) {
    const still = [];
    for (const p of pending) {
      const r = await fetchDecoded(`${a.servedBase}/${p}`, { headers: servedHeaders });
      const served = r.status === 200 ? sha256(r.buf) : null;
      facts[p] = { ...r, served, match: served === local[p] };
      if (!facts[p].match) still.push(p);
    }
    pending = still;
    if (!pending.length || Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  // step 4 — table + record
  for (const p of paths) {
    const f = facts[p];
    record.paths[p] = { sha: local[p], served: f.served, status: f.match ? 'ok' : f.status === 200 ? 'stale' : `http ${f.status}` };
    const row = `${f.match ? 'OK   ' : 'STALE'} ${p} · code ${codeStatus[p] ?? '-'} · cache ${cacheStatus[p] ?? '-'} · last-modified=${f.lastModified.replace(/ /g, '_')} age=${f.age}${f.xcache ? ` x-cache=${f.xcache.replace(/ /g, '_')}` : ''} · ${f.status} ${f.enc} ${f.buf.length}B sha=${f.match ? 'match' : `differ (served ${f.served ? f.served.slice(0, 12) : 'n/a'} / local ${local[p].slice(0, 12)})`}`;
    console.log(row);
  }
  record.status = pending.length ? 'pending' : 'ok';
  write();
  if (a.json) console.log(JSON.stringify(record, null, 2));
  if (pending.length) {
    console.error(`code-sync-verify: ${pending.length} of ${paths.length} path(s) still differ after ${a.wait}s — propagation pending, no verdict (exit ${DEADLINE_EXIT}). Re-run once; if it persists, book the round instrument-invalidated and check the Code Sync POST (da-deploy-protocol.md step 0). Neither ?cb= nor Cache-Control: no-cache busts the code bus — only the POST /code/ re-sync does.`);
    return DEADLINE_EXIT;
  }
  console.log(`code-sync-verify: ${paths.length} path(s) served == working tree on ${a.servedBase} (HEAD ${pre.headSha.slice(0, 7)}) → ${a.record}`);
  return 0;
}

// ───────────────────────────────────────────────────────────── lint mode ──

/** The files the run touched: changed vs HEAD (ACMR) + untracked, under the lint paths; or --files. */
export function lintFiles(root, files) {
  let list = files;
  if (!list) {
    // a failed listing is NO verdict: an empty list from a non-repo or a HEAD-less root must never read as "nothing to lint"
    if (!git(root, ['rev-parse', '--is-inside-work-tree']).ok) return { error: `${root} is not a git work tree` };
    const diff = git(root, ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD', '--', ...LINT_PATHS]);
    if (!diff.ok) return { error: `git diff HEAD failed (${diff.err.split('\n')[0] || 'no HEAD?'})` };
    const others = git(root, ['ls-files', '--others', '--exclude-standard', '--', ...LINT_PATHS]);
    if (!others.ok) return { error: `git ls-files failed (${others.err.split('\n')[0]})` };
    list = [...lines(diff.out), ...lines(others.out)];
  }
  const uniq = [...new Set(list)].filter((f) => /\.(js|css)$/.test(f));
  return { js: uniq.filter((f) => f.endsWith('.js')), css: uniq.filter((f) => f.endsWith('.css')) };
}

/** ESM-safe syntax check: the file is parsed as a module regardless of package.json "type". */
export function syntaxCheck(root, file) {
  const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: readFileSync(path.join(root, file)), encoding: 'utf8' });
  if (r.status === 0) return null;
  const err = r.stderr || '';
  const line = (err.match(/^\[stdin\]:(\d+)/m) || [])[1];
  const msg = (err.match(/^(SyntaxError|ReferenceError|TypeError): .*$/m) || [])[0] || 'syntax error';
  return `${line ? `line ${line}: ` : ''}${msg}`;
}

/** eslint / stylelint from <root>/node_modules/.bin only; a tool is required only for a file class in the list; the parser probe runs eslint once on one file. */
export function resolveToolchain(root, sampleJs, { needJs = true, needCss = true } = {}) {
  const bin = (n) => { const p = path.join(root, 'node_modules', '.bin', n); return existsSync(p) ? p : null; };
  const eslint = bin('eslint');
  const stylelint = bin('stylelint');
  const missing = [];
  if (needJs && !eslint) missing.push('eslint');
  if (needCss && !stylelint) missing.push('stylelint');
  let parserNote = null;
  if (eslint && sampleJs) {
    const probe = spawnSync(eslint, [sampleJs], { cwd: root, encoding: 'utf8' });
    if (/Failed to load parser|Cannot find module/.test(`${probe.stderr}${probe.stdout}`)) { parserNote = ((`${probe.stderr}${probe.stdout}`).match(/Failed to load parser[^\n]*|Cannot find module[^\n]*/) || ['parser missing'])[0]; missing.push('eslint parser'); }
  }
  return { eslint, stylelint, missing, parserNote };
}

function lint(a) {
  const listed = lintFiles(a.root, a.files);
  if (listed.error) { console.error(`lint-changed: cannot list changed files — ${listed.error}; pass --files <a,b,…> (no verdict, exit 1)`); return 1; }
  const { js, css } = listed;
  const all = [...js, ...css];
  if (!all.length) { console.log('lint-changed: nothing to lint (no changed or untracked files under blocks/ scripts/ styles/)'); return 0; }
  const findings = [];
  const perFile = {};
  // a --files entry that does not exist is a finding (a typo'd path or a deleted file), never a crash and never handed to a tool
  const present = (f) => existsSync(path.join(a.root, f));
  for (const f of all) if (!present(f)) { perFile[f] = { syntax: 'FAIL' }; findings.push(`${f}: not found under ${a.root}`); }
  const jsPresent = js.filter(present);
  const cssPresent = css.filter(present);
  for (const f of jsPresent) {
    const err = syntaxCheck(a.root, f);
    perFile[f] = { syntax: err ? 'FAIL' : 'ok' };
    if (err) findings.push(`${f}: ${err}`);
  }
  for (const f of cssPresent) perFile[f] = { syntax: '-' };
  const tc = resolveToolchain(a.root, jsPresent[0], { needJs: js.length > 0, needCss: css.length > 0 });
  let unavailable = null;
  if (tc.missing.length) {
    unavailable = `lint: unavailable (${tc.missing.join(', ')} do not resolve from ${a.root}/node_modules/.bin${tc.parserNote ? ` — ${tc.parserNote}` : ''})`;
    if (!a.syntaxOnly) {
      for (const f of all) console.log(`${f}  syntax ${perFile[f].syntax}`);
      for (const x of findings) console.log(`  ✗ ${x}`);
      console.error(`lint-changed: ${unavailable} — run \`npm ci --legacy-peer-deps\` in ${a.root} and re-run; --syntax-only only when the install was denied or is impossible (the line above then goes to the journal and the finish report). Unavailable is never clean (exit 2).`);
      return 2;
    }
  }
  // A tool that did not run to a verdict is `unavailable`, never clean: eslint exits 2 on a config / internal
  // error ("couldn't find the config … to extend from"), stylelint 78 on an invalid config and 64 on usage —
  // the shapes a pruned node_modules produces. Any other non-zero exit with no finding line is reported verbatim.
  const CRASH = { eslint: (st) => st >= 2, stylelint: (st) => st === 78 || st === 64 };
  const crashed = [];
  const runTool = (tool, files, label) => {
    if (!tool || !files.length) return;
    const r = spawnSync(tool, [...(a.fix ? ['--fix'] : []), ...files], { cwd: a.root, encoding: 'utf8' });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const outLines = out.split('\n').map((l) => l.trim()).filter(Boolean);
    // the reason line: the first line that names the failure (ESLint prints a decorative "Oops!" banner first), else the first line
    const firstLine = outLines.find((l) => /error|couldn't|cannot|failed|not found|no configuration|missing|unknown/i.test(l)) || outLines[0] || (r.error ? r.error.message : 'no output');
    if (r.error || r.status === null || CRASH[label](r.status)) { crashed.push(`${label} exited ${r.status ?? r.error?.code ?? 'signal'} — ${firstLine}`); for (const f of files) perFile[f][label] = '?'; return; }
    for (const f of files) perFile[f][label] = r.status === 0 ? 0 : '✗';
    if (r.status === 0) return;
    const matched = out.split('\n').filter((l) => /\berror\b|✖/.test(l)).slice(0, 40).map((l) => `${label}: ${l.trim()}`);
    findings.push(...(matched.length ? matched : [`${label}: exited ${r.status} — ${firstLine}`]));
  };
  if (!unavailable) {
    // errors block; warnings pass (eslint exits 0 on warnings only, stylelint too)
    runTool(tc.eslint, jsPresent, 'eslint');
    runTool(tc.stylelint, cssPresent, 'stylelint');
    if (crashed.length) unavailable = `lint: unavailable (${crashed.join('; ')})`;
  }
  for (const f of all) console.log(`${f}  syntax ${perFile[f].syntax}${'eslint' in perFile[f] ? ` · eslint ${perFile[f].eslint}` : ''}${'stylelint' in perFile[f] ? ` · stylelint ${perFile[f].stylelint}` : ''}`);
  if (unavailable) console.log(unavailable);
  if (a.json) console.log(JSON.stringify({ files: perFile, findings, unavailable }, null, 2));
  if (crashed.length) {
    for (const x of findings) console.log(`  ✗ ${x}`);
    console.error(`lint-changed: ${unavailable} — the toolchain did not reach a verdict (a config it cannot load, a pruned node_modules): run \`npm ci --legacy-peer-deps\` in ${a.root} and re-run; --syntax-only only when the install was denied or is impossible. Unavailable is never clean (exit 2).`);
    return 2;
  }
  if (findings.length) {
    for (const x of findings) console.log(`  ✗ ${x}`);
    console.error(`lint-changed: ${findings.length} finding(s) in files this run touched — fix them in the same step (they are the run's, whatever line they sit on), then re-run (exit 2)`);
    return 2;
  }
  console.log(`lint-changed: ${all.length} file(s) clean${unavailable ? ' (syntax only)' : ''}`);
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  let a;
  try { a = parseArgs(argv); } catch (e) { console.error(`code-sync-verify: ${e.message}`); usage(); return 1; }
  return a.lint ? lint(a) : verify(a);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main().then((code) => process.exit(code)).catch((e) => { console.error(`code-sync-verify: ${e.message}`); process.exit(1); });
