# AEM 6.5 LTS — Java 21 Migration Workflow

This document is the authoritative step-by-step guide the agent follows during migration. Read it in full before starting. Each step specifies exact commands, expected outcomes, error thresholds, and hard-stop conditions.

---

## Pre-flight Checklist

Complete all items before executing Step 1. Do not proceed if any item cannot be satisfied.

### Build the Migration Tool

The CLI tool must be built before any migration commands can run:

```bash
cd $SKILL_DIR
mvn clean install -DskipTests
```

Expected output ends with:
```
[INFO] BUILD SUCCESS
```

Set the JAR path for use in all subsequent commands:

```bash
MIGRATE_JAR="$SKILL_DIR/aem65lts-migration-cli/target/aem65lts-migration-cli-1.0-SNAPSHOT.jar"
```

Verify the JAR exists:

```bash
test -f "$MIGRATE_JAR" && echo "OK: migration JAR found" || echo "FAIL: JAR not found — build failed"
```

If the build fails, check that both `aem65lts-migration-recipes` and `aem65lts-migration-cli` modules compiled successfully. The CLI depends on the recipes JAR being installed to the local Maven repository (`~/.m2`).

### Environment Variables

Verify the following variables are set and point to valid paths:

```bash
# Required for Java 8 source projects; skip if project is already on Java 11
echo $JAVA8_HOME   # e.g. /Library/Java/JavaVirtualMachines/jdk1.8.0_392.jdk/Contents/Home

# Required — OpenRewrite must run under JDK 11 or later
echo $JAVA11_HOME  # e.g. /Library/Java/JavaVirtualMachines/jdk-11.0.22.jdk/Contents/Home

# Required — intermediate and final builds
echo $JAVA21_HOME  # e.g. /Library/Java/JavaVirtualMachines/jdk-21.0.3.jdk/Contents/Home

# Required — root of the Maven project to migrate
echo $PROJECT_DIR  # e.g. /Users/dev/projects/my-aem-project

# Required — absolute path to this skill directory
echo $SKILL_DIR    # e.g. /path/to/skills/plugins/aem/6.5-lts/skills/java21-migration
```

Verify each JDK binary exists:

```bash
$JAVA8_HOME/bin/java  -version   2>&1 | head -1
$JAVA11_HOME/bin/java -version   2>&1 | head -1
$JAVA21_HOME/bin/java -version   2>&1 | head -1
```

Expected pattern: `openjdk version "X[...]"` where X matches the major version. If any JDK is missing, resolve before continuing.

### Maven

```bash
mvn --version
```

Expected: `Apache Maven 3.9.x` or later. If Maven is not on `PATH`, set `MAVEN_HOME` and add `$MAVEN_HOME/bin` to `PATH`.

### Git

```bash
cd $PROJECT_DIR && git status
```

Expected: `nothing to commit, working tree clean`. If there are uncommitted changes, stash or commit them before proceeding.

### Maven Settings

If the project requires the Adobe Public Repository and it is not in `~/.m2/settings.xml`, copy the template:

```bash
cp $SKILL_DIR/configs/maven-settings-template.xml ~/.m2/settings.xml
```

Or pass it explicitly via `--mavenSettings $SKILL_DIR/configs/maven-settings-template.xml` on all CLI invocations below.

---

## Step 1: Pre-Migration Analysis

**Purpose:** Scan the project for blockers that would prevent a successful migration before any changes are made. No files are modified in this step.

### Command

```bash
java -jar $MIGRATE_JAR analyze -r $PROJECT_DIR \
  2>&1 | tee $PROJECT_DIR/analysis.log
```

### Expected Output

```
Pre-migration analysis complete.
  Hard blockers : 0
  Warnings      : 3
  Modules scanned: 12
```

The command exits with:
- **0** — project is ready to migrate
- **1** — warnings present, migration can proceed with caution
- **2** — hard blockers found, migration must not proceed

### Decision Logic

**If exit code 2 (hard blockers) → HARD STOP**

Read the analysis output. Each blocker entry contains:
- The matched import or dependency pattern
- Why migration cannot proceed
- The source files affected

Report all blockers to the user. Do not proceed until blockers are resolved. Hard-stop packages are defined in `configs/unsupported-apis.yaml` under `hard_stop_packages`.

