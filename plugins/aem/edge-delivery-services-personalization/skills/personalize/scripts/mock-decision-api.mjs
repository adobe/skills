#!/usr/bin/env node
/*
 * Local mock of a decision engine (engine API v1, contract section 5) and of
 * the Adobe Target Delivery API (section 7). Requests are checked against
 * the contract schemas; answers come from the same table-driven mock the
 * browser uses (mock-engine.js), so local tests and aem.page demos decide
 * alike. For local testing only.
 *
 * Endpoints: POST /decide (engine), POST /feedback (decision feedback),
 * POST /rest/v1/delivery (Target prefetch and notifications), GET /requests
 * (bodies received, newest last), DELETE /requests, GET /health. CORS is open
 * so aem up can call it. A request header `x-pzn-mock: <knob>` overrides
 * --knob for that request.
 *
 * decisions.json (engine table, mock-engine.js):
 *   { "ttl": 0, "cacheable": false, "placeholders": {
 *       "home-hero": { "geo: US": "pro", "device: mobile": { "control": true },
 *                      "*": { "reason": "low_confidence" } } } }
 * activities.json (Target table):
 *   { "scroll-offer": { "name": "Scroll offer", "experiences": [
 *       { "name": "Returning", "audience": "visitor: returning", "offer": "/fragments/x/welcome-back" },
 *       { "name": "Everyone", "audience": null, "control": true } ] } }
 */

import { createServer } from 'node:http';
import { resolve } from 'node:path';
import {
  importAsset, exitOnHelp, isMain, parseArgs, readJson,
} from './lib.mjs';
import { check } from './schema.mjs';

export const USAGE = `Usage: node mock-decision-api.mjs [--port 4100] [--decisions decisions.json]
         [--target activities.json] [--latency 0] [--knob <knob>] [--ttl 300] [--cacheable]
Local mock of a v1 decision engine (POST /decide, POST /feedback) and of the
Adobe Target Delivery API (POST /rest/v1/delivery). Requests are checked
against the contract schemas (a non-conforming request gets HTTP 400).
Knobs: fail (HTTP 500), invalid (not a v1 response), missing (no answer),
control, default, reason:<code>, variant:<name>; a request header
x-pzn-mock: <knob> overrides --knob. GET|DELETE /requests, GET /health.`;

const {
  engineAnswer, targetAnswer, parseKnob,
} = await importAsset('runtime', 'scripts', 'personalization', 'mock-engine.js');

const MAX_BODY_BYTES = 65536;
export const DELIVERY_PATH = '/rest/v1/delivery';
export const DECIDE_PATH = '/decide';
export const FEEDBACK_PATH = '/feedback';

/**
 * @param {object} body
 * @returns {string|null} why a v1 engine request does not conform
 */
export function checkRequest(body) {
  const errors = check('decision-request', body);
  return errors.length ? errors.slice(0, 3).join('; ') : null;
}

/**
 * @param {object} body
 * @returns {string|null} why a decision-feedback body does not conform
 */
export function checkFeedback(body) {
  const errors = check('decision-feedback', body);
  return errors.length ? errors.slice(0, 3).join('; ') : null;
}

/**
 * @param {object} body
 * @returns {string|null} why a Delivery API request is not usable
 */
export function checkDeliveryRequest(body) {
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  if (!Array.isArray(body.prefetch?.mboxes) && !Array.isArray(body.notifications)) {
    return 'expected prefetch.mboxes or notifications';
  }
  return null;
}

/**
 * @param {object} options
 * @returns {import('node:http').Server}
 */
export function createMockServer({
  decisions = {}, target = {}, latency = 0, knob, ttl, cacheable, log = console.log,
} = {}) {
  const requests = [];
  const file = {
    ...decisions,
    ...(ttl !== undefined ? { ttl } : {}),
    ...(cacheable !== undefined ? { cacheable } : {}),
  };
  const send = (res, status, payload) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization, x-pzn-mock',
      'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
    });
    res.end(payload === '' ? '' : JSON.stringify(payload));
  };
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    if (req.method === 'OPTIONS') { send(res, 204, ''); return; }
    if (pathname === '/health') { send(res, 200, { ok: true }); return; }
    if (pathname === '/requests') {
      if (req.method === 'DELETE') requests.length = 0;
      send(res, 200, requests);
      return;
    }
    if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return; }
    if (![DECIDE_PATH, FEEDBACK_PATH, DELIVERY_PATH].includes(pathname)) { send(res, 404, { error: 'unknown path' }); return; }
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
      requests.push({ path: pathname, body });
      const requestKnob = parseKnob(req.headers['x-pzn-mock']) || knob || null;
      if (pathname === FEEDBACK_PATH) {
        const problem = checkFeedback(body);
        if (problem) { send(res, 400, { error: problem }); return; }
        log(`✓ feedback ${body.events.map((event) => `${event.decisionId} ${event.type}`).join(', ')}`);
        send(res, 204, '');
        return;
      }
      const problem = pathname === DELIVERY_PATH ? checkDeliveryRequest(body) : checkRequest(body);
      if (problem) {
        log(`⚠️ mock: rejected ${pathname} request: ${problem}`);
        send(res, 400, { error: problem });
        return;
      }
      if (latency) await new Promise((done) => { setTimeout(done, latency); });
      const answer = pathname === DELIVERY_PATH
        ? await targetAnswer(target, body, { clientCode: url.searchParams.get('client') || 'mock', knob: requestKnob })
        : await engineAnswer(file, body, { knob: requestKnob });
      if (pathname === DELIVERY_PATH) {
        const offers = answer.body.prefetch?.mboxes
          .map((mbox) => `${mbox.name}=${JSON.stringify(mbox.options?.[0]?.content ?? null)}`);
        log(`✓ target ${body.notifications ? `notifications ${body.notifications.map((n) => n.type)}` : `prefetch ${offers}`}`);
      } else {
        log(`✓ ${body.mode} ${body.page?.path} → ${JSON.stringify(answer.body.decisions ?? answer.body)}`);
      }
      send(res, answer.status, answer.body);
    });
  });
}

if (isMain(import.meta.url)) {
  exitOnHelp(USAGE);
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.port || 4100);
  const decisions = args.decisions ? readJson(resolve(args.decisions)) : {};
  const target = args.target ? readJson(resolve(args.target)) : {};
  [[args.decisions, decisions], [args.target, target]].forEach(([name, data]) => {
    if (name && !data) {
      console.error(`❌ could not read ${name}`);
      process.exit(2);
    }
  });
  const knob = typeof args.knob === 'string' ? parseKnob(args.knob) : null;
  if (args.knob && !knob) {
    console.error(`❌ unknown knob "${args.knob}"\n${USAGE}`);
    process.exit(2);
  }
  const server = createMockServer({
    decisions,
    target,
    latency: Number(args.latency || 0),
    knob,
    ttl: args.ttl !== undefined ? Number(args.ttl) : undefined,
    cacheable: args.cacheable ? true : undefined,
  });
  server.listen(port, () => {
    console.log(`✓ mock decision engine on http://localhost:${port}${DECIDE_PATH} (feedback ${FEEDBACK_PATH})`);
    console.log(`✓ mock Target Delivery API on http://localhost:${port}${DELIVERY_PATH}`);
    console.log('  for local tests only: point config.api.endpoint / config.target.endpoint at these URLs');
  });
}
