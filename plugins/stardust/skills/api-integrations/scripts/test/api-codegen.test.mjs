import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';

import { diffContract, parseBody } from '../lib/shape.mjs';

const repoRoot = resolve('.');
const scratchRoot = await mkdtemp(join(tmpdir(), 'api-integrations-codegen-'));
const scriptPath = join(repoRoot, 'scripts/api-codegen.mjs');
const fixturePath = join(repoRoot, 'scripts/test/fixtures/contract-contact-form.json');

after(async () => {
  await rm(scratchRoot, { recursive: true, force: true });
});

async function makeCase(t, name) {
  await mkdir(scratchRoot, { recursive: true });
  const dir = await mkdtemp(join(scratchRoot, `${name}-`));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function writeContracts(dir, contracts) {
  await mkdir(dir, { recursive: true });
  await Promise.all(contracts.map((contract) => (
    writeFile(join(dir, `${contract.id}.json`), `${JSON.stringify(contract, null, 2)}\n`)
  )));
}

function runCodegen(args, options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
  });
}

async function generate(t, contracts, args = []) {
  const dir = await makeCase(t, 'generated');
  const contractsDir = join(dir, 'contracts');
  const outDir = join(dir, 'eds');
  await writeContracts(contractsDir, contracts);
  const result = runCodegen(['--contracts', contractsDir, '--out', outDir, ...args]);
  assert.equal(result.status, 0, `codegen failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  await writeFile(join(outDir, 'package.json'), '{"type":"module"}\n');
  return { dir, contractsDir, outDir, result };
}

async function importModule(file) {
  return import(`${pathToFileURL(file).href}?case=${Date.now()}-${Math.random()}`);
}

function valuesFromFieldMap(contract, overrides = {}) {
  return Object.fromEntries((contract.fieldMap || []).map((entry) => [entry.path, entry.value]).concat(Object.entries(overrides)));
}

function parseCookie(cookie = '') {
  return Object.fromEntries(String(cookie).split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? [part, ''] : [part.slice(0, separator), part.slice(separator + 1)];
  }));
}

function headersObject(headers = {}) {
  return Object.fromEntries(new Headers(headers).entries());
}

async function bodyValue(body, contentType) {
  if (body === undefined || body === null) return null;
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  if (typeof FormData !== 'undefined' && body instanceof FormData) return Object.fromEntries(body.entries());
  if (typeof body === 'string') return parseBody(body, contentType).value;
  return body;
}

async function capturedRequest(call, env) {
  const headers = headersObject(call.options.headers || {});
  const contentType = headers['content-type'] || '';
  const url = String(call.url);
  const parsed = new URL(url, env.window.location.href);
  const query = Object.fromEntries(parsed.searchParams.entries());
  const headerNames = Object.keys(headers).sort();
  return {
    method: String(call.options.method || 'GET').toUpperCase(),
    url,
    contentType,
    body: await bodyValue(call.options.body, contentType),
    cookies: parseCookie(env.document.cookie),
    title: env.document.title,
    href: env.window.location.href,
    headerNames,
    requestHeaderNames: headerNames,
    query,
  };
}

function installBrowserGlobals(t, {
  cookie = 'hubspotutk=cookie-123',
  title = 'Contact Us | Example',
  href = 'https://www.example.com/contact-us',
  tokens = ['token-one'],
  grecaptchaPresent = true,
} = {}) {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    fetch: globalThis.fetch,
    grecaptcha: globalThis.grecaptcha,
  };
  let tokenIndex = 0;
  let enterpriseTokenIndex = 0;
  const scriptUrls = [];
  const document = {
    title,
    cookie,
    createElement(tagName) {
      return {
        tagName,
        async: false,
        onerror: null,
        onload: null,
        set src(value) { this._src = value; },
        get src() { return this._src; },
      };
    },
    head: {
      appendChild(element) {
        scriptUrls.push(element.src);
        queueMicrotask(() => {
          if (!window.grecaptcha) {
            window.grecaptcha = grecaptcha;
            globalThis.grecaptcha = grecaptcha;
          }
          if (element.onload) element.onload();
        });
      },
    },
  };
  const grecaptcha = {
    ready(callback) { callback(); },
    execute: async () => {
      const token = tokens[tokenIndex] || tokens.at(-1) || 'token';
      tokenIndex += 1;
      return token;
    },
    enterprise: {
      ready(callback) { callback(); },
      execute: async () => {
        const token = tokens[enterpriseTokenIndex] || tokens.at(-1) || 'token';
        enterpriseTokenIndex += 1;
        return `enterprise-${token}`;
      },
    },
  };
  const window = { document, location: { hostname: 'localhost', href } };
  if (grecaptchaPresent) window.grecaptcha = grecaptcha;
  globalThis.document = document;
  globalThis.window = window;
  globalThis.grecaptcha = grecaptchaPresent ? grecaptcha : undefined;
  t.after(() => {
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    globalThis.fetch = previous.fetch;
    globalThis.grecaptcha = previous.grecaptcha;
  });
  return { document, window, scriptUrls };
}

function installFetch(t, { status = 200, body = { accepted: true }, reject = null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    if (reject) throw reject;
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  t.after(() => {
    calls.length = 0;
  });
  return calls;
}

async function writeOwnerConfig(outDir, { base = 'https://www.example.com', headers = {} } = {}) {
  await writeFile(join(outDir, 'scripts/api-config.js'), [
    `export function apiBaseFor() { return '${base}'; }`,
    'export function apiHeadersFor(id) {',
    `  return ${JSON.stringify(headers)}[id] || {};`,
    '}',
    '',
  ].join('\n'));
}

test('contact-form fixture generates a client whose request satisfies the contract', async (t) => {
  const contract = JSON.parse(await readFile(fixturePath, 'utf8'));
  const { outDir } = await generate(t, [contract]);
  await writeOwnerConfig(outDir, { headers: { 'contact-form': { authorization: 'Bearer owner-provided' } } });
  const mod = await importModule(join(outDir, 'scripts/api/contact-form.js'));
  const env = installBrowserGlobals(t);
  const calls = installFetch(t);

  assert.deepEqual(mod.FIELDS, contract.fieldMap.map(({ path, name }) => ({ path, name })));
  assert.equal(mod.contactForm, mod.default);
  const result = await mod.default(valuesFromFieldMap(contract));

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const captured = await capturedRequest(calls[0], env);
  assert.deepEqual(diffContract(contract, captured), { pass: true, diffs: [] });
});

test('recaptcha dependency resolves a fresh token for each call', async (t) => {
  const contract = JSON.parse(await readFile(fixturePath, 'utf8'));
  const { outDir } = await generate(t, [contract]);
  await writeOwnerConfig(outDir);
  const mod = await importModule(join(outDir, 'scripts/api/contact-form.js'));
  installBrowserGlobals(t, { tokens: ['token-one', 'token-two'] });
  const calls = installFetch(t);

  await mod.default(valuesFromFieldMap(contract));
  await mod.default(valuesFromFieldMap(contract));

  const bodies = await Promise.all(calls.map((call) => bodyValue(call.options.body, 'application/json')));
  assert.deepEqual(bodies.map((body) => body.googleRecaptchaToken), ['token-one', 'token-two']);
});

test('missing cookie dependency is sent as null', async (t) => {
  const contract = JSON.parse(await readFile(fixturePath, 'utf8'));
  const { outDir } = await generate(t, [contract]);
  await writeOwnerConfig(outDir);
  const mod = await importModule(join(outDir, 'scripts/api/contact-form.js'));
  installBrowserGlobals(t, { cookie: '' });
  const calls = installFetch(t);

  await mod.default(valuesFromFieldMap(contract));

  const body = await bodyValue(calls[0].options.body, 'application/json');
  assert.equal(body.hubspotContext.hutk, null);
});

test('network failures return status zero without throwing', async (t) => {
  const contract = JSON.parse(await readFile(fixturePath, 'utf8'));
  const { outDir } = await generate(t, [contract]);
  await writeOwnerConfig(outDir);
  const mod = await importModule(join(outDir, 'scripts/api/contact-form.js'));
  installBrowserGlobals(t);
  installFetch(t, { reject: new TypeError('network down') });

  const result = await mod.default(valuesFromFieldMap(contract));

  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.equal(result.data, null);
  assert.equal(result.error, 'network down');
});

test('JSON error responses are parsed into error', async (t) => {
  const contract = JSON.parse(await readFile(fixturePath, 'utf8'));
  const { outDir } = await generate(t, [contract]);
  await writeOwnerConfig(outDir);
  const mod = await importModule(join(outDir, 'scripts/api/contact-form.js'));
  installBrowserGlobals(t);
  installFetch(t, { status: 400, body: { message: 'bad request' } });

  const result = await mod.default(valuesFromFieldMap(contract));

  assert.deepEqual(result, { ok: false, status: 400, data: null, error: { message: 'bad request' } });
});

test('GraphQL query contracts emit operationName, query, variables, and pass diff', async (t) => {
  const contract = {
    id: 'find-things',
    endpoint: 'https://www.example.com/graphql',
    method: 'POST',
    contentType: 'application/json',
    graphql: {
      operationName: 'FindThings',
      type: 'query',
      variables: { term: '' },
      persistedHash: null,
    },
    kind: 'graphql-query',
    origin: 'first-party',
    trigger: { type: 'search', selector: '#search' },
    pages: ['https://www.example.com/search'],
    auth: { scheme: 'none', headerNames: [] },
    requestSchema: {
      type: 'object',
      properties: {
        operationName: { type: 'string' },
        query: { type: 'string' },
        variables: { type: 'object', properties: { term: { type: 'string' } }, required: ['term'] },
      },
      required: ['operationName', 'query', 'variables'],
    },
    requestExample: {
      operationName: 'FindThings',
      query: 'query FindThings($term: String!) { search(term: $term) { id } }',
      variables: { term: '<test:search>' },
    },
    fieldMap: [{ path: 'variables.term', selector: '#search', name: 'q', value: 'test' }],
    clientDeps: [],
    responses: {},
    status: 'contracted',
    confirmed: true,
  };
  const { outDir } = await generate(t, [contract]);
  await writeOwnerConfig(outDir);
  const mod = await importModule(join(outDir, 'scripts/api/find-things.js'));
  const env = installBrowserGlobals(t);
  const calls = installFetch(t);

  await mod.default(valuesFromFieldMap(contract));

  const captured = await capturedRequest(calls[0], env);
  assert.equal(captured.body.operationName, 'FindThings');
  assert.equal(captured.body.query, contract.requestExample.query);
  assert.deepEqual(captured.body.variables, { term: 'test' });
  assert.deepEqual(diffContract(contract, captured), { pass: true, diffs: [] });
});

test('GET contracts use required query keys from values and expose safe aliases', async (t) => {
  const contract = {
    id: '123-search',
    endpoint: 'https://www.example.com/api/search?term=&page=',
    method: 'GET',
    contentType: null,
    graphql: null,
    kind: 'rest-read',
    origin: 'first-party',
    trigger: { type: 'search', selector: '#search' },
    pages: ['https://www.example.com/search'],
    auth: { scheme: 'none', headerNames: [] },
    requestSchema: {},
    requestExample: null,
    fieldMap: [],
    clientDeps: [],
    responses: {},
    status: 'contracted',
    confirmed: true,
  };
  const { outDir } = await generate(t, [contract]);
  await writeOwnerConfig(outDir);
  const mod = await importModule(join(outDir, 'scripts/api/123-search.js'));
  const env = installBrowserGlobals(t);
  const calls = installFetch(t);

  assert.equal(typeof mod.api123Search, 'function');
  await mod.api123Search({ term: 'alpha', page: '2' });

  const captured = await capturedRequest(calls[0], env);
  assert.deepEqual(captured.query, { term: 'alpha', page: '2' });
  assert.deepEqual(diffContract(contract, captured), { pass: true, diffs: [] });
});

test('form-encoded contracts send URLSearchParams bodies', async (t) => {
  const contract = {
    id: 'newsletter',
    endpoint: 'https://www.example.com/api/newsletter',
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    graphql: null,
    kind: 'rest-write',
    origin: 'first-party',
    trigger: { type: 'submit', selector: '#newsletter' },
    pages: ['https://www.example.com/newsletter'],
    auth: { scheme: 'none', headerNames: [] },
    requestSchema: {
      type: 'object',
      properties: { email: { type: 'string' }, topic: { type: 'string' } },
      required: ['email', 'topic'],
    },
    requestExample: { email: '<test:email>', topic: 'news' },
    fieldMap: [{ path: 'email', selector: '#email', name: 'email', value: 'api-probe@example.com' }],
    clientDeps: [],
    responses: {},
    status: 'contracted',
    confirmed: true,
  };
  const { outDir } = await generate(t, [contract]);
  await writeOwnerConfig(outDir);
  const mod = await importModule(join(outDir, 'scripts/api/newsletter.js'));
  const env = installBrowserGlobals(t);
  const calls = installFetch(t);

  await mod.default(valuesFromFieldMap(contract));

  assert.equal(calls[0].options.body instanceof URLSearchParams, true);
  const captured = await capturedRequest(calls[0], env);
  assert.deepEqual(diffContract(contract, captured), { pass: true, diffs: [] });
});

test('multipart contracts append persisted field names instead of fields metadata paths', async (t) => {
  const contract = {
    id: 'upload-form',
    endpoint: 'https://www.example.com/api/upload',
    method: 'POST',
    contentType: 'multipart/form-data',
    graphql: null,
    kind: 'rest-write',
    origin: 'first-party',
    trigger: { type: 'submit', selector: '#upload' },
    pages: ['https://www.example.com/upload'],
    auth: { scheme: 'none', headerNames: [] },
    requestSchema: {
      type: 'object',
      properties: { fields: { type: 'array', items: { type: 'string' } } },
      required: ['fields'],
    },
    requestExample: { fields: ['email', 'topic', 'unmapped'] },
    fieldMap: [{ path: 'email', selector: '#email', name: 'email', value: 'api-probe@example.com' }],
    clientDeps: [],
    responses: {},
    status: 'contracted',
    confirmed: true,
  };
  const { outDir } = await generate(t, [contract]);
  await writeOwnerConfig(outDir);
  const mod = await importModule(join(outDir, 'scripts/api/upload-form.js'));
  installBrowserGlobals(t);
  const calls = installFetch(t);

  await mod.default({ email: 'writer@example.com', topic: 'docs' });

  assert.deepEqual([...calls[0].options.body.keys()], ['email', 'topic', 'unmapped']);
  assert.deepEqual(Object.fromEntries(calls[0].options.body.entries()), {
    email: 'writer@example.com',
    topic: 'docs',
    unmapped: '',
  });
});

test('recaptcha enterprise dependencies load the enterprise script and call enterprise execute', async (t) => {
  const contract = {
    id: 'enterprise-form',
    endpoint: 'https://www.example.com/api/enterprise',
    method: 'POST',
    contentType: 'application/json',
    graphql: null,
    kind: 'rest-write',
    origin: 'first-party',
    trigger: { type: 'submit', selector: '#enterprise' },
    pages: ['https://www.example.com/enterprise'],
    auth: { scheme: 'none', headerNames: [] },
    requestSchema: {
      type: 'object',
      properties: { token: { type: 'string' } },
      required: ['token'],
    },
    requestExample: { token: '<recaptcha>' },
    fieldMap: [],
    clientDeps: [{ path: 'token', from: 'recaptcha-enterprise', siteKey: 'enterprise-key', action: 'Submit' }],
    responses: {},
    status: 'contracted',
    confirmed: true,
  };
  const { outDir } = await generate(t, [contract]);
  await writeOwnerConfig(outDir);
  const mod = await importModule(join(outDir, 'scripts/api/enterprise-form.js'));
  const env = installBrowserGlobals(t, { grecaptchaPresent: false, tokens: ['one', 'two'] });
  const calls = installFetch(t);

  await mod.default();
  await mod.default();

  const bodies = await Promise.all(calls.map((call) => bodyValue(call.options.body, 'application/json')));
  assert.deepEqual(env.scriptUrls, ['https://www.google.com/recaptcha/enterprise.js?render=enterprise-key']);
  assert.deepEqual(bodies.map((body) => body.token), ['enterprise-one', 'enterprise-two']);
});

test('generated literals preserve escaped contract strings without template cooking', async (t) => {
  const special = `line\nquote" slash\\ tick\` expr\${x} sep${String.fromCodePoint(0x2028)} close</script>`;
  const contract = {
    id: 'literal-safety',
    endpoint: `https://www.example.com/api/${special}`,
    method: 'POST',
    contentType: 'application/json',
    graphql: null,
    kind: 'rest-write',
    origin: 'first-party',
    trigger: { type: 'submit', selector: '#literal' },
    pages: ['https://www.example.com/literal'],
    auth: { scheme: 'none', headerNames: [] },
    requestSchema: {
      type: 'object',
      properties: {
        field: { type: 'string' },
        constants: { type: 'object', properties: { special: { type: 'string' } } },
      },
      required: ['field', 'constants'],
    },
    requestExample: { field: '<test:message>', constants: { special: '' } },
    fieldMap: [{ path: 'field', selector: '#field', name: special, value: 'api-integrations probe - please ignore' }],
    clientDeps: [{ path: 'constants.special', from: 'constant', value: special }],
    responses: {},
    status: 'contracted',
    confirmed: true,
  };
  const { outDir } = await generate(t, [contract]);
  await writeOwnerConfig(outDir);
  const mod = await importModule(join(outDir, 'scripts/api/literal-safety.js'));
  const source = await readFile(join(outDir, 'scripts/api/literal-safety.js'), 'utf8');

  assert.equal(mod.FIELDS[0].name, special);
  assert.equal(source.includes('</script>'), false);
  assert.deepEqual(mod.buildPayload(valuesFromFieldMap(contract)), {
    field: 'api-integrations probe - please ignore',
    constants: { special },
  });
});

