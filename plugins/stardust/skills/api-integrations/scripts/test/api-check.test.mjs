import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildParity, RUNNERS, writeBack } from '../api-check.mjs';
import { loadPlaywright } from '../lib/lib.mjs';
import { startFixture } from './fixture-server.mjs';

const fixtureDir = join(process.cwd(), 'scripts/test/fixtures');
const baseContract = JSON.parse(await readFile(join(fixtureDir, 'contract-contact-form.json'), 'utf8'));

async function ensurePlaywright(t) {
  try {
    await loadPlaywright();
    return true;
  } catch (error) {
    t.skip(error.message);
    return false;
  }
}

async function withBrowserFixture(t, fn) {
  if (!(await ensurePlaywright(t))) return undefined;
  const fixture = await startFixture();
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  try {
    return await fn({ ...fixture, browser, ctx });
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    await fixture.close();
    await rm('stardust', { recursive: true, force: true });
  }
}

function contract(overrides = {}) {
  return structuredClone({
    ...baseContract,
    responses: {
      ...baseContract.responses,
      success: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        schema: {
          type: 'object',
          properties: { success: { type: 'boolean' }, message: { type: 'string' } },
          required: ['success', 'message'],
        },
        example: { success: true, message: 'Thanks from fixture' },
      },
    },
    uiBehavior: {
      ...baseContract.uiBehavior,
      success: {
        text: 'Thanks from fixture',
        reset: true,
        dataLayer: [{ event: 'form_submit', form: 'contact-form' }],
      },
    },
    ...overrides,
  });
}

function firstCheck(type, c = contract(), path = '/rebuilt.html') {
  const inventory = { integrations: [{ id: c.id, kind: c.kind, endpoint: c.endpoint, method: c.method, status: c.status }] };
  const parity = buildParity(inventory, [c]);
  const check = parity.features[0].checks.find((entry) => entry.type === type);
  return { ...check, path };
}

function readContract(endpoint) {
  return {
    id: 'api-list',
    endpoint,
    method: 'GET',
    contentType: null,
    graphql: null,
    kind: 'rest-read',
    origin: 'first-party',
    trigger: { type: 'load', selector: null },
    pages: ['/rebuilt-read.html'],
    reach: 1,
    auth: { scheme: 'none', headerNames: [] },
    requestSchema: {},
    requestExample: null,
    fieldMap: [],
    clientDeps: [],
    responses: {
      success: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
        example: { message: 'Loaded list', items: [] },
      },
      error: null,
    },
    uiBehavior: { success: { text: 'Loaded list', reset: false, dataLayer: [] }, error: null },
    status: 'contracted',
    confirmed: true,
    cors: null,
  };
}

test('L1 passes on the rebuilt page and blocks the real endpoint', async (t) => withBrowserFixture(t, async ({ origin, ctx, hits }) => {
  const result = await RUNNERS['api-contract'](firstCheck('api-contract'), { ctx, origin, contract: contract() });

  assert.equal(result.pass, true, result.detail);
  assert.equal(hits.get('POST /api/form/contact-form'), undefined);
}));

test('L1 fails when the rebuilt page sends fname instead of formData.firstName', async (t) => withBrowserFixture(t, async ({ origin, ctx, hits }) => {
  const result = await RUNNERS['api-contract'](firstCheck('api-contract', contract(), '/rebuilt-fname.html'), { ctx, origin, contract: contract() });

  assert.equal(result.pass, false);
  assert.match(result.detail, /formData\.firstName/);
  assert.equal(hits.get('POST /api/form/contact-form'), undefined);
}));

test('L2 renders success and error flows without reaching the endpoint', async (t) => withBrowserFixture(t, async ({ origin, ctx, hits }) => {
  const result = await RUNNERS['api-mocked-flow'](firstCheck('api-mocked-flow'), { ctx, origin, contract: contract() });

  assert.equal(result.pass, true, result.detail);
  assert.match(result.detail, /form_submit/);
  assert.match(result.detail, /form_submit_error/);
  assert.equal(hits.get('POST /api/form/contact-form'), undefined);
}));

