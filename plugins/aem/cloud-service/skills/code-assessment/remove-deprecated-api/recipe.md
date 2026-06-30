# Recipe — Remove Deprecated API

> Read this fully before editing. Control plane: [SKILL.md](SKILL.md).

## Step 1: Pre-flight

### JDK and Maven

Apache Maven 3.x or newer with a supported JVM must be available. Verify:

```bash
java -version
mvn --version 2>&1 | head -5
```

If the project uses a Maven wrapper, prefer it:

```bash
[ -f ./mvnw ] && ./mvnw --version 2>&1 | head -5
```

Set the Maven command variable — used in all build steps below:

```
MVN_CMD = "./mvnw" if mvnw exists, otherwise "mvn"
```

### Maven Output Size Limit

**CRITICAL**: Maven commands produce very verbose output that can exceed the tool output buffer
limit (1 MB). To prevent crashes, **every Maven command** must redirect output to a log file and
only return the tail. Use this pattern for ALL `mvn` commands:

```bash
$MVN_CMD <args> > /tmp/mvn-modernize.log 2>&1; \
MVN_EXIT=$?; \
echo "=== Maven exit code: $MVN_EXIT ==="; \
tail -150 /tmp/mvn-modernize.log; \
exit $MVN_EXIT
```

Full output is always available in `/tmp/mvn-modernize.log` for later inspection.


## Enforcement scope

Before scanning or editing, determine which API groups are **in scope** for today's date.
Only APIs whose enforcement deadline has already passed are scanned and fixed; future-deadline
APIs are noted in the report but left untouched.

| Group | Enforcement date | In scope when |
|---|---|---|
| Already-enforced set (logback, log4j, Guava, Jetty, MongoDB, Abdera, felix.http.whiteboard, slf4j.spi/event, Cocoon XML, Felix webconsole, Drewnoakes, Oak memory) | Already enforced | Always |
| XSS APIs, Tika, Handlebars, BSON, Oak blob, contentsync, mailer, httpcache, WebDAV, fileupload, smartcontent, OpenNLP, predicate API | 2027-03-31 | today ≥ 2027-03-31 |
| commons-lang v2, commons-collections v3, org.json, sling.runmode, sling.commons.json | 2027-12-31 | today ≥ 2027-12-31 |

Print the active scope before any scan or edit step.

## Input contract

Per invocation, findings come from the analyzer in the standard format:

```json
{
  "findings": [
    {"pattern": "remove-deprecated-api", "file": "core/.../Foo.java",          "line": 5,  "snippet": "org.apache.log4j.Logger"},
    {"pattern": "remove-deprecated-api", "file": "core/pom.xml",                "line": 14, "snippet": "log4j:log4j"},
    {"pattern": "remove-deprecated-api", "file": "ui.config/.../LogManager.cfg","line": 1,  "snippet": "org.apache.sling.commons.log.LogManager"}
  ],
  "warnings": []
}
```

Distinguish sub-category by file extension: `.java` → Java import (snippet is the import FQN);
`pom.xml` → Maven dependency (snippet is `groupId:artifactId`); `.cfg` / `.cfg.json` / `.config`
→ OSGi config (snippet is the PID).

Sources:
1. **User-named** — user specifies files or coordinates directly.
2. **Discover** — run the analyzer per the Discovery section in [`SKILL.md`](SKILL.md) and read the JSON output.

---

## Migration Checklist

```
Migration Progress:
- [ ] Step 1: Pre-flight (verify Maven and JVM, set MVN_CMD)
- [ ] Step 2: Initial build (verify project compiles before changes)
- [ ] Step 3: Apply edits (imports, dependencies, OSGi configs)
- [ ] Step 4: Post-transformation build (verify edits didn't break anything)
- [ ] Step 5: AI-assisted code fixes (fix what edits couldn't handle)
- [ ] Step 6: Final build verification
- [ ] Step 6b: Build Analyzer Maven Plugin validation
- [ ] Step 7: Generate report
```

## How Build Steps Relate

Steps 2, 4, and 6 are build steps. Step 2 verifies the project compiles before any changes.
Step 4 catches breakage introduced by the automated scripts. Step 6 is the final verification
after AI-assisted fixes. Do NOT carry forward module skips or assumptions between build steps,
because transformations and fixes in between may change which modules compile:

- **Step 3** (edits) → may fix some modules but break others (e.g., import rename without matching API change)
- **Step 5** (AI fixes) → resolves compilation errors from Step 4
- **Step 6** (final) → captures the true state of everything

