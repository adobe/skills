import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

import { loadPlaywright } from '../lib/lib.mjs';
import { detect, synthValueFor } from '../api-detect.mjs';
import { startFixture } from './fixture-server.mjs';

async function ensurePlaywright(t) {
  try {
    await loadPlaywright();
    return true;
  } catch (error) {
    t.skip(error.message);
    return false;
  }
}

async function withFixture(t, fn) {
  if (!(await ensurePlaywright(t))) return undefined;
  const fixture = await startFixture();
  try {
    return await fn(fixture);
  } finally {
    await fixture.close();
    await rm('stardust', { recursive: true, force: true });
  }
}

function observationFor(result, method, path) {
  return result.observations.find((observation) => {
    const url = new URL(observation.url);
    return observation.method === method && url.pathname === path;
  });
}

const fixtureToken = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
const graphqlToken = 'ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210abcd';

test('blocks writes, passes reads', async (t) => withFixture(t, async ({ origin, hits }) => {
  const result = await detect({ urls: [`${origin}/contact`] });
  const observed = observationFor(result, 'POST', '/api/form/contact-form');

  assert.equal(hits.get('POST /api/form/contact-form'), undefined);
  assert.equal(hits.get('GET /api/list'), 1);
  assert.equal(observed.aborted, true);
  assert.equal(observed.kind, 'rest-write');
  assert.equal(observed.trigger.type, 'submit');
}));

test('captures client deps without persisting cookie or token values', async (t) => withFixture(t, async ({ origin }) => {
  const result = await detect({ urls: [`${origin}/contact`] });
  const observed = observationFor(result, 'POST', '/api/form/contact-form');

  assert.ok(observed.correlation.clientDeps.some((dep) => (
    dep.from === 'recaptcha' && dep.siteKey === 'site-key-x' && dep.action === 'FormSubmission'
  )));
  assert.ok(observed.correlation.clientDeps.some((dep) => dep.from === 'cookie' && dep.name === 'hubspotutk'));
  assert.ok(observed.correlation.fieldMap.some((entry) => (
    entry.path === 'formData.firstName' && entry.name === 'first-name' && entry.value === '<test:firstName>'
  )));

  const persisted = JSON.stringify(result);
  assert.equal(persisted.includes('abc123'), false);
  assert.equal(persisted.includes('token-site-key-x-FormSubmission'), false);
  assert.equal(persisted.includes('example-token'), false);
}));

test('aborts a document POST and keeps going', async (t) => withFixture(t, async ({ origin, hits }) => {
  const result = await detect({ urls: [`${origin}/contact`] });
  const observed = observationFor(result, 'POST', '/legacy');

  assert.equal(observed.resourceType, 'document');
  assert.equal(observed.aborted, true);
  assert.equal(hits.get('POST /legacy'), undefined);
  assert.ok(observationFor(result, 'POST', '/api/form/contact-form'));
}));

test('drives formless control groups as blocked writes', async (t) => withFixture(t, async ({ origin, hits }) => {
  const result = await detect({ urls: [`${origin}/contact`] });
  const observed = observationFor(result, 'POST', '/api/group');

  assert.equal(observed.aborted, true);
  assert.equal(observed.trigger.type, 'submit');
  assert.equal(hits.get('POST /api/group'), undefined);
}));

test('blocks beacon writes and popup page writes', async (t) => withFixture(t, async ({ origin, hits }) => {
  const result = await detect({ urls: [`${origin}/contact`] });
  const beacon = observationFor(result, 'POST', '/api/beacon');
  const popup = observationFor(result, 'POST', '/api/popup');

  assert.equal(beacon.aborted, true);
  assert.equal(popup.aborted, true);
  assert.equal(hits.get('POST /api/beacon'), undefined);
  assert.equal(hits.get('POST /api/popup'), undefined);
}));

test('persists multipart field names only and redacts URLs responses events and UI text', async (t) => withFixture(t, async ({ origin }) => {
  const result = await detect({ urls: [`${origin}/contact?session=${fixtureToken}`] });
  const upload = observationFor(result, 'POST', '/api/upload');
  const read = observationFor(result, 'GET', '/api/list');
  const contactForm = observationFor(result, 'POST', '/api/form/contact-form');
  const persisted = JSON.stringify(result);

  assert.deepEqual(JSON.parse(upload.body), { fields: ['upload-email', 'upload-message'] });
  assert.match(read.url, /[?&]token=/);
  assert.match(read.url, /[?&]email=/);
  assert.equal(persisted.includes(fixtureToken), false);
  assert.equal(persisted.includes('person@example.com'), false);
  assert.equal(persisted.includes('4155550199'), false);
  assert.equal(persisted.includes('api-probe@example.com'), false);
  assert.equal(persisted.includes('Blocked by detector'), true);
  assert.ok(contactForm.correlation.fieldMap.some((entry) => entry.value === '<test:email>'));
  assert.ok(contactForm.dataLayerAfter.some((event) => event.email === '<test:email>'));
  assert.match(read.response.body, /<email>|<token>/);
}));

