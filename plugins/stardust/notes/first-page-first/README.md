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

- **Two tracks, one writer each.** Track A owns code and DA; Track B owns knowledge (`current/`, `state.json`,
  dynamics docs, spec). No file has two writers, so the tracks never merge-conflict; a Track-B finding that needs code
  queues for RECONCILE.
- **The existing bounded entry is Track A.** replica already had a first-class single-page entry
  (`extract --single --dynamics`, bounded promotion); first-page-first runs it to the published origin instead of
  stopping at a pilot prototype.
- **RECONCILE is a checklist with a record**, not a re-run: seven checks, each confirmed / corrected (with its commit)
  / deferred, in `stardust/reconcile-first-page.md`. Corrections to blocks or chrome re-gate the published page.
- **No new instrument.** The ledger gains two replica phases (`first-page`, `reconcile-first-page`); rollout already
  records a delivered page with `update-coverage.mjs <slug> --status verified --url …`.

## Open questions

- Track B's verbatim Phase 2 promotion vs Track A's bounded spec: the contract keeps what RECONCILE confirmed; a
  mechanical merge (`preserve-direction.md` § 1a) may be needed once runs show where they disagree.
- Status reporting: one status line per track (setup, then both tracks' phase) — today the ledger interleaves them.
- Measure: time to the first published page and the number of RECONCILE corrections across the next three runs.
