# Authoring Model

## The Personalization block

One block per placeholder. Two columns: the first cell is a key or a condition, the second its value.
Rows are evaluated top to bottom; **the first matching condition wins**.

| Row | Required | Second cell |
|---|---|---|
| `id` | yes | Unique per page: letters, digits, `-`, `_` (e.g. `home-hero`). Used by overrides, the API and analytics |
| `source` | no | `rules` (default) or `api` (ask the decision engine first, rules are the fallback) |
| `<condition>` | 0..n | A single link (or path) to a fragment under an allowed prefix |
| `default` | yes | A fragment link, inline content, or `none` |

Condition syntax is in `criteria.md`. Example (DA table):

```
| Personalization                                                       |
| id                    | offer                                         |
| geo: IN & visitor: returning | /fragments/personalization/offer/india-back |
| param: utm_campaign=diwali   | /fragments/personalization/offer/diwali     |
| default               | none                                          |
```

Inside a section of the content document (`content/<page>.html`, what DA stores; the delivered
`.plain.html` carries the same markup):

```html
<div class="personalization">
  <div><div>id</div><div>offer</div></div>
  <div><div>geo: IN &amp; visitor: returning</div>
       <div><a href="/fragments/personalization/offer/india-back">/fragments/personalization/offer/india-back</a></div></div>
  <div><div>default</div><div>none</div></div>
</div>
```

## Defaults

- **Fragment link**: renders that fragment. Preferred when the default is a whole block (hero, cards).
- **Inline content**: the cell's own content (text, images, links) renders. Good for short copy.
  A cell holding exactly one link and nothing else is treated as a fragment reference, not inline.
- **`none`**: renders nothing; the placeholder only shows when a condition matches (banners).

The default is what crawlers, timeouts, API failures, invalid placeholders and visitors without
consent (for consent-gated criteria) see. Make it the canonical content.

## Variants and fragments

- Variant fragments live at `/fragments/personalization/<id>/<variant>` (configurable prefix via
  `fragmentPrefixes` in `config.js` and `edge-config.js`; anything outside is rejected).
- The **variant name** is the last path segment (`india-back`). It is what `?pzn=offer:india-back`,
  the API `variant` field and analytics use. It cannot be `default`, and it must be unique within
  the placeholder: two rules may point at the same fragment, but two fragments with the same last
  segment (`/in/hero`, `/us/hero`) are an error. Name them `hero-in`, `hero-us`.
- A fragment is ordinary EDS content: sections and blocks. Its first section's classes (from
  Section Metadata) are applied to the host section, so a hero fragment styles like the original hero.
  On a variant swap only the classes the previous variant added are removed; the host section's own
  classes stay.
- Fragments must be `noindex` (bulk metadata, see `da-content.md`).
- Only same-origin paths are used: an authored or API-provided URL is reduced to its pathname, and
  `..` segments are rejected.

## Rendering

The block itself stays hidden (it only holds rules). The chosen variant's content is inserted right
after it inside the same section, marked `data-pzn-id` / `data-pzn-variant`. The block gets
`data-pzn-id`, `data-pzn-variant`, `data-pzn-source` (`rule`, `api`, `edge`, `default`, `override`,
`bot`, `timeout`, `fallback`, `error`) and `data-pzn-status="applied"`.

## Placement guidelines

- Replace exactly the region being personalized; keep everything else authored on the page.
- One placeholder per region; do not nest placeholders inside fragments of another placeholder.
- Put an above-the-fold placeholder in the first section only if its criteria can be decided fast
  (param, device, override, edge geo). Otherwise consider edge mode (`client-mode.md`).
- Avoid personalizing the H1 or main SEO copy; if the user insists, keep variants semantically
  equivalent (`cross-cutting.md`).

## Migrating an existing region

1. Copy the region's markup (the block or section content) to
   `content/fragments/personalization/<id>/default.html`.
2. Replace the region in the page with the Personalization block pointing `default` at it.
3. Scaffold each variant from a copy of the default fragment: same blocks, images and CTAs, copy
   swapped for `TODO:` unless the user provided it. `assets/content/fragment.html` is only for a
   placeholder whose default is `none` (no structure to copy).
