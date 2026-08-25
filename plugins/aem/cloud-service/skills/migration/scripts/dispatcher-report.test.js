'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const REP = require('./dispatcher-report.js');

function mkOut(filterRules) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'rep-'));
  const fdir = path.join(r, 'conf.dispatcher.d/filters');
  fs.mkdirSync(fdir, { recursive: true });
  fs.writeFileSync(path.join(fdir, 'filters.any'),
    Array.from({ length: filterRules }, (_, i) => `/000${i} { /type "allow" /url "*" }`).join('\n') + '\n');
  return r;
}

test('coverage table: preserved when output >= source; DROPPED when output 0', () => {
  const outputSrcDir = mkOut(3);                 // output has 3 filter rules
  const inventory = { ruleCounts: { filter: 3, rewrite: 10, cache: 0, clientheader: 0, virtualhost: 0 } };
  const verifyResult = { ok: true, failures: [], warnings: [] };
  const crossBoundary = { cmVars: [] };
  const md = REP.renderReport({ inventory, verifyResult, crossBoundary, outputSrcDir });
  assert.match(md, /## Conversion coverage/);
  assert.match(md, /\| filter \| 3 \| 3 \| preserved \|/);
  // rewrite: source 10, output 0 -> DROPPED + edge routing note
  assert.match(md, /\| rewrite \| 10 \| 0 \| \*\*DROPPED\*\*.*edge/);
});

test('report includes the CM handoff and never leaks a value', () => {
  const outputSrcDir = mkOut(1);
  const inventory = { ruleCounts: { filter: 1, rewrite: 0, cache: 0, clientheader: 0, virtualhost: 0 } };
  const verifyResult = { ok: true, failures: [], warnings: [] };
  const crossBoundary = { cmVars: [{ name: 'ADMIN_TOKEN', files: [{ path: '/x/site.vhost', line: 4 }], origin: 'config-defined', secretLike: true }] };
  const md = REP.renderReport({ inventory, verifyResult, crossBoundary, outputSrcDir });
  assert.match(md, /Cloud Manager variables/);
  assert.match(md, /ADMIN_TOKEN/);
  assert.match(md, /secret/i);              // secretLike surfaced
  assert.match(md, /Branch A/);
});

test('report echoes the verify verdict and always lists delegated next-checks', () => {
  const outputSrcDir = mkOut(0);            // empty filters.any
  const inventory = { ruleCounts: { filter: 5, rewrite: 0, cache: 0, clientheader: 0, virtualhost: 0 } };
  const verifyResult = { ok: false, failures: [{ severity: 'critical', category: 'filter-acl-loss', detail: 'dropped' }], warnings: [] };
  const crossBoundary = { cmVars: [] };
  const md = REP.renderReport({ inventory, verifyResult, crossBoundary, outputSrcDir });
  assert.match(md, /filter-acl-loss/);      // verify verdict echoed
  assert.match(md, /## Next checks \(delegated/);
  assert.match(md, /diff-baseline/);        // freshness -> dispatcher sdk
  assert.match(md, /security-hardening/);   // headers
  assert.match(md, /lint/);                 // validation/quality
});

test('writeReport writes conversion-report.md and returns its path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repw-'));
  const p = REP.writeReport(dir, '# hi');
  assert.strictEqual(p, path.join(dir, 'conversion-report.md'));
  assert.strictEqual(fs.readFileSync(p, 'utf8'), '# hi');
});
