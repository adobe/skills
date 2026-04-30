# Artifact map

Every file stardust reads or writes, who owns it, what it contains, and
how its provenance block is shaped.

---

## Project root (impeccable's format — stardust authors directly)

| Path             | Format owner | Stardust writes when                                         | Stardust reads when                    |
|------------------|--------------|--------------------------------------------------------------|----------------------------------------|
| `PRODUCT.md`     | impeccable   | `$stardust direct` authors it from the resolved direction    | every sub-command (target strategy)    |
| `DESIGN.md`      | impeccable   | `$stardust direct` authors it from the resolved direction + brand surface | `prototype`, `migrate`     |
| `DESIGN.json`    | impeccable   | `$stardust direct` authors it from the resolved direction + brand surface | `prototype`, `migrate`     |
| `AGENTS.md`      | impeccable   | never (read-only for stardust)                               | every sub-command (Design Context)     |

Stardust authors `PRODUCT.md`, `DESIGN.md`, and `DESIGN.json` **directly**,
treating impeccable's `reference/teach.md` and `reference/document.md` as
**format specs** rather than runtime commands. Reasoning: by the time
`$stardust direct` runs, the user has already gone through stardust's
intent-reasoning interview — re-running impeccable's interview would
duplicate questions. The resolved direction in `stardust/direction.md`
carries every answer impeccable's interviews would surface.

Users who want impeccable to validate or refine the project-root files
can run `$impeccable teach` or `$impeccable document` directly at any
time; stardust does not own those commands and will not interfere.

The same direct-authoring pattern is used for the descriptive files
under `stardust/current/` written by `$stardust extract`.

### `DESIGN.json.extensions`

The `extensions` object grows with the migrate-template-canon
refactor (see `notes/migrate-template-canon-refactor.md`):

- **`extensions.canon`** — pinned token values, compositional moves
  (free-text), and references to `stardust/canon/*` chrome and CSS
  files (`{ path, sha }` per file). Written by `$stardust prototype
  --prep` on first approval; extended on subsequent approvals.
- **`extensions.modules[]`** — brand module catalog: `id`, `slots`
  (with `name`, `type`, `required`, optional `default`),
  `canonicalRendering` reference. Auto-detected during `$stardust
  extract --prep`; promoted/refined during `$stardust direct
  --prep`.
- **`extensions.colorReservations[]`** — colors reserved to specific
  modules or contexts (e.g., centennial-red reserved to a
  `trh-100-lockup` module). Validated at migrate time; violation
  refuses the page.
- **`extensions.metadata`** — site-level metadata defaults: site
  name, default OG image, theme color, organization JSON-LD,
  default locale. Composed with per-page metadata at migrate time.

---

## `stardust/` (stardust's territory)

```
stardust/
├── state.json                        # state machine (state-machine.md)
├── direction.md                      # resolved intent + reasoning trace
├── canon/                            # design canon (canon-extraction.md) — written by prototype --prep on first approval, extended on subsequent approvals
│   ├── header.html                   # canonical header chrome
│   ├── footer.html                   # canonical footer chrome
│   ├── canon.css                     # compound CSS (button/card/link/form language)
│   └── modules/
│       └── <module-id>.html          # canonical rendering per brand module
├── current/
│   ├── PRODUCT.md                    # impeccable-format strategy of the EXISTING site
│   ├── DESIGN.md                     # impeccable-format visual system of the EXISTING site
│   ├── DESIGN.json                   # sidecar
│   ├── brand-review.html             # self-contained visual review of the extraction (first eyeball-able artifact)
│   ├── _brand-extraction.json        # consolidated brand surface (palette, type, motifs, voice, system components)
│   ├── _crawl-log.json               # discovery + crawl audit trail
│   ├── pages/
│   │   └── <slug>.json               # per-page parsed structure + content (includes metadata block)
│   └── assets/
│       ├── logo.<ext>                # extracted logo
│       ├── screenshots/<slug>.png    # per-page viewport screenshots (used by brand-review)
│       └── media/                    # extracted images, with original URLs
├── prototypes/
│   ├── <slug>-shape.md               # per-page compositional brief (page-level deployment record)
│   ├── <slug>.html                   # before/after viewer (user-facing review surface)
│   └── <slug>-proposed.html          # proposed redesign on its own (live-mode iteration target, migration source)
└── migrated/                         # deployable static HTML site
    ├── index.html                    # the home page (slug "home" -> root)
    ├── _meta.json                    # sidecar JSON (full reasoning trace) — one per migrated page
    ├── <slug>/
    │   ├── index.html                # one per non-home slug (URL-faithful nesting)
    │   └── _meta.json
    ├── docs/api/                     # multi-segment slugs nest naturally
    │   ├── index.html
    │   └── _meta.json
    ├── assets/
    │   ├── logo.<ext>                # copied from current/assets/
    │   ├── favicon.<ext>             # canonical favicon
    │   ├── favicon-512.png           # variants generated during prepare-migration phase 4
    │   ├── apple-touch-icon.png
    │   ├── fonts/                    # @font-face files downloaded during prepare-migration phase 4
    │   └── media/                    # only files referenced by migrated pages
    ├── robots.txt                    # minimal
    └── sitemap.xml                   # derived from migrated inventory
```

