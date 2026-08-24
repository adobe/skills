'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const INV = require('./dispatcher-inventory.js');

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), 'disp-')); }
function w(root, rel, c = 'x') { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); return f; }

test('detectMode: standard AMS v2.0 layout', () => {
  const r = mk();
  fs.mkdirSync(path.join(r, 'conf.dispatcher.d/enabled_farms'), { recursive: true });
  fs.mkdirSync(path.join(r, 'conf.dispatcher.d/available_farms'), { recursive: true });
  fs.mkdirSync(path.join(r, 'conf.d/enabled_vhosts'), { recursive: true });
  assert.strictEqual(INV.detectMode(r), 'standard');
});

test('detectMode: flexible/on-prem (monolithic dispatcher.any, no conf.dispatcher.d)', () => {
  const r = mk();
  w(r, 'conf.d/dispatcher.any', '/farms {\n  /website { }\n}\n');
  w(r, 'conf.vhost.d/vhosts.conf', '<VirtualHost *:80></VirtualHost>');
  assert.strictEqual(INV.detectMode(r), 'flexible');
});

test('detectMode: already-cloud (has opt-in / default_*.any, no AMS markers)', () => {
  const r = mk();
  fs.mkdirSync(path.join(r, 'conf.dispatcher.d/enabled_farms'), { recursive: true });
  w(r, 'conf.dispatcher.d/enabled_farms/farms.any', '$include "./*.farm"');
  w(r, 'opt-in/USE_SOURCES_DIRECTLY', '');
  assert.strictEqual(INV.detectMode(r), 'already-cloud');
});

test('detectMode: not a dispatcher config', () => {
  const r = mk(); w(r, 'src/Foo.java', 'class Foo {}');
  assert.strictEqual(INV.detectMode(r), 'not-dispatcher');
});

test('detectMode: conf.dispatcher.d with conf.vhost.d (not flexible; should be standard or unknown)', () => {
  const r = mk();
  fs.mkdirSync(path.join(r, 'conf.dispatcher.d'), { recursive: true });
  fs.mkdirSync(path.join(r, 'conf.vhost.d'), { recursive: true });
  w(r, 'conf.vhost.d/vhosts.conf', '<VirtualHost></VirtualHost>');
  const mode = INV.detectMode(r);
  assert.notStrictEqual(mode, 'flexible', `Config with conf.dispatcher.d + conf.vhost.d should not be 'flexible', got '${mode}'`);
});

test('hasAmsMarkers: detects symlinked AMS marker files', () => {
  const r = mk();
  const enabled = path.join(r, 'conf.dispatcher.d/enabled_farms');
  const available = path.join(r, 'conf.dispatcher.d/available_farms');
  fs.mkdirSync(enabled, { recursive: true });
  fs.mkdirSync(available, { recursive: true });
  w(available, 'x_farm.any', '/farm { }');
  fs.symlinkSync('../available_farms/x_farm.any', path.join(enabled, 'x_farm.any'));
  assert.strictEqual(INV.hasAmsMarkers(r), true, 'Should detect AMS marker via symlink');
});

test('detectMode: symlinked AMS marker + cloud marker → standard (not already-cloud)', () => {
  const r = mk();
  const enabled = path.join(r, 'conf.dispatcher.d/enabled_farms');
  const available = path.join(r, 'conf.dispatcher.d/available_farms');
  fs.mkdirSync(enabled, { recursive: true });
  fs.mkdirSync(available, { recursive: true });
  w(available, 'x_farm.any', '/farm { }');
  fs.symlinkSync('../available_farms/x_farm.any', path.join(enabled, 'x_farm.any'));
  w(r, 'opt-in/USE_SOURCES_DIRECTLY', '');
  assert.strictEqual(INV.detectMode(r), 'standard', 'Symlinked AMS marker should block already-cloud classification');
});

test('findConfigRoots: finds dispatcher config nested in workspace', () => {
  const r = mk();
  const nested = path.join(r, 'projects/myapp/dispatcher');
  fs.mkdirSync(path.join(nested, 'conf.dispatcher.d/enabled_farms'), { recursive: true });
  fs.mkdirSync(path.join(nested, 'conf.d'), { recursive: true });
  const roots = INV.findConfigRoots(r);
  assert.ok(roots.includes(nested), `Expected to find nested dispatcher config at ${nested}, found: ${roots.join(', ')}`);
});
