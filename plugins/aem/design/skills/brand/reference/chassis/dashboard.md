---
chassis: dashboard
version: "0.1"
---

# Dashboard

Operations-console presentation. Fixed left sidebar navigation, sections rendered as cards on a grid with live-data affordances (meters, gauges, progress rings, status chips).

## Intent

Feels like the admin panel of a considered product rather than a brand document. Appropriate for brands whose product is itself operational — tools, instruments, SaaS, dashboards, operations-adjacent services. Also appropriate when the seed's register is `railway-timetable`, `broadcast-captioning`, `sports-scorecard`, `repair-manual`, or `hospital-discharge` — registers that normally live in status-and-spec UI.

Reference artifact in this repo: `tmp/e2e-3/aem-design/brand-board-v1-console.html` (Nonna's Arsenal "Operations Console" variant).

## Navigation

Fixed left sidebar, ~200px wide. Section links rendered as stacked labels or pills, one per row. Brand mark at the top of the sidebar; a compact metadata block at the bottom (batch · edition · last-updated). The sidebar is a persistent presence, not a slide-out drawer.

Page content area occupies the remainder of the viewport, with generous padding.

## Section order

Functional groups rather than editorial rhythm:

1. Masthead (compact — brand mark + tagline + live-feel stat row)
2. Palette (rendered as swatch pills with role chips)
3. Typography (specimen cards with size/weight sliders if interactive, else static)
4. Voice (rendered as a chat/messaging UI, speaker = brand persona, listener = customer)
5. Motifs (rendered as widget instances — dials, gauges, badge stacks, progress rings)
6. Components (buttons, inputs, cards shown in their default + pressed states)
7. Photography direction (rendered as image-slot placeholders with direction notes)
8. Personas (rendered as profile cards with stat rows)
9. Logo variants (rendered as app-icon tiles on a rounded-rect grid)

## Hero shape

Card-cluster rather than masthead. Three-to-four cards arranged in a grid:

- Primary: brand mark + tagline + primary CTA
- Secondary: live-feel stat card (counters, progress rings, current-period totals)
- Tertiary: rank/status card or commanding-officer identity card
- Quaternary: call-to-action or key announcement

All cards share a single card language — consistent radius (brand-derived), consistent padding, consistent shadow language.

## Eyebrow / label conventions

Pill labels, not numbered eyebrows. Each section opens with a small pill chip: `OPS · PALETTE` / `OPS · TYPOGRAPHY`. Chip is mono, all caps, rounded pill shape, subtle background tone.

## Spacing rhythm

Tight card padding within cards (24px inset typical), generous grid gaps between cards (24–32px). Vertical sections separated by ~64px, less than the classic-archive's 96px — the density is the point.

## Typography register

Body and data lead. Display type is smaller than in classic-archive (mastheads typically 36–54px rather than 72–140px). Monospace is load-bearing for stat values, metadata, and timestamps. Italic is rare. Sentence-case rather than all-caps for most labels.

## Motif placement

Widget demos rather than image cards. Each motif is rendered as an actual functional-feeling instance: a dial with a needle, a gauge with a fill, a progress ring with a percentage, a badge stack. Place each widget in a card matching the other dashboard cards.

## What this chassis is NOT

- Not a classic archive — no numbered eyebrows, no masthead-first layout
- Not a magazine — no pull quotes, no column text, no editorial drop-caps
- Not a pinboard — no rotation, no overlap, no scattered elements
- Not an analytics tool mimicry — the widgets are motif demonstrations, not real telemetry

## Example reference

The admin panel of Linear. The Bloomberg Terminal homepage (minus the density). A smart-home app's overview screen. A considered fitness app's weekly summary.
