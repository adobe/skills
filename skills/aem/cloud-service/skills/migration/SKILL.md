---
name: aem-migration
description: Orchestrates legacy AEM Java (6.x, AMS, on-prem) to AEM as a Cloud Service migration using BPA CSV or cache, CAM/MCP target discovery, and one-pattern-per-session workflow. Use for BPA/CAM findings, Cloud Service blockers, or fixes for scheduler, ResourceChangeListener, replication, JCR observation EventListener, OSGi EventHandler, DAM AssetManager. Transformation steps are not defined here—read the aem-best-practices skill and its references/ modules in the same repository before editing code.
---

# AEM as a Cloud Service — Code Migration

**Source → target:** Legacy **AEM 6.x / AMS / on-prem** → **AEM as a Cloud Service**. Scoped under `cloud-service/migration` so this is not confused with Edge Delivery or 6.5 LTS.

This skill is **orchestration**: BPA data, CAM/MCP, **one pattern per session**, and target discovery. **Transformation rules and steps** live in **`aem-best-practices`** — read that skill and the right `references/*.md` before editing code.

**Setup:** Install **`aem-best-practices`** alongside this skill when needed so the agent can load pattern modules. Skip the extra install only if those files are already available (e.g. full `adobe/skills` checkout with resolvable `{best-practices}` paths). See this plugin’s **README** for install commands for both plugins.

## Quick start (for the person driving the agent)

**One pattern per chat/session** — if you ask to “fix everything,” the skill will ask you to pick first (e.g. scheduler vs replication).

| You have… | Say something like… | What happens |
|-----------|---------------------|--------------|
| A **BPA CSV** | *“Fix **scheduler** findings using `./path/to/bpa.csv`”* | Fastest path: CSV → cached collection → files |
| **CAM + MCP** only | *“Get **scheduler** findings from CAM; I’ll pick the project when you list them.”* | Agent lists projects → you confirm → MCP fetch ([cam-mcp.md](references/cam-mcp.md)) |
| **Just a few files** | *“Migrate **scheduler** in `core/.../MyJob.java`”* | Manual flow: no BPA required |

**Starter prompts (copy-paste):**

- *“Use the migration skill: **scheduler** only, BPA CSV at `./reports/bpa.csv`, then apply best-practices reference modules before editing.”*
- *“**Replication** only from CAM; list projects first, I’ll pick one.”*
- *“**Manual:** **event listener** migration for `.../Listener.java` — read best-practices module first.”*


## Path convention (Adobe Skills monorepo)

From the **repository root** (parent of the `skills/` directory):

| Symbol | Path |
|--------|------|
| **`{best-practices}`** | `skills/aem/cloud-service/skills/best-practices/` |

Examples: `{best-practices}/SKILL.md`, `{best-practices}/references/scheduler.md`.

## Required delegation (do this first)

1. Read **`{best-practices}/SKILL.md`** — critical rules, Java baseline links, **Pattern Reference Modules** table, **Manual Pattern Hints**.
2. Read **`{best-practices}/references/<module>.md`** for the **single** active BPA pattern (see table in that `SKILL.md`).
3. When code uses SCR, `ResourceResolver`, or console logging, read **`{best-practices}/references/scr-to-osgi-ds.md`** and **`{best-practices}/references/resource-resolver-logging.md`** (or the hub **`{best-practices}/references/aem-cloud-service-pattern-prerequisites.md`**).

Do not transform code until the pattern module is read.

## When to Use This Skill

- Migrate legacy AEM Java toward **Cloud Service–compatible** patterns
- Drive work from **BPA** (CSV or cached collection) or **CAM via MCP**
- Enforce **one pattern type per session**

## Prerequisites

- Project source and Maven/Gradle build
- BPA CSV or MCP access optional but recommended

## BPA findings — flow

Scripts run via **`getBpaFindings`** (see **Calling the helper**); do not reimplement collection logic by hand unless the helper is unavailable.

