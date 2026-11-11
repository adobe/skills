/*
 * Contract conformance (contract v0.5): the contract's own examples
 * (fixtures/contract/examples, copied from the contract repo) against the
 * vendored schemas and the skill's runtime modules; the OF1 adapter against
 * OF1's live samples (fixtures/contract/of1-native); and the pilot
 * scenarios (assets/contract/pilot-scenarios.json) through the shared
 * decision model. The browser and edge replays of the scenarios are in
 * sections.test.mjs, edge.test.mjs and verify-preview.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { ASSETS_DIR, EDGE_DIR, RUNTIME_DIR } from '../lib.mjs';
import { check } from '../schema.mjs';
import { FIXTURES } from './helpers.mjs';

const load = (...parts) => import(pathToFileURL(join(RUNTIME_DIR, 'scripts', 'personalization', ...parts)).href);
const {
  parseSection, sectionObject, ruleOutcome, drawSplit,
} = await load('section-spec.js');
const { buildRequest, sanitizeRequest, parseResponse } = await load('contract.js');
const {
  engineOutcome, rulesOutcome, makeDecision, resultFor, eventPayload, identity, decisionAttributes,
  RULE_FALLBACK,
} = await load('outcomes.js');
const { readOffer } = await load('sources', 'target.js');
const { createOf1Adapter, acquisitionSource } = await import(pathToFileURL(join(EDGE_DIR, 'src', 'personalization', 'adapters', 'of1.js')).href);

const EXAMPLES = join(FIXTURES, 'contract', 'examples');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const jsonFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.json')).sort() : []);
const examples = (name, invalid = false) => {
  const dir = invalid ? join(EXAMPLES, name, 'invalid') : join(EXAMPLES, name);
  return jsonFiles(dir).map((file) => [file, read(join(dir, file))]);
};
const KINDS = readdirSync(EXAMPLES, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

// Whether every field of `expected` is in `actual` with the same value.
const contains = (actual, expected) => {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length
      && expected.every((value, i) => contains(actual[i], value));
  }
  if (expected && typeof expected === 'object') {
    return !!actual && typeof actual === 'object'
      && Object.entries(expected).every(([key, value]) => contains(actual[key], value));
  }
  return actual === expected;
};

describe('schemas: every contract example', () => {
  it('has a vendored schema for every example kind', () => {
    const schemas = readdirSync(join(ASSETS_DIR, 'contract', 'schemas')).map((file) => file.replace('.schema.json', '')).sort();
    assert.deepEqual(KINDS, schemas);
  });

  KINDS.forEach((name) => {
    examples(name).forEach(([file, value]) => it(`${name}/${file} is valid`, () => {
      assert.deepEqual(check(name, value), []);
    }));
    examples(name, true).forEach(([file, value]) => it(`${name}/invalid/${file} is rejected`, () => {
      assert.notDeepEqual(check(name, value), []);
    }));
  });
});

// A section object as the Section Metadata rows the pipeline renders.
function sectionAttributes(section) {
  const rows = [['data-personalization', section.id]];
  if (section.source) rows.push(['data-personalization-source', section.source]);
  if (section.variants) rows.push(['data-personalization-variants', section.variants.map((variant) => variant.fragment).join(',')]);
  const seen = {};
  (section.rules || []).forEach(({ variant, condition }) => {
    seen[variant] = (seen[variant] || 0) + 1;
    rows.push([`data-personalization-rule-${variant}${seen[variant] > 1 ? `-${seen[variant]}` : ''}`, condition]);
  });
  if (section.split) rows.push(['data-personalization-split', section.split.join(', ')]);
  if (section.hint) rows.push(['data-personalization-hint', section.hint]);
  Object.entries(section.descriptions || {}).forEach(([name, text]) => rows.push([`data-personalization-description-${name}`, text]));
  ['location', 'trigger', 'display'].filter((key) => section[key] !== undefined)
    .forEach((key) => rows.push([`data-personalization-${key}`, section[key]]));
  return rows;
}

describe('section examples through parseSection', () => {
  examples('section').forEach(([file, section]) => it(`${file} round-trips`, () => {
    const spec = parseSection(sectionAttributes(section));
    assert.deepEqual(spec.errors, []);
    const object = sectionObject(spec);
    assert.deepEqual(object, section);
    assert.deepEqual(check('section', object), []);
  }));

  examples('section', true).forEach(([file, section]) => it(`invalid/${file} is refused or normalized`, () => {
    const spec = parseSection(sectionAttributes(section));
    if (spec.errors.length) return;
    // Links are reduced to their path: an absolute URL never loads from another origin.
    const object = sectionObject(spec);
    assert.notDeepEqual(object, section);
    assert.deepEqual(check('section', object), []);
  }));

  it('refuses every invalid example the grammar can see (all but absolute URLs)', () => {
    const accepted = examples('section', true)
      .filter(([, section]) => !parseSection(sectionAttributes(section)).errors.length).map(([file]) => file);
    assert.deepEqual(accepted, ['absolute-fragment-url.json']);
  });
});

describe('decision-request examples through the server route', () => {
  examples('decision-request').forEach(([file, request]) => it(`${file} is forwarded as sent`, () => {
    const clean = sanitizeRequest(request);
    assert.ok(clean);
    assert.deepEqual(check('decision-request', clean), []);
    const { mode, ...rest } = request;
    assert.ok(contains(clean, rest), JSON.stringify(clean));
  }));

  examples('decision-request', true).forEach(([file, request]) => it(`invalid/${file} is refused or cleaned`, () => {
    const clean = sanitizeRequest(request);
    if (clean) assert.deepEqual(check('decision-request', clean), []);
  }));

  it('the runtime builds schema-valid requests, with and without consent', () => {
    const spec = parseSection(sectionAttributes(read(join(EXAMPLES, 'section', 'api-of1-hint.json'))));
    const context = {
      geo: { country: 'US', region: 'CA' }, device: 'desktop', visitor: 'returning', state: { quiz: 'a' }, params: { utm_source: 'x' }, referrer: 'espresso-forum.example',
    };
    [true, false].forEach((consent) => ['client', 'edge'].forEach((mode) => {
      const body = buildRequest({
        page: { path: '/', title: 'Home' }, specs: [spec], context, consent, mode,
      });
      assert.deepEqual(check('decision-request', body), [], `consent ${consent}, ${mode}`);
    }));
  });
});

describe('decision-response examples through parseResponse', () => {
  examples('decision-response').forEach(([file, response]) => it(`${file} is read without invalid answers`, () => {
    const { decisions } = parseResponse(response);
    Object.entries(decisions).forEach(([id, decision]) => assert.equal(decision.invalid, undefined, id));
  }));

  examples('decision-response', true).forEach(([file, response]) => it(`invalid/${file} is refused`, () => {
    let parsed;
    try {
      parsed = parseResponse(response);
    } catch (e) {
      return;
    }
    assert.ok(Object.values(parsed.decisions).some((decision) => decision.invalid), JSON.stringify(parsed));
  }));
});

describe('target-offer examples through readOffer', () => {
  examples('target-offer').forEach(([file, offer]) => it(`${file} is an offer`, () => {
    assert.equal(readOffer(offer).invalid, undefined);
  }));
  examples('target-offer', true).forEach(([file, offer]) => it(`invalid/${file} is refused`, () => {
    assert.ok(readOffer(offer).invalid);
  }));
});

describe('split boundaries (section 6a)', () => {
  const spec = (split, variants = 2) => parseSection([
    ['data-personalization', 'msg'], ['data-personalization-source', 'split'],
    ['data-personalization-variants', Array.from({ length: variants }, (_, i) => `/fragments/m/v${i}`).join(',')],
    ...(split ? [['data-personalization-split', split]] : []),
  ]);

  it('40, 30: [0, 0.4) first, [0.4, 0.7) second, [0.7, 1) control', () => {
    const s = spec('40, 30');
    [[0, 'v0'], [0.39999, 'v0'], [0.4, 'v1'], [0.69999, 'v1'], [0.7, 'default'], [0.99999, 'default']]
      .forEach(([n, arm]) => assert.equal(drawSplit(s, n), arm, String(n)));
  });

  it('no Split row: even across control and variants; 0, 100: a rollout', () => {
    const even = spec(null);
    [[0, 'v0'], [0.3333, 'v0'], [0.3334, 'v1'], [0.6666, 'v1'], [0.6667, 'default']]
      .forEach(([n, arm]) => assert.equal(drawSplit(even, n), arm, String(n)));
    [0, 0.5, 0.99999].forEach((n) => assert.equal(drawSplit(spec('0, 100'), n), 'v1'));
    [0, 0.99999].forEach((n) => assert.equal(drawSplit(spec('0, 0'), n), 'default', 'the default gets the rest'));
  });
});

describe('OF1 adapter against the live samples', () => {
  const native = (name) => read(join(FIXTURES, 'contract', 'of1-native', `${name}.json`));
  const v1 = {
    version: '1',
    page: { path: '/', title: 'Intuit Enterprise Suite' },
    placeholders: [{
      id: 'home-hero',
      candidates: ['pro', 'deals', 'default'],
      fragments: { pro: '/fragments/personalization/home-hero/pro', deals: '/fragments/personalization/home-hero/deals' },
      hint: 'Show the hero that best matches why the visitor came: …',
      descriptions: {
        default: 'Intuit Enterprise Suite: the all-in-one platform for growing mid-market businesses.',
        pro: 'Multi-entity accounting and consolidation for finance leaders managing several entities.',
        deals: 'Payroll and HR for growing teams: run payroll, benefits and compliance in one place.',
      },
    }],
    context: { referrer: 'www.google.com', params: {}, consent: { personalization: true } },
    mode: 'edge',
  };
  const of1 = createOf1Adapter({ tenant: 'aemsites/intuit-erp', newRequestId: () => 'sample-variant-1' });

  it('the v1 request used here is valid', () => {
    assert.deepEqual(check('decision-request', v1), []);
  });

  it('mapRequest builds the native request of the sample, without profile signals', () => {
    const { body, init } = of1.mapRequest(v1);
    const sample = native('request');
    assert.equal(init.headers['x-of1-request-id'], 'sample-variant-1');
    assert.equal(body.id, sample.id);
    assert.equal(body.index, sample.index);
    assert.deepEqual(body.page, sample.page);
    assert.deepEqual(body.decisions, sample.decisions);
    assert.deepEqual(body.signals, { acquisition: { source: 'search' }, audiences: [] });
  });

  [
    ['response-variant', { variant: 'pro' }, 'variant'],
    ['response-intentional-default', { variant: 'default' }, 'intentional-default'],
    ['response-low-confidence', { reason: 'low_confidence' }, 'low-confidence'],
    ['response-provider-error', { reason: 'provider_error' }, 'fallback'],
  ].forEach(([file, expected, outcome]) => it(`mapResponse: ${file} → ${outcome}`, () => {
    const sample = native(file);
    const mapped = of1.mapResponse(sample, v1);
    assert.deepEqual(check('decision-response', mapped), []);
    const { tracking, ...decision } = mapped.decisions['home-hero'];
    assert.deepEqual(decision, expected);
    assert.equal(tracking.engine, 'of1');
    assert.equal(tracking.requestId, sample.requestId);
    // Through the runtime: the outcome the contract names.
    const spec = parseSection([
      ['data-personalization', 'home-hero'], ['data-personalization-source', 'api'],
      ['data-personalization-variants', '/fragments/personalization/home-hero/pro,/fragments/personalization/home-hero/deals'],
    ]);
    assert.equal(engineOutcome(spec, parseResponse(mapped).decisions['home-hero']).outcome, outcome);
  }));

  it('a fallback carrying choice c0 is never read as an intentional default', () => {
    assert.equal(of1.mapResponse(native('response-low-confidence'), v1).decisions['home-hero'].variant, undefined);
  });

  it('edge cases: missing decision, out-of-range choice, fallback without reason, null confidence', () => {
    const answer = (d) => of1.mapResponse({ decisions: { 'home-hero': d }, requestId: 'r' }, v1).decisions['home-hero'];
    assert.equal(of1.mapResponse({ decisions: {} }, v1).decisions['home-hero'], undefined);
    assert.equal(answer({ choice: 'c9', fallback: false, reason: null }).reason, 'invalid_choice');
    assert.equal(answer({ choice: 'c0', fallback: true, reason: null }).reason, 'unspecified');
    assert.equal(answer({ choice: 'c0', confidence: null, fallback: true, reason: 'provider_error' }).tracking.confidence, undefined);
    assert.throws(() => createOf1Adapter({}), /tenant is required/);
  });

  it('acquisition source uses only the contract context', () => {
    assert.equal(acquisitionSource({ params: { utm_source: 'news' } }), 'campaign');
    assert.equal(acquisitionSource({ referrer: 'www.bing.com', params: {} }), 'search');
    assert.equal(acquisitionSource({ referrer: 'espresso-forum.example', params: {} }), 'referral');
    assert.equal(acquisitionSource({ params: {} }), 'direct');
  });
});

describe('pilot scenarios through the decision model', () => {
  const { scenarios } = read(join(ASSETS_DIR, 'contract', 'pilot-scenarios.json'));
  // The pilot's sections (pilot.md, of1-worked-example.md, section examples).
  const SPECS = {
    'home-hero': parseSection(sectionAttributes(read(join(EXAMPLES, 'section', 'api-of1-hint.json')))),
    promo: parseSection(sectionAttributes(read(join(EXAMPLES, 'section', 'api-with-fallback-rules.json')))),
  };
  const WHERE = { 'home-hero': 'edge', promo: 'browser' };

  it('covers the agreed cases', () => {
    const required = scenarios.filter((s) => s.pilot === 'required').map((s) => s.id);
    ['selected-variant', 'intentional-default', 'low-confidence-rules', 'provider-fallback', 'cache-hit', 'consent-withdrawal']
      .forEach((id) => assert.ok(required.includes(id), id));
  });

  // Contract section 4: the engine's answer, then (api sections) the Rule rows.
  async function decide(spec, answer, context, cached) {
    const engine = engineOutcome(spec, parseResponse(answer).decisions[spec.id]);
    if (cached) engine.cached = true;
    if (RULE_FALLBACK.includes(engine.outcome) && spec.rules.length) {
      return {
        ...rulesOutcome(await ruleOutcome(spec, context)), source: 'rules', outcome: engine.outcome, reason: engine.reason, tracking: engine.tracking, cached: engine.cached,
      };
    }
    return { source: 'api', ...engine };
  }

  scenarios.forEach((scenario) => it(`${scenario.id}: attributes and events`, async () => {
    const id = scenario.steps[0].attributes['data-pzn-decision'].split('#')[0];
    const spec = SPECS[id];
    const where = WHERE[id];
    const context = { geo: scenario.context.geo, params: scenario.context.params };
    let current = null;
    let count = 0;
    for (const step of scenario.steps) {
      /* eslint-disable no-await-in-loop */
      let fields;
      if (step.answer) {
        // A reused session-cache answer within the page view is not "cached" (section 9).
        fields = await decide(spec, step.answer, context, false);
        fields.trigger = current ? 'refresh' : 'initial';
      } else {
        fields = {
          source: spec.source, outcome: 'no-consent', variant: 'default', trigger: 'consent',
        };
      }
      const candidate = makeDecision({ id, where, ...fields });
      const same = current && identity(candidate) === identity(current);
      if (!same) {
        count += 1;
        candidate.decisionId = `${id}#${count}`;
        Object.assign(candidate, { shown: candidate.variant, result: resultFor(candidate, candidate.variant, current ? current.shown : null) });
      }
      const decision = same ? current : candidate;
      const attributes = Object.fromEntries(Object.entries(decisionAttributes(decision, 'applied'))
        .filter(([name]) => where === 'edge' || !['pzn-where', 'pzn-status'].includes(name))
        .map(([name, value]) => [`data-${name}`, value]));
      Object.entries(step.attributes).forEach(([name, value]) => assert.equal(attributes[name], value, `${step.step}: ${name}`));
      const measured = step.answer !== null && step.answer !== undefined;
      const events = same || !measured ? [] : step.events.map(({ event }) => ({
        event,
        personalization: eventPayload(event, decision, event === 'pzn:clicked'
          ? { href: step.events.find((e) => e.event === 'pzn:clicked').personalization.href } : {}),
      }));
      assert.deepEqual(events, step.events, step.step);
      events.forEach((event) => assert.deepEqual(check('measurement-event', event), [], `${step.step}: ${event.event}`));
      current = decision;
      /* eslint-enable no-await-in-loop */
    }
  }));
});
