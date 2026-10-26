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

## Design rationale

The contract (tracks, ownership table, the seven checks, the hand-off) is the reference doc; this keeps the why.

- **One writer per path, by workspace.** The bounded procedures as first written broke it: `extract --single` writes
  `current/pages/<slug>.json`, `_crawl-log.json` and `state.json`, the bounded cap-probe writes `current/DESIGN.json`,
  Phase 2 writes the dynamics docs, and the caps rule had Track B write `direction.md`. Track A's files moved to
  `stardust/first-page/` through the scripts' existing `--out` / `--write-design` / `--state` flags.
- **Track A's Phase 2 branch is pinned by the track,** not chosen by whether `current/PRODUCT.md` exists: Track B
  writes that file, so the existence check would race.
- **RECONCILE is a checklist with a record, not a re-run.**
- **Promotion replaces, corrections follow:** corrections made before the verbatim promotion would be overwritten by
  it; as commits after it, a canon delta survives.
- **The hand-off goes through the gate record**, not a bare status write, and the pin keeps a migrate re-render from
  re-delivering the page.
- **Small instruments only:** two ledger phases and `--track`; `update-coverage.mjs --gate --pin`, which inventory
  honours.

## Open questions

- Where Track B's promoted design spec and Track A's bounded one disagree, check 7 turns each difference into a code
  commit; runs will show whether that list is short enough to stay manual.
- Status reporting: `last replica --track <t>` reads each track; a status line naming both is not built yet.
- Track A's gate-all input is a one-row state file it writes by hand; a `gate-all.mjs --url` form would remove it.
- Measure: time to the first published page and the number of RECONCILE corrections across the next three runs.
