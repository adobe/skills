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

test('hasAmsMarkers: detects symlinked AMS marker files (symlink name matches pattern, backing file does not)', () => {
  const r = mk();
  const available = path.join(r, 'conf.dispatcher.d/available_farms');
  const enabled = path.join(r, 'conf.dispatcher.d/enabled_farms');
  fs.mkdirSync(available, { recursive: true });
  fs.mkdirSync(enabled, { recursive: true });
  w(available, 'site.any', '/site { }');
  fs.symlinkSync('../available_farms/site.any', path.join(enabled, 'site_farm.any'));
  assert.strictEqual(INV.hasAmsMarkers(r), true, 'Should detect AMS marker only via symlink name matching _farm.any pattern');
});

test('detectMode: symlinked AMS marker + cloud marker → standard (not already-cloud)', () => {
  const r = mk();
  const available = path.join(r, 'conf.dispatcher.d/available_farms');
  const enabled = path.join(r, 'conf.dispatcher.d/enabled_farms');
  fs.mkdirSync(available, { recursive: true });
  fs.mkdirSync(enabled, { recursive: true });
  w(available, 'site.any', '/site { }');
  fs.symlinkSync('../available_farms/site.any', path.join(enabled, 'site_farm.any'));
  w(r, 'opt-in/USE_SOURCES_DIRECTLY', '');
  assert.strictEqual(INV.detectMode(r), 'standard', 'Symlinked AMS marker (whose name matches) should block already-cloud classification');
});

test('findConfigRoots: finds dispatcher config nested in workspace', () => {
  const r = mk();
  const nested = path.join(r, 'projects/myapp/dispatcher');
  fs.mkdirSync(path.join(nested, 'conf.dispatcher.d/enabled_farms'), { recursive: true });
  fs.mkdirSync(path.join(nested, 'conf.d'), { recursive: true });
  const roots = INV.findConfigRoots(r);
  assert.ok(roots.includes(nested), `Expected to find nested dispatcher config at ${nested}, found: ${roots.join(', ')}`);
});

test('buildInventory: counts filter + rewrite rules and flags tmpl/cm-vars', () => {
  const r = mk();
  w(r, 'conf.d/dispatcher.any',
    '/farms {\n /website {\n  /filter {\n   /0001 { /type "allow" /url "*" }\n   /0002 { /type "deny" /url "/x" }\n  }\n } }\n');
  w(r, 'conf.vhost.d/rw.rules.tmpl', 'RewriteRule ^/a /b\nRewriteRule ^/c /d\n');
  w(r, 'conf.d/includes/hdr.conf', 'Header set X-Dispatcher "${DISP_ID}"\n');
  const inv = INV.buildInventory(r);
  assert.strictEqual(inv.mode, 'flexible');
  assert.strictEqual(inv.ruleCounts.filter, 2);
  assert.strictEqual(inv.ruleCounts.rewrite, 2);
  assert.strictEqual(inv.tmplUsage, true);
  assert.ok(inv.cmVarCandidates.includes('DISP_ID'));
});

test('runDispatcherScan: runbook shape, ok:true empty when no dispatcher config', () => {
  const r = mk(); w(r, 'core/Foo.java', 'x');
  const res = INV.runDispatcherScan(r);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.findings.length, 0);
});
