#!/usr/bin/env node
// Writes METHODOLOGY.html: how the evals work, the stack, what was added, how to read the results.
// Numbers (skills, cases, models, runs, costs) come from the stored results, so the page stays current.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { armComparison, costComparison, loadSkills, models, money, root, stats } from '../lib/results.mjs';

const skills = loadSkills();
const known = new Set(models.map((m) => m.label));
const totalRuns = skills.reduce((n, s) => n + s.rows.filter((r) => known.has(r.model)).length, 0);

const caseFiles = readdirSync(join(root, 'skills')).map((skill) => {
  const file = ['cases.yaml', 'sites.yaml'].find((f) => readdirSync(join(root, 'skills', skill)).includes(f));
  const cases = parse(readFileSync(join(root, 'skills', skill, file), 'utf-8'));
  const fixture = cases.filter((c) => !c.vars.url || c.vars.url.includes('localhost')).length;
  return { skill, total: cases.length, fixture, real: cases.length - fixture };
});
const totalCases = caseFiles.reduce((n, c) => n + c.total, 0);
const date = new Date().toISOString().slice(0, 10);
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// ---------- SVG helpers ----------
const COLORS = { existing: ['#e8eefc', '#2157d6'], added: ['#dff5e7', '#147d42'], tested: ['#fdf0d2', '#b4561d'], neutral: ['#fff', '#8a96ad'] };
const box = (x, y, w, h, title, sub, kind = 'neutral') => {
  const [fill, stroke] = COLORS[kind];
  const lines = [title, ...(sub ? [sub] : [])];
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
  <text x="${x + w / 2}" y="${y + (sub ? h / 2 - 4 : h / 2 + 5)}" text-anchor="middle" class="t1">${esc(lines[0])}</text>
  ${sub ? `<text x="${x + w / 2}" y="${y + h / 2 + 14}" text-anchor="middle" class="t2">${esc(sub)}</text>` : ''}</g>`;
};
const arrow = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#55627a" stroke-width="1.8" marker-end="url(#arr)"/>`;
const defs = '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#55627a"/></marker></defs>';

const flow = `<svg viewBox="0 0 980 300" role="img" aria-label="Pipeline of one eval run">${defs}
${box(10, 20, 200, 78, 'Skills repo', 'a git ref: branch or main', 'tested')}
${box(270, 20, 200, 78, 'Workspace', 'copy of the skill, per run', 'added')}
${box(530, 20, 200, 78, 'promptfoo', 'models × cases × 3 repeats', 'existing')}
${box(790, 20, 180, 78, 'Pi agent session', 'model + skill + browser', 'added')}
${arrow(210, 59, 268, 59)}${arrow(470, 59, 528, 59)}${arrow(730, 59, 788, 59)}
${box(790, 190, 180, 78, 'Code graders', 'files, answer, browser state', 'added')}
${box(530, 190, 200, 78, 'Run summary', 'pass, seconds, dollars', 'added')}
${box(270, 190, 200, 78, 'Reports', 'gist, per case, markdown', 'added')}
${box(10, 190, 200, 78, 'Lowest model', 'that meets the skill floor', 'neutral')}
${arrow(880, 98, 880, 188)}${arrow(788, 229, 732, 229)}${arrow(528, 229, 472, 229)}${arrow(268, 229, 212, 229)}
<text x="872" y="140" text-anchor="end" class="t2">headless browser,</text><text x="872" y="155" text-anchor="end" class="t2">fixtures + real sites</text>
</svg>`;

const layer = (y, label, items, defaultKind) =>
  `<text x="8" y="${y + 31}" class="t3">${esc(label)}</text>` +
  items.map(([name, sub, kind], i) => box(150 + i * 270, y, 255, 52, name, sub, kind ?? defaultKind)).join('');
const stack = `<svg viewBox="0 0 980 400" role="img" aria-label="The stack">
${layer(10, 'Models', [['Claude Haiku, Sonnet, Opus', 'Azure AI Foundry'], ['GPT-6 Sol', 'GitHub Copilot'], ['Qwen 3.8, Gemma 4', 'Cloudflare Workers AI']], 'existing')}
${layer(75, 'Agent harness', [['Pi coding agent', 'SDK: tools, skills, sessions'], ['pi-provider.mjs', 'our promptfoo provider for Pi', 'added']], 'existing')}
${layer(140, 'Orchestration', [['promptfoo', 'matrix, repeats, assertions'], ['Config builder + baseline gate', 'models.yaml → providers, baseline first', 'added']], 'existing')}
${layer(205, 'Under test', [['8 web skills', 'SKILL.md and their scripts'], ['Any git ref', 'a branch, a PR or main']], 'tested')}
${layer(270, 'Browsers', [['playwright-cli', 'headless Chrome, one session per run'], ['Chrome DevTools Protocol', 'cdp skills and state checks'], ['Headless shim', 'extension skill without a window', 'added']], 'existing')}
${layer(335, 'Test data', [['Fixture pages', 'known ground truth', 'added'], ['Real sites', 'bd, adobe, astrazeneca, aem.live', 'added'], ['Code graders', 'compare with ground truth', 'added']], 'added')}
</svg>`;

const gate = `<svg viewBox="0 0 980 190" role="img" aria-label="Baseline gate and floor">${defs}
${box(10, 50, 190, 80, 'Baseline model', 'Sonnet 5.5 low runs first', 'existing')}
${box(270, 50, 190, 80, 'Meets the floor?', '≥ 90% pass within 120 s', 'neutral')}
${box(530, 10, 190, 70, 'Run other models', 'Haiku, GPT, Opus, Qwen, …', 'added')}
${box(530, 110, 190, 70, 'Stop', 'fix the skill or the eval', 'tested')}
${box(790, 10, 180, 70, 'Lowest model', 'that meets the same floor', 'added')}
${arrow(200, 90, 268, 90)}${arrow(460, 70, 528, 45)}${arrow(460, 110, 528, 145)}${arrow(720, 45, 788, 45)}
<text x="472" y="52" class="t2">yes</text><text x="472" y="140" class="t2">no</text>
</svg>`;

// ---------- cost chart (data driven) ----------
const bars = skills
  .map((sk) => ({ skill: sk.skill, ...costComparison(sk) }))
  .filter((c) => c.lowestCost !== undefined)
  .map((c, i, all) => {
    const max = Math.max(...all.map((x) => x.topCost));
    const y = 28 + i * 44;
    const w = (v) => Math.max(3, Math.round((v / max) * 520));
    return `<text x="0" y="${y + 17}" class="t3">${esc(c.skill)}</text>
<rect x="150" y="${y}" width="${w(c.lowestCost)}" height="16" rx="3" fill="#147d42"/><text x="${156 + w(c.lowestCost)}" y="${y + 13}" class="t2">${money(c.lowestCost)} ${esc(c.lowest)}</text>
<rect x="150" y="${y + 19}" width="${w(c.topCost)}" height="16" rx="3" fill="#b4561d"/><text x="${156 + w(c.topCost)}" y="${y + 32}" class="t2">${money(c.topCost)} ${esc(c.top)}${c.topMeets ? '' : ' (misses floor)'}</text>`;
  });
const chart = `<svg viewBox="0 0 980 ${bars.length * 44 + 40}" role="img" aria-label="Cost per run">
<text x="150" y="14" class="t2">average cost per run: lowest sufficient model (green) vs the highest-tier model run (orange)</text>${bars.join('\n')}</svg>`;

// ---------- three-arm comparison chart ----------
const BAR_COLORS = ['#147d42', '#2157d6', '#b4561d'];
const pairs = skills.flatMap(armComparison).map((x) => ({
  name: `${x.skill} · ${x.label.split('-')[0]}`,
  bars: [x.a, x.b, x.c].map((s) => (s.n ? s.good / s.n : null)),
}));
const noSkillChart = pairs.length
  ? `<svg viewBox="0 0 980 ${pairs.length * 48 + 40}" role="img" aria-label="Skill, CLI, or neither">
<text x="230" y="14" class="t2">share of runs within the floor: skill + CLI (green), CLI only (blue), neither (orange)</text>
${pairs.map((p, i) => { const y = 26 + i * 48; return `<text x="0" y="${y + 24}" class="t3">${esc(p.name)}</text>
${p.bars.map((v, k) => (v === null ? '' : `<rect x="230" y="${y + k * 14}" width="${Math.max(2, Math.round(v * 600))}" height="12" rx="3" fill="${BAR_COLORS[k]}"/><text x="${236 + Math.round(v * 600)}" y="${y + k * 14 + 10}" class="t2">${Math.round(v * 100)}%</text>`)).join('')}`; }).join('\n')}</svg>`
  : '';

const coverage = caseFiles.map((c) => {
  const sk = skills.find((s) => s.skill === c.skill);
  return `<tr><td>${esc(c.skill)}</td><td>${c.fixture}</td><td>${c.real}</td><td>${sk ? sk.floor.max_latency_s : '-'} s</td></tr>`;
}).join('\n');

writeFileSync(join(root, 'METHODOLOGY.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>How the skill evals work</title>
<style>
  :root { --text:#172033; --muted:#55627a; --line:#d8deea; --bg:#f4f6fb; --blue:#2157d6; --green:#147d42; --orange:#b4561d; }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--text); background:var(--bg); }
  main { max-width: 1040px; margin: 0 auto; padding: 28px 20px 64px; }
  nav { display:flex; gap:18px; font-size:14px; margin-bottom: 18px; } nav a { color: var(--blue); text-decoration:none; }
  h1 { font-size: 34px; line-height:1.2; margin: 8px 0 6px; } h2 { font-size: 22px; margin: 44px 0 8px; } h3 { font-size:16px; margin: 0 0 4px; }
  .lead { font-size:18px; color: var(--muted); max-width: 760px; }
  .stats { display:grid; grid-template-columns: repeat(5, 1fr); gap:10px; margin: 24px 0 8px; }
  .stat { background:#fff; border:1px solid var(--line); border-radius:10px; padding:14px 16px; } .stat b { display:block; font-size:28px; } .stat span { color:var(--muted); font-size:13px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:12px; padding: 18px 20px; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap:12px; }
  .grid .card p { margin: 4px 0 0; color: var(--muted); font-size:14px; }
  svg { width:100%; height:auto; background:#fff; border:1px solid var(--line); border-radius:12px; padding:10px; }
  .t1 { font: 600 14px -apple-system,sans-serif; fill:#172033; } .t2 { font: 12px -apple-system,sans-serif; fill:#55627a; } .t3 { font: 600 13px -apple-system,sans-serif; fill:#172033; }
  .legend span { display:inline-block; margin-right:14px; font-size:13px; color:var(--muted); } .legend i { display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:6px; vertical-align:-1px; border:1.5px solid; }
  table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:10px; overflow:hidden; font-size:14px; }
  th, td { padding:9px 12px; text-align:left; border-bottom:1px solid var(--line); } th { background:#eef2fb; }
  ul { padding-left: 20px; margin: 8px 0; } li { margin: 5px 0; } code { background:#eef2fb; padding:1px 6px; border-radius:4px; font-size:13px; }
  pre { background:#172033; color:#e8eefc; padding:14px 16px; border-radius:10px; overflow:auto; font-size:13px; }
  .two { display:grid; grid-template-columns: 1fr 1fr; gap:14px; } @media (max-width: 760px) { .stats { grid-template-columns: repeat(2, 1fr); } .two { grid-template-columns: 1fr; } }
  footer { margin-top: 48px; color: var(--muted); font-size: 13px; }
</style></head><body><main>
<nav><a href="index.html">← Report</a><a href="https://github.com/aem-growth-adoption/skill-evals">GitHub repo</a></nav>
<h1>How the skill evals work</h1>
<p class="lead">An agent skill is only useful if the model that runs it follows it. We run each skill on several models, grade the outcome with code, and report the lowest-tier model that does the job well enough, so the model choice is a measured decision instead of "always pick the biggest".</p>

<div class="stats">
  <div class="stat"><b>${skills.length}</b><span>skills</span></div>
  <div class="stat"><b>${totalCases}</b><span>cases (fixture pages and real sites)</span></div>
  <div class="stat"><b>${models.length}</b><span>models, low to high tier</span></div>
  <div class="stat"><b>3×</b><span>repeats per case, for stability</span></div>
  <div class="stat"><b>${totalRuns}</b><span>graded agent runs</span></div>
</div>

<h2>A run, end to end</h2>
<p>Every number in the report comes from the same loop. The skill is copied from a git ref into a fresh workspace, promptfoo fans the work out over models, cases and repeats, and each run is a real agent session that uses the skill with a real headless browser.</p>
${flow}
<p class="legend" style="margin-top:10px"><span><i style="background:#e8eefc;border-color:#2157d6"></i>existing tool</span><span><i style="background:#dff5e7;border-color:#147d42"></i>added for this project</span><span><i style="background:#fdf0d2;border-color:#b4561d"></i>under test</span></p>

<h2>The stack: what existed, what we added</h2>
<p>We did not build an eval framework. promptfoo already provides the matrix, repeats, assertions and a viewer, and Pi already runs a model with tools and skills. What was missing was the glue between them, and the tests themselves.</p>
${stack}
<div class="two" style="margin-top:14px">
  <div class="card"><h3>Existing tools we rely on</h3><ul>
    <li><b>promptfoo</b>: test matrix, <code>--repeat</code>, assertions, the <code>skill-used</code> check, HTML export</li>
    <li><b>Pi coding agent</b>: SDK sessions, tool use, skill discovery, many model providers</li>
    <li><b>playwright-cli</b> and headless Chrome: the browser the skills drive</li>
    <li><b>Chrome DevTools Protocol</b>: for the cdp skills and for checking browser state</li>
    <li><b>GitHub Actions and Pages</b>: publishing the report</li>
  </ul></div>
  <div class="card"><h3>What we added</h3><ul>
    <li>A promptfoo provider for Pi: isolated skills, per-run workspace and browser session, timeouts counted as failures, tool trace</li>
    <li>${totalCases} cases with code graders and ground truth, plus a fixture server and a headless shim for the extension skill</li>
    <li>A baseline gate, per-skill floors, the report generators and a replay provider that renders results through promptfoo</li>
    <li>A fix in browser-probe so parallel runs no longer share browser sessions (PR #407)</li>
  </ul></div>
</div>

<h2>How a run is graded</h2>
<p>No model grades another model. Each case has a ground truth, either a fixture page whose answer we wrote or a real site checked against its own live behaviour, and a grader written in code.</p>
<div class="grid">
  <div class="card"><h3>1. The skill was used</h3><p>promptfoo's <code>skill-used</code> check. Pi has no skill tool, so reading the skill's <code>SKILL.md</code> counts.</p></div>
  <div class="card"><h3>2. The output is right</h3><p>Files in <code>./out</code>, the reply, or the tools' output, compared with the known answer: languages, forms, section counts, recipes.</p></div>
  <div class="card"><h3>3. The state is right</h3><p>For browser tasks the grader inspects the agent's own browser session: is the banner really gone, does the recipe really load the page.</p></div>
  <div class="card"><h3>4. It was fast enough</h3><p>Each skill has a time budget (usually 120 s). A slower run is aborted and counts as a failure. Broken output is a failure with a reason, never a harness error.</p></div>
</div>

<h2>From runs to an answer</h2>
<p>The baseline model runs first. If it cannot pass the suite, the problem is the skill or the eval, and other models are not run. The floor is the same for every model: at least 90% of runs pass within the time budget.</p>
${gate}
<ul>
  <li><b>Stability</b>: every case runs three times per model. A case is <i>flaky</i> when its repeats disagree, and the report counts those.</li>
  <li><b>Cost</b>: average dollars per run at the list prices configured in Pi, shown next to the pass rate.</li>
  <li><b>Tier order</b>: the order of models in <code>models.yaml</code> is a judgment call. "Lowest model" means the first one in that order that meets the floor.</li>
</ul>

<h2>The cost of the model choice</h2>
${chart}

${noSkillChart ? `<h2>Skill, CLI, or neither?</h2>
<p>The same cases run in three arms. <b>skill + CLI</b>: the skill is loaded and the <code>web</code> CLI is on PATH. <b>CLI only</b>: no skill is loaded or on disk, the CLI is on PATH, and the prompt adds one line: <code>A \`web\` CLI is installed; \`web --help\` documents it.</code> <b>Neither</b>: no skill and no CLI. Both comparison arms run in an empty workspace under a private home, and a grader fails any run that opens a skill file from disk (the skills are installed on this machine, so this is checked, not assumed). Their prompts also add the output format, meaning file names and fields, never how to produce them. Cases that hinge on a skill's own method are left out, every bar covers the same cases, and browser-probe is judged only on whether the recipe loads the page. To limit cost they run on a few models only. The report also records whether each CLI-only run actually called <code>web</code>.</p>
${noSkillChart}
<p style="color:var(--muted);font-size:14px">Read it as: what the CLI adds over a clear output format, and what the skill adds over the CLI. These are comparisons on small samples, not benchmarks.</p>` : ''}

<h2>Browsers stay invisible</h2>
<p>Evals must never open a window on the machine running them. Every agent shell refuses <code>--headed</code> and <code>open</code>, a grader fails any run that still tried, and a sweeper kills automation browsers started without <code>--headless</code>. The extension skill, which launches a headed Chromium by default, goes through a headless shim.</p>

<h2>Coverage</h2>
<table><thead><tr><th>Skill</th><th>Fixture cases</th><th>Real-site cases</th><th>Time budget</th></tr></thead><tbody>
${coverage}
</tbody></table>
<p style="color:var(--muted);font-size:14px">domain-mask is not covered: it needs sudo, edits <code>/etc/hosts</code> and binds port 443, so it cannot run unattended.</p>

<h2>What the benchmark already found</h2>
<ul>
  <li>browser-probe reused the same <code>playwright-cli</code> session names, so parallel probes broke each other. Fixed in the skill, with a test, in PR #407.</li>
  <li>page-prep sometimes hit its time limit because a model read the screenshot in the same turn that took it, then searched the whole disk for the file.</li>
  <li>Opus saved the page-tree node map in a leaner format than the skill's own. The grader first rejected it, which showed the check was too strict.</li>
  <li>cdp-ext-pilot opens a headed browser by default. A shim now runs it headless so evals do not take over the screen.</li>
</ul>

<h2>What these numbers do not tell you</h2>
<ul>
  <li><b>Small samples</b>: 9 to 27 runs per skill and model. Differences of a few points are noise.</li>
  <li><b>Live sites move</b>: real sites change their bot protection, so results drift. Fixture cases do not.</li>
  <li><b>One harness, one effort level</b>: every model runs in Pi at low reasoning effort. Another harness or setting can behave differently.</li>
  <li><b>List-price costs</b>: they estimate cost, they are not an invoice, and subscription models are priced as if per token.</li>
  <li><b>One skill version</b>: results describe the git ref listed in the report, not later changes.</li>
</ul>

<h2>Run it or extend it</h2>
<pre>scripts/run.sh page-tree origin/main     # baseline first, then the other models
scripts/run.sh page-tree my-branch 'haiku'   # only matching models
npm run report                            # results → REPORT.html, REPORT.md, METHODOLOGY.html</pre>
<p>Adding a model is one entry in <code>models.yaml</code>. Adding a skill is a folder under <code>skills/</code> with a config, cases, graders and a floor.</p>

<footer>Generated ${date} from the stored results of ${totalRuns} runs. Tools: promptfoo, Pi coding agent, playwright-cli, Chrome DevTools Protocol, GitHub Pages.</footer>
</main></body></html>
`);
console.log('METHODOLOGY.html written');
