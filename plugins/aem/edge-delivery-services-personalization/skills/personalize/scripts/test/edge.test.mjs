/*
 * The edge worker (assets/edge/cloudflare) against the contract: consent and
 * exceptions (section 3), decisions and outcomes (4, 5), the three edge
 * results and the data-pzn-* handoff (8), the shared answer cache and
 * headers (10), the server route and the worker entry point.
 */

import assert from 'node:assert/strict';
import {
  after, before, describe, it,
} from 'node:test';
import { edgeBundle, fixture, html } from './helpers.mjs';

const bundle = edgeBundle();
const {
  personalizeResponse, handleApiRoute, edgeContext, absolutizeUrls, fragmentMarkup, fillDescriptions,
  authoredText, approvedExceptions, consentCookie,
} = await bundle.load('personalization/personalize.js');
const { default: baseConfig } = await bundle.load('personalization/edge-config.js');
after(bundle.cleanup);

const BROWSER = 'Mozilla/5.0 (Macintosh) Chrome/140 Safari/537.36';
const CONSENT = { cookie: 'pzn-consent=1' };
// The fixture home page as delivered: home-hero (geo, then geo+device) and
// welcome (visitor, then state).
const PAGE = fixture('index.html');

function htmlResponse(body, headers = {}) {
  return new Response(body, {
    headers: {
      'content-type': 'text/html; charset=utf-8', etag: '"abc"', 'cache-control': 'max-age=7200', ...headers,
    },
  });
}

function request(url = 'https://www.example.com/', headers = {}) {
  return new Request(url, { headers: { 'user-agent': BROWSER, ...headers } });
}

function quiet(fn) {
  return async () => {
    const { warn, error } = console;
    console.warn = () => {};
    console.error = () => {};
    try {
      await fn();
    } finally {
      console.warn = warn;
      console.error = error;
    }
  };
}

// Personalized sections as the pipeline delivers them: Section Metadata rows
// are data-personalization* attributes, links absolute.
const AEM = 'https://main--site--org.aem.page';
const F = '/fragments/personalization';
const variants = (...names) => names.map((name) => `${AEM}${F}/${name}`).join(',');
const SECTIONS = {
  hero: `<div class="hero dark" data-personalization="hero" data-personalization-variants="${variants('hero/india', 'hero/quiz')}" data-personalization-rule-india="geo: IN" data-personalization-rule-quiz="state: persona=a"><h1>Authored hero</h1></div>`,
  promo: `<div data-personalization="promo" data-personalization-variants="${variants('promo/india')}" data-personalization-rule-india="geo: IN"><p>Authored promo</p></div>`,
  device: `<div data-personalization="device" data-personalization-variants="${variants('device/mobile', 'device/india')}" data-personalization-rule-mobile="device: mobile" data-personalization-rule-india="geo: IN"><p>Authored device</p></div>`,
  back: `<div data-personalization="back" data-personalization-variants="${variants('back/returning', 'back/india')}" data-personalization-rule-returning="visitor: returning" data-personalization-rule-india="geo: IN"><p>Authored back</p></div>`,
  plan: `<div data-personalization="plan" data-personalization-source="api" data-personalization-variants="${variants('plan/enterprise', 'plan/agency', 'plan/mobile')}" data-personalization-rule-agency="param: utm_source=agency"><p>Authored plan</p></div>`,
  extra: `<div data-personalization="extra" data-personalization-source="api" data-personalization-variants="${variants('extra/x')}"><p>Authored extra</p></div>`,
  phone: `<div data-personalization="phone" data-personalization-source="api" data-personalization-variants="${variants('phone/mobile')}" data-personalization-rule-mobile="device: mobile"><p>Authored phone</p></div>`,
  msg: `<div data-personalization="msg" data-personalization-source="split" data-personalization-variants="${variants('msg/speed', 'msg/team')}"><p>Authored msg</p></div>`,
  pick: `<div data-personalization="pick" data-personalization-source="split" data-personalization-split="0, 100" data-personalization-variants="${variants('pick/x', 'pick/y')}"><p>Authored pick</p></div>`,
  offer: `<div data-personalization="scroll-offer" data-personalization-source="target" data-personalization-trigger="scroll: 70%" data-personalization-variants="${variants('offer/free-trial')}"><p>Authored offer</p></div>`,
  inline: `<div data-personalization="inline-offer" data-personalization-source="target" data-personalization-variants="${variants('offer/inline')}"><p>Authored inline</p></div>`,
  invalid: `<div data-personalization="broken" data-personalization-source="bogus" data-personalization-variants="${variants('broken/a')}"><p>Authored broken</p></div>`,
  missing: `<div data-personalization="missing" data-personalization-variants="${variants('missing/india')}" data-personalization-rule-india="geo: IN"><p>Authored missing</p></div>`,
  quoted: `<div data-note="a > b" data-personalization="deal" data-personalization-variants="${variants('deal/vip')}" data-personalization-rule-vip="param: q=a>b"><p>Authored deal</p></div>`,
  // Marked by an engine's own proxy: the edge never decides it again.
  proxied: `<div data-personalization="proxied" data-personalization-variants="${variants('promo/india')}" data-personalization-rule-india="geo: IN" data-pzn-where="edge" data-pzn-status="applied" data-pzn-variant="default" data-pzn-source="api" data-pzn-outcome="no-match" data-pzn-decision="proxied#1"><p>Authored proxied</p></div>`,
};
const FRAGMENTS = {
  [`${F}/hero/india`]: '<div><h1>India hero</h1><p><picture><source type="image/webp" srcset="./media_1a2b.png?width=2000&amp;format=webply 2000w, ./media_1a2b.png?width=750&amp;format=webply 750w"><img src="./media_1a2b.png?width=750&amp;format=png" alt=""></picture></p>'
    + '<p><a href="../other">Other</a> <a href="/abs">Abs</a> <a href="https://www.example.com/x">Full</a> <a href="#top">Top</a></p></div>'
    + '<div><div class="section-metadata"><div><div>style</div><div>dark</div></div></div><p>Second section</p></div>',
  [`${F}/promo/india`]: '<div><p>India promo</p></div>',
  [`${F}/device/india`]: '<div><p>India device</p></div>',
  [`${F}/back/returning`]: '<div><p>Welcome back</p></div>',
  [`${F}/back/india`]: '<div><p>India back</p></div>',
  [`${F}/plan/enterprise`]: '<div><h2>Enterprise plan</h2></div>',
  [`${F}/plan/agency`]: '<div><h2>Agency plan</h2></div>',
  [`${F}/extra/x`]: '<div><p>Extra X</p></div>',
  [`${F}/msg/speed`]: '<div><p>Speed</p></div>',
  [`${F}/msg/team`]: '<div><p>Team</p></div>',
  [`${F}/pick/x`]: '<div><p>X</p></div>',
  [`${F}/pick/y`]: '<div><p>Y</p></div>',
  [`${F}/deal/vip`]: '<div><p>VIP deal</p></div>',
  // fixture site fragments
  [`${F}/home-hero/india`]: fixture(`content${F}/home-hero/india.html`),
  [`${F}/welcome/back`]: fixture(`content${F}/welcome/back.html`),
};
const sectionPage = (...names) => `<html><head><title>x</title></head><body><header></header><main>
${names.map((name) => SECTIONS[name] || name).join('\n')}
</main><footer></footer></body></html>`;

