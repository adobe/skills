---
name: migration
description: Orchestrates legacy AEM (6.x, AMS, on-prem) to AEM as a Cloud Service migration using BPA CSV or cache, CAM/MCP target discovery, and one-pattern-per-session workflow. Use for BPA/CAM findings, Cloud Service blockers, or fixes for scheduler, ResourceChangeListener, replication, EventListener, OSGi EventHandler, DAM AssetManager, HTL data-sly-test lint. OSGi configs → Cloud Manager — scan ui.config, .cfg.json, secrets, $[secret:]/$[env:] — agent follows references/osgi-cfg-json-cloud-manager.md when prompted. Transformation steps live in the best-practices skill—read it and the right references/ modules before editing code.
license: Apache-2.0
---

# AEM as a Cloud Service — Code Migration

**Source → target:** Legacy **AEM 6.x / AMS / on-prem** → **AEM as a Cloud Service**. Scoped under `skills/aem/cloud-service/skills/migration/` so this is not confused with Edge Delivery or 6.5 LTS.

This skill is **orchestration**: BPA data, CAM/MCP, **one pattern per session**, and target discovery. **Transformation rules and steps** live in the **`best-practices`** skill — read that skill and the right `references/*.md` before editing code.

**Setup:** Use the **`aem-cloud-service`** install (see repository root **README**) so both **migration** and **best-practices** paths are available. If you already have the monorepo open with resolvable `{best-practices}` paths, no separate install step is required.

## AEM Project Bootstrap Check

> Before running this skill, check if `AGENTS.md` exists at the **workspace root**.
>
> | Status | Action |
> |--------|--------|
> | `AGENTS.md` **exists** | Continue with this skill. |
> | `AGENTS.md` **missing** and `ensure-agents-md` skill is available | Run `ensure-agents-md` first, then return to this skill. |
> | `AGENTS.md` **missing** and `ensure-agents-md` is not installed | Tell the user: *"For optimal project guidance, install the `ensure-agents-md` skill to bootstrap AGENTS.md before using this skill."* Then continue. |

## Quick start (for the person driving the agent)

**One pattern per chat/session** — if you ask to "fix everything," the skill will ask you to pick first (e.g. scheduler vs replication vs htlLint).

| You have… | Say something like… | What happens |
|-----------|---------------------|--------------|
| A **BPA CSV** | *"Fix **scheduler** findings using `./path/to/bpa.csv`"* | Fastest path: CSV → cached collection → files |
| **CAM + MCP** only | *"Get **scheduler** findings from CAM; I'll pick the project when you list them."* | Agent lists projects → you confirm → MCP fetch ([cam-mcp.md](references/cam-mcp.md)) |
| **Just a few files** | *"Migrate **scheduler** in `core/.../MyJob.java`"* | Manual flow: no BPA required |
| **OSGi → Cloud Manager** | *"**Scan my config files and create Cloud Manager environment secrets or variables.**"* | Agent **auto-reads** [references/osgi-cfg-json-cloud-manager.md](references/osgi-cfg-json-cloud-manager.md) (full Adobe-aligned rules inlined there); no BPA pattern id |
| **HTL lint warnings** | *"Fix **htlLint** issues in `ui.apps`"* | Proactive discovery via `rg` → fix per reference module |

**Starter prompts (copy-paste):**

- *"Use the migration skill: **scheduler** only, BPA CSV at `./reports/bpa.csv`, then apply best-practices reference modules before editing."*
- *"**Replication** only from CAM; list projects first, I'll pick one."*
- *"**Manual:** **event listener** migration for `.../Listener.java` — read best-practices module first."*
- *"Scan my config files and create Cloud Manager environment secrets or variables."*
- *"Fix **htlLint** in `ui.apps` — scan for `data-sly-test` redundant constant warnings and fix them."*


## Path convention (Adobe Skills monorepo)

From the **repository root** (parent of the `skills/` directory):