test('generated source omits field test values and secret placeholders', async (t) => {
  const contract = JSON.parse(await readFile(fixturePath, 'utf8'));
  const { outDir } = await generate(t, [contract]);
  const source = await readFile(join(outDir, 'scripts/api/contact-form.js'), 'utf8');

  for (const entry of contract.fieldMap) {
    assert.equal(source.includes(entry.value), false, `${entry.value} leaked`);
  }
  assert.equal(source.includes('<cookie:'), false);
  assert.equal(source.includes('<recaptcha>'), false);
});

test('unknown client dependency kinds fail generation with the kind named', async (t) => {
  const contract = JSON.parse(await readFile(fixturePath, 'utf8'));
  contract.id = 'unknown-dep';
  contract.clientDeps = [{ path: 'session.id', from: 'sessionStorage', name: 'sid' }];
  const dir = await makeCase(t, 'unknown-dep');
  const contractsDir = join(dir, 'contracts');
  const outDir = join(dir, 'eds');
  await writeContracts(contractsDir, [contract]);

  const result = runCodegen(['--contracts', contractsDir, '--out', outDir]);

  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /unknown-dep/);
  assert.match(`${result.stdout}\n${result.stderr}`, /sessionStorage/);
});

test('marked generated files are overwritten, unmarked files need force', async (t) => {
  const contract = JSON.parse(await readFile(fixturePath, 'utf8'));
  const { outDir, contractsDir } = await generate(t, [contract]);
  const modulePath = join(outDir, 'scripts/api/contact-form.js');
  await writeFile(modulePath, '// owner file\nexport default function owner() {}\n');

  const skipped = runCodegen(['--contracts', contractsDir, '--out', outDir]);
  assert.equal(skipped.status, 0);
  assert.match(skipped.stdout, /skipped/i);
  assert.match(await readFile(modulePath, 'utf8'), /owner file/);

  const forced = runCodegen(['--contracts', contractsDir, '--out', outDir, '--force']);
  assert.equal(forced.status, 0);
  assert.match(await readFile(modulePath, 'utf8'), /^\/\/ Generated by api-integrations api-codegen/);

  await writeFile(modulePath, '// Generated by api-integrations api-codegen from contract contact-form. Edits are overwritten on re-run.\n// stale\n');
  const rerun = runCodegen(['--contracts', contractsDir, '--out', outDir]);
  assert.equal(rerun.status, 0);
  assert.doesNotMatch(await readFile(modulePath, 'utf8'), /stale/);
});