**If exit code 1 (warnings) → log and continue**

Warnings indicate dependencies that were removed from the AEM 6.5 LTS runtime (Guava, Caffeine, Jetty, Commons Collections 3). The project will compile but may fail at runtime. Record warnings in the final report. Remediation guidance is in `references/removed-bundles-remediation.md`.

**If the command itself fails (non-zero, not 1 or 2) → HARD STOP**

Fix the invocation before continuing. Common causes: wrong `$PROJECT_DIR`, missing `pom.xml` at project root, JAR not built.

---

## Step 2: Validate Project Structure

**Purpose:** Confirm the Maven project layout is compatible with the migration tool.

### Checks

```bash
# 1. Root pom.xml exists
test -f $PROJECT_DIR/pom.xml && echo "OK: pom.xml found" || echo "FAIL: no pom.xml"

# 2. Git repository exists
test -d $PROJECT_DIR/.git && echo "OK: git repo found" || echo "FAIL: not a git repo"

# 3. Count Maven modules
grep -r '<module>' $PROJECT_DIR/pom.xml | wc -l
```

### Decision Logic

**If pom.xml missing → HARD STOP.** The `$PROJECT_DIR` is not a Maven project root.

**If .git missing → HARD STOP.** The migration requires git for change attribution and rollback.

**If module count is 0**, the project is a single-module build. This is valid; the workflow proceeds identically.

### Detect Source Java Version

Inspect the root POM for the compiler source version:

```bash
# Read maven.compiler.source, maven.compiler.release, or maven-compiler-plugin <source>
SOURCE_JAVA_VERSION=$(grep -m1 'maven\.compiler\.source\|maven\.compiler\.release' \
  $PROJECT_DIR/pom.xml | grep -oP '\d+' | head -1)

echo "Detected source Java version: $SOURCE_JAVA_VERSION"

if [ "$SOURCE_JAVA_VERSION" = "8" ] || [ "$SOURCE_JAVA_VERSION" = "1.8" ]; then
  SOURCE_JDK_HOME=$JAVA8_HOME
  SOURCE_JAVA_VERSION=8
elif [ "$SOURCE_JAVA_VERSION" = "11" ]; then
  SOURCE_JDK_HOME=$JAVA11_HOME
else
  echo "ERROR: Unexpected or undetected source version: $SOURCE_JAVA_VERSION"
  # HARD STOP if version is 17 or 21 — project already migrated
  # Ask user to confirm $SOURCE_JDK_HOME manually if detection is ambiguous
fi

echo "Source JDK home: $SOURCE_JDK_HOME"
```

**If source version is 17 or 21 → HARD STOP.** The project is already at or past Java 17. This workflow is not intended for that case.

**If source version is ambiguous (not clearly 8 or 11)** → warn the user and ask for confirmation before proceeding.

### Create Migration Branch

```bash
MIGRATION_BRANCH="java21-migration/$(date +%Y%m%d-%H%M%S)"
cd $PROJECT_DIR && git checkout -b $MIGRATION_BRANCH
echo "Migration branch: $MIGRATION_BRANCH"
```

All subsequent changes will be committed to this branch.

---

## Step 3: Baseline Build

**Purpose:** Confirm the project compiles successfully at its current Java version before any changes are applied. This establishes a known-good baseline.

### Command

```bash
JAVA_HOME=$SOURCE_JDK_HOME mvn clean install \
  -DskipTests \
  -DskipFrontend=true \
  -T1C \
  -f $PROJECT_DIR/pom.xml \
  2>&1 | tee $PROJECT_DIR/build-baseline.log
```

### Expected Output

```
[INFO] BUILD SUCCESS
```

Build time varies. A 12-module project typically takes 3–8 minutes.

### Decision Logic

**If BUILD SUCCESS → continue to Step 4.**

**If BUILD FAILURE:**

1. Read `build-baseline.log`. Find the first `[ERROR]` line containing `COMPILATION ERROR` or `BUILD FAILURE`.
2. Attempt AI-assisted fix. The fix must be minimal — do not change APIs, only resolve the compile error.
3. Re-run the build command.
4. Repeat up to 3 attempts total.

