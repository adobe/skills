#!/usr/bin/env node
/*
 * Expected outcomes (contract section 11): runs the runtime's own decision
 * modules over a case matrix and prints, per personalized section and case,
 * the expected decision (variant shown, outcome, source, assigned, result)
 * and the preview URL query that reproduces it. verify-preview.mjs checks
 * the browser against the same cases.
 *
 * Cases per section: no consent, a bot, consent with no context, one per
 * rule (and per engine-table or Target-audience condition), engine answers
 * and faults for api (control, default, low_confidence, provider_error,
 * an unlisted variant, missing, HTTP 500, invalid JSON, slow), Target
 * faults for target (control, nothing returned, HTTP 500), and one ?pzn=
 * override per variant and for the default. The consent policy
 * (config.consent.withoutConsent) decides the no-consent cases.
 *
 * Usage:
 *   node simulate.mjs <content/page.html> [--matrix contexts.json]
 *     [--api-decisions decisions.json] [--target activities.json]
 *     [--without-consent rules,api] [--engine of1] [--page-url URL] [--json]
 *   node simulate.mjs <page.html | URL> --edge [--consent] [--country IN] [--region KA]
 *     [--cookie "pzn-seen=1"] [--ua "Googlebot"] [--api-decisions decisions.json]
 *     [--fault fail] [--api-endpoint URL] [--repo .] [--json]
 *
 * contexts.json: [{ "name": "india mobile", "consent": true, "geo": "IN",
 *   "device": "mobile", "visitor": "returning", "params": {"utm_campaign": "x"},
 *   "state": {"k": "v"}, "audiences": ["vip"], "fault": "reason:low_confidence" }]
 *   ("bot": true expects the default). decisions.json / activities.json: the
 *   mock engine and Target tables (mock-engine.js). Without them, cases the
 *   engine or Target decides are listed with expected "unknown".
 */

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EDGE_DIR, RUNTIME_DIR, SHARED_WITH_EDGE, exitOnHelp, importAsset, isMain, parseArgs, readJson,
  readText, sitePrefixes,
} from './lib.mjs';
import { readSiteConfig } from './validate-placeholders.mjs';

export const USAGE = `Usage:
  node simulate.mjs <content/page.html> [--matrix contexts.json]
    [--api-decisions decisions.json] [--target activities.json]
    [--without-consent rules,api] [--engine of1] [--page-url URL] [--json]
  node simulate.mjs <content/page.html | URL> --edge [--consent] [--country IN]
    [--region KA] [--cookie "pzn-seen=1"] [--ua "Googlebot"]
    [--api-decisions decisions.json] [--fault fail] [--api-endpoint URL] [--repo .] [--json]
Expected outcomes: runs the runtime's decision code over a case matrix and
prints, per personalized section and case, the expected variant, outcome,
source, assigned and result, and the preview query that reproduces it.
The consent policy comes from scripts/personalization/config.js (or
--without-consent). --edge prints what the edge worker does per section
(applied / selected / left) and its headers. Exit 2 = usage.`;

const runtime = (...parts) => importAsset('runtime', 'scripts', 'personalization', ...parts);
const { parseCondition } = await runtime('rules.js');
const { parseGeo } = await runtime('context.js');
const { buildRequest, engineProfile, parseResponse } = await runtime('contract.js');
const {
  parseSection, listedVariant, ruleOutcome, splitArms, ATTRIBUTE,
} = await runtime('section-spec.js');
const {
  makeDecision, engineOutcome, targetOutcome, rulesOutcome, RULE_FALLBACK,
} = await runtime('outcomes.js');
const { prefetchRequest, toAnswer, locationOf } = await runtime('sources', 'target.js');
const { engineAnswer, targetAnswer, parseKnob } = await runtime('mock-engine.js');
const {
  findSections, renderSectionMetadata, textContent,
} = await importAsset('edge', 'cloudflare', 'src', 'personalization', 'html.js');

export const API_FAULTS = ['control', 'default', 'reason:low_confidence', 'reason:provider_error',
  'variant:not-listed', 'missing', 'fail', 'invalid', 'slow'];
