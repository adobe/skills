# Migration procedure

Per-page procedure `$stardust migrate` runs to produce
`stardust/migrated/<output-path>/index.html` plus a companion
`_meta.json` sidecar. Idempotent, deterministic where possible
(Path B and adapted Path A′ involve LLM judgment), content-
preserving by default.

---

## Inputs per page

- `stardust/current/pages/<slug>.json` — source structure +
  content + typed slots (the only content source; the live site
  is not re-fetched).
- `stardust/current/assets/` — extracted media and logo.
- `DESIGN.md` (project root) — target visual system.
- `DESIGN.json` (project root) — sidecar with `extensions.canon`,
  `extensions.modules[]`, `extensions.colorReservations[]`,
  `extensions.metadata`.
- `stardust/canon/header.html`, `footer.html`, `canon.css`,
  `modules/<id>.html` — canon files written by
  `prototype --prep`.
- `stardust/direction.md` — Active section (used to confirm
  content changes are authorised, if any).
- `stardust/prototypes/<slug>-proposed.html` — when this page is
  itself approved (Path A) **or** when a sibling of its `type`
  is approved (Path A′ archetype source).
- `stardust/state.json` — page status, type, direction reference,
  `site.deployUrl`.

## Three render branches

The render branch is chosen by LLM judgment per
`reference/template-and-module-rendering.md` § Render path
selection:

- **Path A** — page is itself `approved`. Use proposed.html
  verbatim; refresh `:root` from latest DESIGN.md; inject canon
  CSS alongside.
- **Path A′** — page is `directed`, type matches an approved
  sibling. Fork the sibling's structure, inject this page's
  typed slots, adapt where content doesn't fit. Procedure in
  T&M § Path A′.
- **Path B** — page typed `unique` or no template match. Render
  one-off using DESIGN.md/json + canon + modules. Procedure in
  T&M § Path B.

All three branches apply canon chrome (header, footer) verbatim;
all three apply the validation contracts; all three emit a
`_meta.json` sidecar.

## Output path mapping (slug → file)

Slugs (filesystem-friendly identifiers) map to nested
`index.html` files for portable static hosting:

| Slug                  | Output path                                | URL it serves       |
|-----------------------|--------------------------------------------|---------------------|
| `home`                | `migrated/index.html`                      | `/`                 |
| `about`               | `migrated/about/index.html`                | `/about`            |
| `pricing`             | `migrated/pricing/index.html`              | `/pricing`          |
| `docs__api`           | `migrated/docs/api/index.html`             | `/docs/api`         |
| `blog__post-one`      | `migrated/blog/post-one/index.html`        | `/blog/post-one`    |

The mapping algorithm: replace `__` with `/`, append
`/index.html`. The `home` slug is the only special case (becomes
the root `index.html`).

This convention works on every static host (Netlify, Vercel,
Cloudflare Pages, S3+CloudFront, GitHub Pages, plain nginx)
without URL rewrite rules.

## `_meta.json` sidecar

Every migrated page gets a sidecar JSON next to its `index.html`:

- `migrated/index.html` → `migrated/_meta.json` (home)
- `migrated/about/index.html` → `migrated/about/_meta.json`
- `migrated/docs/api/index.html` → `migrated/docs/api/_meta.json`

Schema:

```json
{
  "slug":             "<slug>",
  "type":             "<page-type>",
  "renderBranch":     "A | A' | B",
  "template":         "<archetype-slug or null>",
  "modules":          ["<module-id>", "..."],
  "slotsFilled":      ["<slot-name>", "..."],
  "canonShas":        { "header": "<sha>", "footer": "<sha>", "css": "<sha>" },
  "deviations":       [ { "where": "header", "reason": "..." } ],
  "migrationDecisions": [ { "kind": "...", "...": "..." } ],
  "metadata":         { "title": "...", "description": "...", "...": "..." },
  "jsonLd":           { "@type": "Article", "...": "..." },
  "migratedAt":       "<ISO timestamp>",
  "designMdSha":      "<sha>",
  "designJsonSha":    "<sha>",
  "sourceCurrentSha": "<sha>",
  "sourceProposedSha": "<sha or null>"
}
```

The HTML provenance block (in `<head>`) carries a compact pointer
to the sidecar. Both are redundant on purpose — downstream
consumers can read either.

## `:root` block sourcing + canon CSS injection

Every migrated page exposes:

1. The full `:root` block defined in
   `skills/stardust/reference/token-contract.md`, with values
   from `DESIGN.json.extensions.canon.pinned` first (overriding
   DESIGN.md ranges where pinned), falling back to DESIGN.md
   frontmatter for tokens not pinned.
2. The contents of `stardust/canon/canon.css` injected as the
   second block in the page's first `<style>`.

