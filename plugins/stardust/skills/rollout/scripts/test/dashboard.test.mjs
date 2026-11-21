#!/usr/bin/env node
// Contract test for rollout/scripts/dashboard.mjs: a verified page whose only open findings are source parity
// (isSourceParity — informational in optimize) reads "optimised"; any other open finding, an `out-of-scope` one filed
// without the parity evidence included, holds a verified page at "deployed"; a failed page is not deployed; --help
// writes nothing. Plus the pure helper behind it.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { blocksOptimised } from '../lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'dashboard.mjs');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const run = (args, cwd) => new Promise((res) => {
  const p = spawn(process.execPath, [SCRIPT, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => res({ code, out, err }));
});
const finding = (id, page, fixability, status = 'open', evidence = fixability === 'out-of-scope' ? 'source parity: no JSON-LD structured data — the source page has no JSON-LD either' : '') => ({ id, source: 'baseline', layer: 'seo', check: 'jsonld', severity: 'P2', fixability, scope: { level: 'page', ids: [page] }, evidence, status });

await check('blocksOptimised: open / in-progress findings count unless source parity (optimize\'s rule); closed ones never', async () => {
  assert.equal(blocksOptimised(finding('a', 'p', 'platform-migration')), true);
  assert.equal(blocksOptimised(finding('b', 'p', 'design-pass', 'in-progress')), true);
  assert.equal(blocksOptimised(finding('c', 'p', 'out-of-scope')), false, 'source parity is informational');
  assert.equal(blocksOptimised(finding('e', 'p', 'out-of-scope', 'open', 'filed by hand')), true, 'out-of-scope without the source-parity evidence still counts, as in optimize');
  assert.equal(blocksOptimised(finding('d', 'p', 'platform-migration', 'fixed')), false);
  assert.equal(blocksOptimised(null), false);
});

await check('a verified page with only source-parity findings is optimised; an in-scope open finding keeps one deployed; a failed page is not deployed', async () => {
  const proj = mkdtempSync(join(tmpdir(), 'dashboard-'));
  const out = join(proj, 'stardust', 'rollout');
  mkdirSync(join(out, 'coverage'), { recursive: true }); mkdirSync(join(out, 'optimize'), { recursive: true });
  const row = (slug, status) => ({ slug, path: `/${slug}`, title: slug, templateId: 'detail', delivery: { status } });
  writeFileSync(join(out, 'coverage', 'pages.json'), JSON.stringify({ pages: [row('parity-only', 'verified'), row('open-p2', 'verified'), row('hand-filed', 'verified'), row('gate-failed', 'failed')] }));
  writeFileSync(join(out, 'rollout.json'), JSON.stringify({ site: {} }));
  writeFileSync(join(out, 'optimize', 'findings.json'), JSON.stringify({ runs: [{ at: '2026-01-01T00:00:00Z' }], findings: [
    finding('f1', 'parity-only', 'out-of-scope'), finding('f2', 'open-p2', 'platform-migration'), finding('f3', 'open-p2', 'out-of-scope'),
    finding('f4', 'hand-filed', 'out-of-scope', 'open', 'filed by hand'),
  ] }));
  const r = await run(['--out', out], proj);
  assert.equal(r.code, 0, r.err);
  const data = JSON.parse(readFileSync(join(out, 'dashboard', 'data.json'), 'utf8'));
  const stage = Object.fromEntries((Array.isArray(data.pages) ? data.pages : Object.values(data.pages)).map((p) => [p.slug, p.stage]));
  assert.equal(stage['parity-only'], 'optimised');
  assert.equal(stage['open-p2'], 'deployed');
  assert.equal(stage['hand-filed'], 'deployed', 'an out-of-scope finding without source-parity evidence still holds the page');
  assert.notEqual(stage['gate-failed'], 'deployed'); assert.notEqual(stage['gate-failed'], 'optimised');
  const openOf = Object.fromEntries((Array.isArray(data.pages) ? data.pages : Object.values(data.pages)).map((p) => [p.slug, p.openFindings]));
  assert.equal(openOf['parity-only'], 0); assert.equal(openOf['open-p2'], 1);
});

await check('--help prints the usage header and writes nothing', async () => {
  const proj = mkdtempSync(join(tmpdir(), 'dashboard-help-'));
  const r = await run(['--help'], proj);
  assert.equal(r.code, 0); assert.match(r.out, /dashboard/i);
  assert.equal(existsSync(join(proj, 'stardust')), false);
});

console.log(failed ? `dashboard: ${failed} check(s) failed` : 'dashboard: all checks passed');
process.exit(failed ? 1 : 0);
