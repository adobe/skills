#!/usr/bin/env node
// skills/replica/scripts/test/reference-url.test.mjs — reference-url.mjs: the gate's reference is the page as the
// inventory lists it. Pure (no browser, no network): the folds the inventory already makes (www., scheme, trailing
// slash, fragment, query order, tracking parameters, the record's finalUrl, the crawl's origin redirect) pass; another
// rendering (an added query such as page-mode=static, another path, another host, a page record captured from one) is
// refused; an inconsistency-register entry naming both URLs turns the refusal into a surfaced substitution; the CLI's
// lines and exit codes in a temp project.
// Run: node plugins/stardust/skills/replica/scripts/test/reference-url.test.mjs
/* eslint-disable max-len */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFUSED_EXIT, alternateFor, checkReference, parseSubstituted, registerSubstitutions, renderingChanges, sameAsInventory, substitutionFor } from '../reference-url.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'reference-url.mjs');
let checks = 0; let failed = 0;
function check(name, fn) {
  checks += 1;
  try { fn(); console.log(`ok    ${name}`); } catch (e) { failed += 1; console.log(`FAIL  ${name}\n      ${String(e.stack || e).split('\n').join('\n      ')}`); }
}

const INV = 'https://www.example.com/webpage/abc';
const STATIC = 'https://www.example.com/webpage/abc?page-mode=static';
const REGISTER = `# Inconsistency register — <site> replica

## R-01 — footer link contrast

- **Evidence:** capture/crop-footer.png
- **Status:** applied

## R-02 — the static rendering stands in for the app rendering

- **Evidence:** screenshots/abc-app.png vs screenshots/abc-static.png, first viewport compared at 1440 and 360
- **Reference substitution:** ${STATIC} stands in for
  ${INV}: the app mode is a virtual-scroll page stitched capture cannot measure; the user agreed on 2026-11-25.
- **Status:** applied
`;

check('normal URL variants are the same page: www., scheme, trailing slash, fragment, query order, tracking parameters', () => {
  for (const u of [INV, `${INV}/`, 'https://example.com/webpage/abc', 'http://www.example.com/webpage/abc', `${INV}#top`, `${INV}?utm_source=x&gclid=1`, `${INV}?fbclid=2`]) assert.deepEqual(renderingChanges(INV, u), [], u);
  assert.deepEqual(renderingChanges('https://example.com/p?a=1&b=2', 'https://example.com/p?b=2&a=1&utm_medium=mail'), []);
  assert.deepEqual(checkReference({ slug: 'abc', inventoryUrl: INV, url: `${INV}/`, record: { url: INV } }).verdict, 'same');
});

check('a fallback rendering is refused: an added query (page-mode=static), a changed or removed one, another path, another host', () => {
  assert.deepEqual(renderingChanges(INV, STATIC), ['query page-mode=static added']);
  assert.deepEqual(renderingChanges('https://example.com/p?lang=en', 'https://example.com/p?lang=de'), ['query lang=de instead of lang=en']);
  assert.deepEqual(renderingChanges('https://example.com/p?lang=en', 'https://example.com/p'), ['query lang removed']);
  assert.deepEqual(renderingChanges(INV, 'https://www.example.com/amp/webpage/abc'), ['path /amp/webpage/abc instead of /webpage/abc']);
  assert.deepEqual(renderingChanges(INV, 'https://m.example.com/webpage/abc'), ['host m.example.com instead of example.com']);
  const r = checkReference({ slug: 'abc', inventoryUrl: INV, url: STATIC, record: { url: INV } });
  assert.equal(r.verdict, 'refused');
  assert.match(r.line, /^reference: REFUSED for abc: the gate URL https:\/\/www\.example\.com\/webpage\/abc\?page-mode=static is not the page the inventory lists \(https:\/\/www\.example\.com\/webpage\/abc\): query page-mode=static added\. /);
  assert.match(r.line, /Hardening rule 13/); assert.match(r.line, /Reference substitution/);
  assert.equal(checkReference({ slug: 'abc', inventoryUrl: INV, url: 'not a url' }).verdict, 'refused');
});

