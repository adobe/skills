# Fixture provenance & known limitations

`fixture/` is a **verbatim copy** of `../migrate-incremental/fixture/` —
the fictional B2B bookkeeping site ("Ledgerline") with `home` and
`pricing` approved (proposed files present), three pages directed,
canon written, no `stardust/migrated/`. Provenance for every file is
documented in `../migrate-incremental/fixture-notes.md` and the notes it
points to. `answers.md` is the same persona.

## This fixture realizes the common core of the Setup, not all of it

The task's Setup describes a 25-page site after `prepare-migration`
(typed pages, three approved archetypes, a module catalog, colour
reservations, brand-faithful inversions). Only the parts every migrate
run needs are present here:

| Setup item | In this fixture |
|---|---|
| `state.json` with approved + directed pages, flow `redesign` | yes (5 pages, not 25) |
| Project-root `PRODUCT.md`, `DESIGN.md`, `DESIGN.json` | yes |
| `DESIGN.json.extensions.canon` populated | yes |
| `stardust/canon/header.html`, `footer.html`, `canon.css` | yes |
| `stardust/direction.md` active direction | yes (rebrand mode) |
| `stardust/prototypes/` for the approved pages | yes (2 files) |
| Page `type` per page; 18 article / 2 program / 1 form / 1 unique | **no** — `type` is `null` on every page |
| Approved article and listing archetypes | **no** |
| `stardust/canon/modules/*.html`, `extensions.modules[]` | **no** |
| `extensions.colorReservations[]`, `extensions.metadata` | **no** |
| `brand_faithful_inversions[]` (Mode A) | **no** — the direction is a rebrand; the list is empty |
| Typed `slots` in `current/pages/<slug>.json` | **no** |

Consequences for the judge: run 1's Path A′ partition (21 pages) and
Path B for `404` cannot occur — the three directed pages take Path B.
Runs 5–11 (broken-link deletion, bespoke-slot promotion, colour
reservation, template adaptation, deployUrl, inversion negative case)
have no fixture support yet, and the runner only executes step 1 anyway
(`../runner/README.md` § Known caveats). Criteria that depend on the
missing items are expected to fail until a dedicated 25-page fixture
exists; treat those failures as fixture gaps, not skill regressions.

## Known limitations

Everything listed in `../migrate-incremental/fixture-notes.md`
(1×1-pixel media, fabricated extract hashes, fonts named but not
loaded, footer links to slugs outside the inventory).
