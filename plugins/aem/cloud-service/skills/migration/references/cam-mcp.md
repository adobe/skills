# CAM / MCP (Cloud Acceleration Manager)

Read this file when **fetching BPA targets from Cloud Acceleration Manager (CAM)** instead of a CSV or cached collection, or when **submitting a Branch G validation outcome** ([submit](#submitting-a-validation-outcome)). Parent skill: `../SKILL.md`.

**Use the AEM MCP Server.** CAM findings and validation outcomes are served as recipes on the **AEM MCP Server** (tools `lookup-api-spec`, `read-api`, `write-api`). The standalone **AEM Cloud Service Migration MCP** server is **deprecated**; use its tools only when the AEM MCP Server is not connected or does not offer the recipes ([legacy section](#legacy-aem-cloud-service-migration-mcp-deprecated)). When you do, tell the user once that the server is deprecated and that the AEM MCP Server replaces it.

## Choosing the source

| Situation | Action |
|---|---|
| AEM MCP Server connected and `recipes.get('<recipe>')` returns the recipe | Use the [recipes](#aem-mcp-server-recipes). |
| A call returns the [enablement restriction](#enablement-restriction-errors-mandatory-handling) | Follow that section. Do not switch servers on your own. |
| AEM MCP Server connected but `recipes.get` returns `null` (capability not offered or not enabled for the org) | Tell the user. Offer the deprecated server if it is connected, a BPA CSV, or named files, and wait for their choice. |
| Only the AEM Cloud Service Migration MCP is connected | Use the [legacy tools](#legacy-aem-cloud-service-migration-mcp-deprecated) and mention the deprecation once. |
| Neither server is connected | Ask for a BPA CSV or named files. |

Never fall back silently from one source to another.

## Happy path (what the user should see)

1. Agent asks the user for their **CAM project name or ID**.
2. **You confirm** the project (the agent never guesses or infers it). Given a name, the agent lists your projects (`list-cam-projects`) and confirms the matching **ID** with you.
3. Agent fetches the findings **once** for the confirmed project and the **one pattern** for this session.
4. `bpa-findings-helper.js` caches the response to
   `<collectionsDir>/mcp/<projectId>/<pattern>.json` and applies the batch slice (default 5) client-side.
5. Agent processes that batch, reports progress (`returned / total`), then stops. The user says whether to continue.
6. On continue, the agent re-invokes `getBpaFindings` with `offset = paging.nextOffset`; the helper reads the cache — **no additional MCP calls** — and returns the next batch.

See [Batching](#batching) below for the full contract.

### Project name and ID — non-negotiable

- **Never** fetch findings or submit with a `projectId` or `projectName` that the user has not **explicitly confirmed**.
- **Pass `projectId`.** When the user gives a name, run `list-cam-projects`, show the matching projects, and use the **ID** the user confirms. The server otherwise resolves a name by a unique *partial* match, which can silently pick a different project.
- If a call returns a "project not found" error, **quote the error verbatim**, and ask the user for the correct project name or ID — do not guess or retry with a fuzzy match.
- **Do not** infer the CAM project from the open workspace, repository name, or sample code (e.g. WKND).

### MCP errors — stop first (especially project-not-found)

On **any** failure, **stop the migration workflow immediately**. **Quote the error verbatim** in your reply to the user (including 404-style messages such as *No project found matching "…"*). **Do not** continue with BPA processing, manual file migration, or "local codebase" assumptions on your own.

**Exception:** [enablement restriction errors](#enablement-restriction-errors-mandatory-handling) below — follow that section exactly (verbatim to user; no retry; no silent fallback).

**After** that verbatim report, you may briefly explain what went wrong (e.g. unknown project name). **Only** if the user **explicitly** asks to switch approach (e.g. provides a BPA CSV path, picks another project, or names specific Java files for manual flow) may you proceed — that is a **new** user-directed step, not an automatic fallback.

For other failures (auth, timeout, 5xx), still quote errors verbatim, follow the [retry table](#retries-and-agent-behavior), then **stop** and ask how the user wants to continue (CSV, different project, or manual files) — do not silently pivot.

---

## Enablement restriction errors (mandatory handling)

Both servers deny a call when they are not enabled for the requested org, project, path, or operation. The error **starts with**:

`The MCP Server is restricted and isn't able to`

(The ending varies, for example "…operate on the given …", "…perform this operation.", "…reach this upstream.") On the AEM MCP Server the denial is the recipe's result: an object with this `error` and no `success` field.

**You must:**

1. **Output that error message to the user verbatim** — same text, in full, including any contact or enablement details the server appended. Do not paraphrase, summarize, or "translate" it into your own words.
2. **Do not retry** the same call to "work around" this response.
3. **Do not silently fall back** to another server, CSV, or manual paths as if MCP had merely failed — the user may need to complete enablement or follow the instructions embedded in the error first. After they confirm they have addressed it, you may continue (including retrying if appropriate).

If your MCP server documentation adds other error prefixes or codes with the same "no paraphrase / no silent fallback" rule, treat those the same way and keep this file aligned with that documentation.

---

## AEM MCP Server recipes

| Recipe | Run with | Parameters | Result |
|---|---|---|---|
| `list-cam-projects` | `read-api` | (none) | `{ success, projects: [{ id, name }] }` for the user's IMS organization |
| `list-bpa-findings-by-pattern` | `read-api` | `projectId`, `pattern` | `{ success, projectId, targets, summary, total, truncated, message?, fetchErrors? }` |
| `list-bpa-findings-by-severity` | `read-api` | `projectId`, `importance` (`CRITICAL` \| `MAJOR` \| `ADVISORY` \| `INFO`) | `{ success, importance, projectId, reportId, reportTime, findings, noReport, message? }` |
| `submit-migration-validation-result` | `write-api` | `payload` | `{ success, run_id, project_id, stored_at, duplicate }`; see [Submitting](#submitting-a-validation-outcome) |

`pattern` is one of `scheduler`, `assetApi`, `eventListener`, `resourceChangeListener`, `eventHandler`, `guavaCache`, `inputStream`, `lui`, `luiCoral2`, `cdw`, or `all`. Targets carry `pattern`, `className`, `identifier`, `issue`, `severity`; findings carry `code`, `type`, `subtype`, `importance`, `count`, sorted by descending count.

### How to call

1. Get each recipe **once per session** with `lookup-api-spec`
   (`return await recipes.get('list-bpa-findings-by-pattern');`) and reuse its code for later calls.
2. Run the code with `read-api` (`write-api` for the submit), declaring the parameters as constants
   before it, for example `const projectId = '<confirmed id>'; const pattern = 'scheduler';`.
   No `aemUrl` is needed.
3. Always pass the session's single `pattern` (the recipe defaults to `all`), and return the result
   unchanged so errors stay verbatim and the helper gets the full list.
4. Hand the result to the helper with a fetcher that returns it:
   `mcpFetcher: async () => result` (or `require('<saved-result>.json')`). The helper treats any result
   without `success: true`, or with `fetchErrors`, as a failure and never caches it.

### Behaviour to know

- **Environment.** There is no `environment` parameter: the server reads the CAM environment that matches
  the user's sign-in (production for customer accounts). If the user asks for `dev` or `stage` data,
  say that this server cannot select it.
- **Capped list.** The pattern recipe returns each pattern's full sorted list, capped at 500 targets.
  When the cap applies, the helper result carries `truncated: { returned, reportedTotal }`. Before the
  first batch, tell the user *"CAM returned N of M findings"* and ask whether to continue with those or
  provide the BPA CSV for the full list.
- **No report yet.** An empty list with `message` (pattern) or `noReport: true` (severity) is a success:
  show `message` verbatim, then offer options as for an empty result in the [retry table](#retries-and-agent-behavior).
- **Ambiguous name.** A 409 "Multiple projects match" error lists the candidates in `suggestion`. Show them
  and call again only with the ID the user picks.
- **No agent retries.** The server already retries a 5xx or network failure once. Quote `error` (and
  `suggestion`, if any) verbatim and stop.

---

## Submitting a validation outcome

Records a **Branch G** validation outcome ([validate-migration.md](validation/validate-migration.md))
against a CAM project, with the `submit-migration-validation-result` recipe (AEM MCP Server, `write-api`)
or the deprecated tool of the same name.

> **Paused.** Submitting validation outcomes is switched off until the legal review is complete.
> Do not call the recipe or the deprecated tool, and do not ask for a project to submit to.
> Fetching findings (above) is unaffected. The validator emits no payload while paused; set
> `VALIDATE_MIGRATION_CAM_REPORTING=1` to re-enable it, after which the rules below apply again.

- Submit only when a project is linked: the nearest `migration-runbook.json` (`project.id`) or an explicit
  `--project-id` / `--project-name` (explicit wins). With no linked project, validation stays local; do
  not ask for a project just to submit.
- **The payload must carry `project_id`.** If only a name is linked, resolve it with `list-cam-projects`,
  have the user confirm the ID, and re-run `check.js --stage verify --project-id <id>`. A name would be
  resolved by partial match, and a result filed under the wrong project cannot be withdrawn.
- Do not build the payload by hand. `check.js --stage verify` prints it between
  `=== submit-migration-validation-result payload ===` markers (one payload per template for
  `custom-templates`). Forward each payload unchanged, **once**, on the final verification
  attempt, including failed validations. On the AEM MCP Server, declare it as `const payload = <payload>;`
  before the recipe code.
- Confirm the recipe (`recipes.get` returns it) or the tool is available; never call it with a test or
  fabricated outcome.

**Payload (illustrative; the server validates it):**

```typescript
{
  run_id: string;              // "vm-<timestamp>"
  project_id?: string;         // either this or project_name must be provided
  project_name?: string;
  skill_pattern: string;       // validator pattern(s), e.g. "scheduler" or "scheduler+replication"
  skill_version: string;       // validator package version
  result: "pass" | "fail";
  verification_level: "runtime" | "source-only";
  started_at: string;          // ISO 8601
  finished_at: string;         // ISO 8601
  summary: { classes_total: number; classes_pass: number; classes_fail: number };
  bundle?: {
    symbolic_name: string;
    state: "Installed" | "Resolved" | "Active" | "Fragment" | "Unknown";
  };
  classes: Array<{
    class_name: string;        // Java FQCN, editable template path, or "(<pattern>)"
    result: "pass" | "fail";
    failure_class?: string;    // one of scripts/validate-migration/failure-classes.js
    bundle_state?: string;
    component_state?: string;
    evidence?: string;         // credential-free, at most 2048 characters
    checks?: Record<string, string | number | boolean>;  // flat; keys contain no "."
  }>;
}
```

**Result.** Acknowledged only when the success flag is `true` — `success` on the AEM MCP Server, `ok` on
the deprecated tool — with `run_id` equal to the submitted one (and, on the AEM MCP Server, `project_id`
equal to the confirmed ID). `duplicate: true` means this `run_id` was already stored. Anything else is a
failed submission. A 400 with `details` means the payload was altered or the validator is out of date:
quote `error` and `details`, stop, and never repair the payload by hand. An acknowledgement confirms the
outcome was stored, not any downstream delivery.

**Agent rules:**

1. Say "outcome recorded" only after an acknowledgement as above.
2. Save the actual result as `.validate-migration/<run_id>-receipt.json` (`--stage finalize` accepts
   `success` or `ok`). For a failure save `{ "success": false, "error": "<credential-free summary>" }`.
   Then run `--stage finalize` per [validate-migration.md](validation/validate-migration.md) steps 5–6,
   including after a failed submission.
3. **Do not retry automatically** — not even on network errors or 5xx. Reporting stays
   incomplete until the user decides. Enablement restriction errors are still shown
   [verbatim](#enablement-restriction-errors-mandatory-handling).

---

## Batching

The migration skill processes BPA findings in **batches of 5** by default. Batching is
**entirely client-side** — the server is called once per `(projectId, pattern)`; the
helper caches the response to disk and slices from the cache on subsequent calls.

### Contract

- **The server does not need to support `limit` or `offset`.** It is called once and
  returns the list for the requested pattern (capped on the AEM MCP Server; see above).
- **Ordering should be stable across calls.** If the underlying BPA run changes between
  fetches and the user wants fresh data, they (or the agent) delete
  `<collectionsDir>/mcp/<projectId>/<pattern>.json` to trigger a re-fetch.
- **No severity filtering.** Within a single pattern all findings are equal rank; the server
  must not silently reorder or filter by severity.
- **Cache location:** `<collectionsDir>/mcp/<projectId>/<pattern>.json`. Disjoint from the
  CSV path's cache at `<collectionsDir>/unified-collection.json`, so MCP and CSV cannot
  shadow each other.

### Agent rules

1. Fetch **once** per `(projectId, pattern)` — the helper calls `mcpFetcher` the first time the
   agent invokes `getBpaFindings` on the MCP path.
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

Both servers retry internally. The AEM MCP Server recipes are **never** retried by the agent; the
"Once" rows below apply only to the deprecated tools' reads. The submit is never retried automatically
on either server.

**Agent:**

1. If the failure matches [Enablement restriction errors](#enablement-restriction-errors-mandatory-handling), handle it **only** as described there (verbatim output; no retry; no silent CSV/manual fallback).
2. Check `result.success` before using `result.targets`.
3. If `pattern` was `all`, filter `targets` to the **one pattern** chosen for this session.
4. Use `className` (and any file paths the server returns) to locate Java sources **only under the current IDE workspace root(s)**. If a path does not exist there, report it and ask the user — do not search outside the open project.
5. On other failures, **stop**; quote the error **verbatim**. Use retries only per the table. **Do not** automatically continue with CSV or manual migration — wait for the user to choose the next step after they have seen the error.

| Situation | Retry? | Action |
|-----------|--------|--------|
| Error starts with `The MCP Server is restricted and isn't able to` | No | [Verbatim to user](#enablement-restriction-errors-mandatory-handling); stop automatic fallback |
| Auth 401 / 403 | No | Quote error verbatim; stop. Ask how to proceed (credentials, CSV, or named files) only after stopping. |
| 404 / "no project found" / unknown `projectId` | No | Quote error verbatim; stop. **Require** user to confirm the correct project name/ID or choose another source (CSV / explicit file list). **No** automatic "local workspace" migration. |
| "Multiple projects match" (AEM MCP Server, 409) | No | Quote error verbatim and show the `suggestion` candidates; call again only with the ID the user picks. |
| `fetchErrors` present (AEM MCP Server) | No | Treat as failed; quote `error` or the failed patterns; stop. |
| Network / timeout / 5xx (deprecated tools) | Once | Retry after ~2s, then quote error verbatim and stop if still failing. |
| Network / timeout / 5xx (AEM MCP Server) | No | Already retried by the server; quote error verbatim; stop. |
| 400 | No | Quote error verbatim; stop; ask user to fix parameters or pick another path. |
| `success: true`, empty `targets`, `message` present (specific pattern, no findings) | No | Show the `message` verbatim (e.g. *"No 'scheduler' findings in the latest BPA report for project X."*). Offer options — other pattern, CSV, explicit files — **only** as choices; do not start editing the repo without BPA targets unless the user picks manual files. |
| `success: false`, empty `targets` (`pattern: "all"` or error) | No | Quote `error` verbatim; stop. Offer options (other pattern, CSV, explicit files) **only** as choices for the user. |

---

## Legacy: AEM Cloud Service Migration MCP (deprecated)

Use only per [Choosing the source](#choosing-the-source). Every rule above applies; the differences are
the tool names, an optional `environment` (`dev` \| `stage` \| `prod`, default `prod`), no 500-target cap,
errors returned as tool errors, one agent retry on network/5xx for the reads, and `ok: true` on the submit.

| Deprecated tool | AEM MCP Server recipe |
|---|---|
| `fetch-cam-bpa-findings-by-pattern` | `list-bpa-findings-by-pattern` |
| `fetch-cam-bpa-findings-by-importance` | `list-bpa-findings-by-severity` |
| `submit-migration-validation-result` | `submit-migration-validation-result` (`write-api`) |
| (internal name lookup) | `list-cam-projects` |

### Tool: `fetch-cam-bpa-findings-by-pattern`

Pattern-axis tool registered by the server. It can also resolve a project name to a project ID itself, so a separate `list-projects` call is not needed — pass `projectName` or `projectId`.

**Request (illustrative — confirm against live MCP tool schema):**

```typescript
{
  projectId?: string;   // CAM project ID; either this or projectName must be provided
  projectName?: string; // human-readable name; resolved to projectId by the server
  pattern?: "scheduler" | "assetApi" | "eventListener" | "resourceChangeListener" | "eventHandler"
    | "guavaCache" | "inputStream" | "lui" | "luiCoral2" | "cdw" | "all";
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


### Tool: `fetch-cam-bpa-findings-by-importance`

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
  projectName?: string; // human-readable name; resolved to projectId by the server
  environment?: "dev" | "stage" | "prod";  // defaults to "prod"
}
```

**Success response:**

```typescript
{
  success: true;
  importance: "CRITICAL" | "MAJOR" | "ADVISORY" | "INFO";
  environment?: "dev" | "stage" | "prod";
  projectId: string;
  reportId: string | null;
  reportTime: number | null;  // epoch millis, when available
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
