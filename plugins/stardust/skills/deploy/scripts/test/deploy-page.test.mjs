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
 *       output (no verdict, B32); usage errors exit 2 with a SUMMARY line; --help exits 0.
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
const nav = (href) => `<body><header></header><main><div><ul><li><a href="${href}">Home</a></li><li><a href="/b">B</a></li>${Array.from({ length: 6 }, (_, i) => `<li><a href="/section-${i}">Section ${i}</a></li>`).join('')}</ul></div></main><footer></footer></body>\n`;

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
  writeFileSync(join(content, 'a.html'), page('A', ['/old']));
  rmSync(join(content, '.deploy-ledger.json'), { force: true });
  mock.reset();
  r = await run(['/a', '/b', '--redirects', join(dir, 'stardust', 'redirects.tsv')]);
  assert.equal(r.status, 1, `links-unlocalized → exit 1: ${r.out}`);
  assert.equal(mock.requests.length, 0, 'zero requests to DA when the check fails');
  assert.match(r.stderr, /links-unlocalized/);
  assert.match(r.stderr, /CHECK FAIL/);
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

  // --paths <file> with mixed shapes, no word-splitting
  fresh(); rmSync(join(content, '.deploy-ledger.json'), { force: true }); mock.reset();
  const list = join(dir, 'list.txt');
  writeFileSync(list, `/a\n${join(content, 'b.html')}\n# comment\n`);
  r = await run(['--paths', list]);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(urls('PUT').sort(), ['/da/o/r/a.html', '/da/o/r/b.html', '/da/o/r/nav.html']);
  console.log('deploy-page test: ok (chrome append, preview default, links-unlocalized zero-PUT, lint-red, --publish, killed no-verdict, exit 3 propagation, --paths file)');
} finally {
  await mock.close();
  rmSync(dir, { recursive: true, force: true });
}
