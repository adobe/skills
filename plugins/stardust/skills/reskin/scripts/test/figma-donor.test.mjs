#!/usr/bin/env node
// skills/reskin/scripts/test/figma-donor.test.mjs — the figma-donor.mjs CLI, spawned against a local
// fake of the Figma API (fixtures/figma-kit/fake-figma.mjs; no network) in temp project dirs:
// --help, capture's outputs and its crawl log, one file version across every API call, variables
// refused by plan, the cache re-run (no requests, no token, byte-identical), --refresh into a new
// version, --max-frames cuts, missing token, bad URL, a long 429 (exit 3, completed calls kept),
// and no signed image URL or token in any written file or output.
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs, { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startFakeFigma } from './fixtures/figma-kit/fake-figma.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'figma-donor.mjs');
const KIT = join(HERE, 'fixtures', 'figma-kit');
const KEY = 'AbCdEf1234567890';
const URL_PAGE = `https://www.figma.com/design/${KEY}/Kit?node-id=0-1`;
const TOKEN = `tok-${randomBytes(12).toString('hex')}`;
const scratch = mkdtempSync(join(tmpdir(), 'figma-donor-test-'));
const outputs = [];
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const fake = await startFakeFigma({ fixtureDir: KIT, token: TOKEN, behaviors: {} });
let projN = 0;
const project = () => { projN += 1; const p = join(scratch, `p${projN}`); mkdirSync(p, { recursive: true }); return p; };
const run = (args, { cwd, token = TOKEN, env = {} } = {}) => new Promise((resolve) => {
  const e = { ...process.env, FIGMA_API_BASE: fake.base, ...env };
  if (token) e.FIGMA_TOKEN = token; else delete e.FIGMA_TOKEN;
  const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: cwd || scratch, env: e });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (code) => { outputs.push(stdout, stderr); resolve({ code, stdout, stderr }); });
});
const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
const hashTree = (dir) => Object.fromEntries(walk(dir).map((p) => [relative(dir, p), createHash('sha256').update(readFileSync(p)).digest('hex')]));
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const apiCalls = () => fake.requests.filter((r) => r.path.startsWith('/v1/'));
const reset = () => { fake.requests.length = 0; for (const k of Object.keys(fake.behaviors)) delete fake.behaviors[k]; fake.setFixtureDir(KIT); };

await check('--help: exit 0, usage, nothing written, no network', async () => {
  reset();
  const cwd = project();
  const r = await run(['--help'], { cwd });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /usage/i);
  for (const s of ['capture', '--frames', '--max-frames', '--refresh', '--list', '--max-wait', '--dir', 'FIGMA_TOKEN', 'Exit codes']) assert.ok(r.stdout.includes(s), `help lacks ${s}`);
  assert.deepEqual(walk(cwd), []);
  assert.equal(fake.requests.length, 0);
});

const donor = await import('../figma-donor.mjs');
await check('--help piped: the whole text reaches the reader, even a slow one', async () => {
  const r = await run(['--help']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, `${donor.HELP}\n`);
  const slow = spawnSync('sh', ['-c', `"${process.execPath}" "${SCRIPT}" --help | (sleep 1; cat)`], { encoding: 'utf8' });
  assert.equal(slow.status, 0, slow.stderr);
  assert.equal(slow.stdout, `${donor.HELP}\n`);
  assert.match(slow.stdout, /Exit codes: 0 ok[\s\S]*5xx after retries\)\.\n$/);
});
await check('exitAfterFlush: exits with the code only after stdout, then stderr, flush', async () => {
  const order = [];
  const pending = [];
  const stream = (name) => ({ write: (s, cb) => { order.push(`${name} write`); pending.push(() => { order.push(`${name} flushed`); cb(); }); return false; } });
  const saved = process.exitCode;
  try {
    donor.exitAfterFlush(3, { stdout: stream('stdout'), stderr: stream('stderr'), exit: (c) => order.push(`exit ${c}`) });
    assert.equal(process.exitCode, 3);
    assert.deepEqual(order, ['stdout write']);
    while (pending.length) pending.shift()();
    assert.deepEqual(order, ['stdout write', 'stdout flushed', 'stderr write', 'stderr flushed', 'exit 3']);
  } finally { process.exitCode = saved; }
});
await check('nodeVersionProblem: Node 22+ passes; older names the version found', async () => {
  assert.equal(donor.nodeVersionProblem('22.14.0'), null);
  assert.equal(donor.nodeVersionProblem('v24.1.0'), null);
  assert.equal(donor.nodeVersionProblem(process.versions.node), null);
  assert.equal(donor.nodeVersionProblem('18.20.4'), 'reskin needs Node 22+, found v18.20.4');
  assert.equal(donor.nodeVersionProblem('v20.0.0'), 'reskin needs Node 22+, found v20.0.0');
  assert.match(donor.nodeVersionProblem('garbage'), /needs Node 22\+/);
  assert.match(donor.HELP, /Needs Node 22\+/);
});
await check('an old Node stops at startup with exit 2 and one line', async () => {
  const shim = `Object.defineProperty(process.versions, 'node', { value: '18.20.4' }); process.argv.splice(1, 0, ${JSON.stringify(SCRIPT)}); await import(${JSON.stringify(pathToFileURL(SCRIPT).href)});`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', shim, 'curate'], { encoding: 'utf8', cwd: scratch });
  assert.equal(r.status, 2, r.stderr);
  assert.equal(r.stderr, 'figma-donor: reskin needs Node 22+, found v18.20.4\n');
  assert.equal(r.stdout, '');
});

