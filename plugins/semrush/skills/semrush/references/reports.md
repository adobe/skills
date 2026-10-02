# Semrush v2 reports reference

Read from the live server at `https://mcp.semrush.com/v2/mcp` on 2026-09-21. Where
a figure appears it was measured, not transposed from the older v1 API.

## Confirmed parameters

`get_report_schema` output is directly machine-readable in v2: each parameter
carries `required` as a boolean, a `type`, an `enum` of accepted values where the
set is closed, and for `export_columns` both the full `items.enum` and the
`default` array. No string parsing needed.

Required signatures, all confirmed by calling `get_report_schema`:

| Report | Required |
|---|---|
| `domain_rank` | `target`, `database` |
| `domain_ranks` | `target` |
| `resource_rank_history` | `target`, `database` |
| `resource_organic` | `target`, `database` |
| `resource_organic_unique` | `target`, `database` |
| `resource_adwords` | `target`, `database` |
| `domain_organic_organic` | `domain`, `database` |
| `domain_adwords_adwords` | `domain`, `database` |
| `domain_domains` | `domains`, `database` |
| `rank_difference`, `search_rank` | `database` only |
| `phrase_this`, `phrase_these`, `phrase_organic`, `phrase_related`, `phrase_kdi` | `phrase`, `database` |
| `backlinks_overview`, `backlinks_refdomains`, `backlinks_competitors` | `target`, `target_type` |
| `summary` | `targets` (array), `export_columns` |
| `toppages`, `geo`, `sources` | `target`, `export_columns` |
| `summary_by_period` | `target`, `period_type`, `export_columns` |
| `list_projects` | nothing |
| `get_project`, `info`, `snapshots`, `meta_issues` | `id` (int64) |
| `issue_details` | `id` (int64), `snapshot_id` (string), `issueid` (integer) |
| `campaigns` | `project_id` (int64) |
| `tracking_position_organic` | `campaign_id` (string), `url` (string) |

Optional parameters worth knowing, and where they turn up:

| Optional | Effect | Appears on |
|---|---|---|
| `display_limit` | rows returned, and therefore cost | per-row analytics reports |
| `display_offset` | pagination | the same set |
| `display_sort` | sort key | the same set |
| `display_filter` | column filter expression | `resource_organic`, `phrase_related`, `backlinks_refdomains`, `domain_domains` |
| `display_positions` | `new` / `lost` / `rise` / `fall` | `resource_organic` |
| `display_positions_type` | `organic` / `all` / `serp_features` | `resource_organic` |
| `display_date` | roll back to a month, dashed `YYYY-MM-DD` | most historically capable reports |
| `display_daily` | daily granularity over recent weeks | `resource_organic`, `resource_rank_history` |
| `export_columns` | choose which columns come back | nearly everything |
| `country`, `device_type` | uppercase ISO-3166; `desktop` or `mobile` | `traffic_overview`, `audience_research` |
| `limit`, `page`, `sort` | pagination, spelled differently here | `issue_details` |
| `positions_type` | organic or paid SERP | `phrase_organic` |
| `period_type` | `day` or `week` | `summary_by_period` |

`target` accepts a domain, subdomain, subfolder (trailing slash required) or full
URL, and the type is auto-detected. The schema says so, and the server's own error
text confirms the dispatch: `resource_organic` given a URL reported
`get url_organic: ERROR 50 …`, so one v2 report fronts several underlying
endpoints.

The `domain_domains` keyword-gap parameter uses literal pipes, so it does not fit
a table cell:

```
domains = *|or|a.com|*|or|b.com
```

## Column naming changed

`export_columns` takes long snake_case names. The schema enumerates them per
report and states the default set. Examples confirmed in use:

