# Recipe — unbounded query

> Read this fully before editing. Control plane: [SKILL.md](SKILL.md).

## Cardinal rule

`p.limit=-1` (or `setLimit(-1)`) means **the caller asked for every row**. Lowering it to a fixed
bound is **not** behaviour-neutral — if the real result exceeds the cap, rows are silently dropped
(wrong counts, truncated lists/UI). So **never silently cap a result the caller reads in full.**
Bounding is the *exception* (only where capping is provably safe); **escalation to a human is the
default** when you cannot prove it. When in doubt, do not edit — record `needs-pagination`.

## Input contract

Per invocation, a deduplicated list of findings — each an explicit unbounded marker the analyzer flagged:

```json
{
  "findings": [
    {
      "pattern": "unbounded-query",
      "file": "core/src/main/java/com/example/core/search/UnboundedQuery.java",
      "line": 11,
      "snippet": "params.put(\"p.limit\", \"-1\")"
    }
  ]
}
```

Sources:

1. **User-named** — the user names the Java file(s) directly.
2. **Discover** — the file/line list is the output of the **Discovery** scan in [`SKILL.md`](SKILL.md).

The `snippet` tells you which marker it is (`put("p.limit", "-1")` predicate vs `setLimit(-1)` call);
how the **result is consumed** decides the action — read the surrounding method to classify it.

## Triage — classify each finding, then act

| Call-site shape | How to recognise | Action | Disposition |
|---|---|---|---|
| **Single-result** | **all four hold** (see gate below): result consumed in the same method, first hit only, no count read, no reorder before selecting | bound → **1** | apply |
| **Already-bounded list** | caller shows a top-N / already pages elsewhere | bound → **N** (the size it shows) | apply |
| **Iterate-all, local + simple** | query build + result loop in **one** method; a stable sort exists; no post-query filtering | wrap in an offset loop (below) | apply (mark *review*) |
| **Iterate-all, request path** | cross-method query/consume, post-query filtering, aggregate/count, or no stable sort | **do not edit** | skipped: `needs-pagination` |
| **Off-request migration / batch** | export/migration/maintenance job, not request-serving | skip | skipped: `bound-changes-correctness` |
| **Test code** | path under `src/test/` | skip | skipped: `test-scope` |

If a site matches more than one row, take the **most conservative** (a skip beats an edit). If you
cannot confidently place a site, treat it as **Iterate-all, request path** → `needs-pagination`.

## Per-branch edits

### Single-result → bound to 1

This is the only branch that edits a request-path query without escalating, so the bar is high.
Apply `→1` **only if ALL FOUR hold** — otherwise the call is *not* provably single-result, so
escalate it as `needs-pagination` instead:

1. **Local consumption** — the `SearchResult` / hits is consumed entirely in this method. It is **not**
   returned, stored in a field, or passed to another method/lambda (you cannot see how those would
   iterate it).
2. **First hit only** — exactly one hit is read via an unconditional `.get(0)` / single `.next()` /
   `getFirstResource()`. No loop, no conditional re-read.
3. **No count** — the method does not read `getTotalMatches()` / `getHits().size()` for a displayed
   or logic count (limit 1 would make it report 1).
4. **No reorder** — the hits are not sorted / min-max'd / "best of"-selected before taking the first
   (limit 1 returns an arbitrary single row; "first hit" must equal the intended pick).

When all hold, the result the caller wants is unchanged — capping to 1 only stops the engine
materialising the rest:

```java
// QueryBuilder predicate
params.put("p.limit", "1");
// JCR
query.setLimit(1);
```

If any condition is uncertain, do not cap — escalate. Verifying these across methods is exactly the
analysis a parse-level tool cannot guarantee, so when in doubt the human pagination decision wins.

### Already-bounded list → bound to N

