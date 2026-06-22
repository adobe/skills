---
name: aa-conversion-funnel-analysis
description: >
  Analyzes a multi-step conversion funnel to find where visitors drop off and
  which steps have the worst leakage. Use this skill when someone describes a
  journey and asks about conversion rates, drop-off, fallout, or step
  completion. Trigger for "analyze our checkout funnel," "where are visitors
  dropping off," "what's our add-to-cart to purchase conversion rate," "funnel
  analysis," "show me fallout between steps," or "which step loses the most
  visitors."
license: Apache-2.0
metadata:
  author: Adobe
  version: "1.0"
---

# Conversion Funnel Analysis (Adobe Analytics)

Analyze a multi-step conversion funnel to identify where visitors drop off,
which steps have the worst leakage, and what drives visitors to convert or
abandon. Uses AA visit-level segment-based reporting to simulate funnel steps.

> **AA Container Model:** AA funnels use **hit**, **visit**, and **visitor**
> containers — not CJA's event/session/person. Funnel steps are defined as
> visit-level segments (visitors who completed the step during a visit).
>
> **Reporting approach:** AA does not have a native sequential fallout API
> accessible via MCP. This skill approximates fallout by creating or finding
> visit-level segments for each funnel step, then running the metric for
> each step segment to compute pass-through rates.

---

## AA MCP Tools Used

- `findReportSuites` — select report suite
- `setSessionDefaults` — set session context (reportSuiteId + globalCompanyId)
- `findDimensions` — discover page/event dimensions for step definition
- `findMetrics` — find visits or orders as the counting metric
- `searchDimensionItems` — validate page names or event values
- `findSegments` — find existing step segments if available
- `upsertSegment` — create visit-level step segments if not found
- `runReport` — run visits count for each step segment

---

## Phase 0 — Setup

1. Confirm report suite with `findReportSuites` / `setSessionDefaults`.
2. Ask the user about the overall funnel scope (visit or visitor level):
   - **Visit-level funnel:** all steps happen within a single visit
     (typical for checkout funnels)
   - **Visitor-level funnel:** steps can span multiple visits
     (typical for lifecycle funnels)

```
findReportSuites(globalCompanyId: "<gcid>", page: 0, limit: 10)
setSessionDefaults(globalCompanyId: "<gcid>", reportSuiteId: "<rsid>")
```

---

## Phase 1 — Define the Funnel Steps

Ask the user to describe each step of the funnel in plain language.
Prompt for 3–8 steps. Example:

1. Product page viewed
2. Add to cart
3. Checkout started
4. Payment info entered
5. Order confirmed (purchase)

For each step, ask:
- "Is this defined by a page view (page name or URL), a custom event, or
  a combination?"
- "Should this step be at the **hit** level (single page/event) or
  **visit** level (any visit where this happened)?"

---

## Phase 2 — Discover Components

### 2.1 Validate page names

For page-based steps:

```
findDimensions(page: 1, limit: 500)   # returns all available dimensions; look for variables/page
searchDimensionItems(
  dimensionId: "variables/page",
  searchOr: "<step page keywords>",   # space-separated keywords OR'd together
  startDate: "<start>",
  endDate: "<end>",
  page: 1,
  limit: 20
)
```

Common page dimension IDs: `variables/page`, `variables/entrypage`, `variables/exitpage`.
Confirm the correct page name value with the user if multiple matches exist.

> **Note:** `searchDimensionItems` uses `searchOr` or `searchAnd` for filtering — not `searchTerm`.
> If no rows return, try a wider date range — some report suites only have historical data.

### 2.2 Validate events/metrics

For event-based steps (add to cart, checkout, purchase):

```
findMetrics(expansions: "componentType,categories", page: 0, limit: 200)
# Filter results locally by name: visits, orders, pageviews, etc.
```

---

## Phase 3 — Find or Create Step Segments

For each funnel step, search for an existing segment:

```
findSegments(searchTerm: "<step description>")
```

If an appropriate visit-level segment exists, use it directly.

If not, create a new visit-level segment for each step:

```
upsertSegment(
  definition: {
    "name": "Visit: Checkout Started",
    "description": "Visits where the visitor reached the checkout page",
    "reportSuiteID": "<rsid>",
    "container": {
      "func": "segment",
      "context": "visits",
      "pred": {
        "func": "streq",
        "val": "/checkout",
        "str": "/checkout",
        "dimension": "variables/page"
      }
    },
    "tags": [{ "name": "funnel" }]
  }
)
```

