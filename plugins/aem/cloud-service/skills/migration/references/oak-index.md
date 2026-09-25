# Oak Index Migration Pattern

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

Rewrites legacy `_oak_index/*.xml` definitions to AEM as a Cloud Service compatible Oak index definitions by invoking Adobe's official **`@adobe/aem-cs-source-migration-index-converter`** CLI tool. Covers BPA subtypes `index.rule.violation` and `standard.index.modification` (category **OID**).

Not a Cloud-Service-native code-quality issue — legacy `_oak_index/*.xml` layouts only exist in pre-cloud (AEM 6.x / AMS) projects, so this is a migration reference, not a `code-assessment` pattern. Like Dispatcher Conversion (Branch E), this pattern wraps an Adobe-maintained conversion tool rather than re-implementing transformation rules, so it lives under `migration/references/` only.

**Before transformation steps:** [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md).

**Scope:**
- Custom Oak index definitions under `ui.apps/.../_oak_index/`
- OOTB index modifications (e.g. `damAssetLucene` customized in place)
- Lucene type indexes; property/ordered indexes are passed through unchanged by the tool

**Out of scope (skill stops, agent reports to user):**
- Indexes outside `_oak_index/` (e.g. JSON definitions deployed at runtime)
- `nt:base` lucene indexes (the tool refuses to convert these)

## How the skill runs

The skill does **not** re-implement transformation rules. It invokes the Adobe-maintained tool, captures the output, shows the diff, and validates.

### Step 1 — Detect

- Locate `_oak_index/` directories under `ui.apps/src/main/content/jcr_root/`. If none exist, stop and report to user.
- Determine `aemVersion` for the config: the tool maps this value directly to a bundled baseline file (`.content_<aemVersion>.xml`). Valid values are `63`, `64`, `65`, and `Cloud_Services`. Use `Cloud_Services` for AEM as a Cloud Service / SDK projects (i.e. when `pom.xml` contains `aem.sdk.api` or `aem.sdk.api.version`). Use `65` for AEM 6.5, `64` for AEM 6.4, `63` for AEM 6.3.

### Step 2 — Determine the next custom-N (do not assume `-custom-1`)

The tool's own default output is always `-custom-1` for a first-time conversion. **Do not trust that blindly** — if this repo has already been through a prior Oak index migration (or a customer manually added `-custom-N` indexes since), reusing `-custom-1` will collide with, or silently shadow, an existing index.

Before invoking the tool:
1. Scan the **current target state** for existing `<baseName>-custom-<n>` siblings — check both `ui.apps/.../_oak_index/.content.xml` (already-migrated definitions committed by a previous run) and, if available, the target Cloud Service environment's live index list.
2. For each index the tool will rename, compute `n = highest existing <baseName>-custom-<n> suffix found (0 if none)`, then use `<baseName>-custom-<n+1>` as the **actual** name applied in Step 4 — overriding the tool's raw `-custom-1` output for that index if the computed `n+1` differs.
3. Record the mapping (`tool output name` → `actual applied name`) so Step 3's diff and Step 5's validation both refer to the corrected name, not the tool's raw one.

If no prior `-custom-N` index exists for a given base name, the tool's own `-custom-1` output is correct as-is — no override needed.

### Step 3 — Invoke Index Converter

The package has no `bin` entry, so it can't be run as a plain `npx <pkg>` command — it must be `require()`'d as a script, which executes it (it has no `require.main` guard) and reads `config.yaml` from `process.cwd()`. Use `npx -y` to resolve/cache the package (no manual `npm install` or throwaway `node_modules`) and only create a small directory for the required `config.yaml`:

```bash
# 1. config.yaml must live in cwd when the executor runs
WORK_DIR="/tmp/oak-index-tool-<sessionId>"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"
cat > config.yaml << 'YAML'
indexConverter:
    ensureIndexDefinitionContentPackageJcrRootPath:
    ensureIndexDefinitionConfigPackageJcrRootPath:
    aemVersion: Cloud_Services
    customOakIndexDirectoryPath: <repo>/ui.apps/src/main/content/jcr_root/_oak_index
    filterXMLPath: <repo>/ui.apps/src/main/content/META-INF/vault/filter.xml
YAML

# 2. Resolve the npx-cached install (npx handles install + caching for future runs)
NODE_PATH="$(npx -y -p @adobe/aem-cs-source-migration-index-converter -c 'echo "${PATH%%:*}"')"
export NODE_PATH="${NODE_PATH%/.bin}"

# 3. Run the executor (require() triggers it; it reads config.yaml from cwd above)
node -e "require('@adobe/aem-cs-source-migration-index-converter/executors/index-converter.js')"
```

