// Whether what a pull request brings in from another repository meets the rules of this one.
//
// Plugins and skills that are written elsewhere and copied here (lib/imported.mjs) are left
// out of the checks of the whole tree, so that a copy which breaks a rule doesn't fail every
// other pull request. This check holds them to those rules instead, when a pull request
// changes them: it lists everything in what the pull request touches that breaks one, and
// fails when there is anything. That makes the gap visible where it is decided. A
// maintainer merges such a pull request with this check red; the fixes belong in the
// repository the copy comes from.
//
//   node scripts/check-imported.mjs [<base>]     default: origin/main
//
// The Tessl lint warnings are listed when the tessl CLI is on the PATH.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { error, summary, table } from './lib/actions.mjs';
import { changedFiles } from './lib/changed.mjs';
import { IMPORTED, origin } from './lib/imported.mjs';
import { isMain } from './lib/is-main.mjs';
import { hookProblems, licenses, withoutSource, withoutTessl } from './check-plugins.mjs';
import { findViolations } from './check-skills.mjs';
import { lintWarnings } from './tessl-lint-debt.mjs';

const RULE = {
  source: 'no root `plugin.json`: its manifests are written by hand, Cursor gets none, and a release does not set its version',
  tessl: 'no Tessl manifest: it is not published to the Tessl registry',
  license: 'no `license` in the frontmatter',
};

// The plugins in an import: the directories with a Claude Code manifest, or with the root
// plugin.json it is built from, relative to root.
function pluginsIn(root, entry) {
  const dirs = new Set();
  const walk = (dir) => {
    if (!existsSync(join(root, dir))) return;
    if (existsSync(join(root, dir, '.claude-plugin', 'plugin.json')) || existsSync(join(root, dir, 'plugin.json'))) dirs.add(dir);
    for (const item of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') walk(`${dir}/${item.name}`);
    }
  };
  walk(entry.path.replace(/\/$/, ''));
  return [...dirs].filter((dir) => `${dir}/`.startsWith(entry.path)).sort();
}

// What breaks a rule in one import, as { rule, file, detail }. `lint` lists the Tessl lint
// warnings of a plugin directory, or is null when the tessl CLI isn't there.
export function deviations(root, entry, lint = null) {
  const inside = (path) => path.startsWith(entry.path);
  const found = [];
  for (const dir of withoutSource(root, inside)) found.push({ rule: 'source', file: `${dir}/.claude-plugin/plugin.json`, detail: RULE.source });
  const plugins = pluginsIn(root, entry);
  const published = (dir) => existsSync(join(root, dir, '.tessl-plugin', 'plugin.json'));
  for (const dir of plugins.filter((plugin) => !published(plugin) && !existsSync(join(root, plugin, 'plugin.json')))) {
    found.push({ rule: 'tessl', file: `${dir}/.claude-plugin/plugin.json`, detail: RULE.tessl });
  }
  for (const dir of withoutTessl(root, inside)) found.push({ rule: 'tessl', file: `${dir}/plugin.json`, detail: RULE.tessl });
  for (const { file, problem } of hookProblems(root, inside)) found.push({ rule: 'hooks', file, detail: problem });
  for (const { file } of licenses(root, inside).filter(({ ok }) => !ok)) found.push({ rule: 'license', file, detail: RULE.license });
  for (const { rule, file, detail } of findViolations(root, inside)) found.push({ rule, file, detail });
  if (lint) {
    for (const dir of plugins.filter(published)) {
      for (const { file, text } of lint(dir)) found.push({ rule: 'tessl-lint-warning', file, detail: text });
    }
  }
  return found;
}

// The imports that changed files touch, in the order of IMPORTED.
export function touchedImports(files) {
  return IMPORTED.filter((entry) => files.some((file) => file.startsWith(entry.path)));
}

const contributing = () => `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY || 'adobe/skills'}/blob/main/CONTRIBUTING.md#brought-in-from-another-repository`;

function main() {
  const root = process.cwd();
  const base = process.argv[2] || 'origin/main';
  const fork = spawnSync('git', ['merge-base', base, 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const touched = touchedImports(changedFiles(root, [fork || base]));
  if (touched.length === 0) {
    console.log('This pull request changes nothing that is brought in from another repository.');
    return;
  }
  const tessl = !spawnSync('tessl', ['--version'], { encoding: 'utf8' }).error;
  const lint = tessl ? (dir) => lintWarnings(root, join(root, dir)) : null;
  const lines = ['## Brought in from another repository', ''];
  let total = 0;
  for (const entry of touched) {
    const found = deviations(root, entry, lint);
    total += found.length;
    if (found.length === 0) {
      console.log(`${entry.name} (${entry.path}) meets the rules of this repository.`);
      lines.push(`${entry.name} meets the rules of this repository.`, '');
      continue;
    }
    const where = origin(entry).replaceAll('`', '');
    for (const { file, detail } of found) console.log(`::error file=${file}::${detail.replace(/\.*$/, '')}. This is brought in from ${where}: fix it there.`);
    lines.push(
      `This pull request changes ${entry.name}, which comes from ${origin(entry)}. It breaks ${found.length} rule(s) of this repository (CONTRIBUTING.md):`,
      '',
      ...table(['Rule', 'File', 'What'], found.map(({ rule, file, detail }) => [rule, `\`${file}\``, detail])),
      '',
    );
  }
  if (!tessl) lines.push('The tessl CLI is not on the PATH, so the Tessl lint warnings are not listed.', '');
  if (total === 0) {
    summary(lines);
    return;
  }
  lines.push(
    `Fix these where the copy comes from, and bring it in again. Until then, a maintainer merges this pull request with this check failing. See [Brought in from another repository](${contributing()}).`,
  );
  summary(lines);
  error(`What this pull request brings in from another repository breaks ${total} rule(s) of this repository. A maintainer may merge it anyway; the fixes belong where it comes from.`);
  process.exit(1);
}

if (isMain(import.meta.url)) main();
