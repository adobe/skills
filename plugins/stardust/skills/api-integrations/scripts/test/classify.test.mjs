import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyRequest, parseGraphQL, scopeOf } from '../lib/classify.mjs';

function req(method, url, body = null, contentType = '') {
  return { method, url, body, contentType };
}

test('POST with a mutation is a write', () => {
  const result = classifyRequest(req(
    'POST',
    'https://www.example.com/graphql',
    JSON.stringify({ query: 'mutation AddItem { addItem { id } }', operationName: 'AddItem' }),
    'application/json',
  ));

  assert.equal(result.kind, 'graphql-mutation');
  assert.equal(result.isWrite, true);
  assert.equal(result.graphql[0].operationName, 'AddItem');
});

test('POST query is a read', () => {
  const result = classifyRequest(req(
    'POST',
    'https://www.example.com/graphql',
    JSON.stringify({ query: 'query Products { products { id } }', operationName: 'Products' }),
    'application/json',
  ));

  assert.equal(result.kind, 'graphql-query');
  assert.equal(result.isWrite, false);
});

test('batch with a mutation is a write', () => {
  const result = classifyRequest(req(
    'POST',
    'https://www.example.com/graphql',
    JSON.stringify([{ query: 'query A{a}' }, { query: 'mutation B{b}' }]),
    'application/json',
  ));

  assert.equal(result.kind, 'graphql-mutation');
  assert.equal(result.isWrite, true);
  assert.equal(result.graphql.length, 2);
});

test('GET persisted query', () => {
  const url = new URL('https://www.example.com/graphql');
  url.searchParams.set('operationName', 'Q');
  url.searchParams.set('extensions', JSON.stringify({ persistedQuery: { version: 1, sha256Hash: 'abc' } }));

  const result = classifyRequest(req('GET', url.href));

  assert.equal(result.kind, 'graphql-query');
  assert.equal(result.isWrite, false);
  assert.equal(result.graphql[0].persistedHash, 'abc');
});

test('operationName picks among several', () => {
  const result = classifyRequest(req(
    'POST',
    'https://www.example.com/graphql',
    JSON.stringify({ query: 'query A{a} mutation B{b}', operationName: 'B' }),
    'application/json',
  ));

  assert.equal(result.kind, 'graphql-mutation');
  assert.equal(result.isWrite, true);
  assert.equal(result.graphql[0].type, 'mutation');
});

for (const readPost of [[], [/\/graphql/]]) {
  const suffix = readPost.length ? ' with readPost' : '';

  test(`mixed query and mutation document without operationName is a write${suffix}`, () => {
    const result = classifyRequest(req(
      'POST',
      'https://www.example.com/graphql',
      JSON.stringify({ query: 'query A { a } mutation B { b }' }),
      'application/json',
    ), { readPost });

    assert.equal(result.kind, 'graphql-mutation');
    assert.equal(result.isWrite, true);
  });

  test(`mixed query and mutation document with mutation operationName is a write${suffix}`, () => {
    const result = classifyRequest(req(
      'POST',
      'https://www.example.com/graphql',
      JSON.stringify({ query: 'query A { a } mutation B { b }', operationName: 'B' }),
      'application/json',
    ), { readPost });

    assert.equal(result.kind, 'graphql-mutation');
    assert.equal(result.isWrite, true);
  });

  test(`mixed query and mutation document with query operationName is still a write${suffix}`, () => {
    const result = classifyRequest(req(
      'POST',
      'https://www.example.com/graphql',
      JSON.stringify({ query: 'query A { a } mutation B { b }', operationName: 'A' }),
      'application/json',
    ), { readPost });

    assert.equal(result.kind, 'graphql-mutation');
    assert.equal(result.isWrite, true);
    assert.equal(result.graphql[0].type, 'query');
  });
}

test('comments after operations do not create GraphQL mutations', () => {
  const result = classifyRequest(req(
    'POST',
    'https://www.example.com/graphql',
    JSON.stringify({ query: 'query A { a }\n# mutation B { b }', operationName: 'B' }),
    'application/json',
  ));

  assert.equal(result.kind, 'graphql-query');
  assert.equal(result.isWrite, false);
});

test('commented queries do not override real mutations', () => {
  const result = classifyRequest(req(
    'POST',
    'https://www.example.com/graphql',
    JSON.stringify({ query: '# query X { x }\nmutation X { y }', operationName: 'X' }),
    'application/json',
  ));

  assert.equal(result.kind, 'graphql-mutation');
  assert.equal(result.isWrite, true);
});

test('string literals do not create GraphQL operations', () => {
  const result = classifyRequest(req(
    'POST',
    'https://www.example.com/graphql',
    JSON.stringify({ query: 'mutation Real { save(text: "query Fake { x }") }', operationName: 'Fake' }),
    'application/json',
  ));

  assert.equal(result.kind, 'graphql-mutation');
  assert.equal(result.isWrite, true);
});

