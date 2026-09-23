#!/usr/bin/env node
// skills/dynamics/scripts/test/dynamics-check.test.mjs — compareSearchResults, the pure comparison the
// `search-query` check runs: what the migrated site returns for a probe term is compared with what the
// SOURCE showed for the same term — result COUNT (a mismatch fails), the top ≤ 3 titles as a set, no two
// results sharing title + text — not just the presence of one expected hit. Fixtures only: no browser, no
// network. Also: --help prints the header and writes nothing.
// Run: node plugins/stardust/skills/dynamics/scripts/test/dynamics-check.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareSearchResults } from '../dynamics-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'dynamics-check.mjs');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const row = (title, text = title, href = `/${title.toLowerCase().replace(/\s+/g, '-')}`) => ({ title, text, href });

// What the source showed for the probe term "bali": three title matches.
const SOURCE = { expectCount: 3, expectTitles: ['Bali Escape', 'Bali by Bike', 'Bali Food Trail'], expectIncludes: 'bali escape' };

check('the recorded defect: 10 entries with two home pages under one title against a source of 3 → FAIL on count, titles and duplicates', () => {
  const here = [row('Home', 'Home — welcome'), row('Home', 'Home — welcome', '/de'), row('Bali Escape'), row('Tours'), row('About us'), row('Bali by Bike'), row('Java Trek'), row('Contact'), row('Bali Food Trail'), row('Press')];
  const r = compareSearchResults(here, SOURCE);
  assert.equal(r.pass, false);
  assert.ok(r.reasons.includes('count 10 vs source 3'), r.reasons.join(' · '));
  assert.ok(r.reasons.some((x) => x.startsWith('top-3 titles differ — source: bali escape | bali by bike | bali food trail · here: home | home | bali escape')), r.reasons.join(' · '));
  assert.ok(r.reasons.some((x) => x.startsWith('duplicates (title + text): "home"')), r.reasons.join(' · '));
  assert.match(r.detail, /^10 results \(source 3\) · first: home · count 10 vs source 3/);
});

check('the same three titles, any order → PASS with a "matches the source" detail', () => {
  const r = compareSearchResults([row('Bali Food Trail'), row('Bali Escape'), row('Bali by Bike')], SOURCE);
  assert.equal(r.pass, true, r.detail);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.detail, '3 results (source 3) · first: bali food trail · matches the source');
});

check('count is exact by default and countTolerance widens it', () => {
  const four = [row('Bali Escape'), row('Bali by Bike'), row('Bali Food Trail'), row('Bali FAQ')];
  assert.equal(compareSearchResults(four, { expectCount: 3, expectTitles: SOURCE.expectTitles }).pass, false);
  assert.ok(compareSearchResults(four, { expectCount: 3 }).reasons.includes('count 4 vs source 3'));
  assert.equal(compareSearchResults(four, { expectCount: 3, countTolerance: 1, expectTitles: SOURCE.expectTitles }).pass, true);
  assert.ok(compareSearchResults(four, { expectCount: 2, countTolerance: 1 }).reasons.includes('count 4 vs source 2 (±1)'));
});

check('only the top ≤ 3 titles are compared, as a set; a fourth expected title is ignored', () => {
  const here = [row('Bali by Bike'), row('Bali Escape'), row('Bali Food Trail'), row('Something else')];
  const r = compareSearchResults(here, { expectTitles: ['Bali Escape', 'Bali by Bike', 'Bali Food Trail', 'Ignored'], expectCount: 4 });
  assert.equal(r.pass, true, r.detail);
  const wrong = compareSearchResults([row('Java Trek'), row('Bali Escape'), row('Bali by Bike'), row('Bali Food Trail')], { expectTitles: SOURCE.expectTitles, expectCount: 4 });
  assert.equal(wrong.pass, false);
  assert.match(wrong.reasons[0], /^top-3 titles differ — source: bali escape \| bali by bike \| bali food trail · here: java trek \| bali escape \| bali by bike$/);
});

check('titles compare after whitespace and case normalization; text and href count for expectIncludes', () => {
  const here = [row('  BALI   Escape '), row('bali by bike'), row('Bali Food\nTrail')];
  assert.equal(compareSearchResults(here, SOURCE).pass, true);
  assert.equal(compareSearchResults(here, { expectIncludes: '/bali-by-bike' }).pass, true, 'href matches');
  assert.equal(compareSearchResults(here, { expectIncludes: 'nowhere' }).pass, false);
  assert.ok(compareSearchResults(here, { expectIncludes: 'nowhere' }).reasons.includes('expected "nowhere" MISSING'));
});

check('duplicates are title + text: the same title with a different description is two results', () => {
  const dup = compareSearchResults([row('Home', 'Home — welcome'), row('Home', 'Home — welcome')], { expectCount: 2 });
  assert.equal(dup.pass, false); assert.ok(dup.reasons.some((x) => x.startsWith('duplicates')));
  const distinct = compareSearchResults([row('Home', 'Home — welcome'), row('Home', 'Home — the other locale')], { expectCount: 2 });
  assert.equal(distinct.pass, true, distinct.detail);
});

check('at least one expectation is required; no results fails unless the source had none either', () => {
  const none = compareSearchResults([row('x')], {});
  assert.equal(none.pass, false); assert.ok(none.reasons.includes('no expectation recorded (expectIncludes | expectCount | expectTitles)'));
  const empty = compareSearchResults([], { expectIncludes: 'x' });
  assert.ok(empty.reasons.includes('no results'));
  assert.equal(compareSearchResults([], { expectCount: 0 }).pass, true, 'the source returned nothing for this term too');
  assert.equal(compareSearchResults([], { expectCount: '0' }).pass, true, 'a string count is accepted');
});

check('the legacy string-results shape is accepted', () => {
  const r = compareSearchResults(['Bali Escape /bali-escape', 'Bali by Bike /bali-by-bike', 'Bali Food Trail /bali-food-trail'], { expectCount: 3, expectIncludes: 'bali escape' });
  assert.equal(r.pass, true, r.detail);
});

check('--help prints the header (naming expectCount) and writes nothing', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dynamics-check-help-'));
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', cwd });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /search-query/); assert.match(r.stdout, /expectCount/);
  assert.deepEqual(readdirSync(cwd), []);
  rmSync(cwd, { recursive: true, force: true });
});

console.log(failed ? `\ndynamics-check: ${failed} check(s) failed` : '\ndynamics-check: all checks passed');
process.exit(failed ? 1 : 0);
