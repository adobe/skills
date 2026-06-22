# DA HTML content reference

How to generate HTML that DA will accept and EDS will render correctly.
Covers the document skeleton, block markup (canonical `<div class="…">`
form and accepted `<table>` alternate), section structure, page and
section metadata blocks, default content, icons, links, image references,
and the encoding / forbidden constructs.

For media binaries (the files HTML references), see [media.md](./media.md).
For the DA Source API call that uploads the HTML, see
[platform.md](./platform.md).

Every factual claim is tagged `[verified]` (read from code or observed
empirically) or `[assumed]` (inferred from documentation without direct
verification).

---

## 1. Document skeleton

A DA document is a **body fragment**, not a full HTML page. `[verified]`
from `da-admin` source and team docs.

```html
<body>
  <header></header>
  <main>
    <div>...</div>      <!-- one div per section -->
    <div>...</div>
  </main>
  <footer></footer>
</body>
```

### What to include

- `<body>` wrapper (mandatory)
- `<header>` and `<footer>` (mandatory tags, typically empty)
- `<main>` containing one `<div>` per section

### What to NOT include

| Tag / attr | Why |
|---|---|
| `<!DOCTYPE>` | Server-side pipeline emits this. `[verified]` |
| `<html>`, `<head>` | Server-side pipeline emits these from `head.html`. `[verified]` |
| `<script>`, inline `onclick=` | Stripped by the pipeline. `[verified]` |
| `<style>`, `style=` attrs | Stripped by the pipeline. `[verified]` |
| `class=` on default-content tags (paragraphs, headings, lists) | Added by `decorateBlocks` / `decorateSections` at delivery. `[verified]` |
| `id=` on headings | Auto-generated from heading text. `[verified]` |
| Inline `data-*` attrs outside Section Metadata output | Stripped. `[verified]` |

### Pipeline injection

At delivery, the EDS pipeline injects `head.html` from the project's
Code Bus (typically containing the CSP meta, viewport, `aem.js`,
`scripts.js`, `styles.css`). The DA document supplies only the
in-`<body>` content. `[verified]` from EDS docs.

## 2. Sections

Each section is a single `<div>` directly inside `<main>`. `[verified]` from
EDS markup docs.

```html
<main>
  <div>
    <!-- section 1 contents -->
  </div>
  <div>
    <!-- section 2 contents -->
  </div>
</main>
```

### Rules

- No `<hr>` between sections — the section boundary is the `<div>` itself.
- Sections may contain default content (headings, paragraphs, lists) and
  blocks (see §3) in any order.
- One level of nesting only: blocks cannot contain other blocks. `[verified]`
  from EDS markup docs.
- Each section becomes `<div class="section">` after decoration at
  delivery; section metadata (§4) adds further CSS classes.

### When to use multiple sections

Use a new section whenever the visual layout shifts — different background,
different content density, a layout break. Sections are the natural unit
of CSS theming.

### Single-section pages

A page with no logical section break still wraps its content in one `<div>`
inside `<main>`. The pipeline always wraps everything in at least one
section. `[verified]`.

## 3. Blocks

A block is a piece of structured, named content inside a section. Two
authoring shapes are accepted by DA:

- **`<div class="…">` form — canonical.** Use this when generating HTML
  programmatically or by hand.
- **`<table>` form — accepted alternate.** Use this when piping content
  from Word / Google-docs imports, helix-importer-ui, or any
  markdown→HTML chain that emits tables natively.

Both forms produce **byte-identical** rendered output on `aem.page` /
`aem.live`. The recommendation to prefer divs is about round-trip
efficiency, not correctness. `[verified]` empirically via direct PUT of
each form against `admin.da.live/source/...` followed by preview —
identical `<div class="…">` markup in the rendered `<main>`. See the
investigation at `DA-BLOCK-FORMAT.md` lines 312-339.

### 3.1 The three-layer conversion model

Why both forms work, and why divs are the canonical form:

| Layer | Behavior |
|---|---|
| **Storage (`da-admin`)** | Accepts any HTML; stores bytes as-is, no transformation. `[verified]` `da-admin/src/storage/object/put.js:33-58`, `da-admin/src/helpers/source.js:62-71` |
| **Preview pipeline (Helix `md2da`)** | On preview, normalizes `<table>` blocks to `<div class="…">` blocks. `[verified]` mirrored in-repo by `da-nx/nx/utils/converters.js:33-60` `convertBlocks()`; the upstream contract is named in `da-nx/test/utils/converters/converters.test.js:145-160` ("md2da in Helix corresponds to mdToDocDom + docDomToAemHtml"). |
| **Editor (`da-live`)** | On open, parses `<div class="…">` into a ProseMirror `table` node via `aem2doc`. On save, always serializes back to `<div class="…">` via `prose2aem.js:26-58` `convertBlocks()`. `[verified]` |

Counter-check: the Universal Editor adapter reads div-form blocks
directly. `[verified]` `da-universal/src/utils/hast.js:36-103`
`readBlockConfig`.

Consequence for programmatic authoring:

- **Generate divs** → the read shape (when you fetch existing content
  from `admin.da.live/source/...`) matches the write shape. Round-trip
  is identity. No `md2da` normalization step on the way to render.
- **Generate tables** → fully supported, but the storage form will flip
  to divs the first time a human user opens-and-saves in the DA editor
  (the editor canonicalizes on save).

### 3.2 Canonical div form

```html
<div class="block-name">
  <div>
    <div>cell 1</div>
    <div>cell 2</div>
  </div>
  <div>
    <div>cell 3</div>
    <div>cell 4</div>
  </div>
</div>
```

