#!/usr/bin/env node
/**
 * skills/deploy/scripts/lockdown.mjs — lock a delivered site before the hand-off: private repo + site auth.
 * The instrument behind the `lockdown` register row (`reference/site-lockdown.md`): it runs AFTER the last
 * anonymous gate and BEFORE the hand-off, never mid-rollout — a locked origin answers 401 to every
 * anonymous probe, so every later delivery-host read carries the token it writes (by NAME).
 *
 *   node skills/deploy/scripts/lockdown.mjs --org <org> --repo <repo> [--site <site>] [--branch main]
 *        [--allow *@dom,...] [--token-env DA_TOKEN] [--site-token-env SITE_TOKEN_<SLUG>] [--env .env]
 *        [--state stardust/state.json] [--no-repo] [--admin-base https://admin.hlx.page]
 *        [--gh-mode gh|rest|print] [--wait 60] [--json]
 *   node skills/deploy/scripts/lockdown.mjs --inventory --org <org> [--prefix sdt-] [--gh-mode gh|rest] [--json]
 *
 *   --org/--repo        GitHub coordinates; --site defaults to --repo (the DA/admin site name).
 *   --allow             access allow list, comma-separated; default `*@<domain of git config user.email>`
 *                       (the OPERATOR's domain — the field runs allow-listed the operator's org, not the customer's).
 *   --token-env         env NAME of the DA/IMS token for admin.hlx.page (default DA_TOKEN; lib.mjs resolveToken:
 *                       shell → ./.env → ~/.claude/.env → ~/.env). Missing → exit 2 before any request.
 *   --site-token-env    env NAME the new site token is written under (default SITE_TOKEN_<SLUG> from --site).
 *   --env               the env file that receives `NAME=value` (default ./.env). It must be git-ignored where
 *                       the file sits in a work tree (master Setup step 6) — asserted BEFORE any POST.
 *   --state             state.json to merge `credentials.siteTokenEnv` into (absent → reported, never created).
 *   --no-repo           skip the repo-visibility half (an already-private bootstrap, or the owner did it).
 *   --gh-mode           gh: `gh repo edit … --visibility private` · rest: PATCH api.github.com with GH_PAT ·
 *                       print: never run it — print the command as the owner's (exit 3 unless already private).
 *   --wait <s>          capped propagation wait for the verify (poll every 3 s; default 60 = 20 polls).
 *   --inventory         TSV for --org (repo · visibility · last push · served · page · live · site auth · class);
 *                       --prefix narrows by repo-name prefix. Three anonymous GETs per repo, no writes.
 *
 * Steps (stop at the first failure; nothing is guessed):
 *   1 resolve the token, assert the env file is ignored;  2 GET config/<org>/sites/<site>.json (404 → exit 2:
 *   the config service is not enabled for the site — enable it, re-run);  3 repo → private (denied → `owner:`
 *   line, the site half continues);  4 POST …/secrets.json {} → a site token;  5 GET …/access/site.json, merge
 *   (`allow` union, `secretId` appended — never replaced), POST it back;  6 write the token to --env by NAME and
 *   `credentials.siteTokenEnv` to --state;  7 verify `<branch>--<site>--<org>.aem.page` and `.aem.live`:
 *   anonymous → 401/403, `Authorization: token …` → accepted (200; 404 on a host with nothing published).
 *   Last stdout line: `SUMMARY lockdown <org>/<site> repo=… site=… verify=… exit=<n>` (+ `owner: <cmd>`).
 *
 * Exit codes (a `timeout` 124 wrapper stays "no verdict"):
 *   0  locked and verified on both hosts (repo private or --no-repo)
 *   1  verification failed after --wait (anonymous still answers, or the token is rejected) — fail loud, re-run
 *   2  no verdict: usage, token missing or a placeholder (no request made), env file not ignored, config 404 / 401 /
 *      unreachable, secret not returned
 *   3  owner action needed: the repo step was denied or --gh-mode print — `owner:` carries the exact command;
 *      the site half ran and verified (else 1)
 * Never: prints a token value, `cat`s an env file, touches the source site, publishes, guesses a config.
 * No dependencies (Node 18+). Test hooks: LOCKDOWN_DELIVERY_BASE (delivery hosts → <base>/aem.page|aem.live),
 * LOCKDOWN_GH_API (GitHub API base), LOCKDOWN_POLL_MS.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveToken, siteTokenName } from './lib.mjs';

const GH_API = process.env.LOCKDOWN_GH_API || 'https://api.github.com';
const POLL_MS = Number(process.env.LOCKDOWN_POLL_MS) || 3000;
const HTTP_TIMEOUT_MS = 15_000;
const DENIED_RE = /\b(401|403)\b|permission denied|not permitted|forbidden|unauthorized|requires authentication|not logged in|bad credentials|not accessible/i;

function usage() {
  const text = readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)[1].split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim();
  console.log(text);
}

export function parseArgs(argv) {
  const a = { org: '', repo: '', site: '', branch: 'main', allow: null, tokenEnv: 'DA_TOKEN', siteTokenEnv: '', env: '.env', state: path.join('stardust', 'state.json'), noRepo: false, inventory: false, prefix: '', adminBase: 'https://admin.hlx.page', ghMode: 'gh', wait: 60, json: false, help: false };
  const v = (i, k) => { const x = argv[i + 1]; if (x === undefined || x.startsWith('--')) throw new Error(`${k} needs a value`); return x; };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--help' || k === '-h') a.help = true;
    else if (k === '--org') a.org = v(i++, k);
    else if (k === '--repo') a.repo = v(i++, k);
    else if (k === '--site') a.site = v(i++, k);
    else if (k === '--branch') a.branch = v(i++, k);
    else if (k === '--allow') a.allow = v(i++, k).split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--token-env') a.tokenEnv = v(i++, k);
    else if (k === '--site-token-env') a.siteTokenEnv = v(i++, k);
    else if (k === '--env') a.env = v(i++, k);
    else if (k === '--state') a.state = v(i++, k);
    else if (k === '--no-repo') a.noRepo = true;
    else if (k === '--inventory') a.inventory = true;
    else if (k === '--prefix') a.prefix = v(i++, k);
    else if (k === '--admin-base') a.adminBase = v(i++, k).replace(/\/$/, '');
    else if (k === '--gh-mode') a.ghMode = v(i++, k);
    else if (k === '--wait') a.wait = Number(v(i++, k));
    else if (k === '--json') a.json = true;
    else throw new Error(`unknown argument: ${k}`);
  }
  if (a.help) return a;
  if (!a.org) throw new Error('--org is required');
  if (!a.inventory && !a.repo) throw new Error('--repo is required');
  if (!['gh', 'rest', 'print'].includes(a.ghMode)) throw new Error('--gh-mode must be gh, rest or print');
  if (!Number.isFinite(a.wait) || a.wait < 0) throw new Error('--wait must be a number of seconds');
  a.site = a.site || a.repo;
  a.siteTokenEnv = a.siteTokenEnv || siteTokenName(a.site);
  return a;
}

// ---- transport helpers --------------------------------------------------------

async function http(method, url, { auth, body, json } = {}) {
  try {
    const headers = {};
    if (auth) headers.authorization = auth;
    if (json !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(url, { method, headers, body: json !== undefined ? JSON.stringify(json) : body, redirect: 'manual', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { status: res.status, data, xError: res.headers.get('x-error') || '' };
  } catch (err) { return { status: 0, data: null, note: String(err?.message || err).slice(0, 160) }; }
}

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', timeout: 20_000 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  if (r.error) return { ok: false, denied: false, note: r.error.code === 'ENOENT' ? 'gh not installed' : r.error.message, out: '' };
  return { ok: r.status === 0, denied: r.status !== 0 && DENIED_RE.test(out), note: out.split('\n').map((l) => l.trim()).filter(Boolean)[0] || '', out: r.stdout || '' };
}

/** Delivery host for a branch/site/org — or the test hook's local base. */
export function deliveryHost(kind, { org, site, branch }) {
  const base = process.env.LOCKDOWN_DELIVERY_BASE;
  return base ? `${base.replace(/\/$/, '')}/aem.${kind}` : `https://${branch}--${site}--${org}.aem.${kind}`;
}

