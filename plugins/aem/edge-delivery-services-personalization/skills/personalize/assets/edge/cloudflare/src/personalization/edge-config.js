/*
 * Edge personalization configuration (contract sections 3, 5 and 8). This
 * file belongs to the site: install-edge never overwrites it once it exists.
 * Keep fragmentPrefixes, consent, botsGetDefault and api.engine aligned with
 * scripts/personalization/config.js. Never put secrets here.
 */

export default {
  fragmentPrefixes: ['/fragments/'],

  // The edge decides only with the pzn-consent cookie (mirrored by the
  // browser from the consent tool) or an exception the site's privacy/legal
  // team approved. Copy withoutConsent and policyRef from config.js.
  consent: { withoutConsent: [], policyRef: '' },

  // Crawlers always get the default (no cloaking).
  botsGetDefault: true,

  // Preview overrides on the edge host: 'never' (recommended for production),
  // 'preview' or 'always'. When overrides are active the edge leaves every
  // section to the browser.
  overrides: 'never',

  // Edge budget per variant fragment, in ms; a slower or failing fragment
  // leaves the section to the browser.
  fragmentTimeout: 1000,

  api: {
    // Upstream decision engine. env.PZN_API_ENDPOINT wins when set.
    endpoint: '',
    // Engine profile: 'generic' or 'of1'. of1 gets descriptions filled from
    // the fragments and the authored section, and never decides the first
    // section in the browser.
    engine: 'generic',
    // Edge budget in ms for the engine; then the section's Rule rows, else
    // the browser decides.
    timeout: 300,
    // Budget in ms for browser requests through apiRoute.
    routeTimeout: 2000,
    // Secrets come from `wrangler secret put PZN_API_KEY`, never from code.
    headers: (env) => (env.PZN_API_KEY ? { authorization: `Bearer ${env.PZN_API_KEY}` } : {}),
    // Adapters for engines that don't speak v1:
    // mapRequest(v1) -> { url?, init?, body }, mapResponse(json, v1) -> v1 response.
    // They apply to edge decisions and to apiRoute. For OF1:
    //   import { createOf1Adapter } from './adapters/of1.js';
    //   const of1 = createOf1Adapter({ tenant: '<owner>/<site>' });
    //   mapRequest: of1.mapRequest, mapResponse: of1.mapResponse,
    mapRequest: null,
    mapResponse: null,
  },

  // Same-origin route that forwards browser engine requests with the
  // credentials attached. Point config.api.endpoint in the browser runtime
  // here. Only v1 requests from this site's pages, with consent or the
  // approved `api` exception, are forwarded. Empty disables the route.
  apiRoute: '/pzn/decide',
};
