#!/usr/bin/env node
/**
 * skills/stardust/scripts/impeccable-version-check.mjs — "is a newer impeccable available?"
 *
 * Stardust depends on impeccable WITHOUT pinning a version (plugin.json declares
 * the dependency with no range on purpose: impeccable's design craft should
 * always be the current one). Claude Code only announces plugin updates through
 * marketplace auto-update, which is OFF by default for third-party marketplaces
 * such as impeccable's — so a user can sit on an old impeccable indefinitely
 * with no signal. This check runs in stardust's Setup step 1 and prints ONE hint
 * line when a newer impeccable exists. It is advisory: it never blocks a run,
 * always exits 0, and fails silently (status "unknown") when anything it reads
 * is missing — the registry/cache paths it consults are Claude Code
 * implementation details, not a documented API.
 *
 * Sources, in order of authority for "latest":
 *   1. upstream — the marketplace's git repo `.claude-plugin/plugin.json` on
 *      HEAD (one fetch, 6s timeout; skipped with --offline or when it fails)
 *   2. cached catalog — ~/.claude/plugins/marketplaces/<mkt>/.claude-plugin/marketplace.json
 * "installed": ~/.claude/plugins/installed_plugins.json → plugins["impeccable@<mkt>"]
 * (user scope preferred), or --local <dir> for a harness-directory install
 * (reads <dir>/.claude-plugin/plugin.json or <dir>/package.json).
 *
 * Usage:
 *   node skills/stardust/scripts/impeccable-version-check.mjs [--marketplace impeccable]
 *        [--local <impeccable-dir>] [--offline] [--json]
 *
 * Output (text): one line —
 *   "impeccable 4.1.3 installed — 4.2.2 available: claude plugin marketplace update impeccable && claude plugin update impeccable@impeccable"
 *   "impeccable 4.2.2 installed — current"
 *   "impeccable version check skipped (<reason>)"
 * Exit code: always 0.
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const MKT = opt('marketplace', 'impeccable');
const PLUGIN = 'impeccable';
const LOCAL = opt('local');
const OFFLINE = args.includes('--offline');
const JSON_OUT = args.includes('--json');
const HOME = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const semver = (v) => { const m = String(v || '').match(/^v?(\d+)\.(\d+)\.(\d+)/); return m ? m.slice(1, 4).map(Number) : null; };
const cmp = (a, b) => { const x = semver(a); const y = semver(b); if (!x || !y) return null; for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

function installedVersion() {
  if (LOCAL) {
    const pj = readJson(path.join(LOCAL, '.claude-plugin', 'plugin.json')) || readJson(path.join(LOCAL, 'package.json'));
    return pj?.version ? { version: pj.version, from: `local ${LOCAL}` } : null;
  }
  const reg = readJson(path.join(HOME, 'plugins', 'installed_plugins.json'));
  const entry = reg?.plugins?.[`${PLUGIN}@${MKT}`];
  if (!entry) return null;
  const list = Array.isArray(entry) ? entry : [entry];
  const pick = list.find((e) => e.scope === 'user') || list[0];
  return pick?.version ? { version: pick.version, from: 'installed_plugins.json' } : null;
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

const installed = installedVersion();
const { cached, repo } = marketplaceInfo();
const upstream = await upstreamVersion(repo);
const latest = upstream || cached;
const update = `claude plugin marketplace update ${MKT} && claude plugin update ${PLUGIN}@${MKT}`;

let status; let line;
if (!installed) { status = 'not-installed'; line = `impeccable not found in the plugin registry (${PLUGIN}@${MKT})${LOCAL ? '' : ' — pass --local <dir> for a harness-directory install'}`; }
else if (!latest) { status = 'unknown'; line = `impeccable ${installed.version} installed — version check skipped (no marketplace catalog or upstream reachable)`; }
else {
  const c = cmp(latest, installed.version);
  if (c === null) { status = 'unknown'; line = `impeccable ${installed.version} installed — cannot compare with "${latest}"`; }
  else if (c > 0) { status = 'outdated'; line = `impeccable ${installed.version} installed — ${latest} available${upstream ? '' : ' (per cached catalog)'}: ${update}`; }
  else { status = 'current'; line = `impeccable ${installed.version} installed — current${upstream ? '' : ' (per cached catalog; upstream not checked)'}`; }
}

if (JSON_OUT) console.log(JSON.stringify({ status, installed: installed?.version || null, installedFrom: installed?.from || null, cachedCatalog: cached, upstream, latest, marketplace: MKT, repo, updateCommand: status === 'outdated' ? update : null }));
else console.log(line);
process.exit(0);
