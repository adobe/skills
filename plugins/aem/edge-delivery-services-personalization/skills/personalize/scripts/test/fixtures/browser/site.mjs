/*
 * A minimal EDS site for the browser runtime tests (sections.test.mjs): the
 * skill's runtime modules, a test config.js (contract site-config shape), an
 * aem.js stub with the boilerplate's loadSection semantics, the fragment
 * block, a scripts.js stub (decorateMain, used to decorate a restored edge
 * default), fragments, and pages as the pipeline delivers them (Section
 * Metadata already rendered as data-* attributes).
 */

import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RUNTIME_DIR, RUNTIME_MODULES } from '../../../lib.mjs';

// window.testConfig (set before the page loads) overrides keys; api, target,
// analytics and budgets merge one level deep.
export const CONFIG = `const base = {
  consent: { mode: 'cmp', tool: 'custom' },
  hasConsent: () => window.testConsent,
  fragmentPrefixes: ['/fragments/'],
  budgets: { eager: 1500, lazy: 1500 },
  devices: { mobile: '(max-width: 599px)', desktop: '(min-width: 600px)' },
  geo: { endpoint: '', timeout: 500 },
  api: {
    endpoint: '/decide', engine: 'generic', timeout: 1200, feedback: '', mapRequest: null, mapResponse: null,
  },
  target: {
    transport: 'delivery-api', clientCode: 'acme', propertyToken: '', endpoint: '', timeout: 3000,
  },
  analytics: { dataLayer: true, rum: true, seenThreshold: 0.5 },
  audiences: {},
  overrides: 'preview',
  botsGetDefault: true,
  mock: false,
};
const test = window.testConfig || {};
const merged = { ...base, ...test };
['api', 'target', 'analytics', 'budgets'].forEach((key) => {
  if (test[key]) merged[key] = { ...base[key], ...test[key] };
});
export default merged;`;

// loadSection / loadSections as in the boilerplate's aem.js, minus blocks.
export const AEM = `export function sampleRUM(checkpoint, data) { (window.testRum = window.testRum || []).push({ checkpoint, ...data }); }
export async function loadCSS(href) {
  if (document.querySelector(\`link[href="\${href}"]\`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}
export async function loadSection(section) {
  const status = section.dataset.sectionStatus;
  if (!status || status === 'initialized') {
    section.dataset.sectionStatus = 'loading';
    section.dataset.sectionStatus = 'loaded';
    section.style.display = null;
  }
}
export async function loadSections(main) {
  for (const section of main.querySelectorAll('div.section')) {
    // eslint-disable-next-line no-await-in-loop
    await loadSection(section);
  }
}`;

// decorateMain marks links, so a test can tell a restored default was decorated.
export const SCRIPTS = `export function decorateMain(main) {
  main.querySelectorAll('a').forEach((a) => { a.dataset.decorated = 'true'; });
}`;

export const FRAGMENT_BLOCK = `export async function loadFragment(path) {
  const resp = await fetch(\`\${path}.plain.html\`);
  if (!resp.ok) return null;
  const main = document.createElement('main');
  main.innerHTML = await resp.text();
  main.querySelectorAll(':scope > div').forEach((div) => div.classList.add('section'));
  return main;
}`;

export const FRAGMENTS = {
  'hero/india': '<h1>India hero</h1>',
  'hero/quiz-a': '<h1>Quiz A hero</h1>',
  'plan/enterprise': '<h2>Enterprise plan</h2><p><a href="/contact?ref=x">Book</a></p>',
  'plan/agency': '<h2>Agency plan</h2>',
  'plan/mobile': '<h2>Mobile plan</h2>',
  'msg/speed': '<h2>Speed</h2>',
  'msg/team': '<h2>Team</h2>',
  'pick/x': '<p>X</p>',
  'pick/y': '<p>Y</p>',
  'offer/free-trial': '<p>BEFORE YOU GO</p><h2>Free trial</h2><p><a href="/trial">Start</a></p>',
  'offer/welcome-back': '<h2>Welcome back</h2><p><a href="/plans">Plans</a></p>',
  'offer/enterprise': '<h2>Enterprise demo</h2>',
  'inline-offer/promo': '<h2>Inline promo</h2><p><a href="/promo">Go</a></p>',
  'inline-offer/alt': '<h2>Inline alt</h2>',
  'edged/x': '<p>Edge X</p>',
  'sel/a': '<h2>Sel A</h2>',
  'sel/b': '<h2>Sel B</h2><p><a href="/b">B</a></p>',
  'later/one': '<h2>Later one</h2>',
  'personalization/home-hero/pro': '<h1>Pro espresso</h1><p><a href="https://www.example.com/espresso">Shop</a></p>',
  'personalization/home-hero/deals': '<h1>Deals</h1><p><a href="https://www.example.com/espresso">Deals on espresso</a></p>',
  'personalization/promo/festive': '<h2>Festive promo</h2>',
  'personalization/promo/clearance': '<h2>Clearance</h2>',
};

