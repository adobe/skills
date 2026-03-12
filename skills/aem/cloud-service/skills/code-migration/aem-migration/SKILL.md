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
2. **MCP server available** → Call `fetch-cam-bpa-findings` with the target pattern
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

If no CSV is available, try fetching findings from the MCP server:
- Call `fetch-cam-bpa-findings` with `pattern` set to the target pattern (e.g., `scheduler`, `assetApi`, or `all`)
- The response contains an array of findings with file paths and pattern IDs
- Filter findings for the target pattern if you fetched `all`

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

2. **If no CSV path, try MCP:** Call `fetch-cam-bpa-findings` with the target pattern. If results are returned, use them. Tell the user: *"Fetched N findings from MCP server."*

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
