#!/usr/bin/env node
// skills/stardust/scripts/test/decide.test.mjs — the decide.mjs contract: stable hashing, battery
// loading and listing, criteriaFrom / appendNone / metadata stripping / API-limit validation in
// buildQuestions, routing thresholds (act / review / escalate, noul yes / no / review, noneIs,
// weakest), the CLI (--help before I/O, batteries, --dry-run touches nothing, --decider off exits 3,
// no key exits 3, usage exits 2), and the network path against a local fake endpoint: answers +
// cache + ledger on the first call, cached:true on the second, a 429 then 200 retried, a 400 as
// exit 4, a 401 as exit 3. No real API is called. Run: node <this file>.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildQuestions, cacheKey, createClient, decide, getPath, listBatteries, loadBattery, route, stable } from '../decide.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'decide.mjs');
const BATTERIES = join(HERE, '..', 'batteries');
const root = mkdtempSync(join(tmpdir(), 'decide-test-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const run = (args, env = {}, cwd = root) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd, env: { ...process.env, TYPESAFE_API_KEY: '', STARDUST_DECIDER: '', ...env } }); return { code: r.status, out: r.stdout, err: r.stderr }; };

await check('stable() sorts keys so equal objects hash equal', () => {
  assert.equal(stable({ b: 1, a: [1, { d: 2, c: 3 }] }), stable({ a: [1, { c: 3, d: 2 }], b: 1 }));
  assert.equal(cacheKey('m', { x: 1 }, { q: 1 }), cacheKey('m', { x: 1 }, { q: 1 }));
  assert.notEqual(cacheKey('m', { x: 1 }, { q: 1 }), cacheKey('m2', { x: 1 }, { q: 1 }));
});

await check('getPath walks dotted paths', () => {
  assert.equal(getPath({ a: { b: [10, 20] } }, 'a.b.1'), 20);
  assert.equal(getPath({ a: 1 }, 'a.b.c'), undefined);
});

await check('every shipped battery loads, lists, routes and has instructions', () => {
  const list = listBatteries(BATTERIES);
  assert.ok(list.length >= 9, `expected ≥ 9 batteries, got ${list.length}`);
  for (const b of list) {
    assert.ok(!b.error, `${b.name}: ${b.error}`);
    const full = loadBattery(b.name, BATTERIES);
    assert.ok(full.route && Object.keys(full.route).length, `${b.name} has no route`);
    for (const [id, q] of Object.entries(full.questions)) assert.ok(q.instructions, `${b.name}.${id} lacks instructions`);
    for (const id of Object.keys(full.route)) assert.ok(full.questions[id], `${b.name} routes unknown question ${id}`);
  }
});

await check('buildQuestions fills criteriaFrom (array and object), appends none, strips metadata', () => {
  const battery = { name: 't', questions: { t: { type: 'choice', instructions: 'which', criteriaFrom: 'types', appendNone: { none: 'no fit' }, notes: 'drop me' }, u: { type: 'choice', instructions: 'which', criteriaFrom: 'reg' }, s: { type: 'score', instructions: 'how', criteriaFrom: 'levels' }, n: { type: 'noul', instructions: 'is', criteria: { true: 'y', false: 'n' } } } };
  const q = buildQuestions(battery, { types: ['a', 'b'], reg: { hero: 'lead', cards: 'units' }, levels: ['lo', 'hi'] });
  assert.deepEqual(q.t, { type: 'choice', instructions: 'which', criteria: { a: null, b: null, none: 'no fit' } });
  assert.deepEqual(q.u.criteria, { hero: 'lead', cards: 'units' });
  assert.deepEqual(q.s.criteria, ['lo', 'hi']);
  assert.deepEqual(q.n, { type: 'noul', instructions: 'is', criteria: { true: 'y', false: 'n' } });
  assert.equal('notes' in q.t, false);
});

await check('buildQuestions enforces the API limits and required fields', () => {
  const mk = (questions) => () => buildQuestions({ name: 't', questions }, { many: Array.from({ length: 256 }, (_, i) => `o${i}`), one: ['solo'] });
  assert.throws(mk({ x: { type: 'choice', instructions: 'q', criteriaFrom: 'many' } }), /at most 255/);
  assert.throws(mk({ x: { type: 'choice', instructions: 'q', criteriaFrom: 'one' } }), /at least 2/);
  assert.throws(mk({ x: { type: 'score', instructions: 'q', criteria: ['only'] } }), /2 to 10/);
  assert.throws(mk({ x: { type: 'rank', instructions: 'q' } }), /type must be/);
  assert.throws(mk({ x: { type: 'noul' } }), /instructions/);
  assert.throws(mk({ x: { type: 'choice', instructions: 'q', criteriaFrom: 'missing' } }), /missing from the state/);
});

await check('route: thresholds, noneIs, noul yes/no/review, overall = worst, weakest named', () => {
  const battery = { route: { c: { confident: 0.8, review: 0.5, noneIs: 'none' }, n: { yes: 0.8, no: 0.2 }, s: { confident: 0.7, review: 0.4 } } };
  let r = route(battery, { c: { type: 'choice', choice: 'a', confidence: 0.95 }, n: { type: 'noul', noul: 0.9 }, s: { type: 'score', score: 1.9, confidence: 0.8 } });
  assert.equal(r.overall, 'act'); assert.equal(r.questions.n.verdict, 'yes');
  r = route(battery, { c: { type: 'choice', choice: 'none', confidence: 0.95 }, n: { type: 'noul', noul: 0.05 }, s: { type: 'score', score: 0.2, confidence: 0.9 } });
  assert.equal(r.questions.c.verdict, 'review', 'noneIs turns act into review'); assert.equal(r.questions.n.verdict, 'no'); assert.equal(r.overall, 'review');
  r = route(battery, { c: { type: 'choice', choice: 'a', confidence: 0.3 }, n: { type: 'noul', noul: 0.5 }, s: { type: 'score', score: 1, confidence: 0.6 } });
  assert.equal(r.questions.c.verdict, 'escalate'); assert.equal(r.questions.n.verdict, 'review'); assert.equal(r.questions.s.verdict, 'review'); assert.equal(r.overall, 'escalate');
  assert.equal(r.weakest.question, 'c');
  r = route(battery, { c: { type: 'choice', choice: 'a', confidence: 0.9 } });
  assert.equal(r.overall, 'escalate', 'a missing routed answer escalates');
});

await check('CLI: --help exits 0 with usage before any I/O', () => {
  const r = run(['--help']); assert.equal(r.code, 0); assert.match(r.out, /decide\.mjs/); assert.match(r.out, /Exit codes/);
  assert.deepEqual(readdirSync(root), []);
});

await check('CLI: batteries lists the shipped files', () => {
  const r = run(['batteries']); assert.equal(r.code, 0); assert.match(r.out, /page-type\s+v1/); assert.match(r.out, /section-alignment/);
});

await check('CLI: --dry-run prints the built request and touches nothing', () => {
  writeFileSync(join(root, 'state.json'), JSON.stringify({ page: { path: '/x' }, types: ['a', 'b'] }));
  const r = run(['page-type', '--state', 'state.json', '--dry-run']);
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out); assert.deepEqual(Object.keys(j.questions.type.criteria), ['a', 'b', 'none']);
  assert.deepEqual(readdirSync(root), ['state.json']);
});

await check('CLI: --decider off exits 3 with a marker; no key exits 3', () => {
  let r = run(['page-type', '--state', 'state.json', '--decider', 'off']); assert.equal(r.code, 3); assert.match(r.out, /"decider":"off"/);
  r = run(['page-type', '--state', 'state.json'], { STARDUST_DECIDER: 'off' }); assert.equal(r.code, 3);
  r = run(['page-type', '--state', 'state.json']); assert.equal(r.code, 3); assert.match(r.err, /no key/);
});

await check('CLI: usage errors exit 2', () => {
  assert.equal(run(['nope-battery', '--state', 'state.json']).code, 2);
  assert.equal(run(['page-type']).code, 2);
  assert.equal(run(['page-type', '--state']).code, 2);
  assert.equal(run(['page-type', '--state', 'state.json', '--bogus']).code, 2);
});

// A fake endpoint: first call 429, then 200 with canned answers; a state with `fail400` → 400; wrong key → 401.
let calls = 0;
const canned = { model: 'jev-9.9.9', answers: { type: { type: 'choice', choice: 'a', confidence: 0.93, probabilities: { a: 0.95, b: 0.05, none: 0 } }, locale_shell: { type: 'noul', noul: 0.04 } }, usage: { input_tokens: 100, output_tokens: 5 } };
const server = createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
    calls += 1;
    if (req.headers.authorization !== 'Bearer test-key') { res.writeHead(401); res.end('{"error":"auth"}'); return; }
    if (body.includes('fail400')) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"bad"}'); return; }
    if (calls === 1) { res.writeHead(429, { 'retry-after': '0' }); res.end('slow down'); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(canned));
  });
});
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const endpoint = `http://127.0.0.1:${server.address().port}/v1/systemone`;

