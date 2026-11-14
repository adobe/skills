# The BPA findings helper

`scripts/bpa-findings-helper.js` returns the migration targets for one pattern, one batch at a
time. The skill's workflow (`SKILL.md`, Step 3) calls it; this file has the call, its result and
the command line for development.

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
