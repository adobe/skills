#!/usr/bin/env node
// skills/diff/scripts/test/live-session.test.mjs — live-session.mjs instrument auth, no browser:
// instrumentAuth is opt-in (null without --token-env / --auth-header, whatever SITE_TOKEN is in the environment
// or .env), origin-scoped (the one origin of the URLs, else --auth-origin, else exit 2), reads a variable from the
// environment then a cwd .env with resolveSiteAuth's grammar, and never puts a value in its error text;
// resolveSiteAuth keeps its SITE_TOKEN default. Run: node <this file>.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTH_HELP, instrumentAuth, resolveSiteAuth } from '../live-session.mjs';

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
const withDir = (envFile, fn) => {
  const cwd = mkdtempSync(join(tmpdir(), 'live-session-auth-'));
  try {
    if (envFile !== null) writeFileSync(join(cwd, '.env'), envFile);
    return fn(cwd);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
};
const fails = (fn, re) => {
  let err;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err, 'expected a throw');
  assert.equal(err.code, 2);
  assert.match(err.message, re);
  return err.message;
};
const PAGE = 'https://main--site--org.aem.page/products/a?x=1';

check('no flag → null, even with SITE_TOKEN in the environment and in .env', () => withDir('SITE_TOKEN=from-dotenv\n', (cwd) => {
  assert.equal(instrumentAuth({ urls: [PAGE], env: { SITE_TOKEN: 'from-env' }, cwd }), null);
  assert.equal(instrumentAuth({ tokenEnv: undefined, authHeader: undefined, urls: [PAGE], env: { SITE_TOKEN: 'from-env' }, cwd }), null);
}));
check('--token-env reads the environment, adds "token ", scopes to the page origin', () => withDir(null, (cwd) => {
  assert.deepEqual(instrumentAuth({ tokenEnv: 'MY_TOKEN', urls: [PAGE], env: { MY_TOKEN: 'abc123' }, cwd }), { authOrigin: 'https://main--site--org.aem.page', authHeader: 'token abc123' });
}));
check('the environment wins over .env; .env is read when the variable is unset', () => withDir('MY_TOKEN=from-dotenv\n', (cwd) => {
  assert.equal(instrumentAuth({ tokenEnv: 'MY_TOKEN', urls: [PAGE], env: { MY_TOKEN: 'from-env' }, cwd }).authHeader, 'token from-env');
  assert.equal(instrumentAuth({ tokenEnv: 'MY_TOKEN', urls: [PAGE], env: {}, cwd }).authHeader, 'token from-dotenv');
}));
check('.env grammar: ^NAME=(.*)$, trimmed, one pair of quotes stripped, other lines and names ignored', () => {
  const read = (envFile) => withDir(envFile, (cwd) => instrumentAuth({ tokenEnv: 'MY_TOKEN', urls: [PAGE], env: {}, cwd }).authHeader);
  assert.equal(read('MY_TOKEN=plain\n'), 'token plain');
  assert.equal(read('MY_TOKEN="double quoted"\n'), 'token double quoted');
  assert.equal(read("MY_TOKEN='single'\n"), 'token single');
  assert.equal(read('MY_TOKEN=  spaced  \r\n'), 'token spaced');
  assert.equal(read('OTHER=x\n# MY_TOKEN=commented\nMY_TOKEN=real\nMY_TOKEN_2=no\n'), 'token real');
  assert.equal(read('MY_TOKEN=bearer abc\n'), 'bearer abc');
});
check('a value that starts with token / bearer (any case) is kept; any other value gets "token "', () => withDir(null, (cwd) => {
  const via = (v) => instrumentAuth({ tokenEnv: 'MY_TOKEN', urls: [PAGE], env: { MY_TOKEN: v }, cwd }).authHeader;
  assert.equal(via('token abc'), 'token abc');
  assert.equal(via('Bearer abc'), 'Bearer abc');
  assert.equal(via('BEARER abc'), 'BEARER abc');
  assert.equal(via('tokenabc'), 'token tokenabc');
  assert.equal(via('abc'), 'token abc');
}));
check('--auth-header goes through the same prefix rule and needs no variable', () => withDir('SITE_TOKEN=ignored\n', (cwd) => {
  assert.equal(instrumentAuth({ authHeader: 'abc', urls: [PAGE], env: {}, cwd }).authHeader, 'token abc');
  assert.equal(instrumentAuth({ authHeader: 'bearer abc', urls: [PAGE], env: {}, cwd }).authHeader, 'bearer abc');
  assert.equal(instrumentAuth({ authHeader: 'token abc', tokenEnv: 'UNSET_VAR', urls: [PAGE], env: {}, cwd }).authHeader, 'token abc');
}));
check('origin: one URL → its origin; several URLs of one origin → that origin; ports kept', () => withDir(null, (cwd) => {
  const o = (urls) => instrumentAuth({ authHeader: 't', urls, env: {}, cwd }).authOrigin;
  assert.equal(o(['https://a.example.com/x/y?z#h']), 'https://a.example.com');
  assert.equal(o(['https://a.example.com/', 'https://a.example.com/other']), 'https://a.example.com');
  assert.equal(o(['http://127.0.0.1:3000/p']), 'http://127.0.0.1:3000');
}));
check('two origins without --auth-origin → exit 2 naming --auth-origin; no URL → exit 2 too', () => withDir(null, (cwd) => {
  const msg = fails(() => instrumentAuth({ authHeader: 'secret-value', urls: [PAGE, 'http://127.0.0.1:4173/reskin.html'], env: {}, cwd }), /--auth-origin/);
  assert.ok(!msg.includes('secret-value'), msg);
  fails(() => instrumentAuth({ authHeader: 'x', urls: ['https://a.example.com/', 'https://b.example.com/'], env: {}, cwd }), /--auth-origin/);
  fails(() => instrumentAuth({ authHeader: 'x', urls: [], env: {}, cwd }), /--auth-origin/);
  fails(() => instrumentAuth({ authHeader: 'x', env: {}, cwd }), /--auth-origin/);
}));
check('--auth-origin decides with several origins; its path, query and case are stripped', () => withDir(null, (cwd) => {
  const r = instrumentAuth({ authHeader: 'abc', authOrigin: 'https://Main--Site--Org.aem.page/some/path?q=1', urls: [PAGE, 'http://127.0.0.1:4173/reskin.html'], env: {}, cwd });
  assert.deepEqual(r, { authOrigin: 'https://main--site--org.aem.page', authHeader: 'token abc' });
}));
check('--auth-origin must be an http(s) origin → exit 2 naming --auth-origin, never echoing the value', () => withDir(null, (cwd) => {
  for (const bad of ['not a url', 'ftp://a.example.com', 'file:///tmp/x', 'javascript:alert(1)']) {
    const msg = fails(() => instrumentAuth({ authHeader: 'x', authOrigin: bad, urls: [PAGE], env: {}, cwd }), /--auth-origin/);
    assert.ok(!msg.includes(bad), msg);
  }
}));
check('an unset variable → exit 2 naming the flag, not the variable, and no other variable\'s value', () => withDir('SITE_TOKEN=dotenv-secret\nOTHER=another-secret\n', (cwd) => {
  const msg = fails(() => instrumentAuth({ tokenEnv: 'MY_TOKEN', urls: [PAGE], env: { SITE_TOKEN: 'env-secret' }, cwd }), /^no site token: the variable --token-env names is not set \(or is empty\) in the environment or in \.env$/);
  for (const secret of ['MY_TOKEN', 'env-secret', 'dotenv-secret', 'another-secret']) assert.ok(!msg.includes(secret), msg);
}));
check('an empty value counts as unset', () => withDir('A=\nB=""\nC=   \n', (cwd) => {
  for (const name of ['A', 'B', 'C', 'D']) fails(() => instrumentAuth({ tokenEnv: name, urls: [PAGE], env: { D: '' }, cwd }), /--token-env/);
}));
check('--token-env takes a variable name: a token typed there is refused without echoing it, even one shaped like a name', () => withDir(null, (cwd) => {
  const msg = fails(() => instrumentAuth({ tokenEnv: 'token abc.def-123', urls: [PAGE], env: {}, cwd }), /--token-env/);
  assert.ok(!msg.includes('abc.def-123'), msg);
  const shaped = fails(() => instrumentAuth({ tokenEnv: 'hlx_AbC123secretValue', urls: [PAGE], env: {}, cwd }), /--token-env/);
  assert.ok(!shaped.includes('hlx_AbC123secretValue'), shaped);
}));
check('a flag given blank is a usage error, not a silent no-auth run', () => withDir(null, (cwd) => {
  fails(() => instrumentAuth({ authHeader: '   ', urls: [PAGE], env: {}, cwd }), /--auth-header/);
  fails(() => instrumentAuth({ tokenEnv: '', urls: [PAGE], env: {}, cwd }), /--token-env/);
  assert.equal(instrumentAuth({ tokenEnv: null, authHeader: null, urls: [PAGE], env: { SITE_TOKEN: 'x' }, cwd }), null);
}));
check('AUTH_HELP: one line per flag, in one wording', () => {
  const lines = AUTH_HELP.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^--token-env <NAME>/);
  assert.match(lines[1], /^--auth-header <value>/);
  assert.match(lines[2], /^--auth-origin <url>/);
  assert.match(AUTH_HELP, /never printed/i);
});
check('resolveSiteAuth keeps its behaviour: --auth-header verbatim, SITE_TOKEN by default, .env fallback, null when none', () => withDir('SITE_TOKEN=from-dotenv\n', (cwd) => {
  const saved = { cwd: process.cwd(), argv: process.argv, env: process.env.SITE_TOKEN, named: process.env.NAMED_VAR };
  try {
    process.chdir(cwd);
    process.argv = [process.argv[0], 'x'];
    delete process.env.SITE_TOKEN;
    assert.equal(resolveSiteAuth(), 'token from-dotenv');
    process.env.SITE_TOKEN = 'from-env';
    assert.equal(resolveSiteAuth(), 'token from-env');
    process.env.NAMED_VAR = 'bearer named';
    assert.equal(resolveSiteAuth({ tokenEnv: 'NAMED_VAR' }), 'bearer named');
    assert.equal(resolveSiteAuth({ authHeader: 'raw value' }), 'raw value');
    process.argv = [process.argv[0], 'x', '--token-env', 'NAMED_VAR'];
    assert.equal(resolveSiteAuth(), 'bearer named');
    process.argv = [process.argv[0], 'x', '--auth-header', 'argv-header'];
    assert.equal(resolveSiteAuth(), 'argv-header');
    process.argv = [process.argv[0], 'x'];
    delete process.env.SITE_TOKEN;
    writeFileSync(join(cwd, '.env'), '');
    assert.equal(resolveSiteAuth(), null);
  } finally {
    process.chdir(saved.cwd);
    process.argv = saved.argv;
    if (saved.env === undefined) delete process.env.SITE_TOKEN; else process.env.SITE_TOKEN = saved.env;
    if (saved.named === undefined) delete process.env.NAMED_VAR; else process.env.NAMED_VAR = saved.named;
  }
}));