**After 3 failed attempts → HARD STOP.**

Report the last compiler error verbatim. The project has pre-existing build issues that must be resolved manually before migration can begin.

---

## Step 4: Java Code Modernization

**Purpose:** Apply AST-based custom recipes that handle Java API modernization, BND plugin cleanup, FileVault artifact updates, and jakarta→javax reversion.

### Command

```bash
java -jar $MIGRATE_JAR upgrade-code \
  -r $PROJECT_DIR \
  -j $JAVA11_HOME \
  2>&1 | tee $PROJECT_DIR/upgrade-code.log
```

OpenRewrite requires JDK 11+ to parse and transform Java source files. The `-j $JAVA11_HOME` flag sets the JDK used for the Maven Invoker subprocess; it does not change the project's source/target version.

### Expected Output

```
[upgrade-code] Running OpenRewrite recipes on $PROJECT_DIR
[upgrade-code] Recipes applied:
  - RevertJakartaInAemSource
  - RemoveBndScrDescriptorPlugin
  - MigrateFileVaultEmbeddedArtifacts
  - DetectUnsupportedPackages
  - ModernizeJavaCode (stock + custom)
[upgrade-code] SUCCESS — X files modified
```

### What the Recipes Do

| Recipe | Effect |
|---|---|
| `RevertJakartaInAemSource` | Converts any `jakarta.*` imports back to `javax.*` (AEM 6.5 LTS is javax-only) |
| `RemoveBndScrDescriptorPlugin` | Removes `SCRDescriptorBndPlugin` from BND configurations (incompatible with Java 21) |
| `MigrateFileVaultEmbeddedArtifacts` | Updates Groovy Console group ID to `be.orbinson.aem`, version `19.0.8` |
| `DetectUnsupportedPackages` | Flags commerce, social, screens, and other unsupported API usages |
| `ModernizeJavaCode` (stock OpenRewrite) | Java 8/11 → 17/21 API and language updates |

### Decision Logic

**If exit code 0 → commit and continue to Step 5.**

**If command fails with "Could not resolve plugin":**
- Verify Maven settings include the Adobe Public Repository
- Re-run with `--mavenSettings $SKILL_DIR/configs/maven-settings-template.xml`

**If command fails with a recipe execution error:**
- Try running on a single module first: add `-pl core` to isolate the issue
- If that succeeds, run remaining modules: `-pl !core`

**If `DetectUnsupportedPackages` reports blockers:**
- Treat as a HARD STOP — same as Step 1 exit code 2
- Do not commit; resolve the unsupported API usage first

### Commit After Step 4

```bash
cd $PROJECT_DIR && git add -A && git commit -m "chore(migration): apply Java code modernization recipes

- RevertJakartaInAemSource: ensured javax namespace throughout
- RemoveBndScrDescriptorPlugin: removed SCRDescriptorBndPlugin from BND configs
- MigrateFileVaultEmbeddedArtifacts: Groovy Console → be.orbinson.aem 19.0.8
- ModernizeJavaCode: Java 8/11 → 21 API and language updates

[java21-migration step-4]"
```

---

## Step 5: Upgrade Maven Build Plugins

**Purpose:** Update Maven build plugin versions to versions compatible with Java 21.

### Command

```bash
java -jar $MIGRATE_JAR upgrade-plugins \
  -r $PROJECT_DIR \
  -j $JAVA11_HOME \
  2>&1 | tee $PROJECT_DIR/upgrade-plugins.log
```

### Expected Output

```
[upgrade-plugins] SUCCESS — X plugin versions updated
  maven-bundle-plugin: → 5.1.9
  bnd-maven-plugin: → 6.4.0
  maven-compiler-plugin: source/target/release → 21
```

### What This Step Does

- Sets `maven-bundle-plugin` to version 5.1.9 or later
- Sets `bnd-maven-plugin` to version 6.4.0 or later
- Sets `maven.compiler.source`, `maven.compiler.target`, and `maven.compiler.release` to `21` in root POM properties
- Sets `<source>21</source>`, `<target>21</target>`, `<release>21</release>` inside `maven-compiler-plugin` configuration blocks

### Decision Logic

**If exit code 0 → commit and continue to Step 6.**

