# Favicon and logo lookup rules

Read on the rendered source page. Take the first rule that yields a file that downloads with a
non-empty body of the expected type (not an HTML error page).

## Favicon

1. `<link rel="icon">` or `<link rel="shortcut icon">` — when several, the largest `sizes`;
   prefer SVG when one is offered. Resolve the `href` against the page URL.
2. `<link rel="apple-touch-icon">`.
3. `/favicon.svg`, then `/favicon.ico` at the site root.

Also request `/favicon.ico` at the site root even when rule 1 or 2 wins: browsers and crawlers
ask for it without reading any `<link>`.

- Keep the original format. Never rasterize an SVG or convert between formats.
- Never draw or synthesize an icon. Nothing found means: keep the boilerplate icon and report it.
- A 16 px-only icon is still the brand's icon; note its size in the report.

## Logo

Candidates, inside the header, banner or main navigation:

- an inline `<svg>`, or an `<img>` (or `<picture>`), whose own or ancestor link's class, id,
  `alt`, `aria-label` or file name contains "logo" or the brand name; a link to the home page
  wrapping an image or SVG (plus text, if any) is a strong candidate — apply the size limits
  below to that link. When it also holds text, save the icon only and report the wordmark as
  text.

Keep a candidate only if, at 1440 px:

- rendered height ≥ 16 px and width ≥ 40 px (drops small icons that share the brand name);
- its top edge is within 200 px of the top of the page.

Wide wordmarks are normal logos: don't reject a candidate for its width-to-height ratio.

When several remain, rank: inside a link to the home page, then "logo" in its class, id, `alt`
or file name, then the brand name; on a tie, the larger rendered area.

Saving:

- Inline SVG: serialize the element (don't retype it) and make sure it has a `viewBox`.
  Colors set by site CSS or `currentColor` don't travel: write the computed fill/stroke onto
  the shapes, and drop classes and fixed width/height. Inline `<use>` references to a sprite
  so the file stands alone.
- `<img>`: download the URL the browser actually displayed (`currentSrc`), query string intact.
- A logo drawn as a CSS background image: download that URL and say so in the report.
- Nothing found: report it. Never draw or synthesize a logo.
