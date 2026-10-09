/*
 * Edge personalization configuration. This file belongs to the site:
 * install-edge never overwrites it once it exists. Keep fragmentPrefixes,
 * botsGetDefault and overrides aligned with scripts/personalization/config.js.
 */

export default {
  fragmentPrefixes: ['/fragments/'],

  // Crawlers always get the default variant (no cloaking).
  botsGetDefault: true,

  // Preview overrides on the edge host: 'never' (recommended for production),
  // 'preview' or 'always'. When overrides are active the edge leaves every
  // placeholder to the browser.
  overrides: 'never',

  api: {
    // Upstream decision engine. env.PZN_API_ENDPOINT wins when set.
    endpoint: '',
    // Edge budget in ms; on timeout the edge falls back to authored rules.
    timeout: 300,
    // Called only with consent (pzn-consent cookie), unless this is true.
    sendWithoutConsent: false,
    // Secrets come from `wrangler secret put PZN_API_KEY`, never from code.
    headers: (env) => (env.PZN_API_KEY ? { authorization: `Bearer ${env.PZN_API_KEY}` } : {}),
    // Adapters for engines that do not speak the canonical v1 contract:
    // mapRequest(v1Request) -> { url?, init?, body }, mapResponse(json) -> v1Response.
    // They apply to edge decisions and to apiRoute. When the browser calls
    // apiRoute, it speaks v1: keep the adapters here, not in config.js.
    mapRequest: null,
    mapResponse: null,
  },

  // Same-origin route that proxies browser decision requests to the engine
  // with the secret attached. Point config.api.endpoint in the browser
  // runtime here. Only v1 requests from this site's pages with the
  // pzn-consent cookie are forwarded. Empty disables the route.
  apiRoute: '/pzn/decide',
};
