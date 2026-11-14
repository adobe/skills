import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const models = parse(readFileSync(join(root, 'models.yaml'), 'utf-8')).sort((a, b) => a.rank - b.rank);
export const read = (...p) => readFileSync(join(root, ...p), 'utf-8');
export const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-');

export const loadSkill = (skill) => {
  const { floor } = parse(read('skills', skill, 'skill.yaml'));
  const files = readdirSync(join(root, 'results', skill)).filter((f) => f.endsWith('.json'));
  const all = files.sort().map((f) => JSON.parse(read('results', skill, f)));
  const summaries = all.filter((s) => (s.arm ?? 'skill') === 'skill');
  const ordered = summaries.map((s, i) => [s, i]).sort((a, b) => (a[0].date > b[0].date) - (a[0].date < b[0].date) || a[1] - b[1]).map(([s]) => s);
  const latest = ordered.at(-1);
  const ref = latest?.ref;
  const earlierRefs = [...new Set(ordered.map((s) => s.ref))].filter((r) => r !== ref);
  const current = summaries.filter((s) => s.ref === ref);
  const latestArm = (name) => {
    const arm = all.filter((s) => s.arm === name);
    const armRef = arm.at(-1)?.ref;
    return { ref: armRef, rows: arm.filter((s) => s.ref === armRef).flatMap((s) => s.runs) };
  };
  const noSkill = latestArm('no-skill');
  const cli = latestArm('cli');
  return {
    skill,
    floor,
    ref,
    commit: latest?.commit,
    earlierRefs,
    refs: [ref, ...earlierRefs].filter(Boolean),
    noSkillRef: noSkill.ref,
    noSkillRows: noSkill.rows,
    cliRef: cli.ref,
    cliRows: cli.rows,
    rows: current.flatMap((s) => s.runs),
  };
};

// A run aborted at the budget is outside it even when its artifacts pass the checks.
export const isGood = (r, floor) => r.pass && !r.timed_out && r.latency_s <= floor.max_latency_s;
export const stats = (runs, floor) => {
  const sorted = runs.map((r) => r.latency_s).sort((a, b) => a - b);
  const good = runs.filter((r) => isGood(r, floor)).length;
  // Stability: every case is run several times per model; it is flaky when its repeats disagree.
  const outcomes = new Map();
  for (const r of runs) outcomes.set(r.case, [...(outcomes.get(r.case) ?? []), isGood(r, floor)]);
  const flaky = [...outcomes.values()].filter((o) => o.includes(true) && o.includes(false)).length;
  return {
    cases: outcomes.size,
    flaky,
    n: runs.length,
    good,
    meets: runs.length > 0 && good / runs.length >= floor.min_pass_rate,
    avg: runs.reduce((s, r) => s + r.latency_s, 0) / (runs.length || 1),
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] ?? 0,
    timeouts: runs.filter((r) => r.timed_out).length,
    cost: runs.reduce((s, r) => s + r.cost_usd, 0) / (runs.length || 1),
  };
};

export const cell = (s) => (s.n ? `${s.meets ? '✓' : '✗'} ${pct(s.good, s.n)} (${s.good}/${s.n})` : '·');
export const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');


/** Skills that have a suite and stored results. */
export const loadSkills = () => {
  const resultsDir = join(root, 'results');
  if (!existsSync(resultsDir)) return [];
  return readdirSync(join(root, 'skills')).filter((s) => readdirSync(resultsDir).includes(s)).map(loadSkill);
};

const usd = (v) => (v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`);
export const money = usd;

/**
 * Per skill: the lowest model meeting the floor versus the highest-tier model that was run,
 * with average cost per run for each and how many times cheaper the lowest is.
 */
export function costComparison(sk) {
  const per = models.map((m) => ({ m, s: stats(sk.rows.filter((r) => r.model === m.label), sk.floor) })).filter((x) => x.s.n);
  const lowest = per.find((x) => x.s.meets);
  const top = per.at(-1);
  if (!lowest || !top) return { lowest: lowest?.m.label ?? null, top: top?.m.label ?? null };
  return {
    lowest: lowest.m.label,
    lowestCost: lowest.s.cost,
    top: top.m.label,
    topMeets: top.s.meets,
    topCost: top.s.cost,
    factor: lowest.s.cost > 0 ? top.s.cost / lowest.s.cost : null,
  };
}

/**
 * Skill + CLI vs CLI only vs neither, per model that has rows in a comparison arm, all over the
 * cases present in every comparison arm that has rows (the intersection).
 */
export function armComparison(sk) {
  const arms = [sk.cliRows, sk.noSkillRows].filter((r) => r.length);
  if (!arms.length) return [];
  const caseSets = arms.map((r) => new Set(r.map((x) => x.case)));
  const shared = [...caseSets[0]].filter((c) => caseSets.every((s) => s.has(c)));
  const pick = (rows, label) => rows.filter((r) => r.model === label && shared.includes(r.case));
  const labels = new Set([...sk.cliRows, ...sk.noSkillRows].map((r) => r.model));
  return models.filter((m) => labels.has(m.label)).map((m) => {
    const runs = [pick(sk.rows, m.label), pick(sk.cliRows, m.label), pick(sk.noSkillRows, m.label)];
    const [a, b, c] = runs.map((r) => stats(r, sk.floor));
    const cliUsed = runs[1].length ? runs[1].filter((r) => r.used_cli).length / runs[1].length : null;
    return { skill: sk.skill, label: m.label, floor: sk.floor, a, b, c, cliUsed };
  });
}

const rate = (s) => (s.n ? s.good / s.n : null);
const pts = (x) => Math.round(100 * x);
/** Three neutral one-line verdicts from an armComparison row (empty when an arm has no runs). */
export function armVerdicts({ a, b, c, floor }) {
  const out = [];
  if (a.n && b.n) out.push(`the skill adds ${pts(rate(a) - rate(b))} points over CLI only`);
  if (b.n && c.n) out.push(`the CLI adds ${pts(rate(b) - rate(c))} points over neither`);
  if (b.n) out.push(`CLI only ${b.meets ? 'reaches' : 'does not reach'} the floor (${pts(floor.min_pass_rate)}%)`);
  return out;
}
export const abc = (a, b, c, f) => [a, b, c].map((s) => (s.n ? f(s) : '·')).join(' / ');
export const cliUsedText = (x) => (x.cliUsed === null ? '·' : pct(Math.round(x.cliUsed * 100), 100));
