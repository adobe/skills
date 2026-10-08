import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  evaluateCors,
  originsFor,
  probeCors,
  requestNeeds,
  runCors,
} from '../api-cors.mjs';

const fixtureDir = join(process.cwd(), 'scripts/test/fixtures');
const contactForm = JSON.parse(await readFile(join(fixtureDir, 'contract-contact-form.json'), 'utf8'));


async function makeContractsDir(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `api-integrations-${name}-`));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'contracts'), { recursive: true });
  return dir;
}

function corsResponse(headers = {}, status = 204) {
  return new Response(status === 204 ? null : '', { status, headers });
}

test('evaluateCors allows exact origin with requested method and headers listed', () => {
  const result = evaluateCors({
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://feat--site--acme.aem.page',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  }, {
    origin: 'https://feat--site--acme.aem.page',
    method: 'POST',
    headers: ['content-type', 'authorization'],
    credentials: false,
  });

  assert.deepEqual(result, { allowed: true, reasons: [] });
});

test('evaluateCors blocks when Access-Control-Allow-Origin is absent', () => {
  const result = evaluateCors({ status: 204, headers: { 'Access-Control-Allow-Methods': 'POST' } }, {
    origin: 'https://feat--site--acme.aem.page',
    method: 'POST',
    headers: [],
    credentials: false,
  });

  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('no Access-Control-Allow-Origin'));
});

test('evaluateCors blocks comma-separated Access-Control-Allow-Origin lists', () => {
  const result = evaluateCors({
    status: 204,
    headers: { 'access-control-allow-origin': 'https://feat--site--acme.aem.page, https://other.example.com' },
  }, {
    origin: 'https://feat--site--acme.aem.page',
    method: 'GET',
    headers: [],
    credentials: false,
  });

  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('Access-Control-Allow-Origin lists multiple origins'));
});

test('evaluateCors blocks wildcard origins when credentials are required', () => {
  const result = evaluateCors({
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET',
      'access-control-allow-credentials': 'true',
    },
  }, {
    origin: 'https://feat--site--acme.aem.page',
    method: 'GET',
    headers: [],
    credentials: true,
  });

  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((reason) => reason.includes('wildcard with credentials')));
});

test('evaluateCors blocks JSON POST when content-type is not allowed', () => {
  const result = evaluateCors({
    status: 204,
    headers: {
      'access-control-allow-origin': 'https://feat--site--acme.aem.page',
      'access-control-allow-methods': 'POST',
      'access-control-allow-headers': 'authorization',
    },
  }, {
    origin: 'https://feat--site--acme.aem.page',
    method: 'POST',
    headers: ['content-type', 'authorization'],
    credentials: false,
  });

  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('header content-type not allowed'));
});

test('evaluateCors allows simple methods without Access-Control-Allow-Methods', () => {
  const result = evaluateCors({
    status: 204,
    headers: { 'access-control-allow-origin': 'https://feat--site--acme.aem.page' },
  }, {
    origin: 'https://feat--site--acme.aem.page',
    method: 'GET',
    headers: [],
    credentials: false,
  });

  assert.deepEqual(result, { allowed: true, reasons: [] });
});

test('evaluateCors does not require simple methods to be listed in Access-Control-Allow-Methods', () => {
  const result = evaluateCors({
    status: 204,
    headers: {
      'access-control-allow-origin': 'https://feat--site--acme.aem.page',
      'access-control-allow-methods': 'POST',
    },
  }, {
    origin: 'https://feat--site--acme.aem.page',
    method: 'GET',
    headers: [],
    credentials: false,
  });

  assert.deepEqual(result, { allowed: true, reasons: [] });
});

test('originsFor normalizes branch names for preview and live origins', () => {
  const origins = originsFor({ owner: 'acme', repo: 'site', branch: 'feat/API_x', prod: 'https://www.example.com' });

  assert.deepEqual(origins, [
    { label: 'preview', origin: 'https://feat-api-x--site--acme.aem.page' },
    { label: 'live', origin: 'https://feat-api-x--site--acme.aem.live' },
    { label: 'production', origin: 'https://www.example.com' },
  ]);
});

