# The content model — capture contract

What `scripts/capture-content.mjs` writes to
`stardust/reskin/content-model/<slug>/content-model.json`, why each
field exists, and the two procedures that keep the capture honest:
scope discovery and the normalization ledger. This is the reskin
Phase 2 contract; the renderer (Phase 4) and both content gates
(Phase 5) consume this file and nothing else for content.

The model is **byte-oriented**: its job is to let a renderer
interpolate every visible string and let a gate assert byte equality.
It complements — does not replace — extract's design-oriented capture
(`../../extract/reference/current-state-schema.md`).

## File shape

```json
{
  "_provenance": {
    "writtenBy": "stardust:reskin/capture-content.mjs",
    "capturedAt": "<ISO-8601>",
    "url": "<page-url>",
    "viewport": "1440x900",
    "scope": "<the --scope string, verbatim>",
    "normalize": { "source": "<ledger path | 'default'>", "ledger": [ { "id", "what", "why" } ] }
  },
  "metadata": {
    "title": "", "description": "", "canonical": null,
    "ogTags": { "og:title": "…" }, "twitterTags": { "twitter:card": "…" },
    "jsonLd": [ { } ], "lang": "en", "favicon": null
  },
  "scope": [ { "sel": "#content", "whole": false } ],
  "visibleTextNormalized": "<whitespace-normalized innerText of the whole scope — the content-gate reference string>",
  "coverage": { "bodyTextLen": 2911, "scopeTextLen": 2281, "ratio": 0.784, "h1Text": "…", "h1InScope": true },
  "sections": [
    {
      "slot": "s01",
      "rootTag": "div", "rootClass": "stage section",
      "visibleText": "<normalized innerText of this slot>",
      "headings":   [ { "level": "h1", "text": "…" } ],
      "paragraphs": [ "…" ],
      "listItems":  [ "…" ],
      "ctas":       [ { "text": "…", "href": "…", "absHref": "https://…", "classes": "…" } ],
      "images":     [ { "currentSrc": "https://…", "alt": "…", "w": 1200, "h": 675 } ],
      "leftovers":  [ { "text": "…", "parentTag": "span", "parentClass": "…" } ],
      "ordered": [
        { "kind": "heading", "level": "h2", "text": "News", "display": "block", "sep": "" },
        { "kind": "cta", "text": "…", "href": "…", "absHref": "https://…", "classes": "…",
          "display": "block", "sep": " ",
          "children": [ { "kind": "heading", "level": "h3", "text": "…", "display": "block", "sep": "" } ] },
        { "kind": "text", "text": "02.07.2026", "parentTag": "time", "parentClass": "…", "sep": " " },
        { "kind": "image", "currentSrc": "https://…", "alt": "…", "sep": "" },
        { "kind": "listItem", "text": "SUPERCOMPUTING", "display": "inline", "sep": " " },
        { "kind": "listItem", "text": "ARTIFICIAL INTELLIGENCE", "display": "inline", "sep": "" }
      ],
      "orderedVerified": true
    }
  ]
}
```

## Slot taxonomy

A **slot** is one coherent content unit — the atom of the Phase 3
mapping brief. The capturer produces one slot per child of the content
root (after descending single-child wrappers); a scope marked whole
(`!`) becomes one slot itself. A slot root that IS itself an
h1..h6/p/li/a element (an sr-only `<h2>` scoped with `!`) is
classified as that kind — it lands in `headings`/`paragraphs`/… like
any descendant, never in `leftovers`.

Each slot carries the same content twice, for two different consumers:

- the **per-type arrays** below (`headings`, `paragraphs`, `listItems`,
  `ctas`, `images`, `leftovers`) — the mapping brief's anatomy surface
  and slot-coverage's assertion surface;
- the **ordered stream** (`ordered`, § The ordered stream) — the
  render surface: the same content in document order with nesting and
  separators preserved, which is what Phase 4 renderers consume.

Within a slot:

- **headings** — h1..h6, visible only, with level. Levels matter
  downstream: the renderer must not skip levels
  (`../../migrate/reference/content-preservation.md` § Headings
  hierarchy).
- **paragraphs / listItems** — visible `p` / `li` normalized
  innerText. A `li` often carries a composite row (kicker + date +
  title); the renderer may parse it apart but must throw when the
  parse doesn't reproduce the string (SKILL.md Phase 4).
- **ctas** — every visible `a` with text. `absHref` (the resolved
  absolute URL) is the identity the gate matches on; `href` is kept
  for provenance; `classes` help the mapping brief distinguish CTA
  kinds (button vs text link vs pagination).
- **images** — **ordered, visible** `img` elements (`loading="lazy"`
  admitted even when not yet intersected). `currentSrc` is the
  responsive-resolved URL; the gate compares URL-normalized
  host+path, order-sensitive.
