# References index

Map of reference files used by the wf-planning-solution-architect skill. Load only what the question requires; do not preload everything.

## Top-level synthesis references (read these first)

| File | When to load |
|---|---|
| `workspace-build-playbook.md` | Designing or building a workspace. Categories B and C in SKILL.md routing. |
| `best-practice-template.md` | Referencing the Fréscopa exemplar for patterns OR explicitly checking against the known deviations. |
| `best-practice-template.json` | Trimmed sample export (minified, ~1.6 MB): full structure, ~5 records per record type. Inspect only when a question requires field-level or record-level detail beyond the digest. |
| `limits-and-tiers.md` | Any limits, capacity, sizing, or tier question. Always check the customer's tier (Select / Prime / Ultimate) before quoting numbers. |
| `public-vs-api-discrepancies.md` | Whenever public docs and observed API behavior could disagree (precision, formulas, color palettes, connection naming, identity model, etc.). |
| `customer-conversation-framings.md` | When the user is preparing for or in a customer conversation (limit escalation, P95 ask, RPM comparison, reporting expectations, workspace build engagement, roadmap question, template adoption review). |

## Public docs layer (UI/UX surface)

Public Adobe documentation is **not bundled**. It is fetched live from Experience League, so it never goes stale in this repo.

Use `scripts/search.js` to find the right pages, then fetch the `markdownUrl` from the results (any Experience League doc URL with `.md` appended returns clean markdown):

```bash
node scripts/search.js [--all] <keyword1> [keyword2] [...]
```

`scripts/docs-index.json` backs the search: one entry per Planning documentation page with its title, section, description, headings, and URL. Sections covered: general, architecture, fields, records, views, access, requests, best-practices, api, fusion, ai-assistant, genstudio, canvas-dashboards.

## Synthesized references (not available on Experience League)

| File | When to load |
|---|---|
| `synthesized/automations-deep-dive.md` | Canonical decision tree across the 5 automation surfaces (native button-click, native field-change, Fusion, AI Assistant, request-form approval). Load for Category G. |
| `synthesized/record-collaboration.md` | Comments, history, record layout, and record sharing behavior. |
| `synthesized/notification-preferences.md` | Notification preference behavior. |

## API reference layer (programmatic surface)

No separate API reference file is bundled. The API-surface facts most often needed (filter operator sets by field type, formula support gaps, precision limits, connection object types, view behavior) are stated directly in the SKILL.md routing sections, and `public-vs-api-discrepancies.md` records where public documentation and observed API behavior diverge.

For anything not covered there, confirm against the live Planning API rather than quoting from memory.

## Loading strategy

For any given question, the routing in SKILL.md identifies the category (A through N). Load:
1. The 1 to 2 top-level synthesis files the category names.
2. Any synthesized files explicitly called out.
3. If the question needs public UI/UX documentation, run `scripts/search.js` and fetch the top 2 to 3 results.
4. Stop. Do not preload neighbors.

If a question spans categories, load only the union of files; do not load every reference.

## Refresh procedure

**Public docs:** nothing to refresh. Pages are fetched live from Experience League at answer time. If Adobe publishes new Planning articles, add entries to `scripts/docs-index.json` (path, url, title, section, description, headings) so the search can surface them.

**API-surface facts:** the operator sets, precision limits, and function support notes live inline in SKILL.md. Re-verify them against the live Planning API, or request refreshed detail from the WFP engineering team, when the product changes.

**Best-practice template:** re-export when the canonical template changes meaningfully. Update both the .json (raw) and the .md (digest). Re-validate the "Known deviations" section against the current template state.

**Discrepancies file:** validate the reconciliation table against the live Planning API. Update the date at the bottom of the file when validated.

Date of this index: May 11, 2026.
