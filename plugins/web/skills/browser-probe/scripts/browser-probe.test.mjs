import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectSignals, findDocumentChain } from './browser-probe.js';

const PROBE = fileURLToPath(new URL('./browser-probe.js', import.meta.url));

const REDIRECT_REQUESTS = `### Result
1. [GET] http://example.com/ => [301] Moved Permanently
2. [GET] https://www.example.com/ => [200]
3. [GET] https://www.example.com/app.js => [200]`;

test('findDocumentChain returns redirect hops plus the final document', () => {
  assert.deepEqual(findDocumentChain(REDIRECT_REQUESTS, 'https://www.example.com/'), ['1', '2']);
});

test('findDocumentChain ignores the URL fragment', () => {
  assert.deepEqual(
    findDocumentChain(REDIRECT_REQUESTS, 'https://www.example.com/#top'), ['1', '2'],
  );
});

test('findDocumentChain throws when the document is missing', () => {
  assert.throws(
    () => findDocumentChain(REDIRECT_REQUESTS, 'https://other.example/'),
    /main document https:\/\/other\.example\/ not found/,
  );
});

test('detectSignals maps akamai-grn to akamai-server', () => {
  const grn = 'akamai-grn: 0.160f0317.1790256381.30155e76';
  assert.deepEqual(detectSignals([grn], []), ['akamai-server']);
  assert.deepEqual(detectSignals(['content-type: text/html'], []), []);
});

// Fake playwright-cli: serves a healthy page behind one redirect. Only the final
// document (#2) carries cf-ray. FAKE_FAIL=<command> makes that command exit 1.
const FAKE_CLI = `#!/usr/bin/env node
const [cmd, arg] = process.argv.slice(3);
if (process.env.FAKE_FAIL && cmd === process.env.FAKE_FAIL) {
  console.error('Unknown command: ' + cmd);
  process.exit(1);
}
const health = { title: 'Example', url: 'https://www.example.com/', bodyLength: 500,
  status: 200, hasMainContent: true };
if (cmd === 'eval') {
  const value = arg === 'document.readyState' ? 'complete' : JSON.stringify(health);
  console.log('### Result\\n' + JSON.stringify(value));
} else if (cmd === 'requests') {
  console.log(${JSON.stringify(REDIRECT_REQUESTS)});
} else if (cmd === 'response-headers') {
  const final = 'server: cloudflare\\ncf-ray: abc';
  console.log(arg === '2' ? final : 'location: https://www.example.com/');
}
`;

function runProbe(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'browser-probe-test-'));
  const cliPath = join(dir, 'playwright-cli');
  writeFileSync(cliPath, FAKE_CLI);
  chmodSync(cliPath, 0o755);
  execFileSync(process.execPath, [PROBE, 'http://example.com/', dir], {
    env: { ...process.env, ...env, PATH: `${dir}:${process.env.PATH}` },
    stdio: 'pipe',
  });
  return JSON.parse(readFileSync(join(dir, 'probe-report.json'), 'utf-8'));
}

test('probe reads headers of the final document after a redirect', () => {
  const report = runProbe();
  assert.equal(report.firstSuccess, 'default');
  assert.deepEqual(report.detectedSignals, ['cloudflare-ray']);
  assert.equal(report.steps[0].headerError, undefined);
});

test('probe records header-collection failures instead of hiding them', () => {
  const report = runProbe({ FAKE_FAIL: 'requests' });
  assert.equal(report.firstSuccess, 'default');
  assert.deepEqual(report.detectedSignals, []);
  assert.match(report.steps[0].headerError, /Failed to read main-document response headers/);
});
