/*
 * Browser runtime (scripts/personalization/index.js) in headless Chromium:
 * edge handoff, re-evaluation ordering and section classes. Playwright
 * resolves from the project (cwd) first, then from the script tree; the suite
 * is skipped when neither has it or Chromium is not installed.
 */

import assert from 'node:assert/strict';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  after, before, describe, it,
} from 'node:test';
import { RUNTIME_DIR, RUNTIME_MODULES } from '../lib.mjs';
import { tempDir } from './helpers.mjs';

const UA = 'Mozilla/5.0 (Macintosh) Chrome/140 Safari/537.36';

const CONFIG = `export default {
  fragmentPrefixes: ['/fragments/'],
  budgets: { eager: 3000, lazy: 3000 },
  devices: { desktop: '(min-width: 0px)' },
  geo: { endpoint: '', timeout: 500 },
  api: { endpoint: '/decide', sendWithoutConsent: false, mapRequest: null, mapResponse: null },
  audiences: {},
  hasConsent: () => !!window.testConsent,
  overrides: 'preview',
  botsGetDefault: true,
  analytics: { dataLayer: false, rum: false },
};`;

// Stock loadFragment minus decoration, with per-path delays for race tests.
const FRAGMENT_BLOCK = `export async function loadFragment(path) {
  await new Promise((done) => { setTimeout(done, (window.testDelays || {})[path] || 0); });
  const resp = await fetch(\`\${path}.plain.html\`);
  if (!resp.ok) return null;
  const main = document.createElement('main');
  main.innerHTML = await resp.text();
  main.querySelectorAll(':scope > div').forEach((div) => div.classList.add('section'));
  return main;
}`;

const row = (key, path) => `<div><div>${key}</div><div><a href="${path}">${path}</a></div></div>`;

const PAGE = `<!DOCTYPE html><html><head></head><body><main>
<div class="section dark"><div class="personalization-wrapper"><div class="personalization" id="offer" EDGE>
<div><div>id</div><div>offer</div></div><div><div>source</div><div>api</div></div>
${row('geo: IN', '/fragments/offer/india')}
${row('param: promo', '/fragments/offer/promo')}
${row('default', '/fragments/offer/default')}
</div></div></div>
<div class="section"><div class="personalization-wrapper"><div class="personalization" id="quiz">
<div><div>id</div><div>quiz</div></div>
${row('state: persona=a', '/fragments/quiz/a')}
${row('state: persona=b', '/fragments/quiz/b')}
<div><div>default</div><div>none</div></div>
</div></div></div>
</main>
<script type="module">
  import { initPersonalization, personalize } from '/scripts/personalization/index.js';
  const main = document.querySelector('main');
  initPersonalization(main);
  window.testDone = Promise.all([...main.querySelectorAll('.personalization')].map((block) => personalize(block)));
</script></body></html>`;

function buildSite(dir) {
  mkdirSync(join(dir, 'scripts', 'personalization'), { recursive: true });
  mkdirSync(join(dir, 'blocks', 'fragment'), { recursive: true });
  RUNTIME_MODULES.forEach((name) => cpSync(
    join(RUNTIME_DIR, 'scripts', 'personalization', name),
    join(dir, 'scripts', 'personalization', name),
  ));
  writeFileSync(join(dir, 'scripts', 'personalization', 'config.js'), CONFIG);
  writeFileSync(join(dir, 'scripts', 'aem.js'), 'export function sampleRUM() {}');
  writeFileSync(join(dir, 'blocks', 'fragment', 'fragment.js'), FRAGMENT_BLOCK);
  ['offer/india', 'offer/promo', 'offer/summer', 'offer/default', 'quiz/a', 'quiz/b'].forEach((name) => {
    mkdirSync(join(dir, 'fragments', name.split('/')[0]), { recursive: true });
    const classes = name === 'quiz/a' ? ' class="dark only-a"' : '';
    writeFileSync(join(dir, 'fragments', `${name}.plain.html`), `<div${classes}><p>${name}</p></div>`);
  });
}

async function launch() {
  try {
    const requires = [createRequire(join(process.cwd(), 'package.json')), createRequire(import.meta.url)];
    const require = requires.find((req) => {
      try {
        req.resolve('playwright');
        return true;
      } catch (e) {
        return false;
      }
    });
    const { chromium } = require('playwright');
    return await chromium.launch();
  } catch (e) {
    return null;
  }
}

const browser = await launch();

