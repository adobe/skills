---
name: personalize
description: Add placeholder-based personalization to an AEM Edge Delivery Services (DA) page. Authors place a Personalization block whose rules (geo, device, new/returning visitor, URL/UTM param, quiz/app state, custom audiences) or a decision-engine API pick the EDS fragment to render, with an authored default as fallback. Installs a client runtime and an optional Cloudflare edge worker (flicker-free, LCP-safe); validates with a rules simulator and a Playwright check. Use when the user says "personalize this page", "show a different hero for visitors from <country>", "returning visitor banner", "show this only on mobile", "swap this block based on location/device/quiz result", "connect our decision engine/API to a placeholder", "edge personalization", or invokes `$stardust personalize` (`/stardust:personalize` in Claude Code). Not for A/B tests or traffic splits, Adobe Target/AJO activity setup, or text-token replacement (placeholders sheet). DA projects only; fails fast on xwalk and document-based projects.
license: Apache-2.0
compatibility: Requires Node 22+, an AEM Edge Delivery Services project authored in DA, @adobe/aem-cli 16.21+ for local preview, and Playwright with Chromium resolvable from the project for verify-preview; wrangler only for edge mode.
---

# stardust:personalize — placeholders → fragments

A **Personalization block** is a placeholder in a page. Its rows map conditions to fragments; the
first matching row wins and the `default` row is the fallback. One rules engine (`rules.js`) runs
unchanged in the browser, at the Cloudflare edge and in this skill's scripts, so every environment
picks the same variant.

```
| Personalization                                                             |
| id                           | home-hero                                    |
| source                       | api            (optional: ask the engine first)
| geo: IN                      | /fragments/personalization/home-hero/india   |
| geo: US, CA & device: mobile | /fragments/personalization/home-hero/na-mobile |
| visitor: returning           | /fragments/personalization/home-hero/welcome-back |
| default                      | /fragments/personalization/home-hero/default (or inline content, or none) |
```

It works on the EDS delivery side of stardust: on a page `deploy` or `rollout` already shipped
(`content/<page>.html`), or on any DA project. On a migration, class-A rows in
`stardust/dynamic-features.md` whose source swaps a region per geo, device or returning visitor are
the candidate placeholders. It is never part of the hands-off chain: it runs on request, and every
ask-first gate below stays a question.

## When to Use

- Show different content per country/region, device, new vs returning visitor, URL/UTM param,
  quiz or app state, or a custom audience function
- Render something only when a condition is met (`default | none`)
- Let a decision engine / personalization API choose the fragment, with local rules as fallback
- Move decisions to the CDN edge (Cloudflare Workers, BYO CDN) for above-the-fold placeholders

**Do NOT use for:**
- A/B tests, traffic splits, "50/50" → decline; point to aem-experimentation (an experimentation
  skill will reuse this runtime later)
- Adobe Target / AJO activity setup, or regions already controlled by Target → decline or confirm
- Replacing text tokens such as `{name}` → placeholders sheet
- Migrating the page itself → the stardust migration flow first (`replica` or `migrate`, then `deploy`)

## Critical Rules

- Run the scripts from the project root: `node skills/personalize/scripts/<name>.mjs` (plugin tree)
  or the project copy `stardust/scripts/personalize/<name>.mjs`, with the skill's `assets/` copied
  alongside it. Every script answers `--help`.
- **Never touch** `scripts/aem.js`, existing block code, the vendored `aem-worker.mjs`, or the
  authored default content (move it into the default fragment, never delete it).
- **Ask first:** the `scripts.js` hook, any DA upload / preview / publish, any `wrangler deploy` or
  secret, overrides on production, a third-party geo endpoint, a region also driven by Target or
  experimentation, a placeholder that holds the H1 or main SEO copy.
- **Never:** invent marketing copy (variant fragments are `TODO:` scaffolds unless the user gives
  copy), put API keys in browser code, send PII to the engine, ship a placeholder without `default`.
- Keep the default meaningful: it is what bots, failures, timeouts and no-consent visitors see.

## Step 0: Preflight

```bash
node skills/personalize/scripts/detect-project.mjs <project>
```

