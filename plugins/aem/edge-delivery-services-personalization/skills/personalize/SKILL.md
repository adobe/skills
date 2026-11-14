---
name: personalize
description: Personalizes sections of AEM Edge Delivery Services (DA) pages with Section Metadata, following the EDS personalization contract. The authored content is the default; Personalization rows pick an EDS fragment variant per visitor from rules (geo, device, new/returning, URL/UTM param, page state, custom audiences), a decision engine (v1 API, OF1), a section A/B split, or Adobe Target (inline or popup). Consent-first (no consent, no personalization), with measurement events per decision, a client runtime and an optional Cloudflare edge worker, all checked with a simulator and Playwright. Use for "personalize this section", "different hero for visitors from <country>", "returning visitor banner", "connect our decision engine / OF1", "A/B test this section", "let Target pick this offer", "edge personalization", or `/aem-eds-personalization:personalize`. Not for creating Target activities, AJO journeys or text tokens. DA projects only.
license: Apache-2.0
compatibility: Requires Node 22+, an AEM Edge Delivery Services project authored in DA whose Section Metadata reaches the page as section attributes (rendering v2, or an aem.js that reads it), @adobe/aem-cli 16.21+ for local preview, and Playwright with Chromium in this skill's folder or ~/.cache/aem-eds-personalization/playwright for verify-preview (never installed into the site); wrangler only for edge mode.
---

# personalize: sections → fragments

A personalized section is an authored section with `Personalization` rows in its Section
Metadata. Its content is the **default**. A variant is an EDS fragment that replaces that content
for the visitors it is chosen for. The browser, the edge and the scripts all run the same grammar
and decision code. The skill implements the personalization contract v0.5; its schemas and pilot
scenarios are vendored in `assets/contract/`.

```
| Section Metadata               |                                                |
| Personalization                | home-hero                                      |
| Personalization Source         | rules   (default) | split | api | target       |
| Personalization Variants       | /fragments/personalization/home-hero/india     |
|                                | /fragments/personalization/home-hero/na-mobile |
| Personalization Rule India     | geo: IN                                        |
| Personalization Rule NA Mobile | geo: US, CA & device: mobile                   |
```

The other sources add their own rows:

- `split`: `Personalization Split | 40, 30`.
- `api`: optional `Personalization Hint` and `Personalization Description <Variant>`, plus Rule
  rows as the written fallback.
- `target`: an optional `Personalization Location`, and a `Personalization Trigger` to make a
  popup.

The grammar is in `reference/authoring-model.md`.

## When to Use

- Show a different section per country/region, device, new or returning visitor, URL/UTM param,
  page state, or custom audience.
- Let a decision engine (any v1 engine, or OF1) choose, with the Rule rows as its fallback.
- A/B test a section against its authored content (`split`), or through Target.
- Let Adobe Target pick a section's offer, inline or as a popup.
- Decide at the Cloudflare edge for above-the-fold sections.

**Do NOT use for:**

- Creating Target activities, audiences or offers, or AJO journeys: decline. The skill only wires
  sections to activities the Target user creates.
- Text tokens such as `{name}`: use the placeholders sheet.
- Page-level experiments run with AEM Experimentation: keep them there. A page that runs one gets
  no personalized sections.

## Critical Rules

- **Paths.** `scripts/` and `assets/` are **this skill's directories**: resolve them against the
  folder holding this SKILL.md and use absolute paths. Run them from the project root. Every
  script answers `--help`.
- **The authored content is the default.** Never delete, rewrite or reorder it. Personalization
  adds Section Metadata rows, variant fragments and, when needed, a section break or a new section.
- **Never touch** `scripts/aem.js`, existing block code or the vendored `aem-worker.mjs`.
- **Consent.** The policy is no consent, no personalization. Never add a `withoutConsent`
  exception on your own: exceptions need the site's privacy/legal approval and a `policyRef`
  (`reference/consent.md`).
- **Choices, not gates.** Ask only where there is a real choice (Step 2), always with its default.
  No reply, or a hands-off run (`--hands-off`, "no approval gates", non-interactive): take the
  defaults and list them as named assumptions in the summary. Never ask a yes/no confirmation.
- **Delivery is on by default.** Pushing the code branch and the DA upload, preview and publish
  run once every check passes (Step 8).
- **Off unless chosen:** `wrangler deploy` and `wrangler secret put` (the site owner runs them),
  overrides on production, a third-party geo endpoint, and `config.mock` outside tests.
- **Never:**
  - invent marketing copy (variants are `TODO:` scaffolds unless the user gives the copy);
  - put API keys or tenant ids in browser code;
  - send personal data to an engine or in events;
  - list a variant named `default`;
  - report a check as passed when it didn't run.

## Step 1: Preflight

```bash
node scripts/detect-project.mjs <project>
```