/** Default allow list: the operator's mail domain (never the customer's) — from git config user.email. */
export function defaultAllow() {
  const r = spawnSync('git', ['config', 'user.email'], { encoding: 'utf8' });
  const dom = (r.stdout || '').trim().split('@')[1];
  return dom ? [`*@${dom}`] : [];
}

/** `NAME=value` into an env file: replace the line or append; never prints the value. */
export function writeEnvVar(file, name, value) {
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, 'm');
  const next = re.test(prev) ? prev.replace(re, line) : `${prev}${prev && !prev.endsWith('\n') ? '\n' : ''}${line}\n`;
  writeFileSync(file, next);
  try { chmodSync(file, 0o600); } catch { /* fs without modes */ }
  return re.test(prev) ? 'replaced' : 'appended';
}

/** The env file must be ignored where it sits in a work tree (Setup step 6) — asserted before any POST. */
export function envIgnored(file) {
  const dir = path.dirname(path.resolve(file));
  const inTree = spawnSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (inTree.status !== 0) return { ok: true, why: 'not a git work tree — nothing to commit it into' };
  const ig = spawnSync('git', ['-C', dir, 'check-ignore', '-q', path.resolve(file)], { encoding: 'utf8' });
  return ig.status === 0 ? { ok: true, why: 'ignored' } : { ok: false, why: `${file} is NOT git-ignored in ${dir}` };
}

