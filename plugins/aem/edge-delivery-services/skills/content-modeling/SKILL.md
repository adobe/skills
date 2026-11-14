---
name: content-modeling
description: "Use this to decide what authors type for an AEM Edge Delivery Services (EDS) block, in any editor (Word, Google Docs, Experience Workspace, Universal Editor): the table layout (rows, cells, columns), variants, per-item options such as featured, lists, tabular data, forms, and whether something should be a block at all. Also use it to review or simplify a block's author-facing structure, before writing block code for a new block or a changed structure. Not for decorate JS or CSS once the model is set."
license: Apache-2.0
metadata:
  version: "3.0.0"
---

# Content Modeling for EDS Blocks

A content model is the structure authors see and manage in Word, Google Docs or Experience Workspace. It is also the markup delivered to browsers before decoration, so it matters under WYSIWYG editing too (Universal Editor, Experience Workspace layout view): search engines and AI crawlers read it. Design it for the author first; `decorate()` absorbs the complexity.

Skip this skill when the block's structure does not change (CSS or code only).

## Steps

1. **Requirements.** Write down what the content is, how often it repeats, and which parts are optional. If the author is not available, decide, and list each assumption in the output.
2. **Default content, widget or block?** Headings, paragraphs, images, lists and links are default content. Never make a `text`, `heading` or `image` block. Forms, search, calculators and similar apps are widgets: authors paste the widget URL alone in a paragraph and author no table. Their editable text (topic lists, messages) lives with the widget, for example in a spreadsheet, so authors can still change it without a developer. A block is for repeating or interactive content that authors fill in. Look for an existing block with the same job first (block-collection-and-party) and reuse its model.
3. **Pick a shape.**
   - One-off (hero, quote): rows or columns as the content needs.
   - Repeating (cards, carousel): one row per item, same columns in every row.
   - Configuration: only for non-displayed settings or API-driven blocks.
   - Auto-blocked: the author writes plain content (a pasted link, sections with Section Metadata, page metadata) and code creates the block.
4. **Check the rules below**, then write the output.

## Rules

- **No nested blocks** (no table in a cell). When content seems to need one, use auto-blocking: code creates a block the author did not write, from default content or metadata. Links and sections are the common triggers, a fragment link is one case, and other patterns are possible. See https://www.aem.live/developer/markup-sections-blocks#auto-blocking for the patterns. A fragment hides content from the author's page and from the page's own HTML, so use it for content shared across many pages, not for content the page needs for search.
- **Structure carries the meaning, not position.** Authors already know headings, bold, italic, links, lists and pictures, so let those say what each part is (a bold link is a primary button, an italic link a secondary one). Keep related parts together in a cell and have code find them by element type (`h2`, `picture`, `a`, `strong`), never by cell index or order. One cell per field breaks when an author skips or reorders a cell, loses the meaning when content is copied between tools, and gives search engines and AI crawlers nothing to read.
- **Accept more than you require.** Make parts optional and let the same content sit in one cell or several (image and text in one cell or two). List the variations in the output so the block code (building-blocks) accepts them.
- **Limit columns.** Aim for 4 or fewer. Many columns usually mean the content is split into small values.
- **Key/value rows only for settings that are not displayed.** Never model a heading, image or text as `label | value`. Section Metadata is key/value too: use it for styles and settings, never for content. A tab title or any label for the content below it is a heading in default content.
- **Tabular data:** small data shown on one page can use the Block Collection `table` block. Large or reused data goes in a spreadsheet (published as JSON) that the block links to.
- **Variants go in the header, in parentheses:** `Cards (dark, wide)`. Do not use a `style | dark` row.
- **Per-item options (featured, highlighted) are not content, so keep them out of the content where you can.** Prefer a default (the first item is featured, plus a variant to turn that off), a variant, or separate blocks that auto-blocking combines. Weigh these options. A marker in the content is acceptable when nothing else works. Never use item index lists (`featured-2`), text suffixes like "(open)", or image alt text.
- **Lists:** complex items are one row each. Simple link lists are links in one cell, and code collects every link. Do not require authors to build bullet lists.
- **Authors enter** fully qualified URLs, and no HTML, CSS or JSON. Write examples as the author sees them.

## Output

Return this to the caller or the user:

```markdown
## Content Model: [Block Name]

**Default content, widget or block:** [why]

| Block Name (variants) |
|---|
| [what the author types in each cell, as the author sees it] |

### How authors use it
[what each row and cell holds; which parts are optional; what the code infers]

### Assumptions
- [decisions made without the author]

### Questions for the author
- [open questions that would change the model]
```

Draw cells as the author sees them. When a cell has several paragraphs, show each paragraph on its own line (for example in a code block under the table). Never use `<br>`, `<p>` or other HTML tags in the examples.

The caller (content-driven-development or the user) decides what happens next: test content, then block code. In AEM-authoring (Universal Editor) projects, ue-component-model maps this model to editor fields.
