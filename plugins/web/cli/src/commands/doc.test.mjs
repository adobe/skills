import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runCli } from '#src/cli.mjs';
import * as lib from '#src/lib.mjs';

const sink = () => ({
  buf: '',
  write(c) {
    this.buf += c;
    return true;
  },
});
const run = async (...args) => {
  const stdout = sink();
  const code = await runCli(['node', 'web', 'doc', ...args], { stdout, stderr: sink(), env: {} });
  return { code, out: stdout.buf };
};

test('doc without a topic lists the topics as commands', async () => {
  const { code, out } = await run();
  assert.equal(code, 0);
  assert.equal(out, 'web doc extending\n');
});

test('doc <topic> prints the Markdown text, not JSON', async () => {
  const { code, out } = await run('extending');
  assert.equal(code, 0);
  assert.match(out, /^# Extending `web`/);
  assert.equal(out, readFileSync(new URL('../docs/extending.md', import.meta.url), 'utf-8'));
});

test('an unknown topic is a USAGE error with the topic list as hint', async () => {
  const { code, out } = await run('nope');
  assert.equal(code, 2);
  const { error } = JSON.parse(out);
  assert.equal(error.code, 'USAGE');
  assert.match(error.hint, /extending/);
});

test('the extending doc names every export of the library', async () => {
  const { out } = await run('extending');
  for (const name of Object.keys(lib)) assert.match(out, new RegExp(`\`${name}\\b`), name);
});
