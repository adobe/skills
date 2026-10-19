#!/usr/bin/env node
// skills/deploy/scripts/test/qa-gate.test.mjs — the pure part of qa-gate.mjs (checkUnits: each schema repeat
// group held to its own block instance, found by ORDER among the non-chrome sections, never by section name)
// and --help, then the site-auth flags: their usage errors (no browser), and the page loads against the two-origin
// fixture (the token reaches the page's origin only; Chromium, skipped without it). The rendered block
// measurements of the pure part are plain objects.
// Run: node --test <this file>   (or node <this file>).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startTwoOriginServer } from '../../../replica/scripts/test/fixtures/two-origin-server.mjs';
import { checkUnits } from '../qa-gate.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'qa-gate.mjs');

// A rendered block as the page evaluation measures it.
const inst = (name, unitCount = 0, extra = {}) => ({
  name, unitCount, headingUnits: 0, tagCounts: {}, ...extra,
});
const rep = (count, unitSelector = '') => ({ count, unitSelector });
const lines = (found, kind) => found.filter((f) => f.kind === kind).map((f) => f.text);

// A reskin page: every section is `class="m m-<module>"`, so section-schema names every one of them "m".
const SAME_NAME = {
  sections: [
    { section: 'header' },
    { section: 'm', repeats: [] },
    { section: 'm', repeats: [rep(3, 'article.card')] },
    { section: 'm', repeats: [] },
    { section: 'm', repeats: [rep(4, 'li.tab')] },
    { section: 'footer', repeats: [rep(2, 'li')] },
  ],
};

test('sections sharing one name: each repeat group is checked against the block at its own position', () => {
  // positions 1 and 3 among the non-chrome sections; the hero (0) and the plain section (2) hold no units
  const instances = [inst('hero', 0), inst('cards', 3), inst('text', 0), inst('tabs', 4)];
  const found = checkUnits(SAME_NAME, instances);
  assert.deepEqual(lines(found, 'fail'), []);
  const ok = lines(found, 'ok');
  assert.equal(ok.length, 2);
  assert.match(ok[0], /^units: "m" #2 → block cards renders ≥3 — rendered 3 /);
  assert.match(ok[1], /^units: "m" #4 → block tabs renders ≥4 — rendered 4 /);
});

test('a short block fails against its own instance, not against the hero', () => {
  const instances = [inst('hero', 9), inst('cards', 3), inst('text', 0), inst('tabs', 2)];
  const found = checkUnits(SAME_NAME, instances);
  const fail = lines(found, 'fail');
  assert.equal(fail.length, 1);
  assert.match(fail[0], /^units: "m" #4 → block tabs renders ≥4 — rendered 2 /);
  assert.equal(lines(found, 'ok').length, 1);
});

test('distinct names resolve to the same positions as shared ones', () => {
  const named = {
    sections: SAME_NAME.sections.map((s, i) => (['header', 'footer'].includes(s.section) ? s : { ...s, section: `s${i}` })),
  };
  const instances = [inst('hero', 0), inst('cards', 3), inst('text', 0), inst('tabs', 4)];
  const found = checkUnits(named, instances);
  assert.deepEqual(lines(found, 'fail'), []);
  assert.deepEqual(lines(found, 'ok').map((t) => t.match(/→ block (\w+)/)[1]), ['cards', 'tabs']);
});

test('the unit count is the densest of grid kids, unit headings and the unitSelector tag', () => {
  const schema = { sections: [{ section: 'm', repeats: [rep(5, 'article.card')] }] };
  assert.equal(lines(checkUnits(schema, [inst('cards', 1, { tagCounts: { article: 5 } })]), 'ok').length, 1);
  assert.equal(lines(checkUnits(schema, [inst('cards', 1, { headingUnits: 5 })]), 'ok').length, 1);
  assert.equal(lines(checkUnits(schema, [inst('cards', 1, { tagCounts: { li: 9 } })]), 'fail').length, 1);
});

test('a repeat group with no block at its position, or in chrome, warns instead of checking another block', () => {
  const found = checkUnits(SAME_NAME, [inst('hero', 0), inst('cards', 3)]);
  assert.deepEqual(lines(found, 'warn'), [
    'schema section "m" (repeats) has no matching page block by order — verify manually',
    'schema section "footer" (repeats) has no matching page block by order — verify manually',
  ]);
  assert.equal(lines(found, 'ok').length, 1);
});

test('groups below 2 units and a schema without sections check nothing', () => {
  assert.deepEqual(checkUnits({ sections: [{ section: 'm', repeats: [rep(1)] }] }, [inst('x')]), []);
  assert.deepEqual(checkUnits(null, []), []);
  assert.deepEqual(checkUnits({}, []), []);
});

test('--help: exit 0 and the usage header, before any browser or file work', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^skills\/deploy\/scripts\/qa-gate\.mjs — the stock Local-QA assertion gate/);
  assert.match(r.stdout, /matched by ORDER among\s+the non-chrome/);
  assert.match(r.stdout, /--token-env <NAME> \| --auth-header "<value>"/);
  assert.match(r.stdout, /ONE origin — --auth-origin <url>/);
  assert.equal(r.stderr, '');
});

// ---- site auth: the token goes to the page's origin only -------------------------------------------------------
// qa-gate runs as a child process, asynchronously: the fixture servers live in this process, so a synchronous spawn
// would deadlock. Auth usage errors answer before a browser starts; the page loads need Chromium and are skipped
// without it.
const SCRATCH = mkdtempSync(join(tmpdir(), 'qa-gate-test-'));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));
const SECRET = 't0k3n';
const NAME_SHAPED = 'hlx_AbC123secretValue';
const run = (args, { env = {}, cwd = SCRATCH } = {}) => new Promise((resolve, reject) => {
  const base = { ...process.env };
  for (const k of Object.keys(base)) if (/token/i.test(k)) delete base[k];
  const child = spawn(process.execPath, [SCRIPT, ...args], { cwd, env: { ...base, ...env } });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
  child.on('error', reject);
  child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
});
const noSecret = (r) => assert.ok(!r.out.includes(SECRET) && !r.err.includes(SECRET), `the token was printed:\n${r.out}${r.err}`);

