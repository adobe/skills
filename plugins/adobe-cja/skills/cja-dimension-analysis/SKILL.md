---
name: cja-dimension-analysis
description: >
  Comprehensive dimension analysis and reporting for CJA. Use this skill whenever the user
  wants to analyze one or more dimensions — including cardinality, distribution/skew, trends,
  anomalies, data quality errors, comparisons, and forecasting. Also trigger when someone
  asks "what are the top values for...", "dimension health", "explore this dimension",
  "dimension dashboard", "dimension statistics", "data quality check on a dimension",
  "dimension cardinality", "dimension trends", "dimension skew", "dimension anomalies",
  "compare dimensions", or any similar request to understand what's inside a CJA dimension.
  Produces an interactive HTML dashboard or a markdown report. Works with the CJA MCP server.
license: Apache-2.0
metadata:
  author: Adobe
  version: "1.0"
---
# CJA Dimension Analysis

Analyze one or more CJA dimensions to understand their cardinality, distribution, trends,
anomalies, data quality issues, and forecasts. Produces an actionable report that helps
teams understand what's inside their dimensions and where to focus attention.

## Workflow

Execute phases in order. Each phase is **selectable** — the user can ask for a subset
(e.g., "just cardinality and errors") or the full analysis. Default is all phases.

### Phase 0 — Setup

1. Call `findDataViews` to list available data views. If the user hasn't specified one,
   ask which data view to analyze. Set it with `setDefaultSessionDataViewId`.
2. Ask which dimensions to analyze. Options:
   - **Named dimensions**: "Analyze Page Name and Browser Type"
   - **By ID**: user provides dimension IDs directly
   - **All dimensions**: warn that this may be slow; ask for a limit (default: top 50 by name)
3. Ask which analyses to run (or confirm "all" as the default):
   - Cardinality, Distribution/Skew, Trends, Anomalies, Data Quality, Comparisons, Forecasting
4. Ask for the date range. If the user hasn't specified one, test a few ranges to find data:
   - Try last 30 days, last 90 days, last 6 months, last year — use the first that returns rows.
5. Ask for the primary metric to use for distribution/skew (default: occurrences or visits).
6. Confirm the plan with the user before proceeding.

### Phase 1 — Cardinality

For each dimension:

1. Call `searchDimensionItems(dimensionId, limit: 50000)` to estimate unique value count,
   or `runReport` with the dimension as rows and a count metric to get row count.
2. Classify cardinality:
   | Level | Threshold |
   |-------|-----------|
   | LOW | < 100 unique values |
   | MEDIUM | 100 – 1,000 |
   | HIGH | 1,000 – 10,000 |
   | VERY HIGH | > 10,000 |
3. Track cardinality over time (optional): `runReport` with dimension + date breakdown;
   count unique dimension values per day/week to see cardinality growth trend.
4. Flag HIGH and VERY HIGH dimensions with performance recommendations.

Store: `{dimensionId, name, uniqueValueCount, cardinalityLevel, cardinalityTrend}`

### Phase 2 — Distribution & Skew

For each dimension:

1. `runReport` with dimension as rows + primary metric (e.g., occurrences/visits).
   Request at least 50 rows to capture the distribution shape.
2. Compute top-N % share (top 1, 5, 10), Gini coefficient, and cumulative distribution.
3. Classify skew:
   | Label | Condition |
   |-------|-----------|
   | **Extreme skew** | Top 1 value > 50% of total |
   | **High skew** | Top 1 value > 30% of total |
   | **Moderate** | Top 5 values < 70% of total |
   | **Long tail** | Top 10 values < 50% of total |
4. Note: per-value breakdown with percentage and cumulative %.

Store: `{dimensionId, distribution: [{value, metric, pct, cumulative}], gini, skewLabel, top1Pct, top5Pct, top10Pct}`

### Phase 3 — Trends

For each dimension:

1. `runReport` with dimension + date granularity (day or week depending on range).
   Compare two periods: first half vs second half of the selected date range.
2. Identify:
   - **New values**: appeared in period 2 but not period 1
   - **Disappeared values**: present in period 1, absent in period 2
   - **Growth**: metric in period 2 > metric in period 1 by > 10%
   - **Decline**: metric in period 2 < metric in period 1 by > 10%
   - **Stable**: < 10% change between periods