test('requestNeeds derives method, non-safelisted headers, and credentials from the contract', () => {
  assert.deepEqual(requestNeeds(contactForm), {
    method: 'POST',
    headers: ['authorization', 'content-type'],
    credentials: false,
  });

  assert.deepEqual(requestNeeds({
    method: 'GET',
    contentType: null,
    auth: { scheme: 'cookie', headerNames: ['cookie'] },
  }), {
    method: 'GET',
    headers: [],
    credentials: true,
  });
});

test('probeCors sends OPTIONS preflight with Origin and strips endpoint query', async () => {
  const calls = [];
  const result = await probeCors('https://api.example.com/form?email=<redacted>', 'https://feat--site--acme.aem.page', {
    method: 'POST',
    headers: ['content-type'],
    credentials: false,
  }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return corsResponse({
        'access-control-allow-origin': 'https://feat--site--acme.aem.page',
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'content-type',
        'x-secret': 'must-not-persist',
      });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.com/form');
  assert.equal(calls[0].init.method, 'OPTIONS');
  assert.equal(calls[0].init.headers.Origin, 'https://feat--site--acme.aem.page');
  assert.equal(calls[0].init.headers['Access-Control-Request-Method'], 'POST');
  assert.equal(calls[0].init.headers['Access-Control-Request-Headers'], 'content-type');
  assert.ok(calls[0].init.signal);
  assert.deepEqual(result, {
    preflight: {
      status: 204,
      headers: {
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'POST',
        'access-control-allow-origin': 'https://feat--site--acme.aem.page',
      },
    },
    actual: null,
  });
});

test('probeCors sends one real GET for read contracts only', async () => {
  const calls = [];
  await probeCors('https://api.example.com/items?token=<redacted>', 'https://feat--site--acme.aem.page', {
    method: 'GET',
    headers: [],
    credentials: false,
  }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return corsResponse({ 'access-control-allow-origin': 'https://feat--site--acme.aem.page' }, init.method === 'GET' ? 200 : 204);
    },
  });

  assert.deepEqual(calls.map((call) => [call.url, call.init.method, call.init.headers.Origin]), [
    ['https://api.example.com/items', 'OPTIONS', 'https://feat--site--acme.aem.page'],
    ['https://api.example.com/items', 'GET', 'https://feat--site--acme.aem.page'],
  ]);
});

test('runCors writes cors artefact and updates contract and inventory status for blocked preview', async (t) => {
  const dir = await makeContractsDir(t, 'cors-run');
  const contract = {
    id: 'items',
    endpoint: 'https://api.example.com/v1/items?token=<redacted>',
    method: 'GET',
    contentType: null,
    auth: { scheme: 'bearer', headerNames: ['authorization'] },
    status: 'contracted',
    confirmed: true,
  };
  await writeFile(join(dir, 'inventory.json'), JSON.stringify({ integrations: [{
    id: 'items',
    endpoint: contract.endpoint,
    method: 'GET',
    status: 'contracted',
    contract: 'contracts/items.json',
  }] }, null, 2));
  await writeFile(join(dir, 'contracts/items.json'), JSON.stringify(contract, null, 2));

  const result = await runCors({
    owner: 'acme',
    repo: 'site',
    branch: 'feat/api',
    prod: 'https://www.example.com',
    dir,
    fetchImpl: async (_url, init) => {
      if (init.headers.Origin.includes('.aem.page')) return corsResponse({}, 204);
      return corsResponse({
        'access-control-allow-origin': init.headers.Origin,
        'access-control-allow-methods': 'GET',
        'access-control-allow-headers': 'authorization',
      }, init.method === 'GET' ? 200 : 204);
    },
  });

  const updatedContract = JSON.parse(await readFile(join(dir, 'contracts/items.json'), 'utf8'));
  const updatedInventory = JSON.parse(await readFile(join(dir, 'inventory.json'), 'utf8'));
  const cors = JSON.parse(await readFile(join(dir, 'cors.json'), 'utf8'));

  assert.equal(result.blocked, true);
  assert.deepEqual(result.actionItems, [
    'Allow origin https://feat-api--site--acme.aem.page for GET https://api.example.com/v1/items with headers authorization',
  ]);
  assert.equal(updatedContract.status, 'blocked-cors');
  assert.equal(updatedContract.cors.preview.allowed, false);
  assert.deepEqual(updatedContract.cors.preview.reasons, ['no Access-Control-Allow-Origin', 'header authorization not allowed']);
  assert.equal(updatedInventory.integrations[0].status, 'blocked-cors');
  assert.equal(cors.results[0].endpoint, 'https://api.example.com/v1/items');
  assert.equal(cors.results[0].origins.preview.preflight.status, 204);
});

