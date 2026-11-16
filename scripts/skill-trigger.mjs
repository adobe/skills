// Runs the trigger queries of a skill in an agent with its plugin installed, and reports
// which skill each run loaded: does the skill's description make an agent pick it up for
// the requests it is for, and leave it for the near misses?
//
//   node scripts/skill-trigger.mjs --plugin <plugin dir> --queries <set.json> [options]
//
//   --client <name>    claude (default) or pi, as skill-eval.mjs runs them
//   --query <id>       only this query; may be repeated
//   -n <n>             runs per query (default 3: pickup varies from run to run)
//   --model <id>       the model, as the client names it (default: as skill-eval.mjs)
//   --max-turns <n>    stop a run after n turns of the agent (default 6): Claude Code's own
//                      limit; for pi, which has none, the watcher's
//   --keep-going       don't stop at the first skill or the first write; record every skill
//                      loaded within --max-turns
//   --timeout <sec>    for each run (default 300)
//   --concurrency <n>  runs at the same time (default 3)
//   --bin <dir>        where the client is (default: where setup-agent-clis.mjs put it, or the PATH)
//   --auth-home <dir>  copy the client's stored sign-in from this home directory (pi needs it)
//   --json <file>      every run, and the summary
//
// Each run starts in a copy of the set's fixture (cloned once), with an empty home and the
// rules of skill-eval.mjs in front of the query. It stops at the first skill the agent
// loads, at its first write, or at --max-turns (Claude Code's own limit), so most runs are short. What it loaded is
// read from the stream of the run by plain code (lib/skill-loads.mjs); no model grades it.
// As with skill-eval.mjs, the agent may do anything the runner may: run it for plugins from
// a branch of this repository, on a machine that holds nothing the agent must not see.
//
// This runs agents, and costs what they cost: run it for the set of the skill you changed,
// not for every set. CI doesn't run it. Credentials as skill-eval.mjs: for claude
// AWS_BEARER_TOKEN_BEDROCK, ANTHROPIC_API_KEY, or --auth-home; for pi, --auth-home. Exit 3 without credentials, 2 for wrong arguments, 1
// when a run failed.
import { spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { findCli } from './lib/clients.mjs';
import { isMain } from './lib/is-main.mjs';
import { watcher } from './lib/skill-loads.mjs';
import { markdown, parseTriggerSet, summarize } from './lib/triggers.mjs';
import { MODELS, RULES, RUNNERS, setUpScenario } from './skill-eval.mjs';
import { describePlugin } from './test-drive.mjs';

// One run: the stream goes to the watcher as it comes, and the run is stopped as soon as
// the watcher has seen enough.
function runOnce({ bin, args, cwd, env, timeout, watch, transcript }) {
  return new Promise((done) => {
    // its own process group, so that stopping it also stops what it started (a shell, a server)
    const child = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const signal = (name) => {
      try {
        process.kill(-child.pid, name);
      } catch {
        // the group is gone
      }
    };
    const stop = (name) => {
      signal(name);
      // a process of the group that ignores the signal may still hold the pipes: the run is
      // over either way, and the group is killed when it closes
      child.stdout.destroy();
      child.stderr.destroy();
    };
    let stdout = '';
    let stderr = '';
    let stopped = null;
    const timer = setTimeout(() => { stopped = 'timeout'; stop('SIGKILL'); }, timeout * 1000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!stopped && watch.feed(String(chunk))) {
        stopped = 'enough';
        stop('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    // when Claude Code exits, whatever it started and left behind (a dev server, a watcher)
    // goes with it; such a process may hold the pipes, so they are closed after a moment
    child.on('exit', () => {
      clearTimeout(timer);
      signal('SIGKILL');
      setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
      }, 1000).unref();
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      signal('SIGKILL');
      writeFileSync(transcript, stdout);
      done({ status, stopped, stderr });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ status: null, stopped, stderr: error.message });
    });
  });
}

