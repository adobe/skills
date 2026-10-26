#!/usr/bin/env node
// skills/reskin/scripts/test/figma-gate-preview.test.mjs — figma-gate on a deployed preview (M2a Tasks 10 and 11): the join of
// the reskin page's data-slot sections to the preview's authored form (plainSections, plainJoin: pure), previewTarget, runJoin
// and the CLI `join --target preview` against the fake preview of fixtures/deployed/, then previewSelector (selectorFor,
// validateChecks, rampSpecs: pure) and geometry, ramp, pixel and all on that preview, with the settle carried to
// donor-probe (needs playwright, pngjs and pixelmatch; prints a skip line otherwise). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main } from '../figma-gate.mjs';
import { parseNormalizations } from '../figma/rules.mjs';
import { buildBoxes } from '../figma-gate/boxes.mjs';
import { selectorFor, validateChecks } from '../figma-gate/checks.mjs';
import { runGeometry } from '../figma-gate/geometry.mjs';
import { includedModules, readInputs, workDir as workDirOf } from '../figma-gate/io.mjs';
import { runJoin } from '../figma-gate/join.mjs';
import { anchors, parseMapping } from '../figma-gate/mapping.mjs';
import { plainJoin, plainSections } from '../figma-gate/plain-join.mjs';
import { prepare } from '../figma-gate/prepare.mjs';
import { rampSpecs, runRamp } from '../figma-gate/ramp.mjs';
import { localAttributes, previewTarget } from '../figma-gate/target.mjs';
import { plainUrl } from '../deployed/fetch.mjs';
import { rootTokens } from '../render/root-tokens.mjs';
import { KEY, VERSION, makeProject } from './fixtures/figma-gate/setup.mjs';
import { fixturePath, startPreviewServer } from './fixtures/deployed/servers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'figma-gate.mjs');
const FIX = join(HERE, 'fixtures', 'figma-gate');
const scratch = mkdtempSync(join(tmpdir(), 'figma-gate-preview-'));
const TOKEN = 'hlxtok-0123456789abcdef';
let failed = 0;
// Every run in this file is on a preview unless a call names the local regime.
const workDir = (dir, slug, regime = 'preview') => workDirOf(dir, slug, regime);
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

// One CLI run: { status, stdout, stderr, all }. Async: the fake preview lives in this process. The ambient hooks are cleared.
const run = (args, { cwd = scratch, env = {} } = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [SCRIPT, ...args], { cwd, env: { ...process.env, DEPLOY_VERIFY_ORIGIN: '', ...env } });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr, all: `${stdout}\n${stderr}` }));
});

const mapping = parseMapping(readFileSync(join(FIX, 'mapping.md'), 'utf8'));
const model = JSON.parse(readFileSync(join(FIX, 'content-model.json'), 'utf8'));
const a = anchors(model);
const modules = includedModules(JSON.parse(readFileSync(join(HERE, 'fixtures', 'figma-kit', 'curation-rules.json'), 'utf8')));
const PLAIN = readFileSync(fixturePath('home.plain.html'), 'utf8');
const local = [
  { slot: 's01', module: 'M1', text: 'Welcome to the kit A calm, readable starting point. Get started Learn more', nested: false },
  { slot: 's02', module: 'M2', text: 'Everything in one place Plan the work. Ship each change. New Try it', nested: false },
];
const plain = plainSections(PLAIN);
// The decorated page's sections as the browser reads them (innerText per main > div): the authored ones, one to one.
const decorated = plain.map((s) => s.text);
const joined = (over = {}) => plainJoin({ local, plain, decorated, mapping, anchors: a, modules, ...over });
const doc = (...divs) => `<body>\n<header><div>header</div></header>\n<main>\n${divs.join('\n')}\n</main>\n<footer><div>footer</div></footer>\n</body>`;
const sub = [{ slot: 's01', module: 'M1', status: 'mapped' }, { slot: 's02-a', module: 'M2', status: 'mapped' }, { slot: 's02-b', module: 'M2', status: 'mapped' }];

await check('plainSections: the top-level divs of the fixture, in order; the first is empty, the text is plain, decoded and case-folded', () => {
  assert.equal(plain.length, 3);
  assert.deepEqual(plain.map((s) => [s.index, s.empty]), [[0, true], [1, false], [2, false]]);
  assert.equal(plain[0].text, '');
  assert.ok(plain[1].text.startsWith('welcome to the kit a calm, readable starting point'), plain[1].text);
  assert.ok(plain[1].text.endsWith('get started learn more'), plain[1].text);
  assert.ok(plain[2].text.startsWith('everything in one place plan the work'), plain[2].text);
  assert.ok(plain[2].text.includes('review & keep the history'), `${plain[2].text}: &#x26; is decoded`);
  assert.ok(plain[2].text.endsWith('new try it'), plain[2].text);
});

await check('plainSections: nested divs (a block\'s rows and cells) never split a section; header and footer are outside', () => {
  const s = plainSections(doc('<div><div class="cards"><div><div><p>One</p></div></div><div><div><p>Two</p></div></div></div></div>', '<div><p>Three</p></div>'));
  assert.deepEqual(s.map((x) => [x.index, x.text, x.empty]), [[0, 'one two', false], [1, 'three', false]]);
});

await check('plainSections: a section holding nothing, or only a metadata or section-metadata block, is empty and keeps its index', () => {
  const meta = '<div class="metadata"><div><div>title</div><div>Hidden title</div></div></div>';
  const smeta = '<div class="section-metadata"><div><div>style</div><div>dark</div></div></div>';
  const s = plainSections(doc('<div></div>', '<div>\n  <div></div>\n</div>', `<div>${meta}</div>`, `<div>${smeta}</div>`, '<div class="Metadata Page"><div><div>x</div></div></div>', '<div><p>Real</p></div>'));
  assert.deepEqual(s.map((x) => [x.index, x.empty]), [[0, true], [1, true], [2, true], [3, true], [4, false], [5, false]]);
  assert.equal(s[2].text, '');
  assert.equal(s[3].text, '');
});

await check('plainSections: only a real class attribute names a metadata block (data-class, a class-like attribute value do not)', () => {
  const meta = (attrs) => `<div ${attrs}><div><div>title</div><div>Hidden title</div></div></div>`;
  const s = plainSections(doc(
    `<div>${meta('data-class="metadata"')}</div>`,
    `<div>${meta('title="x class=metadata"')}</div>`,
    `<div>${meta('data-class="metadata" class="hero"')}</div>`,
    `<div>${meta('id="m" class=\'metadata\'')}</div>`,
    `<div>${meta('DATA-CLASS=metadata CLASS=Section-Metadata')}</div>`,
  ));
  assert.deepEqual(s.map((x) => [x.index, x.text, x.empty]), [
    [0, 'title hidden title', false],
    [1, 'title hidden title', false],
    [2, 'title hidden title', false],
    [3, '', true],
    [4, '', true],
  ]);
});

