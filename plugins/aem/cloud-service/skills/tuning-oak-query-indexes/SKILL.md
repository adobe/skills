---
name: tuning-oak-query-indexes
description: Use when a Jackrabbit Oak/AEM JCR query is slow, logs a traversal warning, or you're adding/changing a query and need to check or update its property/Lucene/Elastic index definition so the query is answered by the index instead of in-memory filtering or sorting.
license: Apache-2.0
compatibility: Any Jackrabbit Oak-backed repository (AEM 6.5 LTS/AMS or AEM as a Cloud Service) using property, Lucene, or Elastic query indexes.
---

# Tuning Oak Query Indexes

## Overview

An Oak query only uses an index for the parts the index actually covers. Any `WHERE`/`ORDER BY`/fulltext
field without a matching, correctly-flagged property definition gets evaluated node-by-node in memory —
same for a wrong nodetype or path scope, **even if every field is indexed**. This skill is the procedure
for finding exactly which fields/conditions aren't covered and what index-definition change fixes each
one.

**Ground truth for every claim below**: `ai-agent-indexing-guide.md`, bundled in this skill's own
directory (`.claude/skills/tuning-oak-query-indexes/ai-agent-indexing-guide.md`) so this skill works the
same way regardless of which codebase it's copied into. Read it on demand for exact property tables,
defaults, cost-model details, and edge cases — this skill is the checklist, not the reference.

**This skill assumes nothing about the codebase it's used in beyond "you have a query and an index
definition."** It does not require an AEM instance, a running Oak repository, or a checkout of Oak's own
Java source — those only *strengthen* confidence where noted (step 6 and the "explain can't reach this"
fallback below), never a requirement; the core procedure — read the query, read the index definition, find
the gap, propose the fix — works from the two artifacts alone. Index definitions in a
real project are often FileVault XML (`.content.xml` under an `/apps/.../install` content package,
`jcr:primaryType="oak:QueryIndexDefinition"` and friends), not raw JSON — read them the same way; the
property names and semantics are identical, only the serialization differs.

## Procedure