| Result | Action |
|---|---|
| `projectType: da` | Continue |
| `xwalk` / `doc` (exit 3) | Stop: "personalize supports DA projects only for now." |
| `sectionMetadata.renderedBy` | `pipeline`: needs rendering v2 (Step 6 proves it). `aem.js`: works as is |
| `content.pagesWithExperiments`, `integrations.experimentation` | Never personalize those pages or sections |
| `integrations.consentTools`, `consent.ask` | Input for the consent choice (Step 2) |
| `integrations.atjs` / `websdk` / `launch` / `target` | Ask which regions Target already owns (Step 2). Web SDK pages use `target.transport: 'websdk'` |
| `edge.cloudflare` | The default mode becomes client + edge |
| `fragmentBlock.exportsLoadFragment: false` | The installer adds the stock fragment block when it is missing; warn if one exists without `loadFragment` |

## Step 2: Choices

Take what the prompt already says. Ask the rest as **one grouped list**, each with its default.
No reply, or a hands-off run, takes the defaults.

| Choice | Default |
|---|---|
| Page and section | The section the prompt names; if only a page is named, its first section |
| Source per section | `rules`. `api` when the prompt names an engine: ask for the endpoint and a sample request and response. `split` for "A/B" or "50/50". `target` when Target should pick |
| Display (`target`) | `inline`. `popup` with a trigger (`scroll: 70%`) when the prompt says popup, modal or scroll |
| Variant content | `TODO:` scaffolds copied from the section (user copy only when given) |
| **Consent** (`reference/consent.md`) | A tool found: `cmp`, wired to it, and the category named. None found: `deny` (every section shows its default until a tool is connected); the alternatives are `cmp` with the user's tool, or `allow` if owner and legal confirm |
| **Exceptions without consent** | None. Only what privacy/legal approved, with where the approval is recorded |
| **Regions Target owns** | None of the requested sections |
| Mode | Client + edge when `edge.cloudflare` is reported or the prompt says so; otherwise client. A first section decided in the browser stays hidden for up to 800 ms, so recommend the edge, a later section or a popup. A slow engine (`of1`) on the first section requires the edge |
| Geo source | The edge meta tag, or the `pzn-geo` cookie when present; `?pzn-geo=` in preview. No third-party endpoint |
| DA delivery | On: push, upload, preview, and publish once `main` serves the runtime. `preview only` or `no upload` when asked |

## Step 3: Install the Runtime

```bash
node scripts/install-runtime.mjs <project> --apply-hook
```

- It copies `scripts/personalization/*`. If they are missing, it also creates the site-owned
  `config.js`, `styles/target-popup.css` and `blocks/fragment/fragment.js`; it never overwrites
  them.
- `--apply-hook` adds the two hooks in `scripts.js`: after `decorateMain(main)` in `loadEager`,
  and after `await loadSections(main)` in `loadLazy`. A hook reported `not-found` is placed by
  hand (`reference/client-mode.md`). Show the diff in the summary.
- The report's `config` lists what `config.js` still needs (Step 5).

## Step 4: Author Section Metadata and Fragments (local first)

For each section, in `content/<page>.html` (`reference/authoring-model.md`,
`reference/da-content.md`):

1. **Rows.** Add the `Personalization …` rows to the section's Section Metadata, creating the
   block at the end of the section if needed. Give the section a unique id. Leave its content
   exactly as authored.
   - To change part of a section: split it, and copy its `Style` row.
   - For content only some visitors see: a new section with only the rows.
2. **Fragments.** Write one fragment per variant at
   `content/fragments/personalization/<id>/<variant>.html`, **scaffolded from the section's
   content**: same blocks, images and buttons, with the copy replaced by `TODO:`.
3. **Rules.** One condition per row. Repeat a variant with `Personalization Rule <Variant> 2`.
4. **`api` sections.** Add a `Description` row per variant and `Description Default` when the
   engine uses them (OF1). They are public text.
5. **`target` sections.** The Target user needs JSON offers `{ "fragment": "<path>" }` or
   `{ "control": true }` on the section's location (`reference/target.md`).

Keep the H1 in the default and in every variant. Everything stays local until Step 8.

## Step 5: Configure `config.js`

`scripts/personalization/config.js` is site-owned (`reference/client-mode.md` § Configuration):

- `consent`: `mode`, plus `tool` for `cmp`, plus `withoutConsent` and `policyRef` only when
  approved. Wire `hasConsent` to the tool, and have the tool's change callback call
  `window.hlx.personalization.refresh()` (`reference/consent.md`).
