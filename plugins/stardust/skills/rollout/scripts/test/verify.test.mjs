#!/usr/bin/env node
// skills/rollout/scripts/test/verify.test.mjs — verify.mjs's <h1> rule against the source capture, offline (--root) in a
// temp project: one <h1> verifies; none verifies only when <current>/pages/<slug>.json records headings without an h1
// (a `note:` line and `· <n> note(s)` in the summary, never a failure); a capture with an h1, no capture, or more than
// one <h1> fails as before; a failed delivery.gate is never rescued by the note; a gate failed at any recorded width
// (delivery.gate.passByWidth) is never verified; --current is honoured. --help writes nothing.
// --base (a local server): a page is fetched where it was deployed (delivery.deployedUrl), else at its path. Media and
// text-track links are assets, never broken page links.
// Run: node plugins/stardust/skills/rollout/scripts/test/verify.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
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
// an async run, so a server in this process can answer verify's requests
const runAsync = (proj, args) => new Promise((ok) => {
  const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: proj });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => ok({ status, stdout, stderr }));
});
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

check('the note never rescues a failed gate: no <h1>, a capture without one, delivery.gate.pass false → failed', () => {
  const proj = project();
  const file = join(proj, 'stardust', 'rollout', 'coverage', 'pages.json');
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  doc.pages.find((p) => p.slug === 'plain').delivery.gate = { pass: false, reasons: ['pct 4.20 > 2'] };
  writeFileSync(file, JSON.stringify(doc));
  const r = run(proj, ['--slug', 'plain']);
  assert.equal(r.status, 1, r.stdout);
  assert.equal(statusOf(proj).plain, 'failed');
  assert.match(r.stdout, /✗ plain \(page\): gate: pct 4\.20 > 2/);
  rmSync(proj, { recursive: true, force: true });
});

check('a gate failed at any recorded width is never verified, though the width gated last passed; a width with no verdict (null) is no failure', () => {
  const proj = project();
  const file = join(proj, 'stardust', 'rollout', 'coverage', 'pages.json');
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  doc.pages.find((p) => p.slug === 'one').delivery.gate = { pass: true, reasons: [], passByWidth: { 1440: false, 360: true } };
  writeFileSync(file, JSON.stringify(doc));
  const r = run(proj, ['--slug', 'one']);
  assert.equal(r.status, 1, r.stdout);
  assert.equal(statusOf(proj).one, 'failed');
  assert.match(r.stdout, /✗ one \(page\): gate: FAIL at 1440$/m);
  doc.pages.find((p) => p.slug === 'one').delivery.gate.passByWidth = { 1440: true, 360: null };
  writeFileSync(file, JSON.stringify(doc));
  const ok = run(proj, ['--slug', 'one']);
  assert.equal(ok.status, 0, ok.stdout);
  assert.equal(statusOf(proj).one, 'verified');
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

check('media and text-track links are assets, not pages; a link to an unknown page still fails', () => {
  const proj = project();
  const file = join(proj, 'stardust', 'rollout', 'coverage', 'pages.json');
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  doc.pages.push({ slug: 'media', path: '/media', delivery: { status: 'deployed' } }, { slug: 'lost', path: '/lost', delivery: { status: 'deployed' } });
  writeFileSync(file, JSON.stringify(doc));
  const exts = ['vtt', 'srt', 'ttml', 'dfxp', 'sbv', 'mp3', 'm4a', 'aac', 'oga', 'ogg', 'wav', 'flac', 'm4v', 'ogv', 'm3u8', 'mpd'];
  writeFileSync(join(proj, 'site', 'media.html'), `<main><h1>Media</h1>${exts.map((e) => `<a href="/media/clip.${e}?v=1">${e}</a>`).join('')}<a href="/one">one</a></main>`);
  writeFileSync(join(proj, 'site', 'lost.html'), '<main><h1>Lost</h1><a href="/media/clip.vtt">vtt</a><a href="/nowhere">x</a></main>');
  const media = run(proj, ['--slug', 'media']);
  assert.equal(media.status, 0, media.stdout + media.stderr);
  assert.equal(statusOf(proj).media, 'verified');
  const lost = run(proj, ['--slug', 'lost']);
  assert.equal(lost.status, 1, lost.stdout);
  assert.match(lost.stdout, /✗ lost \(page\): broken internal links: \/nowhere$/m);
  rmSync(proj, { recursive: true, force: true });
});

check('--help prints the usage header and writes nothing', () => {
  const empty = mkdtempSync(join(tmpdir(), 'verify-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd: empty, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--current/);
  assert.match(r.stdout, /media and text-track links are assets/i);
  assert.deepEqual(readdirSync(empty), []);
  rmSync(empty, { recursive: true, force: true });
});

// --base: each page is fetched where it was deployed (delivery.deployedUrl), else at its path — an index.html source
// adds no slash. The server answers only those URLs (the slash forms 404, as on a plain EDS site) and logs each request.
check('--base fetches a page at its deployedUrl, else its path — never a slash appended for an index.html source', async () => {
  const proj = mkdtempSync(join(tmpdir(), 'verify-base-'));
  mkdirSync(join(proj, 'stardust', 'rollout', 'coverage'), { recursive: true });
  const page = (slug, delivery) => ({ slug, path: `/${slug}`, source: { migratedHtml: `stardust/migrated/${slug}/index.html` }, delivery: { status: 'deployed', ...delivery } });
  writeFileSync(join(proj, 'stardust', 'rollout', 'coverage', 'pages.json'), JSON.stringify({ pages: [
    page('x', { deployedUrl: 'https://h/x' }), page('y', {}), page('z', { deployedUrl: 'https://h/z/' }),
  ] }));
  const served = new Set(['/x', '/y', '/z/']);
  const asked = [];
  const server = createServer((req, res) => {
    asked.push(req.url);
    res.writeHead(served.has(req.url) ? 200 : 404, { 'content-type': 'text/html' });
    res.end(`<main><h1>${req.url}</h1><a href="/x">x</a></main>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const r = await runAsync(proj, ['--base', `http://127.0.0.1:${server.address().port}`]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(asked.sort(), ['/x', '/y', '/z/']);
    assert.deepEqual(statusOf(proj), { x: 'verified', y: 'verified', z: 'verified' });
  } finally {
    server.close();
    rmSync(proj, { recursive: true, force: true });
  }
});

for (const [name, fn] of tests) {
  try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
