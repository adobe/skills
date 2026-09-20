#!/usr/bin/env node
/**
 * skills/deploy/scripts/da-token-check.mjs — the standalone form of the driver's
 * token preflight: resolve `DA_TOKEN` by NAME, decode its IMS expiry, make ONE
 * authenticated DA list call, print the remaining hours and the source CLASS.
 * The instrument behind the master's Setup step 8 (`state-machine.md` § Credentials
 * key) and the lifecycle rule (`da-deploy-protocol.md` § DA_TOKEN lifecycle): a run
 * never declares a 401 blocker, and never hand-decodes a token, before this ran.
 *
 *   node skills/deploy/scripts/da-token-check.mjs [--token-env DA_TOKEN] [--org <org> --repo <repo>]
 *        [--need <hours>] [--no-smoke] [--json]
 *   node skills/deploy/scripts/da-token-check.mjs --credentials --site <slug> [--state stardust/state.json]
 *        [--gh] [--org --repo] [--json]
 *
 *   --token-env NAME  env name of the DA (IMS) token — default DA_TOKEN. Resolved shell →
 *                     ./.env → ~/.claude/.env → ~/.env (lib.mjs resolveToken); the CLASS is
 *                     printed (shell | repo-env | global-env | home-env), never the value.
 *   --org/--repo      enable the smoke: ONE `GET admin.da.live/list/<org>/<repo>/` (skipped
 *                     when the decode already proves expiry, or without both flags). 200 usable;
 *                     401 rejected; 403 no access; 404 the org/repo is not visible to this identity
 *                     (wrong coordinates or no site yet — reference/site-bootstrap.md) — exit 2 each.
 *   --need <h>        the batch ahead needs this many hours — fewer remaining is exit 2.
 *   --no-smoke        decode only (offline switch — not an override; expiry still exits 2).
 *   --credentials     emit the Credentials block {at, da, daExpiresAt, daSource, daTarget, siteTokenEnv, gh};
 *                     `da` is ok | expired | missing | unreachable (the smoke gave no verdict);
 *                     `daTarget` is what the ONE list call said about --org/--repo — ok (200) |
 *                     not-visible (404: wrong coordinates or no site yet → site-bootstrap.md) |
 *                     denied (401/403) | unchecked (no smoke) — so state.json shows WHY Setup step 8
 *                     refused when the token itself is fine. Merged into --state's `credentials`
 *                     key (state.json is tracked: names, statuses and source classes only).
 *   --site <slug>     slug for the SITE_TOKEN_<SLUG> match — exact after normalisation
 *                     (uppercase, non-alphanumerics → `_`), never a prefix; default: --repo.
 *   --state <path>    state file to merge into (default stardust/state.json; an absent file is
 *                     reported, never created — the master's Setup writes it).
 *   --gh              probe GH_PAT (`GET api.github.com/user`, `Authorization: token`) even when
 *                     the variable is absent; default: probed iff GH_PAT resolves, else `skipped`.
 *   --json            print the result object instead of the one-line verdict.
 *
 * Exit codes (never conflated — the exit-124 "no verdict" convention has an exit-1 sibling here):
 *   0  token usable (and remaining ≥ --need when given); unknown expiry with no smoke possible
 *      is 0 with a WARN — advisory fails to unknown, blocking only when it PROVES expiry
 *   2  DA token missing, expired by decode, smoke 401/403/404 (target not usable), or remaining < --need
 *   1  smoke unreachable (network / 5xx — no verdict, `da: unreachable`) or usage error
 * No dependencies (Node 18+). Test hooks: DEPLOY_BATCH_DA_LIST (list host), DA_TOKEN_CHECK_GH_API
 * (GitHub API base). Talks to admin.da.live and api.github.com only — never the source site.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { daSmoke, resolveToken, siteTokenName, siteTokenNamesIn, tokenExpiry } from './lib.mjs';

const GH_API = process.env.DA_TOKEN_CHECK_GH_API || 'https://api.github.com';
const FILE_BY_CLASS = { shell: 'the shell environment', 'repo-env': './.env', 'global-env': '~/.claude/.env', 'home-env': '~/.env' };

function usage() {
  console.log('usage: node skills/deploy/scripts/da-token-check.mjs [--token-env DA_TOKEN] [--org <org> --repo <repo>] [--need <hours>] [--no-smoke] [--json]\n'
    + '       node skills/deploy/scripts/da-token-check.mjs --credentials --site <slug> [--state stardust/state.json] [--gh] [--org <org> --repo <repo>] [--json]\n'
    + '  exit 0 usable · 2 missing / expired / 401 / 403 / 404 / under --need · 1 unreachable (no verdict) or usage');
}

export function parseArgs(argv) {
  const a = { tokenEnv: 'DA_TOKEN', smoke: true, credentials: false, gh: false, json: false, state: 'stardust/state.json', need: null };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const next = () => { const v = argv[i + 1]; if (v === undefined || /^--/.test(v)) throw new Error(`${k} needs a value`); i += 1; return v; };
    if (k === '--token-env') a.tokenEnv = next();
    else if (k === '--org') a.org = next();
    else if (k === '--repo') a.repo = next();
    else if (k === '--site') a.site = next();
    else if (k === '--state') a.state = next();
    else if (k === '--need') { a.need = Number(next()); if (!Number.isFinite(a.need) || a.need < 0) throw new Error('--need takes hours (a number ≥ 0)'); }
    else if (k === '--no-smoke') a.smoke = false;
    else if (k === '--credentials') a.credentials = true;
    else if (k === '--gh') a.gh = true;
    else if (k === '--json') a.json = true;
    else if (k === '--help' || k === '-h') { usage(); process.exit(0); }
    else throw new Error(`unknown arg: ${k}`);
  }
  if ((a.org && !a.repo) || (!a.org && a.repo)) throw new Error('--org and --repo go together');
  if (a.credentials && !a.site && !a.repo) throw new Error('--credentials needs --site <slug> (or --repo)');
  return a;
}

const hours = (sec) => (sec / 3600).toFixed(1);
const fmtH = (h) => Number(h).toFixed(1);

/** GH_PAT probe: 200 ok · 401 expired · network unreachable. The token is sent, never printed. */
async function probeGh(pat) {
  try {
    const res = await fetch(`${GH_API}/user`, { headers: { Authorization: `token ${pat}`, 'User-Agent': 'stardust-da-token-check' } });
    if (res.status === 200) return 'ok';
    if (res.status === 401) return 'expired';
    return `unreachable (HTTP ${res.status})`;
  } catch { return 'unreachable'; }
}

