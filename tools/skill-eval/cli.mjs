#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { describeChanges, snapshotWorkdir } from './lib/changes.mjs';
import { buildJudgePrompt, judgeCommands, judgeOutcome } from './lib/judge.mjs';
import { aggregate, failedAttempts, modelLabels, modelOf, renderMarkdown } from './lib/report.mjs';
import {
  archiveWorkdir,
  cleanupAll,
  DEFAULT_CONCURRENCY,
  installContext,
  killStrays,
  killAll,
  LOCAL_PORTS,
  makeSandboxRoot,
  moveDir,
  piArgs,
  prepareAgentHome,
  PROVIDER_DOMAINS,
  removeDir,
  runProcess,
  sandboxEnv,
  sandboxedCommand,
  which,
  WORKER_DOMAINS,
  writeProfile,
} from './lib/sandbox.mjs';
import { createBreaker, isInfraError, reusablePrior, withInfraRetries } from './lib/infra.mjs';
import { attachContexts, BASELINE, gitInfo, parseContextSpecs } from './lib/contexts.mjs';
import { attemptDir, judgeLabel, loadRunSkills, modelList, positiveInt, refreshAttempts, slug, tagJudgeModels, tagWorkerModels, workerSucceeded } from './lib/rerun.mjs';
import { exists, loadScenario, resolveTargets } from './lib/scenarios.mjs';
import { quizMain } from './lib/quizrun.mjs';
import { reuseBaseline, scenarioFingerprint } from './lib/baselinereuse.mjs';
import { ctxMain } from './lib/ctxrun.mjs';
import { triggerMain } from './lib/triggerrun.mjs';
import { renderSummary } from './lib/summary.mjs';
import { parseSessionFile } from './lib/session.mjs';
import { assembleWorkdir, fetchCommit, normalizeFixtures, walk } from './lib/workdir.mjs';

const DEFAULT_MODEL = 'github-copilot/claude-sonnet-5.5';
const DEFAULT_SCORER = 'github-copilot/gemini-4-argon';

const HELP = `Usage: skill-eval <plugin-or-scenario-dir>... [options]

Runs Tessl-format eval scenarios locally with pi, isolated by nono.
Other commands: ctx (build a context tree from git refs), report <run-dir> (rebuild a report), quiz <facts.yaml>..., trigger <plugin> --queries <file> (see <command> --help).
Each source is a plugin root (all its evals/), an evals/ dir, or one scenario dir.

Options:
  -n, --runs <n>            Repeats per variant, scenario and model (1-10, default 3)
      --scenario <name>     Only scenarios with this name; * wildcards; repeatable
      --skill <name>        Narrow every context to these skills; repeatable
      --context <l>=<dir>   Variant <l> uses the plugin at <dir> (a plugin root, e.g. in a
                            git worktree); repeatable; replaces the default with-plugin
      --skip-baseline       Skip the no-skills baseline variant
      --baseline-from <dir> Reuse ok baseline attempts from an earlier run (same scenario files, model,
                            thinking, run number and judge); repeatable. Needs runs made after this flag existed
      --skip-scoring        Skip the judge
      --force-activation    Tell the agent to read the plugin skills before starting
      --model <ids>         Worker model(s), comma-separated or repeatable (default ${DEFAULT_MODEL})
      --thinking <level>    Worker thinking level
      --scorer-model <id>   Judge model (default ${DEFAULT_SCORER})
      --scorer-thinking <l> Judge thinking level
      --label <text>        Label for this run
      --concurrency <n>     Parallel attempts (default ${DEFAULT_CONCURRENCY})
      --timeout <min>       Worker timeout per attempt in minutes (default 10)
      --out <dir>           Output root (default .skill-eval/runs)
      --resume <run-dir>    Continue an earlier run (same sources and options): keep its ok and
                            timed-out attempts, redo the rest
      --dry-run             Print the plan and exit
  -h, --help                Show this help`;

