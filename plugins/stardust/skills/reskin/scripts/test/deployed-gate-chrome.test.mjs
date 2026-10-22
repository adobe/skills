#!/usr/bin/env node
// skills/reskin/scripts/test/deployed-gate-chrome.test.mjs — A6 of the deployed leg, `deployed-gate chrome`: the header
// and footer on the preview against the mapped chrome. The pure parts first (the contract from mapping.json and the
// chrome model, link keys, the rows of one width for a passing chrome and for each way chrome breaks, the CLI lines),
// then the CLI's setup errors, then runChrome on the fake preview of fixtures/deployed/ (needs playwright; prints a skip
// line when it does not resolve). Run: node <this file>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chromeExpect, chromeLines, evaluateChrome, LIGATURE, linkKey, MAX_HEADER_PX, readChromeContract, runChrome,
} from '../deployed/chrome.mjs';
import { deployedDir } from '../deployed/io.mjs';
import { startPreviewServer } from './fixtures/deployed/servers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, '..', 'deployed-gate.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'deployed-gate-chrome-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const run = (args, { cwd = scratch } = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [GATE, ...args], { cwd, env: { ...process.env, DEPLOY_VERIFY_ORIGIN: '' } });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

const SRC = 'https://source.example';
const PREVIEW = 'https://branch--repo--owner.aem.page';
// A chrome model as capture-content writes it: header slot with a logo, nav links and an icon-font control; footer slot
// with a heading, text, contact links and a text-less social link (iconLinks).
const MODEL = {
  _provenance: { url: `${SRC}/` },
  sections: [
    {
      slot: 'header', images: [{ src: '/logo.svg' }], headings: [], paragraphs: [], listItems: [],
      ctas: [{ text: 'About', href: '/about/', absHref: `${SRC}/about/` }, { text: 'Enrol keyboard_arrow_right', href: '/enrol.html', absHref: `${SRC}/enrol.html` }, { text: 'menu', href: '#' }],
    },
    {
      slot: 'footer', images: [{ src: '/crest.png' }], headings: [{ level: 2, text: 'Contact us' }], paragraphs: ['Open 8am – 4pm  weekdays'], listItems: ['Policy library'],
      ctas: [{ text: 'Email', href: 'mailto:Office@School.example' }, { text: 'Policy library', href: 'https://www.policies.example/library/' }],
      iconLinks: [{ label: 'Facebook', href: 'https://www.facebook.com/school', absHref: 'https://www.facebook.com/school' }],
    },
    { slot: 'main-1', ctas: [{ text: 'Not chrome', href: '/x' }] },
  ],
};
const MAPPING = { chrome: { model: 'stardust/reskin/content-model/_chrome', header: ['header'], footer: ['footer'] } };
const EXPECT = chromeExpect({ mapping: MAPPING, model: MODEL });

const link = (href, visible = true) => ({ href, visible });
// The facts measureWidth reads from a chrome that matches the model.
const goodFacts = () => ({
  mainTop: 120,
  header: {
    present: true, height: 120, top: 0, bottom: 120, contentBottom: 120, undecorated: [], logos: 1, brokenImages: [], leaks: [], text: 'About Enrol',
    links: [link(`${PREVIEW}/ns/about`), link(`${PREVIEW}/ns/enrol`)],
  },
  footer: {
    present: true, height: 300, top: 2000, bottom: 2300, contentBottom: 2300, undecorated: [], logos: 1, brokenImages: [], leaks: [],
    text: 'Contact us OPEN 8am – 4pm weekdays Policy library Email',
    links: [link('mailto:office@school.example'), link('https://policies.example/library'), link('https://facebook.com/school/')],
  },
});
const OPTS = { width: 1440, sourceOrigin: SRC, previewOrigin: PREVIEW, namespace: 'ns' };
const byCheck = (rows) => Object.fromEntries(rows.map((r) => [r.check, r]));

await check('the contract: mapped header and footer slots only, # and javascript: links are controls, icon links count, ligature words dropped, footer texts deduplicated', async () => {
  assert.equal(EXPECT.mapped, true);
  assert.equal(EXPECT.sourceUrl, `${SRC}/`);
  assert.deepEqual(EXPECT.header, { links: [{ label: 'About', href: `${SRC}/about/` }, { label: 'Enrol', href: `${SRC}/enrol.html` }], images: 1 });
  assert.deepEqual(EXPECT.footer.links.map((l) => l.label), ['Email', 'Policy library', 'Facebook']);
  assert.deepEqual(EXPECT.footer.texts, ['Contact us', 'Open 8am – 4pm weekdays', 'Policy library']);
  assert.deepEqual(chromeExpect({ mapping: {}, model: MODEL }).mapped, false, 'no chrome record, no contract');
  assert.match('keyboard_arrow_right expand_more chevron_left open_in_new', new RegExp(`^(${LIGATURE.source}\\s?)+$`));
});

