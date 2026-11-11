import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  API_FAULTS, TARGET_FAULTS, autoMatrix, buildCases, expectedDecision, fragmentSource, sectionSpecs,
  simulateEdge, tableEngine, toCase,
} from '../simulate.mjs';
import { check } from '../schema.mjs';
import {
  SITE, fixture, runHelp, sectionSpec, tempDir,
} from './helpers.mjs';

const DECISIONS = JSON.parse(fixture('decisions.json'));
const F = '/fragments/p';
const metadata = (rows) => `<div class="section-metadata">${rows.map(([key, value]) => `<div><div><p>${key}</p></div><div>${value}</div></div>`).join('')}</div>`;
const links = (...paths) => paths.map((path) => `<p><a href="${path}">${path}</a></p>`).join('');
// One section per source, after an unpersonalized first section.
const PAGE = `<main>
  <div><h1>Hero</h1></div>
  <div><h2>Hero</h2>${metadata([['Personalization', 'hero'], ['Personalization Variants', links(`${F}/hero/india`)], ['Personalization Rule India', 'geo: IN'], ['Personalization Rule India 2', 'param: utm_campaign=diwali']])}</div>
  <div><h2>Plan</h2>${metadata([['Personalization', 'plan'], ['Personalization Source', 'api'], ['Personalization Variants', links(`${F}/plan/enterprise`, `${F}/plan/mobile`)], ['Personalization Rule Mobile', 'device: mobile']])}</div>
  <div><h2>Msg</h2>${metadata([['Personalization', 'msg'], ['Personalization Source', 'split'], ['Personalization Variants', links(`${F}/msg/a`, `${F}/msg/b`)]])}</div>
  <div><h2>Pick</h2>${metadata([['Personalization', 'pick'], ['Personalization Source', 'split'], ['Personalization Split', '0, 100'], ['Personalization Variants', links(`${F}/pick/x`, `${F}/pick/y`)]])}</div>
  <div><h2>Offer</h2>${metadata([['Personalization', 'offer'], ['Personalization Source', 'target'], ['Personalization Display', 'popup'], ['Personalization Trigger', 'scroll: 70%'], ['Personalization Variants', links(`${F}/offer/free-trial`, `${F}/offer/welcome-back`)]])}</div>
</main>`;
const ENGINE = { placeholders: { plan: { 'param: utm_campaign=enterprise': 'enterprise', 'param: utm_source=x': 'unlisted' } } };
const ACTIVITIES = {
  offer: {
    experiences: [
      { audience: 'visitor: returning', offer: `${F}/offer/welcome-back` },
      { audience: null, offer: `${F}/offer/free-trial` },
    ],
  },
};
const pick = (cases, id, name) => cases.find((entry) => entry.id === id && entry.name === name);
const brief = (entry) => [entry.expected, entry.outcome, entry.source, entry.assigned, entry.result];

describe('toCase', () => {
  it('turns a matrix entry into a context and the preview query', () => {
    const entry = toCase({
      geo: 'US-CA', device: 'mobile', visitor: 'returning', state: { quiz: 'cn' }, audiences: ['vip'], params: { utm_campaign: 'x' }, forced: 'hero:india',
    });
    assert.deepEqual(entry.context, {
      geo: { country: 'US', region: 'CA' }, device: 'mobile', visitor: 'returning', state: { quiz: 'cn' }, params: { utm_campaign: 'x' },
    });
    assert.equal(entry.consent, true);
    assert.equal(entry.query, 'pzn-consent=1&pzn-geo=US-CA&pzn-device=mobile&pzn-visitor=returning&pzn-state=quiz%3Acn&pzn-audience=vip&utm_campaign=x&pzn=hero%3Aindia');
  });

  it('says no consent explicitly, and nothing for a bot', () => {
    assert.equal(toCase({}).query, 'pzn-consent=1');
    const none = toCase({ consent: false, visitor: 'returning' });
    assert.equal(none.query, 'pzn-consent=0&pzn-visitor=returning');
    assert.equal(none.context.visitor, undefined, 'the visitor cookie is not read without consent');
    assert.deepEqual([toCase({ bot: true }).query, toCase({ bot: true }).consent], ['', false]);
  });
});

