import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixture-server.mjs';

const binPath = fileURLToPath(new URL('../dist/web.mjs', import.meta.url));
const HTML = `<html><head><title>Smoke</title></head>
<body><h1>hi</h1></body></html>`;
const probe = spawnSync('playwright-cli', ['--version']);
const available = !probe.error && probe.status === 0;
const sessionName = `smoke-${process.pid}`;
let cwd;
let fixture;

/** Parse stdout as JSON; `doc` is null when stdout is not a JSON document. */
function parseDoc(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

// Async spawn: spawnSync would block the event loop that serves the in-process fixture.
function web(...args) {
  return new Promise((resolve) => {
    const options = { encoding: 'utf8', cwd };
    execFile(process.execPath, [binPath, ...args], options, (err, stdout, stderr) => {
      resolve({
        status: err ? err.code : 0,
        doc: parseDoc(stdout),
        stdout,
        stderr,
      });
    });
  });
}

before(async () => {
  if (!available) return;
  cwd = mkdtempSync(join(tmpdir(), 'web-smoke-'));
  fixture = await startFixture(HTML);
});

after(async () => {
  if (!available) return;
  await web('browser', 'close', '--session', sessionName);
  await fixture?.close();
  if (cwd) rmSync(cwd, { recursive: true, force: true });
});

test('open → eval → list → close leaves no session', async (t) => {
  if (!available) return t.skip('playwright-cli not installed');
  const opened = await web('browser', 'open', fixture.url, '--session', sessionName);
  assert.equal(opened.status, 0, opened.stderr || opened.stdout);
  assert.equal(opened.doc?.session, sessionName, opened.stdout);

  const title = await web('browser', 'eval', '--session', sessionName, 'document.title');
  assert.equal(title.status, 0, title.stderr || title.stdout);
  assert.equal(title.doc?.result, 'Smoke', title.stdout);

  const listed = await web('browser', 'list');
  assert.match(JSON.stringify(listed.doc), new RegExp(sessionName));

  assert.equal((await web('browser', 'close', '--session', sessionName)).status, 0);
  assert.doesNotMatch(JSON.stringify((await web('browser', 'list')).doc), new RegExp(sessionName));
});

test('ephemeral page tree --format text renders the page and leaves no session', async (t) => {
  if (!available) return t.skip('playwright-cli not installed');
  const res = await web('page', 'tree', fixture.url, '--format', 'text');
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /hi/);
  const listed = await web('browser', 'list');
  assert.doesNotMatch(JSON.stringify(listed.doc), /web-/);
});

test('page tree JSON carries text, tree, nodeMap, session and durationMs', async (t) => {
  if (!available) return t.skip('playwright-cli not installed');
  const res = await web('page', 'tree', fixture.url);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  for (const key of ['text', 'tree', 'nodeMap', 'session', 'durationMs']) {
    assert.ok(key in (res.doc ?? {}), `missing ${key}: ${res.stdout}`);
  }
});

test('browser eval on an unknown session fails with NO_SESSION', async (t) => {
  if (!available) return t.skip('playwright-cli not installed');
  const res = await web('browser', 'eval', '--session', 'does-not-exist', '1');
  assert.equal(res.status, 2, res.stderr || res.stdout);
  assert.equal(res.doc?.error?.code, 'NO_SESSION', res.stdout);
});
