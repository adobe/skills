// Rules for skills that `skills-ref validate` doesn't know:
//
//   too-long                   a SKILL.md has more than 500 lines
//   over-token-limit           a SKILL.md has more tokens than its skill may have: 5,000 with
//                              an eval, 1,000 without one. What a skill tells an agent is
//                              paid for in every session that loads it; without an eval
//                              nobody has shown that it is worth more than a page. Tokens
//                              are counted as `tessl plugin lint` counts them: a quarter of
//                              the characters, rounded up. An eval of a skill is (see evalOf)
//                                - skills/<skill>/evals/evals.json with a prompt and what is
//                                  expected of the answer, or
//                                - a scenario of its plugin (evals/<scenario>/ with task.md
//                                  and criteria.json) that is named after the skill:
//                                  <skill> or <skill>-<what it tests>, or
//                                - any scenario of its plugin, when the skill is the only one
//   duplicate-in-plugin        two skills of one plugin share a name
//   duplicate-across-plugins   skills of different plugins share a name (GitHub Copilot CLI
//                              exposes skills under their bare name)
//   orphaned                   a client doesn't find the skill: it is in no plugin, or it
//                              lies deeper than skills/<name>/SKILL.md. Clients read the
//                              folders directly under skills/ and don't look further
//                              (https://agent-plugins.org/specification, Skills). Claude
//                              Code also reads the folders its manifest lists, which
//                              counts only for a plugin without a root plugin.json: with
//                              one, GitHub Copilot CLI reads that and not the manifest.
//
// main has skills that break them, so the rules are enforced the boy-scout way
// (.boy-scout.json): a pull request that changes a SKILL.md which breaks a rule has to fix
// it, and nobody has to fix a file they didn't touch. Run from the repository root:
//   node scripts/check-skills.mjs                 what breaks which rule today
//   node scripts/check-skills.mjs --list <rule>   the SKILL.md files that break one rule
//   node scripts/check-skills.mjs --tokens [dir]  every skill (below dir) with its tokens, its
//                                                 limit and its eval
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { isMain } from './lib/is-main.mjs';

export const MAX_LINES = 500;
export const MAX_TOKENS = 5000;
export const MAX_TOKENS_WITHOUT_EVAL = 1000;
export const RULES = ['too-long', 'over-token-limit', 'duplicate-in-plugin', 'duplicate-across-plugins', 'orphaned'];

// The tokens of a text, as `tessl plugin lint` estimates them.
export const tokens = (text) => Math.ceil(text.length / 4);
const SKIP = new Set(['node_modules', '.git']);

