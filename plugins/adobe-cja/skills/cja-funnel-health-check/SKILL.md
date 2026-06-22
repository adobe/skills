---
name: cja-funnel-health-check
description: >
  Analyzes a multi-step conversion funnel to find where users drop off and which
  steps have the worst leakage. Use this skill when someone describes a journey
  or funnel and asks about conversion rates, drop-off, fallout, or step completion.
  Trigger for phrases like "analyze our onboarding funnel," "where are users
  dropping off," "what's our checkout conversion rate," "funnel analysis,"
  "show me fallout between these steps," or "which step loses the most users."
license: Apache-2.0
metadata:
  author: Adobe
  version: "1.0"
---

# Funnel Health Check (Customer Journey Analytics)

Turn a plain-English funnel description into a quantified step-by-step
conversion analysis. The output identifies the biggest leakage point in the
funnel and provides dimension-based breakdowns to show which audience or channel
has the worst drop-off.

Funnel health checks are most valuable when a team suspects a specific step is
broken but hasn't quantified it. This skill does the quantification in a single
conversation turn.

---

## CJA MCP Tools Used

- `findDimensions` — resolve page name, event, or other dimensions for step filtering
- `findMetrics` — get the base metric to measure (sessions, visitors, events)
- `searchDimensionItems` — find exact dimension values for step names
- `runReport` (with `adhocSegments`) — measure visitor counts at each funnel step
- `findSegments` — use existing segments as funnel step filters if applicable
- `describeSegment` — understand segment logic before applying as a funnel step

---

## Phase 0 — Setup

1. Call `findDataViews` to list available data views.
2. If the user hasn't specified a data view, present the list and ask which to use.
3. Call `setDefaultSessionDataViewId` with the chosen ID.
4. Ask the user to define the funnel stages if not already specified (e.g., "What are the steps in the funnel you want to analyze?").

## Phase 1 — Define Funnel Steps

### 1.1 Parse the user's funnel description

Extract the step sequence from the user's plain-English description:
- "Homepage → Product Page → Cart → Purchase"
- "Registration → Onboarding Step 1 → Onboarding Step 2 → Activated"
- "Landing Page → Lead Form → Thank You Page"

Each step must resolve to a measurable condition in CJA. A step can be:
- **Page view**: user viewed a specific page (resolved via page name dimension)
- **Event/metric**: user triggered a specific action (e.g., "Added to Cart")
- **Segment membership**: user meets a pre-built segment condition

### 1.2 Clarify ambiguous steps

If any step is vague (e.g., "checkout" without a page name), ask one question:
> "For the 'Checkout' step — should I look at people who visited a page
> containing 'checkout' in the URL, or those who triggered a specific event
> like 'Cart Add'?"

Do not ask more than one clarifying question at a time.

### 1.3 Resolve page names to dimension values

For page-based steps, call `searchDimensionItems` to find the exact dimension
values that match the step name. First call `findDimensions` with a semantic
search like `"page name url"` to confirm the correct dimension ID — in most
CJA data views this is `variables/web.webPageDetails.name`, not `variables/page`:

```
searchDimensionItems(
  dimensionId: "variables/web.webPageDetails.name",
  searchAnd: "<step page name>",
  startDate: "<period start>",
  endDate: "<period end>",
  page: 0,
  limit: 10
)
```

Present matches to the user if there are multiple candidates:
> "I found these pages matching 'checkout': /checkout/start, /checkout/payment,
> /checkout/review. Should I use '/checkout/start' as the entry to the checkout
> step?"

---

## Phase 2 — Measure Each Step

For each funnel step, construct an ad hoc segment that filters to visitors/sessions
that reached that step. Then run a report measuring the base metric (usually
Unique Visitors or Sessions) with that segment applied.

### 2.1 Construct ad hoc segments for each step

A "reached step N" ad hoc segment is:
- Container: Visit or Person (use Visit for session-level funnels, Person for
  cross-visit journeys)
- Condition: Page Name equals "<step page value>" OR Event occurred

### 2.2 Run reports for each step

Run one `runReport` per step with the ad hoc segment applied. The `adhocSegments`
parameter takes fully-formed CJA segment definition objects — NOT a simplified
shorthand. The correct structure is:

