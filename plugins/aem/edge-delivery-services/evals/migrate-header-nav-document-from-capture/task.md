# Writing the nav document from a header capture

## Problem/Feature Description

A developer is rebuilding the header of `https://www.acme-tools.example/` as the header block of
their AEM Edge Delivery Services project, 1:1 with the source. The header template is installed in
`blocks/header/` and `blocks/tabs/`. `aem up --html-folder drafts --html-mount /` serves the
project. The capture, `.migrate-header/source`, holds these facts:

`page.json`: one region, `header`, the whole header (`body > header`), 72 px tall at 1440 px.

`regions/header.html` (the main bar, shortened):

```html
<header>
  <a href="/" class="logo"><svg aria-label="Acme Tools">…</svg></a>
  <nav>
    <ul>
      <li><a href="/products">Products</a></li>
      <li><button>Resources</button></li>
      <li><a href="/pricing">Pricing</a></li>
    </ul>
  </nav>
  <a href="/search" class="search" aria-label="Search"><svg>…</svg></a>
  <a href="/demo" class="cta">Get a demo</a>
</header>
```

`open/open.json` (shortened):

```json
{
  "states": [
    { "label": "Products", "trigger": "hover", "newLinks": 3, "file": "0.png",
      "panel": { "rect": { "x": 380, "y": 72, "w": 240, "h": 150 },
        "items": [
          { "text": "Drills", "href": "https://www.acme-tools.example/products/drills" },
          { "text": "Saws", "href": "https://www.acme-tools.example/products/saws" },
          { "text": "All products", "href": "https://www.acme-tools.example/products" } ] } },
    { "label": "Resources", "trigger": "click", "newLinks": 4, "file": "1.png",
      "panel": { "rect": { "x": 0, "y": 72, "w": 1440, "h": 380 },
        "items": [
          { "text": "Blog", "href": "https://www.acme-tools.example/blog" },
          { "text": "Guides", "href": "https://www.acme-tools.example/guides" },
          { "text": "Webinars", "href": "https://www.acme-tools.example/webinars" },
          { "text": "Help center", "href": "https://help.acme-tools.example/" } ],
        "text": "Learn Blog Guides Watch Webinars Support Help center Contact support" } }
  ],
  "header": { "breakpoint": { "shownAt": 1100, "hiddenAt": 1099 }, "scroll": { "behavior": "sticky" } },
  "mobileMenu": { "toggle": "button.burger", "revealed": 9 }
}
```

The shot `open/1.png` shows the Resources panel as a list of three categories on the left
(Learn, Watch, Support); hovering a category switches the links shown on the right. "Contact
support" in the panel is plain text on the source, with no link. The mobile shots show an
accordion, with the search icon kept in the bar.

## Output Specification

Write the content files the header template needs, as they would be saved under `drafts/`: the
nav document and any fragment, each with its path. After the files, list the section metadata you
chose with one line of reason each. Do not write CSS or JavaScript.
