#!/usr/bin/env node
/**
 * Fixture test: deploy-page.mjs — the per-page chain (T27.6) against mock-da.mjs.
 * Run: node skills/deploy/scripts/test/deploy-page.test.mjs   (exit 1 on failure)
 *
 *   (a) one page listed → the localize write pass rewrites nav.html too and the chain appends it:
 *       the mock records PUT /a AND /nav, zero POST /live/ (preview default, D16); the chain report
 *       names the appended chrome document; the SUMMARY line is last on stdout;
 *   (b) a localizable link remains after the write pass (a redirect chain) → `links-unlocalized`,
 *       exit 1, ZERO requests to DA (no PUT for the whole run);
 *   (c) a page with a 🔴 (document-relative href) → `lint-red`, no PUT for it; the clean page is PUT;
 *   (d) --publish → POST /live/ per delivered page, status `live`;
 *   (e) a deploy-batch child that outlives --timeout → status `killed`, exit 1, no `FAIL` in the
 *       output (no verdict, B32); usage errors exit 2 with a SUMMARY line; --help exits 0;
 *   (f) a file name Gate 3 folds (`sub/Getting_Started.html`) passes stage 3 (the DELIVERED path is
 *       linted) and deploy-batch PUTs it at `/sub/getting-started` with the redirect row on the
 *       `--redirects` sheet — the chain never turns the Gate 3 default into --strict-paths;
 *   (g) stage-1 pass-through: `--unmigrated bounce` (default) rewrites a dead `/missing` to the
 *       source host and the page ships; `--unmigrated list` leaves it, writes link-gaps.tsv, ships;
 *       `--locale-alias en --append-redirects` aliases `/x` → `/en/x` and appends the row;
 *       the links-unlocalized residue echo carries the kept-absolute target list.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-da.mjs';
import { resolveEntry, runCapped } from '../deploy-page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'deploy-page.mjs');
const page = (t, links = []) => `<body><header></header><main><div><h1>${t}</h1><p>${'lorem ipsum dolor sit amet '.repeat(12)}</p>${links.map((h) => `<p><a href="${h}">${h}</a></p>`).join('')}</div></main><footer></footer></body>\n`;
const nav = (href) => `<body><header></header><main><div><ul><li><a href="${href}">Home</a></li><li><a href="/b">B</a></li>${Array.from({ length: 6 }, (_, i) => `<li><a href="/b#section-${i}">Section ${i}</a></li>`).join('')}</ul></div></main><footer></footer></body>\n`;

const dir = mkdtempSync(join(tmpdir(), 'deploy-page-'));
const content = join(dir, 'content');
const fresh = ({ navLocalized = false } = {}) => {
  rmSync(content, { recursive: true, force: true });
  mkdirSync(content, { recursive: true });
  writeFileSync(join(content, 'a.html'), page('A', ['https://www.src.example/b']));
  writeFileSync(join(content, 'b.html'), page('B'));
  writeFileSync(join(content, 'nav.html'), nav(navLocalized ? '/a' : 'https://www.src.example/a'));
  writeFileSync(join(content, 'bad.html'), page('Bad', ['about']));
};
fresh();
const reportFile = join(dir, 'work', 'report.json');
const mock = await startMock();
const base = ['--org', 'o', '--repo', 'r', '--branch', 'main', '--source-host', 'www.src.example', '--content', content, '--no-progress', '--report', reportFile];
const run = (extra, env = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [CLI, ...base, ...extra], { cwd: dir, env: { ...process.env, HOME: dir, DA_TOKEN: 'x', ...mock.env(), ...env } });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => { c.kill(); stderr += '\n[test] TIMEOUT'; }, 60000);
  c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr, out: stdout + stderr }); });
});
const urls = (m) => mock.requests.filter((q) => q.method === m).map((q) => q.url);
const report = () => JSON.parse(readFileSync(reportFile, 'utf8'));

try {
  // pure helpers
  assert.deepEqual(resolveEntry('/a', content), { file: join(content, 'a.html'), webPath: '/a' });
  assert.equal(resolveEntry('/nope', content), null);
  assert.equal(resolveEntry(join(content, 'b.html'), content).webPath, '/b');
  const k = await runCapped(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], { timeoutMs: 200 });
  assert.equal(k.killed, true, 'runCapped kills at the deadline');
  const ok = await runCapped(process.execPath, ['-e', 'process.exit(0)'], { timeoutMs: 5000 });
  assert.deepEqual([ok.code, ok.killed], [0, false]);

  // --help / usage
  let r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /usage:/);
  r = await run([]);
  assert.equal(r.status, 2, 'no file and no --all → exit 2');
  assert.match(r.stdout, /^SUMMARY deploy-page ok=0 failed=0 exit=2 /m, 'usage error still prints a SUMMARY line');
  r = await run(['/a', '--media', 'reconcile']);
  assert.equal(r.status, 2, '--media reconcile is reserved → exit 2');
  assert.match(r.stderr, /reserved/);
  r = await run(['/a', '--unmigrated', 'maybe']);
  assert.equal(r.status, 2, '--unmigrated takes bounce|list only');
  r = await run(['/a', '--append-redirects']);
  assert.equal(r.status, 2, '--append-redirects without --redirects is a usage error');
  assert.match(r.stderr, /--append-redirects needs --redirects/);

  // (a) one page → nav rewritten by localize and appended; preview only
  mock.reset();
  r = await run(['/a']);
  assert.equal(r.status, 0, `chain exit 0: ${r.out}`);
  assert.deepEqual(urls('PUT').sort(), ['/da/o/r/a.html', '/da/o/r/nav.html'], `PUT /a and the appended /nav: ${urls('PUT')}`);
  assert.equal(urls('POST').filter((u) => u.startsWith('/admin/live/')).length, 0, 'preview default: zero POST /live/');
  assert.match(readFileSync(join(content, 'nav.html'), 'utf8'), /href="\/a"/, 'nav.html localized in place (no staging copy)');
  assert.match(readFileSync(join(content, 'a.html'), 'utf8'), /href="\/b"/, 'a.html localized');
  assert.match(r.stderr, /\[deploy-page\] \/a {2}localize ok · lint ok · delivery-lint ok · sanitise ok · deploy previewed {2}https:\/\/main--r--o\.aem\.page\/a/, `per-page stage line: ${r.stderr}`);
  assert.match(r.stderr, /\[deploy-page\] \/nav {2}localize ok · lint ok · delivery-lint ok · sanitise ok · deploy previewed/);
  assert.equal(r.stdout.trim().split('\n').at(-1), `SUMMARY deploy-page ok=2 failed=0 exit=0 details=${reportFile} published=preview-only`, 'SUMMARY is the last stdout line');
  let rep = report();
  assert.deepEqual(rep.chromeAppended, ['/nav']);
  assert.equal(rep.pages['/a'].status, 'previewed');
  assert.equal(rep.pages['/nav'].appended, 'chrome changed by localize');
  assert.match(rep.run.localize, /\+1 chrome document/);

  // (b) residue after the write pass (redirect chain /old → /mid → /b): no PUT for the whole run
  fresh();
  mkdirSync(join(dir, 'stardust'), { recursive: true });
  writeFileSync(join(dir, 'stardust', 'redirects.tsv'), '/old\t/mid\n/mid\t/b\n');
  writeFileSync(join(content, 'a.html'), page('A', ['/old', 'https://www.src.example/elsewhere']));
  rmSync(join(content, '.deploy-ledger.json'), { force: true });
  mock.reset();
  r = await run(['/a', '/b', '--redirects', join(dir, 'stardust', 'redirects.tsv')]);
  assert.equal(r.status, 1, `links-unlocalized → exit 1: ${r.out}`);
  assert.equal(mock.requests.length, 0, 'zero requests to DA when the check fails');
  assert.match(r.stderr, /links-unlocalized/);
  assert.match(r.stderr, /CHECK FAIL/);
  assert.match(r.stderr, /KEPT[\s\S]*\/elsewhere/, `the residue echo carries the kept-absolute target list: ${r.stderr}`);
  rep = report();
  assert.equal(rep.run.localize, 'links-unlocalized');
  assert.equal(rep.pages['/b'].status, 'links-unlocalized', 'the run is parked, not just the offending page');
  assert.match(r.stdout, /^SUMMARY deploy-page ok=0 failed=3 exit=1 /m, "a, b and the appended nav are all parked");

  // (c) a 🔴 page is lint-red and never PUT; the clean page still ships (nav already localized → not appended)
  fresh({ navLocalized: true });
  rmSync(join(content, '.deploy-ledger.json'), { force: true });
  mock.reset();
  r = await run(['/bad', '/b']);
  assert.equal(r.status, 1, `lint-red → exit 1: ${r.out}`);
  assert.deepEqual(urls('PUT'), ['/da/o/r/b.html'], `only /b is PUT: ${urls('PUT')}`);
  assert.match(r.stderr, /\[deploy-page\] \/bad {2}localize ok · lint red/);
  assert.match(r.stderr, /BLOCKED before any PUT[\s\S]*\/bad {2}lint-red/);
  assert.match(r.stderr, /🔴/, 'the 🔴 finding is echoed');
  rep = report();
  assert.equal(rep.pages['/bad'].status, 'lint-red');
  assert.equal(rep.pages['/b'].status, 'previewed');

  // (d) --publish → POST /live/ and status live
  mock.reset();
  r = await run(['/b', '--publish']);
  assert.equal(r.status, 0, r.out);
  assert.equal(urls('POST').filter((u) => u.startsWith('/admin/live/')).length, 1, 'one POST /live/');
  assert.equal(report().pages['/b'].status, 'live');
  assert.match(r.stdout, /published=1$/m);

  // (e) deploy-batch outliving the deadline → killed, no verdict, no FAIL word
  const stub = join(dir, 'stub-deploy-batch.mjs');
  writeFileSync(stub, 'setTimeout(() => {}, 30000);\n');
  fresh({ navLocalized: true });
  rmSync(join(content, '.deploy-ledger.json'), { force: true });
  mock.reset();
  r = await run(['/b', '--timeout', '1'], { DEPLOY_PAGE_DEPLOY_BATCH: stub });
  assert.equal(r.status, 1, `killed → exit 1: ${r.out}`);
  assert.ok(!/FAIL/.test(r.out), `a killed child is no verdict — the output never says FAIL:\n${r.out}`);
  assert.match(r.stderr, /\[deploy-page\] \/b {2}localize ok · lint ok · delivery-lint ok · sanitise ok · deploy killed/);
  assert.match(r.stderr, /NO VERDICT/);
  assert.match(r.stdout, /^SUMMARY deploy-page ok=0 failed=0 noverdict=1 exit=1 /m);
  assert.equal(report().pages['/b'].status, 'killed');

  // a stub exiting 124 is the same class
  writeFileSync(stub, 'process.exit(124);\n');
  r = await run(['/b'], { DEPLOY_PAGE_DEPLOY_BATCH: stub });
  assert.equal(r.status, 1); assert.match(r.stdout, /noverdict=1/); assert.ok(!/FAIL/.test(r.out));

  // a stub halting (exit 3) propagates 3
  writeFileSync(stub, 'console.log("next=node x"); process.exit(3);\n');
  r = await run(['/b'], { DEPLOY_PAGE_DEPLOY_BATCH: stub });
  assert.equal(r.status, 3, 'deploy-batch halt → exit 3');
  assert.match(r.stderr, /HALTED[\s\S]*next=node x/);

  // (f) a foldable file name: stage 3 lints the delivered path; deploy-batch PUTs at the safe path + redirect row
  fresh({ navLocalized: true }); rmSync(join(content, '.deploy-ledger.json'), { force: true }); mock.reset();
  const sheet = join(dir, 'stardust', 'redirects.tsv');
  writeFileSync(sheet, '');
  mkdirSync(join(content, 'sub'), { recursive: true });
  writeFileSync(join(content, 'sub', 'Getting_Started.html'), page('Getting started'));
  r = await run(['/sub/Getting_Started', '/b', '--redirects', sheet]);
  assert.equal(r.status, 0, `a foldable file name is not a stage-3 block: ${r.out}`);
  assert.deepEqual(urls('PUT').sort(), ['/da/o/r/b.html', '/da/o/r/sub/getting-started.html'], `PUT at the safe path: ${urls('PUT')}`);
  assert.match(r.stderr, /\[deploy-page\] \/sub\/Getting_Started {2}localize ok · lint ok · delivery-lint ok · sanitise ok · deploy previewed {2}https:\/\/main--r--o\.aem\.page\/sub\/getting-started/, `delivered URL names the safe path: ${r.stderr}`);
  assert.match(readFileSync(sheet, 'utf8'), /^\/sub\/Getting_Started\t\/sub\/getting-started$/m, 'Gate 3 redirect row on the --redirects sheet');
  assert.equal(report().pages['/sub/Getting_Started'].status, 'previewed');
  // a path with NO safe form is the one stage-3 P0 (deploy-batch would say path-unsafe too): blocked, no PUT
  writeFileSync(join(content, '日本語.html'), page('JP'));
  mock.reset();
  r = await run(['/日本語', '--redirects', sheet]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\/日本語 {2}localize ok · lint ok · delivery-lint P0\/P1/);
  assert.equal(urls('PUT').length, 0);
  rmSync(join(content, '日本語.html'));

  // (g) stage-1 pass-through — the owner-decided `links: list` row and the locale alias work through the chain
  fresh({ navLocalized: true }); rmSync(join(content, '.deploy-ledger.json'), { force: true }); mock.reset();
  writeFileSync(join(content, 'a.html'), page('A', ['/missing']));
  r = await run(['/a']);
  assert.equal(r.status, 0, `bounce (default) resolves the dead href and ships: ${r.out}`);
  assert.match(readFileSync(join(content, 'a.html'), 'utf8'), /href="https:\/\/www\.src\.example\/missing"/, 'dead root-relative href bounced to the source host');
  assert.deepEqual(urls('PUT'), ['/da/o/r/a.html']);
  fresh({ navLocalized: true }); rmSync(join(content, '.deploy-ledger.json'), { force: true }); mock.reset();
  writeFileSync(join(content, 'a.html'), page('A', ['/missing']));
  rmSync(join(dir, 'stardust', 'link-gaps.tsv'), { force: true });
  r = await run(['/a', '--unmigrated', 'list']);
  assert.equal(r.status, 0, `list leaves the gap and ships: ${r.out}`);
  assert.match(readFileSync(join(content, 'a.html'), 'utf8'), /href="\/missing"/, 'list: href left in place');
  assert.match(readFileSync(join(dir, 'stardust', 'link-gaps.tsv'), 'utf8'), /^\/missing\t1\t\/a\.html$/m, 'link-gaps.tsv row');
  assert.deepEqual(urls('PUT'), ['/da/o/r/a.html']);
  fresh({ navLocalized: true }); rmSync(join(content, '.deploy-ledger.json'), { force: true }); mock.reset();
  mkdirSync(join(content, 'en'), { recursive: true });
  writeFileSync(join(content, 'en', 'x.html'), page('X'));
  writeFileSync(join(content, 'a.html'), page('A', ['/x']));
  writeFileSync(sheet, '');
  r = await run(['/a', '--locale-alias', 'en', '--append-redirects', '--redirects', sheet]);
  assert.equal(r.status, 0, `locale alias through the chain: ${r.out}`);
  assert.match(readFileSync(join(content, 'a.html'), 'utf8'), /href="\/en\/x"/, '/x aliased to /en/x');
  assert.match(readFileSync(sheet, 'utf8'), /^\/x\t\/en\/x$/m, '--append-redirects wrote the alias row');
  rmSync(join(content, 'en'), { recursive: true, force: true });

  // --paths <file> with mixed shapes, no word-splitting
  fresh(); rmSync(join(content, '.deploy-ledger.json'), { force: true }); mock.reset();
  const list = join(dir, 'list.txt');
  writeFileSync(list, `/a\n${join(content, 'b.html')}\n# comment\n`);
  r = await run(['--paths', list]);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(urls('PUT').sort(), ['/da/o/r/a.html', '/da/o/r/b.html', '/da/o/r/nav.html']);
  // transport pass-through: --require-code-synced with no record → deploy-batch REFUSED (exit 3), zero PUT, no verdict
  fresh({ navLocalized: true }); rmSync(join(content, '.deploy-ledger.json'), { force: true }); mock.reset();
  r = await run(['/a', '--require-code-synced', '--code-sync-record', join(dir, 'nope', 'code-sync.json')]);
  assert.equal(r.status, 3, `code-sync refusal propagates as exit 3: ${r.out}`);
  assert.equal(urls('PUT').length, 0, 'refused run PUTs nothing');
  assert.match(r.out, /REFUSED \(--require-code-synced\): no code-sync record/);
  assert.ok(!/FAIL/.test(r.out), 'a refusal is no verdict, never FAIL');
  // a valid record for this org/repo/ref lets the same command ship
  mkdirSync(join(dir, 'nope'), { recursive: true });
  writeFileSync(join(dir, 'nope', 'code-sync.json'), JSON.stringify({ org: 'o', repo: 'r', ref: 'main', status: 'ok', headSha: 'abc1234', ts: new Date().toISOString() }));
  mock.reset();
  r = await run(['/a', '--require-code-synced', '--code-sync-record', join(dir, 'nope', 'code-sync.json')]);
  assert.equal(r.status, 0, `synced record → ships: ${r.out}`);
  assert.deepEqual(urls('PUT'), ['/da/o/r/a.html']);
  // --site-token-env / --token-env / --concurrency forwarded: the delivered GETs carry the named site token
  fresh({ navLocalized: true }); rmSync(join(content, '.deploy-ledger.json'), { force: true }); mock.reset();
  r = await run(['/a', '--site-token-env', 'MY_SITE_TOKEN', '--token-env', 'MY_DA', '--concurrency', '2'], { MY_SITE_TOKEN: 'site-secret', MY_DA: 'x', DA_TOKEN: '' });
  assert.equal(r.status, 0, `forwarded token names: ${r.out}`);
  assert.deepEqual(urls('PUT'), ['/da/o/r/a.html']);
  const deliveredGets = mock.requests.filter((q) => q.method === 'GET' && /^\/delivery\//.test(q.url));
  assert.ok(deliveredGets.length > 0 && deliveredGets.every((q) => q.auth === 'token site-secret'), `delivered GETs carry the --site-token-env value: ${JSON.stringify(deliveredGets)}`);
  r = await run(['/a', '--concurrency']);
  assert.equal(r.status, 2, '--concurrency needs a value');
  r = await run(['/a', '--timeout', 'abc']);
  assert.equal(r.status, 2, '--timeout abc is a usage error, not a silent 600'); assert.match(r.stderr, /--timeout takes whole seconds ≥ 1/);
  r = await run(['/a', '--timeout', '0']);
  assert.equal(r.status, 2, '--timeout 0 is a usage error');

  // --skip-code-sync-verify <reason> forwarded: deploy-batch prints the instrument line and logs it; exclusive with --require-code-synced
  fresh({ navLocalized: true }); rmSync(join(content, '.deploy-ledger.json'), { force: true }); mock.reset();
  r = await run(['/a', '--skip-code-sync-verify', 'served code verified by hand at 09:12']);
  assert.equal(r.status, 0, `skip line forwarded: ${r.out}`);
  assert.match(r.stderr, /\[deploy-batch\] instrument: code-sync-verify skipped — served code verified by hand at 09:12/);
  assert.match(readFileSync(join(content, '.deploy-log.jsonl'), 'utf8'), /"step":"instrument","instrument":"code-sync-verify","skipped":"served code verified by hand at 09:12"/);
  r = await run(['/a', '--skip-code-sync-verify', 'x', '--require-code-synced']);
  assert.equal(r.status, 2); assert.match(r.stderr, /exclusive/);

  // Gate 8 through the chain: a --publish run holds the row the report does not PASS — chain exit 1, `held=1`, the PASS row goes live
  fresh({ navLocalized: true }); rmSync(join(content, '.deploy-ledger.json'), { force: true }); mock.reset();
  r = await run(['/a', '/b']);
  assert.equal(r.status, 0, r.out);
  mkdirSync(join(dir, 'stardust', 'rollout'), { recursive: true });
  const gateRow = (p, status) => ({ path: p, slug: p.slice(1), template: 'landing', wasLive: false, latest: { at: '2026-09-18T09:40:00Z', pass: status === 'pass', status, breakpoints: { 1440: status === 'pass' ? { status: 'pass', pass: true, pixelPct: 5, heightDelta: 0 } : { status: 'fail', pass: false, pixelPct: 12.4, heightDelta: -112 } } }, bestOfLast3: {}, history: [] });
  writeFileSync(join(dir, 'stardust', 'rollout', 'gate-report.json'), JSON.stringify({ generatedAt: '2026-09-18T09:41:00Z', coverage: { delivered: 2, gated: 2, pass: 1, fail: 1, unmeasured: 0, ungated: 0 }, templates: { landing: { atBar: true } }, pages: { '/a': gateRow('/a', 'pass'), '/b': gateRow('/b', 'fail') } }));
  mock.reset();
  r = await run(['/a', '/b', '--publish']);
  assert.equal(r.status, 1, `a held page is not live → exit 1: ${r.out}`);
  assert.deepEqual(urls('POST').filter((u) => u.startsWith('/admin/live/')), ['/admin/live/o/r/main/a'], 'POST /live/ for the PASS row only');
  assert.match(r.stderr, /\[deploy-page\] \/b {2}localize ok · lint ok · delivery-lint ok · sanitise ok · deploy held \(gate\) — row previewed/);
  assert.match(r.stderr, /HELD by the publish gate/);
  assert.match(r.stdout.trim().split('\n').at(-1), /^SUMMARY deploy-page ok=1 failed=0 noverdict=1 exit=1 details=.* published=1 held=1$/);
  assert.equal(JSON.parse(readFileSync(join(content, '.deploy-ledger.json'), 'utf8'))['/b'].status, 'previewed');
  r = await run(['/a', '--publish-ungated']);
  assert.equal(r.status, 2, 'an escape flag without --publish is a usage error'); assert.match(r.stderr, /apply to a --publish run only/);
  rmSync(join(dir, 'stardust'), { recursive: true, force: true });
  console.log('deploy-page test: ok (chrome append, preview default, links-unlocalized zero-PUT + residue echo, lint-red, --publish, killed no-verdict, exit 3 propagation, Gate 3 fold through the chain, stage-1 pass-through, --paths file, transport pass-through: code-sync refusal exit 3 + token names/concurrency forwarded, --timeout validated, --skip-code-sync-verify line, Gate 8 hold through the chain)');
} finally {
  await mock.close();
  rmSync(dir, { recursive: true, force: true });
}
