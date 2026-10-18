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
check('an unset variable → exit 2 naming the variable and no other variable\'s value', () => withDir('SITE_TOKEN=dotenv-secret\nOTHER=another-secret\n', (cwd) => {
  const msg = fails(() => instrumentAuth({ tokenEnv: 'MY_TOKEN', urls: [PAGE], env: { SITE_TOKEN: 'env-secret' }, cwd }), /MY_TOKEN/);
  for (const secret of ['env-secret', 'dotenv-secret', 'another-secret']) assert.ok(!msg.includes(secret), msg);
}));
check('an empty value counts as unset', () => withDir('A=\nB=""\nC=   \n', (cwd) => {
  for (const name of ['A', 'B', 'C', 'D']) fails(() => instrumentAuth({ tokenEnv: name, urls: [PAGE], env: { D: '' }, cwd }), new RegExp(name));
}));
check('--token-env takes a variable name: a token typed there is refused without echoing it', () => withDir(null, (cwd) => {
  const msg = fails(() => instrumentAuth({ tokenEnv: 'token abc.def-123', urls: [PAGE], env: {}, cwd }), /--token-env/);
  assert.ok(!msg.includes('abc.def-123'), msg);
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
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
