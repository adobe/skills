# Prep mode (`--prep`)

Read and executed by `direct` when — and only when — the `--prep` flag
is passed (typically via the `prepare-migration` orchestrator).
Default (discovery-mode) runs never read this file and are unchanged:
intent reasoning, divergence-toolkit resolution, target-spec authoring.

When invoked with `--prep`, direct runs an extended pass that
finalizes the inventory data structures migrate consumes.

`--prep` adds five things on top of the standard procedure:

## 1. Type catalog confirmation

Surface the page-type catalog inferred by `extract --prep` (in
`state.json.pages[].type`). Show counts per type and a sample of
slugs per type:

```
Page types from extract:
  landing  1   (home)
  article  84  (news/post-2026-04-15-housing-summit, news/post-2026-04-08-..., ...)
  listing  6   (news, programs, events, ...)
  program  12  (programs/shelter, programs/case-management, ...)
  form     3   (donate, contact, volunteer)
  static   18  (about, team, financials, ...)
  unique   3   (404, search, faq)

Confirm catalog (yes / refine "<phrase>")?
```

User can confirm or refine. Refinements: rename a type, split a
type into finer-grained ones (e.g., `article-feature` vs.
`article-press`), merge two types, mark specific pages as
`unique`. Updates land in `state.json.pages[].type`.

## 2. Module catalog finalization

Surface the module candidates proposed by `extract --prep`
(`DESIGN.json.extensions.modules[]` with `status: candidate`).
For each candidate:

```
hotline-211 (5 instances)
  Slot candidates: phone, hours, headline, cta-label
  Found in: home, get-help, donate, news, programs

  Confirm? (name "<id>" / promote / prune / refine slots)
```

User actions per candidate:

- **Confirm.** Promote `status: candidate → confirmed`. Module
  ID, slots, defaults are accepted as-is.
- **Rename.** Change the auto-generated ID to a brand-native name.
- **Prune.** Remove from the catalog (the candidate was a
  spurious match; instances will render as inline content).
- **Refine slots.** Mark slots required, set defaults, add or
  remove slots, adjust types.

Confirmed modules become the catalog migrate consumes.

## 3. Color reservations

If the resolved direction reserves any color to a specific
module/lockup (e.g., centennial-red `#DC323D` reserved to the
`trh-100-lockup` module), capture in
`DESIGN.json.extensions.colorReservations[]`:

```json
[
  { "color": "#DC323D", "reservedFor": ["module:trh-100-lockup"] }
]
```

Migrate validates that reserved colors appear only in their
declared contexts; violations refuse the page.

## 4. Wider direction re-evaluation

Discovery mode resolved direction against a 5-page sample. Prep
mode has the full inventory. Re-read the broader content surface
and check:

- Does the resolved register still hold? (e.g., did discovery
  miss a service-led section that pulls toward a different
  register?)
- Are there new tensions surfaced by the wider crawl that affect
  direction?
- Do any anti-references need updating?

If the re-evaluation surfaces a meaningful divergence from the
discovery-mode direction, surface to the user. If the user wants
to re-direct, they run `$stardust direct --re-direct` separately;
the prep run itself is non-destructive.

## 5. Site-level metadata defaults

Capture brand-level metadata defaults in
`DESIGN.json.extensions.metadata`:

- `siteName` — brand name (typically from `<title>` patterns or
  `og:site_name`)
- `defaultOgImage` — default OG image when a page doesn't have
  its own
- `themeColor` — typically already in DESIGN.md
- `organization` — `Organization` JSON-LD entry (name, url,
  logo, sameAs)
- `locale` — default locale
- `keyFacts` — optional: the short list of crawlable fact strings
  the brand must expose in server-rendered content (price, license,
  maker, requirement). Consumed by deploy's atomic-contract raw-HTML
  grep (deploy SKILL.md #86); omit when the direction names none.

These are composed with per-page metadata at migrate time. See
`skills/migrate/reference/metadata-and-jsonld.md` for the
composition rules.

## Prep summary

```
direct --prep complete
======================

Type catalog:        confirmed (7 types, 127 pages)
Module catalog:      confirmed (8 modules, slot vocabularies set)
Color reservations:  1 (#DC323D reserved to trh-100-lockup)
Brand metadata:      set (siteName, defaultOgImage, themeColor, organization, locale)
Direction:           no change (wider crawl confirmed)

Next: $stardust prototype --prep  (fill template gaps, write canon)
```

Default mode is unchanged.
