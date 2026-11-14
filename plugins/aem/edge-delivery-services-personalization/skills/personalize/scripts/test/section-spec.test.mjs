/*
 * Section grammar (contract section 1), split draws (section 6a) and Rule
 * rows: section-spec.js.
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { RUNTIME_DIR } from '../lib.mjs';

const {
  slug, proseValue, parseTrigger, parseSplit, splitArms, drawSplit, assignSplit, ruleVariant,
  parseSection, sectionObject, listedVariant, ruleOutcome, sectionCriteria, DEFAULT_TRIGGER,
  EXPERIMENTATION_META, SOURCES,
} = await import(pathToFileURL(join(RUNTIME_DIR, 'scripts', 'personalization', 'section-spec.js')).href);

const F = '/fragments/personalization';
const attrs = (pairs) => Object.entries(pairs).map(([key, value]) => [key ? `data-personalization-${key}` : 'data-personalization', value]);

const HERO = attrs({
  '': 'home-hero',
  variants: `${F}/home-hero/india,${F}/home-hero/na-mobile,${F}/home-hero/returning`,
  'rule-india': 'geo: IN',
  'rule-na-mobile': 'geo: US, CA & device: mobile',
  'rule-returning': 'visitor: returning',
  'rule-india-2': 'param: utm_campaign=diwali',
});

describe('section grammar', () => {
  it('reads id, source, variants and rules in attribute order', () => {
    const spec = parseSection(HERO);
    assert.equal(spec.id, 'home-hero');
    assert.equal(spec.source, 'rules');
    assert.deepEqual(spec.variants.map((variant) => variant.name), ['india', 'na-mobile', 'returning']);
    assert.deepEqual(spec.rules.map((rule) => [rule.variant, rule.condition]), [
      ['india', 'geo: IN'],
      ['na-mobile', 'geo: US, CA & device: mobile'],
      ['returning', 'visitor: returning'],
      ['india', 'param: utm_campaign=diwali'],
    ]);
    assert.deepEqual(spec.errors, []);
    assert.deepEqual(spec.warnings, []);
    assert.equal(spec.held, true);
    assert.equal(spec.display, 'inline');
  });

  it('has exactly the four sources of the contract', () => {
    assert.deepEqual([...SOURCES].sort(), ['api', 'rules', 'split', 'target']);
  });

  it('accepts an object of attributes and matches rule keys loosely', () => {
    const spec = parseSection({
      'data-personalization': 'quiz',
      'data-personalization-variants': `${F}/quiz/persona_a`,
      // older aem.js turns _ into -
      'data-personalization-rule-persona-a': 'state: persona=a',
    });
    assert.deepEqual(spec.errors, []);
    assert.equal(spec.rules[0].variant, 'persona_a');
  });

  it('numbers rules so a variant can have several', () => {
    const variants = [{ name: 'india' }, { name: 'team-2' }];
    assert.equal(ruleVariant('india-3', variants).name, 'india');
    assert.equal(ruleVariant('team-2', variants).name, 'team-2', 'an exact name wins over the numbered form');
    assert.equal(ruleVariant('team', variants), undefined);
    assert.equal(ruleVariant('india-3', variants, false), undefined, 'description rows are not numbered');
  });

  it('rejects ids, sources, conditions and rules that name no variant', () => {
    const spec = parseSection(attrs({
      '': 'bad id!',
      source: 'magic',
      variants: `${F}/x/a`,
      'rule-a': 'weather: sunny',
      'rule-b': 'geo: IN',
      rule: 'geo: US',
    }));
    const all = spec.errors.join('\n');
    assert.match(spec.errors[0], /id "bad id!"/);
    assert.match(all, /"Personalization Source" must be one of rules, split, api, target, got "magic"/);
    assert.match(all, /Rule a": unknown criterion "weather"/);
    assert.match(all, /"Personalization Rule b" names no variant/);
    assert.match(all, /"Personalization Rule" names no variant .*add the variant name/);
  });

  it('keeps conditions and absolute URLs out of Variants, and the name default out of variants', () => {
    const spec = parseSection(attrs({
      '': 'hero', variants: `geo: IN,${F}/hero/default,${F}/a/india,${F}/b/india,/blog/x,${F}/hero/Upper`, 'rule-india': 'geo: IN',
    }));
    assert.equal(spec.errors.length, 5, spec.errors.join('\n'));
    assert.match(spec.errors[0], /"geo: IN" is not one/);
    assert.match(spec.errors[1], /cannot be named "default"/);
    assert.match(spec.errors[2], /share the name "india"/);
    assert.match(spec.errors[3], /"\/blog\/x" is not one/);
    assert.match(spec.errors[4], /variant name "Upper"/);
    // Only the pathname of a link is kept: a fragment never loads from another origin.
    assert.equal(parseSection(attrs({ '': 'x', source: 'split', variants: `https://evil.example${F}/x/a` })).variants[0].path, `${F}/x/a`);
  });

  it('needs variants for every source, rules for a rules section, and warns about unreachable variants', () => {
    assert.match(parseSection(attrs({ '': 'x' })).errors[0], /needs "Personalization Variants"/);
    assert.match(parseSection(attrs({ '': 'x', source: 'target' })).errors[0], /needs "Personalization Variants"/);
    assert.match(parseSection(attrs({ '': 'x', variants: `${F}/x/a` })).errors[0], /needs at least one "Personalization Rule/);
    assert.deepEqual(parseSection(attrs({ '': 'x', source: 'api', variants: `${F}/x/a` })).errors, [], 'api needs no Rule rows');
    const spec = parseSection(attrs({
      '': 'x', variants: `${F}/x/a,${F}/x/b`, 'rule-a': 'geo: IN',
    }));
    assert.deepEqual(spec.warnings, ['variant "b" has no rule: only ?pzn= previews show it']);
  });

  it('rejects sections that also run AEM Experimentation, and knows its page metadata', () => {
    const spec = parseSection([...HERO, ['data-experiment', 'hero-test'], ['data-audience-mobile', '/x']]);
    assert.equal(spec.errors.length, 2);
    assert.match(spec.errors[0], /AEM Experimentation metadata \(experiment\)/);
    ['experiment', 'Campaign', 'campaign-summer', 'audience-mobile'].forEach((name) => assert.ok(EXPERIMENTATION_META.test(name), name));
    assert.equal(EXPERIMENTATION_META.test('personalization'), false);
  });

  it('warns about unknown Personalization rows', () => {
    assert.deepEqual(parseSection([...HERO, ['data-personalization-audience', 'x']]).warnings, [
      'unknown row "Personalization audience" is ignored',
    ]);
  });

  it('rejects rows outside their source', () => {
    const error = (extra, source = 'rules') => parseSection(attrs({
      '': 'x', source, variants: `${F}/x/a`, 'rule-a': 'geo: IN', ...extra,
    })).errors.join('\n');
    assert.match(error({ split: '50' }), /"Personalization Split" is for split sections only/);
    assert.match(error({ hint: 'x' }), /"Personalization Hint" is for api sections only/);
    assert.match(error({ 'description-a': 'x' }), /"Personalization Description" rows are for api sections only/);
    assert.match(error({ location: 'x' }), /"Personalization Location" is for target sections only/);
    assert.match(error({ trigger: 'view' }), /"Personalization Trigger" is for target sections only/);
    assert.match(error({ display: 'popup' }), /"Personalization Display" is for target sections only/);
    assert.match(error({}, 'split'), /a split section has no Rule rows/);
    assert.match(error({}, 'target'), /a target section has no Rule rows/);
  });
});

describe('api sections: Hint and Description rows', () => {
  const api = (extra) => parseSection(attrs({
    '': 'hero', source: 'api', variants: `${F}/hero/pro,${F}/hero/deals`, ...extra,
  }));

  it('reads hint and descriptions (Default too), restoring commas the pipeline joined', () => {
    const spec = api({
      hint: 'Fast,friendly,from 1,000 shops',
      'description-pro': 'For pros',
      'description-default': 'The flagship range',
      'rule-pro': 'param: utm_campaign=pro',
    });
    assert.deepEqual(spec.errors, []);
    assert.equal(spec.hint, 'Fast, friendly, from 1,000 shops');
    assert.deepEqual(spec.descriptions, { pro: 'For pros', default: 'The flagship range' });
    assert.equal(spec.rules[0].variant, 'pro', 'Rule rows in an api section are its fallback');
    assert.equal(proseValue('a,b'), 'a, b');
  });

  it('enforces the limits and listed names', () => {
    assert.match(api({ hint: 'x'.repeat(501) }).errors[0], /Hint" must be 1 to 500/);
    assert.match(api({ 'description-pro': 'x'.repeat(601) }).errors[0], /must be 1 to 600/);
    assert.match(api({ 'description-mars': 'x' }).errors[0], /names no listed variant \(or Default\)/);
  });
});

describe('split sections (6a)', () => {
  const split = (value, variants = 2) => parseSection(attrs({
    '': 'msg',
    source: 'split',
    variants: Array.from({ length: variants }, (_, index) => `${F}/msg/v${index}`).join(','),
    ...(value === undefined ? {} : { split: value }),
  }));

  it('parses percentages and gives the rest to the default (the control)', () => {
    assert.deepEqual(parseSplit('40, 30'), [40, 30]);
    assert.deepEqual(parseSplit('50%,50%'), [50, 50]);
    assert.equal(parseSplit('half, half'), null);
    assert.equal(parseSplit('120'), null);
    assert.deepEqual(splitArms(split('40, 30')), [{ name: 'v0', weight: 40 }, { name: 'v1', weight: 30 }, { name: 'default', weight: 30 }]);
    assert.deepEqual(splitArms(split('50')).map((arm) => arm.weight), [50, 0, 50]);
    assert.deepEqual(splitArms(split(undefined, 3)).map((arm) => arm.weight), [1, 1, 1, 1], 'even across the default and every variant');
  });

  it('draws every boundary from a fixed number', () => {
    const spec = split('40, 30');
    assert.equal(drawSplit(spec, 0), 'v0');
    assert.equal(drawSplit(spec, 0.3999), 'v0');
    assert.equal(drawSplit(spec, 0.4), 'v1');
    assert.equal(drawSplit(spec, 0.6999), 'v1');
    assert.equal(drawSplit(spec, 0.7), 'default');
    assert.equal(drawSplit(spec, 0.9999), 'default');
    const rollout = split('0, 100');
    [0, 0.5, 0.9999].forEach((n) => assert.equal(drawSplit(rollout, n), 'v1', `0, 100 at ${n}`));
    const even = split(undefined);
    const counts = { v0: 0, v1: 0, default: 0 };
    for (let i = 0; i < 3000; i += 1) counts[drawSplit(even, i / 3000)] += 1;
    assert.deepEqual(counts, { v0: 1000, v1: 1000, default: 1000 });
  });

  it('keeps an assignment that is still an arm, and draws again for a removed variant', () => {
    const spec = split('40, 30');
    assert.equal(assignSplit(spec, 'v1', 0), 'v1');
    assert.equal(assignSplit(spec, 'default', 0), 'default');
    assert.equal(assignSplit(spec, 'removed', 0.95), 'default');
    assert.equal(assignSplit(spec, undefined, 0.1), 'v0');
  });

  it('validates the split row', () => {
    assert.deepEqual(split('0, 100').errors, []);
    assert.equal(split(undefined).split, null);
    assert.match(split('60, 50').errors[0], /adds up to 110%/);
    assert.match(split('10, 10, 10').errors[0], /3 values for 2 variant/);
    assert.match(split('ten').errors[0], /must be percentages/);
  });
});

describe('target sections', () => {
  const target = (extra = {}) => parseSection(attrs({
    '': 'offer', source: 'target', variants: `${F}/offer/free-trial,${F}/offer/demo`, ...extra,
  }));

  it('parses triggers', () => {
    assert.deepEqual(parseTrigger('scroll: 70%'), { type: 'scroll', ratio: 0.7 });
    assert.deepEqual(parseTrigger('Scroll 35'), { type: 'scroll', ratio: 0.35 });
    assert.deepEqual(parseTrigger('view'), { type: 'view' });
    assert.deepEqual(parseTrigger('LOAD'), { type: 'load' });
    assert.equal(parseTrigger('scroll: 120%'), null);
    assert.equal(parseTrigger('exit intent'), null);
  });

  it('is inline (held) without a trigger, a popup with one', () => {
    const inline = target();
    assert.deepEqual([inline.display, inline.held, inline.trigger], ['inline', true, null]);
    const popup = target({ trigger: 'scroll: 40%' });
    assert.deepEqual([popup.display, popup.held, popup.trigger], ['popup', false, { type: 'scroll', ratio: 0.4 }]);
    const defaulted = target({ display: 'popup' });
    assert.deepEqual([defaulted.held, defaulted.trigger], [false, DEFAULT_TRIGGER]);
    const ignored = target({ display: 'inline', trigger: 'view' });
    assert.deepEqual([ignored.held, ignored.trigger, ignored.warnings], [true, null, ['"Personalization Trigger" is ignored with "Personalization Display | inline"']]);
  });

  it('reads an existing location and rejects bad triggers, displays and locations', () => {
    assert.equal(target({ location: 'hero-mbox' }).location, 'hero-mbox');
    assert.match(target({ location: 'has space' }).errors[0], /"Personalization Location" must be a Target location name/);
    assert.match(target({ trigger: 'exit' }).errors[0], /"Personalization Trigger" must be/);
    assert.match(target({ display: 'banner' }).errors[0], /"Personalization Display" must be inline or popup/);
  });
});

describe('sectionObject (section.schema.json)', () => {
  it('turns a spec into the contract section object', () => {
    assert.deepEqual(sectionObject(parseSection(attrs({
      '': 'newsletter', source: 'target', variants: `${F}/newsletter/signup`, trigger: 'Scroll: 60%', display: 'popup',
    }))), {
      id: 'newsletter',
      source: 'target',
      variants: [{ name: 'signup', fragment: `${F}/newsletter/signup` }],
      trigger: 'scroll: 60%',
      display: 'popup',
    });
  });
});

describe('listedVariant: the allowlist', () => {
  const spec = parseSection(HERO);

  it('finds variants by exact name or by path, and only those', () => {
    assert.equal(listedVariant(spec, { variant: 'india' }).path, `${F}/home-hero/india`);
    assert.equal(listedVariant(spec, { variant: 'INDIA' }), undefined, 'engine names are exact');
    assert.equal(listedVariant(spec, { fragment: `${F}/home-hero/returning` }).name, 'returning');
    assert.equal(listedVariant(spec, { fragment: `${F}/other/returning` }), undefined);
    assert.equal(listedVariant(spec, { fragment: '/etc/evil' }), undefined);
    assert.equal(listedVariant(spec, { variant: 'mars' }), undefined);
    assert.equal(listedVariant(spec, null), undefined);
  });

  it('treats "default" as the authored content', () => {
    assert.deepEqual(listedVariant(spec, { variant: 'default' }), { name: 'default' });
    assert.equal(listedVariant(spec, { variant: null }), undefined);
  });
});

describe('ruleOutcome: top to bottom, first match wins', () => {
  const spec = parseSection(HERO);
  const variant = (result) => result.variant?.name;

  it('takes the first matching rule, else none', async () => {
    assert.deepEqual(await ruleOutcome(spec, { geo: { country: 'IN' } }), {
      variant: { name: 'india', path: `${F}/home-hero/india` }, rule: 'geo: IN',
    });
    assert.equal(variant(await ruleOutcome(spec, { geo: { country: 'US' }, device: 'mobile', visitor: 'returning' })), 'na-mobile');
    assert.equal(variant(await ruleOutcome(spec, { params: { utm_campaign: 'diwali' } })), 'india');
    assert.deepEqual(await ruleOutcome(spec, { geo: { country: 'FR' } }), { none: true });
  });

  it('defers when a browser-only criterion could match first (the edge)', async () => {
    assert.deepEqual(await ruleOutcome(spec, { geo: { country: 'US' } }, { defer: ['device'] }), { deferred: true });
    assert.equal(variant(await ruleOutcome(spec, { geo: { country: 'IN' } }, { defer: ['device'] })), 'india');
  });

  it('without consent (the rules exception) never runs visitor or audience rules', async () => {
    assert.deepEqual(await ruleOutcome(spec, { visitor: 'returning' }, { withoutConsent: true }), { none: true });
    assert.equal(variant(await ruleOutcome(spec, { visitor: 'returning' })), 'returning');
    assert.equal(variant(await ruleOutcome(spec, { geo: { country: 'US' }, device: 'mobile' }, { withoutConsent: true })), 'na-mobile');
    const vip = parseSection(attrs({ '': 'x', variants: `${F}/x/vip`, 'rule-vip': 'audience: vip' }));
    assert.equal(variant(await ruleOutcome(vip, {}, { audiences: { vip: () => true } })), 'vip');
    assert.deepEqual(await ruleOutcome(vip, {}, { audiences: { vip: () => true }, withoutConsent: true }), { none: true });
  });

  it('lists the criteria a section uses', () => {
    assert.deepEqual([...sectionCriteria(spec)].sort(), ['device', 'geo', 'param', 'visitor']);
  });

  it('slugs names', () => {
    assert.equal(slug(' Persona_A '), 'persona-a');
    assert.equal(slug('--Na  Mobile--'), 'na-mobile');
  });
});
