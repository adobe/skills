#!/usr/bin/env node
// skills/reskin/scripts/test/figma-gate-join.test.mjs — B0, the section join: parseMapping, anchors and
// matchSections over the fixture mapping and content model (pure), then runJoin and the CLI `join` against
// fixtures/figma-gate/page.html in plain Chromium (needs playwright; prints a skip line otherwise).
// Run: node <this file>.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { includedModules, readInputs, workDir } from '../figma-gate/io.mjs';
import { matchSections, runJoin } from '../figma-gate/join.mjs';
import { anchors, parseMapping } from '../figma-gate/mapping.mjs';
import { localTarget } from '../figma-gate/target.mjs';
import { makeProject } from './fixtures/figma-gate/setup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'figma-gate.mjs');
const FIX = join(HERE, 'fixtures', 'figma-gate');
const scratch = mkdtempSync(join(tmpdir(), 'figma-gate-join-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

const mapping = parseMapping(readFileSync(join(FIX, 'mapping.md'), 'utf8'));
const model = JSON.parse(readFileSync(join(FIX, 'content-model.json'), 'utf8'));
const a = anchors(model);
const modules = includedModules(JSON.parse(readFileSync(join(HERE, 'fixtures', 'figma-kit', 'curation-rules.json'), 'utf8')));
const dom = [
  { slot: 's01', module: 'M1', text: 'Welcome to the kit …', nested: false },
  { slot: 's02', module: 'M2', text: 'Everything in one place …', nested: false },
];

await check('parseMapping reads the slot table: modules, statuses, "—" as null', () => {
  assert.deepEqual(mapping, [
    { slot: 's01', module: 'M1', status: 'mapped' },
    { slot: 's02', module: 'M2', status: 'mapped' },
    { slot: 's03', module: null, status: 'chrome' },
  ]);
});

await check('parseMapping: first table with Status and Donor module; split slots; no table is a usage error', () => {
  const md = '| a | b |\n|---|---|\n| s09 | x |\n\n| Slot | Donor module | Status |\n|---|---|---|\n| **s07-news** | `M3` | mapped |\n| note | M1 | mapped |\n| s08 | — | new-module |\n';
  assert.deepEqual(parseMapping(md), [{ slot: 's07-news', module: 'M3', status: 'mapped' }, { slot: 's08', module: null, status: 'new-module' }]);
  assert.throws(() => parseMapping('# brief\n\n**s01** → M1'), /no slot table/);
  const multi = '| Page | Slot | Donor module | Status |\n|---|---|---|---|\n| a | s01 | M1 | mapped |\n| b | s01 | M2 (Hero) | mapped |\n| b | s02 | — | new-module |';
  assert.deepEqual(parseMapping(multi, 'b'), [{ slot: 's01', module: 'M2', status: 'mapped' }, { slot: 's02', module: null, status: 'new-module' }], 'a multi-page brief keeps the page\'s rows');
  assert.throws(() => parseMapping(multi), (e) => e.code === 2 && /Page column: pass --page/.test(e.message));
  assert.throws(() => parseMapping('# brief\n\n**s01** → M1'), (e) => e.name === 'UsageError' && e.code === 2 && /reference\/mapping-brief\.md § Entry schema/.test(e.message));
});

await check('parseMapping: a Donor module cell may name the module after its id, "M3 (Card Row)" → M3', () => {
  const md = '| # | Donor module | Status |\n|---|---|---|\n| s01 | M3 (Card Row) | mapped |\n| s02 | `M2` (Hero, dark) | mapped |\n| s03 | — (no donor module) | new-module |\n| s04 | Feature Grid | mapped |\n';
  assert.deepEqual(parseMapping(md), [
    { slot: 's01', module: 'M3', status: 'mapped' },
    { slot: 's02', module: 'M2', status: 'mapped' },
    { slot: 's03', module: null, status: 'new-module' },
    { slot: 's04', module: 'Feature Grid', status: 'mapped' },
  ]);
});

await check('parseMapping: an unknown Status is a usage error naming the four statuses', () => {
  const md = (status) => `| Slot | Donor module | Status |\n|---|---|---|\n| s01 | M1 | ${status} |\n`;
  for (const typo of ['new module', 'maped', '']) {
    assert.throws(() => parseMapping(md(typo)), (e) => e.name === 'UsageError' && e.code === 2 && /s01/.test(e.message) && /mapped \| new-module \| chrome \| carried-invisible/.test(e.message), typo);
  }
  assert.doesNotThrow(() => parseMapping(md('Carried-Invisible')));
});

await check('matchSections: a mapped row that names no Donor module is section drift', () => {
  const r = matchSections({ dom, mapping: [{ slot: 's01', module: null, status: 'mapped' }, mapping[1]], anchors: a, modules });
  assert.equal(r.pass, false);
  assert.ok(r.problems.includes('section drift: s01 is mapped but names no Donor module'), r.problems.join('\n'));
  const fresh = matchSections({ dom, mapping: [{ slot: 's01', module: null, status: 'new-module' }, mapping[1]], anchors: a, modules });
  assert.equal(fresh.pass, true, fresh.problems.join('\n'));
});

await check('anchors: first heading, else first ordered text, else the first 60 characters of visibleText; normalized', () => {
  assert.deepEqual([...a], [['s01', 'welcome to the kit'], ['s02', 'everything in one place'], ['s03', 'sample kit, all rights reserved.']]);
  const m = anchors({ sections: [
    { slot: 'a', headings: [{ text: '  Big\n  Title ' }], ordered: [{ kind: 'text', text: 'x' }], visibleText: 'y' },
    { slot: 'b', headings: [], ordered: [{ kind: 'image', alt: '' }, { kind: 'paragraph', text: 'Hello   World' }], visibleText: 'y' },
    { slot: 'c', ordered: [], visibleText: `Z ${'long '.repeat(30)}` },
  ] });
  assert.equal(m.get('a'), 'big title');
  assert.equal(m.get('b'), 'hello world');
  assert.equal(m.get('c'), `z ${'long '.repeat(30)}`.slice(0, 60).trim());
});

await check('matchSections passes the fixture and names module frame, selector and index', () => {
  const ok = matchSections({ dom, mapping, anchors: a, modules });
  assert.equal(ok.pass, true);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.sections[0], { slot: 's01', module: 'M1', node: '1:3', selector: 'main section[data-slot="s01"]', index: 0 });
  assert.deepEqual(ok.sections[1], { slot: 's02', module: 'M2', node: '1:7', selector: 'main section[data-slot="s02"]', index: 1 });
  assert.equal(ok.sections.length, 2);
});

await check('matchSections names every drift, each starting "section drift:"', () => {
  const drift = (d, m = mapping) => matchSections({ dom: d, mapping: m, anchors: a, modules }).problems.join('\n');
  assert.match(drift([dom[1], dom[0]]), /section drift: s02 before s01/);
  assert.match(drift([dom[0], dom[0], dom[1]]), /s01 appears 2 times/);
  assert.match(drift([dom[0]]), /s02 has no section/);
  assert.match(drift([{ ...dom[0], module: 'M2' }, dom[1]]), /s01 carries data-module="M2", mapping.md says M1/);
  assert.match(drift([dom[0], { ...dom[1], text: 'other copy' }]), /s02: anchor "everything in one place" not in the section/);
  assert.match(drift([dom[0], { ...dom[1], nested: true }]), /s02 is nested inside another data-slot section/);
  assert.match(drift(dom, [...mapping, { slot: 's04', module: 'M9', status: 'mapped' }]), /M9 is not an included module/);
  assert.match(drift([...dom, { slot: 's05', module: 'M1', text: 'x', nested: false }]), /s05 is in the page but not in mapping.md/);
  const bad = matchSections({ dom: [dom[1], dom[0], dom[0]], mapping, anchors: a, modules });
  assert.equal(bad.pass, false);
  assert.ok(bad.problems.every((p) => p.startsWith('section drift:')), bad.problems.join('\n'));
});

await check('matchSections: whitespace and case in the section text do not matter; a chrome row needs no section', () => {
  const r = matchSections({ dom: [{ ...dom[0], text: 'WELCOME   to\nthe KIT' }, dom[1]], mapping, anchors: a, modules });
  assert.deepEqual(r.problems, []);
});

await check('matchSections: split sub-slots map to one module; the parent anchor may sit in any one of them', () => {
  const sub = [{ slot: 's02-a', module: 'M2', status: 'mapped' }, { slot: 's02-b', module: 'M2', status: 'mapped' }];
  const r = matchSections({ dom: [{ slot: 's02-a', module: 'M2', text: 'x', nested: false }, { slot: 's02-b', module: 'M2', text: 'Everything in one place', nested: false }], mapping: sub, anchors: a, modules });
  assert.equal(r.pass, true);
  assert.deepEqual(r.sections.map((s) => s.slot), ['s02-a', 's02-b']);
});

await check("matchSections: split sub-slots check their parent's anchor across all parent-* sections, failing once", () => {
  const sub = [{ slot: 's02-a', module: 'M2', status: 'mapped' }, { slot: 's02-b', module: 'M2', status: 'mapped' }];
  const r = matchSections({ dom: [{ slot: 's02-a', module: 'M2', text: 'x', nested: false }, { slot: 's02-b', module: 'M2', text: 'y', nested: false }], mapping: sub, anchors: a, modules });
  assert.equal(r.pass, false);
  assert.deepEqual(r.problems, ['section drift: s02-*: anchor "everything in one place" not in any s02-* section']);
});

await check('matchSections: a new-module row has no frame to join; carried-invisible needs no section', () => {
  const m = [...mapping.slice(0, 2), { slot: 's06', module: null, status: 'new-module' }, { slot: 's07', module: null, status: 'carried-invisible' }];
  const r = matchSections({ dom: [...dom, { slot: 's06', module: null, text: 'x', nested: false }], mapping: m, anchors: a, modules });
  assert.deepEqual(r.problems, []);
  assert.equal(r.sections[2].node, null);
  assert.equal(r.sections[2].module, null);
});

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  runJoin and the join CLI against page.html (playwright not importable here; run this test in an environment that has it)'); }

if (playwrightOk) {
  const { chromium } = await import('playwright');
  const project = (n) => makeProject(join(scratch, n));
  const run = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  const sections = (html) => [...html.matchAll(/ {2}<section[\s\S]*?<\/section>\n/g)].map((m) => m[0]);

  await check('the target opens page.html at the width asked for, fonts ready', async () => {
    const p = project('open');
    const target = localTarget(pathToFileURL(p.page).href);
    assert.equal(target.regime, 'local');
    const { openBrowser } = await import('../../../diff/scripts/measure-live.mjs');
    const browser = await openBrowser(chromium, { tier: 'plain' });
    try {
      const page = await target.open(browser, 1440);
      assert.equal(await page.evaluate(() => innerWidth), 1440);
      assert.deepEqual((await target.join.collect(page)).map((s) => [s.slot, s.module, s.nested]), [['s01', 'M1', false], ['s02', 'M2', false]]);
      await page.context().close();
    } finally { await browser.close(); }
  });

  await check('runJoin passes page.html: two sections, the chrome row needs none; join.json is written', async () => {
    const p = project('pass');
    const inputs = readInputs(p.dir, p.slug, ['mapping', 'contentModel', 'rules']);
    const out = workDir(p.dir, p.slug);
    const result = await runJoin({ target: localTarget(pathToFileURL(p.page).href), inputs, out });
    assert.equal(result.pass, true, result.problems.join('\n'));
    assert.deepEqual(result.sections.map((s) => [s.slot, s.module, s.node, s.index]), [['s01', 'M1', '1:3', 0], ['s02', 'M2', '1:7', 1]]);
    assert.equal(result.regime, 'local');
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'join.json'), 'utf8')), result);
  });

  await check('CLI join: PASS line, exit 0, join.json under .work/reskin/gates/<slug>/figma/; a file path works as --url', () => {
    const p = project('cli-pass');
    const r = run(['join', '--page', p.slug, '--url', p.page, '--dir', p.dir], p.root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS/);
    assert.ok(existsSync(join(p.dir, '.work', 'reskin', 'gates', 'home', 'figma', 'join.json')));
    const u = run(['join', '--page', p.slug, '--url', pathToFileURL(p.page).href, '--dir', p.dir], p.root);
    assert.equal(u.status, 0, u.stdout + u.stderr);
  });

  await check('CLI join on a page with the two sections swapped: exit 1, "section drift" and FAIL on stdout', () => {
    const p = project('cli-swap');
    const html = readFileSync(p.page, 'utf8');
    const [s1, s2] = sections(html);
    writeFileSync(p.page, html.replace(s1, '@@1@@').replace(s2, s1).replace('@@1@@', s2));
    const r = run(['join', '--page', p.slug, '--url', p.page, '--dir', p.dir], p.root);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL/);
    assert.match(r.stdout, /section drift: s02 before s01/);
    const j = JSON.parse(readFileSync(join(p.dir, '.work', 'reskin', 'gates', 'home', 'figma', 'join.json'), 'utf8'));
    assert.equal(j.pass, false);
  });

  await check('CLI join: usage errors exit 2 (missing --page, missing --url, missing mapping.md)', () => {
    const p = project('cli-usage');
    assert.equal(run(['join', '--url', p.page, '--dir', p.dir], p.root).status, 2);
    assert.equal(run(['join', '--page', p.slug, '--dir', p.dir], p.root).status, 2);
    rmSync(join(p.dir, 'reskin', 'mapping.md'));
    const r = run(['join', '--page', p.slug, '--url', p.page, '--dir', p.dir], p.root);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /mapping\.md/);
  });
}

await check('--help lists join and its flags', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', cwd: scratch });
  assert.equal(r.status, 0, r.stderr);
  for (const s of ['join', '--page', '--url', 'section drift']) assert.ok(r.stdout.includes(s), `help lacks ${s}`);
});

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
