# Eval: dynamics triage — the `target` column names the delivery form

## Setup

A same-design (`replica`) migration of a regional retail bank's site, five
pages already migrated, with the dynamics skill's Phase 1 (detect) complete
and saved:

- `stardust/state.json` — `flow: replica`, `handsOff: true`, five pages in
  status `migrated`.
- `stardust/current/_dynamics.json` — the detect output: `_provenance`, five
  `pages`, and nine `findings`:
  `F1` a JS-submitted 3-field calculator form (hint `client-compute?`),
  `S1` the site search form → `/search` on every page,
  `F2` a form-less control group (4 controls, submit "Send"),
  `A1` a first-party API `GET /api/store-locator`,
  `F3` an authored 5-field contact form → `/thanks`,
  `L1` a listing candidate `.news` (8 cards),
  `M1` a modal trigger `.js-modal → /contact`,
  `X1` sign-in / account links (hint `decided-out`),
  `X2` a session-bound dealer-locator shortlist (hint `decided-out`).
- `stardust/current/dynamic-features.generated.md` — the same findings as
  the detect table.
- No `stardust/dynamics/`, no `stardust/dynamic-features.md` yet.
- No network, no browser, no target host, no `stardust/migrated/` tree.
  Impeccable installed.

## User prompt

"Run the stardust dynamics skill's Phase 3 triage on the saved detection in `stardust/current/_dynamics.json` — hands-off, no questions: draft the plan with the skill's plan script, then curate `stardust/dynamic-features.md` (Listings contract, Features table with every axis including the delivery form, Decision batch, Register) and `stardust/dynamic-features-plan.md`. Do not re-run detection, do not probe a target host, do not touch the migrated pages or implement anything — this machine has no network and no browser. Where an owner decision is needed, record the assumption and the default instead of asking me."

## Expected behavior

The stardust `dynamics` skill is invoked at Phase 3. It:

1. Runs `dynamics-plan.mjs --in stardust/current/_dynamics.json --out
   stardust/dynamics` (no `--target-origin`, no `--migrated`) and gets
   `stardust/dynamics/dynamic-features.generated-plan.json` + `.md`, one row
   per finding with class · disposition · reproducibility · status, pattern,
   phase, decision and `target`.
2. Curates `stardust/dynamic-features.md` in the `reference/triage.md` shape
   — `## Listings contract`, `## Features` table whose header includes a
   `target` column (`| # | id | feature | class | reach | disposition | target
   | reproducibility | status | pattern | decision / owner | evidence |`),
   `## Decision batch`, `## Register (decided-out)` — keeping the script's
   targets per the rule "widget when the section carries no authored
   content; block when authors fill rows":
   - `F1` calculator → `widget` (client-only),
   - `S1` site search → `widget` (index-backed, search-index-backed),
   - `F2` form-less control group → `widget` (no authored copy),
   - `A1` store-locator API → `widget` (data-fed locator),
   - `F3` authored contact form → `block`,
   - `L1` news listing → `block` (index-backed, authored rows as fallback),
   - `M1` modal → `runtime` (page-wide modal loader),
   - `X1` sign-in / account links and `X2` session-bound shortlist: the
     script draft marks them `decided-out` with NO target (`—`); the curated
     inventory, being hands-off with no owner answer, does NOT keep
     `decided-out` (an assumption never sets it) — each gets an interim
     disposition (`static-snapshot` "undecided — revisit at rollout" or
     `rebuild-native`) with its owner decision in the Decision batch, and
     the Register stays empty until the owner answers.
3. Writes `stardust/dynamic-features-plan.md` (phases, deliverables,
   authoring contract, verification, owner decisions) and lists the
   non-`self` rows as one decision batch with recorded assumptions.
4. Asks no questions; never fabricates a target host or implementation.
