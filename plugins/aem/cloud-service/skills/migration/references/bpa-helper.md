# The BPA findings helper

`scripts/bpa-findings-helper.js` returns the migration targets for one pattern, one batch at a
time. The skill's workflow (`SKILL.md`, Step 3) calls it; this file has the flow, the call, its
result, the batching rules and the command line for development.

## BPA findings: the flow

Scripts run via **`getBpaFindings`** (see **Calling the helper** below); do not reimplement collection logic by hand unless the helper is unavailable.

The helper has **two independent paths**, chosen by what the caller configures:

1. **MCP configured** (`mcpFetcher` + `projectId` passed) → first call fetches all findings
   from MCP and caches them to `<collectionsDir>/mcp/<projectId>/<pattern>.json`.
   Every call (first and subsequent) reads from the MCP cache and returns one batch.
2. **MCP not configured, BPA CSV provided** → first call parses the CSV and writes the
   unified-collection JSON to `<collectionsDir>/unified-collection.json`.
   Every call reads from the CSV cache and returns one batch.

The two caches are disjoint — MCP sessions and CSV sessions never shadow each other. If
neither is configured, the helper reports `no-source` and the agent asks for one.

**Batching is mandatory on every path**: `getBpaFindings` returns a batch of 5 (`result.targets`) plus a `result.paging` envelope `{ total, returned, offset, limit, nextOffset, hasMore }`. Process one batch, report, stop, and resume only on the user's go-ahead — full rules in **Batched processing (batch size 5)** below.

**Note:** `htlLint` does **not** appear in BPA CSV — it uses proactive `rg` discovery instead. See **htlLint flow** in `SKILL.md`.

### CAM via MCP (summary)

Fetch CAM findings through the **AEM MCP Server** recipes: **`list-bpa-findings-by-pattern`** for
code-transformer pattern flows (scheduler, assetApi, eventListener, resourceChangeListener,
eventHandler, guavaCache, inputStream, lui, luiCoral2, cdw) and **`list-bpa-findings-by-severity`**
when the user asks "what are the critical/major/advisory/info findings?". The **AEM Cloud Service
Migration MCP** tools (`fetch-cam-bpa-findings-by-*`) are **deprecated**; use them only when the
recipes are unavailable. Either way, the user must **explicitly confirm** the project first — resolve a
name to its ID with `list-cam-projects` and pass **`projectId`**. Source choice, schemas, retries,
the 500-target cap, and error handling: [cam-mcp.md](cam-mcp.md).

### Collection caching

Collections live under **`./unified-collections/`**. If a collection exists and the user supplies a **new** CSV, ask whether to reuse or re-process. A collection written before the requested pattern was supported is rebuilt from the CSV automatically (the parser records the subtypes it extracts in `meta.parsedSubtypes`); without a CSV, a request for that one pattern returns an error rather than reporting it absent, while `all` still returns the patterns the collection covers and names the ones it can't answer (`staleCache.missingPatterns`).

### Reading a BPA CSV

Filter rows where **`pattern`** matches the session pattern. Typical columns: `pattern`, `filePath`, `message`.

## Calling the helper

Scripts live under **`./scripts/`** (next to `SKILL.md`).

```javascript
const { getBpaFindings } = require('./scripts/bpa-findings-helper.js');

// First batch (defaults: limit=5, offset=0)
const result = await getBpaFindings(pattern, {
  bpaFilePath: './cleaned_file6.csv',
  collectionsDir: './unified-collections',
  projectId: '...',
  mcpFetcher: mcpFunction
  // limit: 5,   // implicit default
  // offset: 0,  // implicit default
});

// Next batch — only after the user says to continue
if (result.paging?.hasMore) {
  const next = await getBpaFindings(pattern, {
    bpaFilePath: './cleaned_file6.csv',
    collectionsDir: './unified-collections',
    projectId: '...',
    mcpFetcher: mcpFunction,
    offset: result.paging.nextOffset
  });
}
```

