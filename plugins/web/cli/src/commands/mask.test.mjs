import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '#src/cli.mjs';
import {
  requireMkcert,
  requireRoot,
  startMask,
  validateDisplayDomain,
} from '#src/commands/mask.mjs';

const sink = () => ({
  buf: '',
  write(c) {
    this.buf += c;
    return true;
  },
});

test('validateDisplayDomain accepts and rejects', () => {
  for (const ok of ['wknd.adventures', 'a-b.c']) assert.equal(validateDisplayDomain(ok), true);
  for (const bad of ['-bad', 'a b', '', 'bad-']) assert.equal(validateDisplayDomain(bad), false);
});

test('requireRoot', () => {
  assert.throws(
    () => requireRoot({ getuid: () => 501 }),
    (e) => e.code === 'USAGE' && /sudo env CAROOT/.test(e.hint),
  );
  assert.doesNotThrow(() => requireRoot({ getuid: () => 0 }));
});

test('requireMkcert throws USAGE when missing', () => {
  assert.throws(
    () =>
      requireMkcert({
        exec: () => {
          throw new Error('x');
        },
      }),
    { code: 'USAGE' },
  );
});

async function cli(argv, extra = {}) {
  const stdout = sink();
  const stderr = sink();
  const code = await runCli(['node', 'web', ...argv], { stdout, stderr, env: {}, ...extra });
  return { code, stdout: stdout.buf, stderr: stderr.buf };
}

test('mask rejects invalid domain', async () => {
  const r = await cli(['mask', '-bad', 'https://x']);
  assert.equal(r.code, 2);
});

test('mask rejects invalid domain (after --)', async () => {
  const r = await cli(['mask', '--', '-bad', 'https://x']);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /invalid domain name/);
});

test('mask rejects invalid target url', async () => {
  const r = await cli(['mask', 'ok.test', 'not-a-url']);
  assert.equal(r.code, 2);
});

test('mask as non-root exits 2 with sudo hint', async () => {
  const r = await cli(['mask', 'ok.test', 'https://x'], { getuid: () => 501 });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /sudo env CAROOT/);
});

const hasMkcert = (() => {
  try {
    execSync('mkcert -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test(
  'startMask adds and removes hosts entry',
  { skip: !hasMkcert && 'mkcert absent' },
  async () => {
    const upstream = createServer((req, res) => res.end('hi'));
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    const hostsFile = join(mkdtempSync(join(tmpdir(), 'mask-hosts-')), 'hosts');
    writeFileSync(hostsFile, '127.0.0.1 localhost\n');
    const { stop, url, certDir } = await startMask({
      displayDomain: 'ok.test',
      targetUrl: `http://127.0.0.1:${upstream.address().port}`,
      hostsFile,
      port: 0,
      log: () => {},
    });
    assert.match(url, /^https:\/\/ok\.test/);
    assert.match(readFileSync(hostsFile, 'utf8'), /127\.0\.0\.1 ok\.test/);
    await stop();
    assert.doesNotMatch(readFileSync(hostsFile, 'utf8'), /ok\.test/);
    assert.match(readFileSync(hostsFile, 'utf8'), /localhost/);
    assert.equal(existsSync(certDir), false);
    upstream.close();
  },
);
