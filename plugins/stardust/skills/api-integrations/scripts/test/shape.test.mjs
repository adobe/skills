import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  correlate,
  diffContract,
  inferSchema,
  mergeSchemas,
  parseBody,
  redact,
} from '../lib/shape.mjs';

const fixture = JSON.parse(await readFile(join(process.cwd(), 'scripts/test/fixtures/contact-form-body.json'), 'utf8'));

function sources(overrides = {}) {
  return {
    inputs: [
      { selector: '#columns-contact-first-name', name: 'first-name', value: 'Testa' },
      { selector: '#columns-contact-last-name', name: 'last-name', value: 'Probe' },
      { selector: '#columns-contact-business-email', name: 'business-email', value: 'api-probe@example.com' },
      { selector: '#columns-contact-company', name: 'company', value: 'Example Inc' },
      { selector: '#columns-contact-phone', name: 'phone', value: '4155550123' },
      { selector: '#columns-contact-message', name: 'message', value: 'api-integrations probe - please ignore' },
    ],
    cookies: { hubspotutk: 'abc123' },
    title: 'Contact Us | Example',
    href: 'https://www.example.com/contact-us',
    tokens: [
      {
        value: 'tok-FormSubmission',
        siteKey: 'site-key-x',
        action: 'FormSubmission',
        kind: 'recaptcha',
      },
    ],
    ...overrides,
  };
}

function contractFor(body = fixture) {
  return {
    method: 'POST',
    endpoint: 'https://www.example.com/api/form/contact-form',
    contentType: 'application/json',
    requestSchema: {
      type: 'object',
      required: ['formData', 'googleRecaptchaToken', 'hubspotContext'],
      properties: {
        formData: {
          type: 'object',
          required: ['firstName', 'lastName', 'email', 'phoneNumber', 'message'],
          properties: {
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phoneNumber: { type: 'string', format: 'phone' },
            message: { type: 'string' },
            custom_params_form: { type: 'string' },
          },
        },
        googleRecaptchaToken: { type: 'string' },
        hubspotContext: {
          type: 'object',
          required: ['hutk', 'pageName', 'pageUri'],
          properties: {
            hutk: { type: 'string' },
            pageName: { type: 'string' },
            pageUri: { type: 'string', format: 'uri' },
          },
        },
      },
    },
    graphql: null,
    fieldMap: [
      {
        path: 'formData.firstName',
        selector: '#columns-contact-first-name',
        name: 'first-name',
        value: 'Testa',
      },
      {
        path: 'formData.lastName',
        selector: '#columns-contact-last-name',
        name: 'last-name',
        value: 'Probe',
      },
      {
        path: 'formData.email',
        selector: '#columns-contact-business-email',
        name: 'business-email',
        value: 'api-probe@example.com',
      },
      {
        path: 'formData.phoneNumber',
        selector: '#columns-contact-phone',
        name: 'phone',
        value: '4155550123',
      },
      {
        path: 'formData.message',
        selector: '#columns-contact-message',
        name: 'message',
        value: 'api-integrations probe - please ignore',
      },
    ],
    clientDeps: [
      {
        path: 'googleRecaptchaToken',
        from: 'recaptcha',
        siteKey: 'site-key-x',
        action: 'FormSubmission',
      },
      { path: 'hubspotContext.hutk', from: 'cookie', name: 'hubspotutk' },
      { path: 'hubspotContext.pageName', from: 'title' },
      { path: 'hubspotContext.pageUri', from: 'location' },
      { path: 'formData.custom_params_form', from: 'constant', value: '' },
    ],
  };
}

function captured(body = fixture, overrides = {}) {
  return {
    method: 'POST',
    url: 'https://rebuilt.example.net/api/form/contact-form',
    contentType: 'application/json; charset=utf-8',
    requestHeaderNames: ['content-type'],
    body,
    cookies: { hubspotutk: 'abc123' },
    title: 'Contact Us | Example',
    href: 'https://www.example.com/contact-us',
    ...overrides,
  };
}

test('contact form correlates inputs and client dependencies', () => {
  const result = correlate(fixture, sources());

  assert.ok(result.fieldMap.some((entry) => (
    entry.path === 'formData.firstName'
    && entry.selector === '#columns-contact-first-name'
    && entry.name === 'first-name'
    && entry.value === 'Testa'
  )));
  assert.ok(result.clientDeps.some((entry) => (
    entry.path === 'googleRecaptchaToken'
    && entry.from === 'recaptcha'
    && entry.siteKey === 'site-key-x'
    && entry.action === 'FormSubmission'
  )));
  assert.ok(result.clientDeps.some((entry) => (
    entry.path === 'hubspotContext.hutk'
    && entry.from === 'cookie'
    && entry.name === 'hubspotutk'
  )));
  assert.ok(result.clientDeps.some((entry) => entry.path === 'hubspotContext.pageName' && entry.from === 'title'));
  assert.ok(result.clientDeps.some((entry) => entry.path === 'hubspotContext.pageUri' && entry.from === 'location'));
  assert.ok(result.clientDeps.some((entry) => (
    entry.path === 'formData.custom_params_form'
    && entry.from === 'constant'
    && entry.value === ''
  )));
});

