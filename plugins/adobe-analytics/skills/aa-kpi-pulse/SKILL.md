---
name: aa-kpi-pulse
description: >
  Produces a compact KPI digest showing how key metrics changed over a period
  and what's driving the movement. Use this skill when someone asks for a
  performance summary, a weekly recap, a morning briefing, a KPI update, or any
  variation of "how did we do this week/month." Also trigger for "give me a
  performance overview," "what moved in the last 7 days," "pull our AA KPI
  report," or "summarize our metrics."
license: Apache-2.0
metadata:
  author: Adobe
  version: "1.0"
---

# KPI Pulse (Adobe Analytics)

Produce a compact, digestible KPI digest showing how key metrics changed over
a chosen period, which items drove the change, and what stood out. Batches all
KPIs into two `runReport` calls (current period + comparison period) and
assembles results into an HTML performance card deck.

---

## AA MCP Tools Used

- `findReportSuites` — select working report suite
- `setSessionDefaults` — set session context (reportSuiteId + globalCompanyId)
- `describeAa(REPORT_SUITE_CONTEXT_GUIDE)` — load org context, top metrics,
  calendar config, and timezone
- `findMetrics` — discover and validate metric IDs
- `listComponentUsage` — identify top-used metrics if user hasn't specified
- `runReport` — all KPIs batched in one call per period (current + comparison)
- `searchDimensionItems` — find top contributors for top-mover callouts

---

## Phase 0 — Setup

1. Confirm report suite with `findReportSuites` / `setSessionDefaults`.
2. Call `describeAa(REPORT_SUITE_CONTEXT_GUIDE)` to load organizational
   context: top metrics, calendar configuration, and timezone. Record the
   report suite's first-day-of-week as `WEEK_START_DOW` and the report suite
   timezone as `TIMEZONE` — you will use both when computing reporting
   periods in Phase 2. If the context guide returns no `WEEK_START_DOW`,
   default to **Monday** (ISO 8601).

```
findReportSuites(globalCompanyId: "<gcid>")
setSessionDefaults(globalCompanyId: "<gcid>", reportSuiteId: "<rsid>")
describeAa(guideType: "REPORT_SUITE_CONTEXT_GUIDE")
```

---

## Phase 1 — Select KPIs

### 1.1 If the user specified metrics

Resolve each to an AA metric ID:

```
findMetrics(searchTerm: "<metric name>")
```

Cap at 8 metrics for a focused pulse. If more are requested, ask the user
to prioritize or offer to split into multiple reports.

### 1.2 If the user has not specified metrics

Use `listComponentUsage` to find the most-used metrics in the report suite:

```
listComponentUsage(componentType: "metric")
```

Select the top 5–7 by usage count. Confirm with the user:
> "Based on usage, I'll track: Visits, Page Views, Revenue, Orders,
> Conversion Rate, Bounce Rate. Does this look right, or would you like
> to adjust?"

---

## Phase 2 — Select Time Periods

Ask the user what period to report on, or infer from context:

| Request | Current Period | Comparison Period |
|---|---|---|
| "this week" | Last 7 days | Prior 7 days |
| "this month" | Month-to-date | Same period last month |
| "last month" | Last full calendar month | Same month prior year |
| "this quarter" | Quarter-to-date | Same period last quarter |
| "YTD" | Jan 1 to today | Same period prior year |

Confirm: "I'll compare [current period] vs [comparison period]. Is that right?"

**Calendar rule (mandatory):** the current period and the comparison period
MUST use the same `WEEK_START_DOW` from Phase 0. For weekly pulses, both
periods' `startDate` fall on the same day-of-week, both are exactly 7 days
long, and the comparison period ends immediately before the current period
starts. Never mix conventions (e.g., a Mon–Sun current with a Sun–Sat prior)
within the same pulse. For custom date ranges, compute the comparison
period as the equal-length window ending immediately before the current
period starts.

**Sanity check before calling `runReport`:** confirm `current.startDate` and
`comparison.startDate` are the same day-of-week and that
`current.startDate - comparison.endDate == 1 day`. If not, recompute.

**Edge case:** If today is within the first 3 days of a period, note that
the current-period data may be incomplete and the comparison may look skewed.

---

## Phase 3 — Fetch KPI Data

Batch all selected metrics into a single call per period:

```
runReport(
  metricIds: "<metricId1>,<metricId2>,<metricId3>,...",
  dimensionId: "variables/daterangeday",
  startDate: "<current period start>T00:00",
  endDate: "<current period end>T23:59"
)

runReport(
  metricIds: "<metricId1>,<metricId2>,<metricId3>,...",
  dimensionId: "variables/daterangeday",
  startDate: "<comparison period start>T00:00",
  endDate: "<comparison period end>T23:59"
)
```

> **Note:** `metricIds` accepts comma-separated IDs — pass all KPIs at once.
> `startDate`/`endDate` (not `dateRange`); no `granularity` parameter.
> Use `variables/daterangeday` for day-by-day breakdown.
> `summaryData.totals[0]`, `totals[1]`, etc. correspond to each metric in order.
> Unauthorized metrics surface in `columnErrors`; the rest of the call still succeeds.

2 calls total regardless of metric count.

From each pair, compute:
- Current value (total over period)
- Prior value (total over comparison period)
- Absolute delta: current - prior
- Percent change: (delta / prior) × 100
- Trend: ↑ if positive, ↓ if negative, → if within ±2%

