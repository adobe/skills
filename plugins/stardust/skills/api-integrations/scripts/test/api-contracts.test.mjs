import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

import {
  buildContract,
  groupObservations,
  loadBlockPartyIndex,
  rankBlockParty,
  renderHtml,
  renderMarkdown,
} from '../api-contracts.mjs';
import { TEST_DATA } from '../lib/lib.mjs';
import { diffContract } from '../lib/shape.mjs';

const fixtureDir = join(process.cwd(), 'scripts/test/fixtures');
const observation = JSON.parse(await readFile(join(fixtureDir, 'observation-contact-form.json'), 'utf8'));
const blockParty = JSON.parse(await readFile(join(fixtureDir, 'block-party.json'), 'utf8')).data;

function expandPersistedPlaceholders(value) {
  if (Array.isArray(value)) return value.map(expandPersistedPlaceholders);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expandPersistedPlaceholders(child)]));
  }
  if (typeof value !== 'string') return value;
  const testValue = value.match(/^<test:([^>]+)>$/);
  if (testValue) return TEST_DATA[testValue[1]];
  if (value === '<recaptcha>') return 'fresh-token';
  if (value === '<cookie:hubspotutk>') return 'abc123';
  return value;
}

function withoutGenerated(value) {
  if (Array.isArray(value)) return value.map(withoutGenerated);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === '_provenance') continue;
      out[key] = withoutGenerated(child);
    }
    return out;
  }
  return value;
}

function runNode(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('groups observations by endpoint and stable integration id', () => {
  const second = { ...observation, id: 'obs-2', pageUrl: 'https://www.example.com/pricing' };

  const groups = groupObservations([observation, second], []);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, 'contact-form');
  assert.deepEqual(groups[0].pages, [
    'https://www.example.com/contact-us',
    'https://www.example.com/pricing',
  ]);
});

test('static-only candidate is reported as detected and unconfirmed', () => {
  const groups = groupObservations([], [{
    url: 'https://www.example.com/contact-us',
    candidates: [{
      endpoint: '/api/legacy',
      method: 'GET',
      via: 'fetch',
      graphqlOperation: null,
      evidence: "fetch('/api/legacy')",
      source: 'https://www.example.com/contact-us#inline-script',
    }],
  }]);
  const contract = buildContract(groups[0]);
  const md = renderMarkdown({ integrations: [{
    id: contract.id,
    kind: contract.kind,
    method: contract.method,
    endpoint: contract.endpoint,
    trigger: contract.trigger,
    pages: contract.pages,
    auth: contract.auth,
    status: contract.status,
    confirmed: contract.confirmed,
    blockParty: [],
  }], errors: [] });

  assert.equal(contract.status, 'detected');
  assert.equal(contract.confirmed, false);
  assert.match(md, /\/api\/legacy/);
});

test('contract fields preserve redacted examples, schemas, auth, client deps, and error response', () => {
  const [group] = groupObservations([observation], []);
  const contract = buildContract(group);

  assert.equal(contract.kind, 'rest-write');
  assert.equal(contract.endpoint, 'https://www.example.com/api/form/contact-form');
  assert.equal(contract.contentType, 'application/json');
  assert.equal(contract.graphql, null);
  assert.deepEqual(contract.auth, { scheme: 'bearer', headerNames: ['authorization', 'content-type'] });
  assert.ok(contract.clientDeps.some((dep) => dep.from === 'recaptcha' && dep.action === 'FormSubmission'));
  assert.equal(contract.responses.error.status, 400);
  assert.equal(contract.responses.error.example.message, 'firstName must be at least 2 characters');
  assert.equal(contract.requestExample.formData.email, '<test:email>');
  assert.equal(contract.requestSchema.properties.formData.properties.email.format, 'email');
  assert.equal(contract.requestSchema.properties.formData.properties.phoneNumber.format, 'phone');
});

test('contract fieldMap values match rebuilt synthetic captured body', () => {
  const [group] = groupObservations([observation], []);
  const contract = buildContract(group);
  const body = expandPersistedPlaceholders(JSON.parse(observation.body));

  const result = diffContract(contract, {
    method: 'POST',
    url: 'https://rebuilt.example.com/api/form/contact-form',
    contentType: 'application/json',
    requestHeaderNames: ['authorization', 'content-type'],
    body,
    cookies: { hubspotutk: 'abc123' },
    title: body.hubspotContext.pageName,
    href: body.hubspotContext.pageUri,
  });

  assert.equal(result.pass, true, result.diffs.join('\n'));
});

test('request examples are redacted defensively while preserving persisted placeholders', () => {
  const raw = {
    ...observation,
    body: JSON.stringify({
      formData: {
        email: '<test:email>',
        alternateEmail: 'person@example.net',
        phoneNumber: '<test:phone>',
        firstName: 'Private',
      },
      googleRecaptchaToken: '<recaptcha>',
    }),
  };

  const contract = buildContract(groupObservations([raw], [])[0]);

  assert.equal(contract.requestExample.formData.email, '<test:email>');
  assert.equal(contract.requestExample.formData.alternateEmail, '<email>');
  assert.equal(contract.requestExample.formData.phoneNumber, '<test:phone>');
  assert.equal(contract.requestExample.googleRecaptchaToken, '<recaptcha>');
});

test('payload cookie dependency alone is not auth', () => {
  const cookieDepOnly = {
    ...observation,
    authScheme: null,
    requestHeaderNames: ['content-type'],
  };

  const contract = buildContract(groupObservations([cookieDepOnly], [])[0]);

  assert.equal(contract.auth.scheme, 'none');
});

