---
name: aa-executive-briefing
description: >
  Generates a concise, executive-ready performance summary covering key metrics,
  trends, and what's driving movement. Use this skill when someone needs to
  produce a briefing, executive summary, performance narrative, or stakeholder
  readout — for example, "write an exec summary of last week's performance,"
  "create a performance briefing for our leadership team," "produce a monthly
  business review summary," "what should I tell executives about our metrics,"
  or "generate a performance narrative." Also trigger for "QBR summary,"
  "weekly business review," or "stakeholder briefing."
license: Apache-2.0
metadata:
  author: Adobe
  version: "1.0"
---

# Executive Briefing (Adobe Analytics)

Generate a concise, executive-ready performance summary with narrative
context, metric highlights, and key drivers. Designed for leadership
audiences — no raw data dumps, just clear signals and business implications.

> **Key parameter facts validated during implementation:**
> - `runReport` → `metricIds` (plural), not `metricId`; dates as `YYYY-MM-DDTHH:mm:ss`
> - `findMetrics` → `expansions` is a **required** parameter (use `"componentType"`)
> - `describeAa` → parameter is `guideType`, not `guide`; `REPORT_SUITE_CONTEXT_GUIDE`
>   may return empty for some report suites — skip gracefully and proceed
> - `metrics/uniquevisitors` is often unauthorized — use `metrics/visits` instead
> - `setSessionDefaults` is the correct tool name (not `setDefaultReportSuite`)

---

## AA MCP Tools Used

- `findReportSuites` — select report suite
- `setSessionDefaults` — set session context (reportSuiteId + globalCompanyId)
- `describeAa(guideType: "REPORT_SUITE_CONTEXT_GUIDE")` — load org context;
  note: may return no output for some report suites — proceed without it
- `findMetrics(expansions: "componentType")` — resolve metric IDs (expansions
  parameter is **required**)
- `listComponentUsage(componentType: "metric")` — identify most-used metrics
  if not specified by the user
- `runReport` — current and comparison period with all metrics batched in one
  call (`metricIds` accepts comma-separated IDs); dimension breakdowns for top movers
- `searchDimensionItems` — validate dimension values for driver callouts

---

## Phase 0 — Setup

1. Confirm report suite.
2. Load organizational context:

```
findReportSuites()
setSessionDefaults(reportSuiteId: "<rsid>", globalCompanyId: "<companyId>")
describeAa(guideType: "REPORT_SUITE_CONTEXT_GUIDE")   # may return empty — proceed if so
```

Use the context guide to understand:
- The organization's name and industry
- Which metrics are most used (top KPIs)
- **Calendar conventions and timezone.** Record these values — they are
  inputs to every date computation in Phase 1:
  - `WEEK_START_DOW` — day of week each week starts on. Default: **Monday**
    (ISO 8601).
  - `FISCAL_YEAR_START_MONTH` — month the fiscal year begins. Default:
    **January** (calendar year).
  - `TIMEZONE` — for example, `America/Los_Angeles`.
  - `CALENDAR_SOURCE` — one of `"context guide"`, `"default fallback"`, or
    `"user override"`.
- Any active report suite segments

---

## Phase 1 — Clarify the Briefing

Ask the user:

1. **Period** — "What time period should this briefing cover?"
   - Last week
   - Last month
   - Month-to-date (MTD)
   - This quarter / QTD
   - Last quarter
   - Custom date range

#### The principle

Two runs of this skill on the same report suite, period type, and prompt MUST
produce identical `current` and `comparison` date ranges. Determinism comes
from (a) reading calendar conventions from Phase 0 instead of improvising, and
(b) applying the alignment rule for the period type without taste calls.

#### Period type → alignment rule

Pick exactly one period type from the user's request:

| User request | `PERIOD_TYPE` | Current period | Comparison period |
|---|---|---|---|
| "last week" | `weekly` | Most recent full week ending before today, aligned to `WEEK_START_DOW` (exactly 7 days) | The week immediately before, same alignment |
| "this month" / "MTD" | `month-to-date` | 1st of current month → today | 1st of prior month → same day-of-month as today |
| "last month" | `monthly` | Prior full calendar month | The month before that |
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

Assumes `WEEK_START_DOW = Sunday` and `FISCAL_YEAR_START_MONTH = January`. Numbers change for other calendars — that's the point.

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

2. **Audience** — "Who is this briefing for?"
   - C-suite / board (highest level, fewest metrics, most context)
   - VP/Director level (more detail, some dimension context)
   - Marketing leadership (channel and campaign focus)
   Default: C-suite tone (concise, business-focused).

3. **North-star metric** — "What is the single most important metric for
   this briefing?" (e.g., revenue, conversions, retention rate)
   If not specified, use the most-used metric from `listComponentUsage`.

