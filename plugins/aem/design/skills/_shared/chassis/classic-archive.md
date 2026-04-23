---
chassis: classic-archive
version: "0.2"
scope: artifact-agnostic (applies to brand boards, prototypes, and other aem-design artifacts)
---

# Classic Archive

Editorial-archival presentation — numbered sections, sticky top nav, text-first masthead, rigorous horizontal grid.

This chassis describes a **presentation pattern** only. It does not name which sections get rendered — that is the data contract's job (`brand/reference/brand-board-template.md` for brand boards, `prototype/reference/design-guide.md` for prototypes). A renderer reads the artifact's data contract for section list, then reads this chassis for how to present those sections.

## Intent

Feels like a design document from an archive — an artifact that could sit on a shelf between Pentagram annual reports and *The Gentlewoman* issues. Commits to seriousness without being cold.

Appropriate for brands whose subject matter is itself archival, editorial, institutional, or durable (publishers, law firms, museums, artisan goods, fine-press printers, long-run manufacturers).

## Navigation

Sticky top bar. Horizontal link list, one line. Brand name on the left, section links center-right, a metadata stamp on the far right ("VOL 01 · DATE" or equivalent). Nav background matches the page body; a 1px ink hairline separates nav from content.

## Hero pattern

Text-first masthead, no hero image. Three-part structure:

- Large brand-name-or-page-title, serif or slab display register.
- One-line descriptor immediately below, smaller, in the editorial register.
- Metadata stamp below the descriptor in mono: location · year · batch / edition / section number.

The masthead is text-only, the way a book's title page is. If a hero image belongs on the page per the data contract, it sits below the masthead as a separate block.

## Eyebrow conventions

Numbered eyebrows: `§ 01 · <section label>`, `§ 02 · <section label>`. The section number is the eyebrow; the section title is a standard-size heading immediately below. Eyebrow font is mono, all caps, tracked out, small (11–12px).

## Spacing rhythm

Airy and rigid. Sections separated by generous vertical rule (96px+). Horizontal gutters consistent. No overlap, no negative margins. Every element aligns to a column grid.

## Typography register

Balanced display + body. Display carries mastheads and section titles; body carries argument and description text. Monospace appears only in eyebrows, metadata, and spec tables. Italic serif used sparingly on single accent words within body copy.

## Demo / visual presentation style

When the data contract asks a section to display demos (motifs, components, variants, feature callouts, etc.), present them as **inline demo tiles in a horizontal card grid**. Each demo gets a fixed-size box (~240×180px typical), the demo rendered inside, name + description below. 3–4 columns wide.

## What this chassis is NOT

- Not a dashboard — no meters, gauges, status chips, or progress indicators
- Not a magazine — no pull quotes, column text, or issue numbering
- Not a pinboard — no rotation, overlap, or absolute positioning
- Not a SaaS landing page — no oversized sans-serif hero, no two-CTA row

## Example reference

A Pentagram annual report. A volume of *MacGuffin*. A Rizzoli monograph's appendix. A well-typeset committee report.