test('schema marks non-empty fields required and detects formats', () => {
  const schema = inferSchema(fixture);

  assert.ok(schema.properties.formData.required.includes('firstName'));
  assert.ok(!schema.properties.formData.required.includes('custom_params_form'));
  assert.equal(schema.properties.formData.properties.email.format, 'email');
  assert.equal(schema.properties.formData.properties.phoneNumber.format, 'phone');
  assert.equal(schema.properties.hubspotContext.properties.pageUri.format, 'uri');
});

test('redact keeps shape and applies precedence', () => {
  const value = {
    ...fixture,
    formData: {
      ...fixture.formData,
      alternateEmail: 'person@example.net',
      shortCode: '1234',
      longToken: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN1234',
    },
  };

  const result = redact(value);

  assert.equal(result.formData.email, '<test:email>');
  assert.equal(result.formData.alternateEmail, '<email>');
  assert.equal(result.formData.phoneNumber, '<test:phone>');
  assert.equal(result.formData.shortCode, '1234');
  assert.equal(result.formData.longToken, '<token>');
  assert.equal(result.googleRecaptchaToken, '<redacted>');
  assert.deepEqual(Object.keys(result), Object.keys(value));
  assert.deepEqual(Object.keys(result.formData), Object.keys(value.formData));
});

test('redact preserves persisted placeholder strings under sensitive keys', () => {
  assert.deepEqual(redact({
    formData: {
      email: '<test:email>',
      phoneNumber: '<test:phone>',
    },
    googleRecaptchaToken: '<recaptcha>',
    hubspotContext: {
      hutk: '<cookie:hubspotutk>',
    },
  }), {
    formData: {
      email: '<test:email>',
      phoneNumber: '<test:phone>',
    },
    googleRecaptchaToken: '<recaptcha>',
    hubspotContext: {
      hutk: '<cookie:hubspotutk>',
    },
  });
});

test('redact only preserves known placeholders', () => {
  assert.deepEqual(redact({
    token: '<script>',
    email: '<email>',
    context: { hutk: '<cookie:hubspotutk>' },
  }), {
    token: '<redacted>',
    email: '<email>',
    context: { hutk: '<cookie:hubspotutk>' },
  });
});

test('redact handles non-string PII values', () => {
  assert.deepEqual(redact({
    phone: 4155550123,
    ok: false,
    commentOptIn: true,
    nested: [{ email: 'a@b.co' }],
  }), {
    phone: '<phone>',
    ok: false,
    commentOptIn: '<redacted>',
    nested: [{ email: '<email>' }],
  });
});

test('empty and malformed bodies keep stable parse formats', () => {
  assert.deepEqual(parseBody(null, 'application/json'), { format: 'empty', value: null });
  assert.deepEqual(parseBody('', 'application/json'), { format: 'empty', value: null });
  assert.deepEqual(parseBody('{not json', 'application/json'), { format: 'text', value: '{not json' });
});

test('urlencoded body parses and correlates', () => {
  const parsed = parseBody('a=Testa&b=x', 'application/x-www-form-urlencoded');
  const result = correlate(parsed.value, sources({ inputs: [{ selector: '#a', name: 'a', value: 'Testa' }] }));

  assert.equal(parsed.format, 'form');
  assert.equal(parsed.value.a, 'Testa');
  assert.ok(result.fieldMap.some((entry) => entry.path === 'a' && entry.selector === '#a' && entry.value === 'Testa'));
});

test('multipart keeps names only', () => {
  const boundary = '----api-integrations-boundary';
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="name"',
    '',
    'Testa',
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="probe.txt"',
    'Content-Type: text/plain',
    '',
    'hello',
    `--${boundary}--`,
    '',
  ].join('\r\n');

  assert.deepEqual(parseBody(body, `multipart/form-data; boundary=${boundary}`), {
    format: 'multipart',
    value: { fields: ['name', 'file'] },
  });
});

test('diff passes on match and fails on drift', () => {
  const contract = contractFor();

  assert.deepEqual(diffContract(contract, captured()), { pass: true, diffs: [] });

  const renamed = structuredClone(fixture);
  renamed.formData.fname = renamed.formData.firstName;
  delete renamed.formData.firstName;
  const renamedDiff = diffContract(contract, captured(renamed));
  assert.equal(renamedDiff.pass, false);
  assert.ok(renamedDiff.diffs.some((diff) => diff.includes('formData.firstName')));

  const missingToken = structuredClone(fixture);
  missingToken.googleRecaptchaToken = '';
  const tokenDiff = diffContract(contract, captured(missingToken));
  assert.equal(tokenDiff.pass, false);
  assert.ok(tokenDiff.diffs.some((diff) => diff.includes('googleRecaptchaToken')));
});

