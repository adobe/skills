// Rules for skills that `skills-ref validate` doesn't know:
//
//   too-long                   a SKILL.md has more than 500 lines
//   duplicate-in-plugin        two skills of one plugin share a name
//   duplicate-across-plugins   skills of different plugins share a name (GitHub Copilot CLI
//                              exposes skills under their bare name)
//   orphaned                   no client finds the skill: it is in no plugin, or it lies
//                              deeper than skills/<name>/SKILL.md and the plugin's Claude
//                              Code manifest doesn't list its folder. Clients read the
//                              folders directly under skills/ and don't look further
//                              (https://agent-plugins.org/specification, Skills).
//
// main has skills that break them, so the rules are enforced the boy-scout way
// (.boy-scout.json): a pull request that changes a SKILL.md which breaks a rule has to fix
// it, and nobody has to fix a file they didn't touch. Run from the repository root:
//   node scripts/check-skills.mjs                 what breaks which rule today
//   node scripts/check-skills.mjs --list <rule>   the SKILL.md files that break one rule
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { isMain } from './lib/is-main.mjs';

export const MAX_LINES = 500;
export const RULES = ['too-long', 'duplicate-in-plugin', 'duplicate-across-plugins', 'orphaned'];
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

// The plugin a skill belongs to: the nearest directory above it with a manifest. That is
// the Claude Code manifest, or the root plugin.json it is generated from: a new plugin in
// a pull request has only the second until CI has built the first.
function pluginOf(root, file) {
  for (let dir = dirname(file); dir.startsWith(root) && dir !== root; dir = dirname(dir)) {
    if (existsSync(join(dir, '.claude-plugin', 'plugin.json')) || existsSync(join(dir, 'plugin.json'))) return dir;
  }
  return null;
}

const posix = (path) => path.split(sep).join('/');

// The directories of a plugin that a client scans for skills: skills/, and what the Claude
// Code manifest lists under "skills". An entry there is a directory of skill folders or one
// skill folder, so a skill is found when its folder, or the folder above it, is scanned.
function scannedDirs(plugin) {
  const dirs = [join(plugin, 'skills')];
  const read = (...path) => JSON.parse(readFileSync(join(plugin, ...path), 'utf8'));
  try {
    // from the root plugin.json where there is one: the Claude Code manifest is built from it
    const listed = existsSync(join(plugin, 'plugin.json'))
      ? read('plugin.json').extensions?.['io.github.ai-ecoverse.x927']?.targets?.claude?.skills
      : read('.claude-plugin', 'plugin.json').skills;
    for (const entry of [listed ?? []].flat()) {
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

// Every violation under root/plugins, as { rule, file, detail }, sorted. file is the SKILL.md.
export function findViolations(root) {
  const scanned = new Map();
  const skills = walk(join(root, 'plugins')).map((path) => {
    const text = readFileSync(path, 'utf8');
    const file = posix(relative(root, path));
    const plugin = pluginOf(root, path);
    return {
      file,
      name: frontmatterName(text) ?? dirname(file).split('/').pop(),
      plugin,
      lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0),
      orphan: orphanReason(root, path, plugin, scanned),
    };
  });
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
  }
  return violations.sort((a, b) => `${a.rule} ${a.file}`.localeCompare(`${b.rule} ${b.file}`));
}

function main() {
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