The outermost `<div>`'s `class` attribute encodes the block identity:
the **first class token is the block name**; subsequent tokens are
variants. Each direct child `<div>` is a row. Each grandchild `<div>` is
a cell.

```html
<div class="hero">
  <div>
    <div>
      <h1>Title</h1>
      <p>Subtitle</p>
    </div>
  </div>
</div>
```

### 3.3 Block name encoding

The first class token is the block name. It resolves to
`/blocks/<name>/<name>.{js,css}` at delivery (the EDS pipeline injects
these references from Code Bus).

| Class attribute | Block name | File path |
|---|---|---|
| `class="columns"` | `columns` | `blocks/columns/columns.{js,css}` |
| `class="hero-banner"` | `hero-banner` | `blocks/hero-banner/hero-banner.{js,css}` |

`[verified]` from `aem.js` `decorateBlock`.

#### `toBlockCSSClassNames` algorithm

Identical implementation in `da-nx/nx/utils/converters.js` and
`da-live/blocks/shared/prose2aem.js`. Used when normalizing a table-form
header (e.g. `"Columns (features, 3-col)"`) into the equivalent class
list (`["columns", "features", "3-col"]`):

1. Split on the last `(` — first part is the block name, parenthetical
   part splits on `,`
2. Lowercase
3. Non-alphanumeric runs → single `-`
4. Trim leading/trailing `-`
5. Drop empty segments

The inverse (`<div>` → editor table heading) joins them back: first
class is the block name, the rest are variants joined with `, ` and
wrapped in parentheses. `[verified]` `DA-BLOCK-FORMAT.md` lines 290-308.

#### Block name constraints (both forms)

- Alphanumeric and single hyphens only.
- No underscores. `[verified]`
- No double dashes. `[verified]`
- Cannot start with a digit. `[verified]`

Valid: `hero`, `columns`, `super-hero`
Invalid: `hero_wide`, `hero--wide`, `2col`

### 3.4 Block variants / options

Variants attach CSS modifier classes to the block. The two forms encode
them differently but normalize identically:

| Div form (`class="…"`) | Table form (header cell) | Resulting classes |
|---|---|---|
| `class="columns"` | `Columns` | `columns block` |
| `class="columns wide"` | `Columns (wide)` | `columns wide block` |
| `class="columns super-wide"` | `Columns (super wide)` | `columns super-wide block` (multi-word: hyphenated) |
| `class="columns dark wide"` | `Columns (dark, wide)` | `columns dark wide block` (comma-separated → separate classes) |

`[verified]` from EDS markup docs and `toBlockCSSClassNames` in
`da-nx/nx/utils/converters.js`.

### 3.5 DOM output after decoration

For **div-form input**, decoration is not a format conversion — only a
wrapper, status attributes, and an added `block` class are layered on:

```html
<!-- Authored in DA (div form, canonical) -->
<div class="hero">
  <div>
    <div>
      <h1>Title</h1>
      <p>Subtitle</p>
    </div>
  </div>
</div>

<!-- Rendered by aem.page -->
<div class="hero-wrapper">
  <div class="hero block" data-block-name="hero" data-block-status="loaded">
    <div>
      <div>
        <h1>Title</h1>
        <p>Subtitle</p>
      </div>
    </div>
  </div>
</div>
```

For **table-form input**, the Helix preview pipeline first normalizes
the table to the div form above, then decoration applies. The rendered
markup is byte-identical to the div-form rendering.

```html
<!-- Authored in DA (table form, alternate) -->
<table>
  <tr><td>Hero</td></tr>
  <tr><td><h1>Title</h1><p>Subtitle</p></td></tr>
</table>

<!-- Normalized by Helix preview pipeline -->
<div class="hero">
  <div><div><h1>Title</h1><p>Subtitle</p></div></div>
</div>

<!-- Then decorated (same as above) -->
<div class="hero-wrapper">
  <div class="hero block" data-block-name="hero" data-block-status="loaded">
    <div><div><h1>Title</h1><p>Subtitle</p></div></div>
  </div>
</div>
```

`[verified]` from `aem.js` `decorateBlock` for decoration; from
`da-nx/nx/utils/converters.js:33-60` for normalization.

#### Table-form header: colspan requirement

The example above uses a single-column block (Hero), so the header row's
single `<td>` already spans the table. For **multi-column** table-form
blocks, the header `<td>` must declare `colspan="N"` where `N` matches
the width of the widest content row. Without it, the parser sees a
one-cell row followed by multi-cell rows and rejects the structure as a
block — the table renders as plain HTML. `[verified]` 2026-05-20 by
empirical upload test (single-column blocks unaffected; multi-column
blocks without `colspan` render as plain tables).

| Content row width | Header `<td>` requires |
|---|---|
| 1 cell | `colspan` optional (`<tr><td>Name</td></tr>` is fine) |
| 2 cells | `<td colspan="2">Name</td>` |
| 3 cells | `<td colspan="3">Name</td>` |
| 4 cells | `<td colspan="4">Name</td>` |

Single-column blocks (Hero with one big content cell, Quote) work
without `colspan` because the header's single cell already spans the
full table width. Multi-column blocks (Columns, Cards, Stats, Section
Metadata, Metadata) require `colspan`.

If different content rows have different cell counts (uncommon but
legal), use the maximum: e.g., row 1 with 3 cells + row 2 with 2 cells
→ header `colspan="3"`.

The div form has no equivalent constraint — block identity is carried
by the outermost `<div>`'s `class`, not by row geometry.

### 3.6 Which form should I generate?

