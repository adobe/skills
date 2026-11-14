/* eslint-disable no-console */
/*
 * Mock decision engine (v1, contract section 5) and Adobe Target Delivery
 * API (section 7), driven by tables in the authoring grammar. Shared by the
 * in-browser mocks (mocks.js, config.mock) and the skill's local mock server
 * (scripts/mock-decision-api.mjs), so a demo on aem.page and a local test
 * decide alike. Pure ES module. Tests and demos only.
 *
 * Engine table (decisions.json):
 *   { "ttl": 0, "cacheable": false, "placeholders": {
 *       "plan-offer": {
 *         "param: utm_campaign=enterprise": "enterprise",
 *         "device: mobile": { "control": true },
 *         "visitor: returning": "default",
 *         "*": { "reason": "low_confidence" } } } }
 * Conditions are checked in order against the request context; the value
 * is a variant name ("default" for the intentional default) or a v1
 * decision object. A section with no match is left out of the answer
 * (no-match). Every answer carries tracking { engine, rule, requestId }.
 *
 * Target table: location -> activity; experiences are checked in order and
 * the first whose audience matches wins:
 *   { "scroll-offer": { "name": "Scroll offer (A/B)", "experiences": [
 *       { "name": "Control", "audience": "visitor: returning", "control": true },
 *       { "name": "Everyone", "audience": null, "offer": "/fragments/..." } ] } }
 * Audiences see the location parameters (device, visitor) and the page's
 * URL params.
 *
 * Knobs (one per request): fail (HTTP 500), invalid (not a v1 response),
 * missing (no answer for any section), control, default, reason:<code>,
 * variant:<name>.
 */

import { parseCondition, evaluate } from './rules.js';

let counter = 0;
const token = () => {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
};

/**
 * @param {string|null|undefined} value `fail`, `reason:low_confidence`, ...
 * @returns {{kind: string, value?: string}|null}
 */
export function parseKnob(value) {
  if (!value || typeof value !== 'string') return null;
  const [kind, ...rest] = value.trim().split(':');
  if (!['fail', 'invalid', 'missing', 'control', 'default', 'reason', 'variant'].includes(kind)) return null;
  return rest.length ? { kind, value: rest.join(':') } : { kind };
}

async function matches(condition, context, label) {
  if (!condition || condition === '*') return true;
  try {
    return await evaluate(parseCondition(condition), context, {});
  } catch (e) {
    console.warn(`⚠️ mock: bad condition "${condition}" for ${label}: ${e.message}`);
    return false;
  }
}

function toDecision(value) {
  if (typeof value === 'string') return { variant: value };
  return value && typeof value === 'object' ? { ...value } : undefined;
}

function knobDecision(knob) {
  if (knob.kind === 'control') return { control: true };
  if (knob.kind === 'default') return { variant: 'default' };
  if (knob.kind === 'reason') return { reason: knob.value || 'no_match' };
  if (knob.kind === 'variant') return { variant: knob.value || 'default' };
  return undefined;
}

/**
 * Decides like an engine configured with the given table.
 * @param {object} file engine table
 * @param {object} body v1 request body
 * @param {{knob?: object|null}} [options]
 * @returns {Promise<{status: number, body: unknown}>} HTTP status and JSON body
 */
export async function engineAnswer(file, body, { knob = null } = {}) {
  if (knob?.kind === 'fail') return { status: 500, body: { error: 'mock failure' } };
  if (knob?.kind === 'invalid') return { status: 200, body: { answers: 'not a v1 response' } };
  const table = file?.placeholders || {};
  const context = body?.context || {};
  const requestId = token();
  const decisions = {};
  await Promise.all((body?.placeholders || []).map(async ({ id }) => {
    if (knob?.kind === 'missing') return;
    if (knob) {
      decisions[id] = { ...knobDecision(knob), tracking: { engine: 'mock', rule: `knob ${knob.kind}`, requestId } };
      return;
    }
    const entries = Object.entries(table[id] || {});
    const outcomes = await Promise.all(
      entries.map(([condition]) => matches(condition, context, id)),
    );
    const index = outcomes.indexOf(true);
    const decision = index === -1 ? undefined : toDecision(entries[index][1]);
    if (decision) {
      decisions[id] = {
        ...decision,
        tracking: {
          engine: 'mock', rule: entries[index][0], requestId, ...(decision.tracking || {}),
        },
      };
    }
  }));
  return {
    status: 200,
    body: { decisions, ttl: file?.ttl ?? 300, cacheable: file?.cacheable ?? false },
  };
}