/** Merge an access/site.json body: allow union, secretId appended (array; a string is wrapped), other keys kept. */
export function mergeAccess(existing, allow, secretId) {
  const cur = existing && typeof existing === 'object' ? existing : {};
  const ids = Array.isArray(cur.secretId) ? [...cur.secretId] : cur.secretId ? [cur.secretId] : [];
  if (secretId && !ids.includes(secretId)) ids.push(secretId);
  return { ...cur, allow: [...new Set([...(Array.isArray(cur.allow) ? cur.allow : cur.allow ? [cur.allow] : []), ...allow])], secretId: ids };
}

// ---- repo half -----------------------------------------------------------------

async function repoPrivate(a, log) {
  const cmd = `gh repo edit ${a.org}/${a.repo} --visibility private --accept-visibility-change-consequences`;
  if (a.noRepo) { log(`repo: skipped (--no-repo)`); return { repo: 'skipped', owner: null }; }
  if (a.ghMode === 'print') { log(`repo: not run (--gh-mode print) — owner: ${cmd}`); return { repo: 'owner', owner: cmd }; }
  if (a.ghMode === 'rest') {
    const pat = resolveToken('GH_PAT');
    if (!pat) { log(`repo: GH_PAT missing (shell, ./.env, ~/.claude/.env, ~/.env) — owner: ${cmd}`); return { repo: 'owner', owner: cmd }; }
    const auth = `token ${pat.value}`;
    const cur = await http('GET', `${GH_API}/repos/${a.org}/${a.repo}`, { auth });
    if (cur.status === 200 && cur.data?.private === true) { log(`repo: ${a.org}/${a.repo} already private`); return { repo: 'already-private', owner: null }; }
    const r = await http('PATCH', `${GH_API}/repos/${a.org}/${a.repo}`, { auth, json: { private: true } });
    if (r.status === 200 && r.data?.private === true) { log(`repo: ${a.org}/${a.repo} → private (REST)`); return { repo: 'private', owner: null }; }
    log(`repo: PATCH ${r.status || r.note} — owner: ${cmd}`); return { repo: 'owner', owner: cmd };
  }
  const cur = gh(['api', `repos/${a.org}/${a.repo}`, '--jq', '.private']);
  if (cur.ok && cur.out.trim() === 'true') { log(`repo: ${a.org}/${a.repo} already private`); return { repo: 'already-private', owner: null }; }
  const r = gh(['repo', 'edit', `${a.org}/${a.repo}`, '--visibility', 'private', '--accept-visibility-change-consequences']);
  if (r.ok) { log(`repo: ${a.org}/${a.repo} → private`); return { repo: 'private', owner: null }; }
  log(`repo: ${r.denied ? 'denied' : 'failed'} (${r.note}) — owner: ${cmd}`);
  return { repo: 'owner', owner: cmd };
}

