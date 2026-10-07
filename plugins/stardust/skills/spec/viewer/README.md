# Spec viewer

A read-only explorer for a migration spec: a Cloudflare Worker (Hono API, chat with SQL tools, chat-generated
pages, live migration spec) plus a React Spectrum 2 UI. It reads the D1 database the spec pipeline builds. Nothing
in the code names a site: every site-specific word comes from the database's `meta` table.

## Deploy

1. **Render the config.** Copy `wrangler.template.jsonc` to `wrangler.jsonc` and replace the placeholders:

   | Placeholder | Value |
   |---|---|
   | `__WORKER__` | Worker name, e.g. `acme-spec` |
   | `__D1_NAME__` / `__D1_ID__` | name and id of the D1 database that holds the spec (`wrangler d1 create <name>` prints the id) |
   | `__R2_BUCKET__` | R2 bucket for page captures and block crops (`wrangler r2 bucket create <name>`) |
   | `__FOUNDRY_ENDPOINT__` | an Anthropic Messages API compatible endpoint (`.../v1/messages`) |
   | `__CHAT_MODEL__` | model id served by that endpoint |

   ```sh
   sed -e 's/__WORKER__/acme-spec/' -e 's/__D1_NAME__/acme-spec/' -e 's/__D1_ID__/<uuid>/' \
       -e 's/__R2_BUCKET__/acme-spec-media/' -e 's#__FOUNDRY_ENDPOINT__#<endpoint>#' -e 's/__CHAT_MODEL__/<model>/' \
       wrangler.template.jsonc > wrangler.jsonc
   ```

   `wrangler.jsonc` is git-ignored: it holds deployment ids.
2. `npm install`
3. `npm run deploy` (builds the UI with Vite into `dist/`, then `wrangler deploy`).

Local development: `npm run dev` (build, then `wrangler dev`), or `npm run dev:web` with `SPEC_API=<deployed worker URL>`
to run the UI against a deployed Worker's data.

## Secrets

Set with `wrangler secret put <NAME>`:

- `FOUNDRY_API_KEY`: key for `FOUNDRY_ENDPOINT`. Without it the explorer works; chat and generated views fail.
- `EDITOR_KEY`: shared key people enter to record answers to open questions. Viewing stays public.
- `ADMIN_TOKEN` (optional): enables `PUT /api/admin/media/<key>` (header `x-admin-token`) to upload captures and crops
  into R2. Delete the secret after loading media.

`DAILY_TOKEN_BUDGET` (a var) caps model tokens per UTC day; `CHAT_LIMITER` caps chat requests per IP.

## The meta contract

`meta(key, value)` holds strings; some values are JSON. Every key is optional and falls back to neutral wording.
`GET /api/meta` returns them to the UI (loaded once at startup); the chat prompt and the spec read them per request.

| Key | Meaning | Used by |
|---|---|---|
| `site_name` | display name (fallback: origin host, then "the site") | header, page title, favicon letter, Overview, Blocks, Implementation, chat prompt, spec |
| `origin` | e.g. `https://www.example.com` | "Open live page", stripping origins from URLs in lists, chat prompt, spec |
| `scope_path` | e.g. `/en/` (fallback `/`) | URL list paths, broken-link filter, locale tables, About, chat prompt, spec title |
| `scope_label` | short header label (fallback: host and scope path) | header, Overview |
| `reference_blocks_name` | name of the existing block library verdicts compare with | Blocks, block detail, About, chat prompt, spec block table |
| `reference_blocks_count` | number of blocks in that library | same as above |
| `rum_available` | `"1"` or `"0"` (missing: inferred from `rum_bundles` > 0) | every traffic surface (see below), chat prompt, spec |
| `rum_window` | e.g. `90 days (2026-07-01 to 2026-09-29)` | Overview, About, side note, chat prompt, spec |
| `rum_bundles` | sampled page views used | Overview, About |
| `sitemap_urls` | sitemap URL count (fallback: counted from `url`) | Overview, About, chat prompt, spec |
| `built_at`, `built_by` | build date and method | Overview, About, spec |
| `blind_rule` | sentence on what the agent was not allowed to read | About caveats |
| `variant_cut` | how layout variants were cut | About |
| `findings` | JSON list of HTML snippets | Overview "What this scope says" |
| `i18n_notes` | JSON list of strings | Multi-language, spec |
| `consent_summary` | plain text on consent today | Martech consent section, spec |
| `loading_order` | JSON list of `{stage, what}` (fallback: a generic four-stage order) | Martech loading order, spec |
| `tour_steps` | JSON list of `{anchor, fallback?, placement, title, body[], rum?}` overriding the generic tour | first-visit tour |

All meta pairs are also given to the chat model as build facts.

### Without real-user data (`rum_available` = `"0"`)

Views KPIs, view columns (URLs, blocks, redirects, locale trees), the traffic facet and sort, view facts on page, block,
template and feature pages, the "Hit by real users" 404 tab, the "Used by real users" redirect tab, traffic-based chat
suggestions and the tour's real-user step are hidden. The 404 page opens on links found in pages, the Overview risk
tiles show dead links instead of real-user 404s, About says once that telemetry was not available, and the chat prompt
tells the model not to answer traffic questions. Null or zero `pageviews_90d` renders as 0.

## D1 tables

The API and the chat query these tables (the chat sees the full schema in `src/chat.ts`):

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
| `question_answer` | id, question_id, answer, decided_option, answered_by, answered_at (written by the app) |
| `chat_log` | at, question, sql, answer, ms, tokens (written by the app) |
| `usage` | day (unique), tokens, questions (written by the app) |
| `view_spec` | id, title, summary, question, spec, created_at, tokens (written by the app) |
| `meta` | key, value |

SQL views: `v_template_blocks(aem_template, block, urls)` (used by the API), `v_block_usage(block, variant, instances, urls, templates)`
and `v_url_blocks(path, aem_template, variant_code, pos, block, variant, kind, nested_in, section)` (offered to the chat).

Media in R2: `crops/<capture_key>/page.webp` for page captures and `crops/<crop>` for block crops.
