// Whether a pull request leaves the generated plugin files alone.
//
// x927 writes .claude-plugin/plugin.json, .tessl-plugin/plugin.json, .cursor-plugin/plugin.json
// and .mcp.json from a plugin's root plugin.json and mcp.json, and sets the description and
// version of the plugin's marketplace entries. Nobody edits those by hand: after a merge,
// CI rebuilds them on main and pushes the result (scripts/rebuild-plugins.mjs).
//
// So a generated file that is behind its plugin.json is fine here, as long as the pull
// request didn't change it. One that the pull request changed has to be exactly what the
// build writes. Anything else is an edit by hand, or a build that is out of date, and fails.
//
//   node scripts/check-generated.mjs [<git diff args>]     default: origin/main...HEAD
//
// Runs `x927 diff --all` in the current directory; x927 has to be on the PATH (npm run
// puts it there).
import { spawnSync } from 'node:child_process';
import { error, summary } from './lib/actions.mjs';
import { changedFiles } from './lib/changed.mjs';
import { isMain } from './lib/is-main.mjs';

// The generated files that `x927 diff` reports as missing or different.
export function drifted(output) {
  return [...output.matchAll(/^(?:missing|drift):\s+(\S.*)$/gm)].map((match) => match[1].trim());
}

function main() {
  const range = process.argv.slice(2);
  const root = process.cwd();
  const diff = spawnSync('x927', ['diff', '--all'], { cwd: root, encoding: 'utf8' });
  const behind = drifted(diff.stdout ?? '');
  if (diff.status !== 0 && behind.length === 0) {
    // not a drift: a plugin.json that x927 refuses, or x927 itself is missing
    console.log(diff.stdout ?? '');
    error(`x927 diff --all failed: ${(diff.stderr ?? diff.error?.message ?? '').trim()}`);
    process.exit(1);
  }
  if (behind.length === 0) {
    console.log('Every generated plugin file is what the build writes.');
    return;
  }
  const changed = new Set(changedFiles(root, range.length > 0 ? range : ['origin/main...HEAD']));
  const edited = behind.filter((file) => changed.has(file));
  const stale = behind.filter((file) => !changed.has(file));
  if (stale.length > 0) {
    console.log('Behind their plugin.json, and not changed here. CI rebuilds them on main after the merge:');
    for (const file of stale) console.log(`  ${file}`);
  }
  if (edited.length === 0) return;
  for (const file of edited) {
    console.log(`::error file=${file}::${file} is generated, and this pull request changes it to something the build does not write. Change plugin.json (or mcp.json) instead.`);
  }
  summary([
    '## Generated plugin files',
    '',
    'This pull request changes files that x927 generates, to something the build does not write:',
    '',
    ...edited.map((file) => `- \`${file}\``),
    '',
    "Change the plugin's root `plugin.json` (or `mcp.json`) instead, and take the change to the generated file back:",
    '',
    '```bash',
    `git checkout origin/main -- ${edited.join(' ')}`,
    '```',
    '',
    'CI rebuilds the generated files on `main` after the merge. A marketplace file is yours to edit, except for the `description` and `version` of an entry whose plugin has a root `plugin.json`: those come from there. If you want the built files in the pull request, run `npm run plugins:build` and commit what it writes.',
  ]);
  error(`${edited.length} generated file(s) were changed by hand: ${edited.join(', ')}`);
  process.exit(1);
}

if (isMain(import.meta.url)) main();
