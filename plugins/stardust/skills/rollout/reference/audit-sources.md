# optimize audit sources → ledger → AEM autofix

optimize does not invent its own audit. It **aggregates existing audit skills**
into one findings ledger, then **autofixes** the platform-fixable findings for
AEM. This file is the mapping: each source, how to run it, how its findings
normalize into the ledger (layer + fixability), and which AEM fixer (if any)
resolves them.

All sources share one ledger (`optimize/findings.json`), one id space
(`f-<hash(source|layer|check|scope)>`), one scorecard, one gate, and one loop.
A run of a source only resolves **its own** findings — never another source's.

## The sources

| source | how rollout uses it | produces (layers) |
|---|---|---|
| `rollout:baseline` | built-in deterministic detectors (`optimize.mjs`) — runs automatically | accessibility, seo, ai-search, cross-page |
| `impeccable:critique` | `$impeccable critique <delivered-or-migrated>` → record findings | design-ux, brand-tensions |
| `impeccable:audit` | `$impeccable audit <…>` (a11y / perf / responsive) → record | accessibility, seo (CWV) |
| `marketing:seo-audit` | run the `seo-audit` skill → record its issue/impact/evidence/fix items | seo, cross-page |
| `marketing:schema` | run the `schema` skill → record missing/!invalid structured data; payload feeds the JSON-LD autofix | ai-search, seo |
| `marketing:ai-seo` | run the `ai-seo` skill → record AI-search readiness gaps (llms.txt, citability) | ai-search |
| `marketing:site-architecture` | run the `site-architecture` skill → record crawl/structure issues | seo, cross-page |
| `stardust:tensions` | read the `T-*` tensions from `stardust/current/brand-review.html` → record | brand-tensions, design-ux, accessibility |

These are **referenced, not vendored** (the user's decision). impeccable is
already a stardust dependency; the marketing skills come from
`coreyhaines31/marketingskills`. If a source isn't installed, skip it and note
the gap — the baseline source always runs.

## Recording an external finding

The agent runs a source, then normalizes each of its findings:

```bash
node skills/rollout/scripts/findings.mjs record \
  --source <source> --layer <layer> --check <check-id> \
  --severity P1|P2|P3 --fixability platform-migration|design-pass|out-of-scope \
  --scope-level page|site --scope-ids <slug[,slug]> \
  --evidence "what was observed" --recommend "the fix"
```

Normalization rules of thumb:
- **Severity:** the source's "critical / high" → P1, "medium" → P2, "low" → P3.
- **Fixability:** can the **EDS delivery** fix it (head/metadata/blocks/CWV) →
  `platform-migration`; is it authored content/design → `design-pass`; infra/external
  → `out-of-scope`.
- **check id:** reuse a stable, descriptive slug; if it matches a row in the AEM
  fixer table below, autofix will pick it up automatically.

## Fixability → who fixes it

- **platform-migration** → the AEM autofix engine and/or a re-`deploy` resolve it.
- **design-pass** → upstream (`migrate` / `prototype`); rollout **surfaces only**.
- **out-of-scope** → informational; never gates beyond its severity.

## AEM autofix registry (`autofix-aem.mjs`)

`check` → fixer. `kind`: deterministic (mechanical) · content-draft (generates
copy, applied under the aggressive policy, logged for review) · manual (prepares
guidance/payload, a human applies).

| check | fixer (strategy) | kind | what it does |
|---|---|---|---|
| `single-h1` | `eds-fix-h1` | deterministic | promote first heading / demote extras so exactly one `<h1>` |
| `sitemap` | `rollout-assemble` | deterministic | (re)generate `sitemap.xml` via `assemble.mjs` |
| `title-missing` / `title-length` | `eds-metadata-title` | content-draft | set the `metadata` Title (draft from `<h1>`) |
| `meta-description` | `eds-metadata-description` | content-draft | set the `metadata` Description (draft from first paragraph) |
| `img-alt` | `eds-alt-draft` | content-draft | add `alt` drafted from the image filename |
| `duplicate-title` | `eds-disambiguate-title` | content-draft | append a path-derived qualifier to the Title |
| `jsonld` | `eds-jsonld` | manual | place JSON-LD via head.html/metadata (payload from `marketing:schema`) |
| `canonical` | `eds-canonical` | manual | self-canonical is a head.html / project-config change |
| `landmark-main` | `eds-landmark-main` | manual | ensure block output lands inside `<main>` (structural; fix in the block) |

A finding whose `check` isn't in this table gets `autofix.available = false`
(surface only). New fixers are added by extending `AEM_AUTOFIX` in `lib.mjs` and
adding the fixer body in `autofix-aem.mjs` — no schema change.

## The loop

```
  run sources → record into ledger → optimize gate (open P1?)
        ▲                                   │ open P1
        │                                   ▼
   re-verify ◄── re-deploy ◄── autofix-aem (edits EDS project, stages in-progress)
```

autofix stages applied findings `in-progress`; a re-`deploy` + re-`optimize`
(or re-record for external sources) confirms the fix and flips them to `fixed`.
The gate is clean when no open P1 remains from any source.
