# Edge Mode: Cloudflare Workers

Edge mode is for **BYO CDN on Cloudflare** only (the Adobe-managed CDN runs no custom code). It is an
upgrade on top of client mode, which stays installed.

## Generate

```bash
node skills/personalize/scripts/install-edge.mjs <project> \
  [--dir cdn/cloudflare-worker] [--name <worker>] [--origin main--<repo>--<owner>.aem.live] \
  [--route www.example.com/*] [--account <cloudflare account id>] [--dry-run]
```

- `src/aem-worker.mjs`: official `adobe/aem-cloudflare-prod-worker`, vendored **unchanged**
  (Apache-2.0, `LICENSE_APACHE`). Upgrade by re-vendoring, never edit.
- `src/index.mjs`: wrapper that adds the decision route and post-processes HTML.
- `src/personalization/`: `personalize.js`, `html.js` (skill), `rules.js` / `contract.js` /
  `context.js` / `provider-api.js` (copied from `scripts/personalization/`, re-run install-edge
  after updating them),
  `edge-config.js` (site-owned).
- `wrangler.toml` from the template; `ORIGIN_HOSTNAME` inferred from the git remote.
- The worker dir's top folder is added to `.hlxignore` so it is not served by EDS.

**Existing worker** (`--existing <dir>`): only `src/personalization/` is added and the wrap
instructions are printed. Apply the wrap to the entry point and show the diff in the summary.

## Request flow

1. `POST /pzn/decide` (configurable `apiRoute`) is proxied to `PZN_API_ENDPOINT` with
   `Authorization: Bearer $PZN_API_KEY`. Only same-origin v1 requests with the `pzn-consent`
   cookie are forwarded, as a body rebuilt from contract fields; `edge-config.js` adapters then
   translate it. Errors: 405 non-POST, 503 not configured, 403 cross-origin or no consent, 429
   rate limited (`PZN_RATE_LIMITER` binding, see `wrangler.toml`), 413 > 16 KB, 400 not a v1
   request, 502 `{ "decisions": {} }` when the engine fails. Point the browser
   `config.api.endpoint` here, with no browser adapters, so the key never reaches the browser.
2. Everything else goes through the official worker (origin fetch, **cache key unchanged**).
3. HTML 200 GET responses (not `.plain.html`) with Personalization blocks are post-processed:
   - context: `cf.country` / `cf.regionCode`, cookies (`pzn-seen`, `pzn-vs`, `pzn-consent`), URL params;
   - `source | api` placeholders: one engine call (300 ms budget, only with the `pzn-consent`
     cookie unless `sendWithoutConsent`), cached in the Cache API when the response is
     `cacheable` with `ttl > 0`;
   - each decided block gets `data-pzn-source="edge" data-pzn-variant="<variant>"` (plus
     `data-pzn-fragment="<path>"` for fragment targets, so engine-picked fragments that no rule
     names still render) and the variant fragment gets `<link rel="preload" … as="fetch">`;
   - blocks needing device/state/audience are left as is (deferred to the browser);
   - `<meta name="pzn-geo">` is injected when any rule uses geo, so the browser agrees for deferred
     placeholders;
   - headers: `Cache-Control: private, no-cache`, `ETag` removed, `x-pzn: edge | deferred`.
4. Bots (`cf.botManagement.verifiedBot` or a UA match, including Lighthouse/PSI) get the default.
5. Requests with preview overrides (`?pzn…`, except `?pzn-debug`) leave everything to the browser
   (when `edge-config.overrides` allows them; default `never`).
6. Any processing error serves the origin HTML unchanged.

The browser runtime sees `data-pzn-source="edge"`, skips its own decision and renders that variant.
Later `setState()` / `refresh()` calls decide in the browser.

## Configuration

`edge-config.js`: `fragmentPrefixes`, `botsGetDefault`, `overrides`, `api` (`endpoint`, `timeout`,
`sendWithoutConsent`, `headers(env)`, `mapRequest`, `mapResponse`), `apiRoute`. Keep prefixes and
bot policy identical to `config.js`. `wrangler.toml` `[vars] PZN_API_ENDPOINT` overrides
`api.endpoint`. Secrets only via `wrangler secret put`.

## Local test

```bash
# Edge logic over any HTML (preview or local), faking request.cf and the UA:
node skills/personalize/scripts/simulate.mjs https://main--<repo>--<owner>.aem.page/<page> --edge --country IN
node skills/personalize/scripts/simulate.mjs content/<page>.html --edge --country US --region CA --cookie "pzn-seen=1"
node skills/personalize/scripts/simulate.mjs https://main--<repo>--<owner>.aem.page/<page> --edge --ua Googlebot

# The real worker (origin must be main--*--*.aem.live, so use https locally):
cd <project>/cdn/cloudflare-worker
npx wrangler dev --local-protocol https
curl -sk -D - -o /dev/null https://localhost:8787/
curl -sk -XPOST https://localhost:8787/pzn/decide -d '{}'     # 503 until PZN_API_ENDPOINT is set, then 403 (no Origin)
curl -sk -XPOST https://localhost:8787/pzn/decide -H 'origin: https://localhost:8787' \
  -H 'cookie: pzn-consent=1' -d '{"version":"1","placeholders":[{"id":"offer","candidates":["default"]}],"context":{"consent":{"personalization":true}}}'
npx wrangler deploy --dry-run --outdir /tmp/pzn-worker           # bundle check, no upload
```

Pages only reach `aem.live` after publish, so before publish rely on `simulate.mjs --edge`.
Expected: `x-pzn: edge` with the right `data-pzn-variant`, the Googlebot run shows the default,
`cache-control: private, no-cache`.

## Deploy handoff (never run without an explicit request)

```bash
npx wrangler secret put PZN_API_KEY          # only with a decision engine
npx wrangler secret put ORIGIN_AUTHENTICATION  # only for protected sites
npx wrangler deploy
```

Then follow the AEM BYO CDN Cloudflare setup (route, push invalidation, `X-Forwarded-Host`) and
verify on production with a non-bot browser and with `curl -A Googlebot`.