**Preconditions**: steps 1 and 6 below both mention live-instance tools (`explain`, the Felix
`InventoryPrinter`, Oak's trunk test suite) — neither is required. If you only have the query text and the
index definition(s), skip those tools' sub-bullets, do steps 2-5 and 7 as pure static analysis, and report
per the final section with verification stated as reasoned-but-unproven.

1. **Get the query and every index definition it could plausibly use** — not just the one you assume
   applies. **If you don't already have the query in hand** — e.g. asked to audit a whole app/bundle rather
   than tune one query someone handed you — use the `extracting-jcr-queries` skill first to find every
   JCR/QueryBuilder query the codebase actually issues (including ones assembled programmatically through
   wrapper/helper/DAO code, which a text grep alone misses); its output (construction site + every
   trigger/caller path) is the input to this skill's assessment, one query at a time. **If no live instance
   is reachable, work from every index definition you were actually given**
   and say so in the report (§ Report shape) — candidate selection is then reasoned, not confirmed. If a
   live instance *is* reachable, `explain` tells you which index actually gets picked, which is stronger
   than reasoning from the definitions alone; to enumerate every index definition in the repository
   (including non-root ones a per-path lookup would miss), use the Felix `InventoryPrinter` status page
   `oak-core` itself registers — it works on any Sling/Felix-based Oak deployment, not just AEM:
   `GET /system/console/status-oak-index-defn.json` (admin auth). It dumps every index definition (config
   only, no hidden `:data`/`:index` storage nodes) in the same `nam:`/`str:`/`dat:`/... type-prefixed JSON
   encoding oak-run's `--index-definitions-file` uses — one request beats guessing candidate index names
   one at a time.
2. **Segregate every query into two sections before analyzing anything** — Section A (static fields) and
   Section B (dynamic fields):
   - **Section A — static fields**: the property *path/name* the query filters, orders, or searches on is
     fixed in source — a literal string or a named constant — even if the *value* compared against it
     varies at runtime (a caller-supplied ID, a loop variable, a request parameter used only as a value).
     A query stays in Section A as long as you can point at the exact `WHERE`/`ORDER BY` field name without
     guessing.
   - **Section B — dynamic fields**: the property *path/name itself* is not fixed in source — it comes from
     OSGi config (`detectMetadataField`-style properties), a request/predicate-map key, a content-authored
     query (`dam:query` nodes, Smart Collections), or a script/native query string. You cannot state which
     property the index needs to cover without external input.
   **Assess Section A fully — that's the primary deliverable.** For Section B, do **not** guess the likely
   or default field name and assess that guess as if it were the query's real target. Instead, list each
   Section B query with the specific missing input (e.g. "OSGi config value of `detectMetadataField`",
   "the `type` request parameter passed to this servlet") and ask the user for it. Only fold a Section B
   query into a real assessment once the user supplies the concrete field name(s) it actually uses in their
   deployment — treat that answer the same as a Section A fact from that point on.

   | Excuse to assess anyway | Reality |
   |---|---|
   | "The default value is probably X, I'll note the caveat" | A caveated guess still reads as an assessment and gets acted on as one — if the deployment overrides the config, the whole coverage table is wrong. State the missing input and stop instead of assessing the default. |
   | "Partial assessment is still useful" | Partial-but-wrong is worse than no assessment — it's indistinguishable from a verified finding in the report. Segregate it into Section B and ask. |
   | "I already covered the default case in Technique 1" | Knowing the *default* is not the same as knowing the *configured* value. Confirm before assessing, don't infer. |
   | "Asking breaks the flow of the report" | The report is still complete — Section A stands on its own. Section B becomes assessable the moment the user answers. |
3. **Extract every field/construct the query touches**: `WHERE` equality/range/`IN`/`IS NULL`/
   `IS NOT NULL`, `ORDER BY` columns, `contains(...)`/fulltext, `rep:facet`/`rep:similar`/`rep:suggest`/
   `rep:spellcheck`, path restriction (`ISDESCENDANTNODE`/`//`), and the query's own nodetype restriction
   (`FROM [type]` / XPath `element(*, type)`).
4. **For each field, look up the required flag** (table below) and check the index has a property
   definition with a matching `name` carrying it.
5. **Check the two scoping gotchas before anything else** — these skip the index entirely regardless of
   how well the fields are indexed, and are the most common reason an apparently-correct index isn't
   picked:
   - **Nodetype scoping**: does the query's own `FROM`/`element()` restriction name the index's declared
     type (or a subtype)? If the query is unrestricted (bare `*` / implicit `nt:base`) but the index only
     declares rules for one type (`declaringNodeTypes` on a property index, or `indexRules` not including
     `nt:base` on Lucene/Elastic), the index is invisible to the planner — cost `Infinity`, or absent from
     the candidate list entirely. Fix by adding the nodetype restriction to the query, not by changing the
     index.
   - **Path scoping** (Lucene/Elastic only): do `includedPaths` and `queryPaths` match each other, and
     does the query's actual path restriction fall inside them? Leaving `queryPaths` at its default (`/`)
     while narrowing only `includedPaths` is worse than not being selected — the index gets picked outside
     its real coverage and silently returns fewer results than actually exist.
6. **Verify empirically, don't just reason from the spec.** Run `explain <query>` (or the AEM Query
   Performance tool). Confirm: (a) the expected index appears in the candidate/cost log at all, (b) its
   cost beats every alternative including traversal, (c) the plan shows no `traverse` and no unindexed
   residual condition for a field you believe is covered. **A finite cost does not by itself prove a given
   condition is served natively** — live-confirmed: an index selected at a normal-looking finite cost
   (beating traversal, due to nodetype/path scoping alone) had a plan whose actual `luceneQuery` was a bare
   `*:*`, meaning an equality condition on an unindexed property was still being evaluated as a residual
   in-memory filter, not pushed into the index at all. Always read the logged `luceneQuery`/plan text
   itself for the specific field you care about, not just whether *some* index got a finite cost.
   - **`explain` only tells you which index and cost/plan get picked — it says nothing about whether a
     feature that doesn't work through the cost-plan mechanism actually behaves correctly**: suggestions
     (`rep:suggest`), spellcheck (`rep:spellcheck`), facet *counts* (vs. just "the query ran"), similarity
     ranking (`rep:similar`/feature vectors), and raw native-query strings (`rep:native`) all fall in this
     category. For these, don't rely on a live instance + a short wait (suggestions rebuild on a real
     10-minute interval by default — a short wait just produces a false "it doesn't work"). Two ways to get
     real signal, in order of how likely they are to be available:
     - **Portable, works in any codebase with a reachable Oak/AEM instance**: dump the effective index
       definition via the Felix `InventoryPrinter` status page (`GET /system/console/status-oak-index-defn.json`
       on any Sling/Felix-based Oak deployment — see step 1) and confirm the feature's own config flag is
       actually set (`useInSuggest`, `useInSpellcheck`, `facets`, `useInSimilarity`) and that the index
       definition is the *effective* one (§4.9's `refresh`/reindex distinction — a flag that "looks" set in
       the saved node may not be live yet). Cross-check the relevant `IndexStatsMBean` (`LastIndexedTime`,
       `Status`, `Failing`) to rule out a stuck or corrupt async lane. This narrows most "it doesn't work"
       reports to either a genuine timing issue (wait longer/re-check after a real rebuild cycle) or a
       config flag that's missing/not yet effective — without needing to run anything.
     - **Deterministic, but only if you're working inside an actual checkout of Oak's own Java source**
       (rare outside the Oak project itself — check for a Maven `pom.xml` and an `oak-lucene` module before
       assuming this is available; a typical AEM application/content project does **not** have this): run
       the matching unmodified Oak test (`mvn test -pl oak-lucene -Dtest=<Class>#<method>`, needs JDK 17)
       — `SuggestTest`/`SpellcheckTest` (`oak-lucene/.../jcr/query/`), `FacetTest` (asserts real
       `FacetResult.getCount()` values), `LucenePropertyIndexTest` (boost, aggregation-exclude, similarity
       feature-vectors — grep it for the property/flag name), `LuceneDynamicBoostTest`. These give a
       deterministic pass/fail in seconds and often show you the *exact* test setup a feature needs (e.g.
       `SuggestTest` sets `suggestUpdateFrequencyMinutes: 0` specifically to make the suggester rebuild fast
       enough to test).
     If neither is available, say so plainly in the report and reason from the bundled reference doc's
     documented defaults instead of guessing.