export const TARGET_FAULTS = ['control', 'missing', 'fail'];
// The runtime defaults (config.js budgets and api.timeout).
const BUDGETS = { eager: 800, lazy: 2000 };
const API_TIMEOUT = 1500;

/**
 * Turns a matrix entry into a rules context plus the preview query that
 * reproduces it in the browser (?pzn-consent, ?pzn-geo, ...).
 * @param {object} entry
 * @returns {{context: object, audiences: string[], consent: boolean, query: string}}
 */
export function toCase(entry) {
  const consent = entry.consent !== false && !entry.bot;
  const context = { params: { ...(entry.params || {}) }, state: { ...(entry.state || {}) } };
  const query = new URLSearchParams();
  if (!entry.bot) query.set('pzn-consent', consent ? '1' : '0');
  const geo = typeof entry.geo === 'string' ? parseGeo(entry.geo) : entry.geo;
  if (geo) {
    context.geo = geo;
    query.set('pzn-geo', geo.region ? `${geo.country}-${geo.region}` : geo.country);
  }
  if (entry.device) {
    context.device = entry.device;
    query.set('pzn-device', entry.device);
  }
  if (entry.visitor) {
    if (consent) context.visitor = entry.visitor;
    query.set('pzn-visitor', entry.visitor);
  }
  const state = Object.entries(context.state);
  if (state.length) query.set('pzn-state', state.map(([key, value]) => `${key}:${value}`).join(','));
  const audiences = entry.audiences || [];
  if (audiences.length) query.set('pzn-audience', audiences.join(','));
  Object.entries(context.params).forEach(([key, value]) => query.set(key, value));
  if (entry.forced) query.set('pzn', entry.forced);
  return {
    context, audiences, consent, query: query.toString(),
  };
}

function conditionsOf(table) {
  return Object.keys(table || {}).filter((condition) => condition && condition !== '*').flatMap((condition) => {
    try {
      return [{ condition, clauses: parseCondition(condition) }];
    } catch (e) {
      return [];
    }
  });
}

/**
 * A matrix that exercises a section: no consent, a bot, consent with no
 * context, one entry satisfying each rule's positive clauses (and each extra
 * condition), the engine or Target faults, and one ?pzn= override per
 * variant and for the default.
 * @param {object} spec
 * @param {object} [options]
 * @param {{condition: string, clauses: object[]}[]} [options.conditions]
 * @returns {object[]}
 */
export function autoMatrix(spec, { conditions = [] } = {}) {
  const matrix = [{ name: 'no consent', consent: false }, { name: 'bot', bot: true }, { name: 'no context' }];
  [...spec.rules, ...conditions].forEach((rule) => {
    const entry = { name: `matches "${rule.condition}"`, params: {}, state: {} };
    if (matrix.some((existing) => existing.name === entry.name)) return;
    rule.clauses.filter((clause) => !clause.negate).forEach(({ criterion, values }) => {
      const [value] = values;
      const [key, ...rest] = value.split('=');
      if (criterion === 'geo') entry.geo = value;
      if (criterion === 'device') entry.device = value;
      if (criterion === 'visitor') entry.visitor = value;
      if (criterion === 'param') entry.params[key.trim()] = rest.length ? rest.join('=').trim() : '1';
      if (criterion === 'state') entry.state[key.trim()] = rest.length ? rest.join('=').trim() : '1';
      if (criterion === 'audience') entry.audiences = [...(entry.audiences || []), value];
    });
    matrix.push(entry);
  });
  if (spec.source === 'api') API_FAULTS.forEach((fault) => matrix.push({ name: `engine ${fault}`, fault }));
  if (spec.source === 'target') TARGET_FAULTS.forEach((fault) => matrix.push({ name: `Target ${fault}`, fault }));
  [...spec.variants.map((variant) => variant.name), 'default'].forEach((variant) => {
    matrix.push({ name: `forced ${variant}`, forced: `${spec.id}:${variant}` });
  });
  return matrix;
}

const forcedFor = (entry, id) => (entry.forced
  ? String(entry.forced).split(',').map((pair) => pair.split(':').map((part) => part.trim()))
    .find(([key]) => key === id)?.[1]
  : undefined);

