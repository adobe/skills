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
