---
name: cja-executive-briefing
description: >
  Generates a polished, leadership-ready performance briefing with KPI tiles,
  executive narrative bullets, and a driver analysis — all as a print-ready HTML
  document. Always use this skill when someone asks for an executive summary,
  performance briefing, leadership readout, stakeholder update, or business review
  — even if they don't say "executive" explicitly. Trigger phrases include:
  "write a summary of last week's performance," "create a briefing for our
  leadership team," "produce a monthly business review," "what should I tell
  executives about our metrics," "generate a performance narrative," "QBR summary,"
  "weekly business review," "board update," "stakeholder briefing," "how did we
  do last week," or "give me a performance snapshot." When in doubt, use this skill
  — it is always better to produce a polished briefing than a raw data dump.
license: Apache-2.0
metadata:
  author: Adobe
  version: "1.0"
---

# Executive Briefing (Customer Journey Analytics)

Produce a polished, leadership-ready performance document. Executives do not
read data tables — they read narratives that answer "are we growing?", "what
changed?", and "what do we do about it?"

This skill converts CJA data into a briefing that a VP or C-suite leader can
read in under 3 minutes, with supporting data available for those who want to
dig deeper.

Tone: business impact, not technical metrics. Write "Revenue grew 12% driven by
a strong Paid Search week" not "metrics/revenue increased by 0.12 per metrics/sessions."

---

## CJA MCP Tools Used

- `describeCja(DATAVIEW_CONTEXT_GUIDE)` — understand the business context of the data view
- `listComponentUsage` — identify the north-star and supporting KPIs
- `findMetrics` — resolve user-specified or discovered metric IDs
- `findCalculatedMetrics` — include custom business KPIs
- `runReport` — pull KPI values for current and comparison period
- `searchDimensionItems` — identify top driver dimension values

---

## Phase 0 — Setup

1. Call `findDataViews` to list available data views.
2. If the user hasn't specified a data view, present the list and ask which to use.
3. Call `setDefaultSessionDataViewId` with the chosen ID.
4. Confirm the reporting period (default: last 7 days) and the audience for the briefing (executive, board, team lead).

---

## Phase 1 — Establish Context

### 1.1 Load data view context

Call `describeCja("DATAVIEW_CONTEXT_GUIDE")` to understand:
- What business the data view represents (e-commerce, media, SaaS, etc.)
- The primary conversion event and revenue metric
- **Calendar conventions and timezone.** Record these values — they are
  inputs to every date computation in 1.2:
  - `WEEK_START_DOW` — day of week each week starts on (Sunday, Monday, …).
    Default: **Monday** (ISO 8601) if the context guide doesn't specify.
  - `FISCAL_YEAR_START_MONTH` — month the fiscal year begins. Default:
    **January** (calendar year) if the context guide doesn't specify.
  - `TIMEZONE` — for example, `America/Los_Angeles`.
  - `CALENDAR_SOURCE` — one of `"context guide"` (values came from `describeCja`),
    `"default fallback"` (the context guide didn't expose them and you used the
    defaults above), or `"user override"` (the user explicitly specified them).

This context determines what counts as the "north-star metric" and what
language to use in the narrative (e.g., "subscribers" vs "customers" vs "users").

### 1.2 Determine reporting period

Infer the period type from the user's request. Do not stop to ask — proceed immediately.

#### The principle

Two runs of this skill on the same data view, period type, and prompt MUST
produce identical `current` and `comparison` date ranges. Determinism comes
from (a) reading calendar conventions from 1.1 instead of improvising, and
(b) applying the alignment rule for the period type without taste calls.

#### Period type → alignment rule

Pick exactly one period type from the user's request:

| User request | `PERIOD_TYPE` | Current period | Comparison period |
|---|---|---|---|
| "last week" / unspecified | `weekly` | Most recent full week ending before today, aligned to `WEEK_START_DOW` (exactly 7 days) | The week immediately before, same alignment |
| "this month" / "MTD" | `month-to-date` | 1st of current month → today | 1st of prior month → same day-of-month as today |
| "last month" | `monthly` | Prior full calendar month (1st → last day) | The month before that |
| "this quarter" / "QTD" | `quarter-to-date` | Start of current fiscal quarter → today; fiscal quarters derived from `FISCAL_YEAR_START_MONTH` | Same days into the prior fiscal quarter |
| "last quarter" / "Q[N]" | `quarterly` | Prior full fiscal quarter | The fiscal quarter before that |
| Custom date range | `custom` | Use as specified | Equal-length window ending the day before `current.startDate` |