| Report | Default columns |
|---|---|
| `domain_rank` | `domain`, `rank`, `organic_keywords`, `organic_traffic`, `organic_traffic_cost`, `paid_keywords`, `paid_traffic`, `paid_traffic_cost` |
| `resource_organic` | `keyword`, `position`, `previous_position`, `position_difference`, `volume`, `cpc`, `url`, `traffic_share`, `traffic_cost_share`, `competitive_density`, `results`, `trend` |
| `resource_organic_unique` | `url`, `keywords_count`, `traffic`, `traffic_share` |
| `resource_rank_history` | `rank`, `organic_keywords`, `organic_traffic`, `organic_traffic_cost`, `paid_keywords`, `paid_traffic`, `paid_traffic_cost`, `date` |
| `phrase_this` | `keyword`, `volume`, `cpc`, `competitive_density`, `results` |
| `phrase_organic` | `domain`, `url`, `triggered_serp_features` |
| `domain_organic_organic` | `domain`, `competition_level`, `common_keywords`, `organic_keywords`, `organic_traffic`, `organic_traffic_cost`, `paid_keywords` |
| `backlinks_refdomains` | `domain`, `backlinks_num`, `domain_score`, `domain_trust_score`, `first_seen`, `last_seen`, `ip`, `country` |
| `summary`, `toppages`, `geo`, `sources` | none — `export_columns` is required |

Two useful additions that are not in any default set: `keyword_difficulty` and
`intent` on `phrase_this`, and `position` on `phrase_organic`. Without the latter
you get a ranked list with no ranks.

`domain_rank`'s column enum is the widest, with 145 values covering
per-position-band keyword counts, per-intent traffic splits, and a
`serp_*_keywords` / `serp_*_positions` pair for every SERP feature Google shows,
including `serp_ai_overview_keywords`.

## Measured responses

Real calls, trimmed, with the measured `api_units` for each. `adobe.com` is used
because a large site fills every column; `example.com` appears only in parameter
illustrations, where no call was made.

### `domain_rank` — 10 units

`{target: "adobe.com", database: "us"}`

```
Domain;Rank;Organic Keywords;Organic Traffic;Organic Cost;Adwords Keywords;Adwords Traffic;Adwords Cost
adobe.com;51;9866369;43299118;82112484;13161;1236819;8468553
```

`metadata.url` was `https://www.semrush.com/analytics/overview/?db=us&q=adobe.com`.

The same report with `display_date: "2026-08-15"` cost **50 units** for one row
and returned rank 53, 9,505,740 organic keywords. Same shape, five times the
price.

### `resource_organic` — 30 units for 3 rows

`{target: "adobe.com", database: "us", display_limit: 3}`

```
Keyword;Position;Previous Position;Position Difference;Search Volume;CPC;Url;Traffic (%);Traffic Cost (%);Competition;Number of Results;Trends
adobe;1;1;0;1220000;7.67;https://www.adobe.com/;2.25;9.11;0.28;148;0.44,0.54,...
.;1;1;0;2240000;0.00;https://www.adobe.com/acrobat/resources/full-stop-punctuation.html;0.68;0.00;0.00;476;0.36,...
qr code generator;1;1;0;2240000;2.06;https://www.adobe.com/express/feature/image/qr-code-generator;0.68;0.74;0.48;98;0.07,...
```

The CSV header uses human-readable labels even though `export_columns` uses
snake_case identifiers. The second row's keyword is a single full stop, which is a
reminder that a keyword field can hold anything and needs no cleaning before
display.

### `resource_organic_unique` — 30 units for 3 rows

`{target: "adobe.com", database: "us", display_limit: 3}`

```
Url;Number of Keywords;Traffic;Traffic (%)
https://www.adobe.com/;6690;1139118;2.63
https://get.adobe.com/reader/;8653;930680;2.14
https://www.adobe.com/express/feature/image/qr-code-generator;5562;619286;1.43
```

### `phrase_this` — 10 units

`{phrase: "seo audit", database: "us", export_columns: ["keyword","volume","cpc","competitive_density","keyword_difficulty","intent","trend"]}`

```
Keyword;Search Volume;CPC;Competition;Keyword Difficulty Index;Intent;Trends
seo audit;22200;7.2;0.26;85;1;0.36,0.44,0.36,0.44,0.54,1.00,0.66,0.36,0.29,0.24,0.24,0.29
```

### `phrase_organic` — 30 units for 3 rows

`{phrase: "seo audit", database: "us", display_limit: 3, export_columns: ["position","domain","url","triggered_serp_features"]}`

```
Position;Domain;Url;Keywords SERP Features
1;www.seoptimer.com;https://www.seoptimer.com/;6,7,9,21,36,38,45,52
2;www.semrush.com;https://www.semrush.com/siteaudit/;6,7,9,21,36,38,45,52
3;ahrefs.com;https://ahrefs.com/site-audit;6,7,9,21,36,38,45,52
```

