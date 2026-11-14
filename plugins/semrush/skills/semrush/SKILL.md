---
name: semrush
description: Competitive SEO and traffic data from the Semrush MCP server (v2) for any domain, including ones nobody here owns — keyword search volume and difficulty, the keywords a domain ranks for, which URL ranks for a query, organic and paid competitors, keyword gaps, backlink profiles and referring domains, authority score, traffic estimates, audience demographics, and technical site audits. Covers the mandatory three-step call protocol, the JSON envelope that reports each call's API unit cost, and regional database selection. Use whenever the user mentions Semrush, keyword research, search volume, keyword difficulty, backlinks, referring domains, domain authority, competitor or competitive analysis, SERP analysis, traffic estimates, or site audit — or asks "what do we rank for", "what does this competitor rank for", "who ranks for this keyword", "how many people search for X", or "who links to them".
license: Apache-2.0
metadata:
  version: "1.0.0"
---

# Semrush

Estimated, third-party SEO data for any domain — yours or a competitor's. Reached
through the Semrush MCP server at `https://mcp.semrush.com/v2/mcp`, which exposes
14 tools and 86 reports.

**Semrush vs Search Console.** Search Console reports what your own site actually
earned: real clicks, real impressions, only for properties you can verify.
Semrush models the whole market from its own crawl and clickstream panels, so it
covers competitors and keywords you have never ranked for, and every number is an
estimate. Search Console answers "what did we get". Semrush answers "what is out
there", "who else is in this SERP" and "what is that competitor doing". When the
two disagree about your own site, Search Console wins.

## Setup

Register the server with your agent once. OAuth runs on first contact and needs a
human at the browser to approve it.

```
mcp add https://mcp.semrush.com/v2/mcp semrush     # adjust for your own agent
```

That command is one agent's syntax. Substitute whatever your agent uses to add a
remote MCP server; the only things that matter are the URL and that the OAuth
authorization-code flow (scope `mcp.access`) completes. Semrush allowlists
redirect URIs — see [references/protocol.md](references/protocol.md) if
registration is rejected.

A legacy `v1` endpoint also answers, with different tool names, different parameter
names and bare CSV instead of the envelope below; Semrush advertises only v2.

Everything below is expressed as MCP **tool calls**, written as
`tool_name(arg=value)`. Issue them however your agent invokes MCP tools.

## Three steps, never fewer

This is the one thing agents get wrong. A toolkit tool such as `domain_overview`
returns **no data**. It returns a catalogue of reports with descriptions and a
`suggested_call` pointing at the next step.

```
1. domain_overview()                                -> reports[] with names + descriptions
2. get_report_schema(report="domain_rank")           -> parameters, types, enums, defaults
3. execute_report(report="domain_rank",
                  params={target: "example.com", database: "us"})   -> the data
```

Step 3 is the only step that returns data and the only step that spends units.
Skip step 1 when you already know the report name (the tables below are that
knowledge). Do not skip step 2 for a report you have not called before: parameter
names differ between reports in ways that are not guessable.

The report name passed to `get_report_schema` and `execute_report` is the bare
name from `reports[].name`, with no toolkit prefix — `geo`, never
`audience.geo`.

## The response envelope

Every successful report returns JSON, not bare text:

```json
{"data": "Domain;Rank;Organic Keywords;...\nadobe.com;51;9866369;43299118;...\n",
 "metadata": {"format": "csv",
              "url": "https://www.semrush.com/analytics/overview/?db=us&q=adobe.com",
              "usage": {"api_units": 10}}}
```

Three things to do with it every time:

1. **Switch on `metadata.format`.** For `csv`, `data` is a string: header line then
   one line per row, `;`-separated. For `json`, `data` is already a parsed object or
   array. Both occur — `site_audit` and `projects` reports are `json`, analytics
   reports are `csv`. Do not assume.
2. **Keep `metadata.url`.** It is a canonical Semrush interface link for the same
   query. Cite it when reporting a figure to a human, so they can check it.
3. **Read `metadata.usage.api_units`.** That is the measured cost of the call you
   just made. Accumulate it and report the total.

Within a CSV `data` string, a field can itself contain commas: the `Trends` column
is a comma-separated series inside a semicolon-separated row.

## Which tool and report answer which question

The 14 tools: `domain_overview`, `organic_research`, `paid_search_research`,
`competitors_research`, `keyword_research`, `backlinks_research`,
`traffic_overview`, `audience_research`, `shopping_research`, `position_tracking`,
`site_audit`, `projects`, plus `get_report_schema` and `execute_report`. The names
map onto questions directly, and `execute_report` reaches every report regardless
of which toolkit lists it.

