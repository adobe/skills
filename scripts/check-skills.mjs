// Rules for skills that `skills-ref validate` doesn't know:
//
//   too-long                   a SKILL.md has more than 500 lines
//   duplicate-in-plugin        two skills of one plugin share a name
//   duplicate-across-plugins   skills of different plugins share a name (GitHub Copilot CLI
//                              exposes skills under their bare name)
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
export const RULES = ['too-long', 'duplicate-in-plugin', 'duplicate-across-plugins'];
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

// The plugin a skill belongs to: the nearest directory above it with a Claude manifest.
function pluginOf(root, file) {
  for (let dir = dirname(file); dir.startsWith(root) && dir !== root; dir = dirname(dir)) {
    if (existsSync(join(dir, '.claude-plugin', 'plugin.json'))) return dir;
  }
  return null;
}

const posix = (path) => path.split(sep).join('/');

// Every violation under root/plugins, as { rule, file, detail }, sorted. file is the SKILL.md.
export function findViolations(root) {
  const skills = walk(join(root, 'plugins')).map((path) => {
    const text = readFileSync(path, 'utf8');
    const file = posix(relative(root, path));
    return {
      file,
      name: frontmatterName(text) ?? dirname(file).split('/').pop(),
      plugin: pluginOf(root, path),
      lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0),
    };
  });
  const violations = [];
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
