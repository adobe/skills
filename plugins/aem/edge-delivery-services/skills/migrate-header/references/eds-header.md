# The EDS side: serving, the nav document, the header template

## Serving the header locally

The header block fetches its content from the nav document: `/nav.plain.html`, or the path in the
page's `nav` metadata (`<meta name="nav">`). During the work the nav document and its fragments are
local files in `drafts/`, served at the site root by the AEM CLI:

```bash
aem up --html-folder drafts --html-mount / --no-open
```

- `drafts/nav.plain.html` is served at `/nav.plain.html`, `drafts/fragments/<name>.plain.html` at
  `/fragments/<name>.plain.html`. If the site's pages set `nav` metadata (`/en/nav`), write
  `drafts/en/nav.plain.html` instead.
- Every other page still comes from the project's content source, and the code (`blocks/`,
  `styles/`, `scripts/`) from the working tree. So any page of the site shows the new header:
  `<page>` = `http://localhost:3000/<path>`.
- Files are served as written: the CLI does not run the delivery pipeline on them.
  - A section-metadata table stays a table. The template reads it, as it reads the classes and
    `data-*` attributes the pipeline makes of it on the published site.
  - `:icon-name:` is **not** turned into an icon. Write the pipeline's output instead,
    `<span class="icon icon-search"></span>`, with `icons/search.svg` in the project. Authors write
    `:search:` in the document.
- `<baseline>`: the same page before the header work, from the main branch's preview,
  `https://main--<repo>--<owner>.aem.page/<path>`. The text check does not count what it already
  differed by (`--baseline`), so the page's body is not counted as the header's.

The page you test on matters for the full-viewport states (each menu open, the mobile menu,
scrolling):
- Ideally it is the source page migrated, at the same path: then the body is the source's, and a
  difference anywhere is a difference.
- On any other page, the body below the header is not the source's. `--baseline` removes what
  the body already differed by, as long as the header has not moved the page. Read an open
  menu's 2x count as its `in the header and open panel` part.
- The closed header's checks look at the header rows only.

The nav document and fragments in `drafts/` are content: once the header is accepted, they are
authored in the site's content source (in DA, the `da-content` skill), not committed with the
code. Keep `drafts/` and `.migrate-header/` out of the commit (`.gitignore`).

## The template

`assets/header/header.{js,css}`, and `assets/tabs/tabs.{js,css}` for tabbed panels, form a generic
header block with:

- sections by role;
- dropdowns and fragment panels;
- a mobile drawer;
- scroll states;
- keyboard support (focus trap, Escape, arrow keys) and a skip link.

The block imports `decorateIcons` from `scripts/aem.js` and `loadFragment` from
`blocks/fragment/fragment.js` (both in the aem-boilerplate).

Install:

```bash
cp <skill>/assets/header/header.js <skill>/assets/header/header.css blocks/header/
# tabbed panels only:
mkdir -p blocks/tabs && cp <skill>/assets/tabs/tabs.js <skill>/assets/tabs/tabs.css blocks/tabs/
```

- **Breakpoint.** In `header.js`, `const BREAKPOINT = 1024;` becomes the source's desktop
  breakpoint (`open.json` `header.breakpoint.shownAt`, the width where the desktop nav appears,
  to the pixel: `hiddenAt` is one pixel less).
  In `header.css`, replace every `width >= 1024px` with that value and every `width <= 1023px`
  with the value minus one.
- **Keep `header.js` generic.** Tune `header.css`: its custom properties first, then rules. A
  change to `header.js` needs a reason you can name (a behaviour of the source the block does not
  have); list it in your final answer.
- **Custom properties** (in `.header.block`) to fill from the capture before the first check:

  | property | from |
  |---|---|
  | `--header-background` | the bar's background (`<src>/regions/*.styles.txt`) |
  | `--header-max-width`, `--header-section-padding` | the content box of the bar, from its leftmost to its rightmost element |
  | `--header-nav-font-size`, `--header-nav-font-weight`, `--header-nav-link-color` | a top-level nav label's computed style |
  | `--header-nav-gap`, `--header-nav-link-padding` | the space between two labels; the label's padding |
  | `--header-logo-height` | the logo's box |
  | `--header-top-bar-background` | the top bar's background |
  | `--header-dropdown-background`, `-shadow`, `-padding`, `-radius`, `-border` | `open.json` `states[].panel` |
  | `--header-panel-heading-size`, `-weight`, `-lh` | a fragment panel's heading (`<src>/open/<i>.styles.txt`) |
  | `--tabs-*` (`blocks/tabs/tabs.css`, `.tabs.vertical`) | the tab list, the tabs, the link grid, the link titles and descriptions of a tabbed panel |

  `--header-main-nav-height` and `--header-top-bar-height` stay `auto` unless the source gives that
  bar a fixed height (its computed `height` holds at every width): a bar follows its content.
