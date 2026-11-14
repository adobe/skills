// Rules for what is in plugins/, with one error annotation per violation:
//   codeowners   every plugin (a directory with .claude-plugin/plugin.json) has a line in
//                .github/CODEOWNERS that starts with its path
//   license      every SKILL.md has a license field in its frontmatter
//   hooks        a plugin with a root plugin.json keeps its hooks in hooks/hooks.json and
//                in com.github.copilot/hooks/hooks.json, the same in both
//   source       every plugin has a root plugin.json, from which its manifests are built
//   node scripts/check-plugins.mjs codeowners|license|hooks|source      (from the repository root)
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
// plugin's path, followed by a slash or by white space. A plugin is a directory with a
// Claude Code manifest, or with the root plugin.json that manifest is generated from: a
// new plugin in a pull request has only the second until CI has built the first.
export function uncoveredPlugins(root, codeowners) {
  const lines = codeowners.split('\n');
  const plugins = new Set();
  for (const file of files(root)) {
    const generated = file.match(/^(.+)\/\.claude-plugin\/plugin\.json$/);
    const source = file.match(/^(.+)\/plugin\.json$/);
    if (generated) plugins.add(`/${generated[1]}`);
    else if (source && !source[1].split('/').pop().startsWith('.')) plugins.add(`/${source[1]}`);
  }
  return [...plugins]
    .sort()
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

// A plugin's hooks, where each client that runs hooks looks for them. Claude Code reads
// hooks/hooks.json. GitHub Copilot CLI reads the same file as long as a plugin has no root
// plugin.json; with one, it reads com.github.copilot/hooks/hooks.json and nothing else
// (checked with Copilot CLI 1.0.105). So a plugin with a root plugin.json has both files or
// neither, with the same content, and no hooks inline in its manifest, where only Claude
// Code would find them. Returns what is wrong, as { file, problem }.
export function hookProblems(root) {
  const problems = [];
  const all = files(root);
  const plugins = all.filter((file) => /^plugins\/(?:[^/]+\/)*plugin\.json$/.test(file) && !/\/\.[^/]+\/plugin\.json$/.test(file));
  for (const manifest of plugins) {
    const dir = manifest.slice(0, -'/plugin.json'.length);
    let source;
    try {
      source = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
    } catch {
      continue; // x927 reports a manifest that can't be read
    }
    if (!/agent-plugins\.org\/schemas\//.test(source.$schema ?? '')) continue;
    const claude = `${dir}/hooks/hooks.json`;
    const copilot = `${dir}/com.github.copilot/hooks/hooks.json`;
    const read = (file) => (all.includes(file) ? readFileSync(join(root, file), 'utf8') : null);
    const [forClaude, forCopilot] = [read(claude), read(copilot)];
    if (source.extensions?.['io.github.ai-ecoverse.x927']?.targets?.claude?.hooks !== undefined) {
      problems.push({ file: manifest, problem: `has hooks inline for Claude Code only; put them in ${claude} and ${copilot}` });
    }
    if (forClaude !== null && forCopilot === null) {
      problems.push({ file: claude, problem: `GitHub Copilot CLI does not read this file in a plugin with a root plugin.json; copy it to ${copilot}` });
    } else if (forClaude === null && forCopilot !== null) {
      problems.push({ file: copilot, problem: `Claude Code does not read this file; copy it to ${claude}` });
    } else if (forClaude !== null && forClaude !== forCopilot) {
      problems.push({ file: copilot, problem: `differs from ${claude}; the two have to be the same file, so that each client runs the same hooks` });
    }
  }
  return problems;
}

// Plugins that have a Claude Code manifest and no root plugin.json to build it from. An
// import that copies a plugin's old layout over the new one would leave it like that, and
// x927 leaves such a plugin alone without a word.
export function withoutSource(root) {
  const all = files(root);
  return all
    .filter((file) => file.endsWith('/.claude-plugin/plugin.json'))
    .map((file) => file.slice(0, -'/.claude-plugin/plugin.json'.length))
    .filter((dir) => !all.includes(`${dir}/plugin.json`));
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
  if (rule === 'hooks') {
    const problems = hookProblems(root);
    for (const { file, problem } of problems) console.log(`::error file=${file}::${file} ${problem}`);
    console.log(problems.length === 0 ? 'Every plugin has its hooks where Claude Code and GitHub Copilot CLI look for them.' : `${problems.length} problem(s) with where plugins keep their hooks.`);
    process.exit(problems.length === 0 ? 0 : 1);
  }
  if (rule === 'source') {
    const missing = withoutSource(root);
    for (const dir of missing) console.log(`::error file=${dir}/.claude-plugin/plugin.json::${dir} has no root plugin.json. The manifests are built from that file: add it (npx x927 init ${dir} writes one from the manifests that are there).`);
    console.log(missing.length === 0 ? 'Every plugin has a root plugin.json.' : `${missing.length} plugin(s) have no root plugin.json.`);
    process.exit(missing.length === 0 ? 0 : 1);
  }
  console.error('usage: check-plugins.mjs codeowners|license|hooks|source');
  process.exit(2);
}

if (isMain(import.meta.url)) main();
