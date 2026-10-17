# Preview and Testing

## Preview overrides

Enabled when `config.overrides` is `preview` (default: `*.aem.page`, `*.hlx.page`, localhost) or
`always`. They win over bot detection, so headless test browsers can see variants.

| Param | Effect |
|---|---|
| `?pzn=home-hero:india,offer:default` | Force variants per placeholder |
| `?pzn-geo=IN` / `US-CA` | Fake geo |
| `?pzn-device=mobile` | Fake device class |
| `?pzn-visitor=returning` | Fake visitor |
| `?pzn-state=quiz-persona:cn,step:2` | Fake state |
| `?pzn-audience=logged-in,vip` | Force custom audiences to match |
| `?pzn-consent=1` / `0` | Fake the CMP's answer: storage and engine calls behave as with/without consent |
| `?pzn-debug` | Console table: id, variant, source, rule, ms. Logging only: not an override, so edge decisions and bot detection stay as visitors get them |

At the edge, any `pzn…` param except `pzn-debug` (when allowed) makes the worker defer everything
to the browser.
`window.hlx.personalization.decisions` holds the same rows as the debug table.

## Local preview

`aem up` (aem-cli 16.21+) serves the local `content/` tree first and proxies the rest: a page is
`http://localhost:3000/<page>` from `content/<page>.html`, and fragments resolve at their real
paths (`/fragments/personalization/<id>/<variant>.plain.html` from
`content/fragments/personalization/<id>/<variant>.html`), so a variant renders before anything is
uploaded. On an older aem-cli, run `aem up --html-folder content` and open
`http://localhost:3000/content/<page>`: the runtime strips the `/content` prefix for API paths and
retries fragments under it. Restart `aem up` when a new file is not picked up.

## Scripts

| Script | Purpose |
|---|---|
| `validate-placeholders.mjs [files|dirs] --repo . [--base-url] [--json]` | Grammar, unique ids, default, fragment existence, audiences, API config, H1 warning. Exit 1 on errors |
| `simulate.mjs <page> [--matrix] [--api-decisions] [--consent] [--page-url] [--json]` | Expected variant per placeholder and case, plus the override URL. `--api-decisions` adds `pzn-consent=1` to API placeholders' cases; `--consent` to every non-bot case |
| `simulate.mjs <page|url> --edge [--country --region --cookie --ua --api-endpoint]` | Edge output and headers |
| `verify-preview.mjs --page <url> [--file|--cases] [--matrix] [--api-decisions] [--consent] [--baseline] [--revisit] [--screenshots] [--ignore-console] [--json]` | Playwright: each case applied, content rendered, no new console errors, CLS ≤ 0.1. Errors also on the no-context or baseline run (and not about personalization) are reported as pre-existing, not failed. Exit 1 fail, 2 usage / no Playwright |
| `mock-decision-api.mjs [--port] [--decisions] [--latency] [--fail] [--invalid] [--ttl] [--cacheable]` | v1 engine mock |

Playwright loads from this skill's folder or `~/.cache/aem-eds-personalization/playwright`
(`PZN_PLAYWRIGHT_DIR` overrides), **never from the site**: an install there prunes the
site's devDependencies and breaks its lint. If `verify-preview.mjs` exits 2, run the command it
prints once: `npm i --prefix ~/.cache/aem-eds-personalization/playwright playwright && npx --prefix ~/.cache/aem-eds-personalization/playwright playwright install chromium`.

## Default matrix

Without `--matrix`, each placeholder gets: no context, bot, one case per rule satisfying its
positive clauses, and a forced case per variant plus `default`. A shared matrix looks like:

```json
[
  { "name": "india mobile returning", "geo": "IN", "device": "mobile", "visitor": "returning" },
  { "name": "diwali campaign", "params": { "utm_campaign": "diwali" } },
  { "name": "quiz cn", "state": { "quiz-persona": "cn" } },
  { "name": "vip", "audiences": ["vip"] },
  { "name": "crawler", "bot": true }
]
```

## Recipes

```bash
# Rules: expectations, then the browser
node scripts/simulate.mjs content/home.html --page-url http://localhost:3000/home
node scripts/verify-preview.mjs --page http://localhost:3000/home --file content/home.html --screenshots /tmp/pzn-shots

# LCP/CLS against the page before the change (e.g. the original page saved as content/home-before.html)
node scripts/verify-preview.mjs --page http://localhost:3000/home --file content/home.html --baseline http://localhost:3000/home-before

# Returning visitor (requires hasConsent to grant consent in the test setup)
node scripts/verify-preview.mjs --page http://localhost:3000/home --file content/home.html --revisit

# Decision API: happy path, then failure injection
node scripts/mock-decision-api.mjs --decisions decisions.json &
node scripts/verify-preview.mjs --page http://localhost:3000/home --file content/home.html --api-decisions decisions.json
node scripts/mock-decision-api.mjs --port 4101 --fail 500 &   # point api.endpoint at :4101
node scripts/verify-preview.mjs --page http://localhost:3000/home --file content/home.html --consent --ignore-console "status of 5\\d\\d|ERR_"
```

The runtime only calls the engine with consent. `--api-decisions` grants it per case with
`?pzn-consent=1`; for failure runs pass `--consent` so the browser really calls the failing engine.
Without `--api-decisions` the expectations are the authored rules, which is exactly what a failing
or slow engine must produce. Check `GET /requests` on the mock to confirm calls were made. Stop background mocks when done and revert `api.endpoint` and any
test-only `hasConsent` change.

## Live state

Check a quiz-driven swap in the browser (or a Playwright snippet):

```js
await window.hlx.personalization.setState('quiz-persona', 'cn');
document.querySelector('[data-pzn-id="quiz-hero"]').dataset.pznVariant; // the cn variant
```

Placeholders that do not use the key keep their variant.

## Skill tests

`node --test skills/personalize/scripts/test/*.test.mjs` runs the suites (rules, contract, context,
HTML reader, edge worker, one per CLI, API transport); the browser-runtime suite needs Playwright
resolvable from the cwd and skips otherwise.