// ---- site half -----------------------------------------------------------------

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function verifyHosts(a, tokenValue, log) {
  const hosts = ['page', 'live'].map((k) => deliveryHost(k, a));
  const deadline = Date.now() + a.wait * 1000;
  const auth = `token ${tokenValue}`;
  let last = {};
  for (;;) {
    last = {};
    let allOk = true;
    for (const h of hosts) {
      const anon = await http('GET', `${h}/`);
      const withTok = await http('GET', `${h}/`, { auth });
      const locked = anon.status === 401 || anon.status === 403;
      const accepted = withTok.status > 0 && withTok.status !== 401 && withTok.status !== 403;
      last[h] = { anonymous: anon.status || `000 ${anon.note || ''}`.trim(), token: withTok.status || `000 ${withTok.note || ''}`.trim(), ok: locked && accepted };
      if (!last[h].ok) allOk = false;
    }
    if (allOk || Date.now() >= deadline) break;
    await sleep(POLL_MS);
  }
  for (const [h, r] of Object.entries(last)) log(`verify: ${h}/  anonymous ${r.anonymous}${r.ok ? '' : r.anonymous === 200 ? ' (still open)' : ''} · token ${r.token}${r.token === 404 ? ' (accepted — nothing published on this host yet)' : ''} → ${r.ok ? 'locked' : 'NOT locked'}`);
  return { ok: Object.values(last).every((r) => r.ok), hosts: last };
}