| Symbol | Path |
|--------|------|
| **`{best-practices}`** | `skills/aem/cloud-service/skills/best-practices/` |

Examples: `{best-practices}/SKILL.md`, `{best-practices}/references/scheduler.md`.

## Workspace scope (IDE) — user code only

Applies to **finding and editing the user's AEM project** (Java, bundles, config, HTL), not to reading installed skill files under `{best-practices}`.

- Treat the **current IDE workspace root folder(s)** (single- or multi-root) as the **only** boundary for searches, globs, `grep`, and file reads/writes for migration targets.
- **Do not** search parent directories, sibling folders on disk, `~`, other clones, or arbitrary absolute paths to "discover" sources unless the user **explicitly** names those paths or asks you to include them.
- **BPA CSV / CAM targets:** If a `filePath` or class-to-file mapping does not resolve under a workspace root, **stop** and tell the user which paths are missing — do not hunt elsewhere on the filesystem. Ask them to open the correct project in the IDE or adjust paths.
- **Manual flow:** Only migrate files the user named that live under the workspace (or paths they explicitly provided). Do not expand scope by searching outside the workspace.

## Required delegation (do this first)

**Branch A — OSGi configs → Cloud Manager** (no Java BPA pattern this session): If the user asks to **scan config files**, **create / set up Cloud Manager environment secrets or variables**, move **passwords or secrets** out of **OSGi / `.cfg.json` / `ui.config`**, or mentions **`$[secret:]`** / **`$[env:]`** for AEM CS, then **read [references/osgi-cfg-json-cloud-manager.md](references/osgi-cfg-json-cloud-manager.md) immediately** and follow the **product rules and workflow** defined in that file (Adobe AEM as a Cloud Service OSGi + Cloud Manager behavior is reproduced there—no external doc URL required). Sleek prompts are enough — **no** need to name the reference file. **Skip** branch B for that work.

**Branch B — Java / HTL / BPA pattern migration:**

1. Read **`{best-practices}/SKILL.md`** — critical rules, Java baseline links, **Pattern Reference Modules** table, **Manual Pattern Hints**.
2. Read **`{best-practices}/references/<module>.md`** for the **single** active pattern (see table in that `SKILL.md`).
3. When code uses SCR, `ResourceResolver`, or console logging, read **`{best-practices}/references/scr-to-osgi-ds.md`** and **`{best-practices}/references/resource-resolver-logging.md`** (or the hub **`{best-practices}/references/aem-cloud-service-pattern-prerequisites.md`**).

Do not transform **Java or HTL** until the pattern module is read (branch B). Branch A does not require `{best-practices}` pattern modules.

## When to Use This Skill

- Migrate legacy AEM Java toward **Cloud Service–compatible** patterns
- Fix **HTL (Sightly)** lint warnings (`data-sly-test: redundant constant value comparison`) across component templates
- Drive work from **BPA** (CSV or cached collection) or **CAM via MCP**
- Enforce **one pattern type per session**
- **OSGi → Cloud Manager:** **Branch A** — scan scoped **`.cfg.json`**, apply **`$[secret:…]`** / **`$[env:…]`** per rules in **[references/osgi-cfg-json-cloud-manager.md](references/osgi-cfg-json-cloud-manager.md)**; gitignored handoff; **no** secret values in chat.

### OSGi configs and Cloud Manager (no BPA pattern id)

Sleek user prompts are enough (see Quick start). **Agent:** **Branch A** → read the reference → **One-prompt workflow**; obey the **inlined Adobe AEM CS rules** in that file (value types, placeholders, CM API/CLI, custom-properties-only, repoinit, runmode context, local SDK secrets). Ambiguous or Adobe-owned PIDs → **`needs_user_review`**, not guesses.

## Prerequisites

- Project source and Maven/Gradle build
- BPA CSV or MCP access optional but recommended
- For **htlLint**: `ui.apps` or equivalent content package with `.html` HTL templates

## BPA findings — flow

