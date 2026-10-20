# Prep mode (`--prep`) — full procedure

Read this whole file before running any `--prep` extraction.

When invoked with `--prep`, extract runs an extended pass that
prepares the inventory for migration. Discovery-mode runs (without
`--prep`) are unchanged: small cap, no typing, no module detection,
presales-friendly. `--prep` is the gesture that says "the user is
committing to migrate; build the data structure migrate consumes."

`--prep` adds five things on top of the standard procedure:

## 1. Lift the cap

`--prep` implies `--all`. Migration coverage requires the full
inventory — the small discovery cap (5 pages) is insufficient. The
cap-respecting selection logic from `ia-extraction.md`
§ Page selection still applies for ordering and junk-filtering;
it just doesn't truncate.

### Sub-agent prompt requirements (when delegating)

When `--prep` is heavy enough that the agent delegates extraction
to a sub-agent (a presales-shaped pattern when the inventory is
large), the sub-agent prompt **must**:

1. **Forbid synthesis by name.** The literal sentence
   *"do not synthesize a page record from `_brand-extraction.json`
   + URL patterns + captured photos; every page must be a live
   Playwright render"* must appear in the prompt — a softer
   "must actually invoke Playwright per page" let synthesis with
   reused photos through.
2. **Require a per-page evidence table in the return.** Columns:
   `slug | waitMode | waitMs | fetchedAt | httpStatus`. The
   parent agent reads this table on completion and aborts if
   any row is missing or shows `waitMs: 0`.
3. **Require the wait-summary line in the return**, formatted
   identically to Phase 6's wait summary, so the parent can
   surface it in the user-facing report without reformatting.

These three are mandatory; missing any of them in the sub-agent
prompt is itself a recipe violation. The cascade-level guard in
`prepare-migration` validates the resulting per-page JSONs via
`validateProvenance()` regardless — but a well-formed sub-agent
return makes the failure cheaper to diagnose.

## 2. Page typing

For each extracted page, infer the `type` field from URL pattern
and content shape (LLM judgment). Catalog from
`skills/stardust/reference/state-machine.md` § Page types:
`landing | article | listing | program | form | static | unique`.
With a spec, take the type from `stardust/spec/knowledge/archetypes.json`.

Record the inferred type with `state.mjs set <slug…> --type <type>`
(it writes `state.json.pages[].type`; never a hand edit). The user
confirms or refines during `direct --prep`. Discovery-mode runs
leave `type` as `null`.

## 3. Module candidate detection

After Phase 3 (brand-surface extraction), scan extracted pages for
**recurring structural patterns**. A pattern that appears in N+
pages with similar shape (same sequence of elements, same
`data-section` / `data-purpose`, similar text shape) is surfaced
as a module candidate.

### Signal-source priority

Detection consumes per-page captured fields in this priority
order. Each higher signal is **weighted more heavily** in the
match-score; lower signals are tie-breakers and corroboration,
not primary evidence. The priority exists because higher-up
fields are explicitly extracted and structured (no parsing
ambiguity), while the bottom of the list (`landmarks[].innerText`
substring search) is fragile against capture variations and was
the source of the 2026-04-29 agency-site under-detection (0
hits for `pre-footer-shell`, 1 of 2 hits for `install-tile` —
both modules genuinely present on every page, both invisible
because the substrings being searched lived past the truncation
boundary that has since been removed).

1. **`pages/<slug>.json#headings[]`** — cross-page repeats of
   the same heading text in the same level. Highest signal:
   structured, explicit, captured in full regardless of body
   length.
2. **`pages/<slug>.json#ctas[]` labels** — cross-page repeats
   of the same CTA label appearing on similar surfaces.
3. **`pages/<slug>.json#media.cssBackgrounds[]` URLs** — same
   asset URL on multiple pages is a strong system-component
   signal (already specced as a system-component candidate in
   `brand-surface.md` § Cross-page CSS-background
   reuse; module detection consumes the same signal at finer
   granularity).
4. **`pages/<slug>.json#forms[]` actions** — cross-page repeats
   of the same form `action` URL. Newsletter / contact / search
   forms are the typical hits.
5. **`pages/<slug>.json#components.componentsByLandmark`** when
   present (per future `current-state-schema.md` extension):
   per-landmark counts of cards / grids / etc.
6. **Substring search in `landmarks[].innerText`** — lowest
   signal. Use only as corroboration once a candidate has
   already passed the higher-signal checks; never as the
   primary detector.

A candidate that fires on signals 1 + 2 above the threshold is
high-confidence; a candidate that fires only on 6 should be
treated as speculative and surfaced as such for the user to
confirm in `direct --prep`.

Candidate output is a draft entry under
`DESIGN.json.extensions.modules[]`:

```json
{
  "id": "candidate-<short-hash>",
  "slots": [
    { "name": "<inferred>", "type": "text|link|image|...", "required": false }
  ],
  "instances": [
    { "slug": "home",   "selector": "..." },
    { "slug": "donate", "selector": "..." }
  ],
  "status": "candidate"
}
```

The `status: "candidate"` flag distinguishes draft entries from
confirmed modules. `direct --prep` is where the user names them
and promotes (or prunes).

## 4. Typed content slots

