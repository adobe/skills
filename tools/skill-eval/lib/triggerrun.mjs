import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { attachContexts, DEFAULT_VARIANT, gitInfo, parseContextSpecs } from './contexts.mjs';
import { modelLabels } from './report.mjs';
import { modelList, positiveInt, slug } from './rerun.mjs';
import { DEFAULT_CONCURRENCY, installContext, killStrays, LOCAL_PORTS, makeSandboxRoot, piArgs, prepareAgentHome, removeDir, runProcess, sandboxEnv, sandboxedCommand, which, WORKER_DOMAINS, writeProfile } from './sandbox.mjs';
import { findPluginRoot, loadPlugin } from './scenarios.mjs';
import { parseSessionFile } from './session.mjs';
import { createWatcher, parseQuerySet, renderTriggerMarkdown, summarizeTriggers, timeoutMs } from './trigger.mjs';
import { assembleWorkdir, fetchCommit } from './workdir.mjs';

const DEFAULT_MODEL = 'github-copilot/claude-sonnet-5.5';
const TIMEOUT_MIN = 3;
const KEEP_GOING_TIMEOUT_MIN = 10;
const MAX_TURNS = 6;
const KEEP_GOING_MAX_TURNS = 12;

export const TRIGGER_HELP = `Usage: skill-eval trigger <plugin-root> --queries <file.json> [options]

Probes whether the agent picks up a skill for realistic prompts, without solving them.
Every skill of the plugin is installed so skills compete. Each run stops at the first
SKILL.md/skill file the agent opens, the first write or edit, or --max-turns.
With --keep-going a run continues past skills and writes until --max-turns or the end,
and records the order in which skills were opened.

Query set (JSON): {"name", "fixture": {"repoUrl","ref"}, "queries": [
  {"id", "query", "should_trigger": true|false, "skill": "<skill under test>", "split": "train|test"}]}

Options:
      --queries <file>      Query set (required)
      --model <ids>         Worker model(s), comma-separated or repeatable (default ${DEFAULT_MODEL})
  -n, --runs <n>            Runs per query and model (default 3)
      --query <id>          Only these query ids; repeatable
      --split <train|test>  Only queries in this split
      --skill <name>        Only queries about this skill; repeatable (all skills stay installed)
      --context <l>=<dir>   Plugin version to probe (a plugin root); repeatable; default: the positional plugin
      --max-turns <n>       Stop a run after n assistant turns (default ${MAX_TURNS}; ${KEEP_GOING_MAX_TURNS} with --keep-going)
      --keep-going          Do not stop at the first skill or write; record every skill opened, in order
      --timeout <min>       Timeout per run in minutes (default ${TIMEOUT_MIN}; ${KEEP_GOING_TIMEOUT_MIN} with --keep-going)
      --thinking <level>    Worker thinking level
      --label <text>        Run label
      --concurrency <n>     Parallel runs (default ${DEFAULT_CONCURRENCY})
      --out <dir>           Output root (default .skill-eval/triggers)
  -h, --help                Show this help`;

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