test('runCors restores previous blocked-cors status once preview and live are allowed', async (t) => {
  const dir = await makeContractsDir(t, 'cors-restore');
  const contract = {
    id: 'items',
    endpoint: 'https://api.example.com/v1/items',
    method: 'GET',
    contentType: null,
    auth: { scheme: 'none', headerNames: [] },
    status: 'blocked-cors',
    confirmed: true,
  };
  await writeFile(join(dir, 'inventory.json'), JSON.stringify({ integrations: [{
    id: 'items',
    endpoint: contract.endpoint,
    method: 'GET',
    status: 'blocked-cors',
    contract: 'contracts/items.json',
    confirmed: true,
  }] }, null, 2));
  await writeFile(join(dir, 'contracts/items.json'), JSON.stringify(contract, null, 2));

  await runCors({
    owner: 'acme',
    repo: 'site',
    branch: 'feat/api',
    prod: 'https://www.example.com',
    dir,
    fetchImpl: async (_url, init) => corsResponse({ 'access-control-allow-origin': init.headers.Origin }, init.method === 'GET' ? 200 : 204),
  });

  const updatedContract = JSON.parse(await readFile(join(dir, 'contracts/items.json'), 'utf8'));
  const updatedInventory = JSON.parse(await readFile(join(dir, 'inventory.json'), 'utf8'));

  assert.equal(updatedContract.status, 'contracted');
  assert.equal(updatedInventory.integrations[0].status, 'contracted');
});

test('runCors never sends a real GET for GraphQL mutations', async (t) => {
  const dir = await makeContractsDir(t, 'cors-mutation');
  const contract = {
    id: 'mutate',
    endpoint: 'https://api.example.com/graphql',
    method: 'GET',
    kind: 'graphql-mutation',
    graphql: { operationName: 'Mutate', type: 'mutation' },
    contentType: null,
    auth: { scheme: 'none', headerNames: [] },
    status: 'contracted',
    confirmed: true,
  };
  await writeFile(join(dir, 'inventory.json'), JSON.stringify({ integrations: [{
    id: 'mutate',
    endpoint: contract.endpoint,
    method: 'GET',
    status: 'contracted',
    contract: 'contracts/mutate.json',
  }] }, null, 2));
  await writeFile(join(dir, 'contracts/mutate.json'), JSON.stringify(contract, null, 2));

  const methods = [];
  await runCors({
    owner: 'acme',
    repo: 'site',
    branch: 'feat/api',
    prod: 'https://www.example.com',
    dir,
    fetchImpl: async (_url, init) => {
      methods.push(init.method);
      return corsResponse({ 'access-control-allow-origin': init.headers.Origin });
    },
  });

  assert.deepEqual(methods, ['OPTIONS', 'OPTIONS', 'OPTIONS']);
});

