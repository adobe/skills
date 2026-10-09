import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { context } from './helpers.mjs';

const {
  parseCookies, parseGeo, readGeo, getDevice, getVisitor, syncConsentCookie, isBot, readParams,
  overridesEnabled, readOverrides, loadState, saveState, STATE_STORAGE_KEY,
} = context;

describe('cookies and geo', () => {
  it('parses cookies, tolerating bad encoding', () => {
    assert.deepEqual(parseCookies('a=1; b=hello%20world; c; d=%E0%A4'), {
      a: '1', b: 'hello world', c: '', d: '%E0%A4',
    });
    assert.deepEqual(parseCookies(undefined), {});
  });

  it('parses country and region codes', () => {
    assert.deepEqual(parseGeo('in'), { country: 'IN' });
    assert.deepEqual(parseGeo('US-ca'), { country: 'US', region: 'CA' });
    assert.equal(parseGeo('India'), null);
    assert.equal(parseGeo(''), null);
  });

  it('reads geo from the edge meta tag before the cookie', () => {
    const doc = (content) => ({ querySelector: () => (content ? { content } : null) });
    assert.deepEqual(readGeo(doc('IN-KA'), { 'pzn-geo': 'US' }), { country: 'IN', region: 'KA' });
    assert.deepEqual(readGeo(doc(null), { 'pzn-geo': 'US' }), { country: 'US' });
    assert.equal(readGeo(doc(null), {}), null);
  });

  it('picks the first matching device query', () => {
    const devices = { mobile: '(max-width: 599px)', tablet: '(max-width: 899px)', desktop: '(min-width: 900px)' };
    const matchMedia = (query) => ({ matches: query !== '(max-width: 599px)' });
    assert.equal(getDevice(devices, matchMedia), 'tablet');
    assert.equal(getDevice({}, matchMedia), undefined);
  });
});

describe('visitor and consent', () => {
  it('is new without cookies and writes nothing without consent', () => {
    const written = [];
    assert.equal(getVisitor({}, false, (c) => written.push(c)), 'new');
    assert.deepEqual(written, []);
  });

  it('is returning with the seen cookie and sticky for the session', () => {
    assert.equal(getVisitor({ 'pzn-seen': '1' }, false), 'returning');
    // First page of a new visit: seen is written now, but the session stays new.
    assert.equal(getVisitor({ 'pzn-seen': '1', 'pzn-vs': 'new' }, true, () => {}), 'new');
    const written = [];
    assert.equal(getVisitor({}, true, (c) => written.push(c)), 'new');
    assert.equal(written.length, 2);
    assert.match(written[0], /^pzn-seen=1;.*max-age=31536000/);
    assert.match(written[1], /^pzn-vs=new; path=\/; SameSite=Lax; Secure$/);
  });

  it('mirrors consent into a cookie and clears storage on withdrawal', () => {
    const granted = [];
    syncConsentCookie(true, {}, (c) => granted.push(c));
    assert.match(granted[0], /^pzn-consent=1/);
    const unchanged = [];
    syncConsentCookie(true, { 'pzn-consent': '1' }, (c) => unchanged.push(c));
    assert.deepEqual(unchanged, []);
    const withdrawn = [];
    syncConsentCookie(false, { 'pzn-consent': '1' }, (c) => withdrawn.push(c));
    assert.deepEqual(withdrawn.map((c) => c.split('=')[0]), ['pzn-consent', 'pzn-seen', 'pzn-vs']);
    assert.ok(withdrawn.every((c) => c.includes('max-age=0')));
  });
});

describe('bots, params and overrides', () => {
  it('detects crawlers and audit tools', () => {
    assert.equal(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)'), true);
    assert.equal(isBot('Mozilla/5.0 ... Chrome-Lighthouse'), true);
    assert.equal(isBot('Mozilla/5.0 HeadlessChrome/140'), true);
    assert.equal(isBot('Mozilla/5.0 (Macintosh) Chrome/140 Safari/537.36'), false);
    assert.equal(isBot(undefined), false);
  });

  it('reads params without pzn overrides, first value wins', () => {
    const params = readParams(new URLSearchParams('a=1&a=2&pzn=x:y&pzn-geo=IN&utm_source=n'));
    assert.deepEqual(params, { a: '1', utm_source: 'n' });
  });

  it('enables overrides on preview hosts only by default', () => {
    assert.equal(overridesEnabled('preview', 'main--site--org.aem.page'), true);
    assert.equal(overridesEnabled('preview', 'main--site--org.hlx.page'), true);
    assert.equal(overridesEnabled('preview', 'localhost'), true);
    assert.equal(overridesEnabled('preview', 'main--site--org.aem.live'), false);
    assert.equal(overridesEnabled('preview', 'www.example.com'), false);
    assert.equal(overridesEnabled('always', 'www.example.com'), true);
    assert.equal(overridesEnabled('never', 'localhost'), false);
  });

  it('reads every override', () => {
    const overrides = readOverrides(new URLSearchParams(
      'pzn=hero:india,welcome:default,bad&pzn-geo=us-ca&pzn-device=mobile&pzn-visitor=returning&pzn-state=quiz:cn&pzn-audience=vip,beta&pzn-consent=1&pzn-debug',
    ));
    assert.deepEqual(overrides, {
      any: true,
      forced: { hero: 'india', welcome: 'default' },
      context: {
        geo: { country: 'US', region: 'CA' }, device: 'mobile', visitor: 'returning', state: { quiz: 'cn' },
      },
      audiences: ['vip', 'beta'],
      consent: true,
      debug: true,
    });
    assert.equal(readOverrides(new URLSearchParams('utm_source=x')).any, false);
    assert.equal(readOverrides(new URLSearchParams('pzn-consent=0')).consent, false);
    assert.equal(readOverrides(new URLSearchParams('utm_source=x')).consent, undefined);
  });

  it('treats pzn-debug as logging, not as an override', () => {
    const overrides = readOverrides(new URLSearchParams('pzn-debug'));
    assert.equal(overrides.any, false);
    assert.equal(overrides.debug, true);
  });
});

describe('state storage', () => {
  const memory = () => {
    const data = {};
    return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, data };
  };

  it('round-trips and ignores corrupt or blocked storage', () => {
    const storage = memory();
    saveState(storage, { quiz: 'cn' });
    assert.deepEqual(loadState(storage), { quiz: 'cn' });
    storage.data[STATE_STORAGE_KEY] = '[1]';
    assert.deepEqual(loadState(storage), {});
    storage.data[STATE_STORAGE_KEY] = '{bad';
    assert.deepEqual(loadState(storage), {});
    assert.deepEqual(loadState(undefined), {});
    assert.doesNotThrow(() => saveState({ setItem: () => { throw new Error('quota'); } }, {}));
  });
});