| Result | Action |
|---|---|
| `projectType: da` | Continue |
| `xwalk` / `doc` (exit 3) | Stop: "personalize supports DA projects only for now." |
| `fragmentBlock.exportsLoadFragment: false` | The installer adds the stock fragment block; warn if one exists without `loadFragment` |
| `integrations.target` / `experimentation` true | Ask which regions they control; never personalize the same region |
| `runtime.installed` true | Skip to Step 4 unless files `differ` (re-run the installer to update) |

## Step 1: Gather Inputs

Ask in **one grouped list** (skip what the user already said):
1. Page(s) and the region to personalize (an existing block or section).
2. Per variant: the condition and the content (user-provided copy, or a `TODO` scaffold).
3. The default (normally the current content) or `none`.
4. Decision engine? Endpoint, a sample request/response, and whether it speaks the v1 contract.
5. Consent: CMP in use (detect reports `integrations.consent`) and the consent category.
6. CDN: Adobe-managed, or BYO Cloudflare that the customer can deploy a worker to?
7. Analytics: Adobe Data Layer / Launch, Tealium, or none.

Criteria and syntax: `reference/criteria.md`. Authoring rules: `reference/authoring-model.md`.

## Step 2: Choose the Mode

| Situation | Mode |
|---|---|
| Below the fold, or device/state/audience criteria | Client (default) |
| Above the fold **and** geo or API **and** BYO Cloudflare | Client + edge |
| Above the fold geo on the Adobe-managed CDN | Client with a geo source (edge shim cookie or opt-in endpoint); warn about LCP |
| Decision engine needs a secret | Same-origin route: edge `/pzn/decide` or a CDN proxy. Never a key in the browser |

The client runtime is always installed: it serves preview on `aem.page`, decides what the edge
defers, and handles live state. Explain the recommendation and confirm it.
Details: `reference/client-mode.md`, `reference/edge-cloudflare.md`.

## Step 3: Install the Runtime

```bash
node skills/personalize/scripts/install-runtime.mjs <project>
```

- Copies `scripts/personalization/*`, `blocks/personalization/*` and, if missing,
  `blocks/fragment/fragment.js`. Site-owned files (`config.js`, `personalization.css`, fragment
  block) are never overwritten.
- Prints the `scripts.js` patch (a 4-line lazy import before `decorateMain(main)` in `loadEager`).
  **Show the patch, ask for approval**, then apply it with `--apply-hook`. If the hook is
  `not-found` (non-boilerplate `scripts.js`), place it by hand per `reference/client-mode.md` and
  show the diff.
- Edit `scripts/personalization/config.js`: wire `hasConsent` to the CMP (default denies),
  register custom audiences, set `api.endpoint` (Step 5), keep `overrides: 'preview'`.

## Step 4: Author Placeholders and Fragments (local first)

For each placeholder (templates in `assets/content/`, conventions in `reference/authoring-model.md`):
1. In `content/<page>.html`, replace the region with a Personalization block
   (`placeholder-block.html`). Use a stable, unique `id`.
2. Move the region's current markup into
   `content/fragments/personalization/<id>/default.html` (or keep it inline in the default row).
3. Create one fragment per variant at `content/fragments/personalization/<id>/<variant>.html`
   (`fragment.html`, the same body-fragment document as any content page). The variant name is
   the last path segment, cannot be `default`, and must be unique within the placeholder (two
   fragments with the same last segment are an error).

Uploading to DA is outward-facing: **ask before uploading** and follow `reference/da-content.md`
(`deploy`'s batch driver restricted to the personalized paths, bulk metadata `noindex` for
`/fragments/**`).

## Step 5: Decision Source

- **Rules only:** nothing to configure.
- **Decision engine (`source | api` row):** read `reference/decision-api-contract.md`.
  - Point `config.api.endpoint` at a same-origin path (edge `/pzn/decide`, or a CDN proxy).
  - If the engine is not v1, generate `mapRequest` / `mapResponse` from the user's sample and
    test them against the sample (no network) before wiring. With the edge route they go in
    `edge-config.js` only; the browser keeps them `null` and speaks v1 to `/pzn/decide`.
  - The engine is called only with consent unless the user sets `sendWithoutConsent: true`.
  - For local testing run `mock-decision-api.mjs --decisions <file>` and point `api.endpoint` at
    `http://localhost:4100/decide` **temporarily** (revert before handover).

## Step 6: Edge Worker (only if chosen)

```bash
node skills/personalize/scripts/install-edge.mjs <project> [--route www.example.com/*] [--account <id>]
```

