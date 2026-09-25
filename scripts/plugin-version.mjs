#!/usr/bin/env node
// Keep a plugin's version in step across its three manifests, and its Tessl skills
// list in step with the skills it ships.
//
//   node scripts/plugin-version.mjs <plugin-dir>            check — exit 1 on drift
//   node scripts/plugin-version.mjs <plugin-dir> <version>  set   — write all three
//
// Source of truth is <plugin-dir>/.claude-plugin/plugin.json. The marketplace entry
// (.claude-plugin/marketplace.json, matched by `source`) and the Tessl manifest
// (<plugin-dir>/.tessl-plugin/plugin.json) follow it when they carry a version.
// The Tessl publish job only fires when the Tessl manifest's version changes, so a
// manifest left behind means the plugin silently stops publishing (stardust sat at
// 0.21.1 while plugin.json reached 0.25.2).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const [dirArg, version] = process.argv.slice(2);
const usage =
  'usage: plugin-version.mjs <plugin-dir> [<version>]  (no version = check, exit 1 on drift)';
if (dirArg === '--help' || dirArg === '-h') { console.log(usage); process.exit(0); }
if (!dirArg) { console.error(usage); process.exit(2); }

const fail = (msg) => { console.error(msg); process.exit(2); };

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, dirArg);
const source = `./${relative(root, dir)}`;
const pluginPath = join(dir, '.claude-plugin', 'plugin.json');
const tesslPath = join(dir, '.tessl-plugin', 'plugin.json');
const marketPath = join(root, '.claude-plugin', 'marketplace.json');

if (!existsSync(pluginPath)) fail(`not a plugin dir: ${pluginPath} missing`);
if (version && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`not a semver version: ${version}`);
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, o) => writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`);

const plugin = readJson(pluginPath);
const market = readJson(marketPath);
const entry = market.plugins.find((p) => p.source === source);
if (!entry) fail(`no entry with "source": "${source}" in ${relative(root, marketPath)}`);
const tessl = existsSync(tesslPath) ? readJson(tesslPath) : null;
const skillDirs = readdirSync(join(dir, 'skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(dir, 'skills', e.name, 'SKILL.md')))
  .map((e) => `skills/${e.name}`)
  .sort();

if (version) {
  // Compute and verify the marketplace rewrite first, so a refusal leaves every file untouched.
  let marketNext = null;
  if (entry.version) {
    // Scoped text replace: keep every other entry's formatting byte-identical.
    const text = readFileSync(marketPath, 'utf8');
    const at = text.indexOf(`"source": "${source}"`);
    if (at === -1) fail(`marketplace entry for ${source} is not formatted as "source": "…"`);
    const open = text.lastIndexOf('{', at);
    let close = open;
    for (let depth = 0; ; close++) {
      if (text[close] === '{') depth++;
      if (text[close] === '}' && --depth === 0) break;
    }
    const block = text.slice(open, close).replace(/"version": "[^"]*"/, `"version": "${version}"`);
    marketNext = text.slice(0, open) + block + text.slice(close);
    const check = JSON.parse(marketNext);
    if (check.plugins.find((p) => p.source === source)?.version !== version
      || check.metadata?.version !== market.metadata?.version) {
      fail(`marketplace rewrite did not land on the ${source} entry; nothing written`);
    }
  }
  plugin.version = version;
  writeJson(pluginPath, plugin);
  if (marketNext) writeFileSync(marketPath, marketNext);
  if (tessl) {
    tessl.version = version;
    tessl.skills = skillDirs;
    writeJson(tesslPath, tessl);
  }
  const written = ['plugin.json', marketNext && 'marketplace', tessl && 'tessl'].filter(Boolean);
  console.log(`${basename(dir)} → ${version} (${written.join(', ')})`);
  process.exit(0);
}

const drift = [];
if (entry.version && entry.version !== plugin.version) {
  drift.push(`marketplace.json ${entry.version} ≠ plugin.json ${plugin.version}`);
}
if (tessl && tessl.version !== plugin.version) {
  drift.push(`.tessl-plugin/plugin.json ${tessl.version} ≠ plugin.json ${plugin.version}`);
}
if (tessl) {
  const listed = [...(tessl.skills ?? [])].sort();
  const missing = skillDirs.filter((s) => !listed.includes(s));
  const extra = listed.filter((s) => !skillDirs.includes(s));
  if (missing.length) drift.push(`.tessl-plugin/plugin.json skills missing: ${missing.join(', ')}`);
  if (extra.length) drift.push(`.tessl-plugin/plugin.json skills not shipped: ${extra.join(', ')}`);
}

if (drift.length) {
  for (const d of drift) console.error(`${basename(dir)}: ${d}`);
  console.error(`fix: node scripts/plugin-version.mjs ${dirArg} ${plugin.version}`);
  process.exit(1);
}
console.log(`${basename(dir)} ${plugin.version}: manifests in step`);
