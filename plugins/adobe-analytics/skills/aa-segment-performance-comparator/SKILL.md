---
name: aa-segment-performance-comparator
description: >
  Compares the performance of two or more audience segments across key metrics
  side by side. Use this skill when someone wants to compare audiences or
  visitor groups — for example, "how do mobile visitors compare to desktop on
  conversion," "compare new vs. returning visitors," "show me the difference
  between these two segments," "compare these audiences on our KPIs," or
  "which segment performs better." Also trigger for "segment comparison" or
  "audience comparison."
license: Apache-2.0
metadata:
  author: Adobe
  version: "1.0"
---

# Segment Performance Comparator (Adobe Analytics)

Compare the performance of two or more audience segments across key metrics
side by side to understand how different visitor groups behave. Uses direct
segment-vs-segment comparison to determine a winner, loser, and spread for
each metric, with a separate context panel showing segment sizing.

> **AA Call Budget:** AA's `runReport` accepts a single `segmentId` per call.
> For N segments × M metrics the comparison requires N×M calls, plus 1
> baseline call for the segment-size context panel. For 3 segments × 5
> metrics = 16 calls. Limit to 4 segments and 6 metrics for practical
> performance. Always confirm the segment/metric list with the user before
> starting.

---

## AA MCP Tools Used

- `findReportSuites` — select report suite
- `setSessionDefaults` — set session context (reportSuiteId + globalCompanyId)
- `findSegments` — discover and select comparison segments
- `findMetrics` — resolve metric IDs
- `runReport` — one call per segment per metric, plus one unsegmented call for sizing context

---

## Phase 0 — Setup

1. Confirm report suite with `findReportSuites` / `setSessionDefaults`.

```
findReportSuites(globalCompanyId: "<gcid>", page: 0, limit: 10)
setSessionDefaults(globalCompanyId: "<gcid>", reportSuiteId: "<rsid>")
```

---

## Phase 1 — Select Segments

Ask the user which segments to compare. If not specified, prompt:
> "Which visitor audiences would you like to compare? For example:
> Mobile vs. Desktop, New vs. Returning, Paid Search vs. Organic, or
> specific named segments from your library."

Search for and confirm each segment:

```
findSegments(page: 0, limit: 50)
# Filter locally by name. Built-in IDs: "Paid_Search", "Purchasers", "Return_Visits"
```

> **Note:** `findSegments` does not accept a `searchTerm` parameter. Retrieve all segments
> and filter by name locally. Built-in template segments have short IDs like "Paid_Search"
> that can be passed directly as `segmentIds` in `runReport`.

If the user requests a segment that doesn't exist by name, offer to build
it first using the aa-segment-builder skill, or suggest the closest existing
segment from search results.

Limit: 4 segments maximum per comparison. Advise this limit upfront.

---

## Phase 2 — Select Metrics

Ask the user which metrics to compare. Suggest a balanced mix:

- **Volume:** `metrics/visits`
- **Engagement:** `metrics/pageviews`, `metrics/bouncerate`,
  `metrics/pagespervisit`
- **Conversion:** `metrics/orders`, conversion rate calculated metric
- **Revenue:** `metrics/revenue`

Call `findMetrics` to resolve each metric ID:

```
findMetrics(expansions: "componentType,categories", page: 0, limit: 200)
# Filter locally by name. Key IDs: metrics/visits, metrics/revenue, metrics/orders, metrics/bouncerate
```

Limit: 6 metrics maximum. Confirm the final list with the user:
> "I'll compare these 3 segments across 5 metrics. This requires 16 report
> calls (3 segments × 5 metrics + 1 sizing call). OK to proceed?"

---

## Phase 3 — Select Date Range

Ask for or confirm the analysis period:
- Last 7 days (good for quick comparison)
- Last 30 days (recommended default)
- Last 90 days (for seasonal smoothing)
- Custom range

---

## Phase 4 — Run Comparison Reports

### 4.1 Segment sizing (context only)

Run a single unsegmented call for `metrics/visits` to get the total
population size, then one call per segment for `metrics/visits` to
compute each segment's share of total. These sizing values populate the
context panel — they are **not** used in the comparison matrix.

```
runReport(
  dimensionId: "variables/page",
  metricIds: "metrics/visits",
  startDate: "<start>",
  endDate: "<end>",
  limit: 1
)
# allVisitorVisits = summaryData.totals[0]
```

```
runReport(
  dimensionId: "variables/page",
  metricIds: "metrics/visits",
  segmentIds: "<segmentId>",
  startDate: "<start>",
  endDate: "<end>",
  limit: 1
)
# segmentVisits = summaryData.totals[0]; shareOfTotal = segmentVisits / allVisitorVisits × 100
```

> Reuse these results if `metrics/visits` is already a comparison metric.

### 4.2 Per segment per metric

For each segment × metric combination:

```
runReport(
  dimensionId: "variables/page",
  metricIds: "<metricId>",          # note: "metricIds" not "metricId"
  segmentIds: "<segmentId>",        # note: "segmentIds" not "segmentId"
  startDate: "<start>",
  endDate: "<end>",
  limit: 1
)
# Total = summaryData.totals[0]
```

