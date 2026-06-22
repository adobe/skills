---
name: aa-top-movers-watchlist
description: >
  Identifies which items (pages, campaigns, products, channels, regions) had
  the biggest increases or decreases for a key metric between two time periods.
  Use this skill when someone asks "what's up and what's down," "which campaigns
  moved the most," "top gainers and losers," "what pages are trending," "show
  me what changed by channel," or any variation of identifying the biggest
  movers and decliners for a metric.
license: Apache-2.0
metadata:
  author: Adobe
  version: "1.0"
---

# Top Movers Watchlist (Adobe Analytics)

Identify which dimension items had the biggest increases and decreases for a
key metric between two time periods. Surface the top gainers and losers across
pages, channels, campaigns, products, or any other breakout dimension.

---

## AA MCP Tools Used

- `findReportSuites` — select report suite
- `setSessionDefaults` — set session context (reportSuiteId + globalCompanyId)
- `describeAa(REPORT_SUITE_CONTEXT_GUIDE)` — load calendar/timezone context
- `findMetrics` — resolve the key metric ID
- `findDimensions` — discover available breakdown dimensions
- `runReport` — period A and period B for each dimension
- `searchDimensionItems` — validate specific items if needed

---

## Phase 0 — Setup

1. Confirm report suite with `findReportSuites` / `setSessionDefaults`.
2. Call `describeAa(REPORT_SUITE_CONTEXT_GUIDE)` to load report suite
   context. Record:
   - `WEEK_START_DOW` — first-day-of-week from the context guide. If the
     context guide returns no value, use **Monday** (ISO 8601) as the
     explicit deterministic default. This is not a fallback that drifts
     between runs: every run on the same report suite resolves to the
     same `WEEK_START_DOW`, either from the context guide or from the
     fixed Monday default.
   - `TIMEZONE` — report suite timezone.
   - `WEEK_START_DOW_SOURCE` — `"context guide"` if the value came from
     `describeAa`, `"default"` if the context guide was silent and Monday
     was used. Surface this in the artifact footer so the source is
     auditable.

   You will use these values in Phase 1 when defining Period A and Period B.

```
findReportSuites(globalCompanyId: "<gcid>")
setSessionDefaults(globalCompanyId: "<gcid>", reportSuiteId: "<rsid>")
describeAa(guideType: "REPORT_SUITE_CONTEXT_GUIDE")
```

---

## Phase 1 — Confirm Parameters

Ask the user:

1. **Metric** — "Which metric should I rank movers by? (visits, revenue,
   conversions, page views, etc.)"
   If not specified, default to `metrics/visits`.

2. **Dimension** — "Which dimension should I break down?
   - Pages
   - Marketing Channel
   - Campaigns
   - Products
   - Traffic Sources
   - Geographic Regions
   - Entry Pages"
   If not specified, offer the above list.

3. **Time periods** — "What two periods should I compare?"
   Common defaults:
   - This week vs. last week
   - This month vs. last month
   - Last 7 days vs. prior 7 days
   - Last 30 days vs. prior 30 days

   **Calendar rule (mandatory):** Period A and Period B MUST use the same
   `WEEK_START_DOW` from Phase 0 — both periods' `startDate` fall on the
   same day-of-week, both are exactly equal length, and Period B ends
   immediately before Period A starts. Never mix conventions (e.g., a
   Mon–Sun Period A with a Sun–Sat Period B) within the same run. For
   custom date ranges, compute Period B as the equal-length window ending
   immediately before Period A starts.

   **Sanity check before calling `runReport`:** confirm `periodA.startDate`
   and `periodB.startDate` are the same day-of-week and that
   `periodA.startDate - periodB.endDate == 1 day`. If not, recompute.

4. **Item limit** — how many top gainers and losers to show (default: 10 each).

5. **Materiality threshold** — minimum absolute value in Period A or B to be
   included (filters out noise from low-volume items). Default: exclude items
   with fewer than 100 visits (or equivalent) in both periods.