/**
 * Personalized sections of a page, from source content (Section Metadata,
 * rendered as the pipeline does) or delivered HTML.
 * @param {string} html
 * @param {string[]} [prefixes]
 * @returns {object[]} specs, in page order, with their section index
 */
export function sectionSpecs(html, prefixes) {
  const rendered = renderSectionMetadata(html).html;
  return findSections(rendered)
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.attributes.some(([name]) => name === ATTRIBUTE || name.startsWith(`${ATTRIBUTE}-`)))
    .map(({ section, index }) => ({
      ...parseSection(section.attributes, { prefixes }),
      index,
      // what the default starts with, to recognize it in the browser
      authoredText: textContent(rendered.slice(section.openEnd, section.closeStart)).slice(0, 80),
    }));
}

const UNKNOWN = { unknown: true };

async function engineFields(spec, entry, { engine, prefixes, consent, context }) {
  const knob = parseKnob(entry.fault);
  if (entry.fault === 'slow') {
    // The first section's budget (800 ms) runs out before the engine request
    // (api.timeout, 1500 ms); other sections fall back when the request does.
    return spec.index === 0
      ? { outcome: 'timeout', variant: 'default', reason: `no decision within ${BUDGETS.eager} ms` }
      : { outcome: 'fallback', variant: 'default', reason: `timed out after ${API_TIMEOUT} ms` };
  }
  if (!engine && !knob) return UNKNOWN;
  const body = buildRequest({
    page: { path: '/' }, specs: [spec], context, consent, mode: 'client',
  });
  const answer = await engineAnswer(engine || {}, body, { knob });
  if (answer.status !== 200) return { outcome: 'fallback', variant: 'default', reason: `HTTP ${answer.status}` };
  let response;
  try {
    response = parseResponse(answer.body);
  } catch (e) {
    return { outcome: 'fallback', variant: 'default', reason: e.message };
  }
  const fields = engineOutcome(spec, response.decisions[spec.id], prefixes);
  delete fields.tracking;
  return fields;
}

/**
 * The decision the browser runtime (sections.js) makes for one case.
 * @param {object} spec
 * @param {object} entry matrix entry
 * @param {object} options { engine, activities, prefixes, policy, profile }
 * @returns {Promise<object>} decision fields, { unknown: true }, or { allowed } for split
 */
export async function expectedDecision(spec, entry, {
  engine, activities, prefixes, policy = [], profile = engineProfile('generic'),
}) {
  const { context, audiences, consent } = toCase(entry);
  const allowed = (exception) => policy.includes(exception);
  const rules = async () => rulesOutcome(await ruleOutcome(spec, context, {
    audiences: Object.fromEntries(audiences.map((name) => [name, true])), withoutConsent: !consent,
  }));
  const forced = forcedFor(entry, spec.id);
  const listed = forced && listedVariant(spec, { variant: forced }, prefixes);
  if (listed) return { source: 'override', outcome: 'override', variant: listed.name, path: listed.path };
  if (entry.bot) return { source: 'bot', outcome: 'bot', variant: 'default' };
  const noConsent = { source: spec.source, outcome: 'no-consent', variant: 'default' };
  if (spec.source === 'rules') {
    if (!consent && !allowed('rules')) return noConsent;
    return { source: 'rules', ...(await rules()) };
  }
  if (spec.source === 'split') {
    if (!consent && !allowed('split')) return noConsent;
    const arms = splitArms(spec).filter((arm) => arm.weight > 0).map((arm) => arm.name);
    if (arms.length !== 1) return { source: 'split', allowed: arms };
    return arms[0] === 'default'
      ? { source: 'split', outcome: 'control', variant: 'default' }
      : { source: 'split', outcome: 'variant', variant: arms[0] };
  }
  if (spec.source === 'target') {
    if (!consent) return noConsent;
    const knob = parseKnob(entry.fault);
    if (knob?.kind === 'fail') return { source: 'target', outcome: 'fallback', variant: 'default' };
    if (!activities && !knob) return UNKNOWN;
    const location = locationOf(spec);
    const page = { url: `https://simulate.invalid/?${new URLSearchParams(context.params)}` };
    const answer = await targetAnswer(activities || { [location]: { experiences: [{ audience: null, offer: spec.variants[0]?.path }] } }, prefetchRequest([location], context, { requestId: 'simulate', page }), { knob });
    const fields = targetOutcome(spec, toAnswer(answer.body.prefetch.mboxes[0]), prefixes);
    delete fields.tracking;
    delete fields.tokens;
    return { source: 'target', ...fields };
  }
  // api
  if (!consent && !allowed('api')) {
    if (!allowed('rules') || !spec.rules.length) return noConsent;
    return { ...(await rules()), source: 'rules', outcome: 'no-consent' };
  }
  const engined = spec.index === 0 && profile.slow
    ? { outcome: 'fallback', variant: 'default' }
    : await engineFields(spec, entry, {
      engine, prefixes, consent, context,
    });
  if (engined.unknown) return UNKNOWN;
  if (RULE_FALLBACK.includes(engined.outcome) && spec.rules.length && (consent || allowed('rules'))) {
    const ruled = await rules();
    return {
      ...ruled, source: 'rules', outcome: engined.outcome, reason: engined.reason,
    };
  }
  return { source: 'api', ...engined };
}

