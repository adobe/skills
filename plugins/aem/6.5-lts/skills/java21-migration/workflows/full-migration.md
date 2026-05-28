# Full Migration Workflow

Migrates an AEM Maven project from Java 8/11 to Java 21.

## Before You Start

- Read [prerequisites.md](../references/prerequisites.md) and verify all tools are installed.
- Set `AEM_PROJECT_PATH` to the absolute path of the AEM project root.
- The project directory must contain `pom.xml` and be a git repository.

Resolve environment variables for this session:

```
AEM_PROJECT_PATH = $AEM_PROJECT_PATH           (REQUIRED — the project root)
M2_HOME          = $M2_HOME or ~/.m2           (Maven user dir, contains repository/)
JAVA8_HOME       = $JAVA8_HOME  or /usr/lib/jvm/jdk-8
JAVA11_HOME      = $JAVA11_HOME or /usr/lib/jvm/jdk-11
JAVA21_HOME      = $JAVA21_HOME or /usr/lib/jvm/jdk-21
SKILL_BASE_DIR   = directory containing SKILL.md (parent of this workflows/ folder)
```

## Migration Checklist

Copy this checklist and update as you progress:

```
Migration Progress:
- [ ] Step 1: Validate project structure
- [ ] Step 2: Detect source Java version
- [ ] Step 3: Initial build (source Java)
- [ ] Step 4: Apply OpenRewrite Java migration
- [ ] Step 5: Apply POM manipulations
- [ ] Step 6: Set CloudManager Java version
- [ ] Step 7: Pre-Mockito build (Java 21)
- [ ] Step 8: Apply OpenRewrite Mockito migration
- [ ] Step 9: Final build (Java 21)
- [ ] Step 10: Clean up workarounds and jakarta imports
- [ ] Step 11: Generate migration report
- [ ] Step 12: Review diff and commit to local branch
```

## Important: How Build Steps Relate

Steps 3, 7, and 9 are all build steps, but they are **not incremental** — each one runs a
fresh full build. Do NOT carry forward module skips or assumptions between build steps, because
migrations in between may fix previously broken modules:

- **Step 3** (source Java) → Step 4 runs OpenRewrite → Step 5 runs POM scripts → modules may be fixed
- **Step 7** (Java 21) → Step 8 runs Mockito migration → modules may be fixed
- **Step 9** (final) → captures the true state of everything

Always attempt the **full project build** at each build step. If a module fails, read the error
and fix it in context — don't skip it just because it failed earlier.

## Available Scripts

The `scripts/` directory contains Python tools you can use when appropriate:

| Script | When to use |
|--------|-------------|
| `migrate_plugins.py` | Step 5a — always run (plugin config, SCR removal, classifiers) |
| `migrate_filevault.py` | Step 5b — always run (FileVault groupId fix) |
| `migrate_dependency_versions.py` | Step 3 — use when build fails due to outdated dependency versions |

These scripts encode domain-specific POM manipulation logic. Run them via:
`python3 $SKILL_BASE_DIR/scripts/<script> --help` for usage.

---

## Step 1: Validate Project Structure

Verify the project is a valid Maven project:

```bash
test -f $AEM_PROJECT_PATH/pom.xml && echo "VALID" || echo "INVALID"
```

**If INVALID**: STOP. Report: "Not a valid Maven project — pom.xml not found at $AEM_PROJECT_PATH."

Also verify git is initialized:

```bash
test -d $AEM_PROJECT_PATH/.git && echo "GIT OK" || echo "NO GIT"
```

**If NO GIT**: STOP. Report: "Project is not a git repository. Git is required for diff generation."

---

## Step 2: Detect Source Java Version

Determine the project's current Java version. Check in this order:

### 2a. Check `.cloudmanager/java-version` file

```bash
cat $AEM_PROJECT_PATH/.cloudmanager/java-version 2>/dev/null
```

If file exists and contains `8` or `11` → use that as `SOURCE_JAVA_VERSION`.

