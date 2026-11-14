// The files that `tessl plugin lint` warns about, one per line, for the boy-scout gate
// (.boy-scout.json): a pull request that changes one of them has to clear the warning.
//
// A warning about a skill ("⚠ Skill 'name': …") is charged to that skill's SKILL.md. Any
// other warning is charged to the plugin's .tessl-plugin/plugin.json. Whether a plugin is
// valid at all is not decided here: the Tessl Plugin Lint workflow fails on that.
//
// Run from the repository root, with the tessl CLI on the PATH:
//   node scripts/tessl-lint-debt.mjs             the files with a warning
//   node scripts/tessl-lint-debt.mjs --verbose   each warning under its file
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP = new Set(['node_modules', '.git']);
const posix = (path) => path.split(sep).join('/');

function walk(dir, name, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) walk(join(dir, entry.name), name, found);
    } else if (entry.name === name) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

// Directories under root/plugins that have a Tessl manifest, sorted.
export function tesslPlugins(root) {
  const plugins = join(root, 'plugins');
  if (!existsSync(plugins)) return [];
  return walk(plugins, 'plugin.json')
    .filter((file) => dirname(file).endsWith(`${sep}.tessl-plugin`))
    .map((file) => dirname(dirname(file)))
    .sort();
}

function skillName(file) {
  const block = readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const name = block?.[1].match(/^name:\s*(.+?)\s*$/m)?.[1];
  return name?.replace(/^(['"])(.*)\1$/, '$2') ?? dirname(file).split(sep).pop();
}

// The warnings in the output of `tessl plugin lint`, as { skill, text }; skill is null
// for a warning that names none.
export function parseWarnings(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('⚠'))
    .map((line) => {
      const text = line.replace(/^⚠\s*/, '');
      return { skill: text.match(/^Skill '([^']+)'/)?.[1] ?? null, text };
    });
}

// The warnings of one plugin, each with the file it is charged to, relative to root.
export function chargeWarnings(root, pluginDir, warnings) {
  const skills = new Map(walk(pluginDir, 'SKILL.md').map((file) => [skillName(file), file]));
  const manifest = join(pluginDir, '.tessl-plugin', 'plugin.json');
  return warnings.map(({ skill, text }) => ({
    file: posix(relative(root, (skill && skills.get(skill)) || manifest)),
    text,
  }));
}

function main() {
  const root = process.cwd();
  const charged = [];
  for (const pluginDir of tesslPlugins(root)) {
    const result = spawnSync('tessl', ['plugin', 'lint', pluginDir], { encoding: 'utf8' });
    if (result.error) {
      console.error(`tessl-lint-debt: can't run the tessl CLI (${result.error.message}). Install it: https://docs.tessl.io`);
      process.exit(2);
    }
    charged.push(...chargeWarnings(root, pluginDir, parseWarnings(`${result.stdout}\n${result.stderr}`)));
  }
  const files = [...new Set(charged.map(({ file }) => file))].sort();
  for (const file of files) {
    console.log(file);
    if (process.argv.includes('--verbose')) {
      for (const { text } of charged.filter((warning) => warning.file === file)) console.log(`  ${text}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
