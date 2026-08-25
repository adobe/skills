'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CB = require('./dispatcher-crossboundary.js');

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cb-')); }
function w(root, rel, c) { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); return f; }

test('cmVars: external var (no Define) captured with location, not secret', () => {
  const r = mk();
  w(r, 'conf.d/enabled_vhosts/site.vhost', 'ServerName "${SITE_DOMAIN}"\nHeader set X-Env "${SITE_DOMAIN}"\n');
  const { cmVars } = CB.analyzeCrossBoundary({ configRoot: r, inventory: {} });
  const v = cmVars.find(x => x.name === 'SITE_DOMAIN');
  assert.ok(v, 'SITE_DOMAIN present');
  assert.strictEqual(v.origin, 'external');
  assert.strictEqual(v.secretLike, false);
  assert.strictEqual(v.files.length, 2, 'both usages located');
  assert.ok(v.files.every(u => typeof u.line === 'number' && u.line > 0));
});

test('cmVars: Define with concrete value => config-defined; secret-looking name flagged; value never emitted', () => {
  const r = mk();
  w(r, 'conf.d/vars.conf', 'Define ADMIN_TOKEN "s3cr3t-value"\n');
  w(r, 'conf.d/enabled_vhosts/site.vhost', 'Header set X-Auth "${ADMIN_TOKEN}"\n');
  const { cmVars } = CB.analyzeCrossBoundary({ configRoot: r, inventory: {} });
  const v = cmVars.find(x => x.name === 'ADMIN_TOKEN');
  assert.ok(v);
  assert.strictEqual(v.origin, 'config-defined');
  assert.strictEqual(v.secretLike, true, 'TOKEN name is secret-like');
  const serialized = JSON.stringify(cmVars);
  assert.ok(!serialized.includes('s3cr3t-value'), 'the Defined value must never appear in the artifact');
});

test('cmVars: self-referential Define (${NAME}) is treated as external (CM passthrough)', () => {
  const r = mk();
  w(r, 'conf.d/vars.conf', 'Define SITE_DOMAIN ${SITE_DOMAIN}\n');
  w(r, 'conf.d/enabled_vhosts/site.vhost', 'ServerName "${SITE_DOMAIN}"\n');
  const { cmVars } = CB.analyzeCrossBoundary({ configRoot: r, inventory: {} });
  const v = cmVars.find(x => x.name === 'SITE_DOMAIN');
  assert.ok(v);
  assert.strictEqual(v.origin, 'external', 'Define X ${X} does not locally resolve X');
});

test('cmVars: empty when no ${VAR} usages', () => {
  const r = mk();
  w(r, 'conf.d/enabled_vhosts/site.vhost', 'ServerName "example.com"\n');
  const { cmVars } = CB.analyzeCrossBoundary({ configRoot: r, inventory: {} });
  assert.deepStrictEqual(cmVars, []);
});

// Fix D (crossboundary): a `${OLD}` on a full-line comment must not surface as a cmVar; a live
// `${LIVE}` on an uncommented line still does (comment lines are skipped for both Define + ${VAR}).
test('cmVars: skips ${VAR} inside full-line comments', () => {
  const r = mk();
  w(r, 'conf.d/enabled_vhosts/site.vhost', '# ServerName "${OLD}"\nHeader set X-Live "${LIVE}"\n');
  const { cmVars } = CB.analyzeCrossBoundary({ configRoot: r, inventory: {} });
  assert.ok(cmVars.find(x => x.name === 'LIVE'), 'LIVE (uncommented) present');
  assert.ok(!cmVars.find(x => x.name === 'OLD'), 'OLD (commented) excluded');
});

// Fix F: the file predicate must also scan templated vhosts (*.vhost.tmpl), not only *.vhost.
test('cmVars: captures ${VAR} inside a *.vhost.tmpl file', () => {
  const r = mk();
  w(r, 'conf.d/available_vhosts/site.vhost.tmpl', 'ServerName "${TMPL_DOMAIN}"\n');
  const { cmVars } = CB.analyzeCrossBoundary({ configRoot: r, inventory: {} });
  assert.ok(cmVars.find(x => x.name === 'TMPL_DOMAIN'), 'TMPL_DOMAIN captured from .vhost.tmpl');
});