await check('plainSections: a metadata block\'s text is left out of the section that holds it', () => {
  const smeta = '<div class="section-metadata"><div><div>style</div><div>dark</div></div></div>';
  const meta = '<div class="metadata"><div><div>title</div><div>Hidden title</div></div></div>';
  const s = plainSections(doc(`<div><h2>Hi there</h2>${smeta}<p>Body</p>${meta}</div>`));
  assert.deepEqual(s, [{ index: 0, text: 'hi there body', empty: false, blocks: [] }]);
});

await check('plainSections: tags come off without splitting words, blocks split text, entities decode, comments and scripts are ignored', () => {
  const s = plainSections(doc('<div><p>wor<strong>d</strong>s &amp; &#x26; &#38; &lt;b&gt;&nbsp;x</p><p>next</p><!-- <div> --><script>var s = "<div>";</script><style>.a > div {}</style></div>', '<div data-x="a>b"><p>t</p></div>'));
  assert.deepEqual(s.map((x) => x.text), ['words & & & <b> x next', 't']);
});

await check('plainSections: an image-only section is not empty; no <main> reads the whole document; an unclosed div ends at the end', () => {
  assert.deepEqual(plainSections(doc('<div><p><picture><img src="a.png" alt="x"></picture></p></div>')), [{ index: 0, text: '', empty: false, blocks: [] }]);
  assert.deepEqual(plainSections('<div>a</div><div>b</div>').map((x) => x.text), ['a', 'b']);
  assert.deepEqual(plainSections('<main><div><p>a</p></main>').map((x) => x.text), ['a']);
  assert.deepEqual(plainSections(''), []);
  assert.deepEqual(plainSections(undefined), []);
});

await check('plainJoin passes the fixture: s01 and s02 land on the decorated children 2 and 3, with their module frames', () => {
  const r = joined();
  assert.equal(r.pass, true, r.problems.join('\n'));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.notes, []);
  assert.deepEqual(r.sections, [
    { slot: 's01', module: 'M1', node: '1:3', selector: 'main > div:nth-child(2)', index: 1 },
    { slot: 's02', module: 'M2', node: '1:7', selector: 'main > div:nth-child(3)', index: 2 },
  ]);
});

await check('plainJoin: a section the decoration prepended (stock buildHeroBlock) moves the selectors to the decorated divs holding the anchors, with a note each', () => {
  const r = joined({ decorated: ['Banner promo', ...decorated] });
  assert.equal(r.pass, true, r.problems.join('\n'));
  assert.deepEqual(r.sections.map((s) => [s.slot, s.selector, s.index]), [['s01', 'main > div:nth-child(3)', 2], ['s02', 'main > div:nth-child(4)', 3]]);
  assert.deepEqual(r.notes, [
    's01: decoration moved plain section 1 to main > div:nth-child(3): the selector follows the decorated page',
    's02: decoration moved plain section 2 to main > div:nth-child(4): the selector follows the decorated page',
  ]);
});

await check('plainJoin: a section the decoration dropped (an empty one) moves the selectors up; only the moved slots are noted', () => {
  const r = joined({ decorated: decorated.slice(1) });
  assert.equal(r.pass, true, r.problems.join('\n'));
  assert.deepEqual(r.sections.map((s) => [s.slot, s.selector]), [['s01', 'main > div:nth-child(1)'], ['s02', 'main > div:nth-child(2)']]);
  assert.equal(r.notes.length, 2);
  const between = joined({ decorated: [decorated[0], decorated[1], 'Banner promo', decorated[2]] });
  assert.equal(between.pass, true, between.problems.join('\n'));
  assert.deepEqual(between.sections.map((s) => s.selector), ['main > div:nth-child(2)', 'main > div:nth-child(4)']);
  assert.deepEqual(between.notes, ['s02: decoration moved plain section 2 to main > div:nth-child(4): the selector follows the decorated page']);
});

await check('plainJoin: the decorated text is read as the browser gives it (newlines, case, spacing)', () => {
  const r = joined({ decorated: ['', 'WELCOME\nto the   kit\n\nGet started', 'Everything\nIN one place'] });
  assert.equal(r.pass, true, r.problems.join('\n'));
  assert.deepEqual(r.notes, []);
});

await check('plainJoin: a slot whose anchor is in no decorated section is section drift (the page was decorated without it)', () => {
  const r = joined({ decorated: [decorated[0], decorated[1], 'Something else entirely'] });
  assert.equal(r.pass, false);
  assert.deepEqual(r.problems, ['section drift: s02: anchor "everything in one place" not in any decorated main > div']);
  assert.deepEqual(r.sections.map((s) => s.slot), ['s01']);
});

await check('plainJoin: decorated sections in another order than the slots, or two slots in one decorated section, are section drift', () => {
  const swapped = joined({ decorated: [decorated[0], decorated[2], decorated[1]] });
  assert.deepEqual(swapped.problems, ['section drift: s02 before s01 in the decorated main: its text is in main > div:nth-child(2), s01 is in main > div:nth-child(3)']);
  const merged = joined({ decorated: [decorated[0], `${decorated[1]} ${decorated[2]}`] });
  assert.deepEqual(merged.problems, ['section drift: s02 shares main > div:nth-child(2) with s01: one decorated section per slot']);
});

await check('plainJoin: a slot the authored form lacks is reported once; the decorated page is searched for the slots found there only', () => {
  const r = joined({ plain: plain.slice(0, 2) });
  assert.deepEqual(r.problems, ['section drift: s02: anchor "everything in one place" not in any .plain.html section']);
});

await check('plainJoin: swapped plain sections are section drift', () => {
  const r = joined({ plain: [plain[0], { ...plain[2], index: 1 }, { ...plain[1], index: 2 }] });
  assert.equal(r.pass, false);
  assert.deepEqual(r.problems, ['section drift: s02 before s01 in .plain.html: its text is in plain section 1, s01 is in plain section 2']);
});

await check('plainJoin: an extra non-empty plain section is "plain section 3 matches no slot"; empty and metadata-only ones are not', () => {
  const extra = { index: 3, text: 'an author-added promo', empty: false };
  const r = joined({ plain: [...plain, extra] });
  assert.equal(r.pass, false);
  assert.deepEqual(r.problems, ['section drift: plain section 3 matches no slot']);
  assert.deepEqual(r.sections.map((s) => s.selector), ['main > div:nth-child(2)', 'main > div:nth-child(3)']);
  assert.equal(joined({ plain: [...plain, { index: 3, text: '', empty: true }] }).pass, true);
});

await check('plainJoin: an extra section between two slots is named, and the later slot still joins past it', () => {
  const r = joined({ plain: [plain[0], plain[1], { index: 2, text: 'promo', empty: false }, { ...plain[2], index: 3 }], decorated: [decorated[0], decorated[1], 'promo', decorated[2]] });
  assert.deepEqual(r.problems, ['section drift: plain section 2 matches no slot']);
  assert.equal(r.sections[1].selector, 'main > div:nth-child(4)');
});

