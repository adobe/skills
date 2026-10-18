#!/usr/bin/env node
// skills/reskin/scripts/test/figma-gate.test.mjs — the figma-gate.mjs CLI: --help from an empty cwd
// (exit 0, usage, nothing written), usage errors (exit 2), the boxes subcommand (every included module,
// one root's outline, served from the box cache once nodes.json is gone), a project without a capture
// (exit 2 naming figma-donor.mjs capture), the --confidential guard, and `all` (evidence, summary.json and
// the ledger fragment; the page parts need playwright, pngjs and pixelmatch; those cases build their own
// projects and run at most four at a time). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeCurrent } from '../figma/cache.mjs';
import { main } from '../figma-gate.mjs';
import { VERDICT_RE } from '../../../replica/scripts/run-bg.mjs';
import { makeProject, KEY, VERSION } from './fixtures/figma-gate/setup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'figma-gate.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'figma-gate-cli-'));
let failed = 0;
const report = (name, e) => {
  if (!e) { console.log(`✓ ${name}`); return; }
  failed += 1;
  console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`);
};
const check = (name, fn) => { try { fn(); report(name); } catch (e) { report(name, e); } };
const acheck = async (name, fn) => { try { await fn(); report(name); } catch (e) { report(name, e); } };
// The page cases each build their own project, so they run at most CONCURRENCY at a time; their results
// print in the order the cases are written.
const CONCURRENCY = 4;
const queued = [];
const queue = (name, fn) => { queued.push({ name, fn, result: null }); };
const runQueued = async () => {
  let next = 0;
  let printed = 0;
  const flush = () => { while (printed < queued.length && queued[printed].result) { report(queued[printed].name, queued[printed].result.error); printed += 1; } };
  const worker = async () => {
    while (next < queued.length) {
      const c = queued[next++];
      c.result = await c.fn().then(() => ({}), (error) => ({ error: error ?? new Error('rejected without a reason') }));
      flush();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queued.length) }, worker));
};
const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
const run = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
const runAsync = (args, cwd) => new Promise((resolve) => {
  const child = spawn(process.execPath, [SCRIPT, ...args], { cwd });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});
let n = 0;
const project = () => { n += 1; return makeProject(join(scratch, `p${n}`)); };

check('--help from an empty cwd: exit 0, usage, nothing written', () => {
  const cwd = join(scratch, 'empty');
  mkdirSync(cwd);
  const r = run(['--help'], cwd);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /usage/i);
  for (const s of ['boxes', '--module', '--node', '--depth', '--dir', 'Exit codes', '124']) assert.ok(r.stdout.includes(s), `help lacks ${s}`);
  assert.deepEqual(walk(cwd), []);
});

check('--help: run-bg is called as run-bg.mjs with its job name positional, and the line filter claim matches the lines printed', () => {
  const r = run(['--help'], join(scratch, 'empty'));
  assert.ok(r.stdout.includes('run-bg.mjs wait figma-<slug> --dir stardust/.work/reskin/bg'), 'wait takes the job name positionally');
  assert.ok(!/wait --name/.test(r.stdout));
  for (const doc of ['SKILL.md', join('reference', 'gates.md')]) assert.ok(!/run-bg\.mjs wait --name/.test(readFileSync(join(HERE, '..', '..', doc), 'utf8')), doc);
});

check('every setup hint in figma-gate installs to keep: no --no-save (a later npm i prunes it, reskin Setup step 2)', () => {
  const sources = [SCRIPT, ...walk(join(HERE, '..', 'figma-gate'))].filter((p) => p.endsWith('.mjs'));
  const offenders = sources.filter((p) => readFileSync(p, 'utf8').includes('--no-save')).map((p) => p.slice(join(HERE, '..').length + 1));
  assert.deepEqual(offenders, []);
});

check('an unknown subcommand, no subcommand and boxes --module without a value exit 2', () => {
  const cwd = join(scratch, 'empty');
  assert.equal(run(['frobnicate'], cwd).status, 2);
  assert.equal(run([], cwd).status, 2);
  const r = run(['boxes', '--module'], cwd);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--module needs a value/);
  assert.equal(run(['boxes', '--module', '--depth', '1'], cwd).status, 2);
  assert.equal(run(['boxes', '--module', 'M1', '--node', '1:7'], cwd).status, 2);
  assert.equal(run(['boxes', '--depth', 'x'], cwd).status, 2);
});

check('boxes: one line per included module; --module and --node print an outline', () => {
  const p = project();
  const all = run(['boxes'], p.root);
  assert.equal(all.status, 0, all.stderr);
  const lines = all.stdout.trim().split('\n');
  assert.deepEqual(lines.map((l) => l.split(' ')[0]), ['M1', 'M2', 'M3', 'M4']);
  assert.ok(lines[0].startsWith('M1 1:3'), lines[0]);
  assert.ok(lines[1].startsWith('M2 1:7'), lines[1]);
  assert.equal(lines[1], 'M2 1:7 1440×800');
  assert.ok(existsSync(join(p.dir, '.work', 'reskin', 'gates', 'figma-boxes', KEY, `${VERSION}.json`)));
  const one = run(['boxes', '--module', 'M2', '--depth', '1'], p.root);
  assert.equal(one.status, 0, one.stderr);
  assert.equal(one.stdout.trim().split('\n')[0], '1:7 INSTANCE "Features" 0,0 1440×800 VERTICAL pad 80,120,80,120 gap 32');
  const node = run(['boxes', '--node', 'I1:7;5:7', '--depth', '0'], p.root);
  assert.equal(node.status, 0, node.stderr);
  assert.match(node.stdout, /^I1:7;5:7 FRAME "Card" 0,0 560×240 VERTICAL pad 24,24,24,24 gap 12/);
  const unknown = run(['boxes', '--module', 'M9'], p.root);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /M9/);
  const ghost = run(['boxes', '--node', '9:9'], p.root);
  assert.equal(ghost.status, 2);
  assert.match(ghost.stderr, /9:9/);
});

check('after nodes.json is deleted, boxes --module M2 --depth 1 is served from the box cache', () => {
  const p = project();
  assert.equal(run(['boxes'], p.root).status, 0);
  rmSync(join(p.dir, '.work', 'reskin', 'figma', KEY, VERSION, 'nodes.json'));
  const r = run(['boxes', '--module', 'M2', '--depth', '1'], p.root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^1:7 INSTANCE "Features"/);
});

check('a project without a capture exits 2 naming figma-donor.mjs capture and the API cost', () => {
  const p = project();
  rmSync(join(p.dir, '.work'), { recursive: true });
  const r = run(['boxes'], p.root);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /figma-donor\.mjs capture/);
  assert.match(r.stderr, /API calls/);
});

check('a project without curation-rules.json exits 2 naming the file', () => {
  const p = project();
  rmSync(join(p.dir, 'reskin', 'curation-rules.json'));
  const r = run(['boxes'], p.root);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /curation-rules\.json/);
});

check('--confidential (sticky) refuses, writing nothing, when .work/ is not git-ignored', () => {
  const p = project();
  spawnSync('git', ['init', '-q'], { cwd: p.root });
  writeCurrent(p.dir, KEY, VERSION, true);
  const r = run(['boxes'], p.root);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /\.work\//);
  assert.ok(!existsSync(join(p.dir, '.work', 'reskin', 'gates')));
  writeFileSync(join(p.dir, '.gitignore'), '.work/\nreskin/figma-checks/\n');
  const ok = run(['boxes'], p.root);
  assert.equal(ok.status, 0, ok.stderr);
});

const out = [];
let seen = null;
const code = await main(['boxes', '--module', 'M2'], { log: (m) => out.push(m), warn: () => {}, steps: { boxes: async (args) => { seen = args; return 7; } } });
check('main with steps.boxes replaced returns its code and passes dir and opts', () => {
  assert.equal(code, 7);
  assert.equal(seen.opts.module, 'M2');
  assert.equal(seen.dir, 'stardust');
});

check('--help lists every subcommand with its flags and the run-bg launch hint', () => {
  const r = run(['--help'], join(scratch, 'empty'));
  assert.equal(r.status, 0, r.stderr);
  for (const s of ['boxes', 'join', 'geometry', 'ramp', 'pixel', 'register', ' all ', '--page', '--url', '--dir', 'summary.json', 'ledgerFragment', 'waived', 'figma-preview', 'run-bg.mjs start --name figma-<slug> --dir stardust/.work/reskin/bg -- node']) assert.ok(r.stdout.includes(s), `help lacks ${s}`);
});

check('all without --page or --url exits 2', () => {
  assert.equal(run(['all', '--url', 'x.html'], scratch).status, 2);
  assert.equal(run(['all', '--page', 'home'], scratch).status, 2);
  assert.equal(run(['all', '--page', 'home', '--url'], scratch).status, 2);
});

const confidential = (p) => {
  spawnSync('git', ['init', '-q'], { cwd: p.root });
  writeCurrent(p.dir, KEY, VERSION, true);
};

check('all under --confidential without git-ignored .work/ and reskin/figma-checks/: exit 2, nothing written', () => {
  const p = project();
  confidential(p);
  const r = run(['all', '--page', p.slug, '--url', p.page, '--dir', p.dir], p.root);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /\.work\//);
  assert.match(r.stderr, /reskin\/figma-checks\//);
  assert.ok(!existsSync(join(p.dir, '.work', 'reskin', 'gates')));
});

await acheck('a step that throws a UsageError propagates (setup error), not CRASH', async () => {
  const p = project();
  await assert.rejects(
    main(['all', '--page', p.slug, '--url', p.page, '--dir', p.dir], { log: () => {}, warn: () => {}, steps: { ramp: async ({ UsageError }) => { throw new UsageError('bad checks'); } } }),
    /bad checks/,
  );
});

await acheck('a per-step subcommand that hits a bot challenge exits 3 (the error keeps its code)', async () => {
  const p = project();
  await assert.rejects(
    main(['geometry', '--page', p.slug, '--url', p.page, '--dir', p.dir], { log: () => {}, warn: () => {}, steps: { geometry: async () => { const e = new Error('challenge'); e.code = 3; throw e; } } }),
    (e) => e.code === 3,
  );
});

let playwrightOk = false;
let pngOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  all against page.html (playwright not importable here; run this test in an environment that has it)'); }
try { await import('pngjs'); await import('pixelmatch'); pngOk = true; } catch { console.log('skip  all against page.html (pngjs and pixelmatch are not importable here)'); }

if (playwrightOk && pngOk) {
  const { chromium } = await import('playwright');
  const { cacheFor } = await import('../figma/cache.mjs');
  const work = (p) => join(p.dir, '.work', 'reskin', 'gates', p.slug, 'figma');
  const summaryOf = (p) => JSON.parse(readFileSync(join(work(p), 'summary.json'), 'utf8'));
  const registerOf = (p) => JSON.parse(readFileSync(join(work(p), 'register.json'), 'utf8'));
  const runAll = (p, cwd = p.root) => runAsync(['all', '--page', p.slug, '--url', p.page, '--dir', p.dir], cwd);

  // The frame image: figma-frame.html drawn at 1440×1840, as M1 would cache it for frame 1:2.
  const withFrameImage = async (p) => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1840 } });
      await page.goto(pathToFileURL(join(p.root, 'figma-frame.html')).href);
      const v = cacheFor(p.dir, KEY).version(VERSION);
      mkdirSync(dirname(v.path('images/1-2.png')), { recursive: true });
      writeFileSync(v.path('images/1-2.png'), await page.screenshot());
      v.write('images.json', { '1:2': 'images/1-2.png' });
    } finally { await browser.close(); }
    return p;
  };
  const framed = async () => withFrameImage(project());
  const edit = (p, from, to) => writeFileSync(p.page, readFileSync(p.page, 'utf8').replace(from, to));
  const sectionsOf = (html) => [...html.matchAll(/ {2}<section[\s\S]*?<\/section>\n/g)].map((m) => m[0]);

  queue('all on page.html: join, geometry, ramp PASS, pixel advisory, register written; exit 0', async () => {
    const p = await framed();
    const r = await runAll(p);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const re of [/^PASS join/m, /^geometry PASS \d+\/\d+$/m, /^ramp PASS \d+\/\d+/m, /^pixel advisory/m, /^register written: /m]) assert.match(r.stdout, re);
    const s = summaryOf(p);
    assert.deepEqual(Object.keys(s), ['_provenance', 'page', 'url', 'regime', 'figma', 'steps', 'ledgerFragment', 'invocation']);
    assert.equal(s._provenance.writtenBy, 'stardust:reskin/figma-gate.mjs');
    assert.deepEqual([s.page, s.url, s.regime, s.figma], ['home', p.page, 'local', { version: VERSION }]);
    assert.deepEqual(Object.entries(s.steps).map(([k, v]) => [k, v.verdict, v.exit]), [['join', 'PASS', 0], ['geometry', 'PASS', 0], ['ramp', 'PASS', 0], ['pixel', 'advisory', 0], ['register', 'written', 0]]);
    assert.ok(Array.isArray(s.steps.geometry.detail));
    const f = s.ledgerFragment;
    assert.deepEqual(Object.keys(f), ['regime', 'figmaVersion', 'join', 'geometry', 'ramp', 'pixel', 'register', 'coverage', 'literals', 'invocation']);
    assert.deepEqual([f.regime, f.figmaVersion, f.join], ['local', VERSION, 'PASS']);
    assert.match(f.geometry, /^PASS (\d+)\/\1$/);
    assert.match(f.ramp, /^PASS (\d+)\/\1/);
    assert.match(f.pixel, /^s01 \d+\.\d\d%, s02 \d+\.\d\d%$/);
    assert.match(f.register, /^mandated 2 · waived 0 · unmandated 0 · out-of-kit 0 · conflict 0 · pre-existing 0$/);
    assert.equal(f.coverage, 'text styles 8/8 · widths 1440 · waived 0');
    assert.ok(Number.isInteger(f.literals));
    assert.equal(f.invocation, `figma-gate.mjs all --page home --url ${p.page} --dir ${p.dir}`);
    assert.equal(s.invocation, f.invocation);
    assert.ok(!JSON.stringify(s).includes(KEY), 'the summary carries the file key');
    assert.ok(r.stdout.includes(JSON.stringify(f, null, 2)), 'the fragment is printed');
    const lines = r.stdout.trimEnd().split('\n');
    assert.equal(lines.at(-1), join(p.dir, '.work', 'reskin', 'gates', 'home', 'figma', 'register.md'));
    assert.equal(r.stdout.split(lines.at(-1)).length, 2, 'the register path is printed once');
  });

  queue('all twice, nodes.json deleted in between: the second run is served from the box cache, exit 0', async () => {
    const p = await framed();
    assert.equal((await runAll(p)).status, 0);
    rmSync(cacheFor(p.dir, KEY).version(VERSION).path('nodes.json'));
    const r = await runAll(p);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  queue('.card { width: 540px }: geometry FAIL, exit 1, the fragment and register carry it', async () => {
    const p = await framed();
    edit(p, '.card { width: 560px;', '.card { width: 540px;');
    const r = await runAll(p);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^geometry FAIL 1\/\d+$/m);
    const s = summaryOf(p);
    assert.match(s.ledgerFragment.geometry, /^FAIL 1\/\d+$/);
    assert.deepEqual([s.steps.geometry.verdict, s.steps.geometry.exit, s.steps.ramp.verdict], ['FAIL', 1, 'PASS']);
    assert.equal(s.steps.register.verdict, 'written');
    assert.equal(registerOf(p).counts.unmandated, 1);
  });

  queue('swapped sections: join FAIL, geometry/ramp/pixel not run: section drift, register shows nothing mandated, exit 1', async () => {
    const p = await framed();
    const html = readFileSync(p.page, 'utf8');
    const [s1, s2] = sectionsOf(html);
    writeFileSync(p.page, html.replace(s1, '@@1@@').replace(s2, s1).replace('@@1@@', s2));
    const r = await runAll(p);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^FAIL join/m);
    assert.match(r.stdout, /section drift: s02 before s01/);
    for (const k of ['geometry', 'ramp', 'pixel']) assert.match(r.stdout, new RegExp(`^FAIL ${k} not run: section drift$`, 'm'));
    const s = summaryOf(p);
    assert.deepEqual(['geometry', 'ramp', 'pixel'].map((k) => s.steps[k].verdict), Array(3).fill('not run: section drift'));
    assert.deepEqual(['geometry', 'ramp', 'pixel', 'coverage'].map((k) => s.ledgerFragment[k]), Array(4).fill('not run: section drift'));
    assert.equal(s.ledgerFragment.join, 'FAIL');
    assert.equal(s.steps.register.verdict, 'written');
    const reg = registerOf(p);
    assert.equal(reg.counts.mandated, 0);
    assert.ok(reg.notRun.includes('join drift'));
    for (const f of ['geometry.json', 'ramp.json', 'pixel.json']) assert.ok(!existsSync(join(work(p), f)), f);
  });

  queue('all with a waiver in the checks file: the register has no mandated row for that section and a waived row with what it drops; the fragment counts the waiver', async () => {
    const p = await framed();
    const file = join(p.dir, 'reskin', 'figma-checks', 'home.json');
    const checksFile = JSON.parse(readFileSync(file, 'utf8'));
    checksFile.sections.s01.waive = [{ node: '1:6', why: 'lead copy is long-form' }];
    writeFileSync(file, JSON.stringify(checksFile));
    const r = await runAll(p);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const f = summaryOf(p).ledgerFragment;
    assert.equal(f.coverage, 'text styles 8/8 · widths 1440 · waived 1');
    assert.match(f.register, /^mandated 1 · waived 1 · unmandated 0 /);
    const rows = registerOf(p).rows;
    assert.deepEqual(rows.filter((x) => x.class === 'mandated').map((x) => x.slot), ['s02']);
    const w = rows.find((x) => x.class === 'waived');
    assert.deepEqual([w.slot, w.node, w.check], ['s01', '1:6', 'waive node "Lead" (1:6)']);
    assert.match(w.detail, /^"lead copy is long-form": drops 1 text style \(1 text node\) at 1440px/);
  });

  queue('a drifted run after a passing one never reuses the earlier step files', async () => {
    const p = await framed();
    assert.equal((await runAll(p)).status, 0);
    assert.ok(existsSync(join(work(p), 'pixel.json')));
    edit(p, 'data-slot="s02"', 'data-slot="s09"');
    const r = await runAll(p);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    for (const f of ['geometry.json', 'ramp.json', 'pixel.json']) assert.ok(!existsSync(join(work(p), f)), f);
    assert.equal(summaryOf(p).ledgerFragment.pixel, 'not run: section drift');
    assert.equal(registerOf(p).counts.mandated, 0);
  });

  queue('a step that throws is CRASH: <message>, the other steps still run, the exit is 124', async () => {
    const p = await framed();
    const out = [];
    const code = await main(['all', '--page', p.slug, '--url', p.page, '--dir', p.dir], { log: (m) => out.push(m), warn: () => {}, steps: { geometry: async () => { throw new Error('boom'); } } });
    assert.equal(code, 124);
    assert.ok(out.includes('ERROR (exit 124) geometry CRASH: boom'), out.join('\n'));
    assert.ok(out.filter((l) => /CRASH/.test(l)).every((l) => VERDICT_RE.test(l)), 'run-bg\'s default filter matches every CRASH line');
    const s = summaryOf(p);
    assert.deepEqual([s.steps.geometry.verdict, s.steps.geometry.exit, s.ledgerFragment.geometry], ['CRASH: boom', 124, 'CRASH: boom']);
    assert.equal(s.steps.ramp.verdict, 'PASS');
    assert.equal(s.steps.register.verdict, 'written');
  });

  queue('a step that throws code 3 (bot challenge): the other steps still run, the exit is 3, over a 124 and a 1', async () => {
    const p = await framed();
    edit(p, '.card { width: 560px;', '.card { width: 540px;');
    const challenge = async () => { const e = new Error('challenge'); e.code = 3; throw e; };
    const out = [];
    const code = await main(['all', '--page', p.slug, '--url', p.page, '--dir', p.dir], { log: (m) => out.push(m), warn: () => {}, steps: { geometry: challenge } });
    assert.equal(code, 3, out.join('\n'));
    assert.deepEqual([summaryOf(p).steps.geometry.exit, summaryOf(p).steps.ramp.verdict, summaryOf(p).steps.register.verdict], [3, 'PASS', 'written']);
    assert.match(summaryOf(p).ledgerFragment.geometry, /^CHALLENGE: challenge$/);
    assert.ok(out.includes('ERROR (exit 3) geometry CHALLENGE: challenge'), out.join('\n'));
    assert.ok(VERDICT_RE.test('ERROR (exit 3) geometry CHALLENGE: challenge'));
    const both = await main(['all', '--page', p.slug, '--url', p.page, '--dir', p.dir], { log: () => {}, warn: () => {}, steps: { geometry: challenge, pixel: async () => 124 } });
    assert.equal(both, 3, 'a 3 outranks a 124');
    const crashOnly = await main(['all', '--page', p.slug, '--url', p.page, '--dir', p.dir], { log: () => {}, warn: () => {}, steps: { pixel: async () => 124 } });
    assert.equal(crashOnly, 124);
  });

  queue('an earlier 1 does not hide a later 124: the exit is the first present of 2, 3, 124, 1, 0', async () => {
    const p = await framed();
    edit(p, '.card { width: 560px;', '.card { width: 540px;');
    const code = await main(['all', '--page', p.slug, '--url', p.page, '--dir', p.dir], { log: () => {}, warn: () => {}, steps: { pixel: async () => 124 } });
    assert.equal(code, 124);
    assert.equal(summaryOf(p).steps.pixel.verdict, 'no verdict');
    assert.equal(summaryOf(p).ledgerFragment.geometry.slice(0, 4), 'FAIL');
  });

  queue('all under --confidential with .work/ and reskin/figma-checks/ git-ignored runs, and no register row has a link', async () => {
    const p = await framed();
    confidential(p);
    writeFileSync(join(p.dir, '.gitignore'), '.work/\nreskin/figma-checks/\n');
    const r = await runAll(p);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const reg = registerOf(p);
    assert.ok(reg.rows.length > 0);
    assert.ok(reg.rows.every((x) => x.link === null));
    assert.ok(!JSON.stringify(summaryOf(p)).includes(KEY));
  });

  await runQueued();
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