### 2b. Check `maven-compiler-plugin` in root `pom.xml`

Look for `<source>` or `<target>` or `<release>` in the `maven-compiler-plugin` configuration
in `$AEM_PROJECT_PATH/pom.xml`. Also check `<properties>` for `maven.compiler.source` or
`maven.compiler.target`.

Common values: `1.8` or `8` → Java 8. `11` → Java 11.

### 2c. Set version variables

```
SOURCE_JAVA_VERSION = detected version (8 or 11)
SOURCE_JAVA_HOME    = $JAVA8_HOME (if 8) or $JAVA11_HOME (if 11)
TARGET_JAVA_VERSION = 21
TARGET_JAVA_HOME    = $JAVA21_HOME
```

**If detected version is 21 or higher**: STOP. Report: "Project is already on Java 21+. Migration is not needed."

**If detected version is NOT 8 or 11**: Default to 8. Print warning: "Unsupported source version detected, defaulting to Java 8."

---

## Step 3: Initial Build (Source Java)

Build the project with the source Java version to verify it compiles before migration.

```bash
cd $AEM_PROJECT_PATH && \
env JAVA_HOME=$SOURCE_JAVA_HOME PATH=$SOURCE_JAVA_HOME/bin:$PATH \
mvn clean install \
  -Dmaven.clean.failOnError=false \
  -DskipTests \
  -DskipFrontend=true \
  -Dassembly.skipAssembly=true \
  -Dcheckstyle.skip=true \
  -Dvault.skipValidation=true \
  -Dsling.install.skip=true \
  -Dexec.skip=true \
  -Dpackage.skip=true \
  -Dosgi.bundle.status.skip=true
```

**If exit code = 0**: Proceed to Step 4.

**If exit code != 0**: Read the build error output and fix the issues.

Read [build-fix-constraints.md](../references/build-fix-constraints.md) for the rules.

Key points for initial build fixes:
- Check for **unsupported AEM packages** first → STOP if found
- Check for **dependency resolution failures** (401/403, missing artifacts):
  - If it's a customer-specific/private dependency → STOP. Report: "Missing customer-specific dependencies that require manual intervention."
  - If it's a public library auth failure → STOP. Report: "Dependency auth failure — customer's Maven settings need to be fixed manually."
  - If it's an outdated version that can't be resolved, you can run `$SKILL_BASE_DIR/scripts/migrate_dependency_versions.py --project-path $AEM_PROJECT_PATH --config $SKILL_BASE_DIR/configs/dependency-migration.json` to apply known version upgrades, or manually update the version in the POM
- Check for **infrastructure issues** (connection refused, network errors) → STOP
- For **compilation errors**: fix the code, add `// Fixed by Migration AI` above every change
- Re-run the build after fixes
- Retry up to 3 times total

**If still failing after 3 attempts**: STOP. Report: "Initial build cannot be fixed automatically."

---

## Step 4: Apply OpenRewrite Java Migration

Run the OpenRewrite Java upgrade recipe. Start with JDK 11 — it can parse both Java 8 and 11 source.

See [openrewrite-commands.md](../references/openrewrite-commands.md) for command details.

```bash
cd $AEM_PROJECT_PATH && \
env JAVA_HOME=$JAVA11_HOME PATH=$JAVA11_HOME/bin:$PATH \
mvn org.openrewrite.maven:rewrite-maven-plugin:6.19.0:run \
  -Drewrite.recipeArtifactCoordinates=org.openrewrite.recipe:rewrite-migrate-java:3.18.0 \
  -Drewrite.configLocation=$SKILL_BASE_DIR/recipes/java_upgrade.yml \
  -Drewrite.activeRecipes=com.org.adobe.JavaUpgrade \
  -DskipFrontend=true \
  -Dassembly.skipAssembly=true \
  -Dvault.skipValidation=true \
  -Dcheckstyle.skip=true \
  -Djacoco.skip=true \
  -Dbnd.skip=true \
  -Dsling.install.skip=true \
  -Dexec.skip=true
```

