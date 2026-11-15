---
name: migration
description: |
  Migrates legacy AEM (6.x, AMS, on-prem) to AEM as a Cloud Service via BPA CSV/cache and
  CAM/MCP discovery, one pattern per session. Use to review/scan a project for AEMaaCS
  migration — generates a read-only migration-runbook.md — or to fix specific Cloud Service
  blockers: scheduler, ResourceChangeListener, replication, EventListener, OSGi EventHandler,
  DAM AssetManager, HTL data-sly-test lint, Classic UI / ExtJS / Coral 2 → Coral 3 dialog migration (lui),
  Custom Design Widgets (cdw), Vault package install-time dependencies (vault-package-dependencies),
  Guava cache → Caffeine swaps (guavaCache), java.io.InputStream usage triage (inputStream),
  Oak index conversion (oakIndex, beta), and static→editable template modernization. Also
  externalizes OSGi config secrets to Cloud Manager (scans ui.config/.cfg.json for $[secret:]/$[env:]
  placeholders), converts AMS/on-prem Dispatcher configs to AEMaaCS (Branch E), validates migrated code on a
  local Cloud SDK (Branch G, beta), and migrates asset workflows (Branch H).
license: Apache-2.0
metadata:
  version: "1.2.0"
---

# AEM as a Cloud Service — Code Migration

**Source → target:** Legacy **AEM 6.x / AMS / on-prem** → **AEM as a Cloud Service**. Scoped under `skills/aem/cloud-service/skills/migration/` so this is not confused with Edge Delivery or 6.5 LTS.

This skill drives the **migration workflow**: BPA data, CAM/MCP, **one pattern per session**, and target discovery. **Transformation rules and steps** live in the **`code-assessment`** skill — once a finding's pattern is identified, hand off to `{code-assessment}/<pattern>/SKILL.md` (or the relevant shared reference under `{code-assessment}/references/`).

**Setup:** Use the **`aem-cloud-service`** install (see repository root **README**) so both **migration** and **code-assessment** paths are available. If you already have the monorepo open with resolvable `{code-assessment}` paths, no separate install step is required.

**For the person driving the agent:** [references/quick-start.md](references/quick-start.md) has what to say for each kind of migration, with copy-paste prompts.

## Path convention (Adobe Skills monorepo)

From the **repository root** (parent of the `skills/` directory):

| Symbol | Path |
|--------|------|
| **`{code-assessment}`** | `skills/aem/cloud-service/skills/code-assessment/` |

Examples: `{code-assessment}/SKILL.md`, `{code-assessment}/scheduler/SKILL.md`, `{code-assessment}/references/scr-to-osgi-ds.md`.

## Workspace scope (IDE) — user code only

Applies to **finding and editing the user's AEM project** (Java, bundles, config, HTL), not to reading installed skill files under `{code-assessment}`.

- Treat the **current IDE workspace root folder(s)** (single- or multi-root) as the **only** boundary for searches, globs, `grep`, and file reads/writes for migration targets.
- **Do not** search parent directories, sibling folders on disk, `~`, other clones, or arbitrary absolute paths to "discover" sources unless the user **explicitly** names those paths or asks you to include them.
- **BPA CSV / CAM targets:** If a `filePath` or class-to-file mapping does not resolve under a workspace root, **stop** and tell the user which paths are missing — do not hunt elsewhere on the filesystem. Ask them to open the correct project in the IDE or adjust paths.
- **Manual flow:** Only migrate files the user named that live under the workspace (or paths they explicitly provided). Do not expand scope by searching outside the workspace.

## Required delegation (do this first)

Find the branch for the request and read its file before anything else. Each of Branches A and C–H **skips Branch B**. A, C, E, G and H take **no BPA pattern id**.

