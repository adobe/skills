#!/usr/bin/env node
// skills/qa/scripts/test/player-before-paint-browser.test.mjs — the browser half of deploy SKILL.md #157:
// the request collector behind `player-before-paint` dates requests by the browser's clock, and the
// rule's reference snippet mounts the player in every lifecycle state. Every request is routed, so no
// network. Needs Playwright from the project (run from a project directory); skipped otherwise.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectRequests, judgePlayerRequests } from '../checks/perf.mjs';

let chromium;
try {
  const require = createRequire(join(process.cwd(), 'package.json'));
  const mod = await import(pathToFileURL(require.resolve('playwright')).href);
  chromium = mod.chromium || mod.default?.chromium;
} catch { /* skipped below */ }
const browserTest = { skip: chromium ? false : 'Playwright is not available from the project', timeout: 30000 };

// the snippet ships in the deploy skill doc; a project copy of the qa scripts has no doc beside it
const SKILL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'deploy', 'SKILL.md');
const SNIPPET = existsSync(SKILL)
  ? readFileSync(SKILL, 'utf8').match(/\(#157\)[\s\S]*?```js\n([\s\S]*?)\n {2}```/)?.[1].replace(/^ {2}/gm, '')
  : null;
const snippetTest = { ...browserTest, skip: browserTest.skip || (SNIPPET ? false : 'deploy/SKILL.md #157 snippet not found') };

const ORIGIN = 'https://site.test';
const PLAYER = 'https://www.youtube.com/embed/abc';

// a first section hidden until its blocks load, as the boilerplate's loadSection does
const page = ({ head = '', body, script }) => `<!doctype html><html><head>${head}
<style>.player{aspect-ratio:16/9}.player iframe{display:block;width:100%;height:100%;border:0}</style></head>
<body><main><div class="section" style="display:none">${body}</div></main>
<script>${SNIPPET || ''}\n${script}</script></body></html>`;
const showAfter = (ms) => `setTimeout(() => { document.querySelector('.section').style.display = ''; }, ${ms});`;

async function withPage(html, fn, { noPaintTiming = false, busyOn = '', busyMs = 1200 } = {}) {
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage();
    if (noPaintTiming) await p.addInitScript(() => { delete window.PerformanceObserver; });
    if (busyOn) { // a busy QA process: hearing of the player request stalls it while the page paints
      let once = true;
      p.on('request', (r) => {
        if (!once || !r.url().startsWith(busyOn)) return;
        once = false; const end = Date.now() + busyMs; while (Date.now() < end);
      });
    }
    const cdp = await p.context().newCDPSession(p); // as perf.mjs: Network enabled before navigation
    await cdp.send('Network.enable');
    const requests = collectRequests(p, cdp);
    const errors = []; const dialogs = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
    await p.route(`${ORIGIN}/**`, (r) => r.fulfill({ contentType: 'text/html', body: html }));
    await p.route('https://www.youtube.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>player</p>' }));
    await p.route('https://www.youtube.com/api/**', () => {}); // a slow vendor API: no response in the window
    await p.goto(`${ORIGIN}/`, { waitUntil: 'load' });
    const fcp = () => p.evaluate(() => {
      const e = performance.getEntriesByName('first-contentful-paint')[0];
      return e ? performance.timeOrigin + e.startTime : 0;
    });
    await fn({ p, requests, errors, dialogs, fcp });
  } finally { await browser.close(); }
}

test('collector: a pre-paint player request is caught even when this process hears of it late', browserTest, async () => {
  const html = page({
    body: `<h1>Title</h1><p><a href="${PLAYER}">Video</a></p>`,
    script: `setTimeout(() => { const a = document.querySelector('main a');
      a.replaceWith(Object.assign(document.createElement('iframe'), { src: a.href })); ${showAfter(300)} }, 50);`,
  });
  await withPage(html, async ({ p, requests, fcp }) => {
    await p.waitForTimeout(1500);
    const f = await fcp();
    assert.ok(f > 0, 'page painted');
    const { early } = judgePlayerRequests(requests(), f);
    assert.equal(early.length, 1, `eager iframe flagged: ${JSON.stringify(requests().filter((r) => r.url.includes('youtube')))}`);
    assert.equal(early[0].type, 'document');
  }, { busyOn: PLAYER });
});