await check('plainJoin: a slot absent from the plain sections, or two slots in one section, is drift', () => {
  assert.deepEqual(joined({ plain: plain.slice(0, 2) }).problems, ['section drift: s02: anchor "everything in one place" not in any .plain.html section']);
  const merged = { index: 1, text: `${plain[1].text} ${plain[2].text}`, empty: false };
  assert.deepEqual(joined({ plain: [plain[0], merged] }).problems, ['section drift: s02 shares plain section 1 with s01: one plain section per slot']);
});

await check('plainJoin: split sub-slots may share one plain section; their parent\'s anchor finds it', () => {
  const dom = [local[0], { slot: 's02-a', module: 'M2', text: 'lead', nested: false }, { slot: 's02-b', module: 'M2', text: 'Everything in one place', nested: false }];
  const r = joined({ local: dom, mapping: sub });
  assert.equal(r.pass, true, r.problems.join('\n'));
  assert.deepEqual(r.sections.map((s) => [s.slot, s.module, s.selector, s.index]), [
    ['s01', 'M1', 'main > div:nth-child(2)', 1],
    ['s02-a', 'M2', 'main > div:nth-child(3)', 2],
    ['s02-b', 'M2', 'main > div:nth-child(3)', 2],
  ]);
});

await check('plainJoin: the reskin page\'s own drift from mapping.md is reported too; a slot with no anchor cannot be found', () => {
  const r = joined({ local: [local[0]] });
  assert.ok(r.problems.includes('section drift: s02 has no section: add <section data-slot="s02"> inside <main>'), r.problems.join('\n'));
  assert.ok(r.problems.includes('section drift: plain section 2 matches no slot'), r.problems.join('\n'));
  const none = joined({ anchors: new Map([['s02', 'everything in one place']]) });
  assert.deepEqual(none.problems, ['section drift: s01 has no anchor text in content-model.json: it cannot be found in .plain.html', 'section drift: plain section 1 matches no slot']);
});

await check('plainJoin: whitespace, case and entities in the authored form do not matter', () => {
  const s = plainSections(doc('<div></div>', '<div><h1>WELCOME\n   to the   Kit</h1></div>', '<div><h2>Everything&nbsp;in one place</h2></div>'));
  assert.equal(joined({ plain: s }).pass, true);
});

const kitRead = (...p) => JSON.parse(readFileSync(join(HERE, 'fixtures', ...p), 'utf8'));
const kit = { boxes: buildBoxes({ nodes: kitRead('figma-kit', 'nodes.json'), roots: ['1:3', '1:7'] }), tokens: kitRead('figma-gate', 'donor-tokens.json'), rules: kitRead('figma-kit', 'curation-rules.json') };
const kitJoin = { sections: [{ slot: 's01', module: 'M1', node: '1:3', selector: 'main > div:nth-child(2)', index: 1 }, { slot: 's02', module: 'M2', node: '1:7', selector: 'main > div:nth-child(3)', index: 2 }] };
// The M2b checks file with the deployed DOM's selectors added where the blocks rebuilt the markup.
const PREVIEW_SELECTORS = {
  '.container': '.default-content-wrapper', '.btn': 'a.button', '.btn.secondary': 'a.button.secondary', '.lead': '.default-content-wrapper > p:nth-of-type(1)',
  '.card': '.cards > div', '.feature': '.cards > p', '.card-label': '.badge', '.card-btn': '.cards .try',
};
const previewChecks = (checks = kitRead('figma-gate', 'checks.json')) => {
  for (const section of Object.values(checks.sections)) {
    for (const e of [...section.geometry, ...section.type]) if (PREVIEW_SELECTORS[e.selector]) e.previewSelector = PREVIEW_SELECTORS[e.selector];
  }
  return checks;
};

await check('selectorFor: previewSelector on a preview, the selector otherwise and when there is no previewSelector', () => {
  const entry = { selector: '.card', previewSelector: '.cards > div' };
  assert.equal(selectorFor(entry, 'preview'), '.cards > div');
  assert.equal(selectorFor(entry, 'local'), '.card');
  assert.equal(selectorFor({ selector: '.card' }, 'preview'), '.card');
});

await check('validateChecks: previewSelector must be a string; a string is kept on geometry and type entries', () => {
  const ctx = { join: kitJoin, boxes: kit.boxes, tokens: kit.tokens };
  const ok = validateChecks(previewChecks(), ctx);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.sections.s02.geometry[0].previewSelector, '.cards > div');
  assert.equal(ok.sections.s02.type[1].previewSelector, '.badge');
  assert.equal(ok.sections.s02.type[0].previewSelector, undefined);
  const bad = previewChecks();
  bad.sections.s01.geometry[0].previewSelector = 3;
  bad.sections.s02.type[0].previewSelector = ['h2'];
  bad.sections.s02.geometry[1].previewSelector = '  ';
  assert.deepEqual(validateChecks(bad, ctx).problems, [
    'g1: previewSelector must be a string (a CSS selector scoped to the section)',
    'g2: previewSelector must not be blank',
    't1: previewSelector must be a string (a CSS selector scoped to the section)',
  ]);
});

await check('rampSpecs: on a preview the type entries are measured by previewSelector under the join\'s section selector; locally by selector', () => {
  const norm = parseNormalizations(kit.rules.normalizations, []);
  const rootEntries = rootTokens(kit.tokens).entries;
  const { sections } = validateChecks(previewChecks(), { join: kitJoin, boxes: kit.boxes, tokens: kit.tokens });
  const selectors = (regime) => [...new Set(rampSpecs({ join: kitJoin, checks: sections, boxes: kit.boxes, rootEntries, norm, regime }).get(1440).map((e) => e.selector))].filter((s) => s !== ':root');
  assert.deepEqual(selectors('preview'), [
    'main > div:nth-child(2) h1', 'main > div:nth-child(2) a.button', 'main > div:nth-child(2) .default-content-wrapper > p:nth-of-type(1)', 'main > div:nth-child(2) a.button.secondary',
    'main > div:nth-child(3) h2', 'main > div:nth-child(3) .badge', 'main > div:nth-child(3) .cards > p', 'main > div:nth-child(3) .cards .try',
  ]);
  assert.deepEqual(selectors('local'), [
    'main > div:nth-child(2) h1', 'main > div:nth-child(2) .btn', 'main > div:nth-child(2) .lead', 'main > div:nth-child(2) .btn.secondary',
    'main > div:nth-child(3) h2', 'main > div:nth-child(3) .card-label', 'main > div:nth-child(3) .feature', 'main > div:nth-child(3) .card-btn',
  ]);
});

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  previewTarget, runJoin and the join CLI against the fake preview (playwright not importable here; run this test in an environment that has it)'); }