7. **Identify the single existing index the fix belongs on before writing any change.** Never invent a
   brand-new index or silently pick one of several plausible candidates — the target index changes the
   whole recommendation (which properties it already has, its current tags/weight/reindex history), so
   getting it wrong makes step 8's "corrected index definition" wrong too.
   - **Live instance reachable**: run `explain` on the query as-is (even though you expect a gap — the
     candidate list and per-index cost the response returns is exactly what's needed here, not just a
     pass/fail). `explain`'s response enumerates every candidate index it considered with its cost, not
     just the winner — read that list, not just the top line. The lowest-cost index that also matches the
     nodetype/path scoping from step 5 is the target. State the cost numbers you read, not just the index
     name, so the choice is checkable.
   - **No live instance**: enumerate every index definition you were given whose nodetype+path scoping
     (step 5) matches the query — these are the only real candidates regardless of how many index files
     exist in the repo. Then:
     - **Exactly one candidate matches** → that's the target, proceed.
     - **Zero candidates match** → there is no existing index to extend; say so explicitly and propose a
       new index only as a last resort (this is the one case where inventing an index is correct, and it
       still needs to be called out as such, not presented as "the fix" silently).
     - **More than one candidate matches (contending indexes)** → do **not** silently pick one — this is
       exactly the "a property IS indexed, but a *different*, cheaper index still wins" mistake from the
       list above, except now you're the one choosing without the cost data `explain` would have given you.
       Present the contenders side by side — for each: which of the query's fields it already covers,
       its `tags`, `weight` (if set), `includedPaths`/`queryPaths`, and how narrowly it's already scoped —
       and ask the user which index they want the change applied to. Do not propose a corrected definition
       for any of them until the user picks one.