await check('library: decide answers, routes, caches and ledgers; second call is a cache hit', async () => {
  const battery = loadBattery('page-type', BATTERIES);
  const client = createClient({ key: 'test-key', endpoint, backoffMs: 1, retries: 3 });
  const state = { page: { path: '/x' }, types: ['a', 'b'] };
  const cacheDir = join(root, 'cache'); const ledger = join(root, 'decisions.jsonl');
  const r1 = await decide({ battery, state, client, cacheDir, ledger, ref: 'x' });
  assert.equal(r1.cached, false); assert.equal(r1.model, 'jev-9.9.9'); assert.equal(r1.answers.type.choice, 'a'); assert.equal(r1.route.overall, 'act');
  assert.equal(calls, 2, 'one 429 then one 200');
  assert.equal(readdirSync(cacheDir).length, 1);
  const r2 = await decide({ battery, state, client, cacheDir, ledger, ref: 'x' });
  assert.equal(r2.cached, true); assert.equal(calls, 2);
  const lines = readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2); assert.equal(lines[0].battery, 'page-type'); assert.ok(lines[0].answers.type.probabilities, 'full probabilities kept'); assert.ok(lines[0].stateSha);
});

await check('library: a 400 surfaces as exitCode 4 without retries; a 401 as 3', async () => {
  const battery = loadBattery('page-type', BATTERIES);
  const before = calls;
  await assert.rejects(decide({ battery, state: { page: { path: 'fail400' }, types: ['a', 'b'] }, client: createClient({ key: 'test-key', endpoint, backoffMs: 1 }), cacheDir: null, ledger: null }), (e) => e.exitCode === 4 && /HTTP 400/.test(e.message));
  assert.equal(calls, before + 1, 'no retry on 400');
  await assert.rejects(decide({ battery, state: { page: {}, types: ['a', 'b'] }, client: createClient({ key: 'wrong', endpoint, backoffMs: 1 }), cacheDir: null, ledger: null }), (e) => e.exitCode === 3);
});

await check('CLI: end to end against the fake endpoint writes cache + ledger under the cwd defaults', async () => {
  // async spawn: a spawnSync here would block the event loop the fake server runs on.
  const cwd = join(root, 'proj'); mkdirSync(cwd, { recursive: true });
  writeFileSync(join(root, 'state2.json'), JSON.stringify({ page: { path: '/y' }, types: ['a', 'b'] }));
  const r = await new Promise((resolve) => { execFile(process.execPath, [SCRIPT, 'page-type', '--state', join(root, 'state2.json'), '--endpoint', endpoint, '--backoff-ms', '1', '--ref', 'y'], { cwd, encoding: 'utf8', timeout: 20000, env: { ...process.env, TYPESAFE_API_KEY: 'test-key', STARDUST_DECIDER: '' } }, (err, out, errOut) => resolve({ code: err ? err.code : 0, out, err: errOut })); });
  assert.equal(r.code, 0, r.err); const j = JSON.parse(r.out); assert.equal(j.route.overall, 'act'); assert.equal(j.ref, 'y');
  assert.ok(existsSync(join(cwd, 'stardust', 'decisions.jsonl'))); assert.ok(existsSync(join(cwd, 'stardust', '.work', 'decide')));
});

server.close();
rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