The tool writes output to `./target/index/` under the working directory:
- `./target/index/.content.xml` — the converted oak index XML
- `./target/index/filter.xml` — updated filter.xml with renamed index paths
- `./target/index/index-converter-report.md` — conversion report

It does **not** modify the input.

### Step 4 — Show diff in IDE

Diff the input vs. tool output, **using the corrected name from Step 2** wherever it overrides the tool's raw `-custom-1`:

```bash
diff <repo>/ui.apps/src/main/content/jcr_root/_oak_index/.content.xml \
     $WORK_DIR/target/index/.content.xml
diff <repo>/ui.apps/src/main/content/META-INF/vault/filter.xml \
     $WORK_DIR/target/index/filter.xml
```

Also show `$WORK_DIR/target/index/index-converter-report.md` — it lists which indexes were converted and which need manual migration.

**Type/datatype compatibility check (do this before presenting the diff as done):** for each converted index, confirm:
- The output node's `jcr:primaryType` is `oak:QueryIndexDefinition` and it declares `oak:isOakIndexDefinition="{Boolean}true"` and `type="lucene"` (or the applicable index type) — the tool should always produce this, but a mismatch here means the conversion silently failed for that node and must be flagged, not applied.
- Every property present in **both** the legacy and converted definitions (e.g. `propertyIndex`, individual `properties/*/name` and `properties/*/type` nodes) carries the **same JCR value type** — an existing `String` property re-declared as `Long` (or vice versa) in the converted output is an incompatibility the tool report may not surface explicitly. Cross-check property `type` attributes between old and new by name.
- If a datatype mismatch is found, **do not silently apply the tool's output for that property** — flag it in the diff summary shown to the user as `needs_manual_review: datatype mismatch on <propertyName>` and let the tool's report guidance (or a project domain expert) resolve it before Step 5.
- **Tika config (`tika` subnode, e.g. `tika/config.xml`):** the AEM 6.5 and AEM CS Tika configurations are different, and the index-converter tool passes any legacy `tika` subnode through unchanged. Do **not** carry the 6.5 Tika config forward to CS. Default action: **drop the `tika` subnode** from the converted output so the CS platform Tika config applies. If the legacy `tika` subnode is non-trivial (custom parser mappings, non-default MIME handlers), do not auto-drop — flag it in the diff summary as `needs_manual_review: tika config from 6.5 is not portable to CS; re-express or remove before applying` and leave it to the project domain expert to resolve before Step 5.

### Step 5 — Apply (after user confirms)

If the user accepts:
```bash
cp $WORK_DIR/target/index/.content.xml \
   <repo>/ui.apps/src/main/content/jcr_root/_oak_index/.content.xml
cp $WORK_DIR/target/index/filter.xml \
   <repo>/ui.apps/src/main/content/META-INF/vault/filter.xml
```
If Step 2 computed a corrected name, apply the rename in the copied `.content.xml`/`filter.xml` before staging (the node name and any `filter.xml` path referencing the tool's raw `-custom-1` output must both be updated to the corrected `-custom-<n+1>` name).
- Stage for commit

### Step 6 — Validate

Run validation in this order, gate on each:

```bash
# Compile (catches XML / filter.xml errors)
mvn -pl ui.apps clean install

# Cloud-readiness analyser (if pom has aemanalyser-maven-plugin)
mvn -pl all aem-analyser:project-analyse
```

Report PASS or FAIL with file:line evidence on FAIL.

## Naming conventions produced by the tool

The Index Converter applies these naming rules (these are the tool's behavior, documented here for reference; the skill does **not** re-implement them — but does **override** the suffix per Step 2 when a higher `-custom-N` already exists):

- **OOTB extension:** `<ootb-name-on-target-cloud-services>-<version>-custom-1` (e.g. `damAssetStateIndex-3-custom-1`) — the OOTB name and version come from the bundled Cloud Services baseline XML for the configured `aemVersion`, not from the legacy index's own name.
- **New custom index:** `<originalName>-custom-1` (e.g. `wkndId-custom-1`)
- **Already conforming:** passed through unchanged

**Roadmap note:** [Simplified Index Management](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/operations/indexing) is Adobe's newer index-authoring model. This pattern currently targets the Index Converter tool's classic `_oak_index/*.xml` output; adopting Simplified Index Management as the target format is a separate, larger change tracked outside this reference — Step 2's dynamic custom-N logic is written to be forward-compatible with either target once that decision is made.

## What the skill does NOT do

- Does not rewrite XML by hand using rules encoded in this file
- Does not decide whether to use Lucene vs Elasticsearch
- Does not modify queries that depend on the renamed indexes (separate task)
- Does not deploy to a running AEM instance