test('contact form contract fixture stays in sync with buildContract output', async () => {
  const expected = JSON.parse(await readFile(join(fixtureDir, 'contract-contact-form.json'), 'utf8'));
  const actual = buildContract(groupObservations([observation], [])[0]);

  assert.deepEqual(withoutGenerated(actual), expected);
});

test('ranks block party matches by weighted terms', () => {
  const ranked = rankBlockParty(blockParty, ['hubspot', 'form']);

  assert.equal(ranked[0].title, 'HubSpot Form');
  assert.ok(ranked[0].score >= 5);
  assert.match(ranked[0].reason, /hubspot/i);
  assert.deepEqual(rankBlockParty(blockParty, ['zzz']), []);
});

test('loads only approved block party entries and caches them', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'api-integrations-contracts-cache-'));
  t.after(async () => rm(cacheDir, { recursive: true, force: true }));
  const cacheFile = join(cacheDir, 'block-party-cache.json');
  let calls = 0;
  const fetched = await loadBlockPartyIndex({
    cacheFile,
    now: () => 1000,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ data: blockParty }));
    },
  });
  const cached = await loadBlockPartyIndex({
    cacheFile,
    now: () => 1000 + 60_000,
    fetchImpl: async () => { throw new Error('network should not be used'); },
  });

  assert.equal(calls, 1);
  assert.equal(fetched.some((entry) => entry.title === 'Unapproved Form'), false);
  assert.deepEqual(cached, fetched);
});

test('block party fetch failures fall back to empty list or stale cache', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'api-integrations-contracts-fallback-'));
  t.after(async () => rm(cacheDir, { recursive: true, force: true }));
  const emptyCache = join(cacheDir, 'block-party-empty.json');
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    const missing = await loadBlockPartyIndex({
      cacheFile: emptyCache,
      now: () => Date.now() + (2 * 24 * 60 * 60 * 1000),
      fetchImpl: async () => { throw new Error('offline'); },
    });
    assert.deepEqual([...missing], []);
    assert.equal(missing.unavailable, true);

    const staleCache = join(cacheDir, 'block-party-stale.json');
    await mkdir(dirname(staleCache), { recursive: true });
    await writeFile(staleCache, JSON.stringify({ entries: blockParty }));
    const stale = await loadBlockPartyIndex({
      cacheFile: staleCache,
      now: () => Date.now() + (2 * 24 * 60 * 60 * 1000),
      fetchImpl: async () => { throw new Error('offline'); },
    });

    assert.ok(stale.some((entry) => entry.title === 'HubSpot Form'));
    assert.equal(stale.some((entry) => entry.title === 'Unapproved Form'), false);
    assert.equal(stale.unavailable, true);
    assert.equal(warnings.length, 2);
  } finally {
    console.warn = originalWarn;
  }
});

test('markdown table includes integration rows', () => {
  const md = renderMarkdown({ integrations: [{
    id: 'contact-form',
    kind: 'rest-write',
    method: 'POST',
    endpoint: 'https://www.example.com/api/form/contact-form',
    trigger: { type: 'submit', selector: '#contact-form' },
    pages: ['https://www.example.com/contact-us'],
    auth: { scheme: 'none', headerNames: [] },
    blockParty: [],
    status: 'contracted',
    confirmed: true,
  }], errors: [] });

  assert.match(md, /\| contact-form \| POST \| \/api\/form\/contact-form \|/);
});

test('markdown table escapes pipes, newlines, and unavailable Block Party status', () => {
  const md = renderMarkdown({
    blockPartyUnavailable: true,
    integrations: [{
      id: 'pipe|row',
      kind: 'rest-read',
      method: 'GET',
      endpoint: '/api/a|b\nc',
      trigger: { type: 'load', selector: null },
      pages: ['https://www.example.com/a'],
      auth: { scheme: 'none', headerNames: [] },
      blockParty: [],
      status: 'detected',
      confirmed: false,
    }],
    errors: [],
  });

  assert.match(md, /Block Party unavailable/);
  assert.match(md, /\| pipe\\\|row \| GET \| \/api\/a\\\|b c \|/);
});

test('renderHtml escapes script terminators in embedded JSON', () => {
  const html = renderHtml({ integrations: [{
    id: 'x',
    kind: 'rest-read',
    method: 'GET',
    endpoint: '/x</script><img src=x onerror=alert(1)>\u2028next\u2029line',
    trigger: { type: 'load', selector: null },
    pages: ['https://www.example.com/x'],
    auth: { scheme: 'none', headerNames: [] },
    blockParty: [],
    status: 'contracted',
    confirmed: true,
  }], errors: [] });

  assert.equal(html.includes('</script><img'), false);
  assert.equal(html.includes('\\u003c/script>'), true);
  assert.equal(html.includes('\\u2028'), true);
  assert.equal(html.includes('\\u2029'), true);
});

test('cli help prints api-contracts header and writes nothing', async () => {
  await rm('stardust', { recursive: true, force: true });
  const result = await runNode(['scripts/api-contracts.mjs', '--help']);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^api-contracts\.mjs —/);
  await assert.rejects(readFile('stardust/api/inventory.json'), /ENOENT/);
});

test('cli exits 2 on missing required inputs', async () => {
  const result = await runNode(['scripts/api-contracts.mjs']);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /usage: api-contracts\.mjs/);
});
