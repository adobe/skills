# David's Model: 15 Rules for EDS Content Modeling

These rules govern how content should be structured in Adobe Edge Delivery Services. They are based on Adobe's official content modeling guidance (often attributed to David Nuescheler's design principles). Violations of these rules indicate content that will be harder to maintain, may break in unexpected ways, or will not perform optimally.

---

## Rule 1: Minimize Block Usage

**Prefer default content over blocks.**

Default content — headings, paragraphs, images, links, and lists — renders without any custom CSS or JS. Every block you add introduces a dependency: a CSS file, possibly a JS file, and a name that authors must remember.

**What to check:** Look at the ratio of block content to default content. If more than 40-50% of the page is blocks, the page may be over-engineered. Ask: could this block be replaced with a heading, paragraph, image, or list?

**Common offenders:**
- A "text" block that just renders a paragraph (use default content)
- A "image" block that just renders a single image (use default content)
- A "quote" block when a `<blockquote>` (authored with indentation) would work

---

## Rule 2: No Nested Structures

**Blocks must never contain other blocks.**

A block is a table in the source document. A table cell must never contain another table. This is a hard constraint — nested blocks break the EDS content parser and produce unpredictable HTML.

**What to check:** In the `.plain.html`, look for `<div>` structures that suggest a block inside a block. In the source document, look for tables inside table cells.

**Fix:** Flatten the structure. Use section breaks (`---`) to place blocks sequentially rather than nesting them.

---

## Rule 3: Constrain Table Complexity

**Keep block tables simple — no merged cells, minimal columns.**

EDS block tables map directly to DOM structures. Complex table merges do not translate cleanly and create maintenance nightmares for authors.

**What to check:**
- Tables with merged cells (colspan/rowspan) — these should not exist.
- Tables with more than 3 columns — these are hard to author and usually indicate a design that should be simplified.
- Tables with inconsistent row structures — every row in a block should have the same number of cells.

---

## Rule 4: Fully Qualified URLs

**All URLs in content must be absolute (fully qualified).**

Use `https://www.example.com/about` not `/about` or `about`. Relative URLs work in the browser but break in other contexts: email renderings, RSS feeds, content syndication, and preview environments.

**What to check:** Search for `href` and `src` attributes that start with `/` or lack a protocol. Every URL should start with `https://`.

**Exception:** Fragment references within the same page (`#section-name`) are acceptable.

---

## Rule 5: Lists as Block Rows

**When a block needs a list of items, use multiple rows — not a list inside a single cell.**

Each item should be its own row in the block table. Do not put a bulleted list inside a single table cell and expect the block to parse it as individual items.

**What to check:** Look for block tables where a single cell contains a `<ul>` or `<ol>` with multiple items that the block treats as individual entries. These should be separate rows.

---

## Rule 6: Contextual Button Inheritance

**Buttons inherit their style from context, not from explicit markup.**

In EDS, buttons are created by wrapping a link in `<strong>` (primary button) or `<em>` (secondary button). The visual style comes from the section or block context, not from the author specifying "blue button" or "large button."

**What to check:**
- Links styled as buttons that do not use the `<strong>` or `<em>` pattern.
- Attempts to control button color, size, or style through content rather than CSS.
- Button text that is too long (buttons should be 2-4 words).

---

## Rule 7: Clean URL Filenames

**Page URLs must be clean: lowercase, no special characters, no trailing slashes, no file extensions.**

EDS generates URLs from document filenames. The filename `About Us.docx` becomes `/about-us`. Authors must follow naming conventions.

**What to check:**
- URLs containing uppercase letters, spaces, or special characters.
- URLs ending in `.html` (EDS serves extensionless URLs).
- URLs ending in trailing slashes (except the root `/`).
- URLs with double hyphens or underscores.

---

## Rule 8: Group Content by Teams

**Organize the content repository by the team that owns the content, not by the page structure.**

This is a content architecture rule. Pages should be grouped in folders by ownership (marketing, product, support) not by site hierarchy (header, footer, pages).

**What to check:** This is hard to audit from a single page, but look for signs of poor organization:
- Fragment paths that suggest a deeply nested or chaotic folder structure.
- Shared content (header, footer) not in a clearly designated shared location.

