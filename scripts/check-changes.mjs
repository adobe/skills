// Whether a pull request takes its changelog entry the way the plugin does.
//
// A plugin that has a changes/ folder on the base branch takes change notes
// (scripts/lib/changes.mjs): a pull request adds changes/<name>.md and leaves CHANGELOG.md
// to the release. This fails a pull request that edits such a CHANGELOG.md, or adds a note
// the release could not use.
//
//   node scripts/check-changes.mjs [<base>]     default: origin/main
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { error, summary } from './lib/actions.mjs';
import { changedFiles, pluginDirs } from './lib/changed.mjs';
import { CHANGES, noteProblem } from './lib/changes.mjs';
import { isMain } from './lib/is-main.mjs';
import { fileAt } from './lib/release.mjs';

// What a pull request got wrong, as { file, message }.
export function changeProblems(root, fork) {
  const changed = changedFiles(root, [fork]);
  const found = [];
  for (const dir of pluginDirs(root)) {
    // the folder's README.md on the base says that the plugin takes notes
    if (fileAt(root, fork, `${dir}/${CHANGES}/README.md`) === null) continue;
    const changelog = `${dir}/CHANGELOG.md`;
    if (changed.includes(changelog) && fileAt(root, fork, changelog) !== null && existsSync(join(root, changelog))) {
      found.push({ file: changelog, message: `The release writes ${changelog}. Take the change to it out, and put the entry into a new file ${dir}/${CHANGES}/<what-changed>.md: the first line is the title, the rest is the entry.` });
    }
    for (const file of changed.filter((path) => path.startsWith(`${dir}/${CHANGES}/`) && path !== `${dir}/${CHANGES}/README.md`)) {
      if (!existsSync(join(root, file))) continue; // removed: the release does that, and a pull request may take its own note back
      const problem = noteProblem(basename(file), readFileSync(join(root, file), 'utf8'));
      if (problem) found.push({ file, message: `The change note ${file} cannot be used: ${problem}.` });
    }
  }
  return found;
}

function main() {
  const root = process.cwd();
  const base = process.argv[2] || 'origin/main';
  const fork = execFileSync('git', ['merge-base', base, 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const found = changeProblems(root, fork);
  if (found.length === 0) {
    console.log('Changelog entries are change notes, and each can be used.');
    return;
  }
  for (const { file, message } of found) console.log(`::error file=${file}::${message}`);
  summary(['## Change notes', '', ...found.map(({ message }) => `- ${message}`), '', 'Two pull requests that each add an entry at the top of one `CHANGELOG.md` conflict. Two new files do not. See `scripts/lib/changes.mjs`.']);
  error(`${found.length} problem(s) with changelog entries`);
  process.exit(1);
}

if (isMain(import.meta.url)) main();
