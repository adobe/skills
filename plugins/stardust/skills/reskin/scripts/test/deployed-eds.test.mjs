#!/usr/bin/env node
// skills/reskin/scripts/test/deployed-eds.test.mjs — the deployed leg's base: edsSettle and isEdsHost
// (eds.mjs), and the fake preview and source servers with the fixtures every later deployed test
// reads (fixtures/deployed/). The pure parts run anywhere; the browser parts need playwright and print a skip
// line when it does not resolve. Run: node <this file>.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { edsSettle, isEdsHost, loadLiveSession } from '../deployed/eds.mjs';
import { rootTokens } from '../render/root-tokens.mjs';
import { fixturePath, loadSourceModel, startPreviewServer, startSourceServer } from './fixtures/deployed/servers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..');
const scratch = mkdtempSync(join(tmpdir(), 'deployed-eds-'));
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };
const read = (name) => readFileSync(fixturePath(name), 'utf8');
const json = (name) => JSON.parse(read(name));
const squash = (s) => s.replace(/\s+/g, ' ').trim();

await check('isEdsHost: the four EDS suffixes, the DEPLOY_VERIFY_ORIGIN host read at call time, nothing else', () => {
  for (const u of ['https://b--r--o.aem.page/x', 'https://b--r--o.aem.live/', 'https://b--r--o.hlx.page', 'https://b--r--o.hlx.live/x?y=1']) assert.equal(isEdsHost(u), true, u);
  for (const u of ['https://example.test', 'https://aem.page.example.test/', 'http://127.0.0.1:4000/', 'not a url', '']) assert.equal(isEdsHost(u), false, u);
  const saved = process.env.DEPLOY_VERIFY_ORIGIN;
  try {
    process.env.DEPLOY_VERIFY_ORIGIN = 'http://127.0.0.1:4000';
    assert.equal(isEdsHost('http://127.0.0.1:4000/ns/home'), true);
    assert.equal(isEdsHost('http://127.0.0.1:4001/ns/home'), false, 'the port is part of the host');
    process.env.DEPLOY_VERIFY_ORIGIN = 'not a url';
    assert.equal(isEdsHost('http://127.0.0.1:4000/'), false);
    delete process.env.DEPLOY_VERIFY_ORIGIN;
    assert.equal(isEdsHost('http://127.0.0.1:4000/'), false);
  } finally { if (saved === undefined) delete process.env.DEPLOY_VERIFY_ORIGIN; else process.env.DEPLOY_VERIFY_ORIGIN = saved; }
});

await check('eds.mjs resolves live-session in the project-copy layout and loads it only when asked', async () => {
  const dir = join(scratch, 'copy');
  const reskin = join(dir, 'stardust', 'scripts', 'reskin');
  mkdirSync(join(reskin, 'deployed'), { recursive: true });
  mkdirSync(join(reskin, 'figma'), { recursive: true });
  cpSync(join(SCRIPTS, 'deployed', 'eds.mjs'), join(reskin, 'deployed', 'eds.mjs'));
  cpSync(join(SCRIPTS, 'figma', 'errors.mjs'), join(reskin, 'figma', 'errors.mjs'));
  const bare = await import(`${join(reskin, 'deployed', 'eds.mjs')}?bare`);
  await assert.rejects(bare.loadLiveSession(), /live-session\.mjs not found/);
  mkdirSync(join(dir, 'stardust', 'scripts', 'diff'), { recursive: true });
  cpSync(join(SCRIPTS, '..', '..', 'diff', 'scripts', 'live-session.mjs'), join(dir, 'stardust', 'scripts', 'diff', 'live-session.mjs'));
  const copy = await import(`${join(reskin, 'deployed', 'eds.mjs')}?copy`);
  const live = await copy.loadLiveSession();
  assert.equal(typeof live.newLiveContext, 'function');
});