Scripts run via **`getBpaFindings`** (see **Calling the helper**); do not reimplement collection logic by hand unless the helper is unavailable.

The helper has **two independent paths**, chosen by what the caller configures:

1. **MCP configured** (`mcpFetcher` + `projectId` passed) → first call fetches all findings
   from MCP and caches them to `<collectionsDir>/mcp/<projectId>/<pattern>.json`.
   Every call (first and subsequent) reads from the MCP cache and returns one batch.
2. **MCP not configured, BPA CSV provided** → first call parses the CSV and writes the
   unified-collection JSON to `<collectionsDir>/unified-collection.json`.
   Every call reads from the CSV cache and returns one batch.

The two caches are disjoint — MCP sessions and CSV sessions never shadow each other. If
neither is configured, the helper reports `no-source` and the agent asks for one.

**Batching is mandatory on every path.** `getBpaFindings` returns findings **in batches of 5
by default** with a `paging` envelope:

```ts
result.targets   // this batch (length <= limit)
result.paging    // { total, returned, offset, limit, nextOffset, hasMore }
```

Process one batch at a time; stop after each batch and report progress to the user; resume on
the user's go-ahead by re-calling the helper with `offset: paging.nextOffset`. See
**Batched processing (batch size 5)** below.

**Note:** `htlLint` does **not** appear in BPA CSV — it uses proactive `rg` discovery instead. See **htlLint flow** below.

### CAM via MCP (summary)

Use **`fetch-cam-bpa-findings`** only after **`list-projects`** and **explicit user confirmation** of which project row to use (prefer **`projectId`** from that list). Do not pass an unconfirmed project name string. **Full tool schemas, REST notes, retries, and error handling:** [references/cam-mcp.md](references/cam-mcp.md).

### What the user might say

- *"Fix scheduler using ./reports/bpa.csv"* → CSV path known
- *"Fix scheduler"* → collection → MCP → ask for CSV
- *"Migrate `core/.../Foo.java`"* → manual flow
- *"Fix htlLint in ui.apps"* → proactive discovery flow

### Calling the helper

Scripts live under **`./scripts/`** (next to this `SKILL.md`).

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

### Collection caching

Collections live under **`./unified-collections/`**. If a collection exists and the user supplies a **new** CSV, ask whether to reuse or re-process.

### Reading a BPA CSV

Filter rows where **`pattern`** matches the session pattern. Typical columns: `pattern`, `filePath`, `message`.

### MCP errors and fallback

**Critical:** On MCP failure, **stop the workflow immediately** and give the user the **exact tool error message** (verbatim), including "not found" / 404-style project errors. **Do not** continue with migration steps, infer a different CAM project from the workspace, or switch to manual/local migration on your own.

**Exception:** enablement restriction errors (prefix documented in [references/cam-mcp.md](references/cam-mcp.md)) must be shown **verbatim** with no paraphrase and no automatic fallback until the user addresses them.

After stopping, you may summarize what failed in plain language and, if helpful, re-show projects from **`list-projects`**. **Only** continue when the user **explicitly** directs the next step (e.g. correct project id/name from the list, BPA CSV path, or specific Java files for manual flow).

For retries, error categories, and when user-directed CSV/manual paths are allowed, follow [references/cam-mcp.md](references/cam-mcp.md); still **no silent fallback**. Never hide tool errors from the user.

**Optional prompt after stop (user must reply):** *"Reply with the CAM project to use (id or name from the list), a path to your BPA CSV, or the Java files for a manual migration."*

## Pattern modules

Do **not** duplicate the pattern table here. Use **`{best-practices}/SKILL.md` → Pattern Reference Modules** (`references/<file>.md`).

## Workflow

### One pattern per session

If the user asks to fix everything or BPA mixes patterns, **ask which pattern first**. Prefer one commit per pattern session.

### Step 1: Pattern id

If the request is **OSGi configs → Cloud Manager** (see **Required delegation**, branch A), do **not** map to a BPA pattern — follow [references/osgi-cfg-json-cloud-manager.md](references/osgi-cfg-json-cloud-manager.md) instead.

