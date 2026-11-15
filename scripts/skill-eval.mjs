// Runs one task in an agent CLI twice, with a plugin installed and without it, and prints
// what each run answered and which files it wrote. For a reviewer who wants to see what a
// skill changes: the comparison is the eval, and the reviewer is the judge.
//
//   node scripts/skill-eval.mjs --client claude|codex|grok|agy --plugin <plugin dir>
//        (--task <file> | --prompt <text> | --scenario <plugin>/evals/<name>) [options]
//
//   --bin <dir>        where the CLIs are (default: where setup-agent-clis.mjs put them, or the PATH)
//   --model <id>       the model, as the client names it (default: MODELS below, or the client's own)
//   --arms with,without   which runs to make (default: both)
//   --workdir <dir>    files the task starts from; copied, never changed
//   --max-turns <n>    for the clients that take it (default 30)
//   --timeout <sec>    for each run (default 600)
//   --out <dir>        where the transcripts go (default: a new temporary directory)
//   --auth-home <dir>  copy the client's stored sign-in from this home directory, to run with
//                      your own subscription on your own machine
//
// --scenario takes the task from <dir>/task.md, starts from <dir>/resources/ when there is
// one, and adds <dir>/criteria.json to the result for the judge. It does not run a
// scenario's setup.sh or fetch the fixtures of a scenario.json: it says so in the result.
//
// Each run gets an empty home directory and its own copy of the work directory. Both runs
// are told to stay in that directory (RULES below); nothing enforces it, so read the
// transcript when the run without the plugin knows what only the skill says. The agent in
// a run may do anything the runner may: this is for plugins from a branch of this repository,
// on a machine that holds nothing the agent must not see. Credentials come from the
// environment and are handed to the client only, never printed:
//   claude  AWS_BEARER_TOKEN_BEDROCK (as in CI), or ANTHROPIC_API_KEY
//   codex   AWS_BEARER_TOKEN_BEDROCK (as in CI), or OPENAI_API_KEY
//   grok    XAI_API_KEY
//   agy     GEMINI_API_KEY
// Exit 3 when the client has no credentials here, 2 for wrong arguments, 1 when a run failed.
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { CLIENTS, findCli } from './lib/clients.mjs';
import { isMain } from './lib/is-main.mjs';
import { describePlugin } from './test-drive.mjs';

// Put in front of the task in both runs. Without it, the run without the plugin goes looking:
// an agent with an empty work directory searched the disk and answered from a copy of the
// skill it found in another checkout. This is an instruction, not a sandbox.
export const RULES = 'Rules for this run: work in the current directory, with the skills and tools you have. Do not search this machine for skills, plugins or documentation outside the current directory.';

// The models CI's Bedrock key can reach, as the review workflow names them. Used when the
// run is on Bedrock and no --model is given.
export const MODELS = { claude: 'global.anthropic.claude-opus-5-5', codex: 'global.openai.gpt-6.1-sol' };

const BEDROCK = ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_REGION', 'AWS_DEFAULT_REGION'];

