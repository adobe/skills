---
name: brand-setup
description: Use when a fresh AEM Edge Delivery Services boilerplate project should take on the brand basics of an existing website being migrated to EDS — colors, body and heading fonts, font sizes, header height, favicon and logo. Triggers include "set up the brand from <site>", "match the source site's look", "apply the client's fonts and colors", "use their favicon and logo". Not for projects whose styles were already customized, and not for full design-system extraction (spacing scales, components, motifs).
license: Apache-2.0
metadata:
  version: "0.1.0"
---

# Brand setup from a source site

Fill the brand slots that the aem-boilerplate already defines with values measured on the
source site, so every later migration step renders in the client's brand. The project you
run in is the target; the source site URL comes from the user.

Measured, not guessed: every value you write comes from what a browser rendered on the source
site. A slot you cannot source keeps its boilerplate value and is listed in the report.

## 1. Check the project is a fresh boilerplate

Stop, with one line saying why, unless all of these hold at the project root:

- Every slot in the two `:root` blocks of `styles/styles.css` still holds its boilerplate
  value. Top block: colors `white`, `#f8f8f8`, `#505050`, `#131313`, `#3b63fb`, `#1d3ecf`;
  `roboto` body and `roboto-condensed` heading stacks; body sizes 22/19/17px; heading sizes
  55/44/34/27/24/22px; `--nav-height: 64px`. Desktop block: body 18/16/14px; heading
  45/36/28/22/20/18px.
- `styles/fonts.css` exists and declares only the `roboto` and `roboto-condensed` faces.

A project that fails this check was already styled; this skill only overwrites defaults.

## 2. Load the source site in a browser

Use a real browser that renders the page and runs its scripts. Reading HTML or CSS files over
plain HTTP is not a substitute: it yields stylesheet source and variable fallbacks, not what
the page shows, and bot-managed sites answer it with a block or maintenance page. If no
browser is available, stop and say so. Start the browser from a directory outside the project.

- **Pages:** the URL given, plus up to two inner pages linked from the main navigation,
  preferring content-heavy ones (an article or an about page, not an index or listing page).
  Home pages alone are skewed by heroes and promotional CTAs.
- **Widths:** read each page at about 1440 px wide (desktop values) and about 375 px wide
  (mobile values). Reload after resizing.
- **Overlays:** look at the page first (screenshot or accessibility snapshot): consent managers
  often render in a shadow root or iframe that a DOM text search misses. Accept or close
  banners and popups, then, on every page read, confirm `document.elementFromPoint` at the
  viewport centre isn't a fixed overlay. Report what you closed, or "no overlay".
- **Blocked:** if the page is a bot challenge, "access denied", maintenance or login page, or a
  consent wall that can't be dismissed, retry with a headed browser if you can. If it stays
  blocked, stop and report it. Never take values from an interstitial page.

## 3. Read the values from the rendered page

Run JavaScript in the page and read browser data, not stylesheet text (stylesheet text is used
only to locate font files, below):

- `getComputedStyle()` on `body`, paragraphs, inline links and `h1`–`h6` inside the main content
  (`main`, else `[role=main]`, else `body` minus the page's header, nav and footer; say which),
  buttons,
  the header/nav bar, footer and section backgrounds. Skip elements that are hidden
  (`display: none`, zero size, clipped, `visibility: hidden`) — many sites ship hidden SEO
  headings.
- Real hover state: hover an inline content link and the primary button (often an `<a>`
  styled as a button), confirm the hover applied (`:hover` matches the element), then read
  the computed colors again. A hover you couldn't perform is unmeasured, not "no change".
- `getComputedStyle(document.documentElement)` custom properties: if the site exposes tokens
  like `--color-primary`, use their names as hints for which color plays which role.
- Loaded fonts: `document.fonts` entries with status `loaded`, and the font file URLs from the
  performance resource entries (`.woff2`, `.woff`, `.ttf`, `.otf`) of the first page in a fresh
  browser session or after a cache-bypassing reload; later pages can be served from cache and
  not list them. For a loaded face still without a file, find its `@font-face` rule: in the
  page if the stylesheet allows it, else fetch that stylesheet's text (its URL is in the
  network list) and resolve `src` against the stylesheet URL. Use the rule only to locate
  files, never to choose fonts, weights or any other value.
- Header bar: the rendered height of the main navigation bar at both widths (at 375 px, the
  bar that holds the logo and the menu button, even if the links are collapsed).
