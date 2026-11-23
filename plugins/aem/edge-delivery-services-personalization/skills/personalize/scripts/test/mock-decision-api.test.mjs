import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  DECIDE_PATH, DELIVERY_PATH, FEEDBACK_PATH, checkDeliveryRequest, checkFeedback, checkRequest,
  createMockServer,
} from '../mock-decision-api.mjs';
import { check } from '../schema.mjs';
import { contract, fixture, runHelp } from './helpers.mjs';

const DECISIONS = JSON.parse(fixture('decisions.json'));
const SPEC = {
  id: 'offer',
  source: 'api',
  variants: [{ name: 'india', path: '/fragments/personalization/offer/india' }, { name: 'diwali', path: '/fragments/personalization/offer/diwali' }],
  rules: [],
  descriptions: {},
};
const request = (context = {}, consent = true) => contract.buildRequest({
  page: { path: '/offer' }, specs: [SPEC], context, consent, mode: 'client',
});
const ACTIVITIES = {
  'scroll-offer': {
    name: 'Scroll offer',
    experiences: [
      { name: 'Returning', audience: 'visitor: returning', offer: '/fragments/x/welcome-back' },
      { name: 'Everyone', audience: null, control: true },
    ],
  },
};

describe('request checks', () => {
  it('accepts what the runtime sends and rejects anything else (decision-request.schema.json)', () => {
    assert.deepEqual(check('decision-request', request({ geo: { country: 'IN' } })), []);
    assert.equal(checkRequest(request({ geo: { country: 'IN' } })), null);
    assert.match(checkRequest({ version: '2' }), /version|missing/);
    assert.match(checkRequest({ ...request(), mode: 'browser' }), /mode/);
    assert.match(checkRequest({ ...request(), extra: 1 }), /extra/);
  });

  it('checks feedback and Delivery API bodies', () => {
    const feedback = {
      version: '1', page: { path: '/' }, events: [{ id: 'offer', decisionId: 'offer#1', variant: 'india', type: 'seen' }],
    };
    assert.equal(checkFeedback(feedback), null);
    assert.match(checkFeedback({ ...feedback, events: [{ ...feedback.events[0], type: 'viewed' }] }), /type/);
    assert.equal(checkDeliveryRequest({ prefetch: { mboxes: [] } }), null);
    assert.equal(checkDeliveryRequest({ notifications: [] }), null);
    assert.match(checkDeliveryRequest({}), /prefetch.mboxes or notifications/);
    assert.match(checkDeliveryRequest(null), /JSON object/);
  });
});

