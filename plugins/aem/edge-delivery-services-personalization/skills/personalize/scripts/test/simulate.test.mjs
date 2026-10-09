import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  autoMatrix, buildCases, simulateEdge, toCase,
} from '../simulate.mjs';
import {
  fixture, rows, rules, runHelp,
} from './helpers.mjs';

const DECISIONS = JSON.parse(fixture('decisions.json'));

describe('toCase', () => {
  it('turns a matrix entry into a context and the override query', () => {
    const entry = toCase({
      geo: 'US-CA', device: 'mobile', visitor: 'returning', state: { quiz: 'cn' }, audiences: ['vip'], params: { utm_campaign: 'x' }, forced: 'hero:india',
    });
    assert.deepEqual(entry.context, {
      geo: { country: 'US', region: 'CA' }, device: 'mobile', visitor: 'returning', state: { quiz: 'cn' }, params: { utm_campaign: 'x' },
    });
    assert.equal(entry.query, 'pzn-geo=US-CA&pzn-device=mobile&pzn-visitor=returning&pzn-state=quiz%3Acn&pzn-audience=vip&utm_campaign=x&pzn=hero%3Aindia');
    assert.equal(toCase({}).query, '');
  });
});

describe('autoMatrix', () => {
  it('covers baseline, bot, each rule and each forced variant', () => {
    const spec = rules.parseSpec(rows([
      ['id', 'hero'],
      ['geo: US, CA & device: mobile & !visitor: returning', '/fragments/h/na'],
      ['param: utm_campaign=diwali & state: quiz & audience: vip', '/fragments/h/promo'],
      ['default', 'none'],
    ]));
    const matrix = autoMatrix(spec);
    assert.deepEqual(matrix.map((entry) => entry.name), [
      'no context', 'bot',
      'matches "geo: US, CA & device: mobile & !visitor: returning"',
      'matches "param: utm_campaign=diwali & state: quiz & audience: vip"',
      'forced na', 'forced promo', 'forced default',
    ]);
    assert.equal(matrix[2].geo, 'US');
    assert.equal(matrix[2].visitor, undefined, 'negated clauses are left unset');
    assert.deepEqual(matrix[3].params, { utm_campaign: 'diwali' });
    assert.deepEqual(matrix[3].state, { quiz: '1' });
    assert.deepEqual(matrix[3].audiences, ['vip']);
  });
});

describe('buildCases', () => {
  it('expects the right variant for every generated case', async () => {
    const cases = await buildCases(fixture('content/index.html'));
    const expected = Object.fromEntries(cases.map((entry) => [`${entry.placeholder} · ${entry.name}`, entry.expected]));
    assert.deepEqual(expected, {
      'home-hero · no context': 'default',
      'home-hero · bot': 'default',
      'home-hero · matches "geo: IN"': 'india',
      'home-hero · matches "geo: US, CA & device: mobile"': 'na-mobile',
      'home-hero · forced india': 'india',
      'home-hero · forced na-mobile': 'na-mobile',
      'home-hero · forced default': 'default',
      'welcome · no context': 'default',
      'welcome · bot': 'default',
      'welcome · matches "visitor: returning"': 'back',
      'welcome · matches "state: quiz-persona=cn"': 'cn',
      'welcome · forced back': 'back',
      'welcome · forced cn': 'cn',
      'welcome · forced default': 'default',
    });
    const bot = cases.find((entry) => entry.name === 'bot');
    assert.equal(bot.source, 'bot');
    assert.equal(cases.find((entry) => entry.name === 'forced cn').query, 'pzn=welcome%3Acn');
  });

  it('applies a shared matrix and the mock engine for api placeholders', async () => {
    const matrix = [
      { name: 'india returning', geo: 'IN', visitor: 'returning' },
      { name: 'india new', geo: 'IN', visitor: 'new' },
      { name: 'us', geo: 'US' },
      { name: 'campaign', params: { utm_campaign: 'diwali' } },
    ];
    const cases = await buildCases(fixture('content/offer.plain.html'), { matrix, engine: DECISIONS });
    const byName = Object.fromEntries(cases.map((entry) => [entry.name, [entry.expected, entry.source]]));
    assert.deepEqual(byName, {
      'india returning': ['india', 'api'],
      'india new': ['india', 'rule'],
      us: ['default', 'api'],
      campaign: ['diwali', 'rule'],
    });
    // The runtime calls the engine only with consent: the browser case must grant it.
    assert.ok(cases.every((entry) => /(^|&)pzn-consent=1$/.test(entry.query)));
  });

  it('grants consent in every case but bots with consent: true', async () => {
    const cases = await buildCases(fixture('index.html'), { consent: true });
    cases.filter((entry) => entry.source !== 'bot').forEach((entry) => assert.match(entry.query, /pzn-consent=1/));
    cases.filter((entry) => entry.source === 'bot').forEach((entry) => assert.equal(entry.query, ''));
    const plain = await buildCases(fixture('index.html'));
    assert.ok(plain.every((entry) => !/pzn-consent/.test(entry.query)));
  });

  it('reports invalid placeholders instead of cases', async () => {
    const cases = await buildCases('<div class="personalization"><div><div>id</div><div>x</div></div></div>');
    assert.equal(cases.length, 1);
    assert.equal(cases[0].name, 'invalid placeholder');
    assert.match(cases[0].errors.join(), /missing default/);
  });
});

describe('simulateEdge', () => {
  it('runs the worker logic over a page', async () => {
    const india = await simulateEdge(fixture('index.html'), { country: 'IN' });
    assert.deepEqual(india.blocks, [
      {
        id: 'home-hero', source: 'edge', variant: 'india', fragment: '/fragments/personalization/home-hero/india',
      },
      {
        id: 'welcome', source: 'deferred to browser', variant: null, fragment: null,
      },
    ]);
    assert.equal(india.headers['x-pzn'], 'edge');
    const bot = await simulateEdge(fixture('index.html'), { country: 'IN', ua: 'Googlebot' });
    assert.deepEqual(bot.blocks.map((block) => block.variant), ['default', 'default']);
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
