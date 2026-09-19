#!/usr/bin/env node
// Smoke: skills/rollout/scripts/redirects.mjs (Phase D gate) against a fixture.
//
// Why: the script is a gate — exit 2 blocks the redirects sheet — so its three
// contracts need an input in the repo that exercises them: (1) a Source whose
// exact form equals a delivered path exits 2 and writes nothing; (2) a clean
// sheet emits one row per request FORM of each source (extensionless, slash,
// `.html` when the source carried it, original case) and drops forms that are
// delivered pages or the destination itself; (3) `--check` writes nothing.
//
// Usage: node plugins/stardust/evals/lint/redirects-smoke.mjs  (exit 1 on findings)
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = import.meta.dirname;
const SCRIPT = join(HERE, '..', '..', 'skills', 'rollout', 'scripts', 'redirects.mjs');
const FIX = join(HERE, 'fixtures', 'redirects');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

const run = (tsv, extra = []) => {
  const out = mkdtempSync(join(tmpdir(), 'redirects-smoke-'));
  cpSync(join(FIX, 'coverage'), join(out, 'coverage'), { recursive: true });
  const r = spawnSync(process.execPath, [SCRIPT, '--tsv', join(FIX, tsv), '--out', out, ...extra], { encoding: 'utf8' });
  const sheetPath = join(out, 'site', 'redirects.json');
  const sheet = existsSync(sheetPath) ? JSON.parse(readFileSync(sheetPath, 'utf8')) : null;
  rmSync(out, { recursive: true, force: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, sheet };
};

// (1) shadowing Source → exit 2, nothing written, the offending row named
const shadow = run('redirects-shadow.tsv');
check(shadow.status === 2, `shadow: expected exit 2, got ${shadow.status}`);
check(shadow.sheet === null, 'shadow: site/redirects.json must not be written on exit 2');
check(/\/It-IT\s+shadows\s+\/it-it/.test(shadow.stderr), 'shadow: stderr must name the Source and the page it shadows');

// (2) clean sheet → exit 0, exact row set
const clean = run('redirects.tsv');
check(clean.status === 0, `clean: expected exit 0, got ${clean.status}\n${clean.stderr}`);
const expected = [
  ['/old-about', '/about'], ['/old-about/', '/about'], ['/old-about.html', '/about'], ['/Old-About.html', '/about'],
  ['/services_old', '/services'], ['/services_old/', '/services'],
  ['/about/', '/about'],
].map(([s, d]) => `${s} → ${d}`).sort();
const got = clean.sheet ? clean.sheet.data.map((r) => `${r.Source} → ${r.Destination}`).sort() : [];
check(JSON.stringify(got) === JSON.stringify(expected), `clean: row set differs\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(got)}`);
check(clean.sheet && clean.sheet[':type'] === 'sheet' && clean.sheet.total === expected.length, 'clean: sheet envelope (:type, total) is wrong');

// (3) --check → exit 0, nothing written
const dry = run('redirects.tsv', ['--check']);
check(dry.status === 0, `check: expected exit 0, got ${dry.status}`);
check(dry.sheet === null, 'check: --check must not write site/redirects.json');

if (failures.length) { console.error(`redirects-smoke: ${failures.length} finding(s)`); for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
console.log(`redirects-smoke: ok (shadow → exit 2, ${expected.length} rows, --check writes nothing)`);
