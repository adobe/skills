# Validation Report — java21-migration

> Skill version: 1.0 (beta). Last updated: 2026-05-28.

## Migration Pipeline Coverage

The skill's 12-step workflow covers the full Java 8/11 → 21 migration path for AEM 6.5 LTS projects.

### Steps and Tooling

| Step | Action | Tool | Automated |
|------|--------|------|-----------|
| 1 | Validate project structure | Bash (pom.xml + .git check) | Yes |
| 2 | Detect source Java version | `.cloudmanager/java-version` or `maven-compiler-plugin` | Yes |
| 3 | Initial build (source Java) | Maven + JDK 8/11 | Yes |
| 4 | OpenRewrite Java migration | `rewrite-maven-plugin:6.19.0` + `java_upgrade.yml` | Yes |
| 5 | POM manipulations | `migrate_plugins.py` + `migrate_filevault.py` | Yes |
| 6 | CloudManager Java version | Write `21` to `.cloudmanager/java-version` | Yes |
| 7 | Pre-Mockito build (Java 21) | Maven + JDK 21 | Yes |
| 8 | OpenRewrite Mockito migration | `rewrite-maven-plugin:6.19.0` + `mockito_upgrade.yml` | Yes |
| 9 | Final build (Java 21) | Maven + JDK 21 | Yes |
| 10 | Clean up workarounds + jakarta | Grep + manual revert | Yes |
| 11 | Generate migration report | `git diff --stat` + file counts | Yes |
| 12 | Review diff and commit | Git | Agent-assisted |

### OpenRewrite Recipe Coverage

**java_upgrade.yml** — 45 recipe entries covering:

| Category | Recipes | What They Do |
|----------|---------|-------------|
| Java 8 → 11 | 1 | `Java8toJava11` composite recipe |
| Java 11 → 17 | 20 | Individual migration recipes (excludes javax→jakarta) |
| Java 17 → 21 | 10 | `UpgradeBuildToJava21`, deprecated API removal, `SequencedCollection` |
| Test infrastructure | 2 | `jacoco-maven-plugin` → 0.8.12 |
| AEM plugins | 5 | `maven-bundle-plugin` → 6.0.0, `maven-scr-plugin` → 1.26.4, etc. |
| AEM dependencies | 7 | `uber-jar` → 6.6.0, `core.wcm.components.*` → 2.30.4, `groovy-console` groupId |

**mockito_upgrade.yml** — 6 recipe definitions (progressive chain):

| Chain | Recipes | What They Do |
|-------|---------|-------------|
| 1.x → 3.x | 20 | `Matchers` → `ArgumentMatchers`, method renames, type changes |
| 3.x → 4.x | 4 | `MockitoWhenOnStaticToMockStatic`, `byte-buddy` → 1.12.19 |
| 4.x → 5.x | 4 | `mockito-inline` → `mockito-core`, `byte-buddy` → 1.15.x |
| Cleanup | 2 | Remove `FieldSetter`, remove unused imports |

### POM Manipulation Script Coverage

| Script | Operations | Config File |
|--------|-----------|-------------|
| `migrate_plugins.py` | 3 ops: compiler config update, SCR removal, classifier migration | `plugin-configuration.json`, `dependency-classifier-migration.json` |
| `migrate_filevault.py` | 1 op: embedded groupId fix for `aem-groovy-console*` | N/A (CLI args) |
| `migrate_dependency_versions.py` | 1 op: version upgrade for outdated deps | `dependency-migration.json` |

### Guardrail Coverage

| Guardrail | Enforced In | How |
|-----------|------------|-----|
| javax not jakarta | `build-fix-constraints.md`, Step 10 cleanup | Hard rule + post-migration revert |
| Unsupported packages (8 patterns) | `build-fix-constraints.md` | HARD STOP on detection |
| Enforcer version monotonicity | `build-fix-constraints.md` | Only raise, never lower |
| POM indentation preservation | `build-fix-constraints.md` | Match original whitespace |
| Removed bundles (Guava, Caffeine, Jetty) | `build-fix-constraints.md` | Embed or refactor guidance |
| Change attribution | `build-fix-constraints.md` | `// Fixed by Migration AI` comment |
| Temp workaround cleanup | Workflow Step 10 | `TEMP_WORKAROUND` marker removal |
| Build retry limit | Workflow Steps 3, 7, 9 | Max 3 attempts per build phase |

## Known Limitations

1. **Frontend builds skipped**: All Maven commands use `-DskipFrontend=true`. Frontend migration (Node.js version, webpack/vite upgrades) is out of scope.
2. **Tests skipped**: All builds use `-DskipTests`. Test execution is deferred to CI after migration.
3. **No runtime validation**: The skill verifies compilation only. OSGi bundle resolution, Sling Model registration, and runtime behavior require deployment to an AEM instance.
4. **Mockito migration is non-fatal**: If the project doesn't use Mockito or the recipe fails, migration continues.
5. **Customer-specific dependencies**: Private/internal dependencies that fail resolution cause a HARD STOP requiring manual intervention.