async function lock(a) {
  const out = { org: a.org, repo: a.repo, site: a.site, lines: [] };
  const log = (l) => { out.lines.push(l); if (!a.json) console.log(`lockdown: ${l}`); };
  const summary = (repo, site, verify, exit, owner) => { const s = `SUMMARY lockdown ${a.org}/${a.site} repo=${repo} site=${site} verify=${verify} exit=${exit}${owner ? ` owner=${JSON.stringify(owner)}` : ''}`; if (a.json) console.log(JSON.stringify({ ...out, repo, siteAuth: site, verify, exit, owner: owner || null }, null, 2)); else { if (owner) console.log(`owner: ${owner}`); console.log(s); } return exit; };

  // 1 token + env-file assertion — before any request
  const tok = resolveToken(a.tokenEnv);
  if (!tok) { log(`${a.tokenEnv}: missing — looked in the shell, ./.env, ~/.claude/.env, ~/.env; log in at https://da.live, put it in ./.env (gitignored) and re-run the same command (no verdict, exit 2)`); return summary('-', '-', '-', 2); }
  if (/^(placeholder|changeme|todo|xxx+|<[^>]*>|\$\{[^}]*\}|)$/i.test(tok.value.trim())) { log(`${a.tokenEnv}: a placeholder, not a token (source: ${tok.source}) — log in at https://da.live, put the real value in ./.env (gitignored) and re-run the same command; no request made (exit 2)`); return summary('-', '-', '-', 2); }
  const ig = envIgnored(a.env);
  if (!ig.ok) { log(`${ig.why} — run master Setup step 6 (the managed .gitignore block) first; nothing POSTed, nothing written (exit 2)`); return summary('-', '-', '-', 2); }
  const admin = `Bearer ${tok.value}`;
  const cfgBase = `${a.adminBase}/config/${a.org}/sites/${a.site}`;

  // 2 config service present?
  const cfg = await http('GET', `${cfgBase}.json`, { auth: admin });
  if (cfg.status === 404) { log(`config not enabled for ${a.org}/${a.site} (GET ${cfgBase}.json → 404) — enable the config service for the site, then re-run: node skills/deploy/scripts/lockdown.mjs --org ${a.org} --repo ${a.repo}${a.site !== a.repo ? ` --site ${a.site}` : ''} (no config is ever guessed; exit 2)`); return summary('-', 'no-config', '-', 2); }
  if (cfg.status === 401 || cfg.status === 403) { log(`config service answers ${cfg.status} for ${a.org}/${a.site} — ${a.tokenEnv} (source: ${tok.source}) is rejected or lacks admin rights on the site; refresh it or ask the owner to grant config access (exit 2)`); return summary('-', 'denied', '-', 2); }
  if (cfg.status < 200 || cfg.status >= 300) { log(`config service ${cfg.status || `unreachable (${cfg.note})`} — no verdict, re-run (exit 2)`); return summary('-', 'unreachable', '-', 2); }
  log(`config: ${a.org}/${a.site} present`);

  // 3 repo half — a denial never stops the site half
  const repo = await repoPrivate(a, log);

  // 4 site token
  const sec = await http('POST', `${cfgBase}/secrets.json`, { auth: admin, json: {} });
  const secretId = sec.data?.id ?? sec.data?.secretId ?? sec.data?.name ?? null;
  const secretValue = sec.data?.token ?? sec.data?.secret ?? sec.data?.value ?? null;
  if (sec.status < 200 || sec.status >= 300 || !secretId || !secretValue) { log(`secrets.json POST → ${sec.status || sec.note}${sec.data ? ` (keys: ${Object.keys(sec.data).join(', ') || 'none'})` : ''} — no site token returned; nothing written (exit 2)`); return summary(repo.repo, 'no-secret', '-', 2, repo.owner); }
  log(`secret: created (id ${secretId})`);

  // 5 access/site.json merge — allow union, secretId appended
  const allow = a.allow || defaultAllow();
  if (!allow.length) { log(`allow list empty — pass --allow *@<domain> (git config user.email has no domain); the secret ${secretId} exists but access/site.json is unchanged (exit 2)`); return summary(repo.repo, 'no-allow', '-', 2, repo.owner); }
  const cur = await http('GET', `${cfgBase}/access/site.json`, { auth: admin });
  const merged = mergeAccess(cur.status === 200 ? cur.data : {}, allow, secretId);
  const put = await http('POST', `${cfgBase}/access/site.json`, { auth: admin, json: merged });
  if (put.status < 200 || put.status >= 300) { log(`access/site.json POST → ${put.status || put.note} — site auth not applied (exit 2)`); return summary(repo.repo, 'access-failed', '-', 2, repo.owner); }
  log(`access: allow ${merged.allow.join(', ')} · secretId ${merged.secretId.length} entr${merged.secretId.length === 1 ? 'y' : 'ies'} (protects .aem.page and .aem.live)`);

  // 6 token by name
  const how = writeEnvVar(a.env, a.siteTokenEnv, secretValue);
  log(`token: ${a.siteTokenEnv} ${how} in ${a.env} (value never printed)`);
  if (existsSync(a.state)) {
    try { const st = JSON.parse(readFileSync(a.state, 'utf8')); st.credentials = { ...(st.credentials || {}), siteTokenEnv: a.siteTokenEnv }; writeFileSync(a.state, `${JSON.stringify(st, null, 2)}\n`); log(`state: credentials.siteTokenEnv → ${a.state}`); } catch (e) { log(`state: ${a.state} is not valid JSON (${e.message}) — credentials.siteTokenEnv not recorded; fix it by hand`); }
  } else log(`state: ${a.state} absent — not created (the master's Setup writes it); record credentials.siteTokenEnv=${a.siteTokenEnv} there`);

  // 7 verify both hosts, capped
  const v = await verifyHosts(a, secretValue, log);
  out.hosts = v.hosts;
  if (!v.ok) { log(`verification failed after ${a.wait}s — the lock is not proven on both hosts; re-run the same command, do not hand off (exit 1)`); return summary(repo.repo, 'applied', 'failed', 1, repo.owner); }
  if (repo.owner) { log(`site locked and verified; the repo half needs the owner (exit 3)`); return summary(repo.repo, 'locked', 'ok', 3, repo.owner); }
  log(`locked and verified — later delivery-host reads take --token-env ${a.siteTokenEnv} (site-token-env on the driver)`);
  return summary(repo.repo, 'locked', 'ok', 0);
}

