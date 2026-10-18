#!/usr/bin/env node
// skills/diff/scripts/test/content-presence.test.mjs — the content-presence.mjs differ (#125 D2), no browser:
// alignHeadings (LCS by text, prefix tolerance), diffPresence — HIDDEN LINK ×n for links present but clipped,
// MISSING LINK for absent ones, MOVED LINK when present in another band, cross-kind matching (an origin
// button served as a link is not missing), session-variable regions compared as counts (never MISSING) while
// HIDDEN still counts, CONTROL STATE for a sort trigger, HEADING AS TEXT when the text survives as plain
// text, scope = whole page when one side lacks <main>, chrome items excluded by default; formatReport lines;
// --help in an empty cwd. Site auth (--token-env / --auth-header / --auth-origin): pure (--help lists the flags, an
// absent flag parses to undefined) and, where playwright is importable, against a two-origin fixture whose protected
// origin loads its stylesheet and image from a second one (which also serves the same page, as the served build): the
// token reaches the protected origin and never the other, two origins need --auth-origin (a usage error, exit 1, before any request),
// nothing is sent without a flag — a SITE_TOKEN in the environment and .env included — and that run is the run of
// today (origin side: exit 4 on the 401; served side: the 401 page measured with a warning), and a run with no auth
// flag on open pages is unchanged. Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignHeadings, diffPresence, formatReport, parseArgs } from '../content-presence.mjs';
import { startTwoOriginServer } from '../../../replica/scripts/test/fixtures/two-origin-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'content-presence.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const checkAsync = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
// Async: the fixture servers answer from this process. The child env never carries a site token of the runner's.
const runAsync = (args, cwd, env = process.env) => new Promise((done) => { const ch = spawn(process.execPath, [SCRIPT, ...args], { cwd, env }); let out = ''; let err = ''; ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; }); ch.on('close', (code) => done({ code, out, err })); });
const cleanEnv = (extra = {}) => { const env = { ...process.env, ...extra }; for (const k of ['SITE_TOKEN', 'DEPLOYED_GATE_SITE_TOKEN']) if (!(k in extra)) delete env[k]; return env; };
const it = (kind, text, y, extra = {}) => ({ kind, text, y, x: 0, w: 100, h: 20, state: 'visible', variable: false, inRoot: true, inChrome: false, path: 'p', ...extra });
const inv = (items, root = 'main') => ({ docH: 3000, pageW: 1440, root, items });

