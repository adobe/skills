/*
 * The pilot baseline (contract pilot.md, pilot/scenarios.json, vendored as
 * assets/contract/pilot-scenarios.json) replayed through the skill's code:
 * - edge steps: the step's OF1 answer goes through the skill's edge
 *   (simulateEdge) over the pilot page; the section must carry exactly the
 *   step's attributes, and the events the browser builds from them
 *   (decisionFromAttributes -> eventPayload) must be the step's events;
 * - browser steps (promo, re-evaluation): the step's answer goes through the
 *   shared decision model (engineOutcome, identity, resultFor, eventPayload);
 * - consent withdrawal: the edge kept the authored hero in
 *   <template data-pzn-default>, and the withdrawal decision has the step's
 *   attributes.
 */

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { ASSETS_DIR, importAsset, readJson } from '../lib.mjs';
import { simulateEdge } from '../simulate.mjs';
import { check } from '../schema.mjs';
import { html, tempDir } from './helpers.mjs';

const { scenarios } = readJson(join(ASSETS_DIR, 'contract', 'pilot-scenarios.json'));
const { parseSection } = await importAsset('runtime', 'scripts', 'personalization', 'section-spec.js');
const { parseResponse } = await importAsset('runtime', 'scripts', 'personalization', 'contract.js');
const {
  decisionFromAttributes, decisionAttributes, engineOutcome, eventPayload, identity, makeDecision, resultFor,
} = await importAsset('runtime', 'scripts', 'personalization', 'outcomes.js');

const F = '/fragments/personalization';
const row = (key, value) => `<div><div><p>${key}</p></div><div>${value}</div></div>`;
const link = (path) => `<p><a href="${path}">${path}</a></p>`;
const HINT = 'Show the hero that best matches why the visitor came: a professional buyer looking for espresso performance, or a price-conscious buyer looking for a deal.';
const AUTHORED_HERO = '<h1>Espresso for every kitchen</h1><p>Our flagship range.</p><p><a href="/espresso">Shop espresso</a></p>';

// The pilot page (pilot.md, of1-worked-example.md section 1), as DA source.
// promo's first Rule row needs the device, so the edge leaves it to the
// browser (contract sections 2 and 8): the browser-decided pilot section.
const PAGE = `<html lang="en-US"><head><title>Espresso machines</title></head><body><header></header><main>
<div>${AUTHORED_HERO}<div class="section-metadata">
${row('Personalization', '<p>home-hero</p>')}
${row('Personalization Source', '<p>api</p>')}
${row('Personalization Variants', link(`${F}/home-hero/pro`) + link(`${F}/home-hero/deals`))}
${row('Personalization Hint', `<p>${HINT}</p>`)}
${row('Personalization Description Pro', '<p>Pro espresso machines: dual boilers, PID control, barista-grade results.</p>')}
${row('Personalization Description Default', '<p>Our flagship espresso machine range for every kitchen.</p>')}
${row('Personalization Rule Deals', '<p>param: utm_campaign=black-friday</p>')}
</div></div>
<div><h2>Why our machines</h2><p>Static content.</p></div>
<div><h2>Seasonal promo</h2><div class="section-metadata">
${row('Personalization', '<p>promo</p>')}
${row('Personalization Source', '<p>api</p>')}
${row('Personalization Variants', link(`${F}/promo/festive`))}
${row('Personalization Rule Festive', '<p>device: desktop</p>')}
</div></div>
</main><footer></footer></body></html>`;

const FRAGMENTS = {
  'home-hero/pro': '<div><h1>Pro espresso</h1><p>Dual boilers and PID control.</p><p><a href="/espresso">Shop espresso</a></p></div>',
  'home-hero/deals': '<div><h1>Black Friday deals</h1><p>Save on every machine this week.</p><p><a href="/espresso">Shop espresso</a></p></div>',
  'promo/festive': '<div><h2>Festive offer</h2><p><a href="/espresso">Shop</a></p></div>',
};

