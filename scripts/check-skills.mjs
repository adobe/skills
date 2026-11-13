// Rules for skills that `skills-ref validate` doesn't know, with a baseline for the
// violations that existed when the rules arrived (scripts/known-skill-issues.json):
//
//   duplicate-in-plugin        two skills of one plugin share a name
//   duplicate-across-plugins   skills of different plugins share a name (GitHub Copilot CLI
//                              exposes skills under their bare name)
//   too-long                   a SKILL.md has more than 500 lines
//
// A violation that isn't in the baseline fails, and so does a baseline entry that is no
// longer a violation, so the baseline only shrinks. Run from the repository root:
//   node scripts/check-skills.mjs            check
//   node scripts/check-skills.mjs --update   rewrite the baseline (to remove fixed entries)
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_LINES = 500;
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

// Every violation under root/plugins, as { rule, skill, detail }, sorted.
export function findViolations(root) {
  const skills = walk(join(root, 'plugins')).map((file) => {
    const text = readFileSync(file, 'utf8');
    return {
      skill: posix(relative(root, dirname(file))),
      name: frontmatterName(text) ?? posix(relative(root, dirname(file))).split('/').pop(),
      plugin: pluginOf(root, file),
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
        violations.push({ rule: 'duplicate-in-plugin', skill: skill.skill, detail: `"${name}" is also the name of ${inPlugin.map((o) => o.skill).join(', ')}` });
      }
      if (across.length > 0) {
        violations.push({ rule: 'duplicate-across-plugins', skill: skill.skill, detail: `"${name}" is also the name of ${across.map((o) => o.skill).join(', ')}` });
      }
    }
  }
  for (const skill of skills) {
    if (skill.lines > MAX_LINES) {
      violations.push({ rule: 'too-long', skill: skill.skill, detail: `SKILL.md has ${skill.lines} lines; move detail to references/ (limit ${MAX_LINES})` });
    }
  }
  return violations.sort((a, b) => `${a.rule} ${a.skill}`.localeCompare(`${b.rule} ${b.skill}`));
}

const key = ({ rule, skill }) => `${rule} ${skill}`;

// What a baseline says about the violations: the new ones, and the baseline entries that are fixed.
export function compare(violations, baseline) {
  const known = new Set(baseline.map(key));
  const current = new Set(violations.map(key));
  return {
    added: violations.filter((violation) => !known.has(key(violation))),
    fixed: baseline.filter((entry) => !current.has(key(entry))),
  };
}

export function toBaseline(violations) {
  return violations.map(({ rule, skill }) => ({ rule, skill }));
}

function main() {
  const root = process.cwd();
  const baselineFile = join(root, 'scripts', 'known-skill-issues.json');
  const violations = findViolations(root);
  if (process.argv.includes('--update')) {
    writeFileSync(baselineFile, `${JSON.stringify(toBaseline(violations), null, 2)}\n`);
    console.log(`${violations.length} known issue(s) written to scripts/known-skill-issues.json`);
    return;
  }
  const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : [];
  const { added, fixed } = compare(violations, baseline);
  for (const { rule, skill, detail } of added) {
    console.log(`::error file=${skill}/SKILL.md,title=${rule}::${detail}`);
  }
  for (const { rule, skill } of fixed) {
    console.log(`::error file=scripts/known-skill-issues.json,title=fixed::${rule} no longer applies to ${skill}: run node scripts/check-skills.mjs --update and commit the result`);
  }
  console.log(`${violations.length} violation(s): ${violations.length - added.length} known, ${added.length} new, ${fixed.length} fixed but still in the baseline`);
  process.exit(added.length + fixed.length > 0 ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