function fragments() {
  const calls = [];
  const fetchFragment = async (path) => {
    calls.push(path);
    return FRAGMENTS[path]
      ? new Response(FRAGMENTS[path], { headers: { 'content-type': 'text/html' } })
      : new Response('Not Found', { status: 404 });
  };
  return { calls, fetchFragment };
}

const section = (out, id) => {
  const found = html.findSections(out).find((candidate) => candidate.attributes
    .some(([name, value]) => name === 'data-personalization' && value === id));
  return found && {
    attrs: Object.fromEntries(found.attributes),
    inner: out.slice(found.openEnd, found.closeStart),
    raw: out.slice(found.start, found.end),
  };
};
// The decision written on a section: data-pzn-* without the prefix.
const pzn = (out, id) => Object.fromEntries(Object.entries(section(out, id).attrs)
  .filter(([name]) => name.startsWith('data-pzn-')).map(([name, value]) => [name.slice(9), value]));
const untouched = (out, name) => assert.ok(out.includes(SECTIONS[name]), `${name} is left to the browser`);
const authored = (name) => {
  const [found] = html.findSections(SECTIONS[name]);
  return SECTIONS[name].slice(found.openEnd, found.closeStart);
};
const withTemplate = (markup, name) => `${markup}<template data-pzn-default>${authored(name)}</template>`;

const ENGINE = 'https://engine.example/decide';
const engineConfig = (api = {}, rest = {}) => ({
  ...baseConfig, ...rest, api: { ...baseConfig.api, endpoint: ENGINE, ...api },
});
const policy = (...withoutConsent) => ({ withoutConsent, policyRef: 'https://legal.example/ticket/42' });

// An engine that answers one body for every request and records them.
function engine(answer, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (typeof answer === 'function') return answer(calls.at(-1));
    return status === 200 ? Response.json(answer) : new Response('down', { status });
  };
  return { calls, fetchImpl };
}

// An engine that never answers; like fetch, it rejects when aborted.
const slow = (url, init) => new Promise((resolve, reject) => {
  init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});

function memoryCache() {
  const store = new Map();
  const log = [];
  return {
    store,
    log,
    match: async (key) => { log.push(['match', key.url]); return store.get(key.url)?.clone(); },
    put: async (key, value) => { log.push(['put', key.url]); store.set(key.url, value); },
  };
}

async function run(page, {
  url = 'https://www.example.com/', headers = {}, config = baseConfig, cf = { country: 'IN' }, ...rest
} = {}) {
  const { calls: fetched, fetchFragment } = fragments();
  const out = await personalizeResponse(request(url, headers), htmlResponse(page), {
    config, cf, cache: null, fetchFragment, ...rest,
  });
  return {
    out, text: await out.text(), fetched,
  };
}

describe('consent and exceptions (contract section 3)', () => {
  it('leaves every section to the browser without the consent cookie: no engine call, no split cookie', async () => {
    const { calls, fetchImpl } = engine({ decisions: { plan: { variant: 'enterprise' } } });
    const { out, text, fetched } = await run(sectionPage('hero', 'plan', 'msg'), {
      url: 'https://www.example.com/?utm_source=agency', config: engineConfig(), fetchImpl,
    });
    ['hero', 'plan', 'msg'].forEach((name) => untouched(text, name));
    assert.equal(calls.length, 0);
    assert.deepEqual(fetched, []);
    assert.equal(out.headers.get('set-cookie'), null);
    assert.equal(out.headers.get('x-pzn'), 'deferred');
    assert.equal(out.headers.get('cache-control'), 'private, no-cache');
  });

  it('reads only pzn-consent=1 as consent', () => {
    assert.equal(consentCookie(request('https://www.example.com/', CONSENT)), true);
    assert.equal(consentCookie(request('https://www.example.com/', { cookie: 'a=1; pzn-consent=1' })), true);
    assert.equal(consentCookie(request('https://www.example.com/', { cookie: 'pzn-consent=0' })), false);
    assert.equal(consentCookie(request()), false);
  });

  it('decides with the consent cookie', async () => {
    const { text } = await run(sectionPage('hero', 'msg'), { headers: CONSENT, random: () => 0.9 });
    assert.equal(pzn(text, 'hero').variant, 'india');
    assert.equal(pzn(text, 'msg').status, 'applied');
  });

  it('honors an exception only with its policyRef', async () => {
    assert.deepEqual([...approvedExceptions({ consent: { withoutConsent: ['rules'] } })], []);
    assert.deepEqual([...approvedExceptions({ consent: policy('rules', 'split') })], ['rules', 'split']);
    const unrecorded = await run(sectionPage('hero'), { config: { ...baseConfig, consent: { withoutConsent: ['rules'], policyRef: '' } } });
    untouched(unrecorded.text, 'hero');
    const recorded = await run(sectionPage('hero'), { config: { ...baseConfig, consent: policy('rules') } });
    assert.deepEqual(pzn(recorded.text, 'hero'), {
      where: 'edge', status: 'applied', variant: 'india', source: 'rules', outcome: 'variant', decision: 'hero#1', fragment: `${F}/hero/india`,
    });
  });

  it('`rules` exception: Rule rows without visitor:, and api sections get their Rule rows as no-consent', async () => {
    const { calls, fetchImpl } = engine({ decisions: {} });
    const { text } = await run(sectionPage('back', 'plan', 'msg'), {
      url: 'https://www.example.com/?utm_source=agency',
      headers: { cookie: 'pzn-seen=1' },
      config: engineConfig({}, { consent: policy('rules') }),
      fetchImpl,
    });
    // visitor: returning is never read without consent: the geo row decides.
    assert.equal(pzn(text, 'back').variant, 'india');
    assert.deepEqual(pzn(text, 'plan'), {
      where: 'edge', status: 'applied', variant: 'agency', source: 'rules', outcome: 'no-consent', decision: 'plan#1', fragment: `${F}/plan/agency`,
    });
    assert.equal(calls.length, 0, 'the engine is not asked without the api exception');
    untouched(text, 'msg');
  });

  it('`split` exception: assigned for the session without consent', async () => {
    const without = await run(sectionPage('pick'));
    untouched(without.text, 'pick');
    assert.equal(without.out.headers.get('set-cookie'), null);
    const allowed = await run(sectionPage('pick'), { config: { ...baseConfig, consent: policy('split') } });
    assert.equal(pzn(allowed.text, 'pick').variant, 'y');
    assert.match(allowed.out.headers.get('set-cookie'), /^pzn-split=pick%3Ay; Path=\/; SameSite=Lax; Secure$/);
  });

  it('`api` exception: request data only (no visitor, no state, consent false)', async () => {
    const { calls, fetchImpl } = engine({ decisions: { extra: { variant: 'x' } } });
    const { text } = await run(sectionPage('extra'), {
      url: 'https://www.example.com/?utm_medium=mail&email=a@b.c',
      headers: { cookie: 'pzn-seen=1', referer: 'https://news.example/story?id=1' },
      config: engineConfig({}, { consent: policy('api') }),
      fetchImpl,
    });
    assert.equal(calls.length, 1);
    const { context } = calls[0].body;
    assert.deepEqual(context, {
      geo: { country: 'IN' }, params: { utm_medium: 'mail' }, referrer: 'news.example', consent: { personalization: false },
    });
    assert.equal(pzn(text, 'extra').variant, 'x');
  });

  it('builds the edge context from cf, the URL and, with consent only, the visitor cookies', () => {
    const req = request('https://www.example.com/?a=1&pzn=x:y', { cookie: 'pzn-seen=1', referer: 'https://www.google.com/search?q=x' });
    assert.deepEqual(edgeContext(req, { country: 'us', regionCode: 'ca' }, { consent: true }), {
      geo: { country: 'US', region: 'CA' }, visitor: 'returning', params: { a: '1' }, state: {}, referrer: 'www.google.com',
    });
    assert.equal(edgeContext(req, {}, { consent: false }).visitor, undefined);
    assert.equal(edgeContext(request(), { country: 'T1' }, { consent: true }).geo, null, 'Tor and unknown countries are no geo');
    assert.equal(edgeContext(request('https://www.example.com/', { referer: 'https://www.example.com/a' }), {}, { consent: true }).referrer, undefined, 'own site is no referrer');
  });
});