Always attempt the **full project build** at each build step.

## Step 2: Initial Build (Baseline)

Build the project to verify it compiles before any migration changes.

```bash
$MVN_CMD clean install \
  -DskipFrontend=true \
  -Dassembly.skipAssembly=true \
  -Dcheckstyle.skip=true \
  -Dvault.skipValidation=true \
  -Dsling.install.skip=true \
  -Dexec.skip=true \
  -Dpackage.skip=true \
  -Dosgi.bundle.status.skip=true \
  -Djacoco.skip=true \
  > /tmp/mvn-modernize.log 2>&1; \
MVN_EXIT=$?; \
echo "=== Maven exit code: $MVN_EXIT ==="; \
tail -150 /tmp/mvn-modernize.log; \
exit $MVN_EXIT
```

**If exit code = 0**: Proceed to Step 3.

**If exit code != 0**: Read the build error output and fix if possible:

- **Dependency resolution failures** (401/403, missing artifacts):
  - Customer-specific/private dependency → STOP. Report: "Missing customer-specific dependencies. Fix manually before running modernizer."
  - Public library auth failure → STOP. Report: "Maven auth failure — fix settings.xml manually."
- **Infrastructure issues** (connection refused, network errors) → STOP
- **Compilation errors**: Fix and re-run. Retry up to 3 times total.

**If still failing after 3 attempts**: STOP. Report: "Project does not compile before migration. Fix the baseline build first."

---

## Step 3: Apply Edits

Apply edits for each finding from the analyzer. Work pattern-by-pattern: imports first, then Maven dependencies, then OSGi configs.

### Pattern A: Java imports

**Replacement mapping** — apply only rules whose deadline ≤ today or `already_enforced`:

| Deprecated prefix | Replace with | Extra import to add | Code replacement | Deadline |
|---|---|---|---|---|
| `org.apache.sling.commons.auth.` | `org.apache.sling.auth.` | — | — | Already enforced |
| `org.apache.log4j.Logger` | `org.slf4j.Logger` | `org.slf4j.LoggerFactory` | `Logger.getLogger(` → `LoggerFactory.getLogger(` | Already enforced |
| `org.apache.log4j.` | `org.slf4j.` | — | — | Already enforced |
| `com.adobe.granite.xss.` | `org.apache.sling.xss.` | — | — | 2027-03-31 |
| `com.day.cq.xss.` | `org.apache.sling.xss.` | — | — | 2027-03-31 |
| `com.day.cq.commons.predicate.` | `com.day.cq.commons.predicates.` | — | — | 2027-03-31 |
| `org.apache.commons.lang.` | `org.apache.commons.lang3.` | — | — | 2027-12-31 |
| `org.apache.commons.collections.` | `org.apache.commons.collections4.` | — | — | 2027-12-31 |

**Imports with no direct replacement** (remove the import; compilation errors addressed in Step 5):

| Import prefix | Notes |
|---|---|
| `org.eclipse.jetty.` | Use third-party Jetty bundles or remove if unused |
| `com.mongodb.` | Add `org.mongodb:mongo-java-driver:3.12.7` as a bundle to your project (embed in your OSGi bundle or deploy as a separate bundle in your content package) |
| `org.apache.abdera.` | Replace with third-party XML/Atom library |
| `org.apache.felix.http.whiteboard.` | Use OSGi Http Whiteboard (`org.osgi.service.servlet.*`) |
| `ch.qos.logback.` | Remove — not supported in Cloud Service |
| `org.slf4j.spi.` | Remove |
| `org.slf4j.event.` | Remove |
| `com.google.common.` | Remove simple usages; see manual-action for complex Guava |
| `org.apache.cocoon.xml.` | Use JDK XML APIs (`javax.xml.*`, `org.w3c.dom.*`) |
| `org.apache.felix.webconsole.` | See manual-action — webconsole unavailable on CS |
| `com.drew.` | See manual-action — use Asset Compute or Apache Tika |
| `org.apache.jackrabbit.oak.plugins.memory.` | Remove — internal Oak API |

#### For each `.java` finding

1. Read the file at the recorded path
2. Locate the deprecated import at the recorded line
3. Replace the deprecated import prefix with the replacement (keep the class name after the prefix unchanged); if the rule has an extra import to add, insert it as an additional `import` line
4. Apply any code replacement throughout the file body (e.g. `Logger.getLogger(` → `LoggerFactory.getLogger(`)
5. Use the `Edit` tool to apply the change
6. If the import is no longer present (file modified since discovery), record `skipped: deprecated-import-not-found: <prefix> not present in <file>`