check('a page record captured from another rendering is refused, even when the gate loads the inventory URL', () => {
  const r = checkReference({ slug: 'abc', inventoryUrl: INV, url: INV, record: { url: STATIC }, recordFile: 'stardust/current/pages/abc.json' });
  assert.equal(r.verdict, 'refused');
  assert.match(r.line, /the page record stardust\/current\/pages\/abc\.json was captured from \S+page-mode=static, not from the inventory URL \S+: query page-mode=static added/);
  assert.equal(checkReference({ slug: 'abc', inventoryUrl: INV, record: { url: STATIC } }).verdict, 'refused', 'gate-all checks the record alone');
});

check('the redirects the inventory records are the same page: the record\'s finalUrl, the crawl\'s origin redirect', () => {
  const record = { url: 'https://example.com/old', finalUrl: 'https://example.com/new?lang=en' };
  assert.deepEqual(sameAsInventory('https://example.com/old', 'https://example.com/new?lang=en', { record }), { same: true, changes: [], via: 'the redirect the page record followed' });
  assert.equal(sameAsInventory('https://example.com/other', 'https://example.com/new?lang=en', { record }).same, false, 'a finalUrl counts only for the record captured through the inventory URL');
  // the inventory written from the landing URL: the record requested the old URL and landed on the inventory's
  const landed = { url: 'https://example.com/old', finalUrl: 'https://example.com/fr/new/' };
  assert.equal(checkReference({ slug: 'new', inventoryUrl: 'https://example.com/fr/new/', record: landed }).verdict, 'same', 'the record captured through a redirect to the inventory URL');
  assert.equal(checkReference({ slug: 'new', inventoryUrl: 'https://example.com/fr/new/', url: 'https://example.com/old', record: landed }).verdict, 'same', 'the gate loading the URL that redirects there');
  assert.equal(checkReference({ slug: 'new', inventoryUrl: 'https://example.com/fr/new/', url: 'https://example.com/fr/new?page-mode=static', record: landed }).verdict, 'refused');
  const crawlLog = { discovery: { originRedirect: { from: 'https://brand.test', to: 'https://www.brand-global.test' } } };
  assert.equal(sameAsInventory('https://brand.test/about', 'https://www.brand-global.test/about/', { crawlLog }).same, true, 'the same path on the adopted origin');
  assert.equal(sameAsInventory('https://brand.test/', 'https://www.brand-global.test/en/', { crawlLog }).same, true, 'the entry the crawl adopted: the root redirected to a path');
  assert.equal(sameAsInventory('https://brand.test/about', 'https://www.brand-global.test/contact', { crawlLog }).same, false, 'another path is still another page');
  assert.equal(sameAsInventory('https://brand.test/', 'https://www.brand-global.test/?page-mode=static', { crawlLog }).same, false, 'a rendering query is never folded by the redirect');
  const r = checkReference({ slug: 'home', inventoryUrl: 'https://brand.test/', url: 'https://www.brand-global.test/en/', record: { url: 'https://www.brand-global.test/en/' }, crawlLog });
  assert.equal(r.verdict, 'same'); assert.match(r.line, /via the origin redirect the crawl adopted/);
});

check('the inconsistency register: entries with a Reference substitution field naming two URLs (continuation lines too); others ignored', () => {
  const e = registerSubstitutions(REGISTER);
  assert.deepEqual(e, [{ id: 'R-02', title: 'the static rendering stands in for the app rendering', urls: [STATIC, INV] }]);
  assert.deepEqual(registerSubstitutions('## R-03 x\n\n- **Reference substitution**: https://a.test/p?print=1 for https://a.test/p.\n'), [{ id: 'R-03', title: 'x', urls: ['https://a.test/p?print=1', 'https://a.test/p'] }]);
  assert.deepEqual(registerSubstitutions('## R-04 one URL only\n- **Reference substitution:** https://a.test/p?print=1\n'), []);
  assert.deepEqual(registerSubstitutions('No entries — pure replica.\n'), []);
  assert.equal(substitutionFor(INV, STATIC, e).id, 'R-02');
  assert.equal(substitutionFor(INV, 'https://www.example.com/webpage/abc?page-mode=print', e), null, 'another rendering than the one recorded');
  assert.equal(substitutionFor('https://www.example.com/webpage/other', STATIC, e), null, 'another page\'s inventory URL');
  assert.deepEqual(alternateFor(`${INV}/`, e), { url: STATIC, entry: e[0] });
  assert.equal(alternateFor('https://www.example.com/', e), null);
});