describe('edge results and the handoff (contract section 8)', () => {
  it('applied: swaps in the variant, rewrites its URLs and keeps the authored content in a template', async () => {
    const { out, text, fetched } = await run(sectionPage('hero'), { headers: CONSENT });
    const hero = section(text, 'hero');
    assert.deepEqual(hero.attrs, {
      class: 'hero dark',
      'data-personalization': 'hero',
      'data-personalization-variants': variants('hero/india', 'hero/quiz'),
      'data-personalization-rule-india': 'geo: IN',
      'data-personalization-rule-quiz': 'state: persona=a',
      'data-pzn-where': 'edge',
      'data-pzn-status': 'applied',
      'data-pzn-variant': 'india',
      'data-pzn-source': 'rules',
      'data-pzn-outcome': 'variant',
      'data-pzn-decision': 'hero#1',
      'data-pzn-fragment': `${F}/hero/india`,
    });
    assert.equal(hero.inner, withTemplate('<h1>India hero</h1><p><picture><source type="image/webp" srcset="/fragments/personalization/hero/media_1a2b.png?width=2000&amp;format=webply 2000w, /fragments/personalization/hero/media_1a2b.png?width=750&amp;format=webply 750w"><img src="/fragments/personalization/hero/media_1a2b.png?width=750&amp;format=png" alt=""></picture></p>'
      + '<p><a href="/fragments/personalization/other">Other</a> <a href="/abs">Abs</a> <a href="https://www.example.com/x">Full</a> <a href="#top">Top</a></p>'
      + '<p>Second section</p>', 'hero'));
    assert.deepEqual(fetched, [`${F}/hero/india`]);
    assert.match(text, /<meta name="pzn-geo" content="IN"><\/head>/);
    assert.equal(out.headers.get('x-pzn'), 'edge');
    assert.equal(out.headers.get('cache-control'), 'private, no-cache');
    assert.equal(out.headers.get('etag'), null);
    assert.equal(out.headers.get('set-cookie'), null);
  });

  it('applied default: no rule matches, the authored content stays without a template', async () => {
    const { text, fetched } = await run(sectionPage('promo'), { headers: CONSENT, cf: { country: 'FR' } });
    assert.equal(section(text, 'promo').inner, '<p>Authored promo</p>');
    assert.deepEqual(pzn(text, 'promo'), {
      where: 'edge', status: 'applied', variant: 'default', source: 'rules', outcome: 'no-match', decision: 'promo#1',
    });
    assert.deepEqual(fetched, []);
  });

  it('selected: without fetchFragment the browser loads the decided variant', async () => {
    const out = await personalizeResponse(request('https://www.example.com/', CONSENT), htmlResponse(sectionPage('promo')), {
      config: baseConfig, cf: { country: 'IN' }, cache: null,
    });
    const text = await out.text();
    assert.deepEqual(pzn(text, 'promo'), {
      where: 'edge', status: 'selected', variant: 'india', source: 'rules', outcome: 'variant', decision: 'promo#1', fragment: `${F}/promo/india`,
    });
    assert.equal(section(text, 'promo').inner, '<p>Authored promo</p>');
    assert.equal(out.headers.get('x-pzn'), 'edge');
  });

  it('left: a slow or missing fragment, so the browser decides', quiet(async () => {
    const stalled = await run(sectionPage('promo'), {
      headers: CONSENT, config: { ...baseConfig, fragmentTimeout: 20 }, fetchFragment: () => new Promise(() => {}),
    });
    untouched(stalled.text, 'promo');
    const missing = await run(sectionPage('missing'), { headers: CONSENT });
    untouched(missing.text, 'missing');
    assert.deepEqual(missing.fetched, [`${F}/missing/india`]);
    assert.equal(missing.out.headers.get('x-pzn'), 'deferred');
  }));

  it('left: target, invalid, duplicate and already marked sections', async () => {
    const dup = SECTIONS.promo.replace('Authored promo', 'Second promo');
    const { text, fetched } = await run(sectionPage('offer', 'inline', 'invalid', 'proxied', 'promo', dup), { headers: CONSENT });
    ['offer', 'inline', 'invalid', 'proxied'].forEach((name) => untouched(text, name));
    assert.ok(text.includes(dup), 'a duplicate id is invalid');
    assert.equal(pzn(text, 'promo').variant, 'india');
    assert.deepEqual(fetched, [`${F}/promo/india`]);
  });

  it('left: a browser-only criterion could match first (device, state, audience)', async () => {
    const india = await run(sectionPage('device', 'hero'), { headers: CONSENT });
    // device: mobile comes before geo: IN; only the browser knows which matches first.
    untouched(india.text, 'device');
    assert.equal(pzn(india.text, 'hero').variant, 'india', 'geo matches before the state rule');
    const france = await run(sectionPage('hero'), { headers: CONSENT, cf: { country: 'FR' } });
    untouched(france.text, 'hero');
    assert.deepEqual([...india.fetched, ...france.fetched], [`${F}/hero/india`]);
  });

  it('left: preview overrides or AEM Experimentation on the page', async () => {
    const overridden = await run(sectionPage('hero', 'msg'), {
      url: 'https://www.example.com/?pzn=hero:india', headers: CONSENT, config: { ...baseConfig, overrides: 'always' },
    });
    untouched(overridden.text, 'hero');
    untouched(overridden.text, 'msg');
    assert.deepEqual(overridden.fetched, []);
    assert.equal(overridden.out.headers.get('set-cookie'), null);
    // 'never' (the default) ignores ?pzn= on the edge host.
    const ignored = await run(sectionPage('hero'), { url: 'https://www.example.com/?pzn=hero:quiz', headers: CONSENT });
    assert.equal(pzn(ignored.text, 'hero').variant, 'india');
    const experiment = await run(sectionPage('hero').replace('<head>', '<head><meta name="experiment" content="hero-test">'), { headers: CONSENT });
    untouched(experiment.text, 'hero');
  });

  it('reads the visitor cookies with consent', async () => {
    const { text } = await run(PAGE, { headers: { cookie: 'pzn-consent=1; pzn-seen=1' }, cf: { country: 'FR' } });
    assert.equal(pzn(text, 'welcome').variant, 'back');
    assert.match(section(text, 'welcome').inner, /<template data-pzn-default>/);
    // FR: the geo rule fails and the next one needs the device.
    assert.equal(section(text, 'home-hero').attrs['data-pzn-where'], undefined);
    const fresh = await run(PAGE, { headers: CONSENT, cf: { country: 'FR' } });
    // A new visitor: the state rule after the visitor rule needs the browser.
    assert.equal(section(fresh.text, 'welcome').attrs['data-pzn-where'], undefined);
  });

  it('serves bots the default, marked bot: no engine call, no fragment, no split cookie', async () => {
    const { calls, fetchImpl } = engine({ decisions: {} });
    const { out, text, fetched } = await run(sectionPage('hero', 'plan', 'msg', 'offer'), {
      url: 'https://www.example.com/?utm_source=agency',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)', cookie: 'pzn-consent=1' },
      config: engineConfig(),
      fetchImpl,
    });
    ['hero', 'plan', 'msg'].forEach((id) => {
      assert.deepEqual(pzn(text, id), {
        where: 'edge', status: 'applied', variant: 'default', source: 'bot', outcome: 'bot', decision: `${id}#1`,
      }, id);
      assert.match(section(text, id).inner, /Authored/);
    });
    untouched(text, 'offer');
    assert.equal(calls.length, 0);
    assert.deepEqual(fetched, []);
    assert.equal(out.headers.get('set-cookie'), null);
    const verified = await run(sectionPage('hero'), { cf: { country: 'IN', botManagement: { verifiedBot: true } } });
    assert.equal(pzn(verified.text, 'hero').outcome, 'bot', 'a verified bot needs no consent to get the default');
  });

  it('reads quoted attribute values holding ">"', async () => {
    const { text } = await run(sectionPage('quoted'), { url: 'https://www.example.com/?q=a%3Eb', headers: CONSENT });
    const deal = section(text, 'deal');
    assert.equal(deal.attrs['data-note'], 'a > b');
    assert.equal(deal.attrs['data-personalization-rule-vip'], 'param: q=a>b');
    assert.equal(deal.inner, withTemplate('<p>VIP deal</p>', 'quoted'));
  });

  it('flattens fragments and rewrites only relative URLs', () => {
    assert.equal(fragmentMarkup('<div>  </div>', `${F}/x/y`), null);
    assert.equal(fragmentMarkup('<p>loose</p>', `${F}/x/y`), '<p>loose</p>');
    assert.equal(absolutizeUrls('<img src=\'./media_a.png\'><a href="mailto:a@b.c">m</a><a href="tel:1">t</a><a href="?x=1">q</a> src="./not-a-tag"', `${F}/x/y`),
      '<img src=\'/fragments/personalization/x/media_a.png\'><a href="mailto:a@b.c">m</a><a href="tel:1">t</a><a href="?x=1">q</a> src="./not-a-tag"');
  });
});

