# CAM / MCP (Cloud Adoption Service)

Read this file when **fetching BPA targets via MCP** instead of a CSV or cached collection. Parent skill: `../SKILL.md`.

## Happy path (what the user should see)

1. Agent calls **`list-projects`** and shows **name**, **id**, and **description**.
2. **You pick** a project (even if only one is listed — confirms the right CAM context).
3. Agent calls **`fetch-cam-bpa-findings`** with that project and the **one pattern** for this session (`scheduler`, `assetApi`, etc., or `all` then filtered).
4. Agent maps returned targets to Java files and continues the migration workflow in `../SKILL.md`.

If something fails, the agent should **quote the error**, offer **retry** where appropriate (see [Retries and agent behavior](#retries-and-agent-behavior)), then fall back to **BPA CSV** or **manual file paths** when that chain applies — **except** for [enablement restriction errors](#enablement-restriction-errors-mandatory-handling) below.

**Below:** tool shapes and maintainer notes for the agent. You can skip the TypeScript until you need parameter details.

---

## Enablement restriction errors (mandatory handling)

Some **AEM Cloud Service Migration MCP** deployments return an error when the server is not enabled for the requested org, project, or operation. When the tool error **starts with**:

`The MCP Server is restricted and isn't able to operate on the given`

**You must:**

1. **Output that error message to the user verbatim** — same text, in full, including any contact or enablement details the server appended. Do not paraphrase, summarize, or “translate” it into your own words.
2. **Do not retry** the same tool call to “work around” this response.
3. **Do not silently fall back** to CSV or manual paths as if MCP had merely failed — the user may need to complete enablement or follow the instructions embedded in the error first. After they confirm they have addressed it, you may continue (including retrying MCP if appropriate).

If your MCP server documentation adds other error prefixes or codes with the same “no paraphrase / no silent fallback” rule, treat those the same way and keep this file aligned with that documentation.

---

## Rules before any tool call

1. Call **`list-projects`** first; show **name**, **id**, and **description** to the user.
2. **Wait for explicit project choice** (even if only one project), then call **`fetch-cam-bpa-findings`** with that `projectId` (or `projectName` if the tool supports name resolution per server docs).
3. Map the session’s **single pattern** to the tool’s `pattern` argument (`scheduler`, `assetApi`, `eventListener`, `resourceChangeListener`, `eventHandler`, or `all`). If you used `all`, filter `targets` to the active pattern.

## REST (maintainer context)

The MCP server calls **Adobe AEM Cloud Adoption Service**, for example:

- `GET {base}/projects` — projects for the authenticated IMS org.
- `GET {base}/projects/{projectId}/bpaReportCodeTransformerData/subtype/{subtype}` — aggregated identifiers per BPA subtype (e.g. `sling.commons.scheduler` for scheduler).

Auth headers typically include `Authorization: Bearer …`, `x-api-key`, and `x-gw-ims-org-id` (often `ident@AdobeOrg`). Subtype mapping is implemented in the MCP server.

**Deeper docs:** `aemcs-migration-mcp/docs/cam-cloud-adoption-api-contract.md`; controllers `ProjectController`, `BpaReportCodeTransformerDataController` in `aem-cloud-adoption-service`.

---

## Tool: `list-projects`

Lists CAM projects. **Always call this before `fetch-cam-bpa-findings`.**

**Response (illustrative):**

```typescript
{
  success: true;
  projects: Array<{
    id: string;
    name: string;
    description: string;
  }>;
}
```

---

## Tool: `fetch-cam-bpa-findings`

**Request (illustrative — confirm against live MCP tool schema):**

```typescript
{
  projectId: string;   // required after user confirms project
  projectName?: string; // if server resolves names to id
  pattern?: "scheduler" | "assetApi" | "eventListener" | "resourceChangeListener" | "eventHandler" | "all";
  environment?: "dev" | "stage" | "prod";
  apiToken?: string;
  imsOrgId?: string;
  apiKey?: string;
}
```

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
const result = await fetchCamBpaFindings({
  projectId: "<user-confirmed-cam-project-id>",
  pattern: "scheduler",
  environment: "prod"
});
```

---

## Retries and agent behavior

**MCP tool:** Often implements exponential backoff (e.g. up to 3 attempts, ~30s timeout, backoff 2s / 4s / 8s). **Confirm in server implementation** if behavior changes.

**Agent:**

1. If the failure matches [Enablement restriction errors](#enablement-restriction-errors-mandatory-handling), handle it **only** as described there (verbatim output; no retry; no silent CSV/manual fallback).
2. Check `result.success` before using `result.targets`.
3. If `pattern` was `all`, filter `targets` to the **one pattern** chosen for this session.
4. Use `className` (and any file paths the server returns) to locate Java sources.
5. On other failures, follow the **fallback chain** in the parent `SKILL.md` (MCP retry once when appropriate → user CSV → manual file list). Surface errors to the user; do not ignore tool failures.

| Situation | Retry? | Action |
|-----------|--------|--------|
| Error starts with `The MCP Server is restricted and isn't able to operate on the given` | No | [Verbatim to user](#enablement-restriction-errors-mandatory-handling); stop automatic fallback |
| Auth 401 / 403 | No | Ask for credentials or CSV |
| 404 | No | Other project or manual flow |
| Network / timeout | Once | Retry after ~2s, then fallback |
| 5xx | Once | Retry after ~2s, then fallback |
| 400 | No | Fix parameters |
| 200 empty targets | No | Manual flow or other pattern |
