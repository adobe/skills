#!/usr/bin/env node
// Fixture runner: skills/replica/scripts/motion-assert.mjs — the browser half.
//
// Drives the instrument against two local harness pages (file://, nothing
// live) with the same observe JSON (schema 2: header morph, a scrollLeft
// carousel that advanced live, a dead logo strip, three tile entrances, an
// aria-expanded FAQ):
//   live-like.html     → verdict pass, exit 0 (chrome / widgets / entrances /
//                        stateMachines / pageErrors all pass)
//   dead-carousel.html → verdict fail, exit 1, the widgets row names the
//                        control (`.cards-carousel .next`: no observable
//                        changed) — the recorded shape: measure() cached
//                        clientWidth 0 inside a display:none section; every
//                        static check on that page passes
//   observe-v1.json    → entrances / stateMachines `not-asserted` (schema 1),
//                        the rest asserted; verdict from the asserted checks
//   observe-static     → verdict n/a on a page whose header never morphs
//   --record           → breakpoints.1440.motion.assert written on the fixture
//                        ledger copy; result untouched
// Browserless by design when playwright is not resolvable from the repo: one
// SKIP line, exit 0 (the pure halves are covered by
// skills/replica/scripts/test/motion-assert.test.mjs). Set
// STARDUST_GATE_DEPS=<dir>/node_modules to borrow a project's install.
//
// Usage: node plugins/stardust/evals/lint/motion-assert-fixtures.mjs  (exit 1 on findings)
/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PLUGIN = join(import.meta.dirname, '..', '..');
const SCRIPT = join(PLUGIN, 'skills', 'replica', 'scripts', 'motion-assert.mjs');
const FIX = join(import.meta.dirname, 'fixtures', 'motion-assert');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

let deps = null;
try { await import('playwright'); deps = 'repo'; } catch { /* not at the repo root */ }
if (!deps && process.env.STARDUST_GATE_DEPS && existsSync(join(process.env.STARDUST_GATE_DEPS, 'playwright'))) deps = process.env.STARDUST_GATE_DEPS;
if (!deps) { console.log('motion-assert-fixtures: SKIP browser fixtures — playwright not resolvable (set STARDUST_GATE_DEPS=<dir>/node_modules, or npm i -D playwright at the repo root)'); process.exit(0); }