const repo = tempDir('pzn-pilot-');
Object.entries(FRAGMENTS).forEach(([name, text]) => {
  const file = join(repo.dir, 'content', `${F}/${name}.plain.html`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
});
after(repo.cleanup);

const HREF = 'https://www.example.com/espresso';
const isEdgeStep = (step) => step.attributes['data-pzn-where'] === 'edge';
// Decision attributes the edge writes: listed ones must match, unlisted ones
// must be absent. data-pzn-source, -fragment and -tracking are checked apart.
const DECISION_ATTRIBUTES = ['data-pzn-where', 'data-pzn-status', 'data-pzn-variant', 'data-pzn-outcome',
  'data-pzn-decision', 'data-pzn-reason', 'data-pzn-cached'];

async function edgeRun(context, answer) {
  const requests = [];
  const params = new URLSearchParams(context.params || {});
  const result = await simulateEdge(PAGE, {
    url: `https://www.example.com/${params.size ? `?${params}` : ''}`,
    country: context.geo?.country,
    region: context.geo?.region,
    referer: context.referrer ? `https://${context.referrer}/some/path?q=1` : undefined,
    consent: true,
    engineName: 'of1',
    repo: repo.dir,
    fetchImpl: async (url, init) => {
      requests.push(JSON.parse(init.body));
      return Response.json(answer);
    },
  });
  const section = (id) => {
    const found = html.findSections(result.html).find((candidate) => candidate.attributes
      .some(([name, value]) => name === 'data-personalization' && value === id));
    return found && {
      attrs: Object.fromEntries(found.attributes),
      attributes: found.attributes,
      inner: result.html.slice(found.openEnd, found.closeStart),
    };
  };
  return { ...result, requests, section };
}

// The events the browser builds for an edge-marked section (section 8).
function edgeEvents(found, expected) {
  const spec = parseSection(found.attributes);
  const { decision } = decisionFromAttributes(spec, (name) => found.attrs[`data-${name}`] ?? null);
  const applied = { ...decision, shown: decision.variant };
  applied.result = resultFor(applied, applied.shown, null);
  return expected.map(({ event }) => ({
    event,
    personalization: eventPayload(event, event === 'pzn:decided' ? decision : applied, { href: HREF }),
  }));
}

// A browser evaluation of an engine answer (sections 4, 5 and 9).
function browserDecision(spec, answer, { decisionId, trigger }) {
  const parsed = parseResponse(answer).decisions[spec.id];
  return makeDecision({
    id: spec.id, decisionId, source: 'api', where: 'browser', trigger, ...engineOutcome(spec, parsed),
  });
}

describe('pilot scenarios', () => {
  it('covers every scenario and step kind the skill replays', () => {
    assert.ok(scenarios.length >= 9);
    scenarios.forEach((scenario) => scenario.steps.forEach((step) => {
      assert.match(step.step, /^(page load|refresh\(\)|consent withdrawn)/, `${scenario.id}: ${step.step}`);
    }));
  });

  scenarios.forEach((scenario) => {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const { context } = scenario;
      let previous = null;
      let edge = null;
      for (const step of scenario.steps) {
        /* eslint-disable no-await-in-loop */
        const expectedId = step.attributes['data-pzn-decision'];
        const id = expectedId.split('#')[0];
        const label = `${scenario.id} / ${step.step}`;
        step.events.forEach((event) => assert.deepEqual(check('measurement-event', event), [], `${label}: ${event.event} is valid`));

        if (/^page load/.test(step.step) && isEdgeStep(step)) {
          edge = await edgeRun(context, step.answer);
          const found = edge.section(id);
          assert.ok(found, `${label}: section ${id}`);
          DECISION_ATTRIBUTES.forEach((name) => assert.equal(found.attrs[name], step.attributes[name], `${label}: ${name}`));
          const tracking = step.answer.decisions[id]?.tracking;
          assert.deepEqual(JSON.parse(found.attrs['data-pzn-tracking']), tracking, `${label}: data-pzn-tracking`);
          const decided = step.events.find((event) => event.event === 'pzn:decided');
          assert.equal(found.attrs['data-pzn-source'], decided.personalization.source, `${label}: data-pzn-source`);
          // Applied at the edge: the shown content is in the HTML, the
          // authored hero in the template.
          const variant = step.attributes['data-pzn-variant'];
          const content = variant === 'default' ? AUTHORED_HERO : FRAGMENTS[`${id}/${variant}`].replace(/^<div>|<\/div>$/g, '');
          assert.ok(found.inner.startsWith(content), `${label}: shows ${variant}`);
          if (variant !== 'default') assert.ok(found.inner.endsWith(`<template data-pzn-default>${AUTHORED_HERO}</template>`), `${label}: default kept`);
          assert.equal(edge.headers['cache-control'], 'private, no-cache');
          assert.equal(edge.headers['x-pzn'], 'edge');
          assert.deepEqual(edgeEvents(found, step.events), step.events, `${label}: events`);
          // promo is left to the browser.
          assert.equal(edge.section('promo').attrs['data-pzn-where'], undefined, `${label}: promo left`);
          previous = { attrs: found.attrs, spec: parseSection(found.attributes) };
        } else if (/^page load/.test(step.step)) {
          // A browser-decided section: the edge leaves it and never asks the
          // engine about it (section 4).
          edge = await edgeRun(context, step.answer);
          const found = edge.section(id);
          assert.equal(found.attrs['data-pzn-where'], undefined, `${label}: left to the browser`);
          assert.ok(edge.requests.every((body) => body.placeholders.every((entry) => entry.id !== id)), `${label}: not sent to the engine at the edge`);
          const spec = parseSection(found.attributes);
          const decision = browserDecision(spec, step.answer, { decisionId: `${id}#1`, trigger: 'initial' });
          const applied = { ...decision, shown: decision.variant, result: resultFor(decision, decision.variant, null) };
          Object.entries(decisionAttributes(applied, 'applied'))
            .filter(([name]) => step.attributes[`data-${name}`] !== undefined)
            .forEach(([name, value]) => assert.equal(value, step.attributes[`data-${name}`], `${label}: data-${name}`));
          assert.deepEqual(step.events.map(({ event }) => ({
            event, personalization: eventPayload(event, event === 'pzn:decided' ? decision : applied, { href: HREF }),
          })), step.events, `${label}: events`);
          previous = { spec, decision: applied, answer: step.answer };
        } else if (/^refresh\(\)/.test(step.step)) {
          const { spec, decision: before } = previous;
          const next = browserDecision(spec, step.answer, { decisionId: before.decisionId, trigger: 'refresh' });
          const same = identity(next) === identity(before);
          const decisionId = same ? before.decisionId : `${id}#${Number(before.decisionId.split('#')[1]) + 1}`;
          assert.equal(decisionId, expectedId, `${label}: decisionId`);
          if (same) {
            assert.deepEqual(step.events, [], `${label}: the same decision sends nothing`);
          } else {
            const decision = { ...next, decisionId };
            const applied = { ...decision, shown: decision.variant, result: resultFor(decision, decision.variant, before.shown) };
            assert.deepEqual(step.events.map(({ event }) => ({
              event, personalization: eventPayload(event, event === 'pzn:decided' ? decision : applied, { href: HREF }),
            })), step.events, `${label}: events`);
            previous = { spec, decision: applied };
          }
        } else if (/^consent withdrawn/.test(step.step)) {
          // The browser restores the edge default and makes a new decision.
          const found = edge.section(id);
          assert.ok(found.inner.endsWith(`<template data-pzn-default>${AUTHORED_HERO}</template>`), `${label}: the edge kept the default`);
          const withdrawn = makeDecision({
            id,
            decisionId: `${id}#${Number(previous.attrs['data-pzn-decision'].split('#')[1]) + 1}`,
            source: previous.attrs['data-pzn-source'],
            where: 'edge',
            outcome: 'no-consent',
            variant: 'default',
            trigger: 'consent',
          });
          const attrs = decisionAttributes(withdrawn, 'applied');
          DECISION_ATTRIBUTES.forEach((name) => assert.equal(attrs[name.slice(5)], step.attributes[name], `${label}: ${name}`));
          assert.equal(withdrawn.assigned, undefined, `${label}: nothing assigned`);
          assert.deepEqual(step.events, [], `${label}: nothing sent without consent`);
        }
        /* eslint-enable no-await-in-loop */
      }
    });
  });

  it('sends OF1 the worked-example request: hint, descriptions (rows win, the rest filled), referrer host, title', async () => {
    const [scenario] = scenarios;
    const { requests } = await edgeRun(scenario.context, scenario.steps[0].answer);
    assert.equal(requests.length, 1, 'one engine call per page');
    const [body] = requests;
    assert.deepEqual(check('decision-request', body), []);
    assert.equal(body.mode, 'edge');
    assert.deepEqual(body.page, { path: '/', locale: 'en-US', title: 'Espresso machines' });
    assert.deepEqual(body.placeholders, [{
      id: 'home-hero',
      candidates: ['pro', 'deals', 'default'],
      fragments: { pro: `${F}/home-hero/pro`, deals: `${F}/home-hero/deals` },
      hint: HINT,
      descriptions: {
        pro: 'Pro espresso machines: dual boilers, PID control, barista-grade results.',
        default: 'Our flagship espresso machine range for every kitchen.',
        deals: 'Black Friday deals Save on every machine this week. Shop espresso',
      },
    }]);
    assert.deepEqual(body.context.geo, { country: 'US', region: 'CA' });
    assert.equal(body.context.referrer, 'espresso-forum.example', 'host only, never path or query');
    assert.deepEqual(body.context.params, { utm_source: 'espresso-forum' });
    assert.deepEqual(body.context.consent, { personalization: true });
    assert.equal(body.context.device, undefined, 'the edge does not know the device');
  });
});