// ---- in Chromium: the token goes to its origin and to no other, never across a redirect (skipped without playwright) ----
const browserAvailable = await import('playwright').then(async ({ chromium }) => { const b = await chromium.launch(); await b.close(); return true; }, () => false);
if (!browserAvailable) console.log('skip  live-session Chromium checks (playwright or Chromium not importable here; run this test in an environment that has them)');
else {
  const { chromium } = await import('playwright');
  const { startTwoOriginServer } = await import('../../../replica/scripts/test/fixtures/two-origin-server.mjs');
  const { newLiveContext, attachOriginAuth, standardHeaders } = await import('../live-session.mjs');
  const checkAsync = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${String(e.message).split('\n').join('\n  ')}`); } };
  const browser = await chromium.launch();
  const session = async (open, fn) => {
    const fx = await startTwoOriginServer();
    const ctx = await open(fx);
    try { await fn(fx, await ctx.newPage()); } finally { await ctx.close(); await fx.stop(); }
  };
  const live = (fx) => newLiveContext(browser, { authOrigin: fx.originA, authHeader: fx.authorization });
  const plain = (fx) => browser.newContext().then(async (ctx) => { await attachOriginAuth(ctx, fx.originA, fx.authorization); return ctx; });
  const seenOnA = (fx, path) => fx.a.log.filter((e) => e.path === path);
  const asked = (fx, path) => seenOnA(fx, path).map((e) => [e.status, e.authorization]);
  const withStderr = async (fn) => {
    const lines = [];
    const write = process.stderr.write;
    process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
    try { await fn(); } finally { process.stderr.write = write; }
    return lines.join('');
  };
  const redirected = (origin, from, to) => `live-session: ${origin} redirected ${from} → ${to}; a site token is never replayed across a redirect — measure the final URL\n`;
  // a navigation that is expected to fail: its error (null when it did not fail) and what went to stderr meanwhile
  const failing = async (page, url) => {
    let error;
    const err = await withStderr(async () => { error = await page.goto(url, { timeout: 15000, waitUntil: 'load' }).then(() => null, (e) => e); });
    return { error, err };
  };
  const imageWidth = (page, src) => page.evaluate((u) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i.naturalWidth); i.onerror = () => resolve(-1); i.src = u; }), src);

  for (const [kind, open] of [['newLiveContext', live], ['attachOriginAuth on a plain context', plain]]) {
    await checkAsync(`${kind}: a redirect off the origin (a page): origin A sees the token once, origin B — the page, its stylesheet and image — none`, () => session(open, async (fx, page) => {
      await page.goto(`${fx.originA}/hop-b`, { waitUntil: 'load' });
      assert.equal(page.url(), `${fx.originB}/page`, 'the redirect was followed');
      assert.deepEqual(asked(fx, '/hop-b'), [[302, fx.authorization]], 'origin A was asked once, with the token');
      assert.ok(['/page', '/style.css', '/pic.png'].every((p) => fx.b.log.some((e) => e.path === p && e.status === 200)), 'origin B served the page and its sub-resources');
      assert.deepEqual(fx.authorizations('B'), [], 'origin B saw no Authorization');
    }));
    // The reviewer's case: the origin's first answer sets a cookie, and the same request asked again with it is sent
    // to the other origin. Walking the first redirect and then letting the browser replay its request with the header
    // sent the token there.
    await checkAsync(`${kind}: a redirect within the origin that a cookie turns off it on the next ask: the navigation fails loudly and origin B never sees the token`, () => session(open, async (fx, page) => {
      const first = await failing(page, `${fx.originA}/cookie-hop`);
      assert.ok(first.error, 'the navigation failed');
      assert.equal(first.err, redirected(fx.originA, '/cookie-hop', '/page'));
      assert.deepEqual(fx.a.log.map((e) => [e.path, e.status, e.authorization, e.cookie]), [['/cookie-hop', 302, fx.authorization, null]], 'one ask, with the token; the redirect target was never asked');
      // asked again (from a fresh tab: the first one is still showing its error page), now with the cookie the first
      // answer set: the redirect leaves the origin, and the browser follows it on its own, without the token
      const tab = await page.context().newPage();
      const again = await failing(tab, `${fx.originA}/cookie-hop`);
      assert.equal(again.error, null, 'the second navigation succeeded');
      assert.equal(tab.url(), `${fx.originB}/page`, 'it ended on origin B');
      assert.deepEqual(fx.a.log.map((e) => [e.path, e.status, e.authorization, e.cookie]), [['/cookie-hop', 302, fx.authorization, null], ['/cookie-hop', 302, fx.authorization, 'hopped=1']]);
      assert.deepEqual(seenOnA(fx, '/page'), [], 'origin A\'s redirect target was never asked');
      assert.ok(fx.b.log.some((e) => e.path === '/page' && e.status === 200), 'origin B served the page');
      assert.deepEqual(fx.authorizations('B'), [], 'origin B saw an Authorization');
      assert.ok(!`${first.err}${again.err}`.includes(fx.token), 'the token is not printed');
    }));
    await checkAsync(`${kind}: a redirect within the origin that turns off it on the second ask: the first ask fails loudly, the second ends on origin B without the token`, () => session(open, async (fx, page) => {
      const first = await failing(page, `${fx.originA}/count-hop`);
      assert.ok(first.error, 'the first navigation failed');
      assert.equal(first.err, redirected(fx.originA, '/count-hop', '/page'));
      const tab = await page.context().newPage();
      await tab.goto(`${fx.originA}/count-hop`, { waitUntil: 'load' });
      assert.equal(tab.url(), `${fx.originB}/page`);
      assert.deepEqual(asked(fx, '/count-hop'), [[302, fx.authorization], [302, fx.authorization]], 'each navigation asked origin A once, with the token');
      assert.deepEqual(seenOnA(fx, '/page'), []);
      assert.ok(fx.b.log.some((e) => e.path === '/page' && e.status === 200), 'origin B served the page');
      assert.deepEqual(fx.authorizations('B'), [], 'origin B saw an Authorization');
    }));
  }
  await checkAsync('a redirect within the origin (A → A): the navigation fails, one stderr line names the origin and the two paths, the target is never asked', () => session(live, async (fx, page) => {
    const { error, err } = await failing(page, `${fx.originA}/hop-a`);
    assert.ok(error, 'the navigation failed');
    assert.equal(err, redirected(fx.originA, '/hop-a', '/page'));
    assert.deepEqual(fx.a.log.map((e) => [e.path, e.status, e.authorization]), [['/hop-a', 302, fx.authorization]], 'one ask, with the token, and nothing after it');
    assert.deepEqual(fx.b.log, []);
  }));
  await checkAsync('a redirect within the origin and then off it (A → A → B): stopped at the first hop; the token never reaches the other origin', () => session(live, async (fx, page) => {
    const { error, err } = await failing(page, `${fx.originA}/hop-ab`);
    assert.ok(error, 'the navigation failed');
    assert.equal(err, redirected(fx.originA, '/hop-ab', '/hop-b'));
    assert.deepEqual(fx.a.log.map((e) => [e.path, e.status, e.authorization]), [['/hop-ab', 302, fx.authorization]]);
    assert.deepEqual(fx.b.log, [], 'origin B was never asked');
  }));
  await checkAsync('a same-origin redirect loop is one tokened ask, aborted: the navigation fails, one stderr line names the origin and the path', () => session(live, async (fx, page) => {
    const { error, err } = await failing(page, `${fx.originA}/loop`);
    assert.ok(error, 'the navigation failed');
    assert.equal(err, redirected(fx.originA, '/loop', '/loop'));
    assert.ok(!err.includes(fx.token), 'the token is not printed');
    assert.deepEqual(fx.a.log.map((e) => [e.path, e.status, e.authorization]), [['/loop', 302, fx.authorization]]);
    assert.deepEqual(fx.authorizations('B'), []);
  }));
  await checkAsync('a sub-resource redirected off the origin (an image) loads; origin A sees the token once, origin B none', () => session(live, async (fx, page) => {
    await page.goto(`${fx.originA}/page`, { waitUntil: 'load' });
    fx.reset();
    assert.equal(await imageWidth(page, '/hop-pic'), 1, 'the image behind the redirect loaded');
    assert.deepEqual(asked(fx, '/hop-pic'), [[302, fx.authorization]]);
    assert.ok(fx.b.log.some((e) => e.path === '/pic.png' && e.status === 200));
    assert.deepEqual(fx.authorizations('B'), []);
  }));
  await checkAsync('a sub-resource redirected within the origin (an image, A → A) fails with one stderr line; its target is never asked', () => session(live, async (fx, page) => {
    await page.goto(`${fx.originA}/page`, { waitUntil: 'load' });
    fx.reset();
    let width;
    const err = await withStderr(async () => { width = await imageWidth(page, '/hop-a'); });
    assert.equal(width, -1, 'the image request failed');
    assert.equal(err, redirected(fx.originA, '/hop-a', '/page'));
    assert.deepEqual(fx.a.log.map((e) => [e.path, e.status, e.authorization]), [['/hop-a', 302, fx.authorization]]);
    assert.deepEqual(fx.authorizations('B'), []);
  }));
  await checkAsync('the standard header set reaches document requests on both paths (the origin\'s, made by the auth route, and another origin\'s), and stays off sub-resources', () => session(live, async (fx, page) => {
    await page.goto(`${fx.originA}/page`, { waitUntil: 'load' });
    await page.goto(`${fx.originB}/page`, { waitUntil: 'load' });
    const accept = standardHeaders().Accept;
    for (const [side, log] of [['A', fx.a.log], ['B', fx.b.log]]) {
      const docs = log.filter((e) => e.path === '/page');
      assert.ok(docs.length > 0 && docs.every((e) => e.accept === accept), `origin ${side}: ${JSON.stringify(docs)}`);
    }
    assert.notEqual(fx.b.log.find((e) => e.path === '/pic.png').accept, accept, 'the standard Accept stays off sub-resources');
    assert.deepEqual(fx.authorizations('B'), []);
  }));
  await checkAsync('no auth given: nothing is sent and nothing is stopped, the redirect routes included', () => session((fx) => newLiveContext(browser, {}), async (fx, page) => {
    let answers;
    const err = await withStderr(async () => { answers = []; for (const p of ['/hop-b', '/hop-a', '/cookie-hop', '/count-hop']) answers.push((await page.goto(`${fx.originA}${p}`, { waitUntil: 'load' })).status()); });
    assert.deepEqual(answers, [401, 401, 401, 401], 'each page loaded, as the 401 the protected origin answers');
    assert.equal(err, '');
    assert.deepEqual(fx.a.log.map((e) => [e.path, e.authorization, e.status]), [['/hop-b', null, 401], ['/hop-a', null, 401], ['/cookie-hop', null, 401], ['/count-hop', null, 401]]);
    assert.deepEqual(fx.authorizations('B'), []);
  }));

  // A request to the origin that cannot be made (dropped, stalled) fails the navigation: it is never continued, which
  // would send it without the token and let the instrument measure a 401 page as the site.
  const { createServer } = await import('node:http');
  const silent = (behave) => new Promise((resolve) => {
    const seen = [];
    const server = createServer((req, res) => { seen.push(req.headers.authorization || null); behave(req, res); });
    server.listen(0, '127.0.0.1', () => resolve({ seen, origin: `http://127.0.0.1:${server.address().port}`, stop: () => { server.closeAllConnections(); server.close(); } }));
  });
  // Closing a context resumes the requests still paused in it, so a stalled request reaches the origin bare as the
  // browser is torn down; the navigation has failed by then, and what is asserted is the time before.
  for (const [kind, behave, navigationTimeout, strictToTheEnd] of [['drops the connection', (req) => req.socket.destroy(), 15000, true], ['stalls', () => {}, 1500, false]]) {
    await checkAsync(`the origin ${kind}: the navigation fails, one stderr line names the origin, no request goes out without the token`, async () => {
      const srv = await silent(behave);
      const ctx = await newLiveContext(browser, { authOrigin: srv.origin, authHeader: 'token t0k3n' });
      let navigation;
      let whileOpen;
      // a stalled request ends when the context closes, so the stderr line is collected up to then
      const err = await withStderr(async () => {
        const page = await ctx.newPage();
        navigation = await page.goto(`${srv.origin}/page`, { timeout: navigationTimeout, waitUntil: 'load' }).then(() => null, (e) => e);
        await new Promise((r) => { setTimeout(r, 300); });
        whileOpen = [...srv.seen];
        await ctx.close();
        await new Promise((r) => { setTimeout(r, 200); });
      });
      srv.stop();
      assert.ok(navigation, 'the navigation failed');
      assert.match(err, new RegExp(`^live-session: a request to ${srv.origin.replace(/[.:/]/g, '\\$&')} failed[^\\n]*\\n$`), err);
      assert.ok(!err.includes('t0k3n'), 'the token is not printed');
      assert.deepEqual(whileOpen, ['token t0k3n'], 'the origin saw one request, with the token, and no retry without it');
      if (strictToTheEnd) assert.deepEqual(srv.seen, ['token t0k3n'], 'nor at teardown');
    });
  }
  await browser.close();
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