const P1 = project();
let first;
await check('capture writes foundation, candidates, spec tables, screenshots, index, crawl log', async () => {
  reset();
  first = await run(['capture', URL_PAGE], { cwd: P1 });
  assert.equal(first.code, 0, first.stderr);
  const cs = join(P1, 'stardust', 'canon-source');
  for (const f of ['colors', 'typography', 'effects', 'radii', 'spacing', 'components']) {
    const j = json(join(cs, 'foundation', `${f}.json`));
    assert.equal(Object.keys(j)[0], '_provenance');
    assert.equal(j._provenance.writtenBy, 'stardust:reskin/figma-donor.mjs');
  }
  for (const f of ['role-candidates.json', 'module-candidates.json', 'spec-tables.json', '_crawl-log.json', 'assets/screenshots/index.json']) assert.ok(existsSync(join(cs, f)), f);
  assert.equal(Object.keys(json(join(cs, 'role-candidates.json'))).length, 21);
  assert.deepEqual(json(join(cs, 'spec-tables.json')).tables.map((t) => t.node), ['2:6']);
  const index = json(join(cs, 'assets', 'screenshots', 'index.json'));
  assert.deepEqual(index.home, { node: '1:2', width: 1440, height: 1840, version: 'v1', renderable: true });
  assert.equal(index.article.node, '1:9');
  assert.equal(readFileSync(join(cs, 'assets', 'screenshots', 'home.png')).subarray(1, 4).toString(), 'PNG');
  const log = json(join(cs, '_crawl-log.json'));
  assert.deepEqual(Object.keys(log), ['_provenance', 'discovery', 'consent', 'crawl', 'visionCheck', 'siblingCandidates', 'notBrowserRendered']);
  assert.equal(log.discovery.method, 'figma-rest');
  assert.equal(log.discovery.fetchTechnique, 'figma-rest');
  assert.equal(log.discovery.version, 'v1');
  assert.deepEqual(log.discovery.selected, ['1:2', '1:9']);
  assert.equal(log.consent, null);
  assert.ok(Object.values(log.notBrowserRendered).every((s) => s === 'authored from Figma REST node data, not browser-rendered'));
  assert.ok('stardust/canon-source/foundation/colors.json' in log.notBrowserRendered);
  assert.match(first.stdout, /capture: 2 frame/);
});
await check('every later API call carries version=<v>; files first with depth=2', () => {
  const calls = apiCalls();
  assert.equal(calls[0].path, `/v1/files/${KEY}`);
  assert.equal(calls[0].query.depth, '2');
  assert.ok(calls.slice(1).every((r) => r.query.version === 'v1'), calls.map((r) => r.rawUrl).join('\n'));
  assert.deepEqual(calls.map((r) => r.path), [`/v1/files/${KEY}`, `/v1/files/${KEY}/nodes`, `/v1/files/${KEY}/variables/local`, `/v1/images/${KEY}`]);
  assert.equal(calls[1].query.ids, '1:2,1:9');
});
await check('image bytes fetched without the token', () => {
  const imgs = fake.requests.filter((r) => r.path.startsWith('/img/'));
  assert.equal(imgs.length, 2);
  assert.ok(imgs.every((r) => r.headers['x-figma-token'] === undefined));
});
await check('variables 403 → unavailable (plan), exit 0', () => {
  const log = json(join(P1, 'stardust', 'canon-source', '_crawl-log.json'));
  assert.deepEqual(log.crawl.endpoints.find((e) => e.name === 'variables'), { name: 'variables', status: 'unavailable (plan)' });
  assert.equal(first.code, 0);
});
await check('cache: raw responses and a latest pointer, no signed URLs', () => {
  const v = join(P1, 'stardust', '.work', 'reskin', 'figma', KEY, 'v1');
  for (const f of ['file.json', 'nodes.json', 'images.json', 'manifest.json']) assert.ok(existsSync(join(v, f)), f);
  assert.deepEqual(json(join(P1, 'stardust', '.work', 'reskin', 'figma', KEY, 'latest.json')), { version: 'v1' });
  const m = json(join(v, 'manifest.json'));
  assert.deepEqual([m.fileKey, m.mainFileKey, m.nodeId, m.version, m.frames, m.cut], [KEY, KEY, '0:1', 'v1', ['1:2', '1:9'], []]);
});
await check('second run: 0 requests, outputs byte-identical, FIGMA_TOKEN unset is fine', async () => {
  const before = hashTree(join(P1, 'stardust'));
  reset();
  const r = await run(['capture', URL_PAGE], { cwd: P1, token: '' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fake.requests.length, 0);
  assert.deepEqual(hashTree(join(P1, 'stardust')), before);
  assert.match(r.stdout, /from cache/);
});
await check('a cached run with a different selection asks for --refresh', async () => {
  reset();
  const r = await run(['capture', URL_PAGE, '--frames', '1:2'], { cwd: P1, token: '' });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--refresh/);
  assert.equal(fake.requests.length, 0);
});
await check('--refresh after the file moved to v2: new v2 cache dir, v1 untouched, index version v2', async () => {
  const v1 = hashTree(join(P1, 'stardust', '.work', 'reskin', 'figma', KEY, 'v1'));
  const kit2 = join(scratch, 'kit-v2');
  cpSync(KIT, kit2, { recursive: true });
  for (const f of ['file.json', 'nodes.json']) { const j = json(join(kit2, f)); j.version = 'v2'; writeFileSync(join(kit2, f), JSON.stringify(j)); }
  reset();
  fake.setFixtureDir(kit2);
  const r = await run(['capture', URL_PAGE, '--refresh'], { cwd: P1 });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(existsSync(join(P1, 'stardust', '.work', 'reskin', 'figma', KEY, 'v2', 'manifest.json')));
  assert.deepEqual(hashTree(join(P1, 'stardust', '.work', 'reskin', 'figma', KEY, 'v1')), v1);
  assert.deepEqual(json(join(P1, 'stardust', '.work', 'reskin', 'figma', KEY, 'latest.json')), { version: 'v2' });
  const index = json(join(P1, 'stardust', 'canon-source', 'assets', 'screenshots', 'index.json'));
  assert.ok(Object.entries(index).filter(([k]) => !k.startsWith('_')).every(([, e]) => e.version === 'v2'));
  assert.ok(apiCalls().slice(1).every((c) => c.query.version === 'v2'));
});
await check('--frames picks frames by id in either form', async () => {
  reset();
  const p = project();
  const r = await run(['capture', `https://www.figma.com/design/${KEY}/Kit`, '--frames', '1-2'], { cwd: p });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(json(join(p, 'stardust', '.work', 'reskin', 'figma', KEY, 'v1', 'manifest.json')).frames, ['1:2']);
  assert.equal(apiCalls()[1].query.ids, '1:2');
});
await check('a page node-id with 30 top-level frames, --max-frames 25 → 5 in manifest.cut and a stderr warning', async () => {
  const many = join(scratch, 'kit-many');
  cpSync(KIT, many, { recursive: true });
  const frames = Array.from({ length: 30 }, (_, i) => ({ id: `9:${i + 1}`, name: `Page ${i + 1}`, type: 'FRAME', absoluteBoundingBox: { x: i * 1500, y: 0, width: 1440, height: 900 } }));
  const file = json(join(KIT, 'file.json'));
  file.document.children = [{ id: '0:1', name: 'Pages', type: 'CANVAS', children: frames }];
  writeFileSync(join(many, 'file.json'), JSON.stringify(file));
  writeFileSync(join(many, 'nodes.json'), JSON.stringify({ version: 'v1', nodes: Object.fromEntries(frames.map((f) => [f.id, { document: { ...f, fills: [], children: [] }, components: {}, componentSets: {}, styles: {} }])) }));
  writeFileSync(join(many, 'images.json'), JSON.stringify({ err: null, images: Object.fromEntries(frames.map((f) => [f.id, '{{base}}/img/frame-a.png'])) }));
  reset();
  fake.setFixtureDir(many);
  const p = project();
  const r = await run(['capture', `https://www.figma.com/design/${KEY}/Kit?node-id=0-1`, '--max-frames', '25'], { cwd: p });
  assert.equal(r.code, 0, r.stderr);
  const m = json(join(p, 'stardust', '.work', 'reskin', 'figma', KEY, 'v1', 'manifest.json'));
  assert.equal(m.frames.length, 25);
  assert.deepEqual(m.cut, ['9:26', '9:27', '9:28', '9:29', '9:30']);
  assert.match(r.stderr, /30 top-level frames.*25/s);
  assert.match(r.stderr, /9:26/);
  const nodeCalls = apiCalls().filter((c) => c.path.endsWith('/nodes'));
  const imageCalls = apiCalls().filter((c) => c.path.startsWith('/v1/images/'));
  assert.equal(nodeCalls.length, 5, 'nodes in batches of 5');
  assert.equal(imageCalls.length, 5, 'images in batches of 5');
  assert.ok([...nodeCalls, ...imageCalls].every((c) => c.query.ids.split(',').length <= 5));
  assert.equal(json(join(p, 'stardust', '.work', 'reskin', 'figma', KEY, 'v1', 'nodes.json')).nodes['9:25'].document.id, '9:25');
});
await check('no node-id and no --frames on a file with more frames than --max-frames → exit 2 pointing at --list; nothing captured', async () => {
  reset();
  fake.setFixtureDir(join(scratch, 'kit-many'));
  const p = project();
  const r = await run(['capture', `https://www.figma.com/design/${KEY}/Kit`, '--max-frames', '25'], { cwd: p });
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /30 top-level frames/);
  assert.match(r.stderr, /--list/);
  assert.match(r.stderr, /--frames/);
  assert.ok(!existsSync(join(p, 'stardust', 'canon-source')));
  assert.deepEqual(apiCalls().map((c) => c.path), [`/v1/files/${KEY}`]);
});
await check('capture --list: one files call, every page and its top-level frames printed, nothing captured', async () => {
  reset();
  const p = project();
  const r = await run(['capture', `https://www.figma.com/design/${KEY}/Kit`, '--list'], { cwd: p });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(apiCalls().map((c) => [c.path, c.query.depth]), [[`/v1/files/${KEY}`, '2']]);
  const lines = r.stdout.split('\n');
  assert.ok(lines.includes('0:1  Pages  (2)'), r.stdout);
  assert.ok(lines.includes('  1:2  FRAME  1440x1840  Home'), r.stdout);
  assert.ok(lines.includes('0:2  Components  (1)'), r.stdout);
  assert.ok(lines.includes('  3:1  COMPONENT_SET  400x120  Button'), r.stdout);
  assert.match(r.stdout, /2 pages, 3 top-level nodes, file version v1/);
  assert.ok(!existsSync(join(p, 'stardust', 'canon-source')));
  assert.ok(!existsSync(join(p, 'stardust', '.work', 'reskin', 'figma', 'current.json')));
  assert.ok(!existsSync(join(p, 'stardust', '.work', 'reskin', 'figma', KEY, 'latest.json')));
});
await check('capture --list after a capture: from cache, no request, no token', async () => {
  reset();
  const r = await run(['capture', URL_PAGE, '--list'], { cwd: P1, token: '' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fake.requests.length, 0);
  assert.match(r.stdout, /from cache/);
  assert.match(r.stdout, /  1:9  FRAME  1440x1800  Article/);
});
await check('a 429 on the third nodes batch → exit 3; the re-run fetches only the batches still missing', async () => {
  reset();
  fake.setFixtureDir(join(scratch, 'kit-many'));
  fake.behaviors[`/v1/files/${KEY}/nodes`] = [{}, {}, { status: 429, headers: { 'retry-after': '3600' }, body: { status: 429, err: 'Rate limit exceeded' } }];
  const p = project();
  const first = await run(['capture', `https://www.figma.com/design/${KEY}/Kit?node-id=0-1`, '--max-frames', '25'], { cwd: p });
  assert.equal(first.code, 3, first.stderr);
  fake.requests.length = 0;
  const again = await run(['capture', `https://www.figma.com/design/${KEY}/Kit?node-id=0-1`, '--max-frames', '25'], { cwd: p });
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(apiCalls().filter((c) => c.path.endsWith('/nodes')).map((c) => c.query.ids.split(',')[0]), ['9:11', '9:16', '9:21']);
  assert.ok(!readdirSync(join(p, 'stardust', '.work', 'reskin', 'figma', KEY, 'v1')).some((f) => f.startsWith('nodes.part-')), 'batch parts cleaned up');
});
await check('the optional variables call failing (HTTP 400) is recorded, not fatal', async () => {
  reset();
  fake.behaviors[`/v1/files/${KEY}/variables/local`] = { status: 400, body: { status: 400, err: 'Invalid scope' } };
  const p = project();
  const r = await run(['capture', URL_PAGE], { cwd: p });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(json(join(p, 'stardust', 'canon-source', '_crawl-log.json')).crawl.endpoints.find((e) => e.name === 'variables'), { name: 'variables', status: 'unavailable (HTTP 400)' });
  assert.match(r.stderr, /variables\/local unavailable/);
});
await check('a --refresh that stopped part-way is reported on the next cached run', async () => {
  reset();
  const p = project();
  assert.equal((await run(['capture', URL_PAGE], { cwd: p })).code, 0);
  reset();
  fake.setFixtureDir(join(scratch, 'kit-v2'));
  fake.behaviors[`/v1/images/${KEY}`] = { status: 429, headers: { 'retry-after': '3600' }, body: { status: 429, err: 'Rate limit exceeded' } };
  assert.equal((await run(['capture', URL_PAGE, '--refresh'], { cwd: p })).code, 3);
  const r = await run(['capture', URL_PAGE], { cwd: p, token: '' });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /version v2\) stopped part-way.*v1.*--refresh/s);
});
const URL_FILE = `https://www.figma.com/design/${KEY}/Kit`;
await check('a failed refresh of another selection at the same version leaves the complete capture intact; the old selection still serves, the refresh resumes', async () => {
  reset();
  const p = project();
  assert.equal((await run(['capture', URL_FILE, '--frames', '1:2'], { cwd: p })).code, 0);
  const root = join(p, 'stardust', '.work', 'reskin', 'figma', KEY);
  const cs = join(p, 'stardust', 'canon-source');
  const before = { cache: hashTree(join(root, 'v1')), outputs: hashTree(cs) };
  reset();
  fake.behaviors[`/v1/images/${KEY}`] = { status: 429, headers: { 'retry-after': '3600' }, body: { status: 429, err: 'Rate limit exceeded' } };
  assert.equal((await run(['capture', URL_FILE, '--frames', '1:9', '--refresh'], { cwd: p })).code, 3);
  assert.deepEqual(hashTree(join(root, 'v1')), before.cache, 'the complete capture was written to');
  assert.deepEqual(json(join(root, 'latest.json')), { version: 'v1' });
  reset();
  const again = await run(['capture', URL_FILE, '--frames', '1:2'], { cwd: p, token: '' });
  assert.equal(again.code, 0, again.stderr);
  assert.equal(fake.requests.length, 0);
  assert.match(again.stderr, /refresh of version v1 stopped part-way/);
  assert.deepEqual(json(join(cs, 'module-candidates.json')).frames.map((f) => f.node), ['1:2']);
  assert.deepEqual(json(join(cs, '_crawl-log.json')).discovery.missing, []);
  assert.deepEqual(hashTree(cs), before.outputs);
  reset();
  const done = await run(['capture', URL_FILE, '--frames', '1:9', '--refresh'], { cwd: p });
  assert.equal(done.code, 0, done.stderr);
  assert.ok(!apiCalls().some((c) => c.path.endsWith('/nodes')), 'the stopped refresh resumed from staging');
  assert.deepEqual(json(join(root, 'v1', 'manifest.json')).frames, ['1:9']);
  assert.deepEqual(readdirSync(root).sort(), ['latest.json', 'v1'], 'staging cleaned up');
});
await check('a cache whose manifest and saved selection or nodes disagree → exit 2 naming both, no request; a cache without selection.json still serves', async () => {
  reset();
  const p = project();
  assert.equal((await run(['capture', URL_FILE, '--frames', '1:2'], { cwd: p })).code, 0);
  const v1 = join(p, 'stardust', '.work', 'reskin', 'figma', KEY, 'v1');
  const [selection, nodes] = ['selection.json', 'nodes.json'].map((f) => readFileSync(join(v1, f)));
  const swapped = { ...JSON.parse(nodes), nodes: { '1:9': JSON.parse(nodes).nodes['1:2'] } };
  const cs = hashTree(join(p, 'stardust', 'canon-source'));
  const serve = () => run(['capture', URL_FILE, '--frames', '1:2'], { cwd: p, token: '' });
  // what an in-place refresh of 1:9 that stopped before its manifest left in the old layout
  writeFileSync(join(v1, 'selection.json'), JSON.stringify({ frames: ['1:9'] }));
  writeFileSync(join(v1, 'nodes.json'), JSON.stringify(swapped));
  reset();
  const bad = await serve();
  assert.equal(bad.code, 2, bad.stderr);
  assert.match(bad.stderr, /inconsistent.*manifest\.json lists frames 1:2.*nodes\.json holds 1:9.*selection\.json names 1:9.*--refresh/s);
  assert.equal(fake.requests.length, 0);
  assert.deepEqual(hashTree(join(p, 'stardust', 'canon-source')), cs, 'nothing rewritten');
  writeFileSync(join(v1, 'nodes.json'), nodes);
  assert.equal((await serve()).code, 2, 'the selection alone disagrees');
  rmSync(join(v1, 'selection.json'));
  assert.equal((await serve()).code, 0, 'a cache from before selection.json was kept still serves');
  writeFileSync(join(v1, 'selection.json'), selection);
  assert.equal((await serve()).code, 0);
});
await check('missing FIGMA_TOKEN with no cache → exit 2 naming FIGMA_TOKEN and file_content:read', async () => {
  reset();
  const r = await run(['capture', URL_PAGE], { cwd: project(), token: '' });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /FIGMA_TOKEN/);
  assert.match(r.stderr, /file_content:read/);
  assert.equal(fake.requests.length, 0);
});
await check('a bad URL → exit 2 listing accepted forms', async () => {
  reset();
  const r = await run(['capture', 'https://example.com/x'], { cwd: project() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /figma\.com\/design/);
});
await check('a value flag with no value, an unknown flag or command → exit 2 naming it', async () => {
  for (const [args, re] of [[['capture', URL_PAGE, '--frames'], /--frames/], [['capture', URL_PAGE, '--max-frames', '--refresh'], /--max-frames/], [['capture', URL_PAGE, '--bogus'], /--bogus/], [['nope'], /nope/], [['capture'], /figma-url/], [['capture', URL_PAGE, '--max-frames', '0'], /--max-frames/]]) {
    const r = await run(args, { cwd: project() });
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, re);
  }
});
await check('a 429 with Retry-After 3600 → exit 3, cache of completed calls kept', async () => {
  reset();
  fake.behaviors[`/v1/images/${KEY}`] = { status: 429, headers: { 'retry-after': '3600', 'x-figma-plan-tier': 'starter', 'x-figma-rate-limit-type': 'low' }, body: { status: 429, err: 'Rate limit exceeded' } };
  const p = project();
  const r = await run(['capture', URL_PAGE, '--max-wait', '30'], { cwd: p });
  assert.equal(r.code, 3, r.stderr);
  assert.match(r.stderr, /starter/);
  const root = join(p, 'stardust', '.work', 'reskin', 'figma', KEY);
  const [stage] = readdirSync(join(root, '.staging'));
  assert.ok(existsSync(join(root, '.staging', stage, 'file.json')) && existsSync(join(root, '.staging', stage, 'nodes.json')), 'completed calls kept in staging');
  assert.ok(!existsSync(join(root, 'v1')), 'no complete capture yet');
  assert.ok(!existsSync(join(root, 'latest.json')));
  assert.ok(!existsSync(join(p, 'stardust', 'canon-source')));
  delete fake.behaviors[`/v1/images/${KEY}`];
  fake.requests.length = 0;
  const again = await run(['capture', URL_PAGE], { cwd: p });
  assert.equal(again.code, 0, again.stderr);
  assert.ok(!apiCalls().some((c) => c.path.endsWith('/nodes')), 'completed nodes call reused');
  assert.ok(existsSync(join(root, 'v1', 'manifest.json')) && !existsSync(join(root, '.staging', stage)), 'promoted out of staging');
});
await check('curate: no capture → exit 2 naming capture; no rules → exit 2 naming curation-rules.json', async () => {
  const none = await run(['curate'], { cwd: project() });
  assert.equal(none.code, 2);
  assert.match(none.stderr, /capture/);
  const r = await run(['curate'], { cwd: P1, token: '' });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /curation-rules\.json/);
});
await check('curate writes donor-tokens.json and donor-modules.md; 13/13 asserted; byte-identical on re-run', async () => {
  mkdirSync(join(P1, 'stardust', 'reskin'), { recursive: true });
  cpSync(join(KIT, 'curation-rules.json'), join(P1, 'stardust', 'reskin', 'curation-rules.json'));
  reset();
  const r = await run(['curate'], { cwd: P1, token: '' });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /13\/13 probe paths asserted/);
  assert.match(r.stdout, /^note: recommended token not curated: cards\.primary\.borderRadius \(map it, or mark it absent with a why\)$/m);
  assert.doesNotMatch(r.stdout, /not curated: buttons\.primary\.height/);
  assert.equal(fake.requests.length, 0);
  const tokensPath = join(P1, 'stardust', 'reskin', 'donor-tokens.json');
  const t = json(tokensPath);
  assert.equal(t.donor, `https://www.figma.com/design/${KEY}?node-id=0-1`);
  assert.equal(t.curatedFrom, 'reskin/curation-rules.json@v1; canon-source/foundation (figma version v2)');
  assert.equal(t.palette.pageBg, 'rgb(255, 255, 255)');
  const m = json(join(P1, 'stardust', '.work', 'reskin', 'figma', KEY, 'v2', 'manifest.json'));
  assert.equal(t._provenance.writtenAt, m.capturedAt);
  assert.match(readFileSync(join(P1, 'stardust', 'reskin', 'donor-modules.md'), 'utf8'), /\| M1 \| Gradient hero \|/);
  const cs = join(P1, 'stardust', 'canon-source');
  assert.equal(json(join(cs, 'DESIGN.json')).schemaVersion, 2);
  assert.equal(json(join(cs, '_brand-extraction.json')).origins[0].role, 'design-source');
  assert.match(readFileSync(join(cs, 'DESIGN.md'), 'utf8'), /^<!-- stardust:provenance\n/);
  assert.match(r.stdout, /canon-source\/DESIGN\.md/);
  const before = { ...hashTree(join(P1, 'stardust', 'reskin')), ...hashTree(cs) };
  const again = await run(['curate'], { cwd: P1, token: '' });
  assert.equal(again.code, 0);
  assert.deepEqual({ ...hashTree(join(P1, 'stardust', 'reskin')), ...hashTree(cs) }, before);
});
await check('curate with an unresolved from → exit 1 naming the rule; outputs left as they were', async () => {
  const rulesPath = join(P1, 'stardust', 'reskin', 'curation-rules.json');
  const good = readFileSync(rulesPath);
  const before = hashTree(join(P1, 'stardust', 'reskin'));
  const bad = JSON.parse(good); bad.roles['palette.bodyFg'] = { from: 'colors/missing' };
  writeFileSync(rulesPath, JSON.stringify(bad));
  const r = await run(['curate'], { cwd: P1, token: '' });
  writeFileSync(rulesPath, good);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /palette\.bodyFg.*colors\/missing/);
  assert.deepEqual(hashTree(join(P1, 'stardust', 'reskin')), before);
});
await check('--help documents curate and the curation-rules.json schema', async () => {
  const r = await run(['--help'], { cwd: project() });
  for (const s of ['curate', 'curation-rules.json', '"roles"', 'normalizations', 'lineHeightUnitless', 'absent']) assert.ok(r.stdout.includes(s), `help lacks ${s}`);
});
// ---- stamp ---------------------------------------------------------------------------------------
const PHRASE = join(HERE, '..', '..', '..', '..', 'evals', 'direct-from-phrase', 'fixture', 'stardust');
const STATE_MJS = join(HERE, '..', '..', '..', 'stardust', 'scripts', 'state.mjs');
const extracted = async () => {
  reset();
  const p = project();
  cpSync(PHRASE, join(p, 'stardust'), { recursive: true });
  assert.equal((await run(['capture', URL_PAGE], { cwd: p })).code, 0);
  return p;
};
const curated = async () => {
  const p = await extracted();
  mkdirSync(join(p, 'stardust', 'reskin'), { recursive: true });
  cpSync(join(KIT, 'curation-rules.json'), join(p, 'stardust', 'reskin', 'curation-rules.json'));
  assert.equal((await run(['curate'], { cwd: p, token: '' })).code, 0);
  return p;
};
await check('stamp: no state.json → exit 2 naming "extract <content-url>"', async () => {
  const r = await run(['stamp'], { cwd: P1, token: '' });
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /extract <content-url>/);
});
await check('stamp: no DESIGN files → exit 2 naming curate', async () => {
  const p = await extracted();
  const before = readFileSync(join(p, 'stardust', 'state.json'));
  const r = await run(['stamp'], { cwd: p, token: '' });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /curate/);
  assert.deepEqual(readFileSync(join(p, 'stardust', 'state.json')), before);
});
const P2 = await curated();
const stateBefore = json(join(P2, 'stardust', 'state.json'));
let stamped;
await check('stamp writes designSource only; pages, site, flow, direction unchanged', async () => {
  const r = await run(['stamp'], { cwd: P2, token: '' });
  assert.equal(r.code, 0, r.stderr);
  stamped = json(join(P2, 'stardust', 'state.json'));
  const strip = ({ _provenance, designSource, ...rest }) => rest;
  assert.deepEqual(strip(stamped), strip(stateBefore));
  const m = json(join(P2, 'stardust', '.work', 'reskin', 'figma', KEY, 'v1', 'manifest.json'));
  assert.deepEqual(stamped.designSource, { url: `https://www.figma.com/design/${KEY}?node-id=0-1`, capturedAt: m.capturedAt, path: 'stardust/canon-source/' });
  assert.deepEqual(Object.keys(stamped).slice(0, 3), ['_provenance', 'site', 'designSource']);
  assert.match(r.stdout, /designSource/);
});
await check('_provenance.writtenBy is stardust:reskin', () => {
  assert.equal(stamped._provenance.writtenBy, 'stardust:reskin');
  assert.notEqual(stamped._provenance.writtenAt, stateBefore._provenance.writtenAt);
});
await check('direct Setup preconditions hold: ≥1 extracted page, current/_brand-extraction.json, designSource.path resolves, both DESIGN files exist', () => {
  assert.ok(stamped.pages.some((pg) => pg.status === 'extracted'));
  assert.ok(existsSync(join(P2, 'stardust', 'current', '_brand-extraction.json')));
  assert.ok(existsSync(join(P2, stamped.designSource.path)));
  for (const f of ['DESIGN.md', 'DESIGN.json']) assert.ok(existsSync(join(P2, stamped.designSource.path, f)), f);
});
await check('stamp again: same designSource, exit 0', async () => {
  const r = await run(['stamp'], { cwd: P2, token: '' });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(json(join(P2, 'stardust', 'state.json')).designSource, stamped.designSource);
});
await check('project-copy layout: figma-donor.mjs under stardust/scripts/reskin/ finds stardust/scripts/stardust/state.mjs', async () => {
  const copy = join(P2, 'stardust', 'scripts', 'reskin');
  cpSync(join(HERE, '..'), copy, { recursive: true });
  const r0 = await new Promise((resolve) => {
    const c = spawn(process.execPath, [join('stardust', 'scripts', 'reskin', 'figma-donor.mjs'), 'stamp'], { cwd: P2 });
    let err = ''; c.stderr.on('data', (d) => { err += d; }); c.on('close', (code) => resolve({ code, err }));
  });
  assert.equal(r0.code, 2, 'no state.mjs copy yet');
  assert.match(r0.err, /state\.mjs/);
  mkdirSync(join(P2, 'stardust', 'scripts', 'stardust'), { recursive: true });
  cpSync(STATE_MJS, join(P2, 'stardust', 'scripts', 'stardust', 'state.mjs'));
  const r = await new Promise((resolve) => {
    const c = spawn(process.execPath, [join('stardust', 'scripts', 'reskin', 'figma-donor.mjs'), 'stamp'], { cwd: P2 });
    let err = ''; c.stderr.on('data', (d) => { err += d; }); c.on('close', (code) => resolve({ code, err }));
  });
  assert.equal(r.code, 0, r.err);
  assert.equal(json(join(P2, 'stardust', 'state.json')).designSource.path, 'stardust/canon-source/');
});