check('alignHeadings: LCS in order, prefix-tolerant for long texts', () => {
  assert.deepEqual(alignHeadings(['a', 'b', 'c'], ['a', 'c']), [{ oi: 0, ei: 1 }, { oi: 2, ei: 1 }].map((p, i) => [{ oi: 0, ei: 0 }, { oi: 2, ei: 1 }][i]));
  assert.deepEqual(alignHeadings(['help center topics'], ['help center topics and more']), [{ oi: 0, ei: 0 }]);
  assert.deepEqual(alignHeadings(['x'], ['y']), []);
});
check('HIDDEN LINK ×n when the served links exist but are clipped; exit criterion counts them', () => {
  const o = inv([it('heading', 'Coupons', 100, { level: 1 }), ...Array.from({ length: 3 }, (_, i) => it('link', 'View details', 200 + i * 10, { href: '/d' }))]);
  const e = inv([it('heading', 'Coupons', 100, { level: 1 }), ...Array.from({ length: 3 }, (_, i) => it('link', 'View details', 200 + i * 10, { href: '/d', state: 'hidden' }))]);
  const r = diffPresence(o, e);
  const f = r.findings.find((x) => x.kind === 'HIDDEN LINK');
  assert.ok(f && f.n === 3, JSON.stringify(r.findings)); assert.equal(r.totals.hidden, 3); assert.equal(r.totals.missing, 0); assert.equal(r.bands[1].eds.linkHidden, 3);
});
check('MISSING LINK when absent, MOVED LINK when visible in another band, EXTRA LINK for build-only', () => {
  const o = inv([it('heading', 'A', 100, { level: 2 }), it('link', 'Contact', 150, { href: '/c' }), it('heading', 'B', 500, { level: 2 }), it('link', 'Careers', 550, { href: '/j' })]);
  const e = inv([it('heading', 'A', 100, { level: 2 }), it('heading', 'B', 500, { level: 2 }), it('link', 'Contact', 550, { href: '/c' }), it('link', 'Newsroom', 560, { href: '/n' })]);
  const r = diffPresence(o, e);
  assert.deepEqual(r.findings.map((x) => x.kind).sort(), ['EXTRA LINK', 'MISSING LINK', 'MOVED LINK']);
  assert.equal(r.totals.missing, 1);
});
check('cross-kind: an origin button served as a link is present; an origin link served as a button is present', () => {
  const o = inv([it('heading', 'H', 10, { level: 1 }), it('button', 'Sign in', 20), it('link', 'Join', 30, { href: '/j' })]);
  const e = inv([it('heading', 'H', 10, { level: 1 }), it('link', 'Sign in', 20, { href: '/s' }), it('button', 'Join', 30)]);
  const r = diffPresence(o, e);
  assert.equal(r.findings.length, 0, JSON.stringify(r.findings));
});
check('session-variable region: counts only (never MISSING), HIDDEN still 🔴', () => {
  const o = inv([it('heading', 'H', 10, { level: 1 }), ...Array.from({ length: 6 }, (_, i) => it('link', `Coupon ${i}`, 100 + i, { href: '/c', variable: true }))]);
  const e = inv([it('heading', 'H', 10, { level: 1 }), ...Array.from({ length: 2 }, (_, i) => it('link', `Other ${i}`, 100 + i, { href: '/o', variable: true })), it('link', 'Clipped one', 120, { href: '/x', variable: true, state: 'hidden' })]);
  const r = diffPresence(o, e);
  assert.ok(!r.findings.some((x) => x.kind === 'MISSING LINK'), JSON.stringify(r.findings));
  assert.ok(r.findings.some((x) => x.kind === 'COUNT LINKS'));
  assert.equal(r.totals.hidden, 1); assert.equal(r.bands[1].variable, true);
});
check('CONTROL STATE for a trigger with the same label and a different value; COUNT control matched by via', () => {
  const o = inv([it('heading', 'H', 10, { level: 1 }), it('control', '', 20, { label: 'sort by', value: 'Recommended', via: 'trigger' }), it('control', '', 30, { label: 'count coupon', value: '285', via: 'count' })]);
  const e = inv([it('heading', 'H', 10, { level: 1 }), it('control', '', 20, { label: 'sort by', value: 'Expiration Date', via: 'trigger' }), it('control', '', 30, { label: 'count coupon', value: '284', via: 'count' })]);
  const r = diffPresence(o, e);
  assert.equal(r.findings.filter((x) => x.kind === 'CONTROL STATE').length, 2, JSON.stringify(r.findings)); assert.equal(r.totals.controlState, 2); assert.equal(r.totals.structural, 0);
});
check('a specifically labelled control with no counterpart is CONTROL MISSING (never paired by ordinal); generic ones pair by ordinal', () => {
  const o = inv([it('heading', 'H', 10, { level: 1 }), it('control', '', 20, { label: 'rebate help', value: 'rebate help', via: 'trigger' }), it('control', '', 25, { label: 'trigger', value: 'Menu A', via: 'trigger' })]);
  const e = inv([it('heading', 'H', 10, { level: 1 }), it('control', '', 20, { label: 'trigger', value: 'Menu B', via: 'trigger' })]);
  const r = diffPresence(o, e);
  assert.ok(r.findings.some((x) => x.kind === 'CONTROL MISSING' && /rebate/.test(x.msg)));
  assert.ok(r.findings.some((x) => x.kind === 'CONTROL STATE' && /Menu A.*Menu B/.test(x.msg)));
});
check('HEADING AS TEXT (🟡) when the text is served as plain text; MISSING HEADING (🔴) when it is gone', () => {
  const o = inv([it('heading', 'Rx information', 100, { level: 3 }), it('heading', 'Gone', 300, { level: 2 })]);
  const e = inv([it('text', 'Rx information', 100)]);
  const r = diffPresence(o, e);
  assert.ok(r.findings.some((x) => x.kind === 'HEADING AS TEXT' && x.sev === '🟡'));
  assert.ok(r.findings.some((x) => x.kind === 'MISSING HEADING' && x.sev === '🔴')); assert.equal(r.totals.missingHeadings, 1);
});
check('scope: whole page when one side has no root; chrome items excluded unless { chrome: true }', () => {
  const o = inv([it('link', 'Promo strip', 5, { href: '/p', inRoot: null, inChrome: true }), it('link', 'Body link', 400, { href: '/b', inRoot: null })], null);
  const e = inv([it('link', 'Body link', 400, { href: '/b', inRoot: true })], 'main');
  assert.equal(diffPresence(o, e).scope, 'page');
  assert.equal(diffPresence(o, e).findings.length, 0);
  assert.equal(diffPresence(o, e, { chrome: true }).totals.missing, 1);
});
check('formatReport: band table + Content/Findings lines', () => {
  const o = inv([it('heading', 'H', 10, { level: 1 }), it('link', 'A', 20, { href: '/a' })]);
  const r = diffPresence(o, inv([it('heading', 'H', 10, { level: 1 })]));
  const s = formatReport(r);
  assert.match(s, /\| band \| heading/); assert.match(s, /MISSING LINK: "A"/); assert.match(s, /Content: MISSING 1/); assert.match(s, /Findings: 1 \(1 structural/);
});
check('--help exits 0 in an empty cwd and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'content-presence-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.match(r.stdout, /Usage: node content-presence\.mjs/); assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
});
check('--help lists the three site-auth flags', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  for (const flag of ['--token-env <NAME>', '--auth-header <value>', '--auth-origin <url>']) assert.ok(r.stdout.includes(flag), flag);
  assert.match(r.stdout, /2 any MISSING\/HIDDEN link or heading, 1 error \(a usage error, a site-auth one included\)/);
});
check('parseArgs: an absent site-auth flag stays undefined (never ""), a given one is read, a missing value is ""', () => {
  const urls = ['https://a.test/', 'http://127.0.0.1:1/x'];
  const none = parseArgs(['node', 'x', ...urls]);
  for (const k of ['tokenEnv', 'authHeader', 'authOrigin']) assert.equal(none[k], undefined, k);
  const all = parseArgs(['node', 'x', ...urls, '--token-env', 'MY_TOKEN', '--auth-header', 'token abc', '--auth-origin', 'https://a.test']);
  assert.deepEqual([all.tokenEnv, all.authHeader, all.authOrigin, all.origin, all.eds], ['MY_TOKEN', 'token abc', 'https://a.test', urls[0], urls[1]]);
  const bare = parseArgs(['node', 'x', ...urls, '--token-env']);
  assert.equal(bare.tokenEnv, ''); assert.deepEqual([bare.origin, bare.eds], urls);
  const next = parseArgs(['node', 'x', ...urls, '--auth-header', '--plain']);
  assert.equal(next.authHeader, ''); assert.equal(next.plain, true);
});

