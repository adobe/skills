#!/usr/bin/env node
// Usage: summarize.mjs <promptfoo-output.json> <skill> <ref>
// Reduces a promptfoo output file to one row per run and writes it to results/<skill>/.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARM_STORED, ARM_SUFFIX } from '../lib/arm.mjs';

const [file, skill, ref] = process.argv.slice(2);
if (!file || !skill || !ref) {
  console.error('usage: summarize.mjs <promptfoo-output.json> <skill> <ref>');
  process.exit(1);
}

const CLI_USE = /(^|[\s;&|(`$])(web|\$WEB|\$W)\s+(browser|page|probe|ext|mask)\b/;
const usedCli = (r) => (r.response?.metadata?.toolCalls ?? []).some((c) => CLI_USE.test(String(c.input?.command ?? '')));
const isScored = (c) => (c.assertion?.weight ?? 1) !== 0;
// Provider errors (quota, auth, outages) are not observations about the skill: they are dropped
// from the summary and reported on stderr so the run can be repeated.
const all = JSON.parse(readFileSync(file, 'utf-8')).results.results;
const errored = all.filter((r) => r.error && !r.gradingResult);
if (errored.length) {
  console.error(`summarize: ${errored.length} run(s) hit a provider error and were dropped: ` +
    `${[...new Set(errored.map((r) => String(r.error).slice(0, 80)))].join(' | ')}`);
}
const runs = all.filter((r) => !errored.includes(r)).map((r) => ({
  model: r.provider.label,
  case: r.testCase.vars.slug ?? r.testCase.description,
  pass: r.success,
  latency_s: Math.round((r.latencyMs ?? 0) / 100) / 10,
  cost_usd: Math.round((r.response?.cost ?? 0) * 1e4) / 1e4,
  used_cli: usedCli(r),
  timed_out: r.response?.metadata?.timedOut ?? false,
  why: r.error ?? (r.gradingResult?.componentResults ?? []).filter((c) => !c.pass && isScored(c)).map((c) => c.reason),
}));

const arm = ARM_STORED;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const date = new Date().toISOString().slice(0, 10);
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf-8' }).trim();
// `HEAD` is not a name: use the branch, or the short sha when detached.
const refName = ref === 'HEAD' ? git('rev-parse', '--abbrev-ref', 'HEAD').replace(/^HEAD$/, git('rev-parse', '--short', 'HEAD')) : ref;
const commit = git('rev-parse', '--short', ref);
const dir = join(root, 'results', skill);
mkdirSync(dir, { recursive: true });
if (runs.length === 0) {
  console.error('summarize: no scored runs, nothing written');
  process.exit(0);
}
const name = `${date}-${refName.replace(/[^\w.-]+/g, '_')}${ARM_SUFFIX}-${[...new Set(runs.map((r) => r.model))].join('+')}.json`;
writeFileSync(join(dir, name), `${JSON.stringify({ skill, ref: refName, commit, arm, date, runs }, null, 2)}\n`);
console.log(`${runs.length} runs -> results/${skill}/${name}`);