When `prepare-migration` Phase 3 (canon write-back) updates
canon, the next migrate run re-renders every affected page —
canon shas in provenance no longer match.

## Asset references

The migrated site is **self-contained** under
`stardust/migrated/`. Asset paths in HTML resolve relative to the
migrated tree:

- `<img src="...">` references rewritten per
  `content-preservation.md` § Media references.
- The migration step copies referenced media from
  `stardust/current/assets/media/*` to
  `stardust/migrated/assets/media/*`.
- Fonts are downloaded during `prepare-migration` Phase 4 to
  `stardust/migrated/assets/fonts/`; canon CSS already
  references them via local paths after that phase.
- Logo + favicon variants: see
  `metadata-and-jsonld.md` § Favicon.

## Validation

Validation contracts split into strict and soft per
`reference/template-and-module-rendering.md` § Validation
contracts.

**Strict (refuse-on-fail):**

1. `:root` block present at top of first `<style>`.
2. Required `data-*` attributes (`data-template`,
   `data-section`, plus `data-module` and `data-slot` where
   applicable) present.
3. Provenance block present as first child of `<head>`.
4. Required template/module slots filled.
5. Color reservations not violated
   (`DESIGN.json.extensions.colorReservations[]`).
6. Impeccable hard rules respected, **with brand-faithful
   inversions lifted** per
   `DESIGN.json.extensions.divergence.brand_faithful_inversions[]`.
7. `_meta.json` sidecar written and well-formed.
8. Output path collisions refused (two slugs → same path).

**Soft (log + surface, don't refuse):**

- Template-conformance shape (Path A′ deviations expected).
- Canon deviations (logged with reason).
- Bespoke slots (counted toward auto-promotion at 3 instances).
- Content overflow (placed in overflow region, logged).
- Broken internal links (logged in provenance and run summary).
- Missing OG image / favicon variants (falls back to defaults).

If a strict contract fails, do **not** write the file. Surface
the failure with the specific rule violated and a suggested fix.

## Provenance

```html
<!-- stardust:migrate
  writtenBy:        stardust:migrate
  writtenAt:        2026-04-26T11:00:00Z
  page:             home
  slug:             home
  pagePath:         migrated/index.html
  renderBranch:     A | A' | B
  template:         article                                       (Path A' only)
  archetypePath:    stardust/prototypes/news__post-housing-summit-proposed.html (Path A' only)
  archetypeSha:     <short>                                                     (Path A' only)
  sourceProposed:   stardust/prototypes/home-proposed.html        (Path A only)
  sourceCurrent:    stardust/current/pages/home.json
  againstDirection: stardust/direction.md (Active 2026-04-25T15:42:00Z)
  designMd:         DESIGN.md (sha: <short hash>)
  designJson:       DESIGN.json (sha: <short hash>)
  canonShas:        header:<short> footer:<short> css:<short>
  decisionTrace:    _meta.json
  brokenInternalLinks: 0
  stardustVersion:  0.2.0
-->
```

The compact comment in HTML carries pointers; the full
`migrationDecisions[]` array, slot list, JSON-LD, and resolved
metadata live in the sidecar `_meta.json`.

## Idempotent skip

When re-running `$stardust migrate` (no flags), each page is
checked:

- If the migrated `index.html` exists AND its provenance shas
  match the current values for `designMd`, `designJson`,
  `sourceCurrent`, `sourceProposed` (Path A), `canonShas`, and
  `archetypeSha` (Path A′) → **skip the page** and report
  `unchanged`. The archetype is recorded as both `archetypePath`
  (for traceability) and `archetypeSha` (for skip detection).
- Otherwise re-render.

This makes mass re-runs cheap. Common cases that trigger
re-render: DESIGN.md edited; current page re-extracted; proposed
file re-iterated; canon updated by `prototype --prep`; archetype
sibling re-approved.

The idempotent skip applies to all three render branches with
the same sha-comparison logic — only the input set differs per
branch.

## What migrate never does

- **Re-fetch the live site.** Migrate is offline. The only
  network step in the whole pipeline was Phase 1 of `extract`.
- **Run `$impeccable critique` or `audit`.** Validation is the
  hard-rule pass; quality assessment is the user's call (a
  manual `$impeccable critique stardust/migrated/` after the
  fact is always available).
- **Touch the live site.** Stardust never deploys, never pushes,
  never modifies origin.
- **Generate AEM EDS markup, framework components, or CMS
  payloads.** Static HTML only. Downstream conversion is a
  separate plugin's concern; the `data-*` vocabulary plus the
  `_meta.json` sidecar are the contract.
- **Move past `migrated` state.** No further state. A separate
  skill takes the migrated output as input.
