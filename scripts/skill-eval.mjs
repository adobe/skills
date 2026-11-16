// Runs one task in an agent CLI twice, with a plugin installed and without it, and prints
// what each run answered and which files it wrote or removed. For a reviewer who wants to see what a
// skill changes: the comparison is the eval, and the reviewer is the judge.
//
//   node scripts/skill-eval.mjs --client claude|codex|grok|agy --plugin <plugin dir>
//        (--task <file> | --prompt <text> | --scenario <plugin>/evals/<name>) [options]
//
//   --bin <dir>        where the CLIs are (default: where setup-agent-clis.mjs put them, or the PATH)
//   --model <id>       the model, as the client names it (default: MODELS below, or the client's own)
//   --base-url <url>   for grok and agy on Bedrock: another OpenAI-compatible endpoint, up to
//                      and with /v1 (default: bedrock-runtime in AWS_REGION, or us-west-2)
//   --arms with,without   which runs to make (default: both)
//   --workdir <dir>    files the task starts from; copied, never changed
//   --no-setup         with --scenario: no setup scripts and no commit fixtures, for a run offline
//   --max-turns <n>    for the clients that take it (default 30)
//   --timeout <sec>    for each run, and each step of setting up a scenario (default 600)
//   --out <dir>        where the transcripts go (default: a new temporary directory)
//   --auth-home <dir>  copy the client's stored sign-in from this home directory, to run with
//                      your own subscription on your own machine
//
// --scenario sets the work directory up as Tessl does before an eval
// (https://docs.tessl.io/reference/configuration#scenariojson): it installs the fixtures of
// <dir>/scenario.json, copies the directories of its include and <dir>/resources/ to the same
// path, and runs the scripts of its setup and then <dir>/setup.sh in the work directory, once
// for each run. It takes the task from <dir>/task.md and adds <dir>/criteria.json to the
// result for the judge. A commit fixture is cloned and a setup script may clone too: both
// need the network. With --no-setup neither happens, and the result says what was left out.
// With --workdir, the scenario is not set up: the directory is taken as it is.
//
// Each run gets an empty home directory and its own copy of the work directory. Both runs
// are told to stay in that directory (RULES below); nothing enforces it, so read the
// transcript when the run without the plugin knows what only the skill says. The agent in
// a run may do anything the runner may: this is for plugins from a branch of this repository,
// on a machine that holds nothing the agent must not see. Credentials come from the
// environment and are handed to the client only, never printed:
//   claude  AWS_BEARER_TOKEN_BEDROCK (as in CI), or ANTHROPIC_API_KEY
//   codex   AWS_BEARER_TOKEN_BEDROCK (as in CI), or OPENAI_API_KEY
//   grok    AWS_BEARER_TOKEN_BEDROCK (as in CI), or XAI_API_KEY
//   agy     AWS_BEARER_TOKEN_BEDROCK (as in CI), or GEMINI_API_KEY
// All four run on the one Bedrock key. Claude Code and Codex know Bedrock themselves. Grok
// and Antigravity are pointed at Bedrock's OpenAI-compatible endpoints, where the key is a
// bearer token: Grok with a model of its own in ~/.grok/config.toml, Antigravity through its
// enterprise gateway mode (AGY_LLM_GATEWAY_*). Bedrock has no Gemini, so Antigravity runs on
// another vendor's model there: such a run tests what Antigravity does with a skill, not
// what Gemini does with it.
// Exit 3 when the client has no credentials here, 2 for wrong arguments, 1 when a run failed.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, matchesGlob, relative, resolve, sep } from 'node:path';
import { CLIENTS, findCli } from './lib/clients.mjs';
import { isMain } from './lib/is-main.mjs';
import { describePlugin } from './test-drive.mjs';

// Put in front of the task in both runs. Without it, the run without the plugin goes looking:
// an agent with an empty work directory searched the disk and answered from a copy of the
// skill it found in another checkout. This is an instruction, not a sandbox.
export const RULES = 'Rules for this run: work in the current directory, with the skills and tools you have. Do not search this machine for skills, plugins or documentation outside the current directory.';

// The models CI's Bedrock key can reach, as the review workflow names them. Used when the
// run is on Bedrock and no --model is given.
export const MODELS = { claude: 'global.anthropic.claude-opus-5-5', codex: 'global.openai.gpt-6.1-sol', grok: 'global.xai.grok-4.6', agy: 'global.xai.grok-4.6' };