/**
 * Expected decisions for each personalized section of a page.
 * @param {string} html page HTML
 * @param {object} [options]
 * @param {object[]} [options.matrix] shared matrix; default: autoMatrix per section
 * @param {object} [options.engine] mock engine table, applied per case
 * @param {object} [options.activities] mock Target activities
 * @param {string[]} [options.prefixes]
 * @param {string[]} [options.policy] approved exceptions (config.consent.withoutConsent)
 * @param {string} [options.engineName] engine profile (config.api.engine)
 * @returns {Promise<object[]>} cases, by section id
 */
export async function buildCases(html, {
  matrix, engine, activities, prefixes, policy = [], engineName = 'generic',
} = {}) {
  const profile = engineProfile(engineName);
  const cases = await Promise.all(sectionSpecs(html, prefixes).map(async (spec) => {
    if (spec.errors.length) {
      return [{
        id: spec.id || null,
        section: spec.index,
        name: 'invalid section',
        errors: spec.errors,
        query: 'pzn-consent=1',
        context: {},
        expected: 'default',
        outcome: 'invalid',
        result: 'kept-default',
      }];
    }
    let conditions = [];
    if (spec.source === 'api' && engine) conditions = conditionsOf(engine.placeholders?.[spec.id]);
    if (spec.source === 'target' && activities) {
      conditions = conditionsOf(Object.fromEntries((activities[locationOf(spec)]?.experiences || [])
        .map((experience) => [experience.audience, true])));
    }
    const entries = matrix || autoMatrix(spec, { conditions });
    return Promise.all(entries.map(async (entry) => {
      const fields = await expectedDecision(spec, entry, {
        engine, activities, prefixes, policy, profile,
      });
      const { query } = toCase(entry);
      const base = {
        id: spec.id,
        section: spec.index,
        sourceType: spec.source,
        display: spec.display,
        trigger: spec.trigger || undefined,
        authoredText: spec.authoredText,
        name: entry.name,
        query,
        context: entry,
        fault: entry.fault,
      };
      if (fields.unknown) return { ...base, expected: 'unknown', reason: spec.source === 'target' ? 'pass --target activities.json' : 'pass --api-decisions decisions.json' };
      if (fields.allowed) return { ...base, expected: null, allowed: fields.allowed, source: 'split' };
      const decision = makeDecision({ id: spec.id, ...fields });
      return {
        ...base,
        expected: decision.variant,
        source: decision.source,
        outcome: decision.outcome,
        assigned: decision.assigned,
        reason: decision.reason,
        rule: decision.rule,
        result: decision.variant === 'default' ? 'kept-default' : 'applied',
      };
    }));
  }));
  return cases.flat().sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/**
 * Variant fragments for the simulated edge: content/<path>.html or
 * .plain.html in the repo, else <origin><path>.plain.html for a URL page.
 * @param {string} [repo]
 * @param {string} [origin]
 * @returns {(path: string) => Promise<string|null>}
 */
export function fragmentSource(repo, origin) {
  return async (path) => {
    if (repo) {
      const local = [`${path}.plain.html`, `${path}.html`].map((file) => readText(join(repo, 'content', file))).find(Boolean);
      if (local) return local;
    }
    if (!origin) return null;
    try {
      const response = await fetch(new URL(`${path}.plain.html`, origin));
      return response.ok ? await response.text() : null;
    } catch (e) {
      return null;
    }
  };
}

/**
 * A fetch that answers like an engine configured with a table (and an
 * optional fault), for the simulated edge.
 * @param {object} table
 * @param {string} [fault]
 * @param {object[]} [log] requests received
 * @returns {Function}
 */
export function tableEngine(table, fault, log = []) {
  return async (url, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    log.push(body);
    if (fault === 'slow') {
      await new Promise((done, fail) => {
        const timer = setTimeout(done, 5000);
        init.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          fail(new DOMException('aborted', 'AbortError'));
        });
      });
    }
    const answer = await engineAnswer(table || {}, body, { knob: parseKnob(fault) });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
  };
}

