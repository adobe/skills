#!/usr/bin/env node
// skills/diff/scripts/test/clip-probe.test.mjs — the clip-probe.mjs contract (#125 D1). Part (a), no browser:
// summarize groups findings by kind + clipper + parent and keeps advisory kinds apart, formatTable hides advisory
// rows unless asked, verdictLine, parseArgs, --help in an empty cwd. Part (b), where playwright is importable:
// a fixture page served from this process — a 238 px card with overflow:hidden whose description is cut
// mid-line and whose "View details" link sits below the box (the recorded card defect), a line-clamped
// paragraph (advisory only), a collapsed mega-menu (max-height 0 — must not count), an sr-only span (must not
// count), a horizontal carousel track (advisory only), a "Read more" collapsible (advisory TEXT COLLAPSED) — and
// a clean page (exit 0). Site auth (--token-env / --auth-header / --auth-origin) against a two-origin fixture whose
// protected origin loads its stylesheet and image from a second one: the token reaches the protected origin and never
// the other, nothing is sent without a flag (a SITE_TOKEN in the environment and .env included) and that run is the run
// of today — the 401 page measured with a warning, exit 0 —, an auth usage error exits 2 before any request, and a run
// with no auth flag on an open page is unchanged. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatTable, parseArgs, summarize, verdictLine } from '../clip-probe.mjs';
import { startTwoOriginServer } from '../../../replica/scripts/test/fixtures/two-origin-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'clip-probe.mjs');
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const runAsync = (args, cwd, env = process.env) => new Promise((done) => { const ch = spawn(process.execPath, [SCRIPT, ...args], { cwd, env }); let out = ''; let err = ''; ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; }); ch.on('close', (code) => done({ code, out, err })); });
// The child env never carries a site token of the runner's.
const cleanEnv = (extra = {}) => { const env = { ...process.env, ...extra }; for (const k of ['SITE_TOKEN', 'DEPLOYED_GATE_SITE_TOKEN']) if (!(k in extra)) delete env[k]; return env; };

const findings = [
  { kind: 'CONTROL HIDDEN', path: 'div.card-body > p.details > a', text: 'view details', clipper: 'div.card-body', cut: 20 },
  { kind: 'CONTROL HIDDEN', path: 'div.card-body > p.details > a', text: 'view details', clipper: 'div.card-body', cut: 20 },
  { kind: 'TEXT CLIPPED', path: 'div.card-body > p.desc', text: 'multi use offer', clipper: 'div.card-body', cut: 4 },
  { kind: 'TEXT CLIPPED', path: 'div.card-body > p.desc', text: 'valid online', clipper: 'div.card-body', cut: 9 },
  { kind: 'TEXT CLAMPED', advisory: true, path: 'div.card > p.brand', text: 'neutrogena', clipper: 'p.brand' },
];
await check('summarize groups by kind + clipper + parent, counts, cut range, advisory last', () => {
  const g = summarize(findings);
  assert.equal(g.length, 3);
  assert.deepEqual(g.map((x) => [x.kind, x.n]), [['CONTROL HIDDEN', 2], ['TEXT CLIPPED', 2], ['TEXT CLAMPED', 1]]);
  assert.equal(g[1].cutMin, 4); assert.equal(g[1].cutMax, 9); assert.equal(g[2].advisory, true); assert.equal(g[2].cutMin, null);
});
await check('formatTable hides advisory rows by default and shows them with { advisory: true }', () => {
  const g = summarize(findings);
  assert.ok(!formatTable(g).includes('CLAMPED'));
  assert.ok(formatTable(g, { advisory: true }).includes('CLAMPED'));
  assert.ok(formatTable(g).includes('×2'));
  assert.equal(formatTable([]), '  (none)');
});
await check('verdictLine names every counter', () => {
  const l = verdictLine({ total: 3, textClipped: 1, textHidden: 0, controlHidden: 2, controlClipped: 0, clamped: 4, scrollHidden: 0, horizontal: 1 });
  assert.ok(l.startsWith('Clipped: 3')); assert.ok(l.includes('controls hidden 2')); assert.ok(l.includes('clamped 4'));
});
await check('parseArgs: url, flags, --json with and without a file', () => {
  const o = parseArgs(['node', 'x', 'https://a.test/', '--width', '360', '--json', 'out.json', '--min-cut', '3', '--advisory']);
  assert.equal(o.url, 'https://a.test/'); assert.equal(o.width, 360); assert.equal(o.jsonFile, 'out.json'); assert.equal(o.minCut, 3); assert.equal(o.advisory, true);
  const p = parseArgs(['node', 'x', 'https://a.test/', '--json', '--plain']);
  assert.equal(p.json, true); assert.equal(p.jsonFile, null); assert.equal(p.plain, true);
});
await check('--help exits 0 with the usage and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'clip-probe-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Usage: node clip-probe\.mjs/); assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
});