await check('link keys: the source and preview origins compare by path (/<ns>, a trailing /, .html and /index aside), elsewhere by host less www., mailto and tel by address', async () => {
  const local = [PREVIEW, SRC];
  assert.equal(linkKey(`${SRC}/about/index.html`, SRC, [SRC]), 'path:/about');
  assert.equal(linkKey(`${PREVIEW}/ns/about`, PREVIEW, local, 'ns'), 'path:/about');
  assert.equal(linkKey(`${PREVIEW}/ns`, PREVIEW, local, 'ns'), 'path:/');
  assert.equal(linkKey('https://www.Facebook.com/school/', PREVIEW, local), 'ext:facebook.com/school');
  assert.equal(linkKey('mailto:Office@School.example', PREVIEW), 'mailto:office@school.example');
  assert.equal(linkKey('tel:(02) 9999 0000', PREVIEW), 'tel:0299990000');
});

await check('a chrome that matches the model passes every row at 1440 and at 360 (every mapped link shows closed)', async () => {
  const wide = evaluateChrome(goodFacts(), EXPECT, OPTS);
  assert.deepEqual(wide.map((r) => r.check), ['header', 'header logo', 'header height', 'header/main', 'header links', 'icon text', 'footer', 'footer logo', 'footer links', 'footer text']);
  assert.deepEqual(wide.filter((r) => r.status !== 'PASS'), []);
  const narrow = byCheck(evaluateChrome(goodFacts(), EXPECT, { ...OPTS, width: 360 }));
  assert.equal(narrow['menu toggle'].status, 'PASS');
  assert.match(narrow['menu toggle'].value, /every mapped link shows closed/);
});

await check('each way chrome breaks is its row\'s FAIL: a tall or covering header, a band above main, a lost or hidden link, a raw icon word, no logo, an undecorated footer, a lost footer text', async () => {
  const f = goodFacts();
  f.header.height = MAX_HEADER_PX + 60; f.header.contentBottom = 180; f.header.links = [link(`${PREVIEW}/ns/about`)];
  f.header.leaks = ['header: "keyboard_arrow_right" in <span>'];
  f.footer.logos = 0; f.footer.brokenImages = ['/crest.png']; f.footer.undecorated = ['footer block: initialized'];
  f.footer.links = [link('mailto:office@school.example'), link('https://policies.example/library', false)];
  f.footer.text = 'Contact us Email';
  const r = byCheck(evaluateChrome(f, EXPECT, OPTS));
  assert.equal(r['header height'].status, 'FAIL');
  assert.deepEqual([r['header/main'].status, r['header/main'].value], ['FAIL', 'covers main by 60px']);
  assert.deepEqual([r['header links'].status, r['header links'].value], ['FAIL', '1/2']);
  assert.match(r['header links'].detail, /MISSING Enrol → https:\/\/source\.example\/enrol\.html/);
  assert.deepEqual([r['icon text'].status, r['icon text'].value], ['FAIL', '1']);
  assert.deepEqual([r['footer logo'].status, r['footer logo'].detail], ['FAIL', '/crest.png']);
  assert.deepEqual([r.footer.status, r.footer.value], ['FAIL', 'not decorated']);
  assert.match(r['footer links'].detail, /HIDDEN Policy library/);
  assert.match(r['footer links'].detail, /MISSING Facebook → https:\/\/www\.facebook\.com\/school/);
  assert.deepEqual([r['footer text'].status, r['footer text'].value], ['FAIL', '1/3']);
  const banded = goodFacts(); banded.mainTop = 200;
  assert.deepEqual(byCheck(evaluateChrome(banded, EXPECT, OPTS))['header/main'].value, '80px band above main');
  const none = goodFacts(); none.footer = { present: false, links: [], leaks: [] };
  assert.deepEqual(byCheck(evaluateChrome(none, EXPECT, OPTS)).footer.value, 'no <footer>');
});