1. **Collection exists** → reuse; tell the user counts/age when useful.
2. **User gave BPA CSV path** → parse, build collection, then use targets.
3. **No CSV; MCP available** → follow [references/cam-mcp.md](references/cam-mcp.md): `list-projects`, user confirms project, then `fetch-cam-bpa-findings`.
4. **Nothing works** → ask for CSV path or explicit Java files (manual flow).

### CAM via MCP (summary)

Use **`fetch-cam-bpa-findings`** with `projectId` or `projectName` per server behavior; pass the session’s **`pattern`** or `all` (then filter to the chosen pattern). **Full tool schemas, REST notes, retries, and error handling:** [references/cam-mcp.md](references/cam-mcp.md).

### What the user might say

- *"Fix scheduler using ./reports/bpa.csv"* → CSV path known
- *"Fix scheduler"* → collection → MCP → ask for CSV
- *"Migrate `core/.../Foo.java`"* → manual flow

### Calling the helper

Scripts live under **`./scripts/`** (next to this `SKILL.md`).

```javascript
const { getBpaFindings } = require('./scripts/bpa-findings-helper.js');

const result = await getBpaFindings(pattern, {
  bpaFilePath: './cleaned_file6.csv',
  collectionsDir: './unified-collections',
  projectId: '...',
  mcpFetcher: mcpFunction
});
```

**`result`:** `success`, `source` (`'unified-collection' | 'bpa-file' | 'mcp-server' | …`), `message`, `targets` (when successful).

### Collection caching

Collections live under **`./unified-collections/`**. If a collection exists and the user supplies a **new** CSV, ask whether to reuse or re-process.

### Reading a BPA CSV

Filter rows where **`pattern`** matches the session pattern. Typical columns: `pattern`, `filePath`, `message`.

### MCP errors and fallback

If MCP fails, use the error/retry guidance in [references/cam-mcp.md](references/cam-mcp.md), then **CSV**, then **manual file paths**. Never hide tool errors from the user.

**Fallback prompt:** *"Could you provide the path to your BPA CSV report, or the specific Java files to migrate?"*

## Pattern modules

Do **not** duplicate the pattern table here. Use **`{best-practices}/SKILL.md` → Pattern Reference Modules** (`references/<file>.md`).

## Workflow

### One pattern per session

If the user asks to fix everything or BPA mixes patterns, **ask which pattern first**. Prefer one commit per pattern session.

### Step 1: Pattern id

Map the request to a BPA id: `scheduler`, `resourceChangeListener`, `replication`, `eventListener`, `eventHandler`, `assetApi`. If unclear, use **Manual Pattern Hints** in **`{best-practices}/SKILL.md`** or ask the user to pick one of those.

### Step 2: Availability

If the id is missing from the best-practices table, say the pattern is not supported yet.

### Step 3: BPA targets

Run **`getBpaFindings`** (with `bpaFilePath` when provided). Internally: cache → CSV → MCP → manual. For MCP details, [references/cam-mcp.md](references/cam-mcp.md).

### Step 4: Read before edits

**STOP.** Read **`{best-practices}/SKILL.md`** and **`{best-practices}/references/<module>.md`** for the active pattern.

### Step 5: Process each file

Read source → classify with the module → apply steps **in order** → check lints → next file.

### Step 6: Report

Summarize files touched, sub-paths, failures.

### Manual flow (no BPA)

User-named files → classify (best-practices hints or ask) → confirm module exists → read **`{best-practices}/SKILL.md`** + module → transform → report.

## Quick reference

**Source priority:** unified collection → BPA CSV → MCP → manual paths.

**User-facing snippets:** *"Using existing BPA collection (N findings)…"* / *"Processing your BPA report…"* / *"Fetched findings from CAM."* / fallback prompt above.

### CLI (development only)

From this skill’s directory:

```bash
node scripts/bpa-findings-helper.js scheduler ./unified-collections
node scripts/bpa-findings-helper.js scheduler ./unified-collections ./cleaned_file6.csv
node scripts/unified-collection-reader.js all ./unified-collections
```
