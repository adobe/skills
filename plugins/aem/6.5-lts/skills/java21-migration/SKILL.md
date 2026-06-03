---
name: java21-migration
description: "[BETA] Use when the user needs to upgrade an AEM 6.5 LTS Maven project from Java 8 or Java 11 to Java 21, or mentions JDK 21, Java version upgrade, AEM 6.5 LTS migration, pom.xml compiler upgrade, deprecated Java API replacement, Mockito 1.x to 5.x migration, UberJar 6.6.0, bnd or maven-bundle-plugin upgrade, AEM modernization, or LTS code compatibility. Updates Maven compiler/source/target/release to 21, applies OpenRewrite Java 8 to 21 modernization recipes, swaps deprecated APIs, upgrades bnd, maven-bundle, maven-scr, filevault, JaCoCo, SpotBugs and Lombok plugins, migrates Core WCM Components, relocates Groovy Console coordinates, adds the apis classifier to UberJar 6.6.0, runs Mockito 1.x to 5.x progressive migration, sets .cloudmanager/java-version to 21, and verifies the resulting build. Beta skill: verify outputs before production use."
license: Apache-2.0
compatibility: Requires JDK 8, JDK 11, JDK 21 and Apache Maven 3.9+ on PATH or via JAVA8_HOME, JAVA11_HOME, JAVA21_HOME, and MAVEN_HOME environment variables. Built and run on AEM 6.5 LTS Maven projects.
allowed-tools: Bash Read Write Edit Glob Grep
metadata:
  status: beta
  version: 1.0.0
  last-updated: 2026-06-03
  triggers:
    - "migrate to java 21"
    - "java 21 migration"
    - "aem lts migration"
    - "upgrade java version"
    - "java 8 to 21"
    - "java 11 to 21"
    - "modernize java"
---

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

# AEM 6.5 LTS — Java 21 Migration

Migrate an AEM 6.5 LTS Maven project from Java 8 or 11 to Java 21. Use this skill when a user asks to "migrate to Java 21", "upgrade to AEM 6.5 LTS", "modernize an AEM 6.5 codebase", or similar.

## Run This (5 commands)

```bash
# 0. Set context (caller provides AEM_PROJECT_PATH, JAVA8_HOME, JAVA11_HOME, JAVA21_HOME)
SKILL_DIR="plugins/aem/6.5-lts/skills/java21-migration"

# 1. Build the migration tool (once per checkout)
mvn -f "$SKILL_DIR/pom.xml" clean install -DskipTests
MIGRATE_JAR="$SKILL_DIR/aem65lts-migration-cli/target/aem65lts-migration-cli-1.0-SNAPSHOT.jar"

# 2. Pre-flight check — exit 0 ready, 1 warnings, 2 blockers (STOP)
java -jar "$MIGRATE_JAR" analyze -r "$AEM_PROJECT_PATH"

# 3. Run the full 8-step pipeline
java -jar "$MIGRATE_JAR" full-migrate \
  -r "$AEM_PROJECT_PATH" \
  --sourceJavaHome "$JAVA8_HOME" \
  --java11Home   "$JAVA11_HOME" \
  --javaHome     "$JAVA21_HOME"

# 4. Verify and review
java -jar "$MIGRATE_JAR" verify -r "$AEM_PROJECT_PATH"
( cd "$AEM_PROJECT_PATH" && git diff --stat )
```

`full-migrate` runs eight steps end-to-end: validate, baseline build, `upgrade-code`, `upgrade-plugins`, `upgrade-dependencies` + `upgrade-uberjar`, set `.cloudmanager/java-version=21`, intermediate build, `upgrade-tests`. Each step can also be invoked individually (see `workflows/migrate.md`).

## Failure Recovery

| Failure | Do this | Reference |
|---|---|---|
| `analyze` exits 2 | STOP. Remove the unsupported package or escalate. | `references/migration-guardrails.md` |
| Baseline build fails | Fix the source-version compile error first (max 3 retries). | `references/build-troubleshooting.md` |
| `upgrade-code` fails | Re-run pinned to `--sourceJavaHome`; fall back to JDK 8 if JDK 11 cannot parse. | `references/openrewrite-commands.md` |
| Intermediate build fails | AI-assisted fix within guardrails. **Never** swap javax→jakarta (max 3 retries). | `references/migration-guardrails.md` |
| `upgrade-tests` fails | Non-fatal: log and continue. | `workflows/migrate.md` step 9 |
| `verify` reports issues | Resolve each item, re-run `verify`, then commit. | `references/post-migration-checklist.md` |

## Three Layers

1. **OpenRewrite recipes** (`aem65lts-migration-recipes/` + bundled declarative composites under `aem65lts-migration-cli/src/main/resources/META-INF/config/openrewrite/recipes/`) — deterministic AST transforms for Java code, Mockito tests, POM dependencies, and plugin configuration. Idempotency is enforced by per-recipe unit tests.
2. **CLI tool** (`aem65lts-migration-cli/`) — picocli wrapper exposing `analyze`, `upgrade-code`, `upgrade-tests`, `upgrade-uberjar`, `upgrade-plugins`, `upgrade-dependencies`, `full-migrate`, `verify`. The CLI is the only supported entry point — recipe artefact coordinates and active-recipe names are pinned in code so they cannot drift between runs.
3. **AI-assisted fixes** — Claude resolves residual compile errors under the rules in `references/migration-guardrails.md` (max 3 retries per phase, attributed via `// aem-lts-migration: ai-fix`).

## Hard Guardrails (read these before any fix)

- **javax stays javax.** AEM 6.5 LTS does not export `jakarta.*`. A swap compiles but breaks at runtime.
- **Unsupported packages → STOP.** Commerce, Communities, Granite Social, Screens, We.Retail, DAM PIM/rating, Search & Promote, MCM Campaign.
- **Enforcer version floor only rises.** 1.8 → 11 → 21. Never lower.
- **Removed runtime bundles.** Guava, Caffeine, Jetty, Commons-Collections 3 → embed or refactor (see `references/removed-bundles-remediation.md`).
- **POM formatting is preserved by construction.** All POM edits go through OpenRewrite recipes, not text substitution.

## What Changes

| Item | Target |
|---|---|
| Java source/target/release | 21 |
| AEM UberJar | 6.6.0 + `apis` classifier |
| maven-bundle-plugin | 5.1.9 |
| bnd-maven-plugin family | 6.4.0 |
| maven-scr-plugin | 1.26.4 + `asm-analysis` 9.7.1 |
| filevault-package-maven-plugin | 1.3.6 |
| Core WCM Components | 2.30.4 |
| Groovy Console coordinates | `be.orbinson.aem:*:19.0.8` |
| Mockito + byte-buddy | 5.x + 1.15.x |
| `.cloudmanager/java-version` | `21` |

## Layout

```
java21-migration/
├── SKILL.md, README.md
├── pom.xml                         # parent reactor
├── aem65lts-migration-recipes/     # custom OpenRewrite recipes (Java) + tests
├── aem65lts-migration-cli/         # picocli CLI + bundled declarative recipe YAMLs
├── configs/                        # settings.xml, toolchains.xml, analyzer rules
├── references/                     # guardrails, troubleshooting, checklists
└── workflows/migrate.md            # step-by-step playbook for the agent
```