describe('split sections (contract section 6)', () => {
  it('assigns once per browser session, with the weights', async () => {
    const first = await run(sectionPage('msg', 'pick'), { headers: CONSENT });
    const setCookie = first.out.headers.get('set-cookie');
    assert.match(setCookie, /^pzn-split=[^;]+; Path=\/; SameSite=Lax; Secure$/);
    const assigned = Object.fromEntries(decodeURIComponent(setCookie.split(';')[0].slice('pzn-split='.length))
      .split(',').map((pair) => pair.split(':')));
    assert.equal(assigned.pick, 'y', '0, 100 always assigns the second variant');
    assert.equal(section(first.text, 'pick').inner, withTemplate('<p>Y</p>', 'pick'));
    assert.ok(['default', 'speed', 'team'].includes(assigned.msg));
    assert.equal(pzn(first.text, 'msg').variant, assigned.msg);

    const sticky = await run(sectionPage('msg', 'pick'), { headers: { cookie: `pzn-consent=1; pzn-split=${encodeURIComponent('msg:team,other:z')}` } });
    assert.equal(section(sticky.text, 'msg').inner, withTemplate('<p>Team</p>', 'msg'));
    assert.equal(decodeURIComponent(sticky.out.headers.get('set-cookie').split(';')[0]), 'pzn-split=msg:team,other:z,pick:y');
    const known = await run(sectionPage('msg', 'pick'), { headers: { cookie: `pzn-consent=1; pzn-split=${encodeURIComponent('msg:default,pick:y')}` } });
    assert.equal(section(known.text, 'msg').inner, '<p>Authored msg</p>');
    assert.equal(known.out.headers.get('set-cookie'), null, 'nothing new to remember');
  });

  it('marks the default arm as control and draws with the given number', async () => {
    const control = await run(sectionPage('msg'), { headers: CONSENT, random: () => 0.9 });
    assert.deepEqual(pzn(control.text, 'msg'), {
      where: 'edge', status: 'applied', variant: 'default', source: 'split', outcome: 'control', decision: 'msg#1',
    });
    const speed = await run(sectionPage('msg'), { headers: CONSENT, random: () => 0 });
    assert.equal(pzn(speed.text, 'msg').variant, 'speed');
    assert.equal(pzn(speed.text, 'msg').outcome, 'variant');
  });
});

