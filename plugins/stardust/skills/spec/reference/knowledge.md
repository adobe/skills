# The spec's output (knowledge/)

`spec-knowledge.mjs` writes `stardust/spec/knowledge/` from the run's raw material and `judgement/`. With
`judgement/` it is the skill's committed output and its contract with every client (a migration agent, an export
script, any application). Clients read it; they never crawl or judge. The folder is rewritten whole on each run; rows
are in a stable order, so a diff shows what changed. Names are neutral; nothing in them names a site.

## Files

Large row sets are JSON Lines (`.jsonl`), the rest JSON. `url_id` is the `id` of a `urls.jsonl` row.

| File | Rows and main fields |
|---|---|
| `site.json` | `site`, `origin`, `scope_path`, `reference_blocks {name, count}`, `rum {available, window, bundles}`, `sitemap_urls`, `inventory_total`, `inventory_source`, `sample_note` (only when capped), `fetch_sources {live, headed, archive}`, `evidence_note` (only with archive captures), `built_at`, `built_by`, `provenance`, `variant_cut`, `capture_format`, `i18n_notes[]` |
| `urls.jsonl` | id, url, path, section, depth, in_sitemap, status, final_url, final_status, outcome, template, variant_code, title, eds_path, needs_migration_redirect, pageviews_90d, rum_bundles, traffic_band, block_count, capture_key, main_chars, flag |
| `page-blocks.jsonl` | per page: `url_id`, `url`, `blocks[] {pos, block, variant, kind, source[], path, nested_in, section, crop}`; chrome globals first and last |
| `signals.jsonl` | per live sitemap page: `url_id`, `url`, `signals[]` (`hreflang`, `script:<host>`, `iframe:<host>`, `jsonld:<type>`, and `implementation.json#signals` names) |
| `blocks.json` | name, kind, family, description, source[], reference_block, verdict, rationale, url_count, instance_count, template_count, pageviews_90d, `variants[] {variant, verdict, rationale, url_count, instance_count, examples[] {url, crop}}` |
| `variants.json` | code, template_id, rank, label, core[], optional[], url_count, pageviews_90d, distinct_sets, rep_url, rep_capture_key |
| `templates.json` | id, label, url_count, pageviews_90d, variant_count, top_variants_share, rep_url |
| `source-components.json` | name, url_count, instance_count, maps_to {block: instances} |
| `redirects.jsonl` | src, target, status, hops, kind (`legacy`: redirects today; `migration`: every changed delivered path, `.html` included), target_status, external, in_sitemap, inbound_pages, rum_views, note |
| `broken.jsonl` | url, status, source (`sitemap` / `link` / `rum`), kind, in_scope, inbound_pages, inbound_main, rum_views, rum_bundles, referrers, note |
| `bad-links.jsonl` | per dead or redirected target: `to_url`, `main[]` and `chrome[]` (url ids of the pages linking to it) |
| `redirect-landings.json` | path, views, bundles |
| `features.json` | id, class, class_name, name, evidence, disposition, reproducibility, status, pattern, eds, decisions[], reach, sitewide, reach_pages, reach_templates, pageviews_90d, pages[] (empty when site-wide) |
| `martech.json` | `consent_summary`, `loading_order[] {stage, what}`, `vendors[]`, `launch_rules[]`, `datalayer[]` |
| `metadata.json` | name, source, used_by[], coverage_pages, distinct_values, top_values |
| `query-indexes.json`, `helix-query.yaml` | name, include_paths, exclude_paths, filter, properties, consumers, source, yaml; the yaml file joins them (dynamics skeleton) |
| `locales.json` | tree, country, language, urls, rum_views_90d, sitemap, … |
| `site-config.json` | key, now, eds, decision |
| `search-probes.json` | term, expect_count, expect_titles[], expect_includes |
| `open-questions.json` | id, area, owner (`stakeholder` / `implementer`), blocking, question, context, options[], default_assumption, impact_rule, impact, link, features[], answer {answer, option, by, at}, effective |
| `findings.json` | `{ title, text, numbers[] }`, plain text, every number computed |

Captures stay in the run: `<work>/media/<capture_key>/page.<capture_format>` and `<work>/media/<crop>`.

## Rules

Feature `reach`, question `impact` and `{{…}}` in findings use one rule format, evaluated by `rules.mjs`. A rule that
cannot be computed stops S10 with its text; there is no fallback to a typed number. Extend the format in `rules.mjs`
when a real run needs a figure it cannot express.

- **Filter:** `field=v[,v…]` or `field!=…` on a row; `*` is a case-insensitive glob; `null` matches a missing value;
  quote values with spaces or commas (`template="page · news"`).
- **URL terms** (reach, `urls …`): `live` (outcome page), `sitemap`, `nested`, `block:<b>[|<variant>][,…]`,
  `signal:<glob>[,…]`, `verdict:<v>` (a block on the page has that verdict), or any filter on a `urls.jsonl` row;
  `!` negates; terms are ANDed. Example reach: `live sitemap signal:script:*player*,iframe:*player*`.
- **Numbers:** `urls <terms…>` · `count <set> [filters…]` · `sum <set>.<field> [filters…]` ·
  `<set>[<key>].<field>` · `<set>[max:<field>].<field>` · `value:<n>`. Sets: urls, page-blocks, blocks,
  block-variants, variants, templates, features, redirects, broken, bad-links, vendors, launch-rules, datalayer,
  metadata, query-indexes, locales, site-config, search-probes, open-questions, source-components.
- Examples: `urls sitemap flag=empty` · `count redirects kind=legacy external=1` · `blocks[cards].url_count` ·
  `{{urls live sitemap !verdict:new}} of {{urls live sitemap}} live pages need no new block`.