| Situation | Form |
|---|---|
| Writing HTML by hand or programmatically authoring | **`<div class="…">`** — matches what the editor saves and what storage returns. Round-trip is identity. |
| Migrating from Word / Google-docs, helix-importer-ui, an md-based site, or any pipeline that already emits `<table>` blocks | **`<table>`** — the Helix preview pipeline normalizes them on the way to render. No need to pre-convert. |
| Generating EDS-decorated HTML (with `<span class="icon icon-X">` etc.) for upload | **`<div class="…">`** with direct PUT to `admin.da.live/source/...`. Tables piped through the `aem content` CLI lose icon spans during pre-upload normalization. See [platform.md §7](./platform.md). |

`[verified]` `DA-BLOCK-FORMAT.md` lines 343-363.

### 3.7 Max children per row

Four children per row maximum (i.e. four cells per row). `[verified]`
from Adobe's Experience Modernization Agent prompting guide. Exceeding
this is not a hard parse failure but breaks the common block JS
patterns that assume ≤4 columns.

### 3.8 Forbidden patterns

These render as plain HTML (silent failure — the block JS never loads):

#### Div form

| Pattern | Why it breaks |
|---|---|
| Outermost `<div>` has no `class` attribute | No block name → not recognized as a block. Renders as a plain section `<div>`. `[verified]` |
| Block name class is not first in the class list | EDS reads the first class token as the block name. `class="wide hero"` resolves to block name `wide`, not `hero`. `[verified]` from `aem.js`. |
| Nested block divs (block inside a block cell) | EDS doesn't support nested blocks. The inner block renders as plain HTML. `[verified]` from EDS markup docs. |
| Skipping the row/cell nesting (`<div class="hero"><h1>…</h1></div>` directly) | Decoration expects depth-2 rows and depth-3 cells. Without them, default-content selectors inside the block JS don't match. `[verified]` |

#### Table form (alternate)

| Pattern | Why it breaks |
|---|---|
| First row NOT merged into a single cell | EDS treats the table as plain HTML. `[verified]` |
| Multi-column content rows but header `<td>` missing `colspan` | EDS treats the table as plain HTML. The header must visually span all content columns; without `colspan` the parser sees a one-cell row followed by multi-cell rows and rejects the structure as a block. `[verified]` 2026-05-20 |
| Empty header cell | No block name → not recognized as a block. `[verified]` |
| Nested `<table>` inside a block cell | EDS doesn't support nested blocks; the inner table renders as plain HTML. `[verified]` |
| Missing `<tbody>` | Some HTML generators omit `<tbody>`; DA's ProseMirror schema is strict. Use `<table><tr>...</tr></table>` consistently or always wrap in `<tbody>`. `[verified]` from `da-live` source. |
| Stray text nodes between `<tr>` / `<td>` | ProseMirror parse failure. Output clean HTML with no whitespace text nodes. `[verified]` |

### 3.9 Cell content normalization

The EDS preview/publish pipeline runs an **inline-content normalization
pass** on block cell content. It is stricter than the default-content
rules in §6: tags that survive in a paragraph outside a block can be
replaced or stripped when the same tag lives inside a block cell.

This is the most common silent failure when generating block content
programmatically from extracted source HTML: the cell values in the
uploaded DA document look correct, the rendered page on `aem.page`
silently loses or rewrites formatting, and nothing in the pipeline
surfaces an error.

The pipeline applies three distinct operations:

| Operation | What happens |
|---|---|
| **PRESERVE** | Tag and content pass through unchanged. |
| **REWRITE** | Tag is replaced with a semantic equivalent. Content survives wrapped in the new tag. |
| **STRIP** | Tag wrapper is removed. Text content survives unwrapped (but loses class, attributes, and any CSS hooks). |

#### Preserve list

These tags pass through cell normalization unchanged.

| Tag | Notes |
|---|---|
| `<strong>` | Bold emphasis. `[verified]` 2026-05-21 |
| `<em>` | Italic emphasis. `[verified]` 2026-05-21 |
| `<u>` | Underline. Survives inside cells despite having no markdown equivalent. `[verified]` 2026-05-21 |
| `<del>` | Semantic strikethrough. `[verified]` 2026-05-21 |
| `<code>` | Inline code. `[verified]` 2026-05-21 |
| `<sub>`, `<sup>` | Subscript / superscript. `[verified]` 2026-05-21 |
| `<a href="…">` | Link (full URLs only — see §8). `[verified]` 2026-05-21 |
| `<img>`, `<picture>` | Inherits verification from §9 image rules. `[assumed]` for cell-specific behavior — not separately retested. |
| `<h1>` – `<h6>` | Inherits verification from default-content rules. Block cells typically don't contain headings; verify before relying on this in a block context. |
| `<p>` | Preserved when a cell contains multiple block-level children. Unwrapped when a cell contains a single `<p>` of inline-only content — see "Cell-level `<p>` unwrapping" below. `[verified]` 2026-05-21 |
| `<ul>`, `<ol>`, `<li>` | Lists work inside cells, including nested lists, mixed list+`<p>` content, and `<li>` with inline formatting (`<strong>`, `<a>`). `[verified]` 2026-05-21 |
| `<br>` | Position-dependent. Preserved when surrounded by flow text or inside an `<li>`. See "`<br>` is position-dependent" below. `[verified]` 2026-05-21 |

#### Rewrite list

The pipeline canonicalizes presentational and near-semantic tags to
their semantic equivalents. The text content survives wrapped in the
replacement tag, so visual styling is **not** lost — but selectors
targeting the original tag stop matching, and DOM walks see a different
node type.

