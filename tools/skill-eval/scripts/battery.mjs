#!/usr/bin/env node
// Helper on top of the harness: standard final battery for a branch.
// Builds main/final contexts with `skill-eval ctx`, runs trigger sets then solves (main vs final,
// plus baseline), and writes an index with the pooled/comparison rows for the PR body.
//
// node battery.mjs --plugin plugins/aem/edge-delivery-services --main origin/main --final my-branch \
//   --triggers aem-cli,da-content --scenarios 'da-content-page-html-traps,aem-cli-*' [--label x]
//   [--models a,b,c] [--runs-trigger 3] [--runs-solve 2] [--concurrency 3] [--baseline-from <run>] [--dry-run]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: v } = parseArgs({
  options: {
    plugin: { type: 'string' }, main: { type: 'string', default: 'origin/main' }, final: { type: 'string' },
    triggers: { type: 'string', default: '' }, scenarios: { type: 'string', default: '' },
    label: { type: 'string', default: 'battery' }, models: { type: 'string', default: 'github-copilot/claude-sonnet-5.5,github-copilot/gpt-6.1-sol,github-copilot/kimi-k3' },
    'runs-trigger': { type: 'string', default: '3' }, 'runs-solve': { type: 'string', default: '2' }, concurrency: { type: 'string', default: '3' },
    'baseline-from': { type: 'string', multiple: true, default: [] }, cli: { type: 'string', default: 'tools/skill-eval/cli.mjs' },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (!v.plugin || !v.final) throw new Error('--plugin and --final are required');
const cli = resolve(v.cli);
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const sh = (args, opts = {}) => {
  console.error(`$ node ${args.join(' ')}`);
  if (v['dry-run']) return { status: 0, stdout: '' };
  return spawnSync('node', args, { stdio: opts.capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' });
};

const out = (n) => `/tmp/skills-${v.label}-${n}`;
for (const [n, takes] of [['main', []], ['final', [`${v.final}:${v.plugin}`]]]) {
  if (existsSync(out(n))) {
    const manifest = `.skill-eval/ctx/${v.label}-${n}.json`;
    const rev = (ref) => spawnSync('git', ['rev-parse', ref], { encoding: 'utf8' }).stdout.trim();
    const m = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : null;
    const stale = !m || m.base?.sha !== rev(v.main) || takes.some((t, i) => {
      const [ref, path] = [t.slice(0, t.indexOf(':')), t.slice(t.indexOf(':') + 1)];
      return m.takes?.[i]?.sha !== rev(ref) || m.takes?.[i]?.path !== path;
    }) || (m.takes?.length ?? 0) !== takes.length;
    if (stale) throw new Error(`${out(n)} was built from other refs (manifest ${manifest}); remove it with \`ctx rm\` or use another --label`);
    console.error(`reusing ${out(n)}`);
    continue;
  }
  const args = [cli, 'ctx', '--base', v.main, '--out', out(n), '--name', `${v.label}-${n}`];
  for (const t of takes) args.push('--take', t);
  sh(args);
}
const plugin = (n) => join(out(n), v.plugin);
const ctxArgs = ['--context', `main=${plugin('main')}`, '--context', `final=${plugin('final')}`];
const index = [`# ${v.label}: ${v.main} vs ${v.final}`, '', `Contexts: main ${out('main')}, final ${out('final')}`, ''];
const runDirs = (root) => (existsSync(root) ? readdirSync(root) : []);

for (const set of list(v.triggers)) {
  const before = new Set(runDirs('.skill-eval/triggers'));
  const r = sh([cli, 'trigger', plugin('final'), ...ctxArgs, '--queries', join(plugin('final'), 'trigger-queries', `${set}.json`), '-n', v['runs-trigger'], '--concurrency', v.concurrency, '--label', `${v.label}-trigger-${set}`, '--model', v.models]);
  const dir = runDirs('.skill-eval/triggers').filter((d) => !before.has(d)).sort().pop();
  index.push(`## trigger: ${set} (exit ${r.status})`, dir ? `Run: .skill-eval/triggers/${dir}` : '', '');
  if (dir && !v['dry-run']) index.push(readFileSync(`.skill-eval/triggers/${dir}/trigger.md`, 'utf8').split('\n').filter((l) => /^(#|Variant|\| Skill|\| da-|\| aem-|\|---|\| [a-z-]+ \|)/.test(l) && !/^\| [yn]-/.test(l)).join('\n'), '');
}
if (list(v.scenarios).length) {
  const before = new Set(runDirs('.skill-eval/runs'));
  const args = [cli, plugin('final'), ...ctxArgs, '-n', v['runs-solve'], '--concurrency', v.concurrency, '--label', `${v.label}-solve`, '--model', v.models];
  for (const s of list(v.scenarios)) args.push('--scenario', s);
  for (const b of v['baseline-from']) args.push('--baseline-from', b);
  const r = sh(args);
  const dir = runDirs('.skill-eval/runs').filter((d) => !before.has(d)).sort().pop();
  index.push(`## solves: ${v.scenarios} (exit ${r.status})`, dir ? `Run: .skill-eval/runs/${dir}` : '', '');
  if (dir && !v['dry-run']) index.push(readFileSync(`.skill-eval/runs/${dir}/report.md`, 'utf8').split('\n').filter((l) => /^(### |\| pooled \||\| (main|final) vs baseline|\| final vs main)/.test(l)).join('\n'), '');
}
mkdirSync('.skill-eval', { recursive: true });
const file = `.skill-eval/${v.label}-battery.md`;
if (!v['dry-run']) writeFileSync(file, index.join('\n'));
console.error(`index: ${file}`);