**`result`:**
- `success`, `source` (`'unified-collection' | 'bpa-file' | 'mcp-server' | …`)
- `message` (includes a human-readable batch status)
- `targets` — the **current batch** (length `<= limit`)
- `paging: { total, returned, offset, limit, nextOffset, hasMore }` — always present on
  successful calls

To disable batching for a one-off programmatic caller, pass `limit: null`. The
skill workflow itself **never** does this.

## Batched processing (batch size 5)

Findings are served to the agent in batches of **5** by default, regardless of source (MCP
or CSV). Batching happens **client-side** — the heavy fetch (MCP call or CSV parse) happens
once and is materialized to a local JSON cache; every subsequent batch is a cheap slice of
that cache.

### Rules

1. **Default `limit` is 5**, and one batch per call — process, report, stop. Never hold more
   than one batch in memory, pre-fetch, or merge across batches. Never pass `limit: null` in
   the skill flow (that option is for programmatic callers wanting the full list).
2. **Offset starts at 0** and advances by `result.paging.nextOffset` from the previous call —
   read `nextOffset`, never compute `offset + limit` yourself.
3. **Stable ordering.** Each cache file is written once in deterministic order, so slices are
   stable and contiguous.
4. **Resume is stateless.** No progress file — resuming means re-calling with
   `offset: previous.paging.nextOffset`; a later session with the same `pattern` + `offset`
   gets the same batch. **Done when `paging.hasMore === false`** (or `nextOffset === null`).
5. **First call caches, later batches read the cache** — one MCP fetch / CSV parse total, not
   per batch. To refresh, delete the cache file: CSV `<collectionsDir>/unified-collection.json`;
   MCP `<collectionsDir>/mcp/<projectId>/<pattern>.json`.

### Agent-visible flow

```
[User] "Fix scheduler findings using ./reports/bpa.csv"   (MCP path: pass { mcpFetcher, projectId } instead of bpaFilePath)
[Agent] getBpaFindings('scheduler', { bpaFilePath, limit: 5, offset: 0 })
        // first call parses CSV (or fetches MCP once) → writes cache → slices
        → paging: { total: 137, returned: 5, offset: 0, nextOffset: 5, hasMore: true }
        Processes 5 findings, reports: "Processed 5 of 137 (offset 0–4). Reply `continue`."
[User] "continue"
[Agent] getBpaFindings('scheduler', { bpaFilePath, limit: 5, offset: 5 })   // reads cache — no re-parse / no new MCP call
        → paging: { ..., offset: 5, nextOffset: 10, hasMore: true }
...
```

## CLI (development only)

From this skill's directory:

```bash
# First batch (default offset=0, limit=5)
node scripts/bpa-findings-helper.js scheduler ./unified-collections
node scripts/bpa-findings-helper.js scheduler ./unified-collections ./cleaned_file6.csv

# Next batch: offset=5, limit=5
node scripts/bpa-findings-helper.js scheduler ./unified-collections ./cleaned_file6.csv 5 5

# Full unbounded listing (development / debugging only — skill never does this)
node scripts/bpa-findings-helper.js scheduler ./unified-collections ./cleaned_file6.csv 0 all

# Same batching on the low-level reader
node scripts/unified-collection-reader.js all ./unified-collections 0 5
```

## Quick reference

**Source priority (BPA patterns):** unified collection → BPA CSV → MCP → manual paths — **not** an automatic cascade after MCP errors (if MCP fails, stop; see **MCP errors and fallback** in `SKILL.md`). Batch size 5 on every BPA source. `htlLint`, OSGi→Cloud Manager, Template Modernization (C), Dispatcher Conversion (E), Asset Workflow Migration (H), and Repository restructuring (I) do not use BPA/MCP — see their branches in **Required delegation** in `SKILL.md`.

**User-facing snippets:** *"Using existing BPA collection (N findings)…"* / *"Processing your BPA report…"* / *"Fetched findings from CAM."* / *"Scanning HTL templates for data-sly-test lint issues…"* / optional prompt after MCP stop above.
