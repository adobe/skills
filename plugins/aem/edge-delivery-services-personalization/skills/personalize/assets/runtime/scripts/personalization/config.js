/*
 * Site configuration for personalization (contract site-config.schema.json).
 * This file belongs to the site: install-runtime never overwrites it once it
 * exists. Never put API keys or personal data here.
 */

export default {
  // How consent is wired (contract section 3). Recorded at setup.
  //   mode 'cmp':   hasConsent reads the consent tool named in `tool`.
  //   mode 'allow': the site owner and legal confirmed no consent is needed.
  //   mode 'deny':  off until a consent tool is connected (the default).
  // withoutConsent: exceptions the site's privacy/legal team approved, from
  // rules, split, api, rum, data-layer; policyRef says where that approval is
  // recorded. Never add one without that approval.
  consent: { mode: 'deny' },

  // The one consent switch. Wire it to the consent tool when mode is 'cmp',
  // and make consent changes call window.hlx.personalization.refresh().
  // Return undefined while the tool hasn't answered yet.
  // eslint-disable-next-line no-unused-vars
  hasConsent: (category) => false,

  // Fragments a section may show. Anything else is refused.
  fragmentPrefixes: ['/fragments/'],

  // Milliseconds a section may stay hidden for its decision and fragment.
  // Then its default shows. "eager" is the first section, which holds the
  // LCP: prefer the edge there.
  budgets: { eager: 800, lazy: 2000 },

  // `device:` values, checked in order; the first matching media query wins.
  devices: {
    mobile: '(max-width: 599px)',
    tablet: '(min-width: 600px) and (max-width: 899px)',
    desktop: '(min-width: 900px)',
  },

  // Optional geo lookup for client mode, used only when neither the edge nor
  // a CDN cookie provides geo. A second origin before LCP: opt in knowingly.
  // Must answer { "country": "IN", "region": "KA" }.
  geo: { endpoint: '', timeout: 500 },

  // Decision engine for `Personalization Source | api` sections (contract
  // section 5). A same-origin server route that holds the engine's
  // credentials (the edge route /pzn/decide, or the engine's proxy).
  api: {
    endpoint: '',
    // Engine profile: 'generic' or 'of1' (limits the validator checks).
    engine: 'generic',
    // ms for the engine request; the section budget still applies.
    timeout: 1500,
    // Optional decision-feedback beacon URL (sent only with consent).
    feedback: '',
    // Adapters for a keyless engine that speaks another shape:
    // mapRequest(v1) -> { url?, init?, body }, mapResponse(json, v1) -> v1 response.
    // Leave both null for the edge route: it speaks v1.
    mapRequest: null,
    mapResponse: null,
  },

  // Adobe Target for `Personalization Source | target` sections (contract
  // section 7). Called only with consent.
  target: {
    // 'delivery-api' (no Web SDK on the page) or 'websdk' (reuse alloy).
    transport: 'delivery-api',
    clientCode: '',
    // Workspace property token (at_property), when activities use one.
    propertyToken: '',
    // delivery-api only: optional same-origin proxy (or the local mock).
    endpoint: '',
    // websdk only: global name of the alloy instance.
    // alloyInstance: 'alloy',
    timeout: 3000,
  },

  // `audience: <name>` rows: name -> (context) => boolean | Promise<boolean>.
  audiences: {
    // 'logged-in': () => document.cookie.includes('login-token='),
  },

  // Where ?pzn... preview params work: 'preview' (aem.page, localhost),
  // 'always' or 'never'.
  overrides: 'preview',

  // Crawlers and performance tools always get the default (no cloaking).
  botsGetDefault: true,

  // Measurement (contract section 9). seenThreshold: share of the section
  // that must be visible for pzn:seen.
  analytics: { dataLayer: true, rum: true, seenThreshold: 0.25 },

  // Demos and tests only: answer the engine and Target in the browser
  // (mocks.js). Must be false at launch.
  mock: false,
};
