#!/usr/bin/env node
// skills/replica/scripts/test/sibling-variance.test.mjs — the sibling-variance.mjs contract. Part (a), no browser:
// the verdict split (MISSING → missing, EXTRA → extra, every other finding → deltas; `same` only without a finding),
// slug resolution (the roster by origin + pathname without trailing slash + search, `www.` folded; else the crawl
// slug rule), the sidecar's key order and slug order, merge (same archetype URL) vs replace, the more-than-half
// re-type advice, the atomic write; --help, a value flag without a value and a bare import — all without playwright,
// nothing written. Part (b): end-to-end against fixture pages served from this process — exit 2 and exit 0 write the
// sidecar (merged by slug), a page that fails to load (exit 1) writes nothing; runs only where playwright is
// importable from the scripts dir, prints a skip line otherwise.
// Run: node plugins/stardust/skills/replica/scripts/test/sibling-variance.test.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  compare, crawlSlug, mergeSidecar, readRoster, recordVariance, retypeAdvice, sidecarOf, slugFor, varianceAdvice, varianceLines, verdictOf,
} from '../sibling-variance.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'sibling-variance.mjs');
const root = mkdtempSync(join(tmpdir(), 'sibling-variance-test-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const freshDir = (name) => { const d = join(root, name); mkdirSync(d, { recursive: true }); return d; };
const run = (args, cwd) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const MIGRATE = 'node stardust/scripts/migrate/migrate.mjs';
const VARIANT = (t, d, n, slugs) => `${d} of ${n} sibling(s) of ${t} differ (${slugs.join(', ')}): a variant class on the template, not a new archetype — give the delta a variant class on the archetype's block, then: ${MIGRATE} render ${slugs.join(' ')} --accept-variance "<the delta and its variant class>" && ${slugs.map((x) => `${MIGRATE} variant ${x} <variant-class>`).join(' && ')}`;
const ADVICE = (t, d, n) => `more than half of ${t}'s siblings differ (${d} of ${n}): re-type the template — sub-archetypes by locale family or composition (state.mjs set --representative, then probe the new template), the re-typing recorded as a deviation; never a mechanical clone`;

// ---- (a) no browser ------------------------------------------------------------------------------------

await check('--help answers from an empty cwd with the new flags, the sidecar and the exit codes — nothing written', () => {
  const cwd = freshDir('help');
  const r = run(['--help'], cwd);
  assert.equal(r.code, 0, r.err);
  for (const re of [/--template <slug>/, /--state <file> .*stardust\/state\.json/, /--variance-dir <dir> .*stardust\/rollout\/variance/, /<variance-dir>\/<template>\.json/, /variance → <file> \(<s> same, <d> differ\)/, /Exit codes: 0 no variance, 2 variance found, 1 error or usage, 3 bot challenge\./]) assert.match(r.out, re);
  assert.deepEqual(readdirSync(cwd), []);
});

await check('importing the module has no side effect (no exit, no output, no file) and needs no playwright', () => {
  const cwd = freshDir('import');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(pathToFileURL(SCRIPT).href)}); console.log(typeof m.verdictOf, typeof m.compare)`], { encoding: 'utf8', cwd });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, 'function function\n'); assert.equal(r.stderr, '');
  assert.deepEqual(readdirSync(cwd), []);
});

await check('a value flag followed by nothing or by another --flag is a usage error naming the flag (exit 1), before any I/O', () => {
  const cwd = freshDir('usage');
  for (const [extra, flag] of [[['--template'], '--template'], [['--template', '--json'], '--template'], [['--state'], '--state'], [['--variance-dir', '--json'], '--variance-dir'], [['--main', '--probe', 'hero=.h'], '--main'], [['--probe'], '--probe'], [['--width', '--headed'], '--width']]) {
    const r = run(['https://example.test/a/', 'https://example.test/b/', ...extra], cwd);
    assert.equal(r.code, 1, `${extra.join(' ')}: exit ${r.code}`); assert.match(r.err, new RegExp(`^sibling-variance: ${flag} needs a value`), `${extra.join(' ')}: ${r.err.split('\n')[0]}`);
  }
  const bad = run(['https://example.test/a/', 'https://example.test/b/', '--template', '../x'], cwd);
  assert.equal(bad.code, 1); assert.match(bad.err, /--template "\.\.\/x" is not a file-safe slug/);
  assert.deepEqual(readdirSync(cwd), []);
});

// The probe output shape compare() reads: sections [{ label, h }], probes { name: { sel, count, first, clusters } }.
const sig = (o = {}) => ({ rect: { w: 1440, h: 528 }, backgroundLayers: [], backgroundColor: 'rgb(0, 0, 0)', color: 'rgb(255, 255, 255)', padding: '40px 24px 40px 24px', font: 'sans 16px/24px 400', borderRadius: '0px', heading: null, image: null, listStyle: null, before: null, ...o });
const archetypeProbe = {
  sections: [{ label: 'hero', h: 528 }, { label: 'body', h: 900 }],
  probes: { hero: { sel: '.hero', count: 1, first: sig(), clusters: 1 }, card: { sel: '.card', count: 3, first: sig({ rect: { w: 400, h: 300 } }), clusters: 1 }, badge: { sel: '.badge', count: 0 } },
};

await check('verdictOf: no finding → same; MISSING → missing, EXTRA → extra (probe names, sorted); everything else → deltas in report order', () => {
  assert.deepEqual(verdictOf([]), { verdict: 'same', missing: [], extra: [], deltas: [] });
  assert.deepEqual(verdictOf(compare(archetypeProbe, structuredClone(archetypeProbe), 2)), { verdict: 'same', missing: [], extra: [], deltas: [] });
  const within = structuredClone(archetypeProbe); within.probes.hero.first.rect.h = 530; within.sections[0].h = 530;
  assert.equal(verdictOf(compare(archetypeProbe, within, 2)).verdict, 'same', 'a delta within tolerance is no finding');
  const sib = structuredClone(archetypeProbe);
  sib.sections[0].h = 441; sib.probes.hero.first.rect.h = 441; sib.probes.card = { sel: '.card', count: 0 }; sib.probes.badge = { sel: '.badge', count: 2, first: sig(), clusters: 1 };
  const v = verdictOf(compare(archetypeProbe, sib, 2));
  assert.equal(v.verdict, 'differs'); assert.deepEqual(v.missing, ['card']); assert.deepEqual(v.extra, ['badge']);
  assert.deepEqual(v.deltas.map((d) => d.kind), ['SECTION HEIGHTS', 'PROBE']);
  assert.deepEqual(Object.keys(v.deltas[0]), ['kind', 'msg'], 'a finding without a probe has no probe key');
  assert.deepEqual(Object.keys(v.deltas[1]), ['kind', 'probe', 'msg']); assert.equal(v.deltas[1].probe, 'hero'); assert.match(v.deltas[1].msg, /rect\{h 528 → 441\}/);
  const all = verdictOf([
    { kind: 'SECTIONS', msg: 's' }, { kind: 'MISSING', probe: 'li', msg: 'm1' }, { kind: 'COUNT', probe: 'card', msg: 'c' }, { kind: 'CLUSTERS', probe: 'li', msg: 'k' },
    { kind: 'EXTRA', probe: 'badge', msg: 'e' }, { kind: 'MISSING', probe: 'aside', msg: 'm2' }, { kind: 'PROBE', probe: 'hero', msg: 'p' }, { kind: 'SECTION HEIGHTS', msg: 'h' },
  ]);
  assert.deepEqual(all, {
    verdict: 'differs', missing: ['aside', 'li'], extra: ['badge'],
    deltas: [{ kind: 'SECTIONS', msg: 's' }, { kind: 'COUNT', probe: 'card', msg: 'c' }, { kind: 'CLUSTERS', probe: 'li', msg: 'k' }, { kind: 'PROBE', probe: 'hero', msg: 'p' }, { kind: 'SECTION HEIGHTS', msg: 'h' }],
  });
});

await check('slugFor: the roster slug by origin + pathname without trailing slash + search (www. folded, fragment ignored), else the crawl slug rule', () => {
  const pages = [
    { slug: 'bali-tour', url: 'https://www.example.test/tours/bali/' },
    { slug: 'p-a2-1f3c', url: 'https://example.test/p?a=2' },
    { slug: 'home', url: 'https://example.test/' },
    { slug: 'no-url' },
  ];
  assert.equal(slugFor('https://example.test/tours/bali', pages), 'bali-tour');
  assert.equal(slugFor('https://www.example.test/tours/bali/#top', pages), 'bali-tour');
  assert.equal(slugFor('https://example.test/p?a=2', pages), 'p-a2-1f3c');
  assert.equal(slugFor('https://example.test/p?a=1', pages), 'p', 'another query is another page: crawl slug rule');
  assert.equal(slugFor('https://www.example.test', pages), 'home');
  assert.equal(slugFor('http://example.test/tours/bali/', pages), 'tours-bali', 'another origin is not the roster page');
  assert.equal(slugFor('https://example.test/About_Us/Team.html', pages), 'about-us-team-html');
  assert.equal(slugFor('https://example.test/', []), 'index');
  assert.equal(slugFor('https://example.test/de/x/', null), 'de-x');
  assert.equal(crawlSlug('https://example.test/a%20b/c.d/'), 'a-20b-c-d');
});

await check('readRoster: a missing default roster is a note (crawl slug rule); a missing --state, bad JSON or no pages[] is an error', () => {
  const dir = freshDir('roster');
  const none = readRoster(join(dir, 'state.json'), false);
  assert.deepEqual(none.pages, []); assert.match(none.note, /not found — slugs by the crawl slug rule/);
  assert.throws(() => readRoster(join(dir, 'state.json'), true), /--state .* not found/);
  writeFileSync(join(dir, 'bad.json'), '{'); assert.throws(() => readRoster(join(dir, 'bad.json')), /not valid JSON/);
  writeFileSync(join(dir, 'flat.json'), '{"pages":{}}'); assert.throws(() => readRoster(join(dir, 'flat.json')), /no pages\[\] array/);
  writeFileSync(join(dir, 'ok.json'), JSON.stringify({ pages: [{ slug: 'a', url: 'https://example.test/a' }] }));
  assert.deepEqual(readRoster(join(dir, 'ok.json')), { pages: [{ slug: 'a', url: 'https://example.test/a' }], note: null });
});

const ARCH = 'https://www.example.test/tours/bali/';
const differs = [{ kind: 'PROBE', probe: 'hero', msg: 'rect{h 528 → 441}' }];
const rowsOf = (spec) => spec.map(([slug, findings]) => ({ slug, url: `https://example.test/tours/${slug}/`, findings }));

await check('sidecarOf: key order template, archetype, at, siblings; sibling keys slug, url, verdict, missing, extra, deltas; siblings by slug', () => {
  const s = sidecarOf({ template: 'tours-bali', archetype: ARCH, at: '2026-01-01T00:00:00Z', rows: rowsOf([['utah', []], ['alps', differs], ['crete', [{ kind: 'MISSING', probe: 'card', msg: 'm' }]]]) });
  assert.deepEqual(Object.keys(s), ['template', 'archetype', 'at', 'siblings']);
  assert.deepEqual(s.siblings.map((r) => r.slug), ['alps', 'crete', 'utah']);
  for (const r of s.siblings) assert.deepEqual(Object.keys(r), ['slug', 'url', 'verdict', 'missing', 'extra', 'deltas']);
  assert.deepEqual(s.siblings[1], { slug: 'crete', url: 'https://example.test/tours/crete/', verdict: 'differs', missing: ['card'], extra: [], deltas: [] });
  assert.equal(s.siblings[2].verdict, 'same');
});

await check('mergeSidecar: the same archetype URL merges by slug (other slugs kept, re-probed slug replaced, at = now); another archetype URL replaces', () => {
  const prev = sidecarOf({ template: 'tours-bali', archetype: ARCH, at: '2026-01-01T00:00:00Z', rows: rowsOf([['alps', differs], ['crete', []], ['utah', differs]]) });
  const next = sidecarOf({ template: 'tours-bali', archetype: 'https://example.test/tours/bali', at: '2026-02-02T00:00:00Z', rows: rowsOf([['utah', []], ['zion', []]]) });
  const m = mergeSidecar(prev, next);
  assert.deepEqual(Object.keys(m), ['template', 'archetype', 'at', 'siblings']);
  assert.equal(m.at, '2026-02-02T00:00:00Z'); assert.equal(m.archetype, 'https://example.test/tours/bali');
  assert.deepEqual(m.siblings.map((r) => `${r.slug}:${r.verdict}`), ['alps:differs', 'crete:same', 'utah:same', 'zion:same']);
  const other = sidecarOf({ template: 'tours-bali', archetype: 'https://example.test/tours/java/', at: '2026-03-03T00:00:00Z', rows: rowsOf([['zion', []]]) });
  assert.equal(mergeSidecar(prev, other), other);
  assert.equal(mergeSidecar(null, next), next); assert.equal(mergeSidecar({ archetype: ARCH }, next), next, 'a file without siblings[] is replaced');
});

await check('mergeSidecar: an earlier row whose URL a new row probes again (a slug change) is dropped; the URL compares by roster key', () => {
  const prev = sidecarOf({ template: 'tours-bali', archetype: ARCH, at: '2026-01-01T00:00:00Z', rows: [{ slug: 'old-utah', url: 'https://www.example.test/tours/utah/', findings: differs }, ...rowsOf([['crete', []]])] });
  const next = sidecarOf({ template: 'tours-bali', archetype: ARCH, at: '2026-02-02T00:00:00Z', rows: [{ slug: 'utah', url: 'https://example.test/tours/utah', findings: [] }] });
  assert.deepEqual(mergeSidecar(prev, next).siblings.map((r) => `${r.slug}:${r.verdict}`), ['crete:same', 'utah:same']);
});

await check('retypeAdvice: more than half of the siblings differ → the re-type advice verbatim; exactly half or none → null', () => {
  const rows = (d, s) => [...Array(d).fill({ verdict: 'differs' }), ...Array(s).fill({ verdict: 'same' })];
  assert.equal(retypeAdvice(rows(3, 2), 'tours-bali'), ADVICE('tours-bali', 3, 5));
  assert.equal(retypeAdvice(rows(1, 0), 'tours-bali'), ADVICE('tours-bali', 1, 1));
  assert.equal(retypeAdvice(rows(2, 2), 'tours-bali'), null);
  assert.equal(retypeAdvice([], 'tours-bali'), null);
});

await check('varianceAdvice: a single differing sibling, or fewer than 20 % of them → the variant class with the exact render and variant commands, never a new archetype; 20 % to half → none; a majority → the re-type advice', () => {
  const rows = (d, s) => [...Array.from({ length: d }, (_, i) => ({ slug: `d${i + 1}`, verdict: 'differs' })), ...Array.from({ length: s }, (_, i) => ({ slug: `s${i + 1}`, verdict: 'same' }))];
  assert.equal(varianceAdvice(rows(1, 20), 'tours-bali'), VARIANT('tours-bali', 1, 21, ['d1']));
  assert.equal(varianceAdvice(rows(1, 1), 'tours-bali'), VARIANT('tours-bali', 1, 2, ['d1']), 'one of two is a single sibling, not a majority');
  assert.equal(varianceAdvice(rows(2, 9), 'tours-bali'), VARIANT('tours-bali', 2, 11, ['d1', 'd2']));
  for (const [d, n] of [[1, 21], [2, 11]]) assert.doesNotMatch(varianceAdvice(rows(d, n - d), 'tours-bali'), /re-type|--representative|sub-archetype/);
  assert.equal(varianceAdvice(rows(3, 7), 'tours-bali'), null); assert.equal(varianceAdvice(rows(2, 2), 'tours-bali'), null);
  assert.equal(varianceAdvice(rows(3, 2), 'tours-bali'), ADVICE('tours-bali', 3, 5)); assert.equal(varianceAdvice(rows(2, 1), 'tours-bali'), ADVICE('tours-bali', 2, 3));
  assert.equal(varianceAdvice(rows(1, 0), 'tours-bali'), VARIANT('tours-bali', 1, 1, ['d1']), 'the only sibling differing is a single sibling: a variant, never a re-type');
  assert.equal(varianceAdvice(rows(0, 4), 'tours-bali'), null); assert.equal(varianceAdvice([], 'tours-bali'), null);
});

await check('recordVariance: atomic 2-space JSON + newline, no temp left; same archetype → merged, another → replaced with a note; the printed lines', () => {
  const dir = join(freshDir('record'), 'stardust', 'rollout', 'variance');
  const file = join(dir, 'tours-bali.json');
  const r1 = recordVariance({ dir, template: 'tours-bali', archetype: ARCH, at: '2026-01-01T00:00:00Z', rows: rowsOf([['utah', []], ['alps', differs], ['crete', differs]]) });
  assert.equal(r1.file, file); assert.equal(r1.note, null);
  assert.equal(readFileSync(file, 'utf8'), `${JSON.stringify(r1.sidecar, null, 2)}\n`);
  assert.deepEqual(readdirSync(dir), ['tours-bali.json']);
  assert.deepEqual(varianceLines(r1), [`variance → ${file} (1 same, 2 differ)`, ADVICE('tours-bali', 2, 3)]);
  const r2 = recordVariance({ dir, template: 'tours-bali', archetype: 'https://example.test/tours/bali', at: '2026-02-02T00:00:00Z', rows: rowsOf([['alps', []], ['zion', []]]) });
  const onDisk = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(onDisk.siblings.map((r) => `${r.slug}:${r.verdict}`), ['alps:same', 'crete:differs', 'utah:same', 'zion:same']); assert.equal(onDisk.at, '2026-02-02T00:00:00Z');
  assert.deepEqual(varianceLines(r2), [`variance → ${file} (3 same, 1 differ)`, VARIANT('tours-bali', 1, 4, ['crete'])]);
  const r3 = recordVariance({ dir, template: 'tours-bali', archetype: 'https://example.test/tours/java/', at: '2026-03-03T00:00:00Z', rows: rowsOf([['zion', differs]]) });
  assert.match(r3.note, /held archetype https:\/\/example\.test\/tours\/bali — replaced$/);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).siblings.map((r) => r.slug), ['zion']);
  writeFileSync(file, 'not json');
  const r4 = recordVariance({ dir, template: 'tours-bali', archetype: ARCH, rows: rowsOf([['utah', []]]) });
  assert.match(r4.note, /held no readable sidecar — replaced$/); assert.match(r4.sidecar.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.deepEqual(readdirSync(dir), ['tours-bali.json']);
});

// ---- (b) end-to-end, where playwright resolves from the script's location ---------------------------------

const pwProbe = spawnSync(process.execPath, ['--input-type=module', '-e', "import('playwright').then(() => process.exit(0), () => process.exit(1))"], { cwd: dirname(SCRIPT) });
if (pwProbe.status !== 0) {
  console.log('- e2e: playwright not importable from the scripts dir — skipped (run the copy inside a project with playwright installed)');
} else {
  const pageHtml = (heroH) => `<!doctype html><html><body style="margin:0"><main><section class="hero" style="height:${heroH}px;background:#123;color:#fff"><h1>Tour</h1></section><section class="body" style="height:600px">${'<div class="card" style="width:300px;height:200px">c</div>'.repeat(3)}</section></main></body></html>`;
  const server = createServer((req, res) => {
    const html = { '/tours/bali/': pageHtml(528), '/tours/utah/': pageHtml(528), '/tours/alps/': pageHtml(441) }[req.url];
    res.writeHead(html ? 200 : 404, { 'content-type': 'text/html' }); res.end(html || 'not found');
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const runAsync = (args, cwd) => new Promise((done) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd }); let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => done({ code, out, err }));
  });
  const probes = ['--probe', 'hero=.hero', '--probe', 'card=.card'];
  const cwd = freshDir('e2e');
  const rel = 'stardust/rollout/variance/tours-bali.json';

  await check('e2e: variance found → exit 2 and the sidecar is written (slugs by the crawl slug rule), the variance line after the report', async () => {
    const r = await runAsync([`${base}/tours/bali/`, `${base}/tours/utah/`, `${base}/tours/alps/`, ...probes], cwd);
    assert.equal(r.code, 2, r.err);
    const s = JSON.parse(readFileSync(join(cwd, rel), 'utf8'));
    assert.equal(s.template, 'tours-bali'); assert.equal(s.archetype, `${base}/tours/bali/`);
    assert.deepEqual(s.siblings.map((x) => `${x.slug}:${x.verdict}`), ['tours-alps:differs', 'tours-utah:same']);
    assert.ok(s.siblings[0].deltas.some((d) => d.kind === 'PROBE' && d.probe === 'hero'), JSON.stringify(s.siblings[0].deltas));
    assert.ok(r.out.endsWith(`variance → stardust/rollout/variance/tours-bali.json (1 same, 1 differ)\n${VARIANT('tours-bali', 1, 2, ['tours-alps'])}\n`), r.out); assert.match(r.out, /✗ 1 of 2 sibling\(s\) vary/);
  });
  await check('e2e: no variance with --json → exit 0, stdout stays JSON, the sidecar is merged by slug and the variance line goes to stderr', async () => {
    const r = await runAsync([`${base}/tours/bali/`, `${base}/tours/utah/`, ...probes, '--json'], cwd);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).summary.varying, 0);
    assert.match(r.err, /^variance → stardust\/rollout\/variance\/tours-bali\.json \(1 same, 1 differ\)$/m);
    assert.deepEqual(JSON.parse(readFileSync(join(cwd, rel), 'utf8')).siblings.map((x) => x.slug), ['tours-alps', 'tours-utah']);
  });
  await check('e2e: more than half differ → the re-type advice; a page that fails to load → exit 1 and nothing written', async () => {
    const r = await runAsync([`${base}/tours/bali/`, `${base}/tours/alps/`, ...probes, '--template', 'bali', '--variance-dir', 'v'], cwd);
    assert.equal(r.code, 2, r.err); assert.ok(r.out.endsWith(`variance → v/bali.json (0 same, 1 differ)\n${VARIANT('bali', 1, 1, ['tours-alps'])}\n`), r.out);
    const failCwd = freshDir('e2e-fail');
    const f = await runAsync([`${base}/tours/bali/`, `${base}/tours/utah/`, `${base}/tours/gone/`, ...probes], failCwd);
    assert.equal(f.code, 1, f.err); assert.match(f.err, /HTTP 404/);
    assert.equal(existsSync(join(failCwd, 'stardust')), false, 'no sidecar on exit 1');
  });
  server.close();
}

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
