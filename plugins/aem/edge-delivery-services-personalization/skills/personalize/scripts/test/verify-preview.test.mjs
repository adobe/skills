import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { join } from 'node:path';
import {
  after, before, describe, it,
} from 'node:test';
import { installRuntime } from '../install-runtime.mjs';
import { ASSETS_DIR, importAsset, loadPlaywright } from '../lib.mjs';
import { createMockServer } from '../mock-decision-api.mjs';
import { buildCases, simulateEdge } from '../simulate.mjs';
import { readSiteConfig } from '../validate-placeholders.mjs';
import {
  compareEvents, eventProblems, faultAnswer, matches, plainUrl, splitConsoleErrors, verify, withQuery,
} from '../verify-preview.mjs';
import { runHelp, tempDir } from './helpers.mjs';

const { renderSectionMetadata } = await importAsset('edge', 'cloudflare', 'src', 'personalization', 'html.js');

describe('plainUrl and withQuery', () => {
  it('maps a preview page to its .plain.html, dropping the query', () => {
    assert.equal(plainUrl('http://localhost:3000/offer?pzn=offer:india'), 'http://localhost:3000/offer.plain.html');
    assert.equal(plainUrl('https://main--site--org.aem.page/'), 'https://main--site--org.aem.page/index.plain.html');
    assert.equal(plainUrl('http://localhost:3000/en/'), 'http://localhost:3000/en/index.plain.html');
  });

  it('adds a case query to a page URL, replacing what is there', () => {
    assert.equal(withQuery('http://localhost:3000/p?a=1&pzn-consent=0', 'pzn-consent=1&pzn-geo=IN'), 'http://localhost:3000/p?a=1&pzn-consent=1&pzn-geo=IN');
    assert.equal(withQuery('http://localhost:3000/p', ''), 'http://localhost:3000/p');
  });
});

describe('faultAnswer', () => {
  const body = { placeholders: [{ id: 'plan' }], context: {} };
  it('answers engine faults as the mock engine does', async () => {
    assert.equal((await faultAnswer('engine', 'fail', body)).status, 500);
    assert.equal((await faultAnswer('engine', 'reason:low_confidence', body)).body.decisions.plan.reason, 'low_confidence');
    assert.equal((await faultAnswer('engine', 'control', body)).body.decisions.plan.control, true);
    assert.deepEqual((await faultAnswer('engine', 'missing', body)).body.decisions, {});
    const slow = await faultAnswer('engine', 'slow', body);
    assert.ok(slow.delay > 1500, 'slower than api.timeout');
  });

  it('answers Target faults', async () => {
    const prefetch = { prefetch: { mboxes: [{ index: 0, name: 'offer' }] } };
    assert.equal((await faultAnswer('target', 'fail', prefetch)).status, 500);
    assert.deepEqual((await faultAnswer('target', 'control', prefetch)).body.prefetch.mboxes[0].options[0].content, { control: true });
    assert.equal((await faultAnswer('target', 'missing', prefetch)).body.prefetch.mboxes[0].options, undefined);
  });
});

const event = (name, fields) => ({
  event: name,
  personalization: {
    id: 'hero', decisionId: 'hero#1', variant: 'india', source: 'rules', where: 'browser', outcome: 'variant', assigned: 'india', ...fields,
  },
});

