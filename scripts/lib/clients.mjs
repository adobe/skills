// The four agent CLIs that CI installs plugins into, and how to ask each what it loaded.
//
// Every driver installs one plugin into a client that has an empty home directory, so that
// nothing of the machine's own configuration leaks in, and returns what the client says it
// loaded: { installed, skills, mcpServers, hooks, notes } (skills as names; hooks as a count,
// as event names, or null when the client can't be asked). None of this needs a sign-in or a model.
//
// What each client offers for that, checked with claude 2.1.322, codex 0.169.0, grok 1.0.77
// and agy 1.5.9:
//   claude  marketplace add + plugin install (a plugin has to be in the marketplace);
//           `plugin details` prints the inventory and the projected token cost
//   codex   plugin marketplace add + plugin add; skills are in `debug prompt-input`,
//           MCP servers in `mcp list --json`. Codex runs plugin hooks, but has no command
//           that lists them, so hooks are null: not checked.
//   grok    plugin install <path> --trust; `inspect --json` lists skills, hooks and servers
//   agy     plugin validate --json (findings), plugin install, plugin list --json
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

export const CLIENTS = ['claude', 'codex', 'grok', 'agy'];

// Where a CLI is: in the directory given, in the one setup-agent-clis.mjs filled (in CI below
// RUNNER_TEMP, locally .agent-clis/bin in the repository), or anywhere on the PATH. Null when
// it is not installed.
export function findCli(name, { bin, root = process.cwd(), env = process.env } = {}) {
  const dirs = bin ? [resolve(bin)] : [
    env.AGENT_CLIS_BIN,
    env.RUNNER_TEMP && join(env.RUNNER_TEMP, 'agent-clis', 'bin'),
    join(root, '.agent-clis', 'bin'),
    ...(env.PATH ?? '').split(delimiter),
  ].filter(Boolean);
  return dirs.map((dir) => join(dir, name)).find((path) => existsSync(path)) ?? null;
}

const text = (result) => `${result.stdout ?? ''}${result.stderr ?? ''}`;
const lastLine = (result) => text(result).trim().split('\n').filter(Boolean).pop() ?? `exit ${result.status}`;
const json = (result) => {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
};

