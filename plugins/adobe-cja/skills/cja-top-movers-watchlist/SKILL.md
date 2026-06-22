---
name: cja-top-movers-watchlist
description: >
  Identifies which items (pages, campaigns, products, channels, regions) had the
  biggest increases or decreases for a key metric between two time periods. Use
  this skill when someone asks "what's up and what's down," "which campaigns
  moved the most," "top gainers and losers," "what pages are trending," "show me
  what changed by channel," or any variation of identifying the biggest movers
  and decliners for a metric.
license: Apache-2.0
metadata:
  author: Adobe
  version: "1.0"
---

# Top Movers Watchlist (Customer Journey Analytics)

Surface the biggest gainers and decliners for a metric across any dimension in
two time periods. The output tells the user exactly what moved, by how much, and
whether items appeared or disappeared entirely — which is often the most
interesting signal.

This skill is a faster, more targeted alternative to a full anomaly triage.
Use it when the user wants to scan the landscape of changes rather than drill
into a single anomaly.

---

## CJA MCP Tools Used

- `describeCja(DATAVIEW_CONTEXT_GUIDE)` — load data view calendar/timezone
- `findMetrics` — resolve the metric being watched
- `findCalculatedMetrics` — if the metric is a custom KPI
- `findDimensions` — resolve the dimension to break down by
- `runReport` — pull dimension-metric data for both periods
- `searchDimensionItems` — validate dimension values if user specifies names

---

## Phase 0 — Setup

1. Call `findDataViews` and `setDefaultSessionDataViewId` as needed.
2. Call `describeCja("DATAVIEW_CONTEXT_GUIDE")` to load data view context.
   Record the first-day-of-week as `WEEK_START_DOW` and timezone as
   `TIMEZONE`. If the context guide does not return a week-start value,
   default to **Monday** (ISO 8601). You will use both in Phase 1.3.

---

## Phase 1 — Clarify Inputs

### 1.1 Metric

If the user specified a metric, resolve it:
```
findMetrics(search: "<user's metric name>")
```

If not specified, suggest the top 3 metrics from usage:
> "Which metric would you like to track? I can suggest: Sessions, Revenue,
> Orders based on what your team uses most."

### 1.2 Dimension (what to break down by)

Common dimension choices and their typical use cases:

| Dimension          | Use Case                                |
|--------------------|-----------------------------------------|
| Marketing Channel  | "Which channels moved?"                 |
| Page Name          | "Which pages are trending?"             |
| Campaign           | "Which campaigns improved?"             |
| Product            | "Which products gained/lost traction?"  |
| Country / Region   | "Which markets moved?"                  |
| Device Type        | "Did mobile or desktop shift?"          |
| Referring Domain   | "Which referrers changed?"              |

If the user did not specify, ask:
> "Which dimension should I break down by — for example, marketing channel,
> page, campaign, country, or product?"

Call `findDimensions(search: "<dimension keyword>")` to resolve the dimension ID.

### 1.3 Periods

Define Period A (current) and Period B (comparison). Defaults:
- **Period A**: this week (or last 7 days)
- **Period B**: last week (or the 7 days before that)

If the user specifies "this month vs last month" or a custom range, map
accordingly. Always confirm the periods before running reports:
> "I'll compare **this week (Mar 13–19)** vs **last week (Mar 6–12)**. Sound right?"

**Calendar rule (mandatory):**

Use `WEEK_START_DOW` from Phase 0 to define what "week" means. Period A and
Period B MUST use the same first-day-of-week — i.e., both periods'
`startDate` fall on the same day-of-week, both are exactly equal length,
and Period B ends immediately before Period A starts. Never mix conventions
(e.g., a Mon–Sun Period A with a Sun–Sat Period B) within the same run.
Pick the boundary once, then derive both periods from it. For custom date
ranges, compute Period B as the equal-length window ending immediately
before Period A starts.

**Sanity check before calling `runReport`:** confirm `periodA.startDate`
and `periodB.startDate` are the same day-of-week and that
`periodA.startDate - periodB.endDate == 1 day`. If not, recompute.

