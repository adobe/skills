---
name: aem-cloud-service-migration
description: Migrates AEM code from legacy (6.x, AMS, on-prem) to AEM as a Cloud Service. Use for BPA findings, CAM/MCP, Cloud Service migration blockers, or fixing scheduler, scheduled task, resource change listener, ResourceChangeListener, replication, Replicator, event listener, EventListener, event handler, EventHandler, asset manager, AssetManager. Always combine with the aem-cloud-service-best-practices skill for transformations.
---

# AEM as a Cloud Service — Code Migration

**Source → target:** Legacy **AEM 6.x / AMS / on-prem** → **AEM as a Cloud Service**. This path is explicit under `cloud-service/migration` so “migration” is not confused with other Adobe routes (for example Edge Delivery or 6.5 LTS).

This skill is **orchestration**: BPA data, CAM/MCP, one-pattern-per-session workflow, and finding files to change. **Platform rules and transformation steps** live in **`aem-cloud-service-best-practices`** — read it before any code edits.

## Required delegation (do this first)

1. **Read** `skills/aem/cloud-service/skills/aem-cloud-service-best-practices/aem-cloud-service-best-practices/SKILL.md` — critical rules, Java baseline index, and pattern overview.
2. **Read** the pattern module for the active pattern from  
   `skills/aem/cloud-service/skills/aem-cloud-service-best-practices/aem-cloud-service-best-practices/references/`  
   (see **Available pattern modules** below).
3. **As needed**, read `references/scr-to-osgi-ds.md` and `references/resource-resolver-logging.md` (or the hub `references/aem-cloud-service-pattern-prerequisites.md`) — same as **§ Java / OSGi baseline** in the best-practices `SKILL.md`.

**Do not transform code** until the pattern module is read; apply those prerequisite modules when the code touches SCR, resolvers, or logging.

## When to Use This Skill

- Migrate legacy AEM Java code **to Cloud Service** compatible patterns
- Drive work from **Best Practices Analyzer (BPA)** findings or **CAM** data
- Use **one pattern type per session** (see workflow)

## Prerequisites

- Access to AEM project source code
- BPA results optional but recommended (CSV or CAM via MCP)
- Maven/Gradle build for the project

## BPA Findings — How It Works

The skill handles BPA data automatically. You never need to run scripts manually.

### Flow

1. **Collection already exists?** → Use it directly. Inform user: *"Using existing BPA collection (N findings, created X ago)"*
2. **No collection, but user provided BPA CSV path?** → Parse the CSV, create the collection, then use it. Inform user: *"Processing your BPA report... Created collection with N findings."*
3. **No collection, no BPA path, but MCP available?** → Call the AEM Cloud Migration MCP tool **`fetch-cam-bpa-findings`** (see **Cloud Adoption Service (CAM) via MCP** below).
4. **Nothing available?** → Ask user for a BPA CSV file path, or proceed with manual flow on specific files.

### Cloud Adoption Service (CAM) via MCP

When step 3 applies, use **`fetch-cam-bpa-findings`** with either `projectId` or `projectName` (the tool resolves names via CAM). Optional: `pattern` (`scheduler`, `assetApi`, `eventListener`, `resourceChangeListener`, `eventHandler`, or `all`).

Under the hood the MCP server calls **Adobe AEM Cloud Adoption Service**:

- **`GET {base}/projects`** — list projects for the authenticated IMS org; match `projectName` to obtain `projectId`.
- **`GET {base}/projects/{projectId}/bpaReportCodeTransformerData/subtype/{subtype}`** — aggregated identifiers per BPA subtype (e.g. `sling.commons.scheduler` for scheduler findings).

Requests require Adobe IO auth: `Authorization: Bearer …`, `x-api-key`, and `x-gw-ims-org-id` (typically `ident@AdobeOrg`). The tool maps each `pattern` to the subtype string the service expects.

Reference (maintainers): `aemcs-migration-mcp/docs/cam-cloud-adoption-api-contract.md` and `aem-cloud-adoption-service` controllers `ProjectController`, `BpaReportCodeTransformerDataController`.

### What the user provides

The user may say things like:

- *"Fix scheduler issues using my BPA report at ./cleaned_file6.csv"* → You have a BPA path
- *"Fix scheduler issues"* (no path) → Check for existing collection, then MCP, then ask
- *"Fix this file: MyScheduler.java"* → Manual flow, no BPA needed

### Calling the helper

Scripts live next to this skill under `./scripts/`.

