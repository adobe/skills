import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rows, rules } from './helpers.mjs';

const {
  parseCondition, parseSpec, decide, evaluate, toFragmentPath, variantName, criteriaUsed, stateKeysUsed,
} = rules;

const HERO = rows([
  ['id', 'home-hero'],
  ['geo: IN', '/fragments/personalization/home-hero/india'],
  ['geo: US, CA & device: mobile', '/fragments/personalization/home-hero/na-mobile'],
  ['visitor: returning', '', { href: '/fragments/personalization/home-hero/back' }],
  ['default', '/fragments/personalization/home-hero/default'],
]);

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

describe('parseSpec', () => {
  it('reads id, rules and default', () => {
    const spec = parseSpec(HERO);
    assert.deepEqual(spec.errors, []);
    assert.equal(spec.id, 'home-hero');
    assert.equal(spec.source, 'rules');
    assert.deepEqual(spec.rules.map((rule) => rule.variant), ['india', 'na-mobile', 'back']);
    assert.deepEqual(spec.default, { type: 'fragment', path: '/fragments/personalization/home-hero/default' });
    assert.deepEqual([...criteriaUsed(spec)].sort(), ['device', 'geo', 'visitor']);
  });

  it('supports none and inline defaults', () => {
    assert.deepEqual(parseSpec(rows([['id', 'a'], ['default', 'none']])).default, { type: 'none' });
    assert.deepEqual(parseSpec(rows([['id', 'a'], ['default', 'Hello', { inline: true }]])).default, { type: 'inline' });
    assert.deepEqual(parseSpec(rows([['id', 'a'], ['default', 'Plain text']])).default, { type: 'inline' });
  });

  it('reports authoring errors', () => {
    const errors = (pairs) => parseSpec(rows(pairs)).errors.join(' | ');
    assert.match(errors([['default', 'none']]), /missing id/);
    assert.match(errors([['id', 'a']]), /missing default/);
    assert.match(errors([['id', 'a b'], ['default', 'none']]), /letters, digits/);
    assert.match(errors([['id', 'a'], ['id', 'b'], ['default', 'none']]), /duplicate id/);
    assert.match(errors([['id', 'a'], ['default', 'none'], ['default', 'none']]), /duplicate default/);
    assert.match(errors([['id', 'a'], ['source', 'magic'], ['default', 'none']]), /source must be/);
    assert.match(errors([['id', 'a'], ['geo: IN', '/elsewhere/x'], ['default', 'none']]), /fragment link under/);
    assert.match(errors([['id', 'a'], ['geo: IN', '/fragments/a/default'], ['default', 'none']]), /cannot be named "default"/);
    assert.match(errors([['id', 'a'], ['default', '/elsewhere/x']]), /not under/);
    assert.match(errors([['id', 'a'], ['default', '']]), /default is empty/);
    assert.match(errors([['', 'x'], ['id', 'a'], ['default', 'none']]), /first cell is empty/);
  });

  it('rejects one variant name for two fragments, allows one fragment for two rules', () => {
    const clash = parseSpec(rows([['id', 'a'], ['geo: IN', '/fragments/in/hero'], ['geo: US', '/fragments/us/hero'], ['default', 'none']]));
    assert.match(clash.errors.join(), /variant "hero" also names \/fragments\/in\/hero/);
    const shared = parseSpec(rows([['id', 'a'], ['geo: IN', '/fragments/x/v'], ['param: promo', '/fragments/x/v'], ['default', 'none']]));
    assert.deepEqual(shared.errors, []);
    assert.deepEqual(shared.warnings, []);
  });

  it('warns on api without rules', () => {
    const api = parseSpec(rows([['id', 'a'], ['source', 'API'], ['default', 'none']]));
    assert.equal(api.source, 'api');
    assert.match(api.warnings.join(), /no rules/);
  });

  it('honors custom prefixes', () => {
    const spec = parseSpec(rows([['id', 'a'], ['geo: IN', '/pzn/a/in'], ['default', 'none']]), { prefixes: ['/pzn/'] });
    assert.deepEqual(spec.errors, []);
  });

  it('collects state keys', () => {
    const spec = parseSpec(rows([['id', 'a'], ['state: quiz=cn & state: step', '/fragments/a/cn'], ['default', 'none']]));
    assert.deepEqual([...stateKeysUsed(spec)], ['quiz', 'step']);
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

describe('decide', () => {
  const spec = parseSpec(HERO);

  it('picks the first matching rule', async () => {
    const decision = await decide(spec, { geo: { country: 'IN' }, visitor: 'returning' });
    assert.equal(decision.variant, 'india');
    assert.equal(decision.source, 'rule');
    assert.equal(decision.rule, 'geo: IN');
  });

  it('falls back to the default', async () => {
    const decision = await decide(spec, { geo: { country: 'FR' }, visitor: 'new' });
    assert.equal(decision.variant, 'default');
    assert.equal(decision.source, 'default');
    assert.equal(decision.target.path, '/fragments/personalization/home-hero/default');
  });

  it('applies forced overrides, ignoring unknown variants', async () => {
    assert.equal((await decide(spec, {}, { forcedVariant: 'back' })).source, 'override');
    assert.equal((await decide(spec, { geo: { country: 'IN' } }, { forcedVariant: 'DEFAULT' })).variant, 'default');
    assert.equal((await decide(spec, { geo: { country: 'IN' } }, { forcedVariant: 'nope' })).variant, 'india');
  });

  it('prefers the API decision, then falls back on bad answers', async () => {
    const ctx = { geo: { country: 'IN' } };
    const variant = await decide(spec, ctx, { apiDecision: { variant: 'back', tracking: { id: 1 } } });
    assert.deepEqual([variant.variant, variant.source, variant.tracking], ['back', 'api', { id: 1 }]);
    const control = await decide(spec, ctx, { apiDecision: { variant: null } });
    assert.deepEqual([control.variant, control.source], ['default', 'api']);
    const fragment = await decide(spec, ctx, { apiDecision: { fragment: '/fragments/promo/summer' } });
    assert.deepEqual([fragment.variant, fragment.target.path], ['summer', '/fragments/promo/summer']);
    const offPrefix = await decide(spec, ctx, { apiDecision: { fragment: '/admin/x' } });
    assert.equal(offPrefix.variant, 'india');
    const unknown = await decide(spec, ctx, { apiDecision: { variant: 'nope' } });
    assert.equal(unknown.variant, 'india');
  });

  it('defers when the first candidate rule needs a criterion the caller lacks', async () => {
    const deferred = await decide(spec, { geo: { country: 'US' } }, { deferCriteria: ['device'] });
    assert.deepEqual(deferred, { id: 'home-hero', deferred: true });
    const decided = await decide(spec, { geo: { country: 'IN' } }, { deferCriteria: ['device'] });
    assert.equal(decided.variant, 'india');
  });

  it('renders nothing for default none', async () => {
    const none = parseSpec(rows([['id', 'w'], ['visitor: returning', '/fragments/w/back'], ['default', 'none']]));
    const decision = await decide(none, { visitor: 'new' });
    assert.deepEqual(decision.target, { type: 'none' });
  });
});
