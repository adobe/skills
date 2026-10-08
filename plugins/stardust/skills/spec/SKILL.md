---
name: spec
description: Build the pre-migration spec of a website — pages, redirects, 404s, layout variants, the EDS blocks each page needs with reuse verdicts, dynamic features, martech and open decisions — as documented knowledge files for people and a migration agent. Use when someone asks to scope, estimate or plan a migration, wants "which pages use block X / which blocks does page Y need", a redirect or 404 inventory, or the facts behind a migration brief. Not the migration itself (replica, migrate, rollout).
license: Apache-2.0
compatibility: Requires Node 20+, and Playwright with Chromium resolvable from the project for the capture stages. Real-user data needs an AEM Operational Telemetry domain key.
---

# stardust:spec — the migration spec, before the migration

The spec answers the people planning a migration (what to build, reuse, fix or decide) and the agent that runs it
(archetypes, block backlog, contracts, redirects, a default for every decision). The agent builds it stage by stage.

## Principles

- **Evidence, then judgement.** Stages S1–S6 and S8 measure the live site; S7 and S9 are judgement (mapping, reuse,
  features, questions) recorded in `judgement/` with a rationale per decision.
- **Blind judgement.** Judge from the source site only (reference/judgement.md); state the provenance in
  `implementation.json#provenance`.
- **Variants, not templates.** CMS templates are loose; plan, capture and QA by layout variant (S8).
- **Every open question ships a default.** A hands-off migration applies it; a recorded answer replaces it.
- **Computed, never typed.** Every figure in findings, feature reach and question impact is a rule
  (reference/knowledge.md § Rules) the knowledge stage evaluates.
- **Speak the downstream contracts.** Dynamic features use the dynamics taxonomy (`../dynamics/reference/triage.md`).

## Setup

`stardust/spec/spec.config.json` (reference/config.md): `origin`, `scopePath`, `template` rule, `parser` profile
(`aem-classic`, `aem-core`, or `generic` for any other site) + main selector, optional `maxPages`, `rum`,
`referenceBlocks`. Copy the spec, diff and dynamics scripts to `stardust/scripts/spec/`, `stardust/scripts/diff/` and
`stardust/scripts/dynamics/` (S1, S2 and S6 use diff's `live-session.mjs`; S9 the dynamics detector and vendor table).

## Stages

| # | Stage | Command (from the project root) | Output |
|---|---|---|---|
| S1 | Inventory | `spec-inventory.mjs` | `<work>/inventory/` |
| S2 | Fetch | `spec-fetch.mjs` | `<work>/fetch/` |
| S3 | Parse | `spec-parse.mjs` | `<work>/parse/` |
| S4 | Links | `spec-links.mjs`, then `spec-fetch.mjs --urls <work>/links/pages.txt --out <work>/links/pages.jsonl` and `spec-parse.mjs --fetch <work>/links/pages.jsonl --out <work>/links` | `<work>/links/` |
| S5 | Real-user data (optional) | `spec-rum.mjs` (key from `$RUM_DOMAIN_KEY`) | `<work>/rum/rum.json` |
| S6 | First capture | `spec-pick.mjs --components-only`, `spec-capture.mjs` | `<work>/media/` |
| S7 | Judgement: mapping | `spec-profile.mjs`, `spec-sheet.mjs <component>`, write `judgement/mapping.json`, `spec-map.mjs` | `<work>/map/page-blocks.jsonl` |
| S8 | Variants + visuals | `spec-variants.mjs`, `spec-pick.mjs`, `spec-capture.mjs` | `<work>/map/variants.json`, `<work>/media/` |
| S9 | Implementation | `dynamics-detect.mjs --urls <reps> --out <work>/dynamics`, `spec-martech.mjs`; write `judgement/catalog.json`, `implementation.json`, `findings.json`, `search-probes.json` | `<work>/`, `judgement/` |
| S10 | Knowledge | `spec-knowledge.mjs` | `knowledge/` |

`<work>` is `stardust/.work/spec/`, never committed. Large sites: S2 runs at 4 parallel requests and is resumable —
start it, then write config and judgement scaffolding while it runs. One browser job at a time (S6/S8/S9), two tabs.

## Judgement (S7, S9)

Start from `templates/`. `mapping.json` and `catalog.json`: reference/judgement.md. `implementation.json`:
reference/implementation.md. `findings.json`: 6–10 plain-text `{ title, text }` headlines. Recorded answers go in
`judgement/answers.json`.

## Outputs

`judgement/` and `knowledge/` in `stardust/spec/`, committed; reference/knowledge.md is the contract. Raw material,
captures and crops stay in `<work>`.

## Gates

- S7 passes when `spec-map.mjs` reports no unmapped component and every block in the page blocks is in `catalog.json`
  (`spec-knowledge.mjs` warns otherwise).
- S10 passes when `spec-knowledge.mjs` exits 0 (every rule computed) and every open question has a default.
- A blocked origin (S1 or S2 exit 3: bot challenges or refusals on 10% or more) stops the build: ask the user to
  allow-list the crawler, or to choose `--headed` (the plugin's stealth real-Chrome tier from the diff skill's
  `live-session.mjs`, as replica uses) or `--archive <date>` (Internet Archive captures, which the provenance and a
  finding must disclose). Never choose for them, and never work around a block another way.
- Before sharing: no customer secret, internal evaluation or other migration's name in the project or the output.

## References

- reference/config.md — `spec.config.json`, template rules, parser profiles.
- reference/judgement.md — the blind rule, mapping rules, contact sheets, block families, reuse verdicts.
- reference/implementation.md — features, martech, data layer, metadata, indexes, locales, open questions.
- reference/knowledge.md — the output contract: files, fields, the rule format.
- reference/evaluation.md — scoring a spec against a delivered migration; blind re-judgement.
