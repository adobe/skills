---
name: cja-segment-performance-comparator
description: >
  Compares the performance of two or more audience segments across key metrics
  side by side. Use this skill when someone wants to compare audiences, cohorts,
  or groups — for example, "how do mobile users compare to desktop users on
  conversion," "compare new vs. returning visitors," "show me the difference
  between these two segments," "compare these audiences on our KPIs," or
  "which segment performs better." Also trigger for "segment comparison,"
  "audience comparison," or "cohort comparison."
license: Apache-2.0
metadata:
  author: Adobe
  version: "1.0"
---

# Segment Performance Comparator (Customer Journey Analytics)

Compare 2–5 audience segments across a set of key metrics in a side-by-side
matrix. The output tells the user not just what each segment looks like in
isolation, but which segment wins or loses on each metric — and which
differences are large enough to act on.

This skill answers the question "which audience should we focus on?" with data.
Segment comparisons drive product decisions, personalization strategy, and
budget allocation — so clarity and actionability matter more than exhaustive data.

---

## CJA MCP Tools Used

- `findSegments` — search for segments by name or keyword
- `describeSegment` — understand the logic of candidate segments before using them
- `findMetrics` — resolve base metric IDs
- `findCalculatedMetrics` — include custom KPIs in the comparison
- `listComponentUsage` — identify the most-used metrics as default comparison set
- `runReport` (with `segmentIds` or `adhocSegments`) — pull metric values per segment

---

## Phase 0 — Setup

1. Call `findDataViews` to list available data views.
2. If the user hasn't specified a data view, present the list and ask which to use.
3. Call `setDefaultSessionDataViewId` with the chosen ID.
4. Ask the user which segments to compare if not already specified. Confirm the metrics to compare them on.

---

## Phase 1 — Identify Segments to Compare

### 1.1 From user description

If the user named specific segments, resolve them:
```
findSegments(search: "<segment name>")
```

For each match, call `describeSegment` to verify it is the correct one:
```
describeSegment(segmentId: "<id>")
```

Show the segment definition summary to the user if there is ambiguity:
> "I found two segments matching 'mobile users': **Mobile Visitors (All Devices)**
> and **Mobile App Users**. Which do you want to compare?"

### 1.2 From plain-English descriptions

If the user says "compare mobile vs desktop users" but there are no matching
segments, offer to create ad hoc segments inline for the comparison:
> "I don't see pre-built segments for mobile and desktop. I can create
> temporary ad hoc segments for this comparison using device type. Should I
> proceed with ad hoc segments, or would you like to create permanent segments
> first?"

Ad hoc segments are constructed using `adhocSegments` in `runReport` — no
save required for the comparison itself.

### 1.3 Segment count limit

Maximum 5 segments for a single comparison. More than 5 creates a matrix
that is too wide to read meaningfully. If the user requests more, say:
> "I'll limit to the 5 most relevant segments for readability. Would you like
> me to prioritize by usage count or stick with your list order?"

---

## Phase 2 — Identify Metrics to Compare

### 2.1 From user specification

Resolve named metrics via `findMetrics` and `findCalculatedMetrics`.

### 2.2 Default metric discovery

If the user did not specify metrics, pull the top metrics by usage. The
`listComponentUsage` tool does not support a `limit` parameter — it returns all
components ranked by usage count; take the top 6–8 from the result:
```
listComponentUsage(componentType: "metric")
listComponentUsage(componentType: "calculatedMetric")
```

Prefer calculated metrics over raw base metrics when they measure the same
thing — calculated metrics reflect intentional KPI definitions.

### 2.3 Metric selection for a comparison

Good comparison metrics should be meaningful across all segments. For example,
"Revenue" is meaningful for both mobile and desktop users; "App Installs" is
only meaningful for mobile. Remove metrics that would be trivially zero for
one segment.

If unsure, ask: "Should I use your standard KPI set, or focus on specific
metrics like conversion rate, revenue, and engagement?"

---

## Phase 3 — Run the Comparison

For each segment, run a `runReport` with that segment applied and all
comparison metrics included. Note that `runReport` takes `metricIds` as a
comma-separated string, `startDate`/`endDate` (not `dateRange`), and a
`dimensionIds` (required even for summary-only reports — use a low-cardinality
dimension like `variables/daterangeday` or `variables/web.webPageDetails.name`).
The summary totals for all metrics are in `summaryData.filteredTotals`:

```
runReport(
  dimensionIds: "variables/web.webPageDetails.name",
  metricIds: "metrics/visits,metrics/revenue_1,metrics/orders_1_1",
  startDate: "<period start>T00:00:00",
  endDate: "<period end>T23:59:59",
  page: 0,
  limit: 1,
  segmentIds: "<segment id>"
)
```

For ad hoc segments, use the full CJA segment definition object:
```
runReport(
  dimensionIds: "variables/web.webPageDetails.name",
  metricIds: "metrics/visits,metrics/orders_1_1",
  startDate: "<period start>T00:00:00",
  endDate: "<period end>T23:59:59",
  page: 0,
  limit: 1,
  adhocSegments: [{
    "func": "segment",
    "version": [1, 0, 0],
    "container": {
      "func": "container",
      "context": "visitors",
      "pred": {
        "func": "streq",
        "val": { "func": "attr", "name": "variables/device_type" },
        "str": "Mobile Phone"
      }
    }
  }]
)
```

