import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dropFailedEntries, harFileName, loadHarIndex } from '#src/cache/har.mjs';

const tmp = () => mkdtemp(path.join(os.tmpdir(), 'har-'));
const entry = (url, status, content = {}, headers = [], method = 'GET') => ({
  request: { method, url },
  response: { status, headers, content },
});
const writeHar = (file, entries) =>
  writeFile(file, JSON.stringify({ log: { version: '1.2', entries } }));

test('harFileName is <hostname>_<sha8>.har and varies with the full URL', () => {
  const a = harFileName('https://www.example.com/a?b=1');
  assert.match(a, /^www\.example\.com_[0-9a-f]{8}\.har$/);
  assert.notEqual(a, harFileName('https://www.example.com/a?b=2'));
});

test('dropFailedEntries removes status <= 0 entries in place', async () => {
  const dir = await tmp();
  const file = path.join(dir, 'a.har');
  await writeHar(file, [
    entry('https://a.test/', 200),
    entry('https://a.test/x', -1),
    entry('https://a.test/y', 0),
  ]);
  assert.deepEqual(dropFailedEntries(file), { entries: 1, dropped: 2 });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).log.entries.length, 1);
});

test('loadHarIndex cleans headers and reads the _file body', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'body.bin'), Buffer.from([1, 2, 3]));
  await writeHar(path.join(dir, 'a.har'), [
    entry('https://a.test/', 200, { _file: 'body.bin' }, [
      { name: 'Content-Type', value: 'text/html' },
      { name: 'Content-Encoding', value: 'gzip' },
      { name: 'Content-Length', value: '99' },
      { name: 'Transfer-Encoding', value: 'chunked' },
      { name: ':status', value: '200' },
    ]),
  ]);
  const res = loadHarIndex(dir).get('GET https://a.test/');
  assert.equal(res.status, 200);
  assert.deepEqual(res.headers, { 'content-type': 'text/html' });
  assert.deepEqual(res.body(), Buffer.from([1, 2, 3]));
});

test('repeated headers are joined, set-cookie stays an array', async () => {
  const dir = await tmp();
  await writeHar(path.join(dir, 'a.har'), [
    entry('https://a.test/', 200, {}, [
      { name: 'Vary', value: 'a' },
      { name: 'vary', value: 'b' },
      { name: 'Set-Cookie', value: 'x=1' },
      { name: 'set-cookie', value: 'y=2' },
    ]),
  ]);
  const { headers } = loadHarIndex(dir).get('GET https://a.test/');
  assert.deepEqual(headers, { vary: 'a, b', 'set-cookie': ['x=1', 'y=2'] });
});

test('inline text bodies decode as base64 or utf-8; no content is empty', async () => {
  const dir = await tmp();
  await writeHar(path.join(dir, 'a.har'), [
    entry('https://a.test/b64', 200, {
      text: Buffer.from('hi').toString('base64'),
      encoding: 'base64',
    }),
    entry('https://a.test/txt', 200, { text: 'héllo' }),
    entry('https://a.test/none', 204),
  ]);
  const index = loadHarIndex(dir);
  assert.equal(index.get('GET https://a.test/b64').body().toString(), 'hi');
  assert.deepEqual(index.get('GET https://a.test/txt').body(), Buffer.from('héllo'));
  assert.equal(index.get('GET https://a.test/none').body().length, 0);
});

test('the later file (sorted) wins on duplicate keys', async () => {
  const dir = await tmp();
  await writeHar(path.join(dir, 'b.har'), [entry('https://a.test/', 201)]);
  await writeHar(path.join(dir, 'a.har'), [entry('https://a.test/', 200)]);
  assert.equal(loadHarIndex(dir).get('GET https://a.test/').status, 201);
});

test('an unparsable HAR throws USAGE naming the file', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'bad.har'), '{');
  assert.throws(
    () => loadHarIndex(dir),
    (err) => err.code === 'USAGE' && err.message.includes('bad.har') && Boolean(err.hint),
  );
});

test('loadHarIndex rejects a relative _file that escapes the cache dir', async () => {
  const dir = await tmp();
  await writeHar(path.join(dir, 'a.har'), [entry('https://a.test/', 200, { _file: '../x' })]);
  assert.throws(
    () => loadHarIndex(dir),
    (err) => err.code === 'USAGE' && /escapes the cache dir: \.\.\/x/.test(err.message),
  );
});

test('loadHarIndex rejects an absolute _file', async () => {
  const dir = await tmp();
  await writeHar(path.join(dir, 'a.har'), [entry('https://a.test/', 200, { _file: '/etc/hosts' })]);
  assert.throws(
    () => loadHarIndex(dir),
    (err) => err.code === 'USAGE' && /escapes the cache dir/.test(err.message),
  );
});

test('loadHarIndex rejects a _file that is a symlink to a file outside the cache dir', async () => {
  const dir = await tmp();
  const outside = path.join(await tmp(), 'secret.txt');
  await writeFile(outside, 'secret');
  await symlink(outside, path.join(dir, 'body.bin'));
  await writeHar(path.join(dir, 'a.har'), [entry('https://a.test/', 200, { _file: 'body.bin' })]);
  assert.throws(
    () => loadHarIndex(dir),
    (err) => err.code === 'USAGE' && /escapes the cache dir/.test(err.message),
  );
});

test('loadHarIndex rejects a _file under a symlinked directory outside the cache dir', async () => {
  const dir = await tmp();
  const outside = await tmp();
  await mkdir(path.join(outside, 'sub'));
  await writeFile(path.join(outside, 'sub', 'secret.txt'), 'secret');
  await symlink(outside, path.join(dir, 'link'));
  await writeHar(path.join(dir, 'a.har'), [
    entry('https://a.test/', 200, { _file: 'link/sub/secret.txt' }),
  ]);
  assert.throws(
    () => loadHarIndex(dir),
    (err) => err.code === 'USAGE' && /escapes the cache dir/.test(err.message),
  );
});

test('a later 304 entry does not replace an earlier 200 for the same key', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'body.bin'), 'hello');
  await writeHar(path.join(dir, 'a.har'), [entry('https://a.test/', 200, { _file: 'body.bin' })]);
  await writeHar(path.join(dir, 'b.har'), [entry('https://a.test/', 304)]);
  const res = loadHarIndex(dir).get('GET https://a.test/');
  assert.equal(res.status, 200);
  assert.equal(res.body().toString(), 'hello');
});
