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

test('buildInventory: counts quoted entries in clientheaders and virtualhosts sections', () => {
  const r = mk();
  w(r, 'conf.d/dispatcher.any',
    '/farms {\n /website {\n  /clientheaders {\n   "Cookie"\n   "X-Forwarded-For"\n  }\n  /virtualhosts {\n   "*.example.com"\n  }\n } }\n');
  const inv = INV.buildInventory(r);
  assert.strictEqual(inv.ruleCounts.clientheader, 2, 'should count 2 quoted entries in clientheaders');
  assert.strictEqual(inv.ruleCounts.virtualhost, 1, 'should count 1 quoted entry in virtualhosts');
});

test('buildInventory: filter rule count excludes commented-out rules', () => {
  const r = mk();
  w(r, 'conf.d/dispatcher.any',
    '/farms {\n /website {\n  /filter {\n   # /0009 { /type "deny" /url "*.pdf" }\n   /0001 { /type "allow" /url "*" }\n  }\n } }\n');
  const inv = INV.buildInventory(r);
  assert.strictEqual(inv.ruleCounts.filter, 1, 'should count 1 rule and skip the commented /0009');
});

// Task 3: Output verification (filter/ACL preservation gate)
const VERIFY = require('./dispatcher-verify.js');

test('verifyOutput: empty filters.any with source filter rules = hard failure', () => {
  const out = mk();
  w(out, 'conf.dispatcher.d/filters/filters.any', ''); // empty!
  w(out, 'conf.dispatcher.d/available_farms/site.farm', '/site { /filter { } }');
  const res = VERIFY.verifyOutput(out, { filter: 5, rewrite: 3, cache: 0, clientheader: 0, virtualhost: 0 });
  assert.strictEqual(res.ok, false);
  assert.ok(res.failures.some(f => f.category === 'filter-acl-loss' && f.severity === 'critical'));
});

test('verifyOutput: populated filters + collector present = ok', () => {
  const out = mk();
  w(out, 'conf.dispatcher.d/filters/filters.any', '/0001 { /type "allow" /url "*" }\n');
  w(out, 'conf.dispatcher.d/enabled_farms/farms.any', '$include "./*.farm"');
  w(out, 'conf.dispatcher.d/available_farms/site.farm', '/site { /filter { $include "../filters/filters.any" } }');
  const res = VERIFY.verifyOutput(out, { filter: 1, rewrite: 0, cache: 0, clientheader: 0, virtualhost: 0 });
  assert.strictEqual(res.ok, true);
});

test('verifyOutput: missing farms.any collector = warning (not failure)', () => {
  const out = mk();
  w(out, 'conf.dispatcher.d/filters/filters.any', '/0001 { /type "allow" /url "*" }\n');
  w(out, 'conf.dispatcher.d/available_farms/site.farm', '/site { }');
  const res = VERIFY.verifyOutput(out, { filter: 1, rewrite: 0, cache: 0, clientheader: 0, virtualhost: 0 });
  assert.ok(res.warnings.some(x => /farms\.any/.test(x)));
});

// Task 4: Tool driver — config generation + executor resolution
const RUN = require('./dispatcher-run.js');

test('writeToolConfig: emits a valid dispatcherConverter config.yaml (on-premise)', () => {
  const wd = mk();
  const p = RUN.writeToolConfig(wd, {
    sdkSrc: '/sdk/src', mode: 'flexible',
    onPremise: {
      dispatcherAnySrc: '/x/dispatcher.any', httpdSrc: '/x/httpd.conf',
      vhostsToConvert: ['/x/conf.vhost.d/vhosts.conf'],
      variablesToReplace: [{from: 'PUBLISH_DOCROOT', to: 'DOCROOT'}, {from: 'DISP_ID', to: 'SITE'}],
      pathToPrepend: ['/x/conf.vhost.d/'], portsToMap: [8000, 8080]
    },
  });
  const y = fs.readFileSync(p, 'utf8');
  assert.match(y, /dispatcherConverter:/);
  assert.match(y, /sdkSrc: \/sdk\/src/);
  assert.match(y, /dispatcherAnySrc: \/x\/dispatcher\.any/);
  assert.match(y, /vhostsToConvert:/);
  assert.match(y, /- "\/x\/conf\.vhost\.d\/vhosts\.conf"/);
  // Verify variablesToReplace is a YAML mapping (key: value), not a sequence.
  assert.match(y, /"PUBLISH_DOCROOT": "DOCROOT"/);
  assert.match(y, /"DISP_ID": "SITE"/);
  assert.ok(!y.includes('- "PUBLISH_DOCROOT,DOCROOT"'), 'should NOT emit comma-joined list format');
  // Verify portsToMap is a YAML list, not a scalar.
  assert.match(y, /- "8000"/);
  assert.match(y, /- "8080"/);
  assert.ok(!y.includes('portsToMap: 8000,8080'), 'should NOT emit scalar comma-separated format');
});

test('resolveExecutor: maps mode to the right entry script', () => {
  const toolDir = mk();
  const base = path.join(toolDir, 'node_modules/@adobe/aem-cs-source-migration-dispatcher-converter/executors');
  w(base, 'main.js', ''); w(base, 'singleFileMain.js', '');
  assert.match(RUN.resolveExecutor(toolDir, 'standard'), /executors\/main\.js$/);
  assert.match(RUN.resolveExecutor(toolDir, 'flexible'), /executors\/singleFileMain\.js$/);
  assert.match(RUN.resolveExecutor(toolDir, 'v1'), /executors\/singleFileMain\.js$/);
});

// Task 5: Tool driver — ensure-installed + invoke
test('isToolInstalled: false when node_modules absent', () => {
  assert.strictEqual(RUN.isToolInstalled(mk()), false);
});

test('runConverter: computes the tool output + report paths under the working dir', () => {
  // Stub an executor that just creates the expected target tree, to test path plumbing without the real tool.
  const toolDir = mk();
  const execDir = path.join(toolDir, 'node_modules/@adobe/aem-cs-source-migration-dispatcher-converter/executors');
  w(execDir, 'singleFileMain.js',
    'const fs=require("fs"),path=require("path");const t=path.join(process.cwd(),"target/dispatcher/src/conf.dispatcher.d/filters");fs.mkdirSync(t,{recursive:true});fs.writeFileSync(path.join(t,"filters.any"),"/0001 { /type \\"allow\\" /url \\"*\\" }\\n");fs.mkdirSync(path.join(process.cwd(),"target/dispatcher"),{recursive:true});fs.writeFileSync(path.join(process.cwd(),"target/dispatcher/dispatcher-converter-report.md"),"# report");');
  const wd = mk();
  const res = RUN.runConverter(wd, 'flexible', toolDir);
  assert.strictEqual(res.code, 0);
  assert.ok(fs.existsSync(path.join(res.outputSrcDir, 'conf.dispatcher.d/filters/filters.any')));
  assert.ok(fs.existsSync(res.reportPath));
});
