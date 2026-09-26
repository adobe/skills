#!/usr/bin/env node
// Keep a plugin's version in step across its three manifests, and its Tessl skills
// list in step with the skills it ships.
//
//   node scripts/plugin-version.mjs <plugin-dir>            check — exit 1 on drift
//   node scripts/plugin-version.mjs <plugin-dir> <version>  set   — write all three
//   node --test 'scripts/test/*.test.mjs'                    tests (temp fixture, no repo writes)
//
// A managed plugin has all three: <plugin-dir>/.claude-plugin/plugin.json (source of
// truth), a versioned entry in .claude-plugin/marketplace.json (matched by `source`),
// and <plugin-dir>/.tessl-plugin/plugin.json. A missing one is a failure, not a skip:
// the Tessl publish job only fires when the Tessl manifest's version changes, so a
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

// semver.org § Is there a suggested regular expression to check a SemVer string?
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, dirArg);
const source = `./${relative(root, dir)}`;
const pluginPath = join(dir, '.claude-plugin', 'plugin.json');
const tesslPath = join(dir, '.tessl-plugin', 'plugin.json');
const marketPath = join(root, '.claude-plugin', 'marketplace.json');

if (!existsSync(pluginPath)) fail(`not a plugin dir: ${pluginPath} missing`);
if (!existsSync(tesslPath)) fail(`missing Tessl manifest: ${relative(root, tesslPath)}`);
if (version && !SEMVER.test(version)) fail(`not a semver version: ${version}`);

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, o) => writeFileSync(p, `${JSON.stringify(o, null, 2)}\n`);

const plugin = readJson(pluginPath);
const market = readJson(marketPath);
const tessl = readJson(tesslPath);
const entry = market.plugins.find((p) => p.source === source);
if (!entry) fail(`no entry with "source": "${source}" in ${relative(root, marketPath)}`);
if (!entry.version) fail(`marketplace entry for ${source} has no version`);
const skillDirs = readdirSync(join(dir, 'skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(dir, 'skills', e.name, 'SKILL.md')))
  .map((e) => `skills/${e.name}`)
  .sort();

// End index (exclusive) of the JSON object that opens at `open`; string-aware, EOF-guarded.
function objectEnd(text, open) {
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

if (version) {
  // Compute and verify the marketplace rewrite first, so a refusal leaves every file untouched.
  // Scoped text replace: keep every other entry's formatting byte-identical.
  const text = readFileSync(marketPath, 'utf8');
  const key = `"source": "${source}"`;
  if (!text.includes(key)) fail(`marketplace entry for ${source} is not formatted as "source": "…"`);
  // Walk the plugins array object by object until the one holding the key.
  let open = text.indexOf('{', text.indexOf('"plugins"'));
  let close = objectEnd(text, open);
  while (close !== -1 && !text.slice(open, close).includes(key)) {
    open = text.indexOf('{', close);
    close = open === -1 ? -1 : objectEnd(text, open);
  }
  if (close === -1) fail(`marketplace entry for ${source} has no closing brace`);
  const block = text.slice(open, close).replace(/"version": "[^"]*"/, `"version": "${version}"`);
  const marketNext = text.slice(0, open) + block + text.slice(close);
  const check = JSON.parse(marketNext);
  if (check.plugins.find((p) => p.source === source)?.version !== version
    || check.metadata?.version !== market.metadata?.version) {
    fail(`marketplace rewrite did not land on the ${source} entry; nothing written`);
  }
  plugin.version = version;
  tessl.version = version;
  tessl.skills = skillDirs;
  writeJson(pluginPath, plugin);
  writeFileSync(marketPath, marketNext);
  writeJson(tesslPath, tessl);
  console.log(`${basename(dir)} → ${version} (plugin.json, marketplace, tessl)`);
  process.exit(0);
}

const drift = [];
if (entry.version !== plugin.version) {
  drift.push(`marketplace.json ${entry.version} ≠ plugin.json ${plugin.version}`);
}
if (tessl.version !== plugin.version) {
  drift.push(`.tessl-plugin/plugin.json ${tessl.version} ≠ plugin.json ${plugin.version}`);
}
const listed = [...(tessl.skills ?? [])].sort();
const missing = skillDirs.filter((s) => !listed.includes(s));
const extra = listed.filter((s) => !skillDirs.includes(s));
const dupes = listed.filter((s, i) => listed.indexOf(s) !== i);
if (missing.length) drift.push(`.tessl-plugin/plugin.json skills missing: ${missing.join(', ')}`);
if (extra.length) drift.push(`.tessl-plugin/plugin.json skills not shipped: ${extra.join(', ')}`);
if (dupes.length) drift.push(`.tessl-plugin/plugin.json skills listed twice: ${dupes.join(', ')}`);

if (drift.length) {
  for (const d of drift) console.error(`${basename(dir)}: ${d}`);
  console.error(`fix: node scripts/plugin-version.mjs ${dirArg} ${plugin.version}`);
  process.exit(1);
}
console.log(`${basename(dir)} ${plugin.version}: manifests in step`);