describe('mock server', () => {
  let server;
  let base;
  const logs = [];
  const post = async (path, body, headers = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  };

  before(async () => {
    server = createMockServer({
      decisions: DECISIONS, target: ACTIVITIES, knob: null, log: (line) => logs.push(line),
    });
    await new Promise((done) => { server.listen(0, done); });
    base = `http://localhost:${server.address().port}`;
  });
  after(() => server.close());

  it('decides from the table in order, with tracking, ttl and cacheable', async () => {
    const india = await post(DECIDE_PATH, request({ geo: { country: 'IN' }, visitor: 'returning' }));
    assert.equal(india.status, 200);
    assert.deepEqual([india.body.decisions.offer.variant, india.body.decisions.offer.tracking.engine, india.body.decisions.offer.tracking.rule], ['india', 'mock', 'geo: IN & visitor: returning']);
    assert.deepEqual([india.body.ttl, india.body.cacheable], [60, true]);
    assert.deepEqual(check('decision-response', india.body), []);
    assert.equal((await post(DECIDE_PATH, request({ geo: { country: 'US' } }))).body.decisions.offer.variant, 'default');
    assert.deepEqual((await post(DECIDE_PATH, request({ device: 'mobile' }))).body.decisions.offer.control, true);
    assert.deepEqual((await post(DECIDE_PATH, request({ geo: { country: 'DE' } }))).body.decisions, {}, 'no match: the section is left out');
    assert.equal(india.headers.get('access-control-allow-origin'), '*');
  });

  it('rejects non-conforming requests with 400', async () => {
    const bad = await post(DECIDE_PATH, { version: '1', placeholders: [{ id: 'offer' }], context: {} });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /page|mode|candidates/);
    assert.equal((await post(DECIDE_PATH, 'not json')).status, 400);
  });

  it('applies a knob from the x-pzn-mock header', async () => {
    const body = request({ geo: { country: 'IN' }, visitor: 'returning' });
    assert.equal((await post(DECIDE_PATH, body, { 'x-pzn-mock': 'fail' })).status, 500);
    const low = await post(DECIDE_PATH, body, { 'x-pzn-mock': 'reason:low_confidence' });
    assert.equal(low.body.decisions.offer.reason, 'low_confidence');
    assert.equal((await post(DECIDE_PATH, body, { 'x-pzn-mock': 'control' })).body.decisions.offer.control, true);
    assert.equal((await post(DECIDE_PATH, body, { 'x-pzn-mock': 'variant:diwali' })).body.decisions.offer.variant, 'diwali');
    assert.deepEqual((await post(DECIDE_PATH, body, { 'x-pzn-mock': 'missing' })).body.decisions, {});
    const invalid = await post(DECIDE_PATH, body, { 'x-pzn-mock': 'invalid' });
    assert.equal(invalid.status, 200);
    assert.notDeepEqual(check('decision-response', invalid.body), []);
    assert.equal((await post(DECIDE_PATH, body, { 'x-pzn-mock': 'nonsense' })).body.decisions.offer.variant, 'india', 'unknown knobs are ignored');
  });

  it('accepts decision feedback', async () => {
    const ok = await post(FEEDBACK_PATH, {
      version: '1', page: { path: '/' }, events: [{ id: 'offer', decisionId: 'offer#1', variant: 'india', type: 'clicked' }],
    });
    assert.equal(ok.status, 204);
    assert.equal((await post(FEEDBACK_PATH, { version: '1' })).status, 400);
    assert.ok(logs.some((line) => /feedback offer#1 clicked/.test(line)));
  });

  it('answers Target prefetch with JSON offers and echoes notification ids', async () => {
    const prefetch = await post(`${DELIVERY_PATH}?client=acme`, {
      requestId: 'r1', prefetch: { mboxes: [{ index: 0, name: 'scroll-offer', parameters: { visitor: 'returning' } }, { index: 1, name: 'none' }] },
    });
    const [mbox, empty] = prefetch.body.prefetch.mboxes;
    assert.deepEqual(mbox.options[0].content, { fragment: '/fragments/x/welcome-back' });
    assert.equal(mbox.options[0].type, 'json');
    assert.ok(mbox.options[0].eventToken);
    assert.equal(mbox.metrics[0].type, 'click');
    assert.equal(empty.options, undefined);
    assert.equal(prefetch.body.client, 'acme');
    const control = await post(DELIVERY_PATH, { prefetch: { mboxes: [{ index: 0, name: 'scroll-offer' }] } });
    assert.deepEqual(control.body.prefetch.mboxes[0].options[0].content, { control: true });
    const notified = await post(DELIVERY_PATH, { notifications: [{ id: 'n-1', type: 'display' }, { id: 'n-2', type: 'click' }] });
    assert.deepEqual(notified.body.notifications, [{ id: 'n-1' }, { id: 'n-2' }]);
    assert.equal((await post(DELIVERY_PATH, { prefetch: { mboxes: [] } }, { 'x-pzn-mock': 'fail' })).status, 500);
  });

  it('records requests and serves health', async () => {
    const list = await (await fetch(`${base}/requests`)).json();
    assert.ok(list.some((entry) => entry.path === DECIDE_PATH));
    await fetch(`${base}/requests`, { method: 'DELETE' });
    assert.deepEqual(await (await fetch(`${base}/requests`)).json(), []);
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
    assert.equal((await fetch(`${base}/decide`)).status, 405);
    assert.equal((await post('/other', {})).status, 404);
    assert.equal((await fetch(`${base}/decide`, { method: 'OPTIONS' })).status, 204);
  });
});

describe('mock server options', () => {
  it('applies --knob, --latency, --ttl and --cacheable', async () => {
    const server = createMockServer({
      decisions: { placeholders: { offer: { '*': 'india' } } }, knob: { kind: 'default' }, latency: 50, ttl: 0, cacheable: true, log: () => {},
    });
    await new Promise((done) => { server.listen(0, done); });
    try {
      const started = Date.now();
      const response = await fetch(`http://localhost:${server.address().port}${DECIDE_PATH}`, { method: 'POST', body: JSON.stringify(request()) });
      const body = await response.json();
      assert.ok(Date.now() - started >= 45);
      assert.deepEqual([body.decisions.offer.variant, body.ttl, body.cacheable], ['default', 0, true]);
    } finally {
      server.close();
    }
  });
});

describe('mock-decision-api.mjs --help', () => {
  it('prints the usage, exits 0 and writes nothing', () => {
    const { status, stdout, wrote } = runHelp('mock-decision-api.mjs');
    assert.equal(status, 0);
    assert.match(stdout, /^Usage/);
    assert.match(stdout, /x-pzn-mock/);
    assert.deepEqual(wrote, []);
  });
});