| Input tag | Rewritten to | Notes |
|---|---|---|
| `<b>` | `<strong>` | Presentational bold → semantic emphasis. `[verified]` 2026-05-21 |
| `<i>` | `<em>` | Presentational italic → semantic emphasis. `[verified]` 2026-05-21 |
| `<s>` | `<del>` | Presentational strikethrough → semantic deletion. `[verified]` 2026-05-21 |
| `<mark>` | `<em>` | Markdown has no native highlight notation, so the pipeline falls back to italic. **No inline tag survives as `<mark>` inside cells** — highlight styling must be CSS-on-structure (see "Practical guidance" below). `[verified]` 2026-05-21 |
| `<kbd>` | `<code>` | Both render as monospace; markdown round-trip collapses to `<code>`. `[verified]` 2026-05-21 |

#### Strip list

These tags are unwrapped. Text content survives bare in the parent
element; the tag wrapper, including any class or attributes, disappears.

| Tag | Observed behavior |
|---|---|
| `<span class="…">` | Span removed; text content survives without the wrapper. The class is lost, so any CSS targeting the class stops matching. `[verified]` 2026-05-21 |
| `<span>` (no class) | Same as classed span — unwrapped. `[verified]` 2026-05-21 |
| `<ins>` | Insertion semantics lost. No automatic semantic replacement. `[verified]` 2026-05-21 |

#### `<br>` is position-dependent

`<br>` is not simply preserved or stripped. The pipeline applies
positional rules: a `<br>` survives when it has flow content on the
side after it (i.e., it must "break to" something), and is stripped
otherwise.

| Position | Outcome | Example |
|---|---|---|
| Between flow text | PRESERVE | `before<br>after` → `before<br>after` |
| Inside `<p>` with text either side | PRESERVE (and the `<p>` may unwrap — see below) | `<p>before<br>after</p>` → `before<br>after` |
| Leading (`<br>` then text) | PRESERVE | `<br>text` → `<br>text` |
| Trailing (text then `<br>`) | STRIP | `text<br>` → `text` |
| Lonely (only content in cell) | STRIP | `<br>` → empty |
| Between block siblings (e.g. between two `<p>`) | STRIP — the block boundary already breaks | `<p>a</p><br><p>b</p>` → `<p>a</p><p>b</p>` |
| Consecutive (`<br><br>`) between flow text | PRESERVE both | `a<br><br>b` → `a<br><br>b` |
| Inside `<li>` between text | PRESERVE | `<li>line 1<br>line 2</li>` → `<li>line 1<br>line 2</li>` |

`[verified]` 2026-05-21 across all eight positional variants.

When a `<br>` carries a block-level semantic break (separating two
distinct paragraphs of content), restructure to two `<p>` elements
instead — the pipeline will strip a `<br>` between blocks and the
two-paragraph form is what authors would type in the DA editor anyway.

#### Cell-level `<p>` unwrapping

When a cell contains a single `<p>` whose children are inline-only
content, the pipeline unwraps the `<p>` — the cell `<div>` itself
provides the paragraph-equivalent flow context.

```html
<!-- Input: -->
<div><p>before <strong>middle</strong> after</p></div>

<!-- Output: -->
<div>before <strong>middle</strong> after</div>
```

When a cell contains multiple block-level children (e.g., a `<p>` plus
a `<ul>`, or two `<p>` elements), the `<p>` wrappers are preserved
because they distinguish blocks from each other:

```html
<!-- Input: -->
<div><p>Intro</p><ul><li>Item</li></ul></div>

<!-- Output (both wrappers preserved): -->
<div><p>Intro</p><ul><li>Item</li></ul></div>
```

`[verified]` 2026-05-21. The inverse also occurs in one observed case:
in nested lists, the inline text of a parent `<li>` that has a nested
list child gets wrapped in `<p>` on output (a markdown round-trip
artifact — markdown lists with nested children require multi-paragraph
notation for the parent).

#### Practical guidance

When source HTML contains content destined for a block cell, the
normalization rules above usually do the right thing automatically:
`<b>` becomes `<strong>`, `<i>` becomes `<em>`. Visual styling is
preserved through the rewrite. The cases that need authoring effort
are STRIP outcomes (where formatting is lost) and the `<mark>` rewrite
(where the semantic intent shifts).

**1. CSS-on-structure for stripped `<span>` styling hooks.** When a
`<span class="…">` carried CSS styling, rewrite the page CSS to target
structure rather than class. `:has()`, sibling combinators, and
`:nth-child()` cover most cases. Example for a price pattern:

```html
<!-- Source: classed span used as a styling hook -->
<p class="price">
  <del>CHF 20.90</del>
  <span class="price-now">CHF 14.63</span>
</p>
```

```css
/* Was: .price-now { color: orange; } — but the span gets stripped */
/* Now: target the position structurally */
.price:has(del) { color: orange; }
.price del { color: grey; }
```

**2. `<mark>` highlight styling via CSS-on-structure.** No inline tag
survives as `<mark>` inside cells. If a highlight is purely visual,
apply CSS to a surrounding structural selector (e.g., the cell, or a
parent block class). If the highlight needs to be inline-scoped, the
authoring pattern is to use a block whose cell content is the
highlighted phrase, styled at the block level.

**3. Restructure `<br>` between block-level content into separate
`<p>` elements.** This is mostly a non-issue today — `<br>` inside a
paragraph survives. But if the source HTML uses `<br>` to separate
what should be two paragraphs (e.g., between two `<strong>` titles
with trailing text), split it:

```html
<!-- Before: -->
<p><strong>Title A</strong><br><strong>Title B</strong></p>

<!-- After (semantically two paragraphs): -->
<p><strong>Title A</strong></p>
<p><strong>Title B</strong></p>
```

#### Why this happens

The preview pipeline converts DA-stored HTML through a markdown-ish
intermediate representation as it produces `*.plain.html` and the final
delivered page. Tags that map cleanly to markdown survive (semantic
emphasis, links, images, headings, lists, code). Tags that map to the
same markdown notation as another tag get canonicalized to a single
form (`<b>` and `<strong>` both encode as `**bold**` and both come
back as `<strong>`). Tags with no markdown representation are dropped
unless they have a semantic equivalent the pipeline can substitute
(`<mark>` → `<em>` because both italicize; `<span>` → text because
spans carry no semantic meaning markdown can encode).

`<u>` is the outlier — it has no markdown representation but survives
unchanged. This is a deliberate pipeline preservation, not a fallback.

#### Detection

When generating block content programmatically, scan the output before
upload to catch tags that the pipeline will strip or rewrite. Strip
outcomes lose content; rewrite outcomes are usually safe but may
surprise CSS selectors:

```bash
# Stripped wrappers (text loses class / styling)
grep -nE '<(span|ins)[ >]' path/to/da-output.html

# <br> in a STRIP position: immediately before a closing tag (trailing or lonely),
# or between two block-level siblings (block boundary already breaks)
grep -nE '<br[ /]*>[[:space:]]*</|</(p|div|ul|ol|h[1-6]|blockquote|pre|table)>[[:space:]]*<br[ /]*>' path/to/da-output.html

# Rewrite-list tags (formatting preserved, but CSS selectors targeting these stop matching)
grep -nE '<(b|i|s|mark|kbd)[ >]' path/to/da-output.html
```

For more rigorous detection, a Node script can parse the DA HTML, walk
into every block cell (depth-3 `<div>` inside any `<div class="…">`),
and verify the tag set per cell against the allowed list above.

#### Relationship to §6 (default content)

§6 lists allowed elements for content *outside* blocks. The cell
normalization rules here are *stricter and different*:

- `<u>`, `<s>`, `<br>` are listed in §6 as allowed default-content
  elements. Inside cells: `<u>` is preserved, `<s>` is **rewritten to
  `<del>`**, `<br>` is **position-dependent**.
- `<ul>`, `<ol>`, `<li>` are in §6 and also work in cells.
- `<span>`, `<b>`, `<i>`, `<mark>`, `<kbd>`, `<ins>` aren't in §6 (they
  are not standard default-content tags) and are stripped or rewritten
  inside cells.

**Rule of thumb:** when generating block-heavy content programmatically,
restrict yourself to the §3.9 preserve list everywhere — it always
works, both inside cells and as default content. If you need richer
inline formatting in default content, consult §6 separately.

## 4. Section Metadata block

Section Metadata is a special block placed **inside** the section it
targets. It adds CSS classes and data attributes to the enclosing section
`<div>`. It has **no SEO effect** — that's the Page Metadata block (§5).

Canonical (div) form:

```html
<div class="section-metadata">
  <div><div>Style</div><div>dark, center</div></div>
  <div><div>Background</div><div>https://content.da.live/{org}/{repo}/media/bg.jpg</div></div>
</div>
```

The block class is exactly `section-metadata` (kebab-case, one token).
`[verified]` from `toBlockCSSClassNames` in `da-nx/nx/utils/converters.js`
applied to the table-form header `"Section Metadata"`.

Alternate (table) form — equivalent, accepted when imported from
Word/Google-docs flows. Content rows have 2 cells, so the header
requires `colspan="2"` (§3.5):

```html
<table>
  <tr><td colspan="2">Section Metadata</td></tr>
  <tr><td>Style</td><td>dark, center</td></tr>
  <tr><td>Background</td><td>https://content.da.live/{org}/{repo}/media/bg.jpg</td></tr>
</table>
```

### Processing rules

- The `Style` property's value becomes additional CSS classes on the
  section `<div>` (comma-separated → separate classes). `[verified]`
- All other key/value rows become `data-*` attributes on the section.
  Key lowercased. `[verified]`
- No project code required — handled by the boilerplate's
  `decorateSections()`. `[verified]`

### Placement

Section Metadata must be inside the section it targets. The section is
determined by which `<div>` (inside `<main>`) the block sits inside.
Placing a Section Metadata block in the wrong section silently applies
the styles to the wrong section. `[verified]`

### URL values in data attributes

When a Section Metadata value is consumed by block JS or CSS as an asset URL
(e.g., `data-background` used as `background-image: url(...)`), the same
full-URL rule from §9 applies — use `https://content.da.live/...` or an
external URL, never a repo-relative path. The pipeline does not rewrite
data-attribute values. `[verified]`

### HTML output example

For either form above inside a section, the section `<div>` becomes:

```html
<div class="section dark center" data-background="https://content.da.live/{org}/{repo}/media/bg.jpg">
  <!-- section contents -->
</div>
```

## 5. Page Metadata block

A single block placed as the **last element of the last section inside
`<main>`**. Maps to `<head>` meta tags at delivery. Do not place it inside
`<footer>` — `<footer>` is typically empty (see §1). `[verified]`

Canonical (div) form:

```html
<div class="metadata">
  <div><div>title</div><div>My Page Title</div></div>
  <div><div>description</div><div>Page summary</div></div>
  <div><div>image</div><div><img src="https://content.da.live/{org}/{repo}/media/og.png"></div></div>
  <div><div>template</div><div>article</div></div>
  <div><div>theme</div><div>dark</div></div>
  <div><div>og:title</div><div>OG Title</div></div>
  <div><div>robots</div><div>noindex</div></div>
  <div><div>canonical</div><div>https://example.com/canonical-url</div></div>
</div>
```

