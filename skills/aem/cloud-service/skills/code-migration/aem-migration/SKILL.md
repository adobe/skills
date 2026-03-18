---
name: aem-migration
description: Migrates AEM code from legacy patterns to AEM Cloud Service compatible patterns. Use when user asks to fix or migrate any of these - scheduler, scheduled task, resource change listener, ResourceChangeListener, replication, Replicator, event listener, EventListener, event handler, EventHandler, asset manager, AssetManager. Also use for BPA findings, Cloud Service migration, or AEM code modernization.
---

# AEM Code Migration

Migrates AEM Java code from legacy patterns to AEM Cloud Service compatible patterns. Each pattern has a dedicated transformation module.

## When to Use This Skill

Use this skill when you need to:
- Migrate legacy AEM Java code to Cloud Service compatible patterns
- Fix Best Practices Analyzer (BPA) findings
- Modernize AEM code for cloud deployment and scalability
- Transform specific patterns: schedulers, event listeners, replication, asset management
- Address AEM as a Cloud Service migration blockers
- Update code that uses deprecated AEM APIs or patterns

## Prerequisites

Before using this skill, ensure you have:
- ✅ Access to AEM project source code
- ✅ Best Practices Analyzer (BPA) results (optional but recommended)
- ✅ Understanding of the target migration pattern
- ✅ AEM project with proper Maven/Gradle build setup
- ✅ Knowledge of the legacy pattern being migrated

## BPA Findings — How It Works

BPA (Best Practices Analyzer) findings tell you which files need migration and which pattern applies. Follow this priority chain to obtain them.

### Source priority

1. **User provided a BPA CSV path** → Read and parse the CSV directly
2. **MCP server available** → Call `fetch-cam-bpa-findings` with the target pattern. **If MCP returns an error, STOP. Do NOT proceed to Manual Flow.**
3. **User points to specific files** → Skip BPA, use Manual Flow
4. **Nothing available** → Ask the user for a BPA CSV path or specific Java files

### What the user provides

The user may say things like:
- *"Fix scheduler issues using my BPA report at ./cleaned_file6.csv"* → You have a BPA path
- *"Fix scheduler issues"* (no path) → Try MCP, then ask
- *"Fix this file: MyScheduler.java"* → Manual flow, no BPA needed

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
  projectId: string;                    // REQUIRED - Cloud Manager project ID (e.g., "698473e4e470e603f55600fd")
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

**Example Success Response:**
```json
{
  "success": true,
  "environment": "prod",
  "projectId": "698473e4e470e603f55600fd",
  "targets": [
    {
      "pattern": "scheduler",
      "className": "com.example.schedulers.ContentSyncScheduler",
      "identifier": "org.apache.sling.commons.scheduler",
      "issue": "Uses imperative Scheduler API instead of declarative @SlingScheduled annotation",
      "severity": "high"
    }
  ],
  "summary": {
    "schedulerCount": 1
  }
}
```

**Example Error Response:**
```json
{
  "success": false,
  "error": "HTTP 401: Unauthorized",
  "errorDetails": {
    "message": "HTTP 401: Unauthorized",
    "name": "Error",
    "code": "N/A"
  },
  "troubleshooting": [
    "Check CAM API token is valid",
    "Verify network connectivity to CAM API",
    "Ensure project exists in Cloud Acceleration Manager"
  ]
}
```

#### Error Handling and Retry Strategy

**Built-in Retry Logic:**
The MCP tool implements automatic retries with exponential backoff:
- **Max retries:** 3 attempts per request
- **Timeout:** 30 seconds per request
- **Backoff:** Exponential (2^attempt seconds: 2s, 4s, 8s)
- **Abort on timeout:** If request exceeds 30s, aborts and throws `AbortError`

**Agent-Level Error Handling:**

When calling `fetch-cam-bpa-findings`, implement this error handling pattern:

1. **Check `result.success`** before accessing `result.targets`
2. **Filter `targets`** by pattern if `pattern: "all"` was used
3. **Extract `className`** from targets — these are the file paths
4. **Handle errors** according to the error category (see table below)

**Error Categories and Handling:**

| Error Type | HTTP Status | Retry? | Action |
|------------|-------------|--------|--------|
| **Authentication** | 401, 403 | ❌ No | Ask user for credentials or CSV |
| **Not Found** | 404 | ❌ No | Proceed to Manual Flow (no findings) |
| **Network/Timeout** | N/A (AbortError) | ✅ Yes (once) | Retry after 2s, then fallback |
| **Server Error** | 500, 502, 503 | ✅ Yes (once) | Retry after 2s, then fallback |
| **Invalid Request** | 400 | ❌ No | Check parameters, don't retry |
| **No Findings** | 200 (empty) | ❌ No | Proceed to Manual Flow |

