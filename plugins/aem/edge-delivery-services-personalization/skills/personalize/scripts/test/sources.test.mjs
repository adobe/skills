/*
 * Decision sources (scripts/personalization/sources/*.js) in Node with a
 * minimal browser stub: the engine request (api.js, contract section 5),
 * split assignment (6a), and Adobe Target over the Delivery API and the Web
 * SDK (7). The browser behaviour is covered by sections.test.mjs.
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, it } from 'node:test';
import { RUNTIME_DIR } from '../lib.mjs';
import { check } from '../schema.mjs';

function storage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    keys: () => [...data.keys()],
  };
}

// The globals the sources read. Reset before every test.
function browser(url = 'https://www.example.com/offers?utm_source=news') {
  let cookies = {};
  globalThis.window = {
    location: new URL(url),
    sessionStorage: storage(),
    localStorage: storage(),
    screen: { width: 1440, height: 900 },
    innerWidth: 1280,
    innerHeight: 800,
    crypto: globalThis.crypto,
  };
  globalThis.document = {
    referrer: 'https://www.google.com/',
    title: 'Offers',
    documentElement: { lang: 'en-US' },
    get cookie() {
      return Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');
    },
    set cookie(value) {
      const [pair] = value.split(';');
      const index = pair.indexOf('=');
      cookies = { ...cookies, [pair.slice(0, index)]: pair.slice(index + 1) };
    },
  };
}
browser();

const load = (...parts) => import(pathToFileURL(join(RUNTIME_DIR, 'scripts', 'personalization', ...parts)).href);
const { parseSection } = await load('section-spec.js');
const split = await load('sources', 'split.js');
const target = await load('sources', 'target.js');
const websdk = await load('sources', 'target-websdk.js');
const { apiAnswers } = await load('sources', 'api.js');
const { targetOutcome } = await load('outcomes.js');

const F = '/fragments/personalization';
const section = (pairs) => parseSection(Object.entries(pairs)
  .map(([key, value]) => [key ? `data-personalization-${key}` : 'data-personalization', value]));

beforeEach(() => browser());

describe('api source', () => {
  const spec = section({
    '': 'offer', source: 'api', variants: `${F}/offer/promo,${F}/offer/india`, 'rule-india': 'geo: IN',
  });
  const context = {
    geo: { country: 'IN' }, device: 'desktop', visitor: 'returning', state: { quiz: 'a' }, params: { utm_source: 'news', email: 'a@b.c' }, referrer: 'www.google.com',
  };
  const engine = (answer, calls) => async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), init });
    return typeof answer === 'function' ? answer() : Response.json(answer);
  };

  it('sends one schema-valid v1 request for the page and keeps the answer for the session with consent', async () => {
    const calls = [];
    const result = await apiAnswers([spec], context, {
      config: { api: { endpoint: '/pzn/decide' } },
      consent: true,
      fetch: engine({ decisions: { offer: { variant: 'promo' } }, ttl: 60 }, calls),
      timeout: 500,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/pzn/decide');
    assert.equal(calls[0].init.credentials, 'same-origin');
    assert.deepEqual(check('decision-request', calls[0].body), []);
    assert.deepEqual(calls[0].body.page, { path: '/offers', locale: 'en-US', title: 'Offers' });
    assert.deepEqual(calls[0].body.context.params, { utm_source: 'news' });
    assert.equal(calls[0].body.context.visitor, 'returning');
    assert.equal(calls[0].body.mode, 'client');
    assert.deepEqual(result.response.decisions, { offer: { variant: 'promo' } });
    assert.ok(window.sessionStorage.keys().some((key) => key.startsWith('pzn-decisions:')));
  });

  it('with the api exception: request data only, nothing kept', async () => {
    const calls = [];
    await apiAnswers([spec], context, {
      config: { api: { endpoint: '/pzn/decide' } },
      consent: false,
      fetch: engine({ decisions: {}, ttl: 60 }, calls),
      timeout: 500,
    });
    assert.deepEqual(check('decision-request', calls[0].body), []);
    assert.equal(calls[0].body.context.visitor, undefined);
    assert.equal(calls[0].body.context.state, undefined);
    assert.deepEqual(calls[0].body.context.consent, { personalization: false });
    assert.deepEqual(window.sessionStorage.keys(), []);
  });

  it('reports failures with their kind: no endpoint, HTTP, timeout', async () => {
    const run = (fetch, config = { api: { endpoint: '/d' } }, timeout = 500) => apiAnswers([spec], {}, {
      config, consent: true, fetch, timeout,
    });
    assert.deepEqual(await run(null, {}), { error: 'no endpoint (config.api.endpoint)', kind: 'http', cached: false });
    assert.equal((await run(async () => new Response('', { status: 502 }))).kind, 'http');
    const hang = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    assert.equal((await run(hang, undefined, 20)).kind, 'timeout');
  });
});

describe('split source (6a)', () => {
  const spec = section({
    '': 'msg', source: 'split', variants: `${F}/msg/speed,${F}/msg/team`, split: '40, 30',
  });

  it('reads and writes the pzn-split cookie value', () => {
    assert.deepEqual(split.parseAssignments('msg:team, pick:y,broken,:x'), { msg: 'team', pick: 'y' });
    assert.equal(split.formatAssignments({ msg: 'team', pick: 'y' }), 'msg:team,pick:y');
    assert.equal(split.COOKIE, 'pzn-split');
  });

  it('draws once per session and keeps the arm in sessionStorage and the session cookie', () => {
    assert.equal(split.splitArm(spec, { random: () => 0.5 }), 'team');
    assert.equal(window.sessionStorage.getItem('pzn-split:msg'), 'team');
    assert.match(document.cookie, /pzn-split=msg%3Ateam/);
    assert.doesNotMatch(document.cookie, /max-age|expires/i, 'a session cookie');
    assert.equal(split.splitArm(spec, { random: () => 0.99 }), 'team', 'kept for the session');
  });

  it('agrees with the edge: an assignment in the cookie wins in a new tab', () => {
    document.cookie = `pzn-split=${encodeURIComponent('msg:default')}; path=/`;
    assert.equal(split.splitArm(spec, { random: () => 0 }), 'default');
  });

  it('draws again when the kept arm was removed', () => {
    window.sessionStorage.setItem('pzn-split:msg', 'gone');
    assert.equal(split.splitArm(spec, { random: () => 0.1 }), 'speed');
  });
});

describe('Target over the Delivery API (7)', () => {
  const offer = section({ '': 'plan-offer', source: 'target', variants: `${F}/plan-offer/trial,${F}/plan-offer/demo` });
  const hero = section({
    '': 'hero', source: 'target', variants: `${F}/hero/a`, location: 'hero-mbox',
  });
  const config = { target: { clientCode: 'acme', propertyToken: 'p1' } };
  const mbox = (index, name, content, extra = {}) => ({
    index,
    name,
    options: [{
      type: 'json', content, eventToken: `display-${name}`, responseTokens: { 'activity.name': 'Plans', 'experience.name': 'B', 'profile.age': '42' },
    }],
    metrics: [{ type: 'click', eventToken: `click-${name}` }],
    ...extra,
  });

  it('reads JSON offers: fragment, control, and nothing else', () => {
    assert.deepEqual(target.readOffer({ fragment: `${F}/x/a`, note: 'ignored' }), { fragment: `${F}/x/a` });
    assert.deepEqual(target.readOffer({ control: true }), { control: true });
    assert.ok(target.readOffer({ control: false }).invalid);
    assert.ok(target.readOffer({ fragment: `${F}/x/a`, control: true }).invalid);
    assert.ok(target.readOffer({ fragment: 'https://evil.example/fragments/x' }).invalid);
    assert.ok(target.readOffer('<div>html</div>').invalid);
  });

  it('keeps activity and experience names as tracking, never profile tokens', () => {
    assert.deepEqual(target.trackingOf({ 'activity.name': 'A', 'experience.id': 3, 'profile.age': '42', 'geo.city': 'x' }), {
      'activity.name': 'A', 'experience.id': 3,
    });
    assert.equal(target.trackingOf({ 'profile.age': '42' }), undefined);
  });

  it('prefetches every location in one request with device and visitor', () => {
    const body = target.prefetchRequest(['plan-offer', 'hero-mbox'], { device: 'mobile', visitor: 'new', geo: { country: 'IN' } }, {
      requestId: 'r1', tntId: 't1', propertyToken: 'p1', page: { url: 'https://www.example.com/', referrer: '' },
    });
    assert.deepEqual(body.prefetch.mboxes, [
      { index: 0, name: 'plan-offer', parameters: { device: 'mobile', visitor: 'new' } },
      { index: 1, name: 'hero-mbox', parameters: { device: 'mobile', visitor: 'new' } },
    ]);
    assert.deepEqual(body.id, { tntId: 't1' });
    assert.deepEqual(body.property, { token: 'p1' });
    assert.equal(body.context.channel, 'web');
    assert.equal(body.execute, undefined, 'prefetch never counts as a visit');
  });

  it('turns mboxes into answers with display and click tokens', () => {
    assert.deepEqual(target.toAnswer(mbox(0, 'plan-offer', { fragment: `${F}/plan-offer/trial` })), {
      fragment: `${F}/plan-offer/trial`,
      tracking: { 'activity.name': 'Plans', 'experience.name': 'B' },
      tokens: { display: ['display-plan-offer'], click: ['click-plan-offer'] },
    });
    assert.equal(target.toAnswer({ index: 0, name: 'x' }), undefined, 'nothing returned');
    assert.match(target.toAnswer({ options: [{ type: 'html', content: '<p>' }] }).invalid, /JSON offers only/);
  });

  it('decides the page\'s sections in one call and keeps the visitor id with consent', async () => {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), init });
      return Response.json({
        id: { tntId: 'tnt-1' },
        edgeHost: 'mboxedge31.tt.omtrdc.net',
        prefetch: { mboxes: [mbox(0, 'plan-offer', { control: true }), { index: 1, name: 'hero-mbox' }] },
      });
    };
    const result = await target.decide([offer, hero], { device: 'desktop' }, { config, fetch });
    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(url.host, 'acme.tt.omtrdc.net');
    assert.equal(url.pathname, '/rest/v1/delivery');
    assert.equal(url.searchParams.get('client'), 'acme');
    assert.ok(url.searchParams.get('sessionId'));
    assert.deepEqual(calls[0].body.prefetch.mboxes.map((m) => m.name), ['plan-offer', 'hero-mbox']);
    assert.equal(result.answers['plan-offer'].control, true);
    assert.equal(result.answers.hero, undefined);
    assert.equal(targetOutcome(offer, result.answers['plan-offer']).outcome, 'control');
    assert.equal(targetOutcome(hero, result.answers.hero).outcome, 'no-match');
    assert.equal(window.localStorage.getItem(target.TNT_ID_KEY), 'tnt-1');
    // The next call goes to the edge host Target answered from, with the same session.
    await target.decide([offer], {}, { config, fetch });
    const next = new URL(calls[1].url);
    assert.equal(next.host, 'mboxedge31.tt.omtrdc.net');
    assert.equal(next.searchParams.get('sessionId'), url.searchParams.get('sessionId'));
    assert.deepEqual(calls[1].body.id, { tntId: 'tnt-1' });
  });

  it('uses a same-origin proxy when configured, and reports config, HTTP and timeout failures', async () => {
    let seen;
    await target.decide([offer], {}, {
      config: { target: { clientCode: 'acme', endpoint: '/target/delivery' } },
      fetch: async (url) => { seen = new URL(url); return Response.json({}); },
    });
    assert.equal(seen.origin, 'https://www.example.com');
    assert.equal(seen.pathname, '/target/delivery');
    assert.deepEqual(await target.decide([offer], {}, { config: { target: {} }, fetch }), { error: 'no clientCode (config.target)', kind: 'config' });
    assert.deepEqual(await target.decide([offer], {}, { config, fetch: async () => new Response('', { status: 503 }) }), { error: 'HTTP 503', kind: 'http' });
    const hang = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    assert.equal((await target.decide([offer], {}, { config, fetch: hang, timeout: 20 })).kind, 'timeout');
  });

  it('notifies display and click; ok only when Target echoes the notification id', async () => {
    const decision = { tokens: { display: ['d1'], click: ['c1'] } };
    const sent = [];
    const echo = async (url, init) => {
      const body = JSON.parse(init.body);
      sent.push({ body, init });
      return Response.json({ notifications: body.notifications.map(({ id }) => ({ id })) });
    };
    assert.deepEqual(await target.notify({ type: 'display', spec: hero, decision }, { config, fetch: echo }), { ok: true });
    const [notification] = sent[0].body.notifications;
    assert.deepEqual([notification.type, notification.mbox, notification.tokens], ['display', { name: 'hero-mbox' }, ['d1']]);
    assert.ok(notification.id && Number.isFinite(notification.timestamp));
    assert.equal(sent[0].body.prefetch, undefined);
    assert.equal(sent[0].init.keepalive, true, 'a click must outlive the navigation');
    assert.deepEqual(await target.notify({ type: 'click', spec: hero, decision }, { config, fetch: echo }), { ok: true });
    assert.deepEqual(sent[1].body.notifications[0].tokens, ['c1']);
    // Target answered, but did not list this notification.
    assert.deepEqual(await target.notify({ type: 'display', spec: hero, decision }, { config, fetch: async () => Response.json({ notifications: [{ id: 'other' }] }) }), { ok: false });
    assert.deepEqual(await target.notify({ type: 'display', spec: hero, decision }, { config, fetch: async () => Response.json({}) }), { ok: false });
    assert.deepEqual(await target.notify({ type: 'display', spec: hero, decision }, { config, fetch: async () => new Response('', { status: 500 }) }), { ok: false });
    assert.equal(await target.notify({ type: 'click', spec: hero, decision: { tokens: { display: ['d1'] } } }, { config, fetch: echo }), null);
    assert.equal(target.notificationOk({ notifications: [{ id: 'n1' }] }, 'n1'), true);
    assert.equal(target.notificationOk({ notifications: [] }, 'n1'), false);
    assert.equal(target.notificationOk(null, 'n1'), false);
  });

  it('never stores notification tokens', async () => {
    await target.decide([offer], {}, {
      config,
      fetch: async () => Response.json({ prefetch: { mboxes: [mbox(0, 'plan-offer', { fragment: `${F}/plan-offer/trial` })] } }),
    });
    const stored = [...window.sessionStorage.keys(), ...window.localStorage.keys()]
      .map((key) => window.sessionStorage.getItem(key) || window.localStorage.getItem(key)).join(' ');
    assert.doesNotMatch(stored, /display-plan-offer|click-plan-offer/);
  });
});

describe('Target over the Web SDK (7)', () => {
  const offer = section({
    '': 'plan-offer', source: 'target', variants: `${F}/plan-offer/trial`, location: 'plans',
  });
  const proposition = (scope, content) => ({
    id: `p-${scope}`,
    scope,
    scopeDetails: { activity: { id: '101' }, experience: { id: '2' } },
    items: [{ schema: websdk.JSON_ITEM, data: { content } }],
  });

  it('fetches only the given locations, renders nothing, isn\'t a page view', () => {
    assert.deepEqual(websdk.fetchOptions(['plans', 'hero']), {
      type: 'decisioning.propositionFetch',
      renderDecisions: false,
      personalization: { decisionScopes: ['plans', 'hero'], defaultPersonalizationEnabled: false },
    });
  });

  it('decides through the existing alloy instance and reports display and click as proposition events', async () => {
    const calls = [];
    window.myAlloy = async (command, options) => {
      calls.push([command, options]);
      return options.type === 'decisioning.propositionFetch'
        ? { propositions: [proposition('plans', { fragment: `${F}/plan-offer/trial` })] } : {};
    };
    const config = { target: { transport: 'websdk', alloyInstance: 'myAlloy' } };
    const result = await websdk.decide([offer], {}, { config });
    assert.deepEqual(calls[0], ['sendEvent', websdk.fetchOptions(['plans'])]);
    const answer = result.answers['plan-offer'];
    assert.equal(answer.fragment, `${F}/plan-offer/trial`);
    assert.deepEqual(answer.tracking, { 'activity.id': '101', 'experience.id': '2' });
    assert.equal(targetOutcome(offer, answer).outcome, 'variant');

    assert.deepEqual(await websdk.notify({ type: 'display', decision: answer }, { config }), { ok: true });
    assert.deepEqual(calls[1][1], {
      xdm: {
        eventType: 'decisioning.propositionDisplay',
        _experience: {
          decisioning: {
            propositions: [{ id: 'p-plans', scope: 'plans', scopeDetails: { activity: { id: '101' }, experience: { id: '2' } } }],
            propositionEventType: { display: 1 },
          },
        },
      },
    });
    await websdk.notify({ type: 'click', decision: answer }, { config });
    assert.equal(calls[2][1].xdm.eventType, 'decisioning.propositionInteract');
    assert.deepEqual(calls[2][1].xdm._experience.decisioning.propositionEventType, { interact: 1 });
  });

  it('maps control, nothing returned, non-JSON items and a missing instance', async () => {
    assert.deepEqual(websdk.toAnswers([proposition('plans', { control: true })], ['plans']).plans.control, true);
    assert.equal(websdk.toAnswers([], ['plans']).plans, undefined);
    assert.equal(websdk.toAnswers([{ scope: 'plans', items: [] }], ['plans']).plans, undefined);
    assert.match(websdk.toAnswers([{ scope: 'plans', items: [{ schema: 'html' }] }], ['plans']).plans.invalid, /JSON content item/);
    assert.deepEqual(await websdk.decide([offer], {}, { config: { target: {} } }), { error: 'window.alloy is not loaded', kind: 'config' });
    window.alloy = async () => { throw new Error('datastream down'); };
    assert.deepEqual(await websdk.decide([offer], {}, { config: { target: {} } }), { error: 'datastream down', kind: 'http' });
    assert.deepEqual(await websdk.notify({ type: 'display', decision: { tokens: { display: [{}] } } }, { config: { target: {} } }), { ok: false });
  });
});