- **`--header-bottom`** is set by the block to the header's actual height. Place what opens
  under the header (the mobile sheet, fixed panels) from `var(--header-bottom)`, not from
  `--nav-height`.
- **`--nav-height`** (`styles/styles.css`) is the page's reservation for the header while it
  loads. Set it to the source's closed header height, mobile first, with the desktop value from
  the breakpoint up, so nothing moves when the header arrives (`header check cls`). Change nothing
  else in `styles/styles.css`. The block's `<header>` then takes its content's height once loaded.

## The nav document

One top-level `<div>` per band of the source's header (a promo or top bar, a utility bar, the
main bar), in their order on the source. Each ends with a section-metadata table:

```html
<div>
  <p>Free shipping on orders over $50 <a href="https://www.example.com/shipping">Details</a></p>
  <div class="section-metadata"><div><div>Style</div><div>top-bar</div></div></div>
</div>
<div>
  <p><a href="https://www.example.com/"><span class="icon icon-logo"></span></a></p>
  <ul>
    <li><a href="https://www.example.com/products">Products</a>
      <ul>
        <li><a href="https://www.example.com/products/a">Product A</a></li>
        <li><a href="https://www.example.com/products/b">Product B</a></li>
      </ul>
    </li>
    <li>Resources
      <ul><li><a href="/fragments/nav-resources">Resources</a></li></ul>
    </li>
  </ul>
  <p><a href="https://www.example.com/contact">Contact us</a></p>
  <div class="section-metadata">
    <div><div>Style</div><div>main-nav</div></div>
    <div><div>Dropdown Trigger</div><div>hover</div></div>
    <div><div>Dropdown Align</div><div>trigger</div></div>
    <div><div>Mobile Style</div><div>accordion</div></div>
    <div><div>Mobile Tools</div><div>drawer</div></div>
    <div><div>Scroll Behavior</div><div>sticky</div></div>
  </div>
</div>
```

- **main-nav**: first a `<p>` with the logo (`img`, `picture`, an `svg` or an icon span, in a link
  when the source links it), then **one** `<ul>` (the navigation), then the tools (search,
  account, a call to action) as paragraphs or a further list.
- **top-bar / utility**: the band's content as default content (text, links, buttons).
- **A menu**: `<li>Label<ul>…</ul></li>`. A label the source gives no link becomes a button: write
  it without `<a>`, never invent a link. Text after the item's list (a note, a "View all" link)
  is shown at the foot of the panel.
- **A fragment panel** (columns, cards, a tabbed panel): the item's list holds one link to
  `/fragments/<name>`, and `drafts/fragments/<name>.plain.html` holds the panel as ordinary
  content and blocks. The block loads it with `loadFragment`, so the blocks in it (`tabs`,
  `columns`, `cards`) are decorated. `references/panel-kinds.md` says which kind to author for
  each menu.
- **Links**: every href comes from the capture (`open.json` `states[].panel.items`, the bands'
  HTML in `<src>/regions/*.html`), absolute as on the source. `node <skill>/scripts/hrefs-check.mjs
  <src> drafts` lists any other.

Section metadata keys (case-insensitive, hyphens and spaces alike):

| key | values | default | effect |
|---|---|---|---|
| `Style` | `brand`, `top-bar`, `utility`, `main-nav` | — | the band's role: `.header-section.header-<style>` |
| `Dropdown Trigger` | `hover`, `click` | `hover` | desktop open: `click` toggles, closes on an outside click or Escape |
| `Dropdown Delay` | ms | `100` | hover intent before opening |
| `Dropdown Align` | `trigger`, `header`, `full`, `center` | `trigger` | the panel's horizontal position |
| `Mobile Style` | `accordion`, `slide-in`, `fullscreen` | `accordion` | what tapping a menu item in the drawer does |
| `Mobile Tools` | `bar`, `drawer`, `hidden` | `drawer` | where the tools sit on mobile |
| `Scroll Behavior` | `static`, `sticky`, `hide-on-scroll` | `sticky` | `hide-on-scroll` adds `.is-hidden` to `<header>` while scrolling down |
| `Scroll Threshold` | px | `50` | the scroll position from which `<header>` gets `.is-scrolled` |

`open.json` gives each menu's trigger (`states[].trigger`) and a first guess at the scroll
behaviour (`header.scroll`, from two jumps). Check the scroll behaviour on the live source (rule 5)
before you trust it.

## Template provenance

The header template comes from migration-lab's `single-page-fast` toolkit (`templates/header/`,
commit `8fe5635`). That toolkit derived it from an earlier `migrate-header` skill and changed it
for the delivery pipeline: metadata as classes, triggers without links, fragment panels, mobile
tools, the breakpoint constant, keyboard support. The tabs template is the Block Collection's
`tabs` (adobe/aem-block-collection, commit `a8ffc6c`, Apache-2.0) with a `vertical` variant for
two-pane menus.