| Question | Report | Toolkit |
|---|---|---|
| What keywords does this rank for? | `resource_organic` | organic_research |
| Which of its pages earn the organic traffic? | `resource_organic_unique` | organic_research |
| What changed — new, lost, rising, falling? | `resource_organic` + `display_positions` | organic_research |
| Summary counters for a domain | `domain_rank` | domain_overview |
| Growing or shrinking, month by month? | `resource_rank_history` | domain_overview |
| Which countries does it rank in at all? | `domain_ranks` | domain_overview |
| Who ranks for this keyword, with which URL? | `phrase_organic` | keyword_research |
| How much searched, how hard, what intent? | `phrase_this` | keyword_research |
| Same for a list of keywords in one call | `phrase_these` | keyword_research |
| What else could I target around this theme? | `phrase_related`, `phrase_fullsearch`, `phrase_questions` | keyword_research |
| Who are the organic competitors? | `domain_organic_organic` | competitors_research |
| Who competes on paid search? | `domain_adwords_adwords` | competitors_research |
| What do they rank for that we do not? | `domain_domains` | competitors_research |
| Who is gaining or losing in this market? | `rank_difference` | competitors_research |
| How strong is the backlink profile? | `backlinks_overview` | backlinks_research |
| Who links to it, and with what anchors? | `backlinks_refdomains`, `backlinks_anchors` | backlinks_research |
| How much traffic, and from where? | `summary`, `sources`, `toppages` | traffic_overview |
| Who visits, and what are they like? | `geo`, `age_and_sex_distribution`, `audience_interests` | audience_research |
| What paid keywords does it bid on? | `resource_adwords` | paid_search_research |
| What is in its Shopping ads? | `domain_shopping` | shopping_research |
| What is technically broken on the site? | `info`, `meta_issues`, `issue_details` | site_audit |
| How are our tracked keywords moving? | `tracking_position_organic` | position_tracking |

Full catalogue and confirmed parameters:
[references/reports.md](references/reports.md).

**`resource_*` reports accept any granularity.** `resource_organic`,
`resource_organic_unique`, `resource_rank_history`, `resource_adwords` and
`resource_adwords_unique` take a `target` that may be a domain
(`example.com`), a subdomain (`blog.example.com`), a subfolder
(`www.example.com/blog/`) or a full URL (`https://example.com/page`). The type is
auto-detected, so there is no separate subdomain, subfolder or URL report to pick.
Subfolders still need the trailing slash.

## The parameter name is not always `target`

Guessing here is the most common way to waste a call. Confirmed by schema:

| Parameter | Type | Reports |
|---|---|---|
| `target` | string | `domain_rank`, `domain_ranks`, all `resource_*`, `backlinks_*`, `toppages`, `geo`, `sources`, `summary_by_period` |
| `domain` | string | `domain_organic_organic`, `domain_adwords_adwords`, `domain_organic_subdomains` |
| `domains` | string | `domain_domains` (the keyword-gap report) |
| `targets` | array | `summary` |
| `phrase` | string | every `phrase_*` report |
| `id` | int64 | `info`, `snapshots`, `meta_issues`, `issue_details`, `get_project` |
| `project_id` | int64 | `campaigns` |

`backlinks_*` reports also require `target_type`, one of `root_domain`, `domain`,
`url`. `summary`, `toppages`, `geo`, `sources` and `summary_by_period` require
`export_columns` — they have no default column set and fail without it.

Two more shape rules that bite:

- `export_columns` values are long snake_case names (`organic_traffic`,
  `keyword_difficulty`, `position`), not the two-letter codes an older Semrush API
  used. The schema lists the full allowed set in `parameters.export_columns
  .items.enum` and the default set in `.default`.
- `display_date` is a dashed date. `2026-08-15` works; `20260815` fails validation.

## Cost is measured, not advertised

The v2 catalogue publishes no prices. The only trustworthy number is
`metadata.usage.api_units` on the response you just received, so cost control is a
matter of measuring as you go and stopping.

Measured on real calls:

| Call | Units |
|---|---|
| `domain_rank`, current date, 1 row | 10 |
| `domain_rank` with a historical `display_date`, 1 row | 50 |
| `resource_organic`, 3 rows | 30 |
| `phrase_this`, 1 keyword | 10 |
| `phrase_organic`, 3 rows | 30 |
| `domain_organic_organic`, 3 rows | 120 |
| `backlinks_overview` | 40 |
| `list_projects`, `info`, `snapshots`, `meta_issues`, each | 100 |
| `summary`, `toppages`, `issue_details` | 0 |

What follows from those measurements:

- **Per-row pricing dominates.** `display_limit` multiplies the bill directly, and
  competitor reports cost 40 per row where keyword reports cost 10. Set
  `display_limit` explicitly and start at 3 to 10 while exploring.
- **Historical dates cost more than current ones** — five times more on
  `domain_rank` for the same single row. Do not backfill a series row by row; ask
  `resource_rank_history` for the whole series in one call.
- **Some reports measured zero.** Traffic reports and `issue_details` billed
  nothing on this account. Whether that is the plan, the report, or rounding was
  not determined, so do not promise it; read the field.
- Never loop a report over a list. Use the batch forms: `phrase_these` takes
  `"a;b;c"` in one call, `summary` takes up to five targets.
