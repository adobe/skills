// Checks the facts and the trigger queries of every plugin (see lib/facts.mjs) against the
// tree, so that they stay true to the skills they are about:
//
//   unreadable     facts.yaml or a set of trigger queries can't be read
//   no-consumer    a fact that no file uses: no skill states it and no eval tests it.
//                  A fact whose line left the skill may stay, to see whether a later model
//                  gets it wrong, as long as an eval tests it
//   missing-file   a file in used_by that isn't in the plugin
//   no-source      a fact that no skill states, without a source: it can't be checked
//   unknown-skill  a trigger query about a skill the plugin doesn't have
//
// Run from the repository root: node scripts/check-facts.mjs. It exits 1 when something
// breaks a rule.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseFacts, parseTriggerSet } from './lib/facts.mjs';
import { isMain } from './lib/is-main.mjs';

const SKIP = new Set(['node_modules', '.git']);

// The directories below dir that hold a facts.yaml or a trigger-queries/ directory.
function plugins(dir, found = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  if (entries.some((entry) => (entry.isFile() && entry.name === 'facts.yaml') || (entry.isDirectory() && entry.name === 'trigger-queries'))) found.push(dir);
  for (const entry of entries) if (entry.isDirectory() && !SKIP.has(entry.name) && entry.name !== 'trigger-queries') plugins(join(dir, entry.name), found);
  return found;
}

// The names of a plugin's skills: their folders, and the names in their frontmatter.
export function skillNames(plugin) {
  const dir = join(plugin, 'skills');
  if (!existsSync(dir)) return new Set();
  const names = new Set();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name, 'SKILL.md');
    if (!entry.isDirectory() || !existsSync(file)) continue;
    names.add(entry.name);
    const block = readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
    const name = block?.match(/^name:\s*(.+?)\s*$/m)?.[1];
    if (name) names.add(name.replace(/^['"]|['"]$/g, ''));
  }
  return names;
}

export function checkFacts(plugin, root = plugin) {
  const file = join(plugin, 'facts.yaml');
  const at = relative(root, file);
  let facts;
  try {
    facts = parseFacts(readFileSync(file, 'utf8'), at);
  } catch (error) {
    return [{ rule: 'unreadable', file: at, detail: error.message }];
  }
  const found = [];
  for (const fact of facts) {
    const where = { file: at, id: fact.id };
    if (fact.used_by.length === 0) found.push({ rule: 'no-consumer', ...where, detail: `${fact.id}: no skill states it and no eval tests it` });
    for (const path of fact.used_by) {
      if (!existsSync(join(plugin, path))) found.push({ rule: 'missing-file', ...where, detail: `${fact.id}: ${path} is not in the plugin` });
    }
    const inSkill = fact.used_by.some((path) => path.split(/[\\/]/)[0] === 'skills');
    if (!inSkill && !fact.source?.trim()) found.push({ rule: 'no-source', ...where, detail: `${fact.id}: no skill states it, and it has no source` });
  }
  return found;
}

export function checkTriggerSets(plugin, root = plugin) {
  const dir = join(plugin, 'trigger-queries');
  if (!existsSync(dir)) return [];
  const skills = skillNames(plugin);
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
      if (!skills.has(skill)) found.push({ rule: 'unknown-skill', file: at, detail: `${skill} is not a skill of ${relative(root, plugin).split(sep).join('/')}` });
    }
  }
  return found;
}

export function findProblems(root) {
  const start = join(root, 'plugins');
  if (!existsSync(start)) return [];
  return plugins(start).sort().flatMap((plugin) => [
    ...(existsSync(join(plugin, 'facts.yaml')) ? checkFacts(plugin, root) : []),
    ...checkTriggerSets(plugin, root),
  ]);
}

function main() {
  const problems = findProblems(process.cwd());
  for (const { file, detail } of problems) console.log(`${file}: ${detail}`);
  if (problems.length > 0) {
    console.log(`\n${problems.length} problem(s). The rules are at the top of scripts/check-facts.mjs.`);
    process.exit(1);
  }
  console.log('Facts and trigger queries agree with the tree.');
}

if (isMain(import.meta.url)) main();