### `stardust/state.json`
Owner: every stardust sub-command. Schema in `state-machine.md`.

### `stardust/direction.md`
Owner: `$stardust direct`. The full reasoning trace for the resolved
direction, written using the format in
`skills/direct/reference/direction-format.md`. The agent appends a new
section every time direction changes.

### `stardust/current/PRODUCT.md` and `DESIGN.md`
Owner: `$stardust extract`. Authored by `$impeccable teach` /
`$impeccable document` against the extracted site, but seeded by
stardust. These files describe what *is*, not what *should be*.

### `stardust/current/brand-review.html`
Owner: `$stardust extract` (Phase 5). Self-contained visual review of
the extraction — the **first eyeball-able artifact** the pipeline
emits. Renders the canonical brand-board section contract plus a
Tensions section that surfaces forced decisions for `direct`. Format
spec in `skills/extract/reference/brand-review-template.md`. Embedded
CSS only, no external JavaScript, rendered in the brand's own
captured colors and fonts.

The reviewer is expected to open this file and confirm the extraction
captured the site faithfully **before** running `$stardust direct`.
Misreads caught here are cheap to fix (re-run extract); misreads
caught after `direct` are not.

### `stardust/current/_brand-extraction.json`
Owner: `$stardust extract` (Phase 3). Consolidated brand surface —
palette, type, motifs, system components, voice, register. Schema in
`skills/extract/reference/brand-surface.md`.

### `stardust/current/_crawl-log.json`
Owner: `$stardust extract` (Phases 1, 2, 6). Append-only audit trail
of discovery and crawl. Re-running extract appends to `runs[]` rather
than overwriting. Schema in
`skills/extract/reference/ia-extraction.md` § `_crawl-log.json` shape.

### `stardust/current/pages/<slug>.json`
Owner: `$stardust extract`. Per-page parsed model. Schema lives in
`skills/extract/reference/current-state-schema.md` (Phase 1).

### `stardust/current/assets/`
Owner: `$stardust extract`. Logo + media extracted from the live site.
Filenames preserve the source basename plus a hash to avoid collisions.

### `stardust/prototypes/<slug>-shape.md`
Owner: `$stardust prototype` (Phase 1). Per-page compositional
brief. Carries page-level deployment decisions: section order,
layout strategy, key states, interaction model, structural data
attributes, unsourced-content list. Format spec in
`skills/prototype/reference/page-shape-brief.md`.

The brief exists because of the F-015 site/page split (see
`STARDUST-FEEDBACK.md` and the site-level vs page-level table
below). `direct` authors the design **system**; the brief records
the **deployment** of that system to a specific page. A direction
change invalidates the system; the brief is content-aware-stale
only when the system change makes its composition impossible.

### `stardust/prototypes/<slug>.html` and `<slug>-proposed.html`
Owner: `$stardust prototype`. Two files per page (see
`skills/prototype/reference/before-after-shell.md` for the contract):

