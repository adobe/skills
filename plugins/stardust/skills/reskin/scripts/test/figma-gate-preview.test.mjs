#!/usr/bin/env node
// skills/reskin/scripts/test/figma-gate-preview.test.mjs — figma-gate on a deployed preview (M2a Task 10): the join of
// the reskin page's data-slot sections to the preview's authored form (plainSections, plainJoin: pure), then
// previewTarget, runJoin and the CLI `join --target preview` against the fake preview of fixtures/deployed/ (needs
// playwright; prints a skip line otherwise). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../figma-gate.mjs';
import { includedModules, readInputs, workDir } from '../figma-gate/io.mjs';
import { runJoin } from '../figma-gate/join.mjs';
import { anchors, parseMapping } from '../figma-gate/mapping.mjs';
import { plainJoin, plainSections } from '../figma-gate/plain-join.mjs';
import { prepare } from '../figma-gate/prepare.mjs';
import { localAttributes, plainUrl, previewTarget } from '../figma-gate/target.mjs';
import { fixturePath, startPreviewServer, startSourceServer } from './fixtures/deployed/servers.mjs';
import { makeProject } from './fixtures/figma-gate/setup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'figma-gate.mjs');
const FIX = join(HERE, 'fixtures', 'figma-gate');
const scratch = mkdtempSync(join(tmpdir(), 'figma-gate-preview-'));
const TOKEN = 'hlxtok-0123456789abcdef';
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

// One CLI run: { status, stdout, stderr, all }. Async: the fake preview lives in this process. The ambient hooks are cleared.
const run = (args, { cwd = scratch, env = {} } = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [SCRIPT, ...args], { cwd, env: { ...process.env, DEPLOY_VERIFY_ORIGIN: '', SITE_TOKEN: '', ...env } });
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
const joined = (over = {}) => plainJoin({ local, plain, mapping, anchors: a, modules, ...over });
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

await check('plainSections: a metadata block\'s text is left out of the section that holds it', () => {
  const smeta = '<div class="section-metadata"><div><div>style</div><div>dark</div></div></div>';
  const meta = '<div class="metadata"><div><div>title</div><div>Hidden title</div></div></div>';
  const s = plainSections(doc(`<div><h2>Hi there</h2>${smeta}<p>Body</p>${meta}</div>`));
  assert.deepEqual(s, [{ index: 0, text: 'hi there body', empty: false }]);
});

await check('plainSections: tags come off without splitting words, blocks split text, entities decode, comments and scripts are ignored', () => {
  const s = plainSections(doc('<div><p>wor<strong>d</strong>s &amp; &#x26; &#38; &lt;b&gt;&nbsp;x</p><p>next</p><!-- <div> --><script>var s = "<div>";</script><style>.a > div {}</style></div>', '<div data-x="a>b"><p>t</p></div>'));
  assert.deepEqual(s.map((x) => x.text), ['words & & & <b> x next', 't']);
});

await check('plainSections: an image-only section is not empty; no <main> reads the whole document; an unclosed div ends at the end', () => {
  assert.deepEqual(plainSections(doc('<div><p><picture><img src="a.png" alt="x"></picture></p></div>')), [{ index: 0, text: '', empty: false }]);
  assert.deepEqual(plainSections('<div>a</div><div>b</div>').map((x) => x.text), ['a', 'b']);
  assert.deepEqual(plainSections('<main><div><p>a</p></main>').map((x) => x.text), ['a']);
  assert.deepEqual(plainSections(''), []);
  assert.deepEqual(plainSections(undefined), []);
});