---

## Rule 9: Control Block Sprawl

**Limit the number of unique block types on a site.**

Every custom block is a maintenance cost. A well-designed EDS site uses 10-20 block types total. Sites with 40+ block types likely have redundant blocks that could be consolidated or replaced with default content.

**What to check:** Count the number of distinct block types used on the page. If a single page uses more than 5-6 different block types, it may be over-designed. Flag it for review.

---

## Rule 10: Limit Columns

**Blocks should not exceed 3 columns.**

More than 3 columns creates authoring complexity in Google Docs / SharePoint and does not render well on mobile. If a design requires more than 3 columns, rethink the design or use multiple rows.

**What to check:** Look for block tables with 4 or more columns. Flag them as P2.

---

## Rule 11: Reference Block Collection

**Reuse blocks from the block collection before creating custom ones.**

Adobe and the EDS community maintain a library of standard blocks (columns, cards, hero, tabs, accordion, carousel, etc.). Authors and developers should use these before inventing new ones.

**What to check:** Look for custom blocks that replicate functionality available in standard blocks. A custom "two-column-text" block when the standard "columns" block exists is a P3 finding.

---

## Rule 12: Strategic Fragment Use

**Use fragments for shared, reusable content — not as a general composition tool.**

Fragments (content pulled from another document) are powerful but add complexity. They are appropriate for:
- Header and footer
- Shared CTAs or banners that appear on many pages
- Legal disclaimers or compliance text

They are NOT appropriate for:
- Building every section of a page from fragments (this creates "fragment soup")
- Content that only appears on one page (just put it on the page)

**What to check:** Count the number of fragment references on a page. More than 3-4 fragments per page (excluding header/footer) suggests overuse. Flag as P2.

---

## Rule 13: No Hidden Semantics

**Do not use block names or metadata to encode hidden meaning that changes behavior.**

Block names should describe what the block IS, not what it DOES in a specific context. A block named "promo-holiday-redirect" that silently redirects users is an anti-pattern.

**What to check:** Look for block names that suggest behavioral logic rather than content structure. Look for metadata values that appear to control application behavior rather than describe content.

---

## Rule 14: Name/Value Pairs for Config Only

**Metadata tables with name/value pairs (two-column tables with key-value rows) should only be used for page configuration — not for content.**

The metadata table at the bottom of the document is for page-level settings: title, description, image, template, theme. Do not use this pattern to pass arbitrary data into blocks.

**What to check:** Look for metadata entries that are not standard page metadata. Entries like "carousel-speed: 5" or "banner-color: blue" in the metadata table are misuses — these belong in block-specific configuration (section metadata or block options via class names).

---

## Rule 15: No HTML/CSS/JSON in Documents

**The source document must not contain raw HTML, CSS, or JSON.**

EDS content is authored in Google Docs or SharePoint — tools that are designed for structured text, not code. If an author needs to paste HTML or JSON into a document, the content model is wrong.

**What to check:**
- HTML tags visible in the content (e.g., `<div>`, `<span>`, `<br>`)
- CSS declarations in the content (e.g., `style="color: red"`)
- JSON blobs in table cells
- Script snippets anywhere in the content

This is a P0 violation. The fix is always to redesign the block or content model so the author can express the content using plain text, headings, images, and links.

---

## Quick Reference Table

| # | Rule | Severity if Violated |
|---|------|---------------------|
| 1 | Minimize block usage | P2 |
| 2 | No nested structures | P0 |
| 3 | Constrain table complexity | P1 |
| 4 | Fully qualified URLs | P1 |
| 5 | Lists as block rows | P2 |
| 6 | Contextual button inheritance | P2 |
| 7 | Clean URL filenames | P1 |
| 8 | Group content by teams | P3 |
| 9 | Control block sprawl | P3 |
| 10 | Limit columns | P2 |
| 11 | Reference block collection | P3 |
| 12 | Strategic fragment use | P2 |
| 13 | No hidden semantics | P2 |
| 14 | Name/value pairs for config only | P2 |
| 15 | No HTML/CSS/JSON in documents | P0 |