**If the step fails:**
- This step is considered soft-failure. Log the failure with the error from `upgrade-plugins.log`.
- Attempt the plugin upgrades manually by editing the POM files directly.
- Do not continue to Step 6 until `maven-compiler-plugin` has been set to target Java 21 — this is required for the intermediate build.

### Commit After Step 5

```bash
cd $PROJECT_DIR && git add -A && git commit -m "chore(migration): upgrade Maven build plugin versions

- maven-bundle-plugin: → 5.1.9
- bnd-maven-plugin: → 6.4.0
- maven-compiler-plugin: source/target/release set to 21

[java21-migration step-5]"
```

---

## Step 6: Upgrade Dependencies and UberJar

**Purpose:** Update AEM dependency versions and inject the `apis` classifier into all UberJar references.

### Commands

Run dependency upgrade and UberJar migration in sequence:

```bash
java -jar $MIGRATE_JAR upgrade-dependencies \
  -r $PROJECT_DIR \
  -j $JAVA11_HOME \
  2>&1 | tee $PROJECT_DIR/upgrade-dependencies.log

java -jar $MIGRATE_JAR upgrade-uberjar \
  -r $PROJECT_DIR \
  -j $JAVA11_HOME \
  2>&1 | tee $PROJECT_DIR/upgrade-uberjar.log
```

### Expected Output

```
[upgrade-dependencies] SUCCESS — X dependency versions updated
  com.adobe.aem:uber-jar: → 6.6.0
  com.adobe.cq:core.wcm.components.all: → 2.24.0
  be.orbinson.aem:aem-groovy-console-bundle: → 19.0.8

[upgrade-uberjar] SUCCESS — apis classifier injected
  uber-jar dependencies updated: X occurrences
```

### What These Steps Do

**upgrade-dependencies:**
- Updates `com.adobe.aem:uber-jar` to version `6.6.0`
- Updates WCM Core Components to `2.24.0` or later
- Updates Groovy Console group and version (if not already handled by Step 4 recipes)

**upgrade-uberjar:**
- Ensures all `com.adobe.aem:uber-jar` dependencies have `<classifier>apis</classifier>`
- This is required for UberJar 6.6.0 — without it the dependency resolves but annotation processors are missing

### Decision Logic

**If both commands exit 0 → commit and continue to Step 7.**

**If `upgrade-dependencies` fails:**
- Log the failure. Attempt manual POM edits for the dependency versions listed above.
- Do not block on this — the intermediate build in Step 7 will reveal missing version updates.

**If `upgrade-uberjar` fails:**
- This is more critical. Inject the classifier manually:
  ```xml
  <!-- In every pom.xml that declares uber-jar -->
  <dependency>
    <groupId>com.adobe.aem</groupId>
    <artifactId>uber-jar</artifactId>
    <version>6.6.0</version>
    <classifier>apis</classifier>
    <scope>provided</scope>
  </dependency>
  ```
- Do not proceed to Step 7 without the classifier — the build will fail with missing annotation processor JARs.

### Commit After Step 6

```bash
cd $PROJECT_DIR && git add -A && git commit -m "chore(migration): upgrade AEM dependencies and UberJar

- uber-jar: → 6.6.0 with apis classifier
- core.wcm.components.all: → 2.24.0
- upgrade-dependencies: updated remaining dependency versions

[java21-migration step-6]"
```

---

## Step 7: Set CloudManager Java Version

**Purpose:** Signal to Cloud Manager that this project requires JDK 21 for pipeline builds.

### Command

The `full-migrate` command sets this automatically. When running steps individually:

```bash
mkdir -p $PROJECT_DIR/.cloudmanager
printf '21' > $PROJECT_DIR/.cloudmanager/java-version
echo "OK: .cloudmanager/java-version set to 21"
```

Verify:

```bash
cat $PROJECT_DIR/.cloudmanager/java-version
# Expected: 21
```

The file must contain exactly `21` with no trailing newline. Cloud Manager reads this value literally.

### Decision Logic

**If the file exists and contains `21` → continue.**

**If the file is missing or contains a different value:** Create or overwrite it with the command above. This is not optional — without it, Cloud Manager will build with the default JDK (8 or 11) and the build will fail.

