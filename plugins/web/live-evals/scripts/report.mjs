#!/usr/bin/env node
// Aggregates results/<skill>/*.json into REPORT.md:
//   1. the gist: lowest model meeting each skill's floor,
//   2. a skill x model matrix (share of runs that passed within the skill's floor),
//   3. per skill: model stats, a case x model matrix and the most common failure reasons.
// scripts/promptfoo-report.mjs renders the same data as promptfoo HTML reports.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { abc, armComparison, armVerdicts, cell, cliUsedText, costComparison, isGood, loadSkills, models, money, pct, root, stats, table } from '../lib/results.mjs';

/** Failure reasons with numbers and quoted values stripped, so similar failures group together. */
const reasonKey = (r) => {
  if (r.timed_out) return 'timed out';
  const first = Array.isArray(r.why) ? r.why[0] : r.why;
  return String(first ?? 'unknown').replace(/["'`].*?["'`]/g, '…').replace(/\d+(\.\d+)?/g, 'N').slice(0, 90);
};

function summaryRow(sk) {
  const per = models.map((m) => stats(sk.rows.filter((r) => r.model === m.label), sk.floor));
  const lowest = models.find((_, i) => per[i].meets)?.label ?? 'none';
  const baseline = models.findIndex((m) => m.baseline);
  const flag = baseline >= 0 && per[baseline].n && !per[baseline].meets ? ' ⚠ baseline below floor' : '';
  return [`[${sk.skill}](#${sk.skill})`, ...per.map(cell), `**${lowest}**${flag}`];
}

function skillSection(sk) {
  const { skill, floor, rows, ref, commit, earlierRefs } = sk;
  const lines = [`## ${skill}`, '', `Floor: ≥ ${floor.min_pass_rate * 100}% of runs pass within ${floor.max_latency_s} s. `, '', `Skill ref: ${ref}${commit ? ` (${commit})` : ''}.${earlierRefs.length ? ` Earlier refs, not pooled: ${earlierRefs.join(', ')}.` : ''}`, ''];

  const perModel = models.map((m) => [m, stats(rows.filter((r) => r.model === m.label), floor)]).filter(([, s]) => s.n);
  lines.push(table(['Model', 'Runs', 'Passed', 'Within floor', 'Flaky cases', 'Avg s', 'p95 s', 'Timeouts', '$/run'],
    perModel.map(([m, s]) => [m.label + (m.baseline ? ' (baseline)' : ''), s.n, pct(rows.filter((r) => r.model === m.label && r.pass).length, s.n), cell(s), `${s.flaky} of ${s.cases}`, s.avg.toFixed(0), s.p95.toFixed(0), s.timeouts, s.cost.toFixed(3)])), '');

  const cases = [...new Set(rows.map((r) => r.case))];
  lines.push('**By case** (share of runs within the floor)', '');
  lines.push(table(['Case', ...perModel.map(([m]) => m.label)],
    cases.map((c) => [c, ...perModel.map(([m]) => { const s = stats(rows.filter((r) => r.case === c && r.model === m.label), floor); return s.n ? `${pct(s.good, s.n)} (${s.good}/${s.n})` : '·'; })])), '');

  const failures = new Map();
  for (const r of rows.filter((x) => !isGood(x, floor))) {
    const key = `${r.model}: ${reasonKey(r)}`;
    failures.set(key, (failures.get(key) ?? 0) + 1);
  }
  const top = [...failures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (top.length) lines.push('**Most common failures**', '', ...top.map(([k, n]) => `- ${n}× ${k}`), '');
  return lines.join('\n');
}

const skills = loadSkills();
const known = new Set(models.map((m) => m.label));
const totalRuns = skills.reduce((n, s) => n + s.rows.filter((r) => known.has(r.model)).length, 0);
const lowestFor = (sk) => {
  const per = models.map((m) => stats(sk.rows.filter((r) => r.model === m.label), sk.floor));
  const baseline = models.findIndex((m) => m.baseline);
  return { lowest: models.find((_, i) => per[i].meets)?.label ?? 'none', baselineOk: baseline < 0 || per[baseline].meets };
};
const gist = skills
  .map((sk) => ({ skill: sk.skill, ...lowestFor(sk) }))
  .map(({ skill, lowest, baselineOk }) => `- **${skill}**: ${lowest}${baselineOk ? '' : ' (baseline below its floor, treat as provisional)'}`)
  .join('\n');
const fmtFactor = (f) => (f >= 10 ? f.toFixed(0) : f.toFixed(1));
const costTable = table(['Skill', 'Lowest sufficient model', '$/run', 'Highest model run', '$/run', 'Savings'],
  skills.map((sk) => {
    const c = costComparison(sk);
    if (c.lowestCost === undefined) return [sk.skill, c.lowest ?? 'none', '-', c.top ?? '-', '-', '-'];
    return [sk.skill, c.lowest, money(c.lowestCost), c.top + (c.topMeets ? '' : ' (misses floor)'), money(c.topCost), c.factor && c.lowest !== c.top ? `${fmtFactor(c.factor)}× cheaper` : 'same model'];
  }));
const armRows = skills.flatMap(armComparison);
const armSkills = skills.filter((sk) => sk.cliRows.length || sk.noSkillRows.length);
const armTable = armRows.length
  ? `Comparison rows come from the ref(s): ${armSkills.map((sk) => `${sk.skill} → CLI only ${sk.cliRef ?? '·'}, neither ${sk.noSkillRef ?? '·'}`).join('; ')}.\n\n` + table(['Skill', 'Model', 'skill + CLI', 'CLI only', 'neither', 'time (s)', '$/run', 'CLI used'],
    armRows.map((x) => [x.skill, x.label, cell(x.a), cell(x.b), cell(x.c), abc(x.a, x.b, x.c, (s) => s.avg.toFixed(0)), abc(x.a, x.b, x.c, (s) => money(s.cost)), cliUsedText(x)]))
    + '\n\n' + armRows.map((x) => `- ${x.skill} · ${x.label}: ${armVerdicts(x).join('; ')}.`).join('\n')
  : '';
const summary = table(['Skill', ...models.map((m) => `${m.label}${m.baseline ? ' (baseline)' : ''}`), 'Lowest model meeting the floor'], skills.map(summaryRow));

writeFileSync(join(root, 'REPORT.md'), `# Skill eval report

${skills.length} skills, ${models.length} models, ${totalRuns} runs. Models are ordered from lowest to highest tier.
Each cell is the share of runs that passed within the skill's time budget; ✓ means it meets the skill's floor
(see each section), ✗ that it does not, · that the model was not run. Every case is run several times per
model (usually 3) to measure stability: a case is flaky when its repeats disagree, which the per-skill tables count. Numbers rest on small samples (9 to 27 runs
per cell): treat gaps of a few points as noise. Live sites drift, so rerun before relying on one result.

## The gist

${gist}

## Cost of the model choice

${costTable}

## Skill x model matrix

${summary}

${armTable ? `## Skill, CLI, or neither

Same cases and the same graders in three arms. \`skill + CLI\`: the skill is loaded and the \`web\` CLI is on PATH. \`CLI only\`: no skill anywhere, the CLI is on PATH and the prompt says \`web --help\` documents it. \`neither\`: no skill and no CLI. The two comparison arms get the output format (file names and fields, never how to produce them) appended to the prompt, because the graders read the skill's own formats; runs that open a skill file fail. Cases that depend on a skill's own method are left out, and every cell covers the same cases. Only a few models are run this way: it is a comparison, not a benchmark. \`CLI used\` is the share of CLI-only runs whose shell commands called \`web\`.

${armTable}
` : ''}
${skills.map(skillSection).join('\n')}
## How to read this

- A run passes when every scored assertion holds: the skill was loaded, the files or answer match the ground
  truth, and (for browser tasks) the page is really in the expected state. Slower than the budget counts as a failure.
- The baseline model must meet a skill's floor before other models are run (\`scripts/run.sh\`). A ⚠ marks a baseline
  that does not, which means the skill or its eval needs work before the other rows mean anything.
- "Lowest model meeting the floor" uses the model order in \`models.yaml\`, which is a judgment call, not a benchmark.
- Raw promptfoo results stay in \`output/\`; \`npx promptfoo view\` browses the evals run on this machine.
`);
console.log(`REPORT.md written: ${skills.map((s) => s.skill).join(', ')}`);