3. Assign trend badges per value: 🟢 Growing | 🔴 Declining | 🟡 Stable | 🆕 New | ⬜ Disappeared

Store: `{dimensionId, periodComparison: {period1, period2, changes: [{value, p1Metric, p2Metric, pctChange, badge}]}, newValues: [], disappearedValues: []}`

### Phase 4 — Anomalies

For each dimension:

1. From the Phase 3 time-series, compute rolling mean and stddev per dimension value.
2. **Z-score detection**: flag (value, date) pairs where the z-score exceeds the threshold
   (default: 2.0; sensitive: 1.5; conservative: 3.0).
3. **Threshold alerts**:
   - Any single value holding > 50% of total metric on a given day
   - Value count that is > 2× the rolling average for that value
4. **New/disappeared alerts**: flag values that appear or disappear mid-period (from Phase 3).
5. Collect: anomaly type (spike, drop, new, disappeared, threshold), dimension value, date, magnitude.

Store: `{dimensionId, anomalies: [{value, date, type, magnitude, zScore}]}`

### Phase 5 — Data Quality / Errors

For each dimension:

1. Search for known bad values using `searchDimensionItems`:
   - `"Unspecified"`, `"None"`, `"(empty)"`, `""`, `"null"`, `"undefined"`, `"N/A"`, `"unknown"`
2. Count occurrences with `runReport` filtering to each known bad value.
3. Compute: missing data % = (sum of bad value occurrences) / total occurrences.
4. Flag: dimensions where missing data > 5% (warning), > 20% (critical).
5. If the dimension has an expected format (URL, email, date), note it — but don't auto-validate
   patterns unless the user asks.

Store: `{dimensionId, errorPatterns: [{pattern, count, pct}], missingDataPct, missingDataSeverity}`

### Phase 6 — Comparisons (multi-dimension or time-period)

This phase runs when the user is analyzing 2+ dimensions OR requests period comparison.

**Side-by-side (2–3 dimensions):**
1. For each dimension pair, compare cardinality level, skew, top-5 values, error rate.
2. Produce a comparison table: dimension A vs B vs C on each metric.

**Time-period comparison (single dimension):**
1. Compare two custom date ranges provided by the user (or auto-detect: first half vs second half).
2. For each value: metric in period 1, metric in period 2, delta, % change.
3. Surface the biggest movers (top 5 growing, top 5 declining).

Store: `{comparisons: [{type, dimensions or periods, table}]}`

### Phase 7 — Forecasting

For each dimension with sufficient time-series data (>= 7 data points):

1. For the top 5–10 values by metric, fit a linear regression to the time series.
2. Project 7 periods forward.
3. Report:
   - Trend direction: Upward / Downward / Flat (based on slope)
   - Confidence: High (R² > 0.7), Medium (0.4–0.7), Low (< 0.4)
   - Projected value at end of forecast window
4. Flag values with strong upward trend (might become dominant) or strong downward trend
   (might disappear soon).

Store: `{dimensionId, forecasts: [{value, slope, r2, direction, confidence, projectedValues: []}]}`

### Phase 8 — Report Generation

After all analysis phases complete:

1. Save all collected data to a JSON file:
   `dimension_analysis_results_YYYY-MM-DD_HH-MM.json`
   (in a temp output directory, e.g. `/tmp/cja-dimension-analysis/`, or a path the user specifies)

2. Run the Python report generator:
   ```bash
   python3 scripts/cja_dimension_analysis.py \
     <analysis_json> \
     "<data_view_name>" \
     "<data_view_id>" \
     [output_directory] \
     [--format=html|markdown] \
     [--keep-analyses=N]
   ```

   **Options:**
   - `--format=html` (default): Interactive HTML dashboard with Chart.js visualizations
   - `--format=markdown`: Comprehensive text-based report with tables
   - `--keep-analyses=N` (default: 0 = keep all): Auto-cleanup of old analysis files

3. The script generates a second output file: the report (HTML or markdown).

4. Open with `open <output_directory>/dimension_analysis_report_*.html`
5. Present the report path to the user and summarize key findings:
   - Dimensions with HIGH/VERY HIGH cardinality
   - Dimensions with extreme or high skew
   - Any anomalies found
   - Data quality issues above warning threshold
   - Forecast trends worth watching

## CJA MCP Tools Used

