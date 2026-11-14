import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runCli } from '#src/cli.mjs';

const sink = () => ({
  buf: '',
  write(c) {
    this.buf += c;
    return true;
  },
});

async function run(args) {
  const stdout = sink();
  const stderr = sink();
  const code = await runCli(['node', 'web', ...args], { stdout, stderr, env: {} });
  return { code, doc: JSON.parse(stdout.buf) };
}

test('site scan prints the summary document', async () => {
  const server = createServer((req, res) => {
    res.writeHead(req.url === '/sitemap.xml' ? 200 : 404);
    res.end(`<urlset><url><loc>http://127.0.0.1:${server.address().port}/p</loc></url></urlset>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const { code, doc } = await run(['site', 'scan', `http://127.0.0.1:${server.address().port}`]);
    assert.equal(code, 0);
    assert.equal(doc.valid, 1);
    assert.equal(doc.urls[0].lang, '');
  } finally {
    server.close();
  }
});

test('site scan exits 1 with EMPTY_RESULT when nothing is found', async () => {
  const server = createServer((_req, res) => res.writeHead(404).end());
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const { code, doc } = await run(['site', 'scan', `http://127.0.0.1:${server.address().port}`]);
    assert.equal(code, 1);
    assert.equal(doc.error.code, 'EMPTY_RESULT');
  } finally {
    server.close();
  }
});

test('site scan rejects a bad strategy, origin and limit with exit 2', async () => {
  for (const args of [
    ['site', 'scan', 'http://x.test', '--strategy', 'dns'],
    ['site', 'scan', 'not a url'],
    ['site', 'scan', 'http://x.test', '--limit', '0'],
    ['site', 'scan', 'http://x.test', '--timeout', 'abc'],
    ['site', 'scan', 'http://x.test', '--timeout', '0'],
  ]) {
    const { code, doc } = await run(args);
    assert.equal(code, 2, args.join(' '));
    assert.equal(doc.error.code, 'USAGE');
  }
});