#### Universal invariants (must hold for every period type)

Before calling `runReport`, verify all six:

1. `current.startDate < current.endDate`
2. `comparison.startDate < comparison.endDate`
3. `comparison.endDate < current.startDate` (no overlap)
4. The day after `comparison.endDate` equals `current.startDate` (contiguous)
5. `current` and `comparison` have the **same length in days**
6. The alignment rule for `PERIOD_TYPE` is satisfied:
   - `weekly`: both `startDate`s fall on `WEEK_START_DOW`
   - `monthly`: both `startDate`s fall on the 1st of a month
   - `month-to-date`: both `startDate`s fall on the 1st; both `endDate`s have the same day-of-month
   - `quarterly`: both `startDate`s fall on the first day of a fiscal quarter
   - `quarter-to-date`: both `startDate`s fall on a fiscal quarter start; both `endDate`s are the same number of days into the quarter
   - `custom`: lengths match; contiguity holds

If ANY invariant fails, recompute the dates. **Never** paper over a mismatch by editing the footer.

#### Worked examples — today is Tuesday, May 26, 2026

These examples assume the data view's context guide returns `WEEK_START_DOW = Sunday` and `FISCAL_YEAR_START_MONTH = January`. Numbers change for other calendars — that's exactly the point.

| User request | `PERIOD_TYPE` | Current | Comparison |
|---|---|---|---|
| "last week" | `weekly` | May 17 (Sun) – May 23 (Sat) | May 10 (Sun) – May 16 (Sat) |
| "this month" / "MTD" | `month-to-date` | May 1 – May 26 | Apr 1 – Apr 26 |
| "last month" | `monthly` | Apr 1 – Apr 30 | Mar 1 – Mar 31 |
| "this quarter" / "QTD" | `quarter-to-date` | Apr 1 – May 26 | Jan 1 – Feb 24 |
| "last quarter" | `quarterly` | Jan 1 – Mar 31 | Oct 1 – Dec 31 (2025) |
| Custom: "May 15–22" | `custom` | May 15 – May 22 (8 days) | May 7 – May 14 (8 days) |

If `WEEK_START_DOW = Monday` instead, the weekly row becomes `May 18 (Mon) – May 24 (Sun)` vs `May 11 (Mon) – May 17 (Sun)`. The other rows are unchanged.

#### A common AI failure mode

The AI may "know" from training data that weeks are Mon–Sun (ISO 8601) or that
quarters are Q1=Jan–Mar (calendar). Silently overriding the context guide with
those defaults is exactly the determinism bug this section exists to prevent.
The footer's methodology line MUST accurately describe the dates you computed
— if footer says "weeks start Sunday" but `current.startDate` is a Monday,
that's a bug to fix in the dates, not in the footer.

### 1.3 Audience assumption

Default to **internal leadership** (VPs, directors, senior managers). This means:
- Include specific dimension values (e.g., channel names) in the narrative
- Surface both positive and negative findings with equal directness
- The reader understands your business — no need to define basic terms

If the user says "external," "board," or "investors," shift to higher-level
business outcomes, remove any internal channel naming that could be sensitive,
and lead with the most positive finding.

---

## Phase 2 — Discover North-Star Metrics

Pull the most-used metrics to identify what the org actually tracks as success.
Run both calls in parallel — this is fast and sets the foundation for every KPI
decision downstream:

```
listComponentUsage(componentType: "metric")
listComponentUsage(componentType: "calculatedMetric")
```

### Deterministic selection — do not improvise

The KPI set MUST be reproducible across runs for the same data view. Two runs of
this skill on the same period must produce the same metric values, which requires
selecting the **same metric IDs** every time. Follow this algorithm exactly:

1. Combine both `listComponentUsage` results into a single ranked list.
2. Sort by `usageCount` descending. Break ties by metric ID alphabetically
   (stable secondary sort).