**Error Handling Flow:**

```
1. Call fetch-cam-bpa-findings
   ↓
2. Check result.success
   ├─→ true → Check targets.length
   │          ├─→ > 0 → Filter by pattern → Use targets
   │          └─→ 0 → "No findings" → Fallback to Manual Flow
   │
   └─→ false → Check error type
              ├─→ Authentication (401/403) → Ask for CSV (don't retry)
              ├─→ Network/Timeout → Retry once after 2s
              │                      ├─→ Success → Use targets
              │                      └─→ Fail → Fallback to CSV/Manual
              ├─→ Server Error (5xx) → Retry once after 2s
              │                         ├─→ Success → Use targets
              │                         └─→ Fail → Fallback to CSV/Manual
              └─→ Other → Use troubleshooting array → Fallback to CSV/Manual
```

**User-Facing Error Messages:**

When errors occur, inform the user with actionable guidance:

- **Authentication Error:**
  > "Unable to authenticate with Cloud Acceleration Manager. Please either:
  > - Provide your BPA CSV report file path, or
  > - Verify your CAM API credentials are configured"

- **Network/Timeout Error:**
  > "Connection to CAM API timed out. Retrying... [if retry succeeds, continue; if fails, ask for CSV]"

- **No Findings:**
  > "No BPA findings found for pattern '[pattern]' in project '[projectId]'. Would you like to:
  > - Point me to specific Java files to migrate, or
  > - Provide a BPA CSV report?"

**Fallback Chain:**

1. **Try MCP** → If fails with retryable error, retry once
2. **If MCP fails** → Ask user for BPA CSV path
3. **If no CSV** → Proceed to Manual Flow (user points to files)
4. **If nothing available** → Ask user: *"Could you provide the path to your BPA CSV report? Or point me to the specific Java files you want to migrate."*

**Best Practices:**

- ✅ Always check `result.success` before accessing `result.targets`
- ✅ Filter `targets` by pattern if `pattern: "all"` was used
- ✅ Extract `className` from targets — these are the file paths
- ✅ Use `troubleshooting` array to help users resolve issues
- ✅ Don't retry authentication errors — ask for credentials or CSV
- ✅ Retry network/timeout errors once, then fallback
- ✅ Provide clear, actionable error messages to users

**Practical Implementation Example:**

When implementing error handling in your agent logic, follow this pattern:

```markdown
1. Call mcp_aem-migration_fetch-cam-bpa-findings with:
   - projectId: [from user or context]
   - pattern: [target pattern from Step 1]
   - environment: "prod" (or user-specified)

2. Check the response:
   - If result.success === true:
     - If result.targets.length > 0:
       - Filter targets by pattern (if pattern was "all")
       - Extract className values → these are your file paths
       - Proceed to Step 4 (Read pattern module)
     - If result.targets.length === 0:
       - Tell user: "No BPA findings found. Proceeding with Manual Flow..."
       - Ask user for specific files or CSV path
   
   - If result.success === false:
     - Check error message/errorDetails.name:
       - If "401" or "403" or "Unauthorized" or "Forbidden":
         - DO NOT RETRY
         - Tell user: "Authentication failed. Please provide BPA CSV path or verify CAM credentials."
         - Fallback to CSV/Manual Flow
       
       - If "AbortError" or "timeout" or "network" or "ECONNREFUSED":
         - Wait 2 seconds
         - RETRY ONCE with same parameters
         - If retry succeeds → use results
         - If retry fails → Tell user: "Connection failed. Please provide BPA CSV path."
         - Fallback to CSV/Manual Flow
       
       - If "404":
         - DO NOT RETRY
         - Tell user: "No findings found for this project/pattern. Proceeding with Manual Flow..."
         - Ask user for specific files
       
       - If "500" or "502" or "503":
         - Wait 2 seconds
         - RETRY ONCE
         - If retry succeeds → use results
         - If retry fails → Fallback to CSV/Manual Flow
       
       - Other errors:
         - Use result.troubleshooting array to inform user
         - Fallback to CSV/Manual Flow

3. Fallback Chain:
   - If MCP fails → Ask user: "Could you provide the path to your BPA CSV report?"
   - If no CSV → Ask user: "Could you point me to the specific Java files you want to migrate?"
   - If user provides files → Proceed with Manual Flow
```