async function runOne(job, ctx) {
  const { piBin, profile, cacheDir, opts } = ctx;
  const { dir, query, model, variant, run, plugin } = job;
  const root = await makeSandboxRoot();
  const work = join(root, 'project');
  const result = { query: query.id, skill: query.skill, model, variant, run, status: 'ok', dir: job.rel };
  const sandbox = await prepareAgentHome(root);
  let installed = { skills: [], rules: [], uninstall: async () => {} };
  try {
    if (ctx.fixture) {
      const empty = await mkdtemp(join(root, 'scn-'));
      await assembleWorkdir({ name: 'trigger', dir: empty, config: { fixture: ctx.fixture } }, work, { cacheDir });
    } else await mkdir(work, { recursive: true });
    installed = await installContext(plugin, { work, agentDir: sandbox.agentDir });
    const watcher = createWatcher(installed.skills, { maxTurns: opts.maxTurns, keepGoing: opts.keepGoing });
    const cmd = sandboxedCommand({
      profile,
      cwd: work,
      allow: [root],
      env: sandboxEnv({ ...sandbox, piBin }),
      command: piBin,
      args: piArgs({ model, thinking: opts.thinking, skills: installed.skills.map((s) => s.dir), rules: installed.rules, contextFiles: true, prompt: query.query }),
    });
    const proc = await runProcess({ ...cmd, cwd: work, stdoutFile: join(dir, 'session.jsonl'), stderrFile: join(dir, 'stderr.txt'), timeoutMs: opts.timeoutMs, onStdout: (c) => watcher.feed(c) });
    const session = await parseSessionFile(join(dir, 'session.jsonl'));
    const w = watcher.result();
    Object.assign(result, { triggered: w.triggered, order: w.order, stopReason: w.stopReason, turns: w.turns, durationMs: proc.durationMs, tokens: session.tokens, cost: session.cost });
    if (proc.timedOut) Object.assign(result, { status: 'timeout', error: 'timed out' });
    else if (!proc.stopped && (proc.exitCode !== 0 || session.errors.length)) Object.assign(result, { status: 'error', error: session.errors[0] ?? `pi exited ${proc.exitCode}` });
  } catch (e) {
    Object.assign(result, { status: 'error', error: e.message, triggered: [] });
  } finally {
    await killStrays(root);
    await installed.uninstall();
    await sandbox.cleanup();
    await removeDir(root);
  }
  await writeFile(join(dir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

export async function triggerMain(argv, { installSignalHandlers }) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      queries: { type: 'string' },
      model: { type: 'string', multiple: true, default: [] },
      runs: { type: 'string', short: 'n', default: '3' },
      query: { type: 'string', multiple: true, default: [] },
      split: { type: 'string' },
      skill: { type: 'string', multiple: true, default: [] },
      context: { type: 'string', multiple: true, default: [] },
      'max-turns': { type: 'string' },
      'keep-going': { type: 'boolean', default: false },
      timeout: { type: 'string' },
      thinking: { type: 'string' },
      label: { type: 'string' },
      concurrency: { type: 'string', default: String(DEFAULT_CONCURRENCY) },
      out: { type: 'string', default: '.skill-eval/triggers' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help || positionals.length !== 1 || !values.queries) {
    console.log(TRIGGER_HELP);
    process.exit(values.help ? 0 : 1);
  }
  if (values.split && values.split !== 'train' && values.split !== 'test') throw new Error('--split must be train or test');
  const runs = positiveInt(values.runs, '--runs');
  const concurrency = positiveInt(values.concurrency, '--concurrency');
  const keepGoing = values['keep-going'];
  const maxTurns = positiveInt(values['max-turns'] ?? String(keepGoing ? KEEP_GOING_MAX_TURNS : MAX_TURNS), '--max-turns');
  const timeoutMin = Number(values.timeout ?? (keepGoing ? KEEP_GOING_TIMEOUT_MIN : TIMEOUT_MIN));
  const runTimeoutMs = timeoutMs(timeoutMin);
  const models = modelList(values.model, DEFAULT_MODEL);

  const set = parseQuerySet(await readFile(resolve(values.queries), 'utf8'), values.queries);
  const pluginRoot = await findPluginRoot(resolve(positionals[0]));
  if (!pluginRoot) throw new Error(`${positionals[0]}: not inside a plugin`);
  const plugin = await loadPlugin(pluginRoot);
  const known = new Set(plugin.skills.map((s) => s.name));
  for (const s of new Set(set.queries.map((q) => q.skill))) if (!known.has(s)) throw new Error(`query set tests unknown skill ${s}`);
  for (const s of values.skill) if (!known.has(s)) throw new Error(`Unknown skill: ${s}`);
  const queries = set.queries.filter((q) => (!values.query.length || values.query.includes(q.id)) && (!values.split || q.split === values.split) && (!values.skill.length || values.skill.includes(q.skill)));
  if (!queries.length) throw new Error('No queries matched');

  const specs = parseContextSpecs(values.context);
  const { targets, variants } = await attachContexts([{ plugin, scenarios: [] }], specs, []);
  const contexts = targets[0].contexts;
  const total = queries.length * variants.length * models.length * runs;
  console.error(`${total} run(s): ${queries.length} query(ies) × ${variants.join(', ')} × ${models.length} model(s) × ${runs}; ${plugin.skills.length} skill(s) installed`);

  const piBin = await which('pi');
  await which('nono');
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}${values.label ? `-${slug(values.label)}` : ''}`;
  const outRoot = resolve(values.out);
  const runDir = join(outRoot, runId);
  await mkdir(join(runDir, 'profiles'), { recursive: true });
  const profile = await writeProfile(join(runDir, 'profiles', 'trigger.json'), 'readwrite', WORKER_DOMAINS, LOCAL_PORTS);
  const cacheDir = join(resolve('.skill-eval/runs'), '.cache', 'commits');
  if (set.fixture) await fetchCommit(cacheDir, set.fixture.repoUrl, set.fixture.ref);
  installSignalHandlers();

  const jobs = [];
  for (const variant of variants) for (const query of queries) for (const model of models) for (let run = 1; run <= runs; run++) {
    const rel = join('runs', variant, query.id, slug(model), String(run));
    jobs.push({ variant, query, model, run, plugin: contexts[variant], rel, dir: join(runDir, rel) });
  }
  const ctx = { piBin, profile, cacheDir, fixture: set.fixture, opts: { maxTurns, keepGoing, timeoutMs: runTimeoutMs, thinking: values.thinking } };
  const results = [];
  let done = 0;
  await pool(jobs, concurrency, async (job) => {
    const r = await runOne(job, ctx);
    results.push(r);
    const opened = keepGoing ? r.order?.map((o) => `${o.skill}@${o.turn}`).join(' → ') : r.triggered?.join(', ');
    console.error(`[${++done}/${total}] ${job.variant} ${job.query.id} ${slug(job.model)} #${job.run} → ${r.status === 'ok' ? (opened || `none (${r.stopReason})`) : `! ${r.error}`}`);
  });

  const labels = modelLabels(models);
  const sections = [];
  const bySummary = {};
  for (const variant of variants) {
    const summary = summarizeTriggers(queries, results.filter((r) => r.variant === variant));
    bySummary[variant] = summary;
    sections.push(renderTriggerMarkdown({ summary, models, labels, meta: { name: set.name, variant: variants.length > 1 || specs.length ? variant : DEFAULT_VARIANT, runs, keepGoing, maxTurns } }));
  }
  const gits = {};
  for (const v of variants) gits[v] = { dir: contexts[v].root, ...(await gitInfo(contexts[v].root)) };
  const meta = { createdAt: new Date().toISOString(), queries: values.queries, set: set.name, fixture: set.fixture, models, runs, maxTurns, keepGoing, timeoutMin, variants, contexts: gits };
  await writeFile(join(runDir, 'results.json'), JSON.stringify({ meta, results, summary: bySummary }, null, 2));
  const markdown = sections.join('\n\n');
  await writeFile(join(runDir, 'trigger.md'), `${markdown}\n`);
  console.log(markdown);
  console.error(`\nResults: ${runDir}`);
  if (results.some((r) => r.status !== 'ok')) process.exitCode = 1;
}
