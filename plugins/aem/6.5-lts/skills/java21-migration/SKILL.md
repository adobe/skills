---
name: java21-migration
description: "[BETA] Migrate AEM 6.5 LTS Maven projects from Java 8/11 to Java 21"
version: 1.0.0
status: beta
last_updated: 2026-06-03
compatibility:
  - name: jdk
    versions: ["8", "11", "21"]
  - name: maven
    versions: ["3.9+"]
triggers:
  - "migrate to java 21"
  - "java 21 migration"
  - "aem lts migration"
  - "upgrade java version"
  - "java 8 to 21"
  - "java 11 to 21"
  - "modernize java"
env:
  JAVA8_HOME:
    required: false
    description: "Path to JDK 8 installation (required for Java 8 source projects)"
  JAVA11_HOME:
    required: false
    description: "Path to JDK 11 installation (required — OpenRewrite must run under JDK 11+)"
  JAVA21_HOME:
    required: false
    description: "Path to JDK 21 installation (required — intermediate and final builds)"
  MAVEN_HOME:
    required: false
    description: "Path to Maven installation (defaults to mvn on PATH)"
---

> **[BETA]** This skill is in beta. Validate all changes in a development environment before deploying to production.

# AEM 6.5 LTS — Java 21 Migration

Automated migration of AEM 6.5 LTS Maven projects from Java 8 or 11 to Java 21, covering source code modernization, build plugin upgrades, dependency updates, and test framework migration.

## What This Skill Does

### Module 1: `aem65lts-migration-recipes`
Custom OpenRewrite recipes (Java) that perform safe, deterministic AST transformations:
- FileVault embedded artifact group ID changes (Groovy Console migration)
- BND plugin instruction removal (SCRDescriptorBndPlugin, incompatible with Java 21)
- Jakarta → javax namespace reversion (AEM 6.5 LTS is javax-only)
- Unsupported package detection (commerce, social, screens, and others)
- Java API modernization (8/11 → 17 → 21 language and library updates)
- Maven build plugin version upgrades
- AEM dependency version updates (UberJar, WCM Components)
- Mockito test framework migration (1.x → 5.x)

### Module 2: `aem65lts-migration-cli`
A picocli CLI tool that wraps Maven/OpenRewrite invocations. Available commands:

| Command | Purpose |
|---|---|
| `full-migrate` | Run the complete 8-step pipeline end-to-end |
| `analyze` | Pre-migration project analysis and blocker detection |
| `upgrade-code` | Apply Java code modernization recipes (OpenRewrite) |
| `upgrade-plugins` | Upgrade Maven build plugin versions |
| `upgrade-dependencies` | Upgrade AEM dependency versions |
| `upgrade-uberjar` | Migrate UberJar coordinates and inject `apis` classifier |
| `upgrade-tests` | Apply Mockito test framework migration |
| `verify` | Post-migration verification checks |

### Layer 3: AI-Assisted Build Fixing
The agent handles the long tail of compilation errors that automated tooling cannot predict:
- Resolves remaining build failures after automated transforms
- Follows strict guardrails (see `references/migration-guardrails.md`)
- Attributes all changes for traceability

## Prerequisites

- **JDK 8** — Baseline build verification for Java 8 source projects
- **JDK 11** — Required: OpenRewrite must run under JDK 11+
- **JDK 21** — Intermediate and final builds
- **Apache Maven 3.9+** — `mvn` on PATH or `MAVEN_HOME` set
- **Git** — Clean working tree required before starting

## Migration Pipeline (8 Steps in `full-migrate`)

1. **Validate** — Verify project structure and prerequisites
2. **Baseline Build** — Verify project compiles at source Java version
3. **Upgrade Code** — Apply Java code modernization (OpenRewrite + custom recipes)
4. **Upgrade Plugins** — Upgrade Maven build plugin versions
5. **Upgrade Dependencies + UberJar** — Update AEM dependencies and inject `apis` classifier
6. **Set CloudManager Java Version** — Write `.cloudmanager/java-version` with value `21`
7. **Intermediate Build** — Verify JDK 21 compilation after automated transforms
8. **Upgrade Tests** — Apply Mockito test framework migration

## Key Migration Changes

| Category | From | To |
|----------|------|----|
| Java Version | 8 or 11 | 21 |
| AEM UberJar | any version | 6.6.0 (apis classifier) |
| maven-bundle-plugin | < 5.x | 5.1.9 |
| bnd-maven-plugin | < 6.x | 6.4.0 |
| maven-scr-plugin (BND instruction) | SCRDescriptorBndPlugin present | removed |
| WCM Core Components | < 2.24 | 2.24.0+ |
| Groovy Console | various | be.orbinson.aem 19.0.8 |
| Mockito | 1.x/2.x | 5.11.0 |

## Critical Guardrails

1. **javax, NOT jakarta** — AEM 6.5 LTS uses the javax namespace exclusively
2. **Unsupported packages** → hard stop (commerce, social, screens, etc.)
3. **Enforcer version floor** — monotonically increasing, never lowered
4. **Removed bundles** — Guava, Caffeine, Jetty require manual remediation
5. **POM formatting** — preserved exactly (recipe-level XML manipulation)

## Directory Structure
```
java21-migration/
├── SKILL.md                          # This file
├── README.md                         # User-facing documentation
├── aem65lts-migration-recipes/       # Module 1: custom OpenRewrite recipes (Java/Maven)
├── aem65lts-migration-cli/           # Module 2: picocli CLI wrapper (Java/Maven)
├── configs/                          # Migration configuration files
├── references/                       # Technical reference documentation
└── workflows/                        # Step-by-step migration workflows
```