Per-page JSON (`current/pages/<slug>.json`) gains a `slots`
section that identifies content slots per page-type:

- `article` pages: `headline`, `deck`, `byline`, `meta`,
  `lead-image`, `body`, `pullquotes[]`, `related[]`
- `listing` pages: `index-headline`, `filter-controls`, and one
  slot name per card field — `card-title[]`, `card-image[]`,
  `card-link[]` — each an array with one value per card (never an
  object per card; the `[]` is notation for "an array", not part of
  the slot name)
- `program` pages: `program-headline`, `summary`,
  `feature-grid`, `cta-band`
- `landing`, `form`, `static` — typed slots inferred per
  content shape

The slot NAMES are per page type; the slot VALUES have one grammar,
the one `migrate.mjs render` reads when it forks a sibling from its
archetype (the A′ fork, `migrate.mjs --help` § A' fork). A value is
exactly one of the shapes below — one example each:

```json
{
  "slots": {
    "headline": "Our story",
    "deck": { "text": "One platform for every team." },
    "body": { "html": "<p>First paragraph.</p><p>Second.</p>" },
    "lead-image": { "src": "https://example.com/img/hero.jpg", "alt": "Two engineers at a whiteboard" },
    "cta": { "href": "/signup", "text": "Start free trial" },
    "related": [
      { "href": "/pricing", "text": "Pricing" },
      { "href": "/docs", "text": "Documentation" }
    ],
    "byline": null
  }
}
```

| value | the fork writes |
|---|---|
| a string (`headline`) | the text, escaped |
| `{ "text" }` (`deck`) | the text, escaped |
| `{ "html" }` (`body`) | the inner HTML verbatim; media URLs in it resolved through the media map / ledger |
| `{ "src", "alt"?, "srcset"? }` (`lead-image`) | an image: `src` / `alt` / `srcset` on the slot's `<img>` (or the first `<img>` inside the slot) |
| `{ "href", "text"? }` (`cta`) | a link: `href` on the slot's `<a>` (or the first `<a>` inside it); the text replaced when given, kept when absent |
| an array of the above (`related`) | a repeated slot: one element per value — more values clone the last element, fewer remove the rest |
| `null` (`byline`) | the page has none: the element is removed, decision `slot-empty` |

**A value is one of these or `null` — nothing else.** The fork refuses
anything outside the grammar (`strict slots`, nothing written), naming
the slot and the offending key:

- **No nested objects.** `{ "question": { "text": "…" }, "answer":
  null }` is not a value; a question-and-answer list is two repeated
  slots (`question[]`, `answer[]`) or one `{ "html" }` per item.
  `{ "text": { … } }` is refused (`text is an object, not a string`);
  a `text` is a string (a number passes too).
- **No provenance keys — no key at all — inside a value.** A key the
  shape does not have (`level`, `from`, `source`, a second content
  key) is refused by name (`key(s) level outside the text value
  shape`). `src` is an image reference only when it reads as a path,
  a URL or a file name with an image extension; `{ "text": "Our
  story", "src": "headings[0]" }` is refused as `src "headings[0]" is
  not an image reference` — never read as an image, never silently as
  text.
- **Record provenance beside the value.** The array form of `slots`
  carries it: `[{ "name": "headline", "value": "Our story", "from":
  "headings[0]" }, …]` — keys other than `name` and `value` are not
  read. (The other array form, `{ "name": "lead-image", "src": "…",
  "alt": "…" }`, spreads the value's own keys and nothing else.)
  Page-level evidence stays in `_provenance`
  (`current-state-schema.md` § Top-level shape).

The schema is `current-state-schema.md` § Typed slots. Once the
rollout block mapping covers a template's archetype, migrate's A′ fork
reads its siblings' slots through it
(`skills/migrate/reference/template-and-module-rendering.md` § Path A′
Step 2); typed slots kept here still override the mapped values. A
page JSON without the `slots` key is not refused: the fork derives
the values from the archetype's and the sibling's captured HTML
(`current/pages/<slug>.html`, both required).

## 5. Prep summary

Replace Phase 6's standard report with the prep summary format:

```
extract --prep complete
=======================

Inventory:    127 pages crawled (5 prior, 122 new)
Provenance:   127/127 live (every page has Playwright evidence)
Page types:   landing 1 · article 84 · listing 6 · program 12 · form 3 · static 18 · unique 3
              (LLM-inferred; refine in direct --prep)

Module candidates: 8
  hotline-211         5 instances  (home, get-help, donate, news, programs)
  donate-band         12 instances (home, donate, news, all article footers)
  story-card          7 instances  (home, news, programs)
  ...

Typed slots:  filled per page-type (see current/pages/<slug>.json § slots)

Next: $stardust direct --prep  (confirm types, name modules)
```

The `Provenance: <live>/<total> live` line is mandatory in
prep-mode output. When the ratio is anything other than
`<total>/<total>` the prep run has failed the synthesis guard;
list the affected slugs as a sub-bullet and treat the prep run
as incomplete (the cascade-level guard in
`prepare-migration` SKILL.md surfaces the same check between
phases).

Default mode (no `--prep`) is unchanged. The flag is intended for
the `prepare-migration` orchestrator, though direct invocation is
supported.
