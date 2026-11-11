/*
 * Browser runtime (scripts/personalization/sections.js and its modules) in
 * headless Chromium, against the contract: decisions and outcomes (section
 * 4), consent and its exceptions (3), the engine API answer kinds (5), split
 * (6), Target over the Delivery API (7), the edge handoff (8) and the
 * measurement events (9). Every captured pzn:* event is validated against
 * measurement-event.schema.json and its semantics. The engine is the test
 * server's /decide route; Target is answered through a Playwright route.
 * Skipped when Playwright Chromium is not installed.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  after, before, beforeEach, describe, it,
} from 'node:test';
import { ASSETS_DIR, RUNTIME_DIR, loadPlaywright } from '../lib.mjs';
import { check } from '../schema.mjs';
import { simulateEdge } from '../simulate.mjs';
import { FIXTURES, tempDir } from './helpers.mjs';
import {
  ACTIVITIES, ENGINE_TABLE, PAGES, buildSite, page as pageHtml, section, sectionRows, spacer,
  withRuntime,
} from './fixtures/browser/site.mjs';

const { engineAnswer, targetAnswer } = await import(pathToFileURL(join(RUNTIME_DIR, 'scripts', 'personalization', 'mock-engine.js')).href);

const UA = 'Mozilla/5.0 (Macintosh) Chrome/140 Safari/537.36';
const BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const DELIVERY = /^https:\/\/[^/]+\.tt\.omtrdc\.net\/rest\/v1\/delivery/;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const PILOT = JSON.parse(await readFile(join(ASSETS_DIR, 'contract', 'pilot-scenarios.json'), 'utf8'));
const EXAMPLES = join(FIXTURES, 'contract', 'examples', 'section');
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });

async function launch() {
  const playwright = loadPlaywright() || loadPlaywright([process.cwd()]);
  try {
    return playwright ? await playwright.chromium.launch() : null;
  } catch (e) {
    return null;
  }
}

const browser = await launch();

/**
 * Problems of a page's events: schema and semantics, one pzn:decided and one
 * pzn:applied per decision, seen and clicked at most once per decision,
 * nothing before its pzn:decided.
 * @param {object[]} events
 * @returns {string[]}
 */
function eventProblems(events) {
  const problems = [];
  const counts = {};
  const decided = new Set();
  events.forEach((item) => {
    const { event, personalization: p } = item;
    check('measurement-event', item).forEach((problem) => problems.push(`${event} ${p?.decisionId}: ${problem}`));
    if (event === 'pzn:decided') decided.add(p.decisionId);
    else if (!decided.has(p.decisionId)) problems.push(`${event} ${p.decisionId} before pzn:decided`);
    if (event === 'pzn:notified') return;
    const key = `${event} ${p.decisionId}`;
    counts[key] = (counts[key] || 0) + 1;
    if (counts[key] === 2) problems.push(`${key} sent twice`);
  });
  return problems;
}

// Whether actual holds every field of expected (objects recursively; href by path).
function holds(expected, actual, key = '') {
  if (key === 'href') return new URL(expected).pathname === new URL(actual, 'https://x.invalid').pathname;
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    return !!actual && typeof actual === 'object'
      && Object.entries(expected).every(([name, value]) => holds(value, actual[name], name));
  }
  return JSON.stringify(expected) === JSON.stringify(actual);
}

