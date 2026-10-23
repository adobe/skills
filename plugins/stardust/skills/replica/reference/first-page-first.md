# First page first — one page delivered while the site is still being defined

The opening of a full-site replica run (`--first-page <url|home>`; hands-off: the home page). Two tracks start
together, meet once at RECONCILE, and the flow continues as before with one page already delivered.

## Track A — the first page, to the published origin

SKILL.md's bounded entry (`extract <url> --single --dynamics`) → Phase 2 bounded promotion → Phases 3–4 for this page
→ Phase 5 for this page (`deploy`, then the published-origin gate). Ledger `replica first-page`. Track A **owns the code
and DA**: styles, fonts, header/footer, its blocks and documents. Its dynamic features ship their interim tier.

## Track B — the site scope, knowledge only

Phase 1 `--prep` (the roster's caps said out loud), page types, module catalog, dynamics detect + triage, owner
questions. It writes `stardust/current/`, `state.json`, `dynamic-features*.md` and the spec — never code or DA. A
finding that needs code waits for RECONCILE.

## RECONCILE — when Track B is done (Track A finished or still running)

Ledger `replica reconcile-first-page`. One row per check in `stardust/reconcile-first-page.md`:
`confirmed | corrected (<commit>) | deferred (<why>)`.

1. **Page type** — type and archetype role match the catalog.
2. **Blocks** — each maps to a catalog module; names, variants and content models fit the siblings that will reuse it
   (generalise now as a variant, never fork later).
3. **Chrome** — the catalog's header/footer variants fit as variants; the nav/footer documents cover them.
4. **Dynamics** — each feature triaged for this page is built or on its interim tier; endpoints match the plan.
5. **Listings** — the page's metadata fits the listings contract.
6. **Scope** — no link treats a decided-out or app-routed path as an EDS page.
7. **Canon** — its base styles, tokens and breakpoints are the canon, or the deltas are applied now.

Phase 2 then promotes verbatim, keeping what a check confirmed. A correction to blocks or chrome re-runs the page's
published-origin gate. Under hands-off, corrections apply without asking and the run summary lists them.

## Then

Phase 3 recreates the remaining types; the first page's blocks and chrome are the foundation (rollout's C0 freezes
them, never rebuilds them). After rollout's inventory, record the page as delivered:
`update-coverage.mjs <slug> --status verified --url <published URL>`.
