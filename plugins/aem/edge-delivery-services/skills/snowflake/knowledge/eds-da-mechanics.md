# EDS and DA Mechanics — Verified Facts

Reference doc. What we've actually confirmed about how the platforms
work. Mark every entry as **[verified]** (we've read the code or
observed behavior) or **[assumed]** (we're inferring from documentation).
Promote assumed → verified as experiments confirm them.

## EDS — request to rendered page

### Initial HTML response
**[verified, from `head.html` + docs]** The HTML response for any EDS
page is composed by the pipeline:
1. `head.html` (from the EDS repo) is injected into `<head>`. In this
   project: a CSP meta, viewport, `aem.js`, `scripts.js`, `styles.css`.
2. Body comes from the content source (DA, Google Drive, SharePoint).
   For DA: the document HTML, with sections separated by horizontal
   rules and blocks rendered as `<div class="blockname">…</div>` trees.

### Scripts boot order
**[verified, from `head.html:7-8`]** Both `aem.js` and `scripts.js` load
as ES modules from `<head>`. `aem.js` defines the framework (RUM,
decorate*, loadFragment, etc.); `scripts.js` calls `loadPage()` which
runs `loadEager → loadLazy → loadDelayed`.

### loadEager (scripts/scripts.js)
**[verified]** Runs synchronously on page load. In the boilerplate:
- Sets `html.lang`
- `decorateTemplateAndTheme()` (reads `<meta>` template / theme classes)
- `decorateMain(main)`:
  - `decorateIcons` (replaces `span.icon` with `<img>`)
  - `buildAutoBlocks` (auto-injects hero block, processes fragment
    links — `scripts/scripts.js`)
  - `decorateSections` (`aem.js:457`) — wraps section children, applies
    section metadata as CSS classes, sets `display:none` on each section
  - `decorateBlocks` (`aem.js:585`) — calls `decorateBlock` on every
    `div.section > div > div` to add block-name class, `block` class,
    and dataset metadata
  - `decorateButtons` (links with `<strong>`/`<em>` formatting → button
    classes)
- Adds `appear` class to body → CSS shows body
- `loadSection(firstSection, waitForFirstImage)` — loads the first
  section's blocks and waits for hero image to complete

**Implication for our overlay:** the cleanest hook point is *between*
`decorateTemplateAndTheme` and `decorateMain` — we can take over the
DOM there, before sections are wrapped and hidden.

### loadLazy (scripts/scripts.js)
**[verified]** Loads `<header>` and `<footer>` blocks (which themselves
load `/nav` and `/footer` fragments via `loadFragment`), then loads
remaining sections, then `lazy-styles.css` and fonts.

### Fragment mechanism
**[verified, from `blocks/fragment/fragment.js:21-43`]**
`loadFragment(path)` does:
1. `fetch(\`${path}.plain.html\`)` — note the `.plain.html` suffix
2. Wraps response in a `<main>`, rebases media URLs
3. Runs `decorateMain` and `loadSections` on it
4. Returns the `<main>` element ready to inject

**Implication:** static fragments in the EDS repo, referenced by code
path, work the same way as DA-authored fragments. We just put HTML at
`fragments/header.html` in the repo and request `/fragments/header`.

### Body visibility
**[verified, from `aem.js:473` and CSS]** Each section gets
`display:none` during `decorateSections`. Body has the `appear` class
applied at the end of `loadEager`, which (via CSS) reveals it. Until
then, users see whatever pre-decoration painted — which the
`body { display:none }` rule in `styles.css` typically suppresses
entirely.

**Implication for overlay:** as long as our template+slot merge
completes before `body.appear`, there is **zero user-visible flicker**.

### Where authored blocks live in the raw HTML
**[verified, from EDS markup docs and `decorateBlocks`]** Before
decoration, a block authored as a table named "Hero" renders as:
```html
<main>
  <div>                           <!-- becomes section -->
    <div class="hero">            <!-- block container -->
      <div>                       <!-- row -->
        <div>cell 1 content</div>
        <div>cell 2 content</div>
      </div>
      <div>                       <!-- another row -->
        <div>…</div>
      </div>
    </div>
  </div>
</main>
```
The first class on a `main > div > div` element is treated as the
block name; rows and cells are `<div>` children.

**Implication:** our DA document emits one `<div class="<name>">`
block per semantic block, with `slot-name | content` rows. Reading
slot values is `block.querySelectorAll(':scope > div')` then mapping
cell pairs. See `da-content` §3.2 for the canonical block shape.

## DA — Document Authoring

DA storage model, document skeleton, admin API, IMS auth, image
storage patterns, media formats and limits, and the `aem content`
CLI all live in the `da-content` skill. Load it whenever a
failure involves DA HTML format, the Source API, or media binaries.

The sections in this file that follow (Cross-cutting and below)
document EDS-pipeline behavior specifically relevant to the overlay
engine — they're not DA-side concerns and aren't covered by
`da-content`.

## Cross-cutting

### `.plain.html` suffix
**[verified, from `fragment.js:23`]** Appending `.plain.html` to any
page URL on an EDS site returns the raw HTML body (sections + blocks)
*without* the decoration scripts, `<head>`, etc. This is what
`loadFragment` uses, and it's how we'll fetch templates at runtime
(or directly: HTML files in the repo are served as-is).

### `.hlxignore`
Same syntax as `.gitignore`; matched paths are not delivered by EDS.
Useful for keeping experiment artifacts, scratch directories, or
internal docs off the public site.

### `head.html` size budget
**[assumed, per keeping-it-100 docs]** Aggregate resources before LCP
should stay under 100 KB to keep Lighthouse at 100. Our overlay adds
one template fetch per page load — needs measurement.

### Dev server: `aem up --html-folder drafts` serves verbatim
The local dev server does **not** run the
EDS pipeline on drafts content. Tables stay as tables, `head.html`
is not injected, metadata-block → `<meta>` conversion doesn't
happen. Drafts is for *raw post-pipeline content*, not DA-shape
content. Practical implication: when round-tripping locally, the
DA doc must be pre-transformed to post-pipeline shape.

### `/templates/<name>.html` served as raw HTML by EDS code bus
Putting `templates/home.html` in the repo
makes it fetchable at `/templates/home.html` with no decoration —
the EDS pipeline only decorates *content* (DA / Word / GDrive
backends), not arbitrary code-bus files. A plain `fetch()` returns
the file's bytes verbatim. Same applies to `/fragments/*.html`.

### `header-wrapper` / `footer-wrapper` lifecycle classes
EDS's `loadHeader` / `loadFooter` wrap the
async-loaded fragment content in `<div class="header-wrapper">` /
`<div class="footer-wrapper">`. The original page's header/footer
markup ends up nested inside that wrapper. CSS class selectors keep
working; CSS `body > .gnav` direct-child selectors would NOT.

### `body { display: none } / body.appear { display: block }`
This pair, in `styles/styles.css`, is the
EDS no-flicker contract. The body is hidden until `scripts.js`
adds the `appear` class at the end of `loadEager`. Our overlay
runs inside `loadEager` so the user never sees the
pre-overlay (EDS-shape) DOM.

## Things to verify still

- [x] ~~Exact DA admin source API URL, auth headers, response shape~~
      — answered by team docs (see Admin API section above).
- [x] ~~Confirm Admin API source PUT accepts multipart/form-data~~
      — verified 2026-05-18: HTTP 200 with `-F "data=@file.html;type=text/html"`
      returns JSON with `{source: {editUrl, contentUrl}, aem: {previewUrl, liveUrl}}`.
- [x] ~~Whether DA preserves table-format source on PUT~~
      — verified 2026-05-18: yes, what you PUT is what's GET-able.
      Tables stay tables. The table → div conversion happens
      at pipeline-render time, not in DA's storage.
- [ ] Whether the production `.aem.page` pipeline correctly
      processes our DA doc (Metadata block → `<meta>` tags, etc.).
      Requires preview API call + code-deploy first.
- [ ] Performance impact of an extra fetch in `loadEager` —
      need Lighthouse run against the production preview URL.
- [ ] How `<meta name="template">` round-trips through DA — is the
      meta authored as a metadata block, and does it land in `<head>`
      as expected?
- [ ] Whether stripping authored content from a block table (leaving
      only slot keys with no cells) is a problem for DA's editor.
- [ ] Whether the `<header><p>Title</p></header>` shape in our DA doc
      is correct, or whether the title should live exclusively in the
      Metadata table (team docs example shows empty `<header>`).