test('api-config is created once and not overwritten on rerun', async (t) => {
  const contract = JSON.parse(await readFile(fixturePath, 'utf8'));
  const { outDir, contractsDir } = await generate(t, [contract]);
  const configPath = join(outDir, 'scripts/api-config.js');
  const ownerConfig = 'export function apiBaseFor() { return ""; }\nexport function apiHeadersFor() { return { authorization: "owner" }; }\n';
  await writeFile(configPath, ownerConfig);

  const result = runCodegen(['--contracts', contractsDir, '--out', outDir]);

  assert.equal(result.status, 0);
  assert.equal(await readFile(configPath, 'utf8'), ownerConfig);
});

test('dry run prints planned files and writes nothing', async (t) => {
  const contract = JSON.parse(await readFile(fixturePath, 'utf8'));
  const dir = await makeCase(t, 'dry-run');
  const contractsDir = join(dir, 'contracts');
  const outDir = join(dir, 'eds');
  await writeContracts(contractsDir, [contract]);

  const result = runCodegen(['--contracts', contractsDir, '--out', outDir, '--dry-run']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /scripts\/api\/contact-form\.js/);
  await assert.rejects(readdir(join(outDir, 'scripts')), /ENOENT/);
});

test('unknown ids are usage errors', async (t) => {
  const contract = JSON.parse(await readFile(fixturePath, 'utf8'));
  const dir = await makeCase(t, 'unknown-id');
  const contractsDir = join(dir, 'contracts');
  const outDir = join(dir, 'eds');
  await writeContracts(contractsDir, [contract]);

  const result = runCodegen(['--contracts', contractsDir, '--out', outDir, '--id', 'missing']);

  assert.equal(result.status, 2);
  assert.match(`${result.stdout}\n${result.stderr}`, /missing/);
});