```
runReport(
  dimensionIds: "variables/web.webPageDetails.name",
  metricIds: "metrics/visitors",
  startDate: "<period start>",
  endDate: "<period end>",
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
        "val": { "func": "attr", "name": "variables/web.webPageDetails.name" },
        "str": "<step page value>"
      }
    }
  }]
)
```

Use `context: "visitors"` (person-level) for cross-visit funnels. Use
`context: "visits"` (session-level) for within-session funnels. The metric
value comes from `summaryData.filteredTotals[0]` in the response.

The dimension and value used in the predicate should match what was found via
`searchDimensionItems` in Phase 1 — use the exact `value` string returned.

**Important**: Each step uses a cumulative filter — measure "visitors who
EVER reached this step in the period," not "visitors who ONLY visited this
page." This produces the classic funnel waterfall.

Capture `stepCount[i]` for each step i from 1 to N.

---

## Phase 3 — Compute Funnel Metrics

For each step-to-step transition:
- `stepConversionRate[i→i+1]` = stepCount[i+1] / stepCount[i] × 100
- `dropOff[i→i+1]` = stepCount[i] − stepCount[i+1]
- `dropOffRate[i→i+1]` = 100 − stepConversionRate[i→i+1]

Overall funnel:
- `overallConversionRate` = stepCount[N] / stepCount[1] × 100
- `biggestDropOffStep` = argmax(dropOff[i→i+1]) — the step with the most
  visitors lost

---

## Phase 4 — Optional: Segment the Funnel

If the user wants to compare funnel performance across audiences or channels,
run the same step reports filtered by a dimension or segment:

```
runReport(
  dimensionIds: "variables/device_type",
  metricIds: "metrics/visitors",
  startDate: "<range start>",
  endDate: "<range end>",
  page: 0,
  limit: 10,
  adhocSegments: [{ /* step N filter — same structure as Phase 2 */ }]
)
```

Note: use `findDimensions` with `searchQuery: "device type mobile desktop"` to
confirm the device dimension ID for the data view (often `variables/device_type`).

This shows step-N visitor counts broken down by device type (or channel,
or country). If one segment has a dramatically lower conversion through the
worst step, that's the target for optimization.

Common comparisons to suggest:
- Device type (mobile vs desktop conversion often differs significantly)
- Marketing channel (paid vs organic users may convert differently)
- New vs returning visitors

---

## Phase 5 — Generate HTML Funnel Report

Generate the funnel report inline and write to
`/tmp/cja_funnel_health_check_report_<YYYY-MM-DD_HHMMSS>.html`.


