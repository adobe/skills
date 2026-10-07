---
name: spec
description: Build the pre-migration spec of a website — inventory, redirects, 404s, templates and layout variants, the EDS blocks each page needs with reuse verdicts against an existing block library, dynamic features, martech, data contracts, locales and the open decisions — publish it as an interactive viewer with a chat, and emit a migration spec an autonomous migration agent reads before it starts. Use when someone asks to scope, estimate or plan a migration, wants "which pages use block X / which blocks does page Y need", a redirect or 404 inventory, or a migration brief for a customer. Not the migration itself (replica, migrate, rollout).
license: Apache-2.0
compatibility: Requires Node 22.5+ (node:sqlite), Playwright with Chromium resolvable from the project for the capture stages, and wrangler for the viewer. Real-user data needs an AEM Operational Telemetry domain key.
---

# stardust:spec — the migration spec, before the migration

A spec answers two audiences from one database: the people planning a migration (what has to be built, what can be
reused, what is broken, what needs a decision) and the agent that will run it (archetypes, block backlog, metadata
contract, indexes, dynamic features, martech, locales, redirects, and a default for every open question). The agent
builds the spec here, stage by stage; the viewer only reads it.

## Principles

- **Evidence, then judgement.** Stages S1–S6 and S8 measure the live site; S7 and S9 are judgement (mapping, reuse,
  features, questions) recorded as files in `<dir>/judgement/` with a rationale per decision. Numbers in findings are SQL, never typed.
- **Blind judgement.** Judge from the source site only. A context that has seen a migration of the same site must not
  write the mapping (reference/evaluation.md); state the provenance honestly in `implementation.json#provenance`.
- **Variants, not templates.** CMS templates are loose; plan, capture and QA by layout variant (S8).
- **Every open question ships a default.** Hands-off migration applies the default; a recorded answer replaces it.
- **Speak the downstream contracts.** Dynamic features use the dynamics taxonomy (`../dynamics/reference/triage.md`);
  the spec is the input replica/migrate read instead of re-detecting.

## Setup

`spec.config.json` at the project root (reference/config.md): `origin`, `scopePath`, `template` rule, `parser`
profile + main selector, optional `rum`, `referenceBlocks`, `viewer`. Copy the scripts to `stardust/scripts/spec/`.

## Stages

| # | Stage | Command (from the project root) | Output under `<dir>` |
|---|---|---|---|
| S1 | Inventory | `spec-inventory.mjs` | `inventory/urls.txt`, `sitemaps.json` |
| S2 | Fetch | `spec-fetch.mjs` | `fetch/fetch.jsonl`, `fetch/html/` |
| S3 | Parse | `spec-parse.mjs` | `parse/components.jsonl`, `links.jsonl`, `signals.jsonl` |
| S4 | Links | `spec-links.mjs`, then `spec-fetch.mjs --urls links/pages.txt --out links/pages.jsonl` and `spec-parse.mjs --fetch links/pages.jsonl --out links` | `links/` |
| S5 | Real-user data (optional) | `spec-rum.mjs` (key from `$RUM_DOMAIN_KEY`) | `rum/rum.json` |
| S6 | First capture | `spec-pick.mjs --components-only`, `spec-capture.mjs` | `media/` |
| S7 | Judgement: mapping | `spec-profile.mjs`, `spec-sheet.mjs <component>`, write `judgement/mapping.json`, `spec-map.mjs` until no component is unmapped | `judgement/page-blocks.jsonl` |
| S8 | Variants + visuals | `spec-variants.mjs`, `spec-pick.mjs`, `spec-capture.mjs` | `judgement/variants.json`, `media/` |
| S9 | Implementation | `../dynamics/scripts/dynamics-detect.mjs --urls <reps> --out <dir>/dynamics`, `spec-martech.mjs`; write `judgement/catalog.json`, `implementation.json`, `findings.json`, `search-probes.json` | `martech/`, `dynamics/`, `judgement/` |
| S10 | Package | `spec-build.mjs` | `spec.sqlite` |
| S11 | Publish | `spec-load.mjs` (render, data, deploy, media) | the viewer |

Large sites: S2 runs at 4 parallel requests and is resumable — start it, then write config and judgement scaffolding
while it runs. One browser job at a time (S6/S8/S9), two tabs.

## Judgement (S7, S9)

reference/judgement.md has the method; `templates/` has the starting files. In short:
1. `spec-profile.mjs` lists every component with pages, size, context and an example; look at
   `spec-sheet.mjs <component>` for anything ambiguous — decide from crops, not names.
2. Write `mapping.json`: direct rules, layout wrappers, styled sections, nesting containers (tabs/accordion — EDS blocks
   do not nest), carousel slide rules, row heuristics. Re-run `spec-map.mjs` until it reports no unmapped component.
3. `catalog.json`: one entry per block — description, family (the neutral list in reference/judgement.md), verdict
   against the reference library (reuse | variant | new) with a rationale.
4. `implementation.json`: dynamic features (class, disposition, reproducibility, pattern, EDS guidance, reach rule),
   metadata contract, query indexes, site config, open questions (start from `templates/open-questions.json`; keep
   only what applies, add site-specific ones), consent summary and loading order. reference/implementation.md.
5. `findings.json`: 6–10 headline findings with `{{SELECT …}}` for every number.

## Outputs

- `spec.sqlite` and the viewer (reference/viewer.md): explorer, implementation pages, chat with chat-built views,
  open questions with recorded decisions, onboarding tour.
- The migration spec, generated live by the viewer: `/api/spec.json` (agent contract) and `/api/spec.md` (people).

## Gates

- S7 passes when `spec-map.mjs` reports no unmapped component and every block in page-blocks is in `catalog.json`
  (`spec-build.mjs` warns otherwise).
- S10 passes when every finding renders without `–` and every open question has a default.
- Before sharing: no customer secret in the project or the viewer; the public viewer names no other migration.

## References

- reference/config.md — `spec.config.json`, template rules, parser profiles.
- reference/judgement.md — mapping rules, block families, reuse verdicts, contact sheets, the blind rule.
- reference/implementation.md — features, martech, data layer, metadata, indexes, locales, open questions.
- reference/viewer.md — tables, meta contract, deploy, secrets, chat guardrails.
- reference/evaluation.md — scoring a spec against a delivered migration; blind re-judgement.