Use the size the caller actually renders (the UI's page size / top-N), not a guess:

```java
params.put("p.limit", "10");   // N = the list length the component shows
```

### Iterate-all, local + simple → offset loop

Only when the whole query+consume lives in one method, has a deterministic sort, and applies no
post-query filter. `p.guessTotal=true` reports the full count without materialising every hit.

```java
int offset = 0, page = 100;
boolean more = true;
while (more) {
    params.put("p.limit", String.valueOf(page));
    params.put("p.offset", String.valueOf(offset));
    List<Hit> hits = queryBuilder.createQuery(PredicateGroup.create(params), session)
            .getResult().getHits();
    for (Hit hit : hits) { /* existing per-hit logic */ }
    more = hits.size() == page;
    offset += page;
}
```

JCR equivalent: `query.setLimit(page); query.setOffset(offset);` inside the same loop. Mark the
finding *applied — review*: a generated loop must be read by the developer for ordering and
off-by-one correctness.

## Skip / escalation reasons

Record every non-edit as `skipped` with the exact reason (never silently drop):

```
needs-pagination: <file>:<line> result consumed in full on the request path — needs offset paging (human decision: page size + a stable sort)
bound-changes-correctness: <file>:<line> off-request job needs the full set — run as a paged batch job
test-scope: <file>:<line>
not-a-query-limit: <file>:<line> setLimit/put is on an unrelated API, not a query
```

`needs-pagination` is the **expected common outcome** for request-path iterate-all sites — it is a
successful triage result, not a failure. Surface it in the report so a human can add paging or make a
deliberate cap decision.

## Per-finding edit procedure

For each finding (grouped by file):

1. Read the method around `line`. Classify the site against the **Triage** table — base it on how the
   result is consumed, not just the marker.
2. **Skip / escalate** branches: record the reason, edit nothing, move on.
3. **Single-result / already-bounded**: replace the `-1` with `1` / `N` — only that token.
4. **Iterate-all local + simple**: apply the offset loop; mark *applied — review*.
5. Write the file back. Never partially edit a method you could not classify.

After all files are processed, continue the Verify & summarize step in [`../references/runbook.md`](../references/runbook.md).

## Examples

**Single-result — apply `→1`** (`getComponentNode` reads only the first hit):

```java
// before
params.put("p.limit", "-1");
SearchResult result = queryBuilder.createQuery(PredicateGroup.create(params), session).getResult();
return result.getHits().get(0).getResource();
// after — p.limit "1"; the rest unchanged
params.put("p.limit", "1");
```

**Iterate-all on the request path — escalate, do not edit:**

```java
// findAllArticles(): builds the map here, returns it; another class executes the query and a
// third filters the hits by date for the UI. p.limit=-1 stays — capping would truncate the
// date-filtered list. Recorded:
//   needs-pagination: .../ArticleSearchBuilder.java:42 result consumed in full on the request
//   path — needs offset paging (human decision: page size + a stable sort)
```

## Editing strategy

Surgical text-level edit — for the bound branches, replace only the `-1` token in the flagged call;
leave other predicates, statements, and formatting untouched. Add an offset loop only in the
local-and-simple branch; otherwise escalate rather than guessing the loop structure across methods.
Do not introduce `Integer.MAX_VALUE` / `Long.MAX_VALUE` — that is the same unbounded bug.

**Constant-valued marker** (the snippet passes a constant, e.g. `put("p.limit", UNLIMITED_RESULT)`):
do **not** edit the constant's definition — it is usually shared, so changing it silently re-bounds
*every* caller (blast radius). Bound at this site only if the constant is single-use *and* the site
meets the single-result gate, by replacing the reference with the literal at this call. Otherwise
escalate as `needs-pagination` — a shared unbounded constant is almost always an iterate-all builder
feeding multiple callers, the case that needs a human pagination decision.

## Verify

Beyond `mvn compile`: a bounded single-result query stops materialising the whole set — under load the
heap no longer climbs on that path and the related `OutOfMemoryError` / long GC pauses disappear. For
any site you bounded, confirm the caller cannot legitimately exceed the bound (else it would now drop
rows); sites that could exceed it should have been escalated as `needs-pagination`, not capped.
