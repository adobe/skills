# Decode disciplines — deep dive (#42–#79)

Companion to SKILL.md § Step 8. The one-line rules inline in SKILL.md are the enforceable
contract; this file carries each discipline's full explanation, failure signature, and worked
example. Every block author (including dispatched sub-agents) must read this before writing
`decorate()` code.

## #42 — Lead/hero blocks: query content, don't hard-index rows

A hero that reads `rows[3]=headline, rows[4]=lede, rows[5]=CTA` breaks the moment the content
shape differs — and the mandatory-metadata / single-`<h1>` SEO rework (#34/#35) actively
**consolidates** the headline + lede + CTAs into ONE cell, so the fixed indices come back
`undefined` and the hero `.wrap` (the LCP element and the only `<h1>`) renders EMPTY with no
error. Decorate lead blocks by querying (`block.querySelector('h1,h2')`; link-bearing `<p>` =
CTAs; `picture` from anywhere) so they tolerate BOTH the rich multi-row shape and the
consolidated single-cell shape. Local-QA check: after decoration, assert the hero's inner
wrap is non-empty and contains the `<h1>`.

## #51 — Disambiguate eyebrow vs lede by ORDER/length, not "first `<p>`"

Both are link-free `<p>`s, so "first link-free paragraph = lede" swaps them (the short
eyebrow comes first). The canonical lead order is **eyebrow → heading → lede**: the eyebrow
is the short/uppercase line *before* the heading; the lede is the sentence-length `<p>`
*after* it.

## #55 — Unwrap the cell's heading before cloning into your OWN heading element

If you build a live `<h1>` and clone a source cell's *childNodes* into it, and that cell
wraps its text in its own `<h1>` (which #35/#42 actively encourage), you get
`<h1><h1>…</h1></h1>` — a duplicate heading and a doubled font cascade. Always
`const inner = cell.querySelector('h1,h2,h3,h4,h5,h6') || cell;` then clone
`inner.childNodes`. Local-QA: exactly one `<h1>`, and 0 descendant headings inside the live
headline.

## #70 — Marker injection must be IDEMPOTENT

When `decorate()` PREPENDS a fixed decorative marker to authored heading/link text (a glyph
`▶`, a badge, a `CH NN` number), first STRIP a matching leading occurrence from the cloned
text node — `firstText.textContent = firstText.textContent.replace(/^\s*▶\s*/, '')` — because
the author (or the #34/#35 SEO content rebuild) may already type it, so the marker doubles
(`▶ ▶ Latest signal`). Apply the SAME strip at EVERY place the block injects that marker
(section titles AND card links), not just some. (The visual-diff text-match catches a doubled
glyph `X X …`.)

## #69 — Carousel slide segmentation: heading-boundary driven and ORDER-AGNOSTIC

Segment slides ONLY on the heading boundary — one heading opens one slide (a leading
`<picture>` before the first heading may open slide 0). Fold EVERYTHING between two headings
into the open slide regardless of authored order (eyebrow/label may come AFTER the heading,
not before): first non-link text run = eyebrow, links = CTAs, extra text = description. Never
let a post-heading text node open a NEW slide (that steals the heading slot and the CTAs
never attach — symptom: N+2 jumbled slides with 0 CTAs). Local-QA: rendered slide count ==
authored heading count AND each slide's CTA count == authored.

## #76 — Split/photo-overlay segmentation: BUFFER the eyebrow that PRECEDES its heading

Heading-boundary segmentation (#52/#69/#73) opens a new group ON the heading — but in split
panels and photo-overlay halves the eyebrow is the small label ABOVE the title, so it arrives
BEFORE the heading and a "start collecting after the heading" loop drops it entirely. Worse,
the body line after the heading then falls into the now-empty eyebrow slot (inheriting its
accent/uppercase paint) and the next group's eyebrow bleeds into the prior group's teaser.
Fix: keep a `pendingEyebrow` — any text seen before a heading is buffered and attached to the
group that heading opens; once a group already has its body/CTA, further bare text re-buffers
as the NEXT group's pending eyebrow (not this group's teaser). This complements #69 (carousel
eyebrow may come AFTER the heading): don't hard-assume either order — buffer pre-heading
text, classify post-heading text by what's already filled. The content is all in the DOM, so
a count check passes while the render is scrambled — Local-QA: assert each group's
eyebrow/heading/body/CTA land in their OWN slots (eyebrow text ≠ body text), not just that N
groups exist. Hit on beermaker `the-people`.

## #57 — Carousel/rotator lead: exactly ONE server `<h1>` across all slides

A rotating hero authors N slide headlines; if each is an `<h1>`, the delivered HTML has N
`<h1>`s (the block may rotate a single live `<h1>` post-JS, but crawlers see all N). Author
the **first/primary** slide's headline as the page `<h1>` and every other slide's headline as
`<h2>` — the block reads them generically (`querySelector('h1,h2…')`) so the carousel still
works, and the server HTML has one `<h1>` (#35). Local-QA: count `<h1>` in the *content* file
= 1.

## #56 — A multi-row head/intro must be collected whole, not just its first row

A block that takes "the first row with no image" as the head breaks when the head is authored
as N separate single-cell rows (eyebrow / heading / CTA): only the eyebrow becomes the head
and the section heading + CTA leak into the item grid as bogus cards (the section title then
renders at card-title size). The head is **everything before the first content/image cell** —
collect ALL leading no-image rows into the head. (Inverse of #52's flattening.) Local-QA: the
item grid holds exactly the expected count, and the section heading renders at section-title
size.

## #62 / #68 / #71 — DEFAULT to the DA-flattened single-cell contract (the root cause of most decode bugs)

When block JS and the content page are generated in the same run, they MUST agree on the row
shape — and DA delivers most blocks as ONE row with ONE cell holding all elements as flat
siblings, NOT the rich multi-row layout the prototype implies. A block written to a multi-row
index contract (`rows[0]=eyebrow, rows[1]=title, rows[2]=cards…`) then reads its whole cell
as `rows[0]` and finds `rows[1..]` undefined — rendering 1-of-N (a jumbled hero, a card grid
with one card) while passing lint.

So make **flatten-first the default**, via a CELL-LEVEL cascade collector (#68/#71) — NOT a
single selector and NOT a block-level fallback chain. The trap (#71): a block-level chain
(try `:scope>div>div>*` on the whole block, else…) succeeds on the first tier whenever ANY
cell has a child element, so in a block that MIXES element cells (`img`/`h1`/`a`) with
text-only cells (eyebrow, lede, count, meta, date) it returns only the element cells and
**silently drops every bare-text cell** — the most common one-element-per-row DA shape. The
canonical `collectNodes` collector (inline in SKILL.md Step 8) iterates CELLS and recovers
each. Then segment/classify the returned nodes by content; one-cell-per-row is a fallback.

**Local-QA: assert every block's primary content container is non-empty post-decorate
(childCount>0 / height>0)** — a 0-node selector mismatch otherwise renders a silent blank box
(a blank hero only surfaces via a per-block height probe; testimonials surfaced as a CONTENT
GAP). And assert the rendered count equals the authored count — the hero wrap is non-empty
and has the `<h1>`; a card grid holds N cards (= N repeat-headings in source), never 1.
Index-based contracts pass lint but silently render 1/N.

## #61 — Card grids that alternate ground: reconstruct the rhythm by INDEX when no marker survives

A prototype encodes a grid's light/dark alternation structurally (the 2nd card has `--dark`),
but that marker does NOT survive into DA content. A block that flips dark only on an explicit
authored "dark" cell renders every card light — the dark card's white heading/CTA go
invisible (caught by the #59 `SURFACE/GROUND MISMATCH` flag). Fallback to the positional
pattern: `const dark = explicitMarker ?? (i % 2 === 1)`. Then scope on-dark button/text
overrides to the resulting `.card.dark` block class (#41).

## #48 — Content-classification applies to EVERY block, not just hero

The author's row/cell layout is rarely the contract the agent assumed — a block that
hard-codes `rows[4] = <dl> data cell` silently drops content when the content authors one
`dt|dd` pair per row instead, and a `[num]|[label]` two-cell assumption duplicates the
eyebrow when the author wrote a single `"01 — Title"` cell. These are **silent**: the page
still renders something, and the metrics-only diff (stretch/flush/blank) does NOT catch a
dropped CTA, a duplicated eyebrow, or an empty data grid. Classify rows/cells by content —
presence of a heading, a `<picture>`, a link, a number prefix (`/^\d+/`), a 2-cell `dt|dd`
shape — never by `block.children[N]`.

## #50 — When DA flattens content, delimiters carry structure — DECODE defensively

(ENCODE is the opposite: when the generator controls authoring, do NOT invent delimiters —
lead each sub-field with a preserved tag instead; see the ENCODE contract. A block parses
delimiters only as a back-compat fallback.) DA/snowflake content rarely preserves the
prototype's semantic `<dl>`/`<dt>`/`<dd>`/`<ol>`/`<ul>`/`<li>` — it flattens them to a
sequence of single-cell `<p>` rows with INLINE delimiters: `Address: PLACEHOLDER · Brand team
to supply` (key:value), `01 · Tabernacle · Imp. Stout · 6.5%` (`·`-delimited spec line),
`Heber Valley · Utah · Est 1996` (a plain foot line). So a block that `querySelector('dl,
dt')` or `'ol, ul, li'` finds NOTHING and silently drops the whole data table / spec list /
menu. **Parse by delimiters, not tags:** split `Key: value` on the first colon into
`dt`/`dd`; split `·`-delimited lines into spans; detect a list's start by its preceding
heading (`On tap this week`), not an `<ol>`. (Even #48's "one `dt|dd` pair per row" misses
this — the row is ONE cell, not two.) Checklist: for any table/spec-list/menu block, assert
post-decorate that the data container has the expected non-zero row count.

## #52 / #63 / #73 / #64 — Repeating card/tile grids: segment, don't iterate rows

A section that is a grid/band of N similar units (a 3-up card grid, a 2-up tile band, a logo
row, a team grid) is very often collapsed by DA into a SINGLE cell of a SINGLE row, with each
unit's elements (heading, picture, paragraphs, link) as flat siblings. A block written
one-DOM-row-per-card then renders **0 cards** (the whole grid collapses into the section
header) or **1** — silently dropping every other product/tile. Detect the flattened shape
(`rows.length === 1` with multiple headings in the cell) and **segment the flat sibling list
into one group per repeating heading**. The repeat-unit boundary is the **most frequent
heading tag** in the cell (cards are `h3`; the lone section title is `h2` one level up) —
segmenting on "any heading" turns the section title into a phantom first card. Support BOTH
the flat-single-cell and the one-row-per-unit shapes.

**Segmentation order (#63, #73):**
0. **one-row-per-card** — if ≥2 `:scope > div` ROWS each contain a card heading (`h3`/`h4`),
   build one group per ROW from `[...row.children]` in AUTHORED field order (treat leading
   non-card-heading rows as the section head); never assume a `tag → media → heading` field
   order — content authored `media → tag → heading` otherwise attributes each card's image to
   the PREVIOUS card and drops the first card's (a 1-of-N image shift that passes a
   card-COUNT check, #73); ELSE
1. per-card heading boundary if present; ELSE
2. **one card per delimited `<p>` line** — when the cards carry no per-card heading (only the
   section title), each card is a single `Name · meta · meta · Badge` line (the natural way
   to author a short card): split on the unit delimiter (`·`), first segment = name, a
   trailing keyword (`New`/`Limited`/`Sold out`…) = badge, the middle = meta; ELSE
3. one-row-per-unit.

This unifies #50 (delimiter parsing) and #52 (card segmentation) for the headingless
card/tile rail that falls between them (it silently renders 0 cards otherwise — the section
heading still shows, so only the #49 CONTENT GAP / a card-count assert catches it). Local-QA:
assert the grid count EVEN WHEN the block found no per-card headings (that's the case that
returns 0), AND that each card's image src matches its OWN title (#73 — an image shifted by
one passes a count-only check).

**#64 — Never use `<picture>` as the PRIMARY card boundary:** image-led prototypes tempt "the
picture leads each card", but claude-design content is usually image-less (#2), so a
picture-keyed split collapses N cards into 1. Segment on the per-card heading first; treat
the picture only as a hint for which segment owns the media. (If a grid renders 1-of-N,
suspect a picture-keyed boundary with no heading fallback.)

## #53 / #72 — Classifiers must match the element ITSELF or a descendant; media = `picture, img`

In the flattened shape the segmented "cells" are bare sibling elements (an `<img>`, an `<a>`,
an `<h3>`), so `cell.querySelector('img')` returns null and the content silently vanishes.
Classify with `el.matches(sel) || el.querySelector(sel)`. For MEDIA, always test
`picture, img` (not just `picture`) — un-pipelined/harness content and pasted external URLs
deliver a bare `<img>` with no `<picture>` wrapper:
`const media = el.matches('picture, img') ? el : el.querySelector('picture, img')`.
(Likewise `a` / `Hn`.)

Always pair with a per-section screenshot eyeball (#23) and the `CONTENT GAP` probe flag
(#49) — a heading/contentBox-count or main-height delta vs the proto means content was
dropped or duplicated.

## #79 — Read plain-text fields by CELL/`textContent`, not `querySelectorAll('p')`

The pipeline unwraps the `<p>` in single-text cells, so a `p`-based read drops
eyebrow/subhead/lede/tag/body on live while the raw-`<p>` harness still shows them. Verify
against the decorated live/preview render or a `<p>`-stripping harness, and assert each text
field is present (counts alone don't catch it).

## #35 — Headings: exactly one `<h1>` per page + a real outline

Prototype headlines are usually styled `<div>`/`<span>`s with no heading semantics. Promote
them: the hero/lead block renders its headline as the page's **single `<h1>`**; every other
section title renders as `<h2>` (sub-items `<h3>`). Never leave a headline as a bare `<div>`
— the `<h1>` is the strongest on-page relevance signal, it's the source of the page `<title>`
(#34), and the outline drives crawlers, AI answer engines, and screen readers (WCAG). This
applies to **interactive blocks too**: a flow/quiz/dashboard renders its lead title as `<h1>`
in its server-visible markup, not just after JS. (Symptom this prevents: a converted page
with zero `<h*>` elements, or sibling `<h2>`s with no `<h1>`.)

## #28 — Interactive blocks (stateful components)

When the prototype section is a stateful component (a selector, a filter, a form that mutates
data, a multi-step flow), reproduce it as **one self-contained interactive block that owns
the state** — block JS runs, so this is fully supported:

- **Data → keyed authorable rows.** For heterogeneous data, key each row by its first cell
  (`account | id | name | …`, `txn | date | desc | …`) and parse by key. Homogeneous lists
  are just one row per item.
- **Behavior → local state + targeted re-render.** Hold a mutable `state` object; write small
  `render*()` functions (e.g. `renderCards()`, `renderList()`) and re-invoke only the
  affected one on each interaction — the manual equivalent of a React re-render. A form that
  mutates data validates, updates `state`, re-renders the affected parts (cards, totals,
  `<option>`s), and shows a confirmation.
- This mirrors lifting state to a parent in React: if several widgets share data, put them in
  **one** block rather than trying to sync state across blocks. (Cross-block coordination, if
  ever needed, is a DOM `CustomEvent`.)
- **QA the behavior, not just the paint** — drive each control and assert the state change.
  (When asserting computed style right after a click, move the pointer off the element and
  let CSS transitions settle first, or a mid-`transition`/`:hover` read gives a false
  negative.)

## #33 — Sequential flow vs. addressable views: pick the right decomposition

A *sequential* flow whose views are entered from one starting point and are not independently
addressable (search → results → seats → confirm; an onboarding wizard; a checkout) is **one
block** with a `state.view` field and a `render()` dispatcher that `replaceChildren()`s the
active view. This is the inverse of #29: *independently-addressable* views with **different
chrome** become **multiple pages**. Rule of thumb — sequential-from-one-entry → one block;
addressable-with-own-chrome → pages.

## QA probes referenced from Local QA

### #13 — Wide-viewport content-width probe

```js
// Playwright, viewport 1600: for each block, is the content constrained?
for (const n of ['hero','quick','used','stats','service','offers','brands','locations']) {
  const w = await page.evaluate((sel) => {
    const inner = document.querySelector(`.${sel} .wrap`) || document.querySelector(`.${sel}`).firstElementChild;
    return Math.round(inner.getBoundingClientRect().width);
  }, n);
  console.log(n, w, w > 1340 ? '<== FULL-WIDTH (check against prototype)' : '');
}
```

Cross-check each flag against the prototype: full-bleed is correct only where the prototype
section has no inner max-width wrapper.

### #19 — Capture at a real viewport

A `min-height:100vh` hero becomes *window-tall* under a huge capture window (e.g. 7800px),
pushing its centered content far down and off the top crop — it looks like the hero text
vanished. Use Playwright at a normal viewport (e.g. 1440×900) and `scrollIntoView()` each
section before each screenshot.

### #29 — Multi-view SPA harness caveat

The `metadata` block is consumed by the delivery pipeline into a `<head>` `<meta>`, but the
local harness has no pipeline — so it won't apply `header: off` and will try to load
`metadata` as a block, showing a stray error. Strip the `<header>` element from the harness
to preview a header-off page; it's a non-issue live.
