---
name: dynamics
description: Find, classify, triage, re-implement and verify a source site's dynamic surface (APIs, search, forms, modals, media, tags, client-rendered and sheet-backed content) during a migration to a platform. Migration-bound — invoked by prepare-migration, replica, migrate and rollout, or standalone on an already-migrated site; never for redesign-only work.
license: Apache-2.0
---

# stardust:dynamics — the dynamic surface of a migration

Static migration treats a page as content and layout. This skill treats it as **behaviour**:
everything the source renders from JavaScript, a service or a data source, and everything the
target host cannot serve the same way. Three real migrations found the same thing: the dynamic
surface is invisible to a block-scoped, pixel-verified pipeline — and invisible in a way every gate
certifies as correct. Modals rendered as links, video pills as CTAs without targets, a search box as
a 404, forms that rendered and could not submit. This skill makes that surface visible and forces a
decision per row **before import**, then proves the behaviour after delivery. It never blocks the
static path; every page must still work as a static page.

## When it runs — migration-bound, default-on there, never elsewhere

| entry point | what runs here |
|---|---|
| `prepare-migration` Phase 4.5 · `replica` Phase 2 | Phases 1–3 (detect on archetypes, classify, triage) — the pre-import gate |
| `migrate` Phase 1 | safety net: no inventory → run Phases 1–3 now (hand-run `extract → direct → prototype → migrate` never passed a gate) |
| `deploy` | reads the inventory as brief input (fallback rows, `#modal` markers, endpoint config; never flatten `client-only` / modal-bearing sections) |
| `rollout` B2 · D2 | B2 verifies the inventory against fresh evidence; D2 = Phase 4 for the `self` set + one owner batch |
| `qa` `dynamics` check · rollout report | Phase 5 replay of `parity.json` |
| **standalone** `$stardust dynamics <origin>` | all phases on a site that was already migrated without them |

`uplift`, `audit` and a bare `extract` never trigger it: dynamics is a migration concern (EDS today,
other platforms later), not a redesign one.

## Phase 1 — Detect

`node skills/dynamics/scripts/dynamics-detect.mjs --from-state stardust/state.json --out stardust/current [--reach stardust/current]`
(or `--urls` one per archetype + the home page). Depth on archetypes, reach from the crawl's
`extract --dynamics` per-page signals. Output `stardust/current/_dynamics.json` +
`dynamic-features.generated.md`. Evidence only. `reference/classes-and-signals.md`.

## Phase 2 — Classify

Every finding gets a class from `L S F M V T A R X I18N CR D`; known vendors resolve to a role
through `scripts/vendors.json`; unknown third-party hosts stay visible as "inspect". When a target
host exists, `dynamics-plan.mjs --target-origin <host>` probes every recorded first-party API path
there and marks dead ones **host-bound** — the signal a pixel gate reports as "band shorter".

## Phase 3 — Triage (the gate output)

`node skills/dynamics/scripts/dynamics-plan.mjs [--target-origin …] [--migrated stardust/migrated] --out stardust/dynamics`
drafts one row per finding with the four axes pre-filled — **class · disposition ·
reproducibility · status** — plus pattern, phase and the owner decision. Curate it into
`stardust/dynamic-features.md` (subsumes the former dynamic-blocks map: § Listings contract +
§ Features + § Decision batch + § Register) and `stardust/dynamic-features-plan.md`.
`reference/triage.md` is the contract. Rules that decide the shape of the phase:

- **Reconcile against the migrated output** before scheduling anything.
- Only reproducibility `self` ships autonomously; everything else is **one decision batch**.
- Never fabricate copy for a blank client-rendered capture; never auto-wire a `regulated-pii` form;
  a search box implies a results page; decided-out is explicit.
- **Gate:** a row without a disposition fails prepare-migration 4.5 / replica Phase 2 / rollout B2.
  The static migration continues regardless.

## Phase 4 — Implement (per plan phase)

From `reference/patterns.md` (catalogue + contracts + embedded example mechanisms),
`reference/listings.md`, `reference/off-origin-data.md`, `reference/forms.md`,
`reference/locale-trees.md`. Principles that held on three sites: static first, then wire ·
authoring contract before code · no owner input, no waiting (ship the interim tier, name the
decision) · existing library first (feed it, do not fork it) · decided-out is explicit. Each phase
ends with the flow verified on the published origin at 1440 and 360, a parity row, a journal entry
and a commit. Tooling: `snapshot-api.mjs`, `snapshot-forms.mjs`, `sync-sheets.mjs`.

## Phase 5 — Verify: dynamic parity

Write `stardust/dynamics/parity.json` (`reference/parity-report.md`) with replayable checks from the
closed set; `node skills/dynamics/scripts/dynamics-check.mjs --origin <published origin> [--auth-header … | --token-env SITE_TOKEN]`
writes `stardust/qa/dynamics-report.md`. **Flows, not presence.** The site secret rides an
origin-scoped route filter only; third-party request statuses are recorded next to every assertion.

## Hands-off resolutions

| gate | resolution |
|---|---|
| owner decision (backend, tags on the new host, datasource ownership, locale scope) | ship the interim tier, record the decision by name in the plan and parity report, continue |
| unknown third-party host | classify from the XHR body; else `T` "inspect" — never drop silently |
| blank client-rendered capture | hard content gap → human-capture batch; never migrate blank |
| regulated-pii form | UI rebuilt, submission blocked, mandatory decision |
| hand-off target unreachable from the test network | `environment-limit` row with the egress region; not a defect |
| content source cannot receive submissions | local capture with an explicit "no backend connected" message; decision named |

## Hard blockers (`event: "blocked"`)

Source unreachable from the probe network; target config not writable when endpoint indirection is
required; an interim tier that would capture regulated data (record as decided-out instead).

## Artifacts

`stardust/current/_dynamics.json`, `dynamic-features.generated.md` · `stardust/dynamics/dynamic-features.generated-plan.{md,json}` ·
`stardust/dynamic-features.md`, `stardust/dynamic-features-plan.md` (curated) · `helix-query.yaml` (listings) ·
`data/<feature>/*.json` + `_provenance.json` (snapshots, code bus) · `scripts/site-config.js` (owner-facing integrations, disabled) ·
`stardust/dynamics/parity.json` · `stardust/qa/dynamics-report.{md,json}` · register rows · journal + status lines.

## References

- `reference/classes-and-signals.md` — the class axis, detector procedure, vendor table policy, origin-bound probe.
- `reference/triage.md` — the four axes, rules, the inventory file format.
- `reference/patterns.md` — catalogue: contracts + verification per pattern, example mechanisms.
- `reference/listings.md` — metadata contract + query-index mechanics (formerly rollout's dynamic-listings).
- `reference/off-origin-data.md` — feeding an existing library off-origin; sheet-backed data; chrome URL space.
- `reference/forms.md` — controls not form tags; intake by content source; regulated data.
- `reference/parity-report.md` — schema, check types, rules.
- `reference/locale-trees.md` — I18N as a tree.
- `scripts/` — `dynamics-detect.mjs`, `dynamics-plan.mjs`, `dynamics-check.mjs`, `snapshot-api.mjs`, `snapshot-forms.mjs`, `sync-sheets.mjs`, `vendors.json`, `lib.mjs`.