The block class must be exactly `metadata` (single token, lowercase).
Misspelled class (`meta-data`, `metadatas`, missing class) → not
recognized → no `<meta>` tags emitted. `[verified]`

Alternate (table) form — equivalent. Content rows have 2 cells, so the
header requires `colspan="2"` (§3.5):

```html
<table>
  <tr><td colspan="2">Metadata</td></tr>
  <tr><td>title</td><td>My Page Title</td></tr>
  <tr><td>description</td><td>Page summary</td></tr>
  <tr><td>image</td><td><img src="https://content.da.live/{org}/{repo}/media/og.png"></td></tr>
  <tr><td>template</td><td>article</td></tr>
  <tr><td>theme</td><td>dark</td></tr>
  <tr><td>og:title</td><td>OG Title</td></tr>
  <tr><td>robots</td><td>noindex</td></tr>
  <tr><td>canonical</td><td>https://example.com/canonical-url</td></tr>
</table>
```

### Recognized keys

| Key | Output |
|---|---|
| `title` | `<title>` + `<meta name="title">` + `og:title` + `twitter:title` |
| `description` | `<meta name="description">` + `og:description` + `twitter:description` |
| `image` | `og:image` + `og:image:secure_url` + `twitter:image` |
| `author` | `<meta name="author">` |
| `keywords` | `<meta name="keywords">` |
| `robots` | `<meta name="robots">` (values: `noindex`, `nofollow`, `all`) |
| `canonical` | `<link rel="canonical">` |
| `template` | CSS class on `<body>` (triggers auto-blocking) |
| `theme` | CSS class on `<body>` |
| `og:*`, `twitter:*` | `<meta property="...">` |
| any other | `<meta name="<lowercased-key>" content="...">` |

`[verified]` from EDS docs.

### Rules

- Only one Metadata block per page. `[verified]`
- **Div form:** block class must be exactly `metadata` (single token).
  **Table form:** header text must be exactly `Metadata` (case-insensitive).
  Misspellings (`meta-data` / `Meta Data`, `metadatas` / `Metadata:`,
  `metadat` / `Metadat`) are silently ignored — no `<meta>` tags emitted.
  `[verified]`
- Page-level metadata overrides bulk metadata. `[verified]`
- Empty right column removes the corresponding tag (useful for clearing
  canonical on specific pages). `[verified]`

### Placement

Conventionally last in the document. `[verified]` from EDS docs. Some
projects place it at the top — both work, but consistency matters for
authoring tooling.

## 6. Default content

Default content is anything outside a block — standard document
elements that render as themselves: headings, paragraphs, lists, links,
images, inline formatting.

Use default content as much as possible. Blocks are heavier (structured
markup, block JS, dedicated CSS). Prefer default content for any content
that doesn't need a custom layout or behavior. `[verified]` from EDS
authoring docs.

### Allowed elements

| Tag | Notes |
|---|---|
| `<h1>` through `<h6>` | IDs auto-generated from text. `[verified]` |
| `<p>` | Standard paragraph. |
| `<ul>`, `<ol>`, `<li>` | Standard lists. |
| `<a href="...">` | Full URLs (§8). |
| `<img src="...">` | Full URLs (§9). |
| `<strong>`, `<em>` | Bold / italic. Trigger button promotion on standalone links (§8). |
| `<code>` | Inline code. |
| `<sub>`, `<sup>` | Subscript / superscript. |
| `<u>`, `<s>` | Underline / strikethrough. |
| `<br>` | Line break. |

For content **inside block cells**, a stricter inline-tag normalization
applies — `<s>` is rewritten to `<del>`, `<br>` is position-dependent,
and additional tags (`<b>`, `<i>`, `<mark>`, `<kbd>`, `<span>`, `<ins>`)
that are not in this default-content list have specific cell-level
behavior. See §3.9.

### Heading anchor IDs

Heading IDs are auto-generated by `decorateMain`. The algorithm:

1. Lowercase the heading text
2. Replace spaces with hyphens
3. Strip non-alphanumeric (except hyphens)

"Our History" → `id="our-history"` → linkable as `/page#our-history`.
`[verified]` from `aem.js`.

Authors should NOT manually add `id=` attributes — they are stripped and
regenerated. `[verified]`

## 7. Icons

In **DA HTML uploads**, icons are represented as:

```html
<span class="icon icon-<name>"></span>
```

`[verified]` from EDS `decorateIcons` source.

The colon-notation `:iconname:` form is what authors type in the DA editor
(or in Google Docs / Word) — the editor converts it to the `<span>` form
on save. When generating HTML programmatically, emit the `<span>` form
directly. `[verified]`

### SVG resolution

At delivery, `decorateIcons(element)` finds every `<span class="icon icon-X">`
and:

1. Fetches `/icons/<name>.svg` from the project's Code Bus.
2. Inlines the SVG content into the span (or sets `<img>` with the SVG as
   src, depending on the boilerplate variant).

`[verified]` from `aem.js`.

### Icon location options

Icons can live in two places:

- **Code Bus** (`/icons/<name>.svg` in the GitHub repo) — managed by
  developers, deployed via git. The default.
- **DA `/media`** (any path) — referenced via a full
  `https://content.da.live/...` URL in CSS or via `<img>` inside the icon
  span. See [media.md §3.3](./media.md) for the `/media` storage pattern
  and [media.md §6.1](./media.md) for the 40 KB SVG cap.

