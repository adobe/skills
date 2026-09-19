---
name: dynamics
description: Find, classify, triage, re-implement and verify a source site's dynamic surface (APIs, search, forms, modals, media, tags, client-rendered and sheet-backed content) during a migration to a platform. Migration-bound — invoked by prepare-migration, replica, migrate and rollout, or standalone on an already-migrated site; never for redesign-only work.
license: Apache-2.0
compatibility: Requires Node 22+, Playwright with Chromium resolvable from the project, playwright-cli on PATH, and the impeccable skill (github.com/pbakaus/impeccable) installed alongside stardust.
---

# stardust:dynamics — the dynamic surface of a migration

## Operator card

Phases, in order: 1 Detect → 2 Classify → 3 Triage (the gate output) → 4 Implement → 5 Verify. Which phases each caller runs: § When it runs.

| Phase | Command |
|---|---|
| 1 | `node skills/dynamics/scripts/dynamics-detect.mjs --from-state stardust/state.json --out stardust/current [--reach stardust/current]` (or `--urls …`) |
| 2 | class per finding; vendors via `scripts/vendors.json`; `dynamics-plan.mjs --target-origin <host>` marks dead first-party API paths host-bound |
| 3 | `node skills/dynamics/scripts/dynamics-plan.mjs [--target-origin …] [--migrated stardust/migrated] --out stardust/dynamics`; curate `stardust/dynamic-features.md` + `-plan.md`; `dynamics-plan.mjs --lint <inventory.md> <plan.md>` (every row placed once) |
| 4 | per plan phase, from the pattern catalogue; tooling `snapshot-api.mjs`, `snapshot-forms.mjs`, `sync-sheets.mjs` |
| 5 | write `stardust/dynamics/parity.json`; `node skills/dynamics/scripts/dynamics-check.mjs --origin <published origin> [--auth-header … | --token-env SITE_TOKEN] [--gate]` |

Gates: Phase 3 — a row without a disposition fails the caller's pre-import gate (prepare-migration 4.5 / replica Phase 2 / rollout B2). Phase 4 — each plan phase ends with the flow verified on the published origin at both gate widths, a parity row, a journal entry and a commit. Phase 5 — replayed flows, not presence; `--gate` is the close-out condition (`reference/parity-report.md` rule 8).

Outputs: `stardust/current/_dynamics.json` + `dynamic-features.generated.md` · `stardust/dynamics/dynamic-features.generated-plan.{md,json}` · `stardust/dynamic-features.md` + `-plan.md` · `helix-query.yaml` · `data/<feature>/*.json` + `_provenance.json` · `scripts/site-config.js` · `stardust/dynamics/parity.json` · `stardust/qa/dynamics-report.{md,json}`.

| At phase | Read |
|---|---|
| 1 | `reference/classes-and-signals.md` § Detection procedure · § Known noise |
| 2 | `reference/classes-and-signals.md` § Classes · § Vendor table · § Origin-bound probe |
| 3 | `reference/triage.md` § Dispositions · § Reproducibility · § Rules · § `stardust/dynamic-features.md` |
| 4 | `reference/patterns.md` (one section per pattern); `reference/listings.md` § Mechanics · § Block contract; `reference/off-origin-data.md` § Tier 1 · § Tier 2 · § Tier 3 · § Tier 4 · § Sheet-backed data (class D); `reference/forms.md` § 1. Record the live form · § 2. Key the inventory · § 3. Decide the intake · § 4. The block · § 5. Regulated data; `reference/locale-trees.md` |
| 5 | `reference/parity-report.md` § Schema · § Rules; `reference/listings.md` § Verify; `reference/off-origin-data.md` § Verify (flows, not presence); `reference/forms.md` § 6. Verify (flow) |

Sections: When it runs · Phase 1 — Detect · Phase 2 — Classify · Phase 3 — Triage · Phase 4 — Implement · Phase 5 — Verify · Hands-off resolutions · Hard blockers · Artifacts · References.

Static migration treats a page as content and layout. This skill treats it as **behaviour**:
everything the source renders from JavaScript, a service or a data source, and everything the
target host cannot serve the same way — a surface a block-scoped, pixel-verified pipeline
certifies as correct while modals render as links, video pills as CTAs without targets, a search
box as a 404. It forces a decision per row **before import**, then proves the behaviour after
delivery. It never blocks the static path; every page must still work as a static page.

