# Recipe — Remove Deprecated API

> Read this fully before editing. Control plane: [SKILL.md](SKILL.md).
>
> **Detection is plugin-driven**: the AEM Analyser Maven Plugin
> (`com.adobe.aem:aemanalyser-maven-plugin`, latest release on Maven Central) is the
> source of truth for what is deprecated and what to replace it with. Every fix flows
> from a finding's `hint` field (the analyser's `deprecated.msg`). No hardcoded rule
> tables live in this recipe — the plugin's output IS the ruleset, refreshed on every
> run.

## Step 1: Pre-flight

### 1a. JDK and Maven

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

### 1b. Network

`detect.sh` resolves the plugin from Maven Central and (transitively) reads the AEM SDK
feature data through the plugin. If Maven Central is unreachable, the pattern cannot
run — record `skipped: network-unavailable` and continue with other patterns.

### 1c. Maven output size limit

**CRITICAL**: Maven commands produce very verbose output that can exceed the tool output
buffer limit (1 MB). Every Maven invocation redirects to a log file and only returns
the tail:

```bash
$MVN_CMD <args> > /tmp/mvn-modernize.log 2>&1; \
MVN_EXIT=$?; \
echo "=== Maven exit code: $MVN_EXIT ==="; \
tail -150 /tmp/mvn-modernize.log; \
exit $MVN_EXIT
```

Full output stays available in `/tmp/mvn-modernize.log`.

## Input contract

Findings come from the shared analyzer (`analyze.sh`) in the standard shape, with an
added `hint` field carrying the AEM Analyser Maven Plugin's deprecation message for
that package:

```json
{
  "findings": [
    {"pattern": "remove-deprecated-api",
     "file":    "core/src/main/java/com/example/MyService.java",
     "line":    5,
     "snippet": "org.apache.log4j.Logger",
     "hint":    "The log4j 1.x libraries are deprecated. Please use org.slf4j instead."}
  ],
  "warnings": []
}
```

The `snippet` is the fully-qualified imported package (as reported by the Java
compiler tree). Sub-category is inferred from the file extension: `.java` → Java
import; `pom.xml` → Maven dependency; `.cfg` / `.cfg.json` / `.config` → OSGi config.
The current Java detector emits findings for Java imports only; the recipe's Step 4
also inspects the rules cache and the project's `pom.xml` for Maven-dep matches
against the same deprecated packages (see Step 4d Category B).

Sources:

1. **User-named** — user specifies files or coordinates directly. Still run the
   Phase 1 preflight (`detect.sh`) so the analyzer has a fresh rules cache to
   consume.
2. **Discover** — run Phase 1 then Phase 2 per the Discovery section in
   [`SKILL.md`](SKILL.md).

---

## Migration Checklist

```
Migration Progress:
- [ ] Step 1: Pre-flight (verify Maven and JVM, set MVN_CMD, confirm network)
- [ ] Step 2: Initial build (verify project compiles before changes)
- [ ] Step 3: Detection — 3a preflight (detect.sh, populates rules cache); 3b analyzer (analyze.sh consumes cache)
- [ ] Step 4: Apply edits (each fix driven by the finding's hint; Experience League fallback)
- [ ] Step 5: Post-transformation build (verify edits didn't break anything)
- [ ] Step 6: AI-assisted code fixes (fix compile errors introduced by rewrites)
- [ ] Step 7: Final build verification (analyser now clean)
- [ ] Step 8: Generate report
```

## How build steps relate

Steps 2, 5, and 7 are build steps. Step 2 verifies the project compiles before any
changes. Step 5 catches breakage introduced by Step 4 edits. Step 7 is the final
verification after AI-assisted fixes. Do not carry forward module skips or assumptions
between build steps — transformations and fixes in between may change which modules
compile:

- **Step 4** (edits) → may fix some modules but break others (successor class has a
  different signature than the deprecated one).
- **Step 6** (AI fixes) → resolves compilation errors from Step 5.
- **Step 7** (final) → captures the true state and re-runs the analyser to confirm zero
  past-due deprecations.

Always attempt the **full project build** at each build step.

## Step 2: Initial Build (Baseline)

Build the project to verify it compiles before any migration changes.

