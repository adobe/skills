#!/usr/bin/env node
/**
 * skills/replica/scripts/run-capped.mjs
 *
 * Run a command under a hard wall-clock deadline. macOS ships no `timeout`
 * binary, so every replica instrument that can stall (Playwright captures,
 * pixel compares on tall pages) gets its deadline from here instead of from
 * an agent-authored `sleep N; kill` loop.
 *
 * Why: across field migrations (2026-08/09, three sites independently)
 * `pixel-compare.mjs` / `stitch-shot.mjs` sat at 0 % CPU for 10+ minutes;
 * the coordinating agent lost the harness's 600 s command timeout on the
 * first hang, then wrapped later rounds in fixed `sleep 150; kill` guards —
 * a page's four gate rounds spent 30 minutes sleeping. A deadline is not a
 * measurement: exit 124 means "re-run, or raise the cap for a legitimately
 * huge page", never "the gate failed".
 *
 * Usage:
 *   node skills/replica/scripts/run-capped.mjs --timeout <s> [--label <name>] -- <cmd> [args...]
 *
 * The child runs in its own process group with inherited stdio; on the
 * deadline the whole group gets SIGTERM, then SIGKILL after 3 s (Chromium
 * children die with their driver). Exit code: the child's, or 124 on the
 * deadline (GNU `timeout` convention), 125 on usage error.
 *
 * Also importable: `runCapped(cmd, args, { timeoutSec, label })` → exit code.
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

export const DEADLINE_EXIT = 124;

export function runCapped(cmd, args, { timeoutSec = 0, label = cmd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', detached: process.platform !== 'win32' });
    let timedOut = false;
    const killGroup = (sig) => { try { if (child.pid) process.kill(process.platform === 'win32' ? child.pid : -child.pid, sig); } catch { /* already gone */ } };
    const forward = (sig) => () => { killGroup(sig); };
    const onInt = forward('SIGINT'); const onTerm = forward('SIGTERM');
    process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
    let timer = null;
    if (timeoutSec > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        console.error(`run-capped: ${label} exceeded ${timeoutSec}s — killed (exit ${DEADLINE_EXIT}). Instrument deadline, not a measurement: re-run; pass a longer --timeout only for a legitimately huge page.`);
        killGroup('SIGTERM');
        setTimeout(() => killGroup('SIGKILL'), 3000).unref();
      }, timeoutSec * 1000);
    }
    child.on('exit', (code, signal) => {
      if (timer) clearTimeout(timer);
      process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
      if (timedOut) resolve(DEADLINE_EXIT);
      else if (code !== null) resolve(code);
      else resolve(signal === 'SIGINT' ? 130 : 1);
    });
    child.on('error', (e) => { if (timer) clearTimeout(timer); console.error(`run-capped: cannot start ${label}: ${e.message}`); resolve(127); });
  });
}

function cli(argv) {
  const rest = argv.slice(2);
  const HELP = 'Usage: node run-capped.mjs --timeout <s> [--label <name>] -- <cmd> [args...]';
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  let timeoutSec = 0; let label = null;
  let i = 0;
  for (; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--timeout') { timeoutSec = Number(rest[i += 1]); }
    else if (a === '--label') { label = rest[i += 1]; }
    else if (a === '--') { i += 1; break; }
    else { console.error(`run-capped: unexpected argument ${a}\n${HELP}`); process.exit(125); }
  }
  const cmd = rest.slice(i);
  if (!cmd.length || !Number.isFinite(timeoutSec)) { console.error(`run-capped: need --timeout <s> and a command after --\n${HELP}`); process.exit(125); }
  // exitCode, not process.exit(): see pixel-compare.mjs header — a forced exit
  // can hang Node's platform shutdown; nothing keeps the loop alive here.
  runCapped(cmd[0], cmd.slice(1), { timeoutSec, label: label || cmd.slice(0, 2).join(' ') }).then((code) => { process.exitCode = code; });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) cli(process.argv);
