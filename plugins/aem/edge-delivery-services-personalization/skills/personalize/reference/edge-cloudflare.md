# Edge Mode: Cloudflare Workers (contract sections 4, 8 and 10)

## What edge mode is

- **Where it runs.** Edge mode is for a **BYO CDN on Cloudflare** only; the Adobe-managed CDN runs
  no custom code.
- **What it adds.** It is an addition on top of client mode, which stays installed. It decides
  `rules`, `split` and `api` sections before the HTML leaves the CDN, so the section is never
  hidden in the browser. That makes it the right place for a personalized **first section**
  (LCP).
- **What stays in the browser.** `target` sections always run in the browser.
- **One edge decider per site.** It is the skill's worker or an engine's own proxy (for example
  OF1's), never both for the same section.
- **Prerequisite.** It needs Section Metadata rendered as section attributes (rendering v2,
  `authoring-model.md`).

## Contents

- Generate
- Request flow
- The three edge results
- Configuration
- Local test
- Deploy handoff

## Generate

```bash
node scripts/install-edge.mjs <project> \
  [--dir cdn/cloudflare-worker] [--name <worker>] [--origin main--<repo>--<owner>.aem.live] \
  [--route www.example.com/*] [--account <cloudflare account id>] [--dry-run]
```

It generates these files:

- `src/aem-worker.mjs`: the official `adobe/aem-cloudflare-prod-worker`, vendored **unchanged**
  (Apache-2.0, `LICENSE_APACHE`). Upgrade it by vendoring it again; never edit it.
- `src/index.mjs`: the wrapper that adds the decision route and post-processes HTML. It builds
  `fetchFragment(path)` on the official worker (`<path>.plain.html`, same host), so fragments use
  the same origin, auth and cache settings as pages.
- `src/personalization/`:
  - `personalize.js`, `html.js` and `adapters/of1.js` (skill-owned);
  - `rules.js`, `section-spec.js`, `outcomes.js`, `contract.js`, `context.js`, `provider-api.js`
    and `sources/split.js`, copied unchanged from `scripts/personalization/`. Re-run install-edge
    after updating them;
  - `edge-config.js` (site-owned, never overwritten).
- `wrangler.toml`, from the template. `name` comes from the repo and `ORIGIN_HOSTNAME` from the
  git remote; `route` and `account_id` stay commented out until given.

The worker folder's top-level directory is added to `.hlxignore`, so EDS doesn't serve it.

**Existing worker** (`--existing <dir>`): only `src/personalization/` is added, and the wrap
instructions are printed. Apply the wrap to the entry point and show the diff in the summary:

```js
import config from './personalization/edge-config.js';
import { handleApiRoute, personalizeResponse } from './personalization/personalize.js';

// inside fetch(request, env, ctx); originFetch = the worker's own origin fetch
const fetchFragment = (path) => originFetch(new URL(`${path}.plain.html`, request.url));
// before the origin fetch:
const routed = await handleApiRoute(request, env, config, { fetchPlain: fetchFragment });
if (routed) return routed;
// after the existing logic produced `response`:
return personalizeResponse(request, response, { config, env, cf: request.cf, ctx, fetchFragment });
```

## Request flow

1. **`POST /pzn/decide`** (`apiRoute`) is the server route for browser engine requests
   (`decision-api.md`). Point the browser's `config.api.endpoint` there and leave the browser
   adapters empty, so the key never reaches the browser.
2. **Everything else** goes through the official worker. The origin fetch and its **cache key are
   unchanged**.
3. **HTML GET responses** (status 200, not `.plain.html`) that contain personalized sections are
   post-processed:
   - **Consent.** The edge decides only with the `pzn-consent=1` cookie, or under an approved
     exception in `edge-config.js` `consent`. Without either, every section is left to the
     browser.
   - **Context.** `cf.country` and `cf.regionCode`; the cookies `pzn-seen` and `pzn-vs` (with
     consent only), `pzn-consent` and `pzn-split`; the URL params; and the referrer host. Device,
     state and audiences are unknown at the edge.
   - **Engine.** One call for the page's `api` sections that the edge may decide. Sections it
     would leave to the browser are not sent. The call has a 300 ms budget, and its answer is
     cached under the shared key only with `cacheable: true` and `ttl > 0`
     (`decision-api.md` § Caching).
   - **Decision.** Each section is decided with the shared code. For `api` sections: the engine's
     answer, then the Rule rows, then the default. For `split` sections: the cookie, or a new
     draw.
   - **Split cookie.** A new split assignment is sent as
     `Set-Cookie: pzn-split=…; Path=/; SameSite=Lax; Secure`.
   - **Geo meta.** `<meta name="pzn-geo">` is injected when a rule uses geo, so the browser agrees
     on the sections the edge left.
   - **Headers.** `Cache-Control: private, no-cache`; `ETag` and `Content-Length` are removed;
     `x-pzn` is `edge` or `deferred`.
4. **Bots** (`cf.botManagement.verifiedBot`, or a user-agent match such as Lighthouse or PSI) get
   the default, with no engine call and no split cookie.
5. **Preview overrides** (`?pzn…`), when `edge-config.overrides` allows them (the default is
   `never`), and pages with AEM Experimentation page metadata, are left entirely to the browser.
6. **Any processing error** serves the origin HTML unchanged, and the browser decides.

## The three edge results

| Result | When | Marked as | The browser |
|---|---|---|---|
| **Applied** | Decided, and the HTML swapped (or kept, when the decision is the default) | `data-pzn-where="edge" data-pzn-status="applied"`, plus `<template data-pzn-default>` holding the authored content when a variant is shown | Measures only; never decides it again |
| **Selected** | Decided, but the fragment couldn't be fetched here, for a section the browser may not decide | `data-pzn-status="selected"` | Loads and swaps the selected variant; doesn't decide again |
| **Left** | No consent cookie or exception; a `target` section; Rule rows that need `device`, `state` or `audience`; invalid rows; the engine timed out or failed with no matching rule; the fragment failed | Not marked | Decides it as in client mode |

Both marked kinds carry `data-pzn-variant`, `-source`, `-outcome`, `-reason`, `-decision` (`<id>#1`),
`-cached` (when the answer came from a cache) and `-tracking` (the engine's `tracking`, at most
1 KB). The browser sends `pzn:decided` and `pzn:applied` with `where: "edge"` and those values,
then `seen` and `clicked` as usual.

**Sections the browser may not decide.** For a slow engine (`of1`) on the first section, the
edge doesn't leave the section when it stops waiting. It applies the default with outcome
`timeout`, so the browser doesn't call the engine again.

**Final for the page view.** A marked section changes only when:

- consent is withdrawn: the default comes back from the template, with outcome `no-consent`;
- a preview `?pzn=` override is used.

## Configuration

`edge-config.js` has these keys:

- `fragmentPrefixes`;
- `consent: { withoutConsent, policyRef }`, copied from `config.js`;
- `botsGetDefault`;
- `overrides` (`never` in production);
- `fragmentTimeout` (1000);
- `api`: `endpoint`, `engine`, `timeout` (300), `routeTimeout` (2000), `headers(env)`,
  `mapRequest`, `mapResponse`;
- `apiRoute` (`/pzn/decide`).

Keep `fragmentPrefixes`, `consent` and `api.engine` the same as in `config.js`. The `wrangler.toml`
`[vars] PZN_API_ENDPOINT` overrides `api.endpoint`. Secrets are set only with
`wrangler secret put`, by the site owner.

## Local test

```bash
# The edge logic over any HTML, faking request.cf, the consent cookie and the UA:
node scripts/simulate.mjs https://main--<repo>--<owner>.aem.page/<page> --edge --consent --country IN
node scripts/simulate.mjs content/<page>.html --edge --repo <project> --consent --country US --region CA
node scripts/simulate.mjs content/<page>.html --edge --repo <project>             # no consent: all left
node scripts/simulate.mjs https://main--<repo>--<owner>.aem.page/<page> --edge --ua Googlebot

# The real worker (the origin must be main--*--*.aem.live, so use https locally):
cd <project>/cdn/cloudflare-worker
npx wrangler dev --local-protocol https
curl -sk -D - -o /dev/null https://localhost:8787/
curl -sk -XPOST https://localhost:8787/pzn/decide -d '{}'     # 503 until an engine is set, then 403 (no Origin)
npx wrangler deploy --dry-run --outdir /tmp/pzn-worker           # bundle check, no upload
```

Pages reach `aem.live` only after they are published, so before that rely on
`simulate.mjs --edge`. With `--repo`, the local `content/` folder serves the fragments.

Expected results:

- `x-pzn: edge`, with the right `data-pzn-variant` and `data-pzn-status` per section;
- `<template data-pzn-default>` on each applied variant;
- Googlebot and no-consent runs: the default, with sections left to the browser;
- a split run sets `pzn-split` only with consent or the exception;
- `cache-control: private, no-cache`.

`verify-preview.mjs --scenarios` replays the pilot scenarios through this same edge code. Use
`--perf --edge --uncached` on the deployed site to measure it.

## Deploy handoff (never run without an explicit request)

1. Log in first: a non-interactive `wrangler login` always fails. Hand the user an interactive
   login (in Claude Code, `! npx wrangler login`), or have them set `CLOUDFLARE_API_TOKEN` (and
   `CLOUDFLARE_ACCOUNT_ID`).
2. Uncomment `route` and `account_id` in `wrangler.toml`.
3. The site owner runs:

```bash
npx wrangler secret put PZN_API_KEY            # only with a decision engine
npx wrangler secret put ORIGIN_AUTHENTICATION  # only for protected sites
npx wrangler deploy
```

4. Follow the AEM BYO CDN Cloudflare setup: route, push invalidation, `X-Forwarded-Host`.
5. Verify on production with a non-bot browser and with `curl -A Googlebot`.