For static SVG icons under 40 KB, Code Bus is simpler. For authored icons
that need to change without code deploys, DA `/media` is the right choice.

## 8. Links

### URL form

`<a href>` accepts:

- Full external URLs (`https://other-host.com/path`) — preserved as-is.
- Full preview/live URLs (`https://main--repo--owner.aem.page/path`,
  `.aem.live/path`) — auto-rewritten to relative paths at render time.
  `[verified]`
- Full DA content URLs (`https://content.da.live/{org}/{repo}/path`) —
  serve directly. Use sparingly for in-page navigation; prefer the
  `aem.page` / `aem.live` form for branch independence at delivery.

### Discouraged forms (links only — for images see §9)

- Repo-relative paths without a host (`/path/to/page`) — these work in
  DA HTML for same-site links, but the pipeline rewrites `aem.page`-form
  URLs to relative anyway, so it's simpler and more copy-paste-friendly
  to use the full form.

### Forbidden forms

- Document-relative paths (`./page`, `../page`) — resolve against the
  editor URL (`da.live/edit#/...`), break in production. `[verified]`

### Heading anchors

Link to a heading via `#<auto-generated-id>` (see §6 for the algorithm).

```html
<a href="https://main--repo--owner.aem.page/about-us#our-history">Our history</a>
```

The pipeline rewrites this to `/about-us#our-history` at delivery.
`[verified]`

### Button promotion

A link becomes a styled button when it's the **only content of its
paragraph** (a "standalone" link). `[verified]` from `decorateButtons` source.

```html
<!-- Plain link inside text — stays a regular <a>: -->
<p>Read more in <a href="...">our blog</a> today.</p>

<!-- Standalone link — becomes a button: -->
<p><a href="...">Read the blog</a></p>

<!-- With <strong> — becomes a primary button: -->
<p><strong><a href="...">Get started</a></strong></p>

<!-- With <em> — becomes a secondary button: -->
<p><em><a href="...">Learn more</a></em></p>
```

The wrapping `<p>` becomes `class="button-container"`; the `<a>` becomes
`class="button"` (with `primary` or `secondary` modifier classes). All
applied by `decorateButtons` at delivery. `[verified]`

### External link `target="_blank"`

The boilerplate's `decorateExternalLinks()` adds `target="_blank"` to
links pointing to domains other than the current host. `[verified]`
Authors should NOT manually add `target="_blank"` — let decoration handle it.

## 9. Images in HTML

The single most common silent failure in programmatic HTML generation:
unreachable image URLs.

### Required URL form

Every `<img src>` and `<source srcset>` in a DA-uploaded document MUST be
a full URL that the preview step can fetch. The preview walks every
`<img>` and `<source>` element, fetches the URL, hashes the bytes, and
stores them in Media Bus — that's how the delivered page gets responsive
`<picture>` variants. See [media.md §2 (Asset lifecycle)](./media.md) for
the full flow.

Hosts that work:

| Host | Use case | Notes |
|---|---|---|
| `https://content.da.live/{org}/{repo}/<path>` | Preferred for assets you control | Preview re-fetches each time; binary must exist at upload time of preview |
| `https://{branch}--{repo}--{owner}.aem.page/<path>/media_<hash>.<ext>` | Already in Media Bus | Recognized; preview skips re-fetch |
| `https://other-host.com/<path>` | External image | **Sideloaded** — preview copies the bytes into Media Bus on first run; no DA pre-upload required `[verified]` |

### Forbidden URL forms

These render as `<img src="about:error">` and produce broken images on
delivery:

| Form | Why |
|---|---|
| Repo-relative paths (`/path/foo.png`) | No host → preview can't fetch. `[verified]` |
| Document-relative paths (`./foo.png`, `../foo.png`) | No host → preview can't fetch. `[verified]` |
| `https://{branch}--{repo}--{owner}.aem.page/<path>.png` (non-`media_*` path) | aem.page doesn't serve plain binaries at arbitrary paths → preview fetch 404s. `[verified]` |
| `https://content.da.live/{other-org}/{other-repo}/<path>` (cross-tenant) | Path doesn't exist → preview fetch 404s. `[verified]` |
| External URL that DNS-fails, returns 4xx/5xx, returns HTML/non-image content, or times out (>5s) | Preview fetch fails. `[verified]` |

### When you need to pre-upload binaries

Pre-uploading is **not** required for external URLs — the preview
sideloads them automatically. Pre-upload (PUT to
`admin.da.live/source/...`) when you want:

- A stable `content.da.live` URL the preview can re-fetch (independent
  of third-party host availability).
- Bytes under DA's control (e.g., for governance, asset reuse, or
  pre-migration prep).
- Predictable Media Bus hashes (the preview re-fetches the same DA path
  on every preview; same bytes → same hash).

For storage patterns (DAM, dot-folder, `/media`), supported formats, size
limits, and the Source API call to upload binaries, see
[media.md](./media.md).

### Author a simple `<img>` — pipeline auto-generates `<picture>`

EDS auto-transforms `<img>` into a responsive `<picture>` element at
delivery:

```html
<!-- Authored in DA -->
<img src="https://content.da.live/{org}/{repo}/media/hero.png" alt="Hero">

<!-- Rendered by aem.page -->
<picture>
  <source type="image/webp" srcset="./media_<hash>.png?width=2000&format=webply&optimize=medium"
          media="(min-width: 600px)">
  <source type="image/webp" srcset="./media_<hash>.png?width=750&format=webply&optimize=medium">
  <source type="image/png" srcset="./media_<hash>.png?width=2000&format=png&optimize=medium"
          media="(min-width: 600px)">
  <img loading="lazy"
       decoding="async"
       src="./media_<hash>.png?width=750&format=png&optimize=medium"
       width="..." height="..." alt="Hero">
</picture>
```

