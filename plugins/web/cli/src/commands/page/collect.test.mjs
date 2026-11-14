import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '#src/cli.mjs';

const sink = () => ({
  buf: '',
  write(c) {
    this.buf += c;
    return true;
  },
});
const OK = {
  title: 'T',
  url: 'http://x/final',
  bodyLength: 5000,
  status: 200,
  hasMainContent: true,
};
const SVG = '<svg viewBox="0 0 1 1"><path/></svg>';

async function run(extra, data, { screenshotFails = false } = {}) {
  const out = mkdtempSync(join(tmpdir(), 'collect-'));
  const calls = [];
  const rec =
    (n) =>
    (...a) => (calls.push([n, ...a]), undefined);
  const driver = {
    ensureAvailable: () => {},
    open: rec('open'),
    close: rec('close'),
    list: () => [],
    goto: rec('goto'),
    inject: rec('inject'),
    pageHealth: () => OK,
    run: (s, o) => (calls.push(['run', s, o]), data),
    screenshot: (...a) => {
      calls.push(['screenshot', ...a]);
      if (screenshotFails) throw new Error('boom');
    },
  };
  const stdout = sink();
  const stderr = sink();
  const deps = { stdout, stderr, env: {}, driverFactory: () => driver };
  const code = await runCli(['node', 'web', 'page', 'collect', ...extra, '--output', out], deps);
  return { code, calls, stdout, stderr, out };
}

test('invalid collector exits 2 with hint and no driver calls', async () => {
  const { code, calls, stdout } = await run(['bogus', 'http://x'], {});
  assert.equal(code, 2);
  assert.deepEqual(calls, []);
  const err = JSON.parse(stdout.buf).error;
  assert.equal(err.code, 'USAGE');
  assert.match(err.hint, /one of: all, icons, metadata/);
});

test('all passes null to extract and writes collection + screenshot', async () => {
  const data = { url: 'http://x', metadata: { title: 'T' }, text: { body: 'b' } };
  const { code, calls, stdout, out } = await run(['all', 'http://x'], data);
  assert.equal(code, 0);
  assert.match(calls.find((c) => c[0] === 'run')[2].code, /extract\(c\), null\)$/);
  assert.equal(calls.filter((c) => c[0] === 'screenshot').length, 1);
  const doc = JSON.parse(stdout.buf);
  assert.deepEqual(doc.collectors, { metadata: data.metadata, text: data.text });
  assert.equal(doc.files.collection, join(out, `${doc.session}-collect`, 'collection.json'));
  assert.equal(JSON.parse(readFileSync(doc.files.collection, 'utf8')).url, 'http://x/final');
});

test('screenshot failure warns on stderr and still succeeds', async () => {
  const { code, stderr, stdout } = await run(
    ['all', 'http://x'],
    { url: 'u', metadata: {} },
    { screenshotFails: true },
  );
  assert.equal(code, 0);
  assert.match(stderr.buf, /Warning: screenshot failed/);
  assert.equal(JSON.parse(stdout.buf).screenshot, undefined);
});

test('icons writes manifest under session-prefixed dir', async () => {
  const data = {
    url: 'http://x',
    svgs: [
      { width: 16, height: 16, svgClass: 'search', parentTag: 'A', source: 'inline-svg', svg: SVG },
    ],
  };
  const { code, calls, stdout, out } = await run(['icons', 'http://x'], data);
  assert.equal(code, 0);
  assert.match(calls.find((c) => c[0] === 'run')[2].code, /\["icons"\]\)$/);
  const doc = JSON.parse(stdout.buf);
  assert.match(doc.files.icons, new RegExp(`${out}/web-[0-9a-f]{4}-collect/icons$`));
  assert.deepEqual(readdirSync(doc.files.icons).sort(), ['icons.json', 'search.svg']);
  assert.equal(doc.icons[0].name, 'search');
  assert.equal(doc.url, 'http://x/final');
});

test('metadata writes json file and prints fields at top level', async () => {
  const { code, stdout, out } = await run(['metadata', 'http://x'], {
    url: 'http://x',
    metadata: { title: 'Example' },
  });
  assert.equal(code, 0);
  const doc = JSON.parse(stdout.buf);
  assert.equal(doc.title, 'Example');
  assert.equal(doc.files.metadata, join(out, `${doc.session}-collect`, 'metadata.json'));
  assert.deepEqual(JSON.parse(readFileSync(doc.files.metadata, 'utf8')), { title: 'Example' });
});
