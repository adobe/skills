# Eval: move-combination contract (prototype Phase 1 step 7)

## Setup

A project with `stardust:direct` already complete:

- `stardust/state.json` lists 5 pages, all status `directed`. The
  home page is in scope.
- `PRODUCT.md`, `DESIGN.md`, `DESIGN.json` exist at project root
  (target spec).
- `stardust/direction.md` exists with `# Active direction` and a
  `# Anchors` section listing 3 stunning anchors and 1 slop anchor
  (per the exemplar-anchoring eval setup, e.g.
  `editorial-civic-2024`, `tactile-publishing-2025`,
  `archival-museum-2023`, `slop-fintech-stock-2024`).
- `stardust/current/pages/home.json` carries the page's structure
  and content.
- `stardust/current/_brand-extraction.json` exists.
- Impeccable installed.
- The plugin's `divergence-toolkit.md` §1a contains the seed catalog
  with at least the seed entries: `layout/asymmetric-grid`,
  `type/editorial-serif-display`, `palette/duotone-high-contrast`,
  `image/no-imagery`, `motion/still-but-precise`, `tone/declarative`.
- `divergence-toolkit.md` §1a default-combinations registry contains
  one entry: `default-combo/generic-2026-saas` triggering on
  `[layout/centered-single-column, type/all-caps-grotesque-display,
  structural/sticky-nav, structural/two-button-cta-pair]`.

The eval runs three sub-scenarios in sequence, each an independent
invocation against this same setup:

## Scenario A — compliant brief

### User prompt

"$stardust prototype home"

### Expected behavior

Phase 1 produces `stardust/prototypes/home-shape.md` with a
`## Committed moves` block declaring **at least 3 moves spanning at
least 3 distinct axes**, each with a `brand_justification` field
non-empty and tracing to a fact in the extracted brand or
`direction.md`. Each entry has an `anchor_ref` either citing one of
the anchors from `direction.md` or set to `null` with a one-line
divergence reason.

Phase 1 step 7 enforces the contract on the brief **before**
showing it to the user (step 8). The brief shown is contract-
compliant. The user is asked to confirm before Phase 2 renders.

## Scenario B — non-compliant brief (under floor)

### User prompt

"$stardust prototype home"

The agent is *primed* (via the runner's harness, not the user) to
initially draft a brief with only 2 moves, both on the `type` axis.

### Expected behavior

Phase 1 step 7 **rejects** the brief with a clear failure message
naming which rule failed (`floor: only 2 moves committed; need ≥3`
AND `floor: moves span 1 axis; need ≥3`). The brief is **not** shown
to the user. The agent re-authors with additional moves on
different axes. The re-authored brief passes the contract; only then
is the user shown the brief at step 8.

No attempt to ship the non-compliant brief is made. The
`--bypass-contract` flag is not invoked (it was not requested by the
user).

## Scenario C — default-combo flag (warn, not reject)

### User prompt

"$stardust prototype home"

The agent is primed to draft a brief that commits to all four moves
of the `default-combo/generic-2026-saas` registry entry. Each move
has a non-empty `brand_justification`; the floor is satisfied (4
moves across 4 axes).

### Expected behavior

Phase 1 step 7 **flags but does not reject** the brief. The agent
surfaces a warning with the matched `combo_id` and the
`resolution` note from the registry, then asks the user to confirm
or revise. If the user confirms, Phase 2 proceeds and the
combo-flag event is recorded in the brief's
`_provenance.contract_flags[]`. If the user revises, step 7
re-runs against the revised brief.

## Cross-scenario expectations

In all three scenarios:

- The brief includes the `## Committed moves` block per
  `prototype/reference/page-shape-brief.md`.
- Move ids reference `divergence-toolkit.md` §1a entries (not
  invented).
- `brand_justification` is non-empty on every entry.
- Anchor references either cite a `direction.md` anchor id or are
  `null` with a one-line reason.
- `--bypass-contract` is not silently invoked. If the user passes
  it, it is recorded in `_provenance.contract_bypass` with the
  user's verbatim acknowledgement.
- For multi-variant runs (not tested here, but the contract
  applies): pairwise variance ≥2 moves between any two variants on
  the same page.