test('every generated file parses as an ES module', async (t) => {
  const contract = JSON.parse(await readFile(fixturePath, 'utf8'));
  const { outDir } = await generate(t, [contract]);
  const modulePath = join(outDir, 'scripts/api/contact-form.js');
  const checkPath = join(outDir, 'scripts/api/contact-form-check.mjs');
  await cp(modulePath, checkPath);

  const result = spawnSync(process.execPath, ['--check', checkPath], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
});

test('generated files wrap style-sensitive lines to one hundred columns', async (t) => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const multipart = {
    id: 'upload-form',
    endpoint: 'https://www.example.com/api/upload',
    method: 'POST',
    contentType: 'multipart/form-data',
    graphql: null,
    kind: 'rest-write',
    origin: 'first-party',
    trigger: { type: 'submit', selector: '#upload' },
    pages: ['https://www.example.com/upload'],
    auth: { scheme: 'none', headerNames: [] },
    requestSchema: { type: 'object', properties: { fields: { type: 'array' } }, required: ['fields'] },
    requestExample: { fields: ['email', 'topic', 'unmapped'] },
    fieldMap: [{ path: 'email', selector: '#email', name: 'email', value: 'api-probe@example.com' }],
    clientDeps: [],
    responses: {},
    status: 'contracted',
    confirmed: true,
  };
  const enterprise = {
    id: 'enterprise-form',
    endpoint: 'https://www.example.com/api/enterprise',
    method: 'POST',
    contentType: 'application/json',
    graphql: null,
    kind: 'rest-write',
    origin: 'first-party',
    trigger: { type: 'submit', selector: '#enterprise' },
    pages: ['https://www.example.com/enterprise'],
    auth: { scheme: 'none', headerNames: [] },
    requestSchema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] },
    requestExample: { token: '<recaptcha>' },
    fieldMap: [],
    clientDeps: [{ path: 'token', from: 'recaptcha-enterprise', siteKey: 'enterprise-key', action: 'Submit' }],
    responses: {},
    status: 'contracted',
    confirmed: true,
  };
  const { outDir } = await generate(t, [fixture, multipart, enterprise]);
  const files = ['contact-form.js', 'upload-form.js', 'enterprise-form.js'];
  const allowedLongLiteral = (line) => {
    const trimmed = line.trim();
    if (/^\/\/ Generated by api-integrations api-codegen/.test(trimmed)) return true;
    if (/^["'][^"']+["']: ["']/.test(trimmed)) return true;
    if (/^(?:const [A-Z_]+ = |script\.src = )["'`]/.test(trimmed)) return true;
    return /^return `https:\/\/www\.google\.com\/recaptcha\/\$\{script\}\?render=/.test(trimmed);
  };

  for (const file of files) {
    const source = await readFile(join(outDir, 'scripts/api', file), 'utf8');
    const tooLong = source.split('\n')
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => line.length > 100 && !allowedLongLiteral(line));
    assert.deepEqual(tooLong, [], `${file} has lines over 100 columns`);
  }
});
