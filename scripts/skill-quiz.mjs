// Asks a model without tools the question of each fact a skill relies on, and has another
// model grade the answer against the fact. For an author who wants to know, before the AI
// review asks, which lines of a skill a model knows anyway.
//
//   node scripts/skill-quiz.mjs <plugin dir> [--fact <id>]… [--changed <git diff args>] [options]
//   node scripts/skill-quiz.mjs <plugin dir> --ask "<question>" [options]
//
//   --fact <id>        only this fact; * matches anything; may be repeated
//   --changed <args>   only the facts whose used_by names a file that changed, as
//                      `git diff --name-only <args>` names them, for example main...HEAD. Also
//                      lists the changed Markdown of the plugin's skills that no fact names
//   --ask <question>   a question of your own, for a line that has no fact: prints the
//                      answers, without a grade
//   --model <id>       the model to ask; may be repeated (default: the review's baselines)
//   -n <n>             asks per fact and model (default 2: the review asks twice)
//   --judge <id>       the grading model (default: one of another vendor than the answer's)
//   --auth-home <dir>  without a Bedrock key: ask through Claude Code, signed in as in <dir>
//   --json <file>      the questions, the answers and the grades
//
// The AI review (.github/workflows/ai-review.yml, item 8) asks a small model without tools
// what a skill says, twice, and denies a line that model knows both times. This asks the
// same models, with the same system prompt, the questions of facts.yaml (lib/facts.mjs). A
// fact known in every answer of one model is what the review denies: cut the line. Known
// in some answers or in part: keep what was missed. Missed: the line earns its place.
//
// With AWS_BEARER_TOKEN_BEDROCK (as in CI), the models are called on Bedrock directly, as
// the review's baseline is: no agent, no tools. With --auth-home or ANTHROPIC_API_KEY, they
// are asked through Claude Code with no tools and the same system prompt; then only Claude
// models answer and grade, and the result says so. Credentials are handed to the client
// only, never printed. Exit 3 without credentials, 2 for wrong arguments, 1 when an ask failed.
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { changedFiles } from './lib/changed.mjs';
import { findCli } from './lib/clients.mjs';
import { parseFacts } from './lib/facts.mjs';
import { isMain } from './lib/is-main.mjs';

// The system prompt of the review's baseline (helix-shared-workflows, baseline-server.mjs).
export const SYSTEM = 'Answer from what you know. You have no tools, no files and no web access, and you can\'t ask back. Say what you would do or what you believe is true, briefly and concretely. If you don\'t know, say so.';

// The review's baselines, and a grader of another vendor for each: a model grades the
// answers of its own family more kindly.
export const BEDROCK = {
  models: ['global.anthropic.claude-haiku-5-5', 'global.openai.gpt-5.6-luna'],
  judge: (model) => (model.includes('anthropic') ? 'global.openai.gpt-6.1-sol' : 'global.anthropic.claude-opus-5-5'),
};
export const CLAUDE = { models: ['haiku'], judge: () => 'opus' };

export const GRADES = { known: '✓', partial: '~', unknown: '✗' };

export function judgePrompt({ question, claim, answer }) {
  return [
    'You grade whether a model knew a fact when it was asked a question without tools or documentation.',
    '',
    '## Question',
    question.trim(),
    '',
    '## The fact (the answer key)',
    claim.trim(),
    '',
    '## The answer',
    answer?.trim() || '(no answer)',
    '',
    'Grade the answer against the fact only:',
    '- "known": the answer states the fact fully and correctly, in any words.',
    '- "partial": the answer gets part of the fact right, states it vaguely or hedged, or mixes it with a wrong detail that matters.',
    '- "unknown": the answer misses the fact, contradicts it, or says it does not know.',
    'Correct detail beyond the fact is fine. A confident tone earns nothing.',
    '',
    'Answer with a JSON object only: {"grade":"known|partial|unknown","why":"<one sentence>"}',
  ].join('\n');
}

// The last JSON object in a text that has a grade.
export function parseGrade(text) {
  const found = String(text ?? '').match(/\{[^{}]*\}/g) ?? [];
  for (const candidate of found.reverse()) {
    try {
      const value = JSON.parse(candidate);
      const grade = String(value.grade ?? '').trim().toLowerCase();
      if (grade in GRADES) return { grade, why: String(value.why ?? '') };
    } catch {
      // not JSON: the next one
    }
  }
  return null;
}

// What the grades of one model say about a line: every answer knew it, some did, none did.
export function verdict(grades) {
  if (grades.length === 0 || grades.some((grade) => !grade)) return 'failed';
  if (grades.every((grade) => grade === 'known')) return 'redundant';
  if (grades.some((grade) => grade !== 'unknown')) return 'partly known';
  return 'missed';
}

// For a fact: redundant when one model knew it every time, as the review denies when one of
// its two baselines does.
export function factVerdict(byModel) {
  const verdicts = Object.values(byModel);
  if (verdicts.includes('redundant')) return 'redundant';
  if (verdicts.includes('partly known')) return 'partly known';
  return verdicts.length > 0 && verdicts.every((value) => value === 'missed') ? 'missed' : 'failed';
}