let playwright = true;
try { await import('playwright'); } catch { playwright = false; }
if (!playwright) { console.log('skip  end-to-end site auth (playwright not importable here)'); }
else {
  // ---- site auth: a protected origin A whose page loads its stylesheet and image from an open origin B, which also serves the page ----
  const cwd = mkdtempSync(join(tmpdir(), 'content-presence-e2e-'));
  const fixture = async (fn) => { const fx = await startTwoOriginServer(); try { await fn(fx); } finally { await fx.stop(); } };
  const noLeak = (fx, r) => {
    assert.deepEqual(fx.authorizations('B'), [], 'origin B (the third party and the served build) saw no Authorization');
    assert.ok(!`${r.out}${r.err}`.includes(fx.token), 'the token is never printed');
  };
  const probe = ['--plain', '--width', '900', '--settle-passes', '1'];
  const clean = /Findings: none — every visible origin heading and link is visible on the served page/;

  await checkAsync('--token-env, both URLs on the protected origin: no --auth-origin needed; the token reaches A and not the origin of its stylesheet and image', () => fixture(async (fx) => {
    const r = await runAsync([`${fx.originA}/page`, `${fx.originA}/copy`, ...probe, '--token-env', 'FIXTURE_SITE_TOKEN'], cwd, cleanEnv({ FIXTURE_SITE_TOKEN: fx.token }));
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /origin .*\/page \(docH \d+, \d+ items, HTTP 200\) vs served .*\/copy \(docH \d+, \d+ items, HTTP 200\)/);
    assert.match(r.out, clean);
    for (const path of ['/page', '/copy']) assert.ok(fx.a.log.some((e) => e.path === path && e.status === 200 && e.authorization === fx.authorization), `${path} answered 200 to the token`);
    assert.ok(['/style.css', '/pic.png'].every((p) => fx.b.log.some((e) => e.path === p && e.status === 200)), 'the sub-resources were fetched from origin B');
    noLeak(fx, r);
  }));
  await checkAsync('two origins with --auth-origin (a bare --auth-header value): the protected origin is compared to the open served page, which gets no token', () => fixture(async (fx) => {
    const r = await runAsync([`${fx.originA}/page`, `${fx.originB}/page`, ...probe, '--auth-header', fx.token, '--auth-origin', fx.originA], cwd, cleanEnv());
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, clean);
    assert.ok(fx.a.log.some((e) => e.path === '/page' && e.status === 200 && e.authorization === fx.authorization), 'a bare value is sent as "token <value>"');
    assert.ok(fx.b.log.some((e) => e.path === '/page' && e.status === 200), 'the served page was measured');
    noLeak(fx, r);
  }));
  await checkAsync('a token and two origins without --auth-origin: a usage error (exit 1, not the MISSING/HIDDEN code) before any request, naming the flag', () => fixture(async (fx) => {
    const r = await runAsync([`${fx.originA}/page`, `${fx.originB}/page`, ...probe, '--token-env', 'FIXTURE_SITE_TOKEN'], cwd, cleanEnv({ FIXTURE_SITE_TOKEN: fx.token }));
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.err, /^content-presence error: .*one origin only and these URLs have 2.*--auth-origin/);
    assert.equal(r.out, '');
    assert.equal(fx.a.log.length + fx.b.log.length, 0, 'no request was made');
    noLeak(fx, r);
  }));

  await checkAsync('no flag, protected ORIGIN side: nothing is sent — a SITE_TOKEN in the environment and in .env included — and the 401 fails as before (exit 4, naming it)', () => fixture(async (fx) => {
    const dir = mkdtempSync(join(cwd, 'cwd-'));
    writeFileSync(join(dir, '.env'), `SITE_TOKEN=${fx.token}\n`);
    const r = await runAsync([`${fx.originA}/page`, `${fx.originB}/page`, ...probe], dir, cleanEnv({ SITE_TOKEN: fx.token }));
    assert.deepEqual([r.code, r.out], [4, '']);
    assert.equal(r.err, `content-presence error: HTTP 401 at ${fx.originA}/page — not a challenge marker, but not the page either; refusing to measure it\n`);
    assert.ok(fx.a.log.length > 0 && fx.a.log.every((e) => e.authorization === null && e.status === 401), 'origin A saw requests and none carried an Authorization');
    noLeak(fx, r);
  }));
  await checkAsync('no flag, protected SERVED side: nothing is sent and the 401 page is measured with a warning, as before (exit 2: the origin headings read MISSING)', () => fixture(async (fx) => {
    const dir = mkdtempSync(join(cwd, 'cwd-'));
    writeFileSync(join(dir, '.env'), `SITE_TOKEN=${fx.token}\n`);
    const r = await runAsync([`${fx.originB}/page`, `${fx.originA}/page`, ...probe], dir, cleanEnv({ SITE_TOKEN: fx.token }));
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.out, /vs served .*\/page \(docH \d+, 1 items, HTTP 401\)/);
    assert.match(r.out, /🔴 MISSING HEADING: h1 "protected fixture"/);
    assert.equal(r.err, `[live-session] WARNING: HTTP 401 at ${fx.originA}/page — measuring the error page; flags will reflect it\n`);
    assert.ok(fx.a.log.length > 0 && fx.a.log.every((e) => e.authorization === null && e.status === 401), 'origin A saw requests and none carried an Authorization');
    noLeak(fx, r);
  }));
  await checkAsync('no auth flag on open pages is unaffected: the same report, nothing sent anywhere', () => fixture(async (fx) => {
    const r = await runAsync([`${fx.originB}/page`, `${fx.originB}/copy`, ...probe], cwd, cleanEnv({ SITE_TOKEN: fx.token }));
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(r.err, '');
    assert.match(r.out, /^content-presence @ 900px \(chromium\) — origin .*\/page \(docH \d+, \d+ items, HTTP 200\) vs served .*\/copy \(docH \d+, \d+ items, HTTP 200\)\n/);
    assert.match(r.out, clean);
    assert.equal(fx.a.log.length, 0, 'origin A was never asked');
    noLeak(fx, r);
  }));
  await checkAsync('auth usage errors exit 1 (not the MISSING/HIDDEN code) before any request: an unset variable, a flag without its value, a malformed origin', () => fixture(async (fx) => {
    const urls = [`${fx.originA}/page`, `${fx.originA}/copy`];
    const cases = [
      [['--token-env', 'NO_SUCH_FIXTURE_VAR'], /no site token: the variable --token-env names is not set \(or is empty\) in the environment or in \.env/],
      [['--token-env'], /--token-env takes the name of an environment variable/],
      [['--auth-header'], /--auth-header needs a value/],
      [['--auth-header', 'x', '--auth-origin', 'not a url'], /--auth-origin needs an http\(s\) URL/],
    ];
    for (const [flags, re] of cases) {
      const r = await runAsync([...urls, ...probe, ...flags], cwd, cleanEnv());
      assert.equal(r.code, 1, `${flags.join(' ')}: ${r.out}${r.err}`);
      assert.match(r.err, re); assert.match(r.err, /^content-presence error: /);
    }
    assert.equal(fx.a.log.length + fx.b.log.length, 0, 'no request was made');
  }));
  rmSync(cwd, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