SERP feature ids are numeric and were not resolved to names here.

### `domain_organic_organic` — 120 units for 3 rows

`{domain: "adobe.com", database: "us", display_limit: 3}`

```
Domain;Competitor Relevance;Common Keywords;Organic Keywords;Organic Traffic;Organic Cost;Adwords Keywords
istockphoto.com;0.46;1174523;10918483;17677532;8265098;148
shutterstock.com;0.44;1335777;25956945;16429176;7068174;4669
magnific.com;0.38;888763;5302847;9099330;3649991;9
```

40 units per row, the most expensive per-row report measured. Note this report
takes `domain`, not `target`.

### `backlinks_overview` — 40 units

`{target: "adobe.com", target_type: "root_domain"}`

```
total;domains_num;ips_num;follows_num;nofollows_num;score;trust_score;urls_num;ipclassc_num;texts_num;forms_num;frames_num;images_num
534185589;1980735;617133;496288095;37923514;100;100;379937088;219350;414927327;642162;1977148;114318668
```

`score` is Authority Score, at the top of its scale here.

### `summary` — 0 units

`{targets: ["adobe.com"], export_columns: ["target","visits","users","pages_per_visit","bounce_rate","time_on_site","display_date"]}`

```
target;visits;users;pages_per_visit;bounce_rate;time_on_site;display_date
adobe.com;498168818;253167796;4.006;0.5813;561;2026-08-01
```

`display_date` shows the data is monthly and lags. The column enum includes
`ai_assistants` and `ai_search` as acquisition channels, which first-party Search
Console data does not report at all.

### `toppages` — 0 units

`{target: "adobe.com", export_columns: ["page","traffic","traffic_share","display_date"], display_limit: 3}`

```
page;traffic;traffic_share;display_date
acrobat.adobe.com/dc-chrome-extension/index.html;75509238;0.150694891546;2026-08-01
auth.services.adobe.com/en_us/deeplink.html;30011033;0.020501560176;2026-08-01
adobeid-na1.services.adobe.com/ims/fromsusi;25786626;0.003048243778;2026-08-01
```

These are clickstream-derived pages, so infrastructure and auth URLs dominate.
They are not the same population as `resource_organic_unique`, which is search
rankings only.

## Project-backed reports

All four measured at 100 units except `issue_details` at 0, and all return
`metadata.format: "json"` with `data` already parsed.

### `list_projects` — 100 units, `data` is an array

```json
[{"project_id":31300788,"project_name":"www.aem.live","url":"www.aem.live",
  "domain_unicode":"www.aem.live",
  "tools":[{"tool":"tracking"},{"tool":"siteaudit"}],"permission":["OWNER"]}]
```

`metadata.url` is `https://www.semrush.com/projects/`.

### `snapshots` — 100 units

```json
[{"snapshot_id":"6ab12b71d29f71103c811601","finish_date":1789996168527}]
```

`data` is a bare array. The older API wrapped this in a `{"snapshots": …}` object,
so a v1-era parser will not find it.

### `info` — 100 units

`{id: 31300788}`, trimmed:

```json
{"id":31300788,"url":"www.aem.live","status":"FINISHED",
 "errors":11,"warnings":400,"notices":115,"broken":4,"redirected":17,
 "healthy":3,
 "defects":{"2":4,"8":4,"15":2,"21":1,"101":21,"103":1,"104":3,"105":67,
            "112":4,"114":71,"117":23,"135":213,"213":19,"214":4,"215":20,
            "216":57,"217":8,"218":1,"220":1,"223":2}}
```

### `meta_issues` — 100 units

`{id: 31300788}` returns `data` as a bare array of 101 definitions, each with
`id`, `title`, `title_page`, `url_column`, `info_column`. The ids in the `defects`
map above decode to:

| id | Title |
|---|---|
| 2 | 4xx errors |
| 8 | Broken internal links |
| 15 | Duplicate meta descriptions |
| 21 | Large HTML page size |
| 101 | Title element is too short |
| 103 | Missing h1 |
| 104 | Multiple h1 tags |
| 105 | Duplicate content in h1 and title |
| 112 | Low text to HTML ratio |
| 114 | Missing hreflang and lang attributes |
| 117 | Low word count |
| 135 | Unminified JavaScript and CSS files |
| 213 | Pages with only one internal link |
| 214 | Permanent redirects |
| 215 | Resources formatted as page links |
| 216 | Links with no anchor text |
| 217 | Links with non-descriptive anchor text |
| 218 | External pages or resources with 403 HTTP status code |
| 220 | Too much content |
| 223 | Content not optimized |