// Bedrock's OpenAI-compatible endpoint, for the two clients that need to be told where it
// is. bedrock-runtime serves global.xai.grok-4.6 as the Responses API (what Grok speaks) and
// as Chat Completions (what Antigravity speaks). Antigravity sends function tools with a
// reasoning effort, which Bedrock refuses for global.openai.gpt-6.1-sol on Chat Completions,
// so it runs on Grok's model too. Tried in CI on 2026-11-15; bedrock-mantle with
// xai.grok-4.6 under /openai/v1 worked as well.
const runtime = (region) => `https://bedrock-runtime.${region}.amazonaws.com/openai/v1`;
export const ENDPOINTS = { grok: runtime, agy: runtime };

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
    credentials: (env) => (env.XAI_API_KEY ? ['XAI_API_KEY'] : env.AWS_BEARER_TOKEN_BEDROCK ? ['AWS_BEARER_TOKEN_BEDROCK'] : null),
    needs: 'AWS_BEARER_TOKEN_BEDROCK, or XAI_API_KEY',
    stored: ['.grok/auth.json'],
    bedrock: (env) => Boolean(env.AWS_BEARER_TOKEN_BEDROCK) && !env.XAI_API_KEY,
    prepare({ run, home, plugin, withPlugin, bedrock, model, baseUrl }) {
      if (bedrock) {
        // a model of Grok's own configuration, named "bedrock": the key is read from the
        // environment and sent as a bearer token; Bedrock rejects reasoning.summary
        mkdirSync(join(home, '.grok'), { recursive: true });
        writeFileSync(join(home, '.grok', 'config.toml'), [
          '[model.bedrock]',
          `model = ${JSON.stringify(model)}`,
          `base_url = ${JSON.stringify(baseUrl)}`,
          `name = ${JSON.stringify(`${model} (Amazon Bedrock)`)}`,
          'api_backend = "responses"',
          'reasoning_summary = "none"',
          'env_key = "AWS_BEARER_TOKEN_BEDROCK"',
          '',
        ].join('\n'));
      }
      if (!withPlugin) return null;
      const result = run(['plugin', 'install', plugin.dir, '--trust']);
      return result.status === 0 ? null : `grok plugin install failed: ${`${result.stdout}${result.stderr}`.trim().split('\n').pop()}`;
    },
    command: ({ prompt, model, maxTurns, workdir, bedrock }) => [
      '-p', prompt, '--output-format', 'json', '--permission-mode', 'bypassPermissions', '--cwd', workdir, '--max-turns', String(maxTurns),
      ...(bedrock ? ['-m', 'bedrock'] : model ? ['-m', model] : []),
    ],
    answer: ({ stdout }) => {
      try {
        const result = JSON.parse(stdout);
        // grok exits 0 when the model can't be reached, and says so in the result
        if (result.type === 'error') return { text: String(result.message ?? stdout), failed: true };
        return { text: result.text ?? result.result ?? stdout, turns: result.num_turns, costUsd: result.total_cost_usd };
      } catch {
        return { text: stdout };
      }
    },
  },
  agy: {
    // on Bedrock the key is handed over as the gateway's key, not under its own name
    credentials: (env) => (env.GEMINI_API_KEY ? ['GEMINI_API_KEY'] : env.AWS_BEARER_TOKEN_BEDROCK ? [] : null),
    needs: 'AWS_BEARER_TOKEN_BEDROCK, or GEMINI_API_KEY',
    stored: [],
    bedrock: (env) => Boolean(env.AWS_BEARER_TOKEN_BEDROCK) && !env.GEMINI_API_KEY,
    // the enterprise gateway mode: Antigravity adds /v1/chat/completions to the URL itself
    env: (home, bedrock, { model, baseUrl, key } = {}) => (bedrock ? {
      AGY_LLM_GATEWAY_URL: baseUrl.replace(/\/v1\/?$/, ''),
      AGY_LLM_GATEWAY_API_KEY: key,
      AGY_LLM_GATEWAY_WIRE_PROTOCOL: 'openai',
      AGY_LLM_GATEWAY_MODELS: model,
      AGY_CLI_DISABLE_AUTO_UPDATE: '1',
    } : {}),
    prepare({ run, plugin, withPlugin }) {
      if (!withPlugin) return null;
      const result = run(['plugin', 'install', plugin.dir]);
      return result.status === 0 ? null : `agy plugin install failed: ${`${result.stdout}${result.stderr}`.trim().split('\n').pop()}`;
    },
    command: ({ prompt, model }) => ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions', ...(model ? ['--model', model] : [])],
    answer: ({ stdout }) => {
      try {
        const result = JSON.parse(stdout);
        return { text: result.response ?? result.result ?? stdout, turns: result.num_turns, failed: result.status !== undefined && result.status !== 'SUCCESS' };
      } catch {
        return { text: stdout };
      }
    },
  },
};