describe('api sections at the edge (contract sections 4 and 5)', () => {
  const page = sectionPage('extra', 'plan');
  const answerFor = async (answer, { url = 'https://www.example.com/plans', api, ...rest } = {}) => {
    const { calls, fetchImpl } = engine(answer);
    const result = await run(page, {
      url, headers: CONSENT, config: engineConfig(api), fetchImpl, env: { PZN_API_KEY: 'k' }, ...rest,
    });
    return { ...result, calls };
  };

  it('asks the engine once per page, with the secret, for the sections it may decide', async () => {
    const { calls, fetchImpl } = engine({ decisions: { plan: { variant: 'enterprise', tracking: { engine: 'e', requestId: 'r1' } }, extra: { variant: 'x' } } });
    const { text } = await run(sectionPage('plan', 'extra', 'phone'), {
      url: 'https://www.example.com/plans?utm_source=agency&email=a@b.c',
      headers: CONSENT,
      config: engineConfig(),
      env: { PZN_API_KEY: 'k' },
      fetchImpl,
    });
    assert.equal(calls.length, 1, 'one engine call per page');
    const [{ url, init, body }] = calls;
    assert.equal(url, ENGINE);
    assert.equal(init.headers.authorization, 'Bearer k');
    assert.equal(body.mode, 'edge');
    assert.deepEqual(body.page, { path: '/plans', title: 'x' });
    // phone's first rule needs the device: never sent to the edge engine.
    // Order is not part of the contract: compare by id.
    assert.deepEqual([...body.placeholders].sort((a, b) => a.id.localeCompare(b.id)), [
      { id: 'extra', candidates: ['x', 'default'], fragments: { x: `${F}/extra/x` } },
      { id: 'plan', candidates: ['enterprise', 'agency', 'mobile', 'default'], fragments: { enterprise: `${F}/plan/enterprise`, agency: `${F}/plan/agency`, mobile: `${F}/plan/mobile` } },
    ]);
    assert.deepEqual(body.context, {
      geo: { country: 'IN' }, visitor: 'new', params: { utm_source: 'agency' }, consent: { personalization: true },
    });
    assert.deepEqual(pzn(text, 'plan'), {
      where: 'edge',
      status: 'applied',
      variant: 'enterprise',
      source: 'api',
      outcome: 'variant',
      decision: 'plan#1',
      fragment: `${F}/plan/enterprise`,
      tracking: '{"engine":"e","requestId":"r1"}',
    });
    assert.equal(section(text, 'plan').inner, withTemplate('<h2>Enterprise plan</h2>', 'plan'));
    untouched(text, 'phone');
  });

  it('maps every answer kind to its outcome; Rule rows only when the engine gave no usable answer', quiet(async () => {
    const cases = [
      [{ variant: 'enterprise' }, '', { variant: 'enterprise', source: 'api', outcome: 'variant' }],
      [{ fragment: `${F}/plan/agency` }, '', { variant: 'agency', source: 'api', outcome: 'variant' }],
      [{ control: true }, '?utm_source=agency', { variant: 'default', source: 'api', outcome: 'control' }],
      [{ variant: 'default' }, '?utm_source=agency', { variant: 'default', source: 'api', outcome: 'intentional-default' }],
      [{ reason: 'low_confidence' }, '?utm_source=agency', {
        variant: 'agency', source: 'rules', outcome: 'low-confidence', reason: 'low_confidence',
      }],
      [{ reason: 'low_confidence' }, '', {
        variant: 'default', source: 'rules', outcome: 'low-confidence', reason: 'low_confidence',
      }],
      [{ reason: 'no_candidate' }, '', {
        variant: 'default', source: 'rules', outcome: 'no-match', reason: 'no_candidate',
      }],
      [undefined, '', {
        variant: 'default', source: 'rules', outcome: 'no-match', reason: 'no decision',
      }],
      [{ reason: 'provider_error' }, '?utm_source=agency', {
        variant: 'agency', source: 'rules', outcome: 'fallback', reason: 'provider_error',
      }],
      [{ variant: 'unlisted' }, '?utm_source=agency', {
        variant: 'agency', source: 'rules', outcome: 'fallback', reason: 'not listed: unlisted',
      }],
      [{ variant: 'x', extra: 1 }, '?utm_source=agency', {
        variant: 'agency', source: 'rules', outcome: 'fallback', reason: 'not listed: unknown field extra',
      }],
    ];
    for (const [answer, query, expected] of cases) {
      // eslint-disable-next-line no-await-in-loop
      const { text } = await answerFor({ decisions: answer ? { plan: answer } : {} }, { url: `https://www.example.com/plans${query}` });
      const got = pzn(text, 'plan');
      const fields = {
        variant: got.variant, source: got.source, outcome: got.outcome, ...(got.reason ? { reason: got.reason } : {}),
      };
      assert.deepEqual(fields, expected, `${JSON.stringify(answer)} ${query}`);
      assert.equal(got.status, 'applied');
      assert.equal(got.decision, 'plan#1');
    }
  }));

  it('leaves a section to the browser when the engine failed and no rule matched; uses the rules when one does', quiet(async () => {
    for (const [answer, status] of [[{ decisions: { plan: { reason: 'provider_error' }, extra: { reason: 'invalid_choice' } } }, 200], [null, 500], [{ nope: 1 }, 200]]) {
      const { calls, fetchImpl } = engine(answer, { status });
      // eslint-disable-next-line no-await-in-loop
      const { text } = await run(page, { headers: CONSENT, config: engineConfig(), fetchImpl });
      assert.equal(calls.length, 1);
      untouched(text, 'extra');
      untouched(text, 'plan');
    }
    const { fetchImpl } = engine(null, { status: 500 });
    const ruled = await run(page, {
      url: 'https://www.example.com/?utm_source=agency', headers: CONSENT, config: engineConfig(), fetchImpl,
    });
    assert.deepEqual(pzn(ruled.text, 'plan'), {
      where: 'edge', status: 'applied', variant: 'agency', source: 'rules', outcome: 'fallback', decision: 'plan#1', reason: 'HTTP 500', fragment: `${F}/plan/agency`,
    });
    untouched(ruled.text, 'extra');
  }));

  it('times out after api.timeout: Rule rows, else the browser decides', quiet(async () => {
    const { text } = await run(page, {
      url: 'https://www.example.com/?utm_source=agency', headers: CONSENT, config: engineConfig({ timeout: 20 }), fetchImpl: slow,
    });
    assert.deepEqual(pzn(text, 'plan'), {
      where: 'edge', status: 'applied', variant: 'agency', source: 'rules', outcome: 'timeout', decision: 'plan#1', reason: 'timed out after 20 ms', fragment: `${F}/plan/agency`,
    });
    untouched(text, 'extra');
  }));

  it('applies the default (timeout, fallback) to a first section the browser may not decide (of1)', quiet(async () => {
    const first = sectionPage('extra', 'plan');
    const config = engineConfig({ timeout: 20, engine: 'of1' });
    const timedOut = await run(first, { headers: CONSENT, config, fetchImpl: slow });
    assert.deepEqual(pzn(timedOut.text, 'extra'), {
      where: 'edge', status: 'applied', variant: 'default', source: 'api', outcome: 'timeout', decision: 'extra#1', reason: 'timed out after 20 ms',
    });
    // Not the first section: left to the browser.
    untouched(timedOut.text, 'plan');
    const { fetchImpl } = engine(null, { status: 503 });
    const failed = await run(first, { headers: CONSENT, config, fetchImpl });
    assert.equal(pzn(failed.text, 'extra').outcome, 'fallback');
    // A variant whose fragment fails is selected: the browser loads it.
    const { fetchImpl: chosen } = engine({ decisions: { extra: { variant: 'x' } } });
    const selected = await run(first, {
      headers: CONSENT, config, fetchImpl: chosen, fetchFragment: async () => new Response('', { status: 404 }),
    });
    assert.equal(pzn(selected.text, 'extra').status, 'selected');
    // The generic profile leaves the same first section to the browser.
    const generic = await run(first, { headers: CONSENT, config: engineConfig({ timeout: 20 }), fetchImpl: slow });
    untouched(generic.text, 'extra');
  }));

  it('keeps tracking up to 1 KB and marks answers from the engine cache', async () => {
    const big = { engine: 'e', blob: 'x'.repeat(1100) };
    const { text } = await answerFor({
      decisions: {
        plan: { variant: 'enterprise', tracking: { engine: 'of1', requestId: 'r-91', cached: true } },
        extra: { variant: 'x', tracking: big },
      },
    });
    assert.equal(pzn(text, 'plan').cached, 'true');
    assert.equal(pzn(text, 'plan').tracking, '{"engine":"of1","requestId":"r-91","cached":true}');
    assert.equal(pzn(text, 'extra').tracking, undefined);
    assert.equal(pzn(text, 'extra').cached, undefined);
  });

  it('fills missing descriptions for the of1 profile from fragments and the authored section', async () => {
    const described = SECTIONS.plan.replace('<p>Authored plan</p>', 'data-personalization-description-agency="For agencies." data-personalization-hint="Pick the plan."><p>Authored plan</p>')
      .replace('rule-agency="param: utm_source=agency">', 'rule-agency="param: utm_source=agency" ');
    const { calls, fetchImpl } = engine({ decisions: {} });
    await run(sectionPage('promo', described), { headers: CONSENT, config: engineConfig({ engine: 'of1' }), fetchImpl });
    const [placeholder] = calls[0].body.placeholders;
    assert.equal(placeholder.hint, 'Pick the plan.');
    assert.deepEqual(placeholder.descriptions, {
      agency: 'For agencies.', enterprise: 'Enterprise plan', default: 'Authored plan',
    }, 'author rows win; a missing fragment gives no description, never an empty one');
    const generic = engine({ decisions: {} });
    await run(sectionPage('plan'), { headers: CONSENT, config: engineConfig(), fetchImpl: generic.fetchImpl });
    assert.equal(generic.calls[0].body.placeholders[0].descriptions, undefined, 'generic engines get only author rows');
  });

  it('shares engine answers only with cacheable, ttl and no visitor data (contract section 10)', async () => {
    const answer = { decisions: { extra: { variant: 'x' } }, ttl: 60, cacheable: true };
    const shared = async (headers, config, lastModified) => {
      const cache = shared.cache || memoryCache();
      shared.cache = cache;
      const { calls, fetchImpl } = shared.engine || engine(answer);
      shared.engine = { calls, fetchImpl };
      const out = await personalizeResponse(request('https://www.example.com/plans?utm_source=x', headers), htmlResponse(sectionPage('extra'), lastModified ? { 'last-modified': lastModified } : {}), {
        config, cf: { country: 'IN' }, cache, fetchImpl, fetchFragment: fragments().fetchFragment,
      });
      return { text: await out.text(), calls, cache };
    };
    const exception = engineConfig({}, { consent: policy('api') });
    const first = await shared({}, exception, 'Mon, 01 Jan 2026 00:00:00 GMT');
    assert.equal(first.calls.length, 1);
    assert.equal(pzn(first.text, 'extra').cached, undefined);
    const second = await shared({ cookie: 'pzn-seen=1' }, exception, 'Mon, 01 Jan 2026 00:00:00 GMT');
    assert.equal(second.calls.length, 1, 'another visitor with the same context reuses the answer');
    assert.equal(pzn(second.text, 'extra').cached, 'true');
    assert.equal(pzn(second.text, 'extra').decision, 'extra#1', 'a new decision on every page view');
    const republished = await shared({}, exception, 'Tue, 02 Jan 2026 00:00:00 GMT');
    assert.equal(republished.calls.length, 2, 'Last-Modified is part of the key');
    // With consent the request carries visitor: never shared.
    const before = first.cache.log.length;
    await shared(CONSENT, engineConfig(), 'Tue, 02 Jan 2026 00:00:00 GMT');
    await shared(CONSENT, engineConfig(), 'Tue, 02 Jan 2026 00:00:00 GMT');
    assert.equal(shared.engine.calls.length, 4);
    assert.deepEqual(first.cache.log.slice(before), [], 'no cache read or write for requests with visitor data');
    // Not cacheable, or no ttl: never stored.
    const uncacheable = memoryCache();
    for (const body of [{ decisions: {}, ttl: 60 }, { decisions: {}, ttl: 0, cacheable: true }]) {
      // eslint-disable-next-line no-await-in-loop
      await personalizeResponse(request('https://www.example.com/'), htmlResponse(sectionPage('extra')), {
        config: exception, cf: {}, cache: uncacheable, fetchImpl: engine(body).fetchImpl,
      });
    }
    assert.equal(uncacheable.store.size, 0);
  });
});

