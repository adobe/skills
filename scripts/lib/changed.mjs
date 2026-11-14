// Which skills and plugins a change touches. The workflows that release, review and
// evaluate all ask this; each used to carry its own copy of the answer in bash.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const SKIP = new Set(['node_modules', '.git']);
const posix = (path) => path.split(sep).join('/');

function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) walk(path, found);
    } else {
      found.push(path);
    }
  }
  return found;
}

function files(root) {
  const plugins = join(root, 'plugins');
  return existsSync(plugins) ? walk(plugins).map((file) => posix(relative(root, file))) : [];
}

// Directories that hold a SKILL.md, relative to root, sorted.
export function skillDirs(root) {
  return files(root).filter((file) => file.endsWith('/SKILL.md')).map((file) => dirname(file)).sort();
}

// Directories that hold .tessl-plugin/plugin.json, relative to root, sorted.
export function tesslPluginDirs(root) {
  const suffix = '/.tessl-plugin/plugin.json';
  return files(root).filter((file) => file.endsWith(suffix)).map((file) => file.slice(0, -suffix.length)).sort();
}

// The directory of `dirs` a file lies in. A skill inside another skill belongs to the
// outer one: dirs is sorted, so the outer directory comes first.
function owner(file, dirs) {
  return dirs.find((dir) => file.startsWith(`${dir}/`)) ?? null;
}

// The directories of `dirs` that the changed files touch, in the order they are first touched.
export function touched(changedFiles, dirs) {
  const found = [];
  for (const file of changedFiles) {
    const dir = owner(file, dirs);
    if (dir && !found.includes(dir)) found.push(dir);
  }
  return found;
}

// What a push releases: the touched skills, and the web CLI when one of its files changed.
// The CLI has no SKILL.md, but it has a release of its own.
export function releaseDirs(changedFiles, dirs) {
  const found = touched(changedFiles, dirs);
  const cli = 'plugins/web/cli';
  if (changedFiles.some((file) => file.startsWith(`${cli}/`)) && !found.includes(cli)) found.push(cli);
  return found;
}

// The Tessl plugins to evaluate: the touched ones, or all of them when a file under
// plugins/ changed that belongs to no Tessl plugin (it may be something they share).
export function evalPluginDirs(changedFiles, pluginDirs) {
  const unmatched = changedFiles.some((file) => file.startsWith('plugins/') && !owner(file, pluginDirs));
  return unmatched ? [...pluginDirs] : touched(changedFiles, pluginDirs);
}

// The files that differ, as `git diff --name-only <args>` names them.
export function changedFiles(root, diffArgs) {
  const out = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--name-only', ...diffArgs], { cwd: root, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}
