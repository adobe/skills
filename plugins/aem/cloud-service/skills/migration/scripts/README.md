# BPA Local Collection Scripts

Scripts for managing BPA (Best Practices Analyzer) findings locally. The skill handles these automatically — you should not need to run them manually during normal use.

## How It Works

When the skill needs BPA findings, it calls `bpa-findings-helper.js` which handles everything:

```
User provides BPA CSV path?
        │
   ┌────┴────────────────────────────────────┐
   │                                          │
   ▼                                          ▼
Collection already exists?              No CSV path given
   ┌────┴────┐                           ┌────┴────┐
  YES        NO                         YES        NO
   │          │                          │          │
   ▼          ▼                      Collection    Try MCP
 Use it    Parse CSV &               exists?       server
 directly  create collection         Use it      or ask user
```

**Key behavior:**
- BPA CSV files are parsed **once** and saved as a unified collection
- Subsequent runs reuse the existing collection instantly
- If a new BPA file is provided when a collection exists, the skill asks the user which to use

## Scripts

### `runbook-generator.js` (review / scan entry point)

Generates a read-only `migration-runbook.md` covering the **BPA-addressed** patterns (`scheduler`, `resourceChangeListener`, `event-migration`, `assetApi`, `replication`). Triggered by broad prompts like "review my code for AEMaaCS migration".

Runs a **per-pattern detection cascade** — for each pattern, the highest available source wins:

```
BPA / CAM (MCP) → CSV (uploaded/cached) → analyzer (local fallback) → LLM scan (last resort, agent-driven)
```

`replication` has no BPA/CSV mapping, so it always falls through to the analyzer.

```javascript
const { generateRunbook, renderRunbook } = require('./scripts/runbook-generator.js');

const result = await generateRunbook({
  workspaceRoot: '/path/to/project',         // analyzer tier
  bpaFilePath: './reports/bpa.csv',          // optional (CSV tier)
  collectionsDir: './unified-collections',   // default
  projectId, mcpFetcher,                     // optional (MCP tier)
  outputPath: './migration-runbook.md',      // default
});

// result.totalFindings → total across patterns
// result.patternCounts → { scheduler: 12, replication: 1, … }
// result.needsLlmScan  → patterns no deterministic source could scan (tier 4)
// result.gathered      → { findingsByPattern, sourceByPattern, … } for re-render after an LLM scan
```

**CLI:**
```bash
node scripts/runbook-generator.js <workspaceRoot> [--csv <bpaFilePath>] [--out <outputPath>]
```

### `analyzer-runner.js`

Wraps the code-assessment deterministic analyzer (`../../code-assessment/scripts/analyze.sh`). Runs it once over a workspace, parses the `{ findings, warnings }` JSON, and normalizes analyzer slugs (`resource-change-listener`, `event-migration`, `asset-manager`, …) into the migration canonical pattern ids. Used internally by `runbook-generator.js`. Returns `{ ok: false }` when the analyzer can't run (missing script, no JDK, compile error) so the cascade falls through to the LLM-scan tier.

### `bpa-findings-helper.js` (main entry point)

Orchestrates finding BPA data. Called by the skill internally.

```javascript
const { getBpaFindings } = require('./scripts/bpa-findings-helper.js');

const result = await getBpaFindings('scheduler', {
  bpaFilePath: './cleaned_file6.csv',     // optional
  collectionsDir: './unified-collections', // default
  projectId: '...',                        // optional, for MCP
  mcpFetcher: mcpFunction                  // optional, for MCP
});

// result.success  → true/false
// result.source   → 'unified-collection' | 'bpa-file' | 'mcp-server' | error
// result.message  → human-readable status string
// result.targets  → array of BPA findings (when successful)
```

### `bpa-local-parser.js`

Parses BPA CSV files and creates unified collections. Used internally by the helper, but can also be run directly:

```bash
node bpa-local-parser.js <bpa-csv-file-path> [output-directory]
```

### `unified-collection-reader.js`

Reads unified collections and returns findings. Used internally by the helper, but can also be run directly:

```bash
node unified-collection-reader.js [pattern] [collections-directory]
```

## Testing

```bash
# From the scripts directory
cd scripts
npm run parse-bpa -- <bpa-file-path> [output-dir]
npm run read-unified -- [pattern] [collections-dir]
```

## File Formats

### Input: BPA CSV

```csv
code,type,subtype,importance,identifier,message,context
DG,development.guideline,unsupported.asset.api,MAJOR,com.example.MyClass,Uses deprecated API...
```

### Output: Unified Collection (`unified-collection.json`)

Matches the cloud-adoption-service format with MongoDB-safe field names (dots → underscores). Includes metadata (timestamp, totalFindings) for display:

```json
{
  "subtypes": {
    "unsupported_asset_api": {
      "com_day_cq_dam_api_AssetManager_createAsset": [
        "com.example.MyClass"
      ]
    }
  },
  "meta": {
    "timestamp": "2026-03-18T06:16:37.755Z",
    "source": "local-bpa-parser",
    "totalFindings": 1,
    "subtypeCount": 1
  }
}
```

## Supported Patterns

| Pattern | BPA Subtype |
|---------|------------|
| scheduler | sling.commons.scheduler |
| assetApi | unsupported.asset.api |
| eventListener | javax.jcr.observation.EventListener |
| resourceChangeListener | org.apache.sling.api.resource.observation.ResourceChangeListener |
| eventHandler | org.osgi.service.event.EventHandler |