### Commit After Step 7

```bash
cd $PROJECT_DIR && git add $PROJECT_DIR/.cloudmanager/java-version
cd $PROJECT_DIR && git commit -m "chore(migration): set CloudManager Java version to 21

- .cloudmanager/java-version: 21

[java21-migration step-7]"
```

---

## Step 8: Intermediate Build (JDK 21)

**Purpose:** Verify the project compiles with JDK 21 after the automated transforms. This is the critical checkpoint — failures here are expected and handled by the AI-assisted fix loop.

### Command

```bash
JAVA_HOME=$JAVA21_HOME mvn clean install \
  -DskipTests \
  -DskipFrontend=true \
  -T1C \
  -f $PROJECT_DIR/pom.xml \
  2>&1 | tee $PROJECT_DIR/build-intermediate.log
```

### Decision Logic

**If BUILD SUCCESS → continue to Step 9.**

**If BUILD FAILURE — AI-assisted fix loop (up to 3 attempts):**

For each attempt:

1. Parse `build-intermediate.log` to extract compilation errors. Focus on the first `COMPILATION ERROR` block.

2. Identify the root cause category:

   | Error Pattern | Root Cause | Fix |
   |---|---|---|
   | `package jakarta.* does not exist` | OpenRewrite introduced jakarta imports | Revert to javax namespace |
   | `package javax.* does not exist` | Missing dependency scope | Check provided/compile scope on uber-jar |
   | `cannot find symbol ... class Foo` | Removed AEM API | Check `references/removed-bundles-remediation.md` |
   | `error: module X not found` | Split package issue | Add `--add-opens` JVM arg or remove split package |
   | `method X in class Y cannot be applied` | Signature change | Update call site to new signature |
   | `unchecked or unsafe operations` | Raw type warning promoted to error | Add `@SuppressWarnings` or parameterize type |

3. Apply the minimal fix that resolves the root cause.

   **Critical guardrail for this step:** If any javax import was changed to jakarta, revert it. AEM 6.5 LTS runs on the javax namespace. Search for accidental jakarta imports:

   ```bash
   grep -rn "import jakarta\." $PROJECT_DIR --include="*.java"
   ```

   For each hit, revert to the javax equivalent:
   ```bash
   find $PROJECT_DIR -name "*.java" \
     -exec sed -i '' 's/import jakarta\.servlet\./import javax.servlet./g' {} + \
     -exec sed -i '' 's/import jakarta\.annotation\./import javax.annotation./g' {} +
   ```

4. Re-run the build command.

5. If BUILD SUCCESS → commit fixes and continue to Step 9.

**After 3 failed attempts → HARD STOP.**

Record:
- The final compiler error (full block from the log)
- Which files were modified in each attempt
- Which error category was identified
- Why the fix did not resolve it

The user must manually fix these modules. Once fixed, the workflow can resume at Step 8.

### Commit After Step 8 (if fixes were applied)

```bash
cd $PROJECT_DIR && git add -A && git commit -m "fix(migration): resolve Java 21 compilation errors (intermediate build)

[list each fix applied and the file it targeted]

[java21-migration step-8]"
```

---

## Step 9: Test Framework Migration

**Purpose:** Migrate test dependencies, primarily Mockito, from 1.x/2.x to 5.x. This runs after the intermediate build succeeds to avoid compounding failures.

### Command

```bash
java -jar $MIGRATE_JAR upgrade-tests \
  -r $PROJECT_DIR \
  -j $JAVA21_HOME \
  2>&1 | tee $PROJECT_DIR/upgrade-tests.log
```

Note: `upgrade-tests` uses JDK 21 (not JDK 11) because the test source code must be parsed against the JDK 21 classpath, which is now set in the project's compiler configuration.

### Expected Output

```
[upgrade-tests] Running Mockito migration recipes on $PROJECT_DIR
[upgrade-tests] SUCCESS — X test files modified
  Mockito: 1.x/2.x → 5.11.0
  Updated import paths and mock creation APIs
```

### Decision Logic

**This step is NON-FATAL.**

**If the command succeeds → commit and continue.**

