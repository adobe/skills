#!/usr/bin/env node
/**
 * Negative fixture for the harness self-skip contract: a resolvable Playwright with NO
 * browser binary must make ew-editability-probe.test.mjs SKIP its harness cases (one
 * `SKIP …` line, exit 0), never fail them. Reproduced by pointing
 * PLAYWRIGHT_BROWSERS_PATH at an empty directory — Playwright then looks for
 * Chromium only there and `launch()` throws "Executable doesn't exist". Also pins
 * that the pure cases still run and pass under that environment.
 * The fixture is itself browser-dependent: it needs a RESOLVABLE playwright to exercise the
 * no-binary path, so when loadChromium() finds none it SKIPs (one `SKIP …` line, exit 0)
 * instead of passing on the suite's other skip reason — a pass here means the suite really
 * hit "chromium cannot launch", never "playwright is not resolvable".
 * Run: node --test skills/deploy/scripts/test/harness-skip.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadChromium } from '../ew-editability-probe.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SUITE = join(here, 'ew-editability-probe.test.mjs');

let resolvable = false;
try { resolvable = !!(await loadChromium()); } catch { /* skipped below */ }
const skip = resolvable ? false : 'playwright is not resolvable (project, bare or global) — the no-binary path cannot be exercised';
if (skip) console.log(`SKIP harness-skip negative fixture: ${skip}`);

test('ew-editability-probe.test.mjs self-skips its harness cases when Chromium has no binary (exit 0, SKIP line, pure cases pass)', { skip }, () => {
  const empty = mkdtempSync(join(tmpdir(), 'no-browsers-'));
  try {
    // a child `node --test` must not inherit the parent runner's context, or it reports over IPC instead of stdout
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const r = spawnSync(process.execPath, ['--test', SUITE], { encoding: 'utf8', env: { ...env, PLAYWRIGHT_BROWSERS_PATH: empty } });
    const out = r.stdout + r.stderr;
    assert.equal(r.status, 0, `suite must exit 0 without a browser binary:\n${out.slice(-2000)}`);
    assert.match(out, /SKIP ew-editability-probe harness tests: /, 'a SKIP line names why the harness cases did not run');
    assert.match(out, /\bfail 0\b/);
    assert.doesNotMatch(out, /\bpass 0\b/, 'the pure cases still ran');
    // playwright IS resolvable here (checked above), so the only legitimate skip reason is the missing binary
    const reason = out.match(/SKIP ew-editability-probe harness tests: ([^\n]*)/)?.[1] ?? '';
    assert.match(reason, /^chromium cannot launch: /, `the suite skipped for the wrong reason: ${reason}`);
    assert.doesNotMatch(reason, /playwright is not resolvable/, 'a resolvable playwright must not be reported as unresolvable');
  } finally { rmSync(empty, { recursive: true, force: true }); }
});