## When it runs — migration-bound, default-on there, never elsewhere

| entry point | what runs here |
|---|---|
| `prepare-migration` Phase 4.5 · `replica` Phase 2 | Phases 1–3 (detect on archetypes, classify, triage) — the pre-import gate |
| `migrate` Phase 1 | safety net: no inventory → run Phases 1–3 now (hand-run `extract → direct → prototype → migrate` never passed a gate) |
| `deploy` | reads the inventory as brief input (fallback rows, `#modal` markers, endpoint config; never flatten `client-only` / modal-bearing sections) |
| `rollout` B2 · D2 | B2 verifies the inventory against fresh evidence; D2 = Phase 4 for the `self` set + one owner batch |
| `qa` `dynamics` check · rollout report | Phase 5 replay of `parity.json` |
| **standalone** `$stardust dynamics <origin>` | all phases on a site that was already migrated without them |
| **chain ends at `deploy`** (pilot, no rollout) | Phases 4–5 run standalone before the pilot is declared done; `parity.json` + `dynamics-check.mjs --gate` exit 0 are required in both flows |

`uplift`, `audit` and a bare `extract` never trigger it: dynamics is a migration concern (EDS today,
other platforms later), not a redesign one.

## Phase 1 — Detect

Command: Operator card row 1 (or `--urls` one per archetype + the home page). Depth on archetypes, reach from the crawl's
`extract --dynamics` per-page signals. Output `stardust/current/_dynamics.json` +
`dynamic-features.generated.md`. Evidence only. `reference/classes-and-signals.md`.

## Phase 2 — Classify

Every finding gets a class from `L S F M V T A R X I18N CR D`; known vendors resolve to a role
through `scripts/vendors.json`; unknown third-party hosts stay visible as "inspect". When a target
host exists, `dynamics-plan.mjs --target-origin <host>` probes every recorded first-party API path
there and marks dead ones **host-bound** — the signal a pixel gate reports as "band shorter".

## Phase 3 — Triage (the gate output)

`dynamics-plan.mjs` (Operator card row 3) drafts one row per finding with the four axes pre-filled — **class · disposition ·
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
and a commit. Tooling: `snapshot-api.mjs`, `snapshot-forms.mjs`, `sync-sheets.mjs`. **Listings and data-fed bands are document-first**: the document carries the item text as authored rows, the block reads the index or snapshot only for non-text fields and top-up (`reference/listings.md` § Block contract; why: `deploy/reference/ai-readability.md`).

## Phase 5 — Verify: dynamic parity

Write `stardust/dynamics/parity.json` (`reference/parity-report.md`) with replayable checks from the
closed set; `dynamics-check.mjs` (Operator card row 5) writes `stardust/qa/dynamics-report.md`;
`--gate` is the close-out condition. **Flows, not presence.** The site secret rides an
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
| class S search box with no results page | interim = the index-backed `/search` over `query-index.json`; if it cannot ship, point the box at the live results page; a submit target that 404s is never promoted |
| `self` row unshipped at close-out | `reference/parity-report.md` rule 8 remedy |

## Hard blockers (`event: "blocked"`)

Source unreachable from the probe network; target config not writable when endpoint indirection is
required; an interim tier that would capture regulated data (record as decided-out instead).

## Artifacts

The Operator card's Outputs line, plus register rows · journal + status lines.

## References

- `reference/classes-and-signals.md` — the class axis, detector procedure, vendor table policy, origin-bound probe.
- `reference/triage.md` — the four axes, rules, the inventory file format.
- `reference/patterns.md` — catalogue: contracts + verification per pattern, example mechanisms.
- `reference/listings.md` — metadata contract + query-index mechanics + document-first block contract.
- `reference/off-origin-data.md` — feeding an existing library off-origin; sheet-backed data; chrome URL space.
- `reference/forms.md` — controls not form tags; intake by content source; regulated data.
- `reference/parity-report.md` — schema, check types, rules.
- `reference/locale-trees.md` — I18N as a tree.
- `scripts/` — `dynamics-detect.mjs`, `dynamics-plan.mjs`, `dynamics-check.mjs`, `snapshot-api.mjs`, `snapshot-forms.mjs`, `sync-sheets.mjs`, `vendors.json`, `lib.mjs`.
