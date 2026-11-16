// Checks the facts of every plugin (see lib/facts.mjs) against the tree, so that they stay
// true to the skills they are about:
//
//   unreadable     facts.yaml can't be read
//   no-consumer    a fact that no file uses: no skill states it and no eval tests it.
//                  A fact whose line left the skill may stay, to see whether a later model
//                  gets it wrong, as long as an eval tests it
//   missing-file   a file in used_by that isn't in the plugin
//   no-source      a fact that no skill states, without a source: it can't be checked
//
// Run from the repository root: node scripts/check-facts.mjs. It exits 1 when something
// breaks a rule.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseFacts } from './lib/facts.mjs';
import { isMain } from './lib/is-main.mjs';

const SKIP = new Set(['node_modules', '.git']);

// The directories below dir that hold a facts.yaml.
function plugins(dir, found = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === 'facts.yaml')) found.push(dir);
  for (const entry of entries) if (entry.isDirectory() && !SKIP.has(entry.name)) plugins(join(dir, entry.name), found);
  return found;
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

export function findProblems(root) {
  const start = join(root, 'plugins');
  if (!existsSync(start)) return [];
  return plugins(start).sort().flatMap((plugin) => checkFacts(plugin, root));
}

function main() {
  const problems = findProblems(process.cwd());
  for (const { file, detail } of problems) console.log(`${file}: ${detail}`);
  if (problems.length > 0) {
    console.log(`\n${problems.length} problem(s). The rules are at the top of scripts/check-facts.mjs.`);
    process.exit(1);
  }
  console.log('The facts agree with the tree.');
}

if (isMain(import.meta.url)) main();