await check('--help lists the three site-auth flags', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  for (const flag of ['--token-env <NAME>', '--auth-header <value>', '--auth-origin <url>']) assert.ok(r.stdout.includes(flag), flag);
  assert.match(r.stdout, /A site-auth usage error exits 2 too/);
});
await check('parseArgs: an absent site-auth flag stays undefined (never ""), a given one is read, a missing value is ""', () => {
  const none = parseArgs(['node', 'x', 'https://a.test/']);
  for (const k of ['tokenEnv', 'authHeader', 'authOrigin']) assert.equal(none[k], undefined, k);
  const all = parseArgs(['node', 'x', 'https://a.test/', '--token-env', 'MY_TOKEN', '--auth-header', 'token abc', '--auth-origin', 'https://a.test']);
  assert.deepEqual([all.tokenEnv, all.authHeader, all.authOrigin, all.url], ['MY_TOKEN', 'token abc', 'https://a.test', 'https://a.test/']);
  const bare = parseArgs(['node', 'x', 'https://a.test/', '--token-env']);
  assert.equal(bare.tokenEnv, ''); assert.equal(bare.url, 'https://a.test/');
  const next = parseArgs(['node', 'x', 'https://a.test/', '--auth-header', '--plain']);
  assert.equal(next.authHeader, ''); assert.equal(next.plain, true);
});

