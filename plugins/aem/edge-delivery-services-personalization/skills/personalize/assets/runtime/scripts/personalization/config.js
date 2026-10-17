/*
 * Site configuration for personalization. This file belongs to the site:
 * install-runtime never overwrites it once it exists.
 */

export default {
  // Fragments a placeholder may render. Anything else is rejected.
  fragmentPrefixes: ['/fragments/'],

  // Decision budget in ms. A placeholder still undecided after its budget
  // renders its default. "eager" applies to placeholders in the first section.
  budgets: { eager: 800, lazy: 2000 },

  // `device:` values, checked in order; the first matching media query wins.
  devices: {
    mobile: '(max-width: 599px)',
    tablet: '(min-width: 600px) and (max-width: 899px)',
    desktop: '(min-width: 900px)',
  },

  // Optional geo lookup for client mode, used only when neither the edge worker
  // nor a CDN cookie provides geo. A second origin before LCP: opt in knowingly.
  // Must answer { "country": "IN", "region": "KA" }.
  geo: { endpoint: '', timeout: 500 },

  // Decision engine, used by placeholders with a `source | api` row.
  // Use a same-origin path fronted by the CDN; never put API keys here.
  api: {
    endpoint: '',
    // The engine is only called with consent, unless this is true.
    sendWithoutConsent: false,
    // Adapters for engines that do not speak the canonical v1 contract:
    // mapRequest(v1Request) -> { url?, init?, body }, mapResponse(json) -> v1Response
    // Leave both null when endpoint is the edge route (/pzn/decide): the
    // route speaks v1 and applies edge-config.js adapters itself.
    mapRequest: null,
    mapResponse: null,
  },

  // Custom audiences for `audience: <name>` rows. Same signature as
  // aem-experimentation: name -> (context) => boolean | Promise<boolean>.
  audiences: {
    // 'logged-in': () => document.cookie.includes('login-token='),
  },

  // Consent for storage (returning visitor, persisted state) and for sending
  // context to the decision engine. Wire this to the site's CMP.
  // Privacy-safe default: no consent until the site says otherwise.
  // eslint-disable-next-line no-unused-vars
  hasConsent: (category) => false,

  // Preview overrides (?pzn=, ?pzn-geo=, ...): 'preview' = aem.page and
  // localhost only, 'always', or 'never'.
  overrides: 'preview',

  // Crawlers always get the default variant (no cloaking).
  botsGetDefault: true,

  // Exposure tracking.
  analytics: { dataLayer: true, rum: true },
};