test('L3 CORS block is an environment limit for confirmed invalid writes', async (t) => withBrowserFixture(t, async ({ origin, noCorsOrigin, ctx }) => {
  const c = contract({ endpoint: `${noCorsOrigin}/api/form/contact-form` });
  const result = await RUNNERS['api-live-write-invalid'](firstCheck('api-live-write-invalid', c), {
    ctx,
    origin,
    contract: c,
    cors: { results: [{ id: c.id, origins: { preview: { origin, allowed: false, reasons: ['no Access-Control-Allow-Origin'] } } }] },
    confirm: new Set(['POST /api/form/contact-form']),
  });

  assert.equal(result.pass, true, result.detail);
  assert.match(result.environmentLimit, /^cors-blocked: /);
}));

test('L3 CORS block is an environment limit for live reads', async (t) => withBrowserFixture(t, async ({ origin, noCorsOrigin, ctx }) => {
  const c = readContract(`${noCorsOrigin}/api/list`);
  const result = await RUNNERS['api-live-read'](firstCheck('api-live-read', c, '/rebuilt-read.html'), {
    ctx,
    origin,
    contract: c,
    cors: { results: [{ id: c.id, origins: { preview: { origin, allowed: false, reasons: ['no Access-Control-Allow-Origin'] } } }] },
  });

  assert.equal(result.pass, true, result.detail);
  assert.match(result.environmentLimit, /^cors-blocked: /);
}));

test('L4 refuses without confirmation and sends no request', async (t) => withBrowserFixture(t, async ({ origin, ctx, hits }) => {
  const result = await RUNNERS['api-live-write-valid'](firstCheck('api-live-write-valid'), { ctx, origin, contract: contract() });

  assert.equal(result.pass, false);
  assert.equal(result.detail, 'not confirmed');
  assert.equal(hits.get('POST /api/form/contact-form'), undefined);
}));

test('L4 blocks page-load matching writes until submit is armed', async (t) => withBrowserFixture(t, async ({ origin, ctx, hits }) => {
  const c = contract({ endpoint: `${origin}/api/form/contact-form` });
  const result = await RUNNERS['api-live-write-valid'](firstCheck('api-live-write-valid', c, '/rebuilt-load-write.html'), {
    ctx,
    origin,
    contract: c,
    confirmLiveWrite: c.id,
  });

  assert.equal(result.pass, true, result.detail);
  assert.equal(hits.get('POST /api/form/contact-form'), 1);
}));

test('L4 diffs the live payload and aborts drifted writes', async (t) => withBrowserFixture(t, async ({ origin, ctx, hits }) => {
  const c = contract({ endpoint: `${origin}/api/form/contact-form` });
  const result = await RUNNERS['api-live-write-valid'](firstCheck('api-live-write-valid', c, '/rebuilt-fname.html'), {
    ctx,
    origin,
    contract: c,
    confirmLiveWrite: c.id,
  });

  assert.equal(result.pass, false);
  assert.match(result.detail, /formData\.firstName/);
  assert.equal(hits.get('POST /api/form/contact-form'), undefined);
}));


test('L3 blocks page-load writes and allows only the confirmed invalid write once', async (t) => withBrowserFixture(t, async ({ origin, ctx, hits }) => {
  const c = contract({ endpoint: `${origin}/api/form/contact-form` });
  const result = await RUNNERS['api-live-write-invalid'](firstCheck('api-live-write-invalid', c, '/rebuilt-track-load.html'), {
    ctx,
    origin,
    contract: c,
    confirm: new Set(['POST /api/form/contact-form']),
  });

  assert.equal(result.pass, true, result.detail);
  assert.equal(hits.get('POST /api/track-load'), undefined);
  assert.equal(hits.get('POST /api/form/contact-form'), 1);
}));

test('L3 CORS limit requires a matching blocked origin', async (t) => withBrowserFixture(t, async ({ origin, noCorsOrigin, ctx }) => {
  const c = contract({ endpoint: `${noCorsOrigin}/api/form/contact-form` });
  const result = await RUNNERS['api-live-write-invalid'](firstCheck('api-live-write-invalid', c), {
    ctx,
    origin,
    contract: c,
    cors: { results: [{ id: c.id, origins: { preview: { origin: 'https://other.example', allowed: false, reasons: ['blocked'] } } }] },
    confirm: new Set(['POST /api/form/contact-form']),
  });

  assert.equal(result.pass, false);
  assert.equal(result.environmentLimit, undefined);
}));