test('redacts persisted GraphQL variables and query literals', async (t) => withFixture(t, async ({ origin, hits }) => {
  const result = await detect({ urls: [`${origin}/contact`] });
  const observed = observationFor(result, 'POST', '/graphql');
  const persisted = JSON.stringify(result);

  assert.equal(observed.aborted, true);
  assert.equal(observed.kind, 'graphql-mutation');
  assert.equal(hits.get('POST /graphql'), undefined);
  assert.equal(persisted.includes('someone@real.test'), false);
  assert.equal(persisted.includes('literal@real.test'), false);
  assert.equal(persisted.includes(graphqlToken), false);
  assert.deepEqual(observed.graphql[0].variables, { email: '<email>', token: '<token>' });
  assert.match(observed.graphql[0].query, /<email>/);
  assert.match(observed.graphql[0].query, /<token>/);
}));

test('redacts cookie and token values in GET GraphQL URL params', async (t) => withFixture(t, async ({ origin, hits }) => {
  const result = await detect({ urls: [`${origin}/contact`] });
  const observed = observationFor(result, 'GET', '/graphql');
  const persisted = JSON.stringify(result);

  assert.equal(observed.aborted, false);
  assert.equal(observed.kind, 'graphql-query');
  assert.equal(hits.get('GET /graphql'), 1);
  assert.equal(persisted.includes('abc123'), false);
  assert.equal(persisted.includes('token-site-key-x-FormSubmission'), false);
  assert.match(observed.url, /variables=/);
  assert.equal(decodeURIComponent(observed.url).includes('<cookie:hubspotutk>'), true);
  assert.equal(decodeURIComponent(observed.url).includes('<recaptcha>'), true);
  assert.deepEqual(observed.graphql[0].variables, { hutk: '<cookie:hubspotutk>', token: '<recaptcha>' });
  assert.equal(observed.response.body.includes('abc123'), false);
}));

test('page failures are recorded and later URLs still run', async (t) => withFixture(t, async ({ origin, hits }) => {
  const result = await detect({ urls: ['http://127.0.0.1:9/unreachable', `${origin}/contact`] });

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /ERR_CONNECTION_REFUSED|net::ERR|Cannot assign requested address|connection/i);
  assert.equal(hits.get('GET /api/list'), 1);
}));

test('top-level detection errors strip query values', async (t) => withFixture(t, async ({ origin }) => {
  const secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
  const result = await detect({ urls: [`http://127.0.0.1:9/unreachable?apiKey=SECRET123&token=${secret}`, `${origin}/contact`] });
  const persisted = JSON.stringify(result.errors);

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].url, /apiKey=/);
  assert.match(result.errors[0].url, /token=/);
  assert.equal(persisted.includes('SECRET123'), false);
  assert.equal(persisted.includes(secret), false);
}));

test('probe needs confirmation', async (t) => withFixture(t, async ({ origin }) => {
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [
      'scripts/api-detect.mjs',
      '--urls', `${origin}/contact`,
      '--probe-writes',
    ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

  assert.equal(result.code, 2, result.stderr);
  assert.match(result.stdout, /POST \/api\/form\/contact-form/);
}));

test('confirmed probe records the error', async (t) => withFixture(t, async ({ origin, hits }) => {
  const result = await detect({
    urls: [`${origin}/contact`],
    probeConfirm: ['POST /api/form/contact-form'],
  });
  const observed = observationFor(result, 'POST', '/api/form/contact-form');

  assert.equal(hits.get('POST /api/form/contact-form'), 1);
  assert.equal(observed.probe.response.status, 400);
  assert.match(observed.probe.response.body, /firstName must be at least 2 characters/);
}));

test('confirmed probe sends at most one real request per endpoint', async (t) => withFixture(t, async ({ origin, hits }) => {
  const result = await detect({
    urls: [`${origin}/contact`],
    probeConfirm: ['POST /api/form/contact-form'],
  });
  const probed = result.observations.filter((observation) => observation.probe?.response && new URL(observation.url).pathname === '/api/form/contact-form');

  assert.equal(hits.get('POST /api/form/contact-form'), 1);
  assert.equal(probed.length, 1);
}));

test('synthValueFor uses typed synthetic fixture values', () => {
  assert.equal(synthValueFor({ type: 'email' }), 'api-probe@example.com');
  assert.equal(synthValueFor({ name: 'phone', type: 'tel' }), '4155550123');
  assert.equal(synthValueFor({ name: 'last-name' }), 'Probe');
});