export async function check(a, { cwd = process.cwd(), home, env } = {}) {
  const opts = { cwd, ...(home ? { home } : {}), ...(env ? { env } : {}) };
  const out = { tokenEnv: a.tokenEnv, da: 'missing', daSource: null, daExpiresAt: null, remainingH: null, smoke: 'skipped', exit: 2, lines: [] };
  const tok = resolveToken(a.tokenEnv, opts);
  if (!tok) {
    out.lines.push(`${a.tokenEnv}: missing — looked in the shell, ./.env, ~/.claude/.env, ~/.env. Put it in ./.env (gitignored) or ~/.claude/.env (log in at https://da.live) and re-run the same command`);
    return out;
  }
  out.daSource = tok.source;
  const exp = tokenExpiry(tok.value);
  const now = Date.now() / 1000;
  const where = FILE_BY_CLASS[tok.source];
  if (exp !== null) {
    out.daExpiresAt = new Date(exp * 1000).toISOString();
    out.remainingH = Number(hours(exp - now));
    if (exp <= now) {
      out.da = 'expired';
      out.lines.push(`${a.tokenEnv}: expired ${hours(now - exp)}h ago (source: ${tok.source}) — refresh it in ${where} (log in at https://da.live) and re-run the same command`);
      return out; // decode proves expiry: no smoke, no request
    }
  } else {
    out.lines.push(`WARN ${a.tokenEnv}: expiry unknown (no created_at/expires_in or exp claim) — ${a.smoke && a.org ? 'the smoke decides' : 'a mid-batch 401 would halt the driver (exit 3)'}`);
  }
  // ONE authenticated list call — the smoke; skipped offline or without a target
  if (a.smoke && a.org && a.repo) {
    const status = await daSmoke(tok.value, a.org, a.repo);
    out.smoke = status;
    if (status === 401) {
      out.da = 'expired';
      out.lines.push(`${a.tokenEnv}: rejected (list 401; source: ${tok.source}) — refresh it in ${where} (log in at https://da.live) and re-run the same command`);
      return out;
    }
    if (status === 403) {
      out.da = 'expired';
      out.lines.push(`${a.tokenEnv}: accepted but ${a.org}/${a.repo} answers 403 (source: ${tok.source}) — this identity has no access to that DA org/repo; ask the owner to grant it`);
      return out;
    }
    if (status === 404) {
      out.da = 'ok';
      out.lines.push(`${a.tokenEnv}: valid${out.remainingH === null ? '' : ` ~${fmtH(out.remainingH)}h`} (source: ${tok.source}) but ${a.org}/${a.repo} answers 404 — the DA org/repo is not visible to this identity: check the coordinates (decisions.md row \`target\`), or the site does not exist yet (skills/deploy/reference/site-bootstrap.md); not usable against this target`);
      return out; // exit 2: the token is fine, the target is not
    }
    if (status === 0 || status >= 500) {
      out.da = 'unreachable';
      out.exit = 1;
      out.lines.push(`${a.tokenEnv}: valid${out.remainingH === null ? '' : ` ~${fmtH(out.remainingH)}h`} (source: ${tok.source}) · list: ${status || '000'} — no verdict from admin.da.live (network / 5xx); re-run`);
      return out;
    }
  }
  out.da = 'ok';
  out.exit = 0;
  if (a.need !== null && out.remainingH !== null && out.remainingH < a.need) {
    out.exit = 2;
    out.lines.push(`${a.tokenEnv}: valid ~${fmtH(out.remainingH)}h but the batch needs ${a.need}h (source: ${tok.source}) — refresh it in ${where} first, or narrow the batch`);
    return out;
  }
  out.lines.push(`${a.tokenEnv}: valid${out.remainingH === null ? ' (expiry unknown)' : ` ~${fmtH(out.remainingH)}h`} (source: ${tok.source}${where && tok.source !== 'shell' ? `, ${where}` : ''})${out.smoke !== 'skipped' ? ` · list: ${out.smoke}` : ''}`);
  return out;
}

