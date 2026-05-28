# AEM 6.5 LTS — Java 21 Migration

Automated migration skill for upgrading AEM 6.5 LTS Maven projects from Java 8/11 to Java 21.

## Scope

Use this skill when you need to:
- Migrate an AEM Maven project from Java 8 or 11 to Java 21
- Apply OpenRewrite recipes for Java API and Mockito upgrades
- Fix build compatibility issues introduced by Java 21
- Update AEM-specific plugins and dependencies for 6.5 LTS compatibility

## What It Does

The migration pipeline applies three layers of changes:

1. **OpenRewrite Recipes** — Automated Java API upgrades, plugin version bumps, dependency migrations
2. **POM Manipulation Scripts** — Targeted XML changes that OpenRewrite cannot handle (compiler config, SCR removal, classifier addition, FileVault groupId fixes)
3. **AI-Assisted Build Fixing** — Compilation errors that automated tooling misses are fixed by the agent with guardrails

## Prerequisites

- JDK 8, 11, and 21 installed simultaneously
- Apache Maven 3.9+
- Python 3.10+
- Git

## Getting Started

1. Review [prerequisites](references/prerequisites.md)
2. Follow the [full migration workflow](workflows/full-migration.md)

## Skill Contents

```
java21-migration/
├── SKILL.md                    # Skill metadata and overview
├── README.md                   # This file
├── workflows/
│   └── full-migration.md       # 10-step migration workflow
├── references/
│   ├── prerequisites.md        # Required tools and environment
│   ├── build-fix-constraints.md # Guardrails for AI-assisted fixes
│   ├── openrewrite-commands.md # Exact Maven commands
│   └── pom-manipulation-rules.md # POM script documentation
├── configs/
│   ├── plugin-configuration.json
│   ├── dependency-migration.json
│   ├── dependency-classifier-migration.json
│   ├── settings.xml
│   └── toolchains.xml
├── recipes/
│   ├── java_upgrade.yml        # OpenRewrite Java 8/11 → 21 recipe
│   └── mockito_upgrade.yml     # OpenRewrite Mockito 1.x → 5.x recipe
└── scripts/
    ├── migrate_plugins.py      # Plugin config, SCR removal, classifiers
    ├── migrate_filevault.py    # FileVault embedded groupId fix
    └── migrate_dependency_versions.py  # Dependency version upgrades
```