await check('at 360 a mapped link hidden closed needs a toggle that shows it, aria-expanded "true" after', async () => {
  const closed = () => { const f = goodFacts(); f.header.links = f.header.links.map((a) => ({ ...a, visible: false })); return f; };
  const at360 = (f) => byCheck(evaluateChrome(f, EXPECT, { ...OPTS, width: 360 }))['menu toggle'];
  const noToggle = closed(); noToggle.toggle = { found: false };
  assert.deepEqual([at360(noToggle).status, at360(noToggle).value], ['FAIL', 'no toggle']);
  const opens = closed(); opens.toggle = { found: true, label: 'Menu', expandedBefore: 'false', expandedAfter: 'true', links: goodFacts().header.links };
  assert.deepEqual([at360(opens).status, at360(opens).value], ['PASS', 'Menu: 2 shown']);
  const stuck = closed(); stuck.toggle = { ...opens.toggle, expandedAfter: 'false', links: [link(`${PREVIEW}/ns/about`)] };
  assert.equal(at360(stuck).status, 'FAIL');
  assert.match(at360(stuck).value, /1 link\(s\) still hidden after the click; aria-expanded "false" after the click/);
  assert.equal(byCheck(evaluateChrome(opens, EXPECT, { ...OPTS, width: 360 }))['header links'].status, 'PASS', 'a link the toggle shows counts as visible');
});

await check('no chrome in the mapping: the contract rows are n/a, the rows that need none are still measured', async () => {
  const none = chromeExpect({});
  const r = evaluateChrome(goodFacts(), none, { ...OPTS, width: 360 });
  assert.deepEqual(r.filter((x) => x.status === 'n/a').map((x) => x.check), ['header logo', 'header links', 'menu toggle', 'footer logo', 'footer links', 'footer text']);
  assert.ok(r.filter((x) => x.status === 'n/a').every((x) => x.value === 'n/a: no chrome in the mapping'));
  assert.deepEqual(r.filter((x) => x.status === 'PASS').map((x) => x.check), ['header', 'header height', 'header/main', 'icon text', 'footer']);
});

await check('chromeLines: "FAIL chrome (hard)", a line per failing row with its findings, "PASS chrome" otherwise', async () => {
  const f = goodFacts(); f.footer.links = [];
  const rows = evaluateChrome(f, EXPECT, OPTS);
  const lines = chromeLines({ verdict: 'FAIL', rows });
  assert.equal(lines[0], 'FAIL chrome (hard)');
  assert.equal(lines[1], '  footer links @1440: 0/3 (bar all mapped, visible)');
  assert.match(lines.slice(2).join('\n'), /MISSING Email → mailto:Office@School\.example/);
  assert.deepEqual(chromeLines({ verdict: 'PASS', rows: evaluateChrome(goodFacts(), EXPECT, OPTS) }), ['PASS chrome']);
});

// A project at <root>/stardust with the preview record, and the chrome mapping and model when given.
const project = (name, { origin = 'http://127.0.0.1:9', mapping = null, model = null } = {}) => {
  const root = join(scratch, name);
  const dir = join(root, 'stardust');
  mkdirSync(deployedDir(dir, 'home'), { recursive: true });
  writeFileSync(join(deployedDir(dir, 'home'), 'preview.json'), `${JSON.stringify({ url: `${origin}/ns/home`, origin, path: '/ns/home', plain: `${origin}/ns/home.plain.html`, namespace: 'ns', sandbox: false, checkedAt: new Date().toISOString() })}\n`);
  if (mapping) { mkdirSync(join(dir, 'reskin'), { recursive: true }); writeFileSync(join(dir, 'reskin', 'mapping.json'), JSON.stringify(mapping)); }
  if (model) { const m = join(root, mapping.chrome.model); mkdirSync(m, { recursive: true }); writeFileSync(join(m, 'content-model.json'), JSON.stringify(model)); }
  return { root, dir };
};