**If exit code = 0**: Proceed to Step 5.

**If exit code != 0**: Read the error output and fix if possible:

- **POM parsing errors** (malformed XML): Fix the XML in the failing `pom.xml` and re-run
- **Dependency resolution failures**: Fix the dependency (version, repo access) and re-run
- **Recipe artifact download failures**: Network issue downloading OpenRewrite plugin — retry
- **JDK compatibility issues**: If the error suggests JDK 11 can't compile the source
  (e.g., old toolchain configs, JDK-specific API issues), and `SOURCE_JAVA_VERSION` is 8,
  re-run the command with `$JAVA8_HOME` instead of `$JAVA11_HOME`

Re-run the OpenRewrite command after fixes. Retry up to 2 times.

**If still failing**: STOP. Report: "OpenRewrite Java migration failed — [reason from error output]."

---

## Step 5: Apply POM Manipulations

Run the Python POM manipulation scripts. These handle changes OpenRewrite cannot.

See [pom-manipulation-rules.md](../references/pom-manipulation-rules.md) for details on what each does.

### 5a. Plugin configurations + SCR removal + classifier migration

```bash
python3 $SKILL_BASE_DIR/scripts/migrate_plugins.py \
  --project-path $AEM_PROJECT_PATH \
  --plugin-config $SKILL_BASE_DIR/configs/plugin-configuration.json \
  --classifier-config $SKILL_BASE_DIR/configs/dependency-classifier-migration.json
```

### 5b. FileVault embedded groupId fix

```bash
python3 $SKILL_BASE_DIR/scripts/migrate_filevault.py \
  --project-path $AEM_PROJECT_PATH \
  --artifact-prefix "aem-groovy-console" \
  --new-group-id "be.orbinson.aem"
```

**If any script fails**: Read the error output. If it's a parsing issue with a specific `pom.xml`,
fix the XML and re-run the script. If it's a fundamental issue (e.g., no matching dependencies found),
that's expected for projects that don't use those features — proceed to Step 6.

---

## Step 6: Set CloudManager Java Version

Create or update `.cloudmanager/java-version` to declare Java 21:

```bash
mkdir -p $AEM_PROJECT_PATH/.cloudmanager
echo "21" > $AEM_PROJECT_PATH/.cloudmanager/java-version
```

---

## Step 7: Pre-Mockito Build (Java 21)

Build the project with Java 21 to verify the Java migration succeeded.
This catches issues that OpenRewrite and POM scripts did not handle.

```bash
cd $AEM_PROJECT_PATH && \
env JAVA_HOME=$JAVA21_HOME PATH=$JAVA21_HOME/bin:$PATH \
mvn clean install \
  -Dmaven.clean.failOnError=false \
  -DskipTests \
  -DskipFrontend=true \
  -Dassembly.skipAssembly=true \
  -Dcheckstyle.skip=true \
  -Dvault.skipValidation=true \
  -Dsling.install.skip=true \
  -Dexec.skip=true \
  -Dpackage.skip=true \
  -Dosgi.bundle.status.skip=true
```

**If exit code = 0**: Proceed to Step 8.

**If exit code != 0**: Fix the Java 21 build errors.

Read [build-fix-constraints.md](../references/build-fix-constraints.md) for the rules.

Key points for Java 21 build fixes:
- These are typically Java API changes that OpenRewrite missed
- Check for **unsupported AEM packages** first → STOP if found
- Only modify files in modules that have compilation errors
- Do NOT modify pom.xml dependency versions (except adding missing ones)
- Add `// Fixed by Migration AI` above every code change
- Re-run the build after fixes
- Retry up to 3 times total

**If still failing after 3 attempts**: STOP. Report: "Java 21 build cannot be fixed automatically."

---

## Step 8: Apply OpenRewrite Mockito Migration