test('auth usage errors exit 2 before any request: an unset variable is named, an empty flag value is refused, a token pasted for a name is never echoed', async () => {
  const url = 'http://127.0.0.1:9/page';
  const cases = [
    [['--token-env', 'QA_NOT_SET'], /^qa-gate: no site token: the variable --token-env names is not set \(or is empty\) in the environment or in \.env$/m],
    [['--token-env'], /^qa-gate: --token-env takes the name of an environment variable/m],
    [['--token-env', ''], /^qa-gate: --token-env takes the name of an environment variable/m],
    [['--token-env', `token ${SECRET}`], /^qa-gate: --token-env takes the name of an environment variable/m],
    [['--token-env', NAME_SHAPED], /^qa-gate: no site token: the variable --token-env names is not set/m],
    [['--auth-header'], /^qa-gate: --auth-header needs a value$/m],
    [['--auth-header', ''], /^qa-gate: --auth-header needs a value$/m],
    [['--auth-header', SECRET, '--auth-origin'], /^qa-gate: --auth-origin needs an http\(s\) URL/m],
    [['--auth-header', SECRET, '--auth-origin', 'ftp://x.test'], /^qa-gate: --auth-origin needs an http\(s\) URL/m],
  ];
  for (const [flags, expected] of cases) {
    const r = await run([url, ...flags]);
    assert.equal(r.code, 2, `${flags.join(' ')}: ${r.out}${r.err}`);
    assert.match(r.err, expected, flags.join(' '));
    assert.equal(r.out, '');
    noSecret(r);
    assert.ok(!r.err.includes(NAME_SHAPED), 'a token shaped like a name is not echoed');
  }
  const noUrl = await run(['--auth-header', `token ${SECRET}`]);
  assert.equal(noUrl.code, 2); assert.match(noUrl.err, /^usage: qa-gate\.mjs <harnessURL>/); noSecret(noUrl);
});

const hasBrowser = await import('playwright').then(async ({ chromium }) => { const b = await chromium.launch(); await b.close(); return true; }, () => false);
const browserTest = (name, fn) => test(name, { skip: !hasBrowser && 'playwright / Chromium not available' }, fn);
const fx = hasBrowser ? await startTwoOriginServer() : null;
after(() => fx && fx.stop());