await check('previewTarget: regime preview, the preview URL; an http(s) URL and an existing --reskin file are required', () => {
  const p = makeProject(join(scratch, 'target'));
  const t = previewTarget('http://127.0.0.1:9/ns/home', { reskin: p.page });
  assert.equal(t.regime, 'preview');
  assert.equal(t.url, 'http://127.0.0.1:9/ns/home');
  assert.equal(typeof t.open, 'function');
  assert.equal(typeof t.join.collect, 'function');
  assert.equal(typeof t.join.match, 'function');
  assert.throws(() => previewTarget(p.page, { reskin: p.page }), (e) => e.name === 'UsageError' && e.code === 2 && /http\(s\)/.test(e.message));
  assert.throws(() => previewTarget('http://127.0.0.1:9/ns/home', {}), (e) => e.name === 'UsageError' && /--reskin/.test(e.message));
  assert.throws(() => previewTarget('http://127.0.0.1:9/ns/home', { reskin: join(scratch, 'no-such.html') }), (e) => e.name === 'UsageError' && /no-such\.html/.test(e.message));
  assert.equal(localAttributes.name, 'data-slot');
});

await check('plainUrl: the authored form of a page, of a folder and of a .html path; query and fragment dropped', () => {
  assert.equal(plainUrl('http://127.0.0.1:9/ns/home'), 'http://127.0.0.1:9/ns/home.plain.html');
  assert.equal(plainUrl('http://127.0.0.1:9/'), 'http://127.0.0.1:9/index.plain.html');
  assert.equal(plainUrl('http://127.0.0.1:9/ns/blog/'), 'http://127.0.0.1:9/ns/blog/index.plain.html');
  assert.equal(plainUrl('http://127.0.0.1:9/ns/home.html?a=1#b'), 'http://127.0.0.1:9/ns/home.plain.html');
});

