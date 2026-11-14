# Preview and Testing (contract section 11)

## Contents

- Preview overrides
- Local preview
- Scripts
- Required checks
- What verify-preview checks
- Recipes
- Skill tests

## Preview overrides

The overrides work when `config.overrides` is `preview` (the default: `*.aem.page`, `*.hlx.page`
and localhost) or `always`. They never work on the live site. They take precedence over bot
detection, so headless test browsers can see variants.

| Param | Effect |
|---|---|
| `?pzn=home-hero:pro,offer:default` | Force an arm per section, for any source. The outcome is `override`. `default` forces the default |
| `?pzn-geo=IN` / `US-CA` | Fake the geo |
| `?pzn-device=mobile` | Fake the device class |
| `?pzn-visitor=returning` | Fake the visitor |
| `?pzn-state=quiz-persona:cn,step:2` | Fake the state |
| `?pzn-audience=logged-in,vip` | Force custom audiences to match |
| `?pzn-consent=1` / `0` | Fake the consent tool's answer |
| `?pzn-mock=fail \| invalid \| missing \| control \| default \| reason:<code> \| variant:<name>` | With `config.mock`: what the mocked engine and Target answer |
| `?pzn-mock-latency=3000` | With `config.mock`: delay every mocked answer (the default is 250 ms) |
| `?pzn-debug` | Print the decisions table in the console. It only logs; it isn't an override |

`window.hlx.personalization.preview.consent(true | false)` stands in for the consent tool on
preview hosts. At the edge, any `pzn…` param except `pzn-debug` leaves every section to the
browser, when `edge-config.overrides` allows overrides (the default is `never`).

## Local preview

`aem up` (aem-cli 16.21+) serves the local `content/` tree first and proxies the rest:

- `http://localhost:3000/<page>` comes from `content/<page>.html`;
- fragments resolve at their real paths, so a variant renders before anything is uploaded;
- restart `aem up` when it doesn't pick up a new file.

If `verify-preview.mjs` reports `section not found`, check the hooks and how the site renders
Section Metadata (`authoring-model.md` § Rendering prerequisite) before anything else.

## Scripts

| Script | Purpose |
|---|---|
| `validate-placeholders.mjs [files\|dirs] --repo . [--mode client\|edge] [--json]` | Checks the sections against `section.schema.json` and the cross-row checks; the site config (`consent`, transport, engine profile, no `providers` or `sendWithoutConsent`); engine limits; no slow engine on a first section in the browser; AEM Experimentation on the section or page; fragments (prefixes, existence, nesting, `TODO:`, H1); audiences; LCP. Exit 1 on errors |
| `simulate.mjs <page> [--matrix] [--api-decisions] [--target] [--without-consent rules,api] [--engine of1] [--page-url] [--json]` | The expected decision per section and case: variant, outcome, source, assigned and result, plus the `?pzn…` query that reproduces it. Each section gets a no-consent case, a bot case, one case per rule and per engine answer kind, and a forced case per variant |
| `simulate.mjs <page\|url> --edge [--consent] [--country --region --cookie --ua --api-decisions --fault --repo]` | What the edge does per section (applied, selected or left), with its attributes and headers |
| `verify-preview.mjs --page <url> …` | Playwright checks (below). Exit 1 on a failure, 2 on bad usage or when Playwright is missing |
| `mock-decision-api.mjs [--decisions] [--target] [--latency] [--knob] [--ttl] [--cacheable]` | A local engine (`/decide`, `/feedback`) and Target Delivery API that check requests against the schemas (`decision-api.md`) |

Playwright loads from this skill's folder or from `~/.cache/aem-eds-personalization/playwright`
(`PZN_PLAYWRIGHT_DIR` overrides the location). It is **never loaded from the site**: an install
there prunes the site's devDependencies and breaks its lint. If `verify-preview.mjs` exits 2, run
the command it prints, once.

## Required checks

Each check prints `PASS` or `FAIL`. A check that couldn't run is reported as **not run**, never as
passed. Deliver only when every required check passes.

| Check | Command | When |
|---|---|---|
| Authoring | `validate-placeholders.mjs content --repo .` | Always |
| Expected outcomes | `simulate.mjs content/<page>.html` | Always |
| Lint | `npm run lint` | Always |
| Browser | `verify-preview.mjs --page <url> --file content/<page>.html` | Always |
| Re-evaluation | `… --refresh` | `api` sections decided in the browser |
| Failures | `… --faults` | `api`, `target` |
| Target notifications | `… --target activities.json` | `target` |
| Split | `npm test` (fixed-number boundaries) and `… --split-runs 30` | `split` |
| Consent changes | `… --consent-flow` | Always (`cmp` mode) |
| Page speed | `… --perf --baseline <url before>` | A personalized first section, or layout changes |
| Pilot baseline | `… --scenarios assets/contract/pilot-scenarios.json` | The OF1 pilot page |
| Edge | `simulate.mjs --edge` (with and without `--consent`, and `--ua Googlebot`), `wrangler dev` | Edge mode |
| Edge latency | `… --perf --edge --uncached --baseline <unpersonalized url>` | Edge mode, once deployed |

## What verify-preview checks

