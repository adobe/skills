# Phase 2: LLM Structural Reasoning Rules

Apply these transformations to each section's `tokenizedHtml` from Phase 1.
Phase 1 already replaced content with tokens (`{TEXT}`, `{HEADING:n}`,
`{IMAGE:WxH}`, `{CTA:label}`, `{LINK:label}`, `{INPUT:type}`, `{SELECT:N}`,
`{VIDEO}`, `{ICON}`). Phase 2 focuses on **structural simplification**.

## Token Vocabulary

Tokens you'll find in Phase 1 output (keep as-is unless a rule says to change them):

| Token | Meaning |
|-------|---------|
| `{TEXT}` | Paragraph or inline text |
| `{HEADING:n}` | Heading level n (1-6) |
| `{IMAGE:WxH}` | Image with rendered dimensions |
| `{ICON}` | Small image/SVG (< 64px) |
| `{VIDEO}` | Video or video embed |
| `{LINK:label}` | Hyperlink with link text |
| `{CTA:label}` | Call-to-action (styled link/button) |
| `{INPUT:type}` | Form input (text, email, password, etc.) |
| `{SELECT:N}` | Dropdown with N options |

Tokens you produce in Phase 2:

| Token | Meaning |
|-------|---------|
| `{REPEAT:N}` | N more items identical to the pattern above |
| `{FORM:N-fields}` | Entire form collapsed (when > 3 fields) |
| `{NAV:N-items}` | Navigation collapsed (when > 5 links) |

## Rules

### 1. Identify repeated patterns

Find groups of 3+ structurally identical siblings — same tag, same token
pattern inside, same nesting depth. "Structurally identical" means the
token sequence matches (e.g., `{IMAGE:WxH} {HEADING:3} {TEXT} {LINK:*}`
in the same wrapper structure). Keep 2 representative items, then add
`{REPEAT:N}` where N is the remaining count.

Example — 6 identical card divs become:
```html
<div class="card">
  {IMAGE:400x300}
  <h3>{HEADING:3}</h3>
  <p>{TEXT}</p>
  <a>{LINK:Read more}</a>
</div>
<div class="card">
  {IMAGE:400x300}
  <h3>{HEADING:3}</h3>
  <p>{TEXT}</p>
  <a>{LINK:Read more}</a>
</div>
{REPEAT:4}
```

### 2. Collapse decorative wrappers

Remove `<div>` elements that have exactly one child, no class attribute,
and no semantic role. Promote the child up to the parent level.

Before:
```html
<div><div class="hero-content"><h1>{HEADING:1}</h1></div></div>
```

After:
```html
<div class="hero-content"><h1>{HEADING:1}</h1></div>
```

### 3. Preserve layout-significant containers

Keep containers that have multiple children at the same level, or whose
class names suggest layout purpose (`grid`, `row`, `columns`, `container`,
`wrapper` with siblings).

### 4. Strip utility CSS classes

Remove classes matching these patterns:
- Spacing: `mt-*`, `mb-*`, `ml-*`, `mr-*`, `mx-*`, `my-*`, `pt-*`, `pb-*`, `p-*`, `m-*`
- Grid columns: `col-*`
- Display: `d-*`, `flex`, `block`, `inline`
- Color: `bg-*`, `text-*` when followed by a color name
- Animation: `fade-*`, `slide-*`, `inview-*`, `js-*`, `is-*`

Keep all semantic classes (`hero`, `card`, `carousel-slide`, `nav-item`,
`footer`, `testimonial`, etc.).

### 5. Strip tracking data attributes

Remove attributes starting with:
`data-analytics`, `data-tracking`, `data-gtm`, `data-testid`, `data-test-`, `data-cy`

Keep behavioral attributes: `data-block-name`, `data-slide-index`, `data-tab`, `data-active`, `role`, `aria-*`

### 6. Collapse complex forms

If a `<form>` contains more than 3 `{INPUT:*}` or `{SELECT:*}` tokens,
replace all form contents with `{FORM:N-fields}` where N is the total
count. Keep the `<form>` tag with its `action` and `method` attributes.

### 7. Collapse complex navigation

If a `<nav>` or navigation-like list has more than 5 `{LINK:*}` or
`{CTA:*}` items, keep 2 representative items and replace the rest with
`{NAV:N-items}`.

### 8. Preserve table structure

Show `<thead>` rows fully. Show 2 `<tbody>` rows. If more exist, add
`{REPEAT:N}` after the second row.

### 9. Strip cookie consent / overlay panels

Cookie consent panels, GDPR modals, and similar overlays should be collapsed
to a single line: `<div id="cookie-panel">{FORM:N-fields}</div>` or removed
entirely. These are not part of the page structure.

### 10. Re-type sections

Phase 1 section types come from the detector and may be `unknown`. Based
on the HTML structure and class names, assign a more accurate type in the
manifest. Common re-typings:

| Phase 1 type | Evidence | Phase 2 type |
|-------------|----------|-------------|
| unknown | `class="nav"`, `<nav>`, mega-menu structure | navbar |
| unknown | `class="tabs"`, `role="tabpanel"` | tabs |
| unknown | `class="testimonial"`, hidden panels | tabs |
| default-content | FAQ accordion pattern | faq |
| default-content | numbered steps | editorial-index |
| columns | `class="footer"`, `<footer>` | footer-nav |
| carousel | tab-pane structure | tabs |

## Output Format

### skeleton.html

Concatenate all sections with comment separators:
```html
<!-- section:INDEX type:TYPE xpath:XPATH -->
TOKENIZED_HTML
```

Pretty-print with 2-space indentation.

### manifest.json

```json
{
  "url": "...",
  "title": "...",
  "generatedAt": "ISO-8601 timestamp",
  "templateHash": "...",
  "sections": [
    {
      "index": 0,
      "type": "hero",
      "xpath": "...",
      "layout": { "cols": 2, "rows": 1 },
      "features": ["hasHeading", "hasBackgroundImage"],
      "tokens": {
        "headings": 1,
        "texts": 2,
        "images": 1,
        "icons": 0,
        "videos": 0,
        "ctas": 1,
        "links": 0,
        "inputs": 0,
        "forms": 0,
        "repeatedPatterns": []
      },
      "styledSection": null
    }
  ]
}
```

Count tokens by scanning the final skeleton HTML for each section using
these patterns: `{HEADING:\d}`, `{TEXT}`, `{IMAGE:\d+x\d+}`, `{ICON}`,
`{VIDEO}`, `{CTA:[^}]+}`, `{LINK:[^}]+}`, `{INPUT:[^}]+}`, `{SELECT:\d+}`,
`{FORM:\d+-fields}`, `{REPEAT:\d+}`.
