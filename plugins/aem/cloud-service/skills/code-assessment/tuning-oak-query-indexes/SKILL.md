---
name: tuning-oak-query-indexes
description: "AEM Cloud Service expert skill — check a JCR/Oak query is actually served by an index and, when it is not, propose the property/Lucene index-definition change so the query is answered by the index instead of in-memory filtering or sorting. Use for \"query is slow\", \"traversal warning\", \"is my query indexed\", \"tune oak index\", or a scan that flags a JCR/QueryBuilder query. The analyzer locates every query-construction site (createQuery, getQueryManager, Sling findResources / queryResources, PredicateGroup.create / new PredicateGroup); the recipe assesses each flagged query against the supplied index definition(s). Resolution is user-supplied: the index definition(s) are required input — if none is provided the whole pattern is deferred, never guessed. Guided fix — the developer reviews and applies the proposed index change; never auto-apply."
license: Apache-2.0
---

# Tuning Oak query indexes — AEM as a Cloud Service

> This pattern is executed by the code-assessment runbook — follow [`../references/runbook.md`](../references/runbook.md) for the full flow. This skill supplies the detection + recipe the runbook applies.

## Overview

An Oak query only uses an index for the parts the index actually covers. Any `WHERE`/`ORDER BY`/fulltext
field without a matching, correctly-flagged property definition gets evaluated node-by-node in memory —
same for a wrong nodetype or path scope, **even if every field is indexed**. An uncovered query traverses
the repository: slow, `traversal`-warning-logged, and a load risk at scale. This pattern finds exactly
which fields/conditions aren't covered and what index-definition change fixes each one.

## Classification — confirm this pattern applies

- A JCR/QueryBuilder query is slow, logs a `traversal`/`TraversingIndex` warning, or you're adding/changing
  a query and need to confirm it's served by an index rather than in-memory filtering or sorting.
- The user asks "is my query indexed", "tune the oak index", "why is this query slow", or a scan flagged a
  query-construction site (`createQuery` / `PredicateGroup.create`).
- **Not** this pattern: an explicitly *unbounded* query (`p.limit=-1` / `setLimit(-1)`) — that's
  [`unbounded-query`](../unbounded-query/SKILL.md); this pattern is about index *coverage*, not result-set
  size. (A query can be both — assess index coverage here, bound it there.)

## Discovery

Detection is performed by the analyzer ([`../scripts/analyze.sh`](../scripts/README.md)), run by the runbook:

```bash
bash ../scripts/analyze.sh <workspace-root> --pattern tuning-oak-query-indexes
```

**Match criteria (what the detector flags)** — query-*construction* sites, matched on written names
(parse-level, no type resolution). These mirror the Java-API anchors the folded
[extracting JCR queries guide](references/extracting-jcr-queries.md) used, so moving detection from grep to
code keeps the same capture:

- any invocation named `createQuery` — JCR `QueryManager.createQuery(...)` and AEM QueryBuilder
  `builder.createQuery(...)`.
- any invocation named `getQueryManager` — the JCR query entry point (`Workspace.getQueryManager()`).
- any invocation named `findResources` or `queryResources` — the Sling `ResourceResolver` query APIs, which
  run a real indexed repository query.
- `PredicateGroup.create(...)` (a `create` invocation whose receiver's trailing simple name is
  `PredicateGroup`) and `new PredicateGroup(...)` — QueryBuilder predicate-group construction.

One finding per distinct source line, with the call as the snippet. The detector locates where queries are
built; it does **not** judge coverage — that requires the query text (read the surrounding code) and the
index definition(s) (see Resolution contract).

**Known limits (out of a parse-level Java detector's reach — use the extracting guide's manual fallback):**
non-Java queries (XPath/SQL2 in JSP/HTL/config, stored `dam:query` / Smart-Collection predicate strings,
query-string form) and queries hidden behind a non-JCR wrapper method whose body has no direct query call.

## Resolution contract

**user-supplied** — the required input is the Oak/Lucene **index definition(s)** the query could use. The
whole assessment is a comparison of the query against its candidate index definition(s), so:

- **Required input — the index definition(s). This skill does not run without them.** Accept any of: a
  FileVault `.content.xml` under an `/apps/.../install` package, a JSON export, or the live dump at
  `GET /system/console/status-oak-index-defn.json` (admin auth).
- **If no index definition is available, DEFER THE WHOLE PATTERN** with a single line — e.g.
  `tuning-oak-query-indexes: deferred — index definition not provided`. Do **not** emit a per-query skip
  for every finding, and do **not** emit a coverage assessment from the query alone (a guess reads as a
  finding and gets acted on as one).
- **When index definitions ARE supplied**, assess each flagged query's coverage and propose the
  index-definition change where a field is uncovered. **`fix: guided`** — never auto-apply: write the
  corrected definition out for the developer to review and apply.

## Recipe

Read [`recipe.md`](recipe.md) in full before assessing or proposing any change: the input contract, the
Section A/B segregation, the field-construct → required-flag table, the two scoping gotchas, the
index-size/storage pitfalls, the common mistakes, the target-index selection, `explain` verification, and
the two-section report shape. Ground truth for every claim is the bundled
[AI agent indexing guide](references/ai-agent-indexing-guide.md); build a query inventory from scratch with
the bundled [extracting JCR queries guide](references/extracting-jcr-queries.md).

## Handoff

The skill never commits and never applies an index change to a live instance. See
[`../references/runbook.md`](../references/runbook.md) for the full flow and handoff.