- **leftovers** — text nodes NOT inside h1..h6/p/li/a: eyebrows,
  spans, button labels, figcaptions. **These carry real content** —
  the experiment's eyebrows, slide titles, and the search-button
  label all lived here. A renderer that only consumes
  headings/paragraphs/ctas silently drops leftovers; slot-coverage's
  slot-text check catches it, but consume them deliberately.

Composite slots (one wrapper holding e.g. News *and* Events) are
split at mapping time, not capture time — the brief addresses
sub-units of a slot explicitly (`reference/mapping-brief.md`
§ Slot splitting).

## The ordered stream

`sections[].ordered` is the **render-ready** view of a slot: the same
content as the per-type arrays, but as kind-tagged nodes in **document
order**, with nesting and separators preserved. Phase 4 renderers
consume this and only this for slot structure — they never
reconstruct order by matching the per-type arrays against
`visibleText` as an oracle.

Node shape:

- `kind` ∈ `heading | paragraph | listItem | cta | image | text`.
  `text` nodes are the stream's leftovers — bare text runs
  (eyebrows, dates, photo credits) with `parentTag`/`parentClass`
  for context.
- `text` — normalized **rendered-case** innerText (text nodes get the
  parent's computed `text-transform` applied, since raw
  `textContent` doesn't reflect it).
- `level` (headings), `href`/`absHref`/`classes` (ctas),
  `currentSrc`/`alt` (images — admitted by the same shared
  visibility predicate as the `images` array and the gate).
- `display` — the computed display value, so the renderer knows an
  inline `li` run from a block list without guessing.
- `children` — present when the node contains structure of its own:
  a hero `<a>` wrapping its `<h2>` is a `cta` node with a `heading`
  child; a news `<h3>` wrapping its link is the reverse. Pure-text
  leaves have no `children`.
- `sep` — the separator between this node's text and the previous
  text in the same parent, after whitespace normalization: `' '`
  (separated) or `''` (**tight join** — the source renders them
  inline with no separator, and the reskin must too or the byte gate
  fails). First child is always `''`.

`orderedVerified` (per slot) records that the stream **tiles**
`visibleText` exactly — every child's text found left-to-right with
only whitespace gaps, nothing left over. The capturer warns on any
slot where it is `false`; do not trust that slot's `sep` flags
without inspecting it.

### Why this exists (the smoke-test history)

The first field run of this skill (ethz.ch × posthog.com) had only
the per-type arrays, and reconstructing document order from
`visibleText` as an oracle consumed the majority of the renderer's
engineering time — three debug rounds on one page. The three traps
that forced it, all captured structurally by the stream now:

1. **Duplicate identical strings.** Two identical date leftovers,
   the same eyebrow ×5 across `li`/`p`/`a`, a hero headline present
   twice in the source — greedy text-matching nests a block inside
   its own twin. The stream needs no matching: order is captured,
   duplicates are just two nodes.
2. **CTA/container overlap, both directions.** A hero `<a>` wraps
   its `<h2>`; a news `<h3>` wraps its `<a>`; an `<li>`'s text
   equals its nested link's text. Equal-text tie-breaking rules are
   unwritable in general; the stream records the actual nesting as
   `children`.
3. **Zero-separator inline joins.** Inline category-tag `<li>`s
   rendered with NO separator ("SUPERCOMPUTINGARTIFICIAL…") — the
   exact byte-gate failure the smoke hit at char 3918. The stream's
   `sep: ""` marks every tight join; the renderer emits those runs
   inline.

A renderer may still parse a single node's text apart (a composite
`li` row into kicker/date/title) — the SKILL.md Phase 4 fail-loudly
rule applies to that parse. Reordering or re-joining across nodes is
never the renderer's job anymore.

## Rendered-case text (the casing subtlety)

All text is captured via `innerText`, which reflects
`text-transform` — an eyebrow authored as "Locations" but rendered
uppercase is captured as "LOCATIONS". This is deliberate: the gate
compares **rendered** text on both sides, so the reskin reproduces
casing via CSS `text-transform` where the source does, and byte
equality stays honest at the rendered-text level. Never edit the
string to change case. Policy: `reference/mapping-brief.md` § Casing
policy.

## Scope discovery

**The top failure mode.** In the validation experiment the obvious
root (`#content`) silently dropped ~30% of the page's content — 1558
of 2281 chars — because the hero and a banner carousel lived inside
`<header>`. Byte equality would then "pass" against an incomplete
reference: the gate is only as good as the scope.

Procedure, per page:

1. **Render and screenshot first.** The capture writes
   `source-full.png`; extract's capture
   (`stardust/current/assets/screenshots/<slug>.png`) works too.
   The screenshot is ground truth for "what content exists".
