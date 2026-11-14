/*
 * The decision model (contract sections 4, 8 and 9): outcomes.js. Every
 * event payload built here is checked against measurement-event.schema.json
 * and the event semantics.
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { RUNTIME_DIR } from '../lib.mjs';
import { check } from '../schema.mjs';
import { sectionSpec } from './helpers.mjs';

const {
  OUTCOMES, assignedFor, engineOutcome, targetOutcome, splitOutcome, rulesOutcome, identity,
  makeDecision, resultFor, eventPayload, rumCheckpoint, trackingAttribute, decisionAttributes,
  decisionFromAttributes, TRACKING_MAX_BYTES,
} = await import(pathToFileURL(join(RUNTIME_DIR, 'scripts', 'personalization', 'outcomes.js')).href);

const F = '/fragments/personalization/home-hero';
const api = sectionSpec({
  '': 'home-hero', source: 'api', variants: `${F}/pro,${F}/deals`, 'rule-deals': 'param: utm_campaign=deals',
});
const split = sectionSpec({
  '': 'hero-message', source: 'split', variants: '/fragments/m/speed,/fragments/m/price', split: '40, 30',
});
const target = sectionSpec({ '': 'plan-offer', source: 'target', variants: '/fragments/p/trial' });

const EVENTS = ['pzn:decided', 'pzn:applied', 'pzn:seen', 'pzn:clicked'];

// A decision through application, as the runtime does it.
function decided(fields, shown = fields.variant, before = null) {
  const decision = makeDecision({
    id: 'home-hero', decisionId: 'home-hero#1', where: 'browser', trigger: 'initial', ...fields,
  });
  return Object.assign(decision, { shown, result: resultFor(decision, shown, before) });
}

// Payloads of every event for a decision, each checked against the contract.
function payloads(decision) {
  return EVENTS.map((event) => {
    const personalization = eventPayload(event, decision, event === 'pzn:clicked' ? { href: 'https://www.example.com/espresso' } : {});
    assert.deepEqual(check('measurement-event', { event, personalization }), [], `${event} ${decision.outcome}`);
    return personalization;
  });
}

describe('engine answers (section 5)', () => {
  const tracking = { engine: 'of1', requestId: 'r-91', confidence: 0.82 };

  it('maps the four answer kinds', () => {
    assert.deepEqual(engineOutcome(api, { variant: 'pro', tracking }), {
      outcome: 'variant', variant: 'pro', path: `${F}/pro`, tracking,
    });
    assert.deepEqual(engineOutcome(api, { fragment: `${F}/deals` }), { outcome: 'variant', variant: 'deals', path: `${F}/deals` });
    assert.deepEqual(engineOutcome(api, { variant: 'default' }), { outcome: 'intentional-default', variant: 'default' });
    assert.deepEqual(engineOutcome(api, { control: true }), { outcome: 'control', variant: 'default' });
    assert.deepEqual(engineOutcome(api, { reason: 'low_confidence', tracking }), {
      outcome: 'low-confidence', variant: 'default', reason: 'low_confidence', tracking,
    });
  });

  it('maps reason codes, a missing section and unlisted answers', () => {
    assert.equal(engineOutcome(api, { reason: 'no_candidate' }).outcome, 'no-match');
    assert.equal(engineOutcome(api, { reason: 'anything_else' }).outcome, 'no-match');
    assert.equal(engineOutcome(api, { reason: 'provider_error' }).outcome, 'fallback');
    assert.equal(engineOutcome(api, { reason: 'invalid_choice' }).outcome, 'fallback');
    assert.deepEqual(engineOutcome(api, undefined), { outcome: 'no-match', variant: 'default', reason: 'no decision' });
    assert.deepEqual(engineOutcome(api, { variant: 'mars' }), { outcome: 'fallback', variant: 'default', reason: 'not listed: mars' });
    assert.deepEqual(engineOutcome(api, { fragment: '/fragments/other/x' }), {
      outcome: 'fallback', variant: 'default', reason: 'not listed: /fragments/other/x',
    });
    assert.equal(engineOutcome(api, { invalid: 'variant and reason', tracking }).outcome, 'fallback');
    assert.deepEqual(engineOutcome(api, { invalid: 'x', tracking }).tracking, tracking);
  });

  it('marks answers from the engine\'s own cache as cached', () => {
    const cached = { ...tracking, cached: true };
    assert.equal(engineOutcome(api, { variant: 'pro', tracking: cached }).cached, true);
    assert.equal(engineOutcome(api, { control: true, tracking: cached }).cached, true);
    assert.equal(engineOutcome(api, { variant: 'pro', tracking: { cached: false } }).cached, undefined);
  });
});

describe('Target and split answers (sections 6 and 7)', () => {
  it('maps Target offers, control and nothing returned, keeping the tokens', () => {
    const tokens = { display: ['t1'], click: ['c1'] };
    assert.deepEqual(targetOutcome(target, { fragment: '/fragments/p/trial', tokens }), {
      outcome: 'variant', variant: 'trial', path: '/fragments/p/trial', tokens,
    });
    assert.deepEqual(targetOutcome(target, { control: true, tokens }), { outcome: 'control', variant: 'default', tokens });
    assert.deepEqual(targetOutcome(target, undefined), { outcome: 'no-match', variant: 'default', reason: 'no offer' });
    assert.equal(targetOutcome(target, { fragment: '/fragments/p/other' }).outcome, 'fallback');
    assert.equal(targetOutcome(target, { invalid: 'offer type html' }).reason, 'offer type html');
  });

  it('maps split arms: the default arm is control, with the test', () => {
    assert.deepEqual(splitOutcome(split, 'speed'), {
      outcome: 'variant', variant: 'speed', path: '/fragments/m/speed', test: { type: 'split', weights: [40, 30] },
    });
    assert.deepEqual(splitOutcome(split, 'default'), { outcome: 'control', variant: 'default', test: { type: 'split', weights: [40, 30] } });
    const even = sectionSpec({ '': 'm', source: 'split', variants: '/fragments/m/a' });
    assert.deepEqual(splitOutcome(even, 'default').test, { type: 'split', weights: 'even' });
  });

  it('maps Rule rows', () => {
    assert.deepEqual(rulesOutcome({ variant: { name: 'deals', path: `${F}/deals` }, rule: 'geo: IN' }), {
      outcome: 'variant', variant: 'deals', path: `${F}/deals`, rule: 'geo: IN',
    });
    assert.deepEqual(rulesOutcome({ none: true }), { outcome: 'no-match', variant: 'default' });
  });
});

describe('assigned (section 9)', () => {
  it('is the source\'s choice, absent when nothing was assigned', () => {
    assert.equal(assignedFor('variant', 'pro'), 'pro');
    assert.equal(assignedFor('override', 'pro'), 'pro');
    assert.equal(assignedFor('control', 'default'), 'default');
    assert.equal(assignedFor('intentional-default', 'default'), 'default');
    // Rule rows chose after the engine gave no usable answer.
    assert.equal(assignedFor('low-confidence', 'deals'), 'deals');
    assert.equal(assignedFor('low-confidence', 'default'), undefined);
    assert.equal(assignedFor('no-match', 'default'), undefined);
    ['no-consent', 'bot', 'timeout', 'error', 'invalid'].forEach((outcome) => assert.equal(assignedFor(outcome, 'default'), undefined, outcome));
  });
});

describe('decisions, results and events', () => {
  it('a variant applied: every event valid, assigned = variant', () => {
    const decision = decided({
      source: 'api', outcome: 'variant', variant: 'pro', path: `${F}/pro`, tracking: { engine: 'of1', requestId: 'r-91' },
    });
    assert.equal(decision.result, 'applied');
    const [d, a, seen, clicked] = payloads(decision);
    assert.deepEqual(d, {
      id: 'home-hero',
      decisionId: 'home-hero#1',
      variant: 'pro',
      assigned: 'pro',
      source: 'api',
      where: 'browser',
      outcome: 'variant',
      trigger: 'initial',
      tracking: { engine: 'of1', requestId: 'r-91' },
    });
    assert.equal(a.result, 'applied');
    assert.equal(a.tracking, undefined, 'tracking travels on decided and seen');
    assert.deepEqual(seen.tracking, { engine: 'of1', requestId: 'r-91' });
    assert.equal(clicked.href, 'https://www.example.com/espresso');
  });

  it('a failed treatment stays assigned: variant default, result failed', () => {
    const decision = decided({
      source: 'api', outcome: 'variant', variant: 'pro', path: `${F}/pro`,
    }, 'default');
    assert.equal(decision.result, 'failed');
    const [d, a] = payloads(decision);
    assert.equal(d.variant, 'pro', 'decided says what was chosen');
    assert.deepEqual([a.variant, a.assigned, a.result], ['default', 'pro', 'failed']);
  });

  it('control and intentional-default keep the default and stay distinct', () => {
    const control = decided({ source: 'split', outcome: 'control', variant: 'default', test: { type: 'split', weights: 'even' } });
    assert.equal(control.result, 'kept-default');
    assert.deepEqual(payloads(control).map((p) => p.test), Array(4).fill({ type: 'split', weights: 'even' }));
    const best = decided({ source: 'api', outcome: 'intentional-default', variant: 'default' });
    assert.deepEqual([best.assigned, best.result], ['default', 'kept-default']);
    payloads(best);
  });

  it('no-consent, timeout and fallbacks are never an arm', () => {
    ['no-consent', 'timeout', 'error', 'bot', 'no-match', 'fallback'].forEach((outcome) => {
      const decision = decided({
        source: outcome === 'bot' ? 'bot' : 'api', outcome, variant: 'default', reason: outcome === 'timeout' ? 'budget 800 ms' : undefined,
      });
      assert.equal(decision.assigned, undefined, outcome);
      assert.equal(decision.result, 'kept-default', outcome);
      payloads(decision);
    });
    const ruled = decided({
      source: 'rules', outcome: 'low-confidence', reason: 'low_confidence', variant: 'deals', path: `${F}/deals`,
    });
    assert.deepEqual([ruled.assigned, ruled.result], ['deals', 'applied']);
    payloads(ruled);
  });

  it('a re-evaluation showing the same variant is unchanged; cached only on decided', () => {
    const decision = decided({
      decisionId: 'home-hero#2', source: 'api', outcome: 'variant', variant: 'pro', path: `${F}/pro`, cached: true, trigger: 'refresh',
    }, 'pro', 'pro');
    assert.equal(decision.result, 'unchanged');
    const [d, a, seen] = payloads(decision);
    assert.deepEqual([d.decisionId, d.trigger, d.cached], ['home-hero#2', 'refresh', true]);
    assert.equal(a.cached, undefined);
    assert.equal(seen.cached, undefined);
    assert.equal(seen.result, 'unchanged');
  });

  it('makeDecision drops empty fields', () => {
    assert.deepEqual(makeDecision({
      id: 'x', decisionId: 'x#1', outcome: 'no-match', variant: 'default', reason: '', cached: false, tracking: undefined, assigned: 'y',
    }), {
      id: 'x', decisionId: 'x#1', outcome: 'no-match', variant: 'default',
    });
  });

  it('notified carries the notification only', () => {
    const decision = decided({
      id: 'plan-offer', decisionId: 'plan-offer#1', source: 'target', outcome: 'variant', variant: 'trial', path: '/fragments/p/trial', test: { type: 'target' },
    });
    const personalization = eventPayload('pzn:notified', decision, { notification: { product: 'target', type: 'display', ok: true } });
    assert.deepEqual(check('measurement-event', { event: 'pzn:notified', personalization }), []);
    assert.deepEqual(personalization.notification, { product: 'target', type: 'display', ok: true });
  });
});

describe('decision identity (section 9)', () => {
  const base = {
    source: 'api', outcome: 'variant', variant: 'pro', assigned: 'pro', tracking: { requestId: 'r1', model: 'm' },
  };

  it('is equal only when source, assigned, outcome, reason, cached, tracking, test and tokens are', () => {
    assert.equal(identity(base), identity({ ...base, tracking: { model: 'm', requestId: 'r1' } }), 'key order does not matter');
    assert.equal(identity(base), identity({ ...base, decisionId: 'x#9', trigger: 'refresh', ms: 12 }));
    [
      { tracking: { requestId: 'r2', model: 'm' } },
      { cached: true },
      { reason: 'x' },
      { outcome: 'override' },
      { source: 'rules' },
      { tokens: { display: ['t'] } },
      { test: { type: 'target' } },
      { variant: 'deals', assigned: 'deals' },
    ].forEach((change) => assert.notEqual(identity(base), identity({ ...base, ...change }), JSON.stringify(change)));
  });
});

describe('RUM checkpoint (section 9)', () => {
  const rum = (spec, fields, shown) => rumCheckpoint(spec, decided({ id: spec.id, ...fields }, shown));

  it('split: experiment for variant and control arms applied', () => {
    assert.deepEqual(rum(split, { source: 'split', outcome: 'variant', variant: 'speed', path: '/fragments/m/speed' }), ['experiment', { source: 'hero-message', target: 'speed' }]);
    assert.deepEqual(rum(split, { source: 'split', outcome: 'control', variant: 'default' }), ['experiment', { source: 'hero-message', target: 'default' }]);
  });

  it('others: audience for variant and intentional-default; nothing for failures and fallbacks', () => {
    assert.deepEqual(rum(api, { source: 'api', outcome: 'variant', variant: 'pro', path: `${F}/pro` }), ['audience', { source: 'home-hero', target: 'pro' }]);
    assert.deepEqual(rum(api, { source: 'api', outcome: 'intentional-default', variant: 'default' }), ['audience', { source: 'home-hero', target: 'default' }]);
    assert.equal(rum(api, { source: 'api', outcome: 'control', variant: 'default' }), null);
    assert.equal(rum(api, { source: 'api', outcome: 'variant', variant: 'pro', path: `${F}/pro` }, 'default'), null, 'failed');
    assert.equal(rum(api, {
      source: 'rules', outcome: 'low-confidence', variant: 'deals', path: `${F}/deals`,
    }), null);
    assert.equal(rum(api, { source: 'api', outcome: 'no-consent', variant: 'default' }), null);
  });
});

describe('edge handoff attributes (section 8)', () => {
  it('writes and reads back an edge decision', () => {
    const decision = makeDecision({
      id: 'home-hero',
      decisionId: 'home-hero#1',
      source: 'api',
      where: 'edge',
      outcome: 'variant',
      variant: 'pro',
      path: `${F}/pro`,
      cached: true,
      tracking: { engine: 'of1', requestId: 'r-91', cached: true },
      trigger: 'initial',
    });
    const attributes = decisionAttributes(decision, 'applied', { tracking: true });
    assert.deepEqual(attributes, {
      'pzn-where': 'edge',
      'pzn-status': 'applied',
      'pzn-variant': 'pro',
      'pzn-source': 'api',
      'pzn-outcome': 'variant',
      'pzn-decision': 'home-hero#1',
      'pzn-cached': 'true',
      'pzn-fragment': `${F}/pro`,
      'pzn-tracking': JSON.stringify(decision.tracking),
    });
    assert.equal(decisionAttributes(decision, 'applied')['pzn-tracking'], undefined, 'the browser does not write tracking');
    const read = decisionFromAttributes(api, (name) => attributes[name] ?? null);
    assert.equal(read.status, 'applied');
    assert.equal(read.unlisted, false);
    assert.deepEqual(read.decision, decision);
  });

  it('ignores sections not marked by the edge, and never shows an unlisted edge variant', () => {
    assert.equal(decisionFromAttributes(api, () => null), null);
    const get = (values) => (name) => values[name] ?? null;
    assert.equal(decisionFromAttributes(api, get({ 'pzn-where': 'edge', 'pzn-status': 'left' })), null);
    const unlisted = decisionFromAttributes(api, get({
      'pzn-where': 'edge', 'pzn-status': 'selected', 'pzn-variant': 'mars', 'pzn-outcome': 'variant', 'pzn-decision': 'bad',
    }));
    assert.equal(unlisted.unlisted, true);
    assert.equal(unlisted.decision.variant, 'default');
    assert.equal(unlisted.decision.decisionId, 'home-hero#1', 'a malformed decisionId becomes <id>#1');
    assert.ok(OUTCOMES.includes(unlisted.decision.outcome));
  });

  it('keeps tracking only up to 1 KB', () => {
    assert.equal(trackingAttribute({ a: 'x'.repeat(TRACKING_MAX_BYTES) }), null);
    assert.equal(trackingAttribute({ a: 1 }), '{"a":1}');
    assert.equal(trackingAttribute('x'), null);
  });
});
