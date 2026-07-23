# Fixture provenance & known limitations

`fixture/` is a hand-authored realization of this eval's Setup section: a
fictional conservative B2B bookkeeping site ("Ledgerline") immediately after
`stardust:extract` completed on 5 pages. It lives OUTSIDE the fixture tree on
purpose — everything under `fixture/` is copied verbatim into the eval
workspace, and notes like this one must not be visible to the agent under
test.

## Where each shape came from

- `stardust/state.json` — `skills/stardust/reference/state-machine.md`
  (file shape and key order; `extracted` state; `type` stays null until
  prep; page entries satisfy the `validateProvenance()` conditions).
- `stardust/current/pages/*.json` — `skills/extract/reference/current-state-schema.md`
  (all top-level keys required, missing data as `[]`/`null` never omitted;
  full 5-field live-render provenance).
- `stardust/current/_brand-extraction.json` — `skills/extract/reference/brand-surface.md`
  (palette roles, type incl. `scaleAudit`, spacing, motifs, componentStyle,
  systemComponents, voice + voiceTable, crossPromo `detected:false`).
- `stardust/current/PRODUCT.md` — extract Phase 4 + impeccable's
  `reference/init.md` section list.
- `stardust/current/DESIGN.md` / `DESIGN.json` — impeccable's
  `reference/document.md` (Stitch frontmatter, six fixed sections,
  schemaVersion-2 sidecar) plus extract's v1 carry-forward extensions.
- `stardust/status.jsonl`, `stardust/journal.md` — `reference/run-status.md`
  and `reference/journal-format.md`.

## Deliberate design choices

- **Signal-strong on purpose**: 6-role palette + named font families +
  modular scale, so `direct`'s setup classifies the brand surface as
  signal-strong and Mode A (brand-faithful) fires by default. To test
  rebrand mode instead, thin the brand surface — don't reuse this fixture
  as-is.
- `state.json.direction` is present as `null` (preserves the documented key
  order; extract itself doesn't own that key).

## Known limitations — don't mistake these for skill bugs

- Screenshots and media are valid but 1×1-pixel PNGs; the JSON metadata
  claims realistic intrinsic dimensions (e.g. 1920×1200). `direct` never
  opens images, but the mismatch matters if this fixture is reused for
  `prototype` or vision-gated flows.
- `domFingerprintHash` / `markupHash` values are syntactically valid,
  fabricated sha256 strings — nothing actually hashes to them.
- `brand-review.html` (extract Phase 5 output) is deliberately omitted, so
  `direct`'s tension-reuse path ("when present") is NOT exercised by this
  eval.
- `_crawl-log.json` internals are a plausible arrangement of the fields
  extract's SKILL.md names piecemeal; the exact schema is loosely specified.
- `type.loadStrategy: null` is an inference (the fictional site uses only
  system-installed Georgia/Arial, no `@font-face`); `files: []` is
  explicitly sanctioned by the schema.

`answers.md` (sibling of this file) is the simulated-user persona consumed
by the runner's auto-responder; it is also not part of the fixture tree.