- **`<slug>.html`** — the **viewer**. Self-contained HTML with two
  iframes side-by-side: left = current page (live URL, screenshot
  fallback, or landmarks-text fallback), right = the proposed
  redesign (loaded from `<slug>-proposed.html`). Header strip with
  swap/approve/stash/live-mode actions. The user-facing review
  surface.
- **`<slug>-proposed.html`** — the **proposed redesign on its own**.
  Self-contained, complete HTML page rendered against the target
  `DESIGN.md`. The file `$impeccable live` iterates on; the file
  `$stardust migrate` later re-derives from for the final migrated
  page.

Both carry provenance blocks in `<head>`. The proposed file's
provenance lists the active direction it was rendered against; when
direction changes, the page is flagged `stale` in `state.json` and
the viewer surfaces the staleness in the header strip.

### `stardust/migrated/`
Owner: `$stardust migrate`. A deployable static HTML site. The slug →
output-path mapping (`home` → `index.html`, `pricing` →
`pricing/index.html`, `docs__api` → `docs/api/index.html`) is detailed
in `skills/migrate/reference/migration-procedure.md` § Output path
mapping.

Each page is a self-contained HTML file with a stardust:migrate
provenance block as the first child of `<head>`, the `:root` block
exposing the current DESIGN.md tokens, structural data attributes on
every section, and asset references rewritten to relative paths
under `assets/`.

The migrated tree is **incremental and idempotent**. Re-running
migrate writes only pages whose source has changed (sha-compared in
provenance). Migration is per-page — the user can migrate part of
the site today and the rest later.

### `stardust/canon/`
Owner: `$stardust prototype --prep`. Written on first prototype
approval (typically the home; `--canon-from <slug>` overrides),
extended on subsequent approvals. Contains the design canon — the
load-bearing visual decisions extracted from approved prototypes
that govern every other template's rendering.

- **`header.html` / `footer.html`** — chrome HTML lifted verbatim
  from the canon-author prototype. Other templates inject these
  files into their proposed and migrated output.
- **`canon.css`** — compound CSS for the named visual language
  (`.btn-primary`, `.btn-secondary`, `.card`, `.link`, form
  inputs). Consumes DESIGN.md tokens; injected into every migrated
  page's `<style>` block alongside `:root`.
- **`modules/<module-id>.html`** — canonical rendering per brand
  module. Each file's path + sha is referenced by
  `DESIGN.json.extensions.modules[].canonicalRendering`.

Pinned token values, compositional moves, and conflict-resolution
metadata live inside `DESIGN.json.extensions.canon` rather than as
standalone files. Canon-extraction procedure:
`skills/prototype/reference/canon-extraction.md`.

### `stardust/migrated/<slug-path>/_meta.json`
Owner: `$stardust migrate`. Sidecar JSON written alongside every
migrated `index.html` — one for the home at `migrated/_meta.json`,
one per nested slug at `migrated/<slug-path>/_meta.json`. Carries:

- Resolved metadata (system-fixed, brand-level, preserved, derived).
- Resolved JSON-LD (when page-type is known).
- Filled slot list and module-instance list.
- The `migrationDecisions[]` array — per-page reasoning trace
  (`template-applied` / `template-adapted` / `unique-render` /
  `module-bespoke-slot` / `canon-deviation` / `metadata-override`).
- Canon shas at the time of migration (so re-runs detect canon
  drift).

The HTML `<head>` provenance block stays compact; the sidecar
carries the full trace. Both are redundant on purpose — downstream
consumers can read either source.

---

## Provenance shapes

Stardust uses three provenance shapes depending on the file type, the
same convention as v1 and as impeccable's loader expects.

### HTML files
First child of `<head>`:

```html
<!-- stardust:provenance
  writtenBy:        stardust:prototype
  writtenAt:        2026-04-25T15:42:00Z
  againstDirection: stardust/direction.md#section-2
  readArtifacts:
    - stardust/current/pages/home.json
    - DESIGN.md
    - DESIGN.json
  synthesizedInputs: []
  stardustVersion:  0.2.0
-->
```

### Markdown files
First line, before any frontmatter:

```markdown
<!-- stardust:provenance
  writtenBy: stardust:direct
  writtenAt: 2026-04-25T14:10:00Z
  ...
-->
---
```

### JSON files
First top-level key (`_provenance`):

```json
{
  "_provenance": {
    "writtenBy": "stardust:extract",
    "writtenAt": "2026-04-25T13:00:00Z",
    "readArtifacts": ["https://example.com/"],
    "synthesizedInputs": [],
    "stardustVersion": "0.2.0"
  },
  "...": "..."
}
```

---

## Site-level vs page-level (the F-015 split)

Stardust separates **system** (site-wide design decisions) from
**deployment** (how the system applies to a specific page). The
boundary lives between `direct`'s outputs and `prototype`'s
outputs, not within either:

| concern | lives in (site-level) | lives in (page-level) |
|---|---|---|
| Token vocabulary (colors, typography, spacing, radii) | `DESIGN.md` frontmatter | — |
| Voice rules, hard rules, anti-references, tone exemplars | `DESIGN.md` § 6 + `DESIGN.json` `narrative.rules/dos/donts` | — |
| Anti-toolbox audit, divergence trace | `DESIGN.json` `extensions.divergence` | — |
| Abstract component vocabulary (button-primary, card, input — default treatment, no per-page values) | `DESIGN.json` `extensions.componentStyle` + top-level `components[]` | — |
| Named system-component **roles** (header / footer / cta-band / etc. — purpose + position class) | `DESIGN.json` `extensions.systemComponentRoles` | — |
| Per-page section list and order | — | `<slug>-shape.md` § Sections |
| Per-page layout strategy (column ratios, alternation, breakpoint inversions) | — | `<slug>-shape.md` § Layout strategy |
| Literal copy per section | — | sourced from `current/pages/<slug>.json` into `<slug>-shape.md` |
| Section-level pixel dimensions, dock points, viewport-specific widths | — | `<slug>-shape.md` § Layout strategy |
| Stat numbers, addresses, phones, quotes, named persons | — | `<slug>-shape.md` § Sections OR `<slug>-shape.md` § Unsourced content (placeholder) |
| System-component **deployment** (literal tile labels, link targets, copy variants) | — | `<slug>-shape.md` § Sections |
| Per-page interaction model (CSS-only details/target panels, etc.) | — | `<slug>-shape.md` § Interaction model |
| Per-page key states (default/empty/loading/error) | — | `<slug>-shape.md` § Key states |

**Rule of thumb:** if removing a value from the file would make
the file nonsensical for *every other page on the site*, it's
site-level (DESIGN.md). If removing it would only affect *this
page*, it's page-level (`<slug>-shape.md`).

The split solves three problems with v0.1's mash-up
(`STARDUST-FEEDBACK.md F-015`):

1. **DESIGN.md grew per-page** — each prototyped page leaked its
   specifics into the site spec. After F-015, DESIGN.md size is
   bounded by the system, not the page count.
2. **Direct over-specified the visual layer at site-time** —
   leaving prototype no room to diverge per-page. After F-015,
   prototype owns deployment; direct owns vocabulary.
3. **Re-direct ambiguity** — was the user changing the system
   (tokens, voice) or the deployment (composition on this page)?
   After F-015, direct's edits target the system; prototype's
   edits target a single brief; stale-flagging is content-aware
   per `state-machine.md` § Stale flagging.

When in doubt about where a new piece of information should land,
ask: does this affect *every* page in the inventory, or just one?
The answer locates the file.

## Read-vs-write discipline

- **Read order** for any sub-command: `state.json` first, then
  `direction.md`, then the impeccable target files at the project root,
  then anything from `stardust/current/` it specifically needs.
- **Write order** for any sub-command: write all artifacts first, then
  update `state.json` last. If a write fails, the `state.json` update
  is skipped so the next run sees a consistent prior state.
- **Provenance is mandatory.** Any artifact without a provenance block
  is treated as user-edited and stardust will not silently overwrite it.
  When stardust detects a provenance-less artifact in a path it owns,
  it asks the user before proceeding.