- `api`: a same-origin `endpoint` (the edge route `/pzn/decide`, or the engine's proxy) and
  `engine` (`generic` or `of1`). Adapters for other engine formats go in `edge-config.js` and are
  checked offline against the user's samples (`reference/decision-api.md`).
- `target`: `transport`, `clientCode`, `propertyToken` (`reference/target.md`).
- `audiences`, when `audience:` rules are used.
- `mock`: only for tests and demos; revert it before handover. Keep `overrides: 'preview'`.

## Step 6: Validate

With `aem up` running, run the checks in order (`reference/preview-and-testing.md` § Required
checks). Each prints PASS or FAIL. Fix and re-run until all pass; a check that couldn't run is
reported as not run.

```bash
node scripts/validate-placeholders.mjs content --repo <project>
node scripts/simulate.mjs content/<page>.html --page-url http://localhost:3000/<page>
npm run lint
node scripts/verify-preview.mjs --page http://localhost:3000/<page> --file content/<page>.html --consent-flow
```

Per source, add these to `simulate` and `verify-preview`:

- `api`: `--api-decisions decisions.json` (mock table), `--faults` and `--refresh`.
- `target`: `--target activities.json`, plus `--faults`.
- `split`: `--split-runs 30`.
- A personalized first section, or layout changes: `--perf --baseline <url before>`.
- The OF1 pilot page: `--scenarios assets/contract/pilot-scenarios.json`.

If verify-preview reports `section not found`, the hooks are missing or Section Metadata isn't
rendered as attributes (`reference/authoring-model.md` § Rendering prerequisite).

## Step 7: Edge Worker (only if chosen)

```bash
node scripts/install-edge.mjs <project> [--route <host>/*] [--account <id>]
```

Or pass `--existing <dir>` and apply the printed wrap. Then follow
`reference/edge-cloudflare.md`:

1. Copy `consent` and `fragmentPrefixes` into `edge-config.js`, and the engine adapters (OF1:
   `adapters/of1.js`).
2. Check with `simulate.mjs content/<page>.html --edge --repo <project> --consent --country US`,
   again without `--consent`, and with `--ua Googlebot`.
3. Run `npx wrangler dev --local-protocol https`.

Deploying and setting secrets are handed off to the site owner.

## Step 8: Deliver

Deliver once every required check passes (`reference/da-content.md`). DA content is shared by
every branch, and `aem.live` always runs `main`'s code.

1. Commit the runtime, hooks, config and styles; push the code branch.
2. Upload and preview only the personalized pages and their variant fragments, through the DA
   Source API with a `DA_TOKEN`, or with a DA MCP server's source and preview tools.
3. Verify on `<branch>--<repo>--<owner>.aem.page` (`verify-preview.mjs`).
4. Publish only once
   `https://main--<repo>--<owner>.aem.live/scripts/personalization/sections.js` answers 200.
   Until then, stay at preview and say why.

With no DA access (token or MCP), or when a push fails, deliver nothing and hand off the
commands.

## Summary

Report the following:

- the files changed and the `scripts.js` diff;
- the per-variant `?pzn=<id>:<variant>` preview URLs;
- the consent setup (mode, tool and category, exceptions and their `policyRef`);
- named assumptions: every Step 2 default, and the mode with its reason;
- every `TODO:`;
- the check results (PASS, FAIL or not run);
- the **launch checklist** (`reference/cross-cutting.md`).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Section never personalizes | Hooks missing; rows not rendered as `data-personalization*` (rendering v2); code not on the branch |
| Always the default, `data-pzn-outcome="no-consent"` | Consent not given or not wired (`consent.mode` is `deny`, or `hasConsent` returns undefined), or no exception |
| Always the default, another outcome | `data-pzn-outcome` and `data-pzn-reason` say why: no geo source, rule order, `low-confidence`, `fallback` (`HTTP 500`, `not listed: x`), `timeout` |
| A rule disappeared | Two rows with the same name: number them (`Rule India 2`) |
| First section blank for a moment | Held for its decision (LCP): use the edge, a later section, or a popup |
| Popup never opens | No consent (`waiting for consent`), no offer, a trigger beyond the page; check the `?pzn-debug` popup status |
| Events sent twice or missing | Same decision identity means no new events (`reference/decisions-and-measurement.md`) |
| Variant 404 locally | Fragment missing under `content/fragments/...`, or `aem up` needs a restart |
| Worker 500 locally | Run `wrangler dev --local-protocol https`; the origin must be `main--<repo>--<owner>.aem.live` |

`?pzn-debug` prints the decisions table. For anything else, hand back the page URL and that table.

## References

- `reference/authoring-model.md`: grammar, sources, attributes, rendering, placement, fragments
- `reference/criteria.md`: condition syntax, built-in criteria, custom audiences
- `reference/consent.md`: consent modes, wiring the consent tool, exceptions, consent changes
- `reference/decisions-and-measurement.md`: outcomes, `pzn:*` events, decision identity, analysis
- `reference/client-mode.md`: installed files, hooks, lifecycle, budgets, public API, `config.js`
- `reference/decision-api.md`: engine API v1, outcomes per answer, caching, server route, OF1, adapters, mock
- `reference/split.md`: section A/B, weights, assignment, reporting
- `reference/target.md`: Target mapping, popups, Delivery API and Web SDK transports
- `reference/edge-cloudflare.md`: worker generation, request flow, the three edge results, deploy handoff
- `reference/cross-cutting.md`: fallback, SEO and bots, privacy, sharing, analytics, launch checklist
- `reference/preview-and-testing.md`: overrides, scripts, required checks, verify-preview, recipes
- `reference/da-content.md`: local content, DA upload, preview, publish on `main`, noindex
