import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rules } from './helpers.mjs';

const {
  parseCondition, evaluate, toFragmentPath, variantName, criteriaUsed, stateKeysUsed,
  CRITERIA, CLIENT_ONLY_CRITERIA, NO_CONSENT_CRITERIA,
} = rules;

describe('criteria (contract section 2 and 3)', () => {
  it('are exactly the six of the contract', () => {
    assert.deepEqual([...CRITERIA].sort(), ['audience', 'device', 'geo', 'param', 'state', 'visitor']);
  });

  it('leaves device, state and audience to the browser', () => {
    assert.deepEqual([...CLIENT_ONLY_CRITERIA].sort(), ['audience', 'device', 'state']);
  });

  it('lets the rules exception use only geo, device, param and state', () => {
    assert.deepEqual([...NO_CONSENT_CRITERIA].sort(), ['device', 'geo', 'param', 'state']);
    assert.equal(NO_CONSENT_CRITERIA.includes('visitor'), false);
    assert.equal(NO_CONSENT_CRITERIA.includes('audience'), false);
  });
});

describe('parseCondition', () => {
  it('parses OR values, AND clauses and negation', () => {
    assert.deepEqual(parseCondition('geo: US, CA & !visitor: returning'), [
      { criterion: 'geo', negate: false, values: ['US', 'CA'] },
      { criterion: 'visitor', negate: true, values: ['returning'] },
    ]);
  });

  it('accepts key=value for param and state', () => {
    assert.deepEqual(parseCondition('state: quiz-persona=cn')[0].values, ['quiz-persona=cn']);
    assert.deepEqual(parseCondition('Param: utm_campaign')[0], { criterion: 'param', negate: false, values: ['utm_campaign'] });
  });

  it('rejects unknown criteria, bad values and empty input', () => {
    assert.throws(() => parseCondition('weather: sunny'), /unknown criterion/);
    assert.throws(() => parseCondition('geo: India'), /country code/);
    assert.throws(() => parseCondition('visitor: loyal'), /visitor must be/);
    assert.throws(() => parseCondition('state: =x'), /needs a key/);
    assert.throws(() => parseCondition('geo IN'), /criterion: value/);
    assert.throws(() => parseCondition('geo:'), /no values/);
    assert.throws(() => parseCondition(''), /empty condition/);
  });
});

describe('toFragmentPath', () => {
  it('keeps only same-origin paths under the allowed prefixes', () => {
    assert.equal(toFragmentPath('/fragments/a/b'), '/fragments/a/b');
    assert.equal(toFragmentPath('https://main--site--org.aem.page/fragments/a.plain.html'), '/fragments/a');
    assert.equal(toFragmentPath('https://evil.example/fragments/a'), '/fragments/a');
    assert.equal(toFragmentPath('/other/a'), null);
    assert.equal(toFragmentPath('/pzn/a', ['/pzn/']), '/pzn/a');
    assert.equal(toFragmentPath(''), null);
    assert.equal(toFragmentPath(42), null);
  });

  it('never escapes the prefix', () => {
    assert.equal(toFragmentPath('/fragments/../secret'), null);
    assert.equal(toFragmentPath('/fragments/%2e%2e/secret'), null);
  });

  it('names variants after the last segment', () => {
    assert.equal(variantName('/fragments/personalization/home-hero/india'), 'india');
    assert.equal(variantName('/'), 'default');
  });
});

describe('criteriaUsed and stateKeysUsed', () => {
  it('collect what a spec\'s rules refer to', () => {
    const spec = {
      rules: ['geo: US, CA & device: mobile', 'state: quiz=cn & state: step', 'visitor: returning']
        .map((condition) => ({ clauses: parseCondition(condition) })),
    };
    assert.deepEqual([...criteriaUsed(spec)].sort(), ['device', 'geo', 'state', 'visitor']);
    assert.deepEqual([...stateKeysUsed(spec)], ['quiz', 'step']);
    assert.deepEqual([...criteriaUsed({})], []);
  });
});

describe('evaluate', () => {
  it('matches geo with and without region', async () => {
    assert.equal(await evaluate(parseCondition('geo: US-CA'), { geo: { country: 'US', region: 'CA' } }), true);
    assert.equal(await evaluate(parseCondition('geo: US-CA'), { geo: { country: 'US', region: 'NY' } }), false);
    assert.equal(await evaluate(parseCondition('geo: us'), { geo: { country: 'US', region: 'NY' } }), true);
    assert.equal(await evaluate(parseCondition('geo: IN'), {}), false);
    assert.equal(await evaluate(parseCondition('!geo: IN'), {}), true);
  });

  it('matches params and state by key or key=value, case-insensitively', async () => {
    const ctx = { params: { utm_campaign: 'Diwali' }, state: { persona: 'cn' } };
    assert.equal(await evaluate(parseCondition('param: utm_campaign'), ctx), true);
    assert.equal(await evaluate(parseCondition('param: utm_campaign=diwali'), ctx), true);
    assert.equal(await evaluate(parseCondition('param: utm_campaign=holi'), ctx), false);
    assert.equal(await evaluate(parseCondition('state: persona=cn & param: utm_source'), ctx), false);
  });

  it('calls custom audiences and treats failures as no match', async () => {
    const audiences = {
      vip: async (ctx) => ctx.visitor === 'returning',
      broken: () => { throw new Error('boom'); },
      forced: true,
    };
    assert.equal(await evaluate(parseCondition('audience: vip'), { visitor: 'returning' }, audiences), true);
    assert.equal(await evaluate(parseCondition('audience: broken'), {}, audiences), false);
    assert.equal(await evaluate(parseCondition('audience: forced'), {}, audiences), true);
    assert.equal(await evaluate(parseCondition('audience: unknown'), {}, audiences), false);
  });
});
