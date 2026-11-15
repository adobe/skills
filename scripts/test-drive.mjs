// Installs plugins into the agent CLIs and reports what each client loaded.
//
//   node scripts/test-drive.mjs [options] <plugin dir>…
//   node scripts/test-drive.mjs [options] --changed <git diff args>     the plugins a change touches;
//                                                                 all of them when it changes a CLI
//                                                                 or the test drive itself
//   node scripts/test-drive.mjs [options] --against <tree>          the plugins that differ from
//                                                                 another checkout of the repository
//   node scripts/test-drive.mjs [options] --all
//
//   --build            build the generated manifests first, and put the files back afterwards:
//                      a pull request changes plugin.json and leaves the manifests the clients
//                      read to the Release workflow
//   --bin <dir>        where the CLIs are (default: where setup-agent-clis.mjs put them, or the PATH)
//   --clients a,b      a subset of claude, codex, grok, agy
//   --json <file>      the full result
//   --markdown <file>  the report, as it goes into the step summary
//
// For each plugin and client: a fresh, empty home directory, the client's own install
// command, and the client's own listing of what it loaded (scripts/lib/clients.mjs). No
// sign-in and no model is involved, so this says what a client finds, not what an agent
// does with it.
//
// Fails when a client can't install a plugin, or loads fewer skills than the plugin has
// directly under skills/. A client that is not installed is reported and does not fail the
// run. Hooks and MCP servers that a client does not load are reported, not failed: which
// client runs which is in the README.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { error, summary, table } from './lib/actions.mjs';
import { changedFiles, pluginDirs, touched } from './lib/changed.mjs';
import { CLIENTS, drivers, findCli } from './lib/clients.mjs';
import { isMain } from './lib/is-main.mjs';
import { written } from './rebuild-plugins.mjs';

const frontmatterName = (file) => readFileSync(file, 'utf8').match(/^---\r?\n[\s\S]*?^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1];

// What a plugin ships, read from its files: the skills directly under skills/, whether it has
// an MCP configuration and hooks, and its entry in the marketplace.
export function describePlugin(root, dir) {
  const abs = resolve(root, dir);
  const manifest = JSON.parse(readFileSync(join(abs, 'plugin.json'), 'utf8'));
  const skillsDir = join(abs, 'skills');
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md')))
      .map((entry) => frontmatterName(join(skillsDir, entry.name, 'SKILL.md')) ?? entry.name)
      .sort()
    : [];
  let marketplace = null;
  try {
    const catalog = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
    const listed = (catalog.plugins ?? []).some((entry) => typeof entry.source === 'string' && resolve(root, entry.source) === abs);
    if (listed) marketplace = catalog.name;
  } catch {
    // no marketplace: every plugin is installed from its directory, where a client can
  }
  return {
    dir: abs,
    path: relative(root, abs),
    name: manifest.name,
    version: manifest.version,
    skills,
    hasMcp: existsSync(join(abs, 'mcp.json')) || existsSync(join(abs, '.mcp.json')),
    hasHooks: existsSync(join(abs, 'hooks', 'hooks.json')),
    marketplace,
  };
}

// A fingerprint of a directory: every file below it with a hash of its content.
function fingerprint(dir) {
  const hash = createHash('sha256');
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
      else if (entry.isFile()) hash.update(`${prefix}${entry.name}\0`).update(readFileSync(path)).update('\0');
    }
  };
  walk(dir, '');
  return hash.digest('hex');
}

// The plugins of root that another checkout of the repository doesn't have, or has differently.
export function differingPlugins(root, other) {
  return pluginDirs(root).filter((dir) => !existsSync(join(other, dir, 'plugin.json')) || fingerprint(join(root, dir)) !== fingerprint(join(other, dir)));
}