Confirm: "I'll show the top 10 gainers and losers for [metric] broken down
by [dimension], comparing [Period A] vs [Period B]."

---

## Phase 2 — Resolve Components

```
findMetrics(expansions: "componentType")
findDimensions(page: 1, limit: 100)
```

> **Note:** `findMetrics` requires the `expansions` parameter (use `"componentType"`
> or `"categories"`). `findDimensions` requires `page` and `limit`.


Record `id` for the metric and dimension.

---

## Phase 3 — Run Period Reports

Run the metric for the selected dimension in both periods:

```
runReport(
  metricIds: "<metricId>",
  dimensionId: "<dimensionId>",
  startDate: "<period A start>T00:00",
  endDate: "<period A end>T23:59",
  limit: 200
)

runReport(
  metricIds: "<metricId>",
  dimensionId: "<dimensionId>",
  startDate: "<period B start>T00:00",
  endDate: "<period B end>T23:59",
  limit: 200
)
```

> **Note:** `runReport` uses `metricIds` (not `metricId`) and `startDate`/`endDate`
> in ISO 8601 format (`YYYY-MM-DDTHH:mm`), not a `dateRange` parameter.

Use `limit: 200` to capture enough items for a meaningful mover analysis.

---

## Phase 4 — Compute Deltas and Rank

For each dimension item present in either period:

1. Period A value (or 0 if not in results)
2. Period B value (or 0 if not in results)
3. Absolute delta: Period A - Period B
4. Percent change: delta / Period B × 100 (or "+100% new" if Period B = 0)
5. Apply materiality filter: exclude items where max(Period A, Period B) <
   materiality threshold

Sort by absolute delta descending for gainers (positive delta).
Sort by absolute delta ascending for losers (negative delta).

Take top N from each list.

### Special cases

- **New items** (present in Period A only): flag as "New — no prior period
  data." Include if materiality threshold met.
- **Disappeared items** (present in Period B only, 0 in Period A): flag as
  "Dropped — no current period data."
- **Near-zero items**: items with <1% of total metric value — consider
  excluding from the watchlist unless they show very large percent changes.

---

## Phase 5 — Optional Multi-Dimension Watchlist

If the user wants movers across multiple dimensions (e.g., both pages AND
channels), repeat Phase 3–4 for each additional dimension. Each additional
dimension adds 2 more `runReport` calls.

```
runReport(metricIds: "<metricId>", dimensionId: "variables/marketingchannel",
          startDate: "<A>T00:00", endDate: "<A>T23:59", ...)
runReport(metricIds: "<metricId>", dimensionId: "variables/page",
          startDate: "<A>T00:00", endDate: "<A>T23:59", ...)
```

Group results into separate tables by dimension in the HTML report.

---

## Phase 6 — Generate HTML Report

Build the movers report inline and write to
`/tmp/aa_top_movers_report_<YYYY-MM-DD_HHMMSS>.html`.


### Rendering rules — apply consistently across runs

Two runs of this skill on the same report suite + metric/dimension + period
must render identically (modulo the generation timestamp). The rules below
pin the formatting choices that the AI would otherwise drift on.

#### Number formatting

- **KPI values** (the big number in each summary tile, and per-row mover
  values) — use full digits with thousands separators (`8,160`, `77,584`,
  `1,250,000`). Do **NOT** use SI suffixes like `K` or `M`, even for large
  values. Stakeholders want exact numbers, not abbreviations.
- **Percent change** (in pills and narrative bullets) — always one decimal
  place, rounded **half-away-from-zero**. For example, `−23.55%` displays as
  `−23.6%`, never `−23.5%`. Compute on full-precision values; round only at
  display time.
- **Percentage-point change** (for already-percentage metrics like Conversion
  Rate or Bounce Rate) — same rounding, suffix `pp`. Example: `+0.40 pp`.
- **Currency** — `$` prefix with thousands separators and no decimals for
  values ≥ $100 (`$1,240,000`); cents only when value < $100 (`$45.20`).