test('diff messages do not leak cookie values and redact captured fieldMap values', () => {
  const drifted = structuredClone(fixture);
  drifted.hubspotContext.hutk = 'secret-cookie-value';
  drifted.formData.firstName = 'Real Person';

  const result = diffContract(contractFor(), captured(drifted, { cookies: { hubspotutk: 'abc123' } }));
  const message = result.diffs.join('\n');

  assert.equal(result.pass, false);
  assert.ok(message.includes('hubspotContext.hutk'));
  assert.ok(!message.includes('abc123'));
  assert.ok(!message.includes('secret-cookie-value'));
  assert.ok(!message.includes('Real Person'));
  assert.ok(message.includes('fieldMap formData.firstName value differed'));
});

test('diff requires fields inside every array item', () => {
  const contract = {
    method: 'POST',
    endpoint: 'https://www.example.com/api/cart',
    contentType: 'application/json',
    requestSchema: {
      type: 'object',
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['sku'],
            properties: { sku: { type: 'string' } },
          },
        },
      },
    },
    graphql: null,
    fieldMap: [],
    clientDeps: [],
  };

  const result = diffContract(contract, captured({ items: [{ sku: 'sku-1' }, {}] }, {
    url: 'https://www.example.com/api/cart',
  }));

  assert.equal(result.pass, false);
  assert.ok(result.diffs.some((diff) => diff.includes('items[].sku')));
});

test('diff compares GraphQL operation and media type only', () => {
  const contract = {
    method: 'POST',
    endpoint: 'https://www.example.com/graphql',
    contentType: 'application/json',
    requestSchema: inferSchema({ query: 'query Contact { contact { id } }', operationName: 'Contact' }),
    graphql: { operationName: 'Contact', type: 'query' },
    fieldMap: [],
    clientDeps: [],
  };

  assert.equal(diffContract(contract, captured(
    { query: 'query Contact { contact { id } }', operationName: 'Contact' },
    { url: 'https://api.example.net/graphql', contentType: 'Application/JSON; Charset=UTF-8' },
  )).pass, true);

  const result = diffContract(contract, captured(
    { query: 'mutation Contact { contact { id } }', operationName: 'Contact' },
    { url: 'https://api.example.net/graphql' },
  ));
  assert.equal(result.pass, false);
  assert.ok(result.diffs.some((diff) => diff.includes('GraphQL type')));
});

test('diff compares query keys, header names, and GraphQL variables and persisted hashes', () => {
  const contract = {
    method: 'POST',
    endpoint: 'https://www.example.com/graphql?tenant=<redacted>',
    contentType: 'application/json',
    auth: { scheme: 'bearer', headerNames: ['authorization'] },
    requestSchema: inferSchema({
      operationName: 'Contact',
      query: 'query Contact($id: ID!, $filter: String) { contact(id: $id) { id } }',
      variables: { id: '1', filter: 'all' },
      extensions: { persistedQuery: { sha256Hash: 'abc' } },
    }),
    graphql: {
      operationName: 'Contact',
      type: 'query',
      variables: { id: '1', filter: 'all' },
      persistedHash: 'abc',
    },
    fieldMap: [],
    clientDeps: [],
  };
  const ok = captured({
    operationName: 'Contact',
    query: 'query Contact($id: ID!, $filter: String) { contact(id: $id) { id } }',
    variables: { id: '1', filter: 'all' },
    extensions: { persistedQuery: { sha256Hash: 'abc' } },
  }, {
    url: 'https://rebuilt.example.net/graphql?tenant=customer-a',
    requestHeaderNames: ['authorization', 'content-type'],
  });

  assert.equal(diffContract(contract, ok).pass, true);

  const drift = diffContract(contract, captured({
    operationName: 'Other',
    query: 'query Other($id: ID!) { contact(id: $id) { id } }',
    variables: { id: '1' },
    extensions: { persistedQuery: { sha256Hash: 'def' } },
  }, {
    url: 'https://rebuilt.example.net/graphql',
    requestHeaderNames: ['content-type'],
  }));
  const message = drift.diffs.join('\n');

  assert.equal(drift.pass, false);
  assert.match(message, /query parameter missing: tenant/);
  assert.match(message, /required header missing: authorization/);
  assert.match(message, /GraphQL operationName differed/);
  assert.match(message, /GraphQL variable missing: filter/);
  assert.match(message, /GraphQL persisted query hash differed/);
  assert.equal(message.includes('customer-a'), false);
  assert.equal(message.includes('def'), false);
});

test('mergeSchemas unions properties and intersects required keys', () => {
  const merged = mergeSchemas(
    inferSchema({ a: 'x', b: 'y' }),
    inferSchema({ a: 'x', c: '' }),
  );

  assert.deepEqual(Object.keys(merged.properties).sort(), ['a', 'b', 'c']);
  assert.deepEqual(merged.required, ['a']);
});