check('a recorded substitution is allowed and surfaced: SUBSTITUTED, the entry, both URLs, "not the page visitors see"', () => {
  const register = registerSubstitutions(REGISTER);
  const r = checkReference({ slug: 'abc', inventoryUrl: INV, url: STATIC, record: { url: STATIC }, recordFile: 'stardust/current/pages/abc.json', register });
  assert.equal(r.verdict, 'substituted');
  assert.deepEqual(r.substitution, { url: STATIC, inventoryUrl: INV, entry: 'R-02', title: 'the static rendering stands in for the app rendering', changes: ['query page-mode=static added'], record: STATIC });
  assert.equal(r.line, `reference: SUBSTITUTED: ${STATIC} stands in for ${INV} (query page-mode=static added); the page record was captured from ${STATIC}, accepted by R-02 in the inconsistency register. A pass is a pass against that rendering, not the page visitors see: the run report says so`);
  assert.deepEqual(parseSubstituted(`gate.sh: ${r.line}`), { url: STATIC, inventoryUrl: INV, entry: 'R-02' });
  assert.equal(parseSubstituted('gate.sh: reference: frozen 2026-11-01'), null);
  // a recorded record substitution with an unrecorded gate URL is still refused
  assert.equal(checkReference({ slug: 'abc', inventoryUrl: INV, url: 'https://www.example.com/webpage/abc?print=1', record: { url: STATIC }, register }).verdict, 'refused');
  assert.equal(checkReference({ slug: 'abc', inventoryUrl: null, url: STATIC }).verdict, 'unchecked');
});

check('CLI in a project: same (exit 0), refused (exit 7, one line), substituted once registered (exit 0), unchecked, an unreadable state.json (exit 1, stderr), --help, usage 125', () => {
  const root = mkdtempSync(join(tmpdir(), 'reference-url-test-'));
  try {
    const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: root, encoding: 'utf8' });
    let r = run('abc', STATIC);
    assert.equal(r.status, 0); assert.equal(r.stdout.trim(), 'reference: unchecked: no state.json');
    mkdirSync(join(root, 'stardust/current/pages'), { recursive: true });
    writeFileSync(join(root, 'stardust/state.json'), '{ "pages": [');
    r = run('abc', STATIC);
    assert.equal(r.status, 1, 'a state.json that cannot be read is no answer, never unchecked'); assert.equal(r.stdout, '');
    assert.match(r.stderr, /^reference: ERROR: stardust\/state\.json exists but cannot be read as JSON, so the reference cannot be checked/);
    writeFileSync(join(root, 'stardust/state.json'), JSON.stringify({ flow: 'replica', pages: [{ slug: 'abc', url: INV, currentStatePath: 'stardust/current/pages/abc.json' }] }));
    writeFileSync(join(root, 'stardust/current/pages/abc.json'), JSON.stringify({ slug: 'abc', url: INV, finalUrl: INV }));
    r = run('abc', `${INV}/#x`);
    assert.equal(r.status, 0); assert.equal(r.stdout.trim(), `reference: the inventory URL ${INV}`);
    r = run('abc', STATIC);
    assert.equal(r.status, REFUSED_EXIT); assert.equal(r.stdout.trim().split('\n').length, 1); assert.match(r.stdout, /^reference: REFUSED for abc: the gate URL /);
    r = run('other', STATIC);
    assert.equal(r.status, 0); assert.equal(r.stdout.trim(), 'reference: unchecked: state.json has no row for other');
    mkdirSync(join(root, 'stardust/replica'), { recursive: true });
    writeFileSync(join(root, 'stardust/replica/inconsistency-register.md'), REGISTER);
    r = run('abc', STATIC);
    assert.equal(r.status, 0); assert.match(r.stdout, /^reference: SUBSTITUTED: \S+ stands in for \S+ \(query page-mode=static added\), accepted by R-02 /);
    r = run('abc', STATIC, '--register', 'missing.md');
    assert.equal(r.status, REFUSED_EXIT, '--register points elsewhere');
    r = run('--help');
    assert.equal(r.status, 0); assert.match(r.stdout, /^reference-url: /); assert.match(r.stdout, /Usage: node reference-url\.mjs <slug> <live-url>/);
    assert.equal(run('abc').status, 125); assert.equal(run('abc', INV, '--bogus').status, 125); assert.equal(run('abc', INV, '--state').status, 125);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

console.log(`\n${checks - failed}/${checks} passed`);
if (failed) process.exit(1);
