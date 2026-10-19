#!/usr/bin/env node
// skills/replica/scripts/test/stitch-shot.test.mjs — stitch-shot's --hide (the rest of the instrument is exercised by
// the gate runs): --help answers and names it; against a pair of in-process pages — the same `main` bare, and wrapped
// in a header (its bar fixed, its space reserved in flow) and a footer — a capture with --hide on the chrome is the
// bare page's capture to the pixel at 1440 and 360 (a fixed bar not repeated in any chunk), a capture without --hide is
// taller and well above the pixel bar, a selector that matches nothing changes nothing, and --dismiss, which clicks,
// leaves the chrome in the capture. Site auth (--token-env / --auth-header / --auth-origin) against a two-origin
// fixture whose protected origin loads its stylesheet and image from a second one: the token reaches the protected
// origin and never the other, nothing is sent without a flag (a SITE_TOKEN in the environment and .env included) and
// that run is the run of today (exit 1 naming the 401), an auth usage error exits 1 like the other usage errors, before any request, and a run
// with no auth flag on an open page is unchanged. Needs playwright and pngjs (it prints a skip line without them).
// Run: node <this file>.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startTwoOriginServer } from './fixtures/two-origin-server.mjs';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const STITCH = join(HERE, '..', 'stitch-shot.mjs');
const PIXEL = join(HERE, '..', 'pixel-compare.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'stitch-shot-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
// Async: the fixture servers answer from this process. The child env never carries a site token of the runner's.
const cleanEnv = (extra = {}) => { const env = { ...process.env, ...extra }; for (const k of ['SITE_TOKEN', 'DEPLOYED_GATE_SITE_TOKEN']) if (!(k in extra)) delete env[k]; return env; };
const node = (script, args, { cwd, env } = {}) => exec(process.execPath, [script, ...args], { cwd, env }).then((r) => ({ status: 0, ...r }), (e) => ({ status: e.code, stdout: e.stdout, stderr: e.stderr }));

let playwrightOk = false;
try { await import('playwright'); await import('pngjs'); playwrightOk = true; } catch { console.log('skip  stitch-shot checks (playwright or pngjs not importable here; run this test in an environment that has them)'); }

if (playwrightOk) {
  const { PNG } = await import('pngjs');
  const HEADER = 64;
  const FOOTER = 120;
  const stripes = Array.from({ length: 8 }, (_, i) => `<section style="height:420px;background:hsl(${i * 40} 60% 70%)"><h2>Section ${i}</h2></section>`).join('');
  const base = 'body{margin:0;font:16px/24px sans-serif}';
  const pages = {
    '/bare': `<!doctype html><meta charset="utf-8"><style>${base}</style><body><main>${stripes}</main></body>`,
    '/chrome': `<!doctype html><meta charset="utf-8"><style>${base}header{height:${HEADER}px}header nav{position:fixed;top:0;left:0;width:100%;height:${HEADER}px;background:#123;color:#fff;z-index:2}footer{height:${FOOTER}px;background:#345;color:#fff}</style><body><header><nav>Head</nav></header><main>${stripes}</main><footer>Foot</footer></body>`,
  };
  const server = createServer((req, res) => { res.writeHead(pages[req.url] ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }); res.end(pages[req.url] ?? ''); });
  await new Promise((done) => { server.listen(0, '127.0.0.1', done); });
  const origin = `http://127.0.0.1:${server.address().port}`;

  let shots = 0;
  const shoot = async (path, width, extra = []) => {
    shots += 1;
    const file = join(scratch, `shot-${shots}.png`);
    const r = await node(STITCH, [`${origin}${path}`, file, '--width', String(width), ...extra]);
    assert.equal(r.status, 0, `${path} ${extra.join(' ')}: ${r.stderr}`);
    return file;
  };
  const heightOf = (file) => PNG.sync.read(readFileSync(file)).height;
  const pixelPct = async (a, b) => {
    const r = await node(PIXEL, [a, b, '--json', '--out', join(scratch, 'diff.png')]);
    assert.ok([0, 2].includes(r.status), r.stderr);
    return JSON.parse(r.stdout).pct;
  };

  await check('--help answers before any capture and names --hide, beside --dismiss and the three site-auth flags', async () => {
    const r = await node(STITCH, ['--help']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /--hide <sel,…>\s+remove the matched elements from the capture/);
    assert.match(r.stdout, /--dismiss <sel,…>/);
    for (const flag of ['--token-env <NAME>', '--auth-header <value>', '--auth-origin <url>']) assert.ok(r.stdout.includes(flag), flag);
  });

  for (const width of [1440, 360]) {
    await check(`@${width}: --hide on the chrome captures the bare page; without it the capture is taller and over the pixel bar; --dismiss only clicks; a selector that matches nothing changes nothing`, async () => {
      const [bare, plain, hidden, dismissed, nothing] = await Promise.all([
        shoot('/bare', width),
        shoot('/chrome', width),
        shoot('/chrome', width, ['--hide', 'header,footer']),
        shoot('/chrome', width, ['--dismiss', 'header,footer']),
        shoot('/chrome', width, ['--hide', '.no-such-element']),
      ]);
      const main = heightOf(bare);
      assert.equal(heightOf(plain), main + HEADER + FOOTER, 'default: the chrome and the space it reserves are captured');
      assert.equal(heightOf(hidden), main, 'the header, its reserved space and the footer are gone');
      assert.equal(await pixelPct(bare, hidden), 0, 'to the pixel: the fixed bar is in no chunk');
      assert.ok(await pixelPct(bare, plain) > 10, 'unhidden, the shifted page and the repeated bar are far over the bar');
      assert.equal(heightOf(dismissed), main + HEADER + FOOTER, '--dismiss clicks, it does not remove');
      assert.equal(heightOf(nothing), main + HEADER + FOOTER);
      assert.equal(await pixelPct(plain, nothing), 0);
    });
  }

  // ---- site auth: a two-origin fixture, the protected origin A loads its stylesheet and image from origin B ----
  const dims = (file) => { const { width, height } = PNG.sync.read(readFileSync(file)); return `${width}x${height}`; };
  const fixture = async (fn) => { const fx = await startTwoOriginServer(); try { await fn(fx); } finally { await fx.stop(); } };
  const leaksNothing = (fx, r) => {
    assert.deepEqual(fx.authorizations('B'), [], 'origin B (the third party) saw no Authorization');
    assert.ok(!`${r.stdout}${r.stderr}`.includes(fx.token), 'the token is never printed');
  };

  await check('--token-env: the token reaches the measured origin and not the origin its stylesheet and image come from', () => fixture(async (fx) => {
    const out = join(scratch, 'auth-env.png');
    const r = await node(STITCH, [`${fx.originA}/page`, out, '--token-env', 'FIXTURE_SITE_TOKEN'], { env: cleanEnv({ FIXTURE_SITE_TOKEN: fx.token }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^stitched .*: 1440x\d+ from \d+ chunks/);
    assert.ok(fx.a.log.some((e) => e.path === '/page' && e.status === 200 && e.authorization === fx.authorization), 'origin A answered the page 200 to the token');
    assert.ok(['/style.css', '/pic.png'].every((p) => fx.b.log.some((e) => e.path === p && e.status === 200)), 'the sub-resources were fetched from origin B');
    leaksNothing(fx, r);
  }));

  await check('--auth-header with a bare value and an explicit --auth-origin works the same', () => fixture(async (fx) => {
    const out = join(scratch, 'auth-header.png');
    const r = await node(STITCH, [`${fx.originA}/page`, out, '--auth-header', fx.token, '--auth-origin', `${fx.originA}/ignored/path`], { env: cleanEnv() });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fx.a.log.some((e) => e.path === '/page' && e.status === 200 && e.authorization === fx.authorization), 'a bare value is sent as "token <value>"');
    assert.ok(fx.b.log.length >= 2);
    leaksNothing(fx, r);
  }));

  await check('no flag: nothing is sent — a SITE_TOKEN in the environment and in .env included — and the 401 fails as before (exit 1, naming it)', () => fixture(async (fx) => {
    const cwd = mkdtempSync(join(scratch, 'cwd-'));
    writeFileSync(join(cwd, '.env'), `SITE_TOKEN=${fx.token}\n`);
    const out = join(scratch, 'no-flag.png');
    const r = await node(STITCH, [`${fx.originA}/page`, out], { cwd, env: cleanEnv({ SITE_TOKEN: fx.token }) });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, `stitch-shot error: HTTP 401 at ${fx.originA}/page — not a challenge marker, but not the page either; refusing to measure it\n`);
    assert.ok(!existsSync(out));
    assert.ok(fx.a.log.length > 0 && fx.a.log.every((e) => e.authorization === null && e.status === 401), 'origin A saw requests and none carried an Authorization');
    leaksNothing(fx, r);
  }));

  await check('no auth flag on an open page is unaffected: the same capture, nothing sent anywhere', () => fixture(async (fx) => {
    const out = join(scratch, 'open.png');
    const r = await node(STITCH, [`${fx.originB}/page`, out], { env: cleanEnv({ SITE_TOKEN: fx.token }) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^stitched .*: 1440x\d+ from \d+ chunks\n$/);
    assert.equal(r.stderr, '');
    assert.ok(heightOf(out) > 200, dims(out));
    assert.equal(fx.a.log.length, 0, 'origin A was never asked');
    leaksNothing(fx, r);
  }));

  await check('auth usage errors exit 1, as the other usage errors do, before any request: an unset variable, a flag without its value, a malformed origin', () => fixture(async (fx) => {
    const url = `${fx.originA}/page`;
    const out = join(scratch, 'usage.png');
    const cases = [
      [['--token-env', 'NO_SUCH_FIXTURE_VAR'], /no site token: the variable --token-env names is not set \(or is empty\) in the environment or in \.env/],
      [['--token-env'], /--token-env takes the name of an environment variable/],
      [['--auth-header'], /--auth-header needs a value/],
      [['--auth-header', 'x', '--auth-origin', 'not a url'], /--auth-origin needs an http\(s\) URL/],
    ];
    for (const [flags, re] of cases) {
      const r = await node(STITCH, [url, out, ...flags], { env: cleanEnv() });
      assert.equal(r.status, 1, `${flags.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, re);
      assert.match(r.stderr, /^stitch-shot error: /);
    }
    assert.equal(fx.a.log.length + fx.b.log.length, 0, 'no request was made');
  }));

  server.closeAllConnections();
  server.close();
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