async function pool(items, size, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        plugin: { type: 'string' },
        client: { type: 'string', default: 'claude' },
        queries: { type: 'string' },
        query: { type: 'string', multiple: true, default: [] },
        n: { type: 'string', short: 'n', default: '3' },
        model: { type: 'string' },
        'max-turns': { type: 'string', default: '6' },
        'keep-going': { type: 'boolean', default: false },
        timeout: { type: 'string', default: '300' },
        concurrency: { type: 'string', default: '3' },
        bin: { type: 'string' },
        'auth-home': { type: 'string' },
        json: { type: 'string' },
      },
    });
  } catch (error) {
    fail(error.message);
  }
  const { values } = parsed;
  const [runs, maxTurns, timeout, concurrency] = ['n', 'max-turns', 'timeout', 'concurrency'].map((key) => Number(values[key]));
  if (!['claude', 'pi'].includes(values.client) || !values.plugin || !values.queries || ![runs, maxTurns, timeout, concurrency].every((value) => Number.isInteger(value) && value > 0)) {
    fail('usage: skill-trigger.mjs [--client claude|pi] --plugin <plugin dir> --queries <set.json> [--query <id>]… [-n 3] [--model <id>] [--max-turns 6] [--keep-going] [--timeout 300] [--concurrency 3] [--bin <dir>] [--auth-home <dir>] [--json <file>]');
  }
  const root = process.cwd();
  const plugin = describePlugin(root, values.plugin);
  const set = parseTriggerSet(readFileSync(resolve(values.queries), 'utf8'), values.queries);
  for (const skill of new Set(set.queries.map((query) => query.skill))) {
    if (!plugin.skills.includes(skill)) fail(`${values.queries} asks about ${skill}, which is not a skill of ${plugin.path}`);
  }
  const queries = set.queries.filter((query) => values.query.length === 0 || values.query.includes(query.id));
  if (queries.length === 0) fail('No query matches.');

  const client = RUNNERS[values.client];
  const bin = findCli(values.client, { bin: values.bin, root });
  if (!bin) fail(`${values.client} is not installed.${values.client === 'claude' ? ' Run node scripts/setup-agent-clis.mjs first.' : ''}`);
  const authHome = values['auth-home'] && resolve(values['auth-home']);
  const stored = authHome ? client.stored.filter((file) => existsSync(join(authHome, file))) : [];
  const credentials = client.credentials(process.env) ?? (stored.length > 0 ? [] : null);
  if (!credentials) fail(`No credentials for ${values.client} here. It needs ${client.needs}${client.stored.length > 0 && values.client === 'claude' ? ', or --auth-home with a home directory that is signed in' : ''}.`, 3);
  const bedrock = Boolean(client.bedrock(process.env)) && stored.length === 0;
  const model = values.model ?? (bedrock || values.client === 'pi' ? MODELS[values.client] : undefined);

  const scratch = mkdtempSync(join(tmpdir(), 'skill-trigger-'));
  const out = values.json ? dirname(resolve(values.json)) : scratch;
  mkdirSync(out, { recursive: true });
  const plain = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? '/tmp', LANG: 'C.UTF-8', TERM: 'dumb', NO_COLOR: '1', CI: '1' };
  const template = join(scratch, 'fixture');
  mkdirSync(template, { recursive: true });
  try {
    if (set.fixture) {
      const setupHome = mkdtempSync(join(scratch, 'setup-home-'));
      setUpScenario({ dir: scratch, fixtures: [['codebase', { type: 'commit', ...set.fixture }]], include: [], setup: [] }, template, { env: { ...plain, HOME: setupHome }, timeout });
    }
    const jobs = queries.flatMap((query) => Array.from({ length: runs }, (_, index) => ({ query, run: index + 1 })));
    console.error(`${jobs.length} run(s): ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'} × ${runs}, ${model ?? 'the client\'s default model'}, ${plugin.skills.length} skills installed`);
    const results = [];
    let finished = 0;
    await pool(jobs, concurrency, async ({ query, run }) => {
      const home = mkdtempSync(join(scratch, 'home-'));
      const work = mkdtempSync(join(scratch, 'work-'));
      const entry = { query: query.id, skill: query.skill, run, loaded: [] };
      try {
        cpSync(template, work, { recursive: true });
        for (const file of stored) {
          mkdirSync(dirname(join(home, file)), { recursive: true });
          cpSync(join(authHome, file), join(home, file));
          chmodSync(join(home, file), 0o600);
        }
        const env = { ...plain, HOME: home, ...client.env(home, bedrock) };
        for (const name of credentials) if (process.env[name] !== undefined) env[name] = process.env[name];
        const watch = watcher(plugin.skills, { keepGoing: values['keep-going'], ...(values.client === 'pi' ? { maxTurns } : {}) });
        const transcript = join(out, `trigger-${query.id}-${run}.jsonl`);
        const args = client.command({ prompt: `${RULES}\n\n${query.query}`, model, maxTurns, plugin, withPlugin: true, workdir: work, bedrock });
        const ran = await runOnce({ bin, args, cwd: work, env, timeout, watch, transcript });
        Object.assign(entry, watch.result(), { transcript });
        if (ran.stopped === 'timeout') entry.error = `timed out after ${timeout} s`;
        else if (ran.stopped !== 'enough' && ran.status !== 0) entry.error = `claude exited ${ran.status}: ${ran.stderr.trim().split('\n').pop() ?? ''}`;
      } catch (error) {
        entry.error = error.message;
      } finally {
        rmSync(home, { recursive: true, force: true });
        rmSync(work, { recursive: true, force: true });
      }
      results.push(entry);
      console.error(`[${++finished}/${jobs.length}] ${query.id} #${run}: ${entry.error ? `failed (${entry.error})` : entry.loaded.join(', ') || `none (${entry.stopped})`}`);
    });
    const summary = summarize(queries, results);
    console.log(markdown(summary));
    if (values.json) writeFileSync(resolve(values.json), `${JSON.stringify({ set: set.name, model: model ?? null, runs, maxTurns, keepGoing: values['keep-going'], results, summary }, null, 2)}\n`);
    if (results.some((entry) => entry.error)) process.exitCode = 1;
  } finally {
    rmSync(template, { recursive: true, force: true });
    if (!values.json) console.error(`Transcripts: ${scratch}`);
  }
}

if (isMain(import.meta.url)) await main();
