# Good and bad models

## Standalone block with optional parts

Bad: one row per field, labels, config rows, an empty row for an unused part.

```markdown
| Hero |  |
|---|---|
| Image | ![](bg.jpg) |
| Eyebrow | New |
| Title | Plan your trip |
| Subtitle | |
| Button Text | Shop now |
| Button Link | https://example.com/shop |
| Theme | dark |
```

Good: presentation in the variant, text as one semantic flow, parts left out when unused.

```markdown
| Hero (dark, tall) |  |
|---|---|
| ![](bg.jpg) | New<br># Plan your trip<br>One-line intro.<br>**[Shop now](https://example.com/shop)** _[Learn more](https://example.com/about)_ |
```

Minimal: `| Hero |` with one cell: `# Plan your trip<br>One sentence.<br>**[Shop now](/shop)**`. The paragraph before the heading is the eyebrow; bold link = primary, italic link = secondary. A video background is a link to the video in place of the picture.

## Collection

Bad: header row, one cell per field.

```markdown
| Cards |  |  |  |  |
|---|---|---|---|---|
| Image | Title | Summary | Date | Link |
| ![](a.jpg) | Guide A | Short summary | May 3 | /guides/a |
```

Good: one row per item, picture | content, optional parts omitted.

```markdown
| Cards |  |
|---|---|
| ![](a.jpg) | Guide<br>## Guide A<br>Text with **bold** and [a link](/x).<br>May 3<br>[Read the guide](/guides/a) |
| Article<br>## Article B<br>Summary. |
```

`<br>` stands for separate paragraphs. The second item has no picture, so its row has only the content cell; it has no CTA either. Code: `picture` → image, heading → title, paragraph before the heading → eyebrow, a link alone in its paragraph → CTA. Cells are classified by content, so a row without a picture is not misread.

## Container with inner blocks

Bad: a Cards table inside a Tabs cell (never decorated).

Good: one section per tab, grouped by Section Metadata, inner blocks at the section's top level.

```markdown
## Overview
Intro text.

| Cards |  |
|---|---|
| ![](a.jpg) | ## Item |

| Section Metadata |  |
|---|---|
| Style | tabs |

---

## Details
More text.

| Section Metadata |  |
|---|---|
| Style | tabs |
```

## App-like feature

Bad: a `Search Results` block with `limit | 10`, `index | /query-index.json` rows; a Form block pointing at a spreadsheet.

Good: default content plus a widget link alone in its paragraph.

```markdown
# Find a store

[/widgets/store-locator/store-locator.html?radius=25](/widgets/store-locator/store-locator.html?radius=25)
```

`radius=25` becomes `data-radius="25"` on the widget element.