describe('autoMatrix', () => {
  it('covers no consent, a bot, no context, each rule and each override', () => {
    const spec = sectionSpec({
      '': 'hero',
      variants: '/fragments/h/na,/fragments/h/promo',
      'rule-na': 'geo: US, CA & device: mobile & !visitor: returning',
      'rule-promo': 'param: utm_campaign=diwali & state: quiz & audience: vip',
    });
    const matrix = autoMatrix(spec);
    assert.deepEqual(matrix.map((entry) => entry.name), [
      'no consent', 'bot', 'no context',
      'matches "geo: US, CA & device: mobile & !visitor: returning"',
      'matches "param: utm_campaign=diwali & state: quiz & audience: vip"',
      'forced na', 'forced promo', 'forced default',
    ]);
    assert.equal(matrix[3].geo, 'US');
    assert.equal(matrix[3].visitor, undefined, 'negated clauses are left unset');
    assert.deepEqual(matrix[4].params, { utm_campaign: 'diwali' });
    assert.deepEqual(matrix[4].state, { quiz: '1' });
    assert.deepEqual(matrix[4].audiences, ['vip']);
  });

  it('adds the engine and Target faults for those sources', () => {
    const api = autoMatrix(sectionSpec({ '': 'plan', source: 'api', variants: '/fragments/p/a' }));
    assert.deepEqual(api.filter((entry) => entry.fault).map((entry) => entry.fault), API_FAULTS);
    const target = autoMatrix(sectionSpec({ '': 'offer', source: 'target', variants: '/fragments/p/a' }));
    assert.deepEqual(target.filter((entry) => entry.fault).map((entry) => entry.fault), TARGET_FAULTS);
  });
});

describe('sectionSpecs', () => {
  it('reads source content and delivered HTML alike, with the section index', () => {
    const source = sectionSpecs(fixture('content/index.html'));
    const delivered = sectionSpecs(fixture('index.html'));
    assert.deepEqual(source.map((spec) => [spec.id, spec.index]), [['home-hero', 0], ['welcome', 2]]);
    assert.deepEqual(delivered.map((spec) => [spec.id, spec.index]), [['home-hero', 0], ['welcome', 2]]);
    assert.match(source[0].authoredText, /^Original hero/);
  });
});

