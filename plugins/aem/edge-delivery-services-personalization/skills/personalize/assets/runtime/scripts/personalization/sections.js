/* eslint-disable no-console */
/*
 * Section personalization runtime (contract sections 4, 8 and 9).
 *
 * Authors personalize a whole section with Section Metadata (grammar:
 * section-spec.js). The section's authored content is the default: what
 * bots, failures, timeouts and visitors without consent see.
 *
 * 1. personalizeSections(main), from loadEager right after decorateMain,
 *    reads each personalized section. A section the edge decided
 *    (data-pzn-where="edge") is final: `applied` is only measured,
 *    `selected` gets its fragment here. Every other inline section is held
 *    hidden (data-section-status="pzn-pending", so aem.js skips it), and the
 *    sections below it wait, so sections appear in page order and nothing
 *    shifts.
 * 2. One evaluation decides the sections: one batched call per source (the
 *    engine, Target), then each section within its budget (config.budgets).
 *    A decision has one outcome; the variant's fragment replaces the
 *    section's children (classes, id and attributes stay) and the section
 *    loads like any other.
 * 3. Each new decision (decisionId <id>#n) sends pzn:decided and
 *    pzn:applied, then pzn:seen and pzn:clicked once, Target display/click
 *    and engine feedback once, and the RUM checkpoint for successful arms.
 * 4. personalizeSectionsLazy(main), from loadLazy, lets target popups arm:
 *    the offer opens in a dialog when its trigger fires.
 * 5. refresh(), setState() and consent changes re-evaluate. The same
 *    decision identity sends nothing; consent withdrawn restores every
 *    default.
 */

import { loadSection, loadCSS } from '../aem.js';
import config from './config.js';
import {
  parseSection, listedVariant, ruleOutcome, sectionCriteria, EXPERIMENTATION_META,
} from './section-spec.js';
import { stateKeysUsed } from './rules.js';
import { engineProfile } from './contract.js';
import {
  makeDecision, identity, resultFor, eventPayload, rumCheckpoint, decisionAttributes,
  decisionFromAttributes, engineOutcome, targetOutcome, splitOutcome, rulesOutcome, RULE_FALLBACK,
} from './outcomes.js';
import {
  overrides, previewHost, debug, hasConsent, allowed, syncConsent, forgetVisitor, dropStoredState,
  isCrawler, getContext, getAudiences, emit, rum, feedback, log, register,
} from './visitor.js';
import { onTrigger, openPopup } from './popup.js';
import { splitArm } from './sources/split.js';

export const PENDING = 'pzn-pending';
// Decided, waiting for the sections above it to show.
export const READY = 'pzn-ready';
// Not personalized, below a held section.
export const WAITING = 'pzn-waiting';
const SELECTOR = ':scope > .section[data-personalization]';
const ID = /^[a-z0-9][a-z0-9_-]*$/;
const ATTRIBUTES = ['pzn-where', 'pzn-status', 'pzn-variant', 'pzn-source', 'pzn-outcome', 'pzn-reason',
  'pzn-decision', 'pzn-cached', 'pzn-fragment', 'pzn-tracking'];
const TIMEOUT = Symbol('timeout');

const budgets = { eager: 800, lazy: 2000, ...(config.budgets || {}) };
const prefixes = config.fragmentPrefixes || ['/fragments/'];
const seenThreshold = config.analytics?.seenThreshold || 0.25;
const profile = engineProfile(config.api?.engine);
const entries = [];
let order = [];
let releasing = Promise.resolve();
let lastConsent = false;
let markLazy;
const lazy = new Promise((done) => { markLazy = done; });
let transport;

// config.mock answers the engine and Target in the browser (mocks.js).
function fetcher() {
  transport = transport || (config.mock
    ? import('./mocks.js').then((module) => module.default)
    : Promise.resolve((...args) => window.fetch(...args)));
  return transport;
}

function targetTransport() {
  return config.target?.transport === 'websdk'
    ? import('./sources/target-websdk.js')
    : import('./sources/target.js');
}

