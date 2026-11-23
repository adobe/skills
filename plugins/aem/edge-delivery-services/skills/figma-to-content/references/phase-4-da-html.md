# figma-to-content: phase 4, generate DA body-fragment HTML

The text of this part of `SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

## Phase 4 — Generate DA body-fragment HTML (da-content)

Emit a **body fragment** (not a full HTML document) per **da-content**. **Invoke
da-content and load its `SKILL.md` and `references/` now** — the rules quoted throughout this phase are reminders to jog the
right skill, not the source of truth. Subtle authoring rules (block-cell inline-
tag normalization, media MIME/extension derivation, metadata keys) live in those
docs; authoring from this summary alone is how they get missed. Write one file per
page to `content/<PATH>.html`.

**Mandatory skeleton** (da-content SKILL.md): wrap everything in
`<body>` with an (empty) `<header>`/`<footer>` and a `<main>`; **each section
is exactly one `<div>` directly inside `<main>`** — the `<div>` *is* the
section boundary (no `<hr>`). Do NOT emit `<!DOCTYPE>`, `<html>`, `<head>`,
`<script>`, `<style>`, `style=`, or `class=` on default content.

```html
<body>
  <header></header>
  <main>
    <div>
      <!-- section: default content and/or a block, in visual order -->
      <h1>Heading</h1>
      <p>Intro paragraph.</p>
      <div class="block-name variant">
        <div><div>cell</div><div>cell</div></div>
      </div>
    </div>
    <div>
      <!-- next section -->
    </div>
  </main>
  <footer></footer>
</body>
```

- **Sanitize everything derived from the design — text, attributes, links.**
  Figma text and layer names are untrusted input to the HTML you emit; treat
  them as data, never as markup:
  - **HTML-escape** every design-derived string before it lands in the document
    — `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`, and inside attribute values also
    `"`→`&quot;` and `'`→`&#39;`. A heading `Tips & Tricks <Beta>` must serialize
    as `Tips &amp; Tricks &lt;Beta&gt;`, never as raw markup that can break the
    document or inject an element.
  - **Validate every link's URL scheme** against an allowlist — `http`, `https`,
    `mailto`, `tel`, or a root-relative (`/…`) path. **Reject `javascript:`,
    `data:`, `vbscript:`, and any other scheme** (a prototype link can carry
    anything): drop the href or ask the user — never emit it.
  - **Admit a Figma-derived class token only after block-name validation** — a
    layer/frame name becomes a block or variant class *only* once it passes the
    EDS name rules in Phase 3B (lowercase alphanumeric + single hyphens, no
    underscores/double-dashes, not digit-initial); never pass a raw layer name
    through as a class.
- **Blocks — canonical div form:** `<div class="block-name variant">`, each
  direct child `<div>` a row, each grandchild `<div>` a cell. The first class
  token is the block name (resolves to `blocks/<name>/<name>.{js,css}`).
  Multi-word variants hyphenate; multiple variants are separate class tokens.
  Max 4 cells per row (block-authoring convention); blocks cannot nest. *(da-content)*
- **Default content:** headings/paragraphs/lists/images/buttons live directly
  in the section `<div>`, outside any block. *(da-content SKILL.md)*
- **Icons — two non-interchangeable paths; never a stand-in glyph.** The
  `:<name>:` text convention (the pipeline turns it into
  `<span class="icon icon-<name>"></span>`, see da-content, Icons) resolves **only** to the
  project's Code Bus `/icons/<name>.svg`, so that SVG must be **committed to the
  repo `/icons/` folder and pushed on the deploy branch** (content+code path,
  same as block code) and return `200` on the branch host — uploading it to DA
  `/media` does **not** satisfy the icon (it 404s and the icon silently vanishes).
  A DA-`/media` SVG must instead be referenced by **full URL on an `<img>`**, not
  an icon. Get the real **SVG** in Phase 1; **never emit an emoji or Unicode
  glyph in place of a designed icon.** *(da-content SKILL.md)*
- **Images — MUST be full, fetchable URLs.** Figma render URLs expire, and
  **repo-relative paths (`/img/…`) render as `about:error`.** So: download the
  image bytes from Figma (Phase 1 asset URLs), **upload each binary to DA**
  (`PUT admin.da.live/source/{daOrg}/{daRepo}/<media-path>`), and reference
  `https://content.da.live/{daOrg}/{daRepo}/<media-path>`. External image URLs
  are also accepted (the preview sideloads them). Author a bare `<img alt="…">`
  and let the pipeline build the `<picture>`.
  - **Normalize format, extension, and MIME together — from the bytes, never the
    URL suffix.** Detect the real format from the image's magic bytes (or the
    asset's reported `format`), then make **all three agree**: the multipart
    `type=` MIME, the `<media-path>` file extension you PUT to, and the extension
    in the `content.da.live` URL you author. Design tools routinely export JPEG
    bytes under a `.png`-named asset; trusting the suffix gives you a `.png` path
    served as `image/jpeg` (or the reverse) — a latent corruption bug. A layer
    that *looks* vector (an icon, a logo, a shape) often comes back **rasterized**
    — `download_assets` returns it under `rawImages` with `svgAssets` empty — so a
    design that implies `.svg` can hand you PNG/JPEG bytes. Author each `<img>`
    extension from the bytes you actually downloaded, never from the layer's
    apparent type or name. Canonical
    mapping: JPEG→`.jpg`/`image/jpeg`, PNG→`.png`/`image/png`, WebP→`.webp`/
    `image/webp`, GIF→`.gif`/`image/gif`, SVG→`.svg`/`image/svg+xml`. If bytes
    and asset-reported format disagree, trust the bytes.
  *(da-content SKILL.md + media.md)*
- **Section styling** → a `section-metadata` block **inside** the section
  (`Style` → CSS classes; other rows → `data-*`). *(da-content SKILL.md)*
- **Page metadata** → a single `metadata` block (exact class), placed as the
  **last element of the last section inside `<main>`** (never after `</main>`
  or in `<footer>`); keys like `title`, `description`, `image`, `template`,
  `theme`. **Author it from the design — don't leave it empty or a bare
  comment.** Derive `title` from the frame name or the page `<h1>`, `description`
  from the hero/intro copy (a concise real sentence, never lorem), and `image`
  from the primary/hero image's uploaded DA URL when the design has one. This
  block is **required** — the Phase 5 pre-publish gate blocks on its absence — so
  populate it rather than deferring it. If the design offers no usable
  title/description text, ask the user rather than inventing marketing copy.
  *(da-content SKILL.md)*

Inside block cells the pipeline runs a stricter inline-tag normalization than
for default content — `<span class>` is unwrapped (class lost), `<b>`→`<strong>`,
`<mark>`→`<em>`, etc. Restrict cell content to the da-content SKILL.md preserve
list. A wrong metadata **key** or block **field** silently corrupts output;
when unsure, read da-content.
