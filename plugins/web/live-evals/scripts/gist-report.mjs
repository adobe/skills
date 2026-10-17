#!/usr/bin/env node
// Writes REPORT.html: one self-contained page, one row per skill, one column per model, coloured by
// whether the model meets the skill's floor. REPORT-detail.html (promptfoo) has the per-case view.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { abc, armComparison, armVerdicts, cliUsedText, costComparison, loadSkills, models, money, root, stats } from '../lib/results.mjs';

const skills = loadSkills();
const known = new Set(models.map((m) => m.label));
const totalRuns = skills.reduce((n, s) => n + s.rows.filter((r) => known.has(r.model)).length, 0);
const baseline = models.findIndex((m) => m.baseline);
const fmtFactor = (f) => (f >= 10 ? f.toFixed(0) : f.toFixed(1));
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const heat = (s, floor) => {
  if (!s.n) return 'none';
  if (s.meets) return 'ok';
  return s.good / s.n >= floor.min_pass_rate - 0.2 ? 'near' : 'bad';
};

const rows = skills.map((sk) => {
  const per = models.map((m) => stats(sk.rows.filter((r) => r.model === m.label), sk.floor));
  const lowest = models.find((_, i) => per[i].meets)?.label ?? 'none';
  const baselineBad = baseline >= 0 && per[baseline].n > 0 && !per[baseline].meets;
  const cells = per.map((s) => (s.n
    ? `<td class="${heat(s, sk.floor)}"><b>${Math.round((100 * s.good) / s.n)}%</b><small>${s.good}/${s.n} · ${s.avg.toFixed(0)} s</small><small class="cost">${money(s.cost)}/run</small><small>${s.flaky ? `<span class="flaky">${s.flaky} of ${s.cases} cases flaky</span>` : 'stable'}</small></td>`
    : '<td class="none">·</td>')).join('');
  const c = costComparison(sk);
  const saving = c.factor && c.lowest !== c.top ? `<small class="cost">${money(c.lowestCost)}/run, ${fmtFactor(c.factor)}× cheaper than ${esc(c.top)}${c.topMeets ? '' : ' (which misses the floor)'}</small>` : '';
  return `<tr><th>${esc(sk.skill)}</th>${cells}<td class="floor"><b>${esc(lowest)}</b>${saving}${baselineBad ? '<small>baseline below floor: provisional</small>' : ''}</td></tr>`;
}).join('\n');

const head = models.map((m) => `<th>${esc(m.label)}${m.baseline ? '<small>baseline</small>' : ''}</th>`).join('');
const pct = (x) => (x.n ? `${Math.round((100 * x.good) / x.n)}%` : '·');
const armCell = (s, floor) => (s.n
  ? `<td class="${heat(s, floor)}"><b>${pct(s)}</b><small>${s.good}/${s.n}</small></td>` : '<td class="none">·</td>');
const armRows = skills.flatMap(armComparison);
const armBody = armRows.map((x) => `<tr><th>${esc(x.skill)}<small>${esc(x.label)}</small></th>
${armCell(x.a, x.floor)}${armCell(x.b, x.floor)}${armCell(x.c, x.floor)}
<td><b>${abc(x.a, x.b, x.c, (s) => s.avg.toFixed(0))}</b><small>seconds</small></td>
<td><b>${abc(x.a, x.b, x.c, (s) => money(s.cost))}</b><small>per run</small></td>
<td><b>${cliUsedText(x)}</b><small>CLI-only runs</small></td></tr>
<tr><td colspan="7" style="text-align:left;background:none"><small>${esc(armVerdicts(x).join('; '))}.</small></td></tr>`).join('\n');
const noSkillSection = armRows.length ? `
<h2>Skill, CLI, or neither?</h2>
<p>The same cases in three arms: the skill with its CLI, the CLI alone (no skill on disk, the prompt only says <code>web --help</code> documents it), and neither. Each cell covers the same cases. A comparison on a few models, not a benchmark.</p>
<table class="cmp"><thead><tr><th>Skill and model</th><th>skill + CLI</th><th>CLI only</th><th>neither</th><th>Time</th><th>Cost</th><th>CLI used</th></tr></thead>
<tbody>
${armBody}
</tbody></table>
<p class="legend" style="margin-top:10px"><span class="ok">meets the floor</span><span class="near">within 20 points</span><span class="bad">well below</span></p>` : '';
const date = new Date().toISOString().slice(0, 10);
const comparisons = skills.map(costComparison).filter((c) => c.lowestCost !== undefined && c.topCost > 0);
const sum = (key) => comparisons.reduce((n, c) => n + c[key], 0);
const headline = comparisons.length
  ? `<p class="headline">Using the lowest sufficient model for each skill costs about <b>${Math.round((100 * sum('lowestCost')) / sum('topCost'))}%</b> of always using ${esc(comparisons[0].top)} (average cost per run, summed over ${comparisons.length} skills).</p>`
  : '';