// What each client needs: the variables that are credentials, the stored sign-in a local
// run can copy, how the plugin gets in, and the command of a headless run.
export const RUNNERS = {
  claude: {
    credentials: (env) => (env.ANTHROPIC_API_KEY ? ['ANTHROPIC_API_KEY'] : env.AWS_BEARER_TOKEN_BEDROCK ? BEDROCK : null),
    needs: 'AWS_BEARER_TOKEN_BEDROCK, or ANTHROPIC_API_KEY',
    stored: ['.claude/.credentials.json'],
    bedrock: (env) => Boolean(env.AWS_BEARER_TOKEN_BEDROCK) && !env.ANTHROPIC_API_KEY,
    env: (home, bedrock) => (bedrock ? { CLAUDE_CODE_USE_BEDROCK: '1' } : {}),
    // the plugin is loaded from its directory for this run: nothing to install
    command: ({ prompt, model, maxTurns, plugin, withPlugin }) => [
      '-p', prompt, '--output-format', 'json', '--permission-mode', 'bypassPermissions', '--max-turns', String(maxTurns),
      ...(model ? ['--model', model] : []), ...(withPlugin ? ['--plugin-dir', plugin.dir] : []),
    ],
    answer: ({ stdout }) => {
      try {
        const result = JSON.parse(stdout);
        return { text: result.result ?? '', turns: result.num_turns, costUsd: result.total_cost_usd, failed: Boolean(result.is_error) };
      } catch {
        return { text: stdout };
      }
    },
  },
  codex: {
    credentials: (env) => (env.OPENAI_API_KEY ? ['OPENAI_API_KEY'] : env.AWS_BEARER_TOKEN_BEDROCK ? BEDROCK : null),
    needs: 'AWS_BEARER_TOKEN_BEDROCK, or OPENAI_API_KEY',
    stored: ['.codex/auth.json'],
    bedrock: (env) => Boolean(env.AWS_BEARER_TOKEN_BEDROCK) && !env.OPENAI_API_KEY,
    env: (home) => ({ CODEX_HOME: join(home, '.codex') }),
    prepare({ run, home, plugin, withPlugin, repoRoot, bedrock }) {
      mkdirSync(join(home, '.codex'), { recursive: true });
      if (bedrock) writeFileSync(join(home, '.codex', 'config.toml'), 'model_provider = "amazon-bedrock-runtime"\n');
      if (!withPlugin) return null;
      if (!plugin.marketplace) return 'Codex installs from a marketplace only, and this plugin is not in .claude-plugin/marketplace.json';
      for (const args of [['plugin', 'marketplace', 'add', repoRoot], ['plugin', 'add', `${plugin.name}@${plugin.marketplace}`]]) {
        const result = run(args);
        if (result.status !== 0) return `codex ${args.slice(0, 3).join(' ')} failed: ${`${result.stdout}${result.stderr}`.trim().split('\n').pop()}`;
      }
      return null;
    },
    command: ({ prompt, model, workdir, lastMessage }) => [
      'exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '-C', workdir, '-o', lastMessage,
      ...(model ? ['-m', model] : []), prompt,
    ],
    answer: ({ stdout, lastMessage }) => ({ text: existsSync(lastMessage) ? readFileSync(lastMessage, 'utf8') : stdout }),
  },
  grok: {
    credentials: (env) => (env.XAI_API_KEY ? ['XAI_API_KEY'] : null),
    needs: 'XAI_API_KEY',
    stored: ['.grok/auth.json'],
    prepare({ run, plugin, withPlugin }) {
      if (!withPlugin) return null;
      const result = run(['plugin', 'install', plugin.dir, '--trust']);
      return result.status === 0 ? null : `grok plugin install failed: ${`${result.stdout}${result.stderr}`.trim().split('\n').pop()}`;
    },
    command: ({ prompt, model, maxTurns, workdir }) => [
      '-p', prompt, '--output-format', 'json', '--permission-mode', 'bypassPermissions', '--cwd', workdir, '--max-turns', String(maxTurns),
      ...(model ? ['-m', model] : []),
    ],
    answer: ({ stdout }) => {
      try {
        const result = JSON.parse(stdout);
        return { text: result.text ?? result.result ?? stdout, turns: result.num_turns, costUsd: result.total_cost_usd };
      } catch {
        return { text: stdout };
      }
    },
  },
  agy: {
    credentials: (env) => (env.GEMINI_API_KEY ? ['GEMINI_API_KEY'] : null),
    needs: 'GEMINI_API_KEY',
    stored: [],
    prepare({ run, plugin, withPlugin }) {
      if (!withPlugin) return null;
      const result = run(['plugin', 'install', plugin.dir]);
      return result.status === 0 ? null : `agy plugin install failed: ${`${result.stdout}${result.stderr}`.trim().split('\n').pop()}`;
    },
    command: ({ prompt, model }) => ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions', ...(model ? ['--model', model] : [])],
    answer: ({ stdout }) => {
      try {
        const result = JSON.parse(stdout);
        return { text: result.result ?? result.response ?? result.text ?? stdout };
      } catch {
        return { text: stdout };
      }
    },
  },
};

