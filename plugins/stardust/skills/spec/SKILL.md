---
name: spec
description: Build the pre-migration spec of a website — pages, redirects, 404s, layout variants, the EDS blocks each page needs with reuse verdicts, dynamic features, martech and open decisions — as one documented SQLite database for people and a migration agent. Use when someone asks to scope, estimate or plan a migration, wants "which pages use block X / which blocks does page Y need", a redirect or 404 inventory, or a migration brief for a customer. Not the migration itself (replica, migrate, rollout).
license: Apache-2.0
compatibility: Requires Node 22.5+ (node:sqlite), and Playwright with Chromium resolvable from the project for the capture stages. Real-user data needs an AEM Operational Telemetry domain key.
---

# stardust:spec — the migration spec, before the migration

One database answers the people planning a migration (what to build, reuse, fix or decide) and the agent that runs it
(archetypes, block backlog, contracts, redirects, a default for every decision). The agent builds it here, stage by
stage, into `spec.sqlite`; showing it is a separate viewer application's job.

## Principles

- **Evidence, then judgement.** Stages S1–S6 and S8 measure the live site; S7 and S9 are judgement (mapping, reuse,
  features, questions) recorded as files in `<dir>/judgement/` with a rationale per decision.
- **Blind judgement.** Judge from the source site only (reference/judgement.md); state the provenance in
  `implementation.json#provenance`.
- **Variants, not templates.** CMS templates are loose; plan, capture and QA by layout variant (S8).
- **Every open question ships a default.** A hands-off migration applies it; a recorded answer replaces it.
- **Speak the downstream contracts.** Dynamic features use the dynamics taxonomy (`../dynamics/reference/triage.md`);
  `spec.sqlite` is the input replica/migrate can read instead of re-detecting.

## Setup

`spec.config.json` at the project root (reference/config.md): `origin`, `scopePath`, `template` rule, `parser`
profile + main selector, optional `rum`, `referenceBlocks`. Copy the scripts to `stardust/scripts/spec/`.

## Stages

| # | Stage | Command (from the project root) | Output under `<dir>` |
|---|---|---|---|
| S1 | Inventory | `spec-inventory.mjs` | `inventory/urls.txt`, `sitemaps.json` |
| S2 | Fetch | `spec-fetch.mjs` | `fetch/fetch.jsonl`, `fetch/html/` |
| S3 | Parse | `spec-parse.mjs` | `parse/components.jsonl`, `links.jsonl`, `signals.jsonl` |
| S4 | Links | `spec-links.mjs`, then `spec-fetch.mjs --urls links/pages.txt --out links/pages.jsonl` and `spec-parse.mjs --fetch links/pages.jsonl --out links` | `links/` |
| S5 | Real-user data (optional) | `spec-rum.mjs` (key from `$RUM_DOMAIN_KEY`) | `rum/rum.json` |
| S6 | First capture | `spec-pick.mjs --components-only`, `spec-capture.mjs` | `media/` |
| S7 | Judgement: mapping | `spec-profile.mjs`, `spec-sheet.mjs <component>`, write `judgement/mapping.json`, `spec-map.mjs` | `judgement/page-blocks.jsonl` |
| S8 | Variants + visuals | `spec-variants.mjs`, `spec-pick.mjs`, `spec-capture.mjs` | `judgement/variants.json`, `media/` |
| S9 | Implementation | `../dynamics/scripts/dynamics-detect.mjs --urls <reps> --out <dir>/dynamics`, `spec-martech.mjs`; write `judgement/catalog.json`, `implementation.json`, `findings.json`, `search-probes.json` | `martech/`, `dynamics/`, `judgement/` |
| S10 | Package | `spec-build.mjs` | `spec.sqlite` |

Large sites: S2 runs at 4 parallel requests and is resumable — start it, then write config and judgement scaffolding
while it runs. One browser job at a time (S6/S8/S9), two tabs.

## Judgement (S7, S9)

Start from `templates/`. `mapping.json` and `catalog.json`: reference/judgement.md. `implementation.json`:
reference/implementation.md. `findings.json`: 6–10 headline findings, every number a `{{SELECT …}}`.

## Outputs

- `<dir>/spec.sqlite`: every measurement and judgement, findings with computed numbers, open questions with defaults.
  reference/database.md is the contract (meta keys, tables, consumer-owned tables a reload keeps).
- `<dir>/media/`: page captures and block crops the tables point to.

## Gates

- S7 passes when `spec-map.mjs` reports no unmapped component and every block in page-blocks is in `catalog.json`
  (`spec-build.mjs` warns otherwise).
- S10 passes when every finding renders without `–` and every open question has a default.
- Before sharing: no customer secret, internal evaluation or other migration's name in the project or the database.

## References

- reference/config.md — `spec.config.json`, template rules, parser profiles.
- reference/judgement.md — the blind rule, mapping rules, contact sheets, block families, reuse verdicts.
- reference/implementation.md — features, martech, data layer, metadata, indexes, locales, open questions.
- reference/database.md — the output contract: meta keys, tables, media paths.
- reference/evaluation.md — scoring a spec against a delivered migration; blind re-judgement.