await check('plainJoin passes the fixture: s01 and s02 land on the decorated children 2 and 3, with their module frames', () => {
  const r = joined();
  assert.equal(r.pass, true, r.problems.join('\n'));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.sections, [
    { slot: 's01', module: 'M1', node: '1:3', selector: 'main > div:nth-child(2)', index: 1 },
    { slot: 's02', module: 'M2', node: '1:7', selector: 'main > div:nth-child(3)', index: 2 },
  ]);
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
  const r = joined({ plain: [plain[0], plain[1], { index: 2, text: 'promo', empty: false }, { ...plain[2], index: 3 }] });
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
        const { local, html } = await target.join.collect(page);
        assert.deepEqual(local.map((s) => [s.slot, s.module, s.nested]), [['s01', 'M1', false], ['s02', 'M2', false]]);
        assert.equal(html, PLAIN);
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

  await check('previewTarget: a protected preview is a usage error without the token; with it the page and its authored form are both read', async () => {
    await withPreview({ token: TOKEN }, async (server) => {
      await withBrowser(async (browser) => {
        const p = project('auth');
        await assert.rejects(previewTarget(`${server.origin}/ns/home`, { reskin: p.page }).open(browser, 1440), (e) => e.name === 'UsageError' && /HTTP 401/.test(e.message) && /--auth-header/.test(e.message));
        const target = previewTarget(`${server.origin}/ns/home`, { reskin: p.page, auth: `token ${TOKEN}` });
        const page = await target.open(browser, 1440);
        assert.equal((await target.join.collect(page)).html, PLAIN);
        await page.context().close();
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

  await check('CLI join --target preview: PASS line, exit 0, join.json.regime "preview" under .work/reskin/gates/<slug>/figma/', async () => {
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
    assert.equal(joinJson(p).regime, 'local');
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

  await check('CLI join --target preview on a protected preview: --token-env passes; the token is never printed; every request carried it', async () => {
    await withPreview({ token: TOKEN }, async (server) => {
      const p = project('cli-token');
      const r = await run(joinArgs(p, `${server.origin}/ns/home`, ['--token-env', 'PREVIEW_TOKEN']), { cwd: p.root, env: { PREVIEW_TOKEN: TOKEN } });
      assert.equal(r.status, 0, r.all.replaceAll(TOKEN, '[token]'));
      assert.equal(r.all.includes(TOKEN), false, 'the token appears in the output');
      const paths = server.requests.map((q) => q.path);
      assert.ok(paths.includes('/ns/home') && paths.includes('/ns/home.plain.html'), 'the page and its authored form were both read');
      assert.ok(server.requests.every((q) => q.headers.authorization === `token ${TOKEN}`), 'a request went out without the token');
      assert.equal(joinJson(p).regime, 'preview');
      assert.equal(readFileSync(join(workDir(p.dir, p.slug), 'join.json'), 'utf8').includes(TOKEN), false, 'the token is in join.json');
      const direct = await run(joinArgs(p, `${server.origin}/ns/home`, ['--auth-header', `token ${TOKEN}`]), { cwd: p.root });
      assert.equal(direct.status, 0, direct.all.replaceAll(TOKEN, '[token]'));
      assert.equal(direct.all.includes(TOKEN), false, 'the token appears in the output');
    });
  });

  await check('the token goes to the preview origin only: a cross-origin subresource of the page is fetched without it', async () => {
    const source = await startSourceServer();
    try {
      const page = customPreview('cross', PLAIN, (html) => html.replace('</body>', `<img src="${source.origin}/images/hero.png" alt="">\n</body>`));
      await withPreview({ token: TOKEN, pages: { '/ns/home': page } }, async (server) => {
        const p = project('cli-cross');
        const r = await run(joinArgs(p, `${server.origin}/ns/home`, ['--token-env', 'PREVIEW_TOKEN']), { cwd: p.root, env: { PREVIEW_TOKEN: TOKEN } });
        assert.equal(r.status, 0, r.all.replaceAll(TOKEN, '[token]'));
        assert.ok(source.requests.some((q) => q.path === '/images/hero.png'), 'the page did not load the cross-origin image');
        assert.ok(source.requests.every((q) => q.headers.authorization === undefined), 'a request to another origin carried the token');
      });
    } finally { await source.close(); }
  });

  await check('CLI join --target preview: a protected preview with no token, or the wrong one, is exit 2 and prints no token', async () => {
    await withPreview({ token: TOKEN }, async (server) => {
      const p = project('cli-401');
      const none = await run(joinArgs(p, `${server.origin}/ns/home`), { cwd: p.root });
      assert.equal(none.status, 2, none.all);
      assert.match(none.stderr, /HTTP 401.*protected.*--auth-header or --token-env/);
      const wrong = await run(joinArgs(p, `${server.origin}/ns/home`, ['--token-env', 'PREVIEW_TOKEN']), { cwd: p.root, env: { PREVIEW_TOKEN: 'hlxtok-wrong-0000' } });
      assert.equal(wrong.status, 2, wrong.all);
      assert.match(wrong.stderr, /HTTP 401.*not accepted/);
      assert.equal(wrong.all.includes('hlxtok-wrong-0000'), false);
    });
  });
}

await check('CLI usage errors: --target preview needs --reskin; a blank secret, an unset variable, a bad --target and a missing --reskin file are exit 2', async () => {
  const p = makeProject(join(scratch, 'usage'));
  const url = 'http://127.0.0.1:9/ns/home';
  const base = ['join', '--page', p.slug, '--url', url, '--dir', p.dir];
  const argsFor = (at) => ['join', '--page', p.slug, '--url', at, '--dir', p.dir, '--target', 'preview', '--reskin', p.page];
  const withReskin = argsFor(url);
  const cases = [
    [[...base, '--target', 'preview'], /--target preview needs --reskin/],
    [[...withReskin, '--auth-header', ' '], /--auth-header needs a value/],
    [[...withReskin, '--auth-header'], /--auth-header needs a value/],
    [[...withReskin, '--token-env', ' '], /--token-env needs a value/],
    [[...withReskin, '--token-env', 'NO_SUCH_PREVIEW_TOKEN'], /no site token: --token-env NO_SUCH_PREVIEW_TOKEN/],
    [[...base, '--target', 'remote'], /--target is local or preview, got "remote"/],
    [[...base, '--target', 'preview', '--reskin', join(scratch, 'no-such.html')], /no-such\.html/],
    [[...base, '--reskin', p.page], /--reskin applies to --target preview/],
    [[...base, '--auth-header', 'token x'], /--auth-header applies to --target preview/],
    [[...base, '--token-env', 'X'], /--token-env applies to --target preview/],
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

await check('--target preview is join only for now: geometry, ramp, pixel and all exit 2 "lands in a later task" before any browser', async () => {
  const p = makeProject(join(scratch, 'later'));
  for (const step of ['geometry', 'ramp', 'pixel', 'all']) {
    const r = await run([step, '--page', p.slug, '--url', 'http://127.0.0.1:9/ns/home', '--target', 'preview', '--reskin', p.page, '--dir', p.dir], { cwd: p.root });
    assert.equal(r.status, 2, `${step}\n${r.all}`);
    assert.match(r.stderr, new RegExp(`--target preview: ${step} lands in a later task`));
  }
  const r = await run(['register', '--page', p.slug, '--target', 'preview', '--dir', p.dir], { cwd: p.root });
  assert.equal(r.status, 2, r.all);
});

await check('every line the gate prints and every error it throws has the token redacted', async () => {
  const p = makeProject(join(scratch, 'redact'));
  const secret = 'hlxtok-redact-me-42';
  const lines = [];
  const args = ['join', '--page', p.slug, '--url', 'http://127.0.0.1:9/ns/home', '--target', 'preview', '--reskin', p.page, '--auth-header', `token ${secret}`, '--dir', p.dir];
  const steps = { join: async ({ log }) => { log(`saw ${secret} and token ${secret}`); throw new Error(`no good: ${secret}`); } };
  await assert.rejects(main(args, { log: (m) => lines.push(m), steps }), (e) => e.message === 'no good: [redacted]');
  assert.deepEqual(lines, ['saw [redacted] and [redacted]']);
});

await check('--help lists --target, --reskin, --auth-header and --token-env, the preview join and its exit codes', async () => {
  const r = await run(['--help']);
  assert.equal(r.status, 0, r.stderr);
  for (const s of ['--target local|preview', '--reskin', '--auth-header', '--token-env', '.plain.html', 'plain section', 'stalled decoration']) assert.ok(r.stdout.includes(s), `help lacks ${s}`);
});

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
