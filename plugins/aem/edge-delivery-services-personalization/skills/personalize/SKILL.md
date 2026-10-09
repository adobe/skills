---
name: personalize
description: Add placeholder-based personalization to an AEM Edge Delivery Services (DA) page. Authors place a Personalization block whose rules (geo, device, new/returning visitor, URL/UTM param, quiz/app state, custom audiences) or a decision-engine API pick the EDS fragment to render, with an authored default as fallback. Installs a client runtime and an optional Cloudflare edge worker (flicker-free, LCP-safe); validates with a rules simulator and a Playwright check. Use when the user says "personalize this page", "show a different hero for visitors from <country>", "returning visitor banner", "show this only on mobile", "swap this block based on location/device/quiz result", "connect our decision engine/API to a placeholder", "edge personalization", or invokes `/aem-eds-personalization:personalize`. Not for A/B tests or traffic splits, Adobe Target/AJO activity setup, or text-token replacement (placeholders sheet). DA projects only; fails fast on xwalk and document-based projects.
license: Apache-2.0
compatibility: Requires Node 22+, an AEM Edge Delivery Services project authored in DA, @adobe/aem-cli 16.21+ for local preview, and Playwright with Chromium in this skill's folder or ~/.cache/aem-eds-personalization/playwright for verify-preview (never installed into the site); wrangler only for edge mode.
---

# personalize — placeholders → fragments

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

It works on any DA project, on pages kept locally as `content/<page>.html` body-fragment documents
(pulled from DA or written by a migration). On top of a migration it runs when the use case needs
it: if the project has a `stardust/dynamic-features.md`, its class-A rows whose source swaps a
region per geo, device or returning visitor are the candidate placeholders. It runs on request
only.

## When to Use

- Show different content per country/region, device, new vs returning visitor, URL/UTM param,
  quiz or app state, or a custom audience function
- Render something only when a condition is met (`default | none`)
- Let a decision engine / personalization API choose the fragment, with local rules as fallback
- Move decisions to the CDN edge (Cloudflare Workers, BYO CDN) for above-the-fold placeholders

**Do NOT use for:**
- A/B tests, traffic splits, "50/50" → decline; point to aem-experimentation (an experimentation
  skill will reuse this runtime later)
- Adobe Target / AJO activity setup, or a region the user says Target controls → decline
- Replacing text tokens such as `{name}` → placeholders sheet
- Migrating the page itself → migrate it to EDS first (for example `page-import`, or the stardust plugin)

## Critical Rules

- `scripts/` and `assets/` below are **this skill's directories**: resolve them against the folder
  holding this SKILL.md (a plugin install keeps them outside the project; use absolute paths). Run
  them from the project root. Every script answers `--help`.
- **Never touch** `scripts/aem.js`, existing block code, the vendored `aem-worker.mjs`, or the
  authored default content (move it into the default fragment, never delete it).
- **Choices, not gates:** ask only where there is a real choice (Step 1), always with its default.
  No reply, or hands-off (`--hands-off`, "no approval gates", a non-interactive run): take the
  defaults and list them as named assumptions in the summary. Never ask a yes/no confirmation (hook, mode, H1 placeholder, worker wrap).
- **Delivery is on by default:** pushing the code branch and the DA upload, preview and publish run
  once every gate passes (Step 7).
- **Off unless chosen:** `wrangler deploy` / `wrangler secret put`, overrides on production, a
  third-party geo endpoint. Hand off those commands.
- **Never:** invent marketing copy (variant fragments are `TODO:` scaffolds unless the user gives
  copy), put API keys in browser code, send PII to the engine, ship a placeholder without `default`.
- Keep the default meaningful: it is what bots, failures, timeouts and no-consent visitors see.

## Step 0: Preflight

```bash
node scripts/detect-project.mjs <project>
```

| Result | Action |
|---|---|
| `projectType: da` | Continue |
| `xwalk` / `doc` (exit 3) | Stop: "personalize supports DA projects only for now." |
| `fragmentBlock.exportsLoadFragment: false` | The installer adds the stock fragment block; warn if one exists without `loadFragment` |
| `integrations.target` / `experimentation` true | A Step 1 choice: which regions they control (default: none of the requested ones); never personalize a region named there |
| `runtime.installed` true | Skip to Step 4 unless files `differ` (re-run the installer to update) |

## Step 1: Gather Inputs

Take what the prompt already says. Ask the rest in **one grouped list**, every question showing
its default; no reply or hands-off takes the defaults (Critical Rules). Nothing else is asked.

| Choice | Default |
|---|---|
| Page and region | The region the prompt names; if only a page is named, its first section (the hero) |
| Variant content | `TODO:` scaffolds (user copy only when given) |
| Default | The current region content, moved into the default fragment (`none` only when asked) |
| Decision source | Rules; `source \| api` only when the prompt names an engine (then its endpoint and a sample request/response) |
| Consent | No CMP: `hasConsent` denies, so `visitor:` rules, persisted state and engine calls stay off |
| CDN | Own Cloudflare (client + edge) when detect reports `edge.cloudflare` or the prompt says so; otherwise Adobe-managed (client) |
| Geo source | Edge meta / `pzn-geo` cookie when present, preview `?pzn-geo=` otherwise; no third-party endpoint |
| Target / experimentation regions | None of the requested regions |
| Analytics | None (`personalization:applied` still fires) |
| DA delivery | On: push the code, upload and preview; publish only once `main` serves the block (Step 7); `preview only` or `no upload` when asked |

