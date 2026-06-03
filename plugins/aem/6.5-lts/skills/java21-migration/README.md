# AEM 6.5 LTS — Java 21 Migration Skill

Automates the migration of AEM 6.5 LTS Maven projects from Java 8 or Java 11 to Java 21. The skill orchestrates three layers of transformation: deterministic AST-based recipe runs via custom OpenRewrite recipes, structural POM patching via the CLI tool, and AI-assisted resolution of the remaining compilation failures that automated tooling cannot predict.

---

## Problem This Solves

AEM 6.5 LTS ships with a Java 21 runtime requirement, but most existing customer codebases were authored against Java 8 or Java 11. Upgrading is not a simple compiler flag change — it requires coordinated updates across:

- Source and target compiler settings in every Maven module
- Build plugins that broke or behaved differently under Java 21 (`SCRDescriptorBndPlugin`, older annotation processors)
- Third-party libraries whose AEM-bundled versions were removed or replaced
- Test dependencies, especially Mockito, which underwent major API changes between 1.x and 5.x
- AEM UberJar coordinates, which changed to an `apis` classifier in 6.6.0

Doing this manually across a large multi-module project is error-prone and time-consuming. This skill automates the deterministic parts and guides the AI agent through the non-deterministic remainder.

---

## Prerequisites

### Required JDKs

The migration tool needs all three JDK versions accessible on the machine:

| Variable | Purpose |
|---|---|
| `JAVA8_HOME` | Baseline build verification (Java 8 projects) |
| `JAVA11_HOME` | OpenRewrite execution (OpenRewrite requires JDK 11+) |
| `JAVA21_HOME` | Intermediate and final builds |

If your project is already on Java 11, `JAVA8_HOME` is not required.

Set these in your shell profile or pass them directly as environment variables when invoking the workflow.

### Maven

- Version 3.9 or later
- The `mvn` binary must be on `PATH`, or `MAVEN_HOME` must be set
- Network access to Maven Central and the Adobe Public Repository

A Maven settings template with both repositories pre-configured is available at `configs/maven-settings-template.xml`. Copy it to `~/.m2/settings.xml` or pass it via `-s` if your environment does not already have Adobe repository configuration.

### Git

- A clean working tree before starting (`git status` should show no uncommitted changes)
- The migration commits to a branch named `java21-migration/<timestamp>` by default

---

## Quick Start

### 1. Build the migration tool

```bash
cd $SKILL_DIR
mvn clean install -DskipTests
```

This compiles both modules and produces the executable JAR:

```
aem65lts-migration-cli/target/aem65lts-migration-cli-1.0-SNAPSHOT.jar
```

### 2. Set environment variables

```bash
export JAVA8_HOME=/Library/Java/JavaVirtualMachines/jdk1.8.0_xxx.jdk/Contents/Home
export JAVA11_HOME=/Library/Java/JavaVirtualMachines/jdk-11.jdk/Contents/Home
export JAVA21_HOME=/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home
export PROJECT_DIR=/path/to/your/aem-project
export SKILL_DIR=/path/to/skills/plugins/aem/6.5-lts/skills/java21-migration
export MIGRATE_JAR=$SKILL_DIR/aem65lts-migration-cli/target/aem65lts-migration-cli-1.0-SNAPSHOT.jar
```

### 3. Run the full migration

```bash
java -jar $MIGRATE_JAR full-migrate \
  -r $PROJECT_DIR \
  --javaHome $JAVA21_HOME \
  --java11Home $JAVA11_HOME \
  --sourceJavaHome $JAVA8_HOME
```

Or tell the agent to run the migration:

```
Run the AEM Java 21 migration workflow for my project at $PROJECT_DIR
```

The agent will follow `workflows/migrate.md` step by step, pausing to report blockers or request confirmation when required.

### 4. Run individual steps

Each command can be run in isolation:

```bash
# Analyze only — no changes made
java -jar $MIGRATE_JAR analyze -r $PROJECT_DIR

# Apply code modernization only (uses JDK 11 for OpenRewrite)
java -jar $MIGRATE_JAR upgrade-code -r $PROJECT_DIR -j $JAVA11_HOME

# Upgrade plugins only
java -jar $MIGRATE_JAR upgrade-plugins -r $PROJECT_DIR -j $JAVA11_HOME

# Upgrade dependencies
java -jar $MIGRATE_JAR upgrade-dependencies -r $PROJECT_DIR -j $JAVA11_HOME

# Migrate UberJar coordinates
java -jar $MIGRATE_JAR upgrade-uberjar -r $PROJECT_DIR -j $JAVA11_HOME

# Migrate test frameworks (Mockito)
java -jar $MIGRATE_JAR upgrade-tests -r $PROJECT_DIR -j $JAVA21_HOME

# Post-migration verification
java -jar $MIGRATE_JAR verify -r $PROJECT_DIR
```

### 5. Review the output

After a successful run the agent produces:

- `report.md` — Summary of all changes made, grouped by category
- `verification.json` — Machine-readable verification results
- A git branch `java21-migration/<timestamp>` containing the migration commits

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    aem-migrate CLI                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ analyze  │ │ upgrade- │ │ upgrade- │ │   full-   │  │
│  │          │ │   code   │ │  tests   │ │  migrate  │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
│         │            │            │            │         │
│         └────────────┴────────────┴────────────┘        │
│                          │                               │
│               OpenRewriteRunner                          │
│         (Maven Invoker → rewrite-maven-plugin)          │
└─────────────────────┬───────────────────────────────────┘
                      │
    ┌─────────────────┼──────────────────┐
    │                 │                  │
    ▼                 ▼                  ▼
┌─────────┐  ┌──────────────┐  ┌─────────────────┐
│ Stock    │  │   Custom     │  │  Target AEM     │
│ OpenRW   │  │   Recipes    │  │  Maven Project  │
│ Recipes  │  │  (our JAR)   │  │  (customer)     │
└─────────┘  └──────────────┘  └─────────────────┘
```

### Module Roles

**`aem65lts-migration-recipes`** (`aem65lts-migration-recipes/`)
Custom OpenRewrite recipes written in Java and packaged as a standard Maven JAR. These recipes are injected into the `rewrite-maven-plugin` classpath at runtime via the CLI tool. They extend the stock OpenRewrite recipe set with AEM-specific transformations: FileVault embedded artifact changes, BND plugin instruction removal, jakarta→javax reversion, and unsupported package detection.

**`aem65lts-migration-cli`** (`aem65lts-migration-cli/`)
A picocli-based CLI that wraps Maven Invoker API calls. Each command constructs the appropriate `rewrite-maven-plugin` invocation, injects the recipes JAR, passes the correct JDK, and streams Maven output back to the console. The `full-migrate` command sequences all individual commands into the complete 8-step pipeline.

**AI-assisted fixing** (agent behavior guided by `references/migration-guardrails.md`)
Addresses compilation failures that remain after the automated layers. The agent reads compiler output, identifies the root cause, applies a targeted fix, and re-runs the build. Guardrails prevent the agent from making changes that would appear to fix the build but break AEM runtime behaviour (for example, switching javax to jakarta).

---

## Directory Structure

```
java21-migration/
├── SKILL.md                              # Skill metadata and pipeline overview
├── README.md                             # This file
├── pom.xml                               # Parent POM (two-module Maven project)
├── aem65lts-migration-recipes/           # Module 1: custom OpenRewrite recipes
│   ├── pom.xml
│   └── src/main/java/...
│       ├── RevertJakartaInAemSource.java
│       ├── RemoveBndScrDescriptorPlugin.java
│       ├── MigrateFileVaultEmbeddedArtifacts.java
│       └── DetectUnsupportedPackages.java
├── aem65lts-migration-cli/              # Module 2: picocli CLI wrapper
│   ├── pom.xml
│   └── src/main/java/...
│       ├── MigrateCli.java              # Entry point, command registration
│       ├── commands/
│       │   ├── FullMigrateCommand.java
│       │   ├── AnalyzeCommand.java
│       │   ├── UpgradeCodeCommand.java
│       │   └── ...
│       └── OpenRewriteRunner.java       # Maven Invoker wrapper
├── configs/                             # Migration configuration files
│   ├── maven-settings-template.xml
│   └── unsupported-apis.yaml
├── references/                          # Technical reference documentation
│   ├── migration-guardrails.md
│   └── removed-bundles-remediation.md
└── workflows/                           # Step-by-step migration workflows
    └── migrate.md