const pick = (variant) => (variant?.path ? { variant: variant.name, path: variant.path } : { variant: 'default' });
const budgetOf = (entry) => (entry.eager ? budgets.eager : budgets.lazy);

function withBudget(promise, deadline) {
  let timer;
  return Promise.race([
    promise,
    new Promise((done) => {
      timer = setTimeout(() => done(TIMEOUT), Math.max(0, deadline - performance.now()));
    }),
  ]).finally(() => clearTimeout(timer));
}

function readEntry(section, first, ids, pageExperiment) {
  const attributes = section.getAttributeNames().map((name) => [name, section.getAttribute(name)]);
  const spec = parseSection(attributes, { prefixes });
  if (spec.id && ids.has(spec.id)) spec.errors.push(`id "${spec.id}" is used by another section on this page`);
  if (pageExperiment) spec.errors.push(`the page has AEM Experimentation metadata (${pageExperiment}); a page experiment gets no personalized sections`);
  ids.add(spec.id);
  return {
    id: spec.id,
    spec,
    section,
    eager: section === first,
    popup: spec.display === 'popup',
    where: 'browser',
    final: false,
    generation: 0,
    count: 0,
    key: null,
    decision: null,
    shown: 'default',
    applied: false,
    defaultNodes: null,
    edgeDefault: null,
    edgeDecision: null,
    watch: null,
    dialog: null,
    row: null,
  };
}

// --- Content ---

/**
 * The content of a variant fragment, flattened from its sections (its own
 * Section Metadata is dropped by decoration).
 * @param {string} path
 * @returns {Promise<Node[]|null>}
 */
async function fragmentNodes(path) {
  try {
    // fragment.js imports scripts.js, which loads this module dynamically.
    // eslint-disable-next-line import/no-cycle
    const { loadFragment } = await import('../../blocks/fragment/fragment.js');
    const fragment = await loadFragment(path);
    if (!fragment) return null;
    const sections = [...fragment.querySelectorAll(':scope > .section')];
    const nodes = sections.length
      ? sections.flatMap((section) => [...section.childNodes])
      : [...fragment.childNodes];
    return nodes.some((node) => node.nodeType === Node.ELEMENT_NODE) ? nodes : null;
  } catch (e) {
    return null;
  }
}

// The edge's <template data-pzn-default>, decorated like the page.
async function decorateDefault(html) {
  const main = document.createElement('main');
  const holder = document.createElement('div');
  holder.innerHTML = html;
  main.append(holder);
  try {
    // eslint-disable-next-line import/no-cycle
    const { decorateMain } = await import('../scripts.js');
    if (typeof decorateMain === 'function') decorateMain(main);
  } catch (e) {
    console.warn('⚠️ personalization: could not decorate the restored default:', e.message);
  }
  return [...(main.querySelector(':scope > div') || holder).childNodes];
}

function takeTemplate(entry) {
  const template = entry.section.querySelector('template[data-pzn-default]');
  if (!template) return;
  entry.edgeDefault = template.innerHTML;
  const parent = template.parentElement;
  template.remove();
  const empty = !parent.children.length && !parent.textContent.trim();
  if (parent !== entry.section && empty) parent.remove();
}

function swapIn(entry, nodes) {
  const { section } = entry;
  if (entry.shown === 'default' && !entry.defaultNodes) entry.defaultNodes = [...section.childNodes];
  section.replaceChildren(...nodes);
}

async function restoreDefault(entry) {
  if (!entry.defaultNodes && entry.edgeDefault !== null) {
    entry.defaultNodes = await decorateDefault(entry.edgeDefault);
  }
  if (!entry.defaultNodes) {
    console.warn(`⚠️ personalization: section "${entry.id}" has no default to restore`);
    return false;
  }
  entry.section.replaceChildren(...entry.defaultNodes);
  return true;
}

function writeAttributes(entry, decision) {
  const { section } = entry;
  const values = decisionAttributes(decision, 'applied', { tracking: false });
  ATTRIBUTES.forEach((name) => {
    // The edge's own decision keeps what the edge wrote (status, tracking).
    if (decision === entry.edgeDecision && ['pzn-tracking', 'pzn-status'].includes(name)) return;
    if (values[name] === undefined) section.removeAttribute(`data-${name}`);
    else section.setAttribute(`data-${name}`, values[name]);
  });
}