Read metric totals from `summaryData.filteredTotals[i]` where `i` is the
0-based index of the metric in the `metricIds` string.

Run one report per segment. Collect all results into a matrix:
- Rows = metrics
- Columns = segments

---

## Phase 4 — Build the Comparison Matrix

For each cell (metric × segment):
- `value[metric][segment]` = raw metric value from `runReport`

For each metric row:
- `winner` = segment with the highest value (or lowest, for "lower is better" metrics)
- `loser`  = segment with the lowest value (or highest, for inverse metrics)
- `range`  = (max − min) / max × 100 — the spread across segments as a percentage
- `significant` = true if range > 10% (a meaningful difference worth acting on)

---

## Phase 5 — Generate HTML Comparison Report

Generate the report inline and write to
`/tmp/cja_segment_performance_comparator_report_<YYYY-MM-DD_HHMMSS>.html`.


### HTML Template

Read [`template.html`](template.html) and use it verbatim. Do not improvise the
HTML structure or CSS — only fill in the `{PLACEHOLDER}` tokens (`{ORG_NAME}`,
`{DATE_RANGE}`, `{DATA_VIEW}`, `{GENERATED_DATE}`, `{SEGMENT_NAMES_SUMMARY}`,
`{SEGMENT_NAME}`, `{COLOR}`, `{VISITOR_COUNT}`, `{NUM_SEGMENTS}`, `{NUM_METRICS}`,
`{NUM_SIGNIFICANT}`, `{OVERALL_WINNER}`, `{METRIC_NAME}`, `{VALUE}`,
`{WINNER_SEGMENT}`, `{SPREAD}`, `{INSIGHT_TEXT}`) and repeat segment chips,
matrix rows, and insight boxes once per data item. Use the `cell-winner` /
`cell-loser` classes per Phase 4 winner/loser rules.

---

## Phase 6 — Narrative Insights

After building the matrix, generate 3–5 insight bullets for the Insights section:

1. **Overall Winner**: "Returning Visitors outperform New Visitors on 5 of 7
   metrics, with the largest gap in Revenue per Session (+82%)."
2. **Most Significant Difference**: "The biggest gap is Conversion Rate: Mobile
   converts at 1.2% vs Desktop at 3.8% — a 68% gap worth prioritizing."
3. **Surprising Parity**: "New vs Returning Visitors show nearly identical
   Bounce Rates (42% vs 44%), suggesting landing page quality is consistent."
4. **Actionable Signal**: "Paid Search visitors have 2.3× higher Revenue per
   Session than Direct visitors — consider shifting budget toward Paid Search."
5. **Anomaly**: "One segment shows near-zero values across all metrics — verify
   that the segment definition is correct and matches the current data view."

Insights should be plain English, not metric IDs. Name the specific segments
and metric values.

---

## Workflow Summary

1. Resolve 2–5 segments (by name or ad hoc definition).
2. Identify 5–8 comparison metrics (from user or top usage).
3. Run one `runReport` per segment with all metrics; collect results.
4. Build comparison matrix: rows = metrics, columns = segments.
5. Mark winner/loser per row; compute spread; flag significant differences.
6. Generate HTML report with matrix and insight bullets.
7. Write to `/tmp/cja_segment_performance_comparator_report_<YYYY-MM-DD_HHMMSS>.html`.
8. Open with `open /tmp/cja_segment_performance_comparator_report_<YYYY-MM-DD_HHMMSS>.html`.
9. Deliver inline summary: which segment wins overall, biggest gap metric,
   one actionable recommendation.

---

## Important Guardrails

- **Read-only analysis.** Never delete or modify segments or calculated metrics.
- **Always confirm segments before running.** Ambiguous segment names (e.g., "Mobile" could be several) should be resolved by showing the user the matched segment IDs and definitions.
- **Use the same date range for all segments.** Comparisons across different time windows are misleading.
- **Note overlap between segments.** If two segments share substantial audience overlap, note it — the "difference" may be exaggerated.
- **Cap the number of segments compared.** Comparing more than 5–6 segments in a single report makes the output unreadable; ask the user to prioritize.
- **Distinguish statistical significance from practical significance.** A 0.1% difference is rarely actionable — focus on differences of 5%+ unless the user specifies otherwise.

---

## Example Interaction

> "Compare our mobile vs. desktop segment performance for last quarter."

1. **Setup:** Confirm data view. Call `findDataViews`, user selects. Call `setDefaultSessionDataViewId`.
2. **Segment resolution:** Call `findSegments` to locate the "Mobile Users" and "Desktop Users" segments. Show matched names and IDs to confirm. User approves.
3. **Metrics:** Ask "Which metrics should I compare?" User: "Sessions, Conversion Rate, Revenue, and Average Order Value."
4. **Analysis:** Run `runReport` for Q1 2026 with both segments applied. Tabulate results side-by-side.
5. **Findings:** Mobile: 45% of sessions, 2.1% CVR, $0.84 RPV. Desktop: 55% of sessions, 4.8% CVR, $2.10 RPV. Desktop converts 2.3× better. Present a comparison table and 3 recommended next steps.
