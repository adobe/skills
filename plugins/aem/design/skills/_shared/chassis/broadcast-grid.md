---
chassis: broadcast-grid
version: "0.1"
scope: artifact-agnostic (applies to brand boards, prototypes, and other aem-design artifacts)
---

# Broadcast Grid

Terminal / EPG / news-broadcast presentation. Flat dense grid of panes, monospace-led, live-data affordances (ticker, timecodes, LIVE indicators). A reader scans across multiple feeds at once rather than scrolling through one column.

This chassis describes a **presentation pattern** only. It does not name which sections get rendered — that is the data contract's job. A renderer reads the artifact's data contract for section list, then reads this chassis for how to present those sections as panes.

Reference artifact in this repo: `tmp/e2e-3/chassis-mocks/5-broadcast-grid.html` (Ward Orchard broadcast-grid mock).

## Intent

Feels like a Bloomberg Terminal, a railway departures board, or the BBC News overlay during a general election. Data-dense, time-sensitive, multiple feeds on-screen at once. Appropriate when the seed's register is `railway-timetable`, `broadcast-captioning`, `sports-scorecard`, `liturgical-program`, or `pharmacy-insert` — registers whose native form is a schedule / scoreboard / timetable rather than a document.

Also appropriate for brands whose subject matter is inherently time-sensitive, live-updating, or information-dense (event operations, dispatch services, news-adjacent publishers, transit, sports, auction).

## Navigation

Top bar with three parts, 38–44px tall, single line:

- **Left:** channel identifier (`CH 08` or the brand's abbreviation) in inverse background — bold condensed sans, tracked out.
- **Centre-left:** LIVE indicator (pulsing dot) + current-feed label.
- **Middle:** horizontal tab-strip of section names, each ~14px wide padding, vertical rules between. Active tab highlighted with a subtle background tint.
- **Right:** clock / timestamp in monospace, always in a contrasting accent colour.

Below the top bar: a **ticker** — horizontal scrolling band of short data snippets (`<label> <value>`), ~30px tall, continuous animation. The ticker is part of the navigation system, not decoration.

## Hero pattern

Multi-pane grid, NOT a card cluster. The page body is a CSS grid of ≥5 panes with 1px rules between them (no radii, no shadow — the rules ARE the structure).

Recommended grid:
- **Hero pane** — top-left, spans 1.5fr × 2 rows. Contains: pane header + condensed-sans headline (~48–60px) + 1-line sub + chip row with live/status/meta chips.
- **Feed panes** — 2–3 panes top-right. Each shows a compact data table or sparkline with a source label.
- **Wide feed pane** — middle row spanning remaining columns. Timeline or event list with timecodes.
- **Status strip** — bottom row, 4–6 equal cells, each a stat callout (`big number + small label + delta`).

## Eyebrow conventions

Every pane has a header row: **pane title (left) · source label (right)**, split with a 1px bottom rule. Pane title in condensed sans, uppercase, tracked out (~.08em). Source label in monospace, smaller, dim colour — reads as attribution (`SRC · /ops/brand` / `REALTIME` / `Q2 · ESTIMATE`).

No numbered eyebrows. No pill chips for section labels. Each pane's identity is its header row.

## Spacing rhythm

1px inter-pane rules; no radii anywhere. Inside a pane: tight 14–16px padding, 8–12px between internal rows. Vertical rhythm driven by data density, not by editorial breathing room. Tables are the dominant layout primitive; `<th>` rows are hairlines, `<td>` rows are hairlines, no zebra striping.

## Typography register

Monospace-dominant for data and timestamps. Condensed sans (IBM Plex Sans Condensed, Oswald-adjacent) for pane titles and headlines. All numerals are tabular (`font-variant-numeric: tabular-nums`). Italic is rare. Sentence-case rare; most labels are uppercase with tracked letter-spacing.

Surfaces are usually dark (broadcast-graphics tradition), but a light variant is valid when the brand palette demands it — the rule is "flat, no soft surfaces", not "dark by default".

## Demo / visual presentation style

When the data contract asks a section to display demos (motifs, components, items in a collection), render each as a **live-feed pane**: a pane with a header row, a table or a compact list, and a source label. Tables over cards. Status chips (`LIVE`, `OPEN`, `CONFIRMED`, `SCARCE`) where they convey state. Sparklines where a trend would be useful.

Do not render demos as individual cards on a canvas — that is the dashboard chassis. Broadcast-grid puts everything inside a grid cell with shared rules.

## What this chassis is NOT

- Not a dashboard — dashboard is cards-with-radii on a canvas; broadcast is flat panes separated by rules. Different metaphor.
- Not a classic archive — no numbered eyebrows, no text-first masthead, no horizontal editorial grid.
- Not a magazine — no pull quotes, no column text, no drop caps, no department heads.
- Not a SaaS landing page — the point is that the reader is consuming multiple feeds simultaneously, not being walked through a funnel.

## Accessibility note

Broadcast-grid lives at high information density. WCAG AA contrast is non-negotiable at this density — use the brand's darkest accent for meaningful data (green/amber/red state chips) against the ground. Do not drop below 14px on body text; tabular numerals at 13–14px read fine, but non-numeric prose below that becomes hostile.

## Example reference

A Bloomberg Terminal session window. BBC News 24's full-screen election overlay. An airport departures board translated to web. A major-league sports scoreboard page. A European rail operator's real-time timetable.
