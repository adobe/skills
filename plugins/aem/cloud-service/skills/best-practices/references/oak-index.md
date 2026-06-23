# Oak Index Migration Pattern

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

Rewrites legacy `_oak_index/*.xml` definitions to AEM as a Cloud Service compatible Oak index definitions by invoking Adobe's official **`@adobe/aem-cs-source-migration-index-converter`** CLI tool. Covers BPA subtypes `index.rule.violation` and `standard.index.modification` (category **OID**).

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

### Step 2 — Invoke Index Converter

The package has no `bin` entry — it must be run via its executor script. Install to a temp directory and invoke with a `config.yaml`:

```bash
# 1. Install to a temp working directory (no project pollution)
WORK_DIR="/tmp/oak-index-tool-<sessionId>"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"
npm install @adobe/aem-cs-source-migration-index-converter

# 2. Write config.yaml (must be in cwd when running the executor)
cat > config.yaml << 'YAML'
indexConverter:
    ensureIndexDefinitionContentPackageJcrRootPath:
    ensureIndexDefinitionConfigPackageJcrRootPath:
    aemVersion: Cloud_Services
    customOakIndexDirectoryPath: <repo>/ui.apps/src/main/content/jcr_root/_oak_index
    filterXMLPath: <repo>/ui.apps/src/main/content/META-INF/vault/filter.xml
YAML

# 3. Run the executor
node node_modules/@adobe/aem-cs-source-migration-index-converter/executors/index-converter.js
```

The tool writes output to `./target/index/` under the working directory:
- `./target/index/.content.xml` — the converted oak index XML
- `./target/index/filter.xml` — updated filter.xml with renamed index paths
- `./target/index/index-converter-report.md` — conversion report

It does **not** modify the input.

### Step 3 — Show diff in IDE

Diff the input vs. tool output. Show the diff to the user; do not auto-apply:

```bash
diff <repo>/ui.apps/src/main/content/jcr_root/_oak_index/.content.xml \
     $WORK_DIR/target/index/.content.xml
diff <repo>/ui.apps/src/main/content/META-INF/vault/filter.xml \
     $WORK_DIR/target/index/filter.xml
```

Also show `$WORK_DIR/target/index/index-converter-report.md` — it lists which indexes were converted and which need manual migration.

### Step 4 — Apply (after user confirms)

If the user accepts:
```bash
cp $WORK_DIR/target/index/.content.xml \
   <repo>/ui.apps/src/main/content/jcr_root/_oak_index/.content.xml
cp $WORK_DIR/target/index/filter.xml \
   <repo>/ui.apps/src/main/content/META-INF/vault/filter.xml
```
- Stage for commit

### Step 5 — Validate

Run validation in this order, gate on each:

```bash
# Compile (catches XML / filter.xml errors)
mvn -pl ui.apps clean install

# Cloud-readiness analyser (if pom has aemanalyser-maven-plugin)
mvn -pl all aem-analyser:project-analyse
```

Report PASS or FAIL with file:line evidence on FAIL.

### Step 6 — Telemetry (when enabled)

Emit events through the migration skill's helper:
- `skill.invoked` (pattern=oakIndex)
- `tool.run` (tool=index-converter, durationMs, exitCode)
- `pattern.batch.processed` (count of indexes transformed)
- `validation.run` (passed=true|false)

## Naming conventions produced by the tool

The Index Converter applies these naming rules (these are the tool's behavior, documented here for reference; the skill does **not** re-implement them):

- **OOTB extension:** `<oobName>-<productVersion>-custom-1` (e.g. `damAssetLucene-8-custom-1`)
- **New custom index:** `<originalName>-custom-1` (e.g. `wkndId-custom-1`)
- **Already conforming:** passed through unchanged

## What the skill does NOT do

- Does not rewrite XML by hand using rules encoded in this file
- Does not decide whether to use Lucene vs Elasticsearch
- Does not modify queries that depend on the renamed indexes (separate task)
- Does not deploy to a running AEM instance

## Verification on `aem-guides-wknd-legacy`

Reference test project: `aem-guides-wknd-legacy` contains 3 real OID violations:
- `damAssetLucene` modified in place (`standard.index.modification`)
- `wkndId` custom index without `-custom-` suffix (`index.rule.violation`)
- `wkndTerminationDate` custom index without `-custom-` suffix (`index.rule.violation`)

Expected after running this skill:
- `damAssetLucene` → `<ootb-name-on-target-cloud-services>-<version>-custom-1` — the tool determines the exact name from the bundled Cloud Services baseline XML. With `aemVersion: Cloud_Services` and current tool version (0.2.3) this produces `damAssetStateIndex-3-custom-1`. The [reference branch `code/oid`](https://github.com/adobe/aem-guides-wknd-legacy/tree/code/oid) (created 2021) shows `damAssetLucene-6-custom-1` because that was the OOTB name at that time — both are correct for their respective baseline versions. The content is the full merged OOTB definition plus the customer's delta properties.
- `wkndId` — **not converted automatically** (property type, not lucene); must be migrated manually per tool report
- `wkndTerminationDate` — **not converted automatically** (ordered type, not lucene); must be migrated manually per tool report
- `mvn -pl ui.apps clean install` passes
- `aemanalyser-maven-plugin` reports no OID-class errors