/**
 * The v1 response body of engineAnswer (tables without knobs).
 * @param {object} file
 * @param {object} body
 * @returns {Promise<object>}
 */
export async function engineDecide(file, body) {
  return (await engineAnswer(file, body)).body;
}

function offerContent(experience) {
  if (experience.control === true) return { control: true };
  if (experience.content && typeof experience.content === 'object') return experience.content;
  return { fragment: experience.offer };
}

async function prefetchMbox(activities, mbox, params, knob) {
  const activity = activities?.[mbox.name];
  const empty = { index: mbox.index, name: mbox.name };
  if (!activity || knob?.kind === 'missing') return empty;
  const parameters = mbox.parameters || {};
  const context = {
    params: { ...params, ...parameters }, device: parameters.device, visitor: parameters.visitor,
  };
  const experiences = activity.experiences || [];
  const outcomes = await Promise.all(
    experiences.map((experience) => matches(experience.audience, context, mbox.name)),
  );
  const index = outcomes.indexOf(true);
  if (index === -1) return empty;
  const experience = knob?.kind === 'control' ? { name: 'Control (knob)', control: true } : experiences[index];
  const content = offerContent(experience);
  return {
    ...empty,
    options: [{
      type: 'json',
      content,
      eventToken: token(),
      responseTokens: {
        'activity.id': String(activity.id ?? Object.keys(activities).indexOf(mbox.name) + 1),
        'activity.name': activity.name || mbox.name,
        'experience.id': String(index),
        'experience.name': experience.name || `Experience ${index + 1}`,
        'offer.name': content.fragment ? String(content.fragment).split('/').pop() : 'control',
        'profile.tier': 'mock',
      },
    }],
    metrics: [{ type: 'click', eventToken: token() }],
  };
}

/**
 * Answers a Target Delivery API request: prefetch or notifications.
 * @param {object} activities Target table
 * @param {object} body Delivery API request
 * @param {{clientCode?: string, knob?: object|null}} [options]
 * @returns {Promise<{status: number, body: object}>}
 */
export async function targetAnswer(activities, body, { clientCode = 'mock', knob = null } = {}) {
  if (knob?.kind === 'fail') return { status: 500, body: { error: 'mock failure' } };
  const response = {
    status: 200,
    requestId: body?.requestId,
    client: clientCode,
    id: { tntId: body?.id?.tntId || `${token()}.37_0` },
    edgeHost: 'mboxedge37.tt.omtrdc.net',
  };
  if (Array.isArray(body?.notifications)) {
    const notifications = body.notifications.map(({ id }) => ({ id }));
    return { status: 200, body: { ...response, notifications } };
  }
  let params = {};
  try {
    params = Object.fromEntries(new URL(body?.context?.address?.url).searchParams);
  } catch (e) {
    // no page URL: audiences see the location parameters only
  }
  const mboxes = await Promise.all((body?.prefetch?.mboxes || [])
    .map((mbox) => prefetchMbox(activities, mbox, params, knob)));
  return { status: 200, body: { ...response, prefetch: { mboxes } } };
}

/**
 * The Delivery API response body of targetAnswer (tables without knobs).
 * @param {object} activities
 * @param {object} body
 * @param {{clientCode?: string}} [options]
 * @returns {Promise<object>}
 */
export async function targetDeliver(activities, body, options = {}) {
  return (await targetAnswer(activities, body, options)).body;
}

/**
 * @param {string} hostname
 * @param {string} pathname
 * @returns {boolean} true for a Target Delivery API URL
 */
export function isDeliveryUrl(hostname, pathname) {
  return /(^|\.)tt\.omtrdc\.net$/.test(hostname) && pathname === '/rest/v1/delivery';
}
