#!/usr/bin/env node
// Fixture test: evals/lint/crawl-log-lint.mjs over two fixture trees
// (lint/fixtures/crawl-log/{good,bad}) — the extract Phase 2.5 rules are code:
//   `ok` + overlay note → finding; `ok` + captureQuality degraded → finding;
//   degraded / OVERLAY? page with no verdict → finding; recaptured / suspect
//   never fail; a missing _crawl-log.json is exit 2, not a pass.
// Usage: node plugins/stardust/evals/fixtures/crawl-log-lint.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const LINT = join(import.meta.dirname, '..', 'lint', 'crawl-log-lint.mjs');
const FIX = join(import.meta.dirname, '..', 'lint', 'fixtures', 'crawl-log');
const run = (...args) => spawnSync(process.execPath, [LINT, ...args], { encoding: 'utf8' });

const good = run('--dir', join(FIX, 'good'));
assert.equal(good.status, 0, `good tree must pass: ${good.stderr}`);
assert.match(good.stdout, /clean \(3 vision verdicts, 3 page records\)/);

const bad = run('--dir', join(FIX, 'bad'));
assert.equal(bad.status, 1, 'bad tree must fail');
assert.match(bad.stderr, /4 finding\(s\)/, `expected four findings, got:\n${bad.stderr}`);
assert.match(bad.stderr, /index: verdict ok but the note names an overlay/);
assert.match(bad.stderr, /pricing: verdict ok but crawl\.mjs recorded captureQuality degraded \(subResourceBlock:14\)/);
assert.match(bad.stderr, /contact: captureQuality degraded and no visionCheck entry/);
assert.match(bad.stderr, /team: overlayCoverPct 55 \(> 30\) and no visionCheck entry/);

const missing = run('--dir', join(FIX, 'nope'));
assert.equal(missing.status, 2, 'no log → exit 2 (usage), never a silent pass');

const help = run('--help');
assert.equal(help.status, 0);
assert.match(help.stdout, /Usage: node plugins\/stardust\/evals\/lint\/crawl-log-lint\.mjs/);

console.log('crawl-log-lint test: ok');
