#!/usr/bin/env node
// Export a Figma node screenshot to a PNG file via the Figma desktop
// MCP server's streamable-HTTP endpoint (default http://127.0.0.1:3845/mcp),
// bypassing the agent context entirely — the image never enters the
// conversation. Requires the Figma desktop app running with the local
// MCP server enabled and the target file open.
//
// Usage: node figma-screenshot.mjs <nodeId> <outfile.png> [--contents-only]
//        node figma-screenshot.mjs --batch <manifest.json>
//   manifest.json: [{ "nodeId": "1:23", "out": "path/to/file.png" }, ...]
// Env: FIGMA_MCP_URL to override the endpoint.

const MCP_URL = process.env.FIGMA_MCP_URL || 'http://127.0.0.1:3845/mcp';

async function rpc(session, body) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${body.method}`);
  const newSession = res.headers.get('mcp-session-id') || session;
  const text = await res.text();
  // Responses arrive as SSE (`data: {...}` lines) or plain JSON.
  let msg = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('data:')) {
      const parsed = JSON.parse(line.slice(5).trim());
      if (parsed.id === body.id) msg = parsed;
    }
  }
  if (!msg && text.trim().startsWith('{')) msg = JSON.parse(text);
  return { session: newSession, msg };
}

async function connect() {
  const { session } = await rpc(null, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2025-03-26', capabilities: {},
      clientInfo: { name: 'figma-to-eds-screenshot', version: '0.1.0' },
    },
  });
  if (!session) throw new Error('no mcp-session-id returned by initialize');
  await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': session,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  return session;
}

async function screenshot(session, id, nodeId, contentsOnly) {
  const { msg } = await rpc(session, {
    jsonrpc: '2.0', id, method: 'tools/call',
    params: {
      name: 'get_screenshot',
      arguments: { nodeId, ...(contentsOnly ? { contentsOnly: true } : {}) },
    },
  });
  if (!msg) throw new Error(`no response for ${nodeId}`);
  if (msg.error) throw new Error(`${nodeId}: ${msg.error.message}`);
  const img = (msg.result?.content || []).find((c) => c.type === 'image');
  if (!img) {
    const texts = (msg.result?.content || []).map((c) => c.text).join(' ');
    throw new Error(`${nodeId}: no image in result (${texts.slice(0, 200)})`);
  }
  return { data: Buffer.from(img.data, 'base64'), mime: img.mimeType };
}

const { writeFileSync, readFileSync, mkdirSync } = await import('node:fs');
const { dirname } = await import('node:path');
const args = process.argv.slice(2);

const jobs = [];
if (args[0] === '--batch') {
  for (const j of JSON.parse(readFileSync(args[1], 'utf8'))) {
    jobs.push({ nodeId: j.nodeId, out: j.out, contentsOnly: !!j.contentsOnly });
  }
} else {
  const [nodeId, out] = args;
  if (!nodeId || !out) {
    console.error('usage: figma-screenshot.mjs <nodeId> <out.png> [--contents-only] | --batch <manifest.json>');
    process.exit(2);
  }
  jobs.push({ nodeId, out, contentsOnly: args.includes('--contents-only') });
}

const session = await connect();
let failed = 0;
for (let i = 0; i < jobs.length; i++) {
  const j = jobs[i];
  try {
    const { data, mime } = await screenshot(session, i + 10, j.nodeId, j.contentsOnly);
    mkdirSync(dirname(j.out), { recursive: true });
    writeFileSync(j.out, data);
    console.log(`ok ${j.nodeId} -> ${j.out} (${data.length} bytes, ${mime})`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${j.nodeId}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