4. **Supporting metrics** — "What other metrics should be included? (up to 5)"

5. **Specific topic focus** — "Is there anything you want to highlight or
   investigate? (e.g., mobile performance, campaign results)"

---

## Phase 2 — Resolve Metrics

```
findMetrics(expansions: "componentType")  # expansions required
listComponentUsage(componentType: "metric")  # if metrics not specified
```

> **Important:** `findMetrics` requires the `expansions` parameter (use `"componentType"`
> as a safe default). Without it the call will fail.
>
> **Avoid `metrics/uniquevisitors`** — this metric is frequently restricted and returns
> an "unauthorized_metric" error. Prefer `metrics/visits` for audience size.
>
> **Reliable standard metrics for AA briefings:** `metrics/pageviews`, `metrics/visits`,
> `metrics/orders`, `metrics/revenue`, `metrics/bouncerate`, `metrics/occurrences`

### Deterministic selection — do not improvise

The KPI set MUST be reproducible across runs. Two runs of this skill on the same
report suite + period must produce the same metric values, which requires
selecting the **same metric IDs** every time. Follow this algorithm exactly:

1. If the user named metrics explicitly, resolve each to ONE specific metric ID
   via `findMetrics`. On ambiguity, pick the metric with the highest `usageCount`
   from `listComponentUsage` and document the choice.
2. Otherwise, take `listComponentUsage(componentType: "metric")` results, sort by
   `usageCount` descending with metric ID alphabetical as the tiebreak (stable
   secondary sort), and take the top **6 metric IDs**.
3. Use `describeMetric` to resolve to display names.
4. Do NOT cherry-pick by metric "type" (volume vs conversion vs revenue) and
   do NOT swap in an alternative metric because its name reads better in the
   narrative. Different runs picking `metrics/orders` vs a calculated metric
   also called "Orders" produce wildly different numbers and break trust.

### Always disclose the metric IDs used

Include a "Metrics included" line in the briefing artifact's footer listing
the resolved metric IDs. This makes the report auditable and lets the user
confirm a re-run is using the same metrics.

Record metric IDs and display names. Limit to 6 metrics total.

---

## Phase 3 — Fetch Performance Data

Batch all metrics into a single `runReport` call per period:

```
runReport(
  dimensionId: "variables/daterangeday",
  metricIds: "<metricId1>,<metricId2>,<metricId3>,...",
  startDate: "<YYYY-MM-DDTHH:mm:ss>",
  endDate:   "<YYYY-MM-DDTHH:mm:ss>"
)
```

> **Critical:** The `runReport` parameter is `metricIds` (plural), not `metricId`.
> It accepts comma-separated IDs — pass all metrics in one call.
> Dates must be ISO 8601 with time component: `2026-03-31T00:00:00` / `2026-04-06T23:59:59`.
> Use `variables/daterangeday` as `dimensionId` to get a day-by-day breakdown;
> totals for each metric are in `summaryData.totals[0]`, `totals[1]`, etc. in order.
> If a metric is unauthorized, it surfaces in `columnErrors` — the overall call still succeeds.

For 6 metrics: 2 calls total (current period + comparison period).

From each pair compute:
- Current total
- Prior total
- Absolute and percent delta
- Trend direction (up/flat/down)

---

## Phase 4 — Driver Context

For the north-star metric and any metric with a change > ±10%, run a
marketing channel breakdown to find what drove the movement:

```
runReport(
  metricIds: "<northStarMetricId>",
  dimensionId: "variables/marketingchannel",
  startDate: "<current period start>T00:00:00",
  endDate: "<current period end>T23:59:59",
  limit: 8
)
```

Run the same for the comparison period if needed to identify share shift.

Also check device type if the user mentioned mobile:

```
runReport(
  metricIds: "<northStarMetricId>",
  dimensionId: "variables/mobiledevicetype",
  startDate: "<current period start>T00:00:00",
  endDate: "<current period end>T23:59:59",
  limit: 5
)
```

---

## Phase 5 — Write the Narrative

Compose the executive briefing as a structured narrative, not a data table.
Tone: confident, clear, forward-looking. Avoid jargon. Use business language.

### Narrative structure

1. **Opening headline** — 1 sentence capturing the period's overall result.
   "Q2 performance was strong, with revenue growing 14% and conversion rates
   reaching a 12-month high."

2. **North-star metric** — 2–3 sentences on the most important KPI:
   value, change, context, what drove it.

3. **Supporting highlights** — 1 sentence per additional metric (positive
   first, then concerns).

4. **Key driver** — 2 sentences identifying what primarily caused movement.
   "Paid Search drove 60% of revenue growth, up from 48% in the prior period.
   Email performance also improved materially with a 22% lift in conversions."

