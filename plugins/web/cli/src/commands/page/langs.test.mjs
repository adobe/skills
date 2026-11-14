import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '#src/cli.mjs';
import { CliError } from '#src/errors.mjs';

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
const SIGNALS = {
  url: 'http://x',
  htmlLang: 'en',
  nestedLangs: [],
  hreflang: [],
  metaContentLanguage: null,
  text: 'hello',
  wordCount: 1,
};
const detector = {
  create: () => ({ findLanguage: () => ({ language: 'und', probability: 0 }), dispose() {} }),
};

async function run(deps = {}) {
  const calls = [];
  const driver = {
    ensureAvailable: () => {},
    open: () => {},
    close: () => {},
    list: () => [],
    goto: () => {},
    pageHealth: () => OK,
    run: (s, o) => (calls.push(['run', s, o]), SIGNALS),
  };
  const stdout = sink();
  const all = { stdout, stderr: sink(), env: {}, driverFactory: () => driver, ...deps };
  const code = await runCli(['node', 'web', 'page', 'langs', 'http://x'], all);
  return { code, calls, doc: JSON.parse(stdout.buf) };
}

test('prints schema fields and runs collect code', async () => {
  const { code, calls, doc } = await run({ loadDetector: async () => detector });
  assert.equal(code, 0);
  assert.match(calls[0][2].code, /htmlLang/);
  assert.equal(calls[0][2].file, undefined);
  for (const k of ['wordCount', 'detected', 'declared', 'reconciliation', 'session']) {
    assert.ok(k in doc, k);
  }
  assert.equal(doc.url, 'http://x/final');
});

test('missing detector exits 2 UNSUPPORTED before running anything', async () => {
  const loadDetector = async () => {
    throw new CliError('UNSUPPORTED', 'cld3-asm is not installed', { hint: 'npm install' });
  };
  const { code, calls, doc } = await run({ loadDetector });
  assert.equal(code, 2);
  assert.deepEqual(calls, []);
  assert.equal(doc.error.code, 'UNSUPPORTED');
  assert.equal(doc.error.hint, 'npm install');
});
