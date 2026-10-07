/* eslint-disable no-console */
/*
 * Placeholder personalization runtime.
 *
 * A Personalization block is a placeholder: its rows map conditions to
 * fragments. The block element stays in the DOM as a hidden marker and the
 * chosen variant is rendered right after it, so the site's section styles
 * apply exactly as they do for the stock fragment block.
 *
 * Lifecycle:
 * 1. initPersonalization(main), called from loadEager before decorateMain,
 *    reads the raw rows and starts one batched decision API request.
 * 2. The block's decorate calls personalize(block) while its section is still
 *    hidden, so the decision never flickers.
 * 3. setState(key, value) re-evaluates placeholders that depend on that key;
 *    refresh() re-evaluates all of them. Re-evaluations decide in the browser
 *    even where the edge decided first, and the latest one always wins.
 */

import config from './config.js';
import {
  parseSpec, decide, criteriaUsed, stateKeysUsed, toFragmentPath, variantName,
} from './rules.js';
import { buildRequest } from './contract.js';
import { fetchDecisions } from './provider-api.js';
import {
  parseCookies, readGeo, parseGeo, getDevice, getVisitor, syncConsentCookie, isBot,
  readParams, overridesEnabled, readOverrides, loadState, saveState,
} from './context.js';

const rowsByBlock = new WeakMap();
const apiResults = new Map();
const entries = [];
const debugRows = [];
const state = {};
let baseContext;
let geoPromise;
let debugTimer;

const search = new URLSearchParams(window.location.search);
const overrides = readOverrides(
  overridesEnabled(config.overrides, window.location.hostname) ? search : new URLSearchParams(),
);
const debug = search.has('pzn-debug');
const prefixes = config.fragmentPrefixes;
// Local `aem up --html-folder content` serves pages and fragments under
// /content; DA and the CDN serve them at the root.
const localMount = window.location.pathname.startsWith('/content/') ? '/content' : '';

function hasConsent() {
  if (overrides.consent !== undefined) return overrides.consent;
  try {
    return !!config.hasConsent('personalization');
  } catch (e) {
    return false;
  }
}

function writeCookie(cookie) {
  document.cookie = cookie;
}

function log(row) {
  debugRows.push(row);
  if (!debug) return;
  clearTimeout(debugTimer);
  debugTimer = setTimeout(() => console.table(debugRows), 100);
}

/**
 * Reads the block rows into the environment-neutral shape parseSpec expects.
 * @param {Element} block
 * @returns {object[]}
 */
function readRows(block) {
  return [...block.children].map((row) => {
    const [keyCell, valueCell] = row.children;
    const text = valueCell ? valueCell.textContent.trim() : '';
    const links = valueCell ? valueCell.querySelectorAll('a[href]') : [];
    const link = links.length === 1 && links[0].textContent.trim() === text ? links[0] : null;
    const paragraphs = valueCell ? valueCell.querySelectorAll('p').length : 0;
    const inline = !!valueCell && !link
      && (paragraphs > 1 || !!valueCell.querySelector(':scope *:not(p)'));
    return {
      key: keyCell ? keyCell.textContent.trim() : '',
      value: text,
      href: link ? link.getAttribute('href') : undefined,
      inline,
    };
  });
}

function getRows(block) {
  if (!rowsByBlock.has(block)) rowsByBlock.set(block, readRows(block));
  return rowsByBlock.get(block);
}

function getBaseContext() {
  if (baseContext) return baseContext;
  const consent = hasConsent();
  const cookies = parseCookies(document.cookie);
  syncConsentCookie(consent, cookies, writeCookie);
  Object.assign(state, { ...(consent ? loadState(window.localStorage) : {}), ...state });
  Object.assign(state, overrides.context.state || {});
  baseContext = {
    geo: readGeo(document, cookies),
    device: getDevice(config.devices, (query) => window.matchMedia(query)),
    visitor: getVisitor(cookies, consent, writeCookie),
    params: readParams(search),
    state,
  };
  ['geo', 'device', 'visitor'].forEach((key) => {
    if (overrides.context[key]) baseContext[key] = overrides.context[key];
  });
  return baseContext;
}

