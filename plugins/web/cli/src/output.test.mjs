import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emit, fail } from './output.mjs';
import { CliError } from './errors.mjs';

const sink = () => ({
  buf: '',
  write(c) {
    this.buf += c;
    return true;
  },
});

test('emit json writes one pretty document', () => {
  const stdout = sink();
  emit({ a: 1 }, { format: 'json', stdout });
  assert.equal(stdout.buf, '{\n  "a": 1\n}\n');
});

test('emit text prefers text member', () => {
  const stdout = sink();
  emit({ a: 1 }, { format: 'text', text: 'tree', stdout });
  assert.equal(stdout.buf, 'tree\n');
});

test('fail writes error doc and maps exit code', () => {
  const stdout = sink();
  const code = fail(new CliError('BLOCKED', 'm', { hint: 'h' }), { stdout, stderr: sink() });
  assert.deepEqual(JSON.parse(stdout.buf), { error: { code: 'BLOCKED', message: 'm', hint: 'h' } });
  assert.equal(code, 3);
});

test('fail wraps unknown errors as INTERNAL exit 1', () => {
  const stdout = sink();
  const code = fail(new Error('boom'), { stdout, stderr: sink() });
  assert.equal(JSON.parse(stdout.buf).error.code, 'INTERNAL');
  assert.equal(JSON.parse(stdout.buf).error.message, 'boom');
  assert.equal(code, 1);
});