- Favicon and logo: follow [references/lookup-rules.md](references/lookup-rules.md).

Ignore fully transparent colors (`transparent`, alpha 0) — they mean "inherits the parent".

## 4. Map values to the boilerplate slots

Write values exactly as measured (convert `rgb()` to hex). Don't round, darken, derive or
estimate: a value you did not measure keeps its boilerplate value and goes in the report.

| Slot | Source on the rendered page |
| --- | --- |
| `--background-color` | the innermost opaque background on `main` or its ancestors (a full-width wrapper can paint over `body`); `body`/`html` only if none is opaque. Bands inside `main` are for `--light-color` |
| `--text-color` | most common color of paragraphs in the main content |
| `--link-color` | color of inline links inside main-content paragraphs (not nav, footer, buttons) |
| `--link-hover-color` | the same link's color while hovered; if a confirmed hover doesn't change the color, use `--link-color` and say so; if no hover could be performed, keep the boilerplate value and list it as unmeasured |
| `--light-color` | most common light, non-white surface: alternating sections, footer, cards. Boilerplate uses it for light sections, the footer and disabled buttons |
| `--dark-color` | primary button hover background if dark; else a dark section/footer background; else secondary text color. Boilerplate uses it for primary-button hover |
| `--body-font-family` | family of main-content paragraphs (the first family that actually loaded) |
| `--heading-font-family` | family of the visible `h1`/`h2` |
| `--body-font-size-m` / `-s` / `-xs` | paragraph text / smaller supporting text (captions, nav links) / smallest legible text in the body font (legal, fine print), not labels set in the heading font |
| `--heading-font-size-xxl` … `-xs` | `h1` … `h6` |
| `--nav-height` | rendered height of the logo's nearest ancestor that also holds the main links (not an inner links element, utility or promo bars, nor a logo or menu that overflows it); when the logo and main links sit on separate rows, use the total of those rows. Report each row's height |

"Most common" and visible-element counts are taken over all main-content elements of every page
read (at that width for sizes, at both widths for colors), not a sample.

Sizes:

- Mobile values (375 px) go in the top `:root`; desktop values (1440 px) go in the existing
  `@media (width >= 900px) { :root { … } }` block. Keep both blocks and all nine size slots in
  each. If `--nav-height` differs between widths, add the desktop value to the media block too.
- Per heading level, when sizes differ across pages or elements, pick the one with the highest
  `size × weight × number of visible main-content elements`. Headings in the page's header,
  nav, footer and asides don't count (a `<header>` inside the main content does); a level
  found only there is unmeasured.
- No heading level may be larger than the one above it (`xxl` to `xs`; equal is allowed),
  because authors pick levels by meaning. Each measured size stays on its own level. Only if
  measured levels are out of order (an `h3` larger than the `h2`), re-sort the measured sizes
  in descending order over those same measured levels, and report the per-level values.
- A level with no measured size keeps its boilerplate value for that width (mobile and desktop
  differ), unless that breaks this order; then it takes the size of the nearest measured level
  above it, or below it when none is measured above (a missing `h1`). Report it as filled, not
  measured. The same order and fill-in rules apply to the body sizes
  `m`, `s`, `xs`.

## 5. Fonts

Only the families used by body text and headings, and every face of them that `document.fonts`
reports as loaded on the pages you read (italics, bold and one-off weights included). Don't
skip a loaded face as "unused". Declare each face with the weight and style the browser
reports for it; treat a file as a variable font only if the browser reports a weight range for
it. Copy every
file the browser loaded for those faces, not just the Latin one: a face split into subsets
(Latin, Cyrillic, Greek, …) keeps one `@font-face` per file with its `unicode-range`.

- **Self-hosted by the site** (files on its own domain or CDN): download the files the browser
  loaded into `fonts/`. Proprietary families are copied too, for fidelity, with a licensing
  warning (below).
- **Open-licence hosting service** (Google Fonts): download the `woff2` files the browser
  loaded into `fonts/` and self-host them, as the boilerplate does for Roboto.
- **Commercial hosting service** (Adobe Fonts/Typekit, fonts.net, Cloud.typography and the
  like): don't copy. Keep the family name in the stack, give it a fallback face, and report the
  family and service so the project can add a licensed kit later.

Wiring — the boilerplate's loading mechanism stays as is:

- `styles/fonts.css`: replace the Roboto `@font-face` rules with the brand ones in the same
  shape (`font-display: swap`, `src: url('../fonts/<file>') format('woff2')`, or `'truetype'`/
  `'opentype'` for `.ttf`/`.otf` files, which you don't convert; report any file over 100 KB).
  Delete the Roboto files from `fonts/`. Keep `loadFonts()` in `scripts/scripts.js` untouched.
- Proprietary copies (any family not in the Google Fonts catalogue and not stated as
  OFL/Apache/MIT, or when unsure): start `styles/fonts.css` with a comment
  `/* FONT LICENSING REQUIRED BEFORE GOING LIVE: <family> (<foundry if known>) */` per family.
- `styles/styles.css`: replace the two Roboto fallback faces with one per brand family, named
  `<family>-fallback`, `src: local('Arial')` for sans-serif or `local('Times New Roman')` for
  serif, and a `size-adjust` measured in the browser: render the same sample sentence in the
  brand font and in the local font at one size; `size-adjust` = brand width ÷ local width,
  as a percentage.
- Stacks: `--body-font-family: <family>, <family>-fallback, sans-serif;` (or `serif`). One
  family for both roles means one set of faces and one fallback face.
- System fonts: when no family in the measured stack has a loaded face (Arial, Georgia,
  Helvetica …), write the stack as measured, with no download and no fallback face.
- Never add font `<link>`, `<style>` or preload lines to `head.html`.

## 6. Favicon and logo

Per [references/lookup-rules.md](references/lookup-rules.md):

- Chosen icon is ICO (whatever its URL): it replaces the root `favicon.ico`. No `head.html`
  change.
- Chosen icon is SVG or PNG: save it at the root as `favicon.svg`/`favicon.png` and add exactly
  one line to `head.html`: `<link rel="icon" href="/favicon.<ext>">`. This is the only
  `head.html` edit this skill makes. Then, for the root `favicon.ico`: if the source serves
  `/favicon.ico`, that file replaces it; if not, delete it, so the boilerplate icon doesn't leak.
- No icon found: keep the boilerplate `favicon.ico` and report it.
- Logo: `icons/logo.svg` for SVG; a raster logo is saved as `icons/logo.<ext>`. Don't wire it
  into the header — the nav document does that. A raster logo can't be used with the `:logo:`
  icon syntax; say so in the report.

If a file download is refused outside the browser, fetch it from inside the page instead.

## 7. Write only these files

`styles/styles.css` (the two `:root` blocks and the fallback faces), `styles/fonts.css`,
`fonts/*`, root favicon file(s), the one `head.html` favicon line, `icons/logo.<ext>`.
Don't add custom properties, change other rules, edit blocks or scripts. Delete anything your
browser or other tools left in the project (session folders, screenshots, downloads).

## 8. Self-check, then report

Run all six checks on the files you wrote, not from memory. The report lists each one with
pass or fail and the output that shows it; a report missing a check or its output is
incomplete. If you edit a file after the checks, run them all again. Fix any failure before
reporting; a
failure you can't fix needs a stated reason:

- Every non-generic family in the two font stacks is accounted for: a brand family has an
  `@font-face` in `styles/fonts.css` or is listed as commercial-hosted or system in the
  report; a `<family>-fallback` has its `@font-face` in `styles/styles.css`.
- Every `url()` in `styles/fonts.css` points to a file in `fonts/`.
- `head.html` differs from the boilerplate by at most the favicon line.
- Both `:root` blocks still define all nine size slots, and in each no heading or body size is
  larger than the one above it.
- Every value in the report table has a source; anything else is listed as boilerplate or filled.
- `git status --short`, run after the last write and pasted verbatim in the report, shows
  changes only in the files listed in step 7 (plus any file the user asked for, named in the
  report).

Give the report in your final reply. Write it to a file only when the user asks for one.

1. The six self-check results.
2. Table: slot | mobile value | desktop value | source (page, element, property), plus the
   pages read and the main-content definition used.
3. Slots left at boilerplate value or filled, and why.
4. Fonts: family, files copied, licence status, hosted families not copied.
5. Favicon and logo: source URL and file written; overlays closed (or "no overlay").
6. Brand traits with no boilerplate slot, measured but not written: button colors, radius and
   padding; body and heading weight, line height; content max-width; extra accent colors;
   `theme-color`.

This skill doesn't render the result. To review it, serve a page with the aem-cli skill; tell
the user how to stop any server you leave running, and don't hide files with
`.git/info/exclude`.
