import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { checkRequest, createMockServer, engineDecide } from '../mock-decision-api.mjs';
import { fixture, runHelp } from './helpers.mjs';

const DECISIONS = JSON.parse(fixture('decisions.json'));

describe('mock decision engine', () => {
  const body = (overrides = {}) => ({
    version: '1', placeholders: [{ id: 'offer' }, { id: 'other' }], context: { geo: { country: 'IN' }, visitor: 'returning' }, ...overrides,
  });

  it('decides from the conditions table in order', async () => {
    assert.deepEqual(await engineDecide(DECISIONS, body()), {
      decisions: { offer: { variant: 'india', tracking: { engine: 'mock', rule: 'geo: IN & visitor: returning' } } },
      ttl: 60,
      cacheable: true,
    });
    const us = await engineDecide(DECISIONS, body({ context: { geo: { country: 'US' } } }));
    assert.equal(us.decisions.offer.variant, null);
    const none = await engineDecide(DECISIONS, body({ context: {} }));
    assert.deepEqual(none.decisions, {});
    const fallback = await engineDecide({ placeholders: { offer: { '*': { fragment: '/fragments/x/y' } } } }, body());
    assert.deepEqual(fallback, {
      decisions: { offer: { fragment: '/fragments/x/y', tracking: { engine: 'mock', rule: '*' } } }, ttl: 300, cacheable: false,
    });
  });

  it('checks requests against the contract', () => {
    assert.equal(checkRequest(body()), null);
    assert.match(checkRequest(null), /JSON object/);
    assert.match(checkRequest(body({ version: '2' })), /version/);
    assert.match(checkRequest(body({ placeholders: {} })), /array/);
    assert.match(checkRequest(body({ placeholders: [{}] })), /needs an id/);
    assert.match(checkRequest(body({ context: null })), /context/);
  });

  describe('server', () => {
    const servers = [];
    after(() => servers.forEach((server) => server.close()));
    const start = async (options) => {
      const server = createMockServer(options);
      servers.push(server);
      await new Promise((done) => { server.listen(0, done); });
      return `http://localhost:${server.address().port}`;
    };
    const post = (url, payload) => fetch(`${url}/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });

    it('serves the contract and records requests', async () => {
      const { log } = console;
      console.log = () => {};
      try {
        const url = await start({ decisions: DECISIONS });
        const response = await post(url, body());
        assert.equal(response.headers.get('access-control-allow-origin'), '*');
        assert.equal((await response.json()).decisions.offer.variant, 'india');
        assert.equal((await (await fetch(`${url}/requests`)).json()).length, 1);
        await fetch(`${url}/requests`, { method: 'DELETE' });
        assert.deepEqual(await (await fetch(`${url}/requests`)).json(), []);
        assert.deepEqual(await (await fetch(`${url}/health`)).json(), { ok: true });
        assert.equal((await fetch(`${url}/decide`, { method: 'OPTIONS' })).status, 204);
        assert.equal((await fetch(`${url}/decide`)).status, 405);
      } finally {
        console.log = log;
      }
    });

    it('injects failures, invalid bodies and latency', async () => {
      const { warn } = console;
      console.warn = () => {};
      try {
        assert.equal((await post(await start({ fail: 503 }), body())).status, 503);
        const invalid = await post(await start({ invalid: true }), body());
        await assert.rejects(invalid.json());
        const slow = await start({ latency: 120, decisions: DECISIONS });
        const started = Date.now();
        await (await post(slow, body())).json();
        assert.ok(Date.now() - started >= 100);
        const strict = await start({});
        assert.equal((await post(strict, body({ version: '0' }))).status, 400);
        assert.equal((await post(strict, '{oops')).status, 400);
      } finally {
        console.warn = warn;
      }
    });
  });
});

describe('mock-decision-api.mjs --help', () => {
  it('prints the usage, exits 0 and writes nothing', () => {
    const { status, stdout, wrote } = runHelp('mock-decision-api.mjs');
    assert.equal(status, 0);
    assert.match(stdout, /^Usage/);
    assert.deepEqual(wrote, []);
  });
});