// --- Page order ---

const revealed = new WeakMap();

// Resolves once the section has loaded (shown).
function whenRevealed(section) {
  if (section.dataset.sectionStatus === 'loaded') return Promise.resolve();
  if (!revealed.has(section)) {
    let done;
    const promise = new Promise((settle) => { done = settle; });
    revealed.set(section, { promise, done });
  }
  return revealed.get(section).promise;
}

async function reveal(section, id) {
  section.dataset.sectionStatus = 'initialized';
  try {
    await loadSection(section);
  } catch (error) {
    console.error(`❌ personalization: section "${id || '?'}" failed to load:`, error);
    section.dataset.sectionStatus = 'loaded';
    section.style.display = null;
  }
  revealed.get(section)?.done();
}

let watcher;

/**
 * Shows decided and waiting sections in page order, up to the first section
 * not shown yet: still being decided, or still loading in aem.js.
 */
async function revealFrom(index, force) {
  const section = order[index];
  if (!section) {
    watcher?.disconnect();
    return;
  }
  const status = section.dataset.sectionStatus;
  if (status === READY || status === WAITING) {
    await reveal(section, section.dataset.personalization);
  } else if (status !== 'loaded' && !force) {
    return;
  }
  await revealFrom(index + 1, force);
}

function release({ force = false } = {}) {
  releasing = releasing.then(() => revealFrom(0, force));
  return releasing;
}

async function show(entry, swapped) {
  const { section } = entry;
  if (entry.eager && swapped) {
    // The LCP image, as aem.js waitForFirstImage would treat it.
    const image = section.querySelector('img');
    if (image) {
      image.loading = 'eager';
      image.fetchPriority = 'high';
    }
  }
  if ([PENDING, READY].includes(section.dataset.sectionStatus)) {
    // Not shown yet: shown once every section above it is.
    section.dataset.sectionStatus = READY;
    release();
    await whenRevealed(section);
  } else if (swapped) {
    await reveal(section, entry.id);
  }
}

// --- Measurement ---

function row(entry, decision, extra = {}) {
  entry.row = log({
    id: entry.id,
    decisionId: decision.decisionId,
    variant: decision.shown ?? decision.variant,
    source: decision.source,
    where: decision.where,
    outcome: decision.outcome,
    reason: decision.reason,
    result: decision.result,
    ms: Number.isFinite(decision.ms) ? Math.round(decision.ms) : undefined,
    cached: !!decision.cached,
    trigger: decision.trigger,
    popup: entry.popup ? 'none' : undefined,
    notifications: '',
    ...extra,
  });
  return entry.row;
}

function send(entry, event, decision, extra) {
  if (!ID.test(entry.id || '')) return;
  emit(entry.section, event, eventPayload(event, decision, extra));
}

function noted(entry, decision, notification) {
  send(entry, 'pzn:notified', decision, { notification });
  if (entry.row?.decisionId === decision.decisionId) {
    entry.row.notifications = [entry.row.notifications, `${notification.product} ${notification.type} ${notification.ok ? 'ok' : 'failed'}`]
      .filter(Boolean).join(', ');
    log(entry.row);
  }
}

// Target display / click, once per decision, with consent only.
function notifyTarget(entry, decision, type) {
  if (decision.source !== 'target' || !decision.tokens?.[type]?.length || !hasConsent()) return;
  Promise.all([targetTransport(), fetcher()])
    .then(([module, fetch]) => module.notify({ type, spec: entry.spec, decision }, {
      config, fetch,
    }))
    .then((result) => {
      if (result) noted(entry, decision, { product: 'target', type, ok: !!result.ok });
    })
    .catch((error) => console.warn(`⚠️ personalization: Target ${type} for "${entry.id}" failed:`, error.message));
}

// Engine feedback, once per decision, for engine-assigned decisions.
function notifyEngine(entry, decision, type) {
  if (decision.source !== 'api' || decision.assigned === undefined) return;
  const ok = feedback(decision, type);
  if (ok !== null) noted(entry, decision, { product: 'api', type, ok: !!ok });
}

