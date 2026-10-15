#!/usr/bin/env node
// Unit test: encode/deps.mjs — deploy's scripts resolved in both layouts (plugin tree and project copy). No browser, no
// network. The project layout is simulated in fixtures/encode-site/.scratch/ (git-ignored, removed afterwards).
//
// Usage: node plugins/stardust/skills/migrate/scripts/test/encode-site.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deployCandidates, deployPath, loadDeploy } from '../encode/deps.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENCODE = join(HERE, '..', 'encode');
const DEPLOY = join(HERE, '..', '..', '..', 'deploy', 'scripts');
const SCRATCH = join(HERE, 'fixtures', 'encode-site', '.scratch');

// --- deps.mjs, plugin tree ------------------------------------------------------------------------------------
{
  assert.equal(deployPath('eds-path.mjs'), join(DEPLOY, 'eds-path.mjs'), 'the plugin-tree candidate comes first');
  const a = await loadDeploy('eds-path.mjs');
  assert.equal(a.deliveredUrl('/en/About_Us.html'), '/en/about-us', 'the loaded module is deploy\'s eds-path.mjs');
  assert.equal(await loadDeploy('eds-path.mjs'), a, 'cached: one namespace per file');
  const c = deployCandidates('nope.mjs');
  await assert.rejects(loadDeploy('nope.mjs'), (e) => e.message.includes(c[0]) && e.message.includes(c[1]), 'a missing script names both candidate paths');
  assert.throws(() => deployPath('nope.mjs'), /nope\.mjs/);
}

// --- deps.mjs, project copy: stardust/scripts/migrate/encode/ beside stardust/scripts/deploy/ --------------------
rmSync(SCRATCH, { recursive: true, force: true });
try {
  const proj = join(SCRATCH, 'project', 'stardust', 'scripts');
  mkdirSync(join(proj, 'migrate', 'encode'), { recursive: true });
  mkdirSync(join(proj, 'deploy'), { recursive: true });
  copyFileSync(join(ENCODE, 'deps.mjs'), join(proj, 'migrate', 'encode', 'deps.mjs'));
  writeFileSync(join(proj, 'deploy', 'probe.mjs'), "export const layout = 'project';\n");
  const deps = await import(pathToFileURL(join(proj, 'migrate', 'encode', 'deps.mjs')).href);
  assert.equal(deps.deployPath('probe.mjs'), join(proj, 'deploy', 'probe.mjs'), 'the project-copy candidate resolves');
  assert.equal((await deps.loadDeploy('probe.mjs')).layout, 'project');
  await assert.rejects(deps.loadDeploy('eds-path.mjs'), /eds-path\.mjs.*stardust[/\\]scripts[/\\]deploy[/\\]eds-path\.mjs/, 'never falls back to the plugin tree');
} finally {
  rmSync(SCRATCH, { recursive: true, force: true });
}

console.log('encode-site: ok');