// ---- --confidential and the token canary ---------------------------------------------------------
const NOGLOBAL = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const gitProject = () => {
  const p = project();
  const g = spawnSync('git', ['init', '-q'], { cwd: p, env: { ...process.env, ...NOGLOBAL } });
  assert.equal(g.status, 0);
  return p;
};
const printedLines = (stderr) => stderr.split('\n').filter((l) => /^(canon-source|reskin|\.work)\//.test(l));
const PC = gitProject();
await check('--confidential in a repo that ignores nothing → exit 2, lists foundation/, candidates, screenshots index, crawl log; nothing written', async () => {
  reset();
  const r = await run(['capture', URL_PAGE, '--confidential'], { cwd: PC, env: NOGLOBAL });
  assert.equal(r.code, 2, r.stderr);
  const lines = printedLines(r.stderr);
  for (const l of ['canon-source/foundation/', 'canon-source/role-candidates.json', 'canon-source/module-candidates.json', 'canon-source/spec-tables.json', 'canon-source/assets/screenshots/', 'canon-source/_crawl-log.json', '.work/']) assert.ok(lines.includes(l), `missing ${l}`);
  // curate's outputs are listed up front, so one .gitignore edit covers the pipeline
  for (const l of ['reskin/curation-rules.json', 'reskin/donor-tokens.json', 'reskin/donor-modules.md', 'canon-source/DESIGN.md', 'canon-source/DESIGN.json', 'canon-source/_brand-extraction.json']) assert.ok(lines.includes(l), `missing ${l}`);
  assert.match(r.stderr, /stardust\/\.gitignore/);
  assert.deepEqual(walk(PC).filter((f) => !f.includes('/.git/')), []);
  assert.equal(fake.requests.length, 0);
});
await check('--confidential: only capture lines added → capture succeeds with a curate warning; curate refuses until its lines are added (sticky)', async () => {
  reset();
  const first = await run(['capture', URL_PAGE, '--confidential'], { cwd: PC, env: NOGLOBAL });
  mkdirSync(join(PC, 'stardust'), { recursive: true });
  const captureOnly = printedLines(first.stderr).filter((l) => !l.startsWith('reskin/') && !/DESIGN\.|_brand-extraction/.test(l));
  writeFileSync(join(PC, 'stardust', '.gitignore'), `${captureOnly.join('\n')}\n`);
  const cap = await run(['capture', URL_PAGE, '--confidential'], { cwd: PC, env: NOGLOBAL });
  assert.equal(cap.code, 0, cap.stderr);
  assert.match(cap.stderr, /curate will refuse until stardust\/\.gitignore also has: .*reskin\/donor-tokens\.json/);
  mkdirSync(join(PC, 'stardust', 'reskin'), { recursive: true });
  cpSync(join(KIT, 'curation-rules.json'), join(PC, 'stardust', 'reskin', 'curation-rules.json'));
  assert.equal(json(join(PC, 'stardust', '.work', 'reskin', 'figma', 'current.json')).confidential, true);
  const blocked = await run(['curate'], { cwd: PC, token: '', env: NOGLOBAL });
  assert.match(blocked.stdout, /confidential: on/);
  assert.equal(blocked.code, 2, blocked.stderr);
  const more = printedLines(blocked.stderr);
  for (const l of ['reskin/curation-rules.json', 'reskin/donor-tokens.json', 'reskin/donor-modules.md', 'canon-source/DESIGN.md', 'canon-source/DESIGN.json', 'canon-source/_brand-extraction.json']) assert.ok(more.includes(l), `missing ${l}`);
  assert.ok(!existsSync(join(PC, 'stardust', 'reskin', 'donor-tokens.json')));
  writeFileSync(join(PC, 'stardust', '.gitignore'), `${readFileSync(join(PC, 'stardust', '.gitignore'), 'utf8')}${more.join('\n')}\n`);
  const cur = await run(['curate'], { cwd: PC, token: '', env: NOGLOBAL });
  assert.equal(cur.code, 0, cur.stderr);
  const st = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: PC, encoding: 'utf8', env: { ...process.env, ...NOGLOBAL } }).stdout;
  assert.deepEqual(st.trim().split('\n'), ['?? stardust/.gitignore'], st);
});
await check('--confidential: the capture refusal\'s lines alone are enough for capture and curate', async () => {
  reset();
  const P1 = gitProject();
  const first = await run(['capture', URL_PAGE, '--confidential'], { cwd: P1, env: NOGLOBAL });
  mkdirSync(join(P1, 'stardust', 'reskin'), { recursive: true });
  writeFileSync(join(P1, 'stardust', '.gitignore'), `${printedLines(first.stderr).join('\n')}\n`);
  const cap = await run(['capture', URL_PAGE, '--confidential'], { cwd: P1, env: NOGLOBAL });
  assert.equal(cap.code, 0, cap.stderr); assert.doesNotMatch(cap.stderr, /curate will refuse/);
  cpSync(join(KIT, 'curation-rules.json'), join(P1, 'stardust', 'reskin', 'curation-rules.json'));
  const cur = await run(['curate'], { cwd: P1, token: '', env: NOGLOBAL });
  assert.equal(cur.code, 0, cur.stderr);
});
await check('a plain stamp after capture --confidential → designSource.url is "figma:redacted"; state.json stays tracked', async () => {
  cpSync(PHRASE, join(PC, 'stardust'), { recursive: true, force: false, errorOnExist: false });
  const r = await run(['stamp'], { cwd: PC, token: '', env: NOGLOBAL });
  assert.equal(r.code, 0, r.stderr);
  const s = json(join(PC, 'stardust', 'state.json'));
  assert.equal(s.designSource.url, 'figma:redacted');
  assert.ok(!JSON.stringify(s).includes(KEY));
  assert.ok(!r.stdout.includes(KEY));
  assert.equal(spawnSync('git', ['check-ignore', '-q', 'stardust/state.json'], { cwd: PC, env: { ...process.env, ...NOGLOBAL } }).status, 1);
});
await check('--confidential with an output already tracked → exit 2 naming git rm --cached', async () => {
  reset();
  const p = gitProject();
  const g = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: p, env: { ...process.env, ...NOGLOBAL } });
  mkdirSync(join(p, 'stardust', 'canon-source'), { recursive: true });
  writeFileSync(join(p, 'stardust', 'canon-source', '_crawl-log.json'), '{}\n');
  assert.equal(g('add', '-A').status, 0);
  assert.equal(g('commit', '-q', '-m', 'x').status, 0);
  writeFileSync(join(p, 'stardust', '.gitignore'), ['canon-source/foundation/', 'canon-source/role-candidates.json', 'canon-source/module-candidates.json', 'canon-source/spec-tables.json', 'canon-source/assets/screenshots/', 'canon-source/_crawl-log.json', '.work/', ''].join('\n'));
  const r = await run(['capture', URL_PAGE, '--confidential'], { cwd: p, env: NOGLOBAL });
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /git rm --cached -- stardust\/canon-source\/_crawl-log\.json/);
  assert.equal(fake.requests.length, 0);
});
const IGNORE_ALL = ['canon-source/foundation/', 'canon-source/role-candidates.json', 'canon-source/module-candidates.json', 'canon-source/spec-tables.json', 'canon-source/assets/screenshots/', 'canon-source/_crawl-log.json', '.work/'];
const withIgnore = (p, lines) => { mkdirSync(join(p, 'stardust'), { recursive: true }); writeFileSync(join(p, 'stardust', '.gitignore'), `${lines.join('\n')}\n`); return p; };
const untouched = (p) => walk(p).filter((f) => !f.includes('/.git/')).map((f) => relative(p, f));
await check('--confidential refuses an ignore negation of a non-representative output: exit 2 naming it, no request, nothing written', async () => {
  reset();
  const p = withIgnore(gitProject(), [...IGNORE_ALL.filter((l) => l !== 'canon-source/foundation/'), 'canon-source/foundation/*', '!canon-source/foundation/typography.json']);
  const r = await run(['capture', URL_PAGE, '--confidential'], { cwd: p, env: NOGLOBAL });
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /stardust\/canon-source\/foundation\/typography\.json/);
  assert.ok(!r.stderr.includes('colors.json'));
  assert.equal(fake.requests.length, 0);
  assert.deepEqual(untouched(p), ['stardust/.gitignore']);
});
await check('--confidential refuses a tracked file under a capture output directory that the run would not write', async () => {
  reset();
  const p = gitProject();
  mkdirSync(join(p, 'stardust', 'canon-source', 'assets', 'screenshots'), { recursive: true });
  writeFileSync(join(p, 'stardust', 'canon-source', 'assets', 'screenshots', 'old-slug.png'), 'x');
  spawnSync('git', ['add', '-A'], { cwd: p, env: { ...process.env, ...NOGLOBAL } });
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x'], { cwd: p, env: { ...process.env, ...NOGLOBAL } });
  withIgnore(p, IGNORE_ALL);
  const r = await run(['capture', URL_PAGE, '--confidential'], { cwd: p, env: NOGLOBAL });
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /git rm --cached -- stardust\/canon-source\/assets\/screenshots\/old-slug\.png/);
  assert.equal(fake.requests.length, 0);
});
await check('--confidential checks the cache paths once the file version is known: refused before the first cache write', async () => {
  reset();
  const p = withIgnore(gitProject(), [...IGNORE_ALL.filter((l) => l !== '.work/'), '.work/reskin/figma/current.json', '.work/reskin/figma/*/latest.json']);
  const r = await run(['capture', URL_PAGE, '--confidential'], { cwd: p, env: NOGLOBAL });
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /stardust\/\.work\/reskin\/figma\/AbCdEf1234567890\/\.staging\/v1-[0-9a-f]{8}\/nodes\.json/);
  assert.deepEqual(apiCalls().map((c) => c.path), [`/v1/files/${KEY}`]);
  assert.deepEqual(untouched(p), ['stardust/.gitignore']);
});
await check('--confidential checks every screenshot destination before writing canon-source; the cache stays and the fixed .gitignore finishes it with no request', async () => {
  reset();
  const lines = [...IGNORE_ALL.filter((l) => l !== 'canon-source/assets/screenshots/'), 'canon-source/assets/screenshots/*', '!canon-source/assets/screenshots/home.png'];
  const p = withIgnore(gitProject(), lines);
  const r = await run(['capture', URL_PAGE, '--confidential'], { cwd: p, env: NOGLOBAL });
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /1 output\(s\).*stardust\/canon-source\/assets\/screenshots\/home\.png/);
  assert.ok(!existsSync(join(p, 'stardust', 'canon-source')), 'nothing written under canon-source');
  assert.ok(existsSync(join(p, 'stardust', '.work', 'reskin', 'figma', KEY, 'v1', 'manifest.json')));
  withIgnore(p, [...lines, 'canon-source/assets/screenshots/']);
  reset();
  const again = await run(['capture', URL_PAGE, '--confidential'], { cwd: p, env: NOGLOBAL, token: '' });
  assert.equal(again.code, 0, again.stderr);
  assert.equal(fake.requests.length, 0);
  const st = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: p, encoding: 'utf8', env: { ...process.env, ...NOGLOBAL } }).stdout;
  assert.deepEqual(st.trim().split('\n'), ['?? stardust/.gitignore'], st);
});
await check('--confidential checks where a swap parks the old capture: refused before anything moves; with the backup ignored, a swap cut short by an I/O error stays ignored and readable', async () => {
  reset();
  const lines = [...IGNORE_ALL.filter((l) => l !== '.work/'), '.work/reskin/figma/current.json', '.work/reskin/figma/*/latest.json', '.work/reskin/figma/*/v1/', '.work/reskin/figma/*/.staging/'];
  const p = withIgnore(gitProject(), lines);
  const args = ['capture', URL_FILE, '--frames', '1:2', '--confidential'];
  assert.equal((await run(args, { cwd: p, env: NOGLOBAL })).code, 0);
  const work = join(p, 'stardust', '.work');
  const root = join(work, 'reskin', 'figma', KEY);
  const before = hashTree(work);
  reset();
  const refused = await run([...args, '--refresh'], { cwd: p, env: NOGLOBAL });
  assert.equal(refused.code, 2, refused.stderr);
  assert.match(refused.stderr, /stardust\/\.work\/reskin\/figma\/AbCdEf1234567890\/\.prev\/v1\/nodes\.json/);
  assert.deepEqual(hashTree(work), before, 'nothing written or moved');
  assert.deepEqual(apiCalls().map((c) => c.path), [`/v1/files/${KEY}`]);

  // The same refresh with the backup ignored, in-process, with an I/O error on both renames after the first.
  withIgnore(p, [...lines, '.work/reskin/figma/*/.prev/']);
  const { runCapture } = await import('../figma/capture.mjs');
  const { createClient } = await import('../figma/client.mjs');
  const { cacheFor } = await import('../figma/cache.mjs');
  const realRename = fs.renameSync;
  const here = process.cwd();
  Object.assign(process.env, NOGLOBAL);
  process.chdir(p);
  fs.renameSync = (from, to) => {
    if (/\/\.(staging|prev)\/[^/]+$/.test(String(from))) throw Object.assign(new Error(`EIO: i/o error, rename '${from}'`), { code: 'EIO' });
    return realRename(from, to);
  };
  syncBuiltinESMExports();
  reset();
  try {
    await assert.rejects(runCapture({ url: URL_FILE, frames: ['1:2'], refresh: true, confidential: true, dir: 'stardust', client: createClient({ token: TOKEN, base: fake.base }), warn: () => {} }), /EIO/);
  } finally {
    fs.renameSync = realRename;
    syncBuiltinESMExports();
    process.chdir(here);
    for (const k of Object.keys(NOGLOBAL)) delete process.env[k];
  }
  assert.ok(existsSync(join(root, '.prev', 'v1', 'nodes.json')) && !existsSync(join(root, 'v1')), 'the old capture is parked');
  const gitEnv = { ...process.env, ...NOGLOBAL };
  assert.equal(spawnSync('git', ['check-ignore', '-q', `stardust/.work/reskin/figma/${KEY}/.prev/v1/nodes.json`], { cwd: p, env: gitEnv }).status, 0, 'and ignored');
  const st = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: p, encoding: 'utf8', env: gitEnv }).stdout;
  assert.deepEqual(st.trim().split('\n'), ['?? stardust/.gitignore'], st);
  assert.deepEqual(cacheFor(join(p, 'stardust'), KEY).version('v1').read('manifest.json').frames, ['1:2'], 'readers get it from the backup');
  reset();
  const back = await run(args, { cwd: p, env: NOGLOBAL, token: '' });
  assert.equal(back.code, 0, back.stderr);
  assert.equal(fake.requests.length, 0);
  assert.ok(existsSync(join(root, 'v1', 'manifest.json')) && !existsSync(join(root, '.prev')), 'the next capture puts it back');
});
await check('curate and stamp read the last complete capture while a swap is cut short (version dir parked in .prev); the next capture puts it back', async () => {
  const p = await curated();
  const root = join(p, 'stardust', '.work', 'reskin', 'figma', KEY);
  const outputs = () => ({ ...hashTree(join(p, 'stardust', 'reskin')), ...hashTree(join(p, 'stardust', 'canon-source')) });
  const before = outputs();
  mkdirSync(join(root, '.prev'), { recursive: true });
  renameSync(join(root, 'v1'), join(root, '.prev', 'v1'));
  const cur = await run(['curate'], { cwd: p, token: '' });
  assert.equal(cur.code, 0, cur.stderr);
  assert.deepEqual(outputs(), before);
  const stamp = await run(['stamp'], { cwd: p, token: '' });
  assert.equal(stamp.code, 0, stamp.stderr);
  assert.ok(!existsSync(join(root, 'v1')), 'reading moves nothing');
  const cap = await run(['capture', URL_PAGE], { cwd: p, token: '' });
  assert.equal(cap.code, 0, cap.stderr);
  assert.ok(existsSync(join(root, 'v1', 'manifest.json')) && !existsSync(join(root, '.prev')));
});
await check('capture --list --confidential needs no ignore rules and writes nothing', async () => {
  reset();
  const p = gitProject();
  const r = await run(['capture', URL_FILE, '--list', '--confidential'], { cwd: p, env: NOGLOBAL });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /2 pages, 3 top-level nodes/);
  assert.deepEqual(untouched(p), []);
});
await check('every file capture and curate write is covered by the --confidential guard lists', async () => {
  const { CAPTURE_NAMESPACES, CAPTURE_OUTPUTS, CURATE_OUTPUTS } = await import('../figma/guard.mjs');
  const root = join(P1, 'stardust');
  const listed = new Set([...CAPTURE_OUTPUTS, ...CURATE_OUTPUTS].map(([rel]) => rel));
  const files = walk(root).map((f) => relative(root, f));
  assert.ok(files.length > 20, `${files.length} files`);
  for (const f of files) assert.ok(listed.has(f) || CAPTURE_NAMESPACES.some(([ns]) => f.startsWith(ns)), `${f} escapes the guard`);
});
await check('--confidential outside a git repo → exit 2', async () => {
  reset();
  const r = await run(['capture', URL_PAGE, '--confidential'], { cwd: project(), env: { ...NOGLOBAL, GIT_CEILING_DIRECTORIES: scratch } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /git repository/);
  assert.equal(fake.requests.length, 0);
});
await check('canary: FIGMA_TOKEN=canary-<random> across capture, curate, stamp (success, 401 and 429 paths) appears in no stdout, stderr or file under the project', async () => {
  const CANARY = `canary-${randomBytes(10).toString('hex')}`;
  const cfake = await startFakeFigma({ fixtureDir: KIT, token: CANARY, behaviors: {} });
  const seen = [];
  const go = async (args, cwd, extra = {}) => { const r = await run(args, { cwd, token: CANARY, env: { FIGMA_API_BASE: cfake.base, ...extra } }); seen.push(r.stdout, r.stderr); return r; };
  const ok = project();
  cpSync(PHRASE, join(ok, 'stardust'), { recursive: true });
  assert.equal((await go(['capture', URL_PAGE], ok)).code, 0);
  mkdirSync(join(ok, 'stardust', 'reskin'), { recursive: true });
  cpSync(join(KIT, 'curation-rules.json'), join(ok, 'stardust', 'reskin', 'curation-rules.json'));
  assert.equal((await go(['curate'], ok)).code, 0);
  assert.equal((await go(['stamp'], ok)).code, 0);
  cfake.behaviors[`/v1/files/${KEY}`] = { status: 401, body: { status: 401, err: `token ${CANARY} is expired` } };
  const denied = project();
  assert.equal((await go(['capture', URL_PAGE], denied)).code, 3);
  delete cfake.behaviors[`/v1/files/${KEY}`];
  cfake.behaviors[`/v1/images/${KEY}`] = { status: 429, headers: { 'retry-after': '9999' }, body: { status: 429, err: `limit for ${CANARY}` } };
  const limited = project();
  assert.equal((await go(['capture', URL_PAGE], limited)).code, 3);
  await cfake.close();
  assert.ok(seen.every((s) => !s.includes(CANARY)), 'canary in output');
  for (const p of [ok, denied, limited]) for (const f of walk(p)) assert.ok(!readFileSync(f).toString('latin1').includes(CANARY), `canary in ${relative(p, f)}`);
  assert.ok(cfake.requests.some((r) => r.headers['x-figma-token'] === CANARY), 'the canary was sent to the API');
});

await check('stamp refuses DESIGN files curate did not write for this capture', async () => {
  const p = join(P2, 'stardust', 'canon-source', 'DESIGN.json');
  const good = readFileSync(p);
  const d = JSON.parse(good); d.generatedAt = '2020-01-01T00:00:00Z'; d._provenance.writtenBy = 'stardust:extract';
  writeFileSync(p, JSON.stringify(d));
  const r = await run(['stamp'], { cwd: P2, token: '' });
  writeFileSync(p, good);
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /not written by curate for this capture.*stardust:extract/);
});
await check('e2e: extract fixture → capture → curate → stamp leaves everything reskin Phase 1 and direct need', async () => {
  const t = json(join(P2, 'stardust', 'reskin', 'donor-tokens.json'));
  const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
  const PROBES = ['palette.pageBg', 'palette.bodyFg', 'palette.headingFg', 'type.family', 'type.body.fontSize', 'type.display.fontWeight', 'buttons.primary.background', 'buttons.primary.color', 'buttons.primary.borderRadius', 'buttons.primary.padding', 'buttons.primary.fontSize', 'layout.containerMaxWidth', 'layout.sectionPaddingY'];
  for (const p of PROBES) assert.ok(typeof get(t, p) === 'string' || t.coverage.absent.some((a) => a.path === p), p);
  for (const f of ['reskin/donor-modules.md', 'canon-source/DESIGN.md', 'canon-source/DESIGN.json', 'canon-source/_brand-extraction.json', 'canon-source/assets/screenshots/home.png']) assert.ok(existsSync(join(P2, 'stardust', f)), f);
  const s = json(join(P2, 'stardust', 'state.json'));
  assert.equal(s.designSource.path, 'stardust/canon-source/');
  assert.ok(s.designSource.url.startsWith('https://www.figma.com/design/'));
  for (const script of [SCRIPT, join(P2, 'stardust', 'scripts', 'reskin', 'figma-donor.mjs')]) {
    const r = spawnSync(process.execPath, [script, '--help'], { cwd: P2, encoding: 'utf8' });
    assert.equal(r.status, 0, script);
    assert.match(r.stdout, /Usage:/);
  }
});