Fetch this mapping rather than hard-coding it; there are 101 ids and only 20 are
shown here.

### `issue_details` — 0 units

`{id: 31300788, snapshot_id: "6ab12b71d29f71103c811601", issueid: 103, limit: 2}`

```json
{"limit":2,"page":0,"total":1,"issue_id":103,
 "data":[{"target_url":"","page_id":"6ab12c8835582b01d62c4485",
          "source_url":"https://www.aem.live/docs/setup-byo-cdn-push-invalidation-for-fastly"}]}
```

Note the nesting: the envelope's `data` contains its own `data` array. The
`metadata.url` echoes every parameter back as a deep link into the audit
interface.

### `tracking_position_organic`

Not called on v2. In the older API it charged per keyword in the campaign and
returned a keyword-keyed object with `Dt` (position by date), `Diff1`, `Diff7`,
`Diff30`, `Vi` (visibility) and `Sf` (SERP features), a dash meaning unranked.
The v2 schema keeps the same required `campaign_id` and `url`, but the response
shape was not verified on v2.

## Full catalogue

86 reports across 12 toolkits. The v2 catalogue publishes a name, a description
and a usage note per report, and **no price** — cost is only knowable from
`metadata.usage.api_units` after the call.

**`audience_research`** — 10 reports
  `age_and_sex_distribution`, `audience_insights`, `audience_interests`, 
  `categories`, `education_distribution`, `geo`, `household_distribution`, 
  `income_distribution`, `occupation_distribution`, `purchase_conversion`

**`backlinks_research`** — 12 reports
  `backlinks`, `backlinks_anchors`, `backlinks_ascore_profile`, 
  `backlinks_categories`, `backlinks_categories_profile`, `backlinks_geo`, 
  `backlinks_historical`, `backlinks_overview`, `backlinks_pages`, 
  `backlinks_refdomains`, `backlinks_refips`, `backlinks_tld`

**`competitors_research`** — 10 reports
  `backlinks_comparison`, `backlinks_competitors`, `backlinks_matrix`, 
  `domain_adwords_adwords`, `domain_domains`, `domain_organic_organic`, 
  `domain_shopping_shopping`, `rank_difference`, `search_rank`, `traffic_rank`

**`domain_overview`** — 3 reports
  `domain_rank`, `domain_ranks`, `resource_rank_history`

**`keyword_research`** — 10 reports
  `phrase_adwords`, `phrase_adwords_historical`, `phrase_all`, 
  `phrase_fullsearch`, `phrase_kdi`, `phrase_organic`, `phrase_questions`, 
  `phrase_related`, `phrase_these`, `phrase_this`

**`organic_research`** — 3 reports
  `domain_organic_subdomains`, `resource_organic`, `resource_organic_unique`

**`paid_search_research`** — 3 reports
  `domain_adwords_historical`, `resource_adwords`, `resource_adwords_unique`

**`position_tracking`** — 13 reports
  `campaigns`, `locations`, `tracking_campaign_dates`, 
  `tracking_competitors_adwords`, `tracking_competitors_organic`, 
  `tracking_landing_pages_adwords`, `tracking_landing_pages_organic`, 
  `tracking_overview_adwords`, `tracking_overview_organic`, 
  `tracking_position_adwords`, `tracking_position_organic`, 
  `tracking_visibility_adwords`, `tracking_visibility_organic`

**`projects`** — 2 reports
  `get_project`, `list_projects`

**`shopping_research`** — 2 reports
  `domain_shopping`, `domain_shopping_unique`

**`site_audit`** — 8 reports
  `history`, `info`, `issue_details`, `meta_issues`, `page_info`, 
  `page_list`, `snapshot`, `snapshots`

**`traffic_overview`** — 10 reports
  `accuracy`, `destinations`, `rank`, `social_media`, `sources`, 
  `subdomains`, `subfolders`, `summary`, `summary_by_period`, `toppages`

