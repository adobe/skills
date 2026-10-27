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
    "normalize": { "source": "<ledger path | 'default'>", "ledger": [ { "id", "what", "why" } ] },
    "nav": { "live": true, "waitUntil": "domcontentloaded", "headed": false },
    "settle": { "firstLen": 4102, "waitedMs": 1511, "stable": true, "settledLen": 4413, "lateChars": 311 }
  },
  "metadata": {
    "title": "", "description": "", "canonical": null,
    "ogTags": { "og:title": "…" }, "twitterTags": { "twitter:card": "…" },
    "jsonLd": [ { } ], "lang": "en", "favicon": null
  },
  "scope": [ { "sel": "#content", "whole": false } ],
  "visibleTextNormalized": "<whitespace-normalized innerText of the whole scope — the content-gate reference string>",
  "coverage": { "bodyTextLen": 2911, "scopeTextLen": 2281, "ratio": 0.784, "h1Text": "…", "h1InScope": true },
  "residue": [ { "sel": "div.layout > aside.sidebar", "kind": "aside", "textLen": 140,
                 "lines": [ "Section navigation", "Learning and support", "…" ], "rect": { "x": 120, "y": 420, "w": 400, "h": 900 } } ],
  "sections": [
    {
      "slot": "s01",
      "rootTag": "div", "rootClass": "stage section",
      "tone": "dark", "bg": "rgb(99, 0, 25)", "toneEl": "div.callout",
      "visibleText": "<normalized innerText of this slot>",
      "headings":   [ { "level": "h1", "text": "…" } ],
      "paragraphs": [ "…" ],
      "listItems":  [ "…" ],
      "ctas":       [ { "text": "…", "href": "…", "absHref": "https://…", "classes": "…" } ],
      "iconLinks":  [ { "label": "Facebook", "href": "…", "absHref": "https://…" } ],
      "images":     [ { "currentSrc": "https://…", "alt": "…", "w": 1200, "h": 675 } ],
      "formControls": [ { "control": "select", "name": "classType", "text": "Select a Class Type Online Classes …",
                          "options": [ "Select a Class Type", "Online Classes & Training", "…" ], "selectedIndex": 0 },
                        { "control": "input", "inputType": "text", "name": "zip", "text": "", "placeholder": "Zip Code" } ],
      "leftovers":  [ { "text": "…", "parentTag": "span", "parentClass": "…" } ],
      "ordered": [
        { "kind": "heading", "level": "h2", "text": "News", "display": "block", "sep": "" },
        { "kind": "cta", "text": "…", "href": "…", "absHref": "https://…", "classes": "…",
          "display": "block", "sep": " ",
          "children": [ { "kind": "heading", "level": "h3", "text": "…", "display": "block", "sep": "" } ] },
        { "kind": "text", "text": "02.07.2026", "parentTag": "time", "parentClass": "…", "sep": " " },
        { "kind": "image", "currentSrc": "https://…", "alt": "…", "sep": "" },
        { "kind": "formControl", "control": "select", "name": "classType", "text": "Select a Class Type …",
          "options": [ "Select a Class Type", "…" ], "selectedIndex": 0, "display": "block", "sep": " " },
        { "kind": "listItem", "text": "SUPERCOMPUTING", "display": "inline", "sep": " " },
        { "kind": "listItem", "text": "ARTIFICIAL INTELLIGENCE", "display": "inline", "sep": "" }
      ],
      "orderedVerified": true
    }
  ]
}
```

**Settle, residue, tone (stardust 0.40).** After the lazy-load scroll the
capture polls the body text every 500 ms until it is unchanged three times
(re-scrolling on growth, capped by `CAPTURE_SETTLE_CAP_MS`, default 15000):
`_provenance.settle` records it, and `stable: false` means the reference may
still be short. `residue[]` lists every sibling of each scope's ancestor chain
that holds no scope and has visible text — `kind` is `chrome`
(header/footer/banner/contentinfo), `breadcrumb`, `aside`, `nav` or `other`;
`lines` are its visible text nodes (≤ 60). Each slot's `tone` is measured from
the background that paints it (the largest ≥ 50%-area opaque descendant up to
three levels down, else the nearest opaque ancestor): `dark` below relative
luminance 0.2, `tinted` when it differs from the page background, else `page`.
None of these feed the byte gates; gate (a′) reads them.

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
- **iconLinks** — every visible `a` with an href and no text (a social
  icon, a logo link), which `ctas` drops. `label` is its aria-label,
  title, `img` alt or svg title, else its host. `deployed-gate chrome`
  expects them in the header and footer.
- **images** — **ordered, visible** `img` elements (`loading="lazy"`
  admitted even when not yet intersected). `currentSrc` is the
  responsive-resolved URL; the gate compares URL-normalized
  host+path, order-sensitive.
- **formControls** — visible `select` / `input` / `textarea`
  controls. A `<select>`'s option text is part of `innerText` — and
  therefore of the byte-gate reference — but `getComputedStyle` on
  `<option>` computes `display:none`, so without this array the
  option bytes exist ONLY inside the concatenated `visibleText`,
  with no structured field to render from (a nonprofit's
  course-enrolment form: "Select a Class Type / Online Classes /
  … / FIND A CLASS"). Any locator / course-finder / country-picker
  page hits this. Captured: `control` (tag), `name`, `text`
  (`norm(innerText)` — for a select that includes the option
  texts), and per control: `options` (**verbatim, in order**) +
  `selectedIndex` for selects; `inputType` / `value` /
  `placeholder` for inputs and textareas. Visibility is tested on
  the CONTROL (an `input[type=hidden]` is excluded), never on the
  options.
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

- `kind` ∈ `heading | paragraph | listItem | cta | image |
  formControl | table | text` (§ Structure the stream keeps).
  `text` nodes are the stream's leftovers — bare text runs
  (eyebrows, dates, photo credits) with `parentTag`/`parentClass`
  for context, and `inButton: true` when the run sits inside a
  `<button>` below its direct parent (an icon button's sr-only label).
  A `cta` carries `buttonLike: true` when it is styled as a button
  whatever its class names: a painted background or visible border plus
  button-sized padding (≥8px sides, ≥4px top). The renderer gives it the
  donor `.btn`.
- `text` — normalized **rendered-case** innerText. Stream `text`
  nodes are built on an **innerText-consistent basis**: a text node
  enters the stream only if its text occurs in its parent's rendered
  `innerText`, and the emitted string is the matched slice OF that
  `innerText` — so casing is Chrome's own rendered case
  (text-transform included), by construction.
- `level` (headings), `href`/`absHref`/`classes` (ctas),
  `currentSrc`/`alt` (images — admitted by the same shared
  visibility predicate as the `images` array and the gate).
- `control`/`name` + `options`/`selectedIndex` (selects) or
  `inputType`/`value`/`placeholder` (inputs, textareas) on
  `formControl` nodes. The node's `text` is the control's
  `innerText` (a select's includes its option texts), so the node
  tiles `visibleText` like any other; the structured fields are the
  render surface. Renderers emit form controls as **equivalent
  controls** — a `<select>` carrying the option texts verbatim, in
  order; an input carrying value/placeholder — restyled with donor
  tokens, never flattened to plain text and never dropped.
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

### Structure the stream keeps (0.41)

A renderer that sees only the kind of each run flattens what the source structured, and design fidelity pays for it
(a table as a column of paragraphs, every accordion open with its icon word printed, a 768 px figure as a 24 px icon).
The stream therefore carries:

- **`table`** — `{ kind: 'table', text, rows: [[{ text, header?, colspan?, children? }]] }`; `children` is the cell's
  own stream when it holds more than plain text (a link). `text` is the table's innerText, so the node tiles
  `visibleText` like any other.
- **Disclosures** — a toggle is `[aria-expanded][aria-controls]` (its target must exist) or a `<summary>` of a
  `<details>`. Every node inside a toggle carries `toggle: <panel id>`, plus `toggleOpen: true` when the source had it
  open **at rest**; every node inside a controlled panel or a `<details>` body carries `panels: [<id>, …]` (inner first).
  The rest state is read before the normalization ledger runs, so a ledger that expands accordions (N3) to read their
  text no longer decides how they render. The renderer emits `div.disclosure > button.disclosure-toggle +
  div.disclosure-panel`, closed panels as `hidden="until-found"` (dom-equality reveals them and compares the rest-state
  count). A toggle inside a heading (`h3 > button`) is the heading's children. A toggle with no adjacent panel in the
  stream renders as plain text.
- **`glyph: true`** on a text run that is an icon-font ligature: a lower-case `[a-z0-9_]` word under
  `aria-hidden="true"` set in an `icon`/`symbol` font family. The renderer keeps the word (font-size 0, for the byte
  gate) and draws a CSS glyph (chevron, search, close, menu).
- **`srOnly: true`** on a text run or cta that is visually hidden (≤ 1×1 px, clipped, `clip-path: inset(50%)`, or above
  or left of the page). It renders `.sr-only`, still in innerText.
- **`rw`** on an image: its rendered width. A paragraph holding only images, one of them ≥ 200 px wide, renders as a
  full-width figure; an inline image ≥ 200 px is `.inline-media`. A model without `rw` keeps the inline-icon rendering.
### The consistency guarantee

The stream and the byte gate share ONE definition of "visible text":
Chrome's `innerText`. `visibleText` (the gate reference) *is*
`innerText`; stream `text` nodes are admitted **only** when their
text occurs in the parent's `innerText`, and their string is sliced
from it. Text that a naive visibility predicate would admit but
`innerText` omits — SVG `<title>`/`<desc>` a11y labels (a field site's
carousel "Arrow right"/"Arrow left", the video "Play" label),
duplicated nested link labels, UA-hidden text — never enters the
stream. Without this basis the stream emits **ghost nodes**: a
spec-compliant renderer ("emit stream order, never reconstruct from
visibleText") reproduces them and fails the byte gate through no
fault of its own — a field run hit exactly that on 5 of 8
slots.

`orderedVerified` (per slot) records that the stream **tiles**
`visibleText` exactly — every child's text found left-to-right with
only whitespace gaps, nothing left over. Under the consistency
guarantee this should hold for ordinary slots; the capturer warns on
any slot where it is `false`; do not trust that slot's `sep` flags
without inspecting it.

### When `orderedVerified` is false — the sanctioned fallback

Inspect the slot first: the divergence may be real missing structure
(a content element kind the stream doesn't capture — report it), or
dynamic text that changed between the two reads. When the inspection
shows stream text that is genuinely absent from the slot's
`visibleText`, the **sanctioned resolution** is:

1. drop the stream nodes (or node-text) not present in the slot's
   `visibleText` before rendering — matching against `visibleText`
   **for this filtering purpose** is the documented fallback, not
   the forbidden order-reconstruction move (the prohibition in
   SKILL.md Phase 4 is against *reconstructing order/separators*
   from `visibleText`; filtering ghosts against it is how the
   stream is brought back onto the gate's basis);
2. record the drop in the model's provenance — add a
   `streamFilter` note under `_provenance` (or the run report)
   naming the slot, the dropped text, and why — so the model stays
   auditable;
3. treat the slot's `sep` flags as unverified — verify the joins
   against `visibleText` after filtering.

Never resolve the other direction (adding text to the render that
isn't a stream node) and never edit `visibleText` itself.

### Why this exists (the smoke-test history)

The first field run of this skill (a university site × a SaaS donor) had only
the per-type arrays; reconstructing document order from `visibleText` as an
oracle took three debug rounds on one page, on duplicate identical strings
(greedy matching nests a block inside its own twin), CTA/container nesting in
both directions and zero-separator inline joins (the byte-gate failure at char
3918). The stream captures each structurally: duplicates are two nodes,
`children` records the nesting, `sep: ""` marks every tight join.

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
   The capturer downgrades two known false positives to `note:`
   lines. (a) **All-whole scopes** (every part ends in `!`, e.g. a
   chrome capture or a single-form page) are one slot per element
   by design, so it skips the granularity check and treats an h1
   outside the scope as expected. (b) A **mega-slot that is a
   repeating run** (`findRepeat` covers ≥60% of its stream) is a
   card grid, not a wrapper: a listing page whose grid carries most
   of the text is correctly scoped. A `WARNING:` means neither
   exception applies.
4. **Widen with multi-scope selectors**, comma-separated, captured
   in order: `'.stage.section!,.banner-slider.section!,#content'`.
   The `!` suffix keeps a scope **whole** as one slot (use it for
   hero blocks and other units whose children are fragments, not
   sections).

   **Each selector captures exactly ONE element** — resolution is
   `querySelector`, first match, NOT set-matching. The example above
   works because each selector is unique on its page; a class shared
   by N siblings captures only the first (one field site has three
   `section.section--highlights` — that class as a scope captured
   one and silently dropped two). To capture N sibling sections:
   scope their **common container** without `!` (its children become
   the slots — the normal move), or give each sibling a
   per-element-unique selector
   (`section.section--highlights:nth-of-type(2)`-style). The same
   first-match rule applies verbatim to `dom-equality.mjs
   --source-scope`.
5. **Declare the residue — machine-checked.** Whatever stays outside the
   scope is in `residue[]`. Header and footer (`kind: chrome`) are a
   chrome delta (`D1`-style) recorded in the mapping brief and held by
   A6. Every other region with ≥ 20 chars — a breadcrumb, a section
   sidebar, a utility bar — is carried to the target or declared in
   `coverage/<slug>.json` with a why; `source-coverage.mjs` (gate (a′))
   FAILs a region that is neither. Widening the scope to take it in is
   also fine — then it is content and the byte gates hold it.

**Zero-output failures carry the discovery evidence.** When the
scope matches nothing, the capturer prints the whole-body text
length and the candidate-root ladder (the largest-text-child chain
from `<body>`, each with text length and body-coverage ratio) — the
real content root is on that chain. Start step 2 from its deepest
high-coverage entry.

**A missing "obvious" root can be a degraded page, not a scope
problem.** The capture navigates live URLs through the shared
live-session hardening (real-Chrome UA + the standard request
headers, `domcontentloaded`, challenge detection — one field site served a
non-hydrated document with no `<main>` to the default headless UA,
and Akamai-class bot managers 403 on missing standard headers even
with the real UA). A bot challenge fails loud with **exit 3** and is
never captured as the source; escalate with `--headed` (stealth real
Chrome), and a site that still blocks needs crawl.mjs-class capture
— never gate against whatever the block served.

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

- A normalization is **capture-only**. It changes what the capture and
  the gate read, never how the delivered block behaves: an entry that
  expands every accordion (so the hidden panel text is captured) does
  not make the deployed accordion start open. The block keeps the
  source's rest state, hiding a closed panel with `hidden="until-found"`
  or a closed `<details>`; `dom-equality` fails a render that starts
  everything open against a source that does not (`reference/gates.md`
  § dom-equality).
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

## Figma-sourced models

A Figma-only project (no live site; `state.json` `flowSource: "figma-only"`, written by
`figma-donor.mjs init`) takes its content from the page frames: `figma-donor.mjs content <url>
--frame <id> --slug <slug>` writes `content-model/<slug>/content-model.json` with the shape above, so
mapping, `stream-render`, `slot-coverage` and the handoff read it unchanged. What differs:

- `_provenance.source` is `{ kind: "figma", figma: { fileKey, fileKeyHash, node, version, name } }`
  (`fileKey` is `"redacted"` under `--confidential`; the overwrite guard compares `fileKeyHash`). It
  also records the rules applied: `visibility` (effective: a hidden ancestor hides), `readingOrder`
  (auto-layout child order, else geometric rows by ≥ 50 % vertical overlap then x; overlapping text is
  listed as ambiguous), `segmentation` (top-level children by y; chrome by name — `Header`, `Nav bar`,
  `Top bar`, `Footer` anywhere, or the word in the name's last path segment, e.g. "Market Specific
  Header", for the outermost content layer at the top / bottom, so a "Section Header" below it stays
  body; `content-rules.json` `chrome.header|footer|headerWord|footerWord` override the patterns;
  content-less layers fold; one wrapper with ≥ 2 bands is descended), `responsive` and `decorative`.
- Text is the rendered case (`textCase` applied); `characters` and `textCase` stay beside it so the
  renderer sets the CSS (`text-transform`, `font-variant-caps`) on the raw characters. A truncated
  layer keeps the full string with `truncation: { maxLines }`; the renderer clamps it in CSS.
  A TEXT layer's `\n`-separated lines are separate paragraphs; a line separator (U+2028) stays inside
  one paragraph as a break (the run after it carries `br: true`, rendered `<br>`).
- An image fill drawn translucent carries `opacity` (node opacity × image-fill opacity, only when
  < 1) and `backdrop`, the CSS colour under it (the solid fill below the image in the layer's fill
  stack, else the nearest ancestor's solid fill); the renderer sets the opacity on the `<img>` and the
  backdrop on its wrapper (`figure`, the media band's section, a split's `.img-backdrop`).
- Headings come from the donor's type roles (`donor-tokens.json` `type.display|h1…h6`); the first is
  the page h1. Links come from per-run hyperlinks and prototype interactions and pass the allowlist
  (http(s), mailto, tel, root-relative); a NODE link resolves to a slug via `--pages <id>=<slug>` or
  `reskin/content-rules.json` `pages`. Drawn fields become `formControls` with the drawn placeholder.
  A button component (layer, component or set named button / btn / cta) is a button unless its
  visible variant says link (a VARIANT value or its main component's `Key=Link` name; an icon property
  aside): then it is a link (`cta`, `href "#"` and `link.unresolved` without a target). A text inside it
  larger than its smallest text (≥ 1.2×) is its own heading or paragraph, never part of the label.
- `metadata` holds only the title derived from the frame name; `declaredAbsent` lists description,
  canonical, OG, Twitter and JSON-LD. Nothing is invented: SEO, alt text and link targets are flags.
- Side files: `text-ops.json` (per-node text ops `caseless | attr | omit | replace`, chrome outside
  the gate; read only by the Figma text gate), `flags.json` (every finding with severity `block | review | info`; open
  block and review items are the deploy blocklist, cleared by fixing the design and re-running
  `content` or by `figma-donor.mjs ack <slug> --flag <key> --why "…"`) and `assets/` (image bytes,
  magic-byte sniffed; SVGs refused when they carry script, handlers or external references).
- Shared header/footer layers go to `content-model/_chrome/` once (kept unless the same frame re-runs
  or `--force`).
- Placeholder copy (lorem, kit words such as "Button", `XX-XXXX` patterns, a string repeated ≥ 3 times)
  is a block flag; a page whose body is all placeholder is `placeholderOnly` and `content` exits 1.
- Kit default copy: a text still at its kit component's default (an instance sublayer with no
  `characters` override) where the responsive frame draws other text is `placeholder.kit-default`,
  naming the responsive text to use. It is a block flag when the instance's copy also reads like kit
  copy ("The most inspiring heading"), or repeats such copy; otherwise review ("confirm which copy is
  meant"). Either keeps `blocklist` at exit 1: set the real copy in Figma and re-run `content`.
- Design strings are untrusted: the model keeps them raw, every renderer escapes them, and layer names
  become class tokens only when they pass block-name validation.

### Pages and the kit library

`figma-donor.mjs pages <url>` reads the whole file (`files?depth=1`), groups canvases and writes
`reskin/figma-pages.json`; `content --all` runs `content` for each page it lists.

- **Canvas groups.** Marker canvases (`FOUNDATIONS`, `COMPONENTS`, `TEMPLATE SECTIONS`, `FULL PAGES`,
  matched by `kit.markers`) open a group; the canvases after one belong to it. Prefix glyphs override
  (`❖` component, `❏` template, `↪` foundation, via `kit.prefixes`); `kit.canvases {id: group}` pins one.
- **Pages.** On a pages canvas each COMPONENT_SET is a page family: variant `Type=X` is page `x`,
  `Breakpoint=Desktop` its frame, Tablet/Mobile its responsive frame (`kit.breakpointProp`). Without
  a set, top-level frames are pages paired by name. Frames named `Page: …`, `Cover`, or matching
  `kit.exclude` are documentation and listed under `skipped`. The template slug is the set name.
- **The library.** Every non-marker template and component canvas is read to `kit.depth` (default 5;
  a canvas with no set inside that depth is listed in `kit.emptyCanvases`). With `kit.blockPer:
  "canvas"` (default) the canvas is one block, named from the canvas (`❖ Checkbox & Radio` →
  `checkbox-radio`); its first public set is the module frame, each public set becomes a variant
  class when there are several (`Teaser / Card` → `card`), and sets named with a leading `.` or `_`
  are parts. `"set"` makes each public set of a multi-set canvas its own block. Every block is a
  module (`M1…` in canvas order) and a capture frame, used or not; `kit.unused` lists those no page
  instances.
- **EDS names.** The library is a proposal: its keys (`block`) are Figma names. What each becomes is
  [`deploy` Step 2](../../deploy/SKILL.md#2-decide-names--reuse--lock-before-writing-any-code) (D1 default content vs block,
  D11 a boilerplate / Block Collection name), applied by `figma/eds-map.mjs` `edsEquivalent` and
  recorded as `block.eds {block, variant, reason}` (`null` block = default content). Several kit
  blocks on one EDS block are its variants, in canvas order — except form field modules, which all
  share the plain `form` block (field types are rows, `Label | value | type | state`, not classes).
  Worked example:

  | Figma canvas | EDS (`block.eds`) | Step 2 |
  |---|---|---|
  | ❖ Q&A | `accordion` | D11 Block Collection |
  | ❖ Teaser | `cards` (variant `teaser`) | D11 boilerplate |
  | ❖ Button | default content | D1 |
  | ❖ Chips | `chips` | no EDS match: keeps its name |
  | ❖ Input, ❖ Dropdown | `form` (no variant) | D11 Block Collection: field type rows |
- **Binding.** A page's top-level instances resolve, through `kit.index` (set id → kit block, class,
  part), to their EDS block (`kit`: the kit key); variant classes are the EDS variant, the set's class,
  then its non-breakpoint property values. A set no kit canvas holds is off-kit (`kit.offKit`, home
  canvas named): a variant of the EDS block Step 2 maps it to when the kit or EDS has it, else default
  content — never a new block. In the content model a section binds to the outermost kit instance
  enclosing its nodes (`section.kit {block, kit, module, variant, set, instance}`); instances that are
  default content bind `{block: null, defaultContent: true}` and do not count as a second block; none
  → `kit.unbound` (review), several EDS blocks in one band → `kit.mixed` (review). Chrome slots bind
  the same way.
- **Seed.** `reskin/mapping.seed.json` holds `library` (per kit block `{figma, block, variant,
  reason, module, key, used}`; `block` null = default content, nothing to build), `chrome.kit` and per
  page `template`, `slots.<sNN> {module, block, variant, instance}` and `defaultContent.<sNN> {module,
  figma}`. `mapping.json` is never
  written; it is authored from the seed. `stream-render` emits `data-block`, `data-block-variant`
  and `data-kit-instance` on each section whose slot names them.