test('collector: a pre-paint player request still pending at measurement is caught by its browser start', browserTest, async () => {
  const html = page({
    body: '<h1>Title</h1>',
    script: `setTimeout(() => { fetch('https://www.youtube.com/api/held').catch(() => {}); ${showAfter(300)} }, 50);`,
  });
  await withPage(html, async ({ p, requests, fcp }) => {
    await p.waitForTimeout(1500);
    const held = requests().find((r) => r.url.endsWith('/api/held'));
    assert.ok(held && held.heard > await fcp(), 'this process heard of it after the paint');
    const { early, unmeasured } = judgePlayerRequests(requests(), await fcp());
    assert.deepEqual([early.map((x) => x.type), unmeasured], [['fetch'], []]);
  }, { busyOn: 'https://www.youtube.com/api/' });
});

test('snippet: a player-only first section still paints, then mounts the player after FCP', snippetTest, async () => {
  const html = page({
    body: `<p><a href="${PLAYER}">Promo video</a></p><p>Below</p>`,
    script: `setTimeout(() => { mountPlayer(document.querySelector('main a')); ${showAfter(300)} }, 50);`,
  });
  await withPage(html, async ({ p, requests, errors, fcp }) => {
    const frame = await p.waitForSelector('.player > iframe', { state: 'attached', timeout: 5000 });
    assert.equal(await frame.getAttribute('src'), PLAYER);
    assert.equal(await frame.evaluate((f) => [f.title, f.loading].join('|')), 'Promo video|lazy');
    assert.equal(await p.locator('.player a').count(), 0, 'the link is replaced by the iframe');
    const box = await p.evaluate(() => { // in flow: a box that keeps its height moves nothing below it
      const r = document.querySelector('.player').getBoundingClientRect();
      return { h: r.height, reserved: (r.width * 9) / 16 };
    });
    assert.ok(Math.abs(box.h - box.reserved) < 0.5, `the box keeps its reserved height after mount: ${JSON.stringify(box)}`);
    await p.waitForTimeout(300);
    assert.deepEqual(judgePlayerRequests(requests(), await fcp()), { early: [], unmeasured: [] });
    assert.deepEqual(errors, []);
  });
});

test('snippet without paint timing: mounts at load, or at once when decorated after load', snippetTest, async () => {
  for (const [label, script] of [
    ['before load', `mountPlayer(document.querySelector('main a')); ${showAfter(0)}`],
    ['after load', `addEventListener('load', () => setTimeout(() => { mountPlayer(document.querySelector('main a')); ${showAfter(0)} }, 50));`],
  ]) {
    const html = page({ body: `<p><a href="${PLAYER}">Video</a></p>`, script });
    await withPage(html, async ({ p, errors }) => {
      await p.waitForSelector('.player > iframe', { state: 'attached', timeout: 5000 });
      assert.deepEqual(errors, [], label);
    }, { noPaintTiming: true });
  }
});

test('snippet: links that are not an https player URL on the host list stay links and run nothing', snippetTest, async () => {
  const links = ['javascript:alert(1)', 'http://www.youtube.com/embed/abc', 'https://www.youtube.com.evil.example/embed/abc'];
  const html = page({
    body: `<h1>Title</h1>${links.map((h) => `<p><a href="${h}">x</a></p>`).join('')}`,
    script: `document.querySelectorAll('main a').forEach((a) => mountPlayer(a)); ${showAfter(0)}`,
  });
  await withPage(html, async ({ p, errors, dialogs }) => {
    await p.waitForTimeout(800);
    assert.equal(await p.locator('iframe').count(), 0);
    assert.deepEqual(await p.locator('main a').evaluateAll((as) => as.map((a) => a.getAttribute('href'))), links);
    assert.deepEqual(dialogs, []);
    assert.deepEqual(errors, []);
  });
});