#### Unlocatable / skip

- `deprecated-import-not-found: <deprecated-prefix> not present in <file>` — already removed or file modified
- `deprecated-import-out-of-scope: <deprecated-prefix> deadline <YYYY-MM-DD> is in the future` — leave untouched
- `deprecated-import-manual-only: <deprecated-prefix> requires design decisions` — webconsole, deeply-integrated Guava

#### Before / after example — log4j → SLF4J

**Before** (`core/src/main/java/com/example/core/services/MyService.java`):

```java
import org.apache.log4j.Logger;

public class MyService {
    private static final Logger log = Logger.getLogger(MyService.class);
}
```

**After:**

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class MyService {
    private static final Logger log = LoggerFactory.getLogger(MyService.class);
}
```

---

### Pattern B: Maven dependencies

**Replacement mapping** — apply only rules whose deadline ≤ today or `already_enforced`:

| groupId | artifactId | Action | Replacement coordinates | Deadline |
|---|---|---|---|---|
| `log4j` | `log4j` | remove | — | Already enforced |
| `ch.qos.logback` | `*` (any) | remove | — | Already enforced |
| `com.github.jknack` | `handlebars` | update_version | version → `4.3.0` | 2027-03-31 |
| `org.apache.opennlp` | `opennlp-tools` | remove | — | 2027-03-31 |
| `commons-lang` | `commons-lang` | replace | `org.apache.commons:commons-lang3` | 2027-12-31 |
| `commons-collections` | `commons-collections` | replace | `org.apache.commons:commons-collections4` | 2027-12-31 |
| `org.json` | `json` | replace | `org.apache.johnzon:johnzon-core` + add `javax.json:javax.json-api` | 2027-12-31 |

#### For each `pom.xml` finding

1. Read the file
2. Locate the `<dependency>` block containing the flagged `groupId:artifactId` at the recorded line
3. Apply the action:
   - **remove**: delete the entire `<dependency>...</dependency>` block (including surrounding whitespace/newline)
   - **replace**: rewrite `<groupId>` and `<artifactId>` to the new coordinates and **remove `<version>`** — the AEM SDK BOM manages the version; if the rule adds an extra dependency, insert it as a new `<dependency>` block (also without `<version>`) in the nearest `<dependencies>` section
   - **update_version**: update `<version>` to the new value; if the version is a `${property}` reference, find and update the property declaration instead
4. Use the `Edit` tool to apply the change
5. If ambiguous (same coordinate appears in multiple `<dependency>` blocks), record `skipped: maven-dep-ambiguous`

#### Unlocatable / skip

- `maven-dep-not-found: <groupId>:<artifactId> not present in <file>` — already removed or migrated
- `maven-dep-ambiguous: multiple blocks match <groupId>:<artifactId> in <file>` — manual fix required
- `maven-dep-out-of-scope: <groupId>:<artifactId> deadline <YYYY-MM-DD> is in the future` — leave untouched

#### Before / after example — log4j removal

**Before** (`core/pom.xml`):

```xml
<dependency>
  <groupId>log4j</groupId>
  <artifactId>log4j</artifactId>
  <version>1.2.17</version>
</dependency>
```

**After:** the entire `<dependency>` block is removed (action: `remove`).

#### Before / after example — commons-lang v2 → v3 replacement

**Before** (`core/pom.xml`):

```xml
<dependency>
  <groupId>commons-lang</groupId>
  <artifactId>commons-lang</artifactId>
  <version>2.6</version>
</dependency>
```

**After:**

```xml
<dependency>
  <groupId>org.apache.commons</groupId>
  <artifactId>commons-lang3</artifactId>