function seen(entry, decision) {
  send(entry, 'pzn:seen', decision);
  notifyTarget(entry, decision, 'display');
  notifyEngine(entry, decision, 'seen');
}

/**
 * pzn:seen (once the share config.analytics.seenThreshold is visible) and
 * pzn:clicked (first link click), once per decision.
 * @param {object} entry
 * @param {object} decision
 * @param {Element} container the section, or the popup's content
 * @param {{visible?: boolean, signal: AbortSignal}} options visible: seen now
 */
function watchExposure(entry, decision, container, { visible = false, signal }) {
  const clicks = new AbortController();
  signal.addEventListener('abort', () => clicks.abort());
  container.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    clicks.abort();
    let href = link.getAttribute('href');
    try {
      href = new URL(link.href, window.location.href).href;
    } catch (e) {
      // keep the attribute
    }
    send(entry, 'pzn:clicked', decision, { href: href.split(/[?#]/)[0].slice(0, 2048) });
    notifyTarget(entry, decision, 'click');
    notifyEngine(entry, decision, 'clicked');
  }, { signal: clicks.signal, capture: true });
  if (visible) {
    seen(entry, decision);
    return;
  }
  const observer = new IntersectionObserver((records) => {
    const enough = records
      .some((record) => record.isIntersecting && record.intersectionRatio >= seenThreshold);
    if (!enough) return;
    observer.disconnect();
    seen(entry, decision);
  }, { threshold: seenThreshold });
  observer.observe(container);
  signal.addEventListener('abort', () => observer.disconnect());
}

function measure(entry, decision) {
  send(entry, 'pzn:decided', decision);
  send(entry, 'pzn:applied', decision);
  rum(rumCheckpoint(entry.spec, decision));
}

// --- Deciding ---

const warned = new Set();

function forcedVariant(entry) {
  const forced = overrides.forced[entry.id];
  if (!forced) return undefined;
  const listed = listedVariant(entry.spec, { variant: forced }, prefixes);
  if (!listed && !warned.has(entry.id)) {
    warned.add(entry.id);
    console.warn(`⚠️ personalization: ?pzn= variant "${forced}" is not listed in section "${entry.id}"`);
  }
  return listed;
}

const rules = (spec, env) => ruleOutcome(spec, env.context, {
  audiences: getAudiences(), withoutConsent: !env.consent,
});

/**
 * The decision fields for a section (contract section 4): override, bot,
 * consent, then the source; an api section's Rule rows decide when the
 * engine gives no usable answer.
 */
async function evaluate(entry, env) {
  const { spec } = entry;
  if (spec.errors.length) {
    return {
      source: spec.source, outcome: 'invalid', variant: 'default', reason: spec.errors[0],
    };
  }
  const forced = forcedVariant(entry);
  if (forced) return { source: 'override', outcome: 'override', ...pick(forced) };
  if (env.bot) return { source: 'bot', outcome: 'bot', variant: 'default' };
  const { consent } = env;
  const noConsent = { source: spec.source, outcome: 'no-consent', variant: 'default' };
  if (spec.source === 'rules') {
    if (!consent && !allowed('rules')) return noConsent;
    return { source: 'rules', ...rulesOutcome(await rules(spec, env)) };
  }
  if (spec.source === 'split') {
    if (!consent && !allowed('split')) return noConsent;
    return { source: 'split', ...splitOutcome(spec, splitArm(spec)) };
  }
  if (spec.source === 'target') {
    // Never through an exception.
    if (!consent) return noConsent;
    const result = (await env.target) || { error: 'Target was not asked' };
    if (result.error) {
      return {
        source: 'target', outcome: 'fallback', variant: 'default', reason: result.error,
      };
    }
    return { source: 'target', ...targetOutcome(spec, result.answers?.[spec.id], prefixes), test: { type: 'target' } };
  }
  // api
  if (!consent && !allowed('api')) {
    if (!allowed('rules') || !spec.rules.length) return noConsent;
    const ruled = rulesOutcome(await rules(spec, env));
    return {
      ...ruled, source: 'rules', outcome: 'no-consent',
    };
  }
  let engine;
  if (entry.eager && profile.slow) {
    engine = { outcome: 'fallback', variant: 'default', reason: `the ${config.api.engine} engine is too slow for the first section in the browser` };
  } else {
    const result = (await env.api) || { error: 'the engine was not asked' };
    engine = result.error
      ? { outcome: 'fallback', variant: 'default', reason: result.error }
      : {
        ...engineOutcome(spec, result.response.decisions[spec.id], prefixes),
        ...(result.cached ? { cached: true } : {}),
      };
  }
  if (RULE_FALLBACK.includes(engine.outcome) && spec.rules.length && (consent || allowed('rules'))) {
    const ruled = rulesOutcome(await rules(spec, env));
    return {
      ...ruled,
      source: 'rules',
      outcome: engine.outcome,
      reason: engine.reason,
      tracking: engine.tracking,
      cached: engine.cached,
    };
  }
  return { source: 'api', ...engine };
}

async function askApi(batch, context, consent) {
  try {
    const { apiAnswers } = await import('./sources/api.js');
    return await apiAnswers(batch.map((entry) => entry.spec), context, {
      config, consent, fetch: await fetcher(), timeout: config.api?.timeout || budgets.lazy,
    });
  } catch (error) {
    return { error: error.message, kind: 'error' };
  }
}

async function askTarget(batch, context) {
  try {
    const module = await targetTransport();
    return await module.decide(batch.map((entry) => entry.spec), context, {
      config, fetch: await fetcher(), timeout: config.target?.timeout,
    });
  } catch (error) {
    return { error: error.message, kind: 'error' };
  }
}

async function prepare(list, trigger) {
  const started = performance.now();
  const consent = syncConsent();
  const bot = isCrawler();
  const context = await getContext({
    consent, needGeo: list.some((entry) => sectionCriteria(entry.spec).has('geo')),
  });
  const live = (entry) => !entry.spec.errors.length && !bot && !forcedVariant(entry);
  const apiBatch = list.filter((entry) => live(entry) && entry.spec.source === 'api'
    && (consent || allowed('api')) && !(entry.eager && profile.slow));
  const targetBatch = list.filter((entry) => live(entry) && entry.spec.source === 'target' && consent);
  return {
    started,
    trigger,
    consent,
    bot,
    context,
    api: apiBatch.length ? askApi(apiBatch, context, consent) : null,
    target: targetBatch.length ? askTarget(targetBatch, context) : null,
  };
}

/**
 * Shows a new decision: swaps the content in, or keeps / restores the
 * default, then measures it.
 */
async function apply(entry, decision, { started, deadline, current = () => true }) {
  const before = entry.applied ? entry.shown : null;
  let { shown } = entry;
  let swapped = false;
  if (decision.variant !== 'default' && decision.path) {
    if (entry.shown !== decision.variant) {
      const nodes = await withBudget(fragmentNodes(decision.path), deadline);
      if (!current()) return;
      if (nodes && nodes !== TIMEOUT) {
        swapIn(entry, nodes);
        shown = decision.variant;
        swapped = true;
      } else {
        console.warn(`⚠️ personalization: fragment ${decision.path} ${nodes === TIMEOUT ? 'timed out' : 'failed'}; section "${entry.id}" shows its default`);
        if (!decision.reason) decision.reason = `fragment ${nodes === TIMEOUT ? 'timed out' : 'failed'}: ${decision.path}`;
        if (entry.shown !== 'default') swapped = await restoreDefault(entry);
        shown = 'default';
      }
    }
  } else if (entry.shown !== 'default') {
    swapped = await restoreDefault(entry);
    if (!current()) return;
    shown = swapped ? 'default' : entry.shown;
  }
  Object.assign(decision, { shown, result: resultFor(decision, shown, before) });
  entry.shown = shown;
  entry.applied = true;
  entry.decision = decision;
  entry.watch?.abort();
  entry.watch = new AbortController();
  writeAttributes(entry, decision);
  await show(entry, swapped);
  decision.appliedMs = performance.now() - started;
  row(entry, decision);
  measure(entry, decision);
  if (!entry.watch.signal.aborted && entry.decision === decision) {
    watchExposure(entry, decision, entry.section, { signal: entry.watch.signal });
  }
}

/**
 * Arms a target popup (Display popup): the section keeps its default, the
 * offer opens in a dialog when the trigger fires, once per decision.
 */
async function arm(entry, decision, current) {
  await lazy;
  if (!current()) return;
  const before = entry.applied ? entry.shown : null;
  let nodes = null;
  if (decision.path) {
    nodes = await fragmentNodes(decision.path);
    if (!current()) return;
    if (!nodes && !decision.reason) decision.reason = `fragment failed: ${decision.path}`;
    if (nodes) loadCSS(`${window.hlx?.codeBasePath || ''}/styles/target-popup.css`).catch(() => {});
  }
  const shown = nodes ? decision.variant : 'default';
  Object.assign(decision, { shown, result: resultFor(decision, shown, before) });
  entry.shown = shown;
  entry.applied = true;
  entry.decision = decision;
  entry.watch?.abort();
  entry.dialog?.close();
  entry.watch = new AbortController();
  const { signal } = entry.watch;
  writeAttributes(entry, decision);
  let status = 'none';
  if (nodes) status = 'armed';
  else if (decision.outcome === 'no-consent') status = 'waiting for consent';
  else if (decision.outcome === 'control') status = 'control';
  const popupRow = row(entry, decision, { popup: status });
  measure(entry, decision);
  // A control experience opens nothing, but Target still counts its display.
  if (!nodes && !(decision.outcome === 'control' && decision.tokens)) return;
  const cancel = onTrigger(entry.spec.trigger, entry.section, () => {
    if (signal.aborted) return;
    if (!nodes) {
      popupRow.popup = 'control (triggered)';
      log(popupRow);
      seen(entry, decision);
      return;
    }
    const dialog = openPopup(nodes, {
      label: decision.tracking?.['activity.name'] || 'Offer',
      onClose: () => {
        popupRow.popup = 'closed';
        log(popupRow);
        if (entry.dialog === dialog) entry.dialog = null;
      },
    });
    entry.dialog = dialog;
    popupRow.popup = 'open';
    log(popupRow);
    watchExposure(entry, decision, dialog.querySelector('.target-popup-content') || dialog, { visible: true, signal });
  });
  signal.addEventListener('abort', cancel);
}

/**
 * Decides one section and shows the result. A newer evaluation of the same
 * section wins; an older answer that arrives late is ignored.
 */
async function run(entry, ready, generation) {
  const current = () => generation === entry.generation;
  const env = await ready;
  if (!current()) return;
  const deadline = env.started + budgetOf(entry);
  let fields;
  try {
    fields = await withBudget(evaluate(entry, env), deadline);
  } catch (error) {
    console.error(`❌ personalization: section "${entry.id}" shows its default after an error:`, error);
    fields = {
      source: entry.spec.source, outcome: 'error', variant: 'default', reason: error.message,
    };
  }
  if (fields === TIMEOUT) {
    fields = {
      source: entry.spec.source, outcome: 'timeout', variant: 'default', reason: `no decision within ${budgetOf(entry)} ms`,
    };
  }
  if (!current()) return;
  const decision = makeDecision({
    id: entry.id,
    where: 'browser',
    ...fields,
    trigger: env.trigger,
    ms: performance.now() - env.started,
  });
  const key = identity(decision);
  if (entry.decision && key === entry.key && entry.where === 'browser') {
    // The same decision: nothing new is sent.
    log({
      ...entry.row, trigger: env.trigger, ms: Math.round(decision.ms), same: true, notifications: '',
    });
    return;
  }
  entry.key = key;
  entry.where = 'browser';
  entry.final = false;
  entry.count += 1;
  decision.decisionId = `${entry.id || 'invalid'}#${entry.count}`;
  if (entry.popup && !entry.spec.errors.length) await arm(entry, decision, current);
  else await apply(entry, decision, { started: env.started, deadline, current });
}

/**
 * One evaluation of a set of sections.
 * @param {object[]} list entries
 * @param {string} trigger initial | refresh | state | consent
 * @returns {Promise<void>}
 */
function evaluateAll(list, trigger) {
  if (!list.length) return Promise.resolve();
  const ready = prepare(list, trigger);
  return Promise.all(list.map((entry) => {
    entry.generation += 1;
    entry.runConsent = null;
    entry.resolving = run(entry, ready.then((env) => {
      entry.runConsent = env.consent;
      return env;
    }), entry.generation).catch((error) => console.error(`❌ personalization: section "${entry.id}":`, error));
    return entry.resolving;
  })).then(() => {});
}

// An edge `selected` section: the browser loads the selected variant.
async function loadSelected(entry) {
  entry.generation += 1;
  const { generation } = entry;
  const started = performance.now();
  await apply(entry, entry.decision, {
    started,
    deadline: started + budgetOf(entry),
    current: () => generation === entry.generation,
  });
}

// --- Consent changes ---

async function withdraw() {
  forgetVisitor();
  dropStoredState();
  await Promise.all(entries.map(async (entry) => {
    if (entry.spec.errors.length) return;
    if (entry.decision?.outcome === 'no-consent' && entry.shown === 'default') return;
    entry.generation += 1;
    const { generation } = entry;
    entry.dialog?.close();
    entry.count += 1;
    const decision = makeDecision({
      id: entry.id,
      decisionId: `${entry.id}#${entry.count}`,
      source: entry.spec.source,
      where: entry.where,
      outcome: 'no-consent',
      variant: 'default',
      trigger: 'consent',
      ms: 0,
    });
    entry.key = identity(decision);
    if (entry.popup) {
      entry.applied = false;
      await arm(entry, decision, () => generation === entry.generation);
    } else {
      const started = performance.now();
      await apply(entry, decision, {
        started,
        deadline: started + budgets.lazy,
        current: () => generation === entry.generation,
      });
    }
  }));
}

async function onRefresh() {
  const consent = syncConsent();
  const was = lastConsent;
  lastConsent = consent;
  const valid = entries.filter((entry) => !entry.spec.errors.length);
  if (was && !consent) return withdraw();
  if (!was && consent) {
    // Given: sections decided (or being decided) without consent.
    return evaluateAll(valid.filter((entry) => entry.decision?.outcome === 'no-consent'
      || entry.runConsent === false), 'consent');
  }
  return evaluateAll(valid.filter((entry) => !entry.final), 'refresh');
}

// A state change re-decides only the sections it can affect: Rule rows on
// that key, audience rules (which may read state) and, with consent, api
// sections when the engine reads state (engine profile `state`).
function onStateChanged(key) {
  const engineReadsState = profile.state && hasConsent();
  return evaluateAll(entries.filter((entry) => !entry.final && !entry.spec.errors.length
    && (stateKeysUsed(entry.spec).has(key) || sectionCriteria(entry.spec).has('audience')
      || (entry.spec.source === 'api' && engineReadsState))), 'state');
}

// --- Entry points ---

function hold(entry) {
  if (entry.section.dataset.sectionStatus === 'initialized') entry.section.dataset.sectionStatus = PENDING;
}

function readEdge(entry) {
  const edge = decisionFromAttributes(entry.spec, (name) => entry.section.getAttribute(`data-${name}`));
  if (!edge || entry.spec.errors.length || overrides.forced[entry.id]) {
    // Decided again here: the edge's content is what shows until then.
    if (edge?.status === 'applied') entry.shown = entry.section.getAttribute('data-pzn-variant') || 'default';
    return null;
  }
  if (edge.unlisted) {
    console.warn(`⚠️ personalization: the edge chose "${entry.section.getAttribute('data-pzn-variant')}", not listed in section "${entry.id}"`);
    if (edge.status === 'applied') entry.shown = entry.section.getAttribute('data-pzn-variant');
    else return null;
  }
  entry.where = 'edge';
  entry.final = true;
  entry.count = Number(edge.decision.decisionId.split('#')[1]) || 1;
  entry.decision = edge.decision;
  entry.edgeDecision = edge.decision;
  entry.key = identity(edge.decision);
  return edge;
}

/**
 * Call from loadEager right after decorateMain(main), and await it: when the
 * first section (LCP) is personalized, loadEager continues once it shows
 * (within the eager budget). Other sections are decided in the background.
 * @param {Element} main
 * @returns {Promise<void>}
 */
export async function personalizeSections(main) {
  if (entries.length) return;
  const pageExperiment = [...document.head.querySelectorAll('meta[name]')]
    .map((meta) => meta.getAttribute('name')).find((name) => EXPERIMENTATION_META.test(name));
  const first = main.querySelector(':scope > .section');
  const seenIds = new Set();
  main.querySelectorAll(SELECTOR)
    .forEach((section) => entries.push(readEntry(section, first, seenIds, pageExperiment)));
  if (!entries.length) return;
  lastConsent = syncConsent();
  const decide = [];
  const selected = [];
  entries.forEach((entry) => {
    const { spec } = entry;
    takeTemplate(entry);
    if (spec.errors.length) {
      console.warn(`⚠️ personalization: section "${spec.id || '?'}" shows its default; fix its Section Metadata:\n- ${spec.errors.join('\n- ')}`);
    }
    const edge = readEdge(entry);
    if (edge?.status === 'applied') {
      const { decision } = entry;
      entry.shown = entry.shown === 'default' ? decision.variant : entry.shown;
      entry.applied = true;
      decision.shown = entry.shown;
      decision.result = resultFor(decision, entry.shown, null);
      entry.watch = new AbortController();
      row(entry, decision);
      measure(entry, decision);
      watchExposure(entry, decision, entry.section, { signal: entry.watch.signal });
      return;
    }
    if (edge?.status === 'selected') {
      hold(entry);
      selected.push(entry);
      return;
    }
    if (spec.held && !spec.errors.length) hold(entry);
    decide.push(entry);
    if (entry.eager && spec.held && (previewHost || debug)) {
      console.warn(`⚠️ personalization: section "${spec.id}" is the first section (LCP) and stays hidden until decided (up to ${budgets.eager} ms); decide it at the edge or personalize a later section`);
    }
  });
  const held = entries.filter((entry) => entry.section.dataset.sectionStatus === PENDING);
  if (held.length) {
    order = [...main.querySelectorAll(':scope > .section')];
    order.slice(order.indexOf(held[0].section) + 1).forEach((section) => {
      if (section.dataset.sectionStatus === 'initialized') section.dataset.sectionStatus = WAITING;
    });
    watcher = new MutationObserver(() => release());
    order.forEach((section) => watcher.observe(section, { attributes: true, attributeFilter: ['data-section-status'] }));
    // Budgets bound every decision; this only guards against a runtime fault.
    setTimeout(() => {
      held.filter((entry) => entry.section.dataset.sectionStatus === PENDING).forEach((entry) => {
        console.error(`❌ personalization: section "${entry.id}" was still undecided; showing its default`);
        entry.generation += 1;
        entry.count += 1;
        apply(entry, makeDecision({
          id: entry.id,
          decisionId: `${entry.id || 'invalid'}#${entry.count}`,
          source: entry.spec.source,
          where: entry.where,
          outcome: 'timeout',
          variant: 'default',
          reason: 'failsafe',
          trigger: 'initial',
        }), { started: performance.now(), deadline: performance.now() });
      });
      release({ force: true });
    }, Math.max(budgets.eager, budgets.lazy) + 2000);
  }
  selected.forEach((entry) => { entry.resolving = loadSelected(entry); });
  evaluateAll(decide, 'initial');
  await entries.find((entry) => entry.eager)?.resolving;
}

/**
 * Call from loadLazy after loadSections(main): target popups may arm.
 * @param {Element} main
 */
// eslint-disable-next-line no-unused-vars
export function personalizeSectionsLazy(main) {
  markLazy();
}

register({ refresh: onRefresh, stateChanged: onStateChanged });

export default personalizeSections;