// Builds the generated manifests in root and returns what puts the files back: a file git
// tracks goes back to what is checked out, a file the build created is removed. A file that
// had changes of its own before the build is left as the build wrote it, and named.
export function buildManifests(root) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const dirty = new Set(git('status', '--porcelain', '-uall').split('\n').filter(Boolean).map((line) => line.slice(3)));
  const tracked = new Set(git('ls-files').split('\n'));
  const build = spawnSync('npx', ['--no-install', 'x927', 'build', '--all'], { cwd: root, encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`x927 build --all failed: ${`${build.stdout ?? ''}${build.stderr ?? ''}`.trim().split('\n').pop()}`);
  const files = written(build.stdout ?? '');
  return () => {
    const kept = [];
    for (const file of files) {
      if (dirty.has(file)) kept.push(file);
      else if (tracked.has(file)) git('checkout', '--', file);
      else rmSync(join(root, file), { force: true });
    }
    return kept;
  };
}

// A change to one of these changes what every plugin's test drive says: the versions of the
// CLIs (Claude Code is in the root package), and the scripts that drive them.
export const TOOLING = [/^scripts\/agent-clis\//, /^scripts\/(setup-agent-clis|test-drive)\.mjs$/, /^scripts\/lib\/clients\.mjs$/, /^package(-lock)?\.json$/];

// The plugins to test-drive for a list of changed files.
export function pluginsToDrive(files, all) {
  return files.some((file) => TOOLING.some((pattern) => pattern.test(file))) ? all : touched(files, all);
}

// What is wrong with one client's result, as the reasons the run fails for.
export function problems(plugin, result) {
  if (result.installed === false) return [`could not install: ${result.notes.join('; ') || 'no reason given'}`];
  if (result.missing || result.installed === null) return [];
  const missing = plugin.skills.filter((skill) => !result.skills.includes(skill));
  return missing.length > 0 ? [`did not load ${missing.length} of ${plugin.skills.length} skills: ${missing.join(', ')}`] : [];
}

const count = (value) => (Array.isArray(value) ? value.length : Number(value) || 0);
const cell = (loaded, shipped, names) => {
  if (loaded === null) return shipped ? 'not checked' : '';
  const n = count(loaded);
  if (!shipped && n === 0) return '';
  if (n === 0) return 'not loaded';
  return Array.isArray(names) && names.length > 0 ? `${n} (${names.join(', ')})` : String(n);
};

// The report of one plugin: a table with a row per client, and the notes below it.
export function report(plugin, results) {
  const rows = Object.entries(results).map(([client, result]) => {
    if (result.missing) return [client, 'CLI not installed', '', '', ''];
    if (result.installed === null) return [client, 'not installed', '', '', ''];
    if (result.installed === false) return [client, '❌ failed', '', '', ''];
    const bad = problems(plugin, result).length > 0;
    const extra = result.skills.filter((skill) => !plugin.skills.includes(skill)).length;
    return [
      client,
      bad ? '❌ installed' : '✅ installed',
      extra > 0 ? `${result.skills.length - extra} of ${plugin.skills.length}, and ${extra} from deeper folders` : `${result.skills.length} of ${plugin.skills.length}`,
      cell(result.mcpServers, plugin.hasMcp, result.mcpServers),
      cell(result.hooks, plugin.hasHooks, Array.isArray(result.hooks) ? result.hooks : []),
    ];
  });
  const lines = [`### ${plugin.name} ${plugin.version ?? ''} (\`${plugin.path}\`)`, '', ...table(['Client', 'Install', 'Skills loaded', 'MCP servers', 'Hooks'], rows)];
  const notes = Object.entries(results).flatMap(([client, result]) => [...problems(plugin, result), ...(result.notes ?? [])].map((note) => `- **${client}:** ${note}`));
  if (notes.length > 0) lines.push('', ...notes.slice(0, 40));
  if (notes.length > 40) lines.push(`- … and ${notes.length - 40} more, in the JSON result`);
  return lines;
}

function parse(argv) {
  const options = { bin: null, build: false, clients: CLIENTS, json: null, markdown: null, changed: null, against: null, all: false, dirs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--all') options.all = true;
    else if (arg === '--build') options.build = true;
    else if (arg === '--bin') options.bin = argv[++index];
    else if (arg === '--against') options.against = argv[++index];
    else if (arg === '--clients') options.clients = argv[++index].split(',').map((name) => name.trim()).filter(Boolean);
    else if (arg === '--json') options.json = argv[++index];
    else if (arg === '--markdown') options.markdown = argv[++index];
    else if (arg === '--changed') {
      options.changed = argv.slice(index + 1);
      break;
    } else if (arg.startsWith('--')) return null;
    else options.dirs.push(arg);
  }
  const unknown = options.clients.filter((name) => !CLIENTS.includes(name));
  return unknown.length > 0 ? null : options;
}

function main() {
  const root = process.cwd();
  const options = parse(process.argv.slice(2));
  if (!options || (!options.all && !options.changed && !options.against && options.dirs.length === 0)) {
    console.error(`usage: test-drive.mjs [--build] [--bin <dir>] [--clients ${CLIENTS.join(',')}] [--json <file>] [--markdown <file>] (<plugin dir>… | --changed <git diff args> | --against <tree> | --all)`);
    process.exit(2);
  }
  const all = pluginDirs(root);
  const dirs = options.all ? all : options.changed ? pluginsToDrive(changedFiles(root, options.changed), all) : options.against ? differingPlugins(root, resolve(options.against)) : options.dirs;
  const lines = ['## Plugin test drive', ''];
  if (dirs.length === 0) {
    lines.push('No plugin is touched by this change.');
    summary(lines);
    if (options.markdown) writeFileSync(options.markdown, `${lines.join('\n')}\n`);
    if (options.json) writeFileSync(options.json, '[]\n');
    console.log('No plugin to test-drive.');
    return;
  }
  lines.push('Each plugin installed into each client with an empty home directory, and what the client then lists. No sign-in, no model.', '');
  const output = [];
  let failures = 0;
  const restore = options.build ? buildManifests(root) : () => [];
  try {
    for (const dir of dirs) {
      const plugin = describePlugin(root, dir);
      const results = {};
      for (const client of options.clients) {
        const cli = findCli(client, { bin: options.bin, root });
        if (!cli) {
          results[client] = { missing: true, notes: [] };
          continue;
        }
        const home = mkdtempSync(join(tmpdir(), `test-drive-${client}-`));
        try {
          results[client] = drivers[client]({ bin: cli, home, plugin, repoRoot: root });
        } catch (thrown) {
          results[client] = { installed: false, skills: [], mcpServers: [], hooks: 0, notes: [thrown.message] };
        } finally {
          rmSync(home, { recursive: true, force: true });
        }
        for (const problem of problems(plugin, results[client])) {
          failures += 1;
          error(`${plugin.name} in ${client}: ${problem}`);
        }
      }
      output.push({ plugin: { ...plugin, dir: plugin.path }, results });
      lines.push(...report(plugin, results), '');
      console.log(`${plugin.name}: ${Object.entries(results).map(([client, result]) => `${client} ${result.missing ? 'n/a' : result.installed === null ? 'skipped' : result.installed ? `${result.skills.filter((skill) => plugin.skills.includes(skill)).length}/${plugin.skills.length}` : 'FAILED'}`).join(', ')}`);
    }
  } finally {
    for (const file of restore()) console.log(`${file} had changes of its own and stays as the build wrote it.`);
  }
  summary(lines);
  if (options.markdown) writeFileSync(options.markdown, `${lines.join('\n')}\n`);
  if (options.json) writeFileSync(options.json, `${JSON.stringify(output, null, 2)}\n`);
  if (failures > 0) {
    error(`${failures} problem(s) in the test drive`);
    process.exit(1);
  }
}

if (isMain(import.meta.url)) main();
