import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contract, rows, rules } from './helpers.mjs';

const {
  buildRequest, parseResponse, cacheKey, candidates, allowedParams, MAX_TTL_SECONDS, DEFAULT_TTL_SECONDS,
} = contract;

const spec = rules.parseSpec(rows([
  ['id', 'offer'],
  ['source', 'api'],
  ['param: promo=x', '/fragments/offer/promo'],
  ['geo: IN', '/fragments/offer/india'],
  ['default', 'none'],
]));

const fullContext = {
  geo: { country: 'IN' },
  device: 'mobile',
  visitor: 'returning',
  state: { persona: 'cn' },
  params: {
    utm_campaign: 'diwali', promo: 'x', email: 'a@b.c', token: 'secret',
  },
};

describe('buildRequest', () => {
  it('builds a v1 body with candidates and allowed params only', () => {
    const body = buildRequest({
      path: '/offers', locale: 'en-IN', specs: [spec], context: fullContext, consent: true, mode: 'client',
    });
    assert.equal(body.version, '1');
    assert.deepEqual(body.page, { path: '/offers', locale: 'en-IN' });
    assert.deepEqual(body.placeholders, [{ id: 'offer', candidates: ['promo', 'india', 'default'] }]);
    assert.deepEqual(body.context.params, { utm_campaign: 'diwali', promo: 'x' });
    assert.deepEqual(body.context.state, { persona: 'cn' });
    assert.equal(body.context.visitor, 'returning');
    assert.deepEqual(body.context.consent, { personalization: true });
    assert.equal(body.mode, 'client');
  });

  it('drops stored context without consent', () => {
    const body = buildRequest({
      path: '/', specs: [spec], context: fullContext, consent: false, mode: 'edge',
    });
    assert.equal(body.context.state, undefined);
    assert.equal(body.context.visitor, undefined);
    assert.deepEqual(body.context.consent, { personalization: false });
    assert.equal('locale' in body.page, false);
  });

  it('keeps visitor without consent when a rule needs it', () => {
    const visitorSpec = rules.parseSpec(rows([['id', 'w'], ['visitor: returning', '/fragments/w/back'], ['default', 'none']]));
    const body = buildRequest({
      path: '/', specs: [visitorSpec], context: { visitor: 'new' }, consent: false, mode: 'client',
    });
    assert.equal(body.context.visitor, 'new');
  });

  it('candidates are unique and end with default', () => {
    assert.deepEqual(candidates({ rules: [{ variant: 'a' }, { variant: 'a' }] }), ['a', 'default']);
    assert.deepEqual(allowedParams(undefined, [spec]), {});
  });
});

describe('parseResponse', () => {
  it('keeps valid decisions and drops malformed ones', () => {
    const result = parseResponse({
      decisions: {
        a: { variant: 'india', tracking: { t: 1 }, extra: 'x' },
        b: { variant: null },
        c: { fragment: '/fragments/c/x' },
        d: { variant: 42 },
        e: null,
      },
      ttl: 60,
      cacheable: true,
    });
    assert.deepEqual(result, {
      decisions: { a: { variant: 'india', tracking: { t: 1 } }, b: { variant: null }, c: { fragment: '/fragments/c/x' } },
      ttl: 60,
      cacheable: true,
    });
  });

  it('caps and defaults ttl; cacheable must be literally true', () => {
    assert.equal(parseResponse({ decisions: {}, ttl: 99999 }).ttl, MAX_TTL_SECONDS);
    assert.equal(parseResponse({ decisions: {}, ttl: -1 }).ttl, DEFAULT_TTL_SECONDS);
    assert.equal(parseResponse({ decisions: {}, cacheable: 'yes' }).cacheable, false);
  });

  it('throws on non-contract bodies', () => {
    assert.throws(() => parseResponse(null), /not a JSON object/);
    assert.throws(() => parseResponse([]), /not a JSON object/);
    assert.throws(() => parseResponse({}), /no "decisions"/);
    assert.throws(() => parseResponse({ decisions: [] }), /no "decisions"/);
  });
});

describe('cacheKey', () => {
  it('is stable across key order and ignores mode', () => {
    const a = { page: { path: '/' }, placeholders: [{ id: 'x' }], context: { geo: { country: 'IN' }, device: 'mobile' }, mode: 'client' };
    const b = { mode: 'edge', context: { device: 'mobile', geo: { country: 'IN' } }, placeholders: [{ id: 'x' }], page: { path: '/' } };
    assert.equal(cacheKey(a), cacheKey(b));
    assert.notEqual(cacheKey(a), cacheKey({ ...a, context: { geo: { country: 'US' } } }));
  });
});
