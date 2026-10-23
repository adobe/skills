import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./stealth-init.js', import.meta.url), 'utf8');
const run = (window) => vm.runInNewContext(source, { window, navigator: {} });

test('stealth adds window.chrome.runtime where the page has none', () => {
  const window = {};
  run(window);
  assert.deepEqual(Object.keys(window.chrome), ['runtime']);
});

test('stealth keeps the chrome.runtime an extension page already has', () => {
  const getManifest = () => ({});
  const window = { chrome: { runtime: { getManifest }, storage: {} } };
  run(window);
  assert.equal(window.chrome.runtime.getManifest, getManifest);
  assert.ok(window.chrome.storage);
});