test('block string literals do not create GraphQL operations', () => {
  const result = classifyRequest(req(
    'POST',
    'https://www.example.com/graphql',
    JSON.stringify({ query: 'mutation Real { save(text: """query Fake { x }""") }', operationName: 'Fake' }),
    'application/json',
  ));

  assert.equal(result.kind, 'graphql-mutation');
  assert.equal(result.isWrite, true);
});

test('malformed JSON bodies are treated as non-GraphQL REST requests', () => {
  const request = req('POST', 'https://www.example.com/graphql', '{not json', 'application/json');

  assert.equal(parseGraphQL(request), null);
  assert.deepEqual(classifyRequest(request), {
    kind: 'rest-write',
    isWrite: true,
    graphql: null,
  });
});

test('raw application/graphql body is parsed', () => {
  const ops = parseGraphQL(req(
    'POST',
    'https://www.example.com/graphql',
    'subscription Updates { updates { id } }',
    'application/graphql',
  ));

  assert.ok(Array.isArray(ops));
  assert.equal(ops.length, 1);
  assert.equal(ops[0].type, 'subscription');
  assert.equal(ops[0].operationName, 'Updates');
  assert.equal(ops[0].query, 'subscription Updates { updates { id } }');
});

test('leading comments do not hide shorthand query', () => {
  const ops = parseGraphQL(req(
    'POST',
    'https://www.example.com/graphql',
    '# generated query\n{ viewer { id } }',
    'application/graphql',
  ));

  assert.ok(Array.isArray(ops));
  assert.equal(ops[0].type, 'query');
});

test('GET variables are parsed as an object', () => {
  const url = new URL('https://www.example.com/graphql');
  url.searchParams.set('query', 'query Product($id: ID!) { product(id: $id) { id } }');
  url.searchParams.set('variables', JSON.stringify({ id: 'sku-1' }));

  const ops = parseGraphQL(req('GET', url.href));

  assert.ok(Array.isArray(ops));
  assert.deepEqual(ops[0].variables, { id: 'sku-1' });
});

test('contact form is a REST write', () => {
  const result = classifyRequest(req(
    'POST',
    'https://www.example.com/api/form/contact-form',
    JSON.stringify({ email: 'api-probe@example.com' }),
    'application/json',
  ));

  assert.equal(result.kind, 'rest-write');
  assert.equal(result.isWrite, true);
  assert.equal(result.graphql, null);
});

test('read-post allow-list', () => {
  const result = classifyRequest(
    req('POST', 'https://www.example.com/api/search', JSON.stringify({ q: 'test' }), 'application/json'),
    { readPost: [/\/api\/search/] },
  );

  assert.equal(result.kind, 'rest-read');
  assert.equal(result.isWrite, false);
});

test('read-post allow-list does not downgrade a GraphQL mutation', () => {
  const result = classifyRequest(
    req('POST', 'https://www.example.com/graphql', JSON.stringify({ query: 'mutation Save { save { id } }', operationName: 'Save' }), 'application/json'),
    { readPost: [/\/graphql/] },
  );

  assert.equal(result.kind, 'graphql-mutation');
  assert.equal(result.isWrite, true);
});

test('read-post allow-list does not downgrade a GraphQL batch containing a mutation', () => {
  const result = classifyRequest(
    req('POST', 'https://www.example.com/graphql', JSON.stringify([{ query: 'query Read { read { id } }' }, { query: 'mutation Save { save { id } }' }]), 'application/json'),
    { readPost: [/\/graphql/] },
  );

  assert.equal(result.kind, 'graphql-mutation');
  assert.equal(result.isWrite, true);
});

test('DELETE is a write', () => {
  const result = classifyRequest(req('DELETE', 'https://www.example.com/api/items/1'));

  assert.equal(result.kind, 'rest-write');
  assert.equal(result.isWrite, true);
  assert.equal(result.graphql, null);
});

test('GET is a read', () => {
  const result = classifyRequest(req('GET', 'https://www.example.com/api/items'));

  assert.equal(result.kind, 'rest-read');
  assert.equal(result.isWrite, false);
  assert.equal(result.graphql, null);
});

test('scope: API subdomain stays in scope', () => {
  assert.deepEqual(scopeOf('https://api.example.com/v1/items', 'https://www.example.com/products'), {
    inScope: true,
    origin: 'api-subdomain',
    vendor: null,
    inspect: false,
  });
});

test('scope: known tag vendors are out of scope', () => {
  const result = scopeOf('https://assets.adobedtm.com/launch.min.js', 'https://www.example.com/');

  assert.equal(result.inScope, false);
  assert.equal(result.origin, 'third-party');
  assert.deepEqual(result.vendor, { class: 'T', role: 'tag manager: Adobe Launch' });
  assert.equal(result.inspect, false);
});

test('scope: unknown third-party vendors need inspection', () => {
  assert.deepEqual(scopeOf('https://api.vendor.example.net/data', 'https://www.example.com/'), {
    inScope: true,
    origin: 'third-party',
    vendor: null,
    inspect: true,
  });
});
