#!/usr/bin/env node
/**
 * skills/stardust/scripts/preflight-transports.mjs — the capability probes.
 *
 * Runs the five transport probes `reference/harness-permissions.md`
 * § Privileged-action preflight names, in the first minutes of a run, so a
 * denied transport is a `Blocked on owner:` line at Setup — never a surprise
 * after migrate. A probe proves capability (token, reachability, org access),
 * not permission: a read that passes says nothing about the write that follows.
 *
 *   gh-user     gh api user
 *   gh-repo     gh api repos/<org>/<repo>   (404 → gh api orgs/<org>)
 *   git-push    git push --dry-run <remote> <branch>          (cwd = --root)
 *   da-write    PUT 1 byte to admin.da.live /source/<org>/<repo>/.stardust-preflight/<ts>.html, then DELETE
 *   admin-read  GET admin.hlx.page /status/<org>/<repo>/<branch>/
 *
 * Writes `<root>/stardust/.work/env.json` (merged with what is there):
 *   { ..., "transports": { "<probe>": "ok" | "denied" | "unreachable" }, "transportsAt": "<iso>" }
 * Prints one line per probe, then `Blocked on owner:` with the unblock per
 * denied probe. Tokens are read by env-var NAME only (`--token-env`, default
 * DA_TOKEN); the value is never printed or written.
 *
 * Usage:
 *   node skills/stardust/scripts/preflight-transports.mjs --org <org> --repo <repo>
 *        [--branch main] [--remote origin] [--root <dir>] [--token-env DA_TOKEN]
 *        [--skip gh-user,gh-repo,git-push,da-write,admin-read]
 *
 * Exit: 0 all ok · 2 any denied · 1 none denied but some unreachable / usage error.
 * No dependencies (Node 18+: global fetch / FormData / Blob).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DA_SRC = 'https://admin.da.live/source';
const ADMIN = 'https://admin.hlx.page';
const PROBES = ['gh-user', 'gh-repo', 'git-push', 'da-write', 'admin-read'];
const HTTP_TIMEOUT_MS = 15_000;
const CMD_TIMEOUT_MS = 20_000;

function usage(code) {
  const text = readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1]
    .split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim();
  (code ? process.stderr : process.stdout).write(`${text}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const o = { org: '', repo: '', branch: 'main', remote: 'origin', root: process.cwd(), tokenEnv: 'DA_TOKEN', skip: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const v = () => { i += 1; if (i >= argv.length) usage(1); return argv[i]; };
    if (k === '--help' || k === '-h') usage(0);
    else if (k === '--org') o.org = v();
    else if (k === '--repo') o.repo = v();
    else if (k === '--branch') o.branch = v();
    else if (k === '--remote') o.remote = v();
    else if (k === '--root') o.root = v();
    else if (k === '--token-env') o.tokenEnv = v();
    else if (k === '--skip') v().split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => o.skip.add(s));
    else { process.stderr.write(`unknown argument: ${k}\n`); usage(1); }
  }
  for (const s of o.skip) if (!PROBES.includes(s)) { process.stderr.write(`unknown probe in --skip: ${s}\n`); usage(1); }
  if (!o.org || !o.repo) { process.stderr.write('--org and --repo are required\n'); usage(1); }
  return o;
}

// ---- classification helpers -------------------------------------------------

const DENIED_RE = /\b(401|403)\b|permission denied|not permitted|authentication failed|could not read username|forbidden|unauthorized|requires authentication|not logged in|bad credentials/i;

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: CMD_TIMEOUT_MS, env: process.env });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  if (r.error && r.error.code === 'ENOENT') return { status: 'unreachable', note: `${cmd} not installed` };
  if (r.error && r.error.code === 'ETIMEDOUT') return { status: 'unreachable', note: `${cmd} timed out` };
  if (r.status === 0) return { status: 'ok', note: '' };
  if (DENIED_RE.test(out)) return { status: 'denied', note: firstLine(out) };
  return { status: 'unreachable', note: firstLine(out), raw: out };
}

function firstLine(s) {
  return (s || '').split('\n').map((l) => l.trim()).filter(Boolean)[0]?.slice(0, 160) || '';
}

async function http(method, url, { token, body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    return { code: res.status };
  } catch (err) {
    return { code: 0, note: String(err?.message || err).slice(0, 160) };
  }
}

function classify(code, note) {
  if (code >= 200 && code < 400) return { status: 'ok', note: '' };
  if (code === 401 || code === 403) return { status: 'denied', note: `HTTP ${code}` };
  return { status: 'unreachable', note: code ? `HTTP ${code}` : (note || 'network error') };
}

// ---- probes -----------------------------------------------------------------

async function probeGhUser() { return run('gh', ['api', 'user']); }

async function probeGhRepo({ org, repo }) {
  const r = run('gh', ['api', `repos/${org}/${repo}`]);
  if (r.status !== 'unreachable' || !/\b404\b|not found/i.test(r.raw || '')) return r;
  const o = run('gh', ['api', `orgs/${org}`]);
  return o.status === 'ok' ? { status: 'ok', note: `repo absent; org ${org} reachable` } : o;
}

async function probeGitPush({ root, remote, branch }) {
  return run('git', ['push', '--dry-run', remote, branch], root);
}

async function probeDaWrite({ org, repo, token }) {
  if (!token) return { status: 'denied', note: 'token env unset' };
  const path = `/.stardust-preflight/${Date.now()}.html`;
  const url = `${DA_SRC}/${org}/${repo}${path}`;
  const fd = new FormData();
  fd.append('data', new Blob(['\n'], { type: 'text/html' }), 'preflight.html');
  const put = await http('PUT', url, { token, body: fd });
  const putRes = classify(put.code, put.note);
  if (putRes.status !== 'ok') return putRes;
  const del = await http('DELETE', url, { token });
  const delRes = classify(del.code, del.note);
  return delRes.status === 'ok' ? { status: 'ok', note: '' } : { status: delRes.status, note: `PUT ok, DELETE ${delRes.note} — remove ${path} by hand` };
}

async function probeAdminRead({ org, repo, branch, token }) {
  if (!token) return { status: 'denied', note: 'token env unset' };
  const r = await http('GET', `${ADMIN}/status/${org}/${repo}/${branch}/`, { token });
  return classify(r.code, r.note);
}

const RUNNERS = {
  'gh-user': probeGhUser,
  'gh-repo': probeGhRepo,
  'git-push': probeGitPush,
  'da-write': probeDaWrite,
  'admin-read': probeAdminRead,
};

function unblock(name, o) {
  switch (name) {
    case 'gh-user': return 'gh auth login   (or export GH_TOKEN with repo scope)';
    case 'gh-repo': return `gh auth refresh -s repo   # or grant this account access to ${o.org}/${o.repo}`;
    case 'git-push': return `grant push on ${o.remote} for branch ${o.branch}, or install the Code Sync app and add the deploy key`;
    case 'da-write': return `re-login at https://da.live and refresh ${o.tokenEnv}; the DA org ${o.org}/${o.repo} must grant this user write`;
    case 'admin-read': return `refresh ${o.tokenEnv}; the site ${o.org}/${o.repo} must list this user in its admin config`;
    default: return '';
  }
}

// ---- main -------------------------------------------------------------------

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const token = process.env[o.tokenEnv] || '';
  const ctx = { ...o, token };
  const transports = {};
  const notes = {};
  for (const name of PROBES) {
    if (o.skip.has(name)) continue;
    const r = await RUNNERS[name](ctx);
    transports[name] = r.status;
    notes[name] = r.note || '';
    process.stdout.write(`${name.padEnd(11)} ${r.status}${r.note ? `  (${r.note})` : ''}\n`);
  }

  const workDir = join(o.root, 'stardust', '.work');
  const envPath = join(workDir, 'env.json');
  let env = {};
  try { env = JSON.parse(readFileSync(envPath, 'utf8')); } catch { env = {}; }
  mkdirSync(workDir, { recursive: true });
  env.transports = { ...(env.transports || {}), ...transports };
  env.transportsAt = new Date().toISOString();
  env.transportsTarget = { org: o.org, repo: o.repo, branch: o.branch, tokenEnv: o.tokenEnv };
  writeFileSync(envPath, `${JSON.stringify(env, null, 2)}\n`);

  const denied = Object.entries(transports).filter(([, s]) => s === 'denied').map(([n]) => n);
  const unreachable = Object.entries(transports).filter(([, s]) => s === 'unreachable').map(([n]) => n);
  if (denied.length) {
    process.stdout.write('\nBlocked on owner:\n');
    for (const n of denied) process.stdout.write(`  ${n}: ${unblock(n, o)}${notes[n] ? `   [${notes[n]}]` : ''}\n`);
  }
  if (unreachable.length) process.stdout.write(`\nUnreachable (retry, not an owner action): ${unreachable.join(', ')}\n`);
  process.stdout.write(`\nwrote ${envPath}\n`);
  process.exit(denied.length ? 2 : (unreachable.length ? 1 : 0));
}

main().catch((err) => { process.stderr.write(`preflight-transports: ${err?.message || err}\n`); process.exit(1); });