**If the command fails:**
- Log the failure with the error from `upgrade-tests.log`.
- Add a warning entry to the migration report: "Mockito migration was not applied automatically. Manual migration required."
- Continue to Step 10 without committing Step 9 changes.

Do not retry this step more than once. Test migration failures do not block the Java 21 compilation goal.

### Commit After Step 9 (only if successful)

```bash
cd $PROJECT_DIR && git add -A && git commit -m "chore(migration): apply test framework migration

- Mockito: 1.x/2.x → 5.11.0
- Updated import paths and mock creation APIs
- PowerMock references flagged for manual review (not auto-migrated)

[java21-migration step-9]"
```

---

## Step 10: Final Build (JDK 21)

**Purpose:** Run the complete build including tests with JDK 21. This is the definitive pass/fail gate for the migration.

### Command

```bash
JAVA_HOME=$JAVA21_HOME mvn clean install \
  -DskipFrontend=true \
  -T1C \
  -f $PROJECT_DIR/pom.xml \
  2>&1 | tee $PROJECT_DIR/build-final.log
```

Note: `-DskipTests` is NOT set. Tests run in this step.

### Decision Logic

**If BUILD SUCCESS → continue to Step 11.**

**If BUILD FAILURE — AI-assisted fix loop (up to 3 attempts, 45 minutes maximum per attempt):**

Follow the same process as Step 8, but now also handle test failures:

| Failure Type | Action |
|---|---|
| Compilation error | Fix root cause in production code |
| Test compilation error | Fix test code to match new APIs |
| Test runtime failure: `StrictStubbing` | Mockito 5 is stricter — remove unused stubs |
| Test runtime failure: `NullPointerException` | Check for APIs removed from mocked AEM objects |
| Test runtime failure: assertion mismatch | Verify the logic change was intentional |

**Per-attempt time limit:** If a single fix attempt takes more than 45 minutes of elapsed time, stop that attempt and count it. This prevents infinite loops on deeply nested build failures.

**After 3 failed attempts → HARD STOP.**

At this point the project compiles (as verified by Step 8) but tests fail. Report:
- Module(s) with failing tests
- Test names and failure messages
- Whether failures appear to be pre-existing or introduced by the migration

The user may choose to merge the migration branch with `-DskipTests` for now and address test failures separately.

### Commit After Step 10 (if fixes were applied)

```bash
cd $PROJECT_DIR && git add -A && git commit -m "fix(migration): resolve Java 21 build and test failures (final build)

[list each fix applied and the file it targeted]

[java21-migration step-10]"
```

---

## Step 11: Verify and Cleanup

**Purpose:** Clean up any migration artifacts, run post-migration verification, and generate the migration report.

### 11a. Cleanup

Verify no accidental jakarta imports remain:

```bash
JAKARTA_COUNT=$(grep -rn "import jakarta\." $PROJECT_DIR --include="*.java" | wc -l | tr -d ' ')
echo "Accidental jakarta imports: $JAKARTA_COUNT"
if [ "$JAKARTA_COUNT" -gt "0" ]; then
  grep -rn "import jakarta\." $PROJECT_DIR --include="*.java"
  # HARD STOP — do not proceed until these are resolved
fi
```

If any jakarta imports are found, apply the `RevertJakartaInAemSource` recipe again:

```bash
java -jar $MIGRATE_JAR upgrade-code \
  -r $PROJECT_DIR \
  -j $JAVA11_HOME \
  --recipe RevertJakartaInAemSource
```

### 11b. Post-Migration Verification

```bash
java -jar $MIGRATE_JAR verify -r $PROJECT_DIR \
  2>&1 | tee $PROJECT_DIR/verification.log
```

The `verify` command checks:
- `maven.compiler.source` / `maven.compiler.release` set to `21` in root POM
- No module POM sets compiler source to less than 21
- `com.adobe.aem:uber-jar` version is `6.6.0` and classifier is `apis`
- `maven-bundle-plugin` version is `5.1.9` or later
- `.cloudmanager/java-version` contains `21`
- No `jakarta.*` imports in Java source files
- No `SCRDescriptorBndPlugin` references in any POM

Expected output:

```
[verify] Verification complete.
  Checks passed : 8
  Checks failed : 0
  Warnings      : 1
```

**If any check fails → do not proceed.** Resolve the failure and re-run verify.

