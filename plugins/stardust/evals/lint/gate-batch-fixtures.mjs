#!/usr/bin/env node
// Fixture runner: skills/replica/scripts/gate-batch.mjs — the pooled gate sweep and
// its completion contract, without a browser (a stub gate.sh with the real positional
// contract lives in lint/fixtures/gate-batch/).
//   - parsePairs: tabs, `#`/blank lines skipped, marker optional; a short row, a bad
//     width, a non-URL and a duplicate slug@width throw;
//   - classify / batchExit: 0 ok · 2 failed · 124/3/5/6/4/1 noverdict (never failed);
//     batch exit 2 over 124 over another code over 0;
//   - end to end over 5 pairs (pass, fail, slow=124, bot=3, pass with marker) at
//     --concurrency 2: the table has one row per pair with exit/verdict/pixel/record,
//     the SUMMARY line is last and reads ok=2 failed=1 noverdict=2 exit=2, the progress
//     JSON has the same counts, gate-batch.json + one log per pair are written, the
//     marker reached gate.sh, and no more than 2 rounds ever overlapped;
//   - a sweep with a deadline row and no FAIL exits 124 (no verdict is not a FAIL);
//   - --dry-run runs nothing; --help 0; missing file / bad row / duplicate pair 125.
// Usage: node plugins/stardust/evals/lint/gate-batch-fixtures.mjs  (exit 1 on findings)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePairs, classify, batchExit } from '../../skills/replica/scripts/gate-batch.mjs';

const HERE = import.meta.dirname;
const CLI = join(HERE, '..', '..', 'skills', 'replica', 'scripts', 'gate-batch.mjs');
const STUB = join(HERE, 'fixtures', 'gate-batch', 'gate.sh');
const work = mkdtempSync(join(tmpdir(), 'gate-batch-'));
const run = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], { cwd: work, encoding: 'utf8', env: { ...process.env, ...env } });

