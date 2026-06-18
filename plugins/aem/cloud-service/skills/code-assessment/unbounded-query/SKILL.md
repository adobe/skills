---
name: unbounded-query
description: "[BETA] AEM Cloud Service expert skill — handle an explicitly-unbounded query (`p.limit=-1` predicate or JCR `setLimit(-1)`): bound it when capping is provably safe, otherwise flag it for human pagination. Use for \"bound my query\", \"unbounded query\", \"query causing OOM\", or a scan that flags `p.limit=-1`. Top CSO OOM cause: an unbounded result set traversed in a loop fills the heap and saturates the instance. The analyzer locates the explicit markers; the recipe triages each by how the result is consumed — single-result → 1, already-bounded list → N, iterate-all on the request path → escalate. Never silently cap a result the caller reads in full. This skill is in beta. Verify all outputs before applying them to production projects."
metadata:
  status: beta
license: Apache-2.0
---

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

# Unbounded query — AEM as a Cloud Service

> This pattern is executed by the code-assessment runbook — follow [`../references/runbook.md`](../references/runbook.md) for the full flow (preflight → plan → apply → verify, run log). This skill supplies the detection + recipe the runbook applies.

## Overview

A query asked to return *everything* — a QueryBuilder predicate `p.limit=-1`, or a JCR `Query.setLimit(-1)` — loads the entire result set into heap. When that result grows and the rows are traversed in a loop, the heap fills and the instance OOMs: this is the top co-occurring cause of out-of-memory outages in the CSO dataset.

**`-1` means the caller wants every row, so capping is not behaviour-neutral.** Lowering it to a fixed bound silently drops rows whenever the real result exceeds the cap — trading a loud OOM for a silent data/count/UI bug. So this pattern does **not** blanket-cap: it triages each site by how the result is consumed (Resolution contract below), bounds only where that is provably safe, and **escalates the rest for human pagination rather than editing them**. The skill never commits — every applied edit is reviewed in the diff.

## Classification — confirm this pattern applies

- A QueryBuilder predicate map sets `p.limit` to `-1` (`…put("p.limit", "-1")`), or a JCR/`javax.jcr.query.Query` (or `QueryManager`-built query) calls `setLimit(-1)`.
- The user asks to "bound a query", mentions an "unbounded query", or a query implicated in an OOM / heap incident; or a scan flagged `unbounded-query`.
- **Not** this pattern: a query that already sets a positive bound (`p.limit=100`, `setLimit(100)`); a `-1` on a different predicate key (only `p.limit` is the marker); pagination tuning of an already-bounded query.

## Discovery

Detection is performed by the analyzer ([`../scripts/analyze.sh`](../scripts/README.md)), run by the runbook:

```bash
bash ../scripts/analyze.sh <workspace-root> --pattern unbounded-query
```

**Match criteria (what the detector flags):** the two *explicit* unbounded markers, matched on source literals (parse-level, no type resolution):

- `…put("p.limit", "-1")` — a QueryBuilder predicate-map entry whose key is exactly `p.limit` and value is `"-1"`, written inline **or** referenced through a same-file `final` constant (e.g. `UNLIMITED_RESULT = "-1"`).
- `…setLimit(-1)` — a `setLimit` call whose single argument is `-1`, inline or via a same-file `final` constant.

Emitted at the call's line, with the call as the snippet. The match is on the marker value (literal or a same-file constant resolving to it), so a bounded query (`"100"`, `setLimit(100)`) or a `-1` on any other key is not flagged — precise by construction, no scope analysis needed.

## Resolution contract

**guided** — triage each flagged site by **how the result is consumed**; the safe automatic edit is narrow, and the default for "iterate-all on the request path" is to **flag for human pagination, not edit**. Cardinal rule: *never silently cap a result the caller reads in full.*

| Call-site shape | Action | Disposition |
|---|---|---|
| **Single-result** — reads first hit only (`.get(0)`, `.next()` once, `getFirstResource()`), no `getTotalMatches()` | bound → **1** | apply |
| **Already-bounded list** — caller shows top-N / already pages | bound → **N / page size** | apply |
| **Iterate-all, local + simple** — query build + result loop in one method, stable sort, no post-filter | wrap in `p.offset` loop | apply (mark review) |
| **Iterate-all, request path** — cross-method, post-filtered, aggregate/count, or unsorted | **do not edit** | skipped: `needs-pagination` |
| **Off-request migration / batch** | skip | skipped: `bound-changes-correctness` |
| **Test code** (`src/test/`) | skip | skipped: `test-scope` |

Bounding is the exception (provably safe sites); escalation is the default when safety cannot be proven. The recipe gives the per-branch edits and the exact reason strings.

## Review checklist

- [ ] The fix matches how the result is consumed (single-hit → 1; bounded list → N; iterate-all → paginate or escalate)
- [ ] No request-path query that consumes **all** rows was silently capped — those are `skipped: needs-pagination`
- [ ] Where a bound was applied, the caller cannot legitimately exceed it (or paging was added)
- [ ] No `getTotalMatches()` / count dependency broken by the new limit
- [ ] Paging (where added) has a stable sort and survives any post-query filter
- [ ] Surgical edit — no reformatting

## Recipe

Read [`recipe.md`](recipe.md) in full before editing: input contract, the triage decision table, per-branch edits (QueryBuilder predicate, JCR `setLimit`, offset paging), the escalation reason strings, skip policy, before/after, editing strategy.

## Handoff

The skill never commits. See [`../references/git-workflow.md`](../references/git-workflow.md) for git vs in-place handoff and the suggested commit message.
