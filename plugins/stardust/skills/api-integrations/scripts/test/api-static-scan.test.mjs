import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractScripts,
  scanPage,
  scanSource,
  urlsFromDynamics,
  urlsFromState,
} from '../api-static-scan.mjs';

const pageUrl = 'https://www.example.com/contact';

function only(fields, candidate) {
  const result = {};
  for (const field of fields) result[field] = candidate[field];
  return result;
}

test('fetch with method records endpoint, POST method, and fetch provenance', () => {
  const [candidate] = scanSource('fetch("/api/form/contact-form", { method: "POST", body: payload })', { pageUrl });

  assert.deepEqual(only(['endpoint', 'method', 'via'], candidate), {
    endpoint: '/api/form/contact-form',
    method: 'POST',
    via: 'fetch',
  });
});

test('fetch and axios candidates are not limited to API-looking paths', () => {
  const candidates = scanSource("fetch('/search'); axios.post('/submit', d);", { pageUrl });

  assert.deepEqual(candidates.map((candidate) => only(['endpoint', 'method', 'via'], candidate)), [
    { endpoint: '/search', method: null, via: 'fetch' },
    { endpoint: '/submit', method: 'POST', via: 'axios' },
  ]);
});

test('fetch method detection is scoped to the current call', () => {
  const candidates = scanSource("fetch('/api/read'); fetch('/x', { method: 'post' });", { pageUrl });

  assert.deepEqual(candidates.map((candidate) => only(['endpoint', 'method', 'via'], candidate)), [
    { endpoint: '/api/read', method: null, via: 'fetch' },
    { endpoint: '/x', method: 'POST', via: 'fetch' },
  ]);
});

test('axios shorthand, XHR open, and API-base literals are detected', () => {
  const candidates = scanSource(`
    axios.post('/api/lead', payload);
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "/api/items");
    window.apiBase = "https://api.example.com/v2/";
  `, { pageUrl });

  assert.deepEqual(candidates.map((candidate) => only(['endpoint', 'method', 'via'], candidate)), [
    { endpoint: '/api/lead', method: 'POST', via: 'axios' },
    { endpoint: '/api/items', method: 'GET', via: 'xhr' },
    { endpoint: 'https://api.example.com/v2/', method: null, via: 'literal' },
  ]);
});

test('GraphQL documents include operation name and type', () => {
  const [candidate] = scanSource('const doc = gql`mutation Subscribe($e:String){ subscribe(email:$e){ ok } }`;', { pageUrl });

  assert.equal(candidate.endpoint, '/graphql');
  assert.equal(candidate.via, 'graphql-doc');
  assert.deepEqual(candidate.graphqlOperation, { name: 'Subscribe', type: 'mutation' });
});

test('GraphQL documents emit a distinct candidate for each operation', () => {
  const candidates = scanSource(`
    const a = gql\`query A{a}\`;
    const b = gql\`mutation B{b}\`;
    const many = gql\`query C{c} mutation D{d}\`;
  `, { pageUrl });

  assert.deepEqual(candidates.map((candidate) => candidate.graphqlOperation), [
    { name: 'A', type: 'query' },
    { name: 'B', type: 'mutation' },
    { name: 'C', type: 'query' },
    { name: 'D', type: 'mutation' },
  ]);
});

test('data endpoint attributes and form actions are detected', () => {
  const candidates = scanSource(`
    <div data-endpoint="/api/list"></div>
    <form action="/subscribe" method="post"><input name="email"></form>
  `, { pageUrl });

  assert.deepEqual(candidates.map((candidate) => only(['endpoint', 'method', 'via'], candidate)), [
    { endpoint: '/api/list', method: null, via: 'data-attr' },
    { endpoint: '/subscribe', method: 'POST', via: 'form-action' },
  ]);
});

test('JSON settings islands surface API URL strings', () => {
  const [candidate] = scanSource('<script id="__NEXT_DATA__" type="application/json">{"runtimeConfig":{"apiUrl":"https://api.x.com"}}</script>', { pageUrl });

  assert.deepEqual(only(['endpoint', 'method', 'via'], candidate), {
    endpoint: 'https://api.x.com',
    method: null,
    via: 'json-island',
  });
});

test('static assets are ignored even when referenced by request helpers', () => {
  const candidates = scanSource("fetch('/styles/a.css'); axios.get('/image.png');", { pageUrl });

  assert.deepEqual(candidates, []);
});

test('extractScripts keeps same-site external scripts and drops tag-vendor scripts', () => {
  const scripts = extractScripts(`
    <script src="/scripts/app.js"></script>
    <script src="https://cdn.example.com/widgets.js"></script>
    <script src="https://assets.adobedtm.com/launch.min.js"></script>
    <script>fetch('/api/inline')</script>
  `, pageUrl);

  assert.deepEqual(scripts.external, [
    'https://www.example.com/scripts/app.js',
    'https://cdn.example.com/widgets.js',
  ]);
  assert.deepEqual(scripts.inline, ["fetch('/api/inline')"]);
});

test('out-of-scope vendor endpoints are dropped while unknown third-party APIs stay', () => {
  const candidates = scanSource(`
    fetch('https://assets.adobedtm.com/launch.min.js');
    fetch('https://api.vendor.example.net/v1/search');
  `, { pageUrl });

  assert.deepEqual(candidates.map((candidate) => candidate.endpoint), ['https://api.vendor.example.net/v1/search']);
});

test('static candidates redact query values and evidence snippets', () => {
  const [candidate] = scanSource(`
    const token = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
    fetch('/api/search?apiKey=SECRET123&email=person@example.com', { method: 'GET' });
  `, { pageUrl, source: 'https://www.example.com/app.js?apiKey=SECRET123' });
  const persisted = JSON.stringify(candidate);

  assert.match(candidate.endpoint, /apiKey=/);
  assert.match(candidate.endpoint, /email=/);
  assert.equal(persisted.includes('SECRET123'), false);
  assert.equal(persisted.includes('person@example.com'), false);
  assert.equal(persisted.includes('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN'), false);
});

test('Stardust URL parsers read dynamics and state shapes', () => {
  assert.deepEqual(urlsFromDynamics({
    _provenance: { urls: ['https://www.example.com/'] },
    pages: {
      '/contact': { url: 'https://www.example.com/contact' },
      '/pricing': { url: 'https://www.example.com/pricing' },
    },
  }), [
    'https://www.example.com/',
    'https://www.example.com/contact',
    'https://www.example.com/pricing',
  ]);

  assert.deepEqual(urlsFromState({
    site: { originUrl: 'https://www.example.com' },
    pages: [
      { slug: 'home', url: 'https://www.example.com/' },
      { slug: 'contact', url: 'https://www.example.com/contact' },
    ],
  }), [
    'https://www.example.com',
    'https://www.example.com/',
    'https://www.example.com/contact',
  ]);
});

test('scanPage records failing bundle fetches and keeps page candidates', async () => {
  async function fetchImpl(url) {
    if (url === 'https://www.example.com/contact') {
      return new Response(`
        <script src="/bad.js"></script>
        <script>fetch('/api/inline')</script>
      `);
    }
    throw new Error('bundle offline');
  }

  const page = await scanPage('https://www.example.com/contact', { fetchImpl });

  assert.deepEqual(page.candidates.map((candidate) => candidate.endpoint), ['/api/inline']);
  assert.deepEqual(page.errors, ['https://www.example.com/bad.js: bundle offline']);
});