// Runs a CLI in its own home, without the caller's credentials or configuration.
export function runner(bin, home, extra = {}) {
  mkdirSync(home, { recursive: true });
  const env = { PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR ?? '/tmp', LANG: 'C.UTF-8', TERM: 'dumb', NO_COLOR: '1', CI: '1', COLUMNS: '400', ...extra };
  return (args, { cwd = home } = {}) => spawnSync(bin, args, { cwd, env, encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
}

// ---- what the clients print ----

// `claude plugin details`: the counts of the inventory, the names from the table of
// components (the inventory line is cut off for a long list), and the always-on tokens.
export function parseClaudeDetails(output) {
  const count = (label) => Number(output.match(new RegExp(`^\\s*${label} \\((\\d+)\\)`, 'm'))?.[1] ?? 0);
  const names = (label) => (output.match(new RegExp(`^\\s*${label} \\(\\d+\\)[ \\t]+(.*)$`, 'm'))?.[1] ?? '')
    .replace(/\s*\(.*$/, '').split(',').map((name) => name.trim()).filter(Boolean);
  const table = output.split(/^\s*component\s+always-on\s+on-invoke\s*$/m)[1] ?? '';
  const components = [...table.matchAll(/^\s{2}(\S+)\s+~([\d.,k]+)\s+~([\d.,k]+)\s*$/gm)].map((match) => ({ name: match[1], alwaysOn: tokens(match[2]), onInvoke: tokens(match[3]) }));
  const skillCount = count('Skills');
  return {
    skills: components.length >= skillCount ? components.slice(0, components.length).map((component) => component.name).sort() : names('Skills').sort(),
    skillCount,
    hooks: names('Hooks'),
    mcpServers: names('MCP servers'),
    agents: count('Agents'),
    alwaysOnTokens: tokens(output.match(/Always-on:\s+~([\d.,k]+) tok/)?.[1] ?? '0'),
    components,
  };
}
function tokens(value) {
  const number = Number(String(value).replace(/,/g, '').replace(/k$/, ''));
  return /k$/.test(String(value)) ? Math.round(number * 1000) : number;
}

// `codex debug prompt-input`: the skills of a plugin are listed as "<plugin>:<skill>: <description>".
export function parseCodexSkills(output, plugin) {
  const escaped = plugin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...new Set([...output.matchAll(new RegExp(`(?:^|[^\\w-])${escaped}:([a-z0-9][a-z0-9_.-]*):`, 'g'))].map((match) => match[1]))].sort();
}

// `grok inspect --json`: everything Grok discovered, each entry with the plugin it came from.
export function parseGrokInspect(inspect, plugin) {
  const mine = (entry) => entry?.source?.type === 'plugin' && entry.source.plugin_name === plugin;
  return {
    skills: (inspect?.skills ?? []).filter(mine).map((skill) => skill.name).sort(),
    hooks: (inspect?.hooks ?? []).filter(mine).length,
    mcpServers: (inspect?.mcpServers ?? []).filter(mine).map((server) => server.name).sort(),
  };
}

// `agy plugin validate --json`: findings that are not notes, as "file: message".
export function agyWarnings(validation) {
  return (validation?.findings ?? []).filter((finding) => finding.severity !== 'note').map((finding) => `${finding.file}: ${finding.message}`);
}

// ---- the drivers ----

const failed = (step, result) => ({ installed: false, skills: [], mcpServers: [], hooks: 0, notes: [`${step}: ${lastLine(result)}`] });

export const drivers = {
  claude({ bin, home, plugin, repoRoot }) {
    const run = runner(bin, home);
    const validated = run(['plugin', 'validate', plugin.dir]);
    if (!plugin.marketplace) {
      return { installed: null, skills: [], mcpServers: [], hooks: 0, notes: [validated.status === 0 ? 'not in the marketplace: validated, not installed' : `validate: ${lastLine(validated)}`] };
    }
    const added = run(['plugin', 'marketplace', 'add', repoRoot]);
    if (added.status !== 0) return failed('marketplace add', added);
    const installed = run(['plugin', 'install', `${plugin.name}@${plugin.marketplace}`]);
    if (installed.status !== 0) return failed('install', installed);
    const details = parseClaudeDetails(text(run(['plugin', 'details', plugin.name])));
    return {
      installed: true,
      skills: details.skills,
      mcpServers: details.mcpServers,
      hooks: details.hooks,
      alwaysOnTokens: details.alwaysOnTokens,
      notes: validated.status === 0 ? [] : [`validate: ${lastLine(validated)}`],
    };
  },

  codex({ bin, home, plugin, repoRoot }) {
    const run = runner(bin, home, { CODEX_HOME: join(home, '.codex') });
    mkdirSync(join(home, '.codex'), { recursive: true });
    if (!plugin.marketplace) return { installed: null, skills: [], mcpServers: [], hooks: 0, notes: ['not in the marketplace: Codex installs from a marketplace only'] };
    const added = run(['plugin', 'marketplace', 'add', repoRoot]);
    if (added.status !== 0) return failed('marketplace add', added);
    const installed = run(['plugin', 'add', `${plugin.name}@${plugin.marketplace}`]);
    if (installed.status !== 0) return failed('plugin add', installed);
    const servers = json(run(['mcp', 'list', '--json'])) ?? [];
    return {
      installed: true,
      skills: parseCodexSkills(text(run(['debug', 'prompt-input', 'x'])), plugin.name),
      mcpServers: servers.map((server) => server.name).sort(),
      hooks: null,
      notes: [],
    };
  },

  grok({ bin, home, plugin }) {
    const run = runner(bin, home);
    const validated = run(['plugin', 'validate', plugin.dir]);
    // an absolute path: Grok reads "plugins/x" as the GitHub repository plugins/x
    const installed = run(['plugin', 'install', plugin.dir, '--trust']);
    if (installed.status !== 0) return failed('install', installed);
    const inspect = parseGrokInspect(json(run(['inspect', '--json'])), plugin.name);
    return { installed: true, ...inspect, notes: validated.status === 0 ? [] : [`validate: ${lastLine(validated)}`] };
  },

  agy({ bin, home, plugin }) {
    const run = runner(bin, home);
    const validation = json(run(['plugin', 'validate', '--json', plugin.dir]));
    const installed = run(['plugin', 'install', plugin.dir]);
    if (installed.status !== 0) return failed('install', installed);
    const listed = (json(run(['plugin', 'list', '--json'])) ?? []).find((entry) => entry.name === plugin.name);
    if (!listed) return { installed: false, skills: [], mcpServers: [], hooks: 0, notes: ['installed, but not in `agy plugin list`'] };
    return {
      installed: true,
      skills: [...(listed.skills ?? [])].sort(),
      mcpServers: [...(listed.mcpServers ?? [])].sort(),
      hooks: listed.hooks ?? 0,
      notes: agyWarnings(validation),
    };
  },
};
