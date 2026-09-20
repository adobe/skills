# Journal — Larkspur Mutual replica migration

Chronological log of every prompt execution. Most recent at the bottom.
See `skills/stardust/reference/journal-format.md` for entry format.

---

## 2026-09-08T10:05:00Z — Extracted larkspurmutual.example (6 pages) and set preserve direction

**Prompt:** User asked to migrate the site to EDS keeping the current design.

**Decisions:**
- Keep-design phrase → replica flow; no redesign machinery. `extract --prep --dynamics` ran unchanged: 6 pages discovered via sitemap, all crawled (under the cap).
- Page-type catalog confirmed as landing (home, business), article (2 member-news posts), program (home and auto insurance); the remaining 13 pages are siblings of those three types.
- Preserve direction promoted `current/PRODUCT.md`, `DESIGN.md`, `DESIGN.json` verbatim to the project root; the stardust `direct` skill was not invoked.
- Inconsistency register opened with one applied entry (R-01, footer link contrast) measured during CSS lifting; no audit run, user asked for nothing else.

**Artifacts touched:**
- stardust/current/ — created (6 pages, screenshots, fonts, `_brand-extraction.json`, PRODUCT.md, DESIGN.md, DESIGN.json)
- PRODUCT.md, DESIGN.md, DESIGN.json — created (verbatim promotion)
- stardust/direction.md — created (preserve-mode record)
- stardust/replica/inconsistency-register.md — created (1 entry)
- stardust/state.json — created (19 pages `extracted` → `directed`, `type` set)

**Findings worth flagging:**
- Body face is a licensed kit; a metric-matched open face is the permanent 🟠 fork for the gate.
- The member-news pages load a related-articles rail from a personalization endpoint that answers 403 to headless clients — expect capture-state residuals there.

**Open questions:**
- none

**Next:** $stardust replica — recreate one archetype per page type and run the source-fidelity gate at 1440 and 360.

---

## 2026-09-09T17:22:00Z — Recreated three archetypes; gated landing and article, program deferred

**Prompt:** User asked to continue the replica and see all three archetypes before migrating.

**Decisions:**
- `home` (landing) passed the gate at 1440 (2.14%, iteration 2) and 360 (3.87%, iteration 3); approved.
- `news__storm-season-checklist` (article) hit the 3-iteration cap over the bar at both breakpoints (11.6% / 12.4%); every residual is cause-logged — the personalization rail (capture-state, flagged for delivery) and glyph antialiasing from the font fork (flagged for user). Approved with residuals per § Residual logging.
- `insurance__home` (program) was approved on visual review; the user asked to migrate all pages first and gate the program archetype afterwards. Gate NOT run — recorded as `gated: false` in progress.json.
- Motion observed on `home` only (nav shrink, tile hover lift); `aos-fade-up` classes were dead on every archetype and not implemented.

**Artifacts touched:**
- stardust/prototypes/{home,news__storm-season-checklist,insurance__home}-proposed.html — created
- stardust/replica/progress.json — created (per-archetype gate ledger)
- stardust/replica/gates/ — created (live/proto/diff captures per iteration; not committed)
- stardust/replica/motion/home.json — created
- stardust/state.json — updated (3 archetypes `prototyped` → `approved`)

**Findings worth flagging:**
- The 360 height delta on the article (−7px) came from the stacked rail placeholder, not from the prose; the prose columns matched within 1px.

**Open questions:**
- The program archetype ships ungated if rollout proceeds before its gate — the user accepted this ordering explicitly.

**Next:** $stardust migrate — render the six in-scope pages (archetypes at Path A, siblings at Path A′).

---

## 2026-09-10T15:40:02Z — Migrated six pages (three archetypes + three siblings)

**Prompt:** User asked to migrate the approved archetypes and their first siblings.

**Decisions:**
- Path A for the three archetypes, Path A′ for `business`, `news__annual-report-2025`, `insurance__auto` (sibling-variance probe recorded one block variant per sibling, listed in each `_meta.json` `variants[]`).
- Output paths follow the URL-literal rule; every source URL carried a trailing slash so no `outputPathDefault` was recorded.
- R-01 applied on every page as a `migrationDecisions[]` entry; no deviations.
- Bundle finalised self-contained: three assets (favicon, logo, canon CSS), zero broken internal links.

**Artifacts touched:**
- stardust/migrated/**/index.html + _meta.json — created (6 pages)
- stardust/migrated/assets/ — created (3 files)
- stardust/state.json — updated (6 pages `migrated`; `migrate` block written)

**Findings worth flagging:**
- The sibling-variance probe found the coverage tile count differs per landing page (3 vs 4); modelled as a block variant, not a fork.

**Open questions:**
- none

**Next:** $stardust rollout — after gating `insurance__home`.

---

## 2026-09-14T08:31:10Z — Resumed on 0.23.0: flow stamped, rollout blocked on the program archetype

**Prompt:** User asked to roll the site out to EDS.

**Decisions:**
- Flow guard fired: `state.json` predates the flow keys. Asked the one keep-vs-redesign question; user answered "keep the design" → `flow: replica`, `flowSource: question`.
- Rollout Setup read `stardust/replica/progress.json`: `landing` and `article` may ship (pass, and pass with cause-logged residuals); `program` is blocked because `insurance__home` was never gated. No page was delivered; no `POST /live/` was made.

**Artifacts touched:**
- stardust/state.json — updated (`flow`, `flowChosenAt`, `flowSource`)
- stardust/status.jsonl — appended (rollout Setup `blocked`)

**Findings worth flagging:**
- Migrated siblings of an ungated archetype are exactly what the rollout precondition exists to stop; the migration itself stays valid, the gate is what is missing.

**Open questions:**
- Whether the user accepts the article residuals flagged `user` (glyph antialiasing, hamburger sub-pixel offset) or wants a fourth, budgeted iteration.

**Next:** $stardust replica insurance__home — gate the program archetype at 1440 and 360, then $stardust rollout.

---

## 2026-09-15T10:13:05Z — Captured two new landing pages (members, claims) for fan-out

**Prompt:** User asked to bring the members and claims pages into scope.

**Decisions:**
- `$stardust extract --pages members,claims` (bounded entry): two page records under `stardust/current/pages/`, both typed `landing` — the type whose archetype (`home`) is gated at 1440 and 360.
- Nothing rendered yet; the sibling tier follows the archetype's gate.

**Artifacts touched:**
- stardust/current/pages/members.json — created
- stardust/current/pages/claims.json — created
- stardust/state.json — two pages `extracted`

**Findings worth flagging:**
- Both new pages sit under a campaign template (a persistent sub-navigation band under the header) — noticed in the screenshots, not yet reflected anywhere in the ledger.

**Next:** $stardust replica — fan out `members` and `claims` at sibling tier from the gated `home` archetype.

---
