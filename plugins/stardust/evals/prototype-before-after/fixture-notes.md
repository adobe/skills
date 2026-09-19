# Fixture provenance & known limitations

`fixture/` is a hand-authored realization of this eval's Setup section:
the fictional B2B bookkeeping site ("Ledgerline") after `stardust:extract`
**and** `stardust:direct` have completed — 5 pages `directed`, target
spec at the project root, active direction, no `stardust/prototypes/`.
It lives OUTSIDE the fixture tree on purpose; everything under `fixture/`
is copied verbatim into the eval workspace.

## How it was built

Start from `../direct-from-phrase/fixture/` (the post-extract state; its
`fixture-notes.md` documents every file under `stardust/current/`). Then
add what `direct` writes when the `direct-from-phrase` persona answers
its questions — the same phrase, the same answers (Gen Z college /
first-job, skip the reference set, balanced, reimagined, "go"), so this
fixture is the continuation of that eval's happy path:

- `PRODUCT.md` — impeccable `reference/init.md` template
  (`<!-- impeccable:product-schema 1 -->`, Platform … Accessibility).
  `Stack` omitted (existing site answers it), as the template allows.
- `DESIGN.md` — impeccable `reference/document.md`: Stitch frontmatter
  (colors / typography / rounded / spacing / components, hex colors,
  `{token}` refs, ≤ 8 component props) + the eight canonical sections.
  The current-state snapshot in `stardust/current/DESIGN.md` predates
  the eight-section revision and has six; the target file follows the
  reference as it stands today.
- `DESIGN.json` — document.md § Step 4b schemaVersion-2 sidecar
  (`colorMeta`, `typographyMeta`, `shadows`, `motion`, `breakpoints`,
  `components[]`, `narrative`) plus the stardust extensions direct owns
  (`direct/SKILL.md` § Outputs): `divergence` in the v2 storage shape
  from `stardust/reference/divergence-toolkit.md`, `componentStyle`,
  `systemComponentRoles`, `iaPriorities[]` (mutability `movable` under
  `reimagined`), `voice`, `containerMaxWidth` (token-contract.md
  § Sizing `--max-width`).
- `stardust/direction.md` — `direct/reference/direction-format.md`: the
  provenance comment, YAML frontmatter, and every required section of an
  `# Active direction`. Values for seed, deck and palette are legal
  members of the toolkit's vocabularies; the palette is a real entry of
  `direct/reference/palettes/library.json` (`Midnight Sky`,
  monochrome-tint) with roles renamed brand-native per toolkit § 4.
- `stardust/state.json` — `stardust/reference/state-machine.md`: the
  `direction` block (`resolvedAt`, `phrase`, `directionFile`,
  `iaFidelity`), flow keys (`redesign`, chosen from the user's phrase —
  this project will migrate, so the master skill stamped them at direct
  time), every page `directed` with a `directed` history entry appended.
  `type` stays `null` (discovery-mode extract; no `--prep` ran).
- `stardust/journal.md`, `stardust/status.jsonl` — one direct entry and
  one start/end pair per direct phase, per `journal-format.md` and
  `run-status.md`.

## Deliberate design choices

- **Rebrand on palette and type, not brand-faithful.** The persona
  says the navy-and-Georgia look is what feels old, so
  `brand_faithful_inversions` is empty and pure white is not retained.
  The indigo primary keeps a blue lineage so `prototype` has a
  recognisable brand to render, not a blank slate.
- **Exactly one anti-toolbox hit**, with a brand-specific justification,
  so the prototype's divergence audit has something real to check
  without being noisy.
- **Fonts are named but not loaded.** DESIGN.md names Space Grotesk /
  Martian Mono / Roboto Slab with system fallbacks; no `@font-face` or
  `@import` is prescribed. A prototype rendered from this spec stays
  self-contained and renders with fallbacks.

## Known limitations — don't mistake these for skill bugs

- Everything inherited from the model fixture: 1×1-pixel screenshots
  and media (the JSON claims real dimensions), fabricated sha256 hash
  strings, no `brand-review.html`, loosely specified `_crawl-log.json`.
  `prototype` reads `current/pages/home.json` and the target spec, not
  the images, so the pixel mismatch is harmless here unless a vision
  gate opens the screenshot.
- No `stardust/<slug>-shape.md` briefs exist yet (prototype writes them).
- `answers.md` deliberately withholds approval so the eval can check the
  page lands in `prototyped`, not `approved`.
