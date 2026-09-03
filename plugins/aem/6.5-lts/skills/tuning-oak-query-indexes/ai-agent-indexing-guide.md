<!--
   Licensed to the Apache Software Foundation (ASF) under one or more
   contributor license agreements.  See the NOTICE file distributed with
   this work for additional information regarding copyright ownership.
   The ASF licenses this file to You under the Apache License, Version 2.0
   (the "License"); you may not use this file except in compliance with
   the License.  You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
  -->

# Oak Indexing & Query — Consolidated Reference (for AI agents and humans)

This is a **single-file, task-oriented rewrite** of the public Oak query/indexing docs
([Query Engine][pub-qe], [XPath Grammar][pub-xp], [SQL-2 Grammar][pub-sql2], [Indexing][pub-idx],
[Lucene Index][pub-lucene], [Elastic Index][pub-elastic], [Property Index][pub-prop],
[Hybrid Index][pub-hybrid], [Oak-Run Indexing][pub-oakrun]).

**Why this doc exists:** the public docs are spread over 9 pages, assume a lot of background,
and have drifted from trunk in a few places. This doc:

1. Merges everything into one place, organized by *task* ("I need to make this query fast"),
   not by index-implementation-class.
2. Marks every claim with a confidence tag so you know how solid it is:
   - `[PUBLIC]` — matches the current public ASF doc.
   - `[CODE]` — verified against Oak trunk source in this repo, not (or not fully) in the public docs.
   - `[LIVE]` — additionally exercised against a running AEM instance (Oak 1.88.0 bundled) with real
     index definitions and content, via the JCR query APIs. Evidence (curl commands + responses) is
     in [Appendix C](#appendix-c-live-verification-log).
   - `[GOTCHA]` — the public doc is misleading, incomplete, or wrong on this point.
   - `[PRIVATE?]` — exists in code but looks internal/experimental; flagged so a human can decide
     whether it belongs in the public docs at all.
3. Every runnable example is something you can paste into a JCR session, `oak-run console`,
   or an AEM CRXDE Lite / query-debugger call — see [Appendix B](#appendix-b-how-to-test-any-of-this-yourself).

If you only read one thing, read [Section 1 (Mental Model)](#1-mental-model) and
[Section 8 (Decision Checklist)](#8-decision-checklist-which-index-do-i-need).

---

## Table of Contents

1. [Mental Model](#1-mental-model)
2. [Index Definitions: the Common Shape](#2-index-definitions-the-common-shape)
3. [Property Index](#3-property-index)
4. [Lucene Index](#4-lucene-index)
5. [Elastic Index](#5-elastic-index)
6. [Hybrid / Synchronous / NRT Indexing](#6-hybrid--synchronous--nrt-indexing)
7. [Async Indexing Machinery](#7-async-indexing-machinery)
8. [Decision Checklist: Which Index Do I Need?](#8-decision-checklist-which-index-do-i-need)
   - [8.1 The #1 Real-World Index-Selection Gotcha: Nodetype Scoping](#81-the-1-real-world-index-selection-gotcha-nodetype-scoping)
9. [Diff Indexes & Superseding an Index](#9-diff-indexes--superseding-an-index)
10. [Query Engine: Cost, Planning, Execution](#10-query-engine-cost-planning-execution)
11. [Query Options (`option(...)`)](#11-query-options-option)
12. [XPath Grammar Reference](#12-xpath-grammar-reference)
13. [SQL-2 Grammar Reference](#13-sql-2-grammar-reference)
14. [Full-Text, Facets, Suggestions, Spellcheck, Similarity](#14-full-text-facets-suggestions-spellcheck-similarity)
15. [Reindexing](#15-reindexing)
16. [oak-run Indexing Tool](#16-oak-run-indexing-tool)
17. [Cost Estimation Model](#17-cost-estimation-model)
18. [Troubleshooting Playbook](#18-troubleshooting-playbook)
19. [Undocumented / Private Appendix](#19-undocumented--private-appendix)
20. [Appendix A: Full Property Reference Tables](#appendix-a-full-property-reference-tables)
21. [Appendix B: How to Test Any of This Yourself](#appendix-b-how-to-test-any-of-this-yourself)
22. [Appendix C: Live Verification Log](#appendix-c-live-verification-log)

---

## 1. Mental Model

`[PUBLIC]`

- Oak does **not** index everything by default (unlike Jackrabbit 2). If there's no usable index for
  a query, Oak **traverses** the repository (walks every node under the query's path restriction and
  evaluates constraints in Java) — the query still works, but can be very slow at scale.
- Index definitions live under `oak:index` nodes. `oak:index` can exist at **any** path (Lucene/Elastic
  support this; property indexes only work at the repository root `/oak:index`), and an `oak:index` node
  found at a given path only indexes content under that path.
- Every query is planned by a **cost-based optimizer**: each available index estimates a cost to answer
  the query; the query engine picks the cheapest plan (traversal is itself modeled as an index with a cost
  based on the `counter` index's node-count estimate). This is analogous to a relational DB's query planner,
  but the statistics are much cruder (see [Section 17](#17-cost-estimation-model)).
- Built-in indexes always present: **property** index per explicitly-configured property, **nodetype**
  index (itself built from two property indexes on `jcr:primaryType`/`jcr:mixinTypes`), **reference** index,
  **counter** index (approximate node counts, used to price traversal and to scale property-index cost
  estimates by subtree size), and (out of the box) a **lucene** full-text index. Solr support was **removed**
  in Oak 1.82 ([OAK-11346](https://issues.apache.org/jira/browse/OAK-11346)) — `solr.md` is dead documentation
  that the public site still ships.
- Three indexing *modes* determine when index content is updated relative to the content it indexes:

  | Mode | Consistency | Used by |
  |---|---|---|
  | **Synchronous** | Index updated in the same commit as the content | `property`, `reference` |
  | **Asynchronous** | Index updated by a periodic background job (default every 5s), eventually consistent | `lucene`, `elasticsearch` |
  | **Near-Real-Time (NRT)** | A small in-memory/local Lucene index per cluster node, refreshed every 1-2s, unioned with the async persisted index at query time | `lucene` only, opt-in via `async` property |

---

## 2. Index Definitions: the Common Shape

`[PUBLIC]` (indexing.md) with `[CODE]` additions.

```
/oak:index/<indexName>
  - jcr:primaryType = "oak:QueryIndexDefinition"   (mandatory)
  - type            = "property" | "lucene" | "elasticsearch" | "disabled" | "reference" | "counter"
  - async           (string, multi)   sync if absent; async lane name; "nrt"/"sync" for NRT
  - reindex         (boolean)         set true to force a full reindex
```

- `type` selects which registered `IndexEditorProvider` builds/maintains the index. Setting `type=disabled`
  freezes an index in place: it stops being updated **and** stops being considered for queries. Re-enabling
  it does not retroactively fix missed updates — you must reindex if you re-enable after a period of drift.
- `deprecated` (boolean) — index is still maintained but a WARN log ("This index is deprecated") is emitted
  on any query that actually uses it. Good for finding out if anything still depends on a legacy index before
  deleting it.
- `async` values: absent/unset = synchronous. `"async"` = the default async lane. Any other string ending in
  `async` = a custom lane (see [Section 7](#7-async-indexing-machinery)). Can also be a **multi-valued**
  array combining a lane name with an NRT mode, e.g. `["async", "nrt"]` or `["async", "sync"]`.
- Index location matters: an `oak:index` node under `/content/foo/oak:index/bar` only indexes/queries
  content under `/content/foo`. Only **lucene** and **elasticsearch** support non-root index locations;
  **property** indexes must be at `/oak:index`.

---

## 3. Property Index

`[PUBLIC]` (property-index.md), verification tag per bullet below.

Use for: exact-match / range / `IN`/ `IS NOT NULL` queries on one property, where you need **synchronous**
(commit-time) consistency, or a **uniqueness constraint**. `[GOTCHA — self-correction]` note the direction:
a property index has no mechanism for `IS NULL` at all (no property in Appendix A.4's full list plays that
role) — only `IS NOT NULL`, via the "approximate number of entries" cost path below. This is easy to get
backwards; `type=property` genuinely cannot help an `IS NULL` query.

```
/oak:index/uuid
  - jcr:primaryType = "oak:QueryIndexDefinition"
  - type = "property"
  - propertyNames = ["jcr:uuid"]        (Name, multi — usually just one name)
  - declaringNodeTypes = ["mix:referenceable"]   (optional)
  - unique = true                        (optional)
  - reindex = true
```

### Properties

| Property | Type | Notes |
|---|---|---|
| `propertyNames` | Name[] | Required, non-empty. Prefer **one property per index** — indexing several properties in one definition means the index contains the union of nodes matching *any* of them, which hurts both index precision and the planner's ability to pick the right index. `[PUBLIC]` |
| `declaringNodeTypes` | Name[] | Restrict to nodes of these types. Omitting it indexes the property on **every** matching node in the repo. `[PUBLIC]` `[LIVE]` `[GOTCHA — this is the #1 cause of "my property index is never picked" confusion]`: the index is only even *considered* if the **query itself** explicitly restricts to that nodetype (or a subtype of it) — e.g. XPath `element(*, nt:unstructured)[@x=...]` or SQL-2 `select * from [nt:unstructured] where [x]=...`. A bare `*`/`nt:base`-implied query (XPath `//*[@x=...]`) reports `Infinity` cost for a `declaringNodeTypes`-scoped index and falls through to another index/traversal — **even if every single node that actually has the property happens to be of the declared type.** Root cause (`PropertyIndexLookup.getIndexNode`): the index is matched by checking whether the filter's *queried* type (and its supertypes) contains one of `declaringNodeTypes`; if the query doesn't restrict the type at all, that set doesn't include the declared type (nt:unstructured is a *subtype* of the query's implicit nt:base, not a supertype), so the match never succeeds and there is no fallback. Live-confirmed on two otherwise-identical property indexes on this AEM instance (Oak 1.88.0): one with `declaringNodeTypes=["nt:unstructured"]` queried with `//*[@liveTestStatus='published']` → `cost for property is Infinity`, traversal used instead; the identical index queried with `//element(*, nt:unstructured)[@liveTestStatus='published']` → `property cost for liveTestPropIdx is 3.0`, index used. **Practical rule: if you set `declaringNodeTypes` on an index, every query meant to use it must also explicitly restrict to that nodetype (or a subtype) in the query text itself — the index config alone does not do this for you.** |
| `unique` | Boolean | Enforced at commit time. Only the **first 100 characters** of the value are compared for uniqueness (full value is still used for querying). `[LIVE]` confirmed — see Appendix C (property index section): a duplicate value was rejected on save (`PersistenceException: Unable to commit changes to session.`), and two values differing only *after* character 100 also collided and were rejected, exactly as documented. |
| `includedPaths` / `excludedPaths` | String[] | Since 1.4 (OAK-3263). Index only used if the query's path restriction falls inside `includedPaths` and outside `excludedPaths`. |
| `valuePattern` | String (regex) | Since 1.7.2 (OAK-4637). Index used for `=`/`IN` only if the value(s) match; never used for `LIKE`. |
| `valueIncludedPrefixes` / `valueExcludedPrefixes` | String[] | Since 1.7.2. Same idea as `valuePattern` but prefix-based; also affects `LIKE` unlike `valuePattern`. |
| `entryCount` / `keyCount` | Long | Manual override of the cost model — skip statistics-based estimation. `keyCount` only affects equality-lookup cost, not `IS NOT NULL`. `[LIVE]` `[GOTCHA]` confirmed: for equality/`IN` queries, setting `entryCount` *alone* barely moved the estimated cost — `keyCount` is auto-derived as roughly `entryCount / 10000` when unset, so a moderate `entryCount` alone still implies a large `keyCount` and a low per-key cost estimate. To meaningfully change equality-cost via `entryCount`, also set `keyCount` explicitly. For `IS NOT NULL`, `entryCount` alone does directly control the cost as expected. |
| `useIfExists` | String (path, optionally `@propName`) | Since 1.10 (OAK-7739). Index only used if a given node/property exists — for blue/green `/libs` cutovers on the composite node store. The index is still **maintained** either way; only usage is gated. |
| `reindex` | Boolean | Triggers synchronous full reindex on next save (blocking, can be slow). |
| `reindex-async` + `reindex` (both true) | — | Since OAK-1456: push the reindex to a background job instead of blocking the commit. Start it via the `PropertyIndexAsyncReindex#startPropertyIndexAsyncReindex` JMX operation after the initial save; the index temporarily has `async = async-reindex` while this runs, then switches back to synchronous. Recovery after a failed async reindex needs manual `CheckpointManager` release + manually deleting `async` + setting `reindex=true`. `[LIVE]` exact match confirmed: setting both flags flipped `async` to `"async-reindex"` immediately; invoking the MBean op (`POST /system/console/jmx/org.apache.jackrabbit.oak%3Aname%3Dasync%2Ctype%3DPropertyIndexAsyncReindex/op/startPropertyIndexAsyncReindex/`) returned `"Property index asynchronous reindex running"`; ~5s later `reindex:false`, `reindexCount` incremented, and the `async` property was gone entirely (reverted to fully synchronous) — every detail of the doc's description held up. |

### Cost model (property index)
`[PUBLIC]`, `[CODE]` verified against `PropertyIndex`/`PropertyIndexLookup`:

- `Infinity` if: query has a full-text constraint, no applicable restriction, wrong nodetype, or path
  filters don't match.
- `x IS NOT NULL`: cost ≈ `entryCount` (if set) else the index's approximate total entry count
  (order-of-magnitude estimate via Morris' algorithm — this is intentionally imprecise, it's cheap to
  maintain concurrently).
- `x = v` on a **unique** index: cost is 0 or 1.
- `x = v` on a non-unique index: uses `entryCount`/`keyCount` if set, else the approximate per-key count,
  additionally **scaled down** by the ratio of (approximate nodes in the query's path subtree) to
  (approximate nodes in the whole repo), using the `counter` index. Overhead of `2` is always added.

---

## 4. Lucene Index

`[PUBLIC]` (lucene.md) is the biggest and most detail-dense doc; this section is a condensed, corrected
version. Full property tables are in [Appendix A](#appendix-a-full-property-reference-tables).

### 4.1 Minimal shape

```
/oak:index/assetType
  - jcr:primaryType = "oak:QueryIndexDefinition"
  - type = "lucene"
  - compatVersion = 2        (always use 2; version 1 is deprecated and slower)
  - async = "async"
  + indexRules
    + nt:base
      + properties
        + assetType
          - propertyIndex = true
          - name = "assetType"
```

`compatVersion=2` gates a lot of behavior: property restrictions and index-time aggregation only work in
v2; a v2 fulltext index checks access rights **only** at the aggregate root, not at every aggregated child
— know this before using aggregation on anything containing per-child ACLs.

### 4.2 Index-level properties (selected; full table in Appendix A)

`compatVersion`, `async`, `codec`, `evaluatePathRestrictions`, `includedPaths`/`queryPaths`/`excludedPaths`,
`tags`, `selectionPolicy`, `useIfExists`, `blobSize`, `functionName` (deprecated `@since 1.46`), `refresh`
(forces the [Effective Index Definition](#effective-index-definition) to reload without a reindex),
`maxFieldLength` (10000), `maxTagLength` (100, `-1` disables), `maxSimilarityTagsCount` (50, `-1` disables),
`maxDynamicBoostCount` (50, `-1` disables).

`[LIVE]` `[GOTCHA]` **`includedPaths`/`queryPaths` split is confusing and easy to misconfigure — and this
is a live-confirmed correctness bug waiting to happen, not just a wording nit**: `includedPaths`
controls what gets *indexed*; `queryPaths` controls what the index is allowed to be *selected for*.
**Root cause, precisely pinned down**: `queryPaths` defaults to `/` (everywhere) independently of
`includedPaths`. If you set `includedPaths` to a narrow scope but leave `queryPaths` at its default, the
index is still eligible for selection **anywhere in the repository**, but only actually contains data for
the narrow scope — so for an out-of-scope query it gets picked (because its own cost estimate, correctly
computed from its own empty/near-empty content, is *lower* than traversal's cost) and returns an
incomplete/wrong result instead of falling back to traversal.

Reproduced twice, isolating the exact variable:
```
# Index A: includedPaths=["/content/spr/inscope"], queryPaths=["/content/spr/inscope"]  (both set, matching)
# Index B: includedPaths=["/content/spr/inscope"], queryPaths left UNSET (defaults to "/")
# Same query, same out-of-scope path (/content/spr/outscope, which has a real matching node):

# Against Index A (queryPaths set correctly):
"cost for lucene-property is Infinity" ... "cost for traverse is 2000.0"   -> traversal used, correct result

# Against Index B (queryPaths left unset):
"cost for [/oak:index/sprLucene2] ... estimatedEntries: 0 ... is 1.00"    -> Index B used (1.00 < 2000.0)
# real query result: {"results":[],"total":0}   <-- WRONG: a real matching node exists, but was silently missed
```
**Always set `includedPaths` and `queryPaths` to the same value(s)** — this alone is the fix; you do not
additionally need `evaluatePathRestrictions` for this specific correctness issue (that property affects
whether path restrictions are evaluated *natively inside* an in-scope query, a different concern from
whether the index is *eligible for selection* at all).

`[LIVE]` **the JMX `strictPathRestriction` setting (§11) is a real, working safety net for exactly this
bug**: with `QueryEngineSettingsMBean.StrictPathRestriction=ENABLE`, re-running the broken Index-B scenario
above correctly rejects the plan (`"cost for lucene-property is Infinity"`, falls back to traversal) instead
of silently returning the wrong empty result. `DISABLE` is the default, so this protection is opt-in — worth
turning on in any environment where `includedPaths`/`queryPaths` might drift out of sync across many
custom indexes over time.

### 4.3 Indexing rules (`indexRules/<nodeType>`)

- `inherited` (default `true`): whether the rule applies via nodetype **inheritance** or only on an exact
  primary-type match.
- `includePropertyTypes`: which JCR property types get full-text indexed (default: all types).
- `indexNodeName` (`@since 1.0.20, 1.2.5`): also index the node's own name for `NAME()`/`fn:name()` queries.
- `nodeTypeIndex` `[CODE]` `[GOTCHA — undocumented]`: a **boolean on the indexing rule itself**
  (`FulltextIndexConstants.PROP_INDEX_NODE_TYPE = "nodeTypeIndex"`) that indexes the node's primary type so
  this Lucene index can itself answer nodetype-restricted queries, instead of relying on the separate
  `/oak:index/nodetype` property index. Not mentioned anywhere in lucene.md — do not confuse with
  `indexNodeName` (node *name*, not node *type*).
- Cost overrides `costPerExecution` / `costPerEntry` (both default `1.0`; V1 format defaults `costPerEntry`
  to `1.5`) — only meaningful for `compatVersion=2`. `[LIVE]` confirmed the §17 formula exactly: with 1
  matching entry, `costPerExecution=50` (default `costPerEntry`) → `explain` reported cost `51.00`
  (`50 + 1×1.0`); separately, `costPerEntry=0.1` (default `costPerExecution`) → cost `1.10` (`1.0 + 1×0.1`).
  Both knobs move the reported cost by exactly the amount the formula predicts — useful for deliberately
  nudging the planner toward or away from an index without touching its actual selectivity.

### 4.4 Property definitions (`indexRules/<nodeType>/properties/<name>`)

Full table in Appendix A. Highlights and gotchas:

- `name`: simple / relative (`jcr:content/metadata/title`, one `*` wildcard for "any child") / regexp
  (`isRegexp=true`) / the sentinel `:nodeName` (indexes the node name itself). `[GOTCHA]` properties whose
  `name` starts with a literal dot (e.g. `./jcr:content/...`) are **silently ignored** for backward
  compatibility — no error, the definition is just dead weight. `jcr:path`/`jcr:score` can never be named
  directly; use function-based indexing (`function="path()"`) instead.
- `propertyIndex`: enables equality / `IN` / ordering / `IS NOT NULL` evaluation for this property.
- `notNullCheckEnabled` / `nullCheckEnabled`: **a genuinely cheaper, standalone alternative to
  `propertyIndex` when all you need is an existence check** (`IS NOT NULL`/`IS NULL`), not equality, range,
  or ordering on the actual value. `[CODE]` `[LIVE]` traced and confirmed: unlike `propertyIndex` (which
  indexes every distinct *value* as its own term, in a field dedicated to that one property),
  `notNullCheckEnabled`/`nullCheckEnabled` add a single lightweight, unstored term — just the *property
  name* — into one **shared** field across the whole index (`:notNullProps`/`:nullProps`,
  `LuceneDocumentMaker.java:152,157`/`FieldNames.java:101,107`): every `notNullCheckEnabled` property on
  every document contributes to the same shared field, none of them get their own per-value field. Live
  reproduced: a property flagged with `notNullCheckEnabled`+`nullCheckEnabled` **and no `propertyIndex` at
  all** correctly served both `IS NOT NULL` (cost `3.0`) and `IS NULL` (cost `3.0`) — `propertyIndex` is
  not required for either. The inverse also held: with only these two flags set, an *equality* condition on
  the same property still showed a finite index cost (because the index is a valid nodetype/path-scoped
  candidate either way) but the actual Lucene query was a bare `*:*` — the equality wasn't pushed into the
  index at all, just evaluated as a residual filter after the fact. **Takeaway for index design: a finite
  `explain` cost does not by itself prove a specific condition is served natively — check the logged
  `luceneQuery` text, not just whether some cost was assigned.** Per the original public doc: only enable
  `nullCheckEnabled` for nodetypes that are not generic, since it creates an entry for every node of that
  type where the property is *absent* — for a broad/generic nodetype with a rarely-set property, that can
  mean an entry for nearly every document in the repository.
- `analyzed` + `nodeScopeIndex`: `analyzed` enables `contains(@prop, ...)`; `nodeScopeIndex` enables
  `contains(., ...)` (node-level fulltext) by folding the property into the shared fulltext field.
  `[GOTCHA]` if **any** property in a rule has `nodeScopeIndex=true`, the **node name** of every matching
  node gets indexed too, for every node covered by that rule (not just the one property) — this can bloat
  the index a lot for broad rules like `nt:base`.
- `type=Date` `[GOTCHA — public doc gets the failure mode wrong]`: values that don't parse as ISO-8601 are
  **silently not indexed as dates**. Public doc says this means "wrong order, or no results if the query
  relies on that property to select nodes." `[LIVE]`-tested (4 nodes, one with `eventDate="not-a-real-date"`,
  `order by [eventDate]` ascending): the node with the bad value was **not excluded** — it appeared **first**,
  before all valid ascending dates, and `explain`'s plan showed `sortOrder: [{propertyName: eventDate,
  propertyType: UNDEFINED, order: ASCENDING}]`. So the practical failure mode for `order by` is "the bad-value
  node sorts to the front (ascending) or back (descending) of the list", not "gets no results" — "no results"
  only applies to a query that *selects* on the Date property (e.g. a range condition), not one that merely
  *orders* by it. For inconsistent legacy data, leave `type` unset or use `type=String`, understanding that
  string sort order only matches date order for uniformly-formatted, same-timezone timestamps.
- `ordered`: intended for single-valued properties only. `[GOTCHA — public doc overstates the failure mode]`
  `[LIVE]` confirmed: enabling `ordered` on a multi-valued property does **not** fail indexing or error out —
  `FulltextDocumentMaker.java:444` just logs a `WARN` ("Ignoring ordered property ... as multivalued ordered
  property not supported") and skips writing the doc-values field **for that document**; the rest of that
  document's indexing (including the regular `propertyIndex` term for the same property) proceeds normally,
  and the index/lane is not marked failing. Practical effect: `ORDER BY` on such a property is undefined/
  unreliable for any document that actually had multiple values (its sort position is unpredictable, not an
  error), while single-valued documents in the same index sort correctly. Live-tested with only one
  multi-valued document present, which trivially "sorted" correctly (a single row is always in order) —
  this doesn't disprove the warning-and-skip behavior, it just means you need 2+ multi-valued documents with
  different values to see the effect, which wasn't reproduced here. Either way: don't expect a hard failure
  as a safety net — a multi-valued value silently degrades sort correctness instead.
- `weight` (default `5` since 1.10; `0` since 1.6.3 means "never let this be the sole reason to pick this
  index"; see [Section 17](#17-cost-estimation-model) for the full selectivity model).
- `sync` / `unique`: sync requires `propertyIndex=true`; does not support relative properties or
  `notNullCheckEnabled`; see [Section 6](#6-hybrid--synchronous--nrt-indexing).
- `function`: function-based indexing, see 4.7.

### 4.5 Aggregation

Folds descendant-node content into the parent's index document for a single `contains(., ...)` search
across scattered content. Key rules:

- Defined under `aggregates/<nodeType>/include<N>` with `path` (supports `*` and `*/*`), optional
  `primaryType` filter, and `relativeNode=true` for querying a specific aggregated sub-path directly
  (`contains([renditions/original/*], "text")`). `[LIVE]` confirmed exactly this pattern: aggregated
  `renditions/original` content into the parent via `relativeNode=true`, then
  `contains([renditions/original/*], 'pluto')` correctly matched the **parent** node even though the text
  only exists on the aggregated child.
- `[GOTCHA]` aggregation does **not** follow nodetype inheritance — you must define a separate aggregate
  block per concrete nodetype even if they share a supertype.
- Recursion: aggregating into a node whose own aggregation rules would apply again is capped by
  `reaggregateLimit` (default 5) to avoid infinite aggregation loops.
- `excludeFromAggregation=true` on a property definition removes just that property from the aggregated
  fulltext content. `[TEST-CONFIRMED]` (`LucenePropertyIndexTest#aggregationAndExcludeProperty`, passing
  on trunk): this **only** excludes the value from the aggregated fulltext blob — the same property
  remains fully usable via its own explicit property-index definition (e.g. an equality condition on it
  still uses the index natively). Excluding a property from aggregation is not the same as excluding it
  from indexing altogether.

### 4.6 Analyzers, Codec, Boost

- Default analyzer: `OakAnalyzer` (Lucene `StandardTokenizer` + `LowerCaseFilter` + `WordDelimiterFilter`
  with `GENERATE_WORD_PARTS`, `STEM_ENGLISH_POSSESSIVE`, `GENERATE_NUMBER_PARTS`). `indexOriginalTerm=true`
  on the `analyzers` node adds `PRESERVE_ORIGINAL` — but only takes effect if no custom analyzer class or
  composition is configured (in-built analyzer has lowest precedence overall).
  Precedence: explicit `class` > composition (`tokenizer`/`filters`/`charFilters`) > built-in default.
- Only **one** analyzer per index; no separate index-time vs. query-time analyzer. `[LIVE]` confirmed
  `analyzers/default/class=<fully-qualified-class-name>` genuinely overrides the default analyzer: with
  `class=org.apache.lucene.analysis.core.WhitespaceAnalyzer` (no lowercasing filter, unlike the default),
  a stored value's exact-case form matched via `contains(...)` while the lowercased form did **not** —
  proving the custom analyzer was truly in effect, not silently falling back to the default. `[CODE]`
  `indexOriginalTerm=true` was tested three ways (a non-stemmed verb form, a hyphenated compound word
  under both the default analyzer and an explicit `StandardAnalyzer`) without isolating a clear
  before/after difference in indexed term count via `LuceneIndexMBean.getFieldTermsInfo` — inconclusive
  with this test design, not evidence the flag doesn't work; a decisive test would need to inspect the
  actual term *strings* (not just counts) for a case where `WordDelimiterFilter`'s `GENERATE_WORD_PARTS`
  demonstrably discards the unsplit original.
- `codec`: default is `OakCodec` (compression **disabled** — bigger index, but avoids a known correctness
  issue with compressed codecs + partial reads). Set `codec="Lucene46"` for compression at the cost of some
  correctness edge cases historically fixed by `OakCodec`; do this deliberately, not by default.
- `boost` + `nodeScopeIndex` + `analyzed` on a property = that property's matches rank higher in
  node-level fulltext search relevance (separate Lucene field per boosted property). `[TEST-CONFIRMED]`
  (`LucenePropertyIndexTest#boostTitleOverDescription`, passing on trunk): the boost factor is applied
  literally as a Lucene `^N` suffix on the per-property analyzed field in the generated query (e.g.
  `full:jcr:content/jcr:title:batman^4.0`) — visible directly in `explain` output — and it does change
  result order for otherwise-tied fulltext matches.

### 4.7 Function-Based Indexing

`@since 1.5.11, 1.6.0, 1.42.0`. Index/search/sort by a **computed** value instead of a raw property:
`fn:upper-case(@x)`, `fn:lower-case(test/@x)`, `fn:string-length(@x)`, `path()`, `first([alias])`,
`name()`/`localname()` (need Oak ≥ 1.42), range conditions (`<`,`<=`,`>`,`>=`) all supported, including on
multi-valued and relative properties (except `.`/`..`).

Common use: case-insensitive lookup/sort, or **keyset pagination by node name** when there's no natural
sort key (`function = "lower(name())"`, `propertyIndex=true`, `ordered=true`) — see query-engine.md's
Keyset Pagination section for the full pattern.

### 4.8 Dynamic Boost

`@since 1.28.0`. Set `dynamicBoost=true` + `propertyIndex=true` on a regexp property definition matching a
container node path (e.g. `name=jcr:content/metadata/predictedTags/.*`, `isRegexp=true`). Oak then reads
each child node's `name` (String) + `confidence` (Double) and indexes a boosted term per token of `name`
with boost = `confidence`. This is the replacement for the deprecated `IndexFieldProvider` SPI.
Tags beyond `maxTagLength` (100) chars are skipped; beyond `maxDynamicBoostCount` (50) entries, only the
top-N **by confidence, descending** are kept (contrast with similarity tags below, which keep first-N by
*appearance order*, not confidence). `[TEST-CONFIRMED]` (`LuceneDynamicBoostTest`, 20/20 passing on trunk,
including `dynamicBoostMaxLengthFiltering`): querying for a boosted tag token (e.g.
`contains(*, 'blue flower')` against `dam:Asset`) matches the **parent** node directly — the tag contribution
genuinely folds into the parent's fulltext field, it's not just independently indexed on the child.

### 4.9 Effective Index Definition {#effective-index-definition}

`@since 1.6`. Since 1.6, the definition used for querying/incremental-indexing is a **cloned, stored** copy
taken at reindex time — editing the live definition node does **not** change query behavior until either a
reindex happens, or you explicitly opt into a hot-reload by setting `refresh=true` and saving (the flag then
auto-clears itself and logs `Refreshed the index definition for [...]`). This is the mechanism behind the
tags/selectionPolicy "no reindex needed, just set refresh=true" advice in query-engine.md. Disable entirely
via OSGi `LuceneIndexProviderService.disableStoredIndexDefinition=true` (then every definition edit is live
immediately, at the cost of the safety this feature exists for).

`[LIVE]` `[GOTCHA — sharpens a genuinely ambiguous part of this guidance]` **`refresh=true` only makes a new
property *plannable* — it does not backfill pre-existing content that predates the new property
definition.** Live-tested precisely: added a new `propertyIndex` property definition to a Lucene index (via
Sling POST, `refresh=true`, no `reindex`) for a property (`newProp`) that a pre-existing document already
had a real value for. Result: `explain` immediately showed the index as a valid candidate (cost `1.00`,
`estimatedEntries: 0`) — the planner accepted the new property — but the **real query still returned zero
results**, because the pre-existing document was never re-visited to populate the new field. Only a genuine
`reindex=true` (which re-walks all matching content) made the query actually find it. The "safe to skip
reindex" case really is limited to what the doc says — "no prior content exists with such a property" —
take that literally: if *any* existing document already carries the new property's value, `refresh` alone
will silently miss it, with no error or warning anywhere.

### 4.10 Non-root indexes, Native Query selection, Persistence, CopyOnRead/Write

- Non-root: put `oak:index` under any content path to scope both indexing and (for lucene/elastic) query
  eligibility to that subtree — good for multi-tenant repos.
- `functionName` (`@deprecated 1.46`) lets `rep:native('<functionName>', '<lucene query>')` target one
  specific Lucene index by name when several are registered.
- `[GOTCHA]` `[LIVE]` this is what makes native queries "silently return nothing" for people, confirmed
  both by code and by a direct live test: a raw native query string is parsed by Lucene's classic
  `QueryParser` directly against the index's **internal** field names, which are **not** the literal JCR
  property name for analyzed properties. An `analyzed` property named `title` is stored as Lucene field
  `full:title` (`FieldNames.ANALYZED_FIELD_PREFIX = "full:"`), not `title`. `rep:native('myIdx', 'title:foo')`
  silently matches zero documents; the correct raw query is `rep:native('myIdx', 'full\:title:foo')` (colon
  in the field name must be escaped). Live-tested side by side against the same index/content: the
  unescaped form returned `total:0`, the `full\:`-escaped form correctly returned the matching node. Root
  cause traced through `NativeFunctionImpl` → `LucenePropertyIndex` (~line 900) →
  `FieldNames.createAnalyzedFieldName` — also independently confirmed by
  `LucenePropertyIndexTest#boostTitleOverDescription`'s own `explain` output, which shows the identical
  `full:jcr:content/jcr:title:...` field naming for ordinary fulltext queries, not just native ones.
  Non-analyzed (plain `propertyIndex`) fields use the bare property name with no prefix.
- `persistence=file` + `path=...` stores the Lucene files on the local filesystem instead of the NodeStore
  — only safe for **non-clustered** setups (the files won't replicate to other cluster nodes).
- CopyOnRead (default **on** since 1.0.13) and CopyOnWrite (opt-in) mirror index files to local disk to
  avoid remote-NodeStore read/write latency during query/indexing; configured via the
  `LuceneIndexProviderService` OSGi PID.

---

## 5. Elastic Index

`[PUBLIC]` (elastic.md), spot-checked against `ElasticIndexDefinition.java` — no inaccuracies found in the
differences list. Elastic reuses most of the Lucene index-definition vocabulary (`indexRules`, property
definitions, `analyzers`, aggregation) through the shared `oak-search` module, but:

- `type = "elasticsearch"`; must live at `/oak:index` (no non-root indexes); `async` must be exactly
  `"elastic-async"` (no sync/nrt lanes); **not** auto-built on save — you must set `reindex=true` or (the
  recommended path) drive it via `oak-run` — see `[CODE]` note in [Section 16](#16-oak-run-indexing-tool):
  oak-run has Elastic-specific connection flags (`--scheme`, `--host`, `--port`, `--apiKeyId`,
  `--apiKeySecret`, `--indexPrefix`) that **oak-run-indexing.md never mentions at all** — this is a real
  documentation gap, not just an omission of detail.
- Ignored properties (accepted but no-op, for Lucene index-definition compatibility during migration):
  `codec`, `compatVersion`, `useIfExists`, `blobSize`, `name`, `indexPath`. `refresh` is also ignored because
  Elastic index-definition changes take effect immediately (no "effective/stored definition" snapshotting).
- `evaluatePathRestrictions` cannot be turned off — path restrictions are always evaluated at the index
  level when possible.
- Field-count limit: Elasticsearch caps fields per index at **1000** by default
  (`index.mapping.total_fields.limit`, overridable via `limitTotalFields` — raising it is discouraged, it
  risks ES-side memory issues). Wide regex property definitions can blow through this; set `isFlattened=true`
  to store all matches of a regex property under one ES `flattened` field instead of one field each. Trade-off:
  flattened fields only support filter queries, treat all values as string keywords (so numeric `range`
  becomes lexicographic!), don't support wildcard key lookups or highlighting, and `isFlattened` is silently
  forced back to `false` if `analyzed=true` on the same property (flattened fields can't be full-text
  analyzed).
- `dynamicBoost` timing differs: Lucene boosts at **index time**; Elasticsearch boosts at **query time**. To
  use dynamic-boost values purely as a relevance signal without affecting which documents match, set
  `{"dynamicBoost": true, "useInFullTextQuery": false}`.
- `sync`/`unique` on property definitions are accepted but **ignored** — no synchronous/hybrid indexing on
  Elastic.
- Suggestions update immediately on Elastic (no `suggestUpdateFrequencyMinutes` delay like Lucene's default
  10-minute suggester rebuild).
- 🔒 `[CODE]` **Elastic-only KNN vector search properties**, not in elastic.md at all: `similarityMetric`,
  `similarity`, `k`, `candidates` on `ElasticPropertyDefinition` — a native Elasticsearch dense-vector KNN
  search path distinct from Lucene's approximate-nearest-neighbor `useInSimilarity` mechanism (§4.8-adjacent).
  Everything else elastic.md claims about ignored/no-op properties was confirmed accurate against
  `ElasticIndexDefinition.java`.

---

## 6. Hybrid / Synchronous / NRT Indexing

`[PUBLIC]` (hybrid-index.md, indexing.md's NRT section). hybrid-index.md reads like a design doc (it is
one — OAK-4412 / OAK-6535) rather than a how-to; here's the operational summary.

**Why this exists**: Lucene indexes are async (eventually consistent, good for most search) but some
use cases need commit-time consistency (uniqueness constraints, or a listener that queries right after
observing a change and must see it). Rebuilding a second full synchronous property index for that one
property is wasteful; instead, Oak keeps *recent* changes to a synchronously-indexed property in a
lightweight in-memory-friendly structure alongside the async Lucene index, and unions the two at query time.

### Enabling
```
+ indexRules
    + nt:base
        + properties
            + resourceType
                - propertyIndex = true
                - name = "assetType"
                - sync = true          <-- synchronous for THIS property only
```
For a unique constraint instead of just sync consistency, add `unique = true` (requires `sync = true`).

### NRT (the more commonly used flavor in practice)
Set the index's own `async` to include `"nrt"` (refresh every ~1-2s, async-only fallback for other cluster
nodes' changes) or `"sync"` (synchronous local refresh, slower indexing, effectively as consistent as a
property index on a single-node deployment). Controlled globally by `LuceneIndexProviderService`'s
`enableHybridIndexing` (default `true`) and `hybridQueueSize` (default 10000, the in-memory doc queue for
`nrt` mode).

`[LIVE]` confirmed: a `lucene` index with `async=["async","nrt"]` made a freshly-created node queryable
(via a tag-forced index selection to rule out an unrelated cheaper plan) **2 seconds** after creation —
well under the default 5s async cycle.

`[GOTCHA]` hybrid-index.md's "Open Points" section (multiple `sync` properties in one index, ambiguous which
storage to query) is still an open design question, not resolved — don't assume Oak picks a well-defined
property index automatically if you mark several unrelated properties `sync=true` in the same Lucene index.

`[CODE]` `[GOTCHA — stale class names in the public doc]` hybrid-index.md's storage structure description
(`:property-index` hidden node, `head`/`previous` buckets) still matches current code, but the class names
it implies are stale: there is **no `IndexPruner` class** in current code. Pruning is now split into
`PropertyIndexCleaner` (property buckets) and `UniqueIndexCleaner` (unique indexes), with bucket rotation
delegated to a `BucketSwitcher`; the last-indexed-time trigger condition is unchanged (still keyed off
`AsyncIndexInfoService`). Treat hybrid-index.md's storage/pruning *mechanism* as accurate but its class
names as outdated if you go looking for them in source.

`[LIVE]` `[GOTCHA — the single most important correction in this section]` **property-level `sync`/`unique`
is a silent no-op unless the *index-level* `async` property is also multi-valued and contains `"sync"` or
`"nrt"`.** lucene.md's property-definition table says `sync` "requires `propertyIndex=true`" and `unique`
"requires `sync=true`", which reads as if those two property-level flags are sufficient on their own. They
are not. Root cause (`oak-lucene`'s `LuceneIndexEditorProvider.java` / `oak-search`'s `IndexDefinition.java`):
the class that does synchronous property bookkeeping and (for `unique`) the actual duplicate-value rejection
— `PropertyIndexUpdateCallback` — is only constructed when
`IndexDefinition.supportsSyncOrNRTIndexing(definition)` returns true, which checks whether the **index-level**
`async` property (`IndexConstants.ASYNC_PROPERTY_NAME`) is multi-valued and contains the literal string
`"sync"` or `"nrt"`. This is a *different* property from the **property-level** `sync=true` flag
(`FulltextIndexConstants.PROP_SYNC`) despite sharing the same string — which is exactly how the two get
confused when reading the docs. With a plain `async="async"` (single string) at the index level, setting
`unique=true` on a property silently accepts duplicate values with no error, no warning, nothing in the log.

Live proof — **before** (index-level `async="async"`, single string):
```bash
curl -u admin:admin -F"jcr:primaryType=oak:QueryIndexDefinition" -F"type=lucene" -F"compatVersion@TypeHint=Long" -F"compatVersion=2" \
  -F"async=async" \
  -F"indexRules/nt:unstructured/properties/uniqueProp/name=uniqueProp" \
  -F"indexRules/nt:unstructured/properties/uniqueProp/propertyIndex@TypeHint=Boolean" -F"indexRules/nt:unstructured/properties/uniqueProp/propertyIndex=true" \
  -F"indexRules/nt:unstructured/properties/uniqueProp/sync@TypeHint=Boolean" -F"indexRules/nt:unstructured/properties/uniqueProp/sync=true" \
  -F"indexRules/nt:unstructured/properties/uniqueProp/unique@TypeHint=Boolean" -F"indexRules/nt:unstructured/properties/uniqueProp/unique=true" \
  http://localhost:4502/oak:index/aiDocTestHybrid
# ... wait for initial build (reindexCount:1) ...
curl -u admin:admin -F"jcr:primaryType=nt:unstructured" -F"uniqueProp=dup-value" http://localhost:4502/content/aiDocTest/hybrid/node2   # -> HTTP 201
curl -u admin:admin -F"jcr:primaryType=nt:unstructured" -F"uniqueProp=dup-value" http://localhost:4502/content/aiDocTest/hybrid/node3   # -> HTTP 201  (should have been rejected!)
```
**After** (index-level `async=["async","sync"]`) — same property flags, now correctly enforced:
```bash
curl -u admin:admin ... -F"async=async" -F"async=sync" -F"async@TypeHint=String[]" ... http://localhost:4502/oak:index/aiDocTestHybrid2
curl -u admin:admin -F"jcr:primaryType=nt:unstructured" -F"uniqueProp2=dup2" http://localhost:4502/content/aiDocTest/hybrid2/a   # -> HTTP 201
curl -u admin:admin -F"jcr:primaryType=nt:unstructured" -F"uniqueProp2=dup2" http://localhost:4502/content/aiDocTest/hybrid2/b   # -> HTTP 500 "Unable to commit changes to session." (correctly rejected)
```
**Practical rule**: to get a working synchronous/unique Lucene property, you need *both* the property-level
`sync=true`/`unique=true` *and* the index-level `async` set to `["async", "sync"]` (or `"nrt"`) — never just
one or the other.

---

## 7. Async Indexing Machinery

`[PUBLIC]` (indexing.md).

- Each **indexing lane** = one periodic `AsyncIndexUpdate` job (default: lane `"async"`, every 5s). An index
  definition's `async` value selects its lane. Prior to 1.4 there was only one lane; 1.4 added a second
  built-in (`fulltext-async`); 1.6+ lets you configure arbitrary lanes via the
  `AsyncIndexerService` OSGi PID.
- Each job tracks its own **checkpoint** (a preserved NodeStore snapshot reference, like a git tag) as the
  "last indexed" state; diffs `before` (last checkpoint) against a fresh `after` checkpoint each run.
- **Lease**: to keep only one cluster node running a given lane's job, a lease property is periodically
  renewed; a stale lease (default > 15 min old) lets another node take over. Only matters for
  `DocumentNodeStore`; irrelevant for single-node `SegmentNodeStore`.
- **Corrupt index isolation** (`@since 1.6`): an index failing to update for 30 min (configurable via
  `failingIndexTimeoutSeconds` on `AsyncIndexerService`; `0` disables the feature) is marked `corrupt` and
  skipped by future async runs until reindexed — logs make this state easy to grep for.
- `[LIVE]` confirmed the lag is real and observable end-to-end: a Lucene index on the default `async` lane
  returned `total:0` for a query run *immediately* after saving matching content, and returned the node
  correctly ~15s later (one async cycle later). A lane name that "ends in `async`" but was never configured
  in `AsyncIndexerService` (e.g. `aiDocTestCustom-async`) simply **never runs** — content assigned to it is
  never indexed, silently, with no error anywhere. A query relying on such a dead-lane index falls back to
  traversal and (on a repo with ~174k nodes) was killed by the `LimitReads` guard:
  `"The query read or traversed more than 100000 nodes. To avoid affecting other tasks, processing was
  stopped."` — a useful double-check that an unfamiliar `async` value on an index is actually configured
  somewhere, not just spelled correctly.
- `IndexStatsMBean` per lane exposes `LastIndexedTime`, `Status`, `Failing`, `FailingIndexStats`, and
  operations `pause()` / `abortAndPause()` / `resume()`.

---

## 8. Decision Checklist: Which Index Do I Need?

`[CODE]` synthesis, not in any single public doc this explicitly.

| Need | Index |
|---|---|
| Exact/range match on one property, must be visible in the **same commit**, or need a **uniqueness constraint** | Property index (sync) |
| Same as above, but only *one* property in an existing Lucene index needs sync guarantees and you don't want a whole separate index | Lucene property definition with `sync=true` (§6) |
| Full-text search (`contains`) | Lucene or Elastic (fulltext) |
| Structured queries (equality/range/sort) at scale, self-hosted Lucene fine, no need for external cluster | Lucene |
| Structured + full-text at scale, willing to run/operate an Elasticsearch cluster, need field-count/scale headroom Lucene sparse-field storage doesn't give you | Elastic |
| Query needs the result "soon" (1-2s) without paying full sync cost, single- or multi-cluster-node | Lucene with `async=["<lane>","nrt"]` |
| Node type restriction only, few nodes of that type expected | add nodetype to the built-in `nodetype` index (property index under the hood) |
| A query is known to traverse a small, bounded number of nodes | no index needed — use `option(traversal ok)` |

---

## 8.1 The #1 Real-World Index-Selection Gotcha: Nodetype Scoping

`[LIVE]` discovered and confirmed on this AEM instance (Oak 1.88.0) while re-testing this doc's own
examples — **this generalizes across property indexes *and* Lucene indexes**, and is very likely the
single most common reason a seemingly-correct, seemingly-precise index doesn't get picked:

> **If an index is scoped to a specific nodetype (`declaringNodeTypes` on a property index, or an
> `indexRules/<nodeType>` block on a Lucene/Elastic index that doesn't include `nt:base`), the index is
> only even *considered* by the cost planner if the query *itself* explicitly restricts to that nodetype
> (or a subtype of it) — in the query text, not just in the actual shape of the underlying content.**

A query using a bare wildcard (XPath `//*[@x=...]` / `jcr:contains(., ...)`, SQL-2 `select * from
[nt:base] where ...`) reports `Infinity` cost (property index) or **silently doesn't even appear in the
cost log at all** (Lucene index) for a nodetype-scoped index — even when *every single node* that could
possibly match is in fact of the declared type. The planner isn't inspecting your data; it only looks at
what the query *says* it's restricted to. Adding the nodetype restriction to the query
(`element(*, nt:unstructured)[@x=...]` / `select * from [nt:unstructured] where ...`) is what flips the
scoped index from invisible-to-the-planner to selected-at-a-fraction-of-the-cost.

**Live evidence, property index** (two identical indexes differing only in `declaringNodeTypes`):
```bash
# index WITH declaringNodeTypes=["nt:unstructured"], query WITHOUT nodetype restriction:
#   explain "/jcr:root/content/liveTest//*[@liveTestStatus='published']"
#   -> "cost for property is Infinity" ; traversal used instead
# SAME index, query WITH nodetype restriction:
#   explain "/jcr:root/content/liveTest//element(*, nt:unstructured)[@liveTestStatus='published']"
#   -> "property cost for liveTestPropIdx is 3.0" ; plan: "property liveTestPropIdx ... estimatedCost: 3.0"
```

**Live evidence, Lucene index** (`indexRules` only defines `nt:unstructured`, `includedPaths`/`queryPaths`
correctly scoped to the test content's path):
```bash
# query WITHOUT nodetype restriction:
#   explain "/jcr:root/content/liveTest//*[jcr:contains(., 'needle')]"
#   -> the custom index never appears in the cost log at all; the broad OOTB `/oak:index/lucene`
#      index (94349 estimated entries across the WHOLE repo) is used instead, cost 94350.00
# SAME index and content, query WITH nodetype restriction:
#   explain "/jcr:root/content/liveTest//element(*, nt:unstructured)[jcr:contains(., 'needle')]"
#   -> "cost for [/oak:index/liveTestLucene] ... estimatedEntries: 5 ... is 6.00" — now selected,
#      ~15,700x cheaper than the fallback plan the untyped query was silently getting instead
```

**Practical takeaway for index/query optimization**: when tuning a query that "should" be using a cheap,
narrow index but the plan shows traversal or an unexpectedly broad index instead, the fix is very often
*not* a change to the index at all — it's adding an explicit nodetype restriction to the query text. This
also means: when designing an index scoped to one nodetype (which lucene.md's own Design Considerations
§4 and this doc's §8 both recommend for a "cohesive" index), audit every query meant to use it and confirm
each one actually names that nodetype, not just `*`/`nt:base`. `explain` is the tool to catch this — a
scoped index silently missing from the candidate list (Lucene) or reporting `Infinity` (property index)
is the signature of this specific problem, distinct from a genuine `includedPaths`/`queryPaths` mismatch
(§4.2) which behaves differently (that one can get *silently selected* for the wrong scope, this one gets
silently *excluded* even for the right scope).

---

## 9. Diff Indexes & Superseding an Index

### 9.1 Diff Indexes
`[PUBLIC]` (indexing.md), `[CODE]` verified. **Requires Oak 1.92+ / OAK-12010** — this AEM instance
(Oak 1.88.0) predates it, so most of this subsection is code-verified but **not** `[LIVE]`-tested here.

`[LIVE]` one thing *was* confirmed on this 1.88.0 instance: the feature fails **silently and inertly**
on a too-old Oak, rather than erroring. Creating `/oak:index/diff.index` (`type=disabled`) with a valid
`diff.json` (`{}`) child produced no `warn.*` property and no `*-custom-*` merged index anywhere under
`/oak:index`, even after waiting past a normal async cycle. Useful to know: if you deploy `diff.json`
content to an environment running Oak <1.92, nothing breaks and nothing merges — it just does nothing,
with no signal that the version requirement wasn't met.

- `/oak:index/diff.index` (type `disabled`, `oak:QueryIndexDefinition`) holds a `diff.json` (`nt:file`) whose
  content is a JSON object merged into the out-of-the-box index definitions to produce new versioned nodes
  (e.g. `damAssetLucene-8-custom-1`).
- `[GOTCHA — undocumented sibling]` `/oak:index/diff.index.optimizer` is a **second**, functionally
  identical diff-index node (`DiffIndexMerger.DIFF_INDEX_OPTIMIZER = "diff.index.optimizer"`) that gets
  combined with `diff.index` during merging. indexing.md never mentions it exists.
- Names containing a dot (`acme.myIndex`) are treated as brand-new custom indexes (no OOTB base to merge
  against); the diff for those must be a complete index definition.
- Merge rules (top-level property merge, indexed-property-rule matching by `name`/`function`, checksum-based
  re-merge detection) are as documented in indexing.md — no inaccuracies found there.
- Warnings surface as `warn.01`, `warn.02`, ... properties on `diff.index`, capped at 100 entries / 1MB, and
  self-clear once resolved. A hidden `:lastProcessed` bookkeeping property (on the `diff.json/jcr:content`
  node) tracks whether a given `diff.json` revision has already been merged, to avoid reprocessing.
- `[GOTCHA]` indexing.md's Indexed Property Rules says existing property values "may not be overwritten,
  except for `boost` and `weight`" — `[CODE]` this list is incomplete: `secure` (the facets ACL mode
  property, §14) can also be overwritten on an existing property.
- `[CODE]` `[PRIVATE?]` undocumented system properties tune edge-case merge behavior:
  `oak.diffIndex.unsupportedPaths`, `oak.diffIndex.deleteCreatesDummy`, `oak.diffIndex.deleteCopiesOOTB`,
  `oak.diffIndex.logAtInfoLevel`.

### 9.2 Superseding an Index
`[PUBLIC]` (indexing.md) + `[LIVE]` (this AEM, Oak 1.88.0 — the feature predates OAK-6820 and is much older
than diff indexes). See [Appendix C](#appendix-c-live-verification-log) for the exact commands.

```
/oak:index/sampleIndex2
  - supersedes = ["/oak:index/sampleIndex1"]
  - reindex = true
```

`[GOTCHA — important, not in public doc]` disabling the superseded index is a **two-phase, two-commit**
process, confirmed live:
1. **Commit 1** (saving `supersedes` + `reindex=true`): Oak only sets an internal flag
  (`:disableIndexesOnNextCycle`) on the new index. The superseded index is **not yet disabled**.
2. **Commit 2** (any subsequent commit that runs the index diff again — for a synchronous property index,
   literally any following `save()`; for async indexes, the next async cycle): Oak sees the flag was already
   present in the *base* state (i.e., set in a prior cycle) and only **then** flips the superseded index's
   `type` to `disabled`.

   Live evidence: after commit 1, `GET /oak:index/sampleIndex1.json` still showed `"type":"property"`;
   only after a trivial no-op second commit did it flip to `"type":"disabled"`.

`[CODE]` `supersedes` also accepts a **nodetype-scoped** form not mentioned in indexing.md at all:
`/oak:index/nodetype/@someNodeType` — instead of disabling a whole index, this removes `someNodeType`
from the `declaringNodeTypes` of the `nodetype` index (i.e. "stop routing this one nodetype through the
built-in nodetype index, because my new index now handles it"). Not live-tested here (mutating the
production `nodetype` index on a shared AEM instance was judged too risky) — code path:
`IndexDisabler.isNodeTypePath()` / `disableOldIndexes()` in
`oak-core/.../plugins/index/upgrade/IndexDisabler.java`.

---

## 10. Query Engine: Cost, Planning, Execution

`[PUBLIC]` (query-engine.md), reorganized.

**Pipeline**: parse → (if XPath) convert to SQL-2 → ask every registered index for a cost estimate against
the filter → pick lowest cost → execute as a lazy iterator, pulling nodes from the chosen index (or
traversal) and re-checking any constraints the index couldn't fully evaluate itself, **plus always
re-checking read access** node-by-node (this happens even for a "fully native" index plan) → apply `order by`
(in-memory sort, and a **full** read of the result set, if the index can't provide the requested order) →
apply `limit`/`offset`.

- **`or` across different properties** compiles to a `UNION` (dedup unless `UNION ALL`) so each side can use
  its own index; **`or` on the *same* property** compiles to `IN(...)` instead and keeps using one index.
  XPath *always* does the `or`→`union` conversion; SQL-2 only does it when the union plan is estimated
  cheaper than a single-index-with-OR plan. `[LIVE]` confirmed with real numbers for
  `[tags]='red' or [tags]='blue'` (SQL-2, no index on `tags` in this test, so both plans traverse): `explain`
  literally logs `property=[tags=[in(red, blue)]]` (confirming the `IN` rewrite), then computes and logs
  **both** candidate plans side by side — `cost: 175204.0` for the plain traversal-with-`IN` plan vs.
  `cost: 350418.0` for the `UNION` alternative (traversing twice, once per value) — and correctly picks the
  cheaper plain plan. Also confirmed the multi-valued-property `AND` semantics: `@tags='red' and
  @tags='blue'` matched only a node whose `tags` array contained *both* values, not a node with just one.
- **`and` on the same multi-valued property twice** (`@x=1 and @x=2`) is a real, useful pattern: it matches
  nodes where the *array* contains both values — not found in relational SQL semantics.
- Sorting by `jcr:score` **descending** is a no-op (removed from the ordering list) because that's already
  the fulltext index's natural order; force it anyway via the documented workaround
  `order by fn:lowercase(@jcr:score) descending` / `LOWER([jcr:score]) DESC`.
- `LimitInMemory` / `LimitReads` (JMX `QueryEngineSettings`, or system properties `oak.queryLimitInMemory` /
  `oak.queryLimitReads` as a non-persisted-restart-safe alternative) cap, respectively, nodes buffered for
  in-memory sort/dedup, and total nodes read (indexed or traversed) — both throw
  `UnsupportedOperationException` on breach. `[LIVE]` confirmed on a real (>100k-node) repo:
  `"The query read or traversed more than 100000 nodes. To avoid affecting other tasks, processing was
  stopped."` `[GOTCHA]` **`option(traversal ok)` (or the default) does not exempt a query from
  `LimitReads`** — these are two independent guardrails. `option(traversal fail)` rejects *before*
  scanning a single node (fast, "consider creating an index"); `LimitReads` can still trip *during* a
  traversal you explicitly allowed with `ok`, with the different message above. Don't treat
  `option(traversal ok)` as a guarantee the query is safe on a large repo.
- **SQL-2 Optimisation** (`@since 1.3.9`, on by default since 1.3.11): a post-parse optimization pass
  (e.g. OR→UNION conversion, OAK-1617) on the parsed `Query` object. Disable via
  `-Doak.query.sql2optimisation=false`.
- **Temporarily Blocking Queries** (`@since 1.14.0`, OAK-8294): `QueryEngineSettingsMBean` JMX operations
  `setQueryValidatorPattern` (add/remove) and `queryValidatorJson` (inspect existing patterns + hit counts).
  Patterns can also be persisted under `/oak:index/queryValidator/<key>` (`nt:unstructured`) with properties
  `pattern` (a regex, or a multi-valued string array of exact substrings the regex gets built from — no
  escaping needed in that form), `failQuery` (log-only vs. actually fail), `comment`. Test new patterns with
  `failQuery=false` first. Patterns are read once at startup and evaluated in alphabetical key order.
  `[LIVE]` `[GOTCHA — easy to get wrong, confirmed by direct testing]` **the `pattern` regex must match the
  *entire* query statement text (Java `Pattern.matches()`, a full match), not just contain a match
  somewhere in it** — this isn't stated anywhere in the public doc's wording ("a regular expression of the
  query" reads like a substring/contains check). A pattern like `myMarkerProperty` will **never** trigger,
  even against a query that literally contains that exact text, because the regex doesn't account for
  everything before/after it. You must wrap with `.*`: `.*myMarkerProperty.*`. Confirmed live via the JMX
  operation: the bare pattern produced `executedCount: 0` after running a matching query repeatedly; adding
  `.*` on both sides immediately produced `executedCount: 1` and, with `failQuery=true`, the expected
  `java.text.ParseException: Query is blacklisted: statement=... pattern=...` on the next matching query.
- **Compatibility with Jackrabbit 2.x**: `NodeIterator.getSize()` returns the exact count or `-1` by default
  (Jackrabbit 2 returned a raw/estimated Lucene hit count that could include inaccessible nodes). Opt into
  the old estimate-based behavior via OSGi `fastQuerySize` on `QueryEngineSettingsService` (`@since 1.6.x`)
  or Sling `conf/sling.properties` `oak.query.fastResultSize=true` — only effective with Lucene
  `compatVersion=2`, and can still return `-1` if the specific index used doesn't support it;
  `@since 1.62` (OAK-10424) `SessionQuerySettingsProvider`/`directCountsPrincipals` scopes this to specific
  principals. Stricter quoting than Jackrabbit 2 (`ISDESCENDANTNODE(s, ["/path"])` double-quoting now fails;
  use `ISDESCENDANTNODE(s, [/path])`). `jcr:path = '/abc/%'` used to be silently treated as `LIKE`; Oak
  treats it as an exact match.
- **Native Queries** (`@deprecated 1.46`): `rep:native('lucene'|'solr', '<native query syntax>')` /
  SQL-2 `native(...)` passes a raw query straight to the underlying full-text engine, including
  Solr's MoreLikeThis (historical; Solr itself is removed). `functionName` on a Lucene index definition lets
  a query target one specific index by name when several are registered.
- **Score Explanation** (`@since 1.3.12`): select the virtual column `oak:scoreExplanation` to get Lucene's
  score-explanation string per row — debug-only, expensive, don't use it in production query paths.
  `[LIVE]` confirmed the query itself executes without error when selecting this column (`select
  [oak:scoreExplanation], * from [...] where contains(*, '...')`) — the actual explanation *text* couldn't
  be inspected via the HTTP tooling used here (same `Row` pseudo-column limitation as excerpts/facets),
  so this only confirms the column is accepted, not the content of what it returns.
- `[GOTCHA]` **tooling caveat, not a product limitation**: this doc's own AEM curl-testable tools both have
  trouble with literal `explain`/`measure` keywords — `crx/de/query.jsp` 500s on a `stmt` containing either,
  and the `granite_queryperformance.explain.json` diagnostic endpoint wraps *every* statement in its own
  `explain` server-side regardless of what you pass it, so a literal `measure select ...` through that
  endpoint just becomes `explain measure select ...` and never exercises real `MEASURE` scan-count output.
  To actually exercise `explain`/`measure` semantics, use the JCR API directly
  (`QueryManager.createQuery(...).execute()`) or `oak-run console`, not these two AEM HTTP endpoints.
- **Keyset pagination** is the documented alternative to `OFFSET` for large result sets (`OFFSET` beyond a
  few hundred rows is a real perf/memory risk): order by an ordered index column + `jcr:path` tiebreaker,
  carry the last seen value as a bind variable for the next page. If there's no natural sort column, use
  `lower(name())` as a function-based index (§4.7).
  `[LIVE]` `[GOTCHA]` confirmed: `order by` on a plain **String** property sorts **lexically, not
  numerically** — a page-key column stored as strings `"1".."10"` orders as `1, 10, 2, 3, 4, ...`, which
  silently breaks numeric-looking pagination. If the page key is meant to be numeric, either store/index it
  with `type=Long`/`Date` explicitly, or zero-pad the string — don't assume `order by` on a numeric-looking
  string column sorts numerically. Easy mistake when an AI agent generates paging test data as plain strings.

---

## 11. Query Options (`option(...)`)

`[PUBLIC]` core options, `[CODE]` additions the public docs never mention (verified in `QueryOptions.java`
and both parsers).

| Option | Syntax | Effect |
|---|---|---|
| Traversal | `option(traversal ok\|warn\|fail\|default)` | Overrides the global `QueryEngineSettings.failTraversal` behavior for this one query. |
| Limit/Offset | `option(limit N, offset M)` | `@since 1.44 (OAK-9740)`. Overridden by `Query#setLimit`/`setOffset` if the API caller also sets those. |
| Index tag | `option(index tag <name>)` | Restrict index selection to indexes whose `tags` includes `<name>`. One tag per query. Lucene compatVersion 2 and property indexes only; solr/reference indexes ignore tags (may still be selected!). Nodetype index: if a tag is specified, the nodetype index is **excluded** from consideration, but tags *on* the nodetype index itself are ignored either way. No way to force-disable traversal via tags — if traversal's own estimated cost is lowest, it's still used. `[LIVE]` confirmed mechanism detail: when `option(index tag X)` is supplied, an index that doesn't carry tag `X` is **filtered out of the candidate set before cost evaluation entirely** — it does not even appear in the cost-log output (not merely assigned `Infinity`). Symmetrically, without any tag option, an untagged index and a tagged-but-otherwise-identical index are both costed and the tie is broken by declaration order. |
| **Index name** `[CODE]` `[PRIVATE?]` | `option(index name <name>)` | **Not in any public doc.** Forces selection of a specific index by name (`QueryOptions.indexName`, parsed identically in both XPath and SQL-2 via `OPTION(INDEX NAME ...)` / presumably an equivalent XPath surfacing — verify grammar coverage before relying on this in application code; it is unclear whether it is intended for general use or purely internal tooling). |
| **Prefetch** `[CODE]` `[PRIVATE?]` | `option(prefetch (path1, path2)) `/ `option(prefetches N)` | **Not in any public doc.** Hints for `DocumentNodeStore` (MongoDB) batch-prefetching of documents during traversal/cursor iteration, to cut round-trips. Backed by `oak-store-document`'s `prefetch`/`CacheWarming` machinery; irrelevant for `SegmentNodeStore`. Global default is `QueryEngineSettingsMBean.prefetchCount` (`-1` sentinel = defer to an internal Feature toggle, which yields `20` when enabled, `0` otherwise). |

`[CODE]` `[PRIVATE?]` **Automatic Query Options mapping** — a mechanism with no public documentation at all:
`QueryEngineSettingsMBean.setAutoOptionsMappingJson(String json)` lets an operator supply, via JMX, a JSON
map from a **normalized query-statement pattern** (via `QueryRecorder.simplifySafely`, the same
normalization used for query-stats aggregation — numbers become `1`, quoted literals become `'x'`/`"x"`)
to a default `QueryOptions` object (`traversal`, `indexName`, `indexTag`, `limit`, `prefetch`/
`prefetchCount`). This is the same idea as the `queryValidator` block-pattern mechanism in
query-engine.md's "Temporarily Blocking Queries" section, but for *injecting* options instead of
*rejecting* queries.

`[LIVE]` `[GOTCHA]` **this is a real, useful mechanism, but its reach is narrower than "retrofit options
onto any query you can't edit" implies, and it behaves asymmetrically between XPath and SQL-2** — code
review of both parsers, confirmed via the JMX attribute in this session: `SQL2Parser.parseSelect()` calls
`getAutomaticQueryOptions().getDefaultValues(query)` **unconditionally**, before even checking whether the
query text contains an `OPTION` keyword. `XPathToSQL2Converter`'s equivalent parsing method calls it
**only inside** the `if (readIf("option"))` branch — meaning for an **XPath** query, the query text must
already contain a (possibly syntactically-empty, if that's even legal) `option(...)` clause for any
JMX-configured defaults to be consulted at all; a bare XPath query with no `option(...)` clause never
looks at the mapping, no matter what's configured. For **SQL-2**, the mapping is consulted regardless.
Practical implication: this mechanism is far more useful for retrofitting behavior onto **SQL-2** queries
baked into code you can't edit than onto XPath ones — for XPath, you'd need the original code to already
have *some* `option(...)` clause for this to have any effect. (This session could not get a clean live
demonstration of the end-to-end effect — JSON parses and the attribute is genuinely settable/reachable via
JMX, but no test query visibly picked up mapped defaults; the asymmetry above is a code-level finding, not
itself unconfirmed.)

Also present, `[CODE]` `[PRIVATE?]` `[LIVE]`: `QueryEngineSettingsMBean.strictPathRestriction` (`ENABLE`/
`WARN`/`DISABLE`, default `DISABLE`). When `ENABLE`, a Lucene/Elastic index plan is **rejected outright**
(forcing a different plan, possibly traversal) if the query's path filter doesn't line up with that
index's own `queryPaths`; `WARN` logs instead of rejecting. This is the runtime enforcement of exactly the
pitfall lucene.md warns about under "Avoid overlapping index definition" (§4.2 above) — but the JMX knob to
actually *catch* violations isn't mentioned in that doc at all. `[LIVE]` confirmed as a real, working fix
for the §4.2 `includedPaths`/`queryPaths`-mismatch correctness bug: flipping this to `ENABLE` via the Felix
JMX console (`POST /system/console/jmx/org.apache.jackrabbit.oak%3Aname%3Dsettings%2Ctype%3DQueryEngineSettings/a/StrictPathRestriction`,
form field `value=ENABLE`) turned the broken scenario's wrong-empty-result plan into a correct
traversal-fallback plan. **This is a global, instance-wide setting — flipping it affects every query on the
system**, so treat it like a JVM-level config change (test it, then decide whether to leave it on), not a
per-query knob.

---

## 12. XPath Grammar Reference

`[PUBLIC]` (grammar-xpath.md), condensed. Full grammar is generated from a railroad-diagram CSV
(`oak-doc/src/site/resources/grammar/xpath.csv`) — the prose below is the practically-useful subset.

- Always start with `/jcr:root` and always include a path restriction, even a shallow one — this bounds
  index size selection and traversal cost.
- `*` = any name/type; `text()` = `jcr:xmltext` (compat only); `(a|b)` = union, generates one subquery per
  branch (careful combining with fulltext `order by @jcr:score` — see §18).
- Relative-property wildcards: `a/*/@test` and `*/a/@test` are valid (one `*` per path segment allowed);
  `a//@test` (double-slash inside a relative property path) is **not** supported.
- Functions in **conditions**: `fn:not(@x)` (is-not-set; can use an index but is relatively expensive to
  maintain for "most nodes don't have this property" cases — see `nullCheckEnabled`), `jcr:contains`,
  `jcr:like` (`_`/`%` wildcards, backslash-escaped; leading wildcard forces non-index evaluation),
  `rep:similar`, `rep:native` (deprecated `@1.46`), `rep:spellcheck`, `rep:suggest`.
- Functions as **dynamic operands**: `jcr:score()`, `fn:coalesce(@a,@b)` (`@since 1.8`), `jcr:first(@alias)` /
  `fn:path()` (`@since 1.42`, OAK-9625), `fn:string-length`, `fn:local-name`, `fn:lower-case`/`fn:upper-case`.
- Columns: `rep:excerpt()` / `rep:excerpt(@prop)` (`@since 1.8.1` for the property-scoped variant),
  `rep:spellcheck()`, `rep:suggest()`, `rep:facet(@prop)`.
- `explain <query>` returns one row, column `plan`, without running the query.
  `explain measure <query>` additionally computes cost. `measure <query>` actually **runs** the query and
  returns per-selector `scanCount` rows (plus one `query`-selector total row) instead of the result rows —
  useful for "how much did this really traverse" without needing DEBUG logging.
- Options: `option(traversal ok|warn|fail|default)`, `option(index tag <name>)`,
  `option(limit N, offset M)` — see §11 for the two undocumented siblings (`index name`, `prefetch`).

---

## 13. SQL-2 Grammar Reference

`[PUBLIC]` (grammar-sql2.md), condensed; same railroad-CSV-backed source as XPath.

- Same path-restriction recommendation as XPath. `union` / `union all` between full `select` statements
  (not just filters like XPath's `(a|b)`).
- `[x]=1 or [x]=2` auto-converts to `[x] IN(1,2)`; `[x]=1 or [y]=2` is costed both as a plain OR-with-both-
  conditions plan and as a `UNION` plan, and the cheaper one wins (SQL-2 only — XPath always unions).
- Joins: inner / left outer / right outer, standard semantics — outer-joined selector's properties are
  `null` when there's no match.
- `[CODE]` `[GOTCHA]` `jcr:deref(...)` is recognized *by name* in `XPathToSQL2Converter` but immediately
  throws `"jcr:deref is not supported"` — a recognized-but-rejected token, not a hidden working feature.
  Don't spend time trying variant syntaxes expecting it to work; it's a hard "no" in current code.
- Dynamic operands: `lower(...)`, `upper(...)`, `length(...)` (indexes on functions `@since 1.6`, OAK-3574),
  `coalesce(...)` (`@since 1.8`), `first(...)` / `path()` (`@since 1.42`, OAK-9625), `name()`, `localname()`,
  `score()` (present in the parser though not spelled out in the public grammar table — equivalent to
  `[jcr:score]` as a pseudo-column), `property(*, <Type>)` (rarely used — search across all properties of a
  given JCR type, e.g. `property(*, Reference) = $uuid`).
- Constraint functions: `similar(...)`, `native(...)` (deprecated), `spellcheck(...)`, `suggest(...)`,
  `contains(...)`.
- `explain [measure]` / `measure` / `option(...)` — identical semantics to XPath, see §11-12.

---

## 14. Full-Text, Facets, Suggestions, Spellcheck, Similarity

`[PUBLIC]` (query-engine.md + lucene.md), condensed to the operational bits.

- **Full-text syntax** (compatVersion 2, the default): Apache Lucene classic query-parser grammar, **except**
  `AND`/`NOT` are treated as literal search terms (only `OR`, uppercase, is a real keyword) — use `-term` for
  negation and juxtaposition (`hello world`) for AND. compatVersion 1 uses a smaller custom grammar
  (`Or ::= And {' OR ' And}*`, `Term ::= ['-']{Simple|"Phrase"}['^'Boost]`).
- **Excerpts**: query must select `rep:excerpt(.)` and/or `rep:excerpt(@prop)`
  (`@since 1.10`/OAK-7151 for the property-scoped form) from an index that has `useInExcerpt` configured on
  the relevant property; otherwise the `SimpleExcerptProvider` fallback kicks in (works without index
  config, but weaker — stopwords ignored, no index-aware term boundaries). Read via
  `row.getValue("rep:excerpt(.)")` / `row.getValue("rep:excerpt(@title)")`.
  - `[CODE]` `[LIVE]` **A fulltext term (`contains(...)`) is structurally required, even if you already
    know the exact node path.** `getExcerpt()` (`LucenePropertyIndex.java`) reads only from
    `searcher.getIndexReader().document(docID)` — i.e. it needs the row to have come from a genuine Lucene
    search hit, not merely to be *about* a node the Lucene index happens to also cover. Live-confirmed: a
    bare path lookup (`ISSAMENODE('/path')`, no `contains()`) gets planned as **traversal** (cost `1.0`)
    instead of the Lucene index (cost `2.0`) — cheaper for an exact single-node lookup — so `getExcerpt()`
    is never reached and the excerpt can't be populated. Add a `contains(...)` condition on the same query
    and the planner switches to the Lucene index (confirmed via `explain`:
    `luceneQuery: +full:bodyText:elephant +:path:/content/.../n1`), giving `getExcerpt()` a real hit to read
    and the highlighter something to highlight. **Net: excerpt-by-known-path only works if the query also
    carries a search term** — the term isn't just what gets highlighted, it's also what forces index
    selection over the cheaper traversal plan.
    ```java
    String sql2 =
        "SELECT [rep:excerpt(bodyText)] FROM [nt:unstructured] " +
        "WHERE ISSAMENODE('/content/qbExcerptTest/n1') " +
        "AND CONTAINS(bodyText, 'elephant')";
    QueryResult result = qm.createQuery(sql2, Query.JCR_SQL2).execute();
    for (RowIterator rows = result.getRows(); rows.hasNext(); ) {
        Row row = rows.nextRow();
        Value excerpt = row.getValue("rep:excerpt(bodyText)");
        System.out.println(row.getNode().getPath() + " -> " + excerpt.getString());
    }
    ```
- **Similarity** (`rep:similar(., '/path')`): MoreLikeThis over text by default; extended to feature vectors
  via `useInSimilarity=true` (approximate nearest-neighbor + brute-force rerank of top 15 by default,
  `similarityRerank`), optionally tagged with `similarityTags=true` on text properties describing the vector.
  `indexSimilarityBinaries`/`indexSimilarityStrings` (`[CODE]`, default `true` each) toggle whether
  binary-encoded vs. string-encoded vectors get indexed at all — not in lucene.md's similarity section.
- **Spellcheck**/**Suggest**: `useInSpellcheck`/`useInSuggest` per property, compatVersion 2 required.
  Suggestions rebuild every `suggestUpdateFrequencyMinutes` (default 10) on Lucene (immediate on Elastic).
  Both support a very limited subtree scoping via `evaluatePathRestrictions=true` — internally implemented
  as "filter the top 10 candidates", so a subtree query can legitimately return **zero** results even though
  matches exist deeper in the ranked list.
- **Facets**: `facets=true` per property; index must actually cover the queried nodes (fulltext index or
  indexed `jcr:primaryType`) or facet counts silently reflect only what the index *did* evaluate — any
  constraint the index couldn't natively apply is filtered out **after** facet counting, producing
  misleading counts. `[LIVE]` `[GOTCHA]` a `rep:facet(...)` query is **less forgiving of the §8.1
  nodetype-scoping gotcha than plain fulltext queries**: when no index can be found to evaluate it (e.g.
  the nodetype restriction is missing from the query, so the scoped index isn't even considered), it does
  **not** silently fall back to traversal like `jcr:contains(...)` does — it throws a hard error,
  `"rep:facet(tags) can't be evaluated by traversal"`. **This exception only happens when the query is
  actually executed** — `explain` on the exact same query does **not** throw; it returns a normal
  `success: true` response with a `traverse`/`estimatedEntries: Infinity` plan and no error, which is easy
  to misread as "the query is fine, just uses traversal." Don't trust `explain`'s success alone for a
  `rep:facet` query — you have to run it (or check for `Infinity` traverse specifically as an early-warning
  sign) to discover it will actually fail. If you hit this exact runtime error, the fix is almost always
  adding the missing nodetype restriction to the query (§8.1), not something wrong with the facet config
  itself. `secure` facet mode (`secure` default / `insecure` / `statistical`, `sampleSize` default
  1000) trades ACL-check cost for approximate counts; error rate empirically ~10% at 5% result accessibility
  and 1000-sample, ~0.5% at 95% accessibility.

---

## 15. Reindexing

`[PUBLIC]` (indexing.md). One-line mental model: **reindexing rarely fixes a "wrong results" problem** — it
fixes "index config changed and old data was never (re)covered by the new config." If results look wrong,
check the query, the index selection (`explain`), and path include/exclude settings **before** reindexing.

Set `reindex=true` on the index node to trigger; synchronous for property indexes (blocks the save), starts
on the next async cycle otherwise. Reasons it's actually needed: changed property-index config (old nodes
untouched since the change aren't covered — a workaround is to "touch" affected nodes instead of a full
reindex), pre-1.6 Lucene definition changes (1.6+ needs the extra `refresh=true` opt-in step for
compatible changes instead, §4.9), a badly-drifted `counter` index (pre-1.2.15/1.4.2), missing/corrupt Lucene
binaries, and a handful of now-historical version-specific bugs (OAK-5557, OAK-4684, OAK-3911) listed
verbatim in the public doc if you need the historical detail.

Abort a running (re)index via the relevant `IndexStats` JMX bean's `abortAndPause()`, fix the index
definition, then `resume()`.

---

## 16. oak-run Indexing Tool

`[PUBLIC]` (oak-run-indexing.md) is explicitly labeled **work in progress, not for production**. `[CODE]`
found substantially more flags than documented (see `IndexOptions`/`ElasticIndexOptions` in
`oak-run-commons`) — the delta below is the actual gap, not the full flag list (run `--help` for that):

| Flag | Purpose |
|---|---|
| `--index-out-dir`, `--index-temp-dir` | Override output/temp directories (doc only mentions the default `indexing-result` dir). |
| `--async-index`, `--async-index-lanes`, `--async-delay` | Drive/tune an async indexing cycle directly from oak-run, distinct from the documented `--reindex` full-rebuild flow — an entirely undocumented workflow. |
| `--doc-traversal-mode`, `--build-flatfilestore-separately` | DocumentNodeStore-specific: control the FlatFileStore-based traversal strategy used during reindex. |
| `--enable-cow-cor` | Enable CopyOnWrite/CopyOnRead (§4.10) during an oak-run indexing run. |
| `--ignore-missing-tika-dep` | Continue even if the Tika classpath dependency (§ Tika Setup) is missing. |
| `--existing-data-dump-dir` | Reuse a previously captured DocumentStore dump instead of re-traversing. |
| `--scheme`, `--host`, `--port`, `--apiKeyId`, `--apiKeySecret`, `--indexPrefix` | **Elastic-specific** connection flags for reindexing an `elasticsearch`-type index via oak-run — elastic.md tells you to "use oak-run" for building Elastic indexes but neither doc explains how; these flags are how. |

Documented flags (`--index-paths`, `--index-info`, `--index-definitions`, `--index-dump`,
`--index-consistency-check[=1|2]`, `--reindex`, `--read-write`, `--checkpoint`, `--index-definitions-file`,
`--pre-extracted-text-dir`, `--index-import`, `--index-import-dir`) all check out against the code as
described — no inaccuracies found there, just the above omissions.

`[PUBLIC]` **JSON encoding** for index-definitions-file / `json-index` script values: plain for
Long/Boolean/Double; String needs a `str:` prefix only if it would otherwise collide with a 3-letter+colon
type prefix; Date needs `dat:` + ISO-8601; Name needs `nam:` (except `jcr:primaryType`/`jcr:mixins`, inferred
automatically); Path needs `pat:`; URI needs `uri:`; Binary is base64 with a `:blobId:` prefix if < 1MB.

Separately, `oak-run`'s `json-index --script` REPL (index-management.md) supports a tiny scripting language
(`addNode`/`removeNode`/`setProperty`/`session save`/`xpath`/`sql`/`for`/`loop`/`if`/variables via `$name`) —
useful for reproducible index-creation scripts and for cheaply estimating node counts
(`{"xpath": "explain measure /jcr:root/content//* option(traversal ok)"}`).

---

## 17. Cost Estimation Model

`[PUBLIC]` (cost-estimation.md) — `[CODE]` verified accurate against `FulltextIndexPlanner.java`, no
corrections needed. Summary (see the public doc for the full worked example and PostgreSQL comparison
table):

```
cost = costPerExecution + estimatedEntryCount × costPerEntry / (1 + |sortOrder|)
```

Two estimator implementations coexist, selected by the `FT_OAK-12221` feature toggle (default **disabled**):

- **Legacy** (`FT_OAK-12221` disabled): per indexed property in the filter, compute
  `docCntForField / weight` (or raw `docCntForField` if `weight==1`), then take the **min** across
  properties. This means `AND`-ing more indexed conditions together **never reduces** the estimated cost
  below the single most-selective condition — no compounding.
- **New selectivity model** (`FT_OAK-12221` enabled): per-condition selectivity is looked up from a `stats`
  JSON property (Most-Common-Value percentages) if available, else falls back to `1/weight`; `AND`
  conditions **multiply** selectivities (the textbook independence assumption used by real RDBMS planners);
  `IS NULL`/`IS NOT NULL` use **exact live counts** instead of the `weightNull`/`weightNotNull` heuristic.

`[CODE]` `[PRIVATE?]` one more undocumented flag on top of the two feature toggles: system property
`oak.fulltext.useActualEntryCount` (default `true`) — setting it `false` forces the planner to use a flat
default entry count of `1000` for every query instead of the real live-count estimate. Not mentioned in
cost-estimation.md or lucene.md.

`weight` defaults to `5` (`-Doak.fulltext.defaultPropertyWeight` to change the default). `FT_OAK-12171`
(default **disabled**, meaning its improved behavior is active by default — enabling it is a *kill switch*
reverting to pre-OAK-12171 null-check behavior) and `FT_OAK-12221` are both runtime `FeatureToggle`s, so they
can be flipped without a restart.

---

## 18. Troubleshooting Playbook

`[PUBLIC]` (query-troubleshooting.md), turned into a checklist.

1. **Is it slow because it traverses?** Look for `Traversed N nodes with filter ...` (WARN, N ≥ ~1000-10000)
   or `Traversal query (query without index): ...` (INFO in 1.6.x, WARN in 1.8.x+) in logs.
2. **Get the plan**: `explain <query>`. If it says `traverse "/path//*"`, no index is being used at all.
3. **Tighten the query first**, before touching indexes: narrower path restriction, more specific nodetype
   (check `/oak:index/nodetype`'s `declaringNodeTypes` to see what's already cheaply indexable by type),
   additional selective property constraints.
4. **Only if that's not enough**, consider: a new/extended index for the bottleneck property; converting a
   `LIKE '%..%'` scan into `contains(...)` fulltext (usually the actual fix for "search box" style queries);
   `evaluatePathRestrictions=true` if the path constraint itself isn't being pushed into the index.
5. **Verify** with `explain` again — check the returned plan actually mentions the new index/native
   fulltext condition, not just "traverse" replaced by "traverse a smaller subtree."
6. **Legitimate small traversals**: mark with `option(traversal ok)` rather than building an index nobody
   else needs — but this is a "rare corner case" per the public doc, not a general escape hatch.
7. **OR-heavy / UNION-heavy queries**: `(a|b|c)//*[cond1 or cond2 or ... ]` explodes into
   `|branches| × |or-conditions|` subqueries. Fix by aggregating the OR'd properties into one fulltext field
   (turns N conditions into 1 `contains(., ...)`) and/or loosening the path restriction while filtering some
   other way, to avoid the union explosion.
8. **`order by jcr:score desc` with `union`/`or`**: scores from different subqueries usually aren't
   comparable, so the merged order can look wrong. Prefer expressing the "or" as an indexed property
   condition (SQL-2 `[jcr:path] LIKE ...` union trick, or a tag property) instead of a path-based union, so
   there's only one subquery and one coherent score ordering.
9. Estimate node counts along the way with the `NodeCounter` JMX bean's `getEstimatedChildNodeCounts` — cheap
   and doesn't require running the real query.
10. **Prevent regressions**: `QueryEngineSettings.FailTraversal=true` (JMX) turns "must traverse" into a hard
    failure everywhere, useful in a staging environment to catch new unindexed queries before production.
    Also consider the automatic-query-options / query-validator mechanisms in §11 to react without a code
    change once a bad query is identified in production.

---

## 19. Undocumented / Private Appendix

Findings from a source-code sweep of trunk that are **not** in any of the 9 public docs. Each is tagged
`[CODE]` (should probably be documented publicly — real, usable feature) or `[PRIVATE?]` (looks internal,
experimental, or SPI-only; a human should decide before publishing).

**Already covered inline above** (cross-referenced, not repeated): `nodeTypeIndex` rule flag (§4.3),
`diff.index.optimizer` (§9.1), nodetype-scoped `supersedes` (§9.2), `option(index name ...)` /
`option(prefetch...)` / Automatic Query Options mapping / `strictPathRestriction` (§11).

`[CODE]` **`IndexStatsMBean` has more operations than indexing.md documents**: alongside the documented
`pause`/`abortAndPause`/`resume` (§7, `[LIVE]` confirmed this session via the `Paused` boolean attribute),
the live JMX console (`org.apache.jackrabbit.oak:name=<lane>,type=IndexStats`) also exposes
`forceIndexLaneCatchup`, `releaseLeaseForPausedLane`, `resetConsolidatedExecutionStats`,
`splitIndexingTask`, and `registerAsyncIndexer` — none mentioned anywhere in indexing.md. Not exercised in
this pass (judged too disruptive/uncertain to invoke experimentally on a shared instance); flagged here so
a human knows they exist before reaching for a full reindex or a lane-config change to solve a problem one
of these might address more directly.

**Additional Lucene/Elastic index-definition properties** (`FulltextIndexConstants`/`LuceneIndexConstants`),
not in lucene.md's canonical property lists at all:

| Property | Level | `[CODE]`/`[PRIVATE?]` | What it does |
|---|---|---|---|
| `includePropertyNames` | index-rule | `[CODE]` | Allow-list of property names for fulltext inclusion; if set, `excludePropertyNames` is ignored. |
| `excludePropertyNames` | index-rule | `[CODE]` | Deny-list of property names, excluded from fulltext indexing. |
| `fulltextEnabled` | index definition | `[CODE]` | Disables fulltext indexing for the whole definition (default `true`) — for a Lucene index used purely as a structured/property index. |
| `orderedProps` | index-rule | `[CODE]` | Rule-level list of property names usable for ordering; distinct from the per-property `ordered` boolean — "if range queries are performed on the same property, it must also be in the include list." |
| `mergePolicy` | index definition | `[CODE]` | Named Lucene merge-policy, sibling to the documented `codec` property. |
| `similaritySearchDenseVectorSize` | property definition | `[CODE]` | Explicit dense-vector size for similarity search, alongside `useInSimilarity`. |
| `scorerProviderName` | index-rule | `[PRIVATE?]` | Hook name for a custom scorer provider SPI; no public consumer documented anywhere. |
| `oak.experimental.includePropertyTypes`, `oak.experimental.storage` | index definition | `[PRIVATE?]` | Explicitly named/commented "Experimental" in code. |
| `testMode` | index definition | `[PRIVATE?]` | Internal test-only flag (`LuceneIndexConstants.TEST_MODE`). |
| `saveDirectoryListing` | index definition | `[PRIVATE?]` | Internal storage-format optimization (OAK-2809). |
| `seed` | index definition | `[PRIVATE?]` | RNG seed backing statistical facet sampling (§14) — worth at least *naming* as internal/read-only in the facets section, since lucene.md describes the sampling behavior it controls without ever naming the property. |

**A second, entirely separate "diff/merge" mechanism** `[PRIVATE?]`: `oak-run`'s `merge` package
(`IndexMerge`, `IndexDiff`, `IndexDefMergerUtils`, `IndexDiffCommand`, `IndexStoreStatsCommand`) implements
index-definition diffing/merging as an **offline CLI tool** across two definition snapshots — this is
different code from, and unrelated at the class level to, the runtime `/oak:index/diff.index` auto-merge
feature in §9.1, despite similar naming and goals. Worth a one-line disambiguation in the public docs so
"diff" + "index" + "merge" doesn't send readers to the wrong mechanism.

---

## Appendix A: Full Property Reference Tables

### A.1 Lucene index definition (all properties, canonical)

```
luceneIndex (oak:QueryIndexDefinition)
  - type (string) = 'lucene' mandatory
  - async (string|string[]) = 'async' mandatory
  - codec (string)
  - mergePolicy (string)                        [CODE, undocumented]
  - compatVersion (long) = 2
  - evaluatePathRestrictions (boolean) = false
  - valueRegex (string)
  - queryFilterRegex (string)
  - includedPaths (string[])
  - queryPaths (string[]) = ['/']
  - excludedPaths (string[])
  - tags (string[])
  - selectionPolicy (string)
  - maxFieldLength (long) = 10000
  - maxTagLength (long) = 100
  - maxSimilarityTagsCount (long) = 50
  - maxDynamicBoostCount (long) = 50
  - refresh (boolean)
  - useIfExists (string)
  - blobSize (long) = 32768
  - functionName (string)                        [deprecated @1.46]
  - name (string)                                [deprecated]
  - indexPath (string)                           [deprecated]
  - persistence (string) = 'repository'
  - path (string)                                [with persistence=file]
  - fulltextEnabled (boolean) = true              [CODE, undocumented]
  - deprecated (boolean)
  + indexRules (nt:unstructured)
  + aggregates (nt:unstructured)
  + analyzers (nt:unstructured)
  + facets (nt:unstructured)
  + suggestion (nt:unstructured)
  + tika (nt:unstructured)
```

### A.2 Indexing rule (`indexRules/<nodeType>`)

```
ruleName (nt:unstructured)
  - inherited (boolean) = true
  - indexNodeName (boolean) = false
  - nodeTypeIndex (boolean) = false               [CODE, undocumented]
  - includePropertyTypes (string[])
  - includePropertyNames (string[])               [CODE, undocumented]
  - excludePropertyNames (string[])               [CODE, undocumented]
  - orderedProps (string[])                       [CODE, undocumented]
  - scorerProviderName (string)                   [CODE/PRIVATE?, undocumented]
  - costPerExecution (double) = 1.0
  - costPerEntry (double) = 1.0                   (1.5 for V1 format)
  + properties (nt:unstructured)
```

### A.3 Property definition (`.../properties/<name>`)

```
propNode (nt:unstructured)
  - name (string)
  - boost (double) = 1.0
  - index (boolean) = true
  - useInExcerpt (boolean) = false
  - analyzed (boolean) = false
  - nodeScopeIndex (boolean) = false
  - ordered (boolean) = false
  - isRegexp (boolean) = false
  - type (string) = 'undefined'
  - propertyIndex (boolean) = false
  - notNullCheckEnabled (boolean) = false
  - nullCheckEnabled (boolean) = false
  - excludeFromAggregation (boolean) = false
  - weight (long) = 5
  - weightNull (long) = -1
  - weightNotNull (long) = -1
  - stats (string, JSON)                          {"common":{"value": pct}}
  - function (string)
  - dynamicBoost (boolean)
  - useInFullTextQuery (boolean)                  [with dynamicBoost, Elastic-relevant]
  - useInSimilarity (boolean)
  - similarityTags (boolean)
  - similarityRerank (boolean) = true
  - similaritySearchDenseVectorSize (long)         [CODE, undocumented]
  - facets (boolean)
  - useInSuggest (boolean)
  - useInSpellcheck (boolean)
  - sync (boolean)
  - unique (boolean)                              (requires sync)
```

### A.4 Property index (`/oak:index/<name>`, type=property)

```
propIndex (oak:QueryIndexDefinition)
  - type = 'property' mandatory
  - propertyNames (Name[]) mandatory, non-empty
  - declaringNodeTypes (Name[])
  - unique (boolean)
  - includedPaths (string[])
  - excludedPaths (string[])
  - valuePattern (string, regex)
  - valueIncludedPrefixes (string[])
  - valueExcludedPrefixes (string[])
  - entryCount (long)
  - keyCount (long)
  - reindex (boolean)
  - reindex-async (boolean)
  - useIfExists (string)
```

---

## Appendix B: How to Test Any of This Yourself

Two environments were used while writing this doc: this Oak trunk checkout (source reading, `mvn test`),
and a live AEM author instance at `http://localhost:4502` (admin/admin), bundled Oak **1.88.0**.

### Against a live AEM/Oak instance (no oak-run needed)

**Run any query (XPath or SQL-2)**, via CRXDE Lite's query servlet:
```bash
curl -s -u admin:admin -G "http://localhost:4502/crx/de/query.jsp" \
  --data-urlencode "_dc=1" --data-urlencode "path=/" \
  --data-urlencode "type=xpath" \
  --data-urlencode "stmt=/jcr:root/oak:index/*[@type='lucene']" \
  --data-urlencode "showResults=true"
```
`type` can be `xpath` or `JCR-SQL2`. **Do not** put `explain`/`measure` in `stmt` here — this endpoint
assumes every result row is a real JCR node and 500s on plan-only/measure rows.

**Get an actual query plan + full cost-calculation debug log** (this is the one that matters — it's the
same information as enabling DEBUG on `org.apache.jackrabbit.oak.query`, without touching log config), via
the AEM Operations "Query Performance" diagnostic tool's backing servlet:
```bash
curl -s -u admin:admin -X POST \
  "http://localhost:4502/libs/settings/granite/operations/diagnosis/granite_queryperformance.explain.json" \
  --data-urlencode "statement=/jcr:root/oak:index/*[@type='lucene']" \
  --data-urlencode "language=xpath" \
  --data-urlencode "executionTime=false" \
  --data-urlencode "resultCount=false" \
  --data-urlencode "_charset_=UTF-8"
```
Returns JSON with `explain.logs` (array of lines: XPath→SQL-2 conversion, per-index cost, chosen plan) and
`explain.plan`.

**Enumerate every index definition in the repository in one request** — `[CODE]` `[LIVE]`, and genuinely
Oak-native, not an AEM-specific tool: `oak-core` registers a standard Apache Felix `InventoryPrinter`
(`IndexDefinitionPrinter.java`, `felix.inventory.printer.name=oak-index-defn`), which the Felix Web
Console's status-page convention exposes on **any** Sling/Felix-based Oak deployment (AEM included) at:
```bash
curl -s -u admin:admin "http://localhost:4502/system/console/status-oak-index-defn.json"
```
This dumps every index definition's config (via `IndexPathService.getIndexPaths()`, so it also finds
**non-root** Lucene/Elastic indexes that a plain `/jcr:root/oak:index/*` query would miss) in the same
`nam:`/`str:`/`dat:`/`pat:`/`uri:` type-prefixed JSON encoding documented in §16's JSON File Format table
— hidden storage nodes (`:data`, `:index`) are excluded, so it's cheap even on a large repository. This is
the fastest way to get "every index definition a query could plausibly use" without guessing candidate
index names one at a time.

**Create/modify content or index definitions** via the Sling POST servlet:
```bash
curl -u admin:admin \
  -F"jcr:primaryType=oak:QueryIndexDefinition" -F"type=property" \
  -F"propertyNames=myProp" -F"propertyNames@TypeHint=Name[]" \
  http://localhost:4502/oak:index/myIndex
```
Nested structure in one request via relative-path field names
(`-F"indexRules/nt:base/properties/status/propertyIndex=true" -F"...@TypeHint=Boolean"`); read back with
`curl -u admin:admin http://localhost:4502/oak:index/myIndex.json` (add `.infinity.json` for full depth,
carefully — can be large).

**Delete**: `curl -u admin:admin -X DELETE http://localhost:4502/path/to/node`.

**Caveats**: Lucene/Elastic indexes are async — allow ~5-15s (poll) after a content or index-definition
change before querying. Property indexes are synchronous — visible immediately. Don't test against a
shared/production AEM instance without a disposable content namespace and a cleanup step.

`[GOTCHA — testing artifact, not an Oak bug]` the `crx/de/query.jsp` endpoint can return a **stale cached
empty result** (`{"results":[],"total":0,"success":true}`) for a perfectly valid query if you reuse the same
`_dc` cache-buster value across requests. Always generate a fresh one per call
(e.g. `--data-urlencode "_dc=$(date +%s%N)"`), or you'll chase a phantom "no results" bug that's actually
just HTTP caching.

### Against a plain Oak checkout (no AEM)

- `mvn test -pl oak-core -Dtest=<TestClass>` to exercise a specific parser/planner path directly.
- `oak-run console <repo>` for a JCR-shell-like experience against `SegmentNodeStore`/`DocumentNodeStore`,
  including `lc dump`/`lc info` for raw Lucene-file inspection with Luke.
- `oak-run json-index --script -` for the scripted-node/query REPL described in §16.

---

## Appendix C: Live Verification Log

This appendix is populated from AEM-instance testing runs performed while writing this doc (Oak 1.88.0).
Each entry lists the feature, the exact command, and the key evidence.

*(Live verification passes for property-index.md, lucene.md, and query-engine.md are complete as of this
revision — see the three sections below. Diff Indexes (indexing.md, requires Oak ≥ 1.92) remains code-verified
only, since the AEM instance used here bundles Oak 1.88.0; Elastic (elastic.md) likewise remains code-verified
only, since no Elasticsearch cluster/bundle was available in this environment.)*

### Property index `unique` (§3) — `[LIVE]` confirmed

```bash
curl -u admin:admin -F"jcr:primaryType=oak:QueryIndexDefinition" -F"type=property" \
  -F"propertyNames=aiUniqueVal" -F"propertyNames@TypeHint=Name[]" \
  -F"declaringNodeTypes=nt:unstructured" -F"declaringNodeTypes@TypeHint=Name[]" \
  -F"unique@TypeHint=Boolean" -F"unique=true" -F"reindex@TypeHint=Boolean" -F"reindex=true" \
  http://localhost:4502/oak:index/aiDocTestUniqueProp   # -> HTTP 201

curl -u admin:admin -F"jcr:primaryType=nt:unstructured" -F"aiUniqueVal=dup" http://localhost:4502/content/aiDocTest/uniq/a   # -> HTTP 201
curl -u admin:admin -F"jcr:primaryType=nt:unstructured" -F"aiUniqueVal=dup" http://localhost:4502/content/aiDocTest/uniq/b
# -> HTTP 500, Message: "org.apache.sling.api.resource.PersistenceException: Unable to commit changes to session."

# first-100-characters-only comparison, confirmed:
V1="$(python3 -c "print('x'*100 + 'AAA')")"; V2="$(python3 -c "print('x'*100 + 'BBB')")"
curl -u admin:admin -F"jcr:primaryType=nt:unstructured" -F"aiUniqueVal=$V1" http://localhost:4502/content/aiDocTest/uniq/d   # -> HTTP 201
curl -u admin:admin -F"jcr:primaryType=nt:unstructured" -F"aiUniqueVal=$V2" http://localhost:4502/content/aiDocTest/uniq/e   # -> HTTP 500 (collided on first 100 chars despite differing after char 100)
```
Both the basic uniqueness rejection and the "only the first 100 characters are compared" claim from
property-index.md are confirmed exactly as documented — this is a synchronous, immediate check (no async
wait needed), consistent with property indexes being sync by default.

### Superseding an Index (§9.2) — `[LIVE]` confirmed

```bash
# commit 1: create the old index, then the new one with supersedes+reindex
curl -u admin:admin -F"jcr:primaryType=oak:QueryIndexDefinition" -F"type=property" \
  -F"propertyNames=aiDocTestSupersedeProp1" -F"propertyNames@TypeHint=Name[]" \
  http://localhost:4502/oak:index/aiDocTestSupersede1

curl -u admin:admin -F"jcr:primaryType=oak:QueryIndexDefinition" -F"type=property" \
  -F"propertyNames=aiDocTestSupersedeProp2" -F"propertyNames@TypeHint=Name[]" \
  -F"supersedes=/oak:index/aiDocTestSupersede1" -F"supersedes@TypeHint=String[]" \
  -F"reindex=true" -F"reindex@TypeHint=Boolean" \
  http://localhost:4502/oak:index/aiDocTestSupersede2

# check immediately: index1 still type=property
curl -u admin:admin http://localhost:4502/oak:index/aiDocTestSupersede1.json
# => {"type":"property", ...}   <-- NOT yet disabled

# commit 2: any trivial follow-up save
curl -u admin:admin -F"aiDocTestTouch=1" http://localhost:4502/oak:index/aiDocTestSupersede2

curl -u admin:admin http://localhost:4502/oak:index/aiDocTestSupersede1.json
# => {"type":"disabled", ...}   <-- disabled only now, confirming the 2-commit mechanism
```

### Query options (§11) — `[LIVE]` confirmed

- `option(traversal ok|warn|fail|default)`: all four confirmed. `fail` on a genuinely-traversing query
  produces `IllegalArgumentException: Traversal query (query without index): ...; consider creating an
  index`; `ok`/`warn`/`default` all execute normally.
- `option(limit N, offset M)`: confirmed correct pagination in both XPath and SQL-2 against
  `/jcr:root/oak:index/*` (28 children) — `option(limit 5)` and `option(offset 5, limit 5)` sliced exactly
  as expected, identically in both grammars.
- `union` / `union all`: confirmed dedup semantics — `(a|a)` (same filter twice) and `X union X` both
  collapsed to one result; `X union all X` returned two (no dedup), in both XPath and SQL-2.
- XPath→SQL-2 transform logging: confirmed `explain.logs` reliably contains both the
  `Parsing xpath statement: ...` and `XPath > SQL2: ...` lines exactly as query-engine.md describes.
- `LIKE`/`jcr:like` wildcard effect on index usage: confirmed — `[jcr:path] like '/oak:index/uu%'` picked an
  indexed/constrained plan, while a **leading**-wildcard `[jcr:path] like '%uuid'` fell back to
  `traverse / allNodes (warning: slow) estimatedEntries: 174180.0` — matches the "leading wildcard forces
  non-index evaluation" claim exactly.
- `coalesce`/`fn:coalesce`: confirmed working in both dialects,
  `coalesce(a.[nonExistentProp], a.[type]) = 'lucene'` and the XPath equivalent both returned the expected
  21 `type=lucene` index definitions.
- `[GOTCHA]` **AEM's "Query Performance" diagnostic tool does not expose the JCR `EXPLAIN MEASURE`/`MEASURE`
  keyword's `selector`/`scanCount` row format** described in grammar-xpath.md/grammar-sql2.md. Its
  `resultCount=true`/`executionTime=true` params return a different, tool-specific `heuristics` object
  (`count`, `countTime`, `executionTime`, `getNodesTime`, `totalTime`) — useful, but not the same feature.
  To exercise real `MEASURE` semantics, use the JCR API (`Query.execute()` on a query built with `measure`
  prepended) or `oak-run`, not this particular AEM tool.
- `option(index tag <name>)`: an earlier pass on a throwaway *property* index looked inconclusive (index
  never appeared in the cost log at all, tagged or not). A follow-up pass on a *Lucene* index resolved it —
  see item 9 in the Lucene features table below: `tags` + `selectionPolicy=tag` + `option(index tag ...)`
  all confirmed working exactly as documented (an untagged/unpolicy'd index is costed normally; a
  `selectionPolicy=tag` index is excluded from consideration entirely until the matching tag option is
  supplied). The earlier property-index oddity was most likely a `refresh=true`/timing artifact specific to
  that one run, not a reproducible product issue.

### Lucene index features (§4) — `[LIVE]` confirmed (Oak 1.88.0)

All tested under `/content/aiDocTest/lucene/*` content and `/oak:index/aiDocTestLucene*` index definitions
(cleaned up afterward). Async wait of ~10-30s applied between index/content changes and querying.

| # | Feature | Result |
|---|---|---|
| 1 | Basic `propertyIndex=true` equality | PASS — `explain` cost for the custom index was `1.00` vs OOTB `ntBaseLucene` `4.00` and `traverse` `2000.0`; real query matched after the async cycle. |
| 2 | Fulltext (`analyzed`+`nodeScopeIndex`) | PASS — `jcr:contains(., 'fulltextneedle')` matched. |
| 3 | `ordered=true`+`type=Date`, incl. one unparseable value | PASS with a correction to the public doc's wording — see §4.4 above; the bad-value node sorted **first** (ascending) with an `UNDEFINED` sort-key plan entry, it was not dropped from the result. |
| 4 | `evaluatePathRestrictions` | PASS — every plan folded the path natively into the Lucene query (`+:ancestors:<path>`), no separate post-filter. |
| 5 | `indexNodeName` | PASS — `name()='kite'` matched via the node-name index. |
| 6 | Aggregation (`nt:file` → `jcr:content`) | PASS — `contains(., 'uniqueaggregatekeyword')` on `element(*, nt:file)` matched text stored only on the child `jcr:content` node. |
| 7 | Facets | PASS (query executes cleanly against a `facets=true` property; the CRXDE query endpoint returns raw rows, not facet-count JSON, so facet *counts* specifically weren't independently re-derived here). |
| 8 | Function-based indexing (`fn:lower-case(@prop)`) | PASS — matched a mixed-case stored value case-insensitively; plan showed the native `function*lower*@prop` Lucene query term. |
| 9 | `tags` + `option(index tag)` + `selectionPolicy=tag` | PASS — without the tag option, only the plain-tagged index appeared in the cost log at all; the `selectionPolicy=tag` index was **absent from consideration entirely** (not merely high-cost) until the matching `option(index tag ...)` was supplied, at which point both indexes were costed. Confirms `selectionPolicy=tag` indexes are opt-in-only, exactly as documented. |
| 10 | `includedPaths`/`queryPaths` mismatch — **FAIL, real doc bug, not just a wording nit** | An index with `includedPaths=["/basic"]` was still selected (cost `4.00`, beating traverse's `2000.0`) for a query scoped to a **sibling path it does not index** (`/outside`), and the query returned `total:0` even though a matching node genuinely exists under `/outside`. The cost estimator does not check `includedPaths` against the query's path restriction; correctness for out-of-scope paths depends entirely on `evaluatePathRestrictions` also being `true` so the Lucene query itself carries a `:ancestors:` term that happens to match zero docs. **Without both `includedPaths`/`queryPaths` alignment and `evaluatePathRestrictions=true` together, a scoped index can be silently selected for, and silently drop results from, a path it was never meant to cover.** Repro: `explain` a query under an out-of-scope path against a narrowly-scoped index and check whether the plan cites that index with a finite (non-`Infinity`) cost; then run the query for real and confirm it wrongly returns fewer rows than exist. |
| 11 | Function-based indexing, query-side syntax | **PASS, with a language-specific gotcha not in lucene.md.** The `function` property's value (e.g. `"fn:lower-case(@myProp)"`) is XPath function syntax regardless of query language. Querying in **JCR-SQL2** with the XPath form (`fn:lower-case([myProp])='hello'`) throws a `ParseException` — SQL2 callers must use the SQL2-function form instead (`lower([myProp]) = 'hello'`). XPath queries use `fn:lower-case(@myProp) = 'hello'` directly. Both forms hit the same index (plan shows `function*lower*@myProp` either way) and both support `order by`/`ORDER BY` on the same function. |

### Query plan / explain endpoint — `[LIVE]` confirmed working, sample output

```bash
curl -s -u admin:admin -X POST \
  "http://localhost:4502/libs/settings/granite/operations/diagnosis/granite_queryperformance.explain.json" \
  --data-urlencode "statement=/jcr:root/oak:index/*[@type='lucene']" \
  --data-urlencode "language=xpath" --data-urlencode "executionTime=false" \
  --data-urlencode "resultCount=false" --data-urlencode "_charset_=UTF-8"
```
Response included, per out-of-the-box index, lines like:
```
cost for [/oak:index/ntBaseLucene] of type (lucene-property) with plan [lucene:ntBaseLucene
    indexDefinition: /oak:index/ntBaseLucene
    estimatedEntries: 303
    luceneQuery: +(+:ancestors:/oak:index +:depth:[2 TO 2]) +type:lucene
    propertyCondition: type lucene
] is 304.00
cost for traverse is 1074.0
```
confirming: cost-based selection across multiple candidate Lucene indexes really does happen per-query
(here, `ntBaseLucene` at cost 304 beat traversal at cost 1074, and beat the dedicated `property`/`nodeType`/
`reference` indexes which all returned `Infinity` for this filter) — matches §10's description exactly.

[pub-qe]: https://jackrabbit.apache.org/oak/docs/query/query-engine.html
[pub-xp]: https://jackrabbit.apache.org/oak/docs/query/grammar-xpath.html
[pub-sql2]: https://jackrabbit.apache.org/oak/docs/query/grammar-sql2.html
[pub-idx]: https://jackrabbit.apache.org/oak/docs/query/indexing.html
[pub-lucene]: https://jackrabbit.apache.org/oak/docs/query/lucene.html
[pub-elastic]: https://jackrabbit.apache.org/oak/docs/query/elastic.html
[pub-prop]: https://jackrabbit.apache.org/oak/docs/query/property-index.html
[pub-hybrid]: https://jackrabbit.apache.org/oak/docs/query/hybrid-index.html
[pub-oakrun]: https://jackrabbit.apache.org/oak/docs/query/oak-run-indexing.html