describe('eventProblems', () => {
  it('accepts one decided, applied and seen per decision', () => {
    const events = [event('pzn:decided', { trigger: 'initial' }), event('pzn:applied', { result: 'applied' }), event('pzn:seen', { result: 'applied' })];
    assert.deepEqual(eventProblems(events), []);
  });

  it('flags duplicates, events without pzn:decided and schema or semantic errors', () => {
    const problems = eventProblems([
      event('pzn:decided', { trigger: 'initial' }),
      event('pzn:applied', { result: 'applied' }),
      event('pzn:applied', { result: 'applied' }),
      event('pzn:seen', { decisionId: 'hero#2', result: 'applied' }),
      event('pzn:decided', { decisionId: 'hero#3', outcome: 'bot', source: 'bot', trigger: 'initial' }),
    ]).join('\n');
    assert.match(problems, /hero#1 pzn:applied sent 2 times/);
    assert.match(problems, /pzn:seen for hero#2 without pzn:decided/);
    assert.match(problems, /outcome "bot" has assigned/);
  });
});

describe('matches and compareEvents', () => {
  it('compares expected fields recursively and href by path', () => {
    assert.equal(matches({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2, d: 3 }, e: 4 }), true);
    assert.equal(matches({ a: 1 }, { a: 2 }), false);
    assert.equal(matches({ href: 'https://www.example.com/espresso' }, { href: 'http://localhost:3000/espresso' }), true);
    assert.equal(matches({ href: '/a' }, { href: '/b' }), false);
  });

  it('compares a step\'s events in order, ignoring Target notifications unless expected', () => {
    const decided = event('pzn:decided', { trigger: 'initial' });
    const applied = event('pzn:applied', { result: 'applied' });
    const notified = { event: 'pzn:notified', personalization: { id: 'hero', decisionId: 'hero#1' } };
    assert.deepEqual(compareEvents([decided, applied], [decided, notified, applied]), []);
    assert.match(compareEvents([decided, applied], [decided]).join(), /1 event\(s\).*expected 2/);
    assert.match(compareEvents([applied], [event('pzn:applied', { result: 'unchanged' })]).join(), /result "unchanged" \(expected "applied"\)/);
    assert.match(compareEvents([applied], [decided]).join(), /expected pzn:applied/);
  });
});

describe('splitConsoleErrors', () => {
  const nav = 'Failed to load resource: 404 (http://localhost:3000/nav.plain.html)';
  const variant = 'Failed to load resource: 404 (http://localhost:3000/fragments/personalization/hero/india.plain.html)';
  const run = (query, errors) => ({
    query, errors, problems: [], ok: true,
  });

  it('reports errors the no-consent run also has as pre-existing, not failures', () => {
    const { results, preExisting } = splitConsoleErrors([run('pzn-consent=0', [nav]), run('pzn-consent=1&pzn-geo=IN', [nav])]);
    assert.ok(results.every((result) => result.ok));
    assert.deepEqual(preExisting, [nav]);
  });

  it('fails errors a case introduced, and personalization errors even on the reference run', () => {
    const { results, preExisting } = splitConsoleErrors([run('pzn-consent=0', [variant]), run('pzn-geo=IN', ['boom', variant])]);
    assert.equal(results[0].ok, false);
    assert.match(results[1].problems[0], /boom/);
    assert.deepEqual(preExisting, []);
  });

  it('treats baseline errors as pre-existing', () => {
    const { results, preExisting } = splitConsoleErrors([run('pzn-geo=IN', [nav])], [nav]);
    assert.equal(results[0].ok, true);
    assert.deepEqual(preExisting, [nav]);
  });
});

describe('verify-preview.mjs --help', () => {
  it('prints the usage, exits 0 and writes nothing', () => {
    const { status, stdout, wrote } = runHelp('verify-preview.mjs');
    assert.equal(status, 0);
    assert.match(stdout, /^Usage/);
    assert.match(stdout, /--consent-flow/);
    assert.deepEqual(wrote, []);
  });
});

/*
 * End to end: install-runtime --apply-hook into a boilerplate-shaped site,
 * pages rendered the way the pipeline renders Section Metadata, then
 * simulate's cases through verify(), once with the in-browser mocks
 * (config.mock) and once with same-origin engine and Target routes served by
 * the mock server. Needs Playwright Chromium; the full run (faults, refresh,
 * consent flow, splits, both modes) only with PZN_E2E=1.
 */
const F = '/fragments/pzn';
const metadata = (rows) => `<div class="section-metadata">${rows.map(([key, value]) => `<div><div><p>${key}</p></div><div>${value}</div></div>`).join('')}</div>`;
const links = (...paths) => paths.map((path) => `<p><a href="${path}">${path}</a></p>`).join('');
const spacer = '<div><p>Spacer</p><div class="spacer"></div></div>';
const SOURCE = `<body><header></header><main>
  <div><h1>Welcome</h1><p>Intro</p></div>
  <div><h2>Authored hero</h2>${metadata([['Personalization', 'hero'], ['Personalization Variants', links(`${F}/hero/india`)], ['Personalization Rule India', 'geo: IN']])}</div>
  <div><h2>Authored plan</h2><p><a href="/plans">Plans</a></p>${metadata([['Personalization', 'plan'], ['Personalization Source', 'api'], ['Personalization Variants', links(`${F}/plan/enterprise`, `${F}/plan/mobile`)], ['Personalization Rule Mobile', 'device: mobile']])}</div>
  <div><h2>Authored message</h2>${metadata([['Personalization', 'msg'], ['Personalization Source', 'split'], ['Personalization Variants', links(`${F}/msg/speed`, `${F}/msg/team`)]])}</div>
  <div><h2>Authored banner</h2>${metadata([['Personalization', 'banner'], ['Personalization Source', 'target'], ['Personalization Variants', links(`${F}/banner/sale`)]])}</div>
  ${spacer}${spacer}
  <div><h2>Authored offer</h2>${metadata([['Personalization', 'offer'], ['Personalization Source', 'target'], ['Personalization Display', 'popup'], ['Personalization Trigger', 'scroll: 70%'], ['Personalization Variants', links(`${F}/offer/free-trial`, `${F}/offer/welcome-back`)]])}</div>
  ${spacer}${spacer}
</main><footer></footer></body>`;
const FRAGMENTS = {
  'pzn/hero/india': '<h2>Namaste</h2>',
  'pzn/plan/enterprise': '<h2>Enterprise plan</h2><p><a href="/enterprise">Talk to sales</a></p>',
  'pzn/plan/mobile': '<h2>Mobile plan</h2>',
  'pzn/msg/speed': '<h2>Speed</h2>',
  'pzn/msg/team': '<h2>Team</h2>',
  'pzn/banner/sale': '<h2>Sale</h2><p><a href="/sale">Shop</a></p>',
  'pzn/offer/free-trial': '<h2>Free trial</h2><p><a href="/trial">Start</a></p>',
  'pzn/offer/welcome-back': '<h2>Welcome back</h2>',
};
// The pilot page (contract pilot.md): the OF1 hero, decided at the edge, and
// a lower promo decided in the browser.
const P = '/fragments/personalization';
const PILOT = `<body><header></header><main>
  <div><h1>Espresso machines</h1><p><a href="/espresso">Explore</a></p>${metadata([
    ['Personalization', 'home-hero'], ['Personalization Source', 'api'],
    ['Personalization Variants', links(`${P}/home-hero/pro`, `${P}/home-hero/deals`)],
    ['Personalization Hint', 'Show the hero that best matches why the visitor came.'],
    ['Personalization Description Pro', 'Pro espresso machines: dual boilers, PID control, barista-grade results.'],
    ['Personalization Description Default', 'Our flagship espresso machine range for every kitchen.'],
    ['Personalization Rule Deals', 'param: utm_campaign=black-friday'],
  ])}</div>
  ${spacer}
  <div><h2>Promo</h2><p><a href="/promo">See</a></p>${metadata([['Personalization', 'promo'], ['Personalization Source', 'api'], ['Personalization Variants', links(`${P}/promo/festive`)]])}</div>
  ${spacer}
</main><footer></footer></body>`;
const PILOT_FRAGMENTS = {
  'personalization/home-hero/pro': '<h1>Pro machines</h1><p><a href="/espresso">Go pro</a></p>',
  'personalization/home-hero/deals': '<h1>Deals</h1><p><a href="/espresso">See deals</a></p>',
  'personalization/promo/festive': '<h2>Festive</h2><p><a href="/promo">Shop</a></p>',
};
const ENGINE = { ttl: 0, placeholders: { plan: { 'param: utm_campaign=enterprise': 'enterprise', 'param: utm_campaign=none': 'default' } } };
const ACTIVITIES = {
  banner: { name: 'Banner', experiences: [{ name: 'Everyone', audience: null, offer: `${F}/banner/sale` }] },
  offer: {
    name: 'Scroll offer',
    experiences: [
      { name: 'Returning', audience: 'visitor: returning', offer: `${F}/offer/welcome-back` },
      { name: 'Everyone', audience: null, offer: `${F}/offer/free-trial` },
    ],
  },
};
const config = (mock, engine = 'generic') => `export default {
  consent: { mode: 'cmp', tool: 'custom' },
  hasConsent: () => undefined,
  fragmentPrefixes: ['/fragments/'],
  budgets: { eager: 800, lazy: 2000 },
  devices: { mobile: '(max-width: 599px)', desktop: '(min-width: 600px)' },
  geo: { endpoint: '', timeout: 500 },
  api: { endpoint: '/pzn/decide', engine: '${engine}', timeout: 1500, feedback: '' },
  target: { transport: 'delivery-api', clientCode: 'acme', propertyToken: '', endpoint: '/rest/v1/delivery', timeout: 3000 },
  mock: ${mock ? `{ api: ${JSON.stringify(ENGINE)}, target: ${JSON.stringify(ACTIVITIES)} }` : 'false'},
  audiences: {},
  overrides: 'preview',
  analytics: { dataLayer: true, rum: false },
};
`;
// aem.js essentials: sections decorated and loaded like the boilerplate's.
const AEM = `export function sampleRUM() {}
export async function loadCSS(href) {
  if (document.querySelector(\`link[href="\${href}"]\`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}
export function decorateSections(main) {
  main.querySelectorAll(':scope > div').forEach((section) => {
    section.classList.add('section');
    section.dataset.sectionStatus = 'initialized';
    section.style.display = 'none';
  });
}
export async function loadSection(section) {
  const status = section.dataset.sectionStatus;
  if (!status || status === 'initialized') {
    section.dataset.sectionStatus = 'loaded';
    section.style.display = null;
  }
}
export async function loadSections(main) {
  for (const section of main.querySelectorAll('div.section')) {
    // eslint-disable-next-line no-await-in-loop
    await loadSection(section);
  }
}`;
const SCRIPTS = `import { decorateSections, loadSection, loadSections } from './aem.js';

function decorateMain(main) {
  decorateSections(main);
}

async function loadEager(doc) {
  const main = doc.querySelector('main');
  if (main) {
    decorateMain(main);
    await loadSection(main.querySelector('.section'));
  }
}

async function loadLazy(doc) {
  const main = doc.querySelector('main');
  await loadSections(main);
}

async function loadPage() {
  await loadEager(document);
  await loadLazy(document);
}

loadPage();
`;
const FRAGMENT_BLOCK = `export async function loadFragment(path) {
  const resp = await fetch(\`\${path}.plain.html\`);
  if (!resp.ok) return null;
  const main = document.createElement('main');
  main.innerHTML = await resp.text();
  main.querySelectorAll(':scope > div').forEach((div) => div.classList.add('section'));
  return main;
}`;

const chromium = await (async () => {
  try {
    const playwright = loadPlaywright();
    const browser = playwright ? await playwright.chromium.launch() : null;
    await browser?.close();
    return browser ? playwright : null;
  } catch (e) {
    return null;
  }
})();
const FULL = process.env.PZN_E2E === '1';

/**
 * A boilerplate-shaped site with the runtime installed, served on a free
 * port; /pzn/decide and /rest/v1/delivery answer like the mock server.
 */
async function serveSite(mock, { source = SOURCE, fragments = FRAGMENTS, engine } = {}) {
  const site = tempDir('pzn-verify-');
  const { dir } = site;
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'blocks', 'fragment'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'scripts.js'), SCRIPTS);
  writeFileSync(join(dir, 'scripts', 'aem.js'), AEM);
  writeFileSync(join(dir, 'blocks', 'fragment', 'fragment.js'), FRAGMENT_BLOCK);
  const installed = installRuntime(dir, { applyHook: true });
  assert.equal(installed.hook, 'applied', JSON.stringify(installed.hooks));
  writeFileSync(join(dir, 'scripts', 'personalization', 'config.js'), config(mock, engine));
  const rendered = renderSectionMetadata(source).html;
  const plain = rendered.replace(/^[\s\S]*<main>|<\/main>[\s\S]*$/g, '');
  const pageHtml = `<!DOCTYPE html><html lang="en"><head><title>Page</title><style>.spacer{height:1400px}</style>
    <script type="module" src="/scripts/scripts.js"></script></head>${rendered}</html>`;
  const mockServer = createMockServer({ decisions: ENGINE, target: ACTIVITIES, log: () => {} });
  const [mockHandler] = mockServer.listeners('request');
  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/pzn/decide') {
      req.url = '/decide';
      mockHandler(req, res);
      return;
    }
    if (pathname === '/rest/v1/delivery') {
      mockHandler(req, res);
      return;
    }
    const fragment = /^\/fragments\/(.+)\.plain\.html$/.exec(pathname);
    let body = null;
    let type = 'text/html';
    if (pathname === '/edge') {
      // The page as the skill's edge worker serves it (geo IN, the visitor's cookies).
      const edge = await simulateEdge(pageHtml, {
        url: `http://localhost${req.url}`, country: 'IN', cookie: req.headers.cookie, origin: `http://localhost:${server.address().port}`,
      });
      res.setHeader('content-type', 'text/html');
      res.end(edge.html);
      return;
    }
    if (pathname === '/page') body = pageHtml;
    else if (pathname === '/page.plain.html') body = plain;
    else if (fragment && fragments[fragment[1]]) body = `<div>${fragments[fragment[1]]}</div>`;
    else if (/\.(js|css)$/.test(pathname)) {
      body = await readFile(join(dir, pathname)).catch(() => null);
      type = pathname.endsWith('.js') ? 'text/javascript' : 'text/css';
    }
    res.statusCode = body === null ? 404 : 200;
    res.setHeader('content-type', type);
    res.end(body ?? '');
  });
  await new Promise((done) => { server.listen(0, done); });
  return {
    base: `http://localhost:${server.address().port}`,
    site: readSiteConfig(config(mock, engine)),
    close: () => {
      server.close();
      site.cleanup();
    },
  };
}