```javascript
const { getBpaFindings } = require('./scripts/bpa-findings-helper.js');

const result = await getBpaFindings(pattern, {
  bpaFilePath: './cleaned_file6.csv',   // optional — from user
  collectionsDir: './unified-collections', // default location
  projectId: '...',                      // optional — for MCP fallback
  mcpFetcher: mcpFunction               // optional — MCP function
});
```

The `result` object contains:

- `success` — whether findings were loaded
- `source` — where data came from: `'unified-collection'`, `'bpa-file'`, `'mcp-server'`, or error types
- `message` — human-readable status to show the user
- `targets` — array of findings (when successful)

### Collection caching

Once a collection is created from a BPA CSV, it is saved to `./unified-collections/`. On subsequent runs the skill reuses it instantly without re-parsing. If the user provides a **new** BPA file path when a collection already exists, ask: *"An existing collection was found. Would you like to use it or re-process the new BPA report?"*

### Reading a BPA CSV

When the user provides a CSV path, read the file and extract rows matching the target pattern. Each row typically contains:

- **pattern** — the BPA pattern ID (e.g., `scheduler`, `replication`)
- **filePath** — path to the Java source file that needs migration
- **message** — description of the finding

Filter rows where the `pattern` column matches the pattern identified in Step 1. The matching rows are your migration targets.

### Using MCP server

If no CSV is available, try fetching findings from the MCP server. **Always list projects first and confirm with the user before fetching findings.**

#### API Contract

**Tool Name:** `list-projects`

Lists all available CAM projects. **Call this first** to present the user with available projects for confirmation.

**Response Schema:**

```typescript
{
  success: true;
  projects: Array<{
    id: string;          // Project ID (e.g., "698473e4e470e603f55600fd")
    name: string;        // Human-readable project name
    description: string; // Project description
  }>;
}
```

---

**Tool Name:** `fetch-cam-bpa-findings`

**Request Schema:**

```typescript
{
  projectId: string;                    // REQUIRED - Cloud Acceleration Manager project ID (e.g., "698473e4e470e603f55600fd")
  pattern?: "scheduler" | "assetApi" | "all";  // OPTIONAL - Default: "all"
  environment?: "dev" | "stage" | "prod";       // OPTIONAL - Default: "prod"
  apiToken?: string;                    // OPTIONAL - Falls back to CAM_API_TOKEN or ACCESS_TOKEN env var
  imsOrgId?: string;                    // OPTIONAL - Falls back to IMS_ORG_ID env var
  apiKey?: string;                      // OPTIONAL - Falls back to API_KEY env var (default: "aem_cloud_adoption_service")
}
```

**Response Schema:**

```typescript
// Success Response
{
  success: true;
  environment: "dev" | "stage" | "prod";
  projectId: string;
  targets: Array<{
    pattern: string;              // "scheduler" | "assetApi"
    className: string;            // Fully qualified class name (e.g., "com.example.MyScheduler")
    identifier: string;           // Specific API identifier (e.g., "org.apache.sling.commons.scheduler")
    issue: string;               // Human-readable description
    severity: "high" | "critical";
  }>;
  summary: {
    schedulerCount?: number;     // Count of scheduler findings
    assetApiCount?: number;      // Count of assetApi findings
  };
}

// Error Response
{
  success: false;
  error: string;                 // Human-readable error message
  errorDetails?: {
    message: string;
    name: string;                // Error type (e.g., "AbortError", "TypeError")
    code: string;                // Error code if available
  };
  troubleshooting?: string[];    // Array of troubleshooting steps
  suggestion?: string[];         // Array of suggestions to resolve
}
```

**Example Request:**

```javascript
const result = await fetchCamBpaFindings({
  projectId: "698473e4e470e603f55600fd",
  pattern: "scheduler",
  environment: "prod"
});
```

#### Error Handling and Retry Strategy

**Built-in Retry Logic (MCP tool):** automatic retries with exponential backoff (max 3 attempts, 30s timeout, backoff 2s / 4s / 8s).

**Agent-level handling when calling `fetch-cam-bpa-findings`:**

1. Check `result.success` before accessing `result.targets`
2. Filter `targets` by pattern if `pattern: "all"` was used
3. Extract `className` from targets — migration targets
4. On failure, use the **fallback chain** (MCP retry once if appropriate → CSV → manual files); see table below

| Error Type | HTTP Status | Retry? | Action |
|------------|-------------|--------|--------|
| **Authentication** | 401, 403 | No | Ask user for credentials or CSV |
| **Not Found** | 404 | No | Manual flow or other project |
| **Network/Timeout** | N/A (AbortError) | Yes (once) | Retry after 2s, then fallback |
| **Server Error** | 500, 502, 503 | Yes (once) | Retry after 2s, then fallback |
| **Invalid Request** | 400 | No | Fix parameters |
| **No Findings** | 200 (empty) | No | Manual flow |

