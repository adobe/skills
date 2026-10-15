'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

test('checkMcpServer reports each AEM Quickstart MCP readiness state without leaking credentials', async (context) => {
  const { checkMcpServer } = require('./mcp.js');
  const SECRET = 'user:s3cret-value';
  const tools = (names) => ({ status: 200, headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: names.map((name) => ({ name })) } }) });
  const ok = { status: 200, headers: new Headers({ 'mcp-session-id': 'abc' }), text: async () => '{}' };

  const noAuth = await checkMcpServer('http://localhost:4602', undefined);
  assert.strictEqual(noAuth.status, 'credentials_missing');

  const cases = [
    [[{ status: 401 }], 'credentials_rejected'],
    [[{ status: 404 }], 'not_installed'],
    [[ok, tools(['aem-logs'])], 'tool_missing'],
    [[ok, tools(['aem-logs', 'diagnose-osgi-bundle'])], 'ready'],
  ];
  for (const [responses, expected] of cases) {
    const calls = [];
    context.mock.method(globalThis, 'fetch', async (url, init) => {
      calls.push({ url, init });
      const r = responses.shift();
      return { headers: new Headers(), text: async () => '', ...r };
    });
    const result = await checkMcpServer('http://localhost:4602/', SECRET);
    assert.strictEqual(result.status, expected);
    assert.strictEqual(calls[0].url, 'http://localhost:4602/bin/mcp');
    assert.ok(!JSON.stringify(result).includes('s3cret'), 'result must not contain the password');
    if (expected === 'ready') assert.strictEqual(calls[1].init.headers['Mcp-Session-Id'], 'abc');
    context.mock.restoreAll();
  }
});

test('detectEditor identifies the coding assistant from its environment', () => {
  const { detectEditor } = require('./mcp.js');
  assert.strictEqual(detectEditor({ TERM_PROGRAM: 'vscode', __CFBundleIdentifier: 'com.microsoft.VSCode' }), 'vscode');
  assert.strictEqual(detectEditor({ TERM_PROGRAM: 'vscode', __CFBundleIdentifier: 'com.microsoft.VSCodeInsiders' }), 'vscode-insiders');
  assert.strictEqual(detectEditor({ TERM_PROGRAM: 'vscode', __CFBundleIdentifier: 'com.todesktop.230313mzl4w4u92' }), 'cursor');
  assert.strictEqual(detectEditor({ CLAUDECODE: '1' }), 'claude');
  assert.strictEqual(detectEditor({}), null);
});

test('mergeEditorConfig adds the AEM MCP server to VS Code without storing credentials', () => {
  const { mergeEditorConfig } = require('./mcp.js');
  const sdk = 'http://localhost:4602';
  const added = mergeEditorConfig('vscode', '', sdk);
  assert.strictEqual(added.changed, true);
  const config = JSON.parse(added.text);
  assert.deepStrictEqual(config.servers['aem-cs-sdk'], { type: 'http', url: `${sdk}/bin/mcp`, headers: { Authorization: '${input:aem-sdk-auth}' } });
  assert.strictEqual(config.inputs.filter((i) => i.id === 'aem-sdk-auth' && i.password === true).length, 1);
  assert.ok(!/Basic [A-Za-z0-9+/=]{4,}/.test(added.text), 'no credential may be written');

  const kept = mergeEditorConfig('vscode', JSON.stringify({ servers: { other: { type: 'stdio', command: 'x' } } }), sdk);
  assert.deepStrictEqual(JSON.parse(kept.text).servers.other, { type: 'stdio', command: 'x' });
  assert.strictEqual(mergeEditorConfig('vscode', added.text, sdk).changed, false);
  assert.ok(mergeEditorConfig('vscode', '{ // comment\n "servers": {} }', sdk).error);
  assert.ok(mergeEditorConfig('cursor', '', sdk).error, 'editors without prompted inputs are not written');
});