**If warnings only → continue.** Record warnings in the final report.

### 11c. Review Git Diff

Display the full diff for human review:

```bash
cd $PROJECT_DIR && git diff main..HEAD --stat
```

This shows the total scope of changes. Review for:
- Unexpected file modifications
- Files that should not have changed (content packages, frontend assets)
- Modules that appear unchanged when they should have been updated

### 11d. Final Commit

```bash
cd $PROJECT_DIR && git add -A && git commit -m "chore(migration): post-migration verification and cleanup

- No accidental jakarta imports found
- All verification checks passed
- .cloudmanager/java-version confirmed as 21

[java21-migration step-11]"
```

### 11e. Summary to User

Present the following to the user:

1. Migration branch name: `$MIGRATION_BRANCH`
2. Verification result: pass / pass-with-warnings / fail
3. Any warnings that require manual follow-up
4. Recommended next steps:
   - Review the git diff: `git diff main..HEAD`
   - Run full test suite in CI
   - Test on a local AEM SDK 6.5 LTS instance before merging

---

## One-Command Migration

If you want to run the complete pipeline in a single invocation:

```bash
java -jar $MIGRATE_JAR full-migrate \
  -r $PROJECT_DIR \
  --javaHome $JAVA21_HOME \
  --java11Home $JAVA11_HOME \
  --sourceJavaHome $SOURCE_JDK_HOME \
  2>&1 | tee $PROJECT_DIR/full-migrate.log
```

The `full-migrate` command sequences all steps (analyze → validate → baseline build → upgrade-code → upgrade-plugins → upgrade-dependencies → upgrade-uberjar → set CloudManager version → intermediate build → upgrade-tests → final build → verify) in order, applying the same decision logic and hard-stop conditions as the manual steps above.

Use the manual step-by-step approach when:
- A previous full-migrate run failed partway through and you are resuming
- You want to run only specific steps
- You need to inspect outputs between steps

---

## Reference: Exit Codes and Hard Stops

| Condition | Action |
|---|---|
| Unsupported API package detected (Step 1) | HARD STOP — report blockers |
| No pom.xml at project root (Step 2) | HARD STOP — wrong directory |
| No .git directory (Step 2) | HARD STOP — git required |
| Source Java version > 11 (Step 2) | HARD STOP — wrong workflow |
| Baseline build fails after 3 attempts (Step 3) | HARD STOP — pre-existing issue |
| `upgrade-uberjar` fails and classifier not injected manually | HARD STOP — intermediate build will fail |
| Intermediate build fails after 3 attempts (Step 8) | HARD STOP — manual fix required |
| Final build fails after 3 attempts (Step 10) | HARD STOP — manual fix required |
| Jakarta imports found after cleanup (Step 11) | HARD STOP — AEM 6.5 LTS is javax only |
| OpenRewrite recipe fails in upgrade-code (Step 4) | Soft failure if on single module — log and continue |
| upgrade-plugins fails (Step 5) | Attempt manual correction, then continue |
| upgrade-tests fails (Step 9) | NON-FATAL — log warning and continue |

---

## Reference: AI Fix Guardrails

When applying AI-assisted fixes in Steps 3, 8, and 10, the following rules are absolute:

1. **Never change `javax.*` to `jakarta.*`.** AEM 6.5 LTS runs on a Servlet 4 / JavaEE 8 runtime. Jakarta namespace is not available.

2. **Never remove `provided` scope from `uber-jar`.** The UberJar must be `<scope>provided</scope>` — including it in compile scope causes classpath pollution.

3. **Never lower a version number.** If a recipe set a plugin to version 5.1.9, do not revert it to 4.x to fix a compilation error. Fix the compilation error at the call site instead.

4. **Never modify generated files.** Files under `target/`, `node_modules/`, or `.generated/` must not be touched.

5. **One module at a time.** When fixing compilation errors, fix the failing module's source files only. Do not preemptively change other modules.

6. **Attribute all changes.** Every change must be traceable to the error it resolved. Include the error message as a comment in the commit message body.

7. **No javax→jakarta reversions that break compilation.** If reverting a jakarta import causes a new compilation error, the dependency scope or version is wrong — fix the dependency, not the import.
