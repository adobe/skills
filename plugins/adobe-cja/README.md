# Adobe Customer Journey Analytics (CJA) MCP Plugin

Use the **CJA MCP server** as an analytics copilot: KPI monitoring, funnel and segment analysis, dimension profiling, and executive readouts — all driven from natural-language requests in Claude Code, Cursor, and other MCP clients.

---

## Installation

**Claude Code:**

```bash
/plugin marketplace add adobe/skills
/plugin install adobe-cja@adobe-skills
```

**Cursor / other MCP clients:** Configure the MCP server entry per your environment (see below).

---

## MCP server

```json
{
  "mcpServers": {
    "adobe-cja": {
      "type": "http",
      "url": "https://cja-mcp.adobe.io/mcp"
    }
  }
}
```

Requests require IMS auth headers (`Authorization`, `x-gw-ims-org-id`, `x-gw-ims-user-id`, etc.); an OAuth proxy may inject these. Include `x-data-view-id` when required.

This repo's [`.mcp.json`](./.mcp.json) is a **template** only.

---

## Skills

<table>
<thead>
<tr>
  <th>Skill</th>
  <th>Description</th>
  <th>Try it</th>
</tr>
</thead>
<tbody>
<tr>
  <th colspan="3" align="left">Monitor &amp; investigate — <em>Skills that track day-to-day KPI movement and dig into unexpected shifts.</em></th>
</tr>
<tr>
  <td><a href="skills/cja-kpi-pulse/SKILL.md">cja-kpi-pulse</a></td>
  <td>KPI digest with period-over-period change, trend direction, and dimension breakdown</td>
  <td>
<ul>
<li><code>How are our KPIs looking this week?</code></li>
<li><code>Compare last month's KPIs to the same month last year</code></li>
<li><code>Which KPI moved most this month and what drove it?</code></li>
</ul>
</td>
</tr>
<tr>
  <td><a href="skills/cja-top-movers-watchlist/SKILL.md">cja-top-movers-watchlist</a></td>
  <td>Ranks dimension items by biggest gain or loss for a metric</td>
  <td>
<ul>
<li><code>Top gaining and declining pages this week</code></li>
<li><code>Which marketing channels grew or shrank most this month?</code></li>
<li><code>New product pages that appeared this month with significant traffic</code></li>
</ul>
</td>
</tr>
<tr>
  <th colspan="3" align="left">Analyze — <em>Skills that go deeper into a specific question — funnels, dimensions, segment differences.</em></th>
</tr>
<tr>
  <td><a href="skills/cja-funnel-health-check/SKILL.md">cja-funnel-health-check</a></td>
  <td>Step-by-step fallout analysis across a multi-step conversion funnel</td>
  <td>
<ul>
<li><code>Check the health of our purchase funnel</code></li>
<li><code>Where do users drop off in our onboarding journey?</code></li>
<li><code>Where does our paid search funnel leak compared to organic?</code></li>
</ul>
</td>
</tr>
<tr>
  <td><a href="skills/cja-dimension-analysis/SKILL.md">cja-dimension-analysis</a></td>
  <td>Cardinality, distribution, trends, anomalies, and data quality for a dimension</td>
  <td>
<ul>
<li><code>Analyze the Page Name dimension</code></li>
<li><code>Audit our Marketing Channel values — any spelling variations or duplicates?</code></li>
<li><code>Forecast the top Browser values over the next 4 weeks</code></li>
</ul>
</td>
</tr>
<tr>
  <td><a href="skills/cja-segment-performance-comparator/SKILL.md">cja-segment-performance-comparator</a></td>
  <td>Side-by-side KPI comparison across two or more audience segments</td>
  <td>
<ul>
<li><code>Compare mobile vs desktop performance</code></li>
<li><code>How do US visitors compare to UK visitors on key KPIs?</code></li>
<li><code>Compare new vs returning visitors across acquisition, engagement, and conversion</code></li>
</ul>
</td>
</tr>
<tr>
  <th colspan="3" align="left">Deliver — <em>Skills that produce stakeholder-ready output, like narrative briefings for leadership and business reviews.</em></th>
</tr>
<tr>
  <td><a href="skills/cja-executive-briefing/SKILL.md">cja-executive-briefing</a></td>
  <td>Narrative performance summary ready for leadership or QBR</td>
  <td>
<ul>
<li><code>Write last week's performance briefing for leadership</code></li>
<li><code>Draft a monthly business review for the board</code></li>
<li><code>Give me a briefing that explains why revenue softened — not just what</code></li>
</ul>
</td>
</tr>
</tbody>
</table>

---

## Usage

Each skill's `SKILL.md` contains the trigger description, phased workflow, MCP tool calls, and HTML output templates. Your MCP client routes natural-language requests to the matching skill automatically via the YAML `description` field.

---

## Contributing

To add a new skill, create a `skills/<skill-id>/SKILL.md` following the existing pattern (YAML frontmatter with `name`/`description`, phased workflow, MCP tool calls, HTML template). Keep `name:` stable — it is used for routing.

See the repository [CONTRIBUTING.md](../../CONTRIBUTING.md) for the broader contribution process.