const INFRA_FAILURE_LIMIT = 5;
const JUDGE_TOOLS = 'read,grep,find,ls';
const SETUP_TIMEOUT_MS = 10 * 60_000;
const JUDGE_TIMEOUT_MS = 10 * 60_000;

function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      runs: { type: 'string', short: 'n', default: '3' },
      scenario: { type: 'string', multiple: true, default: [] },
      skill: { type: 'string', multiple: true, default: [] },
      context: { type: 'string', multiple: true, default: [] },
      'skip-baseline': { type: 'boolean', default: false },
      'baseline-from': { type: 'string', multiple: true, default: [] },
      'skip-scoring': { type: 'boolean', default: false },
      'force-activation': { type: 'boolean', default: false },
      model: { type: 'string', multiple: true, default: [] },
      thinking: { type: 'string' },
      'scorer-model': { type: 'string', default: DEFAULT_SCORER },
      'scorer-thinking': { type: 'string' },
      label: { type: 'string' },
      concurrency: { type: 'string', default: String(DEFAULT_CONCURRENCY) },
      timeout: { type: 'string', default: '10' },
      out: { type: 'string', default: '.skill-eval/runs' },
      resume: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('--runs must be 1-10');
  const concurrency = positiveInt(values.concurrency, '--concurrency');
  const timeout = Number(values.timeout);
  if (!(timeout > 0)) throw new Error('--timeout must be > 0');
  return { ...values, models: modelList(values.model, DEFAULT_MODEL), contexts: parseContextSpecs(values.context), runs, concurrency, timeoutMs: timeout * 60_000, sources: positionals };
}


async function listFiles(dir) {
  if (!(await exists(dir))) return [];
  return (await walk(dir, { skip: ['node_modules', '.git'] })).sort();
}

async function stageContext(plugin, contextRoot) {
  const skillsDir = join(contextRoot, 'skills');
  const rulesDir = join(contextRoot, 'rules');
  const skills = [];
  for (const s of plugin.skills) {
    const dir = join(skillsDir, basename(s.dir));
    await cp(s.dir, dir, { recursive: true });
    skills.push({ ...s, dir });
  }
  const rules = [];
  for (const [i, r] of plugin.rules.entries()) {
    await mkdir(rulesDir, { recursive: true });
    const to = join(rulesDir, `${String(i).padStart(2, '0')}-${basename(r)}`);
    await cp(r, to);
    rules.push(to);
  }
  return { root: contextRoot, skills, rules };
}

function forcedPreamble(skills) {
  return [
    'Before starting the task, read each of these skills and apply them where relevant:',
    ...skills.map((s) => `- ${join(s.dir, 'SKILL.md')}`),
    '',
    '',
  ].join('\n');
}

