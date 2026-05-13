# CAM / MCP (Cloud Adoption Service)

Read this file when **fetching BPA targets via MCP** instead of a CSV or cached collection. Parent skill: `../SKILL.md`.

## Happy path (what the user should see)

1. Agent asks the user for their **CAM project name or ID**.
2. **You confirm** the project name or ID (the agent should not guess or infer it).
3. Agent calls **`fetch-cam-bpa-findings-by-pattern`** **once** with the confirmed project and the **one pattern** for this session (`scheduler`, `assetApi`, etc., or `all` then filtered). The MCP server returns all findings for that pattern.
4. `bpa-findings-helper.js` caches the response to
   `<collectionsDir>/mcp/<projectId>/<pattern>.json` and applies the batch slice (default 5) client-side.
5. Agent processes that batch, reports progress (`returned / total`), then stops. The user says whether to continue.
6. On continue, the agent re-invokes `getBpaFindings` with `offset = paging.nextOffset`; the helper reads the cached MCP fetch — **no additional MCP calls** — and returns the next batch.

See [Batching](#batching) below for the full contract.

### Project name and ID — non-negotiable

- **Never** call **`fetch-cam-bpa-findings-by-pattern`** or **`fetch-cam-bpa-findings-by-importance`** with a `projectId` or `projectName` that the user has not **explicitly confirmed**.
- If the tool returns a "project not found" error, **quote the error verbatim**, and ask the user to provide the correct project name or ID — do not guess or retry with a fuzzy match.
- **Do not** infer the CAM project from the open workspace, repository name, or sample code (e.g. WKND) when using MCP.

### MCP errors — stop first (especially project-not-found)

On **any** MCP failure, **stop the migration workflow immediately**. **Quote the tool error verbatim** in your reply to the user (including 404-style messages such as *No project found matching "…"*). **Do not** continue with BPA processing, manual file migration, or "local codebase" assumptions on your own.

**Exception:** [enablement restriction errors](#enablement-restriction-errors-mandatory-handling) below — follow that section exactly (verbatim to user; no retry; no silent fallback).

**After** that verbatim report, you may briefly explain what went wrong (e.g. unknown project name). **Only** if the user **explicitly** asks to switch approach (e.g. provides a BPA CSV path, picks another project, or names specific Java files for manual flow) may you proceed — that is a **new** user-directed step, not an automatic fallback.

For other failures (auth, timeout, 5xx), still quote errors verbatim; use retries only where the table below allows, then **stop** and ask how the user wants to continue (CSV, different project, or manual files) — do not silently pivot.

**Below:** tool shapes and maintainer notes for the agent. You can skip the TypeScript until you need parameter details.

---

## Enablement restriction errors (mandatory handling)

Some **AEM Cloud Service Migration MCP** deployments return an error when the server is not enabled for the requested org, project, or operation. When the tool error **starts with**:

`The MCP Server is restricted and isn't able to operate on the given`

**You must:**

1. **Output that error message to the user verbatim** — same text, in full, including any contact or enablement details the server appended. Do not paraphrase, summarize, or "translate" it into your own words.
2. **Do not retry** the same tool call to "work around" this response.
3. **Do not silently fall back** to CSV or manual paths as if MCP had merely failed — the user may need to complete enablement or follow the instructions embedded in the error first. After they confirm they have addressed it, you may continue (including retrying MCP if appropriate).

If your MCP server documentation adds other error prefixes or codes with the same "no paraphrase / no silent fallback" rule, treat those the same way and keep this file aligned with that documentation.

---

## Rules before any tool call

1. **Ask the user** for their CAM project name or ID. Do not guess from the workspace or sample code.
2. **Wait for explicit confirmation**, then call **`fetch-cam-bpa-findings-by-pattern`** (for code-transformer pattern flows) or **`fetch-cam-bpa-findings-by-importance`** (for "what are the critical/major findings?" requests) using the **confirmed** `projectId` (preferred) or `projectName`.
3. For pattern flows: map the session's **single pattern** to the tool's `pattern` argument (`scheduler`, `assetApi`, `eventListener`, `resourceChangeListener`, `eventHandler`, or `all`). If you used `all`, filter `targets` to the active pattern.

## Tool: `fetch-cam-bpa-findings-by-pattern`

Pattern-axis tool registered by the server. It can also resolve a project name to a project ID internally (via the CAM projects API), so a separate `list-projects` call is not needed — pass `projectName` or `projectId`.

**Request (illustrative — confirm against live MCP tool schema):**

```typescript
{
  projectId?: string;   // CAM project ID; either this or projectName must be provided
  projectName?: string; // human-readable name; resolved to projectId via CAM /projects API
  pattern?: "scheduler" | "assetApi" | "eventListener" | "resourceChangeListener" | "eventHandler" | "all";
  environment?: "dev" | "stage" | "prod";  // defaults to "prod"
}
```

The MCP server is **not** required to implement paging; the helper batches client-side.

**Success response (shape may vary by server version):**

```typescript
{
  success: true;
  environment?: "dev" | "stage" | "prod";
  projectId: string;
  targets: Array<{
    pattern: string;
    className: string;
    identifier: string;
    issue: string;
    severity?: string;
  }>;
  summary?: Record<string, number>;
  /**
   * Present when a specific pattern was requested but has no findings in the
   * latest BPA report (e.g. "No 'scheduler' findings in the latest BPA report
   * for project <id>."). `targets` will be an empty array. This is a successful
   * response — the report exists, there are just no findings for this pattern.
   */
  message?: string;
}
```

**Error response:**

```typescript
{
  success: false;
  error: string;
  errorDetails?: { message: string; name: string; code?: string };
  troubleshooting?: string[];
  suggestion?: string[];
}
```

**Example:**

```javascript
// One-shot fetch per (projectId, pattern). The helper caches this and pages
// subsequent batches from the cache — do not call the MCP tool for every batch.
const resp = await fetchCamBpaFindings({
  projectId: "<user-confirmed-cam-project-id>",
  pattern: "scheduler",
  environment: "prod"
});
// resp.targets — full list for this pattern
```

---

## Tool: `fetch-cam-bpa-findings-by-importance`

Importance-axis tool registered by the server. Returns all findings at one importance
level (`CRITICAL`, `MAJOR`, `ADVISORY`, or `INFO`) from the **latest** BPA report
uploaded to the project, sourced from the BPA's authoritative `_COUNT_<code>` rollup rows
and pre-sorted by descending count.

Use this tool when the user asks open-ended questions like *"what are the critical
findings?"* or *"show me the major issues"*, rather than a code-transformer migration
flow (those use `fetch-cam-bpa-findings-by-pattern`). The same project-confirmation
guardrails apply: never call it with an unconfirmed `projectId` / `projectName`.

**Request (illustrative — confirm against live MCP tool schema):**

```typescript
{
  importance: "CRITICAL" | "MAJOR" | "ADVISORY" | "INFO";  // required
  projectId?: string;   // CAM project ID; either this or projectName must be provided
  projectName?: string; // human-readable name; resolved to projectId via CAM /projects API
  environment?: "dev" | "stage" | "prod";  // defaults to "prod"
}
```

**Backed by:** `GET /projects/{projectId}/bpaReportCodeTransformerData/findings/{importance}`

**Success response:**

```typescript
{
  success: true;
  importance: "CRITICAL" | "MAJOR" | "ADVISORY" | "INFO";
  environment?: "dev" | "stage" | "prod";
  projectId: string;
  reportId: string | null;
  reportTime: number | null;  // epoch millis from BpaOverview, when available
  findings: Array<{
    code: string;          // e.g. "_COUNT_ACV"
    type: string;          // e.g. "_count.assets.health"
    subtype: string;       // e.g. "missing.original.rendition"
    importance: "CRITICAL" | "MAJOR" | "ADVISORY" | "INFO";
    count: number;
  }>;
}
```

A 404 from the backend (no BPA report uploaded yet) is mapped to `success: true` with
`findings: []` and `reportId: null`.

**Error response:** same shape as `fetch-cam-bpa-findings-by-pattern` (`success: false`,
`error`, optional `troubleshooting` / `suggestion`). Apply the same retry table.

---

## Batching

The migration skill processes BPA findings in **batches of 5** by default. Batching is
**entirely client-side** — the MCP server is called once per `(projectId, pattern)`; the
helper caches the response to disk and slices from the cache on subsequent calls.

### Contract

- **The MCP tool does not need to support `limit` or `offset`.** It is called once and
  returns the full list for the requested pattern.
- **Ordering should be stable across calls.** If the underlying BPA run changes between
  fetches and the user wants fresh data, they (or the agent) delete
  `<collectionsDir>/mcp/<projectId>/<pattern>.json` to trigger a re-fetch.
- **No severity filtering.** Within a single pattern all findings are equal rank; the server
  must not silently reorder or filter by severity.
- **Cache location:** `<collectionsDir>/mcp/<projectId>/<pattern>.json`. Disjoint from the
  CSV path's cache at `<collectionsDir>/unified-collection.json`, so MCP and CSV cannot
  shadow each other.

### Agent rules

1. Call `fetch-cam-bpa-findings-by-pattern` **once** per `(projectId, pattern)` — the helper does this
   the first time the agent invokes `getBpaFindings` on the MCP path.
2. After each batch the helper returns, process **only** those findings, then **stop**:
   *"Processed 5 of 137 scheduler findings. Reply `continue` for the next batch, or name
   specific classes to focus on."*
3. On continue, re-invoke `getBpaFindings` with `offset = paging.nextOffset`. The helper
   reads the local cache — **no** additional MCP call.
4. Stop when `paging.hasMore === false` (or `paging.nextOffset === null`).
5. Never accumulate more than one batch in working memory. Each batch is independent.
6. To refresh MCP data, delete the cache file for that `(projectId, pattern)` and re-invoke.

---

## Retries and agent behavior

**MCP tool:** The server implements its own retry and timeout logic internally. Do not add agent-side retries on top unless the table below says otherwise.

**Agent:**

1. If the failure matches [Enablement restriction errors](#enablement-restriction-errors-mandatory-handling), handle it **only** as described there (verbatim output; no retry; no silent CSV/manual fallback).
2. Check `result.success` before using `result.targets`.
3. If `pattern` was `all`, filter `targets` to the **one pattern** chosen for this session.
4. Use `className` (and any file paths the server returns) to locate Java sources **only under the current IDE workspace root(s)**. If a path does not exist there, report it and ask the user — do not search outside the open project.
5. On other failures, **stop**; quote the error **verbatim**. Use retries only per the table. **Do not** automatically continue with CSV or manual migration — wait for the user to choose the next step after they have seen the error.

| Situation | Retry? | Action |
|-----------|--------|--------|
| Error starts with `The MCP Server is restricted and isn't able to operate on the given` | No | [Verbatim to user](#enablement-restriction-errors-mandatory-handling); stop automatic fallback |
| Auth 401 / 403 | No | Quote error verbatim; stop. Ask how to proceed (credentials, CSV, or named files) only after stopping. |
| 404 / "no project found" / unknown `projectId` | No | Quote error verbatim; stop. **Require** user to confirm the correct project name/ID or choose another source (CSV / explicit file list). **No** automatic "local workspace" migration. |
| Network / timeout | Once | Retry after ~2s, then quote error verbatim and stop if still failing. |
| 5xx | Once | Retry after ~2s, then quote error verbatim and stop if still failing. |
| 400 | No | Quote error verbatim; stop; ask user to fix parameters or pick another path. |
| `success: true`, empty `targets`, `message` present (specific pattern, no findings) | No | Show the `message` verbatim (e.g. *"No 'scheduler' findings in the latest BPA report for project X."*). Offer options — other pattern, CSV, explicit files — **only** as choices; do not start editing the repo without BPA targets unless the user picks manual files. |
| `success: false`, empty `targets` (`pattern: "all"` or error) | No | Quote `error` verbatim; stop. Offer options (other pattern, CSV, explicit files) **only** as choices for the user. |