describe('buildCases', () => {
  it('expects the right decision for every rules case (contract section 4)', async () => {
    const cases = await buildCases(fixture('content/index.html'));
    const byCase = Object.fromEntries(cases.map((entry) => [`${entry.id} · ${entry.name}`, brief(entry)]));
    assert.deepEqual(byCase, {
      'home-hero · no consent': ['default', 'no-consent', 'rules', undefined, 'kept-default'],
      'home-hero · bot': ['default', 'bot', 'bot', undefined, 'kept-default'],
      'home-hero · no context': ['default', 'no-match', 'rules', undefined, 'kept-default'],
      'home-hero · matches "geo: IN"': ['india', 'variant', 'rules', 'india', 'applied'],
      'home-hero · matches "geo: US,CA & device: mobile"': ['na-mobile', 'variant', 'rules', 'na-mobile', 'applied'],
      'home-hero · forced india': ['india', 'override', 'override', 'india', 'applied'],
      'home-hero · forced na-mobile': ['na-mobile', 'override', 'override', 'na-mobile', 'applied'],
      'home-hero · forced default': ['default', 'override', 'override', 'default', 'kept-default'],
      'welcome · no consent': ['default', 'no-consent', 'rules', undefined, 'kept-default'],
      'welcome · bot': ['default', 'bot', 'bot', undefined, 'kept-default'],
      'welcome · no context': ['default', 'no-match', 'rules', undefined, 'kept-default'],
      'welcome · matches "visitor: returning"': ['back', 'variant', 'rules', 'back', 'applied'],
      'welcome · matches "state: quiz-persona=cn"': ['cn', 'variant', 'rules', 'cn', 'applied'],
      'welcome · forced back': ['back', 'override', 'override', 'back', 'applied'],
      'welcome · forced cn': ['cn', 'override', 'override', 'cn', 'applied'],
      'welcome · forced default': ['default', 'override', 'override', 'default', 'kept-default'],
    });
    assert.equal(pick(cases, 'welcome', 'forced cn').query, 'pzn-consent=1&pzn=welcome%3Acn');
    assert.equal(pick(cases, 'home-hero', 'matches "geo: IN"').rule, 'geo: IN');
  });

  it('follows the approved rules exception without consent (contract section 3)', async () => {
    const cases = await buildCases(fixture('content/index.html'), {
      matrix: [{ name: 'india, no consent', consent: false, geo: 'IN' }, { name: 'returning, no consent', consent: false, visitor: 'returning' }],
      policy: ['rules'],
    });
    assert.deepEqual(brief(pick(cases, 'home-hero', 'india, no consent')), ['india', 'variant', 'rules', 'india', 'applied']);
    assert.deepEqual(brief(pick(cases, 'welcome', 'returning, no consent')), ['default', 'no-match', 'rules', undefined, 'kept-default'], 'visitor: is never read without consent');
  });

  it('decides api sections through the engine table, then their Rule rows', async () => {
    const cases = await buildCases(fixture('content/offer.plain.html'), { engine: DECISIONS });
    const byCase = Object.fromEntries(cases.map((entry) => [entry.name, [...brief(entry), entry.reason]]));
    assert.deepEqual(byCase['matches "geo: IN & visitor: returning"'], ['india', 'variant', 'api', 'india', 'applied', undefined]);
    assert.deepEqual(byCase['matches "geo: US"'], ['default', 'intentional-default', 'api', 'default', 'kept-default', undefined]);
    assert.deepEqual(byCase['matches "device: mobile"'], ['default', 'control', 'api', 'default', 'kept-default', undefined]);
    // No engine answer: the Rule rows decide, the outcome says why.
    assert.deepEqual(byCase['matches "param: utm_campaign=diwali"'], ['diwali', 'no-match', 'rules', 'diwali', 'applied', 'no decision']);
    assert.deepEqual(byCase['engine reason:low_confidence'], ['default', 'low-confidence', 'rules', undefined, 'kept-default', 'low_confidence']);
    assert.deepEqual(byCase['engine fail'], ['default', 'fallback', 'rules', undefined, 'kept-default', 'HTTP 500']);
    assert.deepEqual(byCase['engine variant:not-listed'], ['default', 'fallback', 'rules', undefined, 'kept-default', 'not listed: not-listed']);
    assert.deepEqual(byCase['engine invalid'].slice(0, 3), ['default', 'fallback', 'rules']);
    assert.deepEqual(byCase['engine missing'].slice(0, 3), ['default', 'no-match', 'rules']);
    assert.deepEqual(byCase['engine reason:provider_error'], ['default', 'fallback', 'rules', undefined, 'kept-default', 'provider_error']);
    // The first section's budget (800 ms) runs out before the engine request.
    assert.deepEqual(byCase['engine slow'], ['default', 'timeout', 'api', undefined, 'kept-default', 'no decision within 800 ms']);
    assert.deepEqual(byCase['no consent'], ['default', 'no-consent', 'api', undefined, 'kept-default', undefined]);
  });

  it('decides each source as sections.js would', async () => {
    const cases = await buildCases(PAGE, { engine: ENGINE, activities: ACTIVITIES });
    const india = pick(cases, 'hero', 'matches "geo: IN"');
    assert.deepEqual(
      [india.section, india.sourceType, india.display, india.authoredText, india.query, india.expected, india.outcome, india.source, india.rule],
      [1, 'rules', 'inline', 'Hero', 'pzn-consent=1&pzn-geo=IN', 'india', 'variant', 'rules', 'geo: IN'],
    );
    assert.equal(pick(cases, 'hero', 'matches "param: utm_campaign=diwali"').expected, 'india');

    assert.deepEqual(brief(pick(cases, 'plan', 'matches "param: utm_campaign=enterprise"')), ['enterprise', 'variant', 'api', 'enterprise', 'applied']);
    const unlisted = pick(cases, 'plan', 'matches "param: utm_source=x"');
    assert.deepEqual([unlisted.expected, unlisted.outcome, unlisted.source, unlisted.reason], ['default', 'fallback', 'rules', 'not listed: unlisted']);
    assert.deepEqual(brief(pick(cases, 'plan', 'matches "device: mobile"')), ['mobile', 'no-match', 'rules', 'mobile', 'applied'], 'no engine answer: the Rule rows decide');
    // Not the first section: the engine request (1500 ms) times out within the budget.
    const slow = pick(cases, 'plan', 'engine slow');
    assert.deepEqual([slow.outcome, slow.source, slow.reason], ['fallback', 'rules', 'timed out after 1500 ms']);

    const msg = pick(cases, 'msg', 'no context');
    assert.deepEqual([msg.expected, msg.allowed, msg.source], [null, ['a', 'b', 'default'], 'split']);
    assert.deepEqual(brief(pick(cases, 'pick', 'no context')), ['y', 'variant', 'split', 'y', 'applied'], 'a single arm with weight is predictable');
    assert.deepEqual(brief(pick(cases, 'msg', 'no consent')), ['default', 'no-consent', 'split', undefined, 'kept-default']);

    const returning = pick(cases, 'offer', 'matches "visitor: returning"');
    assert.deepEqual([returning.expected, returning.outcome, returning.display, returning.trigger], ['welcome-back', 'variant', 'popup', { type: 'scroll', ratio: 0.7 }]);
    assert.equal(pick(cases, 'offer', 'no context').expected, 'free-trial');
    assert.deepEqual(brief(pick(cases, 'offer', 'Target control')), ['default', 'control', 'target', 'default', 'kept-default']);
    assert.deepEqual(brief(pick(cases, 'offer', 'Target missing')).slice(0, 3), ['default', 'no-match', 'target']);
    assert.deepEqual(brief(pick(cases, 'offer', 'Target fail')).slice(0, 3), ['default', 'fallback', 'target']);
    assert.deepEqual(brief(pick(cases, 'offer', 'no consent')).slice(0, 3), ['default', 'no-consent', 'target']);
  });

  it('marks what only the engine or Target can decide as unknown', async () => {
    const cases = await buildCases(PAGE);
    const plan = pick(cases, 'plan', 'no context');
    assert.deepEqual([plan.expected, plan.reason], ['unknown', 'pass --api-decisions decisions.json']);
    assert.equal(pick(cases, 'offer', 'no context').expected, 'unknown');
    // Faults and consent are known without a table.
    assert.equal(pick(cases, 'plan', 'engine fail').outcome, 'fallback');
    assert.equal(pick(cases, 'plan', 'no consent').outcome, 'no-consent');
  });

  it('never lets the slow of1 profile decide the first section in the browser', async () => {
    const cases = await buildCases(fixture('content/offer.plain.html'), { engine: DECISIONS, engineName: 'of1' });
    const returning = pick(cases, 'offer', 'matches "geo: IN & visitor: returning"');
    assert.deepEqual([returning.outcome, returning.source, returning.expected], ['fallback', 'rules', 'india'], 'the Rule rows decide');
  });

  it('every expected decision is a valid measurement event', async () => {
    const cases = await buildCases(PAGE, { engine: ENGINE, activities: ACTIVITIES });
    cases.filter((entry) => entry.outcome).forEach((entry) => {
      const personalization = {
        id: entry.id,
        decisionId: `${entry.id}#1`,
        variant: entry.expected,
        source: entry.source,
        where: 'browser',
        outcome: entry.outcome,
        ...(entry.assigned !== undefined ? { assigned: entry.assigned } : {}),
        ...(entry.reason ? { reason: entry.reason } : {}),
        result: entry.result,
      };
      assert.deepEqual(check('measurement-event', { event: 'pzn:applied', personalization }), [], `${entry.id} · ${entry.name}`);
    });
  });

  it('reports invalid sections instead of cases', async () => {
    const cases = await buildCases('<main><div><p>x</p><div class="section-metadata"><div><div>Personalization</div><div>bad id!</div></div></div></div></main>');
    assert.equal(cases.length, 1);
    assert.deepEqual([cases[0].name, cases[0].outcome, cases[0].expected], ['invalid section', 'invalid', 'default']);
    assert.match(cases[0].errors.join(), /bad id!/);
  });
});