if (playwrightOk) {
  const { chromium } = await import('playwright');
  const { openBrowser } = await import('../../../diff/scripts/measure-live.mjs');
  const project = (n) => makeProject(join(scratch, n));
  const withBrowser = async (fn) => {
    const browser = await openBrowser(chromium, { tier: 'plain' });
    try { return await fn(browser); } finally { await browser.close(); }
  };
  const withPreview = async (opts, fn) => {
    const server = await startPreviewServer(opts);
    try { return await fn(server); } finally { await server.close(); }
  };
  const joinArgs = (p, url, extra = []) => ['join', '--page', p.slug, '--url', url, '--target', 'preview', '--reskin', p.page, '--dir', p.dir, ...extra];
  const joinJson = (p) => JSON.parse(readFileSync(join(workDir(p.dir, p.slug), 'join.json'), 'utf8'));

  // A copy of the home fixture's page (through `change`) with an authored form of its own → the page's path, to serve as /ns/home.
  const customPreview = (name, plainHtml, change = (html) => html) => {
    const dir = join(scratch, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'home.html'), change(readFileSync(fixturePath('home.html'), 'utf8')));
    writeFileSync(join(dir, 'home.plain.html'), plainHtml);
    return join(dir, 'home.html');
  };

  await check('previewTarget opens the settled preview at the width asked for', async () => {
    await withPreview({}, async (server) => {
      await withBrowser(async (browser) => {
        const p = project('open');
        const target = previewTarget(`${server.origin}/ns/home`, { reskin: p.page });
        const page = await target.open(browser, 1280);
        assert.equal(await page.evaluate(() => innerWidth), 1280);
        assert.equal(await page.evaluate(() => document.body.classList.contains('appear')), true);
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-block-status]')].every((el) => el.getAttribute('data-block-status') === 'loaded')), true);
        const { local, html, decorated: texts } = await target.join.collect(page);
        assert.deepEqual(local.map((s) => [s.slot, s.module, s.nested]), [['s01', 'M1', false], ['s02', 'M2', false]]);
        assert.equal(html, PLAIN);
        assert.equal(texts.length, 3);
        assert.equal(texts[0], '');
        assert.ok(texts[1].startsWith('Welcome to the kit') && texts[2].includes('Everything in one place'), texts.join(' | '));
        await page.context().close();
      });
    });
  });

  await check('previewTarget: a block that never decorates throws code 124 "stalled decoration: …"', async () => {
    await withPreview({ stallBlock: 'cards' }, async (server) => {
      await withBrowser(async (browser) => {
        const p = project('stall');
        const target = previewTarget(`${server.origin}/ns/home`, { reskin: p.page, edsTimeoutMs: 1000 });
        await assert.rejects(target.open(browser, 1440), (e) => e.code === 124 && /^stalled decoration: .*block cards/.test(e.message));
      });
    });
  });

  await check('previewTarget: a protected preview is a usage error (out of scope)', async () => {
    await withPreview({ token: TOKEN }, async (server) => {
      await withBrowser(async (browser) => {
        const p = project('protected');
        await assert.rejects(previewTarget(`${server.origin}/ns/home`, { reskin: p.page }).open(browser, 1440), (e) => e.name === 'UsageError' && /HTTP 401/.test(e.message) && /out of scope/.test(e.message));
      });
    });
  });

  await check('runJoin on a preview: PASS, join.json records regime preview, selectors main > div:nth-child(k) and the plain child index', async () => {
    await withPreview({}, async (server) => {
      const p = project('runjoin');
      const inputs = readInputs(p.dir, p.slug, ['mapping', 'contentModel', 'rules']);
      const out = workDir(p.dir, p.slug);
      const result = await runJoin({ target: previewTarget(`${server.origin}/ns/home`, { reskin: p.page }), inputs, out });
      assert.equal(result.pass, true, result.problems.join('\n'));
      assert.equal(result.regime, 'preview');
      assert.equal(result.url, `${server.origin}/ns/home`);
      assert.deepEqual(result.sections.map((s) => [s.slot, s.module, s.node, s.selector, s.index]), [
        ['s01', 'M1', '1:3', 'main > div:nth-child(2)', 1],
        ['s02', 'M2', '1:7', 'main > div:nth-child(3)', 2],
      ]);
      assert.deepEqual(JSON.parse(readFileSync(join(out, 'join.json'), 'utf8')), result);
    });
  });

  await check('prepare takes the preview target: the join, then the boxes and the validated checks, regime preview', async () => {
    await withPreview({}, async (server) => {
      const p = project('prepare');
      const target = previewTarget(`${server.origin}/ns/home`, { reskin: p.page });
      const ready = await prepare({ dir: p.dir, slug: p.slug, url: target.url, target });
      assert.equal(ready.drift, false, ready.drift ? ready.join.problems.join('\n') : '');
      assert.equal(ready.target.regime, 'preview');
      assert.equal(ready.join.regime, 'preview');
      assert.equal(ready.join.sections[0].selector, 'main > div:nth-child(2)');
    });
  });

  await check('CLI join --target preview: PASS line, exit 0, join.json.regime "preview" under .work/reskin/gates/<slug>/figma-preview/', async () => {
    await withPreview({}, async (server) => {
      const p = project('cli-pass');
      const r = await run(joinArgs(p, `${server.origin}/ns/home`), { cwd: p.root });
      assert.equal(r.status, 0, r.all);
      assert.match(r.stdout, /^PASS join: 2 section\(s\) joined to Figma modules \(s01 → M1, s02 → M2\)$/m);
      const j = joinJson(p);
      assert.equal(j.regime, 'preview');
      assert.equal(j.pass, true);
      assert.equal(j.url, `${server.origin}/ns/home`);
      assert.deepEqual(j.sections.map((s) => s.selector), ['main > div:nth-child(2)', 'main > div:nth-child(3)']);
    });
  });

  await check('CLI join --target local is the default and unchanged: regime local, the page file as --url', async () => {
    const p = project('cli-local');
    const r = await run(['join', '--page', p.slug, '--url', p.page, '--target', 'local', '--dir', p.dir], { cwd: p.root });
    assert.equal(r.status, 0, r.all);
    assert.equal(JSON.parse(readFileSync(join(workDir(p.dir, p.slug, 'local'), 'join.json'), 'utf8')).regime, 'local');
    assert.equal(existsSync(join(workDir(p.dir, p.slug), 'join.json')), false, 'a local run writes nothing under figma-preview/');
  });

  await check('CLI join --target preview: an extra non-empty authored section is exit 1 with "section drift: plain section 3 matches no slot"', async () => {
    const page = customPreview('extra', PLAIN.replace('</main>', '<div><p>An author-added promo</p></div>\n</main>'));
    await withPreview({ pages: { '/ns/home': page } }, async (server) => {
      const p = project('cli-extra');
      const r = await run(joinArgs(p, `${server.origin}/ns/home`), { cwd: p.root });
      assert.equal(r.status, 1, r.all);
      assert.match(r.stdout, /^FAIL join: 1 problem\(s\)/m);
      assert.match(r.stdout, /^ {2}section drift: plain section 3 matches no slot$/m);
      const j = joinJson(p);
      assert.equal(j.pass, false);
      assert.equal(j.regime, 'preview');
    });
  });

  await check('CLI join --target preview: swapped authored sections are exit 1, section drift', async () => {
    const lines = PLAIN.split('\n');
    const first = lines.indexOf('<main>') + 2;
    [lines[first], lines[first + 1]] = [lines[first + 1], lines[first]];
    const page = customPreview('swapped', lines.join('\n'));
    await withPreview({ pages: { '/ns/home': page } }, async (server) => {
      const p = project('cli-swapped');
      const r = await run(joinArgs(p, `${server.origin}/ns/home`), { cwd: p.root });
      assert.equal(r.status, 1, r.all);
      assert.match(r.stdout, /section drift: s02 before s01 in \.plain\.html/);
    });
  });

  const decoratedWith = (name, change) => customPreview(name, PLAIN, change);
  const firstSection = '<div class="section" data-section-status="initialized"></div>\n';

  await check('CLI join --target preview: a section the decoration prepended does not shift the sections: selectors follow the decorated divs, with notes', async () => {
    const promo = '<div class="section" data-section-status="initialized"><div class="default-content-wrapper"><p>Banner promo</p></div></div>\n';
    const page = decoratedWith('decorated-prepend', (html) => html.replace('<main>\n', `<main>\n${promo}`));
    await withPreview({ pages: { '/ns/home': page } }, async (server) => {
      const p = project('cli-prepend');
      const r = await run(joinArgs(p, `${server.origin}/ns/home`), { cwd: p.root });
      assert.equal(r.status, 0, r.all);
      assert.match(r.stdout, /^PASS join: 2 section\(s\)/m);
      assert.match(r.stdout, /^ {2}note: s01: decoration moved plain section 1 to main > div:nth-child\(3\)/m);
      const j = joinJson(p);
      assert.deepEqual(j.sections.map((s) => [s.slot, s.selector, s.index]), [['s01', 'main > div:nth-child(3)', 2], ['s02', 'main > div:nth-child(4)', 3]]);
      assert.equal(j.notes.length, 2);
      // The recorded selector measures the section of the slot: the decorated div at that position holds the slot's heading.
      const browser = await openBrowser(chromium, { tier: 'plain' });
      try {
        const page2 = await previewTarget(`${server.origin}/ns/home`, { reskin: p.page }).open(browser, 1440);
        assert.match(await page2.locator(j.sections[0].selector).innerText(), /^Welcome to the kit/);
        assert.match(await page2.locator(j.sections[1].selector).innerText(), /^Everything in one place/);
        await page2.context().close();
      } finally { await browser.close(); }
    });
  });

  await check('CLI join --target preview: an empty section the decoration dropped moves the selectors up (main > div:nth-child(1) and (2))', async () => {
    const page = decoratedWith('decorated-drop', (html) => html.replace(firstSection, ''));
    await withPreview({ pages: { '/ns/home': page } }, async (server) => {
      const p = project('cli-drop');
      const r = await run(joinArgs(p, `${server.origin}/ns/home`), { cwd: p.root });
      assert.equal(r.status, 0, r.all);
      assert.deepEqual(joinJson(p).sections.map((s) => s.selector), ['main > div:nth-child(1)', 'main > div:nth-child(2)']);
    });
  });

  await check('CLI join --target preview: a heading the decoration lost is exit 1, "section drift: s02: anchor … not in any decorated main > div"', async () => {
    const page = decoratedWith('decorated-lost', (html) => html.replace('<h2 id="everything-in-one-place">Everything in one place</h2>', '<h2>Something else</h2>'));
    await withPreview({ pages: { '/ns/home': page } }, async (server) => {
      const p = project('cli-lost');
      const r = await run(joinArgs(p, `${server.origin}/ns/home`), { cwd: p.root });
      assert.equal(r.status, 1, r.all);
      assert.match(r.stdout, /^ {2}section drift: s02: anchor "everything in one place" not in any decorated main > div$/m);
      assert.equal(joinJson(p).pass, false);
    });
  });

  await check('CLI join --target preview: a stalled decoration is exit 124 "stalled decoration: …" and no join.json', async () => {
    await withPreview({ stallBlock: 'cards' }, async (server) => {
      const p = project('cli-stall');
      const r = await run(joinArgs(p, `${server.origin}/ns/home`), { cwd: p.root });
      assert.equal(r.status, 124, r.all);
      assert.match(r.stderr, /stalled decoration: .*block cards/);
      assert.equal(existsSync(join(workDir(p.dir, p.slug), 'join.json')), false);
    });
  });

  await check('CLI join --target preview: a page the preview does not have is exit 124 (no verdict) naming the HTTP status', async () => {
    await withPreview({}, async (server) => {
      const p = project('cli-404');
      const r = await run(joinArgs(p, `${server.origin}/ns/missing`), { cwd: p.root });
      assert.equal(r.status, 124, r.all);
      assert.match(r.stderr, /HTTP 404/);
    });
  });

  await check('CLI join --target preview: a protected preview is exit 2 (out of scope)', async () => {
    await withPreview({ token: TOKEN }, async (server) => {
      const p = project('cli-401');
      const none = await run(joinArgs(p, `${server.origin}/ns/home`), { cwd: p.root });
      assert.equal(none.status, 2, none.all);
      assert.match(none.stderr, /HTTP 401.*protected.*out of scope/);
    });
  });

  // Checks, ramp, pixel and the register on the deployed page (Task 11).
  const previewProject = (n, checks = previewChecks()) => {
    const p = project(n);
    writeFileSync(join(p.dir, 'reskin', 'figma-checks', 'home.json'), `${JSON.stringify(checks, null, 2)}\n`);
    return p;
  };
  const stepArgs = (step, p, url, extra = []) => [step, '--page', p.slug, '--url', url, '--target', 'preview', '--reskin', p.page, '--dir', p.dir, ...extra];
  const stepFile = (p, name) => JSON.parse(readFileSync(join(workDir(p.dir, p.slug), name), 'utf8'));
  const readyOn = async (p, url) => {
    const ready = await prepare({ dir: p.dir, slug: p.slug, url, target: previewTarget(url, { reskin: p.page }) });
    assert.equal(ready.drift, false, ready.drift ? ready.join.problems.join('\n') : '');
    return ready;
  };

  await check('geometry on a preview: previewSelector measures the deployed card (560 vs 560); the same entry with only selector ".card" is unmeasurable there', async () => {
    await withPreview({}, async (server) => {
      const url = `${server.origin}/ns/home`;
      const measure = async (name, change) => {
        const checks = previewChecks();
        change(checks);
        const p = previewProject(name, checks);
        const ready = await readyOn(p, url);
        return runGeometry({ target: ready.target, join: ready.join, checks: ready.checks, boxes: ready.boxes, tokens: ready.tokens, out: ready.out });
      };
      const found = await measure('geo-preview', () => {});
      const card = found.results.find((x) => x.slot === 's02' && x.id === 'g1');
      assert.deepEqual([card.status, card.got, card.want, card.root, card.detail], ['PASS', 560, 560, '1:7', '560 vs 560 (±1)']);
      assert.deepEqual(found.results.filter((x) => x.status !== 'PASS'), []);
      const lost = await measure('geo-plain', (checks) => { delete checks.sections.s02.geometry[0].previewSelector; });
      const miss = lost.results.find((x) => x.slot === 's02' && x.id === 'g1');
      assert.deepEqual([miss.status, miss.got, miss.detail], ['FAIL', null, 'unmeasurable: .card matched nothing in the section']);
      assert.deepEqual(lost.results.filter((x) => x.status !== 'PASS').map((x) => x.id), ['g1']);
    });
  });

  await check('CLI geometry --target preview: PASS 10/10, geometry.json records regime preview, the url and the root of each result', async () => {
    await withPreview({}, async (server) => {
      const url = `${server.origin}/ns/home`;
      const p = previewProject('cli-geometry');
      const r = await run(stepArgs('geometry', p, url), { cwd: p.root });
      assert.equal(r.status, 0, r.all);
      assert.match(r.stdout, /^geometry PASS 10\/10$/m);
      const g = stepFile(p, 'geometry.json');
      assert.deepEqual([g.regime, g.url, g.pass], ['preview', url, true]);
      assert.deepEqual(g.results.map((x) => x.root), [...Array(6).fill('1:3'), ...Array(4).fill('1:7')]);
    });
  });

  await check('CLI geometry --target preview: a selector the deployed DOM lacks is one indented unmeasurable line, exit 1', async () => {
    await withPreview({}, async (server) => {
      const checks = previewChecks();
      delete checks.sections.s02.geometry[0].previewSelector;
      const p = previewProject('cli-geometry-miss', checks);
      const r = await run(stepArgs('geometry', p, `${server.origin}/ns/home`), { cwd: p.root });
      assert.equal(r.status, 1, r.all);
      assert.match(r.stdout, /^geometry FAIL 1\/10$/m);
      assert.match(r.stdout, /^ {2}s02 g1 width \(node I1:7;5:7\): unmeasurable: \.card matched nothing in the section$/m);
    });
  });

  // A page whose badge is 12px until its block is "loaded", 14px after: a probe that does not wait reads 12px.
  const lateBadge = (html) => html.replace('.cards .badge { font: 500 14px/20px', '.cards .badge { font: 500 12px/20px').replace('</style>', '.cards.block[data-block-status="loaded"] .badge { font-size: 14px; }\n</style>');

  await check('CLI ramp --target preview waits for the decoration (decorated 4 s after parse): the type entries pass, ramp.json records regime preview and the roots', async () => {
    const page = customPreview('late', PLAIN, lateBadge);
    await withPreview({ decorateDelayMs: 4000, pages: { '/ns/home': page } }, async (server) => {
      const url = `${server.origin}/ns/home`;
      const p = previewProject('cli-ramp');
      const r = await run(stepArgs('ramp', p, url), { cwd: p.root });
      assert.equal(r.status, 0, r.all);
      assert.match(r.stdout, /^ramp PASS (\d+)\/\1$/m);
      const j = stepFile(p, 'ramp.json');
      assert.deepEqual([j.regime, j.url, j.pass], ['preview', url, true]);
      const typed = j.results.filter((x) => x.slot !== null);
      assert.ok(typed.length >= 24);
      assert.ok(typed.every((x) => x.root === (x.slot === 's01' ? '1:3' : '1:7')), JSON.stringify(typed.find((x) => !x.root)));
      assert.ok(j.results.filter((x) => x.slot === null).every((x) => x.root === null));
      assert.equal(typed.find((x) => x.slot === 's02' && x.id === 't2' && x.property === 'fontSize').detail, '14px vs 14px');
    });
  });

  const probeStub = (p, body) => {
    const stub = join(p.root, 'probe-stub.mjs');
    const seen = join(p.root, 'probe-seen.json');
    writeFileSync(stub, [
      'import { readFileSync, writeFileSync } from "node:fs";',
      'const arg = (n) => process.argv[process.argv.indexOf(n) + 1];',
      `writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ argv: process.argv.slice(2) }));`,
      body,
    ].join('\n'));
    return { stub, seen: () => JSON.parse(readFileSync(seen, 'utf8')) };
  };
  const pass = 'const spec = JSON.parse(readFileSync(arg("--spec"), "utf8")); writeFileSync(arg("--json"), JSON.stringify({ pass: true, results: spec.map((e) => ({ label: e.label, status: "PASS", detail: "x" })) }));';

  await check('runRamp on a preview passes donor-probe --wait-eds and the preview URL', async () => {
    await withPreview({}, async (server) => {
      const url = `${server.origin}/ns/home`;
      const p = previewProject('ramp-stub');
      const ready = await readyOn(p, url);
      const probe = probeStub(p, pass);
      await runRamp({ target: ready.target, join: ready.join, checks: ready.checks, boxes: ready.boxes, tokens: ready.tokens, rules: ready.rules, out: ready.out, donorProbe: probe.stub });
      const given = probe.seen();
      assert.ok(given.argv.includes('--wait-eds'), given.argv.join(' '));
      assert.equal(given.argv[given.argv.indexOf('--rendered') + 1], url);
    });
  });

  await check('runRamp on a preview: a probe that stalls on the decoration is no verdict (code 124, not a usage error); a probe exit 3 stays code 3; another exit 2 is a usage error', async () => {
    await withPreview({}, async (server) => {
      const url = `${server.origin}/ns/home`;
      const p = previewProject('ramp-stall');
      const ready = await readyOn(p, url);
      const ramp = (probe, extra = {}) => runRamp({ target: ready.target, join: ready.join, checks: ready.checks, boxes: ready.boxes, tokens: ready.tokens, rules: ready.rules, out: ready.out, donorProbe: probe.stub, ...extra });
      const stalled = probeStub(p, 'console.error("[donor-probe] stalled decoration: block cards"); process.exit(2);');
      await assert.rejects(ramp(stalled), (e) => e.code === 124 && e.name !== 'UsageError' && /stalled decoration: block cards/.test(e.message));
      const challenged = probeStub(p, 'console.error("[donor-probe] bot challenge"); process.exit(3);');
      await assert.rejects(ramp(challenged), (e) => e.code === 3 && /bot challenge/.test(e.message));
      const setup = probeStub(p, 'console.error("[donor-probe] --spec not readable"); process.exit(2);');
      await assert.rejects(ramp(setup), (e) => e.name === 'UsageError' && /--spec not readable/.test(e.message));
    });
  });

  let pngOk = false;
  try { await import('pngjs'); await import('pixelmatch'); pngOk = true; } catch { console.log('skip  pixel --target preview (pngjs and pixelmatch are not importable here; run this test in an environment that has them)'); }

  if (pngOk) {
    const { PNG } = await import('pngjs');
    const { cacheFor } = await import('../figma/cache.mjs');
    // The frame image: figma-frame.html drawn at 1440×1840, as M1 would cache it for frame 1:2.
    const frameImage = async (p) => {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1840 } });
        await page.goto(pathToFileURL(join(p.root, 'figma-frame.html')).href);
        const v = cacheFor(p.dir, KEY).version(VERSION);
        mkdirSync(dirname(v.path('images/1-2.png')), { recursive: true });
        writeFileSync(v.path('images/1-2.png'), await page.screenshot());
        v.write('images.json', { '1:2': 'images/1-2.png' });
      } finally { await browser.close(); }
    };

    await check('CLI pixel --target preview: advisory, the decorated section at the join selector is the screenshot, a frame whose copy differs is n/a; pixel.json records regime, root and fonts', async () => {
      await withPreview({}, async (server) => {
        const url = `${server.origin}/ns/home`;
        const p = previewProject('cli-pixel');
        await frameImage(p);
        const r = await run(stepArgs('pixel', p, url), { cwd: p.root });
        assert.equal(r.status, 0, r.all);
        assert.match(r.stdout, /^pixel advisory: 2 section\(s\); uncalibrated reference/m);
        assert.match(r.stdout, /^ {2}s01 \d+\.\d\d% \(text (\d+\.\d\d%|n\/a), Δh -?\d+\)$/m);
        assert.match(r.stdout, /^ {2}s02 n\/a: frame content differs$/m);
        const j = stepFile(p, 'pixel.json');
        assert.deepEqual([j.regime, j.url], ['preview', url]);
        const [s01, s02] = j.results;
        assert.deepEqual([s01.slot, s01.verdict, s01.root, s02.slot, s02.verdict, s02.root], ['s01', 'advisory', '1:3', 's02', 'n/a', '1:7']);
        assert.ok(s01.fonts.some((f) => f.family === 'Inter' && typeof f.served === 'boolean'), JSON.stringify(s01.fonts));
        const shot = PNG.sync.read(readFileSync(join(workDir(p.dir, p.slug), 's01.page.png')));
        assert.equal(shot.width, 1440);
        assert.ok(shot.height > 400 && shot.height < 800, `the section screenshot is ${shot.height}px tall`);
        assert.ok(existsSync(join(workDir(p.dir, p.slug), 's01.diff.png')));
      });
    });

    await check('pixel --target preview, mode fixture: the section is found on the local fixture by data-slot, not by the preview\'s main > div selector', async () => {
      await withPreview({}, async (server) => {
        const checks = previewChecks();
        checks.sections.s02.pixel = { mode: 'fixture', fixtureUrl: pathToFileURL(join(scratch, 'cli-pixel-fixture', 'figma-frame.html')).href };
        const p = previewProject('cli-pixel-fixture', checks);
        await frameImage(p);
        const r = await run(stepArgs('pixel', p, `${server.origin}/ns/home`), { cwd: p.root });
        assert.equal(r.status, 0, r.all);
        const s02 = stepFile(p, 'pixel.json').results.find((x) => x.slot === 's02');
        assert.deepEqual([s02.mode, s02.verdict, s02.pct], ['fixture', 'advisory', 0], JSON.stringify(s02));
      });
    });
  }

  await check('CLI all --target preview: every step runs on the deployed page; summary.json, its ledger fragment and every step file record regime preview', async () => {
    await withPreview({}, async (server) => {
      const url = `${server.origin}/ns/home`;
      const p = previewProject('cli-all');
      const r = await run(stepArgs('all', p, url), { cwd: p.root });
      assert.equal(r.status, 0, r.all);
      for (const pattern of [/^PASS join: 2 section\(s\)/m, /^geometry PASS 10\/10$/m, /^ramp PASS (\d+)\/\1$/m, /^pixel advisory/m, /^register written: /m]) assert.match(r.stdout, pattern);
      const s = stepFile(p, 'summary.json');
      assert.deepEqual([s.page, s.url, s.regime, s.ledgerFragment.regime], ['home', url, 'preview', 'preview']);
      assert.deepEqual(Object.entries(s.steps).map(([k, v]) => [k, v.verdict, v.exit]), [['join', 'PASS', 0], ['geometry', 'PASS', 0], ['ramp', 'PASS', 0], ['pixel', 'advisory', 0], ['register', 'written', 0]]);
      assert.deepEqual([s.ledgerFragment.join, s.ledgerFragment.geometry, s.ledgerFragment.figmaVersion], ['PASS', 'PASS 10/10', VERSION]);
      for (const f of ['join.json', 'geometry.json', 'ramp.json', 'pixel.json', 'register.json']) assert.equal(stepFile(p, f).regime, 'preview', f);
      assert.ok(s.invocation.includes(`--target preview --reskin ${p.page}`), s.invocation);
      assert.equal(s.ledgerFragment.invocation, s.invocation);
    });
  });

  await check('CLI all --target preview beside a local run: the local run\'s files stay in figma/, the preview run\'s are written to figma-preview/', async () => {
    await withPreview({}, async (server) => {
      const p = previewProject('cli-all-beside-local');
      const local = workDir(p.dir, p.slug, 'local');
      mkdirSync(local, { recursive: true });
      const kept = Object.fromEntries(['join.json', 'geometry.json', 'ramp.json', 'pixel.json', 'register.json', 'register.md', 'summary.json'].map((f) => [f, `local run ${f}\n`]));
      for (const [f, text] of Object.entries(kept)) writeFileSync(join(local, f), text);
      const r = await run(stepArgs('all', p, `${server.origin}/ns/home`), { cwd: p.root });
      assert.equal(r.status, 0, r.all);
      assert.deepEqual(readdirSync(local).sort(), Object.keys(kept).sort(), 'the preview run added nothing to the local directory');
      for (const [f, text] of Object.entries(kept)) assert.equal(readFileSync(join(local, f), 'utf8'), text, `${f} of the local run was deleted or overwritten`);
      assert.ok(workDir(p.dir, p.slug).endsWith(join('gates', 'home', 'figma-preview')));
      assert.equal(stepFile(p, 'summary.json').regime, 'preview');
      assert.ok(r.stdout.trimEnd().split('\n').at(-1).endsWith(join('figma-preview', 'register.md')), r.stdout);
      assert.match(stepFile(p, 'summary.json').ledgerFragment.coverage, /^text styles 8\/8 · widths 1440 · waived 0$/);
    });
  });

  await check('CLI all --target preview on a page that never decorates: join is "ERROR (exit 124) … stalled decoration", exit 124, and the summary still records regime preview', async () => {
    await withPreview({ stallBlock: 'cards' }, async (server) => {
      const p = previewProject('cli-all-stall');
      const r = await run(stepArgs('all', p, `${server.origin}/ns/home`), { cwd: p.root });
      assert.equal(r.status, 124, r.all);
      assert.match(r.stdout, /^ERROR \(exit 124\) join CRASH: stalled decoration: .*block cards$/m);
      const s = stepFile(p, 'summary.json');
      assert.deepEqual([s.regime, s.ledgerFragment.regime], ['preview', 'preview']);
    });
  });
}

