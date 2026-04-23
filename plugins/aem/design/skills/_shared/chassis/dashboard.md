---
chassis: dashboard
version: "0.2"
scope: artifact-agnostic (applies to brand boards, prototypes, and other aem-design artifacts)
---

# Dashboard

Operations-console presentation. Fixed left sidebar navigation, sections rendered as cards on a grid with live-data affordances (meters, gauges, progress rings, status chips).

This chassis describes a **presentation pattern** only. It does not name which sections get rendered — that is the data contract's job. A renderer reads the artifact's data contract for section list, then reads this chassis for how to present those sections.

Reference artifact in this repo: `tmp/e2e-3/aem-design/brand-board-v1-console.html` (Nonna's Arsenal "Operations Console" variant).

## Intent

Feels like the admin panel of a considered product rather than a brand document. Appropriate for brands whose product is itself operational — tools, instruments, SaaS, dashboards, operations-adjacent services.

Also appropriate when the seed's register is `railway-timetable`, `broadcast-captioning`, `sports-scorecard`, `repair-manual`, `hospital-discharge`, or `pharmacy-insert` — registers that normally live in status-and-spec UI.

## Navigation

Fixed left sidebar, ~200px wide. Section links rendered as stacked labels or pills, one per row. Brand mark at the top of the sidebar; a compact metadata block at the bottom (batch · edition · last-updated). The sidebar is a persistent presence, not a slide-out drawer.

Page content area occupies the remainder of the viewport, with generous padding.

## Hero pattern

Card-cluster rather than masthead. Three-to-four cards arranged in a grid:

- Primary card: brand mark / page title + tagline-or-descriptor + primary action
- Secondary card: live-feel status row (counters, progress rings, current-period totals, or a stat a reader would want at a glance)
- Tertiary card: identity or rank affordance (commanding officer, team, status level, role)
- Quaternary card (optional): call-to-action or key announcement

All cards share a single card language — consistent radius (brand-derived), consistent padding, consistent shadow language.

## Eyebrow conventions

Pill labels, not numbered eyebrows. Each section opens with a small pill chip: `OPS · <section label>` or `<page-scope> · <section label>`. Chip is mono, all caps, rounded pill shape, subtle background tone.

## Spacing rhythm

Tight card padding within cards (24px inset typical), generous grid gaps between cards (24–32px). Vertical sections separated by ~64px, less than the classic-archive's 96px — the density is the point.

## Typography register

Body and data lead. Display type is smaller than in classic-archive (mastheads typically 36–54px rather than 72–140px). Monospace is load-bearing for stat values, metadata, and timestamps. Italic is rare. Sentence-case rather than all-caps for most labels.

## Demo / visual presentation style

When the data contract asks a section to display demos (motifs, components, product features, etc.), render each as an **actual functional-feeling widget instance** — a dial with a needle, a gauge with a fill, a progress ring with a percentage, a badge stack, a status chip row. Place each widget in a card matching the other dashboard cards.

Do not render demos as static illustrations — this chassis's point is that every card looks like it could do something.

## What this chassis is NOT

- Not a broadcast-grid — dashboard cards have radii, padding, and shadow; broadcast-grid panes are flat cells separated by 1px rules. Different metaphor, different density.
- Not a classic archive — no numbered eyebrows, no masthead-first layout
- Not a magazine — no pull quotes, no column text, no editorial drop-caps
- Not an analytics tool mimicry — the widgets are demonstrations of brand style, not real telemetry

## Example reference

The admin panel of Linear. The Bloomberg Terminal homepage (minus the density). A smart-home app's overview screen. A considered fitness app's weekly summary.
