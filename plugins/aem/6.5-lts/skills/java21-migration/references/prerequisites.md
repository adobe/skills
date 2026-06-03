# Prerequisites

The skill is invoked as a CLI process and assumes the host machine has the
toolchain available before the agent runs anything. Every prerequisite is
checked at the top of the workflow (`workflows/migrate.md` step 1) and the
migration terminates with a clear error if any item is missing.

## Tool Matrix

| Tool | Min version | Why it is needed | How to verify |
|---|---|---|---|
| JDK 8 | `1.8.0_311+` | Compiles a baseline build of projects that were originally authored against Java 8; some Maven Toolchains setups also pin Java 8 for `rewrite-maven-plugin` invocations on legacy modules. | `"$JAVA8_HOME/bin/java" -version` reports `1.8.x` |
| JDK 11 | `11.0.20+` | Default JDK for `upgrade-code`, `upgrade-plugins`, `upgrade-dependencies`, `upgrade-uberjar`. JDK 11 is the lowest common denominator that parses Java 8 sources while remaining supported by `rewrite-maven-plugin`. | `"$JAVA11_HOME/bin/java" -version` reports `11.x` |
| JDK 21 | `21.0.0+` | Runs the post-migration build phases and `upgrade-tests`, which needs Mockito 5.x at matching bytecode level. Also the runtime target of the migrated project. | `"$JAVA21_HOME/bin/java" -version` reports `21.x` |
| Maven | `3.9.x` | Drives `rewrite-maven-plugin` from the CLI's Maven Invoker; older 3.6/3.8 lines have known issues with the plugin's classpath isolation. | `mvn --version` reports `3.9.x` |
| Git | `2.30+` | The migration commits to a fresh branch, so `git` must be available and the project working tree must be clean. | `git --version` |

The skill does **not** require Python, Node.js, or Docker on the host — every
transformation runs through the bundled CLI JAR using the local Maven
installation.

## Environment Variables

Three JDK locations are read from the environment. The `--javaHome`
arguments on individual CLI commands override these per-phase, so the
environment defaults only matter when the agent invokes `full-migrate`
without per-phase overrides.

| Variable | Required? | Read by | Notes |
|---|---|---|---|
| `JAVA8_HOME` | When source project is Java 8 | `full-migrate --sourceJavaHome` | Skip if the source project is Java 11. |
| `JAVA11_HOME` | Always | `full-migrate --java11Home`, `upgrade-code`, `upgrade-plugins`, `upgrade-dependencies`, `upgrade-uberjar` | The default OpenRewrite JDK. |
| `JAVA21_HOME` | Always | `full-migrate --javaHome`, `upgrade-tests`, post-migration builds | The migration target. |
| `AEM_PROJECT_PATH` | Always | All CLI commands via `-r/--repository-path` | Absolute path to the project root containing `pom.xml`. |
| `MAVEN_HOME` / `PATH` | Always | Maven Invoker discovers `mvn` from `PATH` first, falls back to `MAVEN_HOME`. | Either works. |

A sample shell-profile snippet:

```bash
export JAVA8_HOME=/Library/Java/JavaVirtualMachines/temurin-8.jdk/Contents/Home
export JAVA11_HOME=/Library/Java/JavaVirtualMachines/temurin-11.jdk/Contents/Home
export JAVA21_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home
```

## Project State

The target project must be in a state that allows a clean migration commit:

- A `pom.xml` exists at `$AEM_PROJECT_PATH`.
- `$AEM_PROJECT_PATH/.git` is a Git working tree.
- `git status --porcelain` produces no output (clean working tree).
- All required JDKs above resolve at the paths in their `*_HOME` variables.
- Maven can reach Maven Central or the configured internal mirror.

The `analyze` subcommand checks the first four items, plus the
unsupported-package scan, and exits non-zero if any fails. Run it before
`full-migrate`:

```bash
java -jar "$MIGRATE_JAR" analyze -r "$AEM_PROJECT_PATH"
```

## Build the CLI Once Per Checkout

The CLI is built from this skill's own Maven reactor:

```bash
cd "$SKILL_DIR"
mvn clean install -DskipTests
```

The shaded executable JAR lands at
`aem65lts-migration-cli/target/aem65lts-migration-cli-1.0-SNAPSHOT.jar`.
The `aem65lts-migration-recipes` module is also installed into the local
Maven repository so the CLI's own `rewrite-maven-plugin` invocations can
resolve it as a recipe artefact.

## References

- [AEM 6.5 LTS GA release notes](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/service-pack/ga)
- [Apache Maven 3.9 release notes](https://maven.apache.org/docs/3.9.0/release-notes.html)
- [Eclipse Temurin JDK 21 downloads](https://adoptium.net/temurin/releases/?version=21)
- [AEM UberJar on Maven Central](https://mvnrepository.com/artifact/com.adobe.aem/uber-jar)
