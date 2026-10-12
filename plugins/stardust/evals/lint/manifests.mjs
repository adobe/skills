#!/usr/bin/env node
// Guard: every manifest that ships stardust names the same version and the same skills.
//
// Why: harnesses read different manifests (Claude Code and Copilot the .claude-plugin
// pair, tessl its own), and a manifest nobody re-reads drifts — the tessl one sat at
// 0.21.1 with 13 of 16 skills for ten releases.
//
// Checks: .claude-plugin/plugin.json version == root marketplace stardust entry version
// == .tessl-plugin/plugin.json version == the first CHANGELOG heading; the tessl skills
// list == the skill directories under skills/.
//
// Usage: node plugins/stardust/evals/lint/manifests.mjs  (exit 1 on findings)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PLUGIN = join(import.meta.dirname, '..', '..');
const read = (p) => JSON.parse(readFileSync(join(PLUGIN, p), 'utf8'));
const findings = [];

const version = read('.claude-plugin/plugin.json').version;
const market = read('../../.claude-plugin/marketplace.json').plugins.find((p) => p.name === 'stardust');
if (market?.version !== version) findings.push(`root .claude-plugin/marketplace.json stardust version ${market?.version} != ${version}`);
const tessl = read('.tessl-plugin/plugin.json');
if (tessl.version !== version) findings.push(`.tessl-plugin/plugin.json version ${tessl.version} != ${version}`);
const heading = readFileSync(join(PLUGIN, 'CHANGELOG.md'), 'utf8').match(/^## (\d+\.\d+\.\d+)/m)?.[1];
if (heading !== version) findings.push(`CHANGELOG.md first heading ${heading} != ${version}`);

const dirs = readdirSync(join(PLUGIN, 'skills')).filter((d) => existsSync(join(PLUGIN, 'skills', d, 'SKILL.md'))).sort();
const listed = (tessl.skills || []).map((s) => s.replace(/^skills\//, '')).sort();
for (const d of dirs) if (!listed.includes(d)) findings.push(`.tessl-plugin/plugin.json does not list skills/${d}`);
for (const s of listed) if (!dirs.includes(s)) findings.push(`.tessl-plugin/plugin.json lists skills/${s}, which has no SKILL.md`);

if (findings.length) { console.error(`manifests lint: ${findings.length} finding(s)\n` + findings.join('\n')); process.exit(1); }
console.log(`manifests lint: version ${version}, ${dirs.length} skills, all manifests agree`);