await check('fixtures: deltas.json and runtime-contract.json carry the keys their readers expect', () => {
  const d = json('deltas.json');
  assert.deepEqual(Object.keys(d), ['version', 'blocking', 'text', 'images', 'links', 'metadata']);
  assert.equal(d.version, 1);
  assert.equal(d.blocking, false);
  assert.equal(d.images, 'count+alt+width');
  assert.equal(d.text.allow.length, 1);
  for (const a of d.text.allow) assert.deepEqual(Object.keys(a), ['id', 'from', 'to', 'why']);
  assert.equal(typeof d.links.localize.sourceHost, 'string');
  assert.deepEqual(d.metadata.ignore, ['canonical', 'og:url', 'og:image', 'twitter:image']);
  assert.equal(d.metadata.jsonLd, 'count-only');
  assert.deepEqual(d.metadata.absent, []);
  const rc = json('runtime-contract.json');
  assert.equal(rc.buttonClasses, '.button / .button.primary / .button.secondary / .button.accent, in p.button-wrapper');
  for (const k of ['runtime', 'blockWrapperClass', 'buttonization', 'fragmentScriptPolicy', 'emptySectionCollapse']) assert.ok(k in rc, k);
});

await check('fixtures: home.html carries no element with class card and its :root block is the first rule of the first <style>', () => {
  const html = read('home.html');
  assert.ok(!/class="[^"]*\bcard\b/.test(html), 'an element has class card');
  const style = html.match(/<style>\n([\s\S]*?)<\/style>/)[1];
  const tokens = JSON.parse(readFileSync(join(HERE, 'fixtures', 'figma-gate', 'donor-tokens.json'), 'utf8'));
  assert.ok(style.startsWith(rootTokens(tokens).css), 'the :root block is not rootTokens(donor-tokens.json) first in the first <style>');
});

await check('fixtures: home.plain.html is the authored form as EDS delivers it: no metadata block, an empty first section, s01 default content, the cards rows; the nav and footer metas are in home.html\'s head', () => {
  const plain = read('home.plain.html');
  assert.match(plain, /^<body>\s*<header><\/header>\s*<main>/);
  assert.match(plain, /<\/main>\s*<footer><\/footer>\s*<\/body>\s*$/);
  assert.ok(!/metadata/i.test(plain), 'EDS strips the metadata block from the authored form');
  assert.match(plain, /<main>\s*<div><\/div>\s*<div><h1 /, 'the first top-level div is empty');
  assert.equal([...plain.matchAll(/<h1[ >]/g)].length, 1);
  assert.ok(plain.includes('<div class="cards">'));
  assert.ok(!plain.includes('about:error') && !plain.includes('/img/'));
  const head = read('home.html').split('</head>')[0];
  assert.ok(head.includes('<meta name="nav" content="/ns/nav">'), 'the page head carries the nav meta');
  assert.ok(head.includes('<meta name="footer" content="/ns/footer">'), 'the page head carries the footer meta');
});

await check('edsSettle never hands playwright a timeout of 0 (no timeout): each wait gets the time left, read once, and is skipped when none is left', async () => {
  const realNow = Date.now;
  let now = 0;
  Date.now = () => { const t = now; now += 50; return t; };
  const timeouts = [];
  const page = {
    waitForLoadState: async (_state, { timeout }) => { timeouts.push(['networkidle', timeout]); },
    waitForFunction: async (_fn, _arg, { timeout }) => { timeouts.push(['settled', timeout]); },
    evaluate: async () => ({ appear: true, sections: [], blocks: [] }),
  };
  try {
    const result = await edsSettle(page, { timeoutMs: 100 });
    assert.deepEqual(result.stalled, []);
  } finally { Date.now = realNow; }
  assert.ok(timeouts.length > 0, 'it waited at all');
  for (const [wait, timeout] of timeouts) assert.ok(timeout > 0, `${wait} was given timeout ${timeout}: playwright reads 0 as no timeout at all`);
});

let playwrightOk = false;
try { await import('playwright'); playwrightOk = true; } catch { console.log('skip  browser parts (playwright not importable here; run this test in an environment that has it)'); }