// ---- inventory -----------------------------------------------------------------

async function listRepos(a) {
  if (a.ghMode === 'rest') {
    const pat = resolveToken('GH_PAT');
    if (!pat) return { error: 'GH_PAT missing for --gh-mode rest' };
    const rows = [];
    for (const kind of ['orgs', 'users']) {
      for (let page = 1; page < 50; page += 1) {
        const r = await http('GET', `${GH_API}/${kind}/${a.org}/repos?per_page=100&page=${page}`, { auth: `token ${pat.value}` });
        if (r.status !== 200 || !Array.isArray(r.data)) break;
        rows.push(...r.data); if (r.data.length < 100) break;
      }
      if (rows.length) break;
    }
    return { rows };
  }
  let r = gh(['api', `orgs/${a.org}/repos`, '--paginate', '--jq', '.[] | {name, visibility, pushed_at}']);
  if (!r.ok) r = gh(['api', `users/${a.org}/repos`, '--paginate', '--jq', '.[] | {name, visibility, pushed_at}']);
  if (!r.ok) return { error: `gh api …/${a.org}/repos: ${r.note}` };
  return { rows: r.out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) };
}

async function inventory(a) {
  const { rows, error } = await listRepos(a);
  if (error) { console.error(`lockdown --inventory: ${error} (exit 2)`); return 2; }
  const header = ['repo', 'visibility', 'last push', 'served', 'page', 'live', 'site auth', 'class'];
  const lines = [];
  for (const repo of rows.filter((x) => !a.prefix || String(x.name).startsWith(a.prefix))) {
    const ctx = { org: a.org, site: repo.name, branch: a.branch };
    const served = await http('GET', `${deliveryHost('page', ctx)}/scripts/aem.js`);
    const page = await http('GET', `${deliveryHost('page', ctx)}/`);
    const live = await http('GET', `${deliveryHost('live', ctx)}/`);
    const auth = (page.status === 401 || page.status === 403) ? 'on' : 'off';
    const isServed = served.status === 200 || ((served.status === 401 || served.status === 403) && auth === 'on');
    const cls = !isServed ? 'unserved' : auth === 'on' ? 'locked' : 'public-served';
    lines.push({ repo: repo.name, visibility: repo.visibility || (repo.private ? 'private' : 'public'), 'last push': (repo.pushed_at || '').slice(0, 10), served: isServed ? 'yes' : String(served.status || '000'), page: String(page.status || '000'), live: String(live.status || '000'), 'site auth': auth, class: cls });
  }
  if (a.json) console.log(JSON.stringify(lines, null, 2));
  else { console.log(header.join('\t')); for (const l of lines) console.log(header.map((h) => l[h]).join('\t')); }
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  let a;
  try { a = parseArgs(argv); } catch (e) { console.error(`lockdown: ${e.message}`); usage(); return 2; }
  if (a.help) { usage(); return 0; }
  return a.inventory ? inventory(a) : lock(a);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main().then((code) => process.exit(code)).catch((e) => { console.error(`lockdown: ${e.message}`); process.exit(2); });