2. **Start from the candidate root** — `main`, `#content`, or the
   CMS's obvious wrapper.
3. **Read the coverage line** the capturer prints:
   `scope <n> / body <m> chars (ratio r) — h1 in scope: <bool>`.
   - `h1InScope: false` is an automatic scope failure — the hero
     lives outside the root (the experiment's exact case). Widen.
   - A low ratio is a smell, not a verdict: the gap should be fully
     explained by **declared chrome** (nav, footer, skip links). Eye
     the screenshot against the captured slots; anything visible
     that is neither in a slot nor declared chrome means the scope
     is wrong.
3b. **Check slot granularity** — the capturer prints it
   (`granularity: <n> slots — largest slot carries <p>% of scope
   text`). If the page yields **fewer slots than visible sections**,
   or one slot carries most of the scope text, the scope sits on a
   page-wide wrapper and every downstream artifact would be built on
   a single unmappable mega-slot. CMS parsys/wrapper divs are the
   usual culprits — an AEM page can pass ratio AND h1InScope while
   producing 2 slots for an entire homepage, because the content
   root's children are an sr-only heading and one `.par.parsys`
   wrapper two levels above the real sections. **Iterate: scope
   deeper so the real sections become the scope's children** —
   inspect the mega-slot's root, find the container whose children
   are the visible sections, and re-scope onto it (keeping any
   outside-the-wrapper units as extra `!` scopes). The field run
   needed three scope iterations to get from 2 slots to 11 real
   ones.
4. **Widen with multi-scope selectors**, comma-separated, captured
   in order: `'.stage.section!,.banner-slider.section!,#content'`.
   The `!` suffix keeps a scope **whole** as one slot (use it for
   hero blocks and other units whose children are fragments, not
   sections).
5. **Declare the residue.** Whatever stays outside the scope
   (nav, footer) is a chrome delta (`D1`-style) recorded in the
   mapping brief — an explicit swap to donor chrome, never a silent
   omission.

The final scope string is recorded in `_provenance.scope` and must be
passed **identically** to `dom-equality.mjs --source-scope` at gate
time. A gate run with a different scope than the capture measures
nothing.

Shadow-DOM or iframe-hosted content is not reachable by these
selectors — that's a SKILL.md § Stop condition, not something to
paper over.

## Normalization ledger

Every DOM mutation applied to the source before capture is a
**declared, executable, shared** delta:

- **Declared** — each entry has an id (`N1`, `N2`, …), a what, and a
  why. The default entries are `N-D1` (cookie/consent chrome) and
  `N-D2` (de-carousel) — see `scripts/source-normalize.mjs` for the
  exact selectors and rationale.
- **Executable** — the ledger is a JS string run via
  `page.evaluate()`, not prose. What the capture removed is exactly
  what the gate removes, because it is the same code.
- **Shared** — the page ledger module is passed via `--normalize` to
  `capture-content.mjs` AND to `dom-equality.mjs`. Same file, both
  ends. A ledger edited between capture and gate invalidates the
  capture — re-capture.

Page ledger format (`stardust/reskin/normalize/<slug>.mjs`):

```js
import { DEFAULT_NORMALIZE, DEFAULT_LEDGER } from '../../scripts/reskin/source-normalize.mjs';

export const LEDGER = [
  ...DEFAULT_LEDGER,
  { id: 'N1', what: 'remove #newsletter-popup', why: 'timed overlay, not page content' },
];

export const NORMALIZE = `${DEFAULT_NORMALIZE};(() => {
  // N1 — timed newsletter overlay
  document.querySelector('#newsletter-popup')?.remove();
})()`;
```

Rules:

- A normalization may only remove **chrome or duplication** — never
  content. De-carouselling keeps every slide's text and image; it
  removes clones and pager dots. If in doubt whether something is
  content, it is content.
- Every entry surfaces in the mapping brief's deltas section
  (`reference/mapping-brief.md` § Deltas) so a human can audit the
  full list of source-side mutations in one place.
- The default `N-D1` cookie selectors are deliberately narrow
  (paired `cookie`+`banner`/`consent` attributes, known CMP ids). A
  page whose *content* discusses cookies (a recipes site, a privacy
  page) must be eyeballed after normalization — if a content block
  vanished, override with a page ledger that replaces `N-D1` with
  the CMP's exact id instead of extending the default.

## Provenance

`_provenance` follows the plugin's artifact shape
(`../../stardust/reference/artifact-map.md`): who wrote it, when,
against which URL, plus the two reskin-specific fields — the verbatim
`scope` string and the resolved `normalize` source. The gate reports
cite both, so any capture↔gate mismatch is visible in the report
header.
