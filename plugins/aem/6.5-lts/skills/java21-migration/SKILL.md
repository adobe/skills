---
name: java21-migration
description: |
  [BETA] Migrates AEM 6.5 LTS Maven projects from Java 8/11 to Java 21.
  Runs OpenRewrite recipes for Java and Mockito upgrades, applies POM manipulations
  (plugin configs, dependency classifiers, FileVault groupId fixes), and uses the agent
  to fix build errors that automated tooling cannot handle.
  Use when migrating AEM projects to Java 21, upgrading Java versions in Maven projects,
  or fixing Java 21 build compatibility issues in AEM codebases.
  This skill is in beta. Verify all outputs before applying them to production projects.
license: Apache-2.0
compatibility: Requires AEM 6.5 LTS. Requires JDK 8, 11, and 21 installed. Requires Maven 3.9+ and Python 3.10+.
status: beta
metadata:
  version: "1.0"
  aem_version: "6.5 LTS"
  author: "Adobe"
---

# AEM 6.5 LTS — Java 21 Migration

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

Automates the migration of AEM 6.5 LTS Maven projects from Java 8/11 to Java 21 using
OpenRewrite recipes, POM manipulation scripts, and AI-assisted build error fixing.

## Quick Start

1. Ensure prerequisites are met: See [references/prerequisites.md](references/prerequisites.md)
2. Run the full migration: Follow [workflows/full-migration.md](workflows/full-migration.md)

## Available Workflows

| Workflow | When to use |
|----------|-------------|
| [Full Migration](workflows/full-migration.md) | End-to-end Java 8/11 → 21 migration with build verification and AI-assisted fixes |

## Reference Documents

Load these only when needed during the workflow:

- [Prerequisites](references/prerequisites.md) — Required JDKs, Maven, environment variables
- [Build Fix Constraints](references/build-fix-constraints.md) — Guardrails for fixing build errors
- [OpenRewrite Commands](references/openrewrite-commands.md) — Exact Maven commands for Java and Mockito migrations
- [POM Manipulation Rules](references/pom-manipulation-rules.md) — What each POM script does and why
- [Validation Report](references/validation-report.md) — Recipe coverage, guardrail matrix, known limitations

## Bundled Resources

- `configs/` — JSON configuration files for dependency and plugin migrations
- `recipes/` — OpenRewrite YAML recipe files (Java upgrade, Mockito upgrade)
- `scripts/` — Python scripts for POM manipulation tasks

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AEM_PROJECT_PATH` | Yes | — | Absolute path to the AEM Maven project root (must contain `pom.xml`) |
| `M2_HOME` | No | `~/.m2` | Maven user directory (contains `repository/`) |
| `JAVA8_HOME` | No | `/usr/lib/jvm/jdk-8` | Path to JDK 8 installation |
| `JAVA11_HOME` | No | `/usr/lib/jvm/jdk-11` | Path to JDK 11 installation |
| `JAVA21_HOME` | No | `/usr/lib/jvm/jdk-21` | Path to JDK 21 installation |

## What This Skill Does

The migration pipeline has 10 steps:

1. **Validate** — Confirm project is a valid Maven + Git project
2. **Detect Java Version** — Read `.cloudmanager/java-version` or `maven-compiler-plugin` config
3. **Initial Build** — Build with source Java (8 or 11) to verify baseline compiles
4. **OpenRewrite Java Migration** — Apply Java 8/11 → 21 recipe (API upgrades, plugin bumps, dependency changes)
5. **POM Manipulations** — Run scripts for compiler config, SCR removal, classifier addition, FileVault fixes
6. **CloudManager Config** — Set `.cloudmanager/java-version` to 21
7. **Pre-Mockito Build** — Build with Java 21 to verify migration, fix any remaining issues
8. **OpenRewrite Mockito Migration** — Apply Mockito 1.x → 5.x recipe (test framework upgrade)
9. **Final Build** — Full Java 21 build to confirm everything compiles
10. **Cleanup** — Remove temp workarounds, revert jakarta imports in AEM/Sling files
11. **Migration Report** — Generate file change statistics and quality markers
12. **Review & Commit** — Review diff, commit to local branch

## Key Migration Changes

### Java API Upgrades
- Deprecated API removal (`Thread.stop`, `URL()` constructors, `Subject` methods, `finalize`)
- Java 8 → 11 → 17 → 21 progressive recipe chain
- Unused import cleanup, pattern matching, text blocks

### Build Plugin Upgrades
- `maven-bundle-plugin` → 6.0.0
- `maven-scr-plugin` → 1.26.4 (with `asm-analysis` 9.7.1)
- `bnd-maven-plugin` → 6.4.0
- `maven-compiler-plugin` release → 21
- `jacoco-maven-plugin` → 0.8.12

### Dependency Upgrades
- `uber-jar` → 6.6.0 with `apis` classifier
- `core.wcm.components.*` → 2.30.4
- `aem-groovy-console*` groupId → `be.orbinson.aem`
- `guice` → 5.x, `commons-codec` → 1.17.x, `mapstruct` → 1.6.x

### Test Framework Upgrades (Mockito)
- `mockito-all` → `mockito-core`, `mockito-inline` → `mockito-core`
- Mockito 1.x → 3.x → 4.x → 5.x progressive chain
- `byte-buddy` → 1.15.x
- `Matchers` → `ArgumentMatchers`, `MockitoJUnitRunner` → `MockitoExtension`

## Critical Guardrails

- **javax NOT jakarta**: AEM 6.5 LTS uses `javax.*`. Never migrate to `jakarta.*`.
- **Unsupported packages**: Commerce, Social, Screens — migration stops immediately if detected.
- **Enforcer rules**: `requireJavaVersion` can only be raised, never lowered.
- **Removed bundles**: Guava, Caffeine, Jetty not exported — embed or refactor.

## Official Documentation

- [AEM 6.5 LTS Release Notes](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/release-notes)
- [AEM 6.5 LTS Deprecated Features](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/release-notes/deprecated-removed-features)
- [OpenRewrite Java Migration](https://docs.openrewrite.org/recipes/java/migrate)
