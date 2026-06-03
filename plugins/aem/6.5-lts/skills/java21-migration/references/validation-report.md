# Validation Report — java21-migration

> Skill version: 1.0 (beta). Last updated: 2026-06-03.

## Migration Pipeline Coverage

The skill's workflow covers the full Java 8/11 → 21 migration path for AEM 6.5 LTS projects.

### Steps and Tooling

| Step | Action | Tool | Automated |
|------|--------|------|-----------|
| 1 | Validate project structure | `aem-migrate analyze` (CLI) | Yes |
| 2 | Detect source Java version | `.cloudmanager/java-version` or `maven-compiler-plugin` | Yes |
| 3 | Initial build (source Java) | Maven + JDK 8/11 | Yes |
| 4 | OpenRewrite Java migration | `aem-migrate upgrade-code` → `rewrite-maven-plugin` + custom recipes | Yes |
| 5 | Build plugin upgrades | `aem-migrate upgrade-plugins` → custom OpenRewrite recipes | Yes |
| 6 | Dependency + UberJar upgrades | `aem-migrate upgrade-dependencies` + `upgrade-uberjar` | Yes |
| 7 | CloudManager Java version | `aem-migrate full-migrate` writes `21` to `.cloudmanager/java-version` | Yes |
| 8 | Pre-Mockito build (Java 21) | Maven + JDK 21 | Yes |
| 9 | OpenRewrite Mockito migration | `aem-migrate upgrade-tests` | Yes |
| 10 | Final build (Java 21) | Maven + JDK 21 | Yes |
| 11 | Post-migration verification | `aem-migrate verify` | Yes |
| 12 | Review diff and commit | Git | Agent-assisted |

### OpenRewrite Recipe Coverage

**65LTSUpgrade.yaml** — top-level composite (`aem.lts.migration.UpgradeToAEM65LTS`) chaining
four sub-recipes:

| Sub-Recipe | Recipes | What They Do |
|------------|---------|-------------|
| `UpgradeToJava21` | Java 8→11→17→21 | Cherry-picked migration recipes; **excludes** javax→jakarta |
| `UpgradePluginVersions` | 5+ | `maven-bundle-plugin` → 5.1.9, `maven-scr-plugin` → 1.26.4 + ASM 9.7.1, `bnd-maven-plugin` → 6.4.0, `maven-compiler-plugin` release=21, `filevault-package-maven-plugin` → 1.3.6 |
| `UpgradeCommonLibraries` | 6+ | WCM Core Components → 2.24.0, Groovy 4.0.27, Groovy Console → `be.orbinson.aem` 19.0.8 |
| `UpgradeMavenPluginConfigurations` | 3 custom | FileVault embedded artefact migration, BND `_plugin` instruction removal, javax safeguard |

**65LTSTestLibsUpgrades.yaml** — Mockito 1.x → 5.x progressive chain:

| Phase | Recipes | What They Do |
|-------|---------|-------------|
| 1.x → 3.x | 20+ | `Matchers` → `ArgumentMatchers`, method renames, type changes, PowerMockito replacement |
| 3.x → 4.x | 4 | `MockitoWhenOnStaticToMockStatic`, `byte-buddy` → 1.12.19 |
| 4.x → 5.x | 4 | `mockito-inline` → `mockito-core`, `byte-buddy` → 1.17.5 |
| Cleanup | 2 | Remove `FieldSetter.setField()`, remove unused imports |

**65LTSUpgradeUberJar.yaml** — UberJar coordinate migration:

| Operation | Detail |
|-----------|--------|
| Version bump | `com.adobe.aem:uber-jar` → 6.6.0 |
| Classifier addition | adds `apis` classifier (required for 6.6.0) |
| Legacy groupId | migrates `com.day.cq:uber-jar` → `com.adobe.aem:uber-jar` |
| Managed deps | syncs `dependencyManagement` declarations |
| Dedup | removes duplicate uber-jar declarations |

### Custom Java Recipes

Defined in `aem65lts-migration-recipes/` and used by the composite recipes above:

| Class | Operation | Used By |
|-------|-----------|---------|
| `ChangeFilevaultEmbeddedArtifact` | Updates `<embedded>` `groupId`/`artifactId` inside `filevault-package-maven-plugin` configuration | `UpgradeMavenPluginConfigurations` |
| `RemoveBndPluginInstruction` | Removes `<_plugin>` instruction elements from `maven-bundle-plugin` configuration that match a pattern (e.g., `SCRDescriptorBndPlugin`) | `UpgradeMavenPluginConfigurations` |
| `RevertJakartaInAemSource` | Safeguard: detects AEM/Sling Java source files and reverts any `jakarta.*` imports back to `javax.*` | `UpgradeMavenPluginConfigurations` |
| `DetectUnsupportedPackages` | Scans source files for imports from unsupported AEM packages or removed runtime bundles; marks each finding as BLOCKER or WARNING | `aem-migrate analyze` |

### Guardrail Coverage

| Guardrail | Enforced In | How |
|-----------|------------|-----|
| javax not jakarta | `migration-guardrails.md`, `RevertJakartaInAemSource` recipe, `verify` command | Triple defense: agent rule + AST recipe + post-migration check |
| Unsupported packages (8 patterns) | `migration-guardrails.md`, `analyze` command, `DetectUnsupportedPackages` recipe | HARD STOP on detection |
| Enforcer version monotonicity | `migration-guardrails.md` | Only raise, never lower |
| POM formatting preservation | OpenRewrite is AST-based | Recipes preserve formatting by construction |
| Removed bundles (Guava, Caffeine, Jetty) | `removed-bundles-remediation.md`, `analyze` command | Detection + detailed remediation guide with JDK equivalents |
| Change attribution | `migration-guardrails.md` | `// aem-lts-migration: ai-fix` comment for agent edits |
| Temp workaround cleanup | `verify` command | `MIGRATION_TEMP` marker detection |
| Build retry limit | `migrate.md` workflow | Max 3 attempts per build phase |

## Known Limitations

1. **Frontend builds skipped**: All Maven commands use `-DskipFrontend=true`. Frontend migration (Node.js version, webpack/vite upgrades) is out of scope.
2. **Tests skipped during build**: Build phases use `-DskipTests`. Test execution is deferred to CI after migration. The `upgrade-tests` command does upgrade Mockito source code, but does not run the tests.
3. **No runtime validation**: The skill verifies compilation only. OSGi bundle resolution, Sling Model registration, and runtime behaviour require deployment to an AEM instance.
4. **Mockito migration is non-fatal**: If the project does not use Mockito or the recipe fails, migration continues. The `upgrade-tests` command logs a warning rather than failing.
5. **Customer-specific dependencies**: Private/internal dependencies that fail Maven resolution cause a HARD STOP requiring manual intervention.