describe('expectedDecision', () => {
  it('puts the override before the bot and consent checks', async () => {
    const spec = sectionSpec({ '': 'hero', variants: '/fragments/h/a', 'rule-a': 'geo: IN' });
    assert.deepEqual(await expectedDecision(spec, { bot: true, forced: 'hero:a' }, {}), {
      source: 'override', outcome: 'override', variant: 'a', path: '/fragments/h/a',
    });
    assert.deepEqual(await expectedDecision(spec, { bot: true }, {}), { source: 'bot', outcome: 'bot', variant: 'default' });
    assert.deepEqual(await expectedDecision(spec, { consent: false, geo: 'IN' }, {}), { source: 'rules', outcome: 'no-consent', variant: 'default' });
  });
});

describe('fragmentSource', () => {
  it('reads content/<path>.plain.html or .html from the repo', async () => {
    const read = fragmentSource(SITE);
    assert.match(await read('/fragments/personalization/home-hero/india'), /./);
    assert.equal(await read('/fragments/none'), null);
  });
});

describe('tableEngine', () => {
  it('answers like the mock engine and logs the requests', async () => {
    const log = [];
    const engine = tableEngine(DECISIONS, undefined, log);
    const body = { placeholders: [{ id: 'offer' }], context: { geo: { country: 'US' } } };
    const response = await engine('https://engine.invalid/', { body: JSON.stringify(body) });
    assert.equal((await response.json()).decisions.offer.variant, 'default');
    assert.equal(log.length, 1);
    assert.equal((await tableEngine(DECISIONS, 'fail')('x', { body: '{}' })).status, 500);
  });

  it('is slow until aborted', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(tableEngine({}, 'slow')('x', { body: '{}', signal: controller.signal }), { name: 'AbortError' });
  });
});

