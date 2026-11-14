#!/usr/bin/env node
// Chain census: skill open order, references read, cost and actions per attempt of a skill-eval run.
// Usage: node tools/skill-eval/scripts/census.mjs <run-dir> <plugin-root> [--out <file.md>]
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWatcher } from '../lib/trigger.mjs';
import { loadPlugin } from '../lib/scenarios.mjs';

const [runDir, pluginRoot, ...rest] = process.argv.slice(2);
if (!runDir || !pluginRoot) {
  console.error('Usage: census.mjs <run-dir> <plugin-root> [--out <file.md>]');
  process.exit(1);
}
const outIdx = rest.indexOf('--out');
const outFile = outIdx >= 0 ? rest[outIdx + 1] : join(runDir, 'census.md');

const CHAIN = ['aem-cli', 'analyze-and-plan', 'content-modeling', 'find-test-content', 'da-content', 'building-blocks', 'block-collection-and-party', 'testing-blocks', 'code-review'];
const short = {
  'content-driven-development': 'CDD', 'aem-cli': 'cli', 'analyze-and-plan': 'plan', 'content-modeling': 'model',
  'find-test-content': 'ftc', 'da-content': 'dac', 'building-blocks': 'BB', 'block-collection-and-party': 'bcp',
  'testing-blocks': 'test', 'code-review': 'cr', 'da-auth': 'daa',
};
const s = (n) => short[n] ?? n;