The transformation:

- Generates 750px (mobile) + 2000px (desktop) variants.
- Generates WebP variants alongside the source format.
- Adds `loading="lazy"`, `decoding="async"`, computed `width`/`height`.
- Strips authored `width`/`height` (the pipeline computes them from
  delivered variant dimensions).

`[verified]` from EDS pipeline docs.

### Author `<picture>` only when bare `<img>` won't do

In most cases, write a bare `<img>` and let the preview produce the
`<picture>`. Hand-authored `<picture>` markup is a less safe path because
the preview rewrites the whole element — both `<source srcset>` and
`<img src>` URLs are sideloaded, but the authored `<source>` elements
are replaced by pipeline-generated ones, not preserved alongside them.
`[verified]` empirically. If you need explicit art direction (different
images per breakpoint), test on `aem.page` before relying on it.

```html
<picture>
  <source media="(min-width: 1000px)"
          srcset="https://content.da.live/{org}/{repo}/media/hero-desktop.png">
  <img src="https://content.da.live/{org}/{repo}/media/hero-mobile.png" alt="Hero">
</picture>
```

### Required `alt` attribute

Always include `alt`. Empty `alt=""` is acceptable only for decorative
images. The pipeline preserves authored `alt` on the fallback `<img>`.
`[verified]`

## 10. Encoding and forbidden constructs

### Character encoding

- Source must be UTF-8 clean. `[verified]` from `da-admin`
  `normalizeCharset()`.
- The DA Source API strips `charset=` parameters from `Content-Type`
  headers (e.g., `text/html; charset=utf-8` becomes `text/html`). Don't
  rely on the charset parameter — ensure the bytes are UTF-8 before upload.
  `[verified]`

### Forbidden tags

| Tag | Why |
|---|---|
| `<script>` | Stripped by pipeline. `[verified]` |
| `<style>` | Stripped by pipeline. `[verified]` |
| `<iframe>` | Allowed for specific block use cases (e.g., embed blocks) but generally stripped from default content. `[assumed]` |
| `<form>`, `<input>`, `<button>` | Forms work via specific block patterns, not as default content. `[assumed]` |
| `<link>`, `<meta>` outside the Page Metadata block | Stripped; use Page Metadata (§5). `[assumed]` |

### Forbidden attributes

| Attribute | Why |
|---|---|
| `style="..."` | Stripped on ingestion. `[verified]` |
| `class="..."` on default content | Set by decoration. `[verified]` |
| `id="..."` on headings | Auto-generated. `[verified]` |
| `on*` event handlers | Stripped. `[verified]` |

### Whitespace handling

ProseMirror (DA's editor schema) is strict about whitespace:

- No stray text nodes between `<tr>` and `<td>`.
- No mixed whitespace inside `<table>` elements.
- Consistent `<tbody>` use (either always wrap rows in `<tbody>` or never;
  don't mix). `[verified]` from `da-live` source.

When generating HTML programmatically, emit a clean DOM with no whitespace
between structural elements inside tables.

### Restore-point threshold

A document body under 83 bytes triggers DA's automatic restore-point
capture before overwriting. `[verified]` from `da-admin` source. This is
protective behavior — empty / near-empty writes preserve the previous
content as a recoverable version. Means a "delete content" write is
distinguishable from a "small page" write.

## 11. Upload handoff

The HTML you've generated per §1-§10 is uploaded via the DA Source API.
See [platform.md §2](./platform.md) for the full contract: endpoint, headers,
the `multipart/form-data` requirement, the field name (`data`), the response
envelope, and IMS auth.

The minimal call shape:

```javascript
const blob = new Blob([htmlString], { type: 'text/html' });
const form = new FormData();
form.append('data', blob, 'document.html');

const url = `https://admin.da.live/source/${org}/${repo}/${path}.html`;
const res = await fetch(url, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
```

After upload, the document is staged but not visible at `aem.page`/`aem.live`.
Trigger preview/publish per [platform.md §6](./platform.md):

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "https://admin.hlx.page/preview/{org}/{repo}/{branch}/{path-no-extension}"
```

### Ordering: binaries must exist before preview, not before HTML upload

The fetch that matters for image sideloading happens at **preview** time
(`admin.hlx.page/preview/...`), not at HTML upload time. So the strict
constraint is:

- All `<img src>` / `<source srcset>` URLs the document references must
  be reachable at the moment preview runs. External URLs need to be
  live; `content.da.live/{org}/{repo}/<path>` URLs need their binary
  uploaded to DA.

A safe, simple sequence:

1. Upload referenced binaries via the DA Source API (per
   [media.md](./media.md)), so any `content.da.live/...` references will
   resolve.
2. Upload the HTML document via the DA Source API (§11 above).
3. Trigger preview to sideload all `<img>` URLs (external and DA-hosted)
   into Media Bus.

Upload order between HTML and binaries does not matter functionally —
DA stores bytes verbatim regardless of dependency state. What does
matter is that everything is in place before the preview call. A failed
preview-time fetch produces `<img src="about:error">` in the delivered
HTML (see [media.md §2](./media.md)).

After preview succeeds, optionally trigger publish (see
[platform.md §6](./platform.md)) to make the document available on
`aem.live`. Binaries don't need their own preview/publish — they ride
along on the document's preview.
