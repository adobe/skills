# OpenRewrite Commands

The `aem-migrate` CLI is the only supported entry point. It packages a fixed pair
of recipe artefact coordinates (`rewrite-migrate-java`, `rewrite-testing-frameworks`)
plus the in-tree `aem65lts-migration-recipes` JAR, and resolves the active recipe
names from the bundled `META-INF/config/openrewrite/recipes/*.yaml` declarative
recipes via OpenRewrite classpath discovery.

There is intentionally **one** invocation path. Hand-crafted `mvn rewrite:run`
invocations are not supported because the recipe-artefact / recipe-name pairing
is brittle and a single mismatched coordinate (for example
`rewrite-migrate-java:3.9.0` vs `:3.18.0`) silently changes the set of resolvable
recipes. Pinning both ends in code is what makes the pipeline reproducible.

For the upstream OpenRewrite recipe catalog and Maven plugin reference, see the
[OpenRewrite documentation](https://docs.openrewrite.org/).

## CLI Invocations

```bash
MIGRATE_JAR="$SKILL_DIR/aem65lts-migration-cli/target/aem65lts-migration-cli-1.0-SNAPSHOT.jar"

# Full automated migration (8-step pipeline — see workflows/migrate.md)
java -jar "$MIGRATE_JAR" full-migrate \
    -r "$AEM_PROJECT_PATH" \
    --sourceJavaHome "$JAVA8_HOME" \
    --java11Home    "$JAVA11_HOME" \
    --javaHome      "$JAVA21_HOME"

# Individual phases (each can be re-run in isolation)
java -jar "$MIGRATE_JAR" analyze              -r "$AEM_PROJECT_PATH"
java -jar "$MIGRATE_JAR" upgrade-code         -r "$AEM_PROJECT_PATH" -j "$JAVA11_HOME"
java -jar "$MIGRATE_JAR" upgrade-plugins      -r "$AEM_PROJECT_PATH" -j "$JAVA11_HOME"
java -jar "$MIGRATE_JAR" upgrade-dependencies -r "$AEM_PROJECT_PATH" -j "$JAVA11_HOME"
java -jar "$MIGRATE_JAR" upgrade-uberjar      -r "$AEM_PROJECT_PATH" -j "$JAVA11_HOME"
java -jar "$MIGRATE_JAR" upgrade-tests        -r "$AEM_PROJECT_PATH" -j "$JAVA21_HOME"
java -jar "$MIGRATE_JAR" verify               -r "$AEM_PROJECT_PATH"
```

Every command supports `--dryRun` / `-d` to surface the diff without writing it
back to the working tree, and exits non-zero if the underlying `rewrite-maven-plugin`
run fails.

## JDK Selection per Phase

| Phase | Required JDK | Why |
|---|---|---|
| `analyze` | any | Read-only AST scan of `*.java` and `pom.xml` — no compilation. |
| `upgrade-code`, `upgrade-plugins`, `upgrade-dependencies`, `upgrade-uberjar` | **JDK 11** | The `rewrite-maven-plugin` parser must accept both the pre-migration source level (8 or 11) and the post-migration target (21). JDK 11 is the lowest common denominator that parses Java 8 source correctly while still being supported by `rewrite-maven-plugin`. |
| `upgrade-tests` | **JDK 21** | At this point the project has already been moved to Java 21 source and Mockito 5.x needs the matching bytecode level. |
| `verify` | any | Reads POMs and Java sources for static checks; never compiles. |

If the source project is Java 8 and `upgrade-code` fails to parse a file under
JDK 11 (rare, caused by legacy toolchain configuration), re-run that single phase
with `-j "$JAVA8_HOME"`. The CLI never modifies the project's enforced JDK
floor; JDK selection is a runtime concern only.

## Active Recipe Wiring

The phase boundaries match the active recipe name passed by each CLI command.
Active recipes live in
`aem65lts-migration-cli/src/main/resources/META-INF/config/openrewrite/recipes/`
and are loaded automatically via OpenRewrite classpath discovery — there is no
filesystem `configLocation` to manage.

| Active recipe | Loaded from | Phase |
|---|---|---|
| `aem.lts.migration.UpgradeToAEM65LTS` | `65LTSUpgrade.yaml` | `upgrade-code` and `full-migrate` |
| `aem.lts.migration.UpgradePluginVersions` | `65LTSPluginUpgrades.yaml` | `upgrade-plugins` |
| `aem.lts.migration.UpgradeCommonLibraries` | `65LTSDependencyUpgrades.yaml` | `upgrade-dependencies` |
| `aem.lts.migration.UpdateUberJarVersion` | `65LTSUpgradeUberJar.yaml` | `upgrade-uberjar` |
| `aem.lts.migration.UpgradeTestingFrameworks` | `65LTSTestLibsUpgrades.yaml` | `upgrade-tests` |

### `aem.lts.migration.UpgradeToAEM65LTS`

Composes the upstream `org.openrewrite.recipe:rewrite-migrate-java` Java 8 →
11 → 17 → 21 chain with the four custom AEM-specific recipes
(`ChangeFilevaultEmbeddedArtifact`, `RemoveBndPluginInstruction`,
`RevertJakartaInAemSource`, `DetectUnsupportedPackages`).

It explicitly **excludes** the upstream `javax → jakarta` migration: AEM 6.5
LTS exports `javax.*`. An accidental swap compiles but produces a runtime
no-op (e.g. `@PostConstruct` callbacks never fire). The
`RevertJakartaInAemSource` safeguard reverts any stray jakarta imports
re-introduced by a transitive composite.

### `aem.lts.migration.UpgradeTestingFrameworks`

Mockito makes hard-cut API changes between every major version. The recipe
runs four staged sub-chains in order: `MockitoOneToThree` →
`MockitoThreeToFour` → `MockitoFourToFive` → `MockitoCleanup`. Skipping a
stage causes compilation chaos because intermediate API renames (for
example `Matchers` → `ArgumentMatchers`) only exist in the intermediate
versions.

## Determinism Guarantees

The custom recipes ship with idempotency tests
(`*IdempotencyTest` in `aem65lts-migration-recipes/src/test/`) that run each
recipe twice over its expected post-migration output and assert that the
second run produces zero changes. This catches accidental visitor reruns,
oscillating edits, and order-dependent transforms before they reach a
customer codebase. The bundled declarative composites are exercised by the
same harness via their constituent custom recipes.

`--dryRun` on every CLI command exposes the diff without writing it back —
running the same command twice with `--dryRun` against a freshly migrated
project must produce an empty diff. This is the contract any new recipe in
this skill is expected to uphold.

## Maven Build Command (manual phase verification)

The CLI does not invoke `mvn install` on the target project — that remains a
separate concern. Use the following invocation for the three intermediate
verification builds (initial baseline, pre-Mockito, final):

```bash
cd "$AEM_PROJECT_PATH" && \
env JAVA_HOME="$JAVA_HOME_FOR_THIS_PHASE" PATH="$JAVA_HOME_FOR_THIS_PHASE/bin:$PATH" \
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

| Phase | JDK | Purpose |
|---|---|---|
| Initial build | source (8 or 11) | Verify project compiles before migration. |
| Pre-Mockito build | 21 | Verify Java 21 migration succeeded before touching tests. |
| Final build | 21 | Verify Mockito migration succeeded. |

---

## References

- [OpenRewrite documentation](https://docs.openrewrite.org/)
- [rewrite-migrate-java recipes](https://docs.openrewrite.org/recipes/java/migrate)
- [rewrite-testing-frameworks Mockito recipes](https://docs.openrewrite.org/recipes/java/testing/mockito)
- [AEM 6.5 LTS GA release notes](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/service-pack/ga)
- [Upgrading code and customizations (AEM 6.5 LTS)](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations)
