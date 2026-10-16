#!/usr/bin/env node
// skills/rollout/scripts/test/verify.test.mjs — verify.mjs's <h1> rule against the source capture, offline (--root) in a
// temp project: one <h1> verifies; none verifies only when <current>/pages/<slug>.json records headings without an h1
// (a `note:` line and `· <n> note(s)` in the summary, never a failure); a capture with an h1, no capture, or more than
// one <h1> fails as before; --current is honoured. --help writes nothing.
// Run: node plugins/stardust/skills/rollout/scripts/test/verify.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'verify.mjs');
let failed = 0;
const tests = [];
const check = (name, fn) => tests.push([name, fn]);

// --- fixture: coverage rows, the delivered tree under site/, source captures under stardust/current/pages/ ----------
const PAGES = {
  one: '<main><h1>One</h1><h2>Intro</h2></main>',
  plain: '<main><h2>Intro</h2></main>',
  titled: '<main><h2>Intro</h2></main>',
  bare: '<main><h2>Intro</h2></main>',
  double: '<main><h1>A</h1><h1>B</h1></main>',
};
const CAPTURES = { plain: ['h2', 'h3'], titled: ['h1', 'h2'], double: ['h2'] };
const capture = (dir, slug, tags) => { mkdirSync(join(dir, 'pages'), { recursive: true }); writeFileSync(join(dir, 'pages', `${slug}.json`), JSON.stringify({ slug, headings: tags.map((tag) => ({ tag, text: 'x' })) })); };
function project() {
  const proj = mkdtempSync(join(tmpdir(), 'verify-'));
  mkdirSync(join(proj, 'stardust', 'rollout', 'coverage'), { recursive: true });
  mkdirSync(join(proj, 'site'));
  const pages = Object.keys(PAGES).map((slug) => ({ slug, path: `/${slug}`, delivery: { status: 'deployed' } }));
  writeFileSync(join(proj, 'stardust', 'rollout', 'coverage', 'pages.json'), JSON.stringify({ pages }));
  for (const [slug, html] of Object.entries(PAGES)) writeFileSync(join(proj, 'site', `${slug}.html`), html);
  for (const [slug, tags] of Object.entries(CAPTURES)) capture(join(proj, 'stardust', 'current'), slug, tags);
  return proj;
}
const run = (proj, args) => spawnSync(process.execPath, [SCRIPT, '--root', 'site', ...args], { cwd: proj, encoding: 'utf8' });
const statusOf = (proj) => Object.fromEntries(JSON.parse(readFileSync(join(proj, 'stardust', 'rollout', 'coverage', 'pages.json'), 'utf8')).pages.map((p) => [p.slug, p.delivery.status]));
const lines = (r) => r.stdout.trim().split('\n');

check('one <h1> → verified, no note', () => {
  const proj = project();
  const r = run(proj, ['--slug', 'one']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(statusOf(proj).one, 'verified');
  assert.equal(lines(r)[2], 'Checked 1 · 1 verified · 0 failed · types: page:1');
  assert.doesNotMatch(r.stdout, /note/);
  rmSync(proj, { recursive: true, force: true });
});

check('no <h1> and a capture without one → verified, with the note line and the summary count', () => {
  const proj = project();
  const r = run(proj, ['--slug', 'plain']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(statusOf(proj).plain, 'verified');
  assert.deepEqual(lines(r).slice(2), ['Checked 1 · 1 verified · 0 failed · 1 note(s) · types: page:1', 'note: plain: source has no h1 (recorded source trait)']);
  rmSync(proj, { recursive: true, force: true });
});

check('no <h1> and a capture with one, or no capture → failed as before', () => {
  const proj = project();
  for (const slug of ['titled', 'bare']) {
    const r = run(proj, ['--slug', slug]);
    assert.equal(r.status, 1, `${slug}: ${r.stdout}`);
    assert.equal(statusOf(proj)[slug], 'failed');
    assert.match(r.stdout, new RegExp(`✗ ${slug} \\(page\\): page should render exactly one <h1>, found 0`));
    assert.doesNotMatch(r.stdout, /note/);
  }
  rmSync(proj, { recursive: true, force: true });
});

check('more than one <h1> fails even when the source has none', () => {
  const proj = project();
  const r = run(proj, ['--slug', 'double']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✗ double \(page\): page should render exactly one <h1>, found 2/);
  rmSync(proj, { recursive: true, force: true });
});

check('--all reports every page; --current points at another capture directory', () => {
  const proj = project();
  const all = run(proj, ['--all']);
  assert.equal(all.status, 1);
  assert.deepEqual(statusOf(proj), { one: 'verified', plain: 'verified', titled: 'failed', bare: 'failed', double: 'failed' });
  assert.equal(lines(all)[2], 'Checked 5 · 2 verified · 3 failed · 1 note(s) · types: page:5');
  capture(join(proj, 'elsewhere'), 'bare', ['h2']);
  const moved = run(proj, ['--slug', 'bare', '--current', 'elsewhere']);
  assert.equal(moved.status, 0, moved.stdout);
  assert.match(moved.stdout, /^note: bare: source has no h1 \(recorded source trait\)$/m);
  assert.equal(run(proj, ['--slug', 'plain', '--current', 'elsewhere']).status, 1);
  rmSync(proj, { recursive: true, force: true });
});

check('--help prints the usage header and writes nothing', () => {
  const empty = mkdtempSync(join(tmpdir(), 'verify-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd: empty, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--current/);
  assert.deepEqual(readdirSync(empty), []);
  rmSync(empty, { recursive: true, force: true });
});

for (const [name, fn] of tests) {
  try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