try {
  // pure helpers
  const rows = parsePairs('# comment\n\nhome\thttps://live.test/\thttp://localhost:8791/home.html\t1440\n\nnews\thttps://live.test/news\thttp://localhost:8791/news.html\t360\tnews-marker\r\n');
  assert.deepEqual(rows.map((r) => [r.slug, r.width, r.marker]), [['home', 1440, null], ['news', 360, 'news-marker']]);
  assert.throws(() => parsePairs('home\thttps://live.test/\t1440'), /expected slug/);
  assert.throws(() => parsePairs('home\thttps://live.test/\thttp://localhost:1/\tbig'), /width/);
  assert.throws(() => parsePairs('home\tnot a url\thttp://localhost:1/\t1440'), /live-url is not a URL/);
  assert.throws(() => parsePairs('home\thttps://a.test/\thttp://localhost:1/\t1440\nhome\thttps://a.test/\thttp://localhost:1/\t1440'), /appears twice/);
  assert.deepEqual(classify(0), { verdict: 'PASS', ok: true, noverdict: false });
  assert.deepEqual(classify(2), { verdict: 'FAIL', ok: false, noverdict: false });
  for (const c of [124, 3, 5, 6, 4, 1, 125, 7]) assert.equal(classify(c).noverdict, true, `exit ${c} is no verdict`);
  assert.equal(classify(124).verdict, 'NO VERDICT (deadline)');
  assert.equal(batchExit([0, 124, 2, 3]), 2);
  assert.equal(batchExit([0, 3, 124]), 124);
  assert.equal(batchExit([0, 3, 0]), 3);
  assert.equal(batchExit([0, 0]), 0);

  // end to end with the stub
  const pairs = join(work, 'pairs.tsv');
  writeFileSync(pairs, ['# slug live build width [marker]', 'pass-home\thttps://live.test/\thttp://localhost:8791/home.html\t1440', 'fail-news\thttps://live.test/news\thttp://localhost:8791/news.html\t1440', 'slow-blog\thttps://live.test/blog\thttp://localhost:8791/blog.html\t360', 'bot-shop\thttps://live.test/shop\thttp://localhost:8791/shop.html\t1440', 'pass-about\thttps://live.test/about\thttp://localhost:8791/about.html\t360\tabout-marker', ''].join('\n'));
  const trace = join(work, 'trace.log');
  const progress = join(work, 'p.json');
  let r = run([pairs, '--gate', STUB, '--concurrency', '2', '--out', join(work, 'out'), '--progress', progress], { GATE_STUB_TRACE: trace });
  assert.equal(r.status, 2, `FAIL in the batch → exit 2\n${r.stdout}\n${r.stderr}`);
  const out = r.stdout.trim().split('\n');
  assert.equal(out.at(-1), `SUMMARY gate-batch ok=2 failed=1 noverdict=2 exit=2 details=${join(work, 'out', 'gate-batch.json')} pairs=5 concurrency=2`, 'SUMMARY is the last stdout line; deadline + bot are noverdict, not failed');
  assert.match(out[0], /^slug\s+width\s+exit\s+verdict\s+pixel\s+Δh\s+iteration\s+record$/, 'table header');
  assert.match(r.stdout, /^pass-home\s+1440\s+0\s+PASS\s+3\.2%\s+4px\s+1\/3\s+stardust\/replica\/gates\/pass-home-1440\/gate-iter1\.json$/m, 'PASS row carries the record numbers');
  assert.match(r.stdout, /^fail-news\s+1440\s+2\s+FAIL\s+18\.7%\s+-31px/m);
  assert.match(r.stdout, /^slow-blog\s+360\s+124\s+NO VERDICT \(deadline\)\s+-\s+-\s+-\s+-$/m, 'deadline row: no numbers, no record');
  assert.match(r.stdout, /^bot-shop\s+1440\s+3\s+NO VERDICT \(bot-challenge\)/m);
  const p = JSON.parse(readFileSync(progress, 'utf8'));
  assert.deepEqual([p.driver, p.total, p.done, p.ok, p.failed, p.noverdict, p.concurrency], ['gate-batch', 5, 5, 2, 1, 2, 2], 'progress JSON counts');
  const details = JSON.parse(readFileSync(join(work, 'out', 'gate-batch.json'), 'utf8'));
  assert.equal(details.pairs.length, 5); assert.equal(details.exit, 2); assert.deepEqual(details.counts, { ok: 2, failed: 1, noverdict: 2 });
  for (const k of ['pass-home-1440', 'fail-news-1440', 'slow-blog-360', 'bot-shop-1440', 'pass-about-360']) assert.ok(existsSync(join(work, 'out', `${k}.log`)), `log for ${k}`);
  assert.match(readFileSync(join(work, 'out', 'pass-about-360.log'), 'utf8'), /--marker about-marker/, 'marker forwarded to gate.sh');
  assert.equal(JSON.parse(readFileSync(join(work, 'stardust', 'replica', 'gates', 'pass-about-360', 'gate-iter1.json'), 'utf8')).marker, 'about-marker');
  // concurrency: reconstruct the overlap from the stub's start/end trace
  let live = 0; let peak = 0;
  for (const l of readFileSync(trace, 'utf8').trim().split('\n').map((x) => x.split(' ')).sort((a, b) => Number(a[2]) - Number(b[2]))) { live += l[0] === 'start' ? 1 : -1; peak = Math.max(peak, live); }
  assert.ok(peak >= 2 && peak <= 2, `pool ran ${peak} rounds at once (asked 2)`);

  // no FAIL but a deadline → 124
  writeFileSync(pairs, 'pass-a\thttps://live.test/\thttp://localhost:1/a.html\t1440\nslow-b\thttps://live.test/b\thttp://localhost:1/b.html\t1440\n');
  r = run([pairs, '--gate', STUB, '--no-progress', '--out', join(work, 'out2')]);
  assert.equal(r.status, 124, 'deadline without a FAIL → 124 (re-run), not 2');
  assert.match(r.stdout.trim().split('\n').at(-1), /^SUMMARY gate-batch ok=1 failed=0 noverdict=1 exit=124 /);

  // usage
  writeFileSync(pairs, 'pass-dry\thttps://live.test/\thttp://localhost:1/a.html\t1440\n');
  r = run([pairs, '--gate', STUB, '--dry-run']);
  assert.equal(r.status, 0); assert.match(r.stdout, /dry run — nothing ran/); assert.ok(!existsSync(join(work, 'stardust', 'replica', 'gates', 'pass-dry-1440')), 'dry run ran no round');
  assert.equal(run(['--help']).status, 0); assert.match(run(['--help']).stdout, /Usage:/);
  assert.equal(run([join(work, 'missing.tsv'), '--gate', STUB]).status, 125);
  writeFileSync(pairs, 'x\thttps://live.test/\t1440\n');
  assert.equal(run([pairs, '--gate', STUB]).status, 125, 'bad row → 125');
  writeFileSync(pairs, 'x\thttps://live.test/\thttp://localhost:1/\t1440\nx\thttps://live.test/\thttp://localhost:1/\t1440\n');
  r = run([pairs, '--gate', STUB]); assert.equal(r.status, 125, 'duplicate pair → 125'); assert.match(r.stderr, /appears twice/);
  assert.equal(run([pairs, '--gate', STUB, '--concurrency', '0']).status, 125);
  assert.equal(spawnSync(process.execPath, ['--check', CLI]).status, 0, 'node --check');
  console.log('gate-batch fixtures: ok (parsePairs, classify/batchExit, pooled sweep table + SUMMARY + progress, 124 batch exit, usage)');
} finally {
  rmSync(work, { recursive: true, force: true });
}