function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) walk(join(dir, entry.name), found);
    } else if (entry.name === 'SKILL.md') {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

function frontmatterName(text) {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const name = block?.[1].match(/^name:\s*(.+?)\s*$/m)?.[1];
  return name?.replace(/^(['"])(.*)\1$/, '$2');
}

// The plugin a skill belongs to: the outermost directory above it with a manifest. That is
// the Claude Code manifest, or the root plugin.json it is generated from: a new plugin in
// a pull request has only the second until CI has built the first. The outermost, because
// a plugin.json further down is a file of the plugin (a fixture, an asset of a skill), not
// a plugin of its own, and must not take the skills below it out of their plugin.
function pluginOf(root, file) {
  let plugin = null;
  for (let dir = dirname(file); dir.startsWith(root) && dir !== root; dir = dirname(dir)) {
    if (existsSync(join(dir, '.claude-plugin', 'plugin.json')) || existsSync(join(dir, 'plugin.json'))) plugin = dir;
  }
  return plugin;
}

const posix = (path) => path.split(sep).join('/');

// The directories of a plugin that every client scans for skills. That is skills/. In a
// plugin without a root plugin.json, the clients read the Claude Code manifest, so what it
// lists under "skills" counts too: a directory of skill folders or one skill folder, so a
// skill is found when its folder, or the folder above it, is scanned.
function scannedDirs(plugin) {
  const dirs = [join(plugin, 'skills')];
  if (existsSync(join(plugin, 'plugin.json'))) return dirs;
  try {
    const listed = JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')).skills ?? [];
    for (const entry of [listed].flat()) {
      if (typeof entry === 'string') dirs.push(join(plugin, entry));
    }
  } catch {
    // a manifest that can't be read lists nothing; `claude plugin validate` reports it
  }
  return dirs;
}

// Why no client finds the skill in this SKILL.md, or null when one does.
function orphanReason(root, path, plugin, scanned) {
  if (!plugin) return 'is in no plugin: no directory above it has .claude-plugin/plugin.json';
  const folder = dirname(path);
  const dirs = scanned.get(plugin) ?? scanned.set(plugin, scannedDirs(plugin)).get(plugin);
  if (dirs.some((dir) => dir === folder || dir === dirname(folder))) return null;
  const below = posix(relative(plugin, dirname(folder)));
  return `lies below ${below}/, where no client looks: move it to skills/${folder.split(sep).pop()}/, or make it a reference of the skill above it`;
}

const json = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const filled = (value) => (typeof value === 'string' ? value.trim() !== '' : Array.isArray(value) && value.length > 0);

// The scenarios of a plugin: the folders of evals/ with a task and criteria to judge it by.
function scenariosOf(plugin) {
  const dir = join(plugin, 'evals');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => {
    if (!entry.isDirectory()) return false;
    const task = join(dir, entry.name, 'task.md');
    return existsSync(task) && readFileSync(task, 'utf8').trim() !== '' && filled(json(join(dir, entry.name, 'criteria.json'))?.checklist);
  }).map((entry) => entry.name).sort();
}

// The eval of the skill in folder, as its path, or null when it has none.
// `plugin` is { dir, scenarios, skills } with the names of the folders directly under skills/.
export function evalOf(folder, plugin) {
  const own = join(folder, 'evals', 'evals.json');
  const cases = json(own)?.evals;
  if (Array.isArray(cases) && cases.some((entry) => filled(entry?.prompt) && (filled(entry.expected_output) || filled(entry.assertions) || filled(entry.expectations)))) {
    return own;
  }
  // the rest is for the skills a client finds: the folders directly under the plugin's skills/
  if (!plugin || dirname(folder) !== join(plugin.dir, 'skills')) return null;
  const name = folder.split(sep).pop();
  // a scenario belongs to the skill with the longest name it starts with
  const named = plugin.scenarios.find((scenario) => plugin.skills
    .filter((skill) => scenario === skill || scenario.startsWith(`${skill}-`))
    .sort((a, b) => b.length - a.length)[0] === name);
  if (named) return join(plugin.dir, 'evals', named);
  if (plugin.skills.length === 1 && plugin.scenarios.length > 0) return join(plugin.dir, 'evals', plugin.scenarios[0]);
  return null;
}

// Every SKILL.md under root/plugins with what the rules need to know about it.
export function readSkills(root) {
  const scanned = new Map();
  const plugins = new Map();
  const describe = (dir) => {
    const skills = join(dir, 'skills');
    return {
      dir,
      scenarios: scenariosOf(dir),
      skills: existsSync(skills) ? readdirSync(skills).filter((name) => existsSync(join(skills, name, 'SKILL.md'))) : [],
    };
  };
  return walk(join(root, 'plugins')).map((path) => {
    const text = readFileSync(path, 'utf8');
    const file = posix(relative(root, path));
    const plugin = pluginOf(root, path);
    const evaluated = evalOf(dirname(path), plugin ? plugins.get(plugin) ?? plugins.set(plugin, describe(plugin)).get(plugin) : null);
    return {
      file,
      name: frontmatterName(text) ?? dirname(file).split('/').pop(),
      plugin,
      lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0),
      tokens: tokens(text),
      eval: evaluated ? posix(relative(root, evaluated)) : null,
      limit: evaluated ? MAX_TOKENS : MAX_TOKENS_WITHOUT_EVAL,
      orphan: orphanReason(root, path, plugin, scanned),
    };
  });
}

const thousands = (number) => number.toLocaleString('en-US');

// Every violation under root/plugins, as { rule, file, detail }, sorted. file is the SKILL.md.
export function findViolations(root) {
  const skills = readSkills(root);
  const violations = [];
  for (const skill of skills) {
    if (skill.orphan) violations.push({ rule: 'orphaned', file: skill.file, detail: skill.orphan });
  }
  const byName = new Map();
  for (const skill of skills) byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);
  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    for (const skill of group) {
      const others = group.filter((other) => other !== skill);
      const inPlugin = others.filter((other) => other.plugin === skill.plugin);
      const across = others.filter((other) => other.plugin !== skill.plugin);
      if (inPlugin.length > 0) {
        violations.push({ rule: 'duplicate-in-plugin', file: skill.file, detail: `"${name}" is also the name of ${inPlugin.map((o) => o.file).join(', ')}` });
      }
      if (across.length > 0) {
        violations.push({ rule: 'duplicate-across-plugins', file: skill.file, detail: `"${name}" is also the name of ${across.map((o) => o.file).join(', ')}` });
      }
    }
  }
  for (const skill of skills) {
    if (skill.lines > MAX_LINES) {
      violations.push({ rule: 'too-long', file: skill.file, detail: `${skill.lines} lines (limit ${MAX_LINES})` });
    }
    if (skill.tokens > skill.limit) {
      violations.push({
        rule: 'over-token-limit',
        file: skill.file,
        detail: skill.eval
          ? `${thousands(skill.tokens)} tokens (limit ${thousands(MAX_TOKENS)}; its eval is ${skill.eval})`
          : `${thousands(skill.tokens)} tokens (limit ${thousands(MAX_TOKENS_WITHOUT_EVAL)} without an eval, ${thousands(MAX_TOKENS)} with one)`,
      });
    }
  }
  return violations.sort((a, b) => `${a.rule} ${a.file}`.localeCompare(`${b.rule} ${b.file}`));
}

function main() {
  if (process.argv[2] === '--tokens') {
    const below = (process.argv[3] ?? '').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
    const skills = readSkills(process.cwd()).filter((skill) => below === '' || skill.file.startsWith(`${below}/`));
    for (const skill of skills) {
      console.log(`${skill.tokens > skill.limit ? 'over ' : 'ok   '} ${String(skill.tokens).padStart(6)} of ${String(skill.limit).padStart(4)}  ${skill.file}  ${skill.eval ? `(eval: ${skill.eval})` : '(no eval)'}`);
    }
    return;
  }
  const violations = findViolations(process.cwd());
  const at = process.argv.indexOf('--list');
  if (at !== -1) {
    const rule = process.argv[at + 1];
    if (!RULES.includes(rule)) {
      console.error(`check-skills: --list needs one of ${RULES.join(', ')}`);
      process.exit(2);
    }
    for (const violation of violations) {
      if (violation.rule === rule) console.log(violation.file);
    }
    return;
  }
  for (const rule of RULES) {
    const found = violations.filter((violation) => violation.rule === rule);
    console.log(`${rule}: ${found.length}`);
    for (const { file, detail } of found) console.log(`  ${file}: ${detail}`);
  }
}

if (isMain(import.meta.url)) main();