describe('browser runtime', { skip: browser ? false : 'Playwright Chromium not installed' }, () => {
  const site = tempDir('pzn-runtime-');
  let server;
  let base;
  let edgeAttrs = '';
  let apiCalls = 0;

  before(async () => {
    buildSite(site.dir);
    server = http.createServer(async (req, res) => {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname === '/decide') {
        apiCalls += 1;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ decisions: { offer: { variant: 'promo' } }, ttl: 0 }));
        return;
      }
      if (pathname === '/page.html') {
        res.setHeader('content-type', 'text/html');
        res.end(PAGE.replace('EDGE', edgeAttrs));
        return;
      }
      try {
        const body = await readFile(join(site.dir, pathname));
        res.setHeader('content-type', pathname.endsWith('.js') ? 'text/javascript' : 'text/html');
        res.end(body);
      } catch (e) {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise((done) => { server.listen(0, done); });
    base = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    await browser?.close();
    server?.close();
    site.cleanup();
  });

  async function open({ edge = '', query = '', init = '' } = {}) {
    edgeAttrs = edge;
    apiCalls = 0;
    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (init) await page.addInitScript(init);
    await page.goto(`${base}/page.html${query}`);
    await page.waitForFunction(() => window.hlx?.personalization);
    return { page, errors, close: () => context.close() };
  }

  const read = (page, id) => page.evaluate((blockId) => {
    const block = document.getElementById(blockId);
    return {
      variant: block.dataset.pznVariant,
      source: block.dataset.pznSource,
      text: [...document.querySelectorAll(`[data-pzn-id="${blockId}"]:not(.personalization)`)]
        .map((node) => node.textContent.trim()).join('|'),
      classes: block.closest('.section').className.split(' '),
    };
  }, id);

  it('renders the edge variant, then decides in the browser on refresh()', async () => {
    const { page, errors, close } = await open({ edge: 'data-pzn-source="edge" data-pzn-variant="india" data-pzn-fragment="/fragments/offer/india"' });
    await page.evaluate(() => window.testDone);
    assert.deepEqual(await read(page, 'offer'), {
      variant: 'india', source: 'edge', text: 'offer/india', classes: ['section', 'dark'],
    });
    assert.equal(apiCalls, 0);
    await page.evaluate(async () => {
      window.testConsent = true;
      await window.hlx.personalization.refresh();
    });
    const offer = await read(page, 'offer');
    assert.equal(offer.variant, 'promo');
    assert.equal(offer.source, 'api');
    assert.equal(offer.text, 'offer/promo');
    assert.equal(apiCalls, 1);
    assert.deepEqual(errors, []);
    await close();
  });

  it('renders an edge fragment that no rule names, by path', async () => {
    const { page, close } = await open({ edge: 'data-pzn-source="edge" data-pzn-variant="summer" data-pzn-fragment="/fragments/offer/summer"' });
    await page.evaluate(() => window.testDone);
    const offer = await read(page, 'offer');
    assert.equal(offer.variant, 'summer');
    assert.equal(offer.text, 'offer/summer');
    assert.equal(apiCalls, 0);
    await close();
  });

  it('reaches a placeholder still loading its first fragment', async () => {
    const { page, close } = await open({ query: '?pzn-state=persona:a', init: 'window.testDelays = { "/fragments/quiz/a": 800 };' });
    const status = await page.evaluate(async () => {
      const before = document.getElementById('quiz').dataset.pznStatus;
      await window.hlx.personalization.setState('persona', 'b');
      await window.testDone;
      return before;
    });
    assert.equal(status, undefined, 'setState ran before the first render');
    const quiz = await read(page, 'quiz');
    assert.equal(quiz.variant, 'b');
    assert.equal(quiz.text, 'quiz/b');
    await close();
  });

  it('lets the latest setState win over a slower earlier one', async () => {
    const { page, close } = await open({ init: 'window.testDelays = { "/fragments/quiz/a": 600 };' });
    await page.evaluate(async () => {
      await window.testDone;
      const { setState } = window.hlx.personalization;
      const first = setState('persona', 'a');
      await new Promise((done) => { setTimeout(done, 50); });
      await Promise.all([first, setState('persona', 'b')]);
    });
    const quiz = await read(page, 'quiz');
    assert.equal(quiz.variant, 'b');
    assert.equal(quiz.text, 'quiz/b');
    await close();
  });

  it('removes only the section classes a variant added', async () => {
    const { page, close } = await open();
    await page.evaluate(async () => {
      await window.testDone;
      document.getElementById('quiz').closest('.section').classList.add('dark');
      await window.hlx.personalization.setState('persona', 'a');
      await window.hlx.personalization.setState('persona', 'b');
    });
    const quiz = await read(page, 'quiz');
    assert.equal(quiz.variant, 'b');
    assert.ok(quiz.classes.includes('dark'), 'host class kept');
    assert.ok(!quiz.classes.includes('only-a'), 'variant class removed');
    await close();
  });

  it('keeps the edge decision with ?pzn-debug', async () => {
    const { page, close } = await open({ edge: 'data-pzn-source="edge" data-pzn-variant="india"', query: '?pzn-debug' });
    await page.evaluate(() => window.testDone);
    const offer = await read(page, 'offer');
    assert.equal(offer.variant, 'india');
    assert.equal(offer.source, 'edge');
    await close();
  });
});
