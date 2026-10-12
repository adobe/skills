#!/usr/bin/env node
// skills/stardust/scripts/test/runtime-preflight.test.mjs — the pure part of runtime-preflight.mjs:
// failure messages recorded on sandboxed harnesses map to their cause class, each class + harness
// maps to a fix, harness detection from the environment; plus --help, usage errors and an --offline
// --json run from the skill tree (no playwright there: MISSING, never FAIL, exit 0). No browser.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, detectHarness, fixFor } from '../runtime-preflight.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime-preflight.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

check('classify: sandbox, missing browser, missing package, DNS, connect', () => {
  assert.equal(classify('browserType.launch: Target page, context or browser has been closed\n[pid=1][err] bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.1: Permission denied (1100)'), 'sandbox-blocked');
  assert.equal(classify("browserType.launch: Executable doesn't exist at /x/chrome-mac/Chromium.app"), 'browser-missing');
  assert.equal(classify("Cannot find package 'playwright' imported from /p/stardust/scripts/stardust/runtime-preflight.mjs"), 'playwright-missing');
  assert.equal(classify('fetch failed: ENOTFOUND'), 'dns-blocked');
  assert.equal(classify('fetch failed: ECONNREFUSED'), 'network-blocked');
  assert.equal(classify('something else'), 'unknown');
});

check('fixFor names the harness fix, else a generic one; both point at harness-notes', () => {
  assert.match(fixFor('sandbox-blocked', 'codex'), /danger-full-access/);
  assert.match(fixFor('network-blocked', 'codex'), /network_access=true/);
  assert.match(fixFor('dns-blocked', 'cursor'), /allowlist/);
  assert.match(fixFor('network-blocked', 'pi'), /blocks outbound network/);
  for (const k of ['sandbox-blocked', 'network-blocked']) assert.match(fixFor(k, null), /harness-notes\.md/);
  assert.match(fixFor('browser-missing', 'grok'), /playwright install chromium/);
});

check('detectHarness: Codex and Claude Code from their env, else null', () => {
  assert.equal(detectHarness({ CODEX_SANDBOX: 'seatbelt' }), 'codex');
  assert.equal(detectHarness({ CLAUDECODE: '1' }), 'claude');
  assert.equal(detectHarness({}), null);
});

const cwd = mkdtempSync(join(tmpdir(), 'preflight-'));
const run = (...a) => { const r = spawnSync(process.execPath, [SCRIPT, ...a], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDECODE: '', CODEX_SANDBOX: '', CODEX_SANDBOX_NETWORK_DISABLED: '', CODEX_HOME: '' } }); return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };

check('--help prints usage; a bad --harness or a missing value exits 2', () => {
  const h = run('--help'); assert.equal(h.code, 0); assert.match(h.out, /runtime-preflight\.mjs/);
  assert.equal(run('--harness', 'nope').code, 2);
  assert.equal(run('--url').code, 2);
});

check('--offline --json from the skill tree: playwright MISSING (not FAIL), outbound skipped, exit 0', () => {
  const r = run('--offline', '--json', '--harness', 'pi');
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.harness, 'pi');
  const by = Object.fromEntries(j.results.map((x) => [x.check, x]));
  assert.equal(by.node.status, 'ok');
  assert.ok(['ok', 'MISSING'].includes(by.playwright.status));
  assert.equal(by.outbound.status, 'skip');
  assert.equal(by.localhost.status, 'ok');
});

rmSync(cwd, { recursive: true, force: true });
console.log(failed ? `\n${failed} failing` : '\nruntime-preflight: all checks passed');
process.exit(failed ? 1 : 0);