await check('the contract file: no mapping or no chrome record is unmapped; a chrome record whose model is missing, lacks a mapped slot or holds an empty one is a setup error (exit 2)', async () => {
  assert.equal(readChromeContract(project('no-mapping').dir).mapped, false);
  assert.equal(readChromeContract(project('no-chrome', { mapping: { pages: {} } }).dir).mapped, false);
  const lost = project('lost-model', { mapping: MAPPING });
  assert.throws(() => readChromeContract(lost.dir), /content-model\.json is missing/);
  const r = await run(['chrome', '--page', 'home', '--dir', lost.dir]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /capture the chrome/);
  assert.equal(readChromeContract(project('mapped', { mapping: MAPPING, model: MODEL }).dir).header.links.length, 2);
  const empty = { ...MODEL, sections: MODEL.sections.map((x) => (x.slot === 'footer' ? { slot: 'footer', visibleText: '', headings: [], paragraphs: [], listItems: [], ctas: [], iconLinks: [], images: [] } : x)) };
  assert.throws(() => readChromeContract(project('empty-slot', { mapping: MAPPING, model: empty }).dir), /footer slot footer .* is empty: .*--wait-until load/);
  const gone = { ...MODEL, sections: MODEL.sections.filter((x) => x.slot !== 'footer') };
  assert.throws(() => readChromeContract(project('gone-slot', { mapping: MAPPING, model: gone }).dir), /maps footer slot footer but .* has no such slot/);
  const help = await run(['chrome', '--help']);
  assert.equal(help.status, 0);
  for (const re of [/A6/, /never waivable/i, /FAIL chrome \(hard\)/, /chrome\.json/, /1440 and 360/]) assert.match(help.stdout, re);
});

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  browser parts (playwright not importable here; run this test in an environment that has it)'); }

if (playwrightOk) {
  await check('real run on the fake preview: its header and footer measured at 1440 and 360, chrome.json written; a footer link it does not render is FAIL', async () => {
    const server = await startPreviewServer();
    try {
      const model = {
        _provenance: { url: `${server.origin}/` },
        sections: [
          { slot: 'header', images: [{ src: '/logo.svg' }], ctas: [{ text: 'Sample kit', href: '/home', absHref: `${server.origin}/home` }] },
          { slot: 'footer', paragraphs: ['Sample kit, all rights reserved.'], ctas: [] },
        ],
      };
      const ok = project('real-ok', { origin: server.origin, mapping: MAPPING, model });
      const preview = JSON.parse(readFileSync(join(deployedDir(ok.dir, 'home'), 'preview.json'), 'utf8'));
      const pass = await runChrome({ dir: ok.dir, slug: 'home', preview });
      assert.equal(pass.verdict, 'PASS', chromeLines(pass).join('\n'));
      assert.deepEqual([...new Set(pass.rows.map((r) => r.width))], [1440, 360]);
      const record = JSON.parse(readFileSync(join(deployedDir(ok.dir, 'home'), 'chrome.json'), 'utf8'));
      assert.deepEqual([record.verdict, record.hard, record.mapped, record.rows.length], ['PASS', true, true, pass.rows.length]);
      const lostModel = { ...model, sections: [model.sections[0], { ...model.sections[1], iconLinks: [{ label: 'Instagram', href: 'https://instagram.com/sample' }] }] };
      const lost = project('real-lost', { origin: server.origin, mapping: MAPPING, model: lostModel });
      const fail = await runChrome({ dir: lost.dir, slug: 'home', preview });
      assert.equal(fail.verdict, 'FAIL');
      assert.equal(fail.exit, 1);
      assert.deepEqual(fail.rows.filter((r) => r.status === 'FAIL').map((r) => `${r.check}@${r.width}`), ['footer links@1440', 'footer links@360']);
      const cli = await run(['chrome', '--page', 'home', '--dir', lost.dir]);
      assert.equal(cli.status, 1, cli.stdout + cli.stderr);
      assert.match(cli.stdout, /^FAIL chrome \(hard\)$/m);
      assert.match(cli.stdout, /MISSING Instagram → https:\/\/instagram\.com\/sample/);
      assert.ok(existsSync(join(deployedDir(lost.dir, 'home'), 'chrome.json')));
    } finally { await server.close?.(); }
  });

  await check('a protected preview (401 without a header) gives no verdict: every row is "ERROR (exit 124)" with "HTTP 401 at <url>", never a pass', async () => {
    const server = await startPreviewServer({ token: 'hlxtok-0123456789abcdef' });
    try {
      const guarded = project('real-protected', { origin: server.origin });
      const preview = JSON.parse(readFileSync(join(deployedDir(guarded.dir, 'home'), 'preview.json'), 'utf8'));
      const r = await runChrome({ dir: guarded.dir, slug: 'home', preview });
      assert.equal(r.verdict, 'ERROR', chromeLines(r).join('\n'));
      assert.equal(r.exit, 124);
      assert.ok(r.rows.length > 0);
      for (const row of r.rows) assert.deepEqual([row.status, row.detail], ['ERROR', `HTTP 401 at ${preview.url}`], `${row.check}@${row.width}`);
    } finally { await server.close?.(); }
  });
}

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
process.exit(0);
