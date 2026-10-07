#!/usr/bin/env node
/*
 * Mock decision engine implementing the v1 contract
 * (reference/decision-api-contract.md), with latency and failure injection.
 * For local testing only.
 *
 * Usage: node mock-decision-api.mjs [--port 4100] [--decisions decisions.json]
 *          [--latency 0] [--fail 500] [--invalid] [--ttl 300] [--cacheable]
 *
 * Endpoints: POST /decide (contract), GET /requests (bodies received, newest
 * last), DELETE /requests, GET /health. CORS is open so aem up can call it.
 *
 * decisions.json:
 * {
 *   "ttl": 300, "cacheable": true,
 *   "placeholders": {
 *     "home-hero": { "geo: IN": "india", "visitor: returning": { "fragment": "/fragments/x" }, "*": null },
 *     "welcome": { "*": "back" }
 *   }
 * }
 * Keys are conditions in the authoring grammar (or "*"), checked in order
 * against the request context; values are a variant name, null (control /
 * default) or a full decision object. A placeholder with no match is omitted,
 * so the site falls back to its own rules.
 */

import { createServer } from 'node:http';
import { resolve } from 'node:path';
import {
  importAsset, exitOnHelp, isMain, parseArgs, readJson,
} from './lib.mjs';

export const USAGE = `Usage: node mock-decision-api.mjs [--port 4100] [--decisions decisions.json]
         [--latency 0] [--fail 500] [--invalid] [--ttl 300] [--cacheable]
Local v1 decision-engine mock (reference/decision-api-contract.md) with latency
and failure injection. Endpoints: POST /decide, GET|DELETE /requests, GET /health.`;


const { parseCondition, evaluate } = await importAsset('runtime', 'scripts', 'personalization', 'rules.js');

const MAX_BODY_BYTES = 65536;

function toDecision(value) {
  if (value === null) return { variant: null };
  if (typeof value === 'string') return { variant: value };
  return value && typeof value === 'object' ? value : undefined;
}

/**
 * Decides like an engine configured with the given file.
 * @param {object} file decisions file
 * @param {object} body v1 request body
 * @returns {Promise<{decisions: object, ttl: number, cacheable: boolean}>}
 */
export async function engineDecide(file, body) {
  const table = file?.placeholders || {};
  const context = body?.context || {};
  const decisions = {};
  await Promise.all((body?.placeholders || []).map(async ({ id }) => {
    const entries = Object.entries(table[id] || {});
    const outcomes = await Promise.all(entries.map(async ([condition]) => {
      if (condition === '*') return true;
      try {
        return await evaluate(parseCondition(condition), context, {});
      } catch (e) {
        console.warn(`⚠️ mock engine: bad condition "${condition}" for ${id}: ${e.message}`);
        return false;
      }
    }));
    const index = outcomes.indexOf(true);
    const decision = index === -1 ? undefined : toDecision(entries[index][1]);
    if (decision) decisions[id] = { ...decision, tracking: { engine: 'mock', rule: entries[index][0] } };
  }));
  return { decisions, ttl: file?.ttl ?? 300, cacheable: file?.cacheable ?? false };
}

/**
 * @param {object} body
 * @returns {string|null} error message for a non-conforming request
 */
export function checkRequest(body) {
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  if (body.version !== '1') return 'version must be "1"';
  if (!Array.isArray(body.placeholders)) return 'placeholders must be an array';
  if (body.placeholders.some((entry) => typeof entry?.id !== 'string')) return 'each placeholder needs an id';
  if (!body.context || typeof body.context !== 'object') return 'context must be an object';
  return null;
}

/**
 * @param {object} options
 * @returns {import('node:http').Server}
 */
export function createMockServer({
  decisions = {}, latency = 0, fail, invalid = false, ttl, cacheable,
} = {}) {
  const requests = [];
  const file = {
    ...decisions,
    ...(ttl !== undefined ? { ttl } : {}),
    ...(cacheable !== undefined ? { cacheable } : {}),
  };
  const send = (res, status, payload, type = 'application/json') => {
    res.writeHead(status, {
      'content-type': type,
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
    });
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  };
  return createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') { send(res, 204, ''); return; }
    if (pathname === '/health') { send(res, 200, { ok: true }); return; }
    if (pathname === '/requests') {
      if (req.method === 'DELETE') requests.length = 0;
      send(res, 200, requests);
      return;
    }
    if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return; }
    let text = '';
    req.on('data', (chunk) => {
      text += chunk;
      if (text.length > MAX_BODY_BYTES) req.destroy();
    });
    req.on('end', async () => {
      let body;
      try {
        body = JSON.parse(text);
      } catch (e) {
        send(res, 400, { error: 'invalid JSON' });
        return;
      }
      requests.push(body);
      const problem = checkRequest(body);
      if (problem) {
        console.warn(`⚠️ mock engine: rejected request: ${problem}`);
        send(res, 400, { error: problem });
        return;
      }
      if (latency) await new Promise((done) => { setTimeout(done, latency); });
      if (fail) { send(res, fail, { error: `injected ${fail}` }); return; }
      if (invalid) { send(res, 200, '{"decisions": ', 'application/json'); return; }
      const result = await engineDecide(file, body);
      console.log(`✓ ${body.mode || '?'} ${body.page?.path || '?'} → ${JSON.stringify(result.decisions)}`);
      send(res, 200, result);
    });
  });
}

if (isMain(import.meta.url)) {
  exitOnHelp(USAGE);
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.port || 4100);
  const decisions = args.decisions ? readJson(resolve(args.decisions)) : {};
  if (args.decisions && !decisions) {
    console.error(`❌ could not read ${args.decisions}`);
    process.exit(2);
  }
  const server = createMockServer({
    decisions,
    latency: Number(args.latency || 0),
    fail: args.fail ? Number(args.fail === true ? 500 : args.fail) : undefined,
    invalid: !!args.invalid,
    ttl: args.ttl !== undefined ? Number(args.ttl) : undefined,
    cacheable: args.cacheable ? true : undefined,
  });
  server.listen(port, () => {
    console.log(`✓ mock decision engine on http://localhost:${port}/decide`);
    console.log('  set api.endpoint in scripts/personalization/config.js to this URL for local tests only');
  });
}