---

## Phase 2 — Pull Data for Both Periods

Run two reports — one per period — with the same dimension breakdown:

```
runReport(
  dimensionIds: "<dimension id>",
  metricIds: "<metric id>",
  startDate: "<period A start>T00:00:00",
  endDate: "<period A end>T23:59:59",
  page: 0,
  limit: 50
)
```

```
runReport(
  dimensionIds: "<dimension id>",
  metricIds: "<metric id>",
  startDate: "<period B start>T00:00:00",
  endDate: "<period B end>T23:59:59",
  page: 0,
  limit: 50
)
```

Use `limit: 50` to capture enough items to surface meaningful movers.
If the user's dimension has thousands of values (e.g., page names), limit to
top 100 by Period A volume to keep the comparison meaningful.

Row data is in the `rows` array — each row has `value` (dimension item name)
and `data[0]` (the metric value). There is no limit on dimension cardinality
but results default to sorted by metric descending, which is what you want.

Always verify the dimension ID with `findDimensions(searchQuery: "<name>")` 
before running — dimension IDs can vary from what you might guess 
(e.g., `variables/marketing_channel` not `variables/marketingchannel`).

---

## Phase 3 — Compute Rankings

Build a unified table joining both result sets on dimension value:

For each dimension value present in either period:
- `valueA` = metric value in Period A (0 if not present)
- `valueB` = metric value in Period B (0 if not present)
- `delta` = valueA − valueB
- `pctChange` = (delta / valueB) × 100 if valueB > 0, else "New Entry"
- `status`:
  - Present in A but not B → **New Entry** (appeared this period)
  - Present in B but not A → **Disappeared** (dropped out this period)
  - Both present → normal mover

Sort by:
1. **Top Gainers**: sort by delta descending (biggest absolute gains first)
2. **Top Decliners**: sort by delta ascending (biggest absolute drops first)
3. **% Gainers**: sort by pctChange descending
4. **% Decliners**: sort by pctChange ascending

Limit each list to **Top 10**. New Entries and Disappeared items get their
own sections regardless of count (they are always interesting signals).

---

## Phase 4 — Generate HTML Report

Generate the movers report inline and write to
`/tmp/cja_top_movers_report_<YYYY-MM-DD_HHMMSS>.html`.


### Rendering rules — apply consistently across runs

Two runs of this skill on the same data view + metric/dimension + period must
render identically (modulo the generation timestamp). The rules below pin the
formatting choices that the AI would otherwise drift on.

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

A KPI tile or mover row must reflect what the data view actually returned.
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