// The files below dir, as { path, bytes, hash }, without what a client keeps for itself.
export function listFiles(dir, base = dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.claude', '.codex', '.grok', '.gemini'].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(path, base, found);
    else if (entry.isFile()) found.push({ path: relative(base, path), bytes: statSync(path).size, hash: createHash('sha256').update(readFileSync(path)).digest('hex') });
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

// What a run did to the files, compared with the listing before it: the ones it wrote (new,
// or with other content, whatever their size) and the ones it removed.
export function changedSince(before, after) {
  const was = new Map(before.map((file) => [file.path, file.hash]));
  const is = new Set(after.map((file) => file.path));
  return {
    written: after.filter((file) => was.get(file.path) !== file.hash).map(({ path, bytes }) => ({ path, bytes })),
    removed: before.filter((file) => !is.has(file.path)).map((file) => file.path),
  };
}

// A scenario as Tessl reads it: the task, the criteria, and what goes into the work
// directory, in the order it goes in. A singular "fixture" is the legacy form of a commit
// fixture named codebase. resources/ and setup.sh are taken without being named.
export function readScenario(dir) {
  const at = (path) => resolve(dir, path);
  const config = existsSync(at('scenario.json')) ? JSON.parse(readFileSync(at('scenario.json'), 'utf8')) : {};
  const fixtures = Object.entries(config.fixtures ?? {});
  if (config.fixture) fixtures.push(['codebase', { type: 'commit', ...config.fixture }]);
  const include = [...(config.include ?? [])];
  if (existsSync(at('resources')) && !include.some((path) => at(path) === at('resources'))) include.push('./resources');
  const setup = [...(config.setup ?? [])];
  if (existsSync(at('setup.sh')) && !setup.some((path) => at(path) === at('setup.sh'))) setup.push('./setup.sh');
  return {
    dir,
    prompt: readFileSync(at('task.md'), 'utf8'),
    criteria: existsSync(at('criteria.json')) ? JSON.parse(readFileSync(at('criteria.json'), 'utf8')) : undefined,
    // commit fixtures first, so that a directory installed at the same place lays its files over the clone
    fixtures: fixtures.sort(([, a], [, b]) => (a.type === 'commit' ? 0 : 1) - (b.type === 'commit' ? 0 : 1)),
    include,
    setup,
  };
}

// Whether a path, relative to the root of a fixture, is kept by its include and exclude
// globs. A glob matches the path, a directory above it, or, without a slash, its file name.
export function keeps(path, { include = [], exclude = [] } = {}) {
  const parts = path.split(sep).join('/').split('/');
  const candidates = [...parts.map((_, index) => parts.slice(0, index + 1).join('/')), parts.at(-1)];
  const matches = (glob) => candidates.some((candidate) => matchesGlob(candidate, glob.replace(/^\.\//, '').replace(/\/$/, '')));
  return (include.length === 0 || include.some(matches)) && !exclude.some(matches);
}

// Copies the files of from that the fixture keeps into to, over what is there.
function install(from, to, fixture) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, {
    recursive: true,
    filter: (source) => source === from || statSync(source).isDirectory() || keeps(relative(from, source), fixture),
  });
}

// Puts what a scenario sets up into workdir, as Tessl does: the fixtures, the includes, then
// the setup scripts, run in workdir with env. Returns what was left out; throws when a step fails.
export function setUpScenario(scenario, workdir, { network = true, env = process.env, timeout = 600 } = {}) {
  const left = [];
  const inside = (path, what) => {
    const target = resolve(workdir, path ?? '.');
    if (target !== workdir && !target.startsWith(workdir + sep)) throw new Error(`${what} is installed at ${path}, outside the work directory`);
    return target;
  };
  const run = (command, args, cwd, what) => {
    const ran = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: timeout * 1000 });
    if (ran.status !== 0) {
      const why = ran.error?.code === 'ETIMEDOUT' ? `timed out after ${timeout} s` : `${ran.stdout}${ran.stderr}${ran.error?.message ?? ''}`.trim().split('\n').pop();
      throw new Error(`${what} failed: ${why}`);
    }
  };
  for (const [name, fixture] of scenario.fixtures) {
    const what = `the fixture ${name}`;
    if (fixture.type === 'directory') {
      install(resolve(scenario.dir, fixture.path), inside(fixture.installPath, what), fixture);
    } else if (fixture.type === 'commit') {
      if (!network) {
        left.push(`${what}, a clone of ${fixture.repoUrl} at ${fixture.ref}`);
        continue;
      }
      const clone = mkdtempSync(join(tmpdir(), 'skill-eval-fixture-'));
      try {
        run('git', ['clone', '--quiet', fixture.repoUrl, clone], workdir, `${what}: git clone ${fixture.repoUrl}`);
        run('git', ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', fixture.ref], clone, `${what}: git checkout ${fixture.ref}`);
        rmSync(join(clone, '.git'), { recursive: true, force: true });
        const target = inside(fixture.installPath, what);
        install(clone, target, fixture);
        // a fresh repository with one commit, as Tessl installs it; the legacy form names its remote
        const git = (...args) => run('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.com', ...args], target, `${what}: git ${args[0]}`);
        git('init', '--quiet', '--initial-branch=main');
        if (fixture.remote) git('remote', 'add', 'origin', fixture.remote);
        git('add', '--all');
        git('commit', '--quiet', '--allow-empty', '-m', `${name} at ${fixture.ref}`);
      } finally {
        rmSync(clone, { recursive: true, force: true });
      }
    } else {
      throw new Error(`${what} has the type ${fixture.type}, which this runner does not know`);
    }
  }
  for (const path of scenario.include) install(resolve(scenario.dir, path), inside(path, `the include ${path}`), {});
  for (const path of scenario.setup) {
    if (network) run('bash', [resolve(scenario.dir, path)], workdir, `the setup script ${path}`);
    else left.push(`the setup script ${path}`);
  }
  return left;
}