const ADVICE = { redundant: 'cut the line', 'partly known': 'keep what was missed; the review may say what was known', missed: 'keep', failed: 'ask again' };

// ---- the two ways to ask ----

// Bedrock Converse without a toolConfig: the model can only answer.
export function bedrockAsker({ key, region = 'us-west-2', endpoint = `https://bedrock-runtime.${region}.amazonaws.com`, fetchImpl = fetch }) {
  return async ({ model, system, prompt, maxTokens = 4000 }) => {
    const response = await fetchImpl(`${endpoint}/model/${encodeURIComponent(model)}/converse`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ system: [{ text: system }], messages: [{ role: 'user', content: [{ text: prompt }] }], inferenceConfig: { maxTokens } }),
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error(`Bedrock answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const data = await response.json();
    const text = (data?.output?.message?.content ?? []).map((block) => block.text ?? '').join('').trim();
    if (!text) throw new Error(`no text in the answer (stop reason: ${data?.stopReason ?? 'unknown'})`);
    return text;
  };
}

// Claude Code in an empty home, with no tools and the given system prompt.
export function claudeAsker({ bin, authHome, env = process.env }) {
  return async ({ model, system, prompt }) => {
    const home = mkdtempSync(join(tmpdir(), 'skill-quiz-home-'));
    const work = mkdtempSync(join(tmpdir(), 'skill-quiz-work-'));
    try {
      const stored = '.claude/.credentials.json';
      if (authHome && existsSync(join(authHome, stored))) {
        mkdirSync(join(home, '.claude'), { recursive: true });
        cpSync(join(authHome, stored), join(home, stored));
        chmodSync(join(home, stored), 0o600);
      }
      const childEnv = { PATH: env.PATH, HOME: home, TMPDIR: env.TMPDIR ?? '/tmp', LANG: 'C.UTF-8', TERM: 'dumb', NO_COLOR: '1', CI: '1' };
      if (env.ANTHROPIC_API_KEY) childEnv.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
      const ran = spawnSync(bin, ['-p', prompt, '--tools', '', '--system-prompt', system, '--model', model, '--output-format', 'json', '--max-turns', '1'], {
        cwd: work, env: childEnv, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024,
      });
      let result;
      try {
        result = JSON.parse(ran.stdout);
      } catch {
        throw new Error(`claude exited ${ran.status}: ${`${ran.stdout}${ran.stderr}`.trim().split('\n').pop() ?? ''}`);
      }
      if (result.is_error || !String(result.result ?? '').trim()) throw new Error(`claude: ${String(result.result ?? 'no answer').slice(0, 300)}`);
      return String(result.result).trim();
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(work, { recursive: true, force: true });
    }
  };
}

// ---- which facts ----

const glob = (pattern) => new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

// The facts to ask, and the changed Markdown of the skills that no fact names.
export function selectFacts(facts, { patterns = [], changed = null, pluginPath = '' } = {}) {
  const prefix = pluginPath ? `${pluginPath.replace(/\/$/, '')}/` : '';
  const inPlugin = changed?.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length));
  const wanted = patterns.map(glob);
  const selected = facts.filter((fact) => (wanted.length === 0 || wanted.some((pattern) => pattern.test(fact.id)))
    && (!inPlugin || fact.used_by.some((path) => inPlugin.includes(path))));
  const named = new Set(facts.flatMap((fact) => fact.used_by));
  const uncovered = (inPlugin ?? []).filter((file) => /^skills\/.+\.md$/.test(file) && !named.has(file));
  return { selected, uncovered };
}

async function pool(items, size, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

// Asks each fact n times of each model and grades each answer.
export async function quiz({ facts, models, runs, ask, judgeOf, concurrency = 4, log = () => {} }) {
  const jobs = facts.flatMap((fact) => models.flatMap((model) => Array.from({ length: runs }, (_, index) => ({ fact, model, run: index + 1 }))));
  const results = [];
  await pool(jobs, concurrency, async ({ fact, model, run }) => {
    const entry = { fact: fact.id, model, run };
    try {
      entry.answer = await ask({ model, system: SYSTEM, prompt: fact.question });
      const judge = judgeOf(model);
      entry.judge = judge;
      for (let attempt = 0; attempt < 2 && !entry.grade; attempt += 1) {
        const graded = parseGrade(await ask({ model: judge, system: 'You grade answers. Answer with JSON only.', prompt: judgePrompt({ question: fact.question, claim: fact.claim, answer: entry.answer }), maxTokens: 1000 }));
        if (graded) Object.assign(entry, graded);
      }
      if (!entry.grade) entry.error = 'the judge gave no grade';
    } catch (error) {
      entry.error = error.message;
    }
    results.push(entry);
    log(`${fact.id} ${model} #${run}: ${entry.grade ?? `failed (${entry.error})`}`);
  });
  const rows = facts.map((fact) => {
    const byModel = {};
    const marks = {};
    for (const model of models) {
      const mine = results.filter((entry) => entry.fact === fact.id && entry.model === model).sort((a, b) => a.run - b.run);
      byModel[model] = verdict(mine.map((entry) => entry.grade));
      marks[model] = mine.map((entry) => (entry.grade ? GRADES[entry.grade] : '!')).join('');
    }
    const outcome = factVerdict(byModel);
    return { fact: fact.id, used_by: fact.used_by, marks, byModel, verdict: outcome, advice: ADVICE[outcome] };
  });
  return { rows, results };
}