Otherwise map the request to a pattern id: `scheduler`, `resourceChangeListener`, `replication`, `eventListener`, `eventHandler`, `assetApi`, `htlLint`. If unclear, use **Manual Pattern Hints** in **`{best-practices}/SKILL.md`** or ask the user to pick one of those.

### Step 2: Availability

If the id is missing from the best-practices table, say the pattern is not supported yet.

### Step 3: Targets

**For BPA patterns** (`scheduler`, `resourceChangeListener`, `replication`, `eventListener`, `eventHandler`, `assetApi`): Run **`getBpaFindings`** (with `bpaFilePath` when provided). Internally: cache → CSV → MCP → manual **only when each step is applicable and succeeds**; if MCP fails, obey **MCP errors and fallback** (stop; no silent chain). For MCP details, [references/cam-mcp.md](references/cam-mcp.md).

`getBpaFindings` returns **a batch of 5 findings** (default `limit=5`) along with a `paging`
envelope. The agent processes that batch only; it does **not** request the next batch until
the user says to continue. See **Batched processing (batch size 5)** below.

**For `htlLint`**: Skip BPA/CSV/MCP — targets come from proactive `rg` discovery. See **htlLint flow** below.

### Step 4: Read before edits

**STOP.** Read **`{best-practices}/SKILL.md`** and **`{best-practices}/references/<module>.md`** for the active pattern.

### Step 5: Process the batch

For **each finding in the returned batch only** (up to 5):

1. Resolve the target **inside the IDE workspace** (see **Workspace scope (IDE)**).
2. Read source → classify with the module → apply steps **in order** → check lints → next file.

Do **not** request the next batch mid-processing. Never hold more than one batch of findings in working memory at a time.

### Step 6: Report batch and wait

After finishing the batch, summarise **for this batch only**:

- `paging.returned` findings processed (of `paging.total`), with class names.
- Any files touched, plus any skips / failures.
- If `paging.hasMore === true`, tell the user:
  *"Processed batch of N (offset {offset}–{offset + returned − 1} of {total}). Reply
  `continue` to process the next batch, or name specific classes to focus on."*
- If `paging.hasMore === false`, say the pattern is done and move to the overall session report.

**Stop and wait for the user.** Do not automatically start the next batch. Only call
`getBpaFindings` (or `fetch-cam-bpa-findings`) again when the user explicitly requests it,
and pass `offset: paging.nextOffset` unchanged.

### Manual flow (no BPA)

User-named files → classify (best-practices hints or ask) → confirm module exists → read **`{best-practices}/SKILL.md`** + module → transform → report.

### OSGi → Cloud Manager flow

Does **not** use BPA CSV, CAM/MCP, or best-practices pattern modules for collection. Follow **Branch A** in **Required delegation** and the **One-prompt workflow** in [references/osgi-cfg-json-cloud-manager.md](references/osgi-cfg-json-cloud-manager.md).

### htlLint flow

`htlLint` does not use BPA CSV or CAM/MCP. Instead:

1. **Read** `{best-practices}/references/data-sly-test-redundant-constant.md` — it contains the **Workflow**, **Proactive Discovery** `rg` patterns, and all 4 fix patterns.
2. **Discover** targets using the `rg` commands from the module's **Proactive Discovery** table (scope: `ui.apps/**/jcr_root/**/*.html` or the user's content package paths).
3. **Group** hits by file, classify each by pattern (boolean literal, raw string, numeric, split expression).
4. **Fix** each hit per the matching pattern section in the module.
5. **Report** and recommend the user run `mvn clean install` or HTL validate to confirm no warnings remain.

## Batched processing (batch size 5)

Findings are served to the agent in batches of **5** by default, regardless of source (MCP
or CSV). Batching happens **client-side** — the heavy fetch (MCP call or CSV parse) happens
once and is materialized to a local JSON cache; every subsequent batch is a cheap slice of
that cache.