**Example Agent Flow:**

```
User: "Fix scheduler issues"

Agent:
1. Identifies pattern: "scheduler" ✓
2. Checks pattern availability: Ready ✓
3. Gets BPA findings:
   → Calls list-projects to get available projects
   → Response: [{ id: "698473e4e470e603f55600fd", name: "my-project", description: "..." }]
   → Presents project list to user and asks: "Which project should I use?"
   → User confirms: "698473e4e470e603f55600fd"
   → Calls fetch-cam-bpa-findings({
        projectId: "698473e4e470e603f55600fd",
        pattern: "scheduler",
        environment: "prod"
      })
   
   → Response: { success: true, targets: [...] }
   → Proceeds to Step 4 (Read pattern module)

--- If MCP auth fails ---

   → Response: { success: false, error: "HTTP 401: Unauthorized" }
   
   → Checks error: Authentication error (401)
   → Does NOT retry (per error handling rules)
   → Tells user: "Unable to authenticate with Cloud Acceleration Manager. 
                  Please provide your BPA CSV report file path, or verify 
                  your CAM API credentials are configured."
   
   → User provides: "./bpa-report.csv"
   → Agent reads CSV, filters for "scheduler" pattern
   → Proceeds to Step 4 (Read pattern module)
```

### Fallback

If neither CSV nor MCP yields results, ask the user: *"Could you provide the path to your BPA CSV report? Or point me to the specific Java files you want to migrate."*

## Available Patterns

| Pattern | BPA Pattern ID | Module File | Status |
|---------|--------------|-------------|--------|
| Scheduler | `scheduler` | `references/scheduler.md` | Ready |
| Resource Change Listener | `resourceChangeListener` | `references/resource-change-listener.md` | Ready |
| Replication | `replication` | `references/replication.md` | Ready |
| Event Listener | `eventListener` | `references/event-migration.md` | Ready |
| Event Handler | `eventHandler` | `references/event-migration.md` | Ready |
| Asset Manager | `assetApi` | `references/asset-manager.md` | Ready |

## Workflow

### Rule: ONE pattern per session

**Process only ONE pattern type per session.** If the user asks to "fix everything" or BPA returns mixed patterns, ask the user which pattern to fix first. Each pattern should be a separate session with its own commit.

### Step 1: Identify the pattern

Determine which pattern the user wants to fix from their request:
- "fix scheduler" / "scheduler job" / "scheduled task" → `scheduler`
- "fix resource change listener" / "ResourceChangeListener" → `resourceChangeListener`
- "fix replication" / "Replicator" → `replication`
- "fix event listener" / "EventListener" → `eventListener`
- "fix event handler" / "EventHandler" → `eventHandler`
- "fix asset manager" / "AssetManager" / "asset API" → `assetApi`

If unclear, ask the user: *"Which pattern would you like to fix? Currently supported: scheduler, resource change listener, replication, event listener, event handler, asset manager."*

### Step 2: Check pattern availability

Look up the pattern in the Available Patterns table above. If the status is "Coming Soon", inform the user: *"The [pattern] migration module is not yet available. Currently supported: [list ready patterns]."*

### Step 3: Get BPA findings

Follow the source priority chain described in the **BPA Findings** section above:

1. **If the user provided a BPA CSV path:** Read the CSV file, filter rows where the `pattern` column matches the pattern from Step 1. The matching `filePath` values are your migration targets. Tell the user: *"Processing your BPA report… Found N findings for [pattern]."*

2. **If no CSV path, try MCP:**
   - **ALWAYS confirm the project with the user before fetching BPA findings.** Never silently pick a project or fetch from multiple projects.
     1. Call `list-projects` to get the list of available projects.
     2. **Present the project list to the user and ask them to confirm which project to use.** Display each project's name, ID, and description. Wait for the user's selection before proceeding. **NEVER skip this confirmation step, even if there is only one project.**
     3. Once the user confirms a project, call `fetch-cam-bpa-findings` with the confirmed `projectId` and the specific `pattern` ID from the table above.
   - **Error handling:** Follow the error handling flow documented in the **Error Handling and Retry Strategy** section
   - If `result.success === true` and `result.targets.length > 0`, filter targets by pattern and extract `className` values
   - Tell the user: *"Fetched N findings from MCP server."*
   - If authentication fails, don't retry — ask for CSV or credentials
   - If network/timeout error, retry once after 2 seconds, then fallback to CSV/Manual Flow