/**
 * Assembles the edge worker modules in a temp dir (as install-edge would)
 * and runs personalizeResponse over the HTML. Source content is rendered as
 * the pipeline would first (Section Metadata -> data-* attributes).
 * @param {string} source page HTML
 * @param {object} options
 * @returns {Promise<{html: string, headers: object, sections: object[], requests: object[]}>}
 */
export async function simulateEdge(source, {
  url = 'https://www.example.com/', country, region, cookie, consent = false, ua = 'Mozilla/5.0',
  referer, apiEndpoint, prefixes, repo, origin, engine, fault, policy, policyRef, engineName,
  fetchImpl, random, fragments = true, lastModified,
} = {}) {
  const html = renderSectionMetadata(source).html;
  const read = fragmentSource(repo, origin);
  const dir = mkdtempSync(join(tmpdir(), 'pzn-edge-'));
  const requests = [];
  try {
    cpSync(join(EDGE_DIR, 'src', 'personalization'), dir, { recursive: true });
    SHARED_WITH_EDGE.forEach((name) => cpSync(join(RUNTIME_DIR, 'scripts', 'personalization', name), join(dir, name)));
    const { personalizeResponse } = await import(pathToFileURL(join(dir, 'personalize.js')).href);
    const { default: baseConfig } = await import(pathToFileURL(join(dir, 'edge-config.js')).href);
    const config = {
      ...baseConfig,
      fragmentPrefixes: prefixes || baseConfig.fragmentPrefixes,
      consent: policy ? { withoutConsent: policy, policyRef: policyRef || 'simulate' } : baseConfig.consent,
      api: {
        ...baseConfig.api,
        endpoint: apiEndpoint || (engine || fault || fetchImpl ? 'https://engine.invalid/decide' : baseConfig.api.endpoint),
        engine: engineName || baseConfig.api.engine,
      },
    };
    const headers = { 'user-agent': ua, ...(referer ? { referer } : {}) };
    const cookies = [cookie, consent ? 'pzn-consent=1' : null].filter(Boolean).join('; ');
    if (cookies) headers.cookie = cookies;
    const request = new Request(url, { headers });
    const response = new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        ...(lastModified ? { 'last-modified': lastModified } : {}),
      },
    });
    const fetchFragment = async (path) => {
      const text = await read(path);
      return new Response(text ?? '', { status: text === null ? 404 : 200, headers: { 'content-type': 'text/html' } });
    };
    const out = await personalizeResponse(request, response, {
      config,
      cf: country ? { country, regionCode: region } : undefined,
      cache: null,
      fetchFragment: fragments ? fetchFragment : undefined,
      fetchImpl: fetchImpl || (engine || fault ? tableEngine(engine, fault, requests) : undefined),
      random,
    });
    const text = await out.text();
    const attr = (section, name) => section.attributes.find(([key]) => key === name)?.[1];
    const sections = findSections(text).filter((section) => attr(section, ATTRIBUTE) !== undefined).map((section) => ({
      id: attr(section, ATTRIBUTE),
      type: attr(section, `${ATTRIBUTE}-source`) || 'rules',
      where: attr(section, 'data-pzn-where') || 'left to the browser',
      status: attr(section, 'data-pzn-status') || null,
      variant: attr(section, 'data-pzn-variant') || null,
      outcome: attr(section, 'data-pzn-outcome') || null,
      source: attr(section, 'data-pzn-source') || null,
      reason: attr(section, 'data-pzn-reason') || null,
      decision: attr(section, 'data-pzn-decision') || null,
      cached: attr(section, 'data-pzn-cached') === 'true',
      tracking: attr(section, 'data-pzn-tracking') || null,
      template: /<template data-pzn-default>/.test(text.slice(section.openEnd, section.closeStart)),
    }));
    return {
      html: text, headers: Object.fromEntries(out.headers), sections, requests,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function loadHtml(target) {
  if (/^https?:\/\//.test(target)) {
    const response = await fetch(target);
    if (!response.ok) throw new Error(`${target}: HTTP ${response.status}`);
    return response.text();
  }
  const html = readText(resolve(target));
  if (html === null) throw new Error(`${target} not found`);
  return html;
}

if (isMain(import.meta.url)) {
  exitOnHelp(USAGE);
  const args = parseArgs(process.argv.slice(2));
  const target = args._[0];
  if (!target) {
    console.error(`❌ ${USAGE}`);
    process.exit(2);
  }
  const repo = resolve(args.repo || process.cwd());
  const prefixes = sitePrefixes(repo);
  const site = readSiteConfig(readText(join(repo, 'scripts', 'personalization', 'config.js')) || '');
  const policy = typeof args['without-consent'] === 'string'
    ? args['without-consent'].split(',').map((name) => name.trim()).filter(Boolean)
    : (site.consent?.policyRef && site.consent.withoutConsent) || [];
  const engineName = typeof args.engine === 'string' ? args.engine : site.engine;
  const html = await loadHtml(target);
  const engine = args['api-decisions'] ? readJson(resolve(args['api-decisions'])) : undefined;
  if (args.edge) {
    const result = await simulateEdge(html, {
      url: /^https?:\/\//.test(target) ? target : undefined,
      country: args.country,
      region: args.region,
      cookie: args.cookie,
      consent: !!args.consent,
      ua: args.ua,
      apiEndpoint: args['api-endpoint'],
      engine,
      fault: typeof args.fault === 'string' ? args.fault : undefined,
      policy,
      engineName,
      prefixes,
      repo,
      origin: /^https?:\/\//.test(target) ? new URL(target).origin : undefined,
    });
    if (args.json) {
      console.log(JSON.stringify({ headers: result.headers, sections: result.sections }, null, 2));
    } else {
      console.log(`cache-control: ${result.headers['cache-control'] || '(unchanged)'}  x-pzn: ${result.headers['x-pzn'] || '-'}${result.headers['set-cookie'] ? `  set-cookie: ${result.headers['set-cookie']}` : ''}`);
      if (result.sections.length) console.table(result.sections.map(({ tracking, ...row }) => row));
    }
  } else {
    const matrix = args.matrix ? readJson(resolve(args.matrix)) : undefined;
    const activities = typeof args.target === 'string' ? readJson(resolve(args.target)) : undefined;
    const cases = await buildCases(html, {
      matrix, engine, activities, prefixes, policy, engineName,
    });
    const pageUrl = typeof args['page-url'] === 'string' ? args['page-url'] : '';
    cases.forEach((entry) => {
      if (pageUrl && entry.query !== undefined) entry.url = `${pageUrl}${entry.query ? `?${entry.query}` : ''}`;
    });
    if (args.json) console.log(JSON.stringify(cases, null, 2));
    else {
      const expected = (entry) => {
        if (entry.errors) return `INVALID: ${entry.errors.join('; ')}`;
        return entry.expected ?? `one of ${entry.allowed.join(', ')}`;
      };
      console.table(cases.map((entry) => ({
        id: entry.id,
        source: `${entry.sourceType || '?'}${entry.display === 'popup' ? ' popup' : ''}`,
        case: entry.name,
        expected: expected(entry),
        outcome: entry.outcome || '',
        'decided by': entry.source || '',
        assigned: entry.assigned ?? '',
        url: entry.url || (entry.query ? `?${entry.query}` : ''),
      })));
    }
  }
}