test('runCors records network errors in reasons without persisting error fields in probe records', async (t) => {
  const dir = await makeContractsDir(t, 'cors-network');
  const contract = {
    id: 'items',
    endpoint: 'https://api.example.com/v1/items',
    method: 'GET',
    kind: 'rest-read',
    contentType: null,
    auth: { scheme: 'none', headerNames: [] },
    status: 'contracted',
    confirmed: true,
  };
  await writeFile(join(dir, 'inventory.json'), JSON.stringify({ integrations: [{
    id: 'items',
    endpoint: contract.endpoint,
    method: 'GET',
    status: 'contracted',
    contract: 'contracts/items.json',
  }] }, null, 2));
  await writeFile(join(dir, 'contracts/items.json'), JSON.stringify(contract, null, 2));

  await runCors({
    owner: 'acme',
    repo: 'site',
    branch: 'feat/api',
    prod: 'https://www.example.com',
    dir,
    fetchImpl: async () => { throw new Error('offline'); },
  });

  const updatedContract = JSON.parse(await readFile(join(dir, 'contracts/items.json'), 'utf8'));
  const cors = JSON.parse(await readFile(join(dir, 'cors.json'), 'utf8'));

  assert.deepEqual(updatedContract.cors.preview, { allowed: false, reasons: ['network error: offline'] });
  assert.deepEqual(cors.results[0].origins.preview.preflight, { status: 0, headers: {} });
});


test('runCors allows simple GET when OPTIONS is blocked but actual GET allows the origin', async (t) => {
  const dir = await makeContractsDir(t, 'cors-simple-get');
  const contract = {
    id: 'items',
    endpoint: 'https://api.example.com/v1/items',
    method: 'GET',
    kind: 'rest-read',
    contentType: null,
    auth: { scheme: 'none', headerNames: [] },
    status: 'contracted',
    confirmed: true,
  };
  await writeFile(join(dir, 'inventory.json'), JSON.stringify({ integrations: [{
    id: 'items',
    endpoint: contract.endpoint,
    method: 'GET',
    status: 'contracted',
    contract: 'contracts/items.json',
  }] }, null, 2));
  await writeFile(join(dir, 'contracts/items.json'), JSON.stringify(contract, null, 2));

  const result = await runCors({
    owner: 'acme',
    repo: 'site',
    branch: 'feat/api',
    prod: 'https://www.example.com',
    dir,
    fetchImpl: async (_url, init) => {
      if (init.method === 'OPTIONS') return corsResponse({}, 405);
      return corsResponse({ 'access-control-allow-origin': init.headers.Origin }, 200);
    },
  });

  const updatedContract = JSON.parse(await readFile(join(dir, 'contracts/items.json'), 'utf8'));
  const cors = JSON.parse(await readFile(join(dir, 'cors.json'), 'utf8'));

  assert.equal(result.blocked, false);
  assert.deepEqual(updatedContract.cors.preview, { allowed: true, reasons: [] });
  assert.deepEqual(cors.results[0].origins.preview.preflight, { status: 405, headers: {} });
  assert.deepEqual(cors.results[0].origins.preview.actual, {
    status: 200,
    headers: { 'access-control-allow-origin': 'https://feat-api--site--acme.aem.page' },
  });
});