const failures = (list) => (list || []).filter((item) => !item.ok)
  .map((item) => `${item.id ?? ''} · ${item.case ?? ''}: ${item.notRun || item.problems.join('; ')}`);

[true, false].forEach((mock) => {
  const mode = mock ? 'in-browser mocks' : 'engine and Target routes';
  const skip = !chromium ? 'Playwright Chromium not installed' : (!mock && !FULL && 'set PZN_E2E=1 for the full run');
  describe(`verify against a preview (${mode})`, { skip }, () => {
    let preview;
    let cases;
    before(async () => {
      preview = await serveSite(mock);
      cases = await buildCases(SOURCE, { engine: ENGINE, activities: ACTIVITIES });
    });
    after(() => preview?.close());

    it('passes the simulated cases and keeps splits sticky', async () => {
      const wanted = new Set(['no consent', 'bot', 'no context', 'forced india', 'matches "geo: IN"',
        'matches "param: utm_campaign=enterprise"', 'matches "param: utm_campaign=none"', 'matches "device: mobile"',
        'forced team', 'matches "visitor: returning"', 'forced free-trial']);
      const chosen = FULL ? cases : cases.filter((entry) => wanted.has(entry.name));
      const report = await verify({
        page: `${preview.base}/page`, cases: chosen, site: preview.site, faults: FULL, splitRuns: FULL ? 6 : 0,
      });
      assert.deepEqual(failures(report.results), []);
      assert.deepEqual(failures(report.splits), []);
      assert.equal(report.splits.length, 1);
      assert.equal(new Set(report.splits[0].sticky).size, 1);
      if (FULL) assert.equal(Object.values(report.splits[0].distribution).reduce((sum, count) => sum + count, 0), 6);
      assert.equal(report.ok, true);
      const names = report.results.map((result) => `${result.id} · ${result.case} → ${result.actual} (${result.outcome})`);
      assert.ok(names.includes('offer · matches "visitor: returning" → welcome-back (variant)'), names.join('\n'));
      assert.ok(names.includes('plan · bot → default (bot)'), names.join('\n'));
      if (FULL) assert.ok(names.includes('plan · engine slow → default (fallback)'), names.join('\n'));
    });

    it('fails a case whose expectation is wrong', async () => {
      const entry = cases.find((item) => item.id === 'hero' && item.name === 'forced india');
      const report = await verify({ page: `${preview.base}/page`, cases: [{ ...entry, expected: 'default' }], site: preview.site });
      assert.equal(report.ok, false);
      assert.match(report.results[0].problems.join(), /variant "india" \(override, override\), expected "default"/);
    });

    it('re-evaluates, follows consent changes and the pilot steps', { skip: !FULL && 'set PZN_E2E=1' }, async () => {
      const report = await verify({
        page: `${preview.base}/page`,
        cases: cases.filter((entry) => entry.name === 'no context'),
        site: preview.site,
        refresh: true,
        consentFlow: true,
      });
      assert.deepEqual(failures(report.refresh), []);
      assert.equal(report.consentFlow.ok, true, report.consentFlow.notRun || report.consentFlow.problems.join('\n'));
    });

    it('measures edge latency for a visitor with consent', { skip: (!FULL || mock) && 'set PZN_E2E=1 (route mode)' }, async () => {
      const report = await verify({
        page: `${preview.base}/edge`, cases, site: preview.site, perf: true, edge: true, uncached: true, runs: 2, baseline: `${preview.base}/page?pzn-consent=0`,
      });
      assert.equal(report.edge.ok, true, report.edge.problems.join('\n'));
      assert.deepEqual([report.edge.uncached.runs, report.edge.uncached.success, report.edge.cached.success], [2, 1, 1]);
      const without = await verify({
        page: `${preview.base}/edge`, cases, site: preview.site, perf: true, edge: true, runs: 2,
      });
      assert.match(without.edge.notRun, /--baseline/);
      assert.equal(without.ok, false, 'not run is never a pass');
    });
  });
});