writeFileSync(join(root, 'REPORT.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Skill evals: lowest model per skill</title>
<style>
  body { font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #f4f6fb; margin: 0; }
  main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 48px; }
  h1 { font-size: 24px; margin: 0 0 4px; } p { margin: 4px 0 16px; color: #55627a; }
  table { border-collapse: separate; border-spacing: 4px; width: 100%; }
  th, td { padding: 10px 12px; text-align: center; border-radius: 6px; background: #fff; }
  thead th { background: none; font-weight: 600; } th small { display: block; font-weight: 400; color: #55627a; }
  tbody th { text-align: left; background: none; font-weight: 600; }
  td b { display: block; font-size: 17px; } td small { display: block; color: #55627a; font-size: 12px; }
  .ok { background: #dff5e7; } .near { background: #fdf0d2; } .bad { background: #fbdcd8; } .none { color: #99a; }
  small.cost { color: #3b5bb5; } .flaky { color: #b4561d; font-weight: 600; } .headline { font-size: 16px; color: #172033; background: #fff; padding: 12px 16px; border-radius: 8px; }
  h2 { font-size: 20px; margin: 40px 0 4px; } table.cmp tbody th small { font-weight: 400; }
  .delta { background: #fff; } .verdict.same { background: #eef0f4; } .verdict.adds { background: #e0eafd; } .verdict.hurts { background: #fde7d3; } .verdict.none { background: #fbdcd8; }
  .floor { background: #e8eefc; } .legend span { display: inline-block; padding: 2px 10px; border-radius: 4px; margin-right: 8px; font-size: 13px; }
  footer a { color: #2157d6; }
  footer { margin-top: 20px; color: #55627a; font-size: 13px; }
</style></head><body><main>
<h1>Which model does each skill need?</h1>
<p>Share of runs that pass within the skill's time budget, with average run time, cost per run and stability. Every case runs several times (usually three) per model; a case is <span class="flaky">flaky</span> when its repeats disagree. The last column is the lowest-tier model that meets the skill's floor.</p>
${headline}
<p class="legend"><span class="ok">meets the floor</span><span class="near">within 20 points</span><span class="bad">well below</span><span class="none">not run</span></p>
<table><thead><tr><th>Skill</th>${head}<th>Lowest model meeting the floor</th></tr></thead>
<tbody>
${rows}
</tbody></table>
${noSkillSection}
<footer>${skills.length} skills, ${models.length} models, ${totalRuns} runs, generated ${date}. Floor: pass rate and time budget per skill (skills/&lt;skill&gt;/skill.yaml), usually 90% within 120 s.
Models run in tier order; the baseline must meet the floor first. Cost is the average per run at the list prices configured in Pi (per-token estimates, not an invoice). Small samples (9 to 27 runs per cell): gaps of a few points are noise.
How this was measured: <a href="methodology.html">methodology and stack</a>. Source and per-case results: <a href="https://github.com/adobe/skills/tree/main/plugins/web/live-evals">GitHub repo</a>.</footer>
</main></body></html>
`);
console.log('REPORT.html written');