// The files below dir, as { path, bytes }, without what a client keeps for itself.
export function listFiles(dir, base = dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.claude', '.codex', '.grok', '.gemini'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(path, base, found);
    else if (entry.isFile()) found.push({ path: relative(base, path), bytes: statSync(path).size });
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

// The files a run added or changed, compared with the listing before it.
export function changedSince(before, after) {
  const was = new Map(before.map((file) => [file.path, file.bytes]));
  return after.filter((file) => was.get(file.path) !== file.bytes);
}

function parse(argv) {
  const options = { arms: ['with', 'without'], maxTurns: 30, timeout: 600 };
  const names = { '--client': 'client', '--plugin': 'plugin', '--task': 'task', '--prompt': 'prompt', '--scenario': 'scenario', '--bin': 'bin', '--model': 'model', '--workdir': 'workdir', '--out': 'out', '--auth-home': 'authHome' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (names[arg]) options[names[arg]] = argv[++index];
    else if (arg === '--arms') options.arms = argv[++index].split(',').map((arm) => arm.trim());
    else if (arg === '--max-turns') options.maxTurns = Number(argv[++index]);
    else if (arg === '--timeout') options.timeout = Number(argv[++index]);
    else return null;
  }
  const sources = [options.task, options.prompt, options.scenario].filter((value) => value !== undefined).length;
  if (!CLIENTS.includes(options.client) || !options.plugin || sources !== 1) return null;
  if (options.arms.length === 0 || options.arms.some((arm) => !['with', 'without'].includes(arm))) return null;
  if (!(options.maxTurns > 0) || !(options.timeout > 0)) return null;
  return options;
}

function main() {
  const root = process.cwd();
  const options = parse(process.argv.slice(2));
  if (!options) {
    console.error(`usage: skill-eval.mjs --client ${CLIENTS.join('|')} --plugin <plugin dir> (--task <file> | --prompt <text> | --scenario <dir>)
       [--bin <dir>] [--model <id>] [--arms with,without] [--workdir <dir>] [--max-turns 30] [--timeout 600] [--out <dir>] [--auth-home <dir>]`);
    process.exit(2);
  }
  const client = RUNNERS[options.client];
  const bin = findCli(options.client, { bin: options.bin, root });
  if (!bin) {
    console.error(`${options.client} is not installed. Run node scripts/setup-agent-clis.mjs first.`);
    process.exit(2);
  }
  const plugin = describePlugin(root, options.plugin);
  const notes = [];
  let prompt = options.prompt;
  let start = options.workdir ? resolve(options.workdir) : null;
  let criteria;
  if (options.task) prompt = readFileSync(options.task, 'utf8');
  if (options.scenario) {
    const scenario = resolve(options.scenario);
    prompt = readFileSync(join(scenario, 'task.md'), 'utf8');
    if (!start && existsSync(join(scenario, 'resources'))) start = join(scenario, 'resources');
    if (existsSync(join(scenario, 'criteria.json'))) criteria = JSON.parse(readFileSync(join(scenario, 'criteria.json'), 'utf8'));
    for (const file of ['setup.sh', 'scenario.json']) {
      if (existsSync(join(scenario, file))) notes.push(`The scenario has a ${file}, which this runner does not run or read: the work directory lacks what it would have set up.`);
    }
  }

  const stored = options.authHome ? client.stored.filter((file) => existsSync(join(resolve(options.authHome), file))) : [];
  const credentials = client.credentials(process.env) ?? (stored.length > 0 ? [] : null);
  if (!credentials) {
    console.error(`No credentials for ${options.client} here. It needs ${client.needs}${client.stored.length > 0 ? ', or --auth-home with a home directory that is signed in' : ''}.`);
    process.exit(3);
  }
  const bedrock = Boolean(client.bedrock?.(process.env)) && stored.length === 0;
  const model = options.model ?? (bedrock ? MODELS[options.client] : undefined);
  const out = resolve(options.out ?? mkdtempSync(join(tmpdir(), 'skill-eval-')));
  const result = { client: options.client, model: model ?? 'the client\'s default', plugin: plugin.name, arms: {}, notes, transcripts: out };
  if (criteria) result.criteria = criteria;
  let failed = false;

  for (const arm of options.arms) {
    const withPlugin = arm === 'with';
    const home = mkdtempSync(join(tmpdir(), `skill-eval-${options.client}-home-`));
    const workdir = mkdtempSync(join(tmpdir(), 'skill-eval-work-'));
    const armOut = join(out, `${options.client}-${arm}`);
    mkdirSync(armOut, { recursive: true });
    try {
      if (start) cpSync(start, workdir, { recursive: true });
      for (const file of stored) {
        mkdirSync(dirname(join(home, file)), { recursive: true });
        cpSync(join(resolve(options.authHome), file), join(home, file));
        chmodSync(join(home, file), 0o600);
      }
      const env = { PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR ?? '/tmp', LANG: 'C.UTF-8', TERM: 'dumb', NO_COLOR: '1', CI: '1', ...(client.env?.(home, bedrock) ?? {}) };
      for (const name of credentials) if (process.env[name] !== undefined) env[name] = process.env[name];
      const run = (args, more = {}) => spawnSync(bin, args, { cwd: workdir, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...more });
      const problem = client.prepare?.({ run, home, plugin, withPlugin, repoRoot: root, bedrock });
      if (problem) {
        result.arms[arm] = { error: problem };
        failed = true;
        continue;
      }
      const before = listFiles(workdir);
      const lastMessage = join(armOut, 'last-message.txt');
      const started = Date.now();
      const ran = run(client.command({ prompt: `${RULES}\n\n${prompt}`, model, maxTurns: options.maxTurns, plugin, withPlugin, workdir, lastMessage }), { timeout: options.timeout * 1000 });
      writeFileSync(join(armOut, 'stdout.txt'), ran.stdout ?? '');
      writeFileSync(join(armOut, 'stderr.txt'), ran.stderr ?? '');
      const answer = client.answer({ stdout: ran.stdout ?? '', lastMessage });
      const files = changedSince(before, listFiles(workdir));
      if (files.length > 0) cpSync(workdir, join(armOut, 'workdir'), { recursive: true });
      const timedOut = ran.error?.code === 'ETIMEDOUT';
      result.arms[arm] = {
        exit: timedOut ? `timed out after ${options.timeout} s` : ran.status,
        seconds: Math.round((Date.now() - started) / 1000),
        ...(answer.turns !== undefined ? { turns: answer.turns } : {}),
        ...(answer.costUsd !== undefined ? { costUsd: answer.costUsd } : {}),
        answer: String(answer.text ?? '').slice(0, 8000),
        files,
        ...(ran.status !== 0 && !timedOut ? { stderr: String(ran.stderr ?? '').trim().split('\n').slice(-5).join('\n').slice(0, 1000) } : {}),
      };
      if (ran.status !== 0 || answer.failed) failed = true;
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(workdir, { recursive: true, force: true });
    }
  }
  console.log(JSON.stringify(result, null, 2));
  if (failed) process.exit(1);
}

if (isMain(import.meta.url)) main();
