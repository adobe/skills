# First page first — design note

Status: shipped as a skill contract in 0.36.0 (`skills/replica/reference/first-page-first.md`); this note keeps the
reasoning and the open questions for the next iteration.

## The problem, measured

A recorded hands-off replica run on a content site (≈ 2,500 discovered URLs, 94 in the capped roster) ran strictly in
sequence: spec, extract of the whole roster, dynamics triage, every archetype recreated and gated as a prototype,
rollout planning, the foundation, then the archetype pages. Five hours after the run started no content page was
published; the home page — the first thing an owner wants to see — existed only as a local prototype.

Almost nothing the site-wide work produced changed that home page: the dynamics triage contributed interim tiers
(snapshots, a form with no backend on preview, martech scaffolded off), and the home page defined the canon (chrome,
base styles) anyway. stardust-lite's recorded home-page cases reach a first shareable EDS URL in 37–77 min with only a
light roster pass as prerequisite.

## The experience asked for

1. The most important page (home, or the one the user names) starts at once: replica and deploy.
2. The site scope starts in parallel.
3. When the site definition is done, the first page — finished or still in progress — is checked against the plan
   and confirmed or corrected.
4. The flow continues as today, with the first page already done.

## Design

- **Two tracks, one writer per path at a time.** Track A owns code, DA, the root spec, `direction.md` and its own
  workspace `stardust/first-page/`; Track B owns knowledge (`current/`, `state.json`, dynamics docs, spec). The
  bounded procedures as first written broke this — `extract --single` writes `current/pages/<slug>.json`,
  `_crawl-log.json` and `state.json`, the bounded cap-probe writes `current/DESIGN.json`, Phase 2 writes the dynamics
  docs, and the caps rule had Track B write `direction.md` — so Track A's capture, breakpoints, dynamics and gate
  state moved to the workspace (the scripts' existing `--out` / `--write-design` / `--state` flags), and the caps
  reach `direction.md` at RECONCILE. Ownership moves only at RECONCILE, which runs while neither track writes. The
  ledger is shared: every line carries `--track`, and the start guard pairs per track.
- **The existing bounded entry is Track A**, pinned: Phase 2's branch is chosen by the track, not by whether
  `current/PRODUCT.md` exists (Track B writes that file, so the existence check would race).
- **RECONCILE is a checklist with a record**, not a re-run: seven checks, each confirmed / corrected (with its commit)
  / deferred, in `stardust/reconcile-first-page.md`. Corrections to blocks or chrome re-gate the published page.
- **Promotion replaces, corrections follow.** RECONCILE promotes Track B's spec verbatim first (the bounded spec is
  replaced, never merged), then checks; corrections are commits on code and documents, so a canon delta is never
  overwritten by the promotion.
- **The hand-off goes through the gate record.** `update-coverage.mjs --gate <Track A's table> --pin` matches the
  coverage row by path (the inventory's slug can differ from Track A's), records `delivery.gate` and pins the row;
  `verify.mjs` then derives `verified`; inventory never flags a pinned row `stale`, so a migrate re-render does not
  re-deliver the page.
- **Small instruments only.** The ledger gains two replica phases (`first-page`, `reconcile-first-page`) and
  `--track`; `update-coverage.mjs --gate` gains `--pin`, which inventory honours.

## Open questions

- Where Track B's promoted spec and Track A's bounded spec disagree, check 7 turns each difference into a code
  commit; runs will show whether that list is short enough to stay manual.
- Status reporting: `last replica --track <t>` reads each track; a status line naming both is not built yet.
- Track A's gate-all input is a one-row state file it writes by hand; a `gate-all.mjs --url` form would remove it.
- Measure: time to the first published page and the number of RECONCILE corrections across the next three runs.
