---
name: cja-kpi-pulse
description: >
  Produces a compact KPI digest showing how key metrics changed over a period and
  what's driving the movement. Use this skill when someone asks for a performance
  summary, a weekly recap, a morning briefing, a KPI update, or any variation of
  "how did we do this week/month." Also trigger for requests like "give me a
  performance overview," "what moved in the last 7 days," "pull our KPI report,"
  or "summarize our metrics."
license: Apache-2.0
metadata:
  author: Adobe
  version: "1.0"
---

# KPI Pulse (Customer Journey Analytics)

Produce a compact KPI digest in under 2 minutes. The goal is a crisp answer to
"how did we do?" — not a deep-dive, not a data dump. Each KPI gets a scorecard
showing current value, period-over-period change, trend direction, and the top
dimension breakdown that explains any movement.

---

## CJA MCP Tools Used

- `describeCja(DATAVIEW_CONTEXT_GUIDE)` — understand the data view context
- `listComponentUsage` — find the most-used metrics (the org's real KPIs)
- `findMetrics` — resolve metric IDs from user-specified names
- `findCalculatedMetrics` — include custom KPIs if present
- `runReport` — pull metric values for current and prior periods
- `searchDimensionItems` — top dimension breakdown for movers

---

## Phase 0 — Setup

1. Call `findDataViews` to list available data views.
2. If the user hasn't specified a data view, present the list and ask which to use.
3. Call `setDefaultSessionDataViewId` with the chosen ID.
4. Call `describeCja("DATAVIEW_CONTEXT_GUIDE")` to load data view context.
   Record the data view's first-day-of-week as `WEEK_START_DOW` and timezone
   as `TIMEZONE`. If the context guide does not return a week-start value,
   default to **Monday** (ISO 8601). You will use both in Phase 1.1.
5. Clarify the monitoring scope: which KPIs to track and the comparison period (e.g., WoW, MoM, vs. target).

## Phase 1 — Clarify Scope

### 1.1 Determine the reporting period

If the user did not specify a period, ask one question:
> "What time window would you like? Options: last 7 days, last 30 days, this
> week vs last week, this month vs last month, or a custom range."

Default to **this week vs last week** if no answer is given.

Map the answer to two date ranges:
- **Period A** (current): e.g., "thisWeek", "thisMonth", last 7 days
- **Period B** (comparison): e.g., "lastWeek", "lastMonth", prior 7 days

**Calendar rule (mandatory):**

Use `WEEK_START_DOW` from Phase 0 to define what "week" means. The current
period (Period A) and the comparison period (Period B) MUST use the same
first-day-of-week — i.e., both periods' `startDate` fall on the same
day-of-week, both are exactly equal length, and the comparison period ends
immediately before the current period starts. Never mix conventions
(e.g., a Mon–Sun current with a Sun–Sat prior) within the same pulse run.
Pick the boundary once, then derive both periods from it. For custom date
ranges, compute Period B as the equal-length window ending immediately
before Period A starts.

**Sanity check before calling `runReport`:** confirm `periodA.startDate` and
`periodB.startDate` are the same day-of-week and that
`periodA.startDate - periodB.endDate == 1 day`. If not, recompute.

### 1.2 Determine the metrics

If the user named specific metrics, resolve them with `findMetrics` or
`findCalculatedMetrics`. Otherwise, discover the top 5–8 KPIs automatically:

```
listComponentUsage(componentType: "metric")
listComponentUsage(componentType: "calculatedMetric")
```

Note: `listComponentUsage` may return an empty list for data views with no
usage history. If it returns empty, fall back to:
```
findMetrics(searchQuery: "sessions visits revenue orders")
findMetrics(searchQuery: "page views cart conversion")
```
Pick the most business-relevant metrics from the results (sessions, orders,
revenue, product views, cart views, people — in that priority order).

Deduplicate: if a built-in metric and a calculated metric measure the same
thing, keep only the calculated metric (it's more intentional).

Final list: 5–8 metrics. More than 8 KPIs in a pulse report is noise.

---

## Phase 2 — Pull Current and Prior Period Data

Run a single `runReport` call per period with all KPI metrics included.
Use one call for Period A and one for Period B to minimize round-trips.
Use a summary dimension (e.g., `variables/daterangeday`) and limit: 1 to
get aggregate totals from `summaryData.totals` in the response.

```
runReport(
  dimensionIds: "variables/daterangeday",
  metricIds: "metrics/visits,metrics/visitors,metrics/orders_1_1,metrics/productListItems.priceTotal,metrics/cart_views",
  startDate: "<periodA start>T00:00:00",
  endDate: "<periodA end>T23:59:59",
  page: 0,
  limit: 1
)
```

```
runReport(
  dimensionIds: "variables/daterangeday",
  metricIds: "metrics/visits,metrics/visitors,metrics/orders_1_1,metrics/productListItems.priceTotal,metrics/cart_views",
  startDate: "<periodB start>T00:00:00",
  endDate: "<periodB end>T23:59:59",
  page: 0,
  limit: 1
)
```

Read aggregate totals from `summaryData.totals` (not row data), which
gives you the full-period sum for each metric in the order they were listed.

Capture for each metric:
- `valueA` (current period)
- `valueB` (comparison period)
- `delta` = valueA − valueB
- `pctChange` = (delta / valueB) × 100, rounded to 1 decimal

---

## Phase 3 — Classify Trends

For each KPI, assign a trend indicator:
- **↑ Up** if pctChange > +3%
- **↓ Down** if pctChange < −3%
- **→ Flat** if −3% ≤ pctChange ≤ +3%

Assign a signal color:
- For "higher is better" metrics: ↑ = green, ↓ = red, → = grey
- For "lower is better" metrics (bounce rate, error rate): ↑ = red, ↓ = green

---

## Phase 4 — Top Mover Drill-Down

For the 1–2 metrics with the largest absolute % change, find what's driving
the movement. Run a dimension breakdown for the current period:

```
runReport(
  dimensionIds: "variables/marketing_channel",
  metricIds: "<moving metric id>",
  startDate: "<periodA start>T00:00:00",
  endDate: "<periodA end>T23:59:59",
  page: 0,
  limit: 5
)
```

Note: Use `variables/marketing_channel` (not `variables/marketingchannel`) — 
verify the exact dimension ID with `findDimensions(searchQuery: "marketing channel")`
if unsure.

Compare dimension values between Period A and Period B to identify the top
contributor to the change. This becomes the "What drove it" entry in the report.

---

## Phase 5 — Generate HTML Report

Generate the KPI Pulse HTML report INLINE — do not use a Python script.
Build the HTML string directly from the collected data and output it as a
code block the user can save, or write it to `/tmp/cja_kpi_pulse_report_<YYYY-MM-DD_HHMMSS>.html`
using a one-line bash command.


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


### HTML Template

Read [`template.html`](template.html) and use it verbatim. Do not improvise the
HTML structure or CSS — only fill in the `{PLACEHOLDER}` tokens (`{ORG_NAME}`,
`{PERIOD_LABEL}`, `{COMPARISON_LABEL}`, `{DATA_VIEW}`, `{GENERATED_DATE}`,
`{METRIC_NAME}`, `{FORMATTED_VALUE_A}`, `{FORMATTED_VALUE_B}`, `{PCT_CHANGE}`,
`{VALUE_A}`, `{VALUE_B}`, `{DELTA}`, `{ARROW}`) and repeat the KPI tile / detail
row / mover row blocks once per data item. Preserve the `.up | .down | .flat`
and `.green | .red | .yellow | .grey` modifier classes per the trend rules in
Phase 3.


---

## Phase 6 — Deliver the Report

After generating the HTML:
1. Write it to `/tmp/cja_kpi_pulse_report_<YYYY-MM-DD_HHMMSS>.html`
2. Open with `open /tmp/cja_kpi_pulse_report_<YYYY-MM-DD_HHMMSS>.html`
3. Provide a 3–5 line text summary inline in the chat:

```
KPI Pulse — This Week vs Last Week

↑ Revenue: $1.24M (+8.2%)  — Paid Search drove most of the gain
↓ Conversion Rate: 2.1% (−0.4pp) — Drop in mobile checkout
→ Sessions: 540K (+1.1%)  — Flat week-over-week
↑ Orders: 11,340 (+6.7%)  — Product page improvements appear to be working
↓ Bounce Rate: 43.2% (+2.1pp) — Worth monitoring next week
```

The text summary gives immediate value even without opening the HTML file.

---

## Important Guardrails

- **Read-only monitoring.** Never modify metrics, segments, or projects.
- **Use consistent date ranges.** Week-over-week and month-over-month comparisons must use equal-length periods.
- **Flag anomalies, don't diagnose them.** The pulse report surfaces significant deviations — deep root cause analysis belongs in the anomaly triage skill.
- **Respect business calendar.** Holiday periods, campaigns, and seasonal patterns affect normal variance — note context when flagging anomalies.
- **Cap metric count.** Monitor up to 10–15 KPIs per pulse; more than that dilutes focus. Ask the user to prioritize if they specify too many.
- **Note data freshness.** If the most recent data point is older than expected, warn the user before presenting the pulse.

## Example Interaction

> "Give me a quick pulse on our key metrics for this week."

1. **Setup:** Confirm data view with `findDataViews`. User selects their main data view. Call `setDefaultSessionDataViewId`.
2. **Scope:** Ask "Which KPIs should I include?" User says: "Sessions, Revenue, Conversion Rate, and Average Order Value."
3. **Data pull:** Run `runReport` for current week vs. prior week for all four metrics.
4. **Analysis:** Sessions +8% WoW (within normal range). Revenue +3% WoW. Conversion Rate -12% WoW — flagged as anomalous. AOV +17% WoW — notable positive.
5. **Summary:** Present a KPI scorecard with traffic-light status (green/yellow/red), highlight the Conversion Rate drop as needing investigation, and note that the AOV increase partially offsets it.

## Error Handling

- If `runReport` returns no data for Period B (comparison is too far in the
  past or data view lacks history), show "N/A" for the delta and flag it with
  a grey badge.
- If a metric returns null, display "—" rather than 0 to avoid false
  impressions of zero performance.
- If fewer than 3 metrics are available, warn the user that the pulse may be
  incomplete and suggest they verify the data view is correctly configured.
