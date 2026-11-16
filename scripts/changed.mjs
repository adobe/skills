// Prints the directories a change touches, one per line.
//   node scripts/changed.mjs skills <git diff args>          skills that changed
//   node scripts/changed.mjs release <git diff args>         skills to release, and the web CLI
//   node scripts/changed.mjs tessl-plugins <git diff args>   plugins to evaluate: the ones
//                                                            with scenarios in evals/
//   node scripts/changed.mjs plugins <git diff args>         plugins to release: the ones
//                                                            with a root plugin.json
// The git diff args are a range such as `<base> <head>` or `HEAD~1...HEAD`. With
// --fallback <args>, a range that git can't resolve (a force push, a first push) falls
// back to that one. The script runs in the tree to look at; it may live elsewhere.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { changedFiles, evalPluginDirs, pluginDirs, releaseDirs, skillDirs, tesslPluginDirs, touched } from './lib/changed.mjs';

const KINDS = {
  skills: (files, root) => touched(files, skillDirs(root)),
  release: (files, root) => releaseDirs(files, skillDirs(root)),
  // every plugin has a Tessl manifest; an eval needs scenarios as well
  'tessl-plugins': (files, root) => evalPluginDirs(files, tesslPluginDirs(root)).filter((dir) => existsSync(join(root, dir, 'evals'))),
  plugins: (files, root) => touched(files, pluginDirs(root)),
};

const [kind, ...rest] = process.argv.slice(2);
if (!KINDS[kind] || rest.length === 0) {
  console.error(`usage: changed.mjs <${Object.keys(KINDS).join('|')}> <git diff args> [--fallback <git diff args>]`);
  process.exit(2);
}
const at = rest.indexOf('--fallback');
const range = at === -1 ? rest : rest.slice(0, at);
const fallback = at === -1 ? null : rest.slice(at + 1);
const root = process.cwd();
let files;
try {
  files = changedFiles(root, range);
} catch (error) {
  if (!fallback) {
    console.error(`changed.mjs: git diff ${range.join(' ')} failed`);
    process.exit(2);
  }
  files = changedFiles(root, fallback);
}
for (const dir of KINDS[kind](files, root)) console.log(dir);