**Fallback chain:**

1. MCP (with retry where appropriate) → 2. User BPA CSV path → 3. User points to Java files (manual flow)

Report MCP errors clearly to the user; then offer CSV or manual file paths — do not silently ignore tool failures.

### Fallback

If neither CSV nor MCP yields results, ask the user: *"Could you provide the path to your BPA CSV report? Or point me to the specific Java files you want to migrate."*

## Pattern modules

Use the **Pattern Reference Modules** table in `skills/aem/cloud-service/skills/aem-cloud-service-best-practices/aem-cloud-service-best-practices/SKILL.md` (BPA pattern id → entry `references/<file>.md`). Resolve files from:

`skills/aem/cloud-service/skills/aem-cloud-service-best-practices/aem-cloud-service-best-practices/references/`

## Workflow

### Rule: ONE pattern per session

**Process only ONE pattern type per session.** If the user asks to "fix everything" or BPA returns mixed patterns, ask the user which pattern to fix first. Each pattern should be a separate session with its own commit.

### Step 1: Identify the pattern

From the user request:

- "fix scheduler" / "scheduler job" / "scheduled task" → `scheduler`
- "fix resource change listener" / "ResourceChangeListener" → `resourceChangeListener`
- "fix replication" / "Replicator" → `replication`
- "fix event listener" / "EventListener" → `eventListener`
- "fix event handler" / "EventHandler" → `eventHandler`
- "fix asset manager" / "AssetManager" / "asset API" → `assetApi`

If unclear, ask: *"Which pattern would you like to fix? Currently supported: scheduler, resource change listener, replication, event listener, event handler, asset manager."*

### Step 2: Check pattern availability

If the pattern is not listed in the best-practices **Pattern Reference Modules** table, inform the user it is not available yet.

### Step 3: Get BPA findings

Call **`getBpaFindings`** as in **Calling the helper** above (pass `bpaFilePath` when the user supplied a CSV path).

**Inside the helper (do not run manually):**

1. Existing collection found → use it
2. No collection + BPA CSV path → parse, create collection
3. No collection + no CSV → try MCP (`fetch-cam-bpa-findings`)
4. Nothing available → error / manual flow

**MCP:** **Always confirm the project with the user before fetching BPA findings** — call `list-projects`, show name/id/description, wait for selection (even if only one project). Then call `fetch-cam-bpa-findings` with confirmed `projectId` and the BPA pattern id from the best-practices pattern table.

If `result.success` is `false` and no BPA path was provided, ask for a CSV path or specific files per **Fallback chain** above.

### Step 4: Read the best-practices skill and pattern module

**STOP. Read before ANY code changes.**

1. `skills/aem/cloud-service/skills/aem-cloud-service-best-practices/aem-cloud-service-best-practices/SKILL.md`
2. The pattern’s `references/<module-file>` from that skill’s **Pattern Reference Modules** table (same directory as `references/aem-cloud-service-pattern-prerequisites.md`)

### Step 5: Process each file

For each file from BPA or the user:

1. Read the Java source
2. Classify using the pattern module
3. Apply transformation steps **in order**
4. Check for linter errors
5. Next file

### Step 6: Report results

Report files migrated, sub-paths if any, failures, and summary.

### Manual Flow (no BPA)

1. Read the file(s) the user named
2. Auto-detect pattern using the **best-practices** skill classification table (or ask)
3. Confirm pattern module exists
4. Read best-practices `SKILL.md` + pattern module
5. Apply transformations
6. Report results

## Quick Reference

### Source Priority

1. Existing unified collection → reuse
2. BPA CSV (user path) → parse once, cache
3. MCP / CAM → live data
4. Manual → user-specified files

### User-Facing Messages

| Situation | Tell the user |
|-----------|---------------|
| Collection exists, pattern found | *"Using existing BPA collection (N findings, created X ago)"* |
| No collection, BPA path given | *"Processing your BPA report… Found N findings for [pattern]."* |
| Collection exists + new BPA path | *"An existing collection was found. Use it or re-process the new BPA report?"* |
| MCP succeeded | *"Fetched findings from CAM."* |
| Nothing available | *"Could you provide the path to your BPA CSV report?"* |

### CLI Testing (development only)

From the directory that contains this skill’s `scripts/`:

```bash
node scripts/bpa-findings-helper.js scheduler ./unified-collections
node scripts/bpa-findings-helper.js scheduler ./unified-collections ./cleaned_file6.csv
node scripts/unified-collection-reader.js all ./unified-collections
```