- Discovery and `get_report_schema` responses carry no `usage` field at all, which
  is consistent with them being free but is not proof.
- `snapshot`, `history` and `page_info` in `site_audit` were the costly reports in
  the older API and were not measured here. Prefer `info`, which already carries
  the issue counts.

Before running a per-row report over more than a handful of rows, say what you are
about to do and let the user decide.

## Errors arrive in two different places

**Validation failures come back as a normal tool result** — a JSON object where
the data would be:

```json
{"code": "validation_failed",
 "message": "parameter 'target' is required",
 "retryable": true,
 "hint": "Fix the invalid parameters and retry. Use get_report_schema to check ...",
 "trace_id": "dba3db395ec403ee1f1a95bcff139acd"}
```

`retryable: true` plus a `hint` means fix the call and try again. For an
out-of-range value the `message` enumerates every accepted value, including the
index of the offending array element — read it instead of re-fetching the schema.

**Everything else comes back as a protocol-level error**, JSON-RPC code `-32603`,
whose `message` is a JSON string with `code: "internal"` and `retryable: false`.
An unknown report, a missing project and a target that is not in the database all
arrive this way. Parse that nested JSON; do not surface the raw `-32603`.

The documented `code` values are `validation_failed`, `no_subscription`,
`no_api_units`, `rate_limit` and `internal`. An error may also carry a `url` for
the human to visit and a `trace_id` to quote to Semrush support.

### Not found is not "does not rank"

A target absent from the queried regional database produces:

```
{"code":"internal",
 "message":"get domain_rank: ERROR 50 :: NOTHING FOUND\nNo data found for this
            request. Verify your parameters are correct. If parameters are valid,
            try a different date range or target.\nnot found",
 "retryable":false,"trace_id":"..."}
```

This means **absent from Semrush's index for that database**, not "this page has
no rankings in Google". Two traps in one response: it is labelled `internal`
rather than a distinct not-found code, and it is not retryable, so an agent that
only reads `code` will report an outage. Say "not present in Semrush's `<db>`
index", and if the real question is whether a page ranks at all, first-party
Search Console data settles it.

`ERROR 120 :: WRONG KEY - ID PAIR` never comes from MCP. It comes from Semrush's
separate key-authenticated REST API, a different entitlement. MCP access over
OAuth can work while that key returns 120. Seeing error 120 while debugging MCP
means something is calling the wrong API.

## Always name the database

Keyword, domain and organic reports require a `database`: a two-letter country
code, optionally `mobile-` prefixed or `-ext` suffixed. The schema `enum` lists
all 145 accepted values. Results differ per database, and absence from one implies
nothing about another. The server defaults to `us` when unspecified, so an answer
built from one database must say which one or a reader will assume it is global.

`traffic_overview` and `audience_research` are the exception: global by default,
with an uppercase ISO-3166 `country` filter instead of a database code.

## Tools that need a project first

`site_audit` and `position_tracking` read data Semrush only collects for a
configured project in the account. They cannot audit or track an arbitrary domain.

```
1. execute_report(report="list_projects", params={})   -> project_id, tools[]
2. site_audit:        snapshots(id) -> snapshot_id;  info(id) -> counts
   position_tracking: campaigns(project_id) -> campaign_id
```

`list_projects` returns each project's `tools` array, so check for `siteaudit` or
`tracking` there before going further. Project ids are integers, not strings. An
id that does not exist fails as a `-32603` with `"campaign not found"` buried
inside, which is unhelpful enough that you should pre-empt it. When no project has
the tool enabled, say so plainly: the audit or campaign has to be created in
Semrush first, and no report substitutes for it.

`info` returns issue counts plus a `defects` map keyed by numeric issue id
(`{"2":4,"103":1,"135":213,…}`). `meta_issues` returns the 101 id-to-title
definitions (`103` = Missing h1). `issue_details` lists the affected URLs for one
id and needs the `snapshot_id` from `snapshots`. Never report a bare defect id.

## Reading the numbers honestly

- Row count is not keyword count. `resource_organic` can return the same keyword
  on several positions, and the headline keyword total counts rows.
- Traffic, volume and cost columns are modelled estimates. Attribute them to
  Semrush and name the database.
- `Number of Results` returns values in the tens or hundreds for high-volume
  queries, which cannot be a count of Google results. Do not build an argument on
  that column.
- `backlinks_overview` returned `score` and `trust_score` of 100 for a very large
  domain. The scale is capped, so 100 means "at the ceiling", not a precise value.
- Competitor rows are only meaningful alongside their `Common Keywords` value. A
  competitor sharing one keyword is a name collision, not a rival.

## References

- [references/reports.md](references/reports.md) — all 86 reports by toolkit,
  confirmed parameters, column naming, and the real responses measured here.
- [references/protocol.md](references/protocol.md) — OAuth discovery, the
  redirect-URI allowlist, the raw HTTP shape of the endpoint for agents without an
  MCP client, and the full error catalogue.