</dependency>
```

---

### Pattern C: Unmodifiable OSGi configs

For each `.cfg` / `.cfg.json` / `.config` finding, delete the entire file:

```bash
rm "<file>"
```

Verify the file is removed: `git status`

On AEM CS, AEM ignores these configs entirely — having them in the package is harmless but misleading, and Cloud Manager's Build Analyzer flags them as warnings.

#### Unlocatable / skip

- `osgi-config-not-found: <pid> file not found at <file>` — already removed or renamed
- `osgi-config-pid-mismatch: <pid> not referenced in <file>` — file exists but contains a different PID

#### Before / after example

**Before:** file `ui.config/src/main/content/jcr_root/apps/myapp/config/org.apache.sling.commons.log.LogManager.cfg.json` exists with content:

```json
{
  "org.apache.sling.commons.log.level": "info",
  "org.apache.sling.commons.log.file": "logs/error.log"
}
```

**After:** file is deleted entirely. AEM CS ignores all `LogManager` properties; the default AEM CS logging configuration takes effect.

---

### 3d. Review what changed

```bash
git diff --stat
```

Print the list of modified files. Verify sensibility before proceeding.

---

## Step 4: Post-Transformation Build

Build the project to verify the automated transformations didn't break anything.

```bash
$MVN_CMD clean install \
  -DskipFrontend=true \
  -Dassembly.skipAssembly=true \
  -Dcheckstyle.skip=true \
  -Dvault.skipValidation=true \
  -Dsling.install.skip=true \
  -Dexec.skip=true \
  -Dpackage.skip=true \
  -Dosgi.bundle.status.skip=true \
  -Djacoco.skip=true \
  > /tmp/mvn-modernize.log 2>&1; \
MVN_EXIT=$?; \
echo "=== Maven exit code: $MVN_EXIT ==="; \
tail -150 /tmp/mvn-modernize.log; \
exit $MVN_EXIT
```

**If exit code = 0**: Proceed to Step 6 (skip Step 5).

**If exit code != 0**: Proceed to Step 5 — the AI-assisted fix phase will handle compilation errors from the edits applied in Step 3.

---

## Step 5: AI-Assisted Code Fixes

Fix compilation errors that the automated edits could not handle. Read `/tmp/mvn-modernize.log`
to find specific errors.

**What you can fix:** compilation errors from import rewrites (renamed class, different method signature), missing imports due to package relocations (e.g., commons-lang v2 → v3), deprecated API usage that no longer compiles after a dependency version bump, missing dependencies added as a result of migration.

**What you cannot modify:** README/docs, `.gitignore`, Dockerfiles, build/deploy scripts, test data files, business logic in working code (only fix compilation errors — never refactor), `.content.xml` dialogs, `ui.content/` packages, Dispatcher configs.

**javax.servlet vs jakarta.servlet — never migrate:** AEM as a Cloud Service uses the `javax.servlet` namespace (and related Servlet/JSP/EL APIs: `javax.servlet.*`, `javax.annotation.*`). Never replace these with their `jakarta.*` equivalents — it will break the build. Fix `javax.servlet` import errors by ensuring the correct AEM SDK dependency is present, not by changing the namespace.

Every AI-applied code change **must** be marked with a comment immediately above:

```java
// Fixed by AEM Modernizer AI
```

### Build fix iteration pattern

1. Read the build log to identify the first failing module
2. Read the specific file(s) with errors
3. Understand the deprecated API that was partially migrated
4. Apply the minimal fix
5. Add `// Fixed by AEM Modernizer AI` above every changed line
6. Re-run the build
7. Repeat up to 5 times total

### Dependency resolution failures

When a build fails due to missing dependencies after migration:

- **Edit bumped a version that doesn't exist**: revert to the previous version and note it in the report
- **Removed dependency still needed**: re-add it with the correct replacement coordinates
- **Customer-specific/private dependency**: STOP — report as requiring manual intervention
- **Network/auth failure**: STOP — report as infrastructure issue

### Common fix patterns

Only apply fix patterns for APIs in the **active enforcement scope** (deadline_iso ≤ today, or
already-enforced). Future-deadline APIs were not changed by the edits and will not appear in
build errors.

**log4j removed but residual usage remains** _(always active)_:

```java
// Before:
import org.apache.log4j.Logger;
private static final Logger log = Logger.getLogger(MyClass.class);

// After:
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
// Fixed by AEM Modernizer AI — log4j removed, migrated to SLF4J
private static final Logger log = LoggerFactory.getLogger(MyClass.class);
```

**Import renamed but method signature differs — XSS API** _(active only when today ≥ 2027-03-31)_:

```java
// Before — Granite XSS
import com.adobe.granite.xss.XSSAPI;
@Reference private XSSAPI xssAPI;

// After — Sling XSS (import rewritten in Step 3)
import org.apache.sling.xss.XSSAPI;
// Fixed by AEM Modernizer AI — com.adobe.granite.xss deprecated, using org.apache.sling.xss
@Reference private XSSAPI xssAPI;
```

If the replacement class has a different method signature, look up the new API and fix the call site.

**commons-lang v2 → v3 method name differences** _(active only when today ≥ 2027-12-31)_:

- `StringUtils.defaultString(Object)` → `StringUtils.defaultString(String)` — v3 doesn't accept `Object`
- `StringUtils.chomp(String, String)` → `StringUtils.removeEnd(String, String)`
- `StringEscapeUtils` moved: `org.apache.commons.lang` → `org.apache.commons.text`

**commons-collections v3 → v4 package root changed** _(active only when today ≥ 2027-12-31)_:

- `org.apache.commons.collections.` → `org.apache.commons.collections4.`
- `Transformer` interface moved; `CollectionUtils.select` return type changed

### Manual-action items (cannot auto-fix — document in report, do not edit)

| Finding | Why it cannot be auto-fixed |
|---|---|
| `import org.apache.felix.webconsole.*` | Webconsole is unavailable on Cloud Service; requires rethinking the debug/admin approach |
| `import com.mongodb.*` | Import is removed in Step 3, but making the driver available at runtime requires embedding `org.mongodb:mongo-java-driver:3.12.7` as a bundle in the content package — project-specific Maven configuration that cannot be auto-applied |
| Guava — caching, event bus, `Ordering`, `Multimap`, or immutable collections beyond `Lists.newArrayList()` | Replacement requires design decisions (JDK equivalents, Apache Commons Collections 4, or explicit Guava dependency) |
| SPA Editor code | Architectural migration, not a compilation fix |
| Workflow definitions (e.g., DAM Asset Update) | AEM config, not Java — out of scope |

Record these in the report under **Manual Action Required** with the exact files and line numbers.

---

## Step 6: Final Build Verification

Build the project one last time to verify everything compiles after all migrations and fixes.

```bash
$MVN_CMD clean install \
  -Dmaven.clean.failOnError=false \
  -DskipFrontend=true \
  -Dassembly.skipAssembly=true \
  -Dcheckstyle.skip=true \
  -Dvault.skipValidation=true \
  -Dsling.install.skip=true \
  -Dexec.skip=true \
  -Dpackage.skip=true \
  -Dosgi.bundle.status.skip=true \
  -Djacoco.skip=true \
  > /tmp/mvn-modernize.log 2>&1; \
MVN_EXIT=$?; \
echo "=== Maven exit code: $MVN_EXIT ==="; \
tail -150 /tmp/mvn-modernize.log; \
exit $MVN_EXIT
```

**If exit code = 0**: Proceed to Step 6b.

**If exit code != 0**: Attempt fixes (same constraints as Step 5). Retry up to 3 times total.

**If still failing after 3 attempts**: Report "Final build failed. Migration is incomplete." Still proceed to Step 6b to capture partial progress.

---

## Step 6b: Build Analyzer Validation

Run the AEM as a Cloud Service SDK Build Analyzer Maven Plugin to catch OSGi wiring issues,
content package structure problems, and deprecated API usage that a plain `mvn compile` misses.

### 6b-i. Check if the plugin is already configured

```bash
grep -r "aemanalyser-maven-plugin" pom.xml **/pom.xml 2>/dev/null | head -5
```

**If found**: Run `mvn verify` without the skips that suppress it:

```bash
$MVN_CMD verify \
  -DskipFrontend=true \
  -Dassembly.skipAssembly=true \
  -Dcheckstyle.skip=true \
  -Dsling.install.skip=true \
  -Dexec.skip=true \
  -Djacoco.skip=true \
  > /tmp/mvn-analyzer.log 2>&1; \
MVN_EXIT=$?; \
echo "=== Build Analyzer exit code: $MVN_EXIT ==="; \
tail -150 /tmp/mvn-analyzer.log; \
exit $MVN_EXIT
```

Proceed to 6b-ii.

**If not found**: Add the plugin permanently to the root `pom.xml` — it provides ongoing Build Analyzer validation in CI and should remain in the project.

**6b-i-A. Inject** — add this block inside the root `pom.xml`'s `<build><plugins>` section,
before `</plugins>`:

```xml
        <plugin>
          <groupId>com.adobe.aem</groupId>
          <artifactId>aemanalyser-maven-plugin</artifactId>
          <version>1.6.20</version>
          <executions>
            <execution>
              <id>aem-analyser</id>
              <goals><goal>analyse</goal></goals>
            </execution>
          </executions>
        </plugin>
```

**6b-i-B. Run the analyser**:

```bash
$MVN_CMD verify \
  -DskipFrontend=true -Dassembly.skipAssembly=true \
  -Dcheckstyle.skip=true -Dsling.install.skip=true -Dexec.skip=true -Djacoco.skip=true \
  > /tmp/mvn-analyzer.log 2>&1; \
MVN_EXIT=$?; echo "=== Build Analyzer exit code: $MVN_EXIT ==="; \
tail -150 /tmp/mvn-analyzer.log; exit $MVN_EXIT
```

### 6b-ii. Interpret analyzer output

| Analyzer finding | What it means | Action |
|---|---|---|
| `Import-Package` not satisfied | Bundle imports a package no other bundle exports | Check if deprecated API was removed without a replacement |
| `api-regions-check` violation | Bundle uses an internal/private AEM API | Replace with public AEM API equivalent |
| `content-package-validation` failure | Malformed XML or invalid node type | Fix the flagged content file |
| `bundle-unversioned-packages` | Missing version range on import | Add version constraint in `bnd.bnd` or `Import-Package` |

**If exit code = 0**: Proceed to Step 7. Record: "Build Analyzer: PASSED".

**If exit code != 0**: Fix compilation-level issues per Step 5 rules; re-run once. If still
failing, record remaining errors in the report under "Warnings" and proceed to Step 7.

---

## Editing strategy

- **Edits are surgical** — only touch the deprecated import/dep/config; no reformatting.
- **No partial migrations** — if a file still fails after 5 AI-fix iterations, record as
  `compile-error-unresolved` and rollback that file if needed.
- **Preserve formatting** — match surrounding indentation; do not run a code formatter.
- **Mark every AI change** — `// Fixed by AEM Modernizer AI` immediately above each changed
  line in Step 5. Step 3 edits are direct replacements attributable via `git diff`.

---

## Step 7: Generate Report

This is MANDATORY. Always produce a structured report.

### 7a. Review the changes

```bash
git diff --stat
```

Confirm: Java source files have import/API upgrades; `pom.xml` files have dependency changes;
OSGi config files were removed where appropriate; no unexpected files were modified.

### 7b. Print the modernization report

```markdown
## AEM Modernize Report

**Scan root:** <path>
**Date:** <today>
**Final build status:** <SUCCESS | FAILED>

### Summary
> Enforcement scope: APIs with deadline <= <today>. Future-deadline APIs were not scanned or modified.

| Severity | Found | Fixed | Manual required |
|---|---|---|---|
| CRITICAL (already enforced) | N | N | N |
| HIGH (deadline passed as of today) | N | N | N |

### Steps Completed
- [x] Step 1: Pre-flight — PASSED
- [x] Step 2: Initial build — PASSED
- [x] Step 3: Edits applied — N files modified
- [x] Step 4: Post-transformation build — PASSED/FAILED
- [x] Step 5: AI-assisted fixes — N fixes applied
- [x] Step 6: Final build — PASSED/FAILED
- [x] Step 6b: Build Analyzer — PASSED/FAILED/SKIPPED (not configured)
- [x] Step 7: Report generated

### Files Modified
<list from git diff --stat>

### Fixes Applied
| File | Line | Change |
|---|---|---|
| core/src/Foo.java | 5 | `org.apache.log4j.` → `org.slf4j.` |
| core/src/Bar.java | 12 | `Logger.getLogger()` → `LoggerFactory.getLogger()` |

### Manual Action Required
#### Felix Webconsole References
- Files: <list of .java files importing org.apache.felix.webconsole.*>
- Action: Remove usage; webconsole is unavailable in Cloud Service

#### Guava (deeply integrated)
- Files: <list of .java files using Guava for caching, event bus, or complex data structures>
- Action: Replace with JDK collections or Apache Commons Collections 4

### Future Enforcement (not fixed this run)
| API | Deadline |
|---|---|
| `com.adobe.granite.xss`, `com.day.cq.xss`, `handlebars`, `tika`, `bson`, `fileupload`, `smartcontent`, `opennlp`, `oak.blob`, `contentsync`, `mailer`, `httpcache`, `webdav`, `cq.commons.predicate` | 2027-03-31 |
| `commons.lang` v2, `commons.collections` v3, `org.json`, `sling.runmode`, `sling.commons.json`, `osgi.service.http` | 2027-12-31 |

### Errors
<list of errors encountered, or "None">

### Warnings
<list of warnings, or "None">

### Next Steps
1. Trigger a Cloud Manager code quality pipeline to confirm compliance
2. Re-run this skill after future deadlines pass to pick up remaining APIs automatically
3. Run tests: `mvn test` to verify no behavioral regressions
```
