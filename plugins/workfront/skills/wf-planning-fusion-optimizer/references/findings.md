# Finding reference

What each finding means, why it matters for performance (run time, operations, cost)
and rate limits, and the recommended direction. Severity reflects typical impact.
Every finding also carries an "Improves:" dimension in the report so the reader sees
whether a fix buys speed, fewer operations, reliability, or headroom.

## Operations, run time, and rate limits are the same problem

Every Fusion module execution is an operation. Operations cost wall-clock time and
consume quota, and iteration depth (loops inside loops) multiplies them. API calls are
the subset of operations that hit Planning and count against the per-user rate limit.
So the structural fixes below usually improve speed, cost, and rate-limit headroom
together. Rate-limit 429s are a symptom, not the whole disease.

One hard constraint shapes the priorities: **there is no bulk-read endpoint.** Search
and single GET are the only reads; bulk exists for create/update/patch/delete only. A
read-heavy scenario is fixed by reading fewer and wider, not by raising a limit or
batching writes. Address the read findings (F1-F3) first.

## Read path

### F1 (HIGH) — Schema fetched inside a loop | improves calls + operations + run time
Record-type and field definitions are static per run. Fetching them inside a loop
re-fetches identical data every iteration, often the largest single share of calls.
Fix: fetch once before the loop, cache in a variable or the data store, reference it.

### F2 (HIGH) — Per-record reads inside nested loops | calls + operations + run time
One GET per child record scales linearly with record count and multiplies with nesting.
This is the pattern that most often breaches the limit and dominates run time.
Fix: collapse into one filtered, projected search per level. Filter the child record
type by its parent reference and project needed fields with `attributes` so connected
data returns in the search result.

### F3 (HIGH) — Read a set, then GET each record again | calls + operations + run time
A search or reference array yields records, then each is re-fetched by id. The fields
are usually already present, so the follow-up GET is redundant and, being nested,
multiplies most.
Fix: project needed fields into the first read and delete the follow-up GET.

### P2 (MEDIUM) — Search runs inside a loop | calls + operations + run time
A search executing inside a loop repeats every iteration. If the result is constant, it
is pure waste; if it varies only by a parent id, one wider search before the loop can
replace many.
Fix: hoist the search above the loop and reuse it, or widen the filter (parent id
hasAnyOf the set) so one search covers all iterations.

## Write path

### F4 (MEDIUM) — All writes single-record, no bulk | calls + operations + run time
Every write is one record per call. The v2 bulk endpoints take 100 per request, cutting
write calls, operations, and time together.
Fix: aggregate and send via bulk. Bulk is not atomic, so read the per-item error array
and retry only failures. Batch level by level (a child needs its parent id first).

### F5 (MEDIUM) — Write-then-PATCH double write | calls + operations
A create/update immediately followed by a second write to the same record doubles the
cost of every logical write.
Fix: find which field(s) force the second write. If a connector limitation, raise it;
otherwise merge into one call. Confirm before removing, or fields go unset.

## Throughput, reliability, resource

### P1 (HIGH) — Sleep / delay modules | run time + timeout risk
Sleeps trade rate-limit failures for longer runs and timeout risk, and consume run time
doing no work. They mask the real problem.
Fix: treat as a temporary bridge. Cut the underlying call volume first, then remove or
re-place the sleeps. Removing them before cutting volume concentrates the same calls
into a shorter window and can make bursts worse, so sequence the change deliberately.

### P3 (MEDIUM) — Reads and writes share one connection | throughput / concurrency
All Planning calls on one connection share a single per-user rate budget and cannot run
against separate budgets, which serializes throughput under concurrency and makes the
limit easier to hit.
Fix: split read and write traffic across separate integration accounts, each with its
own budget. This is headroom, applied after the call reductions, not instead of them.

### F6 (MEDIUM) — Reads that can fire with an empty id | calls + wasted operations
A read builds its id from an array dereference. An empty array fires a request with no
id, returning 404 and wasting budget. Returning an empty string from an `if()` does not
stop the call.
Fix: add a module-level filter so the read runs only when the source array is non-empty.

### F7 (MEDIUM) — Errors silently ignored | reliability + hidden cost
Ignore handlers swallow 429/5xx, hiding the true failure rate and giving up retries that
would recover work.
Fix: on calls that draw 429/5xx, use retry plus backoff, then surface real errors. Keep
suppression only on genuinely optional calls, and be explicit about which; converting
every handler blindly can fail runs that currently complete.

### F8 (LOW) — Trigger may be unbounded / unfiltered | run frequency + total load
An unfiltered change trigger fires the whole scenario per delivered change.
Fix: filter to only records that need processing and set a sane batch size.

### F9 (LOW) — Mixed v1 / v2 API usage | maintainability + unlocks bulk
Both API versions in use. Standardizing on v2 (search, bulk writes, Fields API)
simplifies the integration and unlocks bulk.
Fix: reads to v2 search/get, definitions to the v2 Fields API, writes to v2 single and
bulk endpoints.

## Measuring the change

Recommend a before/after on a representative run at matched concurrency: operations and
calls per run, and run duration (the design change), plus peak calls per minute per
connection (headroom). A good result is retrieval count going flat with respect to
record count rather than linear, and run duration dropping. Do not quote a single
percentage without a real measurement.