Every case opens the page with its query in a fresh browser context, and checks the following.

- **Sections.**
  - Nothing is left hidden (`pzn-*` status).
  - The expected `data-pzn-variant`, outcome and source, or one of the `allowed` arms.
  - The content shown is the variant fragment's (its heading) or the default's.
  - No new console errors, and CLS within budget.
- **Events.**
  - Every captured `pzn:*` event is valid against `measurement-event.schema.json` and its
    semantics.
  - One `pzn:decided` and one `pzn:applied` per decision, with the expected `assigned` and
    `result`.
  - `seen` and `clicked` at most once per decision.
- **No consent.**
  - No events, unless the `data-layer` exception applies.
  - No `pzn-*` storage, unless the `split` exception applies.
  - No engine or Target call, unless the `api` exception applies (Target never).
- **Bots.** The default, with no decision call and no split assignment.
- **Target.**
  - Inline offers: one `display` notification once seen, and `click` on a click.
  - Popups: closed 20 points below the trigger and open past it; modal and labelled; `display`
    notified; Escape closes; no reopen for the same decision.
- **`--faults`.**
  - Engine `fail`, `invalid` and `missing` answers, and each reason, end at their outcome:
    `fallback`, `no-match`, `low-confidence`, `control` or `intentional-default`.
  - A Target failure ends at `fallback`.
  - A 3.5 s answer ends at `timeout` when the section budget runs out first (the first section,
    Target), else at `fallback` after `api.timeout`, followed by the Rule rows.
  - With `config.mock` it uses `?pzn-mock`; otherwise it routes the engine and Target URLs.
- **`--refresh`.** A browser-decided `api` section is answered with tracking `r1` and then
  `refresh()` is called:
  - the same answer: no events;
  - a new `tracking`: decision `#2` with `unchanged`, and `seen` again;
  - another variant: the full set of events.
- **`--consent-flow`.** The page loads with `pzn-consent=0`, then `preview.consent(true)` and
  `preview.consent(false)` are called. It checks the defaults, nothing stored or sent, the `#2`
  decisions with trigger `consent`, the defaults restored (edge sections too) and storage cleared.
- **`--split-runs N`.** Stickiness across reloads and tabs. Bots and visitors without consent are
  not assigned. The distribution over N fresh visitors.
- **`--scenarios <file>`.** Each pilot step's engine answer goes through the edge code (served to
  the browser) or the engine route. The attributes and the ordered events must match.
- **`--perf --baseline <url>`.** A normal visitor with consent and real decisions, for a variant
  case, a default case, a no-consent case and a slow-engine case. It reports LCP, CLS and the time
  until the section shows. A CLS regression fails, and so does an LCP regression over 500 ms.
- **`--perf --edge --uncached --baseline <url>`.** Uncached runs (a unique `utm_content` each) and
  cached runs. It reports added time to first byte (all runs, and successful ones only), LCP and
  CLS at p50 and p75, the success rate, and the timeout, fallback and low-confidence rates. It
  fails over 300 ms added time to first byte at p75, or under 95 % successful decisions.

Console errors that also appear on the no-consent or baseline run, and aren't about
personalization, are reported as pre-existing and don't fail. `--revisit` loads the page twice
with cookies kept, to check the returning visitor (needs consent).

## Recipes

```bash
# Rules
node scripts/simulate.mjs content/home.html --page-url http://localhost:3000/home
node scripts/verify-preview.mjs --page http://localhost:3000/home --file content/home.html --consent-flow

# api / target with the in-browser mock (config.mock = { api: <decisions.json>, target: <activities.json> })
node scripts/simulate.mjs content/home.html --api-decisions decisions.json --target activities.json
node scripts/verify-preview.mjs --page http://localhost:3000/home --file content/home.html \
  --api-decisions decisions.json --target activities.json --faults --refresh --ignore-console "status of 5\\d\\d|ERR_"

# api with the mock server instead (api.endpoint = http://localhost:4100/decide for the test only)
node scripts/mock-decision-api.mjs --decisions decisions.json &
node scripts/verify-preview.mjs --page http://localhost:3000/home --file content/home.html --api-decisions decisions.json --faults

# Split
node scripts/verify-preview.mjs --page http://localhost:3000/home --file content/home.html --split-runs 30

# Page speed against the page before the change (e.g. saved as content/home-before.html)
node scripts/verify-preview.mjs --page http://localhost:3000/home --file content/home.html --perf --baseline http://localhost:3000/home-before

# OF1 pilot
node scripts/verify-preview.mjs --page http://localhost:3000/ --scenarios assets/contract/pilot-scenarios.json
```

Stop background mocks when you are done. Revert `config.mock`, `api.endpoint`, `target.endpoint`
and any test-only consent setting.

## Skill tests

`npm test` in `skills/personalize` (`node --test scripts/test/*.test.mjs`) runs every suite:

- the grammar, rules, outcomes, sources, contract and context;
- conformance against the vendored contract schemas, examples and OF1 samples;
- the pilot scenarios through the edge;
- the edge worker and every CLI.

The browser-runtime suites need Playwright to resolve (from the skill folder or the cache), and
are skipped otherwise.