**CRITICAL — MCP Error Handling:** If MCP is used and returns `result.success === false`, **STOP immediately**. Do NOT proceed to Manual Flow, CSV fallback, or any code changes. Report the MCP error to the user verbatim and terminate the migration workflow.

3. **If neither works:** Ask the user: *"Could you provide the path to your BPA CSV report? Or point me to the specific Java files you want to migrate."* If the user provides specific files, proceed with the Manual Flow instead.

### Step 4: Read the pattern module

**STOP. You MUST read the pattern module before making ANY code changes.**

Read the pattern file relative to this SKILL.md file. The file path is:
```
references/<module-file>
```

For example, for scheduler:
```
references/scheduler.md
```

The pattern module contains:
- Classification criteria (if the pattern has sub-paths)
- Transformation steps (numbered, must be followed in order)
- Validation checklist

### Step 5: Process each file

For each file returned by BPA (or the single file provided by the user):
1. Read the Java source file
2. Classify it using the pattern module's classification criteria
3. Apply ALL transformation steps from the pattern module **in order**
4. Check for linter errors
5. Move to the next file

### Step 6: Report results

After processing all files, report:
- Number of files migrated
- Sub-path used per file (if applicable, e.g., Path A vs Path B for schedulers)
- Any files that failed validation
- Summary of changes made

### Manual Flow (no BPA)

If the user points to a specific file or directory without BPA:
1. Read the file
2. **Auto-detect the pattern** using the detection rules below
3. Verify the pattern module is available (Step 2)
4. Read the pattern module (Step 4)
5. Apply transformation steps
6. Report results

### Pattern Auto-Detection (for Manual Flow)

Scan the file's imports and class signature to identify the pattern:

| Look for | Pattern |
|----------|---------|
| `import org.apache.sling.commons.scheduler.Scheduler` or `implements Runnable` with `scheduler.schedule(` | `scheduler` |
| `implements ResourceChangeListener` | `resourceChangeListener` |
| `import com.day.cq.replication.Replicator` or `import org.apache.sling.replication.*` | `replication` |
| `implements EventListener` with `import javax.jcr.observation.*` and `onEvent(EventIterator)` | `eventListener` |
| `implements EventHandler` with `handleEvent(Event)` containing inline business logic (ResourceResolver, Session, Node operations), replication/workflow event handlers | `eventHandler` |
| `import com.day.cq.dam.api.AssetManager` with `createAsset(`, `createAssetForBinary(`, `removeAssetForBinary(`, or `adaptTo(AssetManager.class)` for create/remove | `assetApi` |

If the file matches multiple patterns, ask the user which one to fix. If no pattern matches, inform the user the file doesn't contain a known legacy pattern.

## Critical Rules (ALL Patterns)

**These rules apply to EVERY pattern module. Violation means incorrect migration.**

- **ONE PATTERN PER SESSION** — do not mix patterns in a single session
- **READ THE PATTERN MODULE FIRST** — never transform code without reading the module
- **DO** migrate Felix SCR → OSGi DS annotations when present
- **DO** replace `getAdministrativeResourceResolver()` with `getServiceResourceResolver()` when found
- **DO** replace `System.out.println` with SLF4J Logger
- **DO** use try-with-resources for ResourceResolver
- **DO** preserve environment-specific guards (e.g., `isAuthor()` run mode checks)
- **DO NOT** change business logic inside methods
- **DO NOT** rename classes unless the pattern module explicitly says to
- **DO NOT** invent values — extract from existing code
- **DO NOT** edit files not identified by BPA or the user
- **STOP ON MCP ERROR** — When `fetch-cam-bpa-findings` returns `success: false`, stop immediately. Do NOT fallback to Manual Flow or CSV. Report the error to the user and do not proceed.

## Quick Reference

### Source Priority

1. **BPA CSV file** (user-provided path) → Read and filter for target pattern
2. **MCP Server** → Live CAM data via `fetch-cam-bpa-findings`
3. **Manual Flow** → User points to specific Java files

### User-Facing Messages

| Situation | Tell the user |
|-----------|---------------|
| BPA CSV path given | *"Processing your BPA report… Found N findings for [pattern]."* |
| No CSV, MCP works | *"Fetched N findings from MCP server."* |
| Nothing available | *"Could you provide the path to your BPA CSV report? Or point me to the specific Java files you want to migrate."* |