### HTML Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Funnel Health Check &mdash; {ORG_NAME} &mdash; {FUNNEL_NAME}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
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

  /* === Funnel chart wrap === */
  .chart-wrap { background: var(--surface); border-radius: 8px;
                padding: 28px 32px;
                box-shadow: 0 1px 3px rgba(0,0,0,.04);
                margin-bottom: 22px; }
  .chart-wrap h2 { font-family: "Playfair Display", Georgia, serif;
                   font-size: 18px; font-weight: 700;
                   margin-bottom: 18px;
                   padding-bottom: 12px;
                   border-bottom: 1px solid var(--border); }

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

  .highlight-row td { background: var(--accent-red-soft) !important;
                      font-weight: 700; }
  .progress-bar-wrap { background: #f1efea; border-radius: 4px;
                       height: 8px; overflow: hidden;
                       width: 100%; min-width: 80px; }
  .progress-bar { height: 100%; border-radius: 4px;
                  background: linear-gradient(90deg, var(--accent-red), #8a1d1c); }

  .rec-item { display: flex; gap: 12px; align-items: flex-start;
              padding: 14px 28px; border-bottom: 1px solid #f1eeea;
              font-size: 14px; line-height: 1.55; }
  .rec-item:last-child { border-bottom: none; }

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
    .kpi-tile, .chart-wrap, .section {
      box-shadow: none; border: 1px solid var(--border);
    }
    .back-top { display: none; }
  }
</style>
</head>
<body>

<header>
  <div class="header-inner">
    <div class="eyebrow">Funnel Health Report</div>
    <h1>{ORG_NAME} Funnel Health</h1>
    <p class="lede">Step-by-step conversion for the {FUNNEL_NAME} journey across {DATE_RANGE}, with the biggest leakage point surfaced.</p>
    <div class="meta">
      <span><span class="icon">&#128197;</span> {DATE_RANGE}</span>
      <span><span class="icon">&#128202;</span> {DATA_VIEW}</span>
      <span><span class="icon">&#128340;</span> Prepared {GENERATED_DATE}</span>
    </div>
  </div>
</header>

<nav>
  <a href="#overview">Overview</a>
  <a href="#chart">Funnel Chart</a>
  <a href="#steps">Step Detail</a>
  <a href="#segments">Segment Breakdown</a>
  <a href="#recs">Recommendations</a>
</nav>

<div class="container">

  <!-- Summary KPI Tiles -->
  <div class="section-label">Funnel Summary</div>
  <div id="overview" class="kpi-row">
    <div class="kpi-tile flat">
      <div class="kpi-head"><div class="kpi-label">Entered Funnel</div></div>
      <div class="kpi-value">{STEP_1_COUNT}</div>
      <span class="prior">Step 1 visitors</span>
    </div>
    <div class="kpi-tile flat">
      <div class="kpi-head"><div class="kpi-label">Completed Funnel</div></div>
      <div class="kpi-value">{STEP_N_COUNT}</div>
      <span class="prior">Reached final step</span>
    </div>
    <div class="kpi-tile flat">
      <div class="kpi-head"><div class="kpi-label">Overall Conversion</div></div>
      <div class="kpi-value">{OVERALL_CVR}%</div>
      <span class="prior">End-to-end rate</span>
    </div>
    <div class="kpi-tile down">
      <div class="kpi-head"><div class="kpi-label">Biggest Drop-Off Step</div></div>
      <div class="kpi-value" style="font-size:22px;">{WORST_STEP_NAME}</div>
      <span class="pill down">&#9660; Worst leakage</span>
    </div>
    <div class="kpi-tile down">
      <div class="kpi-head"><div class="kpi-label">Worst Step Drop-Off</div></div>
      <div class="kpi-value">{WORST_STEP_DROPOFF}%</div>
      <span class="prior">Of visitors lost at this step</span>
    </div>
  </div>

  <!-- Funnel Bar Chart -->
  <div id="chart" class="chart-wrap">
    <h2>Funnel Visualization</h2>
    <canvas id="funnelChart" height="100"></canvas>
  </div>

  <!-- Step-by-Step Table -->
  <div id="steps" class="section">
    <div class="section-header" onclick="toggle('steps-body')">
      <h2>Step-by-Step Analysis</h2>
      <span id="steps-body-icon">&#9662;</span>
    </div>
    <div id="steps-body">
      <table>
        <thead><tr>
          <th>Step</th>
          <th>Visitors</th>
          <th>% of Step 1</th>
          <th>Step Conversion</th>
          <th>Drop-Off</th>
          <th>Drop-Off Rate</th>
          <th>Visual</th>
        </tr></thead>
        <tbody>
          <!-- For each step i:
          <tr class="{highlight-row if worst step}">
            <td>{STEP_NAME}</td>
            <td>{STEP_COUNT}</td>
            <td>{PCT_OF_STEP_1}%</td>
            <td>{STEP_CVR}% {badge}</td>
            <td>{DROPOFF}</td>
            <td>{DROPOFF_RATE}%</td>
            <td>
              <div class="progress-bar-wrap">
                <div class="progress-bar" style="width:{PCT_OF_STEP_1}%"></div>
              </div>
            </td>
          </tr>
          -->
        </tbody>
      </table>
    </div>
  </div>

  <!-- Segment Breakdown (optional) -->
  <div id="segments" class="section">
    <div class="section-header" onclick="toggle('seg-body')">
      <h2>Segment Breakdown at Worst Step</h2>
      <span id="seg-body-icon">&#9662;</span>
    </div>
    <div id="seg-body">
      <table>
        <thead><tr>
          <th>Segment / Dimension</th>
          <th>Entered Worst Step</th>
          <th>Passed Worst Step</th>
          <th>Conversion</th>
          <th>vs. Average</th>
        </tr></thead>
        <tbody>
          <!-- Fill with dimension breakdown at the worst step -->
        </tbody>
      </table>
    </div>
  </div>

  <!-- Recommendations -->
  <div id="recs" class="section">
    <div class="section-header" onclick="toggle('rec-body')">
      <h2>Optimization Recommendations</h2>
      <span id="rec-body-icon">&#9662;</span>
    </div>
    <div id="rec-body">
      <!-- 2-3 recommendation items as .rec-item -->
    </div>
  </div>

</div>

<button class="back-top" onclick="window.scrollTo({top:0,behavior:'smooth'})">&uarr;</button>
<footer>Funnel Health Check &mdash; {ORG_NAME} &mdash; Generated {GENERATED_DATE}</footer>

<script>
// Funnel bar chart — recolor via design tokens.
// Stage colors fade from accent-red (worst leakage upstream) to a deeper red downstream.
const ctx = document.getElementById('funnelChart').getContext('2d');
new Chart(ctx, {
  type: 'bar',
  data: {
    labels: {STEP_NAMES_JSON},
    datasets: [{
      label: 'Visitors',
      data: {STEP_COUNTS_JSON},
      backgroundColor: [
        'rgba(200,49,47,0.90)',
        'rgba(200,49,47,0.72)',
        'rgba(200,49,47,0.54)',
        'rgba(200,49,47,0.38)',
        'rgba(200,49,47,0.22)'
      ],
      borderRadius: 6
    }]
  },
  options: {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, grid: { color: '#eee9df' },
           ticks: { color: '#6b6b6b' } },
      x: { grid: { display: false },
           ticks: { color: '#1a1a1a', font: { weight: '600' } } }
    }
  }
});

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

