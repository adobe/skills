# Step 0: the migration runbook (review / scan entry point)

Paths that start with `scripts/` are relative to the migration skill directory, the folder of `SKILL.md`. `{code-assessment}` is `skills/aem/cloud-service/skills/code-assessment/`.

When the user opens with a **broad review/scan** request — *"review my code for AEMaaCS migration"*, *"scan my project for AEM migration"*, or similar — and does **not** name a single pattern, generate a **read-only migration runbook** before any apply work.

The runbook covers **every pattern the migration skill can address**. Each pattern declares a **detection strategy** — CSV-eligible patterns run the priority cascade; the others keep their existing discovery behaviour:

| Pattern(s) | Strategy | How it's detected |
|---|---|---|
| `scheduler`, `resourceChangeListener`, `event-migration`, `assetApi` | `cascade` | BPA/CAM → CSV → analyzer → LLM scan (priority list) |
| `replication` | `cascade` | analyzer → LLM scan (no BPA/CSV subtype mapping) |
| `htlLint` | `html-scan` | heuristic regex scan of `.html` (pure Node — no `rg` binary needed) |
| `osgiConfig` | `config-scan` | heuristic scan of OSGi config files for secret-looking keys / `$[secret:]`/`$[env:]` placeholders — **key names + locations only, never secret values** |
| `vault-package-dependencies` | `pom-scan` | Prefers Maven's **effective POM** (`mvn help:effective-pom`, one call per reactor root — `<pluginManagement>` inheritance and per-execution vs plugin-level `<configuration>` are Maven's problem, not ours). Falls back to a raw `pom.xml` text-scan when Maven can't resolve a module (dead parent repos, offline — common for legacy AEM 6.x / AMS codebases). No BPA subtype and no analyzer — a `pom.xml` install-time dependency declaration is invisible to a deployed-artifact BPA scan and there is no compiled detector for it. Every effective-POM failure surfaces as a warning so a degraded scan is never silently reported as clean. |
| `lui`, `cdw`, `templateModernization` | BPA `cascade` → `content-scan` fallback | When a BPA CSV/CAM source is present, these come from BPA (subtypes `custom.classic.widget`; `legacy.dialog.classic`/`.coral2`; `legacy.static.template` + `custom.static.template`). With no BPA source, a heuristic `.content.xml` scan is the fallback — for `templateModernization` it walks `apps/<appId>/templates/**` at **any depth** (nested/grouped templates included) and classifies each static template as `custom.static.template` or `legacy.static.template` from its page-component resource type, so the custom-vs-legacy distinction survives even without a BPA report. Sample prompts route to **Branch D** (legacy-ui) / **Branch C** (templates), not code-assessment |
| `guavaCache` | `bpa-only` (no analyzer, no content-scan) | BPA is the **sole** source of truth (subtype `custom.guava.cache`), one finding per **bundle** — `identifier` on this subtype is a Guava-internal class, not a customer class, so raw rows are deduped to the bundle named in the message, not surfaced per row. With no BPA source, `guavaCache` has no deterministic fallback and surfaces under **Tier 4 — LLM scan**: the agent greps `.java` files for `import com.google.common.cache` per module, per [references/guava-cache.md](guava-cache.md), and tags the result `confidence: llm`. There is deliberately no compiled analyzer detector for this pattern — it does not run inside `code-assessment`'s own discovery. |
| `inputStream` | `java-scan` (BPA first, local scan as fallback) | Same precedence as the cascade: BPA/CAM → CSV (subtype `java.io.inputstream`) → local scan. With BPA rows, only the reported classes are in scope: `input-stream-runner.js` resolves them to workspace files and emits **one finding per file** with line-level sites, ordered by risk; classes outside the workspace collapse to **one informational row per bundle** (per package for CAM rows, which carry no bundle name): `missing-source` (plus a warning) for customer code kept in another repository or module, `platform-provided` for AEM Forms add-on code that Adobe provides on AEM as a Cloud Service, and `not-in-workspace` for third-party code to upgrade or replace. Without BPA rows, every `src/main/java` file is scanned. Every stream site is pre-classified (A–F) with a fix kind (`decision` / `review` / `auto`); files with only benign sites are informational. The local scan is always available, so this pattern never needs the LLM tier. |
| `dispatcherConversion` | `content-scan` | Heuristic scan for an AMS / on-prem Dispatcher config layout (a monolithic `dispatcher.any` + `conf.vhost.d/`, or `conf.dispatcher.d/` AMS trees). Detected by `dispatcher-inventory.js`; the sample prompt routes to **Branch E**. |
| `oakIndex` | `bpa-only` (no analyzer, no content-scan) | BPA is the **sole** source of truth (subtypes `index.rule.violation` / `standard.index.modification`), one finding per Oak index path. With no BPA source, `oakIndex` has no deterministic fallback and surfaces under **Tier 4 — LLM scan**: the agent locates `_oak_index/*.xml` directly per [references/oak-index.md](oak-index.md). Sample prompt routes to **Branch F** (beta). |