describe('responses (contract section 10)', () => {
  it('marks pages it cannot decide as deferred, still private', async () => {
    const { out } = await run(PAGE, { headers: CONSENT, cf: { country: 'US' } });
    assert.equal(out.headers.get('x-pzn'), 'deferred');
    assert.equal(out.headers.get('cache-control'), 'private, no-cache');
  });

  it('passes through everything that is not a personalized HTML page', async () => {
    const plain = htmlResponse('<main><div>No personalized sections</div></main>');
    const out = await personalizeResponse(request(), plain, { config: baseConfig, cache: null });
    assert.equal(out.headers.get('x-pzn'), null);
    assert.equal(out.headers.get('cache-control'), 'max-age=7200');

    const json = new Response('{}', { headers: { 'content-type': 'application/json' } });
    assert.equal(await personalizeResponse(request(), json, { config: baseConfig }), json);
    const notFound = new Response('x', { status: 404, headers: { 'content-type': 'text/html' } });
    assert.equal(await personalizeResponse(request(), notFound, { config: baseConfig }), notFound);
    const fragment = htmlResponse(PAGE);
    assert.equal(await personalizeResponse(request('https://www.example.com/a.plain.html'), fragment, { config: baseConfig }), fragment);
    const head = htmlResponse(PAGE);
    assert.equal(await personalizeResponse(new Request('https://www.example.com/', { method: 'HEAD' }), head, { config: baseConfig }), head);
  });

  it('serves origin HTML when processing throws', quiet(async () => {
    const config = { ...baseConfig, get botsGetDefault() { throw new Error('boom'); } };
    const out = await personalizeResponse(request(), htmlResponse(PAGE), { config, cache: null });
    assert.equal(await out.text(), PAGE);
    assert.equal(out.headers.get('x-pzn'), null);
  }));

  it('reads the authored text of a section, without its template', () => {
    const marked = `<main><div data-personalization="a"><h1>New</h1><template data-pzn-default><h1>Old</h1></template></div></main>`;
    assert.equal(authoredText(marked, 'a'), 'New');
    assert.equal(authoredText(marked, 'b'), null);
    assert.equal(authoredText(fixture('content/offer.plain.html'), 'offer'), 'Offers Our standard offer. Terms apply.');
  });

  it('cuts filled descriptions to 600 characters and never sends an empty one', quiet(async () => {
    const body = {
      placeholders: [{
        id: 'a', candidates: ['x', 'y', 'z', 'default'], fragments: { x: '/f/x', y: '/f/y', z: '/f/z' }, descriptions: { z: 'Row' },
      }],
    };
    const plain = { '/f/x': `<div><p>${'w'.repeat(700)}</p></div>`, '/f/y': '<div> </div>' };
    await fillDescriptions(body, {
      fetchPlain: async (path) => (plain[path] ? new Response(plain[path]) : new Response('', { status: 404 })),
      sectionText: () => '',
    });
    assert.deepEqual(Object.keys(body.placeholders[0].descriptions).sort(), ['x', 'z']);
    assert.equal(body.placeholders[0].descriptions.x.length, 600);
    assert.equal(body.placeholders[0].descriptions.z, 'Row');
  }));
});