let playwright = true;
try { await import('playwright'); } catch { playwright = false; }
if (!playwright) { console.log('skip  end-to-end (playwright not importable here)'); }
else {
  const BROKEN = `<!doctype html><html><head><style>
    body{margin:0;font:16px/22px Arial} main{padding:40px}
    .card{position:relative;width:355px;height:238px;overflow:hidden;box-shadow:0 0 2px #999;margin:40px 0}
    .card-body{padding:12px;overflow:hidden;height:170px}
    .desc{margin:0;height:30px;overflow:hidden}
    .details{margin:160px 0 0}
    .clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;width:200px}
    .menu{max-height:0;overflow:hidden}
    .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
    .track{width:300px;overflow:hidden;white-space:nowrap} .track span{display:inline-block;width:280px}
  </style></head><body><header><nav><a href="/a">Home</a><div class="menu"><a href="/b">Hidden menu link</a><p>collapsed menu text that must not count</p></div></nav></header>
  <main><h1>Cards</h1>
    <div class="card"><div class="card-body"><p class="desc">First line of the description<br>second line of the description is cut mid-glyph by the 30px box<br>third</p><p class="details"><a href="/d">View details</a></p></div></div>
    <p class="clamp">A long clamped paragraph that keeps going and going until the second line ends and a third line is hidden by the clamp, which is design, not a defect.</p>
    <p>Visible paragraph <span class="sr-only">screen reader only</span>.</p>
    <div class="track"><span>slide one</span><span>slide two off to the right</span></div>
    <div class="menu" style="max-height:44px"><p style="margin:0">Collapsed accordion first line<br>second line<br>third line behind the toggle</p></div><button aria-expanded="false">Read more</button>
  </main></body></html>`;
  const CLEAN = '<!doctype html><html><body style="margin:0;font:16px Arial"><main><h1>Clean</h1><p>All visible text.</p><a href="/x">A link</a><button>A button</button></main></body></html>';
  const server = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(req.url.startsWith('/clean') ? CLEAN : BROKEN); });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const cwd = mkdtempSync(join(tmpdir(), 'clip-probe-e2e-'));
  await check('e2e: the broken card counts one hidden control + one clipped line + one hidden line; clamp / menu / sr-only / carousel do not count (exit 2)', async () => {
    const r = await runAsync([`${base}/broken`, '--json', '--plain', '--width', '900'], cwd);
    assert.equal(r.code, 2, r.err);
    const j = JSON.parse(r.out);
    assert.equal(j.counts.controlHidden, 1, JSON.stringify(j.findings));
    assert.equal(j.counts.textClipped, 1, 'the second line is cut mid-glyph by p.desc');
    assert.equal(j.counts.textHidden, 1, 'the third line (its own text node after <br>) is wholly hidden by p.desc — no clamp');
    assert.equal(j.counts.total, 3);
    assert.equal(j.counts.clamped, 1);
    assert.ok(j.counts.horizontal >= 1, 'carousel slide is a horizontal advisory');
    assert.equal(j.counts.collapsed, 1, 'lines behind a "Read more" collapsible are advisory TEXT COLLAPSED');
    assert.ok(j.findings.some((f) => f.kind === 'TEXT COLLAPSED'));
    assert.ok(!j.findings.some((f) => /collapsed menu|hidden menu/i.test(f.text)), 'collapsed menu must not be reported');
    assert.ok(!j.findings.some((f) => /screen reader/i.test(f.text)), 'sr-only must not be reported');
    assert.ok(j.textBoxes.length > 3, 'visible text line boxes are emitted for --text-boxes');
    assert.ok(!j.textBoxes.some((b) => b.h <= 1), 'no sr-only boxes among the text boxes');
  });
  await check('e2e: a clean page exits 0 with Clipped: 0', async () => {
    const r = await runAsync([`${base}/clean`, '--plain', '--width', '900'], cwd);
    assert.equal(r.code, 0, r.err); assert.match(r.out, /Clipped: 0 /);
  });

  // ---- site auth: a protected origin A whose page loads its stylesheet and image from an open origin B ----
  const fixture = async (fn) => { const fx = await startTwoOriginServer(); try { await fn(fx); } finally { await fx.stop(); } };
  const noLeak = (fx, r) => {
    assert.deepEqual(fx.authorizations('B'), [], 'origin B (the third party) saw no Authorization');
    assert.ok(!`${r.out}${r.err}`.includes(fx.token), 'the token is never printed');
  };
  const probe = ['--plain', '--width', '900'];
  await check('--token-env: the protected page is measured (HTTP 200); the token reaches its origin and not the origin of its stylesheet and image', () => fixture(async (fx) => {
    const r = await runAsync([`${fx.originA}/page`, ...probe, '--token-env', 'FIXTURE_SITE_TOKEN'], cwd, cleanEnv({ FIXTURE_SITE_TOKEN: fx.token }));
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /^clip-probe .*\/page @ 900px — docH \d+, 7 text nodes, 2 controls \(HTTP 200, chromium\)\n/);
    assert.equal(r.err, '');
    assert.ok(fx.a.log.some((e) => e.path === '/page' && e.status === 200 && e.authorization === fx.authorization), 'origin A answered the page 200 to the token');
    assert.ok(['/style.css', '/pic.png'].every((p) => fx.b.log.some((e) => e.path === p && e.status === 200)), 'the sub-resources were fetched from origin B');
    noLeak(fx, r);
  }));
  await check('--auth-header with a bare value and an explicit --auth-origin works the same; --warmup on another origin gets no token', () => fixture(async (fx) => {
    const r = await runAsync([`${fx.originA}/page`, ...probe, '--warmup', `${fx.originB}/page`, '--auth-header', fx.token, '--auth-origin', fx.originA], cwd, cleanEnv());
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /\(HTTP 200, chromium\)/);
    assert.ok(fx.a.log.some((e) => e.path === '/page' && e.status === 200 && e.authorization === fx.authorization), 'a bare value is sent as "token <value>"');
    assert.ok(fx.b.log.some((e) => e.path === '/page'), 'the warm-up page was visited');
    noLeak(fx, r);
  }));
  await check('a token and a --warmup on another origin without --auth-origin: exit 2 before any request, naming the flag', () => fixture(async (fx) => {
    const r = await runAsync([`${fx.originA}/page`, ...probe, '--warmup', `${fx.originB}/page`, '--token-env', 'FIXTURE_SITE_TOKEN'], cwd, cleanEnv({ FIXTURE_SITE_TOKEN: fx.token }));
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.err, /^clip-probe error: .*one origin only and these URLs have 2.*--auth-origin/);
    assert.equal(r.out, '');
    assert.equal(fx.a.log.length + fx.b.log.length, 0, 'no request was made');
    noLeak(fx, r);
  }));
  await check('no flag: nothing is sent — a SITE_TOKEN in the environment and in .env included — and the 401 page is measured with a warning, exit 0, as before', () => fixture(async (fx) => {
    const dir = mkdtempSync(join(cwd, 'cwd-'));
    writeFileSync(join(dir, '.env'), `SITE_TOKEN=${fx.token}\n`);
    const r = await runAsync([`${fx.originA}/page`, ...probe], dir, cleanEnv({ SITE_TOKEN: fx.token }));
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(r.out, `clip-probe ${fx.originA}/page @ 900px — docH 900, 1 text nodes, 0 controls (HTTP 401, chromium)\n  (none)\nClipped: 0 (text clipped 0, text hidden 0, controls hidden 0, controls clipped 0; advisory: clamped 0, collapsed 0, scroll-hidden 0, horizontal 0)\n`);
    assert.equal(r.err, `[live-session] WARNING: HTTP 401 at ${fx.originA}/page — measuring the error page; flags will reflect it\n`);
    assert.ok(fx.a.log.length > 0 && fx.a.log.every((e) => e.authorization === null && e.status === 401), 'origin A saw requests and none carried an Authorization');
    noLeak(fx, r);
  }));
  await check('no auth flag on an open page is unaffected: the same report, nothing sent anywhere', () => fixture(async (fx) => {
    const r = await runAsync([`${fx.originB}/page`, ...probe], cwd, cleanEnv({ SITE_TOKEN: fx.token }));
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /^clip-probe .*\/page @ 900px — docH \d+, 7 text nodes, 2 controls \(HTTP 200, chromium\)\n {2}\(none\)\nClipped: 0 /);
    assert.equal(r.err, '');
    assert.equal(fx.a.log.length, 0, 'origin A was never asked');
    noLeak(fx, r);
  }));
  await check('auth usage errors exit 2 before any request: an unset variable, a flag without its value, a malformed origin', () => fixture(async (fx) => {
    const cases = [
      [['--token-env', 'NO_SUCH_FIXTURE_VAR'], /NO_SUCH_FIXTURE_VAR/],
      [['--token-env'], /--token-env takes the name of an environment variable/],
      [['--auth-header'], /--auth-header needs a value/],
      [['--auth-header', 'x', '--auth-origin', 'not a url'], /--auth-origin needs an http\(s\) URL/],
    ];
    for (const [flags, re] of cases) {
      const r = await runAsync([`${fx.originA}/page`, ...probe, ...flags], cwd, cleanEnv());
      assert.equal(r.code, 2, `${flags.join(' ')}: ${r.out}${r.err}`);
      assert.match(r.err, re); assert.match(r.err, /^clip-probe error: /);
    }
    assert.equal(fx.a.log.length + fx.b.log.length, 0, 'no request was made');
  }));
  server.close(); rmSync(cwd, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
