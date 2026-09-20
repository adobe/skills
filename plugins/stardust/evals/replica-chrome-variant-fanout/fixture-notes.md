# Fixture provenance & known limitations

`fixture/stardust/` is a copy of the shared post-migrate fixture
(`evals/_shared/fixture-post-migrate/stardust/`, copied with `cp -R` per its
README — never symlinked) plus the additions below. Everything under
`fixture/` is copied into the eval workspace and is visible to the agent;
this note and `answers.md` are not.

## What this eval adds on top of the shared tree

- `stardust/current/pages/*.json` — eight minimal page records (the shared
  tree ships none), each with the `chrome` field `crawl.mjs` records
  (`extract/reference/current-state-schema.md` § Chrome). Six carry the
  main fingerprint (`site-header site-header--main`, `site-footer`, one nav
  row, `main.<hash>.css` + `theme.css`, body class `tpl-main`; the storm
  checklist record adds a state class `is-sticky`, which must not split the
  bucket). `members` and `claims` carry the campaign fingerprint
  (`site-header--campaign has-subnav`, `site-footer--compact`, two nav rows,
  an extra `campaign.<hash>.css`, body class `tpl-campaign`). Records hold
  only what the inventory reads — no body copy, no screenshots.
- `stardust/state.json` — two new `landing` pages, `members` and `claims`,
  `extracted` on 2026-09-15 (no prototype, no migrated path); `site.crawled`
  / `totalDiscovered` 6 → 8. No page carries `chromeVariant`.
- `stardust/replica/progress.json` — a top-level `chrome` block with one
  variant row, `default` (shape from `evals/lint/fixtures/chrome-variants/
  progress.json`; states cover the matrix incl. `search: dead` and
  `drawer-drilled: unprobed:…`; `pages: 6`, `archetype: home`), and
  `chromeVariant: "default"` on every `archetypes[]` entry. The gate results
  themselves are unchanged.
- `stardust/journal.md` — a fifth entry for the capture whose `Next:` line
  asks for the fan-out; `stardust/status.jsonl` — two extract lines.

## What the fixture deliberately makes true

- Running `chrome-variants.mjs --pages stardust/current/pages --state
  stardust/state.json --progress stardust/replica/progress.json` from the
  workspace exits 2: `default` (6 pages, rowed) and a `variant-<key>` bucket
  of exactly `members` + `claims` with no row. The `landing` page type IS
  gated (`home` passes at both breakpoints) — so the page-type precondition
  (`gate-ledger-lint.mjs`) would let the fan-out through; only the chrome
  gate blocks it. That separation is the point of `chrome_archetype_gated`.
- The two new pages are the only pages of their variant, so any "just fix
  the header on these two" shortcut is exactly the page-local compensation
  `no_page_local_compensation` pins against.
- The `chrome-variant` decision row is referenced by the replica skill and
  `chrome-states.md`; the eval judges that the decision is surfaced with
  its default, not the exact row text.

## Known limitations — don't mistake these for skill bugs

- The origin is a `.example` host: a `chrome-states.mjs` probe on the new
  variant fails (or hits the run-capped deadline). That is expected and
  ungraded beyond `hit_minimisation_and_graceful_stop`; the eval ends at the
  hand-off.
- `stardust/prototypes/`, `stardust/replica/gates/`, the root `PRODUCT.md`
  / `DESIGN.md` / `DESIGN.json` and `stardust/current/assets/` are absent
  (see the shared README). The `default` bucket needs none of them for this
  scenario.
- The generated variant name is derived from a hash of the fingerprint
  (`variant-<4 hex>`); the criteria accept whatever the tool prints, so a
  change in the fingerprint inputs does not break the eval.
- Every sha in the tree is syntactically valid but fabricated; nothing
  hashes to it.
