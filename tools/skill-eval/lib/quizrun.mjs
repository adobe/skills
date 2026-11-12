import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadFacts } from './facts.mjs';
import { buildQuizJudgePrompt, parseQuizVerdict, renderQuizMarkdown } from './quiz.mjs';
import { modelLabels } from './report.mjs';
import { modelList, positiveInt, slug } from './rerun.mjs';
import { DEFAULT_CONCURRENCY, makeSandboxRoot, piArgs, prepareAgentHome, PROVIDER_DOMAINS, removeDir, runProcess, sandboxEnv, sandboxedCommand, which, writeProfile } from './sandbox.mjs';
import { parseSessionFile } from './session.mjs';

export const DEFAULT_QUIZ_MODEL = 'github-copilot/claude-sonnet-5.5';
export const DEFAULT_QUIZ_JUDGE = 'github-copilot/gemini-4-argon';
const TIMEOUT_MS = 5 * 60_000;

export const QUIZ_HELP = `Usage: skill-eval quiz <facts.yaml>... [options]

Asks each fact's question to each model with no tools, skills or context files,
then has the judge grade the answer against the fact (✓ known, ~ partial, ✗ unknown).

Options:
      --model <ids>         Models to quiz, comma-separated or repeatable (default ${DEFAULT_QUIZ_MODEL})
      --fact <id>           Only this fact id; * wildcards; repeatable
  -n, --runs <n>            Asks per fact and model (default 1)
      --scorer-model <id>   Judge model (default ${DEFAULT_QUIZ_JUDGE})
      --scorer-thinking <l> Judge thinking level
      --thinking <level>    Quiz model thinking level
      --label <text>        Label for this run
      --concurrency <n>     Parallel asks (default ${DEFAULT_CONCURRENCY})
      --out <dir>           Output root (default .skill-eval/quizzes)
  -h, --help                Show this help`;

const globToRegExp = (g) => new RegExp(`^${g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

async function ask({ piBin, profile, model, thinking, prompt, dir }) {
  const root = await makeSandboxRoot();
  const sandbox = await prepareAgentHome(root);
  const work = join(root, 'project');
  await mkdir(work, { recursive: true });
  try {
    const cmd = sandboxedCommand({
      profile,
      cwd: work,
      allow: [root],
      env: sandboxEnv({ ...sandbox, piBin }),
      command: piBin,
      args: piArgs({ model, thinking, noTools: true, prompt }),
    });
    const proc = await runProcess({ ...cmd, cwd: work, stdoutFile: join(dir, 'session.jsonl'), stderrFile: join(dir, 'stderr.txt'), timeoutMs: TIMEOUT_MS });
    const session = await parseSessionFile(join(dir, 'session.jsonl'));
    let error;
    if (proc.timedOut) error = 'timed out';
    else if (proc.exitCode !== 0) error = `pi exited ${proc.exitCode}`;
    else if (session.errors.length) error = session.errors[0];
    else if (!session.finalAnswer.trim()) error = 'no answer';
    return { answer: session.finalAnswer, cost: session.cost, ...(error ? { error } : {}) };
  } finally {
    await sandbox.cleanup();
    await removeDir(root);
  }
}

export async function quizMain(argv, { installSignalHandlers }) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: 'string', multiple: true, default: [] },
      fact: { type: 'string', multiple: true, default: [] },
      runs: { type: 'string', short: 'n', default: '1' },
      'scorer-model': { type: 'string', default: DEFAULT_QUIZ_JUDGE },
      'scorer-thinking': { type: 'string' },
      thinking: { type: 'string' },
      label: { type: 'string' },
      concurrency: { type: 'string', default: String(DEFAULT_CONCURRENCY) },
      out: { type: 'string', default: '.skill-eval/quizzes' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help || !positionals.length) {
    console.log(QUIZ_HELP);
    process.exit(values.help ? 0 : 1);
  }
  const runs = positiveInt(values.runs, '--runs');
  const concurrency = positiveInt(values.concurrency, '--concurrency');
  const models = modelList(values.model, DEFAULT_QUIZ_MODEL);
  const filters = values.fact.map(globToRegExp);
  const facts = [];
  for (const path of positionals) {
    for (const f of await loadFacts(resolve(path))) {
      if (facts.some((x) => x.id === f.id)) throw new Error(`duplicate fact id ${f.id} across files`);
      if (!filters.length || filters.some((r) => r.test(f.id))) facts.push(f);
    }
  }
  if (!facts.length) throw new Error('No facts matched');
  const total = facts.length * models.length * runs;
  console.error(`${total} ask(s): ${facts.length} fact(s) × ${models.length} model(s) × ${runs}; judge ${values['scorer-model']}`);

  const piBin = await which('pi');
  await which('nono');
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}${values.label ? `-${slug(values.label)}` : ''}`;
  const runDir = resolve(values.out, runId);
  await mkdir(join(runDir, 'profiles'), { recursive: true });
  const profile = await writeProfile(join(runDir, 'profiles', 'quiz.json'), 'readwrite', PROVIDER_DOMAINS);
  installSignalHandlers();

  const jobs = [];
  for (const f of facts) for (const model of models) for (let n = 1; n <= runs; n++) jobs.push({ fact: f, model, n });
  const results = [];
  let done = 0;
  await pool(jobs, concurrency, async ({ fact, model, n }) => {
    const dir = join(runDir, 'asks', fact.id, slug(model), String(n));
    const r = { fact: fact.id, model, run: n, dir: join('asks', fact.id, slug(model), String(n)) };
    try {
      const a = await ask({ piBin, profile, model, thinking: values.thinking, prompt: fact.question, dir });
      Object.assign(r, { answer: a.answer, cost: a.cost });
      if (a.error) r.error = a.error;
      else {
        const prompt = buildQuizJudgePrompt({ question: fact.question, claim: fact.claim, answer: a.answer });
        for (let attempt = 0; attempt < 2 && !r.verdict; attempt++) {
          const j = await ask({ piBin, profile, model: values['scorer-model'], thinking: values['scorer-thinking'], prompt, dir: join(dir, `judge-${attempt}`) });
          r.judgeCost = (r.judgeCost ?? 0) + (j.cost ?? 0);
          const v = j.error ? null : parseQuizVerdict(j.answer);
          if (v) Object.assign(r, v);
          else r.error = j.error ?? 'judge returned no parseable verdict';
        }
        if (r.verdict) delete r.error;
      }
    } catch (e) {
      r.error = e.message;
    }
    results.push(r);
    console.error(`[${++done}/${total}] ${fact.id} ${model} #${n} → ${r.verdict ?? `! ${r.error}`}`);
  });

  const cells = {};
  for (const r of results.sort((a, b) => a.run - b.run)) ((cells[r.fact] ??= {})[r.model] ??= []).push(r);
  const labels = modelLabels(models);
  const markdown = renderQuizMarkdown({ facts, models, labels, cells, judge: values['scorer-model'] });
  const meta = { createdAt: new Date().toISOString(), models, scorerModel: values['scorer-model'], runs, facts: facts.map((f) => f.id), sources: positionals.map((p) => resolve(p)) };
  await writeFile(join(runDir, 'results.json'), JSON.stringify({ meta, results }, null, 2));
  await writeFile(join(runDir, 'quiz.md'), `${markdown}\n`);
  console.log(markdown);
  console.error(`\nResults: ${runDir}`);
  if (results.some((r) => r.error)) process.exitCode = 1;
}