describe('section runtime', { skip: browser ? false : 'Playwright Chromium not installed' }, () => {
  const site = tempDir('pzn-sections-');
  const pages = { ...PAGES };
  let server;
  let base;
  let engine;
  let engineCalls;
  let beacons;

  const tableEngine = async (body) => engineAnswer(ENGINE_TABLE, body);

  before(async () => {
    buildSite(site.dir);
    server = http.createServer(async (req, res) => {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (req.method === 'POST' && ['/decide', '/feedback'].includes(pathname)) {
        let text = '';
        req.on('data', (chunk) => { text += chunk; });
        await new Promise((done) => { req.on('end', done); });
        const body = JSON.parse(text || '{}');
        if (pathname === '/feedback') {
          beacons.push(body);
          res.statusCode = 204;
          res.end();
          return;
        }
        engineCalls.push(body);
        const answer = await engine(body);
        if (answer.delay) await sleep(answer.delay);
        res.statusCode = answer.status || 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(answer.body ?? {}));
        return;
      }
      if (pages[pathname]) {
        res.setHeader('content-type', 'text/html');
        res.end(pages[pathname]);
        return;
      }
      try {
        const body = await readFile(join(site.dir, pathname));
        const type = { js: 'text/javascript', css: 'text/css' }[pathname.split('.').pop()] || 'text/html';
        res.setHeader('content-type', type);
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

  beforeEach(() => {
    engine = tableEngine;
    engineCalls = [];
    beacons = [];
  });

  const settled = (page) => page.waitForFunction(() => !document.querySelector('[data-section-status^="pzn-"]'), null, { timeout: 8000 });

  async function assertShown(page) {
    const hidden = await page.evaluate(() => [...document.querySelectorAll('main > .section')]
      .filter((el) => el.style.display === 'none' || el.dataset.sectionStatus !== 'loaded')
      .map((el) => el.dataset.personalization || 'plain'));
    assert.deepEqual(hidden, [], 'no section is left hidden');
  }

  const events = (page, id, name) => page.evaluate(([sectionId, event]) => window.testEvents
    .filter((item) => (!sectionId || item.personalization.id === sectionId) && (!event || item.event === event)), [id, name]);

  // A browser context whose Target Delivery API calls are answered (and recorded).
  async function newContext({
    userAgent = UA, viewport = { width: 1280, height: 800 },
    target = (body) => targetAnswer(ACTIVITIES, body, { clientCode: 'acme' }),
  } = {}) {
    const context = await browser.newContext({ userAgent, viewport });
    const targetCalls = [];
    await context.route(DELIVERY, async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS });
        return;
      }
      const body = JSON.parse(request.postData() || '{}');
      targetCalls.push({ url: request.url(), body });
      const answer = await target(body);
      await route.fulfill({
        status: answer.status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(answer.body),
      });
    });
    context.targetCalls = targetCalls;
    return context;
  }

  /**
   * Opens a page in a fresh context (or a shared one) and waits until every
   * section is decided and shown.
   */
  async function open({
    path = '/page.html', query = '', consent, config, userAgent = UA, viewport = { width: 1280, height: 800 },
    context: shared, target = (body) => targetAnswer(ACTIVITIES, body, { clientCode: 'acme' }), referer,
  } = {}) {
    const context = shared || await newContext({ userAgent, viewport, target });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.addInitScript(([given, settings]) => {
      if (given !== undefined) window.testConsent = given;
      if (settings) window.testConfig = settings;
    }, [consent, config]);
    await page.goto(`${base}${path}${query}`, referer ? { referer } : undefined);
    await page.evaluate(() => window.testDone);
    await settled(page);
    return {
      page,
      context,
      errors,
      targetCalls: context.targetCalls,
      async close({ allowErrors = false } = {}) {
        await assertShown(page);
        assert.deepEqual(eventProblems(await events(page)), []);
        if (!allowErrors) assert.deepEqual(errors, []);
        if (shared) await page.close();
        else await context.close();
      },
    };
  }

  const read = (page, id) => page.evaluate((sectionId) => {
    const el = document.querySelector(`[data-personalization="${sectionId}"]`);
    const d = el.dataset;
    return {
      where: d.pznWhere,
      status: d.pznStatus,
      variant: d.pznVariant,
      source: d.pznSource,
      outcome: d.pznOutcome,
      reason: d.pznReason,
      decision: d.pznDecision,
      cached: d.pznCached,
      hidden: el.style.display === 'none' || d.sectionStatus !== 'loaded',
      text: el.innerText.trim().replace(/\s+/g, ' '),
      classes: el.className,
    };
  }, id);

  const pick = (object, keys) => Object.fromEntries(keys.map((key) => [key, object[key]]));
  const rows = (page) => page.evaluate(() => window.hlx.personalization.decisions.map((row) => ({ ...row })));
  const lastRow = async (page, id) => (await rows(page)).filter((row) => row.id === id).pop();
  const stored = async (page, context) => ({
    cookies: (await context.cookies()).filter((cookie) => cookie.name.startsWith('pzn-')).map((cookie) => cookie.name).sort(),
    ...(await page.evaluate(() => ({
      local: Object.keys(localStorage).filter((key) => key.startsWith('pzn-')).sort(),
      session: Object.keys(sessionStorage).filter((key) => key.startsWith('pzn-')).sort(),
    }))),
  });
  const scrollTo = (page, ratio) => page.evaluate(async (r) => {
    window.scrollTo(0, document.documentElement.scrollHeight * r - window.innerHeight);
    await new Promise((done) => { setTimeout(done, 300); });
  }, ratio);
  const intoView = (page, id) => page.evaluate(async (sectionId) => {
    document.querySelector(`[data-personalization="${sectionId}"]`).scrollIntoView({ block: 'center' });
    await new Promise((done) => { setTimeout(done, 300); });
  }, id);
  const waitEvent = (page, id, event, decisionId, timeout = 5000) => page.waitForFunction(
    ([sectionId, name, decision]) => window.testEvents.some((item) => item.personalization.id === sectionId
      && item.event === name && (!decision || item.personalization.decisionId === decision)),
    [id, event, decisionId],
    { timeout },
  );
  const waitDecision = (page, id, decisionId, timeout = 5000) => page.waitForFunction(([sectionId, decision]) => {
    const el = document.querySelector(`[data-personalization="${sectionId}"]`);
    return el.dataset.pznDecision === decision && el.dataset.sectionStatus === 'loaded';
  }, [id, decisionId], { timeout });
  // Clicks the first link in a container without leaving the page.
  const clickIn = (page, selector) => page.evaluate((target) => {
    window.addEventListener('click', (event) => event.preventDefault(), { capture: true, once: true });
    document.querySelector(target).querySelector('a[href]').click();
  }, selector);
  const notified = (page, id, type) => events(page, id, 'pzn:notified')
    .then((list) => list.filter((item) => !type || item.personalization.notification.type === type));
  const preferNoMotion = (page) => page.evaluate(() => window.scrollTo(0, 0));

  // --- No consent and page order ---

  it('shows every default without consent: outcome no-consent, nothing stored, sent or called', async () => {
    const session = await open();
    const { page, context } = session;
    for (const id of ['hero', 'plan', 'msg', 'pick', 'inline-offer']) {
      // eslint-disable-next-line no-await-in-loop
      const found = await read(page, id);
      assert.deepEqual(pick(found, ['where', 'status', 'variant', 'outcome', 'decision', 'hidden']), {
        where: 'browser', status: 'applied', variant: 'default', outcome: 'no-consent', decision: `${id}#1`, hidden: false,
      }, id);
      assert.match(found.text, /^Authored/, id);
    }
    assert.equal((await read(page, 'hero')).classes, 'hero dark section', 'host classes kept');
    const broken = await read(page, 'broken');
    assert.deepEqual(pick(broken, ['outcome', 'variant', 'text', 'hidden']), {
      outcome: 'invalid', variant: 'default', text: 'Authored broken', hidden: false,
    });
    assert.match(broken.reason, /Personalization Source/);
    assert.equal((await lastRow(page, 'offer')).popup, 'waiting for consent');
    assert.deepEqual(await events(page), [], 'no measurement without consent');
    assert.equal(await page.evaluate(() => (window.adobeDataLayer || []).length), 0);
    assert.equal(await page.evaluate(() => (window.testRum || []).length), 0);
    assert.equal(engineCalls.length, 0, 'no engine call');
    assert.equal(session.targetCalls.length, 0, 'no Target call');
    assert.deepEqual(await stored(page, context), { cookies: [], local: [], session: [] });
    await session.close({ allowErrors: true });
    // The runtime reports the invalid section as a warning, never an error.
    assert.deepEqual(session.errors, []);
  });

  it('shows sections in page order: nothing below a section still deciding appears first', async () => {
    engine = async (body) => ({ ...(await tableEngine(body)), delay: 900 });
    const context = await newContext();
    const page = await context.newPage();
    await page.goto(`${base}/page.html?pzn-consent=1&utm_campaign=enterprise`);
    await page.waitForFunction(() => document.querySelector('[data-personalization="hero"]').dataset.sectionStatus === 'loaded'
      && document.querySelector('[data-personalization="msg"]').dataset.sectionStatus === 'pzn-ready');
    const during = await page.evaluate(() => [...document.querySelectorAll('main > .section')]
      .map((el) => [el.dataset.personalization || 'plain', el.dataset.sectionStatus, el.style.display === 'none']));
    assert.deepEqual(during.slice(0, 4).map(([id, status]) => [id, status]), [
      ['hero', 'loaded'], ['plain', 'loaded'], ['plan', 'pzn-pending'], ['msg', 'pzn-ready'],
    ]);
    assert.ok(during.slice(2).every(([, , hidden]) => hidden), 'everything from the deciding section down is hidden');
    await settled(page);
    assert.deepEqual(pick(await read(page, 'plan'), ['variant', 'hidden']), { variant: 'enterprise', hidden: false });
    await context.close();
  });

  // --- Rules, measurement, state ---

  it('decides rules, sends decided then applied, RUM and the data layer, and mirrors consent', async () => {
    const { page, context, close } = await open({ query: '?pzn-geo=IN', consent: true });
    const hero = await read(page, 'hero');
    assert.deepEqual(pick(hero, ['where', 'status', 'variant', 'source', 'outcome', 'decision', 'text', 'classes']), {
      where: 'browser', status: 'applied', variant: 'india', source: 'rules', outcome: 'variant', decision: 'hero#1', text: 'India hero', classes: 'hero dark section',
    });
    const heroEvents = await events(page, 'hero');
    assert.deepEqual(heroEvents.slice(0, 2).map((item) => item.event), ['pzn:decided', 'pzn:applied']);
    assert.ok(holds({
      id: 'hero', decisionId: 'hero#1', variant: 'india', assigned: 'india', source: 'rules', where: 'browser', outcome: 'variant', trigger: 'initial',
    }, heroEvents[0].personalization));
    assert.ok(holds({ decisionId: 'hero#1', result: 'applied' }, heroEvents[1].personalization));
    // The hero is in view: seen at once.
    await waitEvent(page, 'hero', 'pzn:seen', 'hero#1');
    const layer = await page.evaluate(() => window.adobeDataLayer.map((entry) => `${entry.event} ${entry.personalization.decisionId}`));
    assert.ok(layer.includes('pzn:decided hero#1') && layer.includes('pzn:applied hero#1'));
    const rum = await page.evaluate(() => window.testRum);
    assert.ok(rum.some((entry) => entry.checkpoint === 'audience' && entry.source === 'hero' && entry.target === 'india'));
    assert.ok(rum.some((entry) => entry.checkpoint === 'experiment' && entry.source === 'pick' && entry.target === 'y'));
    assert.ok(!rum.some((entry) => entry.source === 'plan'), 'no RUM checkpoint for a no-match');
    const cookies = await context.cookies();
    assert.equal(cookies.find((cookie) => cookie.name === 'pzn-consent')?.value, '1', 'pzn-consent mirrors the consent tool');
    await close();
  });

  it('re-decides rules on setState and restores the authored content', async () => {
    const { page, close } = await open({ consent: true });
    assert.equal((await read(page, 'hero')).outcome, 'no-match');
    await page.evaluate(() => window.hlx.personalization.setState('persona', 'a'));
    await waitDecision(page, 'hero', 'hero#2');
    assert.deepEqual(pick(await read(page, 'hero'), ['variant', 'text']), { variant: 'quiz-a', text: 'Quiz A hero' });
    const [decided] = await events(page, 'hero', 'pzn:decided').then((list) => list.filter((item) => item.personalization.decisionId === 'hero#2'));
    assert.equal(decided.personalization.trigger, 'state');
    await page.evaluate(() => window.hlx.personalization.setState('persona', null));
    await waitDecision(page, 'hero', 'hero#3');
    assert.deepEqual(pick(await read(page, 'hero'), ['variant', 'outcome', 'text', 'classes']), {
      variant: 'default', outcome: 'no-match', text: 'Authored hero', classes: 'hero dark section',
    });
    const applied = (await events(page, 'hero', 'pzn:applied')).map((item) => item.personalization.result);
    assert.deepEqual(applied, ['kept-default', 'applied', 'kept-default']);
    assert.ok(await page.evaluate(() => localStorage.getItem('pzn-state') !== null), 'state persisted with consent');
    await close();
  });

  it('re-decides api sections on setState only when the engine reads state', async () => {
    const run = async (engine) => {
      const { page, close } = await open({ query: '?utm_campaign=enterprise', consent: true, config: { api: { engine } } });
      assert.equal((await read(page, 'plan')).decision, 'plan#1');
      await page.evaluate(() => window.hlx.personalization.setState('persona', 'a'));
      // The hero has a Rule row on the key: re-decided with either engine.
      await waitDecision(page, 'hero', 'hero#2');
      if (engine === 'generic') await waitDecision(page, 'plan', 'plan#2');
      else await page.waitForTimeout(500);
      const plan = (await events(page, 'plan', 'pzn:decided')).map((item) => item.personalization.decisionId);
      await close();
      return plan;
    };
    assert.deepEqual(await run('generic'), ['plan#1', 'plan#2'], 'generic engines read state');
    assert.deepEqual(await run('of1'), ['plan#1'], 'of1 reads no state: its section keeps its decision');
  });

  // --- Engine API (section 5) ---

  it('sends one contract request per evaluation and maps the four answer kinds', async () => {
    const cases = [
      ['?utm_campaign=enterprise&email=a@b.c', {
        variant: 'enterprise', source: 'api', outcome: 'variant', text: 'Enterprise plan Book',
      }, 'enterprise', 'applied'],
      ['?utm_campaign=control', {
        variant: 'default', source: 'api', outcome: 'control', text: 'Authored plan Authored link',
      }, 'default', 'kept-default'],
      ['?utm_campaign=keep', {
        variant: 'default', source: 'api', outcome: 'intentional-default', text: 'Authored plan Authored link',
      }, 'default', 'kept-default'],
      // low confidence: the Rule rows decide, the reason is kept.
      ['?utm_campaign=unsure&utm_source=agency', {
        variant: 'agency', source: 'rules', outcome: 'low-confidence', reason: 'low_confidence', text: 'Agency plan',
      }, 'agency', 'applied'],
      ['?utm_campaign=unsure', {
        variant: 'default', source: 'rules', outcome: 'low-confidence', reason: 'low_confidence', text: 'Authored plan Authored link',
      }, undefined, 'kept-default'],
      // Not in the answer: no-match, then the Rule rows.
      ['?utm_campaign=other', {
        variant: 'default', source: 'rules', outcome: 'no-match', text: 'Authored plan Authored link',
      }, undefined, 'kept-default'],
      // Only listed variants count: an unlisted one is a fallback to the Rule rows.
      ['?utm_content=rogue', {
        variant: 'default', source: 'rules', outcome: 'fallback', reason: 'not listed: unlisted', text: 'Authored plan Authored link',
      }, undefined, 'kept-default'],
    ];
    for (const [query, expected, assigned, result] of cases) {
      engineCalls = [];
      // eslint-disable-next-line no-await-in-loop
      const { page, close } = await open({ query, consent: true });
      // eslint-disable-next-line no-await-in-loop
      const plan = await read(page, 'plan');
      assert.deepEqual(pick(plan, Object.keys(expected)), expected, query);
      assert.equal(engineCalls.length, 1, `${query}: one request`);
      assert.deepEqual(check('decision-request', engineCalls[0]), [], `${query}: the request conforms`);
      // eslint-disable-next-line no-await-in-loop
      const [decided, applied] = await events(page, 'plan');
      assert.equal(decided.personalization.assigned, assigned, `${query}: assigned`);
      assert.equal(applied.personalization.result, result, `${query}: result`);
      if (expected.outcome !== 'no-match') assert.equal(decided.personalization.tracking?.engine, 'mock', `${query}: tracking from the engine`);
      // eslint-disable-next-line no-await-in-loop
      await close();
    }
    const [request] = engineCalls;
    assert.deepEqual(request.placeholders, [{
      id: 'plan',
      candidates: ['enterprise', 'agency', 'mobile', 'missing', 'default'],
      fragments: {
        enterprise: '/fragments/plan/enterprise', agency: '/fragments/plan/agency', mobile: '/fragments/plan/mobile', missing: '/fragments/plan/missing',
      },
    }]);
    assert.equal(request.mode, 'client');
    assert.equal(request.context.consent.personalization, true);
    assert.deepEqual(request.context.params, { utm_content: 'rogue' }, 'only utm_* and param: keys are sent');
    const mobile = await open({ consent: true, viewport: { width: 390, height: 844 } });
    assert.equal((await read(mobile.page, 'plan')).variant, 'mobile');
    assert.equal(engineCalls.at(-1).context.device, 'mobile');
    await mobile.close();
  });

  it('falls back to the Rule rows on engine failure and api.timeout; the section budget gives timeout', async () => {
    engine = async () => ({ status: 500, body: { error: 'down' } });
    const failed = await open({ query: '?utm_source=agency', consent: true });
    assert.deepEqual(pick(await read(failed.page, 'plan'), ['variant', 'source', 'outcome', 'text']), {
      variant: 'agency', source: 'rules', outcome: 'fallback', text: 'Agency plan',
    });
    assert.match((await read(failed.page, 'plan')).reason, /500/);
    await failed.close({ allowErrors: true });
    const bare = await open({ consent: true });
    assert.deepEqual(pick(await read(bare.page, 'plan'), ['variant', 'source', 'outcome', 'text']), {
      variant: 'default', source: 'rules', outcome: 'fallback', text: 'Authored plan Authored link',
    });
    await bare.close({ allowErrors: true });
    engine = async (body) => ({ ...(await tableEngine(body)), delay: 1000 });
    const slow = await open({ query: '?utm_campaign=enterprise&utm_source=agency', consent: true, config: { api: { timeout: 300 } } });
    const timedOut = await read(slow.page, 'plan');
    assert.deepEqual(pick(timedOut, ['variant', 'source', 'outcome']), { variant: 'agency', source: 'rules', outcome: 'fallback' });
    assert.match(timedOut.reason, /timed out/);
    await slow.close();
    engine = async (body) => ({ ...(await tableEngine(body)), delay: 2500 });
    const budget = await open({ query: '?utm_campaign=enterprise&utm_source=agency', consent: true, config: { api: { timeout: 5000 } } });
    const late = await read(budget.page, 'plan');
    assert.deepEqual(pick(late, ['variant', 'source', 'outcome', 'text', 'hidden']), {
      variant: 'default', source: 'api', outcome: 'timeout', text: 'Authored plan Authored link', hidden: false,
    }, 'past the budget: the default, no Rule rows');
    const [decided] = await events(budget.page, 'plan');
    assert.equal(decided.personalization.assigned, undefined);
    await budget.close();
  });

  it('shows the default with result failed when the assigned fragment is missing', async () => {
    const { page, close } = await open({ query: '?pzn=plan:missing', consent: true });
    const plan = await read(page, 'plan');
    assert.deepEqual(pick(plan, ['variant', 'source', 'outcome', 'reason', 'text']), {
      variant: 'missing', source: 'override', outcome: 'override', reason: 'fragment failed: /fragments/plan/missing', text: 'Authored plan Authored link',
    });
    const applied = (await events(page, 'plan', 'pzn:applied'))[0].personalization;
    assert.deepEqual(pick(applied, ['variant', 'assigned', 'result']), { variant: 'default', assigned: 'missing', result: 'failed' });
    await close({ allowErrors: true });
  });

  it('answers with the in-browser mock (config.mock) and its knobs', async () => {
    const mock = {
      api: ENGINE_TABLE,
      target: ACTIVITIES,
    };
    const ok = await open({ query: '?utm_campaign=enterprise', consent: true, config: { mock } });
    assert.equal((await read(ok.page, 'plan')).variant, 'enterprise');
    assert.equal((await read(ok.page, 'inline-offer')).variant, 'promo');
    const requests = await ok.page.evaluate(() => window.hlx.personalizationMock.requests.map((r) => r.url));
    assert.equal(engineCalls.length, 0, 'the mock never reaches the network');
    assert.equal(ok.targetCalls.length, 0);
    assert.ok(requests.some((url) => url.endsWith('/decide')) && requests.some((url) => DELIVERY.test(url)));
    await ok.close();
    const failed = await open({ query: '?utm_campaign=enterprise&pzn-mock=fail', consent: true, config: { mock } });
    assert.deepEqual(pick(await read(failed.page, 'plan'), ['variant', 'outcome']), { variant: 'default', outcome: 'fallback' });
    await failed.close({ allowErrors: true });
  });

  // --- Overrides and bots ---

  it('forces any source with ?pzn=, including target without a call', async () => {
    const { page, targetCalls, close } = await open({ query: '?pzn=msg:team,plan:agency,inline-offer:promo,hero:default,offer:welcome-back', consent: true });
    assert.equal((await read(page, 'msg')).text, 'Team');
    assert.deepEqual(pick(await read(page, 'plan'), ['variant', 'source', 'outcome']), { variant: 'agency', source: 'override', outcome: 'override' });
    assert.equal((await read(page, 'inline-offer')).text, 'Inline promo Go');
    assert.deepEqual(pick(await read(page, 'hero'), ['variant', 'source']), { variant: 'default', source: 'override' });
    await page.waitForFunction(() => window.hlx.personalization.decisions.some((row) => row.id === 'offer' && row.popup === 'armed'));
    await scrollTo(page, 1);
    await page.waitForSelector('dialog.target-popup[open]');
    assert.match(await page.textContent('dialog.target-popup'), /Welcome back/);
    assert.equal(targetCalls.length, 0, 'forced offers never call Target');
    assert.equal(engineCalls.length, 0);
    await close();
  });

  it('serves bots the authored content with no calls and no split assignment', async () => {
    const { page, context, targetCalls, close } = await open({ userAgent: BOT, consent: true });
    for (const id of ['hero', 'plan', 'msg', 'pick', 'inline-offer']) {
      // eslint-disable-next-line no-await-in-loop
      const found = await read(page, id);
      assert.deepEqual(pick(found, ['source', 'outcome', 'variant']), { source: 'bot', outcome: 'bot', variant: 'default' }, id);
      assert.match(found.text, /^Authored/);
    }
    assert.ok(!(await stored(page, context)).session.some((key) => key.startsWith('pzn-split')));
    await scrollTo(page, 1);
    await sleep(300);
    assert.equal(await page.$('dialog.target-popup'), null);
    assert.equal(engineCalls.length + targetCalls.length, 0);
    await close();
    const forced = await open({ userAgent: BOT, query: '?pzn=msg:speed' });
    assert.equal((await read(forced.page, 'msg')).text, 'Speed', 'overrides beat the bot check');
    await forced.close();
  });

  // --- Split (section 6) ---

  it('keeps split assignments for the session and honors the weights', async () => {
    const context = await newContext();
    const seen = [];
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const session = await open({ context, consent: true });
      // eslint-disable-next-line no-await-in-loop
      seen.push(await read(session.page, 'msg'));
      // eslint-disable-next-line no-await-in-loop
      assert.equal((await read(session.page, 'pick')).text, 'Y', '0, 100 always picks the second variant');
      // eslint-disable-next-line no-await-in-loop
      const [decided] = await events(session.page, 'msg', 'pzn:decided');
      assert.deepEqual(decided.personalization.test, { type: 'split', weights: 'even' });
      assert.ok(['variant', 'control'].includes(decided.personalization.outcome));
      // eslint-disable-next-line no-await-in-loop
      await session.close();
    }
    assert.equal(new Set(seen.map((msg) => msg.variant)).size, 1, 'sticky within the session');
    assert.equal(seen[0].source, 'split');
    const cookie = (await context.cookies()).find((item) => item.name === 'pzn-split');
    assert.match(decodeURIComponent(cookie.value), /msg:(speed|team|default)/);
    assert.equal(cookie.expires, -1, 'a session cookie');
    await context.close();
  });

  // --- Consent exceptions (section 3) ---

  it('applies each approved exception without consent, and none without a policyRef', async () => {
    const policy = (withoutConsent, policyRef = 'LEGAL-42') => ({
      consent: {
        mode: 'cmp', tool: 'custom', withoutConsent, ...(policyRef ? { policyRef } : {}),
      },
    });
    // rules: Rule rows decide on request data; an api section's Rule rows too.
    const rules = await open({ query: '?pzn-geo=IN&utm_source=agency', consent: false, config: policy(['rules']) });
    assert.deepEqual(pick(await read(rules.page, 'hero'), ['variant', 'source', 'outcome']), { variant: 'india', source: 'rules', outcome: 'variant' });
    assert.deepEqual(pick(await read(rules.page, 'plan'), ['variant', 'source', 'outcome']), { variant: 'agency', source: 'rules', outcome: 'no-consent' });
    assert.equal((await read(rules.page, 'msg')).outcome, 'no-consent');
    assert.equal(engineCalls.length, 0);
    assert.deepEqual(await events(rules.page), []);
    assert.deepEqual(await stored(rules.page, rules.context), { cookies: [], local: [], session: [] });
    await rules.close();
    // split: assigned for the session.
    const split = await open({ consent: false, config: policy(['split']) });
    assert.equal((await read(split.page, 'pick')).variant, 'y');
    assert.equal((await read(split.page, 'hero')).outcome, 'no-consent');
    const kept = await stored(split.page, split.context);
    assert.deepEqual(kept.cookies, ['pzn-split']);
    assert.deepEqual(kept.session, ['pzn-split:msg', 'pzn-split:pick']);
    assert.deepEqual(kept.local, []);
    await split.close();
    // api: the engine decides with request data only, nothing cached.
    const api = await open({ query: '?utm_campaign=enterprise', consent: false, config: { ...policy(['api']), api: { endpoint: '/decide' } } });
    assert.deepEqual(pick(await read(api.page, 'plan'), ['variant', 'source', 'outcome']), { variant: 'enterprise', source: 'api', outcome: 'variant' });
    assert.equal(engineCalls.length, 1);
    assert.deepEqual(engineCalls[0].context.consent, { personalization: false });
    assert.equal(engineCalls[0].context.visitor, undefined);
    assert.equal(api.targetCalls.length, 0, 'Target never runs through an exception');
    assert.equal((await read(api.page, 'inline-offer')).outcome, 'no-consent');
    assert.deepEqual(await stored(api.page, api.context), { cookies: [], local: [], session: [] });
    await api.close();
    // rum: checkpoints only.
    const rum = await open({ query: '?pzn-geo=IN', consent: false, config: policy(['rules', 'rum']) });
    const checkpoints = await rum.page.evaluate(() => window.testRum || []);
    assert.ok(checkpoints.some((entry) => entry.checkpoint === 'audience' && entry.source === 'hero'));
    assert.deepEqual(await events(rum.page), []);
    await rum.close();
    // data-layer: measurement events, valid, without consent.
    const layer = await open({ consent: false, config: policy(['data-layer']) });
    const sent = await events(layer.page, 'hero');
    assert.deepEqual(sent.map((item) => item.event).slice(0, 2), ['pzn:decided', 'pzn:applied']);
    assert.equal(sent[0].personalization.outcome, 'no-consent');
    assert.ok(await layer.page.evaluate(() => window.adobeDataLayer.length > 0));
    await layer.close();
    // No policyRef: no exception.
    const unrecorded = await open({ query: '?pzn-geo=IN', consent: false, config: policy(['rules'], '') });
    assert.equal((await read(unrecorded.page, 'hero')).outcome, 'no-consent');
    await unrecorded.close();
  });

  // --- Consent changes ---

  it('decides no-consent sections again when consent is given (preview hook)', async () => {
    const { page, context, targetCalls, close } = await open({ query: '?utm_campaign=enterprise' });
    assert.equal((await read(page, 'plan')).outcome, 'no-consent');
    await page.evaluate(() => window.hlx.personalization.preview.consent(true));
    await waitDecision(page, 'plan', 'plan#2');
    await settled(page);
    for (const id of ['hero', 'plan', 'msg', 'pick', 'inline-offer']) {
      // eslint-disable-next-line no-await-in-loop
      assert.equal((await read(page, id)).decision, `${id}#2`, id);
    }
    assert.deepEqual(pick(await read(page, 'plan'), ['variant', 'outcome']), { variant: 'enterprise', outcome: 'variant' });
    assert.equal((await read(page, 'inline-offer')).variant, 'promo');
    const decided = await events(page, undefined, 'pzn:decided');
    assert.deepEqual(decided.map((item) => item.personalization.decisionId).sort(), ['hero#2', 'inline-offer#2', 'msg#2', 'offer#2', 'pick#2', 'plan#2']);
    assert.ok(decided.every((item) => item.personalization.trigger === 'consent'));
    await page.waitForFunction(() => window.hlx.personalization.decisions.some((row) => row.id === 'offer' && row.popup === 'armed'));
    assert.equal(engineCalls.length, 1);
    assert.equal(targetCalls.filter((call) => call.body.prefetch).length, 1);
    assert.equal((await context.cookies()).find((cookie) => cookie.name === 'pzn-consent')?.value, '1');
    await close();
  });

  it('decides again on a consent.update event from the consent glue', async () => {
    const { page, close } = await open({ query: '?utm_source=agency' });
    await page.evaluate(() => {
      window.testConsent = true;
      window.dispatchEvent(new CustomEvent('consent.update'));
    });
    await waitDecision(page, 'plan', 'plan#2');
    assert.deepEqual(pick(await read(page, 'plan'), ['variant', 'source']), { variant: 'agency', source: 'rules' });
    await page.waitForFunction(() => window.hlx.personalization.decisions.some((row) => row.id === 'offer' && row.popup === 'armed'));
    await close();
  });

  it('restores every default when consent is withdrawn, clears storage and sends nothing more', async () => {
    const session = await open({ query: '?pzn-geo=IN&utm_campaign=enterprise', consent: true });
    const { page, context } = session;
    await page.evaluate(() => window.hlx.personalization.setState('persona', 'b'));
    await page.waitForFunction(() => window.hlx.personalization.decisions.some((row) => row.id === 'offer' && row.popup === 'armed'));
    const kept = await stored(page, context);
    assert.deepEqual(kept.cookies, ['pzn-consent', 'pzn-seen', 'pzn-split', 'pzn-vs']);
    assert.deepEqual(kept.local, ['pzn-state', 'pzn-tnt-id']);
    assert.ok(kept.session.includes('pzn-split:msg'));
    assert.equal((await read(page, 'plan')).variant, 'enterprise');
    const sent = (await events(page)).length;
    const ids = ['hero', 'plan', 'msg', 'pick', 'inline-offer'];
    const numbers = Object.fromEntries(await Promise.all(ids
      .map(async (id) => [id, Number((await read(page, id)).decision.split('#')[1])])));
    assert.equal(numbers.plan, 2, 'setState re-decides api sections with consent');
    await page.evaluate(async () => {
      window.testConsent = false;
      await window.hlx.personalization.refresh();
    });
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const found = await read(page, id);
      assert.deepEqual(pick(found, ['variant', 'outcome', 'decision', 'status']), {
        variant: 'default', outcome: 'no-consent', decision: `${id}#${numbers[id] + 1}`, status: 'applied',
      }, id);
      assert.match(found.text, /^Authored/, id);
    }
    assert.equal((await lastRow(page, 'offer')).popup, 'waiting for consent');
    assert.deepEqual(await stored(page, context), { cookies: [], local: [], session: [] });
    await intoView(page, 'plan');
    await clickIn(page, '[data-personalization="plan"]');
    await sleep(300);
    assert.equal((await events(page)).length, sent, 'nothing sent after withdrawal');
    await scrollTo(page, 1);
    await sleep(300);
    assert.equal(await page.$('dialog.target-popup'), null, 'no offer after withdrawal');
    await session.close();
  });

  // --- Re-evaluation and exposure (section 9) ---

  it('re-evaluates on refresh(): same decision sends nothing, a new payload a new decision', async () => {
    let answer = { variant: 'enterprise', tracking: { engine: 'e', run: 'r1' } };
    engine = async () => ({ body: { decisions: { plan: answer }, ttl: 0 } });
    const { page, close } = await open({ consent: true });
    await intoView(page, 'plan');
    await waitEvent(page, 'plan', 'pzn:seen', 'plan#1');
    const count = async (ids) => (await events(page)).filter((item) => ids.includes(item.personalization.id)).length;
    const steady = ['plan', 'hero', 'msg', 'pick'];
    const initial = await count(steady);
    await page.evaluate(() => { document.querySelector('[data-personalization="plan"] h2').marked = true; });
    await page.evaluate(() => window.hlx.personalization.refresh());
    await sleep(600);
    assert.equal(await count(steady), initial, 'identical answers send nothing');
    assert.equal((await read(page, 'plan')).decision, 'plan#1');

    answer = { variant: 'enterprise', tracking: { engine: 'e', run: 'r2' } };
    const mark = (await events(page, 'plan')).length;
    await page.evaluate(() => window.hlx.personalization.refresh());
    await waitEvent(page, 'plan', 'pzn:seen', 'plan#2');
    const second = (await events(page, 'plan')).slice(mark).filter((item) => item.event !== 'pzn:notified');
    assert.deepEqual(second.map((item) => `${item.event} ${item.personalization.decisionId}`), ['pzn:decided plan#2', 'pzn:applied plan#2', 'pzn:seen plan#2']);
    assert.equal(second[0].personalization.trigger, 'refresh');
    assert.equal(second[1].personalization.result, 'unchanged');
    assert.equal(second[2].personalization.tracking.run, 'r2');
    assert.ok(await page.evaluate(() => document.querySelector('[data-personalization="plan"] h2').marked), 'content not swapped again');

    answer = { variant: 'agency', tracking: { engine: 'e', run: 'r3' } };
    await page.evaluate(() => window.hlx.personalization.refresh());
    await waitDecision(page, 'plan', 'plan#3');
    assert.equal((await read(page, 'plan')).text, 'Agency plan');
    assert.equal((await events(page, 'plan', 'pzn:applied')).at(-1).personalization.result, 'applied');

    answer = { variant: 'default', tracking: { engine: 'e', run: 'r4' } };
    await page.evaluate(() => window.hlx.personalization.refresh());
    await waitDecision(page, 'plan', 'plan#4');
    assert.deepEqual(pick(await read(page, 'plan'), ['outcome', 'text']), { outcome: 'intentional-default', text: 'Authored plan Authored link' });
    assert.equal((await events(page, 'plan', 'pzn:applied')).at(-1).personalization.result, 'kept-default');
    await close();
  });

  it('sends seen past the visibility threshold and seen and clicked once per decision', async () => {
    const { page, close } = await open({ query: '?utm_campaign=enterprise', consent: true });
    assert.deepEqual(await events(page, 'plan', 'pzn:seen'), [], 'below the fold: not seen');
    // About 20% of the 400px section in view: under the 0.5 threshold.
    await page.evaluate(async () => {
      const el = document.querySelector('[data-personalization="plan"]');
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - window.innerHeight + el.offsetHeight * 0.2);
      await new Promise((done) => { setTimeout(done, 400); });
    });
    assert.deepEqual(await events(page, 'plan', 'pzn:seen'), [], 'under the threshold');
    await intoView(page, 'plan');
    await waitEvent(page, 'plan', 'pzn:seen', 'plan#1');
    await preferNoMotion(page);
    await intoView(page, 'plan');
    await clickIn(page, '[data-personalization="plan"]');
    await clickIn(page, '[data-personalization="plan"]');
    await sleep(300);
    assert.equal((await events(page, 'plan', 'pzn:seen')).length, 1);
    const clicked = await events(page, 'plan', 'pzn:clicked');
    assert.equal(clicked.length, 1);
    assert.equal(clicked[0].personalization.href, `${base}/contact`, 'the link without its query');
    assert.equal(clicked[0].personalization.result, 'applied');
    await close();
  });

  it('sends engine feedback once per decision, with consent only', async () => {
    const config = { api: { feedback: '/feedback' } };
    const { page, close } = await open({ query: '?utm_campaign=enterprise', consent: true, config });
    await intoView(page, 'plan');
    await clickIn(page, '[data-personalization="plan"]');
    await waitEvent(page, 'plan', 'pzn:notified');
    await sleep(500);
    await intoView(page, 'hero');
    await clickIn(page, '[data-personalization="plan"]');
    await sleep(500);
    const sentEvents = beacons.flatMap((body) => body.events);
    beacons.forEach((body) => assert.deepEqual(check('decision-feedback', body), []));
    assert.deepEqual(sentEvents.map((item) => `${item.decisionId} ${item.type} ${item.variant}`).sort(), ['plan#1 clicked enterprise', 'plan#1 seen enterprise']);
    assert.equal(sentEvents[0].tracking.engine, 'mock');
    const notes = (await notified(page, 'plan')).map((item) => item.personalization.notification);
    assert.deepEqual(notes.map((note) => `${note.product} ${note.type} ${note.ok}`).sort(), ['api clicked true', 'api seen true']);
    await close();
    beacons = [];
    const exception = await open({
      query: '?utm_campaign=enterprise',
      consent: false,
      config: {
        ...config, consent: { mode: 'cmp', tool: 'custom', withoutConsent: ['api'], policyRef: 'LEGAL-42' },
      },
    });
    await intoView(exception.page, 'plan');
    await sleep(500);
    assert.equal((await read(exception.page, 'plan')).variant, 'enterprise');
    assert.deepEqual(beacons, [], 'no feedback without consent');
    await exception.close();
  });

  // --- Edge handoff (section 8) ---

  it('measures edge decisions without deciding them again and loads selected variants', async () => {
    const { page, close } = await open({ path: '/edge.html', consent: true });
    const edged = await read(page, 'edged');
    assert.deepEqual(pick(edged, ['where', 'status', 'variant', 'source', 'outcome', 'decision', 'text']), {
      where: 'edge', status: 'applied', variant: 'x', source: 'rules', outcome: 'variant', decision: 'edged#1', text: 'Edge X',
    });
    assert.equal(await page.$('template[data-pzn-default]'), null, 'the default template is taken out of the page');
    const sel = await read(page, 'sel');
    assert.deepEqual(pick(sel, ['where', 'status', 'variant', 'source', 'decision', 'cached', 'text']), {
      where: 'edge', status: 'selected', variant: 'b', source: 'api', decision: 'sel#1', cached: 'true', text: 'Sel B B',
    });
    assert.deepEqual(engineCalls.map((call) => call.placeholders.map((item) => item.id)), [['later']], 'only the section left to the browser');
    assert.equal((await read(page, 'later')).where, 'browser');
    const [decided, applied] = await events(page, 'sel');
    assert.ok(holds({
      decisionId: 'sel#1', where: 'edge', source: 'api', outcome: 'variant', assigned: 'b', cached: true, tracking: { engine: 'of1', requestId: 'r-7' }, trigger: 'initial',
    }, decided.personalization));
    assert.ok(holds({ decisionId: 'sel#1', where: 'edge', result: 'applied' }, applied.personalization));
    const edgedEvents = await events(page, 'edged');
    assert.ok(holds({ decisionId: 'edged#1', where: 'edge', result: 'applied' }, edgedEvents[1].personalization));
    await waitEvent(page, 'sel', 'pzn:seen', 'sel#1');
    assert.equal((await events(page, 'sel', 'pzn:seen'))[0].personalization.tracking.requestId, 'r-7');
    const count = (await events(page)).filter((item) => ['edged', 'sel'].includes(item.personalization.id)).length;
    await page.evaluate(() => window.hlx.personalization.refresh());
    await sleep(500);
    assert.equal((await events(page)).filter((item) => ['edged', 'sel'].includes(item.personalization.id)).length, count, 'edge decisions are final');
    await close();
  });

  it('restores edge sections to their default on withdrawal, from the template', async () => {
    const { page, context, close } = await open({ path: '/edge.html', consent: true });
    await page.evaluate(() => window.hlx.personalization.preview.consent(false));
    await waitDecision(page, 'edged', 'edged#2');
    const edged = await read(page, 'edged');
    assert.deepEqual(pick(edged, ['where', 'status', 'variant', 'outcome', 'text']), {
      where: 'edge', status: 'applied', variant: 'default', outcome: 'no-consent', text: 'Authored edged more',
    });
    assert.equal(await page.getAttribute('[data-personalization="edged"] a', 'data-decorated'), 'true', 'the restored default is decorated');
    assert.deepEqual(pick(await read(page, 'sel'), ['where', 'variant', 'outcome', 'decision', 'text']), {
      where: 'edge', variant: 'default', outcome: 'no-consent', decision: 'sel#2', text: 'Authored sel',
    });
    assert.deepEqual(await stored(page, context), { cookies: [], local: [], session: [] });
    await close();
  });

  // --- Target (section 7) ---

  it('renders inline Target offers and notifies display once seen and click on click', async () => {
    const { page, targetCalls, close } = await open({ consent: true });
    const inline = await read(page, 'inline-offer');
    assert.deepEqual(pick(inline, ['variant', 'source', 'outcome', 'text']), {
      variant: 'promo', source: 'target', outcome: 'variant', text: 'Inline promo Go',
    });
    const prefetch = targetCalls.filter((call) => call.body.prefetch);
    assert.equal(prefetch.length, 1, 'one prefetch for the page');
    assert.deepEqual(prefetch[0].body.prefetch.mboxes.map((mbox) => mbox.name).sort(), ['inline-offer', 'offer']);
    assert.match(prefetch[0].url, /^https:\/\/acme\.tt\.omtrdc\.net\/rest\/v1\/delivery\?client=acme&sessionId=/);
    assert.deepEqual(await notified(page, 'inline-offer'), [], 'prefetch is not a display');
    await intoView(page, 'inline-offer');
    await waitEvent(page, 'inline-offer', 'pzn:notified');
    await clickIn(page, '[data-personalization="inline-offer"]');
    await page.waitForFunction(() => window.testEvents.filter((item) => item.event === 'pzn:notified' && item.personalization.id === 'inline-offer').length === 2);
    await intoView(page, 'hero');
    await intoView(page, 'inline-offer');
    await clickIn(page, '[data-personalization="inline-offer"]');
    await sleep(500);
    const notes = (await notified(page, 'inline-offer')).map((item) => item.personalization.notification);
    assert.deepEqual(notes, [{ product: 'target', type: 'display', ok: true }, { product: 'target', type: 'click', ok: true }]);
    const sent = targetCalls.filter((call) => call.body.notifications).map((call) => call.body.notifications[0]);
    assert.deepEqual(sent.map((note) => `${note.type} ${note.mbox.name}`), ['display inline-offer', 'click inline-offer']);
    assert.ok(sent.every((note) => note.tokens.length > 0));
    await close();
  });

  it('keeps the default for a Target control, notifies its display, and reports unconfirmed notifications', async () => {
    const target = async (body) => {
      const answer = await targetAnswer(ACTIVITIES, body, { clientCode: 'acme' });
      // A Target that does not echo the notification ids.
      return body.notifications ? { status: 200, body: { ...answer.body, notifications: [] } } : answer;
    };
    const { page, close } = await open({ query: '?utm_campaign=control', consent: true, target });
    const inline = await read(page, 'inline-offer');
    assert.deepEqual(pick(inline, ['variant', 'source', 'outcome', 'text']), {
      variant: 'default', source: 'target', outcome: 'control', text: 'Authored inline offer',
    });
    const [decided, applied] = await events(page, 'inline-offer');
    assert.equal(decided.personalization.assigned, 'default');
    assert.equal(applied.personalization.result, 'kept-default');
    await intoView(page, 'inline-offer');
    await waitEvent(page, 'inline-offer', 'pzn:notified');
    assert.deepEqual((await notified(page, 'inline-offer')).map((item) => item.personalization.notification), [
      { product: 'target', type: 'display', ok: false },
    ]);
    await close();
  });

  it('opens a Target popup past its scroll trigger, once per decision, with notifications', async () => {
    const { page, targetCalls, close } = await open({ query: '?pzn-visitor=returning', consent: true });
    await page.waitForFunction(() => window.hlx.personalization.decisions.some((row) => row.id === 'offer' && row.popup === 'armed'));
    assert.deepEqual(pick(await read(page, 'offer'), ['variant', 'source', 'outcome', 'text']), {
      variant: 'welcome-back', source: 'target', outcome: 'variant', text: 'Authored offer section',
    }, 'the section keeps its default; the offer waits for the trigger');
    assert.equal(targetCalls[0].body.prefetch.mboxes.find((mbox) => mbox.name === 'offer').parameters.visitor, 'returning');
    await scrollTo(page, 0.5);
    assert.equal(await page.$('dialog.target-popup'), null, 'no popup at 50%');
    assert.deepEqual(await events(page, 'offer', 'pzn:seen'), []);
    await scrollTo(page, 0.75);
    await page.waitForSelector('dialog.target-popup[open]');
    const dialog = await page.evaluate(() => {
      const el = document.querySelector('dialog.target-popup');
      const label = document.getElementById(el.getAttribute('aria-labelledby'));
      return { modal: el.matches(':modal'), label: label?.textContent };
    });
    assert.deepEqual(dialog, { modal: true, label: 'Welcome back' });
    await waitEvent(page, 'offer', 'pzn:seen', 'offer#1');
    await waitEvent(page, 'offer', 'pzn:notified');
    await clickIn(page, 'dialog.target-popup');
    await page.waitForFunction(() => window.testEvents.filter((item) => item.event === 'pzn:notified' && item.personalization.id === 'offer').length === 2);
    assert.equal((await events(page, 'offer', 'pzn:clicked'))[0].personalization.href, `${base}/plans`);
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog.target-popup', { state: 'detached' });
    await scrollTo(page, 0);
    await scrollTo(page, 1);
    await sleep(300);
    assert.equal(await page.$('dialog.target-popup'), null, 'once per decision');
    assert.equal((await lastRow(page, 'offer')).popup, 'closed');
    const notes = (await notified(page, 'offer')).map((item) => item.personalization.notification.type);
    assert.deepEqual(notes, ['display', 'click']);
    await close();
  });

  it('keeps a popup waiting for consent, then arms it', async () => {
    const { page, targetCalls, close } = await open();
    assert.equal((await lastRow(page, 'offer')).popup, 'waiting for consent');
    await scrollTo(page, 1);
    await sleep(300);
    assert.equal(await page.$('dialog.target-popup'), null);
    assert.equal(targetCalls.length, 0);
    await page.evaluate(() => window.hlx.personalization.preview.consent(true));
    await page.waitForFunction(() => window.hlx.personalization.decisions.some((row) => row.id === 'offer' && row.popup === 'armed' && row.decisionId === 'offer#2'));
    await scrollTo(page, 0.3);
    await scrollTo(page, 1);
    await page.waitForSelector('dialog.target-popup[open]');
    assert.match(await page.textContent('dialog.target-popup'), /Free trial/);
    await close();
  });

  // --- Pilot scenarios (contract pilot/scenarios.json) ---

  describe('pilot scenarios', () => {
    const examples = {};
    before(async () => {
      examples.hero = JSON.parse(await readFile(join(EXAMPLES, 'api-of1-hint.json'), 'utf8'));
      examples.promo = JSON.parse(await readFile(join(EXAMPLES, 'api-with-fallback-rules.json'), 'utf8'));
    });
    const pilotConfig = { api: { engine: 'of1' } };
    // As the pipeline delivers it: the edge runs over it, then the runtime is added.
    const heroSource = () => `<!DOCTYPE html><html lang="en"><head><title>Pilot</title></head><body><main>${[
      section(sectionRows(examples.hero), '<h1>Authored hero</h1><p><a href="https://www.example.com/espresso">Espresso</a></p>'),
      spacer,
    ].join('')}</main></body></html>`;
    const promoSource = () => pageHtml([
      section({}, '<h1>Plain first section</h1>'),
      section(sectionRows(examples.promo), '<h2>Authored promo</h2>'),
      spacer,
    ]);

    // Runs each step and compares the attributes and the events, in order.
    async function replay(scenario) {
      const id = scenario.section || PILOT.section.id;
      const { context: given } = scenario;
      const params = new URLSearchParams(given.params);
      const referer = `https://${given.referrer}/`;
      const [first] = scenario.steps;
      const path = `/pilot-${scenario.id}.html`;
      if (id === 'home-hero') {
        const edge = await simulateEdge(heroSource(), {
          url: `${base}/?${params}`,
          country: given.geo.country,
          region: given.geo.region,
          consent: true,
          referer,
          engineName: 'of1',
          apiEndpoint: 'https://engine.invalid/decide',
          origin: base,
          fetchImpl: async () => new Response(JSON.stringify(first.answer), { headers: { 'content-type': 'application/json' } }),
        });
        pages[path] = withRuntime(edge.html);
      } else {
        pages[path] = promoSource();
      }
      let { answer } = first;
      engine = async () => ({ body: answer });
      params.set('pzn-geo', `${given.geo.country}-${given.geo.region}`);
      const session = await open({
        path, query: `?${params}`, consent: true, config: pilotConfig, referer,
      });
      const { page, context } = session;
      const problems = [];
      for (const [index, step] of scenario.steps.entries()) {
        /* eslint-disable no-await-in-loop */
        const mark = index ? (await events(page, id)).length : 0;
        if (/^refresh/.test(step.step)) {
          if (JSON.stringify(step.answer) !== JSON.stringify(answer)) {
            // A new upstream answer: the session cache has expired.
            await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith('pzn-decisions:'))
              .forEach((key) => sessionStorage.removeItem(key)));
          }
          answer = step.answer;
          await page.evaluate(() => window.hlx.personalization.refresh());
        } else if (/consent withdrawn/.test(step.step)) {
          await page.evaluate(async () => {
            window.testConsent = false;
            await window.hlx.personalization.refresh();
          });
        }
        await waitDecision(page, id, step.attributes['data-pzn-decision']).catch(() => {});
        await intoView(page, id);
        if (step.events.some((item) => item.event === 'pzn:clicked')) await clickIn(page, `[data-personalization="${id}"]`);
        await sleep(400);
        const attrs = await page.evaluate((sectionId) => {
          const el = document.querySelector(`[data-personalization="${sectionId}"]`);
          return Object.fromEntries(el.getAttributeNames().filter((name) => name.startsWith('data-pzn-')).map((name) => [name, el.getAttribute(name)]));
        }, id);
        Object.entries(step.attributes).forEach(([name, value]) => {
          if (attrs[name] !== value) problems.push(`${step.step}: ${name}="${attrs[name]}", expected "${value}"`);
        });
        const got = (await events(page, id)).slice(mark).filter((item) => item.event !== 'pzn:notified');
        if (got.length !== step.events.length) {
          problems.push(`${step.step}: events [${got.map((item) => `${item.event} ${item.personalization.decisionId}`)}], expected [${step.events.map((item) => `${item.event} ${item.personalization.decisionId}`)}]`);
        }
        step.events.forEach((expected, i) => {
          if (got[i] && !holds(expected, got[i])) {
            problems.push(`${step.step}: event ${i + 1} ${JSON.stringify(got[i])} does not hold ${JSON.stringify(expected)}`);
          }
        });
        if (/consent withdrawn/.test(step.step)) {
          const kept = await stored(page, context);
          if ([...kept.cookies, ...kept.local, ...kept.session].length) problems.push(`${step.step}: still stored ${JSON.stringify(kept)}`);
          if (!/Authored hero/.test((await read(page, id)).text)) problems.push(`${step.step}: the authored hero is not restored`);
          await clickIn(page, `[data-personalization="${id}"]`);
          await sleep(200);
          if ((await events(page, id)).length !== mark) problems.push(`${step.step}: a click after withdrawal sent an event`);
        }
        /* eslint-enable no-await-in-loop */
      }
      const decideCalls = engineCalls.length;
      await session.close();
      return { problems, decideCalls };
    }

    PILOT.scenarios.forEach((scenario) => {
      it(`${scenario.id} (${scenario.pilot})`, async () => {
        const { problems, decideCalls } = await replay(scenario);
        assert.deepEqual(problems, []);
        if (!scenario.section) assert.equal(decideCalls, 0, 'the edge decided: no browser engine call');
      });
    });
  });
});
