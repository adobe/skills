# Fixture provenance & known limitations

`fixture/stardust/` is a `cp -R` of the shared post-migrate fixture
(`evals/_shared/fixture-post-migrate/stardust/`, see its README — never
symlinked, never copied with the README) plus four deltas. Everything under
`fixture/` is visible to the agent under test; this note is not. There is no
`answers.md`: the task runs hands-off.

Copied before the shared tree gained `stardust/usage.json` / `stardust/usage.md`
(T13.4 usage ledger) and `stardust/current/pages/business.html` (rendered
capture) — all three absent here; the resume/usage criteria do not apply and
the skeleton reads only the `insurance__renters` capture.

## What this eval adds on top of the shared tree

- `stardust/replica/progress.json` — a top-level `modules[]` lift ledger
  (`replica/SKILL.md` § Module-kind lift ledger): `coverage-tiles` and
  `agent-locator-cta` (`firstSeen: home`, `pageType: landing`) and
  `quote-cta` (`firstSeen: insurance__home`, `pageType: program`, selector
  `.quote-cta`). Archetype entries, gate numbers and `breakpointsConfigured`
  are byte-identical to the shared tree.
- `stardust/import/vocabulary.json` — `root`, `chrome`, `wrappers` and two
  markers (`.tile-grid` → `block:coverage-tiles`, `section.find-agent` →
  `block:agent-locator-cta`). `quote-cta` has no marker and no emitter: the
  unmapped kind the plan-time gate blocks on.
- `stardust/current/pages/insurance__renters.html` — the rendered capture of
  the new `program` sibling (`.quote-cta` module with visible text and a
  CTA; `.example` asset references, never fetched).
- `stardust/state.json` — `pages[]` gains `insurance__renters` (`status:
  extracted`, `template: program`, `representative: insurance__home`); no
  other key changes.

Nothing in the shared tree is edited; `stardust/migrated/**` is the shared
six-page output, so a render of `insurance__renters` is unambiguous new output.

## What the fixture deliberately makes true

- `importer-skeleton.mjs --template program` exits 2 at plan time
  (`template program blocked — lift-ledger kinds without an emitter:
  "quote-cta"`), writes nothing under `stardust/migrated/insurance/renters/`
  and leaves `vocabulary.json` byte-identical. `--slug insurance__renters`
  fails the page with `audit.import.unmapped[]` naming `quote-cta`.
- After the grader's step-2 edit (`.quote-cta` → `block:quote-cta`) the same
  run exits 0 with `_meta.json` `fidelityTier: sibling`, `renderBranch: A'`,
  `unmapped: []`, `flattened: []`.
- The `program` archetype is `gated: false` in the ledger: the type-level
  gated-archetype precondition also fires. The task grades the module-map
  gate only; both may be reported, each by name.

## Known limitations

- No `prototypes/`, no `current/pages/*.json` records and no `.gitignore`;
  the `.example` origin is unreachable by design — zero network is the
  contract (`no_live_traffic`).
- The shared sidecars are hand-authored (`fidelityTier`, `gatesPassed[]` per
  `fidelity-tiers.md` § Declaration); only the new `insurance/renters/_meta.json`
  is skeleton output.
- Expected to fail on the 0.24.0-next.3 baseline (no module-map precondition):
  the baseline renders the sibling with the module flattened to prose.
