// Checks the trigger queries of every plugin (see lib/triggers.mjs) against the tree:
//
//   unreadable     a set can't be read: not JSON, no queries, a query without its fields
//   unknown-skill  a query about a skill the plugin doesn't have
//
// Whether a query still fits its skill's description takes reading both: the AI review
// does that for the sets and descriptions a pull request changes.
//
// Run from the repository root: node scripts/check-trigger-queries.mjs. It exits 1 when
// something breaks a rule.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { isMain } from './lib/is-main.mjs';
import { parseTriggerSet } from './lib/triggers.mjs';

const SKIP = new Set(['node_modules', '.git']);

function sets(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP.has(entry.name)) continue;
    if (entry.name === 'trigger-queries') found.push(join(dir, entry.name));
    else sets(join(dir, entry.name), found);
  }
  return found;
}

// The names of a plugin's skills: their folders, and the names in their frontmatter.
export function skillNames(plugin) {
  const dir = join(plugin, 'skills');
  const names = new Set();
  if (!existsSync(dir)) return names;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name, 'SKILL.md');
    if (!entry.isDirectory() || !existsSync(file)) continue;
    names.add(entry.name);
    const block = readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
    const name = block?.match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1];
    if (name) names.add(name);
  }
  return names;
}

export function checkTriggerSets(dir, root = dir) {
  const skills = skillNames(dirname(dir));
  const found = [];
  for (const name of readdirSync(dir).filter((entry) => entry.endsWith('.json')).sort()) {
    const at = relative(root, join(dir, name));
    let set;
    try {
      set = parseTriggerSet(readFileSync(join(dir, name), 'utf8'), at);
    } catch (error) {
      found.push({ rule: 'unreadable', file: at, detail: error.message });
      continue;
    }
    for (const skill of new Set(set.queries.map((query) => query.skill))) {
      if (!skills.has(skill)) found.push({ rule: 'unknown-skill', file: at, detail: `${skill} is not a skill of this plugin` });
    }
  }
  return found;
}

export function findProblems(root) {
  const start = join(root, 'plugins');
  if (!existsSync(start)) return [];
  return sets(start).sort().flatMap((dir) => checkTriggerSets(dir, root));
}

function main() {
  const problems = findProblems(process.cwd());
  for (const { file, detail } of problems) console.log(`${file}: ${detail}`);
  if (problems.length > 0) {
    console.log(`\n${problems.length} problem(s). The rules are at the top of scripts/check-trigger-queries.mjs.`);
    process.exit(1);
  }
  console.log('The trigger queries agree with the tree.');
}

if (isMain(import.meta.url)) main();
