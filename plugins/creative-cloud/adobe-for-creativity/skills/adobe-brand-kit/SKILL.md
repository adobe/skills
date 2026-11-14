---
name: adobe-brand-kit
description: "Adobe brand tokens, logo rules, typography and voice for anything Claude renders for an Adobe for creativity workflow - pages, home views, dashboards, cards, charts, documents. Load this BEFORE writing any markup or copy for an Adobe skill so every surface looks and sounds like Adobe. Also use on \"Adobe branding\", \"Adobe colours\", \"make it look like Adobe\"."
license: Apache-2.0
metadata:
  version: 1.0.0
  visibility: public
  surface: [claude]
---
<!-- shared-rules:skip -->

# Adobe brand kit

Clean, confident, made for makers: neutral Spectrum surfaces that let the user's own work be the colour on the page, with Adobe red as a single signature mark. These tokens were read from Adobe's public Spectrum design tokens (`github.com/adobe/spectrum-design-data`) and the adobe.com wordmark — use them exactly; do not substitute approximations.

## Palette

| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand-primary` | `#3B63FB` | `#4069FD` | Primary buttons, key figures (light mode) |
| `--brand-surface` | `#FFFFFF` | `#111111` | Page background |
| `--brand-surface-alt` | `#F8F8F8` | `#1B1B1B` | Cards, tiles, table stripes, chips |
| `--brand-dark` | `#131313` | `#222222` | Hero bands, footers |
| `--brand-accent` | `#EB1000` | `#EB1000` | Adobe red — one highlight per view |
| `--brand-ink` | `#292929` | `#DBDBDB` | Body text |
| `--brand-muted` | `#505050` | `#AFAFAF` | Captions, labels, axis labels |
| `--brand-link` | `#3B63FB` | `#5681FF` | Links, informational states, blue text in dark mode |

Status: success `#05834E` / `#099D59`, warning `#C24E00` / `#E06400`, danger `#D73220` / `#FC432E` (light / dark) — always with a text label, never colour alone.

## CSS

Copy `references/tokens.css` into the page's `<style>`. It defines every token on `:root`, redefines them for dark mode, and gives `body` an explicit background.

## Logo

No approved logo asset is bundled. Set **Adobe** as styled text — bold, in `--brand-on-dark` on the hero band or `--brand-ink` elsewhere. Don't redraw the Adobe "A" and don't hotlink any adobe.com logo file.

## Type and shape

- Font stack: `"Adobe Clean", "Source Sans 3", "Source Sans Pro", -apple-system, system-ui, sans-serif` (Adobe Clean where installed; Source Sans 3 is Adobe's open-source fallback). Headings bold, sentence case, slight negative tracking (`-0.01em`) at 24px and above.
- Corner radius 8px. Flat surfaces with 1px `--brand-border` dividers; no shadows, no gradients. Comfortable spacing — 16px inside tiles, 24–32px between sections, at least 16px side gutter at phone width.
- Stat tiles: `--brand-surface-alt` background, a 13px `--brand-muted` label above a 32–36px bold number in `--brand-primary` (light) or `--brand-link` (dark). The one focus tile gets a 4px inset bottom rule in `--brand-accent`.
- Charts: `--brand-primary` leads; `--brand-muted` / `--brand-surface-alt` for comparison; `--brand-accent` for the single highlighted point.

## Voice

Encouraging, plain-spoken, craft-aware. Prefer "Warm Film was skipped — it isn't included in your Adobe plan." over "Preset error: 403 (entitlement)".

Vocabulary: write product names exactly — Adobe Express, Photoshop, Lightroom, Premiere, InDesign, Acrobat, Adobe Fonts, Firefly, Creative Cloud; the connector is "Adobe for creativity". Say "your files", "your plan"; never show tool names, ids, URNs or HTTP codes. Address the user as "you". Sentence case for headings and labels. Dates as "24 Oct" or "Today, 9:30"; no emoji.

## Rules

1. Adobe red appears once per view — the accent rule, the one focus tile, or the wordmark — never as a fill behind text, and never as small text in dark mode (it is under 4.5:1 on dark surfaces).
2. In dark mode, blue text uses `--brand-link`; `--brand-primary` is a fill only. Borders are decorative dividers, never the only edge of a control.
3. Label generated pages "Adobe + Claude"; never present one as an official Adobe product or communication.