/** The master's Credentials key from a check() result + the site-token and GH probes. */
export async function credentialsBlock(a, r, { cwd = process.cwd(), home, env } = {}) {
  const opts = { cwd, ...(home ? { home } : {}), ...(env ? { env } : {}) };
  const want = siteTokenName(a.site || a.repo);
  const names = siteTokenNamesIn(opts);
  const siteTokenEnv = names.includes(want) ? want : null;
  const pat = resolveToken('GH_PAT', opts);
  let gh = 'skipped';
  if (pat) gh = await probeGh(pat.value);
  else if (a.gh) gh = 'missing';
  const daTarget = r.smoke === 'skipped' ? 'unchecked' : r.smoke === 200 ? 'ok' : r.smoke === 404 ? 'not-visible' : (r.smoke === 401 || r.smoke === 403) ? 'denied' : 'unchecked';
  return { at: new Date().toISOString(), da: r.da, daExpiresAt: r.daExpiresAt, daSource: r.daSource, daTarget, siteTokenEnv, gh, ...(siteTokenEnv ? {} : { siteTokenWanted: want }) };
}

export function mergeState(file, block) {
  if (!existsSync(file)) return { written: false, why: `${file} absent — not created (the master's Setup writes it); block printed only` };
  let state;
  try { state = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { written: false, why: `${file} is not valid JSON (${e.message}) — fix it; block printed only` }; }
  const { siteTokenWanted, ...cred } = block; // the schema block only — the hint stays on stdout
  state.credentials = cred;
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  return { written: true };
}

export async function main(argv = process.argv.slice(2)) {
  let a;
  try { a = parseArgs(argv); } catch (e) { console.error(`da-token-check: ${e.message}`); usage(); return 1; }
  const r = await check(a);
  let block = null;
  let merge = null;
  if (a.credentials) {
    block = await credentialsBlock(a, r);
    merge = mergeState(a.state, block);
  }
  if (a.json) console.log(JSON.stringify({ ...r, lines: undefined, credentials: block, state: merge }, null, 2));
  else {
    for (const l of r.lines) console.log(l);
    if (block) {
      console.log(`credentials: da=${block.da} daSource=${block.daSource} daExpiresAt=${block.daExpiresAt || '-'} daTarget=${block.daTarget} siteTokenEnv=${block.siteTokenEnv || `none (looked for ${block.siteTokenWanted})`} gh=${block.gh}`);
      console.log(merge.written ? `credentials → ${a.state}` : `credentials: ${merge.why}`);
    }
  }
  return r.exit;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main().then((code) => process.exit(code)).catch((e) => { console.error(`da-token-check: ${e.message}`); process.exit(1); });