test('runCors blocks GET with authorization when OPTIONS is blocked', async (t) => {
  const dir = await makeContractsDir(t, 'cors-auth-get');
  const contract = {
    id: 'items',
    endpoint: 'https://api.example.com/v1/items',
    method: 'GET',
    kind: 'rest-read',
    contentType: null,
    auth: { scheme: 'bearer', headerNames: ['authorization'] },
    status: 'contracted',
    confirmed: true,
  };
  await writeFile(join(dir, 'inventory.json'), JSON.stringify({ integrations: [{
    id: 'items',
    endpoint: contract.endpoint,
    method: 'GET',
    status: 'contracted',
    contract: 'contracts/items.json',
  }] }, null, 2));
  await writeFile(join(dir, 'contracts/items.json'), JSON.stringify(contract, null, 2));

  const result = await runCors({
    owner: 'acme',
    repo: 'site',
    branch: 'feat/api',
    prod: 'https://www.example.com',
    dir,
    fetchImpl: async (_url, init) => {
      if (init.method === 'OPTIONS') return corsResponse({}, 405);
      return corsResponse({ 'access-control-allow-origin': init.headers.Origin }, 200);
    },
  });

  const updatedContract = JSON.parse(await readFile(join(dir, 'contracts/items.json'), 'utf8'));

  assert.equal(result.blocked, true);
  assert.equal(updatedContract.cors.preview.allowed, false);
  assert.ok(updatedContract.cors.preview.reasons.includes('preflight status 405'));
});

test('runCors judges simple POST from preflight headers and records no actual request', async (t) => {
  const dir = await makeContractsDir(t, 'cors-simple-post');
  const contract = {
    id: 'submit',
    endpoint: 'https://api.example.com/v1/submit',
    method: 'POST',
    kind: 'rest-write',
    contentType: 'text/plain',
    auth: { scheme: 'none', headerNames: [] },
    status: 'contracted',
    confirmed: true,
  };
  await writeFile(join(dir, 'inventory.json'), JSON.stringify({ integrations: [{
    id: 'submit',
    endpoint: contract.endpoint,
    method: 'POST',
    status: 'contracted',
    contract: 'contracts/submit.json',
  }] }, null, 2));
  await writeFile(join(dir, 'contracts/submit.json'), JSON.stringify(contract, null, 2));

  const methods = [];
  await runCors({
    owner: 'acme',
    repo: 'site',
    branch: 'feat/api',
    prod: 'https://www.example.com',
    dir,
    fetchImpl: async (_url, init) => {
      methods.push(init.method);
      return corsResponse({ 'access-control-allow-origin': init.headers.Origin }, 405);
    },
  });

  const updatedContract = JSON.parse(await readFile(join(dir, 'contracts/submit.json'), 'utf8'));
  const cors = JSON.parse(await readFile(join(dir, 'cors.json'), 'utf8'));

  assert.deepEqual(methods, ['OPTIONS', 'OPTIONS', 'OPTIONS']);
  assert.deepEqual(updatedContract.cors.preview, {
    allowed: true,
    reasons: ['judged from preflight headers (no real request sent)'],
  });
  assert.equal(cors.results[0].origins.preview.actual, null);
});

test('same-origin production cors result includes null preflight and actual keys', async (t) => {
  const dir = await makeContractsDir(t, 'cors-same-origin-shape');
  const contract = {
    id: 'items',
    endpoint: 'https://www.example.com/v1/items',
    method: 'GET',
    kind: 'rest-read',
    contentType: null,
    auth: { scheme: 'none', headerNames: [] },
    status: 'contracted',
    confirmed: true,
  };
  await writeFile(join(dir, 'inventory.json'), JSON.stringify({ integrations: [{
    id: 'items',
    endpoint: contract.endpoint,
    method: 'GET',
    status: 'contracted',
    contract: 'contracts/items.json',
  }] }, null, 2));
  await writeFile(join(dir, 'contracts/items.json'), JSON.stringify(contract, null, 2));

  await runCors({
    owner: 'acme',
    repo: 'site',
    branch: 'feat/api',
    prod: 'https://www.example.com',
    dir,
    fetchImpl: async (_url, init) => corsResponse({ 'access-control-allow-origin': init.headers.Origin }, init.method === 'GET' ? 200 : 204),
  });

  const cors = JSON.parse(await readFile(join(dir, 'cors.json'), 'utf8'));

  assert.deepEqual(cors.results[0].origins.production, {
    origin: 'https://www.example.com',
    allowed: true,
    reasons: ['same-origin'],
    preflight: null,
    actual: null,
  });
});