3. Resolve metric IDs to human-readable display names with `describeMetric` or
   `describeCalculatedMetric`.
4. Take the top **6 metric IDs** from this sorted list. That is the KPI set.

Do NOT cherry-pick by metric "type" (volume vs conversion vs revenue) and do NOT
swap in an alternative metric because its name reads better in a narrative.
Different runs picking `metrics/orders` vs `metrics/orders_1_1` produce wildly
different numbers and break trust in the briefing.

### When the user specifies metrics explicitly

If the user names metrics in their request ("give me a briefing on revenue,
orders, and conversion rate"), resolve each name to **one** specific metric ID
via `findMetrics`. If multiple metrics match a name (e.g., "Orders" matches both
`metrics/orders` and a calculated metric called "Orders"), pick the one with
the highest `usageCount` and document the choice.

### Always disclose the metric IDs used

Include a small "Metrics included" line in the briefing artifact's footer
listing the resolved metric IDs (e.g., `metrics/orders_1_1`, `metrics/visits`,
`metrics/page_views`). This makes the report auditable and lets the user
confirm a re-run is using the same metrics.

Cap at 6 KPIs. More is noise.

---

## Phase 3 — Pull KPI Data

Run both reports in parallel — current period and comparison period — with all
selected metrics. Use a date dimension (e.g., `variables/daterangeday`) so the
report returns summary totals across the full period. The `summaryData.totals`
array in the response contains the aggregate values you need.

```
runReport(
  startDate: "<current period start>T00:00:00",
  endDate: "<current period end>T00:00:00",
  dimensionIds: "variables/daterangeday",
  metricIds: "metrics/visits,metrics/orders_1_1,metrics/revenue_1,...",
  page: 0,
  limit: 1
)
runReport(
  startDate: "<prior period start>T00:00:00",
  endDate: "<prior period end>T00:00:00",
  dimensionIds: "variables/daterangeday",
  metricIds: "metrics/visits,metrics/orders_1_1,metrics/revenue_1,...",
  page: 0,
  limit: 1
)
```

Read `summaryData.filteredTotals` from each response — the values correspond to
the metrics in the order they were specified in `metricIds`.

Compute for each KPI:
- `current` value
- `prior` value
- `delta` = current − prior
- `pctChange` = delta / prior × 100
- `direction`: up / down / flat (using ±3% threshold)
- `polarity`: positive if higher is better, negative if lower is better
- `signal`: green (favorable), red (unfavorable), yellow (mixed/flat)

---

## Phase 4 — Find What Drove the Movement

For the 2 KPIs with the largest absolute % change, find the top driver:

Run current and prior period breakdown reports in parallel:

```
runReport(
  startDate: "<current period start>",
  endDate: "<current period end>",
  dimensionIds: "variables/marketing_channel",
  metricIds: "<top-moved metric id>",
  limit: 5
)
runReport(
  startDate: "<prior period start>",
  endDate: "<prior period end>",
  dimensionIds: "variables/marketing_channel",
  metricIds: "<top-moved metric id>",
  limit: 5
)
```

Compare channel-level values between periods to find which dimension value's delta
most closely mirrors the overall metric change. This becomes the "driven by" phrase
in the narrative.

Only run dimension breakdowns for the 2 most-moved metrics (by absolute % change).
This constraint exists because: (a) more breakdowns add latency without adding
executive value, and (b) the two largest movers are what leadership will ask about
first. The remaining KPIs get context from the narrative without needing attribution.

If `variables/marketing_channel` returns no useful breakdown (e.g., only one
channel has data), try `variables/page_type` or `variables/product_category`
as alternative driver dimensions.

---

## Phase 5 — Write the Executive Narrative

Compose 3–5 bullet points as the narrative. Each bullet follows this structure:

**[Signal emoji] [Metric]: [Value] ([+/-pctChange%] vs [prior period]) — [Plain-English context]**

Guidelines:
- Open with the most important finding (highest-impact metric, positive or negative)
- Use business language: "revenue," "customers," "conversions" — not "metrics/revenue"
- Name the driver when known: "driven by Paid Search," "led by Product Page improvements"
- Include one forward-looking note if relevant: "This trend should be monitored..."
- For negative trends: be direct but not alarming. Suggest investigation, not panic.

Examples of well-written bullets:
- "Revenue reached $1.24M last week, up 8.2% vs prior week — Paid Search drove the majority of the gain (+$82K)."
- "Conversion Rate declined to 2.1% (−0.4pp), primarily on mobile. Desktop conversion remained stable at 3.4%."
- "Sessions were flat at 540K (+1.1%) — organic and direct traffic offset a reduction in email campaign sends."
- "Bounce Rate ticked up to 43% (+2pp). No single driver identified; worth monitoring through end of month."

---

## Phase 6 — Generate the HTML Briefing Document

Generate the briefing inline. Write to `/tmp/cja_executive_briefing_<YYYY-MM-DD_HHMMSS>.html`.
This document should look polished enough to share with leadership — not a
developer tool output.


### Rendering rules — apply consistently across runs

Two runs of this skill on the same data view + period must render identically
(modulo the generation timestamp). The rules below pin the formatting choices
that the AI would otherwise drift on.

#### Number formatting

- **KPI values** (the big number in each tile) — use full digits with
  thousands separators (`8,160`, `77,584`, `1,250,000`). Do **NOT** use SI
  suffixes like `K` or `M`, even for large values. Executives want exact
  numbers, not abbreviations.
- **Percent change** (in pills and narrative bullets) — always one decimal
  place, rounded **half-away-from-zero**. For example, `−23.55%` displays as
  `−23.6%`, never `−23.5%`. Compute on full-precision values; round only at
  display time.
- **Percentage-point change** (for already-percentage metrics like Conversion
  Rate or Bounce Rate) — same rounding, suffix `pp`. Example: `+0.40 pp`.
- **Currency** — `$` prefix with thousands separators and no decimals for
  values ≥ $100 (`$1,240,000`); cents only when value < $100 (`$45.20`).

#### Null / missing data handling

A KPI tile must reflect what the data view actually returned. The AI must
**not** silently substitute a different metric or hide a tile to make the
briefing look cleaner.

- **Both periods return 0 or NULL** for a metric in the resolved set: render
  the tile with `kpi-value` = `Data unavailable`, pill class `flat`, pill text
  `⚠ N/A`, and `prior` text = `Both periods returned no data — validate
  instrumentation`. The tile stays in the grid; do not omit it.
- **One period returns valid data, the other 0 / NULL**: render the tile with
  the valid value as `kpi-value`, pill class `flat`, pill text `⚠ N/A`, and
  `prior` text = `Prior {period_noun}: no data`.
- **Never** substitute a derived metric (e.g., adding "Conversion Rate"
  because Revenue came back $0). The visible KPI set MUST match the resolved
  metric IDs disclosed in the footer.
- If a Revenue / monetary metric is unavailable, surface a `.callout.note`
  above the KPI grid explaining the gap. Do not invent a value.


### Template variables

Populate every `{PLACEHOLDER}` in the HTML template below using these rules.
The briefing belongs to the customer — never substitute Adobe, CJA, or any
vendor language into customer-visible fields.

- **`{ORG_NAME}`** — The customer's business or brand name, derived from the
  data view context loaded in Phase 1.1. Strip technical/environment suffixes
  like ` — Prod`, ` - Demo`, ` Stage`, ` Test`, ` MCP`. If the data view name
  has no clean brand label, fall back to the data view display name with
  suffixes removed. Do **not** invent a name and do **not** substitute a
  vendor name.
- **`{PERIOD_TYPE}`** — One of `Weekly`, `Monthly`, `Quarterly`, or
  `Performance` (default), chosen from the period inferred in Phase 1.2.
- **`{LEDE_SENTENCE}`** — Use exactly this pattern, with no vendor names:
  `Leadership readout for the {period type lowercase} of {PERIOD_LABEL} compared to {COMPARISON_LABEL}.`
  Example: `Leadership readout for the week of May 12–18, 2026 compared to May 5–11, 2026.`
- **`{DATA_VIEW}`** — Data view display name as returned by `findDataViews`.
  Suffixes are acceptable here — this row is the technical identifier line,
  not the title.
- **`{PERIOD_LABEL}`** / **`{COMPARISON_LABEL}`** — Human-readable date ranges,
  e.g., `May 12–18, 2026`.
- **`{GENERATED_DATE}`** — Today's date in the same human format,
  e.g., `May 23, 2026`.
- **`{METRIC_LABEL}` / `{FORMATTED_VALUE}` / `{PCT_CHANGE}` / `{PRIOR_VALUE}`** —
  Per-KPI values from Phase 3. Use the metric's customer-facing display name,
  not its internal ID.

### HTML Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Performance Briefing &mdash; {ORG_NAME} &mdash; {PERIOD}</title>
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
              line-height: 1.05; margin-bottom: 14px; }
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

  /* === Callout === */
  .callout { background: var(--accent-red-soft);
             border-left: 4px solid var(--accent-red);
             border-radius: 6px;
             padding: 18px 22px; margin-bottom: 32px;
             display: flex; gap: 14px; align-items: flex-start; }
  .callout .warn-icon { font-size: 22px; line-height: 1; flex-shrink: 0;
                        color: var(--accent-yellow); }
  .callout-title { font-weight: 700; color: var(--accent-red);
                   margin-bottom: 4px; font-size: 15px; }
  .callout-body { font-size: 14px; color: #4a2222; line-height: 1.55; }
  .callout.note { background: #fdf6e7; border-left-color: var(--accent-yellow); }
  .callout.note .callout-title { color: #8a5a08; }
  .callout.note .callout-body { color: #5a4108; }

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
               font-weight: 700; font-size: 38px;
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

  /* === Narrative === */
  .narrative-card { background: var(--surface); border-radius: 8px;
                    padding: 32px 36px;
                    box-shadow: 0 1px 3px rgba(0,0,0,.04);
                    margin-bottom: 24px; }
  .narrative-card h2 { font-family: "Playfair Display", Georgia, serif;
                       font-size: 24px; font-weight: 700;
                       margin-bottom: 18px;
                       padding-bottom: 12px;
                       border-bottom: 1px solid var(--border); }
  .bullet-list { list-style: none; }
  .bullet-list li { padding: 14px 0; font-size: 15px; line-height: 1.65;
                    border-bottom: 1px solid #f1eeea; }
  .bullet-list li:last-child { border-bottom: none; }
  .bullet-list .signal { margin-right: 6px; }
  .bullet-list .metric-highlight { font-weight: 700; }
  .bullet-list .driver { color: var(--accent-red); font-style: italic; }

  /* === Sections (collapsible tables) === */
  .section { background: var(--surface); border-radius: 8px;
             box-shadow: 0 1px 3px rgba(0,0,0,.04);
             margin-bottom: 22px; overflow: hidden; }
  .section-header { padding: 18px 28px; border-bottom: 1px solid var(--border);
                    display: flex; justify-content: space-between;
                    align-items: center; cursor: pointer; }
  .section-header h2 { font-family: "Playfair Display", Georgia, serif;
                       font-size: 18px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { background: #faf8f4; padding: 12px 22px;
             text-align: left; font-weight: 600;
             text-transform: uppercase; letter-spacing: .6px;
             font-size: 11px; color: var(--ink-muted);
             border-bottom: 1px solid var(--border); }
  tbody td { padding: 12px 22px; border-bottom: 1px solid #f4f1eb; }
  tbody tr:last-child td { border-bottom: none; }

  .badge { display: inline-block; padding: 3px 9px; border-radius: 4px;
           font-size: 11px; font-weight: 600; }
  .badge.green  { background: #ebf5ef; color: var(--accent-green); }
  .badge.red    { background: var(--accent-red-soft); color: var(--accent-red); }
  .badge.yellow { background: #fef6e3; color: #b67a08; }
  .badge.grey   { background: #f1efea; color: var(--ink-muted); }

  footer { text-align: center; padding: 32px 24px;
           font-size: 12px; color: var(--ink-muted); }

  /* === Print === */
  @media print {
    nav { display: none; position: static; }
    header { padding: 36px 32px 28px; }
    header h1 { font-size: 42px; }
    .section-header { cursor: default; }
    .kpi-row { page-break-inside: avoid; }
    .kpi-tile, .narrative-card, .section {
      box-shadow: none; border: 1px solid var(--border);
    }
  }
</style>
</head>
<body>

<header>
  <div class="header-inner">
    <div class="eyebrow">{PERIOD_TYPE} Performance Briefing</div>
    <h1>{ORG_NAME} Performance</h1>
    <p class="lede">{LEDE_SENTENCE}</p>
    <div class="meta">
      <span><span class="icon">&#128197;</span> {PERIOD_LABEL}</span>
      <span><span class="icon">&#128202;</span> {DATA_VIEW}</span>
      <span><span class="icon">&#128340;</span> Prepared {GENERATED_DATE}</span>
    </div>
  </div>
</header>

<nav>
  <a href="#highlights">Highlights</a>
  <a href="#narrative">Summary</a>
  <a href="#data">KPI Detail</a>
  <a href="#drivers">Drivers</a>
</nav>

<div class="container">

  <!--
    Optional critical callout. Include ONLY when the data has a
    notable finding worth raising above the fold (e.g., a metric
    moved >25% week-over-week, or data is missing/anomalous).
    Use the .note variant (yellow) for non-critical context;
    omit entirely if there is nothing noteworthy.
  -->
  <!--
  <div class="callout">
    <span class="warn-icon">&#9888;</span>
    <div>
      <div class="callout-title">Critical: {ONE_LINE_HEADLINE}</div>
      <div class="callout-body">{ONE_PARAGRAPH_CONTEXT}</div>
    </div>
  </div>
  -->

  <!-- Headline KPI Tiles -->
  <div class="section-label">Key Performance Indicators</div>
  <div id="highlights" class="kpi-row">
    <!-- Repeat for each KPI (4-6 tiles), class = up | down | flat:
    <div class="kpi-tile down">
      <div class="kpi-head">
        <div class="kpi-label">{METRIC_LABEL}</div>
      </div>
      <div class="kpi-value">{FORMATTED_VALUE}</div>
      <span class="pill down">&#9660; {PCT_CHANGE}%</span>
      <span class="prior">Prior week: {PRIOR_VALUE}</span>
    </div>
    -->
  </div>

  <!-- Executive Narrative -->
  <div id="narrative" class="narrative-card">
    <h2>Executive Summary</h2>
    <ul class="bullet-list">
      <!--
      <li>
        <span class="signal">{EMOJI}</span>
        <span class="metric-highlight">{Metric}:</span> {value} ({delta} vs prior period) &mdash;
        <span class="driver">{plain-English driver or context}</span>
      </li>
      -->
    </ul>
  </div>

  <!-- Supporting Data Table -->
  <div id="data" class="section">
    <div class="section-header" onclick="toggle('data-body')">
      <h2>Full KPI Detail</h2>
      <span id="data-body-icon">&#9662;</span>
    </div>
    <div id="data-body">
      <table>
        <thead><tr>
          <th>Metric</th>
          <th>{PERIOD_LABEL}</th>
          <th>{COMPARISON_LABEL}</th>
          <th>Change</th>
          <th>% Change</th>
          <th>Signal</th>
        </tr></thead>
        <tbody>
          <!-- One row per KPI with delta and badge -->
        </tbody>
      </table>
    </div>
  </div>

  <!-- Key Drivers -->
  <div id="drivers" class="section">
    <div class="section-header" onclick="toggle('drv-body')">
      <h2>What Drove the Movement</h2>
      <span id="drv-body-icon">&#9662;</span>
    </div>
    <div id="drv-body">
      <table>
        <thead><tr>
          <th>Metric</th>
          <th>Top Driver</th>
          <th>Value This Period</th>
          <th>Value Prior Period</th>
          <th>Contribution</th>
        </tr></thead>
        <tbody>
          <!-- One row per metric with top dimension driver -->
        </tbody>
      </table>
    </div>
  </div>

</div>

<footer>
  Performance Briefing &mdash; {ORG_NAME} &mdash; Generated {GENERATED_DATE}<br>
  <span style="opacity:.7">
    Methodology: {PERIOD_TYPE}
    &middot; current {CURRENT_START_ISO}&ndash;{CURRENT_END_ISO}
    &middot; comparison {COMPARISON_START_ISO}&ndash;{COMPARISON_END_ISO}
    &middot; week starts {WEEK_START_DOW}
    &middot; fiscal year starts {FISCAL_YEAR_START_MONTH}
    &middot; tz {TIMEZONE}
    &middot; calendar source: {CALENDAR_SOURCE}
    &middot; metrics: {METRIC_IDS_CSV}
  </span>
</footer>

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

## Phase 7 — Deliver the Briefing

1. Write the HTML to `/tmp/cja_executive_briefing_<YYYY-MM-DD_HHMMSS>.html`
2. Open with `open /tmp/cja_executive_briefing_<YYYY-MM-DD_HHMMSS>.html`
3. Output the narrative bullets directly in chat so the user can copy-paste
   them into an email or slide deck immediately — the HTML is the "appendix."

In-chat format:
```
Performance Briefing — Last Week vs Prior Week
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 Revenue: $1.24M (+8.2%) — Paid Search drove the majority of the gain.
📉 Conversion Rate: 2.1% (−0.4pp) — Mobile checkout declined; desktop stable.
➡  Sessions: 540K (+1.1%) — Essentially flat; organic offset email decline.
📈 Orders: 11,340 (+6.7%) — Product page improvements appear to be contributing.
⚠️  Bounce Rate: 43% (+2pp) — No clear driver identified; monitor next week.

Full briefing document: /tmp/cja_executive_briefing_<YYYY-MM-DD_HHMMSS>.html
```

---

## Tone and Style Rules

1. **Write outcomes, not activities.** "Revenue grew" not "metrics/revenue increased."
2. **Name the driver concisely.** "Paid Search drove the gain" not "Marketing
   Channel = Paid Search had a higher value in period A vs period B."
3. **One sentence per bullet.** Two at most. Executives skim.
4. **Lead with the most important finding.** Do not build to a conclusion.
5. **Be direct about bad news.** "Conversion Rate declined" not "Conversion Rate
   saw some movement in a downward direction."
6. **Quantify everything.** Every bullet must have a number. Opinions without
   data are not executive communication.
7. **Avoid jargon.** No "dimensions," "metrics IDs," "data view context," or
   "MCP tool calls" in the output.

## Important Guardrails

- **Read-only reporting.** Never modify metrics, segments, or projects.
- **Use business language, not technical IDs.** Replace dimension IDs (e.g., `variables/evar5`) with their display names. Never expose internal IDs in the narrative.
- **Always state the date range prominently.** Executives need context — "last week" is ambiguous; write "April 7–13, 2026."
- **Don't invent data.** If a KPI is unavailable or the report returns no data, say so explicitly rather than omitting or estimating.
- **Cap the briefing to the most impactful findings.** 3–5 KPI tiles + 2–3 driver bullets is ideal; more than 8 KPIs dilutes the message.
- **Note significant context.** Mention known external factors (campaigns, holidays, product releases) that affect the metrics when relevant.
- **Validate numbers before presenting.** Cross-check KPI values against a second `runReport` call if they look anomalous.
- **Customer-branded output, never vendor-branded.** The briefing is the customer's document about their own business. Never use "Adobe", "CJA", "Customer Journey Analytics", or any vendor/product name in the customer-visible briefing (title, lede, narrative, tables, footer, or in-chat output). The red/black header palette is the only Adobe-branded element allowed in the artifact.

---

## Example Interaction

> "Write me an executive briefing for last week's performance."

1. **Setup:** Confirm data view with `findDataViews`. User selects their primary data view. Call `setDefaultSessionDataViewId`.
2. **Scope:** Confirm reporting period (last 7 days, April 7–13, 2026) and key KPIs (Revenue, Conversion Rate, Sessions, AOV).
3. **Data pull:** Run `runReport` for each KPI: current week vs. prior week and vs. same week last year.
4. **Narrative draft:** Compose 3–4 executive bullets in business language: "Revenue of $2.4M was up 8% week-over-week, driven by a 15% increase in Paid Search conversions. Conversion Rate dipped 2 points to 3.1%, consistent with the product page redesign rollout on April 9."
5. **HTML report:** Generate the print-ready HTML briefing with KPI tiles, narrative section, and driver table. Open the file. Present a 2-sentence summary to the user and offer to adjust tone or scope.
