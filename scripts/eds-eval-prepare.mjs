// Prepares an EDS multi-model eval: scenario subset, base/head plugin copies narrowed to one
// skill, and a variants file (per model: no-skill, base, head). Run from the repository root.
// Usage: node scripts/eds-eval-prepare.mjs <config.json> <base-ref> <out-dir>
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PLUGIN = 'plugins/aem/edge-delivery-services';
const [configPath, baseRef, out] = process.argv.slice(2);
if (!configPath || !baseRef || !out) {
  console.error('Usage: node scripts/eds-eval-prepare.mjs <config.json> <base-ref> <out-dir>');
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const { skill, scenarios, models } = config;

function narrow(pluginDir, dest) {
  mkdirSync(join(dest, '.tessl-plugin'), { recursive: true });
  cpSync(join(pluginDir, 'skills', skill), join(dest, 'skills', skill), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(pluginDir, '.tessl-plugin', 'plugin.json'), 'utf8'));
  manifest.skills = [`skills/${skill}`];
  writeFileSync(join(dest, '.tessl-plugin', 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const name of scenarios) {
  cpSync(join(PLUGIN, 'evals', name), join(out, 'scenarios', name), { recursive: true });
}

narrow(PLUGIN, join(out, 'head'));

const baseTree = join(out, 'base-tree');
mkdirSync(baseTree, { recursive: true });
const archive = execFileSync(
  'git',
  ['archive', baseRef, `${PLUGIN}/.tessl-plugin/plugin.json`, `${PLUGIN}/skills/${skill}`],
  { maxBuffer: 256 * 1024 * 1024 },
);
execFileSync('tar', ['-x', '-C', baseTree], { input: archive });
narrow(join(baseTree, PLUGIN), join(out, 'base'));
rmSync(baseTree, { recursive: true, force: true });

const variants = models.flatMap(({ label, agent, model }) => [
  { label: `${label}-noskill`, agent, model, fixtures: { context: null } },
  { label: `${label}-base`, agent, model, fixtures: { context: { localPath: resolve(out, 'base') } } },
  { label: `${label}-head`, agent, model, fixtures: { context: { localPath: resolve(out, 'head') } } },
]);
writeFileSync(join(out, 'variants.json'), `${JSON.stringify(variants, null, 2)}\n`);

const solves = variants.length * scenarios.length * (config.runs || 1);
console.log(`skill=${skill} base=${baseRef} scenarios=${scenarios.length} variants=${variants.length} solves=${solves}`);