- Generates `cdn/cloudflare-worker/` from `adobe/aem-cloudflare-prod-worker` (vendored unchanged)
  plus the personalization wrapper; infers `ORIGIN_HOSTNAME` from the git remote; adds `cdn/` to
  `.hlxignore`. For an existing worker use `--existing <dir>` and follow `reference/edge-cloudflare.md`.
- Keep `edge-config.js` `fragmentPrefixes` / `botsGetDefault` aligned with `config.js`.
- `/pzn/decide` is public: it only forwards same-origin v1 requests with the `pzn-consent` cookie,
  but recommend the `PZN_RATE_LIMITER` binding (commented in `wrangler.toml`) before launch.
- **Never** run `wrangler deploy` or `wrangler secret put` unless the user explicitly asks; hand off
  the commands in the summary.

## Step 7: Validate

With `aem up` running (it serves `content/` at the real paths, `reference/preview-and-testing.md`
§ Local preview), run in order; every script prints ✓ PASS / ❌ FAIL. Fix and re-run until all pass.

```bash
node skills/personalize/scripts/validate-placeholders.mjs content --repo <project>
node skills/personalize/scripts/simulate.mjs content/<page>.html --page-url http://localhost:3000/<page>
npm run lint
node skills/personalize/scripts/verify-preview.mjs --page http://localhost:3000/<page> --file content/<page>.html
```

Add `--baseline <url before the change>` for above-the-fold placeholders (CLS/LCP) and `--revisit`
for `visitor:` rules. API placeholders: the mock with `--api-decisions`, then `--consent` with
`--fail 500` / `--latency 3000` to prove the fallback. Edge: `simulate.mjs --edge --country IN` and
`--ua Googlebot`, then `npx wrangler dev --local-protocol https`. Recipes and the test matrix:
`reference/preview-and-testing.md`.

## Step 8: Summarize

Report:
- Files created/changed (runtime, hook, config, content, worker) and what still has `TODO:` copy.
- Preview URLs per variant (from `simulate.mjs --page-url`), e.g. `?pzn=home-hero:india`.
- Author instructions: how to add a rule row or a new variant fragment in DA.
- **Launch checklist** (`reference/cross-cutting.md`): consent hook wired; fragments `noindex`;
  variants are semantically equivalent to the default (no cloaking); analytics consumes
  `personalization:applied`; overrides off in production; mock endpoint reverted; worker
  deployed by the site owner with `PZN_API_KEY` as a secret; Target/experimentation regions disjoint.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Placeholder never applies | Hook missing in `loadEager`, or block files not on the pushed code branch |
| Always the default | Overrides ignored (host not preview), no geo source, no consent for `visitor`/API, rule order |
| Fragment link turned into a fragment block | Hook runs after `decorateMain`; move it before |
| Variant 404 locally | Fragment missing under `content/fragments/...`, aem-cli older than 16.21 (use `--html-folder content`), or `aem up` not restarted |
| API never called | `api.endpoint` empty, no consent, or the edge already decided (`data-pzn-source="edge"`) |
| Worker 500 locally | Run `wrangler dev --local-protocol https`; origin must be `main--<repo>--<owner>.aem.live` |

Run `?pzn-debug` for a console table of decisions; report the page URL and that table when handing
anything else back to the user.

## References

- `reference/authoring-model.md` — block grammar, reserved rows, fragment conventions, examples
- `reference/criteria.md` — built-in criteria, condition syntax, custom audiences
- `reference/client-mode.md` — hook placement, lifecycle, budgets, LCP/CLS, state API, events
- `reference/edge-cloudflare.md` — worker generation, request flow, caching, bots, local test, deploy handoff
- `reference/decision-api-contract.md` — v1 contract, timeouts, caching, fallback, adapters
- `reference/cross-cutting.md` — SEO/bots, consent, analytics/martech, experimentation compatibility
- `reference/preview-and-testing.md` — local preview, overrides, debug, simulate/verify/mock usage, test matrix
- `reference/da-content.md` — placeholders and fragments locally and in DA (consent-gated upload)
- `scripts/` — `detect-project.mjs`, `install-runtime.mjs`, `install-edge.mjs`, `validate-placeholders.mjs`, `simulate.mjs`, `verify-preview.mjs`, `mock-decision-api.mjs`, `lib.mjs`