8. **Propose the smallest fix** that gives every field its required flag. Prefer one cohesive index per
   nodetype over several overlapping single-purpose ones. Set `reindex: true` for the change, **not**
   `refresh: true`, unless you can positively confirm **no existing content already carries the
   new/changed property's value** — `refresh: true` only makes a new property definition *plannable*
   (explain will show it as a candidate); it does **not** backfill pre-existing documents that already had
   the value before the definition existed. Live-confirmed: a property added with `refresh: true` alone
   showed up in `explain` immediately, but a real query for a pre-existing document's value returned zero
   results until a genuine `reindex: true` ran. If you can't be certain the property is genuinely new to
   every document, reindex. **Before changing the index, check whether tightening the *query*
   gets you further for less cost** — a more constrained query is always cheaper and safer than a broader
   index, in this order of preference:
   1. Add/narrow a nodetype restriction (`element(*, T)` / `FROM [T]`) — the single highest-leverage change;
      see the nodetype-scoping gotcha above. Never use a bare `*`/`nt:base` restriction if the real target
      type is known.
   2. Add/narrow a path restriction (`ISDESCENDANTNODE`/`//` scoped as tightly as the use case allows) —
      shrinks both the traversal fallback cost and, if the index is path-scoped, keeps it eligible.
   3. Add/tighten property conditions (more selective equality/range conditions push more work into the
      index and reduce what's read out of it).
   Only after the query is as constrained as the use case genuinely allows should the index definition
   itself be widened — widening the index is the more expensive, more permanent change (more storage, more
   indexing time, affects every other query that hits it), while tightening the query text is free and
   query-request-local.
9. **Re-verify with `explain`** after applying the change (and after the async cycle, if applicable) —
   confirm no residual/in-memory filtering remains, and any `ORDER BY` is served by the index, not a full
   in-memory sort.

## Field construct → required index flag

| Query construct | Property index (`type=property`) | Lucene/Elastic property definition |
|---|---|---|
| Equality / `IN` | in `propertyNames` | `propertyIndex: true` |
| `IS NOT NULL` | in `propertyNames` (property index has no dedicated existence-only flag) | `propertyIndex: true`, **or** the cheaper `notNullCheckEnabled: true` alone if you never need equality/range/ordering on the value — see the cost note below |
| `IS NULL` | n/a — no mechanism exists for `type=property` | `nullCheckEnabled: true` (standalone, `propertyIndex` not required) |
| `ORDER BY` | not supported | `ordered: true` + explicit `type` |
| `contains(prop, ...)` | not supported | `analyzed: true` |
| `contains(., ...)` (node-scope) | not supported | `analyzed: true` + `nodeScopeIndex: true` on every contributing property |
| `rep:facet` | not supported | `facets: true` |
| Range (`<`,`>`,`<=`,`>=`) | works if in `propertyNames` | `propertyIndex: true` + explicit `type` |
| Relative property (`a/b/@c`) | not supported | `name: "a/b/c"` |
| Function (`lower(...)`, `name()`, `path()`) | not supported | `function: "..."` + `propertyIndex`/`ordered` as needed |

**Always set an explicit `type`** (`Date`/`Long`/`Double`) on any property used in `ORDER BY` or a range
condition — without it, values can be compared lexicographically (numeric-looking strings sort
`"1","10","2"`; unparsed dates sort *before* all valid ones instead of erroring or being excluded).

## Index size / storage cost pitfalls

Every fix in this skill makes a query faster by making the index cover more. That's not free — always
surface the tradeoff when a proposed change triggers one of these, don't just add the flag silently:

| Enabling this... | ...costs this |
|---|---|
| `nodeScopeIndex` on **any** property in a rule | Indexes the **node name** for every node matching that rule, not just the boosted property — large for broad rules like `nt:base`. Scope the rule to the narrowest real nodetype before turning this on. |
| `evaluatePathRestrictions` | Slight but real per-document storage increase (stores ancestor-path terms). Only enable on indexes that actually need native path-restriction evaluation (§4.2's `queryPaths` correctness case), not by default. |
| `ordered` on a property | Increases index size (doc-values field per ordered property). Intended for single-valued properties only — but enabling it on a multi-valued one does **not** hard-fail: it just logs a `WARN` and skips the doc-values field for that document, so `ORDER BY` silently degrades to an unpredictable position for multi-valued documents instead of erroring. Only mark properties `ordered` that a real `ORDER BY` actually uses, and don't rely on a hard failure to catch a multi-valued mistake — check your data. |
| Many properties in one broad index "just in case" | Bigger index, slower indexing, and — per the nodetype/path scoping gotchas above — no selection benefit if the query doesn't ask for them. Prefer narrow, cohesive indexes over one large catch-all. |
| A single Lucene index approaching **~2^31 documents** | Hard ceiling in the Lucene version Oak ships — the index can stop being openable past this. Split into multiple narrower (nodetype- or path-scoped) indexes, or use Elastic, which doesn't have this limit (Solr used to be the other escape hatch; it was removed in Oak 1.82). |
| Long text values with no `maxFieldLength` override | Only the first ~10000 terms per field are indexed by default — a large document field is silently truncated, not indexed in full, which can produce fulltext misses on content past that boundary. |
| `propertyIndex: true` used purely for `IS NOT NULL`/`IS NULL`, with no equality/range/ordering ever needed | Wastes storage — `propertyIndex` indexes every distinct *value* as its own term in a dedicated field. `notNullCheckEnabled`/`nullCheckEnabled` alone (no `propertyIndex` needed) do the same existence check via one lightweight, unstored term in a *shared* field across the whole index (`:notNullProps`/`:nullProps`) — genuinely cheaper, live-confirmed to work standalone. The flip side: `nullCheckEnabled` on a broad/generic nodetype where the property is rarely set can itself create an entry for nearly every document (an entry per node *without* the value) — scope it to a narrow nodetype. |

**The general principle**: the more constrained a query is, the cheaper and safer it is to serve — a
query naming a specific, narrow nodetype and path is always preferable to a broad `nt:base`/unscoped one,
independent of whatever the index does. Recommend query tightening first (step 8) before recommending an
index that has to compensate for an unnecessarily broad query.

## Common mistakes (each one live-verified during this skill's development)

- Query has no nodetype restriction → a nodetype-scoped index is skipped entirely, not just deprioritized.
- `includedPaths` set without matching `queryPaths` → wrong index selected outside its real coverage,
  silently returns fewer results than exist — no error, no warning.
- `sync`/`unique` on a Lucene property definition, but the index's own `async` is still a single string
  (not `["async","sync"]`/`["async","nrt"]`) → silently never synchronous, never enforced.
- A property IS indexed, but a *different*, cheaper index still wins → check `weight` (lower = cheaper,
  default `5`), and re-check the scoping gotchas above on the index you expected to win.
- Indexing many unrelated properties into one index "just in case" → prefer one cohesive index per
  nodetype; overlapping indexes with different `includedPaths`/`excludedPaths` for the same nodetype cause
  ambiguous selection.
- `rep:facet`/`rep:similar` hit the nodetype-scoping gotcha too — `rep:facet` fails with a hard exception
  (`"... can't be evaluated by traversal"`) instead of silently falling back like plain fulltext. **This
  only happens when the query actually runs** — `explain` on the same query does not throw; it returns a
  normal success with a `traverse`/`estimatedEntries: Infinity` plan, easy to misread as "fine, just slow."
  Don't trust `explain` succeeding as proof a `rep:facet` query works — run it for real, or treat an
  `Infinity`-cost traverse plan on a facet query as an early-warning sign it will fail at execution.
- A raw `rep:native('idx', 'field:value')` query string silently matches nothing if `field` is an
  `analyzed` property — its real Lucene field name is `full:field` (escape the colon:
  `full\:field:value`), not the bare JCR property name. Only non-analyzed (`propertyIndex`-only) fields
  use the bare name. Root-caused via `FieldNames.ANALYZED_FIELD_PREFIX` and live-confirmed side by side
  (unescaped form: 0 results; `full\:`-escaped form: correct match, same index/content) — this is the
  single most common reason a native query "doesn't work" despite a correct-looking `explain` plan.

## Report shape

Structure the report in the two sections from step 2 — never merge them:

### Section A — static fields (assess fully)

For every Section A query, produce:

1. A table: field/construct → covered? → what's missing.
2. Root cause per uncovered field (which failure mode from the table/mistakes above — including the two
   scoping checks, even when they pass).
3. Whether the query itself can be more constrained first (nodetype, then path, then property conditions —
   see step 8) — call this out even if the eventual answer is "no, it's already as narrow as the use case
   allows."
4. Which index the fix targets and why (step 7): the `explain`-confirmed candidate list with costs, or the
   single statically-matched candidate, or — if multiple indexes contend and no live instance was
   available to break the tie — the side-by-side contender comparison and a question to the user asking
   which one to change, with no corrected definition given for any of them until they answer.
5. The corrected index definition (full JSON or content diff) for the index identified in item 4, with a
   one-line justification per change, **and the storage/size tradeoff called out explicitly** for any
   change that triggers one of the pitfalls above (don't let a size cost pass silently just because it
   fixes the query).
6. The `explain` command to run to verify, and what a passing result looks like — but if no live Oak
   instance is available, say so plainly and present the static analysis as reasoned-but-unproven rather
   than skipping verification silently.

### Section B — dynamic fields (ask, don't assess)

For every Section B query, list the construction site and the exact missing input (named OSGi property,
request parameter, config key, or "arbitrary content-authored query — no fixed field exists"), then ask the
user for it. Do not include a coverage table, root cause, or corrected index definition for a Section B
query until the user supplies the concrete field name(s) — at that point re-run steps 4-9 on it and move it
into Section A's report format for that query.