`htlLint`, `osgiConfig`, `vault-package-dependencies`, `inputStream`, and the content-scan **fallback** for `lui`/`cdw`/`templateModernization` are **heuristic** (tagged `confidence: heuristic` in the cache) — candidate matches, not compiler-validated. BPA-sourced `lui`/`cdw`/`templateModernization`/`replication`/`guavaCache`/`oakIndex` findings are authoritative. Out of scope: `inject-in-sling-model` and `outdated-dependencies` (those belong to code-assessment's own runbook, not migration).

**BPA is the source of truth when a report is available.** `lui`/`cdw`/`templateModernization`/`replication` are read from the BPA CSV/CAM (the parser now extracts these subtypes and excludes `_COUNT_*`/`_STAT` summary rows), so the runbook counts match your BPA report's LUI-dialog / CDW / static-template / REP tallies. `lui` keeps only the dialog sub-types (`legacy.custom.component` → create-component; `legacy.static.template` is counted under `templateModernization`). The `.content.xml` scan is only the fallback when no BPA source is present — and it can **undercount** relative to BPA when the flagged legacy nodes live in packages (e.g. acs-commons) not in the project source. `replication`: BPA `replication.agent` findings when a report is present, else the analyzer detects `Replicator` usage from source.

#### Run it as ONE command (do this — don't read the generator source)

The runbook is produced by a **single CLI command**. It runs the local analyzer + every scanner itself, writes both `migration-runbook.md` and the sidecar cache, and prints the summary line. You do **not** need to `require()` the generator, learn its internals, or write an in-process MCP bridge.

1. **Base (always):**
   ```bash
   node scripts/runbook-generator.js <workspaceRoot> --out ./migration-runbook.md --cache ./migration-runbook.json
   ```
   This alone covers the local analyzer (Java cascade patterns), `html-scan`, `config-scan`, `pom-scan`, and the `content-scan` patterns.

2. **If you have a BPA CSV:** add `--csv ./reports/bpa.csv`.

3. **If CAM/MCP is configured:** make the **one** BPA fetch you would make anyway — call the CAM MCP tool for each relevant slug (`scheduler`, `resourceChangeListener`, `eventListener`, `eventHandler`, `assetApi`, `replication`, `lui`, `cdw`, `templateModernization`, `guavaCache`, `inputStream`, `urc`), write the raw targets to a JSON file keyed by slug, and pass it:
   ```bash
   # bpa.json shape: { "<slug>": [ <raw BPA target>, ... ], ... }   (a slug you omit = "not in report", treated as clean)
   node scripts/runbook-generator.js <workspaceRoot> --bpa-json ./bpa.json --project-id <projectId> --project-name "<confirmed name>" --out ./migration-runbook.md --cache ./migration-runbook.json
   ```
   Pass the **resolved `projectId`** from the CAM tool response and the **project name the user confirmed**. They are recorded under `project` in `migration-runbook.json`, so `validate-migration` can report its outcome to the same CAM project. For local-CSV runs omit both; the cache records `project: null`.

**The analyzer is always unioned with BPA** — when a BPA source reports a cascade pattern *clean* but real source code exists, the local analyzer's finding is added anyway (deduped by class name, shown as `Detected via: BPA / CAM + analyzer`). So you **don't** reconcile "BPA clean" against the source by hand — the script already does it.

**Tier 4 — LLM scan (only if the command prints `⚠️ Needs LLM scan: …`).** That happens for a `cascade`/`bpa-only` pattern nothing deterministic could scan (e.g. `guavaCache` with no BPA source and no JDK). Grep for it per the pattern guide's hints under `{code-assessment}/<pattern>/` (for `guavaCache`, `import com.google.common.cache` — see [references/guava-cache.md](guava-cache.md)), write the hits to a JSON file, and **re-run the same command** with `--llm-findings`:
```bash
# llm.json shape: { "<pattern>": [ { "file": "...", "line": 42, "snippet": "..." }, ... ] }
node scripts/runbook-generator.js <workspaceRoot> --bpa-json ./bpa.json --llm-findings ./llm.json --out ./migration-runbook.md --cache ./migration-runbook.json
```
The generator merges, re-renders, and rewrites the cache in that one pass — no hand-editing of internal objects.

After the command finishes, tell the user (numbers come from the printed summary line):

> "I've written `migration-runbook.md` — **{totalFindings} findings** across **{N} patterns** (detected via {sources}). It's read-only. Reply with the pattern you want to migrate first (e.g. `scheduler`) and I'll reuse the findings already discovered for that pattern — no re-scan needed — and run the one-pattern-per-session apply workflow."

The command also writes the sidecar findings cache (default `./migration-runbook.json`) alongside the markdown, holding each pattern's raw findings and their source. **Step 3** in `SKILL.md` reads this cache first before falling back to a live BPA/analyzer/scan lookup.

**Skip Step 0** when the user names a **specific pattern** up front (e.g. *"fix scheduler findings"*, *"fix htlLint in ui.apps"*, *"scan my config files for Cloud Manager secrets"*) — go straight to the relevant apply flow. Step 0 is only for a **broad review/scan** request with no single pattern named.

> **Advanced (programmatic).** The same behavior is available as an API — `generateRunbook({ workspaceRoot, bpaFilePath, preFetchedBpa, llmByPattern, outputPath, cachePath })` and `mergeLlmFindings(gathered, llmByPattern)` from `./scripts/runbook-generator.js` — for callers that need to drive it in-process (e.g. an in-session `mcpFetcher` instead of `--bpa-json`). Prefer the CLI above; reach for the API only when the CLI can't express what you need.
