#!/usr/bin/env node
/**
 * Fixture test: skills/deploy/scripts/pipeline-mimic.mjs --compare / --probe (T21.2 — the stored pipeline-facts contract).
 * Run: node skills/deploy/scripts/test/pipeline-probe.test.mjs   (exit 1 on failure)
 *
 *   - --compare on the shipped fixture pair → exit 0, every rule `match`, multiValueStyle comma, spaceStyle
 *     hyphen-joined, zwspSurvives true, ISO probedAt, merged into a contract whose other keys survive;
 *   - a mutated plain keeping only the first `style` token → exit 3, sectionMeta `differ`, multiValueStyle first-only;
 *     tokens kept apart (`rt band-navy` → two classes) → spaceStyle split; a plain with the ZWSP paragraph dropped
 *     → zwspSurvives false; a plain without the hoist → hoist differ;
 *   - --probe without a token → exit 2, contract byte-identical, WARN "no verdict";
 *   - --probe against the deploy-batch mock: PUT /.stardust-probe/… → POST /preview/ → GET .plain.html → DELETE ×2,
 *     never POST /live/; exit 0 and the contract's origin/ref; --record rewrites the fixture copy under --fixture-dir;
 *     preview 500 → exit 2 with the source deleted; plain 404 after the retries → exit 2;
 *   - an unexplained residual (h1 text changed + an extra <p>: every rule `match`) → exit 3, `residual > 0` stored,
 *     one WARN naming it — never a clean contract; the fixture pair records `residual 0`;
 *   - contractStyleSplit() reads the measured value (null when absent / unmeasured); resolveStyleSplit(): flag >
 *     `<root>/stardust/runtime-contract.json#pipeline` > comma, and build-harness prints
 *     `style-split first-only (runtime-contract.json#pipeline)` from such a contract; usage: --help 0, --probe without --org 1.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-da.mjs';
import { contractStyleSplit, probeVerdicts, resolveStyleSplit, styleSplitLine } from '../pipeline-mimic.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'pipeline-mimic.mjs');
const FIX = join(here, '..', 'fixtures');
const dir = mkdtempSync(join(tmpdir(), 'pipeline-probe-'));
const home = join(dir, 'home'); mkdirSync(home);
const fixture = readFileSync(join(FIX, 'pipeline-probe.html'), 'utf8');
const plain = readFileSync(join(FIX, 'pipeline-probe.plain.html'), 'utf8');
const contract = join(dir, 'stardust', 'runtime-contract.json');
mkdirSync(dirname(contract)); writeFileSync(contract, JSON.stringify({ runtime: 'vanilla-eds', blockWrapperClass: 'block' }, null, 2));
const rc = () => JSON.parse(readFileSync(contract, 'utf8'));
const run = (args, env = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [CLI, ...args], { cwd: dir, env: { PATH: process.env.PATH, HOME: home, PIPELINE_PROBE_DELAY_MS: '20', ...env } });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => { c.kill(); stderr += '\n[test] TIMEOUT'; }, 20000);
  c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr, all: stdout + stderr }); });
});
const RULES = ['sectionMeta', 'meta', 'strip', 'hoist', 'picture', 'emphPicture', 'headingBr', 'icon', 'table', 'whitespace'];

try {
  // pure verdicts
  let v = probeVerdicts(fixture, plain);
  assert.deepEqual(v.deviations, []); assert.equal(v.multiValueStyle, 'comma'); assert.equal(v.spaceStyle, 'hyphen-joined'); assert.equal(v.zwspSurvives, true);
  for (const r of RULES) assert.equal(v.rules[r], 'match', r);
  v = probeVerdicts(fixture, plain.replace('class="dark narrow"', 'class="dark"'));
  assert.equal(v.multiValueStyle, 'first-only'); assert.equal(v.rules.sectionMeta, 'differ'); assert.deepEqual(v.deviations, ['sectionMeta']);
  v = probeVerdicts(fixture, plain.replace('class="rt-band-navy"', 'class="rt band-navy"'));
  assert.equal(v.spaceStyle, 'split'); assert.equal(v.rules.sectionMeta, 'differ');
  v = probeVerdicts(fixture, plain.replace('  <p>&#8203;</p>\n', ''));
  assert.equal(v.zwspSurvives, false);
  v = probeVerdicts(fixture, plain.replace('<p><strong><a href="/start">Start now</a></strong></p>', '<p><a href="/start"><strong>Start now</strong></a></p>').replace('<div><em><a href="/b">Go</a></em></div>', '<div><a href="/b"><em>Go</em></a></div>'));
  assert.equal(v.rules.hoist, 'differ', 'un-hoisted links: disabling the hoist rule sits closer'); assert.equal(v.rules.picture, 'match');

  // an unexplained deviation: no rule accounts for it — the residual must surface, never a clean contract
  const unexplainedHtml = plain.replace(/<h1([^>]*)>([^<]*)<\/h1>/, '<h1$1>Another headline<\/h1>').replace('</main>', '<div><p>An extra paragraph the pipeline never produced.</p></div></main>');
  assert.notEqual(unexplainedHtml, plain);
  v = probeVerdicts(fixture, unexplainedHtml);
  assert.deepEqual(v.deviations, [], 'no catalogued rule explains it'); assert.ok(v.distance > 0, `residual distance ${v.distance}`);
  assert.equal(probeVerdicts(fixture, plain).distance, 0);

  // --compare, contract merge
  let r = await run(['--compare', join(FIX, 'pipeline-probe.plain.html'), '--contract', contract]);
  assert.equal(r.status, 0, r.all);
  assert.match(r.stdout, /pipeline probe: sectionMeta match, .* whitespace match · multiValueStyle comma · spaceStyle hyphen-joined · zwspSurvives true · residual 0 → /);
  let c = rc(); assert.equal(c.runtime, 'vanilla-eds', 'other keys kept'); assert.equal(c.pipeline.multiValueStyle, 'comma'); assert.equal(c.pipeline.residual, 0); assert.match(c.pipeline.probedAt, /^\d{4}-\d{2}-\d{2}T/); assert.match(c.pipeline.origin, /^offline:/); assert.equal(c.pipeline.ref, null);
  const unexplained = join(dir, 'unexplained.plain.html'); writeFileSync(unexplained, unexplainedHtml);
  r = await run(['--compare', unexplained, '--contract', contract]);
  assert.equal(r.status, 3, `unexplained residual is exit 3, never 0: ${r.all}`);
  assert.match(r.stderr, /WARN pipeline probe: residual \d+ normalised line\(s\) differ that no catalogued rule explains/);
  assert.match(r.stdout, /residual [1-9]\d* → /); assert.doesNotMatch(r.stdout, /differ:/);
  c = rc(); assert.ok(c.pipeline.residual > 0, 'residual stored'); for (const k of RULES) assert.equal(c.pipeline[k], 'match');
  r = await run(['--compare', unexplained, '--contract', contract, '--json']); assert.equal(r.status, 3); assert.ok(JSON.parse(r.stdout).residual > 0);
  assert.equal(contractStyleSplit(contract), 'comma');
  const mutated = join(dir, 'first-only.plain.html'); writeFileSync(mutated, plain.replace('class="dark narrow"', 'class="dark"'));
  r = await run(['--compare', mutated, '--contract', contract, '--json']);
  assert.equal(r.status, 3, 'recorded with deviations'); const j = JSON.parse(r.stdout); assert.equal(j.sectionMeta, 'differ'); assert.equal(j.multiValueStyle, 'first-only'); assert.equal(rc().pipeline.multiValueStyle, 'first-only');
  assert.equal(contractStyleSplit(contract), 'first-only');
  assert.equal(contractStyleSplit(join(dir, 'nope.json')), null);
  // the harness default chain: flag > contract > comma — and build-harness prints the source
  assert.deepEqual(resolveStyleSplit('comma', dir), { value: 'comma', source: '--style-split' });
  assert.deepEqual(resolveStyleSplit(null, dir), { value: 'first-only', source: 'runtime-contract.json#pipeline' });
  assert.deepEqual(resolveStyleSplit(undefined, join(dir, 'nowhere')), { value: 'comma', source: 'default — #pipeline unmeasured' });
  assert.equal(styleSplitLine(resolveStyleSplit(null, dir)), 'style-split first-only (runtime-contract.json#pipeline)');
  const BUILD = join(here, '..', 'build-harness.mjs');
  const runBuild = (args) => new Promise((resolve) => { const c = spawn(process.execPath, [BUILD, join(FIX, 'pipeline-probe.html'), join(dir, 'harness.html'), ...args], { cwd: dir }); let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; }); c.on('close', (status) => resolve({ status, out })); });
  let b = await runBuild(['--root', dir]); assert.equal(b.status, 0, b.out); assert.match(b.out, /style-split first-only \(runtime-contract\.json#pipeline\)/, 'the measured value is the default');
  b = await runBuild(['--root', dir, '--style-split', 'comma']); assert.equal(b.status, 0); assert.match(b.out, /style-split comma \(--style-split\)/, 'the flag wins');
  b = await runBuild(['--root', join(dir, 'nowhere-root')]); assert.equal(b.status, 0); assert.match(b.out, /style-split comma \(default — #pipeline unmeasured\)/);
  b = await runBuild(['--root', dir, '--style-split', 'bogus']); assert.equal(b.status, 1, 'an invalid flag value is still usage');
  r = await run(['--compare', mutated, '--contract', join(dir, 'fresh', 'rc.json')]); assert.equal(r.status, 3); assert.equal(JSON.parse(readFileSync(join(dir, 'fresh', 'rc.json'), 'utf8')).pipeline.multiValueStyle, 'first-only', 'contract created when absent');

  // --probe: no token → no verdict, contract untouched
  const before = readFileSync(contract, 'utf8');
  r = await run(['--probe', '--org', 'o', '--repo', 'r', '--branch', 'main', '--contract', contract]);
  assert.equal(r.status, 2, r.all); assert.match(r.stderr, /WARN pipeline probe: no verdict — DA_TOKEN missing/); assert.equal(readFileSync(contract, 'utf8'), before);

  // --probe against the mock
  const mock = await startMock();
  const fixDir = join(dir, 'fixtures'); cpSync(FIX, fixDir, { recursive: true });
  try {
    mock.rules.delivered = () => ({ status: 200, body: plain });
    r = await run(['--probe', '--org', 'o', '--repo', 'r', '--branch', 'main', '--contract', contract, '--record', '--fixture-dir', fixDir], { DA_TOKEN: 'x', ...mock.env() });
    assert.equal(r.status, 0, r.all);
    const seq = mock.requests.map((q) => `${q.method} ${q.url.replace(/pipeline-\d+/, 'pipeline-<ts>')}`);
    assert.deepEqual(seq, ['PUT /da/o/r/.stardust-probe/pipeline-<ts>.html', 'POST /admin/preview/o/r/main/.stardust-probe/pipeline-<ts>', 'GET /delivery/aem.page/.stardust-probe/pipeline-<ts>.plain.html', 'DELETE /admin/preview/o/r/main/.stardust-probe/pipeline-<ts>', 'DELETE /da/o/r/.stardust-probe/pipeline-<ts>.html'], `request order: ${seq}`);
    assert.ok(mock.requests.every((q) => q.auth === 'Bearer x'));
    assert.ok(!seq.some((s) => s.includes('/live/')), 'never publishes');
    c = rc(); assert.equal(c.pipeline.ref, 'main'); assert.match(c.pipeline.origin, /\/aem\.page$/); assert.equal(c.pipeline.multiValueStyle, 'comma');
    assert.equal(readFileSync(join(fixDir, 'pipeline-probe.plain.html'), 'utf8'), plain, '--record rewrote the fixture copy from the fetched page'); assert.match(r.stderr, /recorded .*pipeline-probe\.plain\.html/);
    mock.reset(); mock.rules.previewStatus = () => 500;
    r = await run(['--probe', '--org', 'o', '--repo', 'r', '--branch', 'main', '--contract', contract], { DA_TOKEN: 'x', ...mock.env() });
    assert.equal(r.status, 2); assert.match(r.stderr, /no verdict — preview 500/); assert.ok(mock.requests.some((q) => q.method === 'DELETE' && q.url.startsWith('/da/')), 'source cleaned up on a failed preview');
    mock.reset(); mock.rules.previewStatus = () => 200; mock.rules.delivered = () => ({ status: 404, body: '' });
    r = await run(['--probe', '--org', 'o', '--repo', 'r', '--branch', 'main', '--contract', contract], { DA_TOKEN: 'x', ...mock.env() });
    assert.equal(r.status, 2); assert.match(r.stderr, /\.plain\.html 404 after 3 reads/); assert.equal(mock.requests.filter((q) => q.method === 'GET').length, 3);
  } finally { await mock.close(); }

  // usage
  assert.equal((await run(['--help'])).status, 0);
  assert.equal((await run(['--probe', '--repo', 'r', '--branch', 'main'])).status, 1);
  assert.equal((await run(['--compare'])).status, 1, '--compare needs a value');
  assert.equal((await run(['--compare', join(dir, 'missing.html')])).status, 1);
  assert.equal((await run(['--self-test'])).status, 0, 'the extended fixture pair still self-tests');
  console.log('pipeline-probe test: ok');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
