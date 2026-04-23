---
chassis: magazine
version: "0.2"
scope: artifact-agnostic (applies to brand boards, prototypes, and other aem-design artifacts)
---

# Magazine

Editorial-spread presentation. Masthead with volume / issue / date line, multi-column body text, pull quotes, drop caps, sidebar rail for metadata.

This chassis describes a **presentation pattern** only. It does not name which sections get rendered — that is the data contract's job. A renderer reads the artifact's data contract for section list, then reads this chassis for how to present those sections.

Reference artifact in this repo: `tmp/e2e-3/aem-design/brand-board-v2-avanguardia.html` (Nonna's Arsenal "Avanguardia 1977" variant).

## Intent

Feels like a printed quarterly. Appropriate when the seed's register is `tabloid`, `memoir`, `auction catalogue`, `travel agency brochure`, `liturgical program`, `museum didactic`, `real-estate listing`, or `supermarket flyer` — registers that traditionally live in magazine and newspaper form.

Also appropriate for brands whose voice is expansive and narrative rather than operational or archival.

## Navigation

Masthead-integrated nav. The top of the page is the magazine's physical masthead: brand-name-or-page-title set very large, volume/issue/date line beneath it in mono, a thin hairline rule, then a single-line nav of section labels styled as magazine section-heads ("CONTENTS · FEATURE · ESSAY · LETTER · BACK MATTER").

No sticky nav — the reader scrolls, and section returns are via Contents at the top or footer.

## Hero pattern

Three-part masthead:

- Kicker line above the main headline (mono, small, all caps: `FEATURE · VOL III, ISSUE 04 · APRIL 2026`)
- Oversized headline with italic accent words (display serif or slab). Italic carries 1–3 accent words per headline.
- Lede paragraph below, set as a long single paragraph with a drop cap on the first letter

A magazine spread does not have a CTA in the hero. Actions live further down or in the colophon.

## Eyebrow conventions

Section labels styled as magazine department heads: `FEATURE`, `ESSAY`, `LETTER`, `CONTENTS`, `COLOPHON`, `OBJECT`. Each label is set in a slab or compressed serif, uppercase, often in a brand accent color. Numbering optional — `I. FEATURE` is acceptable, numerals in roman or arabic as the brand prefers.

## Spacing rhythm

Magazine grid: typically 12 columns, with body text in 2 or 3 columns. Pull quotes breach the columns (take 2 columns width and sit among 3). Margins wide at left and right; gutter between columns narrow. Vertical spacing tight within a section, generous between sections.

## Typography register

Display + italic serif + drop caps lead. Body text is the editorial serif or a humanist sans. Monospace is rare — reserved for the colophon and any technical spec. Italic is load-bearing and appears in pull quotes, accent words, and letter-from signatures.

## Demo / visual presentation style

When the data contract asks a section to display demos (motifs, components, features, stories, etc.), render each as a **magazine panel with its own layout**: a department heading, a visual panel demonstrating the item, body copy describing it and its usage, a caption row. One demo per "page" of the magazine — NOT a grid of fixed-size cards.

## What this chassis is NOT

- Not a broadcast-grid — magazine is slow, multi-column, narrative; broadcast-grid is flat, fast, data-dense
- Not a classic archive — no numbered `§ 01 ·` eyebrows; magazine uses `FEATURE` / `ESSAY`
- Not a dashboard — no cards, no meters, no status chips
- Not a SaaS landing page — no hero-CTA, no feature grid

## Example reference

*Apartamento*. *The Gentlewoman*. *MacGuffin* (structurally — MacGuffin's chassis is magazine even though its subject is archival). A Condé Nast-era *Vanity Fair* letter from the editor. Pirelli calendar editorial afterword.
