#!/usr/bin/env node
/**
 * skills/stardust/scripts/impeccable-version-check.mjs — "is a newer impeccable available?"
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
 * Sources, in order of authority for "latest":
 *   1. upstream — the marketplace's git repo `.claude-plugin/plugin.json` on
 *      HEAD (one fetch, 6s timeout; skipped with --offline or when it fails)
 *   2. cached catalog — ~/.claude/plugins/marketplaces/<mkt>/.claude-plugin/marketplace.json
 * "installed", every copy found:
 *   - Claude Code: ~/.claude/plugins/installed_plugins.json → plugins["impeccable@<mkt>"]
 *     (user scope preferred). Update: claude plugin marketplace update … && claude plugin update …
 *   - GitHub Copilot: ~/.copilot/installed-plugins/<marketplace>/impeccable/.claude-plugin/plugin.json
 *     and ~/.copilot/installed-plugins/_direct/<dir containing "impeccable">/.claude-plugin/plugin.json (Copilot
 *     keeps no version registry; the installed directory's own manifest is the only source).
 *     Update: copilot plugin update impeccable
 *   - --local <dir> for a skills-directory install (reads <dir>/.claude-plugin/plugin.json or
 *     <dir>/package.json). Update hint: reinstall through the installer that put it there.
 *
 * Usage:
 *   node skills/stardust/scripts/impeccable-version-check.mjs [--marketplace impeccable]
 *        [--local <impeccable-dir>] [--offline] [--json]
 *   node skills/stardust/scripts/impeccable-version-check.mjs --where [--local <impeccable-dir>]
 *
 * Output (text): one line per installed copy —
 *   "impeccable 4.1.3 installed (Claude Code) — 4.2.2 available: claude plugin marketplace update impeccable && claude plugin update impeccable@impeccable"
 *   "impeccable 4.2.2 installed (GitHub Copilot) — current"
 *   "impeccable version check skipped (<reason>)"
 * Exit code: always 0.
 *
 * --where prints impeccable's skill directory (the one holding SKILL.md and reference/) for the
 * first installed copy found, from the same registries, with no network call — later phases read
 * impeccable's format specs (reference/init.md, reference/document.md) from there by section. A
 * recorded session searched the whole filesystem for them twice. Exit 0 with the path on stdout;
 * exit 1 and a stderr line when no copy is found.
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import os from 'os';

// --help prints this file's usage header, so an agent never reads the source to learn the flags.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const header = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
  process.exit(0);
}

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const MKT = opt('marketplace', 'impeccable');
const PLUGIN = 'impeccable';
const LOCAL = opt('local');
const OFFLINE = args.includes('--offline');
const JSON_OUT = args.includes('--json');
const WHERE = args.includes('--where');
const HOME = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const COPILOT_HOME = process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
// The skill directory inside a plugin root (or the directory itself when it already is the skill).
const skillDir = (root) => (existsSync(path.join(root, 'SKILL.md')) ? root : path.join(root, 'skills', PLUGIN));
const semver = (v) => { const m = String(v || '').match(/^v?(\d+)\.(\d+)\.(\d+)/); return m ? m.slice(1, 4).map(Number) : null; };
const cmp = (a, b) => { const x = semver(a); const y = semver(b); if (!x || !y) return null; for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

function installedCopies() {
  const copies = [];
  if (LOCAL) {
    const pj = readJson(path.join(LOCAL, '.claude-plugin', 'plugin.json')) || readJson(path.join(LOCAL, 'package.json'));
    copies.push({ version: pj?.version || null, dir: skillDir(LOCAL), from: `local ${LOCAL}`, harness: 'skills directory', update: `reinstall impeccable through the installer that placed it at ${LOCAL}` });
    return copies;
  }
  const reg = readJson(path.join(HOME, 'plugins', 'installed_plugins.json'));
  const entry = reg?.plugins?.[`${PLUGIN}@${MKT}`];
  if (entry) {
    const list = Array.isArray(entry) ? entry : [entry];
    const pick = list.find((e) => e.scope === 'user') || list[0];
    if (pick?.version) copies.push({ version: pick.version, dir: pick.installPath ? skillDir(pick.installPath) : null, from: 'installed_plugins.json', harness: 'Claude Code', update: `claude plugin marketplace update ${MKT} && claude plugin update ${PLUGIN}@${MKT}` });
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
    const pj = readJson(path.join(d, '.claude-plugin', 'plugin.json')) || readJson(path.join(d, 'plugin.json'));
    if (pj?.version) copies.push({ version: pj.version, dir: skillDir(d), from: d, harness: 'GitHub Copilot', update: `copilot plugin update ${PLUGIN}` });
  }
  return copies;
}

if (WHERE) {
  const hit = installedCopies().find((c) => c.dir && existsSync(path.join(c.dir, 'SKILL.md')));
  if (!hit) { console.error(`impeccable skill directory not found (${PLUGIN}@${MKT} in Claude Code, ~/.copilot/installed-plugins${LOCAL ? `, --local ${LOCAL}` : ''})`); process.exit(1); }
  console.log(hit.dir);
  process.exit(0);
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

const copies = installedCopies().filter((c) => c.version); // a --local dir without a manifest can be located but not version-checked
const { cached, repo } = marketplaceInfo();
const upstream = await upstreamVersion(repo);
const latest = upstream || cached;

const results = [];
if (!copies.length) {
  results.push({ status: 'not-installed', line: `impeccable not found in any plugin registry (${PLUGIN}@${MKT} in Claude Code, ~/.copilot/installed-plugins)${LOCAL ? '' : ' — pass --local <dir> for a skills-directory install'}` });
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

const first = results[0];
if (JSON_OUT) console.log(JSON.stringify({ status: first.status, installed: first.version || null, installedFrom: first.from || null, installs: results.map(({ line, ...r }) => r), cachedCatalog: cached, upstream, latest, marketplace: MKT, repo, updateCommand: first.status === 'outdated' ? first.update : null }));
else for (const r of results) console.log(r.line);
process.exit(0);