function parse(argv) {
  const options = { arms: ['with', 'without'], maxTurns: 30, timeout: 600, setup: true };
  const names = { '--client': 'client', '--plugin': 'plugin', '--task': 'task', '--prompt': 'prompt', '--scenario': 'scenario', '--bin': 'bin', '--model': 'model', '--base-url': 'baseUrl', '--workdir': 'workdir', '--out': 'out', '--auth-home': 'authHome' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (names[arg]) options[names[arg]] = argv[++index];
    else if (arg === '--arms') options.arms = argv[++index].split(',').map((arm) => arm.trim());
    else if (arg === '--max-turns') options.maxTurns = Number(argv[++index]);
    else if (arg === '--timeout') options.timeout = Number(argv[++index]);
    else if (arg === '--no-setup') options.setup = false;
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
       [--bin <dir>] [--model <id>] [--base-url <url>] [--arms with,without] [--workdir <dir>] [--no-setup] [--max-turns 30] [--timeout 600] [--out <dir>] [--auth-home <dir>]`);
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
  let scenario;
  if (options.task) prompt = readFileSync(options.task, 'utf8');
  if (options.scenario) {
    scenario = readScenario(resolve(options.scenario));
    ({ prompt, criteria } = scenario);
    if (start) {
      notes.push('The work directory is the one of --workdir: the fixtures, includes and setup scripts of the scenario were not installed or run.');
      scenario = null;
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
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2';
  const baseUrl = bedrock ? options.baseUrl ?? ENDPOINTS[options.client]?.(region) : undefined;
  const on = { bedrock, model, baseUrl, key: bedrock ? process.env.AWS_BEARER_TOKEN_BEDROCK : undefined };
  const out = resolve(options.out ?? mkdtempSync(join(tmpdir(), 'skill-eval-')));
  const result = { client: options.client, model: model ?? 'the client\'s default', ...(baseUrl ? { endpoint: baseUrl } : {}), plugin: plugin.name, arms: {}, notes, transcripts: out };
  if (criteria) result.criteria = criteria;
  let failed = false;

  for (const arm of options.arms) {
    const withPlugin = arm === 'with';
    const home = mkdtempSync(join(tmpdir(), `skill-eval-${options.client}-home-`));
    const workdir = mkdtempSync(join(tmpdir(), 'skill-eval-work-'));
    // the temporary directory of the setup scripts: what they leave there, such as the main
    // checkout of a git worktree, stays for the run and goes with it
    const scratch = mkdtempSync(join(tmpdir(), 'skill-eval-setup-'));
    const armOut = join(out, `${options.client}-${arm}`);
    mkdirSync(armOut, { recursive: true });
    try {
      if (start) cpSync(start, workdir, { recursive: true });
      for (const file of stored) {
        mkdirSync(dirname(join(home, file)), { recursive: true });
        cpSync(join(resolve(options.authHome), file), join(home, file));
        chmodSync(join(home, file), 0o600);
      }
      const plain = { PATH: process.env.PATH, HOME: home, TMPDIR: process.env.TMPDIR ?? '/tmp', LANG: 'C.UTF-8', TERM: 'dumb', NO_COLOR: '1', CI: '1' };
      const env = { ...plain, ...(client.env?.(home, bedrock, on) ?? {}) };
      if (scenario) {
        // in each run's own directory: a script may leave absolute paths, as git worktree does.
        // Without the credentials or the client's settings: the scripts are not the agent.
        let left;
        try {
          left = setUpScenario(scenario, workdir, { network: options.setup, env: { ...plain, TMPDIR: scratch }, timeout: options.timeout });
        } catch (error) {
          result.arms[arm] = { error: `setting up the scenario: ${error.message}` };
          failed = true;
          continue;
        }
        const note = `--no-setup: the work directory lacks ${left.join(', ')}.`;
        if (left.length > 0 && !notes.includes(note)) notes.push(note);
      }
      for (const name of credentials) if (process.env[name] !== undefined) env[name] = process.env[name];
      const run = (args, more = {}) => spawnSync(bin, args, { cwd: workdir, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...more });
      const problem = client.prepare?.({ run, home, plugin, withPlugin, repoRoot: root, ...on });
      if (problem) {
        result.arms[arm] = { error: problem };
        failed = true;
        continue;
      }
      const before = listFiles(workdir);
      const lastMessage = join(armOut, 'last-message.txt');
      const started = Date.now();
      const ran = run(client.command({ prompt: `${RULES}\n\n${prompt}`, model, maxTurns: options.maxTurns, plugin, withPlugin, workdir, lastMessage, bedrock }), { timeout: options.timeout * 1000 });
      writeFileSync(join(armOut, 'stdout.txt'), ran.stdout ?? '');
      writeFileSync(join(armOut, 'stderr.txt'), ran.stderr ?? '');
      const answer = client.answer({ stdout: ran.stdout ?? '', lastMessage });
      const { written, removed } = changedSince(before, listFiles(workdir));
      // the work directory as the run left it, for the judge: it is deleted below
      if (written.length > 0 || removed.length > 0) cpSync(workdir, join(armOut, 'workdir'), { recursive: true });
      const timedOut = ran.error?.code === 'ETIMEDOUT';
      result.arms[arm] = {
        exit: timedOut ? `timed out after ${options.timeout} s` : ran.status,
        seconds: Math.round((Date.now() - started) / 1000),
        ...(answer.turns !== undefined ? { turns: answer.turns } : {}),
        ...(answer.costUsd !== undefined ? { costUsd: answer.costUsd } : {}),
        ...(answer.failed ? { failed: true } : {}),
        answer: String(answer.text ?? '').slice(0, 8000),
        files: written,
        removed,
        ...(ran.status !== 0 && !timedOut ? { stderr: String(ran.stderr ?? '').trim().split('\n').slice(-5).join('\n').slice(0, 1000) } : {}),
      };
      if (ran.status !== 0 || answer.failed) failed = true;
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(workdir, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  console.log(JSON.stringify(result, null, 2));
  if (failed) process.exit(1);
}

if (isMain(import.meta.url)) main();
