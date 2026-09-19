#!/usr/bin/env node
/**
 * skills/stardust/scripts/impeccable-version-check.mjs — "is a newer impeccable
 * available, and where does the installed one actually live?"
 *
 * Stardust depends on impeccable WITHOUT pinning a version (plugin.json declares
 * the dependency with no range on purpose: impeccable's design craft should
 * always be the current one). Harnesses do not announce third-party plugin
 * updates by default (Claude Code's marketplace auto-update is off for
 * third-party marketplaces such as impeccable's; GitHub Copilot has no update
 * notice at all) — so a user can sit on an old impeccable indefinitely with no
 * signal. This check runs in stardust's Setup step 1 and prints ONE hint line
 * per installed copy when a newer impeccable exists. It is advisory: it never
 * blocks a run, always exits 0, and fails silently (status "unknown") when
 * anything it reads is missing — the registry/cache paths it consults are
 * harness implementation details, not a documented API.
 *
 * Probe (default on; --no-probe to skip): impeccable renames files between
 * releases (the 4.1 → 4.3 launcher swap moved `context.mjs`/`hook-admin.mjs`
 * behind `scripts/impeccable`), and every stale path a stardust doc carried
 * cost a session 2–3 rediscovery calls (`ls scripts/`, `find … -name`, retry).
 * The probe resolves the installed SKILL DIRECTORY once, checks the four
 * load-bearing entries Setup and the sub-skills depend on, prints one line
 *   "impeccable 4.3.1 at <skillDir> — launcher scripts/impeccable, 23 commands, 0 drift"
 * plus one "drift: <path> missing" line per miss, and with --state merges
 *   state.json#impeccable = { skillDir, launcher, version, registryCommands, probedAt, drift }
 * so sub-skills read the path instead of locating impeccable again
 * (replica/reskin `impeccable-ignores.mjs` reads `impeccable.skillDir` first).
 * `launcher` is "scripts/impeccable" (4.3+), "scripts/hook-admin.mjs" (older
 * installs) or null. Only that key is touched; other state keys are preserved;
 * an unparsable state file is never overwritten.
 *
 * Sources, in order of authority for "latest":
 *   1. upstream — the marketplace's git repo `.claude-plugin/plugin.json` on
 *      HEAD (one fetch, 6s timeout; skipped with --offline or when it fails)
 *   2. cached catalog — ~/.claude/plugins/marketplaces/<mkt>/.claude-plugin/marketplace.json
 * "installed", every copy found:
 *   - Claude Code: ~/.claude/plugins/installed_plugins.json → plugins["impeccable@<mkt>"]
 *     (user scope preferred; skillDir = <installPath>/skills/impeccable).
 *     Update: claude plugin marketplace update … && claude plugin update …
 *   - GitHub Copilot: ~/.copilot/installed-plugins/<marketplace>/impeccable/.claude-plugin/plugin.json
 *     and ~/.copilot/installed-plugins/_direct/<dir containing "impeccable">/.claude-plugin/plugin.json (Copilot
 *     keeps no version registry; the installed directory's own manifest is the only source).
 *     Update: copilot plugin update impeccable
 *   - project skill directories: ./.claude/skills/impeccable, ./.agents/skills/impeccable,
 *     ./.cursor/skills/impeccable, ./.github/skills/impeccable (version from the dir's own manifest).
 *   - --local <dir> for a skills-directory install (reads <dir>/.claude-plugin/plugin.json or
 *     <dir>/package.json; skillDir = <dir>/skills/impeccable when present, else <dir>).
 *     Update hint: reinstall through the installer that put it there.
 *
 * Usage:
 *   node skills/stardust/scripts/impeccable-version-check.mjs [--marketplace impeccable]
 *        [--local <impeccable-dir>] [--offline] [--probe | --no-probe]
 *        [--state stardust/state.json] [--json] [--help]
 *
 * Output (text): one line per installed copy —
 *   "impeccable 4.1.3 installed (Claude Code) — 4.2.2 available: claude plugin marketplace update impeccable && claude plugin update impeccable@impeccable"
 *   "impeccable 4.2.2 installed (GitHub Copilot) — current"
 *   "impeccable version check skipped (<reason>)"
 * then, per probed copy, the probe line and its drift lines (see above).
 * --json adds skillDir, launcher, registryCommands, drift per install and for the first copy.
 * Exit code: always 0 (advisory; a drift line is information, not a failure).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import os from 'os';

const HELP = `usage: node impeccable-version-check.mjs [--marketplace <name>] [--local <dir>] [--offline]
                                         [--probe | --no-probe] [--state <state.json>] [--json]

Prints one advisory line per installed impeccable copy (newer version available / current /
unknown), then a probe line "impeccable <v> at <skillDir> — launcher <x>, <n> commands, <k> drift"
and one "drift: <path> missing" line per load-bearing file the install lacks.
  --local <dir>     a skills-directory install (plugin root or the skill dir itself)
  --offline         skip the upstream fetch; compare against the cached catalog only
  --no-probe        version lines only (--probe is the default)
  --state <file>    merge the probe into <file>#impeccable (other keys preserved;
                    an unparsable file is left untouched)
  --json            machine-readable output
Exit code: always 0.`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) { console.log(HELP); process.exit(0); }
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const MKT = opt('marketplace', 'impeccable');
const PLUGIN = 'impeccable';
const LOCAL = opt('local');
const OFFLINE = args.includes('--offline');
const JSON_OUT = args.includes('--json');
const PROBE = args.includes('--probe') || !args.includes('--no-probe');
const STATE = opt('state');
const HOME = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const COPILOT_HOME = process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const semver = (v) => { const m = String(v || '').match(/^v?(\d+)\.(\d+)\.(\d+)/); return m ? m.slice(1, 4).map(Number) : null; };
const cmp = (a, b) => { const x = semver(a); const y = semver(b); if (!x || !y) return null; for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
// plugin root → the skill directory (impeccable ships one skill at skills/impeccable)
const skillDirOf = (root) => { const s = path.join(root, 'skills', PLUGIN); return existsSync(s) ? s : root; };
const manifest = (dir) => readJson(path.join(dir, '.claude-plugin', 'plugin.json')) || readJson(path.join(dir, 'package.json')) || readJson(path.join(dir, 'plugin.json'));

function installedCopies() {
  const copies = [];
  if (LOCAL) {
    const pj = manifest(LOCAL);
    if (pj?.version) copies.push({ version: pj.version, from: `local ${LOCAL}`, harness: 'skills directory', skillDir: path.resolve(skillDirOf(LOCAL)), update: `reinstall impeccable through the installer that placed it at ${LOCAL}` });
    return copies;
  }
  const reg = readJson(path.join(HOME, 'plugins', 'installed_plugins.json'));
  const entry = reg?.plugins?.[`${PLUGIN}@${MKT}`];
  if (entry) {
    const list = Array.isArray(entry) ? entry : [entry];
    const pick = list.find((e) => e.scope === 'user') || list[0];
    if (pick?.version) copies.push({ version: pick.version, from: 'installed_plugins.json', harness: 'Claude Code', skillDir: pick.installPath ? skillDirOf(pick.installPath) : null, update: `claude plugin marketplace update ${MKT} && claude plugin update ${PLUGIN}@${MKT}` });
  }
  const root = path.join(COPILOT_HOME, 'installed-plugins');
  const dirs = [];
  try {
    for (const mkt of readdirSync(root)) {
      if (mkt === '_direct') { try { for (const d of readdirSync(path.join(root, '_direct'))) if (d.includes(PLUGIN)) dirs.push(path.join(root, '_direct', d)); } catch {} }
      else dirs.push(path.join(root, mkt, PLUGIN));
    }
  } catch {}
  for (const d of dirs) {
    const pj = manifest(d);
    if (pj?.version) copies.push({ version: pj.version, from: d, harness: 'GitHub Copilot', skillDir: skillDirOf(d), update: `copilot plugin update ${PLUGIN}` });
  }
  for (const d of ['.claude', '.agents', '.cursor', '.github'].map((h) => path.join(process.cwd(), h, 'skills', PLUGIN))) {
    if (!existsSync(path.join(d, 'scripts'))) continue;
    const pj = manifest(d) || manifest(path.join(d, '..', '..'));
    copies.push({ version: pj?.version || 'unknown', from: d, harness: 'project skills directory', skillDir: d, update: `reinstall impeccable through the installer that placed it at ${d}` });
  }
  return copies;
}

// The four load-bearing entries Setup and the sub-skills depend on. Anything
// else a doc cites is the lint's job (evals/lint/script-paths.mjs --installed).
function probe(skillDir) {
  if (!skillDir || !existsSync(skillDir)) return { skillDir, launcher: null, registryCommands: null, drift: [`${skillDir || '<skill dir>'} missing`] };
  const has = (rel) => existsSync(path.join(skillDir, rel));
  const drift = [];
  const launcher = has('scripts/impeccable') ? 'scripts/impeccable' : has('scripts/hook-admin.mjs') ? 'scripts/hook-admin.mjs' : null;
  if (!launcher) drift.push('scripts/impeccable missing (no legacy scripts/hook-admin.mjs either)');
  const reg = readJson(path.join(skillDir, 'scripts', 'command-metadata.json'));
  const registryCommands = reg && typeof reg === 'object' && !Array.isArray(reg) ? Object.keys(reg).length : null;
  if (registryCommands === null) drift.push('scripts/command-metadata.json missing');
  for (const rel of ['reference/init.md', 'reference/document.md']) if (!has(rel)) drift.push(`${rel} missing`);
  return { skillDir, launcher, registryCommands, drift };
}

function writeState(file, inst) {
  let cur = {};
  if (existsSync(file)) { cur = readJson(file); if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return `state not written (${file} is not a JSON object)`; }
  cur.impeccable = { skillDir: inst.skillDir, launcher: inst.launcher, version: inst.version, registryCommands: inst.registryCommands, probedAt: new Date().toISOString(), drift: inst.drift };
  try { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(cur, null, 2)}\n`); return null; } catch (e) { return `state not written (${e.message})`; }
}

function marketplaceInfo() {
  const known = readJson(path.join(HOME, 'plugins', 'known_marketplaces.json'));
  const m = known?.[MKT];
  if (!m) return { cached: null, repo: null };
  const catalog = readJson(path.join(m.installLocation || '', '.claude-plugin', 'marketplace.json'));
  const cached = catalog?.plugins?.find((p) => p.name === PLUGIN)?.version || null;
  const repo = m.source?.source === 'github' ? m.source.repo : null;
  return { cached, repo };
}

async function upstreamVersion(repo) {
  if (!repo || OFFLINE || typeof fetch !== 'function') return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/.claude-plugin/plugin.json`, { signal: ctl.signal });
    if (!res.ok) return null;
    return (await res.json())?.version || null;
  } catch { return null; } finally { clearTimeout(t); }
}

const copies = installedCopies();
const { cached, repo } = marketplaceInfo();
const upstream = await upstreamVersion(repo);
const latest = upstream || cached;

const results = [];
if (!copies.length) {
  results.push({ status: 'not-installed', line: `impeccable not found in any plugin registry (${PLUGIN}@${MKT} in Claude Code, ~/.copilot/installed-plugins, project skills directories)${LOCAL ? '' : ' — pass --local <dir> for a skills-directory install'}` });
}
for (const inst of copies) {
  const who = `impeccable ${inst.version} installed (${inst.harness})`;
  if (!latest) results.push({ ...inst, status: 'unknown', line: `${who} — version check skipped (no marketplace catalog or upstream reachable)` });
  else {
    const c = cmp(latest, inst.version);
    if (c === null) results.push({ ...inst, status: 'unknown', line: `${who} — cannot compare with "${latest}"` });
    else if (c > 0) results.push({ ...inst, status: 'outdated', line: `${who} — ${latest} available${upstream ? '' : ' (per cached catalog)'}: ${inst.update}` });
    else results.push({ ...inst, status: 'current', line: `${who} — current${upstream ? '' : ' (per cached catalog; upstream not checked)'}` });
  }
}

const probeLines = [];
if (PROBE) {
  for (const r of results) {
    if (r.status === 'not-installed') continue;
    Object.assign(r, probe(r.skillDir));
    probeLines.push(`impeccable ${r.version} at ${r.skillDir} — ${r.launcher ? `launcher ${r.launcher}` : 'no launcher'}, ${r.registryCommands ?? 0} commands, ${r.drift.length} drift`);
    for (const d of r.drift) probeLines.push(`drift: ${d}`);
  }
  const first = results.find((r) => r.status !== 'not-installed');
  if (STATE && first) { const err = writeState(STATE, first); if (err) probeLines.push(err); }
}

const first = results[0];
if (JSON_OUT) console.log(JSON.stringify({ status: first.status, installed: first.version || null, installedFrom: first.from || null, skillDir: first.skillDir || null, launcher: first.launcher ?? null, registryCommands: first.registryCommands ?? null, drift: first.drift || [], installs: results.map(({ line, ...r }) => r), cachedCatalog: cached, upstream, latest, marketplace: MKT, repo, updateCommand: first.status === 'outdated' ? first.update : null, state: STATE || null }));
else for (const l of [...results.map((r) => r.line), ...probeLines]) console.log(l);
process.exit(0);
