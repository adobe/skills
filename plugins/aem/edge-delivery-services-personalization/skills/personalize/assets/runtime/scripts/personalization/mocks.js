/* eslint-disable no-console */
/*
 * In-browser mocks of the decision engine and the Target Delivery API, used
 * when config.mock is set (tests and demos only; false at launch): demos then
 * work on aem.page, where a local mock server can't be reached. mockFetch has
 * the signature of window.fetch, so the real transports still run (request
 * building, timeouts, contract validation); only the network hop is
 * simulated. Tables: config.mock.api and config.mock.target (mock-engine.js).
 *
 * Preview knobs (preview hosts only, like the other pzn- overrides):
 *   ?pzn-mock-latency=3000   delay every answer (ms; default 250)
 *   ?pzn-mock=fail | invalid | missing | control | default | reason:<code> | variant:<name>
 * Test hooks on window.hlx.personalizationMock: `next = '<knob>'` applies to
 * the next request only; `respond = { engine, target }` answers with
 * { status, body, delay } as given (verify-preview --refresh, --scenarios).
 * Requests answered: `requests`.
 */

import config from './config.js';
import { overridesEnabled } from './context.js';
import {
  engineAnswer, targetAnswer, isDeliveryUrl, parseKnob,
} from './mock-engine.js';

const search = new URLSearchParams(window.location.search);
const knobs = overridesEnabled(config.overrides, window.location.hostname)
  ? search
  : new URLSearchParams();
const tables = typeof config.mock === 'object' && config.mock ? config.mock : {};

export const requests = [];
const hooks = { requests, next: null, respond: null };

// Like the network, an aborted request fails at once (engine and Target timeouts).
const wait = (ms, signal) => new Promise((resolve, reject) => {
  const abort = () => reject(new DOMException('aborted', 'AbortError'));
  if (signal?.aborted) {
    abort();
    return;
  }
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    abort();
  }, { once: true });
});
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

function latency() {
  const value = Number(knobs.get('pzn-mock-latency'));
  return Number.isFinite(value) && knobs.has('pzn-mock-latency') ? value : 250;
}

/**
 * Answers the decision engine endpoint and the Target Delivery API.
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<Response>}
 */
export default async function mockFetch(url, init = {}) {
  const { pathname, hostname, href } = new URL(url, window.location.href);
  const body = JSON.parse(init.body || '{}');
  const knob = parseKnob(hooks.next) || parseKnob(knobs.get('pzn-mock'));
  hooks.next = null;
  const entry = { url: href, body, knob: knob?.kind };
  requests.push(entry);
  await wait(latency(), init.signal);
  const apiPath = config.api?.endpoint
    && new URL(config.api.endpoint, window.location.href).pathname;
  let answer;
  const scripted = (kind) => {
    const given = hooks.respond?.[kind];
    return given ? { status: given.status || 200, body: given.body ?? {} } : null;
  };
  if (pathname === apiPath) {
    if (hooks.respond?.engine?.delay) await wait(hooks.respond.engine.delay, init.signal);
    answer = scripted('engine') || await engineAnswer(tables.api, body, { knob });
    console.info('🧠 decision engine (mock):', body, '→', answer.body);
  } else if (isDeliveryUrl(hostname, pathname) || (config.target?.endpoint
    && pathname === new URL(config.target.endpoint, window.location.href).pathname)) {
    const clientCode = config.target?.clientCode;
    if (hooks.respond?.target?.delay) await wait(hooks.respond.target.delay, init.signal);
    answer = scripted('target') || await targetAnswer(tables.target, body, { clientCode, knob });
    console.info(`🎯 Target (mock): ${body.notifications ? 'notifications' : 'prefetch'}`, body, '→', answer.body);
  } else {
    entry.status = 404;
    return json({ error: `no mock for ${href}` }, 404);
  }
  entry.status = answer.status;
  entry.answer = answer.body;
  return json(answer.body, answer.status);
}

window.hlx = window.hlx || {};
window.hlx.personalizationMock = hooks;
