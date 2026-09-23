#!/usr/bin/env node
// Contract test for rollout/scripts/update-coverage.mjs under a fan-out: eight processes record a
// different page each at the same moment → all eight rows land, the roll-ups count them, every file
// parses, no lock dir or tmp file remains. Also: a stale lock is reclaimed; --help writes nothing;
// a module mapped to EDS default content (`--eds-name default-content`) is never pending in the
// block roll-up, whatever its status, and a blocks.mjs re-run keeps the mapping.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { blockCounts } from '../lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'update-coverage.mjs');
const BLOCKS_SCRIPT = join(HERE, '..', 'blocks.mjs');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const runScript = (script, args, cwd) => new Promise((res) => {
  const p = spawn(process.execPath, [script, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => res({ code, out, err }));
});
const run = (args, cwd) => runScript(SCRIPT, args, cwd);
const fixture = () => {
  const proj = mkdtempSync(join(tmpdir(), 'update-coverage-'));
  const out = join(proj, 'stardust', 'rollout'); mkdirSync(join(out, 'coverage'), { recursive: true });
  const slugs = Array.from({ length: 8 }, (_, i) => `page-${i}`);
  writeFileSync(join(out, 'coverage', 'pages.json'), JSON.stringify({ pages: slugs.map((slug) => ({ slug, template: 'detail', delivery: { status: 'pending' } })) }, null, 2));
  writeFileSync(join(out, 'coverage', 'blocks.json'), JSON.stringify({ blocks: [{ id: 'hero', delivery: { status: 'pending' } }] }, null, 2));
  writeFileSync(join(out, 'coverage', 'templates.json'), JSON.stringify({ templates: [{ id: 'detail', pages: slugs }] }, null, 2));
  writeFileSync(join(out, 'rollout.json'), JSON.stringify({ site: {} }, null, 2));
  return { proj, out, slugs };
};

await check('eight concurrent page updates all land and the roll-ups count them', async () => {
  const { proj, out, slugs } = fixture();
  const rs = await Promise.all(slugs.map((s) => run([s, '--status', 'deployed', '--url', `https://x/${s}`], proj)));
  for (const r of rs) assert.equal(r.code, 0, r.err);
  const pages = JSON.parse(readFileSync(join(out, 'coverage', 'pages.json'), 'utf8')).pages;
  assert.deepEqual(pages.map((p) => p.delivery.status), Array(8).fill('deployed'));
  const t = JSON.parse(readFileSync(join(out, 'coverage', 'templates.json'), 'utf8')).templates[0];
  assert.equal(t.delivery.deployed, 8);
  const cfg = JSON.parse(readFileSync(join(out, 'rollout.json'), 'utf8'));
  assert.equal(cfg.lastRun.pages.deployed, 8);
  assert.deepEqual(readdirSync(out).sort(), ['coverage', 'rollout.json'], 'no lock dir or tmp file left');
  assert.deepEqual(readdirSync(join(out, 'coverage')).sort(), ['blocks.json', 'pages.json', 'templates.json']);
});

await check('page and block updates interleaved keep both files whole', async () => {
  const { proj, out } = fixture();
  const rs = await Promise.all([
    run(['page-0', '--status', 'deployed'], proj), run(['--block', 'hero', '--status', 'converted', '--eds-name', 'hero'], proj),
    run(['page-1', '--status', 'failed', '--error', 'x'], proj), run(['page-2', '--status', 'verified'], proj),
  ]);
  for (const r of rs) assert.equal(r.code, 0, r.err);
  const pages = JSON.parse(readFileSync(join(out, 'coverage', 'pages.json'), 'utf8')).pages;
  assert.equal(pages.find((p) => p.slug === 'page-1').delivery.error, 'x');
  assert.equal(JSON.parse(readFileSync(join(out, 'coverage', 'blocks.json'), 'utf8')).blocks[0].delivery.status, 'converted');
  assert.equal(JSON.parse(readFileSync(join(out, 'rollout.json'), 'utf8')).lastRun.blocks.converted, 1);
});

await check('a stale lock from a crashed writer is reclaimed', async () => {
  const { proj, out } = fixture();
  const lock = join(out, '.coverage.lock'); mkdirSync(lock); writeFileSync(join(lock, 'owner'), '1 crashed\n');
  const old = (Date.now() - 120000) / 1000; utimesSync(lock, old, old);
  const r = await run(['page-3', '--status', 'deployed'], proj);
  assert.equal(r.code, 0, r.err);
  assert.ok(!existsSync(lock));
});

await check('--help prints the header and writes nothing', async () => {
  const proj = mkdtempSync(join(tmpdir(), 'update-coverage-help-'));
  const r = await run(['--help'], proj);
  assert.equal(r.code, 0); assert.match(r.out, /update-coverage\.mjs <slug>/); assert.deepEqual(readdirSync(proj), []);
});

// --- default-content mappings: a module that needs no block is never pending in the roll-up ------
const BLOCKS_FILE = join('coverage', 'blocks.json');
const row = (id, status, edsBlockName = id) => ({ id, kind: 'module', delivery: { status, edsBlockName, blockPath: null, convertedAt: null } });
const writeBlocks = (out, blocks) => writeFileSync(join(out, BLOCKS_FILE), JSON.stringify({ blocks }, null, 2));
const readBlocks = (out) => JSON.parse(readFileSync(join(out, BLOCKS_FILE), 'utf8')).blocks;
const blockRollup = (out) => JSON.parse(readFileSync(join(out, 'rollout.json'), 'utf8')).lastRun.blocks;

await check('blockCounts: a default-content mapping is converted whatever its status; other rows follow the status rule', () => {
  assert.deepEqual(blockCounts([]), { total: 0, converted: 0, pending: 0 });
  assert.deepEqual(blockCounts([row('title', 'pending', 'default-content'), row('text', 'failed', 'default-content')]), { total: 2, converted: 2, pending: 0 });
  assert.deepEqual(blockCounts([row('hero', 'pending'), row('cards', 'failed'), row('faq', 'converted'), row('stats', 'verified')]), { total: 4, converted: 2, pending: 2 });
  assert.deepEqual(blockCounts([{ id: 'bare' }]), { total: 1, converted: 0, pending: 1 });
});

await check('(a) a default-content row recorded pending → lastRun.blocks.pending is 0 and converted counts it', async () => {
  const { proj, out } = fixture();
  writeBlocks(out, [row('title', 'pending', 'default-content'), row('text', 'pending', 'default-content')]);
  const r = await run(['page-0', '--status', 'deployed'], proj); // any write re-rolls rollout.json
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(blockRollup(out), { total: 2, converted: 2, pending: 0 });
  assert.deepEqual(readBlocks(out).map((b) => b.delivery.status), ['pending', 'pending'], 'a roll-up rule, not a status rewrite');
});

await check('(b) --block <id> --status converted --eds-name default-content sets convertedAt, leaves blockPath null, pending is 0', async () => {
  const { proj, out } = fixture();
  writeBlocks(out, [row('image-caption', 'pending')]);
  const r = await run(['--block', 'image-caption', '--status', 'converted', '--eds-name', 'default-content'], proj);
  assert.equal(r.code, 0, r.err);
  const [b] = readBlocks(out);
  assert.equal(b.delivery.status, 'converted');
  assert.equal(b.delivery.edsBlockName, 'default-content');
  assert.equal(b.delivery.blockPath, null);
  assert.match(b.delivery.convertedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(blockRollup(out), { total: 1, converted: 1, pending: 0 });
});

await check('(c) a real pending block still counts as pending beside a default-content mapping recorded pending', async () => {
  const { proj, out } = fixture();
  writeBlocks(out, [row('hero', 'pending'), row('title', 'pending')]);
  let r = await run(['--block', 'title', '--status', 'pending', '--eds-name', 'default-content'], proj); // what the recorded run did
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(blockRollup(out), { total: 2, converted: 1, pending: 1 });
  r = await run(['--block', 'hero', '--status', 'converted', '--eds-name', 'hero'], proj);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(blockRollup(out), { total: 2, converted: 2, pending: 0 });
});

await check('a blocks.mjs re-run keeps a default-content mapping recorded pending and rolls it up as converted', async () => {
  const { proj, out } = fixture();
  writeFileSync(join(out, 'coverage', 'pages.json'), JSON.stringify({ pages: [{ slug: 'home', templateId: 'detail', blocks: ['hero', 'title'], delivery: { status: 'pending' } }] }, null, 2));
  writeBlocks(out, [row('hero', 'pending'), row('title', 'pending', 'default-content')]);
  const r = await runScript(BLOCKS_SCRIPT, ['--out', out], proj);
  assert.equal(r.code, 0, r.err);
  const byId = Object.fromEntries(readBlocks(out).map((b) => [b.id, b.delivery]));
  assert.equal(byId.title.edsBlockName, 'default-content');
  assert.equal(byId.hero.edsBlockName, 'hero');
  assert.deepEqual(blockRollup(out), { total: 2, converted: 1, pending: 1 });
});

console.log(failed ? `update-coverage: ${failed} check(s) failed` : 'update-coverage: all checks passed');
process.exit(failed ? 1 : 0);