describe('simulateEdge', () => {
  it('applies rules at the edge with consent, keeping the default in a template (contract section 8)', async () => {
    const india = await simulateEdge(fixture('content/index.html'), { country: 'IN', consent: true, repo: SITE });
    const [hero, welcome] = india.sections;
    assert.deepEqual(
      [hero.where, hero.status, hero.variant, hero.outcome, hero.source, hero.decision, hero.template],
      ['edge', 'applied', 'india', 'variant', 'rules', 'home-hero#1', true],
    );
    // visitor: new here, then a state rule only the browser can read.
    assert.deepEqual([welcome.where, welcome.status], ['left to the browser', null]);
    assert.equal(india.headers['x-pzn'], 'edge');
    assert.equal(india.headers['cache-control'], 'private, no-cache');
  });

  it('leaves everything to the browser without consent, unless an exception allows it', async () => {
    const none = await simulateEdge(fixture('content/index.html'), { country: 'IN', repo: SITE });
    assert.deepEqual(none.sections.map((section) => section.where), ['left to the browser', 'left to the browser']);
    assert.equal(none.headers['x-pzn'], 'deferred');
    const rules = await simulateEdge(fixture('content/index.html'), { country: 'IN', repo: SITE, policy: ['rules'] });
    assert.equal(rules.sections[0].variant, 'india');
  });

  it('serves crawlers the default', async () => {
    const bot = await simulateEdge(fixture('content/index.html'), {
      country: 'IN', consent: true, ua: 'Googlebot', repo: SITE,
    });
    assert.deepEqual(bot.sections.map((section) => [section.variant, section.outcome, section.status]), [['default', 'bot', 'applied'], ['default', 'bot', 'applied']]);
  });

  it('asks the engine once and falls back to the Rule rows', async () => {
    const run = (country, fault, cookie) => simulateEdge(fixture('content/offer.plain.html'), {
      country, cookie, consent: true, repo: SITE, engine: DECISIONS, fault, url: 'https://www.example.com/offer?utm_campaign=diwali',
    });
    const returning = await run('IN', undefined, 'pzn-seen=1');
    assert.equal(returning.requests.length, 1);
    const [offer] = returning.sections;
    assert.deepEqual([offer.variant, offer.outcome, offer.source, offer.template], ['india', 'variant', 'api', true]);
    assert.equal(JSON.parse(offer.tracking).engine, 'mock');
    const us = (await run('US')).sections[0];
    assert.deepEqual([us.variant, us.outcome, us.template], ['default', 'intentional-default', false]);
    const nothing = (await run('DE')).sections[0];
    assert.deepEqual([nothing.variant, nothing.outcome, nothing.source, nothing.reason], ['diwali', 'no-match', 'rules', 'no decision']);
    const failed = (await run('IN', 'fail')).sections[0];
    assert.deepEqual([failed.variant, failed.outcome, failed.source, failed.reason], ['diwali', 'fallback', 'rules', 'HTTP 500']);
    const slow = (await run('IN', 'slow')).sections[0];
    assert.deepEqual([slow.outcome, slow.source], ['timeout', 'rules']);
  });

  it('passes the referrer host to the engine', async () => {
    const result = await simulateEdge(fixture('content/offer.plain.html'), {
      country: 'US', consent: true, repo: SITE, engine: DECISIONS, referer: 'https://forum.example/thread',
    });
    assert.equal(result.requests[0].context.referrer, 'forum.example');
    assert.deepEqual(check('decision-request', result.requests[0]), []);
  });

  it('runs the edge over source content with local fragments and assigns splits', async () => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(join(dir, 'content', 'fragments', 'p', 'hero'), { recursive: true });
      writeFileSync(join(dir, 'content', 'fragments', 'p', 'hero', 'india.html'), '<body><main><div><h2>Namaste</h2><img src="./media_1.png"></div></main></body>');
      mkdirSync(join(dir, 'content', 'fragments', 'p', 'pick'), { recursive: true });
      writeFileSync(join(dir, 'content', 'fragments', 'p', 'pick', 'y.plain.html'), '<div><p>Y</p></div>');
      const india = await simulateEdge(PAGE, {
        country: 'IN', consent: true, repo: dir, prefixes: ['/fragments/'],
      });
      const hero = india.sections.find((section) => section.id === 'hero');
      assert.deepEqual([hero.where, hero.variant, hero.template], ['edge', 'india', true]);
      assert.match(india.html, /<h2>Namaste<\/h2>/);
      assert.match(india.html, /media_1\.png/);
      assert.equal(india.sections.find((section) => section.id === 'offer').where, 'left to the browser', 'target stays in the browser');
      const pickSection = india.sections.find((section) => section.id === 'pick');
      assert.deepEqual([pickSection.where, pickSection.variant, pickSection.outcome], ['edge', 'y', 'variant']);
      assert.match(india.headers['set-cookie'] || '', /pzn-split=/);
    } finally {
      cleanup();
    }
  });
});

describe('simulate.mjs --help', () => {
  it('prints the usage, exits 0 and writes nothing', () => {
    const { status, stdout, wrote } = runHelp('simulate.mjs');
    assert.equal(status, 0);
    assert.match(stdout, /^Usage/);
    assert.deepEqual(wrote, []);
  });
});
