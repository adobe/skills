# The spec database (spec.sqlite)

`spec-build.mjs` writes one SQLite file, `<dir>/spec.sqlite`. It is the skill's output and its contract with every
consumer: a viewer application, a migration agent, an export script. Consumers read it; they never crawl or judge.
Column and key names are neutral; nothing in them names a site.

## meta

`meta(key, value)` holds strings; some values are JSON. Every key is optional; consumers fall back to neutral wording.

| Key | Meaning |
|---|---|
| `site_name` | display name |
| `origin` | e.g. `https://www.example.com`, no trailing slash |
| `scope_path` | e.g. `/en/` |
| `scope_label` | short label for headers |
| `reference_blocks_name`, `reference_blocks_count` | the block library reuse verdicts compare with |
| `rum_available` | `"1"` or `"0"`; with `"0"` every traffic figure is unavailable, not zero |
| `rum_window`, `rum_bundles` | telemetry window and sampled page views |
| `sitemap_urls` | URLs the spec covers (the sample when sampled) |
| `inventory_total`, `inventory_source` | URLs found and where (`sitemap` or `crawl`) |
| `sample_note` | set only when the inventory was capped: what the sample is |
| `fetch_sources` | JSON counts of pages by source: `live`, `headed`, `archive` |
| `evidence_note` | set only when pages came from the Internet Archive: how many and their capture dates |
| `built_at`, `built_by` | build date and method |
| `blind_rule` | what the judging agent was not allowed to read |
| `variant_cut` | how layout variants were cut |
| `findings` | JSON list of HTML snippets, numbers already computed |
| `i18n_notes` | JSON list of strings |
| `consent_summary` | plain text on consent today |
| `loading_order` | JSON list of `{stage, what}` for martech on EDS |
| `media_ext` | extension of captures and crops (`jpg`) |
| `tour_steps` | optional JSON list of `{anchor, fallback?, placement, title, body[], rum?}` for a viewer's onboarding |

## Tables

| Table | Main columns |
|---|---|
| `url` | id, url, path, section, depth, in_sitemap, status, final_url, final_status, outcome, aem_template, variant_code, title, eds_path, needs_migration_redirect, pageviews_90d, rum_bundles, traffic_band, block_count, capture_key, main_chars, flag |
| `template` | id, label, url_count, pageviews_90d, variant_count, top_variants_share, rep_url |
| `variant` | code, template_id, rank, label, core (JSON), optional (JSON), url_count, pageviews_90d, distinct_sets, rep_url, rep_capture_key |
| `block` | name, kind, description, aem (JSON), reference_block, verdict, rationale, url_count, instance_count, template_count, pageviews_90d |
| `block_variant` | id, block, variant, verdict, rationale, url_count, instance_count, examples (JSON `[{url, crop}]`) |
| `page_block` | url_id, pos, block, variant, kind, aem (JSON), path, nested_in, section, crop |
| `aem_component` | name, url_count, instance_count, maps_to (JSON) |
| `redirect` | id, src, target, status, hops, kind, target_status, external, in_sitemap, inbound_pages, rum_views, note |
| `broken` | id, url, status, source (`sitemap`/`link`/`rum`), kind, in_scope, inbound_pages, inbound_main, rum_views, rum_bundles, referrers (JSON), note |
| `link` | from_url_id, to_url, zone |
| `rum_redirect_landing` | path, views, bundles |
| `page_signal` | url_id, signal |
| `feature` | id, class, class_name, name, evidence, disposition, reproducibility, status, pattern, eds, decisions (JSON), sitewide, reach_pages, reach_templates, pageviews_90d |
| `feature_page` | feature_id, url_id |
| `vendor` | host, role, class, seen_pages, via, in_csp, consent_group, launch_rules |
| `launch_rule` | id, name, vendor, kind, events, path_values (JSON), html_paths, selectors (JSON), hosts, needs_rewrite, eds_paths (JSON), live_pages |
| `datalayer_field` | path, data_elements (JSON), group_name, eds_source |
| `metadata_field` | name, aem_source, used_by (JSON), coverage_pages, distinct_values, top_values (JSON) |
| `query_index` | name, include_paths, exclude_paths, filter, properties, consumers, source, yaml |
| `locale_tree` | tree, country, language, urls, shared_with_scope, shared_pct, rum_views_90d, deep_sampled, live_pages, templates, blocks, unmapped, sitemap |
| `site_config` | key, now, eds, decision |
| `search_probe` | term, expect_count, expect_titles (JSON), expect_includes |
| `open_question` | id, area, owner (`stakeholder`/`implementer`), blocking, question, context, options (JSON), default_assumption, impact, link, features (JSON) |
| `meta` | key, value |

Consumer-owned tables, created empty so a consumer can keep them across reloads: `question_answer` (id, question_id,
answer, decided_option, answered_by, answered_at), `chat_log`, `usage`, `view_spec`. A reload replaces every other
table and keeps these.

SQL views: `v_template_blocks(aem_template, block, urls)`, `v_block_usage(block, variant, instances, urls, templates)`,
`v_url_blocks(path, aem_template, variant_code, pos, block, variant, kind, nested_in, section)`.

Media: `<dir>/media/<capture_key>/page.<media_ext>` for page captures and `<dir>/media/<crop>` for block crops; `crop`
and `capture_key` in the tables are these relative paths.

