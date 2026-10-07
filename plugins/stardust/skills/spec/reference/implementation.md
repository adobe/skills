# Implementation layer

`judgement/implementation.json` says how each part must be built on EDS. Start from `templates/implementation.json`.

## features[]
`{ id, class, name, evidence, disposition, reproducibility, pattern, eds, decisions[], reach }` — class, disposition
and reproducibility use the dynamics taxonomy (`../../dynamics/reference/classes-and-signals.md`, `triage.md`).
Run the dynamics detector on the variant representatives (≥ 80% of each template) plus one page per data-driven
block and form type, then curate its findings into features. `reach` is how spec-build finds the pages:
`block:<name>`, `bvariant:<block>|<variant>`, `signal:<name>` (a page signal), `url:<path>`, `sql:<SELECT url ids>`.
`signals` in the same file adds regex signals over the raw HTML (`{ "hcp": "HCP_CONTENT" }`). A feature on ≥ 90%
of pages is site-wide.

## Martech (spec-martech output → features, vendors, launch rules, data layer)
- Tag manager: rules matching page paths with `.html`, or DOM selectors, break silently when URLs and markup change
  — they are the rewrite sheet. Campaign rules whose path no longer resolves are retire candidates.
- Data layer: fields read by data elements must be emitted from page metadata; data elements that read the DOM
  (`$(".selector")`) break on new markup — list them.
- Consent: record the geo rule sets (model, default state per category) in `consent_summary`; the CMP loads before
  the tag manager; tags stay gated by consent category.
- `loading_order`: head (CMP), eager (data layer), delayed (tag manager), on interaction (heavy vendors).

## metadata_contract[], query_indexes[], site_config[], template_labels{}
- metadata: `{ name, source: "body:data-x" | "meta:<name>", aem, used_by[] }` — coverage is measured at build.
- indexes: `{ name, include[], exclude[], filter, properties[], consumers[], source }` — the build drafts helix-query.yaml.
- site_config: CDN, CSP and security headers, robots/sitemaps, URL format, error pages, structured data.

## Locales
Inventory every sitemap (spec-inventory counts them). For multi-language sites, write `i18n_notes`: tree structure,
inheritance (live copies / masters), hreflang presence, what changes per tree (strings, search index, consent, gates).
Fetch two to four trees fully (S2–S3 with another scopePath) when coverage of the block set across trees matters.

## open_questions[]
Start from `templates/open-questions.json`; keep what applies, add site-specific ones. Each:
`{ id, area, owner: "stakeholder" | "implementer", blocking, question, context, options[], default, impact_rule, link }`.
`impact_rule`: `sql:<SELECT one value>` or `value:<n>`. The default is what a hands-off migration ships.