async function pool(items, size, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

async function runAttempt(a, ctx) {
  const { opts, piBin, profiles } = ctx;
  const dir = a.dir;
  await mkdir(dir, { recursive: true });
  const root = await makeSandboxRoot();
  const work = join(root, 'project');
  const result = {
    plugin: a.plugin.name,
    pluginSlug: a.pluginSlug,
    scenario: a.scenario.name,
    scenarioDir: a.scenarioDir,
    variant: a.variant,
    run: a.run,
    model: a.model,
    modelSlug: a.modelSlug,
    scenarioHash: a.scenarioHash,
    thinking: opts.thinking ?? null,
    status: 'ok',
    dir,
  };
  const sandbox = await prepareAgentHome(root);
  let installed = { skills: [], rules: [], uninstall: async () => {} };
  try {
    const env = sandboxEnv({ ...sandbox, piBin });
    const setup = await assembleWorkdir(a.scenario, work, { cacheDir: ctx.cacheDir });
    for (const [i, script] of setup.entries()) {
      const cmd = sandboxedCommand({
        profile: profiles.worker,
        cwd: work,
        allow: [root],
        read: [a.scenario.dir],
        env,
        command: '/bin/bash',
        args: [script],
      });
      const r = await runProcess({ ...cmd, cwd: work, stdoutFile: join(dir, `setup-${i}.out.txt`), stderrFile: join(dir, `setup-${i}.err.txt`), timeoutMs: SETUP_TIMEOUT_MS });
      if (r.exitCode !== 0) throw new Error(`setup ${relative(a.scenario.dir, script)} failed (exit ${r.exitCode}${r.timedOut ? ', timeout' : ''})`);
    }
    await snapshotWorkdir(work, join(dir, 'start'));

    const withContext = a.variant !== 'baseline';
    if (withContext) installed = await installContext(a.context, { work, agentDir: sandbox.agentDir });
    const skills = installed.skills;
    const prompt = (withContext && opts['force-activation'] ? forcedPreamble(skills) : '') + a.scenario.task;
    const cmd = sandboxedCommand({
      profile: profiles.worker,
      cwd: work,
      allow: [root],
      env,
      command: piBin,
      args: piArgs({
        model: a.model,
        thinking: opts.thinking,
        skills: skills.map((s) => s.dir),
        rules: installed.rules,
        contextFiles: true,
        prompt,
      }),
    });
    const r = await runProcess({ ...cmd, cwd: work, stdoutFile: join(dir, 'session.jsonl'), stderrFile: join(dir, 'stderr.txt'), timeoutMs: opts.timeoutMs });
    result.strayProcesses = (await killStrays(root)).length;
    await sandbox.cleanup();
    await installed.uninstall();
    const session = await parseSessionFile(join(dir, 'session.jsonl'), { skills });
    Object.assign(result, {
      durationMs: r.durationMs,
      exitCode: r.exitCode,
      turns: session.turns,
      tokens: session.tokens,
      cost: session.cost,
      toolCalls: session.toolCalls.length,
      activatedSkills: session.activatedSkills,
      finalAnswer: session.finalAnswer,
    });
    if (r.timedOut) result.status = 'timeout';
    else if (r.exitCode !== 0 || session.errors.length || session.turns === 0) {
      result.status = 'error';
      result.error = session.errors[0] ?? `pi exited ${r.exitCode}`;
    }
    const changes = await saveChanges(dir, work);
    result.changedFiles = changes.files.length;

    if (!opts['skip-scoring'] && result.status === 'ok') {
      const judged = await judge(ctx, {
        scenario: a.scenario,
        finalAnswer: session.finalAnswer,
        work,
        outDir: dir,
        changes,
        fileCount: (await listFiles(work)).length,
        commands: judgeCommands(a.scenario, session.toolCalls),
      });
      if (judged.score) result.score = judged.score;
      else {
        result.status = 'error';
        result.error = judged.error;
      }
    }
  } catch (e) {
    result.status = 'error';
    result.error = e.message;
  } finally {
    await killStrays(root);
    await installed.uninstall();
    await sandbox.cleanup();
    await removeDir(join(dir, 'start'));
    const archived = await archiveWorkdir(root, work, join(dir, 'work'));
    if (archived.error) {
      result.archiveError = archived.error;
      result.workdir = archived.kept;
      console.error(`warning: ${archived.error}; kept at ${archived.kept}`);
    }
  }
  await writeFile(join(dir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

async function readPrior(dir) {
  try {
    return JSON.parse(await readFile(join(dir, 'result.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function saveChanges(dir, work) {
  const start = join(dir, 'start');
  const changes = (await exists(start)) ? await describeChanges(start, work) : { files: [], diff: '', truncated: false };
  await writeFile(join(dir, 'changes.json'), JSON.stringify({ files: changes.files, truncated: changes.truncated }, null, 2));
  await writeFile(join(dir, 'changes.diff'), changes.diff);
  return changes;
}

async function judge(ctx, { scenario, finalAnswer, work, outDir, changes, fileCount, files, commands }) {
  const { opts, piBin, profiles } = ctx;
  const prompt = buildJudgePrompt({
    task: scenario.task,
    criteria: scenario.criteria,
    finalAnswer,
    changes,
    fileCount,
    files,
    commands,
  });
  let lastError = 'judge did not run';
  let judgeCost = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const jdir = join(outDir, `judge-${attempt}`);
    const jroot = await makeSandboxRoot();
    const sandbox = await prepareAgentHome(jroot);
    let proc;
    try {
      const cmd = sandboxedCommand({
        profile: profiles.judge,
        cwd: work,
        allow: [jroot],
        read: [work],
        env: sandboxEnv({ ...sandbox, piBin }),
        command: piBin,
        args: piArgs({ model: opts['scorer-model'], thinking: opts['scorer-thinking'], tools: JUDGE_TOOLS, prompt }),
      });
      proc = await runProcess({ ...cmd, cwd: work, stdoutFile: join(jdir, 'session.jsonl'), stderrFile: join(jdir, 'stderr.txt'), timeoutMs: JUDGE_TIMEOUT_MS });
    } finally {
      await sandbox.cleanup();
      await removeDir(jroot);
    }
    const js = await parseSessionFile(join(jdir, 'session.jsonl'));
    judgeCost += js.cost;
    const outcome = judgeOutcome(proc, js, scenario.criteria);
    if (outcome.score) return { score: { ...outcome.score, judgeCost, judgeModel: opts['scorer-model'] } };
    lastError = outcome.error;
  }
  return { error: lastError };
}

async function main() {
  const opts = parseCli(process.argv.slice(2));
  if (opts.help || !opts.sources.length) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 1);
  }
  const sourceTargets = await resolveTargets(opts.sources, { scenarioFilters: opts.scenario });
  const { targets, variants: contextVariants } = await attachContexts(sourceTargets, opts.contexts, opts.skill);
  if (!targets.length) throw new Error('No scenarios matched');
  const variants = opts['skip-baseline'] ? contextVariants : [BASELINE, ...contextVariants];

  const total = targets.reduce((n, t) => n + t.scenarios.length, 0) * variants.length * opts.runs * opts.models.length;
  for (const t of targets) {
    console.error(`${t.plugin.name}: ${t.scenarios.length} scenario(s)`);
    for (const v of contextVariants) {
      const p = t.contexts[v];
      console.error(`  ${v}: ${p.skills.length} skill(s), ${p.rules.length} rule(s) from ${p.root}`);
      if (p.unsupported.length) console.error(`    warning: not supported locally, ignored: ${p.unsupported.join(', ')}`);
    }
  }
  console.error(`${total} attempt(s): ${variants.join(' + ')} × ${opts.runs} run(s); worker ${opts.models.join(', ')}; judge ${opts['skip-scoring'] ? 'skipped' : opts['scorer-model']}`);
  if (opts['dry-run']) {
    for (const t of targets) for (const s of t.scenarios) console.log(`${t.plugin.name}\t${s.name}`);
    return;
  }

  const piBin = await which('pi');
  await which('nono');
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}${opts.label ? `-${slug(opts.label)}` : ''}`;
  const outRoot = resolve(opts.out);
  const runDir = opts.resume ? resolve(opts.resume) : join(outRoot, runId);
  if (opts.resume && !(await exists(join(runDir, 'attempts')))) throw new Error(`--resume ${opts.resume}: no attempts/ in that directory`);
  const cacheDir = join(outRoot, '.cache', 'commits');
  await mkdir(join(runDir, 'profiles'), { recursive: true });
  const profiles = {
    worker: await writeProfile(join(runDir, 'profiles', 'worker.json'), 'readwrite', WORKER_DOMAINS, LOCAL_PORTS),
    judge: await writeProfile(join(runDir, 'profiles', 'judge.json'), 'read', PROVIDER_DOMAINS),
  };

  const attempts = [];
  const contexts = [];
  for (const t of targets) {
    const pluginSlug = slug(t.plugin.name);
    const staged = Object.create(null);
    for (const v of contextVariants) {
      staged[v] = await stageContext(t.contexts[v], join(runDir, 'context', v, pluginSlug));
      contexts.push({ variant: v, plugin: t.plugin.name, dir: t.contexts[v].root, ...(await gitInfo(t.contexts[v].root)) });
    }
    for (const s of t.scenarios) {
      for (const fx of Object.values(normalizeFixtures(s.config))) {
        if (fx.type === 'commit') await fetchCommit(cacheDir, fx.repoUrl, fx.ref);
      }
      const scenarioCopy = join(runDir, 'scenarios', pluginSlug, s.name);
      await mkdir(scenarioCopy, { recursive: true });
      const scenarioHash = await scenarioFingerprint(s.dir);
      await writeFile(join(scenarioCopy, 'task.md'), s.task);
      await writeFile(join(scenarioCopy, 'criteria.json'), JSON.stringify(s.criteria, null, 2));
      for (const variant of variants) {
        for (let run = 1; run <= opts.runs; run++) {
          for (const model of opts.models) {
            const a = { plugin: t.plugin, pluginSlug, scenario: s, scenarioDir: relative(runDir, scenarioCopy), variant, run, model, modelSlug: slug(model), scenarioHash, context: staged[variant] };
            attempts.push({ ...a, dir: attemptDir(runDir, { ...a, scenario: s.name }) });
          }
        }
      }
    }
  }

  installSignalHandlers();

  const ctx = { opts, piBin, profiles, cacheDir };
  const labels = modelLabels(opts.models);
  const results = [];
  let done = 0;
  const isInfraFailure = (r) => r.status === 'error' && isInfraError(r.error);
  const breaker = createBreaker(INFRA_FAILURE_LIMIT);
  let skipped = 0;
  const baselineRuns = opts['baseline-from'].map((d) => resolve(d));
  let reusedBaselines = 0;
  const log = (r, prefix = '') => {
    const score = r.score ? `${r.score.pct.toFixed(1)}%` : r.status;
    const act = r.activatedSkills?.length ? ` activated: ${r.activatedSkills.join(', ')}` : '';
    console.error(`[${done}/${total}] ${prefix}${r.scenario} ${labels[r.model]} ${r.variant} #${r.run} → ${score}${r.status !== 'ok' ? ` (${r.status}: ${r.error ?? ''})` : ''}${act} ${Math.round((r.durationMs ?? 0) / 1000)}s, ${r.turns ?? 0} turns, ${r.tokens?.total ?? 0} tokens, $${(r.cost ?? 0).toFixed(3)}`);
  };
  await pool(attempts, opts.concurrency, async (a) => {
    if (breaker.tripped) {
      skipped++;
      return;
    }
    if (a.variant === BASELINE && baselineRuns.length) {
      const reused = await reuseBaseline(a, { runDirs: baselineRuns, thinking: opts.thinking, scorerModel: opts['scorer-model'], skipScoring: opts['skip-scoring'] });
      if (reused) {
        results.push(reused);
        reusedBaselines++;
        done++;
        log(reused, 'reused ');
        return;
      }
    }
    if (opts.resume) {
      const prior = await readPrior(a.dir);
      if (reusablePrior(prior)) {
        results.push(prior);
        done++;
        log(prior, 'kept ');
        return;
      }
    }
    const r = await withInfraRetries(
      async (i) => {
        if (i > 0 || opts.resume) await removeDir(a.dir);
        return runAttempt(a, ctx);
      },
      {
        isFailure: (x) => isInfraFailure(x) && !breaker.tripped,
        onRetry: (n, x) => console.error(`retry ${n}/2 ${x.scenario} ${labels[x.model]} ${x.variant} #${x.run}: ${x.error}`),
      },
    );
    breaker.record(isInfraFailure(r));
    results.push(r);
    done++;
    log(r);
    if (breaker.tripped) console.error(`${INFRA_FAILURE_LIMIT} attempts in a row failed on network or provider errors; stopping. Re-run with --resume ${runDir} once the connection is back.`);
  });
  if (skipped) {
    console.error(`${skipped} attempt(s) not run`);
    process.exitCode = 1;
  }

  const meta = {
    runId: basename(runDir),
    label: opts.label,
    models: opts.models,
    thinking: opts.thinking,
    scorerModel: opts['skip-scoring'] ? null : opts['scorer-model'],
    runs: opts.runs,
    forceActivation: opts['force-activation'],
    baselineFrom: baselineRuns,
    baselinesReused: reusedBaselines,
    contexts,
  };
  const plugins = aggregate(results, variants);
  await writeRun(runDir, { meta, variants, plugins, attempts: results });
  const failed = failedAttempts(results).length;
  if (failed) {
    console.error(`${failed} attempt(s) failed`);
    process.exitCode = 1;
  }
}

function installSignalHandlers() {
  const onSignal = async () => {
    killAll();
    await cleanupAll();
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
}

async function writeRun(runDir, { meta, variants, plugins, attempts }) {
  const slim = attempts.map(({ finalAnswer, ...r }) => r);
  await writeFile(join(runDir, 'results.json'), JSON.stringify({ meta, variants, plugins, attempts: slim }, null, 2));
  const md = renderMarkdown({ meta, plugins, variants });
  await writeFile(join(runDir, 'report.md'), md);
  console.log(md);
  console.error(`\nResults: ${runDir}`);
}

const REPORT_HELP = `Usage: skill-eval report <run-dir> [options]

Rebuilds report.md and results.json from a run's saved sessions (metrics and
skills used are recomputed; scores are kept).

Options:
      --rejudge             Re-score every attempt whose worker finished
      --scorer-model <id>   Judge model for --rejudge (default ${DEFAULT_SCORER})
      --scorer-thinking <l> Judge thinking level for --rejudge
      --concurrency <n>     Parallel judges (default ${DEFAULT_CONCURRENCY})
  -h, --help                Show this help`;

async function rejudgeAttempt(a, ctx, runDir) {
  if (!a.scenarioDir || !(await exists(join(runDir, a.scenarioDir, 'criteria.json')))) {
    return { skipped: 'run has no scenario copy (made before report support)' };
  }
  const work = join(a.dir, 'work');
  if (!(await exists(work))) return { skipped: 'workdir missing' };
  const scenario = await loadScenario(join(runDir, a.scenarioDir));
  let changes = null;
  if (await exists(join(a.dir, 'changes.json'))) {
    const saved = JSON.parse(await readFile(join(a.dir, 'changes.json'), 'utf8'));
    changes = { ...saved, diff: await readFile(join(a.dir, 'changes.diff'), 'utf8') };
  }
  const root = await makeSandboxRoot();
  try {
    const copy = join(root, 'project');
    await cp(work, copy, { recursive: true, verbatimSymlinks: true });
    const files = await listFiles(copy);
    const commands = scenario.config?.judge?.commands && (await exists(join(a.dir, 'session.jsonl')))
      ? judgeCommands(scenario, (await parseSessionFile(join(a.dir, 'session.jsonl'))).toolCalls)
      : undefined;
    return await judge(ctx, { scenario, finalAnswer: a.finalAnswer, work: copy, outDir: join(a.dir, 'rejudge'), changes, files, fileCount: files.length, commands });
  } finally {
    await removeDir(root);
  }
}

async function reportMain(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      rejudge: { type: 'boolean', default: false },
      'scorer-model': { type: 'string', default: DEFAULT_SCORER },
      'scorer-thinking': { type: 'string' },
      concurrency: { type: 'string', default: String(DEFAULT_CONCURRENCY) },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help || positionals.length !== 1) {
    console.log(REPORT_HELP);
    process.exit(values.help ? 0 : 1);
  }
  const runDir = resolve(positionals[0]);
  const concurrency = positiveInt(values.concurrency, '--concurrency');
  const data = JSON.parse(await readFile(join(runDir, 'results.json'), 'utf8'));
  const attempts = await refreshAttempts(data.attempts, await loadRunSkills(runDir, data.meta), runDir);
  tagWorkerModels(attempts, data.meta.model);
  tagJudgeModels(attempts, data.meta.scorerModel);
  const meta = { ...data.meta };
  if (values.rejudge) {
    const piBin = await which('pi');
    await which('nono');
    const judgeProfile = join(runDir, 'profiles', 'judge.json');
    await writeProfile(judgeProfile, 'read', PROVIDER_DOMAINS);
    installSignalHandlers();
    const ctx = { opts: values, piBin, profiles: { judge: judgeProfile } };
    const todo = attempts.filter(workerSucceeded);
    const labels = modelLabels([...new Set(attempts.map(modelOf))]);
    let done = 0;
    let rejudged = 0;
    await pool(todo, concurrency, async (a) => {
      const r = await rejudgeAttempt(a, ctx, runDir);
      done++;
      if (r.skipped) {
        console.error(`[${done}/${todo.length}] ${a.scenario} ${labels[modelOf(a)]} ${a.variant} #${a.run} kept old score: ${r.skipped}`);
        return;
      }
      rejudged++;
      if (r.score) {
        a.score = r.score;
        a.status = 'ok';
        delete a.error;
      } else {
        delete a.score;
        a.status = 'error';
        a.error = r.error;
      }
      console.error(`[${done}/${todo.length}] ${a.scenario} ${labels[modelOf(a)]} ${a.variant} #${a.run} → ${a.score ? `${a.score.pct.toFixed(1)}%` : a.error}`);
    });
    meta.scorerModel = judgeLabel(attempts, data.meta.scorerModel);
    if (rejudged) meta.rejudgedAt = new Date().toISOString();
    console.error(`Re-judged ${rejudged} of ${todo.length} attempt(s)`);
  }
  await writeRun(runDir, { meta, variants: data.variants, plugins: aggregate(attempts, data.variants), attempts });
  if (failedAttempts(attempts).length) process.exitCode = 1;
}

const SUMMARY_HELP = `Usage: skill-eval summary <run-dir> [--variant <label>] [--out <dir>]

Scripted bucket table and observed noise for a finished run (no model calls).
Writes <out>/<run>-summary.md and a copy of the run's report.md next to it
(default out: .skill-eval).`;

async function summaryMain(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { variant: { type: 'string' }, out: { type: 'string', default: '.skill-eval' }, help: { type: 'boolean', short: 'h', default: false } },
  });
  if (values.help || positionals.length !== 1) {
    console.log(SUMMARY_HELP);
    process.exit(values.help ? 0 : 1);
  }
  const runDir = resolve(positionals[0]);
  const data = JSON.parse(await readFile(join(runDir, 'results.json'), 'utf8'));
  const variant = values.variant ?? data.variants.find((v) => v !== BASELINE);
  if (!data.variants.includes(BASELINE) || !data.variants.includes(variant)) throw new Error(`need baseline and ${variant ?? 'a skill variant'} in this run (has ${data.variants.join(', ')})`);
  const attempts = data.attempts;
  tagWorkerModels(attempts, data.meta.model);
  const plugins = aggregate(attempts, data.variants);
  const outDir = resolve(values.out);
  await mkdir(outDir, { recursive: true });
  const name = basename(runDir);
  const reportCopy = join(outDir, `${name}-report.md`);
  await cp(join(runDir, 'report.md'), reportCopy);
  for (const plugin of plugins) {
    const md = renderSummary({ meta: data.meta, variants: data.variants, plugin, variant, attempts: attempts.filter((a) => a.plugin === plugin.plugin), reportPath: reportCopy });
    const file = join(outDir, `${name}-summary${plugins.length > 1 ? `-${slug(plugin.plugin)}` : ''}.md`);
    await writeFile(file, md);
    console.log(file);
  }
}

const [command, ...rest] = process.argv.slice(2);
(command === 'report' ? reportMain(rest) : command === 'summary' ? summaryMain(rest) : command === 'ctx' ? ctxMain(rest) : command === 'quiz' ? quizMain(rest, { installSignalHandlers }) : command === 'trigger' ? triggerMain(rest, { installSignalHandlers }) : main()).catch(async (e) => {
  await cleanupAll();
  console.error(`skill-eval: ${e.message}`);
  process.exit(1);
});