| Tool | Phase | Purpose |
|------|-------|---------|
| `findDataViews` | 0 | List available data views |
| `setDefaultSessionDataViewId` | 0 | Set active data view for session |
| `findDimensions` | 0 | Discover dimensions by name/search |
| `describeDimension` | 0 | Get dimension metadata and ID |
| `searchDimensionItems` | 1, 5 | Count unique values; search for specific items (error patterns) |
| `runReport` | 1–7 | Primary data engine: dimension rows + metric, with optional date breakdown |

## Output Format

### HTML Dashboard (default)

Interactive report with:
- Executive summary cards (total dimensions, flagged dimensions, critical issues)
- Per-dimension sections: cardinality badge, distribution chart (Chart.js bar), skew metrics,
  trend table, anomaly list, data quality indicators
- Comparison section (if multiple dimensions or period comparison requested)
- Forecast section (if forecasting was run)
- Recommendations panel: grouped by priority (critical → warning → info)
- Design: dark navy-to-blue gradient header, full-width, card-based layout, collapsible sections

### Report HTML Style — Required

The generated HTML **must** use the editorial design system shared across all skills:
warm off-white surface, serif display title, red-on-black gradient header, and
underline-on-hover text-link nav. Do **not** introduce corporate-blue chrome,
centered headers, or alternative gradients.

Read [`template.html`](template.html) and use it verbatim. It contains the
Google Fonts `<link>` tags, the full CSS block, and the `<header>` structure.
Paste the `<head>` block into the generated report's `<head>`, paste the
`<header>` block at the top of `<body>`, and fill in the `{ORG_NAME}`,
`{DIMENSION_COUNT}`, `{DATE_RANGE}`, `{DATA_VIEW_NAME}`, and `{DATE}`
placeholders. Do not improvise the styling.


Where `{ORG_NAME}` is the customer's brand name (with technical suffixes like
` — Prod`, ` - Demo`, ` MCP`, ` Stage` stripped). Never substitute a vendor or
product name into the title. The title is all white — do not color any word red.
For single-dimension reports, replace the h1 with `{ORG_NAME} {DIMENSION_NAME} Report`.

**Section titles — no phase prefix**: Section headings in the HTML report must **not** include
the phase number. Use the plain section name only:
- ✅ "Cardinality" — not "Phase 1 — Cardinality"
- ✅ "Distribution & Skew" — not "Phase 2 — Distribution & Skew"
- ✅ "Trends" — not "Phase 3 — Trends"
- ✅ "Data Quality" — not "Phase 5 — Data Quality / Errors"

### Markdown Report

Text-based report with:
- Summary table across all dimensions
- Per-dimension deep-dive sections with inline tables
- Anomaly log
- Recommendations with rationale

The JSON schema consumed by `scripts/cja_dimension_analysis.py` is derived from the
`Store: {...}` shapes in each phase above. The script knows its own input contract;
build the JSON to match the per-phase Store entries.

## Example Interaction

> "Can you analyze how our 'Marketing Channel' dimension is performing and break it down by device type?"

1. **Setup:** Confirm the data view with `findDataViews`. Call `setDefaultSessionDataViewId`.
2. **Dimension discovery:** Call `findDimensions` to locate the 'Marketing Channel' dimension and its ID. Confirm it exists and has data with `searchDimensionItems`.
3. **Analysis:** Run `runReport` for Marketing Channel performance over the last 30 days (visits, conversions, revenue). Identify top and bottom performers.
4. **Breakdown:** Run a second report cross-tabbing Marketing Channel by Device Type dimension to surface mobile vs. desktop patterns.
5. **Report:** Run the Python analysis script to generate an interactive HTML report. Open it. Summarize top findings: "Email drives 38% of conversions despite only 12% of traffic. Paid Search converts 2× better on mobile than desktop."

## Important Guardrails

- Never modify dimension definitions or project data. This is read-only analysis.
- If a dimension returns no data for the selected date range, try a broader range before giving up.
- For VERY HIGH cardinality dimensions (> 50k values), note that full distribution analysis
  may be truncated — use sampled top-N values.
- If `runReport` times out on a dimension, reduce the row limit and note the limitation.
- Always tell the user which analyses are being run and which were skipped.
- For large dimension sets (> 20 dimensions), run phases 1–2 first and ask if the user wants
  to proceed with deeper analysis on a subset.
- Let the user know progress as you move through phases: "Phase 1 complete (cardinality for 5
  dimensions). Running Phase 2 (distribution)..."