await check('a copy without the figma/ helpers: --help still answers; a command exits 2 naming cp -R', async () => {
  const lone = join(scratch, 'lone');
  mkdirSync(lone, { recursive: true });
  cpSync(SCRIPT, join(lone, 'figma-donor.mjs'));
  const help = await new Promise((resolve) => { const c = spawn(process.execPath, [join(lone, 'figma-donor.mjs'), '--help'], { cwd: lone }); c.on('close', resolve); });
  assert.equal(help, 0);
  const r = await new Promise((resolve) => {
    const c = spawn(process.execPath, [join(lone, 'figma-donor.mjs'), 'capture', URL_PAGE], { cwd: lone });
    let err = ''; c.stderr.on('data', (d) => { err += d; }); c.on('close', (code) => resolve({ code, err }));
  });
  assert.equal(r.code, 2);
  assert.match(r.err, /cp -R/);
  rmSync(lone, { recursive: true, force: true });
});
await check('signed image URLs and the token appear in no written file and no output', () => {
  const ours = /\/stardust\/(canon-source|reskin|\.work)\/|\/stardust\/state\.json$/;
  const files = walk(scratch).filter((f) => ours.test(f));
  assert.ok(files.length > 20, `scanned ${files.length} files`);
  for (const f of files) {
    const s = readFileSync(f).toString('latin1');
    assert.ok(!s.includes('X-Amz-Signature') && !s.includes('fixture-signature') && !s.includes('/img/'), `signed URL in ${relative(scratch, f)}`);
    assert.ok(!s.includes(TOKEN), `token in ${relative(scratch, f)}`);
  }
  assert.ok(outputs.every((o) => !o.includes(TOKEN)));
});

await fake.close();
rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