### Rules

1. **Default `limit` is 5.** Pass `limit: 5` (or accept the helper default). The skill never
   requests a larger batch unless the user has explicitly asked for one.
2. **Offset starts at 0** and advances by `result.paging.nextOffset` from the previous call.
   Do not compute offsets from `offset + limit` — read `nextOffset` from the previous
   response; it is authoritative.
3. **Stable ordering.** Each cache file is written once with a deterministic order; every
   slice from it is therefore stable and contiguous.
4. **One batch per call. One batch in memory at a time.** Process, report, stop. No
   pre-fetching, no merging across batches.
5. **Resume is stateless.** The skill does not maintain its own progress file. Resuming means
   "call the helper again with `offset: previous.paging.nextOffset`". If the session ends, a
   later session calls with the same `pattern` and `offset` and gets the same batch.
6. **Done when `paging.hasMore === false`** (or `paging.nextOffset === null`).
7. **To refresh source data**, delete the relevant cache file:
   - CSV: `<collectionsDir>/unified-collection.json`
   - MCP: `<collectionsDir>/mcp/<projectId>/<pattern>.json`

### Agent-visible flow (CSV path)

```
[User] "Fix scheduler findings using ./reports/bpa.csv"
[Agent] getBpaFindings('scheduler', { bpaFilePath, limit: 5, offset: 0 })
        // first call parses CSV → writes <dir>/unified-collection.json → slices
        → paging: { total: 137, returned: 5, offset: 0, nextOffset: 5, hasMore: true }
        Processes 5 findings.
        Reports: "Processed 5 of 137 (offset 0–4). Reply `continue` for the next batch."
[User] "continue"
[Agent] getBpaFindings('scheduler', { bpaFilePath, limit: 5, offset: 5 })
        // reads cached JSON — no CSV re-parse
        → paging: { ..., offset: 5, nextOffset: 10, hasMore: true }
        Processes next 5.
...
```

### Agent-visible flow (MCP path)

```
[User] "Fix scheduler findings from CAM project <id>"
[Agent] getBpaFindings('scheduler', { mcpFetcher, projectId, limit: 5, offset: 0 })
        // first call: one MCP fetch → writes <dir>/mcp/<projectId>/scheduler.json → slices
        → paging: { total: 137, returned: 5, offset: 0, nextOffset: 5, hasMore: true }
        Processes 5 findings.
        Reports and stops.
[User] "continue"
[Agent] getBpaFindings('scheduler', { mcpFetcher, projectId, limit: 5, offset: 5 })
        // reads cached MCP JSON — NO additional MCP call
        → paging: { ..., offset: 5, nextOffset: 10, hasMore: true }
...
```

### Do not

- Do not call `getBpaFindings` with `limit: null` inside the skill flow. That option exists
  only for programmatic callers that deliberately want the full list.
- Do not invent a next batch offset. Always read `paging.nextOffset` from the previous
  response.
- Do not accumulate `targets` across batches in memory.
- Do not call the MCP tool for every batch; the first call caches, subsequent batches read
  the cache.

## Quick reference

**Source priority (when choosing how to obtain targets):** unified collection → BPA CSV → MCP → manual paths. **Not** an automatic cascade after MCP errors — if MCP fails, stop and wait for user direction (see **MCP errors and fallback**). For `htlLint`, use proactive `rg` discovery (no BPA/MCP). For **OSGi → Cloud Manager**, use [references/osgi-cfg-json-cloud-manager.md](references/osgi-cfg-json-cloud-manager.md) only (no BPA/MCP).

**Batch size:** 5 (default) on every BPA source. See **Batched processing** above.

**User-facing snippets:** *"Using existing BPA collection (N findings)…"* / *"Processing your BPA report…"* / *"Fetched findings from CAM."* / *"Scanning HTL templates for data-sly-test lint issues…"* / optional prompt after MCP stop above.

### CLI (development only)

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
