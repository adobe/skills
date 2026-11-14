// Two rules for what is in plugins/, with one error annotation per violation:
//   codeowners   every plugin (a directory with .claude-plugin/plugin.json) has a line in
//                .github/CODEOWNERS that starts with its path
//   license      every SKILL.md has a license field in its frontmatter
//   node scripts/check-plugins.mjs codeowners|license      (from the repository root)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { summary, table } from './lib/actions.mjs';
import { isMain } from './lib/is-main.mjs';

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

const files = (root) => walk(join(root, 'plugins')).map((file) => posix(relative(root, file))).sort();

// Plugins without a CODEOWNERS line. A line covers a plugin when it starts with the
// plugin's path, followed by a slash or by white space.
export function uncoveredPlugins(root, codeowners) {
  const suffix = '/.claude-plugin/plugin.json';
  const lines = codeowners.split('\n');
  return files(root)
    .filter((file) => file.endsWith(suffix))
    .map((file) => `/${file.slice(0, -suffix.length)}`)
    .filter((path) => !lines.some((line) => line.startsWith(`${path}/`) || line.startsWith(`${path} `) || line.startsWith(`${path}\t`)));
}

export function hasLicense(text) {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return Boolean(block && /^license:/m.test(block[1]));
}

// Every SKILL.md, with whether it has a license field.
export function licenses(root) {
  return files(root)
    .filter((file) => file.endsWith('/SKILL.md') || file === 'SKILL.md')
    .map((file) => ({ file, ok: hasLicense(readFileSync(join(root, file), 'utf8')) }));
}

function main() {
  const root = process.cwd();
  const rule = process.argv[2];
  if (rule === 'codeowners') {
    const file = join(root, '.github', 'CODEOWNERS');
    if (!existsSync(file)) {
      console.log('::error::CODEOWNERS file not found at .github/CODEOWNERS');
      process.exit(1);
    }
    const missing = uncoveredPlugins(root, readFileSync(file, 'utf8'));
    for (const path of missing) console.log(`::error file=.github/CODEOWNERS::${path} is not covered in CODEOWNERS`);
    console.log(missing.length === 0 ? 'All plugin directories are covered in CODEOWNERS.' : `${missing.length} plugin directories are not covered in CODEOWNERS.`);
    process.exit(missing.length === 0 ? 0 : 1);
  }
  if (rule === 'license') {
    const all = licenses(root);
    const missing = all.filter(({ ok }) => !ok);
    summary(['## License Field Check', '', ...table(['Skill', 'Status'], all.map(({ file, ok }) => [file, ok ? '✅ Pass' : '❌ Missing']))]);
    for (const { file } of missing) console.log(`::error file=${file}::SKILL.md has no license field in its frontmatter`);
    console.log(missing.length === 0 ? 'All SKILL.md files have a license field.' : `${missing.length} SKILL.md files have no license field.`);
    process.exit(missing.length === 0 ? 0 : 1);
  }
  console.error('usage: check-plugins.mjs codeowners|license');
  process.exit(2);
}

if (isMain(import.meta.url)) main();