```bash
$MVN_CMD clean install \
  -DskipTests \
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

## Step 3: Detection (two-phase)

### 3a. Preflight — run `detect.sh` (populates the rules cache)

```bash
bash "$SKILL_DIR/remove-deprecated-api/scripts/detect.sh" "$PROJECT_ROOT"
```

`$SKILL_DIR` is `plugins/aem/cloud-service/skills/code-assessment`. `detect.sh`:

1. Resolves the latest `aemanalyser-maven-plugin` and the latest `aem-sdk-api`
   versions from Maven Central (each pin-able with `--pin-plugin` / `--pin-sdk`).
   The latest SDK is forced via `-DsdkVersion=<latest> -DsdkUseDependency=false` so
   the freshest deprecation metadata is used — this matches Cloud Manager and
   overrides any `<sdkVersion>` / `<useDependencyVersions>` pin in the plugin
   config **without touching the pom** (pass `--respect-pom-sdk` to keep the pin).
2. Upgrades the plugin's `<version>` in the project's root `pom.xml` if the plugin
   is already declared, or injects a temporary block if not.
3. Runs `mvn verify` and captures the log at `/tmp/aem-analyser.log`.
4. Parses `Usage of deprecated ... found : <pkg> : <hint> ...` lines from the log.
5. **Writes the rules cache TSV** — `<package>\t<hint>\t<for_removal>` per line —
   at `$AEM_DEPRECATED_API_RULES` (env override) or the default path
   `$TMPDIR/aem-code-assessment/deprecated-api-rules.tsv`.
6. **Leaves the plugin wired in.** Both branches persist on disk: an in-place
   `<version>` bump on an already-declared plugin, and a fresh `<plugin>` block when
   the plugin was missing — the analyser stays available for CI and for Step 7's
   final-verification re-run. Mid-edit failures fall back to a byte-for-byte
   pre-image restore.
7. Emits a JSON summary on stdout (plugin version, rule count, sample findings —
   useful for the run log; the authoritative findings come from Phase 2).

**If `detect.sh` exits non-zero** — inspect the reason:
- Network unreachable → skip pattern with a clear message.
- Plugin fails to run because the project doesn't declare the AEM SDK BOM → the
  analyser needs the SDK on the reactor's dependency graph; note this as a manual
  action ("add `com.adobe.aem:aem-sdk-api` as a parent BOM or dependency") and skip.
- Analyser reports no findings → the rules cache exists but is empty; Phase 2 will
  report no findings for this pattern. Stop.

**Pin the plugin version** with `--pin-plugin <version>` when the environment
requires a specific release (e.g. air-gapped mirrors). Otherwise the latest release
is always chosen.

### 3b. Run the shared analyzer (consumes the cache)

```bash
bash "$SKILL_DIR/scripts/analyze.sh" "$WORKSPACE_ROOT" --pattern remove-deprecated-api
```

The Java `RemoveDeprecatedApi` detector reads the rules TSV from the well-known cache
path, matches each rule's package against every `import` in the parsed Java corpus
(longest-prefix), applies today's past-due gating (defence-in-depth against a stale
cache), and emits findings in the standard shape with an added `hint` field:

```json
{"pattern":"remove-deprecated-api","file":"core/src/main/java/.../MyService.java",
 "line":5,"snippet":"org.apache.log4j.Logger","hint":"...Please use org.slf4j instead."}
```

**If the rules cache is missing** (Phase 1 was skipped or failed), the detector
emits a single warning
`deprecated-api-rules-missing: expected TSV at <path> — run remove-deprecated-api/scripts/detect.sh preflight first`
and produces no findings for this pattern. Other detectors continue unaffected.

Every subsequent step operates on the analyzer's findings list.

---

## Step 4: Apply Edits

Work through the findings list, grouped by unique `package`. For each group, derive
the fix **from the finding's `hint`** (never from a hardcoded table). Group edits by
sub-category — Java imports first, then Maven dependencies, then OSGi configs.

### 4a. Extract the successor from the hint

Apply these phrase rules to the `hint` field, in order (first match wins):

| Phrase in hint | Interpretation |
|---|---|
| `"Please use X instead"` / `"Use X instead"` | `X` is the drop-in successor package |
| `"X should be used"` | `X` is the successor |
| `"The <Lib> libraries are deprecated"` (no successor named) | Fall back to Experience League |
| `"Usage of this API is not supported in AEM as a Cloud Service"` | Fall back to Experience League |
| `"This internal <Z> API is not supported"` | Use only the public API of `Z`; drop the `.spi` / `.internal` package |
| `"This version of the <Lib> library is deprecated. Use your own version"` | Explicit Maven dep required — get user consent |
| Hint empty or unrecognised | Fall back to Experience League |

Regex hints (for machine extraction):

- `Please use ([a-z][\w]*(?:\.[a-z][\w]*)+) instead`
- `Use ([a-z][\w]*(?:\.[a-z][\w]*)+) instead`
- `([a-z][\w]*(?:\.[a-z][\w]*)+) should be used`

A candidate successor must have **at least two dot-separated segments** — sentence
fragments like "Use JDK instead" are not valid packages.

### 4b. Experience League fallback

When the hint names no successor, consult Adobe's canonical **API Removal Guidance**
page once per session via `WebFetch`:

<https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/release-notes/deprecated-removed-features#api-removal-guidance>

Extract the recommended successor (or explicit removal instruction) for the package.
If the page names a Maven dependency to add (e.g. `mongo-java-driver:3.12.7` bundled
in the content package), record it as manual-action-required — dependency additions
are not applied without user consent.

### 4c. Verify the successor is on the classpath

Before applying a Java-import rewrite, confirm the successor is resolvable in the
target module:

```bash
$MVN_CMD -pl <module> -am -q dependency:build-classpath \
  -Dmdep.outputFile=/tmp/cp.txt > /tmp/mvn-modernize.log 2>&1