5. **Risk or watch item** — 1–2 sentences on anything concerning:
   "Bounce rate on mobile increased 4pp, suggesting friction in the mobile
   experience worth investigating."

6. **Forward look / ask** — optional: what does this imply for next period?

---

## Phase 6 — Generate HTML Briefing Document

Build the executive briefing HTML and write to
`/tmp/aa_executive_briefing_<YYYY-MM-DD_HHMMSS>.html`.


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


### HTML template

### Template variables

Populate every `{PLACEHOLDER}` in the HTML template below using these rules.
The briefing belongs to the customer — never substitute Adobe, AA, or any
vendor language into customer-visible fields.

- **`{ORG_NAME}`** — The customer's business or brand name, derived from the
  report suite context loaded in Phase 0. Strip technical/environment suffixes
  like ` — Prod`, ` - Demo`, ` Stage`, ` Test`, ` MCP`. If the report suite
  name has no clean brand label, fall back to the report suite display name
  with suffixes removed. Do **not** invent a name and do **not** substitute a
  vendor name.
- **`{PERIOD_TYPE}`** — One of `Weekly`, `Monthly`, `Quarterly`, or
  `Performance` (default), chosen from the period inferred in Phase 1.
- **`{LEDE_SENTENCE}`** — Use exactly this pattern, with no vendor names:
  `Leadership readout for the {period type lowercase} of {PERIOD_LABEL} compared to {COMPARISON_LABEL}.`
- **`{REPORT_SUITE}`** — Report suite display name. Suffixes are acceptable
  here — this row is the technical identifier line, not the title.
- **`{PERIOD_LABEL}`** / **`{COMPARISON_LABEL}`** — Human-readable date ranges,
  e.g., `May 12–18, 2026`.
- **`{GENERATED_DATE}`** — Today's date in the same human format.
- **`{METRIC_LABEL}` / `{FORMATTED_VALUE}` / `{PCT_CHANGE}` / `{PRIOR_VALUE}`** —
  Per-KPI values from Phase 3. Use the metric's customer-facing display name,
  not its internal ID.

### HTML Template

Read [`template.html`](template.html) and use it verbatim. Do not improvise the
HTML structure or CSS — only fill in the `{PLACEHOLDER}` tokens documented
in **Template variables** above. Preserve the `.up | .down | .flat` and
`.green | .red | .yellow | .grey` modifier classes per the trend rules in
Phase 3.

**Section titles — no phase prefix**: Section headings in the HTML report must **not** include
the phase number. Use the plain section name only (e.g., "KPI Scorecards" not "Phase 2 — KPI Scorecards",
"Narrative" not "Phase 3 — Narrative", "Watch Items" not "Phase 5 — Watch Items").

Write to `/tmp/aa_executive_briefing_<YYYY-MM-DD_HHMMSS>.html` and open:

```bash
open /tmp/aa_executive_briefing_<YYYY-MM-DD_HHMMSS>.html
```

---

## Tone and Style Guidelines

| Audience | Tone | Metrics | Length |
|---|---|---|---|
| C-suite | High-level, business outcomes, 1-2 sentences per metric | 3–5 max | 1 page |
| VP/Director | Operational detail, channel context, trend narrative | 5–7 | 1.5 pages |
| Marketing leadership | Campaign and channel depth, attribution, segment | 5–8 | 2 pages |

Always:
- Lead with the positive, then address concerns.
- Express deltas as business impact, not just percentages ("revenue grew $42K,
  up 14%" not just "+14%").
- For metrics that went down, include a possible explanation or next step.

---

## Guardrails

- Do not present raw API output — always narrate the numbers.
- If a metric change is within ±3%, describe as "roughly flat" not a
  directional story.
- Always identify the comparison period explicitly in the briefing header.
- If context from `REPORT_SUITE_CONTEXT_GUIDE` identifies the company name
  or industry, use it in the narrative for a more personalized output.

---

## Example Interaction

> "Write an exec summary of last week's performance for our leadership team."

1. Confirm report suite; load context guide.
2. Identify period: last 7 days vs. prior 7 days. Audience: VP level.
3. Confirm metrics: revenue, visits, orders, conversion rate, bounce rate.
4. Run 2 reports (all 5 metrics batched in one call per period).
5. Run channel breakdown for revenue.
6. Compose narrative: "Revenue grew 9% WoW to $186K, led by Paid Search
   which contributed 58% of revenue. Visits grew 18%, but mobile bounce rate
   increased 4pp, signaling a checkout experience issue worth investigating."
7. Generate HTML briefing and open.
8. Deliver the narrative as inline text for immediate use.