export function markdown({ rows, models, uncovered = [], notes = [] }) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  const out = [line(['Fact', ...models, 'Verdict']), line(['---', ...models.map(() => '---'), '---'])];
  for (const row of rows) out.push(line([`\`${row.fact}\``, ...models.map((model) => row.marks[model] || '—'), `${row.verdict}: ${row.advice}`]));
  out.push('', '✓ known, ~ partly known, ✗ missed, ! failed. A fact one model knew every time is what the AI review denies.');
  if (uncovered.length > 0) out.push('', 'Changed, and named by no fact (ask about these lines with --ask):', ...uncovered.map((file) => `- ${file}`));
  for (const note of notes) out.push('', note);
  return out.join('\n');
}

// ---- the command ----

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        fact: { type: 'string', multiple: true, default: [] },
        changed: { type: 'string' },
        ask: { type: 'string' },
        model: { type: 'string', multiple: true, default: [] },
        n: { type: 'string', short: 'n', default: '2' },
        judge: { type: 'string' },
        'auth-home': { type: 'string' },
        json: { type: 'string' },
      },
    });
  } catch (error) {
    fail(error.message);
  }
  const { values, positionals } = parsed;
  const runs = Number(values.n);
  if (positionals.length !== 1 || !(Number.isInteger(runs) && runs > 0)) {
    fail('usage: skill-quiz.mjs <plugin dir> [--fact <id>]… [--changed <git diff args>] [--ask "<question>"] [--model <id>]… [-n 2] [--judge <id>] [--auth-home <dir>] [--json <file>]');
  }
  const root = process.cwd();
  const pluginDir = resolve(positionals[0]);

  const notes = [];
  let ask;
  let defaults;
  if (process.env.AWS_BEARER_TOKEN_BEDROCK) {
    ask = bedrockAsker({ key: process.env.AWS_BEARER_TOKEN_BEDROCK, region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2' });
    defaults = BEDROCK;
  } else if (process.env.ANTHROPIC_API_KEY || (values['auth-home'] && existsSync(join(resolve(values['auth-home']), '.claude', '.credentials.json')))) {
    const bin = findCli('claude', { root });
    if (!bin) fail('claude is not installed. Run node scripts/setup-agent-clis.mjs first.');
    ask = claudeAsker({ bin, authHome: values['auth-home'] && resolve(values['auth-home']) });
    defaults = CLAUDE;
    notes.push('Asked through Claude Code: Claude models answered and graded. The review also asks a model of another vendor.');
  } else {
    fail('No credentials. Set AWS_BEARER_TOKEN_BEDROCK, or ANTHROPIC_API_KEY, or pass --auth-home with a home directory that is signed in to Claude Code.', 3);
  }
  const models = values.model.length > 0 ? values.model : defaults.models;
  const judgeOf = values.judge ? () => values.judge : defaults.judge;
  const log = (message) => console.error(message);

  if (values.ask) {
    const answers = [];
    for (const model of models) {
      for (let run = 1; run <= runs; run += 1) {
        try {
          answers.push({ model, run, answer: await ask({ model, system: SYSTEM, prompt: values.ask }) });
        } catch (error) {
          answers.push({ model, run, error: error.message });
        }
      }
    }
    for (const { model, run, answer, error } of answers) console.log(`## ${model} #${run}\n\n${answer ?? `failed: ${error}`}\n`);
    if (values.json) writeFileSync(values.json, `${JSON.stringify({ question: values.ask, answers }, null, 2)}\n`);
    if (answers.some((entry) => entry.error)) process.exit(1);
    return;
  }

  const factsFile = join(pluginDir, 'facts.yaml');
  if (!existsSync(factsFile)) fail(`${relative(root, factsFile)} does not exist. Write the facts first, or ask with --ask.`);
  const facts = parseFacts(readFileSync(factsFile, 'utf8'), relative(root, factsFile));
  const changed = values.changed ? changedFiles(root, values.changed.split(/\s+/).filter(Boolean)) : null;
  const { selected, uncovered } = selectFacts(facts, { patterns: values.fact, changed, pluginPath: relative(root, pluginDir).split('\\').join('/') });
  if (selected.length === 0 && uncovered.length === 0) {
    console.log('No fact matches.');
    return;
  }
  log(`${selected.length} fact(s) × ${models.length} model(s) × ${runs}`);
  const { rows, results } = await quiz({ facts: selected, models, runs, ask, judgeOf, log });
  console.log(markdown({ rows, models, uncovered, notes }));
  if (values.json) {
    mkdirSync(dirname(resolve(values.json)), { recursive: true });
    writeFileSync(values.json, `${JSON.stringify({ models, runs, rows, results, uncovered }, null, 2)}\n`);
  }
  if (results.some((entry) => entry.error)) process.exit(1);
}

if (isMain(import.meta.url)) await main();