| Branch | The user asks to… | Read first, and follow |
|---|---|---|
| **A — OSGi configs → Cloud Manager** | scan config files; create or set up Cloud Manager environment secrets or variables; move passwords or secrets out of OSGi / `.cfg.json` / `ui.config`; or mentions `$[secret:]` / `$[env:]` | [references/osgi-cfg-json-cloud-manager.md](references/osgi-cfg-json-cloud-manager.md) **immediately**: the product rules and the workflow are in that file. A short prompt is enough; the user need not name the file. |
| **B — Java / HTL / BPA pattern** | fix one pattern, from a BPA CSV, from CAM, or in files they name | The steps under **Branch B** below |
| **C — Template modernization** | migrate static templates to editable templates ("create editable templates", "generate `/conf` templates", "static to editable", "parsys to container"); generate AEM Modernize Tools rules (structure / component / policy rewrite rules) | [template-modernization-context.md](references/template-modernization/template-modernization-context.md), then per template [editable-template-creation.md](references/template-modernization/editable-template-creation.md) and [aem-modernization.md](references/template-modernization/aem-modernization.md), then [template-modernization-validation.md](references/template-modernization/template-modernization-validation.md) |
| **D — Legacy UI** (`lui`, `cdw`) | convert Classic UI / ExtJS dialogs; upgrade Coral 2 dialogs; migrate custom ExtJS widgets; fix LUI or CDW findings; or mentions `cq:Dialog` / `xtype` / `cq:Widget` | The steps under **Branch D** below |
| **E — Dispatcher conversion** | convert or migrate an AMS / on-premise Dispatcher configuration | [references/dispatcher/flow.md](references/dispatcher/flow.md): six phases around Adobe's `dispatcher-converter`. **HARD STOP on `filter-acl-loss`.** Do not present the result as done on validation failure. |
| **F — Oak index** (`oakIndex`, beta) | fix Oak index findings; convert `_oak_index` definitions | [references/oak-index.md](references/oak-index.md): six steps around Adobe's `index-converter`. Compute the next free `-custom-N`, never assume `-custom-1`. Flag a datatype mismatch as `needs_manual_review`; do not apply it silently. Tell the user that the output needs a careful review. |
| **G — Validate a migration** (beta) | validate, verify or smoke-test migrated code on the local Cloud SDK | [references/validation/validate-migration.md](references/validation/validate-migration.md). It never edits customer source; a failure goes back to the branch that owns the pattern. |
| **H — Asset workflow migration** | migrate DAM asset workflows (`DAM Update Asset` customizations, asset workflow launchers, custom asset process steps, ImageMagick `CommandLineProcess` renditions); or mentions Adobe's Asset Workflow Migration Tool / `wf-migrator` / `aem-cloud-migration` | [references/asset-workflow/flow.md](references/asset-workflow/flow.md): four steps around Adobe's `wf-migrator`, which makes every change. The skill runs it and guides the review; it never edits project files itself. Never present a failed run as done. |

**Branch B — Java / HTL / BPA pattern migration:**

1. Read **`{code-assessment}/SKILL.md`** — critical rules, Java baseline links, **Pattern Guides** table, **Manual Pattern Hints**.
2. Read the **pattern guide** (or reference) for the **single** active pattern:
   - `scheduler` → **`{code-assessment}/scheduler/SKILL.md`** *(pattern guide)*
   - `resourceChangeListener` → **`{code-assessment}/resource-change-listener/SKILL.md`** *(pattern guide)*
   - `replication` → **`{code-assessment}/replication/SKILL.md`** *(pattern guide)*
   - `eventListener` / `eventHandler` → **`{code-assessment}/event-migration/SKILL.md`** *(pattern guide — both JCR and OSGi Event Admin paths)*
   - `assetApi` → **`{code-assessment}/asset-manager/SKILL.md`** *(pattern guide)*
   - `htlLint` → **`{code-assessment}/references/data-sly-test-redundant-constant.md`** *(reference — HTL lint is a single shared reference, not a dedicated pattern guide)*
   - `vault-package-dependencies` → **[references/vault-package-dependencies.md](references/vault-package-dependencies.md)** *(reference — heuristic `pom.xml` scan)*
   - `guavaCache` → **[references/guava-cache.md](references/guava-cache.md)** *(reference — Guava cache → Caffeine)*
   - `inputStream` → **[references/input-stream.md](references/input-stream.md)** *(reference — triage of the `DG` / `java.io.inputstream` advisory; detection is `scripts/input-stream-runner.js`, not the code-assessment analyzer)*

   The last three live under `migration` only, not under `code-assessment`: these shapes occur only in code carried over from legacy AEM.
3. When code uses SCR, `ResourceResolver`, or console logging, read **`{code-assessment}/references/scr-to-osgi-ds.md`** and **`{code-assessment}/references/resource-resolver-logging.md`** (or the hub **`{code-assessment}/references/aem-cloud-service-pattern-prerequisites.md`**).

Do not transform **Java or HTL** until the pattern guide (or reference) is read (branch B). Branch A does not require `{code-assessment}` pattern guidance.

**Behavior pinning (before-eligible Java patterns).** For `guavaCache`, `scheduler`, `resourceChangeListener`, and `eventListener`/`eventHandler`, **Step 5** pins a one-per-finding characterization test around each edit (green before → transform → green after). Rules and skeletons: [references/characterization-tests.md](references/characterization-tests.md).

**Branch D — Legacy UI Migration** (`legacy-ui/` sub-folders):