test('L3 CORS limit requires a TypeError from fetch', async (t) => withBrowserFixture(t, async ({ origin, ctx }) => {
  const c = contract({ endpoint: `${origin}/api/form/contact-form` });
  const result = await RUNNERS['api-live-write-invalid'](firstCheck('api-live-write-invalid', c, '/rebuilt-recaptcha-error.html'), {
    ctx,
    origin,
    contract: c,
    cors: { results: [{ id: c.id, origins: { preview: { origin, allowed: false, reasons: ['blocked'] } } }] },
    confirm: new Set(['POST /api/form/contact-form']),
  });

  assert.equal(result.pass, false);
  assert.equal(result.environmentLimit, undefined);
}));

test('L1 and L2 support load-triggered reads', async (t) => withBrowserFixture(t, async ({ origin, ctx }) => {
  const c = readContract(`${origin}/api/list`);
  const l1 = await RUNNERS['api-contract'](firstCheck('api-contract', c, '/rebuilt-read.html'), { ctx, origin, contract: c });
  const l2 = await RUNNERS['api-mocked-flow'](firstCheck('api-mocked-flow', c, '/rebuilt-read.html'), { ctx, origin, contract: c });

  assert.equal(l1.pass, true, l1.detail);
  assert.equal(l2.pass, true, l2.detail);
}));

test('writeBack emits fetch-json only for first-party GET reads', () => {
  const inventory = { integrations: [
    { id: 'same-origin-items', kind: 'rest-read', method: 'GET', endpoint: '/api/items', origin: 'first-party', pages: ['/items'], reach: 1, status: 'verified-L3' },
    { id: 'remote-items', kind: 'rest-read', method: 'GET', endpoint: 'https://api.example.net/items', origin: 'third-party', pages: ['/items'], reach: 1, status: 'verified-L3' },
  ] };

  const { dynamicsParity } = writeBack(inventory, { featuresMd: null, dynamicsParity: null });
  const same = dynamicsParity.features.find((feature) => feature.id === 'api-same-origin-items');
  const remote = dynamicsParity.features.find((feature) => feature.id === 'api-remote-items');

  assert.ok(same.checks.some((check) => check.type === 'fetch-json'));
  assert.ok(!remote.checks.some((check) => check.type === 'fetch-json'));
});

test('runner returns failure instead of throwing when navigation setup fails', async (t) => {
  if (!(await ensurePlaywright(t))) return;
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const result = await RUNNERS['api-live-read'](firstCheck('api-live-read', readContract('http://127.0.0.1:9/api/list'), '/'), {
      ctx,
      origin: 'http://127.0.0.1:9',
      contract: readContract('http://127.0.0.1:9/api/list'),
    });
    assert.equal(result.pass, false);
    assert.match(result.detail, /error:/);
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
});

test('writeBack is idempotent and maps statuses', () => {
  const inventory = { integrations: [
    { id: 'contact-form', kind: 'rest-write', method: 'POST', endpoint: '/api/form/contact-form', pages: ['/contact-us'], reach: 1, status: 'verified-L3' },
    { id: 'newsletter', kind: 'rest-write', method: 'POST', endpoint: '/api/newsletter', pages: ['/'], reach: 1, status: 'blocked-cors' },
  ] };
  const once = writeBack(inventory, { featuresMd: null, dynamicsParity: null });
  const twice = writeBack(inventory, once);

  assert.equal((twice.featuresMd.match(/api-contact-form/g) || []).length, 1);
  assert.match(twice.featuresMd, /api-contact-form \| contact-form \| F \| 1 \| rebuild-native \| self \| done/);
  assert.match(twice.featuresMd, /api-newsletter \| newsletter \| F \| 1 \| rebuild-native \| needs-backend \| scaffolded-awaiting-owner/);
} );

test('writeBack never emits form-flow and only uses dynamics-safe checks', () => {
  const inventory = { integrations: [
    { id: 'contact-form', kind: 'rest-write', method: 'POST', endpoint: '/api/form/contact-form', pages: ['/contact-us'], reach: 1, status: 'verified-L4' },
    { id: 'items', kind: 'rest-read', method: 'GET', endpoint: '/api/items', pages: ['/items'], reach: 1, status: 'verified-L3' },
  ] };

  const { dynamicsParity } = writeBack(inventory, { featuresMd: null, dynamicsParity: null });
  const types = dynamicsParity.features.flatMap((feature) => feature.checks.map((check) => check.type));

  assert.ok(!types.includes('form-flow'));
  assert.ok(types.every((type) => ['no-page-errors', 'dom-count', 'fetch-json'].includes(type)));
});