#### Null / missing data handling

A KPI tile or mover row must reflect what the report suite actually returned.
The AI must **not** silently substitute a different metric or hide a tile to
make the report look cleaner.

- **Both periods return 0 or NULL** for the tracked metric in a summary tile:
  render the tile with `kpi-value` = `Data unavailable`, pill class `flat`,
  pill text `⚠ N/A`, and `prior` text = `Both periods returned no data —
  validate instrumentation`. The tile stays in the grid; do not omit it.
- **One period returns valid data, the other 0 / NULL**: render the tile with
  the valid value as `kpi-value`, pill class `flat`, pill text `⚠ N/A`, and
  `prior` text = `Prior {period_noun}: no data`.
- **Never** substitute a different metric (e.g., switching from Revenue to
  Orders because Revenue came back $0). The metric being analyzed MUST be the
  metric rendered.


### HTML template

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Top Movers &mdash; {ORG_NAME} &mdash; {METRIC_NAME}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #f5f4f1;
    --surface: #ffffff;
    --ink: #1a1a1a;
    --ink-muted: #6b6b6b;
    --border: #e5e2dc;
    --header-bg: #0e0e10;
    --header-warm: #3a1010;
    --accent-red: #c8312f;
    --accent-red-bright: #ff6b68;
    --accent-red-soft: #fdecea;
    --accent-green: #1f7a4d;
    --accent-yellow: #d4a017;
  }
  body { font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         background: var(--bg); color: var(--ink); line-height: 1.5;
         -webkit-font-smoothing: antialiased; }

  /* === Header === */
  header { background: linear-gradient(120deg, var(--header-bg) 0%, #1a0d0d 55%, var(--header-warm) 100%);
           color: #fff; padding: 56px 56px 44px; position: relative; overflow: hidden; }
  header::after { content: ""; position: absolute; right: -140px; top: -140px;
                  width: 460px; height: 460px;
                  background: radial-gradient(circle, rgba(200,49,47,.35) 0%, transparent 70%);
                  pointer-events: none; }
  .header-inner { max-width: 1080px; margin: 0 auto; position: relative; z-index: 1; }
  .eyebrow { display: inline-flex; align-items: center; gap: 8px;
             padding: 6px 14px; border: 1px solid rgba(255,107,104,.55);
             border-radius: 999px; color: var(--accent-red-bright);
             font-size: 11px; font-weight: 600; letter-spacing: 1.2px;
             text-transform: uppercase; margin-bottom: 24px;
             background: rgba(200,49,47,.10); }
  .eyebrow::before { content: ""; width: 6px; height: 6px;
                     background: var(--accent-red-bright); border-radius: 50%; }
  header h1 { font-family: "Playfair Display", Georgia, serif;
              font-size: 56px; font-weight: 700; letter-spacing: -1.5px;
              line-height: 1.05; margin-bottom: 14px; color: #fff; }
  header .lede { font-size: 16px; max-width: 600px;
                 color: rgba(255,255,255,.80); margin-bottom: 24px;
                 line-height: 1.55; }
  header .meta { display: flex; flex-wrap: wrap; gap: 22px;
                 font-size: 13px; color: rgba(255,255,255,.60); }
  header .meta span { display: inline-flex; align-items: center; gap: 6px; }
  header .meta .icon { opacity: .8; }

  /* === Tabs === */
  nav { background: var(--surface); border-bottom: 1px solid var(--border);
        padding: 0 56px; display: flex; gap: 28px;
        position: sticky; top: 0; z-index: 50; }
  nav a { display: block; padding: 16px 0; font-size: 14px;
          color: var(--ink); text-decoration: none;
          border-bottom: 2px solid transparent;
          transition: border-color .15s ease; }
  nav a:hover { border-bottom-color: var(--accent-red); }

  /* === Container === */
  .container { max-width: 1080px; margin: 0 auto; padding: 36px 56px 60px; }

  /* === Period strip === */
  .period-bar { background: var(--surface); border-radius: 8px;
                padding: 14px 22px; margin-bottom: 28px;
                font-size: 13px; color: var(--ink-muted);
                box-shadow: 0 1px 3px rgba(0,0,0,.04);
                border-left: 3px solid var(--accent-red); }
  .period-bar strong { color: var(--ink); font-weight: 600; }

  /* === Dimension section === */
  .dim-section { margin-top: 32px; }
  .dim-section > h2 { font-family: "Playfair Display", Georgia, serif;
                      font-size: 22px; font-weight: 700; color: var(--ink);
                      margin-bottom: 16px; padding-bottom: 10px;
                      border-bottom: 1px solid var(--border); }

  /* === Gainers / Losers dual panels === */
  .movers-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 22px;
                 margin-bottom: 32px; }
  .movers-panel { background: var(--surface); border-radius: 8px;
                  box-shadow: 0 1px 3px rgba(0,0,0,.05); overflow: hidden; }
  .movers-panel-header { padding: 18px 24px; border-bottom: 1px solid var(--border); }
  .movers-panel-header.gainers { border-top: 3px solid var(--accent-green); }
  .movers-panel-header.losers  { border-top: 3px solid var(--accent-red); }
  .movers-panel-header h2 { font-family: "Playfair Display", Georgia, serif;
                            font-size: 17px; font-weight: 700; }
  .movers-panel-header.gainers h2 { color: var(--accent-green); }
  .movers-panel-header.losers  h2 { color: var(--accent-red); }

  /* === Tables === */
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { background: #faf8f4; padding: 10px 18px;
             text-align: left; font-weight: 600;
             text-transform: uppercase; letter-spacing: .6px;
             font-size: 11px; color: var(--ink-muted);
             border-bottom: 1px solid var(--border); }
  tbody td { padding: 10px 18px; border-bottom: 1px solid #f4f1eb; }
  tbody tr:last-child td { border-bottom: none; }
  .delta-pos { color: var(--accent-green); font-weight: 700; }
  .delta-neg { color: var(--accent-red); font-weight: 700; }

  /* === Rank badges (circular) === */
  .rank-badge { display: inline-flex; align-items: center; justify-content: center;
                width: 24px; height: 24px;
                border-radius: 50%;
                background: var(--accent-red); color: #fff;
                font-size: 11px; font-weight: 700;
                margin-right: 8px; vertical-align: middle; }
  .rank-badge.gain { background: var(--accent-green); }

  .back-top { position: fixed; bottom: 24px; right: 24px; background: var(--accent-red);
              color: #fff; width: 44px; height: 44px; border-radius: 50%; border: none;
              font-size: 20px; cursor: pointer;
              box-shadow: 0 4px 12px rgba(200,49,47,.35); }
  footer { text-align: center; padding: 32px 24px;
           font-size: 12px; color: var(--ink-muted); }
  @media (max-width: 700px) { .movers-grid { grid-template-columns: 1fr; } }

  /* === Print === */
  @media print {
    nav { display: none; position: static; }
    header { padding: 36px 32px 28px; }
    header h1 { font-size: 42px; }
    .back-top { display: none; }
    .movers-grid { page-break-inside: avoid; }
    .movers-panel, .period-bar {
      box-shadow: none; border: 1px solid var(--border);
    }
  }
</style>
</head>
<body>
<header>
  <div class="header-inner">
    <div class="eyebrow">Top Movers Watchlist</div>
    <h1>{ORG_NAME} Top Movers</h1>
    <p class="lede">Biggest gainers and decliners for {METRIC_NAME} between {PERIOD_A} and {PERIOD_B}.</p>
    <div class="meta">
      <span><span class="icon">&#128197;</span> {PERIOD_A} vs {PERIOD_B}</span>
      <span><span class="icon">&#128202;</span> {REPORT_SUITE}</span>
      <span><span class="icon">&#128340;</span> Prepared {GENERATED_DATE}</span>
    </div>
  </div>
</header>
<nav>
  <a href="#summary">Summary</a>
  <!-- one nav link per dimension -->
</nav>
<div class="container">
  <div id="summary" class="period-bar">
    <strong>Metric:</strong> {METRIC_NAME} &nbsp;|&nbsp;
    <strong>Period A:</strong> {PERIOD_A} &nbsp;|&nbsp;
    <strong>Period B:</strong> {PERIOD_B} &nbsp;|&nbsp;
    <strong>Materiality:</strong> &ge;{THRESHOLD} {METRIC_UNIT}
  </div>
  <!-- One .dim-section per dimension -->
  <div id="dim-{DIM_ID}" class="dim-section">
    <h2>{DIMENSION_NAME}</h2>
    <div class="movers-grid">
      <div class="movers-panel">
        <div class="movers-panel-header gainers"><h2>&#9650; Top Gainers</h2></div>
        <table>
          <thead><tr>
            <th>#</th><th>Item</th><th>Period A</th><th>Period B</th>
            <th>Delta</th><th>% Change</th>
          </tr></thead>
          <tbody><!-- gainer rows: use <span class="rank-badge gain">N</span> --></tbody>
        </table>
      </div>
      <div class="movers-panel">
        <div class="movers-panel-header losers"><h2>&#9660; Top Losers</h2></div>
        <table>
          <thead><tr>
            <th>#</th><th>Item</th><th>Period A</th><th>Period B</th>
            <th>Delta</th><th>% Change</th>
          </tr></thead>
          <tbody><!-- loser rows: use <span class="rank-badge">N</span> --></tbody>
        </table>
      </div>
    </div>
  </div>
</div>
<button class="back-top" onclick="window.scrollTo({top:0,behavior:'smooth'})">
  &#8679;
</button>
<footer>Top Movers Watchlist &mdash; {ORG_NAME} &mdash; Generated {GENERATED_DATE}</footer>
</body>
</html>
```

**Section titles — no phase prefix**: Section headings in the HTML report must **not** include
the phase number. Use the plain section name only (e.g., "Top Movers" not "Phase 3 — Top Movers",
"Dimension Breakdown" not "Phase 4 — Dimension Breakdown").

Write to `/tmp/aa_top_movers_report_<YYYY-MM-DD_HHMMSS>.html` and open:

```bash
open /tmp/aa_top_movers_report_<YYYY-MM-DD_HHMMSS>.html
```

---

## Inline Summary (Always Deliver)

Always follow the HTML report with a brief text callout:

```
Top Movers: [Metric] — [Period A] vs [Period B]

GAINERS (by [Dimension])
1. [Item A]  +12,400 visits  (+34%)
2. [Item B]  +8,200 visits   (+21%)
3. [Item C]  +5,100 visits   (+18%)

LOSERS
1. [Item X]  -9,800 visits   (-41%)
2. [Item Y]  -4,200 visits   (-18%)
3. [Item Z]  -2,900 visits   (-12%)

Key takeaway: [1 sentence explanation of the story]
```

---

## Guardrails

- Always apply a materiality threshold to suppress noise from items with
  negligible volume.
- Flag new items (no prior period) and disappeared items (no current period)
  explicitly — they often tell a significant story.
- For percent-change ranking, use absolute delta (not percent) as primary
  sort to avoid surfacing low-volume items with misleading large percentages.
- Cap dimension list at 6 for call efficiency. Offer to run additional
  dimensions on request.

---

## Example Interaction

> "What pages were up and down the most last week?"

1. Confirm report suite.
2. Confirm metric: page views. Dimension: page name. Period: last 7 days vs
   prior 7 days. Limit: top 10 each.
3. Run 2 reports for page × visits.
4. Compute deltas, apply materiality (min 500 page views in either period).
5. Generate HTML report and deliver inline summary.
6. "Top gainer: /products/new-feature with +18,200 page views (+312%).
   Top loser: /promo/expired-campaign with -9,400 page views (-88%)."
