'use strict';

/**
 * mcp.js — readiness probe for the AEM Quickstart MCP server, the content package
 * that exposes `diagnose-osgi-bundle` at <sdk>/bin/mcp. Every runtime pattern needs it.
 * This only checks the server; the coding assistant still calls the tool itself.
 */
const MCP_PACKAGE = 'com.adobe.aem:com.adobe.aem.mcp-server-contribs-content';
const MCP_MAVEN_URL = 'https://repo1.maven.org/maven2/com/adobe/aem/com.adobe.aem.mcp-server-contribs-content/';
const MCP_VERSIONS_URL = 'https://github.com/adobe/cq-quickstart-mcp-server#supported-versions';
const MCP_DOC_URL = 'https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/ai-in-aem/local-development-with-ai-tools#aem-quickstart-mcp-server';
const REQUIRED_TOOL = 'diagnose-osgi-bundle';

// Streamable HTTP may answer with JSON or an SSE stream; take the last data frame.
function parseRpc(text) {
  const frames = text.split('\n').filter((line) => line.startsWith('data:'));
  try { return JSON.parse(frames.length ? frames[frames.length - 1].slice(5).trim() : text); } catch { return null; }
}

/**
 * @param {string} sdkUrl SDK base URL
 * @param {string|undefined} auth `user:password` from the user's environment
 * @returns {Promise<{status: 'ready'|'credentials_missing'|'credentials_rejected'|'unreachable'|'not_installed'|'tool_missing', endpoint: string, tools?: string[], http_status?: number}>}
 */
async function checkMcpServer(sdkUrl, auth) {
  const endpoint = `${sdkUrl.replace(/\/$/, '')}/bin/mcp`;
  if (!auth) return { status: 'credentials_missing', endpoint };
  const headers = {
    Authorization: 'Basic ' + Buffer.from(auth).toString('base64'),
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  const call = (body, extra = {}) => fetch(endpoint, {
    method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });

  let init;
  try {
    init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'validate-migration', version: '1' } } });
  } catch {
    return { status: 'unreachable', endpoint };
  }
  if (init.status === 401 || init.status === 403) return { status: 'credentials_rejected', endpoint };
  if (init.status !== 200) return { status: 'not_installed', endpoint, http_status: init.status };

  const session = init.headers.get('mcp-session-id');
  let tools = [];
  try {
    const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, session ? { 'Mcp-Session-Id': session } : {});
    tools = (parseRpc(await list.text())?.result?.tools || []).map((tool) => tool.name);
  } catch {
    return { status: 'unreachable', endpoint };
  }
  return { status: tools.includes(REQUIRED_TOOL) ? 'ready' : 'tool_missing', endpoint, tools };
}

// One-line guidance per status; never includes credentials.
function mcpGuidance(result, authVar = 'AEM_TARGET_AUTH') {
  switch (result.status) {
    case 'ready':
      return `server ready at ${result.endpoint}. Add it to your coding assistant's MCP config (HTTP, `
        + `Authorization: Basic header from your own SDK login), then confirm the assistant lists ${REQUIRED_TOOL}. See ${MCP_DOC_URL}`;
    case 'credentials_missing':
      return `set ${authVar}=<user>:<password> (your SDK login) in your own terminal so the MCP server can be checked`;
    case 'credentials_rejected':
      return `${authVar} was rejected by the SDK; set it to a valid SDK login in your own terminal`;
    case 'unreachable':
      return `${result.endpoint} did not respond; confirm the SDK is running`;
    case 'tool_missing':
      return `server found but ${REQUIRED_TOOL} is missing (tools: ${result.tools.join(', ') || 'none'}); install a newer ${MCP_PACKAGE}`;
    default:
      return `install ${MCP_PACKAGE} on the SDK via Package Manager (/crx/packmgr). Pick the release listed for your SDK version `
        + `at ${MCP_VERSIONS_URL}; packages: ${MCP_MAVEN_URL}`;
  }
}

/** Which coding assistant launched this shell, or null. */
function detectEditor(env) {
  if (env.CLAUDECODE === '1') return 'claude';
  if (env.TERM_PROGRAM !== 'vscode') return null;
  const bundle = env.__CFBundleIdentifier || '';
  if (bundle === 'com.microsoft.VSCodeInsiders') return 'vscode-insiders';
  if (bundle === 'com.microsoft.VSCode') return 'vscode';
  if (bundle.startsWith('com.todesktop.')) return 'cursor';
  return null;
}

const MCP_SERVER_ID = 'aem-cs-sdk';
const MCP_INPUT_ID = 'aem-sdk-auth';

/**
 * Adds the SDK MCP server to a VS Code mcp.json. The Authorization header is a
 * prompted password input, so no credential is ever written to disk.
 */
function mergeEditorConfig(editor, existingText, sdkUrl) {
  if (editor !== 'vscode' && editor !== 'vscode-insiders') {
    return { error: `${editor}: no prompted secret inputs; add the server manually (see ${MCP_DOC_URL})` };
  }
  let config;
  try {
    config = existingText.trim() ? JSON.parse(existingText) : {};
  } catch {
    return { error: 'mcp.json is not plain JSON (comments or trailing commas); add the server manually' };
  }
  const server = { type: 'http', url: `${sdkUrl.replace(/\/$/, '')}/bin/mcp`, headers: { Authorization: `\${input:${MCP_INPUT_ID}}` } };
  const inputs = config.inputs || [];
  const hasInput = inputs.some((i) => i.id === MCP_INPUT_ID);
  const servers = config.servers || {};
  if (hasInput && JSON.stringify(servers[MCP_SERVER_ID]) === JSON.stringify(server)) return { changed: false, text: existingText };
  const input = { id: MCP_INPUT_ID, type: 'promptString', description: 'AEM SDK Authorization header, e.g. Basic <base64 of user:password>', password: true };
  const merged = { ...config, servers: { ...servers, [MCP_SERVER_ID]: server }, inputs: hasInput ? inputs : [...inputs, input] };
  return { changed: true, text: JSON.stringify(merged, null, 2) + '\n' };
}

module.exports = { checkMcpServer, mcpGuidance, detectEditor, mergeEditorConfig, MCP_PACKAGE, MCP_MAVEN_URL, MCP_VERSIONS_URL, MCP_DOC_URL, REQUIRED_TOOL };