describe('handleApiRoute (the server route)', () => {
  const config = { ...baseConfig, api: { ...baseConfig.api, endpoint: '' } };
  const V1 = {
    version: '1',
    page: { path: '/offers' },
    placeholders: [{ id: 'offer', candidates: ['india', 'default'], fragments: { india: `${F}/offer/india` } }],
    context: {
      geo: { country: 'IN' }, visitor: 'returning', state: { quiz: 'cn' }, params: {}, consent: { personalization: true },
    },
    mode: 'client',
  };
  const body = (change = (value) => value) => JSON.stringify(change(structuredClone(V1)));
  const SITE_HEADERS = { origin: 'https://www.example.com', 'sec-fetch-site': 'same-origin', cookie: 'pzn-consent=1' };
  const post = (text, headers = SITE_HEADERS, path = '/pzn/decide') => new Request(`https://www.example.com${path}`, { method: 'POST', body: text, headers });
  const env = { PZN_API_ENDPOINT: 'https://engine.example' };
  const answering = (answer = { decisions: {} }) => engine(answer);

  it('ignores other paths and rejects bad requests', async () => {
    assert.equal(await handleApiRoute(request(), {}, config), null);
    assert.equal(await handleApiRoute(post(body()), {}, { ...config, apiRoute: '' }), null);
    assert.equal((await handleApiRoute(new Request('https://www.example.com/pzn/decide'), {}, config)).status, 405);
    assert.equal((await handleApiRoute(post(body()), {}, config)).status, 503);
    assert.equal((await handleApiRoute(post('x'.repeat(20000)), env, config)).status, 413);
    // Multi-byte characters count as bytes, not characters.
    assert.equal((await handleApiRoute(post(`"${'é'.repeat(9000)}"`), env, config)).status, 413);
    assert.equal((await handleApiRoute(post('{bad'), env, config)).status, 400);
  });

  it('only forwards same-origin v1 requests with consent', async () => {
    const { calls, fetchImpl } = answering();
    const send = (text, headers, routeConfig = config) => handleApiRoute(post(text, headers), env, routeConfig, { fetchImpl });
    assert.equal((await send(body(), { ...SITE_HEADERS, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await send(body(), { cookie: 'pzn-consent=1' })).status, 403, 'no Origin header');
    assert.equal((await send(body(), { ...SITE_HEADERS, cookie: '' })).status, 403, 'no consent cookie');
    assert.equal((await send(body((v) => ({ ...v, context: { ...v.context, consent: { personalization: false } } })))).status, 403, 'the request says no consent');
    assert.equal((await send('{"version":"1"}')).status, 400, 'not a v1 request');
    assert.match(await (await send('{"slots":["offer"]}')).text(), /leave mapRequest\/mapResponse empty/);
    assert.equal((await send(body(), { ...SITE_HEADERS, cookie: '' }, { ...config, consent: { withoutConsent: ['api'], policyRef: '' } })).status, 403, 'an exception without policyRef');
    assert.equal(calls.length, 0);
  });

  it('`api` exception: forwards request data only and keeps the answer out of the browser cache', async () => {
    const { calls, fetchImpl } = answering({ decisions: { offer: { variant: 'india' } }, ttl: 120, cacheable: true });
    const out = await handleApiRoute(post(body(), { ...SITE_HEADERS, cookie: '' }), env, { ...config, consent: policy('api') }, { fetchImpl });
    assert.equal(out.status, 200);
    assert.deepEqual(calls[0].body.context, { geo: { country: 'IN' }, params: {}, consent: { personalization: false } });
    assert.deepEqual(await out.json(), { decisions: { offer: { variant: 'india' } }, ttl: 0, cacheable: false });
  });

  it('rebuilds the body from contract fields only', async () => {
    const { calls, fetchImpl } = answering();
    await handleApiRoute(post(body((v) => {
      Object.assign(v, { anything: 'x'.repeat(100), mode: 'edge' });
      Object.assign(v.context, { state: { quiz: 'cn', nested: { a: 1 } }, email: 'a@b.c' });
      v.placeholders[0].fragments.evil = 'https://evil.example/x';
      v.placeholders[0].fragments.india = '/elsewhere/india';
      return v;
    })), env, config, { fetchImpl });
    const [{ body: seen }] = calls;
    assert.equal('anything' in seen, false);
    assert.equal('email' in seen.context, false);
    assert.deepEqual(seen.context.state, { quiz: 'cn' });
    assert.equal(seen.mode, 'client');
    assert.deepEqual(seen.placeholders[0].fragments, {}, 'only listed candidates under the fragment prefixes');
  });

  it('applies the optional rate limiter', async () => {
    const keys = [];
    const limiter = { limit: async ({ key }) => { keys.push(key); return { success: false }; } };
    const out = await handleApiRoute(post(body(), { ...SITE_HEADERS, 'cf-connecting-ip': '203.0.113.9' }), { ...env, PZN_RATE_LIMITER: limiter }, config, answering());
    assert.equal(out.status, 429);
    assert.deepEqual(keys, ['203.0.113.9']);
  });

  it('proxies to the engine with the secret and validates the answer', quiet(async () => {
    const { calls, fetchImpl } = answering({ decisions: { offer: { variant: 'x', junk: 1 }, other: { variant: 'india' } }, ttl: 10 });
    const keyed = { ...env, PZN_API_KEY: 'secret' };
    const out = await handleApiRoute(post(body()), keyed, config, { fetchImpl });
    assert.equal(out.status, 200);
    assert.equal(out.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await out.json(), {
      decisions: { offer: { invalid: 'unknown field junk' }, other: { variant: 'india' } }, ttl: 10, cacheable: false,
    });
    assert.equal(calls[0].url, 'https://engine.example');
    assert.equal(calls[0].init.headers.authorization, 'Bearer secret');
    const failed = await handleApiRoute(post(body()), keyed, config, { fetchImpl: async () => Response.json({ nope: 1 }) });
    assert.equal(failed.status, 502);
    assert.deepEqual(await failed.json(), { decisions: {} });
  }));

  it('applies request and response adapters; mapResponse gets the v1 request', async () => {
    let mapped;
    const adapted = {
      ...config,
      api: {
        ...config.api,
        mapRequest: (v1) => ({ url: 'https://vendor.example/v2', body: { slots: v1.placeholders.map((p) => p.id) } }),
        mapResponse: (json, v1) => {
          mapped = v1;
          return { decisions: Object.fromEntries(json.results.map((r) => [r.slot, { variant: v1.placeholders[0].candidates[r.position] }])) };
        },
      },
    };
    const { calls, fetchImpl } = answering({ results: [{ slot: 'offer', position: 0 }] });
    const out = await handleApiRoute(post(body()), env, adapted, { fetchImpl });
    assert.deepEqual({ url: calls[0].url, body: calls[0].body }, { url: 'https://vendor.example/v2', body: { slots: ['offer'] } });
    assert.equal(mapped.version, '1');
    assert.deepEqual((await out.json()).decisions, { offer: { variant: 'india' } });
  });

  it('fills missing descriptions for the of1 profile before calling the engine', async () => {
    const plain = {
      [`${F}/offer/india`]: '<div><h2>India offer</h2><p>Diwali savings.</p></div>',
      '/offers': fixture('content/offer.plain.html'),
    };
    const fetched = [];
    const fetchPlain = async (path) => {
      fetched.push(path);
      return plain[path] ? new Response(plain[path]) : new Response('', { status: 404 });
    };
    const of1 = { ...config, api: { ...config.api, engine: 'of1' } };
    const { calls, fetchImpl } = answering();
    await handleApiRoute(post(body()), env, of1, { fetchImpl, fetchPlain });
    assert.deepEqual(calls[0].body.placeholders[0].descriptions, {
      india: 'India offer Diwali savings.', default: 'Offers Our standard offer. Terms apply.',
    });
    assert.deepEqual(fetched.sort(), ['/fragments/personalization/offer/india', '/offers']);
    const { calls: kept, fetchImpl: keptImpl } = answering();
    await handleApiRoute(post(body((v) => {
      v.placeholders[0].descriptions = { india: 'Row text', default: 'Default row' };
      return v;
    })), env, of1, { fetchImpl: keptImpl, fetchPlain });
    assert.deepEqual(kept[0].body.placeholders[0].descriptions, { india: 'Row text', default: 'Default row' }, 'author rows win');
  });
});

describe('worker entry point (index.mjs)', () => {
  let worker;
  let originRequests;
  const realFetch = globalThis.fetch;

  before(async () => {
    ({ default: worker } = await bundle.load('index.mjs'));
    originRequests = [];
    globalThis.fetch = async (req) => {
      originRequests.push(req);
      const url = new URL(req.url);
      if (url.pathname === '/') return htmlResponse(PAGE, { age: '10', 'x-robots-tag': 'noindex' });
      if (url.pathname === '/sections') return htmlResponse(sectionPage('promo'));
      const fragment = FRAGMENTS[url.pathname.replace(/\.plain\.html$/, '')];
      if (fragment) return htmlResponse(fragment);
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    };
  });
  after(() => { globalThis.fetch = realFetch; });

  const env = { ORIGIN_HOSTNAME: 'main--site--org.aem.live' };
  const ctx = { waitUntil: () => {} };
  const visit = (path, headers = {}) => Object.assign(new Request(`https://www.example.com${path}`, {
    headers: {
      'user-agent': BROWSER, host: 'www.example.com', cookie: 'pzn-consent=1', ...headers,
    },
  }), { cf: { country: 'IN' } });

  it('fetches the AEM origin with an unchanged cache key and personalizes the HTML', async () => {
    const start = originRequests.length;
    const out = await worker.fetch(visit('/?utm_campaign=x'), env, ctx);
    const origin = originRequests[start];
    assert.equal(origin.url, 'https://main--site--org.aem.live/');
    assert.equal(originRequests.at(-1).url, 'https://main--site--org.aem.live/fragments/personalization/home-hero/india.plain.html');
    assert.equal(origin.headers.get('x-byo-cdn-type'), 'cloudflare');
    assert.equal(out.headers.get('x-robots-tag'), null);
    assert.equal(out.headers.get('x-pzn'), 'edge');
    assert.equal(out.headers.get('cache-control'), 'private, no-cache');
    const text = await out.text();
    assert.equal(pzn(text, 'home-hero').variant, 'india');
    assert.match(section(text, 'home-hero').inner, /<template data-pzn-default>[\s\S]*Original hero[\s\S]*<\/template>$/);
  });

  it('fetches section fragments from the AEM origin', async () => {
    const out = await worker.fetch(visit('/sections'), env, ctx);
    const origin = originRequests.at(-1);
    assert.equal(origin.url, 'https://main--site--org.aem.live/fragments/personalization/promo/india.plain.html');
    assert.equal(origin.headers.get('x-forwarded-host'), 'www.example.com');
    assert.equal(section(await out.text(), 'promo').inner, withTemplate('<p>India promo</p>', 'promo'));
  });

  it('leaves sections to the browser without the consent cookie', async () => {
    const start = originRequests.length;
    const out = await worker.fetch(visit('/sections', { cookie: '' }), env, ctx);
    untouched(await out.text(), 'promo');
    assert.equal(originRequests.length, start + 1, 'no fragment fetched');
  });

  it('keeps the official worker behavior for non-HTML and invalid origins', async () => {
    const json = await worker.fetch(new Request('https://www.example.com/data.json?limit=1&x=2'), env, ctx);
    assert.equal(originRequests.at(-1).url, 'https://main--site--org.aem.live/data.json?limit=1');
    assert.equal(json.headers.get('x-pzn'), null);
    const invalid = await worker.fetch(new Request('https://www.example.com/'), { ORIGIN_HOSTNAME: 'evil.example' }, ctx);
    assert.equal(invalid.status, 500);
    const drafts = await worker.fetch(new Request('https://www.example.com/drafts/x'), env, ctx);
    assert.equal(drafts.status, 404);
  });

  it('routes /pzn/decide before the origin', async () => {
    const before = originRequests.length;
    const out = await worker.fetch(new Request('https://www.example.com/pzn/decide', { method: 'POST', body: '{}' }), env, ctx);
    assert.equal(out.status, 503);
    assert.equal(originRequests.length, before);
  });
});