// Engine table (mock-engine.js grammar) the test server answers with by default.
export const ENGINE_TABLE = {
  ttl: 0,
  placeholders: {
    plan: {
      'param: utm_campaign=enterprise': 'enterprise',
      'param: utm_campaign=control': { control: true },
      'param: utm_campaign=keep': 'default',
      'param: utm_campaign=unsure': { reason: 'low_confidence' },
      'param: utm_content=rogue': 'unlisted',
      'device: mobile': 'mobile',
    },
    later: { '*': 'one' },
  },
};

// Target activities (mock-engine.js), answered through a Playwright route.
export const ACTIVITIES = {
  offer: {
    name: 'Scroll offer',
    experiences: [
      { name: 'Enterprise', audience: 'param: utm_campaign=enterprise', offer: '/fragments/offer/enterprise' },
      { name: 'Returning', audience: 'visitor: returning', offer: '/fragments/offer/welcome-back' },
      { name: 'Everyone', audience: null, offer: '/fragments/offer/free-trial' },
    ],
  },
  'inline-offer': {
    name: 'Inline offer',
    experiences: [
      { name: 'Control', audience: 'param: utm_campaign=control', control: true },
      { name: 'All', audience: null, offer: '/fragments/inline-offer/promo' },
    ],
  },
};

const fragmentList = (...paths) => paths.map((path) => `/fragments/${path}`).join(',');

/**
 * A delivered section: Section Metadata rows as data-* attributes.
 * @param {object} rows attribute name (without data-) -> value
 * @param {string} body
 * @param {{classes?: string, style?: string}} [options]
 * @returns {string}
 */
