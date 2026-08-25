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

// Build an output tree with a custom site.rules (siteCount RewriteRule) and an
// Adobe-managed default_rewrite.rules (defaultCount RewriteRule). The default_* file
// must be excluded from the coverage Output count.
function mkRewriteOut(siteCount, defaultCount) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'rep-rw-'));
  const rdir = path.join(r, 'conf.d/rewrites');
  fs.mkdirSync(rdir, { recursive: true });
  fs.writeFileSync(path.join(rdir, 'site.rules'),
    Array.from({ length: siteCount }, (_, i) => `RewriteRule ^/a${i}$ /b${i} [L]`).join('\n') + '\n');
  fs.writeFileSync(path.join(rdir, 'default_rewrite.rules'),
    Array.from({ length: defaultCount }, (_, i) => `RewriteRule ^/d${i}$ /e${i} [L]`).join('\n') + '\n');
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

// Masking regression: a surviving Adobe-managed default_rewrite.rules (5) must NOT be able
// to hide dropped custom rewrites. Source 4 custom, output 2 custom + 5 default → the
// rewrite row must read Output 2 / partial (2/4), NOT 7 / preserved. Under the old code
// (raw buildInventory rewriteCount, no default_* exclusion) it read `4 | 7 | preserved`.
test('coverage rewrite count excludes default_* so a surviving SDK default cannot mask dropped custom rewrites', () => {
  const outputSrcDir = mkRewriteOut(2, 5);       // 2 custom + 5 Adobe-managed default
  const inventory = { ruleCounts: { filter: 0, rewrite: 4, cache: 0, clientheader: 0, virtualhost: 0 } };
  const verifyResult = { ok: true, failures: [], warnings: [] };
  const crossBoundary = { cmVars: [] };
  const md = REP.renderReport({ inventory, verifyResult, crossBoundary, outputSrcDir });
  // Output is the custom-only 2, not the inflated 7; status is partial, not preserved.
  assert.match(md, /\| rewrite \| 4 \| 2 \| partial \(2\/4\)/);
  assert.doesNotMatch(md, /\| rewrite \| 4 \| 7 /);        // the pre-fix masked value
  assert.doesNotMatch(md, /\| rewrite \| 4 \| \d+ \| preserved/);
  assert.match(md, /custom-only/);                          // explicit note under the table
});

test('coverage rewrite: preserved when custom output matches source (default_* still excluded)', () => {
  const outputSrcDir = mkRewriteOut(2, 5);       // 2 custom (matches source) + 5 default excluded
  const inventory = { ruleCounts: { filter: 0, rewrite: 2, cache: 0, clientheader: 0, virtualhost: 0 } };
  const verifyResult = { ok: true, failures: [], warnings: [] };
  const crossBoundary = { cmVars: [] };
  const md = REP.renderReport({ inventory, verifyResult, crossBoundary, outputSrcDir });
  assert.match(md, /\| rewrite \| 2 \| 2 \| preserved \|/);
});

// Minor: with no outputSrcDir the Output/Status columns must read "not scanned" — a
// spec-following caller that omits it must NOT see populated sources flagged DROPPED.
test('coverage renders "not scanned" (never DROPPED) when outputSrcDir is absent', () => {
  const inventory = { ruleCounts: { filter: 3, rewrite: 4, cache: 1, clientheader: 2, virtualhost: 1 } };
  const verifyResult = { ok: true, failures: [], warnings: [] };
  const crossBoundary = { cmVars: [] };
  const md = REP.renderReport({ inventory, verifyResult, crossBoundary });   // no outputSrcDir
  assert.doesNotMatch(md, /DROPPED/);
  assert.match(md, /\| filter \| 3 \| not scanned \| not scanned \|/);
  assert.match(md, /\| rewrite \| 4 \| not scanned \| not scanned \|/);
  assert.match(md, /not scanned/);
});