Create all step segments before running reports. Record each segment `id`.

> **Important:** Only create new segments with explicit user confirmation.
> Present the list of segments to be created and ask: "I need to create N
> visit-level segments to define your funnel steps. Is that OK?"

---

## Phase 4 — Run Funnel Step Reports

For each step segment, run the visits count over the analysis period:

```
runReport(
  dimensionId: "variables/page",    # required by AA runReport
  metricIds: "metrics/visits",      # note: plural field name "metricIds"
  segmentIds: "<step segment id>",  # note: plural field name "segmentIds"
  startDate: "<start>",
  endDate: "<end>",
  limit: 1
)
# summaryData.totals[0] is the total visits for this segment
```

This is 1 call per funnel step. For a 5-step funnel = 5 calls.

Also run total visits (no segment) as the 100% baseline:

```
runReport(
  dimensionId: "variables/page",
  metricIds: "metrics/visits",
  startDate: "<start>",
  endDate: "<end>",
  limit: 1
)
# Use summaryData.totals[0] as the baseline visit count
```

> **AA runReport field names:** Use `metricIds` (not `metricId`) and `segmentIds` (not `segmentId`).
> Use `startDate`/`endDate` (ISO 8601) rather than a `dateRange` object.
> Always read totals from `summaryData.totals[0]`, not from `rows`.

---

## Phase 5 — Compute Funnel Metrics

For each step, compute:

| Metric | Formula |
|---|---|
| Step visits | Raw count from `runReport` |
| Step conversion rate | Step visits / Total visits × 100 |
| Step-to-step rate | Step N visits / Step N-1 visits × 100 |
| Step-to-step drop-off | Step N-1 visits - Step N visits |
| Drop-off rate | 100 - step-to-step rate |

Identify the **biggest leakage step** (highest absolute drop-off count) and
the **weakest conversion step** (lowest step-to-step rate).

---

## Phase 6 — Drill Into the Worst Step

For the step with the highest drop-off, run a dimension breakdown to find
what differentiates visitors who progressed vs. those who dropped:

```
runReport(
  dimensionId: "variables/mobiledevicetype",
  metricIds: "metrics/visits",
  segmentIds: "<worst step segment>",
  startDate: "<start>",
  endDate: "<end>",
  limit: 10
)

runReport(
  dimensionId: "variables/mobiledevicetype",
  metricIds: "metrics/visits",
  segmentIds: "<next step segment>",
  startDate: "<start>",
  endDate: "<end>",
  limit: 10
)
```

Compare the device-type mix between visitors who completed the worst step
and those who made it to the next step. Repeat for 1–2 other dimensions
(e.g., traffic source, new vs. returning).

---

## Phase 7 — Generate HTML Report

Build the funnel report inline and write to
`/tmp/aa_funnel_analysis_report_<YYYY-MM-DD_HHMMSS>.html`.