export function section(rows, body, { classes = '', style = '' } = {}) {
  const attrs = Object.entries(rows)
    .map(([name, value]) => ` data-${name}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('');
  return `<div${classes ? ` class="${classes}"` : ''}${style ? ` style="${style}"` : ''}${attrs}>${body}</div>`;
}

/**
 * Section Metadata rows of a contract section object (section.schema.json).
 * @param {object} object
 * @returns {object}
 */
export function sectionRows(object) {
  const rows = { personalization: object.id };
  if (object.source && object.source !== 'rules') rows['personalization-source'] = object.source;
  rows['personalization-variants'] = object.variants.map((variant) => variant.fragment).join(',');
  (object.rules || []).forEach((rule) => { rows[`personalization-rule-${rule.variant}`] = rule.condition; });
  if (object.hint) rows['personalization-hint'] = object.hint;
  Object.entries(object.descriptions || {}).forEach(([name, text]) => {
    rows[`personalization-description-${name}`] = text;
  });
  return rows;
}

export const spacer = section({}, '<p>spacer</p>', { style: 'height:1200px' });

const MAIN = [
  section({
    personalization: 'hero',
    'personalization-variants': fragmentList('hero/india', 'hero/quiz-a'),
    'personalization-rule-india': 'geo: IN',
    'personalization-rule-quiz-a': 'state: persona=a',
  }, '<h1>Authored hero</h1>', { classes: 'hero dark' }),
  spacer,
  section({
    personalization: 'plan',
    'personalization-source': 'api',
    'personalization-variants': fragmentList('plan/enterprise', 'plan/agency', 'plan/mobile', 'plan/missing'),
    'personalization-rule-agency': 'param: utm_source=agency',
  }, '<h2>Authored plan</h2><p><a href="/authored">Authored link</a></p>', { style: 'min-height:400px' }),
  section({
    personalization: 'msg', 'personalization-source': 'split', 'personalization-variants': fragmentList('msg/speed', 'msg/team'),
  }, '<h2>Authored msg</h2>'),
  section({
    personalization: 'pick', 'personalization-source': 'split', 'personalization-split': '0, 100', 'personalization-variants': fragmentList('pick/x', 'pick/y'),
  }, '<p>Authored pick</p>'),
  section({
    personalization: 'inline-offer', 'personalization-source': 'target', 'personalization-variants': fragmentList('inline-offer/promo', 'inline-offer/alt'),
  }, '<h2>Authored inline offer</h2>'),
  section({ personalization: 'broken', 'personalization-source': 'bogus', 'personalization-variants': fragmentList('pick/x') }, '<p>Authored broken</p>'),
  spacer,
  section({
    personalization: 'offer',
    'personalization-source': 'target',
    'personalization-trigger': 'scroll: 70%',
    'personalization-variants': fragmentList('offer/free-trial', 'offer/welcome-back', 'offer/enterprise'),
  }, '<h2>Authored offer section</h2>'),
  spacer,
  spacer,
];

// What the edge hands over (contract section 8): an applied section with its
// default in a template, a selected one, and one left to the browser.
const EDGE = [
  section({
    personalization: 'edged',
    'personalization-variants': fragmentList('edged/x'),
    'personalization-rule-x': 'geo: IN',
    'pzn-where': 'edge',
    'pzn-status': 'applied',
    'pzn-variant': 'x',
    'pzn-source': 'rules',
    'pzn-outcome': 'variant',
    'pzn-decision': 'edged#1',
  }, '<p>Edge X</p><template data-pzn-default><p>Authored edged <a href="/edged">more</a></p></template>'),
  section({
    personalization: 'sel',
    'personalization-source': 'api',
    'personalization-variants': fragmentList('sel/a', 'sel/b'),
    'pzn-where': 'edge',
    'pzn-status': 'selected',
    'pzn-variant': 'b',
    'pzn-source': 'api',
    'pzn-outcome': 'variant',
    'pzn-decision': 'sel#1',
    'pzn-cached': 'true',
    'pzn-tracking': JSON.stringify({ engine: 'of1', requestId: 'r-7' }),
  }, '<h2>Authored sel</h2>'),
  spacer,
  section({
    personalization: 'later', 'personalization-source': 'api', 'personalization-variants': fragmentList('later/one'),
  }, '<h2>Authored later</h2>'),
];

// Captures measurement events from the start; decorates sections like aem.js
// decorateSections; runs the loadEager / loadLazy hooks as scripts.js does.
const BOOT = `<script>
  window.testEvents = [];
  ['pzn:decided', 'pzn:applied', 'pzn:seen', 'pzn:clicked', 'pzn:notified'].forEach((name) => document.addEventListener(name,
    (e) => window.testEvents.push({ event: name, personalization: e.detail })));
</script>`;
const RUN = `<script type="module">
  import { personalizeSections, personalizeSectionsLazy } from '/scripts/personalization/sections.js';
  import { loadSections } from '/scripts/aem.js';
  window.hlx = window.hlx || {};
  window.hlx.codeBasePath = '';
  const main = document.querySelector('main');
  main.querySelectorAll(':scope > div').forEach((div) => {
    div.classList.add('section');
    div.dataset.sectionStatus = 'initialized';
    div.style.display = 'none';
  });
  window.testDone = (async () => {
    await personalizeSections(main);
    await loadSections(main);
    personalizeSectionsLazy(main);
  })();
</script>`;

/**
 * A page as the pipeline (or the edge) delivers it.
 * @param {string[]|string} sections
 * @returns {string}
 */
export function page(sections) {
  return `<!DOCTYPE html><html lang="en"><head><title>Test</title>${BOOT}</head><body><main>${[].concat(sections).join('\n')}</main>${RUN}</body></html>`;
}

/**
 * The runtime script tags added to an HTML document (e.g. the edge's output).
 * @param {string} html
 * @returns {string}
 */
export function withRuntime(html) {
  return html.replace('</head>', `${BOOT}</head>`).replace('</body>', `${RUN}</body>`);
}

export const PAGES = { '/page.html': page(MAIN), '/edge.html': page(EDGE) };

/**
 * Writes the site into dir.
 * @param {string} dir
 */
export function buildSite(dir) {
  RUNTIME_MODULES.forEach((name) => {
    const target = join(dir, 'scripts', 'personalization', name);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(RUNTIME_DIR, 'scripts', 'personalization', name), target);
  });
  writeFileSync(join(dir, 'scripts', 'personalization', 'config.js'), CONFIG);
  writeFileSync(join(dir, 'scripts', 'aem.js'), AEM);
  writeFileSync(join(dir, 'scripts', 'scripts.js'), SCRIPTS);
  mkdirSync(join(dir, 'blocks', 'fragment'), { recursive: true });
  writeFileSync(join(dir, 'blocks', 'fragment', 'fragment.js'), FRAGMENT_BLOCK);
  mkdirSync(join(dir, 'styles'), { recursive: true });
  cpSync(join(RUNTIME_DIR, 'styles', 'target-popup.css'), join(dir, 'styles', 'target-popup.css'));
  Object.entries(FRAGMENTS).forEach(([name, body]) => {
    const file = join(dir, 'fragments', `${name}.plain.html`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `<div>${body}</div>`);
  });
}
