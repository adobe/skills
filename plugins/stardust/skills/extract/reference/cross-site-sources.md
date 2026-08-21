# Cross-site brand sources — full procedure

Relocated from `SKILL.md` § Cross-site brand sources. Read this
whole file whenever `--brand-source` or `--design-source` is
present on the invocation.

Two flags widen extraction beyond the primary origin. Both are
opt-in; without them this procedure is inert.

## `--brand-source <url>` (repeatable) — sibling enrichment

An additional **same-brand** origin whose brand surface enriches the
primary extraction. Per source: shallow capture only — home page plus
up to 2 nav-linked pages, full recipe per page (Phase 2 rules apply,
provenance contract included). Captured records land under
`stardust/current/brand-sources/<host>/` (own `pages/` +
`assets/screenshots/`, same page-JSON shape); they are **evidence,
not inventory** — they never enter `state.json.pages[]`.

Their palette / type / motif / voice / photography evidence
**aggregates** into `_brand-extraction.json` with per-origin
provenance (`origins[]` per `brand-surface.md` § Origins).
Two rules govern the merge:

- **Conflicts resolve toward the primary.** Where primary and
  brand-source evidence disagree for the same slot (a palette role,
  the heading family, the signature radius), the primary origin's
  value wins; the losing value is noted in `_provenance.notes`.
- **Brand-source evidence widens the surface.** A motif or
  photography treatment the primary site underuses enters as an
  *additional* entry, attributed in `origins[].contributedSignals[]`
  — so downstream `direct` / `uplift` can amplify a trait captured
  on a sibling property as **captured** evidence with an origin
  citation, never as invention.

Brand-source pages join palette/type/motif/voice aggregation but are
**excluded** from § System components, `voiceTable`, and cross-promo
detection — those describe the primary site's IA.

## `--design-source <url>` — design donor

Formalizes the proven canon.com pattern: a golden design source is
extracted separately and its design system becomes the fixed
**target**, while the primary origin supplies content.

- Capture the donor to `stardust/canon-source/` — same page-JSON and
  brand-extraction shapes as `stardust/current/`, rooted there (own
  `pages/`, `assets/`, `_brand-extraction.json`, `_crawl-log.json`).
  The default cap (5) applies unless the user widens it.
- Derive `stardust/canon-source/DESIGN.md` + `DESIGN.json` from the
  donor's brand surface — **descriptive**, same authoring rules as
  Phase 4.
- Stamp `state.json.designSource = { "url", "capturedAt", "path":
  "stardust/canon-source/" }`.

`stardust:direct` reads this stamp and pins the donor system as the
target: Mode A's brand-faithful pins transfer to the **donor**
surface while content stays with the primary origin — see
`skills/direct/SKILL.md` § Mode A. The donor records
`role: "design-source"` in its own
`canon-source/_brand-extraction.json#origins[]`; donor evidence never
aggregates into the primary `_brand-extraction.json`.
