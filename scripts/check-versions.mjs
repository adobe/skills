// Whether a pull request leaves the versions alone that a release sets.
//
// After a merge, semantic-release computes the version of each changed skill and of each
// changed plugin with a root plugin.json from the commit messages, and writes it:
// metadata.version in SKILL.md, version in plugin.json (scripts/release-skills.mjs,
// scripts/release-plugins.mjs). A version changed by hand would be overwritten by the
// next release, or make it count from the wrong number. So this fails a pull request
// that changes one. A new skill or plugin may carry any version: its first release is 1.0.0.
//
// Not checked: what is brought in from another repository and has its version from there,
// a skill whose folder name another skill has, and a plugin without a root plugin.json.
// Those are not released here.
//
//   node scripts/check-versions.mjs [<base>]     default: origin/main
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { error, summary } from './lib/actions.mjs';
import { changedFiles, pluginDirs, skillDirs } from './lib/changed.mjs';
import { isMain } from './lib/is-main.mjs';
import { duplicateNames, fileAt, isImported, manifestVersion, skillVersion } from './lib/release.mjs';

// The versions a pull request changed by hand, as { file, name, was, now }.
export function changedVersions(root, fork) {
  const changed = new Set(changedFiles(root, [fork]));
  const read = (file) => (existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : null);
  const found = [];
  const compare = (file, name, version) => {
    const before = fileAt(root, fork, file);
    const after = read(file);
    if (!changed.has(file) || before === null || after === null) return; // untouched, new or deleted
    const was = version(before);
    const now = version(after);
    if (was !== now) found.push({ file, name, was, now });
  };
  for (const dir of pluginDirs(root)) {
    if (!isImported(dir)) compare(`${dir}/plugin.json`, `the plugin ${basename(dir)}`, manifestVersion);
  }
  const all = skillDirs(root);
  const outer = all.filter((dir) => !all.some((other) => dir.startsWith(`${other}/`)));
  const duplicates = duplicateNames(outer);
  for (const dir of outer) {
    if (!isImported(dir) && !duplicates.has(basename(dir))) compare(`${dir}/SKILL.md`, `the skill ${basename(dir)}`, skillVersion);
  }
  return found;
}

function main() {
  const root = process.cwd();
  const base = process.argv[2] || 'origin/main';
  const fork = execFileSync('git', ['merge-base', base, 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const found = changedVersions(root, fork);
  if (found.length === 0) {
    console.log('No version that a release sets is changed here.');
    return;
  }
  const say = (version) => (version === undefined ? 'none' : version);
  for (const { file, name, was, now } of found) {
    console.log(`::error file=${file}::The version of ${name} is set by the release, from the commit messages. This pull request changes it from ${say(was)} to ${say(now)}. Take that change out.`);
  }
  summary([
    '## Versions',
    '',
    'This pull request changes versions that a release sets:',
    '',
    ...found.map(({ file, was, now }) => `- \`${file}\`: ${say(was)} → ${say(now)}`),
    '',
    'After the merge, semantic-release computes the version of each changed skill and plugin from the commit messages: `fix`, `perf`, `docs`, `refactor` and `style` are a patch release, `feat` a minor one, a breaking change a major one. The title of the pull request is the commit message. Take the change to the version out of the pull request.',
    '',
    `In a hand-written \`CHANGELOG.md\` of a plugin, put the entry under \`## Unreleased\`; the release renames that heading to the version.`,
  ]);
  error(`${found.length} version(s) that a release sets are changed by hand: ${found.map(({ file }) => dirname(file)).join(', ')}`);
  process.exit(1);
}

if (isMain(import.meta.url)) main();
