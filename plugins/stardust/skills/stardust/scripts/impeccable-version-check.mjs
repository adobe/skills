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
 *   - Grok Build / Cursor plugin caches: ~/.grok/plugins/**, ~/.cursor/plugins/** (searched 4 levels
 *     deep for skills/impeccable/SKILL.md; layout undocumented, best effort). Update: reinstall the plugin.
 *   - skills directories (loose installs: `npx impeccable install`, `npx skills add`, copies) — project
 *     dirs from the cwd up to the git root (.claude .agents .agent .github .cursor .grok .opencode .pi
 *     .gemini /skills), then user dirs (~/.claude/skills ~/.agents/skills ~/.copilot/skills
 *     ~/.cursor/skills ~/.grok/skills ~/.codex/skills $OPENCODE_CONFIG_DIR|$XDG_CONFIG_HOME/opencode/skills
 *     ~/.pi/agent/skills ~/.gemini/skills ~/.gemini/config/skills ~/.gemini/antigravity/skills
 *     ~/.gemini/antigravity-cli/skills). Version from SKILL.md frontmatter (`version:` or
 *     `metadata.version`). Update: npx impeccable update.
 *   - --local <dir> for any other location (reads <dir>/.claude-plugin/plugin.json, <dir>/package.json
 *     or the SKILL.md frontmatter). Update hint: reinstall through the installer that put it there.
 *   One line per distinct directory (symlinked copies collapse to one).
 * "latest" falls back to the pbakaus/impeccable repo when no Claude Code marketplace is registered.
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
import { readFileSync, existsSync, readdirSync, realpathSync } from 'fs';
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
const USER = os.homedir();
const OPENCODE_HOME = process.env.OPENCODE_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(USER, '.config'), 'opencode');
const DEFAULT_REPO = 'pbakaus/impeccable'; // impeccable's own marketplace, used when no Claude Code catalog names one
// Skills directories a harness loads, project first. `harness` is a reader, not an exclusive owner.
const PROJECT_SKILL_DIRS = [['.claude', 'Claude Code'], ['.agents', 'agents skills dir'], ['.agent', 'Antigravity'], ['.github', 'GitHub Copilot'], ['.cursor', 'Cursor'], ['.grok', 'Grok Build'], ['.opencode', 'OpenCode'], ['.pi', 'Pi'], ['.gemini', 'Gemini']];
const USER_SKILL_DIRS = [
  [path.join(HOME, 'skills'), 'Claude Code'], [path.join(USER, '.agents', 'skills'), 'agents skills dir'],
  [path.join(COPILOT_HOME, 'skills'), 'GitHub Copilot'], [path.join(USER, '.cursor', 'skills'), 'Cursor'],
  [path.join(USER, '.grok', 'skills'), 'Grok Build'], [path.join(USER, '.codex', 'skills'), 'Codex'],
  [path.join(OPENCODE_HOME, 'skills'), 'OpenCode'], [path.join(USER, '.pi', 'agent', 'skills'), 'Pi'],
  [path.join(USER, '.gemini', 'skills'), 'Gemini'], [path.join(USER, '.gemini', 'config', 'skills'), 'Antigravity'],
  [path.join(USER, '.gemini', 'antigravity', 'skills'), 'Antigravity'], [path.join(USER, '.gemini', 'antigravity-cli', 'skills'), 'Antigravity CLI'],
];
const PLUGIN_CACHES = [[path.join(USER, '.grok', 'plugins'), 'Grok Build', 'reinstall: grok plugin install pbakaus/impeccable#plugin --trust'], [path.join(USER, '.cursor', 'plugins'), 'Cursor', 'reinstall the impeccable plugin from the Cursor marketplace']];

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
// The skill directory inside a plugin root (or the directory itself when it already is the skill).
const skillDir = (root) => (existsSync(path.join(root, 'SKILL.md')) ? root : path.join(root, 'skills', PLUGIN));
const semver = (v) => { const m = String(v || '').match(/^v?(\d+)\.(\d+)\.(\d+)/); return m ? m.slice(1, 4).map(Number) : null; };
const cmp = (a, b) => { const x = semver(a); const y = semver(b); if (!x || !y) return null; for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

// SKILL.md frontmatter version: top-level `version:` (Claude-style builds) or `metadata.version` (Codex/agents builds).
const frontmatterVersion = (skill) => {
  try {
    const fm = readFileSync(path.join(skill, 'SKILL.md'), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';
    return fm.match(/^version:\s*["']?([\w.+-]+)/m)?.[1] || fm.match(/^metadata:[\s\S]*?^\s+version:\s*["']?([\w.+-]+)/m)?.[1] || null;
  } catch { return null; }
};
// Project roots from the cwd up to (and including) the git root, or up to / when there is none.
function projectRoots() {
  const roots = [];
  for (let d = process.cwd(); ; d = path.dirname(d)) { roots.push(d); if (existsSync(path.join(d, '.git')) || path.dirname(d) === d) return roots; }
}
// skills/impeccable/SKILL.md under a plugin cache, at most `depth` levels down.
function findPluginSkill(dir, depth) {
  if (existsSync(path.join(dir, 'skills', PLUGIN, 'SKILL.md'))) return dir;
  if (depth <= 0) return null;
  try { for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) { const hit = findPluginSkill(path.join(dir, e.name), depth - 1); if (hit) return hit; } } catch {}
  return null;
}
const manifestVersion = (root) => ['.claude-plugin', '.grok-plugin', '.cursor-plugin', '.codex-plugin', ''].map((m) => readJson(path.join(root, m, 'plugin.json'))?.version).find(Boolean) || null;

function installedCopies() {
  const copies = [];
  if (LOCAL) {
    const pj = readJson(path.join(LOCAL, '.claude-plugin', 'plugin.json')) || readJson(path.join(LOCAL, 'package.json'));
    copies.push({ version: pj?.version || frontmatterVersion(skillDir(LOCAL)), dir: skillDir(LOCAL), from: `local ${LOCAL}`, harness: 'skills directory', update: `reinstall impeccable through the installer that placed it at ${LOCAL}` });
    return copies;
  }
  for (const root of projectRoots()) for (const [dot, harness] of PROJECT_SKILL_DIRS) {
    const dir = path.join(root, dot, 'skills', PLUGIN);
    if (existsSync(path.join(dir, 'SKILL.md'))) copies.push({ version: frontmatterVersion(dir), dir, from: dir, harness: `${harness}, project`, update: 'npx impeccable update' });
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
  for (const [cache, harness, update] of PLUGIN_CACHES) {
    const hit = findPluginSkill(cache, 4);
    if (hit) copies.push({ version: manifestVersion(hit) || frontmatterVersion(skillDir(hit)), dir: skillDir(hit), from: hit, harness, update });
  }
  for (const [base, harness] of USER_SKILL_DIRS) {
    const dir = path.join(base, PLUGIN);
    if (existsSync(path.join(dir, 'SKILL.md'))) copies.push({ version: frontmatterVersion(dir), dir, from: dir, harness: `${harness}, user`, update: 'npx impeccable update' });
  }
  // `npx skills add` symlinks one canonical copy into several harness dirs: report each real directory once.
  const seen = new Set();
  return copies.filter((c) => { if (!c.dir) return true; let k = c.dir; try { k = realpathSync(c.dir); } catch {} if (seen.has(k)) return false; seen.add(k); return true; });
}

if (WHERE) {
  const hit = installedCopies().find((c) => c.dir && existsSync(path.join(c.dir, 'SKILL.md')));
  if (!hit) { console.error(`impeccable skill directory not found (${LOCAL ? `--local ${LOCAL}` : `project and user skills dirs, ${PLUGIN}@${MKT} in Claude Code, ~/.copilot/installed-plugins, Grok/Cursor plugin caches`})`); process.exit(1); }
  console.log(hit.dir);
  process.exit(0);
}

function marketplaceInfo() {
  const known = readJson(path.join(HOME, 'plugins', 'known_marketplaces.json'));
  const m = known?.[MKT];
  if (!m) return { cached: null, repo: MKT === 'impeccable' ? DEFAULT_REPO : null };
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
  results.push({ status: 'not-installed', line: `impeccable not found (project and user skills dirs, ${PLUGIN}@${MKT} in Claude Code, ~/.copilot/installed-plugins, Grok/Cursor plugin caches)${LOCAL ? '' : ' — pass --local <dir> for any other location'}` });
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