grep -l "<successor-path>" /tmp/cp.txt
```

`java.*` / `javax.*` packages are assumed available (they are on every AEM CS JRE).

If the successor is not on the classpath, either (a) add the correct Maven dep with
user consent, or (b) mark the finding as `manual-action-required: successor-not-on-classpath`.

### 4d. Apply per-category

#### Category A — Java imports (`.java` findings)

For each Java finding:

1. Read the file at the recorded path.
2. Locate the deprecated import at the recorded line.
3. Rewrite the import to the successor (keep the class name after the prefix
   unchanged). If a code replacement is implied (e.g. `Logger.getLogger(` →
   `LoggerFactory.getLogger(` for the log4j → SLF4J case), search the file body and
   apply it too.
4. Add the extra import line if the hint or Experience League guidance requires it
   (e.g. `LoggerFactory`).
5. Use the `Edit` tool.
6. If the import is no longer present (file modified since discovery), record
   `skipped: deprecated-import-not-found: <prefix> not present in <file>`.

**Before / after example — log4j → SLF4J** (hint: *"...Please use `org.slf4j` instead"*):

```java
// Before
import org.apache.log4j.Logger;
public class MyService {
    private static final Logger log = Logger.getLogger(MyService.class);
}

// After
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
public class MyService {
    private static final Logger log = LoggerFactory.getLogger(MyService.class);
}
```

#### Category B — Maven dependencies (`pom.xml` findings)

The analyser flags a deprecated Maven artifact when a bundle in the project depends
on it. Read the hint for the recommended action:

- Hint names a replacement artifact → rewrite `<groupId>` / `<artifactId>` and remove
  `<version>` (the AEM SDK BOM manages the version). Insert any extra dependency the
  hint requires.
- Hint says "remove" or "not supported" → delete the `<dependency>` block.
- Hint names an upgrade target (e.g. `4.3.0`) → update `<version>` or, if it is a
  `${property}` reference, update the property declaration.
- Ambiguous (multiple `<dependency>` blocks match) → record `skipped: maven-dep-ambiguous`.

**Before / after example — commons-lang v2 → v3** (hint: *"Please use `org.apache.commons.lang3` instead"*):

```xml
<!-- Before -->
<dependency>
  <groupId>commons-lang</groupId>
  <artifactId>commons-lang</artifactId>
  <version>2.6</version>
</dependency>

<!-- After -->
<dependency>
  <groupId>org.apache.commons</groupId>
  <artifactId>commons-lang3</artifactId>
</dependency>
```

#### Category C — Unmodifiable OSGi configs (`.cfg` / `.cfg.json` / `.config` findings)

The analyser flags OSGi configs whose PID is on Cloud Manager's unmodifiable list.
Delete the entire file:

```bash
rm "<file>"
```

Verify: `git status`. AEM CS ignores these configs entirely; leaving them in place is
harmless but the analyser continues to flag them.

### 4e. Skip / unlocatable reasons

| Reason | When |
|---|---|
| `deprecated-import-not-found: <prefix> not present in <file>` | File modified since discovery |
| `hint-empty: no successor named` | Hint field blank; Experience League also silent |
| `successor-not-on-classpath: <successor>` | Successor package not resolvable; needs a new dep |
| `maven-dep-ambiguous: multiple blocks match <coords> in <file>` | Manual fix required |
| `osgi-config-pid-mismatch: <pid> not referenced in <file>` | File exists but contains a different PID |
| `manual-only: <reason>` | Design decision required (webconsole, deep Guava, reflection, SPA Editor) |

Record every skipped finding — do not silently drop.

### 4f. Review what changed

```bash
git diff --stat
```

Print the list of modified files. Verify sensibility before proceeding.

---

## Step 5: Post-transformation build

```bash
$MVN_CMD clean install \
  -DskipTests \
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

**If exit code = 0**: Proceed to Step 7 (skip Step 6).

**If exit code != 0**: Proceed to Step 6 — the AI-fix loop handles compilation errors
from the edits applied in Step 4.

---

## Step 6: AI-assisted code fixes

Fix compilation errors that Step 4 edits could not handle. Read `/tmp/mvn-modernize.log`
to find specific errors.

**What you can fix**: compilation errors from import rewrites (renamed class, different
method signature), missing imports from package relocations (e.g. commons-lang v2 → v3
`StringEscapeUtils` moved to commons-text), deprecated API usage that no longer
compiles after a dep version bump, missing dependencies that need to be added as a
result of migration.

**What you cannot modify**: README / docs, `.gitignore`, Dockerfiles, build / deploy
scripts, test data files, business logic in working code (only fix compilation errors —
never refactor), `.content.xml` dialogs, `ui.content/` packages, Dispatcher configs.

**javax.servlet vs jakarta.servlet — never migrate**: AEM as a Cloud Service uses the
`javax.servlet` namespace (and related APIs: `javax.servlet.*`, `javax.annotation.*`).
Never replace these with `jakarta.*` — it will break the build. Fix `javax.servlet`
import errors by ensuring the correct AEM SDK dependency is present, not by changing
the namespace.

Every AI-applied code change **must** be marked with a comment immediately above:

```java
// Fixed by AEM Modernizer AI
```

### 6a. Build-fix iteration pattern

1. Read the build log to identify the first failing module.
2. Read the specific file(s) with errors using the `Read` tool.
3. Identify the deprecated API that was partially migrated (import renamed but
   successor class has a different signature, missing method, etc.).
4. Apply the minimal fix using the `Edit` tool — smallest change that compiles.
5. Add `// Fixed by AEM Modernizer AI` above every changed line.
6. Re-run the build.
7. Repeat up to 5 times total.

### 6b. Dependency resolution failures

- **Edit bumped a version that doesn't exist**: revert to the previous version and
  note it in the report.
- **Removed dependency still needed**: re-add it with the correct replacement
  coordinates (or add a new bundle as Experience League specifies).
- **Customer-specific/private dependency**: STOP — report as requiring manual
  intervention.
- **Network/auth failure**: STOP — report as infrastructure issue.

### 6c. Manual-action items (cannot auto-fix — document, do not edit)

- `org.apache.felix.webconsole.*` — webconsole is unavailable on Cloud Service; requires
  rethinking the debug/admin approach.
- `com.mongodb.*` — the plugin flags the import; making the driver available at
  runtime requires embedding `org.mongodb:mongo-java-driver:<version>` as a bundle
  (project-specific Maven configuration that cannot be auto-applied).
- Guava — caching, event bus, `Ordering`, `Multimap`, or immutable collections beyond
  `Lists.newArrayList()`: replacement requires design decisions.
- SPA Editor code — architectural migration.
- Workflow definitions (e.g. DAM Asset Update) — AEM config, not Java.
- Any finding where hint AND Experience League name no successor.

Record each in the report under **Manual Action Required** with the exact files and
line numbers.

---

## Step 7: Final build + analyser re-run

Build the project one last time. Because the plugin is now on the project (either as
a permanent addition or via the `--pin-plugin` upgrade), `mvn verify` also re-runs the
analyser — the true test of whether the migration cleared every past-due deprecation.

```bash
$MVN_CMD clean verify \
  -Dmaven.clean.failOnError=false \
  -DskipTests \
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

**If exit code = 0 AND log contains zero `Usage of deprecated ... found` lines**:
migration complete. Proceed to Step 8.

**If exit code = 0 but analyser still reports deprecations**: re-run Step 4 for the
new list — some findings were manual-action-only or the AI-fix loop skipped them.
Repeat once at most.

**If exit code != 0**: attempt fixes (same constraints as Step 6). Retry up to 3
times. If still failing, report "Final build failed. Migration is incomplete." Still
proceed to Step 8 to capture partial progress.

### 7a. Common analyser findings to interpret

| Analyser finding | What it means | Action |
|---|---|---|
| `Usage of deprecated package found : <pkg>` | region-deprecated-api — the primary trigger for this skill | Handled by the recipe |
| `Import-Package not satisfied` | Bundle imports a package no other bundle exports | Successor is not on the CS runtime — pick a JDK/available alternative |
| `api-regions-check` violation | Bundle uses an internal/private AEM API | Replace with public AEM API equivalent |
| `content-package-validation` failure | Malformed XML or invalid node type | Fix the flagged content file |
| `bundle-unversioned-packages` | Missing version range on import | Add version constraint in `bnd.bnd` or `Import-Package` |

---

## Editing strategy

- **Edits are surgical** — only touch the deprecated import/dep/config; no
  reformatting.
- **No partial migrations** — if a file still fails after 5 AI-fix iterations, record
  as `compile-error-unresolved` and roll back that file.
- **Preserve formatting** — match surrounding indentation; do not run a code
  formatter.
- **Mark every AI change** — `// Fixed by AEM Modernizer AI` immediately above each
  changed line in Step 6. Step 4 edits are direct replacements attributable via
  `git diff`.

---

## Step 8: Generate report

MANDATORY. Always produce a structured report.

### 8a. Review the changes

```bash
git diff --stat
```

Confirm: Java source files have import/API upgrades; `pom.xml` files have dependency
changes; OSGi config files were removed where appropriate; no unexpected files were
modified.

### 8b. Print the modernization report

```markdown
## AEM Modernize Report

**Scan root:** <path>
**Date:** <today>
**Analyser plugin version:** <plugin_version from detect.sh meta>
**Final build status:** <SUCCESS | FAILED>
**Analyser final status:** <CLEAN | RESIDUAL FINDINGS>

### Summary
> Detection driven by aemanalyser-maven-plugin — the deprecation set is refreshed on
> every run. Future-dated deprecations are not flagged by the plugin and are picked
> up automatically on subsequent runs after each removal date passes.

| Category | Found | Fixed via hint | Fixed via Experience League | Manual required |
|---|---|---|---|---|
| Java imports | N | N | N | N |
| Maven `pom.xml` deps | N | N | N | N |
| OSGi unmodifiable PIDs | N | N | N | N |

### Steps Completed
- [x] Step 1: Pre-flight — PASSED
- [x] Step 2: Initial build — PASSED
- [x] Step 3: Plugin-driven detection — N findings, plugin v<version>
- [x] Step 4: Edits applied — N files modified
- [x] Step 5: Post-transformation build — PASSED/FAILED
- [x] Step 6: AI-assisted fixes — N fixes applied
- [x] Step 7: Final build + analyser rerun — PASSED/FAILED, analyser CLEAN/RESIDUAL
- [x] Step 8: Report generated

### Files Modified
<list from git diff --stat>

### Fixes Applied
| File | Line | Deprecated package | Successor | Source |
|---|---|---|---|---|
| core/src/Foo.java | 5 | org.apache.log4j | org.slf4j | hint |
| core/pom.xml | 12 | commons-lang:commons-lang | org.apache.commons:commons-lang3 | hint |
| core/src/Bar.java | 8 | com.day.cq.xss | org.apache.sling.xss | Experience League |

### Manual Action Required
For each item:
- What was found (file:line, deprecated package)
- Why it couldn't be auto-fixed (design decision required / no successor named by
  hint or Experience League / manual API redesign)
- What Adobe Experience League says (quote or link)

### Analyser final output
- If CLEAN → "No past-due deprecated APIs detected against
  aemanalyser-maven-plugin v<version>."
- If RESIDUAL → list each remaining `Usage of deprecated ... found` line and its
  disposition (deferred, manual-action, third-party).

### Errors
<list of errors encountered, or "None">

### Warnings
<list of warnings from the analyser or elsewhere, or "None">

### Next Steps
1. Trigger a Cloud Manager code quality pipeline to confirm compliance.
2. Re-run this skill after future removal dates pass — the plugin picks up newly
   past-due deprecations automatically.
3. Run tests: `mvn test` to verify no behavioral regressions.
```
