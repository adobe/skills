---
name: da-content
description: "Use when writing or fixing the HTML of pages that authors edit in Experience Workspace / DA (da.live), including hand-written sample pages for local testing; when a generated page previews empty, without its metadata, icons, section styles or block, with about:error images, or with a table turned into a block; when uploading pages or media to the DA source API (200 but nothing written, SVG too big); or when you need to see how the pipeline read a page. Not for block JS/CSS (building-blocks), tokens (da-auth) or the aem CLI (aem-cli)."
license: Apache-2.0
metadata:
  version: "1.0.1"
---

# Authored content HTML (Experience Workspace / DA)

The rules for the HTML that Experience Workspace (formerly DA) stores and the
Edge Delivery pipeline turns into a page. They apply whatever the API backend
or hostname, and also to hand-written pages in `./content/` served by
`aem up` (see **aem-cli**). Everything below was checked against a live
preview; wrong markup fails silently, with no error.

## Page structure

```html
<body><header></header><main>
  <div>
    <h1>Title</h1>
    <p>Intro</p>
    <div class="cards"><div><div>cell</div><div>cell</div></div></div>
  </div>
  <div>
    <div class="metadata"><div><div>title</div><div>My page</div></div></div>
  </div>
</main><footer></footer></body>
```

- Body only: no `<html>`, `<head>`, `<script>`, `<style>`, `style=`. The
  pipeline adds head and scripts. `<main>` is required (sections with no
  `<main>` around them preview empty); `<body>`, `<header>` and `<footer>` are
  optional, and text placed in header or footer is dropped.
- **Everything must be inside a section div that is a direct child of
  `<main>`.** Elements placed directly in `<main>` are dropped. A div placed
  there is taken as a section, so a block or metadata div there is not a
  block: its rows become paragraphs. `<hr>` also starts a new section.
- Attributes `id`, `class`, `style`, `data-*` on default content are dropped;
  headings get an `id` from their text. Empty `<p>` is dropped.

## Blocks

- Div form: `<div class="name variant">`, one child div per row, one grandchild
  div per cell. Table form: header row `<td colspan="N">Name (variant, …)</td>`
  then rows. Use letters, digits and single hyphens for names. The pipeline
  turns `Feature_Block` into `feature-block` and `columns (v)` into
  `columns v`; don't rely on it.
- A block inside a block cell is flattened to text. No nested blocks.
- **A plain `<table>` in default content becomes a block named after its
  first cell** and that header row is consumed. Never use a bare table for
  data; make it a block.

## Section Metadata

Inside the section it styles: `<div class="section-metadata">` with rows of
`key` / `value` (`style` = `dark, highlight`). The class is one token, exactly
`section-metadata`. `class="Section Metadata"` makes a different block and the
metadata is silently lost; the table form with header text `Section Metadata`
is fine. Keys are used as typed.

## Page metadata

`<div class="metadata">` inside its own section, conventionally last. Rows:
`title` → `<title>`; `description` → description, og and twitter; `og:title`
also sets `twitter:title`; `image` → og and twitter image (absolute URL);
`tags` → one `article:tag` per comma value; any other key → `<meta name>`
with the key lowercased and spaces turned into hyphens (`my custom` →
`my-custom`). Canonical, og:url and twitter:card are added. Don't author
og/twitter rows yourself.

## Icons

Write `:name:` as text. The pipeline turns any `:[a-z0-9-]+:` into
`<span class="icon icon-name"></span>`, in default content and block cells,
and the project's decoration loads the SVG from `/icons/name.svg`. An authored
empty `<span class="icon icon-name">` sent by direct PUT also previews as an
icon, but a page opened in the DA editor lost the span, so use `:name:` for
anything authors will edit. The whitespace around an icon is removed.

## Images and links

- Use absolute `<img src>` URLs the preview can fetch. They are sideloaded
  and delivered as `<picture>` with webp/jpeg sources at 750 and 2000 px, plus
  width, height and lazy loading. Don't hand-author `<picture>`/`<source>`;
  it is replaced. Repo-relative or document-relative paths
  (`/images/a.png`) become `<img src="about:error">`. Always set `alt`.
- Links to the site's own `aem.page`/`aem.live` URLs become relative; other
  hosts stay. `class` and `target` on `<a>` are dropped, `title` is kept.
  Bold or italic standalone links (`<strong><a>`) are what decoration turns
  into buttons; that is project code, not the pipeline.

## Inline tags (same in default content and cells)

Kept: `strong`, `em`, `del`, `code`, `u`, `sub`, `sup`, `a`. Rewritten: `b`→
`strong`, `i`/`mark`→`em`, `s`→`del`, `kbd`→`code`. Unwrapped (text kept, class
lost): `span`, `ins`. Cells: a lone `<p>` is unwrapped; `<br>` depends on its
position. Style with classes on the block, not on inline tags.

## Uploading

- `PUT https://admin.da.live/source/{org}/{repo}/{path}.html` with
  `Authorization: Bearer <IMS token>` (see **da-auth**) and a **multipart
  form with the file in field `data`**. Any other field name returns 200 and
  writes nothing (the next GET is 404). A missing or bad token returns 401
  with an empty body.
- Preview is a separate step:
  `POST https://admin.hlx.page/preview/{org}/{repo}/main/{path-without-.html}`
  with the same Bearer token, then `/live/` to publish. Uploading alone does
  not change `aem.page`.
- Binaries go through the same PUT (`data=@file;type=image/png`). **`aem
  content push` reports ✓ for PNG/SVG but writes nothing**; upload binaries
  with the PUT. Pages pushed by the CLI do arrive.
- SVG over 40 KB fails preview with 409 `AEM_BACKEND_SVG_TOO_BIG`.
- An absolute external image URL needs no upload. Upload only when you want
  the binary under your control.

## Seeing what the pipeline did

After the preview POST, `GET https://admin.hlx.page/preview/{org}/{repo}/main/{path}.md`
with header `x-auth-token: <IMS token>` returns the markdown the pipeline
built from your HTML: dropped content, lost spans and blocks that didn't
form show up there, even when `aem.page` needs site authentication.

## More

[references/media.md](./references/media.md): where binaries live (`/media`,
dot-folders), which types are delivered, size caps. Carried over from the
previous version, not re-verified except where marked.