Run the Mockito upgrade recipe. This uses JDK 21 since the project is already migrated.

```bash
cd $AEM_PROJECT_PATH && \
env JAVA_HOME=$JAVA21_HOME PATH=$JAVA21_HOME/bin:$PATH \
mvn org.openrewrite.maven:rewrite-maven-plugin:6.19.0:run \
  -Drewrite.recipeArtifactCoordinates=org.openrewrite.recipe:rewrite-testing-frameworks:3.18.0 \
  -Drewrite.configLocation=$SKILL_BASE_DIR/recipes/mockito_upgrade.yml \
  -Drewrite.activeRecipes=com.org.adobe.MockitoUpgrade \
  -DskipFrontend=true \
  -Dassembly.skipAssembly=true \
  -Dvault.skipValidation=true \
  -Dcheckstyle.skip=true \
  -Djacoco.skip=true \
  -Dbnd.skip=true \
  -Dsling.install.skip=true \
  -Dexec.skip=true
```

**If exit code = 0**: Proceed to Step 9.

**If exit code != 0**: Read the error output. If it's a fixable issue (malformed XML,
dependency resolution), fix it and re-run once. If it's a fundamental incompatibility
or the project doesn't use Mockito, proceed to Step 9 — Mockito migration failure is non-fatal.

---

## Step 9: Final Build (Java 21)

Build the project one last time to verify everything compiles after all migrations.

```bash
cd $AEM_PROJECT_PATH && \
env JAVA_HOME=$JAVA21_HOME PATH=$JAVA21_HOME/bin:$PATH \
mvn clean install \
  -Dmaven.clean.failOnError=false \
  -DskipTests \
  -DskipFrontend=true \
  -Dassembly.skipAssembly=true \
  -Dcheckstyle.skip=true \
  -Dvault.skipValidation=true \
  -Dsling.install.skip=true \
  -Dexec.skip=true \
  -Dpackage.skip=true \
  -Dosgi.bundle.status.skip=true
```

**If exit code = 0**: Proceed to Step 10.

**If exit code != 0**: Fix the build errors (same constraints as Step 7).
Retry up to 3 times total.

**If still failing after 3 attempts**: Report: "Final build failed. Migration is incomplete."
Still proceed to Step 10 to clean up, then Step 12 to capture partial progress.

---

## Step 10: Clean Up Workarounds and Jakarta Imports

After all builds pass, clean the codebase before generating the final diff.

### 10a. Remove temporary workaround markers

Search for and remove all content between TEMP_WORKAROUND markers:

```bash
grep -r "TEMP_WORKAROUND" $AEM_PROJECT_PATH --include="*.xml" --include="*.java" 2>/dev/null
```

If any matches found:
1. Read each file
2. Remove everything between `<!-- TEMP_WORKAROUND_START -->` and `<!-- TEMP_WORKAROUND_END -->` (including the markers)
3. Save the cleaned file
4. Verify no markers remain:
   ```bash
   grep -r "TEMP_WORKAROUND" $AEM_PROJECT_PATH --include="*.xml" --include="*.java" 2>/dev/null && echo "MARKERS REMAINING" || echo "CLEAN"
   ```

### 10b. Revert jakarta imports in AEM/Sling files

AEM 6.5 LTS uses the `javax` namespace. `jakarta` imports may compile but **fail silently
at runtime** — for example, `jakarta.annotation.PostConstruct` is silently ignored by
Sling Models which only recognizes the `javax` equivalent.

1. Find all `.java` files with jakarta imports:
   ```bash
   grep -rln "import jakarta\." $AEM_PROJECT_PATH --include="*.java" 2>/dev/null
   ```

2. For EACH file found, check if it is AEM/Sling code by looking at other imports in the file.
   If the file imports AEM, Sling, OSGi, or Adobe packages → it IS AEM/Sling code.