async function lookupGeo() {
  const { endpoint, timeout } = config.geo || {};
  if (!endpoint) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout || 500);
  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    const json = response.ok ? await response.json() : {};
    return parseGeo(json.region ? `${json.country}-${json.region}` : json.country);
  } catch (e) {
    console.warn('⚠️ personalization: geo lookup failed:', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getContext(needGeo) {
  const context = getBaseContext();
  if (needGeo && !context.geo) {
    geoPromise = geoPromise || lookupGeo();
    const geo = await geoPromise;
    if (geo && !context.geo) context.geo = geo;
  }
  return context;
}

/**
 * Starts one decision API request for a batch of placeholders.
 * @param {object[]} specs
 */
function requestDecisions(specs) {
  if (!specs.length) return;
  const { api } = config;
  const consent = hasConsent();
  let promise;
  if (!api.endpoint) {
    console.warn('⚠️ personalization: "source | api" is set but config.api.endpoint is empty');
    promise = Promise.resolve({ decisions: null, error: 'no endpoint' });
  } else if (!consent && !api.sendWithoutConsent) {
    promise = Promise.resolve({ decisions: null, error: 'no consent' });
  } else {
    promise = (async () => {
      const needGeo = specs.some((spec) => criteriaUsed(spec).has('geo'));
      const context = await getContext(needGeo);
      const body = buildRequest({
        path: window.location.pathname.slice(localMount.length),
        locale: document.documentElement.lang,
        specs,
        context,
        consent,
        mode: 'client',
      });
      const result = await fetchDecisions({
        endpoint: api.endpoint,
        body,
        timeout: config.budgets.lazy,
        mapRequest: api.mapRequest,
        mapResponse: api.mapResponse,
        storage: consent ? window.sessionStorage : undefined,
      });
      if (result.error) console.warn('⚠️ personalization: decision API failed, using rules/default:', result.error);
      return result;
    })();
  }
  specs.forEach((spec) => apiResults.set(spec.id, promise));
}

/**
 * The edge worker's decision, as annotated on the block. Read once per
 * placeholder: after setState or refresh the browser decides on its own.
 * @param {Element} block
 * @returns {{variant?: string, fragment?: string}|null}
 */
function edgeHandoff(block) {
  if (block.dataset.pznSource !== 'edge' || overrides.any) return null;
  return { variant: block.dataset.pznVariant, fragment: block.dataset.pznFragment };
}

/**
 * Call from loadEager before decorateMain. Costs one querySelectorAll on
 * pages without placeholders.
 * @param {Element} main
 */
export function initPersonalization(main) {
  const blocks = [...main.querySelectorAll('div.personalization')];
  const apiSpecs = [];
  blocks.forEach((block) => {
    const rows = getRows(block);
    // Plain-text the fragment links so auto-blocking cannot turn them into
    // fragment blocks before the placeholder decides.
    [...block.children].forEach((row, index) => {
      const link = rows[index].href && row.children[1]?.querySelector('a[href]');
      if (link) link.replaceWith(document.createTextNode(rows[index].href));
    });
    const spec = parseSpec(rows, { prefixes });
    if (spec.source === 'api' && spec.id && !edgeHandoff(block) && !apiResults.has(spec.id)) apiSpecs.push(spec);
  });
  requestDecisions(apiSpecs);
}

function defaultDecision(spec, source) {
  return {
    id: spec.id, variant: 'default', target: spec.default || { type: 'none' }, source, rule: 'default',
  };
}

function withBudget(promise, ms, fallback) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function fromEdge(spec, edge) {
  const path = edge.fragment ? toFragmentPath(edge.fragment, prefixes) : null;
  const named = await decide(spec, {}, { forcedVariant: edge.variant, prefixes });
  if (named.source === 'override' && (!path || named.target.path === path)) return { ...named, source: 'edge' };
  // An engine decision for a fragment no authored rule names.
  if (path) {
    return {
      id: spec.id, variant: edge.variant || variantName(path), target: { type: 'fragment', path }, source: 'edge', rule: 'api',
    };
  }
  return null;
}

async function resolveDecision(entry, deadline) {
  const { spec, edge } = entry;
  const forced = overrides.forced[spec.id];
  if (forced) {
    const decision = await decide(spec, {}, { forcedVariant: forced, prefixes });
    if (decision.source === 'override') return decision;
    console.warn(`⚠️ personalization: ?pzn= variant "${forced}" not found in placeholder "${spec.id}"`);
  }
  // Preview overrides are explicit tester intent, so they win over bot
  // detection (headless test browsers look like bots).
  if (config.botsGetDefault && !overrides.any && isBot(navigator.userAgent)) {
    return defaultDecision(spec, 'bot');
  }
  if (edge) {
    const decision = await fromEdge(spec, edge);
    if (decision) return decision;
  }
  const context = await getContext(criteriaUsed(spec).has('geo'));
  let apiDecision;
  if (spec.source === 'api') {
    if (!apiResults.has(spec.id)) requestDecisions([spec]);
    // A slow engine falls back to the authored rules, not straight to the
    // default: stop waiting shortly before the placeholder's budget runs out.
    const wait = Math.max(0, deadline - performance.now() - 50);
    const result = await withBudget(apiResults.get(spec.id), wait, () => ({ decisions: null }));
    apiDecision = result.decisions ? result.decisions[spec.id] : undefined;
  }
  const audiences = { ...config.audiences };
  overrides.audiences.forEach((name) => { audiences[name] = true; });
  return decide(spec, context, {
    audiences, apiDecision, prefixes,
  });
}

async function fetchFragment(path) {
  try {
    // fragment.js imports scripts.js, which loads this module: the cycle is
    // broken at runtime because both imports are dynamic.
    // eslint-disable-next-line import/no-cycle
    const { loadFragment } = await import('../../blocks/fragment/fragment.js');
    return (localMount && await loadFragment(`${localMount}${path}`)) || await loadFragment(path);
  } catch (e) {
    console.warn(`⚠️ personalization: fragment ${path} failed:`, e.message);
    return null;
  }
}

/**
 * Builds the nodes to insert for a decision; falls back to the default when a
 * variant fragment cannot be loaded.
 */
async function buildNodes(entry, decision) {
  const { target } = decision;
  if (target.type === 'inline') {
    const wrapper = document.createElement('div');
    wrapper.className = 'default-content-wrapper';
    wrapper.append(...entry.defaultNodes.map((node) => node.cloneNode(true)));
    return { nodes: [wrapper], classes: [], decision };
  }
  if (target.type !== 'fragment') return { nodes: [], classes: [], decision };
  const fragment = await fetchFragment(target.path);
  if (!fragment) {
    if (decision.variant === 'default') return { nodes: [], classes: [], decision };
    return buildNodes(entry, defaultDecision(entry.spec, 'fallback'));
  }
  const sections = [...fragment.querySelectorAll(':scope > .section')];
  const nodes = sections.length
    ? sections.flatMap((section) => [...section.children])
    : [...fragment.children];
  const classes = sections.length
    ? [...sections[0].classList].filter((name) => name !== 'section')
    : [];
  return { nodes, classes, decision };
}

function track(block, decision) {
  const detail = {
    id: decision.id,
    variant: decision.variant,
    source: decision.source,
    rule: decision.rule,
    tracking: decision.tracking,
  };
  block.dispatchEvent(new CustomEvent('personalization:applied', { bubbles: true, detail }));
  if (config.analytics?.dataLayer) {
    window.adobeDataLayer = window.adobeDataLayer || [];
    window.adobeDataLayer.push({ event: 'personalization:applied', personalization: detail });
  }
  if (config.analytics?.rum) {
    import('../aem.js')
      .then(({ sampleRUM }) => {
        if (typeof sampleRUM === 'function') sampleRUM('audience', { source: decision.id, target: decision.variant });
      })
      .catch(() => {});
  }
}

const sameTarget = (a, b) => a.variant === b.variant
  && a.target.type === b.target.type && a.target.path === b.target.path;

/**
 * Renders a decision. Returns false, leaving the DOM alone, when a newer
 * evaluation of the placeholder started while the fragment was loading.
 */
async function apply(entry, requested, generation = entry.generation) {
  const { block } = entry;
  const { nodes, classes, decision } = await buildNodes(entry, requested);
  if (generation !== entry.generation) return false;
  const section = block.closest('.section');
  const anchor = block.closest('.personalization-wrapper') || block;
  entry.nodes.forEach((node) => node.remove());
  let added = [];
  if (section) {
    // Only classes the variant added are removed later, never the host
    // section's own (section metadata styles, *-container).
    entry.classes.forEach((name) => section.classList.remove(name));
    added = classes.filter((name) => !section.classList.contains(name));
    added.forEach((name) => section.classList.add(name));
  }
  const first = nodes.flatMap((node) => [...node.querySelectorAll('img')])[0];
  if (first && entry.eager) {
    first.loading = 'eager';
    first.fetchPriority = 'high';
  }
  nodes.forEach((node) => {
    node.dataset.pznId = decision.id;
    node.dataset.pznVariant = decision.variant;
  });
  anchor.after(...nodes);
  Object.assign(entry, { nodes, classes: added, decision });
  block.dataset.pznId = decision.id;
  block.dataset.pznVariant = decision.variant;
  block.dataset.pznSource = decision.source;
  block.dataset.pznStatus = 'applied';
  if (decision.source !== 'edge') delete block.dataset.pznFragment;
  track(block, decision);
  return true;
}

/**
 * Decides and renders a placeholder. Overlapping calls are ordered by start:
 * a superseded call leaves the DOM to the newer one and waits for it.
 * @returns {Promise<void>}
 */
function evaluate(entry) {
  entry.generation += 1;
  const { generation } = entry;
  entry.pending = (async () => {
    const started = performance.now();
    const budget = entry.eager ? config.budgets.eager : config.budgets.lazy;
    const decision = await withBudget(
      resolveDecision(entry, started + budget),
      budget,
      () => defaultDecision(entry.spec, 'timeout'),
    );
    if (generation !== entry.generation) return entry.pending;
    if (entry.decision && sameTarget(entry.decision, decision)) return undefined;
    if (!await apply(entry, decision, generation)) return entry.pending;
    log({
      id: entry.spec.id,
      variant: entry.decision.variant,
      source: entry.decision.source,
      rule: entry.decision.rule,
      ms: Math.round(performance.now() - started),
    });
    return undefined;
  })();
  return entry.pending;
}

async function reevaluate(predicate) {
  const affected = entries.filter(predicate);
  // The edge decided with the context of the page request; state or consent
  // has changed since, so the browser decides now.
  affected.forEach((entry) => { entry.edge = null; });
  requestDecisions(affected.filter((entry) => entry.spec.source === 'api').map((entry) => entry.spec));
  await Promise.all(affected.map((entry) => evaluate(entry).catch((e) => {
    console.error('❌ personalization: re-evaluation failed:', e);
  })));
}

/**
 * Sets a state value (quiz answer, app state) and re-evaluates placeholders
 * whose rules or custom audiences depend on it. Persisted only with consent.
 * @param {string} key
 * @param {string|null} value null removes the key
 * @returns {Promise<void>}
 */
export async function setState(key, value) {
  getBaseContext();
  if (value === null || value === undefined) delete state[key];
  else state[key] = String(value);
  if (hasConsent()) saveState(window.localStorage, state);
  document.dispatchEvent(new CustomEvent('personalization:state-changed', { detail: { key, value } }));
  await reevaluate((entry) => stateKeysUsed(entry.spec).has(key) || criteriaUsed(entry.spec).has('audience'));
}

/**
 * @param {string} key
 * @returns {string|undefined}
 */
export function getState(key) {
  getBaseContext();
  return state[key];
}

/**
 * Re-evaluates every placeholder, e.g. after consent changes.
 * @returns {Promise<void>}
 */
export async function refresh() {
  baseContext = undefined;
  apiResults.clear();
  await reevaluate(() => true);
}

/**
 * Resolves one placeholder. Called by blocks/personalization/personalization.js.
 * Never throws: on any error the default renders.
 * @param {Element} block
 * @returns {Promise<void>}
 */
export async function personalize(block) {
  const rows = getRows(block);
  const spec = parseSpec(rows, { prefixes });
  const defaultIndex = rows.findIndex((row) => row.key.toLowerCase() === 'default');
  const defaultCell = defaultIndex === -1 ? null : block.children[defaultIndex]?.children[1];
  const firstSection = document.querySelector('main .section');
  const entry = {
    block,
    spec,
    edge: edgeHandoff(block),
    defaultNodes: defaultCell ? [...defaultCell.childNodes] : [],
    eager: !!firstSection && firstSection.contains(block),
    nodes: [],
    classes: [],
    decision: null,
    generation: 0,
    pending: null,
  };
  block.replaceChildren();
  if (spec.errors.length) {
    console.warn(`⚠️ personalization: placeholder "${spec.id || '?'}" has errors:\n- ${spec.errors.join('\n- ')}`);
  } else {
    // Registered before the first decision so setState/refresh calls made
    // while it loads (CMP callbacks, quiz blocks) reach this placeholder.
    entries.push(entry);
  }
  try {
    if (spec.errors.length) await apply(entry, defaultDecision(spec, 'error'));
    else await evaluate(entry);
  } catch (e) {
    console.error('❌ personalization: rendering default after error:', e);
    await apply(entry, defaultDecision(spec, 'error')).catch(() => {});
  }
}

window.hlx = window.hlx || {};
window.hlx.personalization = {
  setState, getState, refresh, decisions: debugRows,
};
