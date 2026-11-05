import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactCredentials } from './errors.mjs';

test('redactCredentials hides URL user and password, keeps scheme, host and path', () => {
  assert.equal(
    redactCredentials('from wss://brd-customer-hl_1-zone-b:pa55-w0rd@brd.superproxy.io:9222/x'),
    'from wss://[redacted]@brd.superproxy.io:9222/x',
  );
  assert.equal(redactCredentials('http://user@host/p'), 'http://[redacted]@host/p');
  assert.equal(
    redactCredentials('a https://a:b@one.test and wss://c:d@two.test'),
    'a https://[redacted]@one.test and wss://[redacted]@two.test',
  );
});

test('redactCredentials hides Basic and Bearer tokens', () => {
  assert.equal(
    redactCredentials('Authorization: Basic dXNlcjpwYXNzd29yZA=='),
    'Authorization: Basic [redacted]',
  );
  assert.equal(redactCredentials('Bearer abc.def-ghi_jkl'), 'Bearer [redacted]');
});

test('redactCredentials leaves text without credentials alone', () => {
  for (const text of [
    'https://example.com/a@b',
    'mail me: someone@example.com',
    'Basic auth required',
    'http://127.0.0.1:9222',
  ]) {
    assert.equal(redactCredentials(text), text);
  }
  assert.equal(redactCredentials(undefined), undefined);
});