> Read totals from `summaryData.totals[0]` (not `rows[]`). `dimensionId` is required — use any dimension with `limit: 1` for aggregate totals. Segment IDs are the raw `id` field from `findSegments`.

Track progress: "Fetching Segment 2 of 3, metric 3 of 5..."

---

## Phase 5 — Build the Comparison Matrix

The matrix compares segments directly to each other — no baseline column.

For each metric row, compute:

| Computed Value | Formula |
|---|---|
| Segment value | Raw from `runReport` |
| Winner | Segment with the best value for this metric |
| Loser | Segment with the worst value for this metric |
| Spread | (max − min) / max × 100 |
| Significant? | `true` if spread > 10% |

For metrics where lower is better (bounce rate, cost per acquisition),
invert the winner/loser logic — the segment with the **lowest** value
wins. Mark these metrics clearly in the report.

### 5.1 Segment profile summary

For each segment, compute an overall performance profile:
- **Wins:** count of metrics where this segment ranks #1
- **Losses:** count of metrics where this segment ranks last
- **Biggest edge:** metric where this segment outperforms others by the widest spread
- **Visits share:** percentage of total visits from the context panel

---

## Phase 6 — Generate HTML Comparison Report

Build the comparison report inline and write to
`/tmp/aa_segment_comparator_report_<YYYY-MM-DD_HHMMSS>.html`.


### HTML template

Read [`template.html`](template.html) and use it verbatim. Do not improvise the
HTML structure or CSS — only fill in the `{PLACEHOLDER}` tokens (`{ORG_NAME}`,
`{DATE_RANGE}`, `{REPORT_SUITE}`, `{GENERATED_DATE}`, `{SEGMENT_NAMES_SUMMARY}`,
`{SEGMENT_NAME}`, `{COLOR}`, `{VISITOR_COUNT}`, `{NUM_SEGMENTS}`, `{NUM_METRICS}`,
`{NUM_SIGNIFICANT}`, `{OVERALL_WINNER}`, `{METRIC_NAME}`, `{VALUE}`,
`{WINNER_SEGMENT}`, `{SPREAD}`, `{INSIGHT_TEXT}`) and repeat segment chips,
matrix rows, and insight boxes once per data item. Use the `cell-winner` /
`cell-loser` classes per Phase 5 winner/loser rules.

**Section titles — no phase prefix**: Section headings in the HTML report must **not** include
the phase number. Use the plain section name only (e.g., "Segment Comparison" not "Phase 2 — Segment Comparison",
"Metric Details" not "Phase 3 — Metric Details").

Write to `/tmp/aa_segment_comparator_report_<YYYY-MM-DD_HHMMSS>.html` and open:

```bash
open /tmp/aa_segment_comparator_report_<YYYY-MM-DD_HHMMSS>.html
```

---

## Inline Summary (Always Deliver)

Always follow the HTML report with a text summary:

```
Segment Comparison — [Date Range] | Report Suite: [Name]

Segment Context:  Mobile 48,200 visits (38.7%)  Desktop 72,400 (58.2%)

                  Mobile   Desktop   Winner     Spread
────────────────  ───────  ────────  ─────────  ──────
Visits            48,200   72,400    Desktop    33%
Bounce Rate       61.4%    40.1% ✓  Desktop    35%  ✦
Conversion Rate    1.2%     3.1% ✓  Desktop    61%  ✦
Revenue           $9,400   $31,200   Desktop    70%  ✦

✦ = spread > 10%  ✓ = winner

Key findings:
- Desktop converts 2.6× better (3.1% vs 1.2%). Prioritize mobile checkout.
- Paid Search (not shown) has highest CVR at 4.8% — most efficient channel.
```

---

## Guardrails

- Confirm segments and metrics with the user before starting — the call
  count is N×M and can grow quickly.
- For bounce rate and other "lower is better" metrics, invert the winner
  logic — the segment with the **lowest** value wins. Label these metrics
  clearly in the report (e.g., "↓ lower is better").
- If a segment returns very few visits (< 1,000), note that results may
  not be statistically reliable.
- Do **not** show baseline delta percentages (segment vs. All Visitors)
  in the comparison matrix. Segments are subsets of the total population,
  so count-metric deltas are always negative and misleading. Use the
  context panel for segment sizing instead.

---

## Example Interaction

> "Compare our mobile and desktop visitors on conversion metrics."

1. Confirm report suite.
2. Find segments: "Mobile Devices" and "Desktop" (or offer to create them).
3. Confirm metrics: visits, bounce rate, orders, conversion rate, revenue.
4. Date range: last 30 days.
5. Preview: "2 segments × 5 metrics + 1 sizing call = 11 reports. Proceed?"
6. Run all reports; announce progress.
7. Context: Mobile = 48.2k visits (38.7%), Desktop = 72.4k visits (58.2%).
8. Matrix: Desktop wins 3 of 5 metrics. Conversion rate spread 61%.
9. Generate HTML report and open.
10. Insight: "Desktop is your primary conversion engine. Mobile drives
    volume (39% of visits) but converts at 1.2% vs. Desktop's 3.1% — a 61% spread.
    Prioritize mobile checkout optimization for the biggest conversion lift opportunity."