### HTML template

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Funnel Health &mdash; {ORG_NAME} &mdash; {FUNNEL_NAME}</title>
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

  /* === Section label === */
  .section-label { font-size: 11px; font-weight: 700;
                   text-transform: uppercase; letter-spacing: 1.4px;
                   color: var(--ink-muted); margin-bottom: 14px;
                   padding-bottom: 10px; border-bottom: 1px solid var(--border); }

  /* === Funnel visualization (horizontal stepped bars) ===
     Bar color is set per step by tier:
       .tier-strong = green  (rate >= 70% pass-through)
       .tier-mid    = yellow (40-69%)
       .tier-weak   = red    (< 40%)
     The biggest-leakage step also gets .step-bar.worst (red, regardless of tier). */
  .funnel-wrap { background: var(--surface); border-radius: 8px;
                 padding: 28px 32px; margin-bottom: 28px;
                 box-shadow: 0 1px 3px rgba(0,0,0,.04); }
  .funnel-step { display: flex; align-items: center; margin-bottom: 10px; }
  .step-label { width: 220px; font-size: 14px; font-weight: 600;
                text-align: right; padding-right: 16px; white-space: nowrap;
                overflow: hidden; text-overflow: ellipsis; color: var(--ink); }
  .step-bar-wrap { flex: 1; position: relative; height: 44px;
                   background: #f4f1eb; border-radius: 4px; }
  .step-bar { height: 44px; border-radius: 4px;
              display: flex; align-items: center; padding: 0 14px;
              color: #fff; font-size: 13px; font-weight: 700;
              transition: width 0.4s ease;
              background: var(--accent-green); }
  .step-bar.tier-strong { background: var(--accent-green); }
  .step-bar.tier-mid    { background: var(--accent-yellow); color: #3a2a05; }
  .step-bar.tier-weak   { background: var(--accent-red); }
  .step-bar.worst       { background: var(--accent-red); color: #fff; }
  .step-meta { width: 200px; padding-left: 16px; font-size: 12px;
               color: var(--ink-muted); }
  .step-meta .rate { font-family: "Playfair Display", Georgia, serif;
                     font-size: 18px; font-weight: 700;
                     color: var(--ink); line-height: 1; }
  .step-meta .drop { color: var(--accent-red); font-weight: 600;
                     display: block; margin-top: 4px; }

  /* === Collapsible sections === */
  .section { background: var(--surface); border-radius: 8px;
             box-shadow: 0 1px 3px rgba(0,0,0,.04);
             margin-bottom: 22px; overflow: hidden; }
  .section-header { padding: 18px 28px; border-bottom: 1px solid var(--border);
                    display: flex; justify-content: space-between;
                    align-items: center; cursor: pointer; user-select: none; }
  .section-header h2 { font-family: "Playfair Display", Georgia, serif;
                       font-size: 18px; font-weight: 700; }
  .toggle { font-size: 16px; color: var(--accent-red); }

  /* === Tables === */
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { background: #faf8f4; padding: 12px 22px;
             text-align: left; font-weight: 600;
             text-transform: uppercase; letter-spacing: .6px;
             font-size: 11px; color: var(--ink-muted);
             border-bottom: 1px solid var(--border); }
  tbody td { padding: 12px 22px; border-bottom: 1px solid #f4f1eb; }
  tbody tr:last-child td { border-bottom: none; }

  /* === Badges === */
  .badge { display: inline-block; padding: 3px 9px; border-radius: 4px;
           font-size: 11px; font-weight: 600; }
  .badge.green  { background: #ebf5ef; color: var(--accent-green); }
  .badge.yellow { background: #fef6e3; color: #b67a08; }
  .badge.red    { background: var(--accent-red-soft); color: var(--accent-red); }

  /* === Insight callout === */
  .insight { background: var(--accent-red-soft);
             border-left: 4px solid var(--accent-red);
             border-radius: 6px; padding: 16px 22px;
             margin: 16px 28px; font-size: 14px; line-height: 1.6;
             color: #4a2222; }

  .back-top { position: fixed; bottom: 24px; right: 24px; background: var(--accent-red);
              color: #fff; width: 44px; height: 44px; border-radius: 50%; border: none;
              font-size: 20px; cursor: pointer;
              box-shadow: 0 4px 12px rgba(200,49,47,.35); }
  footer { text-align: center; padding: 32px 24px;
           font-size: 12px; color: var(--ink-muted); }

  /* === Print === */
  @media print {
    nav { display: none; position: static; }
    header { padding: 36px 32px 28px; }
    header h1 { font-size: 42px; }
    .section-header { cursor: default; }
    .back-top { display: none; }
    .funnel-wrap, .section {
      box-shadow: none; border: 1px solid var(--border); break-inside: avoid;
    }
  }
</style>
</head>
<body>
<header>
  <div class="header-inner">
    <div class="eyebrow">Funnel Health Report</div>
    <h1>{ORG_NAME} Funnel Health</h1>
    <p class="lede">Step-by-step pass-through for the {FUNNEL_NAME} funnel during {DATE_RANGE}.</p>
    <div class="meta">
      <span><span class="icon">&#128197;</span> {DATE_RANGE}</span>
      <span><span class="icon">&#128202;</span> {REPORT_SUITE}</span>
      <span><span class="icon">&#128340;</span> Prepared {GENERATED_DATE}</span>
    </div>
  </div>
</header>
<nav>
  <a href="#funnel">Funnel</a>
  <a href="#steps">Step Detail</a>
  <a href="#leakage">Leakage Analysis</a>
  <a href="#recommendations">Recommendations</a>
</nav>
<div class="container">
  <!-- Funnel Visualization -->
  <div class="section-label">Funnel Pass-Through</div>
  <div id="funnel" class="funnel-wrap">
    <!-- One .funnel-step per step:
         - Bar width = (step visits / total visits) * 100%
         - Apply tier class to .step-bar based on step pass-through rate:
             tier-strong (>=70%), tier-mid (40-69%), tier-weak (<40%)
         - Worst step also gets .step-bar.worst (red, always)
    -->
  </div>

  <!-- Step Detail Table -->
  <div id="steps" class="section">
    <div class="section-header" onclick="toggle('steps-body')">
      <h2>Step Detail</h2>
      <span class="toggle" id="steps-body-icon">&#9662;</span>
    </div>
    <div id="steps-body">
      <table>
        <thead><tr>
          <th>Step</th><th>Visits</th><th>% of Total</th>
          <th>Step Rate</th><th>Drop-off</th>
        </tr></thead>
        <tbody><!-- step rows with badge coloring on step rate --></tbody>
      </table>
    </div>
  </div>

  <!-- Leakage Analysis -->
  <div id="leakage" class="section">
    <div class="section-header" onclick="toggle('leak-body')">
      <h2>Leakage Analysis (Worst Step: {WORST_STEP_NAME})</h2>
      <span class="toggle" id="leak-body-icon">&#9662;</span>
    </div>
    <div id="leak-body">
      <div class="insight">{LEAKAGE_INSIGHT_TEXT}</div>
      <table>
        <thead><tr>
          <th>Dimension</th><th>Entered Step</th><th>Completed Step</th>
          <th>Step Rate</th><th>vs. Average</th>
        </tr></thead>
        <tbody><!-- leakage breakdown rows --></tbody>
      </table>
    </div>
  </div>

  <!-- Recommendations -->
  <div id="recommendations" class="section">
    <div class="section-header" onclick="toggle('rec-body')">
      <h2>Recommendations</h2>
      <span class="toggle" id="rec-body-icon">&#9662;</span>
    </div>
    <div id="rec-body">
      <!-- insight divs with specific recommendations per step -->
    </div>
  </div>
</div>
<button class="back-top" onclick="window.scrollTo({top:0,behavior:'smooth'})">
  &#8679;
</button>
<footer>Funnel Health &mdash; {ORG_NAME} &mdash; Generated {GENERATED_DATE}</footer>
<script>
function toggle(id) {
  var el = document.getElementById(id);
  var ic = document.getElementById(id + '-icon');
  if (el.style.display === 'none') { el.style.display = ''; ic.textContent = '\u25be'; }
  else { el.style.display = 'none'; ic.textContent = '\u25b8'; }
}
</script>
</body>
</html>
```

**Section titles — no phase prefix**: Section headings in the HTML report must **not** include
the phase number. Use the plain section name only (e.g., "Funnel Overview" not "Phase 2 — Funnel Overview",
"Drop-off Analysis" not "Phase 3 — Drop-off Analysis").

Write to `/tmp/aa_funnel_analysis_report_<YYYY-MM-DD_HHMMSS>.html` and open:

```bash
open /tmp/aa_funnel_analysis_report_<YYYY-MM-DD_HHMMSS>.html
```

---

## Guardrails

- Always present the list of segments to be created (step 3) and get user
  confirmation before calling `upsertSegment`.
- If the user already has named segments for funnel steps, prefer using those
  rather than creating new ones — check `findSegments` first.
- Limit funnel to 8 steps maximum for practical API call budgets.
- Funnel conversion rates using visit segments are approximations — they
  count visits that touched each step, not strict sequential fallout. Note
  this limitation to the user.

---

## Example Interaction

> "Analyze our checkout funnel — I want to see where visitors drop off."

1. Confirm report suite and date range (last 30 days).
2. Define 5 steps: Product View → Add to Cart → Checkout → Payment →
   Purchase.
3. Validate page names with `searchDimensionItems`.
4. Find existing step segments or create new ones (with user approval).
5. Run 6 reports (5 steps + total).
6. Compute: 100% → 42% (add to cart) → 28% (checkout) → 19% (payment) →
   11% (purchase). Overall conversion: 11%.
7. Worst step: Add-to-Cart to Checkout (33% drop-off rate).
8. Drill in: Mobile users have only 18% checkout rate vs. 31% on Desktop.
9. Generate and open HTML report.
10. Key insight: "Mobile is your funnel's biggest liability. Consider
    simplifying the mobile checkout experience."
