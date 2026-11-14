/*
 * Engine API v1 (contract section 5) and the cache keys (section 10):
 * contract.js.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contract, sectionSpec } from './helpers.mjs';
import { check } from '../schema.mjs';

const {
  buildRequest, sanitizeRequest, parseDecision, parseResponse, sessionKey, sharedKey, candidates,
  placeholder, allowedParams, referrerHost, engineProfile, criteriaOf, MAX_TTL_SECONDS,
  DEFAULT_TTL_SECONDS, ENGINE_PROFILES,
} = contract;

const F = '/fragments/personalization/offer';
const spec = sectionSpec({
  '': 'offer',
  source: 'api',
  variants: `${F}/promo,${F}/india`,
  'rule-promo': 'param: promo=x',
  'rule-india': 'geo: IN',
  hint: 'Show the offer that fits why the visitor came',
  'description-promo': 'Our seasonal promotion',
  'description-default': 'The everyday offer',
});

const fullContext = {
  geo: { country: 'IN', region: 'KA' },
  device: 'mobile',
  visitor: 'returning',
  state: { persona: 'cn' },
  params: {
    utm_campaign: 'diwali', promo: 'x', email: 'a@b.c', token: 'secret',
  },
  referrer: 'espresso-forum.example',
};

describe('buildRequest', () => {
  it('builds a schema-valid v1 body: candidates, fragments, hint, descriptions, allowed params only', () => {
    const body = buildRequest({
      page: { path: '/offers', locale: 'en-IN', title: 'Offers' }, specs: [spec], context: fullContext, consent: true, mode: 'client',
    });
    assert.deepEqual(check('decision-request', body), []);
    assert.equal(body.version, '1');
    assert.deepEqual(body.page, { path: '/offers', locale: 'en-IN', title: 'Offers' });
    assert.deepEqual(body.placeholders, [{
      id: 'offer',
      candidates: ['promo', 'india', 'default'],
      fragments: { promo: `${F}/promo`, india: `${F}/india` },
      hint: 'Show the offer that fits why the visitor came',
      descriptions: { promo: 'Our seasonal promotion', default: 'The everyday offer' },
    }]);
    assert.deepEqual(body.context, {
      geo: { country: 'IN', region: 'KA' },
      device: 'mobile',
      visitor: 'returning',
      state: { persona: 'cn' },
      params: { utm_campaign: 'diwali', promo: 'x' },
      referrer: 'espresso-forum.example',
      consent: { personalization: true },
    });
    assert.equal(body.mode, 'client');
  });

  it('without consent (the api exception) carries request data only', () => {
    const body = buildRequest({
      page: { path: '/' }, specs: [spec], context: fullContext, consent: false, mode: 'edge',
    });
    assert.deepEqual(check('decision-request', body), []);
    assert.equal(body.context.state, undefined);
    assert.equal(body.context.visitor, undefined);
    assert.deepEqual(body.context.consent, { personalization: false });
    assert.deepEqual(body.context.geo, { country: 'IN', region: 'KA' });
    assert.equal(body.mode, 'edge');
    assert.equal('locale' in body.page, false);
  });

  it('never sends a guessed or malformed geo, or a referrer with a path', () => {
    const body = buildRequest({
      page: { path: '/' },
      specs: [spec],
      context: { geo: { country: 'india' }, referrer: 'https://x.example/path?q=1' },
      consent: true,
      mode: 'client',
    });
    assert.equal(body.context.geo, undefined);
    assert.equal(body.context.referrer, undefined);
    assert.deepEqual(check('decision-request', body), []);
  });

  it('lists candidates in Variants order, then default', () => {
    assert.deepEqual(candidates(spec), ['promo', 'india', 'default']);
    assert.deepEqual(placeholder(sectionSpec({ '': 'x', source: 'api', variants: `${F}/a` })), {
      id: 'x', candidates: ['a', 'default'], fragments: { a: `${F}/a` },
    });
  });

  it('only utm_* params and params named in param: rules reach an engine', () => {
    assert.deepEqual(allowedParams(fullContext.params, [spec]), { utm_campaign: 'diwali', promo: 'x' });
    assert.deepEqual(allowedParams(undefined, [spec]), {});
    assert.deepEqual([...criteriaOf([spec])].sort(), ['geo', 'param']);
  });

  it('keeps only another site\'s host as referrer', () => {
    assert.equal(referrerHost('https://www.Google.com/search?q=x', 'www.example.com'), 'www.google.com');
    assert.equal(referrerHost('https://www.example.com/a', 'www.example.com'), undefined);
    assert.equal(referrerHost('', 'www.example.com'), undefined);
    assert.equal(referrerHost('not a url', 'www.example.com'), undefined);
  });

  it('profiles only set limits (generic default, of1 slow with descriptions)', () => {
    assert.equal(engineProfile('nope'), ENGINE_PROFILES.generic);
    assert.deepEqual([ENGINE_PROFILES.generic.sections, ENGINE_PROFILES.generic.maxCandidates], [20, 21]);
    assert.deepEqual([ENGINE_PROFILES.of1.sections, ENGINE_PROFILES.of1.maxCandidates], [8, 10]);
    assert.equal(engineProfile('of1').slow, true);
    assert.equal(engineProfile('of1').descriptions, true);
    // Whether setState() re-decides api sections: unknown engines may read state, OF1 doesn't.
    assert.deepEqual([engineProfile('generic').state, engineProfile('nope').state, engineProfile('of1').state], [true, true, false]);
  });
});

describe('sanitizeRequest (server route)', () => {
  const sent = buildRequest({
    page: { path: '/offers' }, specs: [spec], context: fullContext, consent: true, mode: 'client',
  });

  it('rebuilds a request from contract fields only', () => {
    const clean = sanitizeRequest({
      ...sent,
      extra: 'x',
      context: { ...sent.context, ip: '1.2.3.4', email: 'a@b.c' },
      placeholders: [{ ...sent.placeholders[0], secret: 'x' }],
    });
    assert.deepEqual(clean, sent);
    assert.deepEqual(check('decision-request', clean), []);
  });

  it('rejects what is not a v1 request', () => {
    assert.equal(sanitizeRequest(null), null);
    assert.equal(sanitizeRequest({ ...sent, version: '2' }), null);
    assert.equal(sanitizeRequest({ ...sent, placeholders: [] }), null);
    assert.equal(sanitizeRequest({ ...sent, placeholders: [{ id: 'x', candidates: ['a'] }] }), null, 'default is a candidate');
    assert.equal(sanitizeRequest({ ...sent, placeholders: [{ id: 'Bad Id', candidates: ['default'] }] }), null);
  });

  it('drops fragments outside the prefixes and keeps consent strictly boolean', () => {
    const clean = sanitizeRequest({
      ...sent,
      placeholders: [{ ...sent.placeholders[0], fragments: { promo: 'https://evil.example/x', india: `${F}/india` } }],
      context: { ...sent.context, consent: { personalization: 'yes' } },
    });
    assert.deepEqual(clean.placeholders[0].fragments, { india: `${F}/india` });
    assert.deepEqual(clean.context.consent, { personalization: false });
  });
});

describe('parseDecision: exactly one of four answers, plus tracking', () => {
  it('accepts the four kinds', () => {
    assert.deepEqual(parseDecision({ variant: 'pro', tracking: { requestId: 'r' } }), { variant: 'pro', tracking: { requestId: 'r' } });
    assert.deepEqual(parseDecision({ variant: 'default' }), { variant: 'default' });
    assert.deepEqual(parseDecision({ fragment: `${F}/promo` }), { fragment: `${F}/promo` });
    assert.deepEqual(parseDecision({ control: true }), { control: true });
    assert.deepEqual(parseDecision({ reason: 'low_confidence' }), { reason: 'low_confidence' });
  });

  it('marks anything else invalid, keeping tracking', () => {
    const invalid = (value) => parseDecision(value).invalid;
    assert.ok(invalid(null));
    assert.ok(invalid({}));
    assert.ok(invalid({ variant: 'a', reason: 'x' }));
    assert.ok(invalid({ variant: 'a', fragment: `${F}/a` }));
    assert.ok(invalid({ control: false }));
    assert.ok(invalid({ variant: null }));
    assert.ok(invalid({ variant: 42 }));
    assert.ok(invalid({ fragment: 'https://x.example/a' }));
    assert.ok(invalid({ reason: 'low confidence' }));
    assert.ok(invalid({ variant: 'a', extra: 1 }));
    assert.deepEqual(parseDecision({ control: true, variant: 'a', tracking: { t: 1 } }).tracking, { t: 1 });
  });
});

describe('parseResponse', () => {
  it('parses each section, ignoring unknown top-level fields', () => {
    const result = parseResponse({
      decisions: {
        a: { variant: 'india', tracking: { t: 1 } },
        b: { variant: null },
        c: { fragment: '/fragments/c/x' },
        'Bad Id': { variant: 'x' },
      },
      ttl: 60,
      cacheable: true,
      other: 'ignored',
    });
    assert.deepEqual(Object.keys(result.decisions), ['a', 'b', 'c']);
    assert.deepEqual(result.decisions.a, { variant: 'india', tracking: { t: 1 } });
    assert.ok(result.decisions.b.invalid);
    assert.deepEqual([result.ttl, result.cacheable], [60, true]);
  });

  it('caps and defaults ttl; cacheable must be literally true', () => {
    assert.equal(parseResponse({ decisions: {}, ttl: 99999 }).ttl, MAX_TTL_SECONDS);
    assert.equal(parseResponse({ decisions: {}, ttl: -1 }).ttl, DEFAULT_TTL_SECONDS);
    assert.equal(parseResponse({ decisions: {} }).ttl, 300);
    assert.equal(parseResponse({ decisions: {}, ttl: 0 }).ttl, 0);
    assert.equal(parseResponse({ decisions: {}, cacheable: 'yes' }).cacheable, false);
  });

  it('throws on non-contract bodies', () => {
    assert.throws(() => parseResponse(null), /not a JSON object/);
    assert.throws(() => parseResponse([]), /not a JSON object/);
    assert.throws(() => parseResponse({}), /no "decisions"/);
    assert.throws(() => parseResponse({ decisions: [] }), /no "decisions"/);
  });
});

describe('cache keys (section 10)', () => {
  const request = (context, extra = {}) => buildRequest({
    page: { path: '/' }, specs: [spec], context, consent: !!context.visitor, mode: 'edge', ...extra,
  });

  it('sessionKey is stable across key order and ignores mode', () => {
    const a = { page: { path: '/' }, placeholders: [{ id: 'x' }], context: { geo: { country: 'IN' }, device: 'mobile' }, mode: 'client' };
    const b = { mode: 'edge', context: { device: 'mobile', geo: { country: 'IN' } }, placeholders: [{ id: 'x' }], page: { path: '/' } };
    assert.equal(sessionKey(a), sessionKey(b));
    assert.notEqual(sessionKey(a), sessionKey({ ...a, context: { geo: { country: 'US' } } }));
  });

  it('sharedKey covers path, sections, geo, device, params, referrer, policy and Last-Modified', () => {
    const base = request({ geo: { country: 'US' }, params: { utm_source: 'x' }, referrer: 'a.example' });
    const key = sharedKey(base, { policy: ['rules', 'api'], lastModified: 'Mon' });
    assert.equal(key, sharedKey(base, { policy: ['api', 'rules'], lastModified: 'Mon' }), 'policy order does not matter');
    assert.notEqual(key, sharedKey(base, { policy: ['api'], lastModified: 'Mon' }));
    assert.notEqual(key, sharedKey(base, { policy: ['rules', 'api'], lastModified: 'Tue' }), 'republished content is a new key');
    assert.notEqual(key, sharedKey(request({ geo: { country: 'IN' }, params: { utm_source: 'x' }, referrer: 'a.example' }), { policy: ['rules', 'api'], lastModified: 'Mon' }));
    assert.notEqual(key, sharedKey(request({ geo: { country: 'US' }, params: { utm_source: 'y' }, referrer: 'a.example' }), { policy: ['rules', 'api'], lastModified: 'Mon' }));
    assert.notEqual(key, sharedKey(request({ geo: { country: 'US' }, params: { utm_source: 'x' }, referrer: 'b.example' }), { policy: ['rules', 'api'], lastModified: 'Mon' }));
    assert.notEqual(key, sharedKey({ ...base, page: { path: '/other' } }, { policy: ['rules', 'api'], lastModified: 'Mon' }));
    assert.notEqual(key, sharedKey({ ...base, placeholders: [{ ...base.placeholders[0], hint: 'other' }] }, { policy: ['rules', 'api'], lastModified: 'Mon' }));
  });

  it('a request carrying visitor or state is never shared', () => {
    assert.equal(sharedKey(request({ visitor: 'new' })), null);
    assert.equal(sharedKey(request({ visitor: 'returning', state: { a: 'b' } })), null);
  });
});
