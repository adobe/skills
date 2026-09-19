# Fixture provenance & known limitations

`fixture/` is a **verbatim copy** of `../migrate-incremental/fixture/` —
the fictional B2B bookkeeping site ("Ledgerline") with `home` and
`pricing` approved (proposed files present), three pages directed,
canon written, no `stardust/migrated/`. Provenance for every file is
documented in `../migrate-incremental/fixture-notes.md` and the notes it
points to. `answers.md` is the same persona.

## This fixture realizes the common core of the Setup, not all of it

The task's Setup describes a different fictional site (`example.com`,
4 pages with URL shapes chosen to exercise the URL-literal output rule)
and a `home-proposed.html` that references assets in every detection
shape `migrate/reference/asset-bundling.md` names. This copy supplies
what every migrate run needs and a subset of the asset surface:

| Setup item | In this fixture |
|---|---|
| `state.json` with an approved page + directed pages, flow `redesign` | yes (`home`, `pricing` approved; 3 directed) |
| Project-root `PRODUCT.md`, `DESIGN.md`, `DESIGN.json`; canon; active direction | yes |
| `originUrl` = `https://example.com`; slugs `beers`, `about__history`, `docs__api` | **no** — `https://www.ledgerline.com`; slugs `home`, `features`, `pricing`, `about`, `contact`, every URL a depth-1 path without `.html` |
| `../current/assets/` references in `<img src>` and `<link rel="icon">` | partly — `<img>` for logo, hero and two customer logos; favicon is inlined as a data URI |
| `srcset`, `<picture>`, inline `style="url(...)"`, `@font-face`, `<style>` `url()` | **no** |
| Percent-encoded subpath, root-relative `/assets/` authoring, missing asset, CDN stylesheet, path-traversal attempt | **no** |
| Same-origin absolute nav href, directory-only nav href | **no** — nav links are root-relative |
| Broken internal nav (`/never-extracted/`) | yes, in effect — footer links to `/security`, `/careers`, `/help`, `/blog`, `/docs/api`, `/privacy`, `/terms` have no inventory entry |
| `generated/`, `photos/`, `fonts/` asset subdirectories | **no** — media lives in `current/assets/media/` |

Consequences for the judge: the self-containment, `pageMap[]`, portability
audit and idempotency criteria are exercisable; the per-shape detection,
percent-encoding, `.html`-leaf, missing-asset and traversal criteria are
not, and runs 2–4 are not executed by the runner (`../runner/README.md`
§ Known caveats). Treat failures on those items as fixture gaps, not
skill regressions, until a dedicated fixture with the Setup's asset
surface exists.

## Known limitations

Everything listed in `../migrate-incremental/fixture-notes.md`
(1×1-pixel media, fabricated extract hashes, fonts named but not
loaded).