await check('CLI usage errors: --target preview needs --reskin; a bad --target and a missing --reskin file are exit 2', async () => {
  const p = makeProject(join(scratch, 'usage'));
  const url = 'http://127.0.0.1:9/ns/home';
  const base = ['join', '--page', p.slug, '--url', url, '--dir', p.dir];
  const argsFor = (at) => ['join', '--page', p.slug, '--url', at, '--dir', p.dir, '--target', 'preview', '--reskin', p.page];
  const withReskin = argsFor(url);
  const cases = [
    [[...base, '--target', 'preview'], /--target preview needs --reskin/],
    [[...withReskin, '--reskin'], /--reskin needs a value/],
    [[...base, '--target', 'remote'], /--target is local or preview, got "remote"/],
    [[...base, '--target', 'preview', '--reskin', join(scratch, 'no-such.html')], /no-such\.html/],
    [[...base, '--reskin', p.page], /--reskin applies to --target preview/],
    [['join', '--page', p.slug, '--target', 'preview', '--reskin', p.page, '--dir', p.dir], /join needs --url/],
    [argsFor('file:///x/page.html'), /http\(s\)/],
  ];
  for (const [args, pattern] of cases) {
    const r = await run(args, { cwd: p.root });
    assert.equal(r.status, 2, `${args.slice(4).join(' ')}\n${r.all}`);
    assert.match(r.stderr, pattern, args.slice(4).join(' '));
  }
  assert.equal(existsSync(join(workDir(p.dir, p.slug), 'join.json')), false);
});

