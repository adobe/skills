# Test Page Structure (DA document)

A test page in `content/` is a full DA document. Everything inside `<main>` is also what `<path>.plain.html` returns.

```html
<body>
  <header></header>
  <main>
    <div>
      <h1>Page heading</h1>
      <p>Default content.</p>
      <div class="block-name">
        <div>
          <div>Row 1, cell 1</div>
          <div>Row 1, cell 2</div>
        </div>
        <div>
          <div>Row 2, cell 1</div>
          <div>Row 2, cell 2</div>
        </div>
      </div>
    </div>
    <div>
      <div class="block-name variant-name">
        <div>
          <div>...</div>
        </div>
      </div>
      <div class="section-metadata">
        <div>
          <div>Style</div>
          <div>dark</div>
        </div>
      </div>
    </div>
  </main>
  <footer></footer>
</body>
```

- Each `<div>` directly inside `<main>` is a section. A section holds default content, blocks, or both.
- A block is `<div class="block-name">` at the top level of a section: one `<div>` per table row, one `<div>` per cell inside it. The table's header row is not a row here; it becomes the class. Variants (`Block Name (variant)`) are extra classes. A block nested inside another block's cell is never decorated.
- `section-metadata` is a block inside the section it styles, as key/value rows. A section-metadata block in its own `<div>` styles only that otherwise empty section.
- Images: `<picture><img src="..." alt="..."></picture>`; DA images use `https://content.da.live/{org}/{site}/...` URLs.
- In EDS markdown, blocks are grid tables (`+---+` borders) with the block name in the header row, not pipe tables.

For icons, links, page metadata and the full DA HTML rules, see **da-content**.
