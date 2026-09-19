#!/usr/bin/env node
// Fixture test: live-session.mjs admitted-session helpers (module docstring
// § Admitted-session reuse is the rule):
//   resolveStorageState — explicit file wins (and must exist); the reserved
//   default applies only when a cookie domain suffix-matches the live host;
//   never for a local URL; --fresh-state → null; unreadable file → null.
//   saveStorageState — writes cookies + origins, mode 0600, creates the dir.
// Runs without playwright: the helpers take a duck-typed context.
// Usage: node plugins/stardust/evals/fixtures/storage-state.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveStorageState, saveStorageState, STORAGE_STATE_PATH } from '../../skills/diff/scripts/live-session.mjs';

assert.equal(STORAGE_STATE_PATH, 'stardust/current/_storage-state.json', 'one reserved secret path (artifact-map.md: never tracked)');

const dir = mkdtempSync(join(tmpdir(), 'stardust-state-'));
const def = join(dir, 'current', '_storage-state.json');
const errs = []; const origErr = console.error; console.error = (m) => errs.push(String(m));
try {
  // no default file yet
  assert.equal(resolveStorageState({ url: 'https://www.example.com/', defaultPath: def }), null, 'no file → null');

  // the crawl saved a state (duck-typed context)
  const ctx = { storageState: async () => ({ cookies: [{ name: 'cf_clearance', value: 's3cret', domain: '.example.com', path: '/' }, { name: 'optimizelyEndUserId', value: 'oeu1', domain: 'www.example.com', path: '/' }], origins: [] }) };
  const saved = await saveStorageState(ctx, def);
  assert.deepEqual(saved, { file: def, cookies: 2 });
  assert.ok(existsSync(def), 'directory created, file written');
  assert.equal(statSync(def).mode & 0o777, 0o600, 'secrets: mode 0600');
  assert.equal(JSON.parse(readFileSync(def, 'utf8')).cookies[0].name, 'cf_clearance');

  // default lookup: host match by cookie-domain suffix
  assert.equal(resolveStorageState({ url: 'https://www.example.com/pricing', defaultPath: def }), def, 'www.example.com matches .example.com');
  assert.equal(resolveStorageState({ url: 'https://shop.example.com/', defaultPath: def }), def, 'sibling subdomain matches the parent-domain cookie');
  assert.equal(resolveStorageState({ url: 'https://example.org/', defaultPath: def }), null, 'another site never inherits the session');
  assert.equal(resolveStorageState({ url: 'https://notexample.com/', defaultPath: def }), null, 'suffix match is on a dot boundary');
  assert.ok(errs.some((l) => /reusing .*2 cookies match www\.example\.com/.test(l)), `one stderr line when applied: ${errs}`);

  // opt-outs and precedence
  assert.equal(resolveStorageState({ url: 'https://www.example.com/', defaultPath: def, fresh: true }), null, '--fresh-state opts out');
  assert.equal(resolveStorageState({ url: 'http://localhost:3000/', defaultPath: def }), null, 'a local prototype never gets a session');
  assert.equal(resolveStorageState({ url: 'http://localhost:3000/', explicit: def, defaultPath: def }), null, 'explicit on a local URL is ignored (with a note)');
  const other = join(dir, 'variant-b.json'); writeFileSync(other, JSON.stringify({ cookies: [], origins: [] }));
  assert.equal(resolveStorageState({ url: 'https://elsewhere.test/', explicit: other, defaultPath: def }), other, 'explicit file wins regardless of domain match');
  assert.throws(() => resolveStorageState({ url: 'https://www.example.com/', explicit: join(dir, 'missing.json') }), /file not found/, 'a named file must exist — no silent fresh session');

  // unreadable default → null, never a throw
  writeFileSync(def, '{not json');
  assert.equal(resolveStorageState({ url: 'https://www.example.com/', defaultPath: def }), null);
} finally { console.error = origErr; }

console.log('storage-state test: ok');