1. Parse funnel steps from user description.
2. Clarify any ambiguous steps (one question at a time).
3. Resolve page names with `searchDimensionItems`.
4. Run one `runReport` per step with ad hoc segment filter; capture visitor counts.
5. Compute step conversion rates, drop-off counts, and rates.
6. Identify the biggest drop-off step.
7. Optionally run dimension breakdown at the worst step.
8. Generate HTML report with Chart.js funnel visualization.
9. Write to `/tmp/cja_funnel_health_check_report_<YYYY-MM-DD_HHMMSS>.html`.
10. Open with `open /tmp/cja_funnel_health_check_report_<YYYY-MM-DD_HHMMSS>.html`.
11. Summarize inline: "Overall conversion: X%. Biggest drop-off at [Step N]:
    Y% of users abandon. Mobile users drop off at a 2× higher rate than desktop."

---

## Important Guardrails

- **Read-only analysis.** Never modify segments, calculated metrics, or project definitions automatically.
- **Confirm funnel stages before running.** Ambiguous stage definitions produce misleading results — clarify with the user first.
- **Note attribution model.** Funnel conversion rates depend on the attribution model in the data view; mention it in the report.
- **Flag incomplete data.** If any stage returns zero or suspiciously low counts, note possible tracking gaps before drawing conclusions.
- **Cap date range.** Funnel analysis over very long date ranges (>90 days) can be slow; suggest 30-day windows as default.
- **Never assume stage order.** Confirm with the user that the stages are sequential and mutually exclusive before calculating drop-off rates.

## Example Interaction

> "Check the health of our checkout funnel — I want to see where people are dropping off."

1. **Setup:** Call `findDataViews`, user selects their e-commerce data view. Call `setDefaultSessionDataViewId`.
2. **Define funnel:** Ask "What are the checkout stages?" User replies: "Product View → Add to Cart → Checkout Start → Purchase."
3. **Analysis:** Run `runReport` for each stage transition over the last 30 days. Calculate drop-off rates: Product View→Cart 22%, Cart→Checkout 58%, Checkout→Purchase 71%.
4. **Findings:** Identify the Cart→Checkout step as the highest drop-off (78% fall off). Segment by device type to find mobile conversion is 40% lower than desktop.
5. **Report:** Present a funnel visualization with drop-off rates per stage, top exit segments, and 3 prioritized recommendations.

## Recommendations Logic

- **Worst step drop-off > 60%**: "Critical leakage — this step is broken or
  the user expectation is misaligned. Prioritize UX investigation."
- **Mobile drop-off > 2× desktop**: "Mobile UX at this step needs attention —
  consider a dedicated mobile flow or simplified form."
- **Specific channel drop-off > 40% worse than average**: "Users from this
  channel may have mismatched intent — review landing page alignment."
- **Step 1 count < 1,000**: "Funnel entry volume is too low for statistical
  confidence. Check the step definition or expand the date range."