if (playwrightOk) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const live = await loadLiveSession();
  const opened = async (origin, path, { viewport = { width: 1440, height: 900 }, ...ctxOptions } = {}) => {
    const ctx = await browser.newContext({ viewport, ...ctxOptions });
    const page = await ctx.newPage();
    const response = await page.goto(`${origin}${path}`);
    return { ctx, page, response };
  };

  await check('edsSettle on a page that decorates after 300 ms: appear, every section and block loaded, stalled []', async () => {
    const server = await startPreviewServer({ decorateDelayMs: 300 });
    const { ctx, page, response } = await opened(server.origin, '/ns/home');
    try {
      assert.equal(response.status(), 200);
      const s = await edsSettle(page);
      assert.deepEqual(s, { appear: true, sections: { total: 3, loaded: 3 }, blocks: { total: 3, loaded: 3 }, stalled: [] });
    } finally { await ctx.close(); await server.close(); }
  });

  await check('edsSettle waits for a late decoration: before it the page is undecorated, after it appear and loaded', async () => {
    const server = await startPreviewServer({ decorateDelayMs: 1200 });
    const { ctx, page } = await opened(server.origin, '/ns/home');
    try {
      assert.equal(await page.evaluate(() => document.body.classList.contains('appear')), false);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('main .cards')).display), 'block', 'the cards block is unstyled before it loads');
      const t0 = Date.now();
      const s = await edsSettle(page, { timeoutMs: 10000 });
      assert.deepEqual([s.appear, s.stalled], [true, []]);
      assert.ok(Date.now() - t0 > 500, 'returned before the decoration');
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('main .cards')).display), 'grid');
    } finally { await ctx.close(); await server.close(); }
  });

  await check('edsSettle with stallBlock cards and timeoutMs 1000: stalled ["block cards"], returned within 2 s, never thrown', async () => {
    const server = await startPreviewServer({ decorateDelayMs: 100, stallBlock: 'cards' });
    const { ctx, page } = await opened(server.origin, '/ns/home');
    try {
      const t0 = Date.now();
      const s = await edsSettle(page, { timeoutMs: 1000 });
      assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
      assert.deepEqual(s, { appear: true, sections: { total: 3, loaded: 3 }, blocks: { total: 3, loaded: 2 }, stalled: ['block cards'] });
    } finally { await ctx.close(); await server.close(); }
  });

  await check('edsSettle names a section and body.appear that never came (a page that does not decorate)', async () => {
    const server = await startPreviewServer({ decorateDelayMs: 600000 });
    const { ctx, page } = await opened(server.origin, '/ns/home');
    try {
      const s = await edsSettle(page, { timeoutMs: 800 });
      assert.deepEqual([s.appear, s.sections, s.blocks], [false, { total: 3, loaded: 0 }, { total: 3, loaded: 0 }]);
      assert.deepEqual(s.stalled, ['body.appear', 'section 0', 'section 1', 'section 2', 'block header', 'block cards', 'block footer']);
    } finally { await ctx.close(); await server.close(); }
  });

  await check('with a token (a protected preview): a request without the header gets 401', async () => {
    const server = await startPreviewServer({ token: 'canary-123', decorateDelayMs: 100 });
    try {
      const anon = await opened(server.origin, '/ns/home');
      assert.equal(anon.response.status(), 401);
      await anon.ctx.close();
    } finally { await server.close(); }
  });

  await check('the home page is the delivered DOM (R5): header, footer, three sections, default content, the cards block, one 560×240 card, a 24px icon, a rehosted image', async () => {
    const server = await startPreviewServer({ decorateDelayMs: 100 });
    const { ctx, page } = await opened(server.origin, '/ns/home');
    try {
      await edsSettle(page);
      const d = await page.evaluate(() => {
        const text = (el) => el.innerText.replace(/\s+/g, ' ').trim();
        const box = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return { w: r.width, h: r.height, pad: s.padding }; };
        const sections = [...document.querySelectorAll('main > div')];
        const img = document.querySelector('main p > picture > img');
        const cardsChildren = [...document.querySelectorAll('main .cards > div')];
        return {
          chrome: [document.querySelector('header')?.innerText.trim(), document.querySelector('footer')?.innerText.trim()],
          mainChildren: [...document.querySelector('main').children].map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
          statuses: sections.map((el) => el.dataset.sectionStatus),
          firstSection: { html: sections[0].innerHTML, text: sections[0].innerText },
          h1: document.querySelector('main .default-content-wrapper h1')?.textContent,
          lead: document.querySelectorAll('main .default-content-wrapper > p')[0]?.textContent,
          buttons: [...document.querySelectorAll('main p.button-wrapper > a')].map((a) => [a.className, a.textContent]),
          rows: (() => { const r = (el) => el.getBoundingClientRect(); const [lead] = document.querySelectorAll('main .default-content-wrapper > p'); const [a, b] = [...document.querySelectorAll('main a.button')].map(r); return { leadBottom: r(lead).bottom, buttonTops: [a.top, b.top], gap: b.left - a.right, size: [a.width, a.height], imgTop: r(document.querySelector('main img')).top, buttonsBottom: a.bottom }; })(),
          img: { alt: img?.alt, src: img?.getAttribute('src'), natural: img?.naturalWidth, shown: img?.clientWidth },
          cardsBlock: (() => { const b = document.querySelector('main .cards-wrapper > .cards.block'); return b && { name: b.dataset.blockName, status: b.dataset.blockStatus, display: getComputedStyle(b).display, h2: b.querySelector('h2')?.textContent, texts: [...b.querySelectorAll(':scope > p')].map((p) => p.textContent) }; })(),
          cardsChildren: cardsChildren.map((el) => ({ ...box(el), text: text(el), link: el.querySelector('a')?.textContent })),
          cardAnywhere: !!document.querySelector('.card'),
          icon: (() => { const i = document.querySelector('span.icon'); return i && box(i); })(),
          s02: (() => { const s = getComputedStyle(sections[2]); return [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft, sections[2].getBoundingClientRect().width]; })(),
          bodyWidth: document.body.getBoundingClientRect().width,
        };
      });
      assert.deepEqual(d.chrome, ['Sample kit', 'Sample kit, all rights reserved.']);
      assert.equal(d.mainChildren.length, 3);
      assert.ok(d.mainChildren.every((c) => c.startsWith('div.section')), d.mainChildren.join(' | '));
      assert.deepEqual(d.statuses, ['loaded', 'loaded', 'loaded']);
      assert.deepEqual([d.firstSection.html, d.firstSection.text], ['', ''], 'the phantom first section is empty');
      assert.equal(d.h1, 'Welcome to the kit');
      assert.match(d.lead, /^A calm, readable starting point for every page in the sample kit/);
      assert.deepEqual(d.buttons, [['button primary', 'Get started'], ['button secondary', 'Learn more']]);
      assert.ok(d.rows.buttonTops[0] >= d.rows.leadBottom && d.rows.imgTop >= d.rows.buttonsBottom, 'lead, then the buttons, then the image');
      assert.deepEqual([d.rows.buttonTops[0] === d.rows.buttonTops[1], d.rows.gap, d.rows.size], [true, 24, [140, 48]]);
      assert.equal(d.img.alt, 'A calm board of three planned tasks');
      assert.match(d.img.src, /^\.\/media_[0-9a-f]{12,}\.png/);
      assert.ok(d.img.natural > 0 && d.img.shown > 0, 'the rehosted image does not load');
      assert.deepEqual([d.cardsBlock.name, d.cardsBlock.status, d.cardsBlock.display, d.cardsBlock.h2], ['cards', 'loaded', 'grid', 'Everything in one place']);
      assert.equal(d.cardsBlock.texts.length, 2);
      assert.equal(d.cardsChildren.length, 1, 'exactly one .cards > div');
      assert.deepEqual([d.cardsChildren[0].w, d.cardsChildren[0].h, d.cardsChildren[0].pad], [560, 240, '24px']);
      assert.deepEqual([d.cardsChildren[0].text, d.cardsChildren[0].link], ['New Try it', 'Try it']);
      assert.equal(d.cardAnywhere, false);
      assert.deepEqual([d.icon.w, d.icon.h], [24, 24]);
      assert.deepEqual(d.s02, ['80px', '120px', '80px', '120px', 1440]);
      assert.equal(d.bodyWidth, 1440);
    } finally { await ctx.close(); await server.close(); }
  });

  await check('the home page does not overflow at 360 wide once decorated', async () => {
    const server = await startPreviewServer({ decorateDelayMs: 100 });
    const { ctx, page } = await opened(server.origin, '/ns/home', { viewport: { width: 360, height: 800 } });
    try {
      await edsSettle(page);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 0, `scrollWidth exceeds the viewport by ${over}px`);
    } finally { await ctx.close(); await server.close(); }
  });

  await check('the plain form is served beside the page, without a metadata block', async () => {
    const server = await startPreviewServer();
    try {
      const plain = await fetch(`${server.origin}/ns/home.plain.html`);
      assert.equal(plain.status, 200);
      assert.match(plain.headers.get('content-type'), /^text\/html/);
      assert.equal(await plain.text(), read('home.plain.html'));
      assert.equal((await fetch(`${server.origin}/ns/other`)).status, 404);
      assert.equal((await fetch(`${server.origin}/ns/other.plain.html`)).status, 404);
      const img = await fetch(`${server.origin}/ns/media_5f2c0a9d4b7e1a63.png`);
      assert.deepEqual([img.status, img.headers.get('content-type')], [200, 'image/png']);
      assert.deepEqual([...new Uint8Array(await img.arrayBuffer()).slice(1, 4)], [0x50, 0x4e, 0x47]);
    } finally { await server.close(); }
  });

  await check('pages takes a fixture name or an absolute path, serves each with its plain form (derived from <main> when there is none) and decorates any page it serves', async () => {
    const reskinPage = join(HERE, 'fixtures', 'figma-gate', 'page.html');
    const server = await startPreviewServer({ decorateDelayMs: 100, pages: { '/ns/home': 'home.html', '/ns/reskin': reskinPage } });
    const { ctx, page, response } = await opened(server.origin, '/ns/reskin');
    try {
      assert.equal(response.status(), 200);
      assert.deepEqual(await edsSettle(page), { appear: true, sections: { total: 0, loaded: 0 }, blocks: { total: 0, loaded: 0 }, stalled: [] });
      assert.equal(await page.evaluate(() => document.querySelectorAll('main > section[data-slot]').length), 2);
      const plain = await (await fetch(`${server.origin}/ns/reskin.plain.html`)).text();
      assert.match(plain, /^<body>\s*<header><\/header>\s*<main>[\s\S]*Welcome to the kit[\s\S]*<\/main>\s*<footer><\/footer>\s*<\/body>\s*$/);
      assert.equal((await fetch(`${server.origin}/ns/home`)).status, 200);
    } finally { await ctx.close(); await server.close(); }
  });

  await check('the source page is the live source: main text equals the preview\'s but for the declared text delta, on the source host, same image alt', async () => {
    const preview = await startPreviewServer({ decorateDelayMs: 100 });
    const source = await startSourceServer();
    const view = async (origin, path, { eds }) => {
      const { ctx, page } = await opened(origin, path);
      try {
        if (eds) await edsSettle(page); else await page.waitForLoadState('networkidle');
        return await page.evaluate(() => ({
          text: document.querySelector('main').innerText.replace(/\s+/g, ' ').trim(),
          imgs: [...document.querySelectorAll('main img')].map((i) => ({ alt: i.alt, w: i.getBoundingClientRect().width, loaded: i.naturalWidth > 0 })),
          canonical: document.querySelector('link[rel=canonical]')?.href,
          ogUrl: document.querySelector('meta[property="og:url"]')?.content,
          ogImage: document.querySelector('meta[property="og:image"]')?.content,
          jsonLd: document.querySelectorAll('script[type="application/ld+json"]').length,
        }));
      } finally { await ctx.close(); }
    };
    try {
      const src = await view(source.origin, '/', { eds: false });
      const prev = await view(preview.origin, '/ns/home', { eds: true });
      let expected = src.text;
      for (const a of json('deltas.json').text.allow) expected = expected.split(a.from).join(a.to);
      assert.notEqual(src.text, prev.text, 'the fixtures declare one text difference');
      assert.equal(expected, prev.text);
      assert.deepEqual(src.imgs.map((i) => i.alt), prev.imgs.map((i) => i.alt));
      assert.equal(src.imgs.length, 1);
      assert.ok(src.imgs.every((i) => i.w > 0) && prev.imgs.every((i) => i.w > 0));
      const sourceHost = json('deltas.json').links.localize.sourceHost;
      for (const u of [src.canonical, src.ogUrl, src.ogImage]) assert.equal(new URL(u).host, sourceHost, u);
      for (const [name, u] of [['canonical', prev.canonical], ['og:url', prev.ogUrl], ['og:image', prev.ogImage]]) assert.equal(new URL(u).origin, preview.origin, `the preview's ${name} is its own`);
      assert.equal(src.jsonLd, prev.jsonLd);
      assert.ok(source.requests.some((r) => r.path === '/images/hero.png'), 'the source image is served');
    } finally { await preview.close(); await source.close(); }
  });

  await check('content-model.json is the model of source.html: slots, ordered stream, CTAs, images and metadata', async () => {
    const source = await startSourceServer();
    const model = loadSourceModel(source.origin);
    const { ctx, page } = await opened(source.origin, '/');
    try {
      assert.equal(model._provenance.url, `${source.origin}/`);
      assert.equal(model._provenance.scope, 'main');
      assert.deepEqual(model.sections.map((s) => s.slot), ['s01', 's02']);
      const dom = await page.evaluate(() => {
        const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
        const og = {}; const tw = {};
        document.querySelectorAll('meta').forEach((m) => {
          const p = m.getAttribute('property') || ''; const n = m.getAttribute('name') || '';
          if (p.startsWith('og:')) og[p] = m.content;
          if (n.startsWith('twitter:')) tw[n] = m.content;
        });
        return {
          main: norm(document.querySelector('main').innerText),
          title: document.title,
          description: document.querySelector('meta[name=description]')?.content,
          canonical: document.querySelector('link[rel=canonical]')?.getAttribute('href'),
          og, tw,
          jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent)),
          lang: document.documentElement.lang,
          sections: [...document.querySelectorAll('main > section')].map((s) => ({ text: norm(s.innerText), links: [...s.querySelectorAll('a')].map((a) => [norm(a.textContent), a.getAttribute('href'), a.className]), imgs: [...s.querySelectorAll('img')].map((i) => i.alt) })),
        };
      });
      assert.equal(model.visibleTextNormalized, dom.main);
      assert.equal(model.sections.length, dom.sections.length);
      model.sections.forEach((s, i) => {
        assert.equal(s.visibleText, dom.sections[i].text, s.slot);
        assert.deepEqual(s.ctas.map((c) => [c.text, c.href, c.classes]), dom.sections[i].links, s.slot);
        assert.deepEqual(s.images.map((im) => im.alt), dom.sections[i].imgs, s.slot);
        assert.equal(s.orderedVerified, true);
        assert.equal(squash(s.ordered.filter((n) => n.kind !== 'image').map((n) => n.text).join(' ')), s.visibleText, `${s.slot} ordered stream tiles visibleText`);
        for (const c of s.ctas) assert.ok(c.absHref.startsWith('https://'), c.absHref);
      });
      const m = model.metadata;
      assert.deepEqual([m.title, m.description, m.canonical, m.ogTags, m.twitterTags, m.jsonLd, m.lang], [dom.title, dom.description, dom.canonical, dom.og, dom.tw, dom.jsonLd, dom.lang]);
      const preview = await startPreviewServer({ decorateDelayMs: 100 });
      try {
        const p = await opened(preview.origin, '/ns/home');
        await edsSettle(p.page);
        const text = await p.page.evaluate(() => document.querySelector('main').innerText.replace(/\s+/g, ' ').trim());
        const delta = json('deltas.json').text.allow[0];
        for (const s of model.sections) assert.ok(text.includes(s.visibleText.split(delta.from).join(delta.to)), `${s.slot} is on the preview once the delta is applied`);
        await p.ctx.close();
      } finally { await preview.close(); }
    } finally { await ctx.close(); await source.close(); }
  });

  await browser.close();
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