Criteria and syntax: `reference/criteria.md`. Authoring rules: `reference/authoring-model.md`.

## Step 2: Choose the Mode

| Situation | Mode |
|---|---|
| `edge.cloudflare` true (a wrangler config or worker in the repo), or the prompt says the site fronts its own Cloudflare | Client + edge (default) |
| Not detected (Adobe-managed CDN) | Client; above-the-fold geo needs a geo source (edge shim cookie or opt-in endpoint), so warn about LCP |
| Decision engine needs a secret | Same-origin route: edge `/pzn/decide` or a CDN proxy. Never a key in the browser |

The client runtime is always installed: it serves preview on `aem.page`, decides what the edge
defers, and handles live state. Take the recommended mode and give the reason in the summary.
Details: `reference/client-mode.md`, `reference/edge-cloudflare.md`.

## Step 3: Install the Runtime

```bash
node scripts/install-runtime.mjs <project> --apply-hook
```

- Copies `scripts/personalization/*`, `blocks/personalization/*` and, if missing,
  `blocks/fragment/fragment.js`. Site-owned files (`config.js`, `personalization.css`, fragment
  block) are never overwritten.
- `--apply-hook` adds the `scripts.js` hook (a 4-line lazy import before `decorateMain(main)` in
  `loadEager`). If the hook is `not-found` (non-boilerplate `scripts.js`), place it by hand per
  `reference/client-mode.md`.
- Edit `scripts/personalization/config.js`: wire `hasConsent` to the CMP (default denies),
  register custom audiences, set `api.endpoint` (Step 5), keep `overrides: 'preview'`.

## Step 4: Author Placeholders and Fragments (local first)

For each placeholder (templates in `assets/content/`, conventions in `reference/authoring-model.md`):
1. In `content/<page>.html`, replace the region with a Personalization block
   (`placeholder-block.html`). Use a stable, unique `id`.
2. Move the region's current markup into
   `content/fragments/personalization/<id>/default.html` (or keep it inline in the default row).
3. Create one fragment per variant at `content/fragments/personalization/<id>/<variant>.html`.
   **Scaffold it from the default fragment**, not the generic `fragment.html`: same blocks,
   images and CTAs, with only the copy swapped for `TODO:` (a bare heading drops the hero's
   layout and costs CLS/LCP). The variant name is the last path segment, cannot be `default`, and
   must be unique within the placeholder (two fragments with the same last segment are an error).

A placeholder that holds the H1 or main SEO copy keeps the H1 in the default and every variant;
variants stay semantically equivalent.

Everything stays local until Step 7 passes; delivery to DA comes after it.

## Step 5: Decision Source

Rules only: nothing to configure. A `source | api` placeholder: follow
`reference/decision-api-contract.md` (same-origin endpoint, adapters from the user's sample checked
offline, consent, the mock) before wiring it.

## Step 6: Edge Worker (only if chosen)

`node scripts/install-edge.mjs <project> [--route <host>/*] [--account <id>]`, then follow
`reference/edge-cloudflare.md` (generated worker, an existing worker's wrap, config alignment,
rate limiting, the login and deploy hand-off).

## Step 7: Validate

With `aem up` running (it serves `content/` at the real paths, `reference/preview-and-testing.md`
§ Local preview), run in order; every script prints ✓ PASS / ❌ FAIL. Fix and re-run until all pass.

```bash
node scripts/validate-placeholders.mjs content --repo <project>
node scripts/simulate.mjs content/<page>.html --page-url http://localhost:3000/<page>
npm run lint
node scripts/verify-preview.mjs --page http://localhost:3000/<page> --file content/<page>.html
```

Add `--baseline <url before the change>` for above-the-fold placeholders (CLS/LCP) and `--revisit`
for `visitor:` rules. API placeholders: the mock with `--api-decisions`, then `--consent` with
`--fail 500` / `--latency 3000` to prove the fallback. Edge: `simulate.mjs --edge --country IN` and
`--ua Googlebot`, then `npx wrangler dev --local-protocol https`. Recipes and the test matrix:
`reference/preview-and-testing.md`.

**Deliver once every gate passes** (on by default; `reference/da-content.md`).
DA content is shared by every branch and `aem.live` always runs `main`'s code:
1. Commit the runtime, block, hook and config and push the code branch.
2. Upload and preview the personalized page(s) and their fragments only: the DA Source API with a
   `DA_TOKEN`, or a DA MCP server's source and preview tools when there is none.
3. Verify on `<branch>--<repo>--<owner>.aem.page` (`verify-preview.mjs`).
4. Publish only once `https://main--<repo>--<owner>.aem.live/blocks/personalization/personalization.js`
   answers 200 (the code is on `main`). Until then stay at preview and say why: publishing earlier
   puts the raw rule rows on the live site.

No DA access (token or MCP), or a push that fails: deliver nothing and hand off the commands.

## Step 8: Summarize

Report what changed (files, hook diff, preview URLs per variant), and:
- Named assumptions: every Step 1 default taken, and the mode with its reason.
- Every fragment that still has `TODO:` copy.
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
- `reference/da-content.md` — placeholders and fragments locally and in DA (upload, preview, publish on `main`)
- `scripts/` — `detect-project.mjs`, `install-runtime.mjs`, `install-edge.mjs`, `validate-placeholders.mjs`, `simulate.mjs`, `verify-preview.mjs`, `mock-decision-api.mjs`, `lib.mjs`
