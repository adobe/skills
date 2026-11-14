// Whether a pull request leaves the generated plugin files alone.
//
// x927 writes .claude-plugin/plugin.json, .tessl-plugin/plugin.json, .cursor-plugin/plugin.json
// and .mcp.json from a plugin's root plugin.json and mcp.json, and sets fields such as the
// description and version of the plugin's marketplace entries. Nobody edits those by hand:
// after a merge, CI rebuilds them on main and pushes the result (scripts/rebuild-plugins.mjs).
//
// So a generated file that is behind its plugin.json is fine here, as long as the pull
// request didn't change it. One that the pull request changed has to be exactly what the
// build writes. Anything else is an edit by hand, or a build that is out of date, and fails.
//
// A marketplace file is hand-written except for those fields, so it is compared entry by
// entry: a new entry may have any fields, because the build fills in the generated ones,
// and an existing entry fails only for a generated field that the pull request changed.
//
//   node scripts/check-generated.mjs [<base>]     default: origin/main
//
// Compares the working tree with what `x927 build --all --dry-run` would write, and with
// the commit where this branch left <base>. x927 has to be on the PATH (npm run puts it there).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { error, summary } from './lib/actions.mjs';
import { changedFiles } from './lib/changed.mjs';
import { isMain } from './lib/is-main.mjs';

// What `x927 build --dry-run` would write, as a Map of path to content. It prints each
// file as a "--- path ---" line and the JSON below it; notes follow the last file.
export function planned(output) {
  const files = new Map();
  const parts = output.split(/^--- (.+) ---$/m);
  for (let index = 1; index < parts.length; index += 2) {
    const text = parts[index + 1].replace(/^\n/, '');
    const end = text.lastIndexOf('\n}\n');
    files.set(parts[index].trim(), end === -1 ? text : text.slice(0, end + 3));
  }
  return files;
}

const isCatalog = (file) => /(^|\/)marketplace\.json$/.test(file);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// The generated fields of existing marketplace entries that differ from what the build
// writes and from what they were at the base, as "the `field` of the `name` entry".
export function editedFields(head, built, base) {
  const found = [];
  const before = new Map((base?.plugins ?? []).map((entry) => [entry.source, entry]));
  const after = new Map((built?.plugins ?? []).map((entry) => [entry.source, entry]));
  for (const entry of head?.plugins ?? []) {
    const was = before.get(entry.source);
    const will = after.get(entry.source);
    if (!was || !will) continue; // a new entry: the build fills in its generated fields
    for (const key of new Set([...Object.keys(entry), ...Object.keys(will)])) {
      if (!same(entry[key], will[key]) && !same(entry[key], was[key])) found.push(`the \`${key}\` of the \`${entry.name}\` entry`);
    }
  }
  return found;
}

function main() {
  const root = process.cwd();
  const base = process.argv[2] || 'origin/main';
  const plan = spawnSync('x927', ['build', '--all', '--dry-run'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (plan.status !== 0) {
    // a plugin.json that x927 refuses, or x927 itself is missing
    console.log(plan.stdout ?? '');
    error(`x927 build --all --dry-run failed: ${(plan.stderr ?? plan.error?.message ?? '').trim()}`);
    process.exit(1);
  }
  const read = (file) => (existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : null);
  const behind = [...planned(plan.stdout)].filter(([file, content]) => read(file) !== content);
  if (behind.length === 0) {
    console.log('Every generated plugin file is what the build writes.');
    return;
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const fork = git('merge-base', base, 'HEAD').trim();
  const changed = new Set(changedFiles(root, [fork]));
  const atFork = (file) => {
    try {
      return git('show', `${fork}:${file}`);
    } catch {
      return null; // the file is new
    }
  };
  const edited = []; // { file, what }
  const stale = [];
  for (const [file, content] of behind) {
    if (!changed.has(file)) {
      stale.push(file);
    } else if (isCatalog(file)) {
      const fields = editedFields(parse(read(file) ?? ''), parse(content), parse(atFork(file) ?? ''));
      if (fields.length > 0) edited.push({ file, what: fields.join(', ') });
      else stale.push(file);
    } else {
      edited.push({ file, what: null });
    }
  }
  if (stale.length > 0) {
    console.log('Behind their plugin.json, and not changed by hand here. CI rebuilds them on main after the merge:');
    for (const file of stale) console.log(`  ${file}`);
  }
  if (edited.length === 0) return;
  for (const { file, what } of edited) {
    const detail = what
      ? `${what} in ${file} comes from the plugin's plugin.json, and this pull request changes it to something else. Change it in plugin.json.`
      : `${file} is generated, and this pull request changes it to something the build does not write: an edit by hand, or a build from before plugin.json changed again. Change plugin.json (or mcp.json) only, and take this file out of the pull request.`;
    console.log(`::error file=${file}::${detail}`);
  }
  const files = edited.filter(({ what }) => !what).map(({ file }) => file);
  const fields = edited.filter(({ what }) => what);
  summary([
    '## Generated plugin files',
    '',
    'This pull request changes what x927 generates, to something the build does not write. That is an edit by hand, or a build from before `plugin.json` changed again.',
    '',
    ...files.map((file) => `- \`${file}\``),
    ...fields.map(({ file, what }) => `- \`${file}\`: ${what}`),
    '',
    "Change the plugin's root `plugin.json` (or `mcp.json`) instead. CI rebuilds the generated files on `main` after the merge.",
    ...(files.length > 0 ? ['', 'Take the generated files out of the pull request:', '', '```bash', `git checkout ${base} -- ${files.join(' ')}`, '```'] : []),
    ...(fields.length > 0 ? ['', "In a marketplace file, put those fields back to what they were. A text that only the marketplace should have goes under `extensions[\"io.github.ai-ecoverse.x927\"].marketplace` in the plugin's `plugin.json`."] : []),
    '',
    'If you want the built files in the pull request, run `npm run plugins:build` and commit what it writes.',
  ]);
  error(`${edited.length} generated file(s) are changed here, and not to what the build writes: ${edited.map(({ file }) => file).join(', ')}`);
  process.exit(1);
}

if (isMain(import.meta.url)) main();
