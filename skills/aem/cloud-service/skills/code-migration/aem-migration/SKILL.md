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

The skill handles BPA data automatically. You never need to run scripts manually.

### Flow

1. **Collection already exists?** → Use it directly. Inform user: *"Using existing BPA collection (N findings, created X ago)"*
2. **No collection, but user provided BPA CSV path?** → Parse the CSV, create the collection, then use it. Inform user: *"Processing your BPA report... Created collection with N findings."*
3. **No collection, no BPA path, but MCP available?** → Fetch from MCP server.
4. **Nothing available?** → Ask user for a BPA CSV file path, or proceed with manual flow on specific files.

### What the user provides

The user may say things like:
- *"Fix scheduler issues using my BPA report at ./cleaned_file6.csv"* → You have a BPA path
- *"Fix scheduler issues"* (no path) → Check for existing collection, then MCP, then ask
- *"Fix this file: MyScheduler.java"* → Manual flow, no BPA needed

### Calling the helper

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

## Available Patterns

| Pattern | BPA Pattern ID | Module File | Status |
|---------|--------------|-------------|--------|
| Scheduler | `scheduler` | `resources/scheduler.md` | Ready |
| Resource Change Listener | `resourceChangeListener` | `resources/resource-change-listener.md` | Ready |
| Replication | `replication` | `resources/replication.md` | Ready |
| Event Listener | `eventListener` | `resources/event-migration.md` | Ready |
| Event Handler | `eventHandler` | `resources/event-migration.md` | Ready |
| Asset Manager | `assetApi` | `resources/asset-manager.md` | Ready |

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

Call the BPA findings helper. It handles everything automatically:

```javascript
const { getBpaFindings } = require('./scripts/bpa-findings-helper.js');

const result = await getBpaFindings(pattern, {
  bpaFilePath: userProvidedPath,  // if user gave a CSV path
  collectionsDir: './unified-collections'
});
```

**What happens inside (you do NOT need to run these manually):**
1. Existing collection found → uses it, tells user *"Using existing BPA collection…"*
2. No collection + BPA CSV path given → parses CSV, creates collection, tells user *"Processing your BPA report…"*
3. No collection + no CSV → tries MCP server (`mcp_aem-migration-mcp_fetch-cam-bpa-findings`)
4. Nothing available → returns error; proceed to Manual Flow

**Important:** If the user provides a BPA CSV path AND a collection already exists, ask the user whether to use the existing collection or re-process the new file.

If `result.success` is `false` and no BPA path was provided, ask: *"Could you provide the path to your BPA CSV report? Or point me to the specific Java files you want to migrate."*

### Step 4: Read the pattern module

**STOP. You MUST read the pattern module before making ANY code changes.**

Read the pattern file from this skill's directory. The file path is:
```
.cursor/skills/aem-migration/references/<module-file>
```

For example, for scheduler:
```
.cursor/skills/aem-migration/references/scheduler.md
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

## Quick Reference

### Source Priority

1. **Existing unified collection** → Instant, no re-processing
2. **BPA CSV file** (user-provided path) → One-time processing, then cached
3. **MCP Server** → Live CAM data (requires projectId)
4. **Manual Flow** → User points to specific Java files

### User-Facing Messages

| Situation | Tell the user |
|-----------|---------------|
| Collection exists, pattern found | *"Using existing BPA collection (N findings, created X ago)"* |
| No collection, BPA path given | *"Processing your BPA report… Found N findings for [pattern]."* |
| Collection exists + new BPA path given | *"An existing collection was found. Use it or re-process the new BPA report?"* |
| No collection, no BPA path, MCP works | *"Fetched findings from MCP server."* |
| Nothing available | *"Could you provide the path to your BPA CSV report?"* |

### CLI Testing (development only)

```bash
# Test with existing collection
node scripts/bpa-findings-helper.js scheduler ./unified-collections

# Test with BPA file (creates collection if missing)
node scripts/bpa-findings-helper.js scheduler ./unified-collections ./cleaned_file6.csv

# Verify what's in a collection
node scripts/unified-collection-reader.js all ./unified-collections
```