// The page's content assertions fail on the fixture (no runtime booted): the run still ends in its QA GATE line.
const finished = (r) => { assert.match(r.out, /^QA GATE: (PASS|FAIL) — /m, `qa-gate did not finish:\n${r.out}${r.err}`); noSecret(r); };
const pageHits = (side) => side.log.filter((q) => q.path === '/page');

browserTest('--token-env: the protected page is loaded with the token, the stylesheet and image of origin B arrive without it', async () => {
  fx.reset();
  const r = await run([`${fx.originA}/page`, '--token-env', 'QA_SITE_TOKEN'], { env: { QA_SITE_TOKEN: SECRET } });
  finished(r);
  assert.deepEqual(pageHits(fx.a).map((q) => [q.authorization, q.status]), [[fx.authorization, 200]]);
  assert.ok(fx.a.log.every((q) => q.authorization === fx.authorization), 'every request to origin A carries the token');
  assert.deepEqual(fx.b.log.map((q) => q.path).sort(), ['/pic.png', '/style.css']);
  assert.deepEqual(fx.authorizations('B'), [], 'origin B saw an Authorization');
});

browserTest('--auth-header before the URL: the value is not mistaken for the URL; a bare value gets `token `; origin B sees none', async () => {
  fx.reset();
  const r = await run(['--auth-header', SECRET, `${fx.originA}/page`]);
  finished(r);
  assert.deepEqual(pageHits(fx.a).map((q) => [q.authorization, q.status]), [[fx.authorization, 200]]);
  assert.deepEqual(fx.authorizations('B'), []);
});

browserTest('the token comes from the NAME= line of ./.env when the variable is unset', async () => {
  fx.reset();
  const dir = mkdtempSync(join(SCRATCH, 'dotenv-'));
  writeFileSync(join(dir, '.env'), `QA_SITE_TOKEN=${SECRET}\n`);
  const r = await run([`${fx.originA}/page`, '--token-env', 'QA_SITE_TOKEN'], { cwd: dir });
  finished(r);
  assert.deepEqual(pageHits(fx.a).map((q) => [q.authorization, q.status]), [[fx.authorization, 200]]);
  assert.deepEqual(fx.authorizations('B'), []);
});

browserTest('no flag: a SITE_TOKEN in the environment and in ./.env is not sent — the protected page answers 401 and nothing carries an Authorization', async () => {
  fx.reset();
  const dir = mkdtempSync(join(SCRATCH, 'dotenv-'));
  writeFileSync(join(dir, '.env'), `SITE_TOKEN=${SECRET}\n`);
  const r = await run([`${fx.originA}/page`], { env: { SITE_TOKEN: SECRET }, cwd: dir });
  finished(r);
  assert.deepEqual(pageHits(fx.a).map((q) => [q.authorization, q.status]), [[null, 401]]);
  assert.deepEqual([...fx.authorizations('A'), ...fx.authorizations('B')], []);
});

browserTest('--auth-origin names the one origin: with origin B named, the page on origin A is sent nothing', async () => {
  fx.reset();
  const r = await run([`${fx.originA}/page`, '--auth-header', SECRET, '--auth-origin', fx.originB]);
  finished(r);
  assert.deepEqual(pageHits(fx.a).map((q) => [q.authorization, q.status]), [[null, 401]]);
  assert.deepEqual(fx.authorizations('A'), []);
});

browserTest('an origin that drops the connection fails the run loudly: no QA GATE verdict, a stderr line naming the origin, and the origin never gets a request without the token', async () => {
  const seen = [];
  const server = createServer((req, res) => { seen.push(req.headers.authorization || null); req.socket.destroy(); });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await run([`${origin}/page`, '--auth-header', SECRET]);
    assert.notEqual(r.code, 0, `${r.out}${r.err}`);
    assert.doesNotMatch(r.out, /QA GATE:/);
    assert.ok(r.err.includes(`site-auth: a request to ${origin} failed and was not retried without the site token`), r.err);
    noSecret(r);
    assert.ok(seen.length >= 1 && seen.every((a) => a === fx.authorization), JSON.stringify(seen));
  } finally { server.closeAllConnections(); server.close(); }
});