3. For AEM/Sling files: revert `jakarta` imports to their `javax` equivalents:
   - `import jakarta.annotation.*` → `import javax.annotation.*`
   - `import jakarta.inject.*` → `import javax.inject.*`
   - `import jakarta.servlet.*` → `import javax.servlet.*`
   - etc.

4. For non-AEM files: leave untouched (they may legitimately use jakarta).

5. Check pom.xml files for jakarta dependencies that replaced javax equivalents:
   ```bash
   grep -rn "jakarta" $AEM_PROJECT_PATH --include="pom.xml" 2>/dev/null
   ```
   Revert any `jakarta.annotation:jakarta.annotation-api` → `javax.annotation:javax.annotation-api`,
   `jakarta.inject:jakarta.inject-api` → `javax.inject:javax.inject`, etc.

---

## Step 11: Generate Migration Report

Generate a summary of what was changed during migration.

### 11a. Collect diff statistics

```bash
cd $AEM_PROJECT_PATH && git diff --stat
```

### 11b. Count affected files by category

```bash
cd $AEM_PROJECT_PATH && \
echo "=== Migration Report ===" && \
echo "Java source files changed: $(git diff --name-only | grep '\.java$' | grep -v '/src/test/' | wc -l | tr -d ' ')" && \
echo "Test files changed: $(git diff --name-only | grep '\.java$' | grep '/src/test/' | wc -l | tr -d ' ')" && \
echo "POM files changed: $(git diff --name-only | grep 'pom\.xml$' | wc -l | tr -d ' ')" && \
echo "Total files changed: $(git diff --name-only | wc -l | tr -d ' ')" && \
echo "CloudManager java-version: $(cat .cloudmanager/java-version 2>/dev/null || echo 'not set')" && \
echo "Source Java: $SOURCE_JAVA_VERSION → Target Java: 21"
```

### 11c. Check for migration quality markers

```bash
cd $AEM_PROJECT_PATH && \
echo "AI-fixed files: $(grep -rl 'Fixed by Migration AI' --include='*.java' --include='*.xml' . 2>/dev/null | wc -l | tr -d ' ')" && \
echo "Remaining jakarta imports: $(grep -rl 'import jakarta\.' --include='*.java' . 2>/dev/null | wc -l | tr -d ' ')" && \
echo "Remaining workaround markers: $(grep -rl 'TEMP_WORKAROUND' --include='*.xml' --include='*.java' . 2>/dev/null | wc -l | tr -d ' ')"
```

**Expected**: Zero remaining jakarta imports in AEM/Sling files, zero remaining workaround markers.

---

## Step 12: Review Diff and Commit to Local Branch

### 12a. Review the changes

```bash
cd $AEM_PROJECT_PATH && git diff --stat
```

This shows all files modified during migration (should match Step 11 report). Review to confirm:
- Java source files have API upgrades
- `pom.xml` files have version/plugin changes
- `.cloudmanager/java-version` is set to 21
- No unexpected files were modified

For detailed diff:

```bash
cd $AEM_PROJECT_PATH && git diff
```

### 12b. Commit to a local branch

```bash
cd $AEM_PROJECT_PATH && \
git checkout -b aem_java21_migration && \
git add -A && \
git commit -m "AEM Java 21 migration: OpenRewrite + AI-assisted fixes"
```

This creates a local branch with all migration changes. Do NOT push — that will
be handled separately.

---

## Summary

When the workflow completes, the local branch `aem_java21_migration` contains:

1. **OpenRewrite changes**: Java API upgrades, plugin updates, dependency version bumps
2. **POM manipulation changes**: Compiler plugin config, SCR removal, classifier addition, FileVault fix
3. **Agent fixes**: Compilation errors that OpenRewrite could not handle (marked with `// Fixed by Migration AI`)
4. **CloudManager config**: `.cloudmanager/java-version` set to 21
5. **Mockito changes**: Mockito 1.x→5.x API upgrades (if applicable)
6. **Clean state**: No temporary workarounds, no jakarta imports in AEM/Sling files