const plugin = await loadPlugin(pluginRoot);
async function loadAttempts() {
  try {
    const results = JSON.parse(await readFile(join(runDir, 'results.json'), 'utf8'));
    return results.attempts ?? results.results;
  } catch {
    const { execFileSync } = await import('node:child_process');
    const files = execFileSync('find', [join(runDir, 'attempts'), '-name', 'result.json'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    console.error(`results.json missing (run in progress?): using ${files.length} attempt result.json file(s)`);
    return Promise.all(files.map(async (f) => JSON.parse(await readFile(f, 'utf8'))));
  }
}
const attempts = await loadAttempts();

function actions(calls) {
  const cmds = calls.filter((c) => c.name === 'bash').map((c) => String(c.arguments?.command ?? ''));
  const has = (re) => cmds.some((c) => re.test(c));
  return {
    install: has(/\bnpm (ci|install|i)\b(?!\s+-g)/),
    aemUp: has(/\baem(-cli)?\s+up\b|aem-cli.*\bup\b/),
    lint: has(/\b(npm run lint|eslint|stylelint)\b/),
    test: has(/\b(playwright|npm (run )?test|node --test|vitest|jest)\b/),
    browser: has(/playwright|chrom|screenshot/i),
  };
}

const rows = [];
for (const a of attempts) {
  const lines = (await readFile(join(a.dir, 'session.jsonl'), 'utf8').catch(() => '')).split('\n');
  const w = createWatcher(plugin.skills, { keepGoing: true, maxTurns: Infinity });
  const calls = [];
  const refs = new Set();
  for (const l of lines) {
    if (!l.trim()) continue;
    w.feed(`${l}\n`);
    let ev;
    try { ev = JSON.parse(l); } catch { continue; }
    if (ev.type !== 'message_end' || ev.message?.role !== 'assistant') continue;
    for (const c of ev.message.content ?? []) {
      if (c.type !== 'toolCall') continue;
      calls.push(c);
      const args = JSON.stringify(c.arguments ?? {});
      for (const m of args.matchAll(/\/skills\/([a-z0-9-]+)\/((?:references|scripts|resources)\/[^"\s\\]+)/g)) refs.add(`${s(m[1])}:${m[2]}`);
    }
  }
  const r = w.result();
  const changes = JSON.parse(await readFile(join(a.dir, 'changes.json'), 'utf8').catch(() => '{"files":[]}')).files ?? [];
  rows.push({
    scenario: a.scenario, variant: a.variant, model: a.model.split('/').pop(), run: a.run, status: a.status,
    order: r.order, turns: a.turns, tokens: a.tokens?.total ?? 0, cost: a.cost ?? 0, durationMs: a.durationMs ?? 0,
    refs: [...refs], files: changes.map((f) => `${f.status} ${f.path}`), ...actions(calls),
    content: changes.some((f) => /^(content|drafts)\/|\.html$|\.md$/.test(f.path) && !/README|AGENTS|CLAUDE/.test(f.path)),
  });
}

const k = (n) => `${Math.round(n / 1000)}k`;
const yes = (b) => (b ? '✓' : '');
const out = ['# Chain census', '', `Run: \`${runDir}\`. Plugin: \`${pluginRoot}\` (${plugin.skills.length} skills).`, ''];
out.push('## Per run', '', '| Task | Variant | Model | # | Status | Skills opened (turn) | Turns | Tokens | Min | npm ci | aem up | Lint | Test | Content | Files |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows.sort((a, b) => a.scenario.localeCompare(b.scenario) || String(a.variant).localeCompare(String(b.variant)) || a.model.localeCompare(b.model) || a.run - b.run)) {
  out.push(`| ${r.scenario} | ${r.variant} | ${r.model} | ${r.run} | ${r.status} | ${r.order.map((o) => `${s(o.skill)}@${o.turn}`).join(' → ') || '—'} | ${r.turns} | ${k(r.tokens)} | ${(r.durationMs / 60000).toFixed(1)} | ${yes(r.install)} | ${yes(r.aemUp)} | ${yes(r.lint)} | ${yes(r.test)} | ${yes(r.content)} | ${r.files.length} |`);
}

out.push('', '## Per task and variant (pooled over models and runs)', '', `| Task | Variant | Runs | CDD | ${CHAIN.map(s).join(' | ')} | First opened | Median tokens | Median turns |`, `|---|---|---|---|${CHAIN.map(() => '---').join('|')}|---|---|---|`);
const median = (xs) => { const v = [...xs].sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : 0; };
const variants = [...new Set(rows.map((r) => r.variant))].sort();
for (const scn of [...new Set(rows.map((r) => r.scenario))]) for (const vr of variants) {
  const rs = rows.filter((r) => r.scenario === scn && r.variant === vr && r.status === 'ok');
  if (!rs.length) continue;
  const opened = (n) => `${rs.filter((r) => r.order.some((o) => o.skill === n)).length}/${rs.length}`;
  const first = new Map();
  for (const r of rs) { const f = s(r.order[0]?.skill ?? 'none'); first.set(f, (first.get(f) ?? 0) + 1); }
  out.push(`| ${scn} | ${vr} | ${rs.length} | ${opened('content-driven-development')} | ${CHAIN.map(opened).join(' | ')} | ${[...first].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ×${c}`).join(', ')} | ${k(median(rs.map((r) => r.tokens)))} | ${median(rs.map((r) => r.turns))} |`);
}

out.push('', '## Shadowing: building-blocks vs content-driven-development', '', '| Variant | Model | Runs | CDD opened | BB opened | BB after CDD | CDD without BB | BB without CDD | Neither |', '|---|---|---|---|---|---|---|---|---|');
for (const vr of variants) for (const m of [...new Set(rows.map((r) => r.model)), 'pooled']) {
  const rs = rows.filter((r) => r.status === 'ok' && r.variant === vr && (m === 'pooled' || r.model === m));
  if (!rs.length) continue;
  const at = (r, n) => r.order.find((o) => o.skill === n);
  const c = (f) => rs.filter(f).length;
  out.push(`| ${vr} | ${m} | ${rs.length} | ${c((r) => at(r, 'content-driven-development'))} | ${c((r) => at(r, 'building-blocks'))} | ${c((r) => at(r, 'content-driven-development') && at(r, 'building-blocks') && at(r, 'building-blocks').turn >= at(r, 'content-driven-development').turn)} | ${c((r) => at(r, 'content-driven-development') && !at(r, 'building-blocks'))} | ${c((r) => !at(r, 'content-driven-development') && at(r, 'building-blocks'))} | ${c((r) => !r.order.length)} |`);
}

out.push('', '## References and scripts read', '');
const refCount = new Map();
for (const r of rows) for (const ref of r.refs) refCount.set(ref, (refCount.get(ref) ?? 0) + 1);
for (const [ref, n] of [...refCount].sort((a, b) => b[1] - a[1])) out.push(`- ${ref}: ${n} run(s)`);
if (!refCount.size) out.push('None.');

await writeFile(outFile, `${out.join('\n')}\n`);
await writeFile(outFile.replace(/\.md$/, '.json'), JSON.stringify(rows, null, 2));
console.log(out.join('\n'));
console.error(`\nWritten: ${outFile}`);