// Run from a temp copy of the replica scripts dir so a borrowed node_modules
// resolves for the script (ESM resolution walks up from the script's path).
const tmp = mkdtempSync(join(tmpdir(), 'motion-assert-fx-'));
try {
  let script = SCRIPT;
  if (deps !== 'repo') {
    cpSync(join(PLUGIN, 'skills', 'replica', 'scripts'), join(tmp, 'skills', 'replica', 'scripts'), { recursive: true });
    cpSync(join(PLUGIN, 'skills', 'replica', 'reference'), join(tmp, 'skills', 'replica', 'reference'), { recursive: true });
    symlinkSync(resolve(deps), join(tmp, 'node_modules'));
    script = join(tmp, 'skills', 'replica', 'scripts', 'motion-assert.mjs');
  }
  const ledger = join(tmp, 'progress.json'); writeFileSync(ledger, readFileSync(join(FIX, 'progress.json')));
  const url = (f) => pathToFileURL(join(FIX, f)).href;
  const run = (args) => { const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 90000 }); return { status: r.status, out: `${r.stdout}${r.stderr}` }; };

  let r = run([join(FIX, 'observe-v2.json'), url('live-like.html'), '--record', ledger, '--slug', 'home', '--json']);
  let j = null; try { j = JSON.parse(r.out.split('\n').filter((l) => !l.startsWith('motion-assert')).join('\n')); } catch { /* asserted below */ }
  check(r.status === 0 && j?.verdict === 'pass', `live-like: verdict pass, exit 0 — got ${r.status}\n${r.out}`);
  check(j?.checks?.chrome?.status === 'pass' && j?.checks?.widgets?.status === 'pass' && j?.checks?.entrances?.status === 'pass' && j?.checks?.stateMachines?.status === 'pass' && j?.checks?.pageErrors?.status === 'pass', `live-like: every check passes — got ${JSON.stringify(j?.checks && Object.fromEntries(Object.entries(j.checks).map(([k, v]) => [k, `${v.status}: ${v.detail}`])))}`);
  check(/logo-strip \.next: n\/a/.test(j?.checks?.widgets?.detail || ''), 'live-like: the dead live widget is n/a (implement nothing)');
  const led = JSON.parse(readFileSync(ledger, 'utf8'));
  check(led.archetypes[0].breakpoints['1440'].motion?.assert?.verdict === 'pass' && led.archetypes[0].breakpoints['1440'].result.pixelPct === 2.14 && led.archetypes[0].motion.dead[0] === 'logo-strip-next', '--record: motion.assert written under breakpoints.1440; result and motion inventory untouched');

  r = run([join(FIX, 'observe-v2.json'), url('dead-carousel.html'), '--json']);
  j = null; try { j = JSON.parse(r.out.split('\n').filter((l) => !l.startsWith('motion-assert')).join('\n')); } catch { /* asserted below */ }
  check(r.status === 1 && j?.verdict === 'fail', `dead-carousel: verdict fail, exit 1 — got ${r.status}\n${r.out}`);
  check(j?.checks?.widgets?.status === 'fail' && /cards-carousel \.next: fail \(control .*no observable changed/.test(j?.checks?.widgets?.detail || ''), `dead-carousel: the widgets row names the dead control — got ${j?.checks?.widgets?.detail}`);
  check(j?.checks?.pageErrors?.status === 'pass' && j?.checks?.chrome?.status === 'pass', 'dead-carousel: every static check passes — only the control drive sees it');
  const text = run([join(FIX, 'observe-v2.json'), url('dead-carousel.html')]);
  check(/🟡 FAIL/.test(text.out) && /advisory this release \(D15/.test(text.out), 'text verdict is 🟡 advisory (D15 re-proposal)');

  r = run([join(FIX, 'observe-v1.json'), url('live-like.html'), '--json']);
  j = null; try { j = JSON.parse(r.out.split('\n').filter((l) => !l.startsWith('motion-assert')).join('\n')); } catch { /* asserted below */ }
  check(r.status === 0 && j?.verdict === 'pass' && j?.schema === 1 && j?.checks?.entrances?.status === 'not-asserted' && j?.checks?.stateMachines?.status === 'not-asserted', `schema 1: (a)/(c) not-asserted, the rest asserted — got ${r.status} ${JSON.stringify(j?.checks && Object.fromEntries(Object.entries(j.checks).map(([k, v]) => [k, v.status])))}`);

  r = run([join(FIX, 'observe-static.json'), url('live-like.html'), '--json', '--skip', 'entrances=fixture page has tiles the static observe does not']);
  j = null; try { j = JSON.parse(r.out.split('\n').filter((l) => !l.startsWith('motion-assert')).join('\n')); } catch { /* asserted below */ }
  check(r.status === 1 && j?.checks?.chrome?.status === 'fail' && /live is static, target morphs/.test(j?.checks?.chrome?.detail || '') && j?.skips?.entrances, `static live vs morphing target = invented motion, fail; --skip reason recorded — got ${r.status} ${j?.checks?.chrome?.detail}`);

  r = run([join(FIX, 'observe-v2.json'), url('live-like.html'), '--timeout', '1', '--record', ledger, '--slug', 'home', '--width', '360']);
  check(r.status === 124 && /⏱ none/.test(r.out), `--timeout expiry exits 124 with verdict none — got ${r.status}\n${r.out}`);
  const led2 = JSON.parse(readFileSync(ledger, 'utf8'));
  check(led2.archetypes[0].breakpoints['360'].motion?.assert?.verdict === 'none' && led2.archetypes[0].breakpoints['360'].result.pass === true, 'deadline record: verdict none under breakpoints.360, result untouched');
} finally { rmSync(tmp, { recursive: true, force: true }); }

if (failures.length) { console.error(`motion-assert-fixtures: ${failures.length} failure(s)\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log(`motion-assert-fixtures: ok (live-like pass, dead carousel named, schema-1 not-asserted, invented motion fails, --record, 124 → none) [deps: ${deps}]`);