await check('a usage error names what it did not understand: a stray argument, an unknown --x=… flag by its name', async () => {
  const p = makeProject(join(scratch, 'usage-names'));
  const plainRun = await run(['join', 'stray-arg', '--page', p.slug], { cwd: p.root });
  assert.equal(plainRun.status, 2, plainRun.all);
  assert.match(plainRun.stderr, /unexpected argument "stray-arg"/);
  const other = await run(['join', `--dir=${join(scratch, 'x')}`, '--page', p.slug], { cwd: p.root });
  assert.equal(other.status, 2, other.all);
  assert.match(other.stderr, /unknown flag --dir for join: .*--dir <value>/);
  const known = await run(['join', '--bogus', '--page', p.slug], { cwd: p.root });
  assert.match(known.stderr, /unknown flag --bogus for join/);
});

await check('geometry, ramp, pixel and all take --target preview like join: it needs --reskin and --reskin needs it, exit 2 before any browser; register takes --target alone, to read the preview run', async () => {
  const p = makeProject(join(scratch, 'later'));
  const url = 'http://127.0.0.1:9/ns/home';
  for (const step of ['geometry', 'ramp', 'pixel', 'all']) {
    const bare = await run([step, '--page', p.slug, '--url', url, '--target', 'preview', '--dir', p.dir], { cwd: p.root });
    assert.equal(bare.status, 2, `${step}\n${bare.all}`);
    assert.match(bare.stderr, /--target preview needs --reskin/);
    assert.doesNotMatch(bare.stderr, /later task/);
    const local = await run([step, '--page', p.slug, '--url', url, '--reskin', p.page, '--dir', p.dir], { cwd: p.root });
    assert.equal(local.status, 2, `${step}\n${local.all}`);
    assert.match(local.stderr, /--reskin applies to --target preview/);
  }
  const r = await run(['register', '--page', p.slug, '--target', 'preview', '--dir', p.dir], { cwd: p.root });
  assert.equal(r.status, 2, r.all);
  assert.match(r.stderr, /no .*figma-preview[/\\]join\.json/, 'register --target preview looks in the preview run\'s directory');
  for (const flag of [['--reskin', p.page]]) {
    const other = await run(['register', '--page', p.slug, '--target', 'preview', ...flag, '--dir', p.dir], { cwd: p.root });
    assert.equal(other.status, 2, other.all);
    assert.match(other.stderr, new RegExp(`unknown flag ${flag[0]} for register`));
  }
  assert.equal(existsSync(join(workDir(p.dir, p.slug, 'preview'), 'summary.json')), false);
});

await check('--help lists --target and --reskin, the preview join, previewSelector and its exit codes; the preview is no longer join only', async () => {
  const r = await run(['--help']);
  assert.equal(r.status, 0, r.stderr);
  for (const s of ['--target local|preview', '--reskin', '.plain.html', 'plain section', 'stalled decoration', 'decorated main > div', 'note:', 'previewSelector', '--wait-eds']) assert.ok(r.stdout.includes(s), `help lacks ${s}`);
  assert.equal(r.stdout.includes('later task'), false);
});

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