### HTML Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Top Movers &mdash; {ORG_NAME} &mdash; {METRIC_NAME} by {DIMENSION_NAME}</title>
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
  header .lede { font-size: 16px; max-width: 560px;
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

  /* === Section label === */
  .section-label { font-size: 11px; font-weight: 700;
                   text-transform: uppercase; letter-spacing: 1.4px;
                   color: var(--ink-muted); margin-bottom: 14px;
                   padding-bottom: 10px; border-bottom: 1px solid var(--border); }

  /* === KPI grid === */
  .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
             gap: 14px; margin-bottom: 36px; }
  .kpi-tile { background: var(--surface); border-radius: 8px;
              padding: 22px 22px 20px;
              border-top: 3px solid #b9b6ae;
              box-shadow: 0 1px 3px rgba(0,0,0,.05); }
  .kpi-tile.down { border-top-color: var(--accent-red); }
  .kpi-tile.up   { border-top-color: var(--accent-green); }
  .kpi-tile.flat { border-top-color: #b9b6ae; }
  .kpi-head { display: flex; justify-content: space-between;
              align-items: center; margin-bottom: 10px; }
  .kpi-label { font-size: 11px; font-weight: 700;
               text-transform: uppercase;
               color: var(--ink-muted); letter-spacing: 1px; }
  .kpi-value { font-family: "Playfair Display", Georgia, serif;
               font-weight: 700; font-size: 34px;
               line-height: 1; color: var(--ink);
               margin-bottom: 12px; }
  .pill { display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 9px; border-radius: 4px;
          font-size: 12px; font-weight: 600; line-height: 1.4; }
  .pill.down { background: var(--accent-red-soft); color: var(--accent-red); }
  .pill.up   { background: #ebf5ef; color: var(--accent-green); }
  .pill.flat { background: #f1efea; color: var(--ink-muted); }
  .prior { display: block; margin-top: 10px;
           font-size: 12px; color: var(--ink-muted); }

  /* === Dual risers / fallers panels === */
  .two-col { display: grid; grid-template-columns: 1fr 1fr;
             gap: 20px; margin-bottom: 22px; }
  @media (max-width: 760px) { .two-col { grid-template-columns: 1fr; } }

  /* === Sections (collapsible tables) === */
  .section { background: var(--surface); border-radius: 8px;
             box-shadow: 0 1px 3px rgba(0,0,0,.04);
             margin-bottom: 22px; overflow: hidden; }
  /* Top-border accent on risers/fallers tiles */
  .section.risers  { border-top: 3px solid var(--accent-green); }
  .section.fallers { border-top: 3px solid var(--accent-red); }
  .section-header { padding: 18px 28px; border-bottom: 1px solid var(--border);
                    display: flex; justify-content: space-between;
                    align-items: center; cursor: pointer; }
  .section-header h2 { font-family: "Playfair Display", Georgia, serif;
                       font-size: 18px; font-weight: 700; }
  .section.risers  .section-header h2 { color: var(--accent-green); }
  .section.fallers .section-header h2 { color: var(--accent-red); }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { background: #faf8f4; padding: 12px 22px;
             text-align: left; font-weight: 600;
             text-transform: uppercase; letter-spacing: .6px;
             font-size: 11px; color: var(--ink-muted);
             border-bottom: 1px solid var(--border); }
  tbody td { padding: 12px 22px; border-bottom: 1px solid #f4f1eb; }
  tbody tr:last-child td { border-bottom: none; }

  .delta-up   { color: var(--accent-green); font-weight: 600; }
  .delta-down { color: var(--accent-red);   font-weight: 600; }

  .badge { display: inline-block; padding: 3px 9px; border-radius: 4px;
           font-size: 11px; font-weight: 600; }
  .badge.green  { background: #ebf5ef; color: var(--accent-green); }
  .badge.red    { background: var(--accent-red-soft); color: var(--accent-red); }
  .badge.yellow { background: #fef6e3; color: #b67a08; }
  .badge.blue   { background: #eef2f8; color: #2c4a7a; }
  .badge.grey   { background: #f1efea; color: var(--ink-muted); }

  .back-top { position: fixed; bottom: 24px; right: 24px;
              background: var(--accent-red); color: #fff;
              width: 44px; height: 44px; border-radius: 50%;
              border: none; font-size: 20px; cursor: pointer;
              box-shadow: 0 4px 12px rgba(200,49,47,0.30); }
  footer { text-align: center; padding: 32px 24px;
           font-size: 12px; color: var(--ink-muted); }

  /* === Print === */
  @media print {
    nav { display: none; position: static; }
    header { padding: 36px 32px 28px; }
    header h1 { font-size: 42px; }
    .section-header { cursor: default; }
    .kpi-row { page-break-inside: avoid; }
    .kpi-tile, .section {
      box-shadow: none; border: 1px solid var(--border);
    }
    .back-top { display: none; }
  }
</style>
</head>
<body>

<header>
  <div class="header-inner">
    <div class="eyebrow">Top Movers Report</div>
    <h1>{ORG_NAME} Top Movers</h1>
    <p class="lede">Biggest gainers and decliners for {METRIC_NAME} by {DIMENSION_NAME}, {PERIOD_A_LABEL} vs {PERIOD_B_LABEL}.</p>
    <div class="meta">
      <span><span class="icon">&#128197;</span> {PERIOD_A_LABEL}</span>
      <span><span class="icon">&#128202;</span> {DATA_VIEW}</span>
      <span><span class="icon">&#128340;</span> Prepared {GENERATED_DATE}</span>
    </div>
  </div>
</header>

<nav>
  <a href="#summary">Summary</a>
  <a href="#gainers">Gainers</a>
  <a href="#decliners">Decliners</a>
  <a href="#newdisappeared">New &amp; Gone</a>
  <a href="#fulltable">Full Table</a>
</nav>

<div class="container">

  <!-- Summary KPI Tiles -->
  <div class="section-label">Watchlist Summary</div>
  <div id="summary" class="kpi-row">
    <div class="kpi-tile flat">
      <div class="kpi-head"><div class="kpi-label">Total Items Compared</div></div>
      <div class="kpi-value">{TOTAL_ITEMS}</div>
      <span class="prior">Dimension values in scope</span>
    </div>
    <div class="kpi-tile up">
      <div class="kpi-head"><div class="kpi-label">Biggest Gain</div></div>
      <div class="kpi-value">{TOP_GAINER_VALUE}</div>
      <span class="pill up">&#9650; {TOP_GAINER_NAME}</span>
    </div>
    <div class="kpi-tile down">
      <div class="kpi-head"><div class="kpi-label">Biggest Drop</div></div>
      <div class="kpi-value">{TOP_DECLINER_VALUE}</div>
      <span class="pill down">&#9660; {TOP_DECLINER_NAME}</span>
    </div>
    <div class="kpi-tile flat">
      <div class="kpi-head"><div class="kpi-label">New Entries</div></div>
      <div class="kpi-value">{NEW_ENTRIES}</div>
      <span class="prior">Appeared this period</span>
    </div>
    <div class="kpi-tile flat">
      <div class="kpi-head"><div class="kpi-label">Disappeared</div></div>
      <div class="kpi-value">{DISAPPEARED}</div>
      <span class="prior">Dropped out this period</span>
    </div>
  </div>

  <!-- Gainers + Decliners side by side -->
  <div class="two-col">

    <div id="gainers" class="section risers">
      <div class="section-header" onclick="toggle('gain-body')">
        <h2>&#9650; Top 10 Gainers</h2>
        <span id="gain-body-icon">&#9662;</span>
      </div>
      <div id="gain-body">
        <table>
          <thead><tr>
            <th>Item</th>
            <th>{PERIOD_A_LABEL}</th>
            <th>{PERIOD_B_LABEL}</th>
            <th>Delta</th>
            <th>% Change</th>
          </tr></thead>
          <tbody>
            <!-- Top 10 gainers, sorted by delta desc -->
            <!--
            <tr>
              <td>{ITEM_NAME}</td>
              <td>{VALUE_A}</td>
              <td>{VALUE_B}</td>
              <td class="delta-up">+{DELTA}</td>
              <td><span class="badge green">+{PCT}%</span></td>
            </tr>
            -->
          </tbody>
        </table>
      </div>
    </div>

    <div id="decliners" class="section fallers">
      <div class="section-header" onclick="toggle('dec-body')">
        <h2>&#9660; Top 10 Decliners</h2>
        <span id="dec-body-icon">&#9662;</span>
      </div>
      <div id="dec-body">
        <table>
          <thead><tr>
            <th>Item</th>
            <th>{PERIOD_A_LABEL}</th>
            <th>{PERIOD_B_LABEL}</th>
            <th>Delta</th>
            <th>% Change</th>
          </tr></thead>
          <tbody>
            <!-- Top 10 decliners, sorted by delta asc -->
            <!--
            <tr>
              <td>{ITEM_NAME}</td>
              <td>{VALUE_A}</td>
              <td>{VALUE_B}</td>
              <td class="delta-down">&minus;{DELTA}</td>
              <td><span class="badge red">&minus;{PCT}%</span></td>
            </tr>
            -->
          </tbody>
        </table>
      </div>
    </div>

  </div>

  <!-- New Entries & Disappeared -->
  <div id="newdisappeared" class="section">
    <div class="section-header" onclick="toggle('nd-body')">
      <h2>New Entries &amp; Disappeared Items</h2>
      <span id="nd-body-icon">&#9662;</span>
    </div>
    <div id="nd-body">
      <table>
        <thead><tr>
          <th>Item</th>
          <th>Status</th>
          <th>{PERIOD_A_LABEL}</th>
          <th>{PERIOD_B_LABEL}</th>
          <th>Notes</th>
        </tr></thead>
        <tbody>
          <!-- New entries: badge blue "New Entry" -->
          <!-- Disappeared: badge grey "Disappeared" -->
        </tbody>
      </table>
    </div>
  </div>

  <!-- Full Table -->
  <div id="fulltable" class="section">
    <div class="section-header" onclick="toggle('full-body')">
      <h2>Full Comparison Table</h2>
      <span id="full-body-icon">&#9662;</span>
    </div>
    <div id="full-body">
      <table>
        <thead><tr>
          <th>Item</th>
          <th>{PERIOD_A_LABEL}</th>
          <th>{PERIOD_B_LABEL}</th>
          <th>Delta</th>
          <th>% Change</th>
          <th>Status</th>
        </tr></thead>
        <tbody>
          <!-- All items sorted by absolute delta desc -->
        </tbody>
      </table>
    </div>
  </div>

</div>

<button class="back-top" onclick="window.scrollTo({top:0,behavior:'smooth'})">&uarr;</button>
<footer>Top Movers &mdash; {ORG_NAME} &mdash; Generated {GENERATED_DATE}</footer>

<script>
function toggle(id) {
  var el = document.getElementById(id);
  var ic = document.getElementById(id + '-icon');
  if (el.style.display === 'none') { el.style.display=''; ic.textContent='\u25be'; }
  else { el.style.display='none'; ic.textContent='\u25b8'; }
}
</script>
</body></html>
```

---

## Workflow Summary

1. Confirm metric, dimension, and both time periods.
2. Run `runReport` for Period A with dimension breakdown (limit 50).
3. Run `runReport` for Period B with same parameters.
4. Join on dimension value; compute delta, pctChange, and status.
5. Sort into: Top 10 Gainers, Top 10 Decliners, New Entries, Disappeared.
6. Generate HTML report inline, write to `/tmp/cja_top_movers_report_<YYYY-MM-DD_HHMMSS>.html`.
7. Open with `open /tmp/cja_top_movers_report_<YYYY-MM-DD_HHMMSS>.html`.
8. Deliver a 3-line inline summary: "Top gainer: X (+Y%), Top decliner: Z (−W%).
   N new items entered the top 50; M items disappeared."

---

## Important Guardrails

- **Read-only monitoring.** Never modify segments, metrics, or project definitions.
- **Confirm metric and segment scope** before running. Vague requests ("watch everything") need narrowing — ask which dimensions and metrics matter most.
- **Use consistent comparison windows.** "Top movers" must compare equal-length periods; mismatched windows produce false signals.
- **Distinguish noise from signal.** Very low-traffic dimension values (e.g., a segment with 5 visits) can show 500% swings — apply a minimum threshold (e.g., at least 100 sessions) before flagging as a mover.
- **Cap the watchlist size.** Surface the top 10–20 movers by default; overwhelming users with 100 dimension items defeats the purpose.
- **Attribute changes to context.** When possible, note known business events (campaigns, releases, outages) that could explain movements.

## Example Interaction

> "Which marketing channels moved the most last week vs the week before?"

1. Metric: Sessions (top usage default)
2. Dimension: Marketing Channel
3. Period A: last week, Period B: the week before
4. Run both reports, join results
5. Gainers: Paid Social +32%, Organic Search +8%
6. Decliners: Email −18%, Direct −5%
7. New: Affiliate (not in top 50 prior week)
8. Generate and open report
9. Inline summary: "Paid Social drove the biggest gain (+32%). Email was
   the top decliner (−18%). Affiliate channel appeared for the first time
   in the top rankings."
