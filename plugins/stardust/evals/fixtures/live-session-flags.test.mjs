#!/usr/bin/env node
// Fixture test: every live-session.mjs importer parses the three session flags
// (live-session.mjs module docstring § Admitted-session reuse is the rule):
//   --storage-state <file> / --fresh-state / --solve-wait <ms>, spreads
//   sessionContextOptions(url, opts) into newLiveContext and passes solveWaitMs
//   to gotoLive; the four reskin importers map LiveLockError to exit 1 (the
//   lock is "wait for the other tool", not a usage/fatal 2).
// Also pins the two helpers: parseSolveWaitFlag (≥ 5000, makes the tier-3
// window visible) and sessionContextOptions (live side only). No browser.
// Usage: node plugins/stardust/evals/fixtures/live-session-flags.test.mjs  (exit 1 on failure)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionContextOptions, parseSolveWaitFlag } from '../../skills/diff/scripts/live-session.mjs';

const ROOT = join(import.meta.dirname, '..', '..', 'skills');
const IMPORTERS = [
  'replica/scripts/stitch-shot.mjs', 'replica/scripts/anchor.mjs', 'replica/scripts/chrome-parity.mjs', 'replica/scripts/motion-observe.mjs', 'replica/scripts/sibling-variance.mjs',
  'diff/scripts/content-diff.mjs', 'diff/scripts/visual-diff.mjs',
  'reskin/scripts/dom-equality.mjs', 'reskin/scripts/slot-coverage.mjs', 'reskin/scripts/donor-probe.mjs', 'reskin/scripts/capture-content.mjs',
];
const RESKIN = IMPORTERS.filter((f) => f.startsWith('reskin/'));
const code = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n'); // drop comment lines — the flag must be PARSED, not just documented

// the importer set itself: any script that opens a context through
// newLiveContext( (dynamics-detect/check only borrow the launcher) must be listed
const all = [];
for (const skill of readdirSync(ROOT)) {
  const dir = join(ROOT, skill, 'scripts');
  try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
  for (const f of readdirSync(dir)) if (f.endsWith('.mjs') && f !== 'live-session.mjs' && /\bnewLiveContext\(/.test(code(readFileSync(join(dir, f), 'utf8')))) all.push(`${skill}/scripts/${f}`);
}
const missing = all.filter((f) => !IMPORTERS.includes(f));
assert.deepEqual(missing, [], `every live-session importer must parse the session flags — add to the list and the script: ${missing}`);

for (const rel of IMPORTERS) {
  const src = code(readFileSync(join(ROOT, rel), 'utf8'));
  for (const flag of ['--storage-state', '--fresh-state', '--solve-wait']) {
    assert.ok(src.includes(`'${flag}'`) || src.includes(`'${flag.slice(2)}'`), `${rel}: parser has no case for ${flag}`);
  }
  assert.ok(/\.\.\.sessionContextOptions\(/.test(src), `${rel}: newLiveContext call does not spread sessionContextOptions(url, opts)`);
  assert.ok(/solveWaitMs: (opts|args)\.solveWaitMs/.test(src), `${rel}: gotoLive call does not pass solveWaitMs`);
  assert.ok(/parseSolveWaitFlag/.test(src), `${rel}: --solve-wait must go through parseSolveWaitFlag (≥ 5000, visible window)`);
  assert.ok(/(opts|args)\.headed = 3/.test(src), `${rel}: --solve-wait must imply tier 3 (opts.headed = 3)`);
}
for (const rel of RESKIN) {
  const src = code(readFileSync(join(ROOT, rel), 'utf8'));
  assert.ok(/e\.name === 'LiveLockError' \? 1/.test(src), `${rel}: LiveLockError must exit 1 (another live tool holds the origin), not 2`);
}

// helpers
const dir = mkdtempSync(join(tmpdir(), 'stardust-flags-'));
const state = join(dir, 'variant-b.json'); writeFileSync(state, JSON.stringify({ cookies: [{ name: 'ab', value: 'b', domain: '.example.test' }], origins: [] }));
const errs = []; const origErr = console.error; console.error = (m) => errs.push(String(m));
try {
  assert.deepEqual(sessionContextOptions('https://www.example.test/', { storageState: state }), { storageState: state }, 'explicit file → spread');
  assert.deepEqual(sessionContextOptions('http://localhost:3000/', { storageState: state }), {}, 'local side never gets a session (even when named)');
  assert.deepEqual(sessionContextOptions('https://www.example.test/', { freshState: true, storageState: state }), {}, '--fresh-state wins');
  assert.deepEqual(sessionContextOptions('https://www.example.test/', {}), {}, 'no flags, no reserved file in cwd → {}');
} finally { console.error = origErr; }
delete process.env.STARDUST_HEADED_WINDOW;
assert.throws(() => parseSolveWaitFlag('4000'), /≥ 5000/, 'below the floor → throw');
assert.throws(() => parseSolveWaitFlag(undefined), /≥ 5000/, 'missing value → throw');
assert.equal(process.env.STARDUST_HEADED_WINDOW, undefined, 'a rejected flag does not touch the window env');
assert.equal(parseSolveWaitFlag('90000'), 90000);
assert.equal(process.env.STARDUST_HEADED_WINDOW, '1', '--solve-wait implies a visible tier-3 window (a human cannot solve off-screen)');

console.log(`live-session-flags test: ok (${IMPORTERS.length} importers parse --storage-state / --fresh-state / --solve-wait; reskin LiveLockError → exit 1)`);