describe('pilot scenarios against a preview (contract pilot/scenarios.json)', { skip: !chromium ? 'Playwright Chromium not installed' : (!FULL && 'set PZN_E2E=1') }, () => {
  [true, false].forEach((mock) => {
    it(`replays every step (${mock ? 'in-browser mocks' : 'engine route'})`, async () => {
      const preview = await serveSite(mock, { source: PILOT, fragments: PILOT_FRAGMENTS, engine: 'of1' });
      try {
        const scenarios = JSON.parse(await readFile(join(ASSETS_DIR, 'contract', 'pilot-scenarios.json'), 'utf8'));
        const report = await verify({
          page: `${preview.base}/page`,
          cases: [],
          site: preview.site,
          scenarios,
        });
        assert.equal(report.scenarios.length, scenarios.scenarios.length);
        assert.deepEqual(failures(report.scenarios), []);
        // A wrong expectation fails: the replay really compares.
        const [selected] = scenarios.scenarios;
        const [load] = selected.steps;
        const wrong = {
          ...selected,
          steps: [{
            ...load,
            attributes: { ...load.attributes, 'data-pzn-variant': 'deals' },
            events: load.events.slice(0, 2).map((item) => ({ ...item, personalization: { ...item.personalization, result: item.personalization.result && 'unchanged' } })),
          }],
        };
        const failed = await verify({
          page: `${preview.base}/page`, cases: [], site: preview.site, scenarios: { ...scenarios, scenarios: [wrong] },
        });
        const problems = failed.scenarios[0].problems.join('\n');
        assert.match(problems, /data-pzn-variant="pro", expected "deals"/);
        assert.match(problems, /event\(s\).*expected 2/);
        assert.match(problems, /result "applied" \(expected "unchanged"\)/);
      } finally {
        preview.close();
      }
    });
  });
});
