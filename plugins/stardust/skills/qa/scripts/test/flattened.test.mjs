#!/usr/bin/env node
/**
 * Fixture test for the flattened-collection detector (no network).
 * Run: node skills/qa/scripts/test/flattened.test.mjs
 *
 * Fixture 1 models the real-world miss this detector exists for: a directory
 * of 24 cohort companies (h4 name + p tag + p description) emitted as bare
 * default content between a designed masthead block and a CTA block — only
 * the middle prose dump is the defect.
 */
import { parseSections, detectFlattenedCollections } from '../checks/content.mjs';

const card = (i) => `<h4>Company ${i}</h4><p>Fintech</p><p>Company ${i} builds delightful workflow software for mid-market operators across three continents.</p>`;
const FLATTENED = `<div><div class="masthead"><div><h1>Accelerator</h1></div></div>${Array.from({ length: 24 }, (_, i) => card(i)).join('')}</div>\n<div><div class="closing-cta"><div><p>Apply now</p></div></div></div>`;

const PROSE = `<div><h2>Our story</h2>${Array.from({ length: 9 }, () => '<p>A long paragraph of ordinary narrative prose that flows from one thought to the next without any repeating structure at all.</p>').join('')}</div>`;

const BLOCKED = `<div><div class="cards">${Array.from({ length: 24 }, (_, i) => `<div><div><h4>Company ${i}</h4></div><div><p>Desc</p></div></div>`).join('')}</div></div>`;

const CENSUS = `<div>${Array.from({ length: 6 }, (_, i) => `<h3>Team member ${i}</h3><p>Bio line for this person.</p>${i % 2 ? '<p>Extra line.</p>' : ''}`).join('')}</div>`;

let failed = 0;
function expect(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failed += 1;
}

const f = detectFlattenedCollections(parseSections(FLATTENED));
expect('flattened directory fires', f.length === 1, JSON.stringify(f));
expect('cycle is h4+p+p ×24', f[0]?.repeats === 24 && f[0]?.cycle.join('+') === 'h4+p+p', JSON.stringify(f[0]));

const pr = detectFlattenedCollections(parseSections(PROSE));
expect('plain prose does not fire', pr.length === 0, JSON.stringify(pr));

const bl = detectFlattenedCollections(parseSections(BLOCKED));
expect('same cards inside a block do not fire', bl.length === 0, JSON.stringify(bl));

const ce = detectFlattenedCollections(parseSections(CENSUS));
expect('irregular team list fires via heading census', ce.length === 1 && ce[0].repeats === 6, JSON.stringify(ce));

process.exit(failed ? 1 : 0);