- **Dialog findings** (`lui`, sub-types `legacy.dialog.classic` and `legacy.dialog.coral2` only): read [dialog/context.md](references/legacy-ui/dialog/context.md) (`getBpaFindings('lui', …)`, filter to the dialog sub-types, skip all others with a note); convert with [extjs-to-coral3.md](references/legacy-ui/dialog/extjs-to-coral3.md) (`convert-extjs`) or [coral2-to-coral3.md](references/legacy-ui/dialog/coral2-to-coral3.md) (`upgrade-coral2`); validate with [dialog/validation.md](references/legacy-ui/dialog/validation.md).
- **Custom widget findings** (`cdw`): read [cdw/context.md](references/legacy-ui/cdw/context.md) (`getBpaFindings('cdw', …)`, inventory the xtypes); per xtype apply [cdw/conversion.md](references/legacy-ui/cdw/conversion.md) (a mapping, or a scaffolded Granite UI component); validate with [cdw/validation.md](references/legacy-ui/cdw/validation.md).

## Prerequisites

- Project source and Maven/Gradle build
- BPA CSV or MCP access optional but recommended
- For **htlLint**: `ui.apps` or equivalent content package with `.html` HTL templates

## BPA findings

Get targets with **`getBpaFindings`** from `./scripts/bpa-findings-helper.js`; do not reimplement collection logic by hand unless the helper is unavailable. The flow, the call, collection caching and the batching rules: [references/bpa-helper.md](references/bpa-helper.md).

- **Two sources, two caches.** With MCP configured (`mcpFetcher` + `projectId`) the first call fetches from CAM and caches; with a BPA CSV the first call parses it and caches. With neither, the helper reports `no-source`: ask the user for one.
- **`htlLint` is not in a BPA CSV.** It uses proactive `rg` discovery; see **htlLint flow**.
- **CAM:** the user must **explicitly confirm** the project first. Recipes, schemas, retries and the 500-target cap: [references/cam-mcp.md](references/cam-mcp.md).

### MCP errors and fallback

**Critical:** On MCP failure, **stop the workflow immediately** and give the user the **exact tool error message** (verbatim), including "not found" / 404-style project errors. **Do not** continue with migration steps, infer a different CAM project from the workspace, or switch to manual/local migration on your own.

**Exception:** enablement restriction errors (prefix documented in [references/cam-mcp.md](references/cam-mcp.md)) must be shown **verbatim** with no paraphrase and no automatic fallback until the user addresses them.

After stopping, you may summarize what failed in plain language and re-show the projects. Continue **only** when the user **explicitly** directs the next step: a CAM project id or name from the list, a BPA CSV path, or specific Java files for the manual flow. Retries and error categories are in [references/cam-mcp.md](references/cam-mcp.md); still **no silent fallback**. Never hide tool errors from the user.

**Optional prompt after stop (user must reply):** *"Reply with the CAM project to use (id or name from the list), a path to your BPA CSV, or the Java files for a manual migration."*

## Workflow

### Step 0: Migration runbook (review / scan entry point)

When the user opens with a **broad review/scan** request (*"review my code for AEMaaCS migration"*, *"scan my project for AEM migration"*) and does **not** name a single pattern, generate a **read-only migration runbook** before any apply work. It is **one command**; do not read the generator's source:

```bash
node scripts/runbook-generator.js <workspaceRoot> --out ./migration-runbook.md --cache ./migration-runbook.json
```

Add `--csv <bpa.csv>` for a BPA CSV. For CAM, for an LLM scan when the command prints `⚠️ Needs LLM scan: …`, for how each pattern is detected, and for what to tell the user afterwards: [references/runbook.md](references/runbook.md). Read it before you run a runbook with CAM data.

**Skip Step 0** when the user names a **specific pattern** up front: go straight to the relevant apply flow.

### One pattern per session

If the user asks to fix everything or BPA mixes patterns, **ask which pattern first**. Prefer one commit per pattern session.

### Step 1: Pattern id

First check the branches other than B (see **Required delegation**): A (OSGi configs), C (templates), D (Legacy UI: `lui` for dialogs, `cdw` for widgets), E (Dispatcher), F (Oak index, `oakIndex`), G (validate), H (asset workflows).

Otherwise map the request to a pattern id: `scheduler`, `resourceChangeListener`, `replication`, `eventListener`, `eventHandler`, `assetApi`, `htlLint`, `lui`, `cdw`, `inputStream`. If unclear, use **Manual Pattern Hints** in **`{code-assessment}/SKILL.md`** or ask the user to pick one of those.

### Step 2: Availability

If the id is missing from the code-assessment catalog ([`{code-assessment}/references/patterns.md`](../code-assessment/references/patterns.md)), say the pattern is not supported yet. **Exception:** the migration-only references routed in **Branch B step 2** (`vault-package-dependencies`, `guavaCache`, `inputStream`) are supported even though they aren't in that catalog.

### Step 3: Targets

In this order, and stop at the first that has findings for the active pattern:

1. **The runbook cache**, `./migration-runbook.json`: reuse `findingsByPattern[<pattern>]` and tell the user that you do. Heuristic entries (`htlLint`, `osgiConfig`) are candidates: re-confirm each before editing.
2. **`getBpaFindings`** for BPA patterns (`scheduler`, `resourceChangeListener`, `replication`, `eventListener`, `eventHandler`, `assetApi`, `lui`, `cdw`). If MCP fails, obey **MCP errors and fallback**.
3. **The pattern's own discovery:** `rg` for `htlLint`; `scripts/input-stream-runner.js` for `inputStream`, which always runs once because BPA names classes and not lines; the inventory of Branch E for `dispatcherConversion`.

Every path serves **five findings per batch**. How to read the cache, the envelope, and the rules for `lui`, `inputStream`, `htlLint` and `osgiConfig` targets: [references/targets.md](references/targets.md). Read it before the first batch.

### Step 4: Read before edits

**STOP.** Read **`{code-assessment}/SKILL.md`** and the pattern guide (or reference) for the active pattern — see **Branch B step 2** above for the pattern → file routing table.

### Step 5: Process the batch

For **each finding in the returned batch only** (up to 5):

1. Resolve the target **inside the IDE workspace** (see **Workspace scope (IDE)**).
2. **Pin behavior first (before-eligible patterns only).** If the active pattern is before-eligible in [references/characterization-tests.md](references/characterization-tests.md) (`guavaCache`, `scheduler`, `resourceChangeListener`, `eventListener`/`eventHandler`), write **one** characterization test for this finding and run it green **before** editing — this pins current behavior. Follow that file's **efficiency contract exactly**: one fill-in skeleton, one attempt, **skip-fast** with `pin-skip: <reason>`. Never debug a test. All other patterns (including `replication`, `assetApi`, and every non-Java pattern) skip this step.
3. Read source → classify with the pattern guide (or reference) → apply steps **in order** → check lints.
4. **Re-run the pinned test (only if step 2 pinned one).** Green → behavior preserved, record `pinned`. Red after the edit → a real regression: **revert this finding's edit**, record `pin-fail → reverted`, and move on — do not retry or edit the test.
5. Next file.

### Step 6: Report batch and wait

After finishing the batch, summarise **for this batch only**: `paging.returned` of `paging.total` processed (with class names), files touched, and any skips/failures. For before-eligible patterns, add each finding's pin outcome (`pinned` \| `pin-skip: <reason>` \| `pin-fail → reverted`) per [references/characterization-tests.md](references/characterization-tests.md) — omit this line entirely for patterns that are not before-eligible. If `paging.hasMore`, tell the user *"Processed batch of N (offset {offset}–{offset + returned − 1} of {total}). Reply `continue` for the next batch, or name specific classes."*; otherwise say the pattern is done and move to the session report.

Then **stop and wait** — resume only when the user explicitly asks, per the Batched-processing rules.

### Manual flow (no BPA)

User-named files → classify (code-assessment Manual Pattern Hints or ask) → confirm the pattern guide or reference exists → read **`{code-assessment}/SKILL.md`** + the pattern guide (or reference) — see Branch B step 2 routing — → transform → report.

### htlLint flow

`htlLint` does not use BPA CSV or CAM/MCP. Instead:

1. **Read** [`{code-assessment}/references/data-sly-test-redundant-constant.md`](../code-assessment/references/data-sly-test-redundant-constant.md): its **Workflow**, the **Proactive Discovery** `rg` patterns and the four fix patterns.
2. **Discover** targets with those `rg` commands (scope: `ui.apps/**/jcr_root/**/*.html` or the user's content package paths), **group** the hits by file and **fix** each per its pattern section.
3. **Report**, and recommend that the user run `mvn clean install` or HTL validate to confirm that no warnings remain.

## Batched processing (batch size 5)

Findings come in batches of **5**, whatever the source. The fetch (MCP call or CSV parse) happens once and is cached; each further batch is a slice of the cache.

- One batch per call: process, report, stop. Never pre-fetch, merge batches, or pass `limit: null`.
- The next offset is `result.paging.nextOffset`. Never compute `offset + limit` yourself.
- Done when `paging.hasMore === false`.

The full rules and an example exchange: [references/bpa-helper.md](references/bpa-helper.md#batched-processing-batch-size-5).

## Quick reference

**Source priority (BPA patterns):** unified collection → BPA CSV → MCP → manual paths — **not** an automatic cascade after MCP errors (if MCP fails, stop; see **MCP errors and fallback**). Batch size 5 on every BPA source. `htlLint`, OSGi→Cloud Manager, Template Modernization (C), Dispatcher Conversion (E), and Asset Workflow Migration (H) do not use BPA/MCP — see their branches in **Required delegation**.

**User-facing snippets:** *"Using existing BPA collection (N findings)…"* / *"Processing your BPA report…"* / *"Fetched findings from CAM."* / *"Scanning HTL templates for data-sly-test lint issues…"* / optional prompt after MCP stop above.
