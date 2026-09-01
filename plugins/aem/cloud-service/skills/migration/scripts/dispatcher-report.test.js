'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const REP = require('./dispatcher-report.js');

const _tmpDirs = [];
after(() => { for (const d of _tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });
function track(d) { _tmpDirs.push(d); return d; }

function mkOut(filterRules) {
  const r = track(fs.mkdtempSync(path.join(os.tmpdir(), 'rep-')));
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
  const r = track(fs.mkdtempSync(path.join(os.tmpdir(), 'rep-rw-')));
  const rdir = path.join(r, 'conf.d/rewrites');
  fs.mkdirSync(rdir, { recursive: true });
  fs.writeFileSync(path.join(rdir, 'site.rules'),
    Array.from({ length: siteCount }, (_, i) => `RewriteRule ^/a${i}$ /b${i} [L]`).join('\n') + '\n');
  fs.writeFileSync(path.join(rdir, 'default_rewrite.rules'),
    Array.from({ length: defaultCount }, (_, i) => `RewriteRule ^/d${i}$ /e${i} [L]`).join('\n') + '\n');
  return r;
}

// Build an output tree whose farm has an EMPTY inline /cache { /rules { } } — the converter split
// the real cache rules into an $include'd file (cache/marketing_query_parameters.any) that the
// inline counter does not resolve. The inline output cache count is therefore 0 even though the
// rules were preserved, so the coverage row must NOT read **DROPPED**.
function mkCacheInIncludeOut() {
  const r = track(fs.mkdtempSync(path.join(os.tmpdir(), 'rep-cache-')));
  const fdir = path.join(r, 'conf.dispatcher.d/available_farms');
  fs.mkdirSync(fdir, { recursive: true });
  fs.writeFileSync(path.join(fdir, 'site.farm'),
    '/site {\n  /cache {\n    /rules {\n      $include "../cache/marketing_query_parameters.any"\n    }\n  }\n}\n');
  const cdir = path.join(r, 'conf.dispatcher.d/cache');
  fs.mkdirSync(cdir, { recursive: true });
  fs.writeFileSync(path.join(cdir, 'marketing_query_parameters.any'),
    '/rules {\n  /0001 { /glob "*" /type "allow" }\n  /0002 { /glob "*.html" /type "deny" }\n  /0003 { /glob "/api/*" /type "deny" }\n}\n');
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
  const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'repw-')));
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

// Fix 2: cache/clientheaders/virtualhosts are counted from inline farm bodies ONLY; when the
// converter moves custom entries into an $include'd file the inline output count is 0. That must
// render as advisory ("inline — verify via validate/lint"), NOT a false **DROPPED** on preserved
// config. Only filter (gate-echoed) and rewrite (reliably file-counted) keep hard verdicts.
test('coverage: cache rules moved to an $include render advisory (inline — verify), never DROPPED', () => {
  const outputSrcDir = mkCacheInIncludeOut();    // inline /cache is empty; the real rules live in an include
  const inventory = { ruleCounts: { filter: 0, rewrite: 0, cache: 3, clientheader: 0, virtualhost: 0 } };
  const verifyResult = { ok: true, failures: [], warnings: [] };
  const crossBoundary = { cmVars: [] };
  const md = REP.renderReport({ inventory, verifyResult, crossBoundary, outputSrcDir });
  assert.match(md, /\| cache \| 3 \| 0 \| inline — verify/);   // advisory: shows inline 0 but asserts no verdict
  assert.doesNotMatch(md, /\| cache \|.*DROPPED/);             // must NOT be a false DROPPED
  assert.match(md, /inline-counted/);                          // under-table advisory note present
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

// Fix C: a `|` in a dynamic handoff cell (variable name or file path) must be escaped as `\|` so
// it can't break the Markdown row into a spurious extra column.
test('CM handoff: escapes a | in the variable name and file path cells', () => {
  const outputSrcDir = mkOut(1);
  const inventory = { ruleCounts: { filter: 1, rewrite: 0, cache: 0, clientheader: 0, virtualhost: 0 } };
  const verifyResult = { ok: true, failures: [], warnings: [] };
  const crossBoundary = { cmVars: [{ name: 'PIPE|VAR', files: [{ path: '/x/a|b/site.vhost', line: 7 }], origin: 'external', secretLike: false }] };
  const md = REP.renderReport({ inventory, verifyResult, crossBoundary, outputSrcDir });
  const row = md.split('\n').find(l => l.includes('PIPE'));
  assert.ok(row, 'handoff row rendered');
  assert.match(row, /PIPE\\\|VAR/, 'variable-name pipe escaped as \\|');
  assert.match(row, /\/x\/a\\\|b\/site\.vhost:7/, 'file-path pipe escaped as \\|');
  // Structural columns must stay at 4: after stripping escaped `\|`, exactly 5 delimiter pipes remain.
  const structural = row.replace(/\\\|/g, '').split('|').length - 1;
  assert.strictEqual(structural, 5, 'exactly 5 unescaped | delimiters (4 columns) — no spurious column');
});