```

---

## Configuration

### `configs/unsupported-apis.yaml`
Defines packages that cause a hard stop (cannot migrate) versus packages that produce a warning (migration continues with a note). Edit this file to adjust thresholds for your project's risk tolerance.

### `configs/maven-settings-template.xml`
A ready-to-use Maven settings file with Adobe Public Repository and Maven Central configured. Copy to `~/.m2/settings.xml` if needed.

---

## Troubleshooting

### "Blocker detected: unsupported package"

The pre-migration analysis found usage of a package listed in `configs/unsupported-apis.yaml` under `hard_stop_packages`. The migration cannot proceed until this dependency is resolved. See the reason and remediation in the analysis output.

### CLI fails with "Could not resolve plugin" during OpenRewrite steps

Ensure network access to Maven Central is available, or add the `configs/maven-settings-template.xml` as your active Maven settings:

```bash
java -jar $MIGRATE_JAR upgrade-code \
  -r $PROJECT_DIR \
  -j $JAVA11_HOME \
  --mavenSettings $SKILL_DIR/configs/maven-settings-template.xml
```

### Build fails with `javax.* cannot be resolved` after upgrade-code

OpenRewrite's Java 17/21 migration recipes sometimes introduce `jakarta.*` imports. AEM 6.5 LTS does not use the Jakarta namespace. The `RevertJakartaInAemSource` recipe in the custom recipes module handles this automatically; if it did not run, re-run `upgrade-code`.

### BND plugin errors after upgrade-plugins

If `SCRDescriptorBndPlugin` was not fully removed, the `RemoveBndScrDescriptorPlugin` recipe should handle it. Re-run `upgrade-plugins` to retry.

### JAR not found after `mvn clean install`

Ensure the build ran from the project root (the directory containing the parent `pom.xml`). Both modules must compile successfully before the CLI JAR is available at `aem65lts-migration-cli/target/aem65lts-migration-cli-1.0-SNAPSHOT.jar`.

### Final build still fails after 3 AI-assisted attempts

This indicates a non-trivial migration issue that requires human review. The agent will hard-stop and provide:
- The full compiler error
- The files it attempted to fix
- The guardrail that prevented further attempts

Escalate to a senior engineer for manual remediation of those specific modules.

---

## FAQ

**Q: Does this skill modify my source files in place?**
Yes. All changes are applied directly to the working tree. The workflow requires a clean git status before starting so that all changes are attributable and reversible via `git checkout`.

**Q: Can I run individual steps instead of the full pipeline?**
Yes. Each command (`upgrade-code`, `upgrade-plugins`, etc.) is self-contained. Ensure prerequisite steps have already been completed before running a later step in isolation (for example, `upgrade-tests` should run after `upgrade-code` and an intermediate JDK 21 build).

**Q: What if my project uses a monorepo layout?**
Point `-r` at the root `pom.xml` directory. All recipes and CLI commands recurse into submodules automatically via the Maven multi-module reactor.

**Q: Does the skill handle frontend Maven modules (npm/webpack)?**
No. All Maven builds in this workflow use `-DskipFrontend=true`. Frontend build verification is outside the scope of this migration skill.

**Q: Will this skill upgrade my AEM version?**
No. This skill migrates Java source code and build configuration only. It does not change AEM service pack versions, content packages, or repository configuration.

**Q: What happens to my Groovy Console scripts?**
If your project bundles the Groovy Console, the `MigrateFileVaultEmbeddedArtifacts` recipe updates the group ID to `be.orbinson.aem` and sets version `19.0.8`. Existing Groovy scripts in the repository are not modified.

**Q: Is Mockito migration mandatory?**
No. The `upgrade-tests` step is marked non-fatal. If it fails, the workflow logs a warning and continues. You can migrate Mockito manually after the Java 21 migration is complete.