---

## Phase 4 — Top Mover Context

For the 1–2 metrics with the largest percent changes (positive or negative),
run a dimension breakdown to find the top contributor:

```
runReport(
  metricIds: "<metricId>",
  dimensionId: "variables/marketingchannel",
  startDate: "<current period start>T00:00",
  endDate: "<current period end>T23:59",
  limit: 5
)
```

Repeat for a second dimension if relevant (e.g., pages for a traffic spike,
products for a revenue change).

Use results to write a 1–2 sentence driver narrative:
> "Visits rose 18% WoW, driven primarily by Organic Search (+34%) which
> offset a decline in Direct traffic (-12%)."

---

## Phase 5 — Generate HTML Report

Build the KPI pulse HTML report inline and write to
`/tmp/aa_kpi_pulse_report_<YYYY-MM-DD_HHMMSS>.html`.


### Rendering rules — apply consistently across runs

Two runs of this skill on the same report suite + period must render identically
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

A KPI tile must reflect what the report suite actually returned. The AI must
**not** silently substitute a different metric or hide a tile to make the
report look cleaner.

- **Both periods return 0 or NULL** for a KPI being rendered: render the tile
  with `kpi-value` = `Data unavailable`, pill class `flat`, pill text
  `⚠ N/A`, and `prior` text = `Both periods returned no data — validate
  instrumentation`. The tile stays in the grid; do not omit it.
- **One period returns valid data, the other 0 / NULL**: render the tile with
  the valid value as `kpi-value`, pill class `flat`, pill text `⚠ N/A`, and
  `prior` text = `Prior {period_noun}: no data`.
- **Never** substitute a derived metric (e.g., adding "Conversion Rate"
  because Revenue came back $0). The visible KPI set MUST match the metrics
  selected for this run.


### HTML template

Read [`template.html`](template.html) and use it verbatim. Do not improvise the
HTML structure or CSS — only fill in the `{PLACEHOLDER}` tokens (`{ORG_NAME}`,
`{PERIOD_LABEL}`, `{COMPARISON_LABEL}`, `{REPORT_SUITE}`, `{GENERATED_DATE}`,
`{METRIC_NAME}`, `{FORMATTED_VALUE_A}`, `{FORMATTED_VALUE_B}`, `{PCT_CHANGE}`,
`{VALUE_A}`, `{VALUE_B}`, `{DELTA}`, `{ARROW}`) and repeat the KPI tile / detail
row / mover row blocks once per data item. Preserve the `.up | .down | .flat`
and `.green | .red | .yellow | .grey` modifier classes per the trend rules in
Phase 3.

**Section titles — no phase prefix**: Section headings in the HTML report must **not** include
the phase number. Use the plain section name only (e.g., "KPI Scorecards" not "Phase 2 — KPI Scorecards",
"Top Movers" not "Phase 4 — Top Movers").

Write the completed HTML to `/tmp/aa_kpi_pulse_report_<YYYY-MM-DD_HHMMSS>.html`, then open:

```bash
open /tmp/aa_kpi_pulse_report_<YYYY-MM-DD_HHMMSS>.html
```

---

## KPI Card Coloring Rules

- Delta badge green if change >= +2%
- Delta badge red if change <= -2%
- Delta badge grey if between -2% and +2% (flat)
- Border-top on card: green for positive movement, red for negative,
  grey for flat

---

## Inline Summary (Always Deliver)

In addition to the HTML report, always provide a brief inline text summary:

```
KPI Pulse — [Period] vs [Comparison]
Report Suite: [Name]

Metric              Current   Change
─────────────────   ───────   ──────
Visits              124,500   ▲ 18%
Revenue             $42,800   ▲  9%
Conversion Rate       2.4%    ▼  0.3pp
Page Views          398,200   ▲ 11%
Bounce Rate          48.2%    ▼  1.8pp

Key driver: Visits growth led by Paid Search (+34%).
Revenue up on strong Mobile performance (+22%).
```

---

## Guardrails

- Always confirm the time period with the user before fetching data — wrong
  periods are the most common source of confusion.
- Flag partial periods explicitly (e.g., "This month has only 5 days of data").
- For percentage metrics (conversion rate, bounce rate), report deltas as
  percentage points (pp), not percent change.
- Cap at 8 metrics for reasonable call volume. Offer a second pulse for
  additional metrics if needed.

---

## Example Interaction

> "Give me a KPI update for last week."

1. Confirm report suite with `findReportSuites` and `setSessionDefaults`.
2. Load context with `describeAa(guideType: "REPORT_SUITE_CONTEXT_GUIDE")`.
3. Identify top 6 metrics from `listComponentUsage(componentType: "metric")` or user input.
4. Confirm: last 7 days vs prior 7 days.
5. Run 12 `runReport` calls (2 per metric) — use `metricIds`, `startDate`, `endDate`, and
   `dimensionId: "variables/daterangeday"`. Sum `summaryData.totals[0]` for each period total.
6. Run dimension breakdown for 2 biggest movers (use `dimensionId: "variables/marketingchannel"`).
7. Generate HTML report, open it, deliver inline summary.
8. Narrative: "Visits were up 18% WoW driven by paid search. Revenue grew 9%
   with mobile leading. Bounce rate improved 1.8pp."
