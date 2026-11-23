# Intentional version policy

The exact Maven versions in this evaluation skill are **intentional pins**, not
automatically maintained compatibility claims. `renovate.json` disables Maven
updates only under this skill's directory. GitHub Actions in the regression
workflow and other plugins remain eligible for normal updates.

Each runtime value stays in its existing JSON configuration. The list below
records the nearby rationale for those pins; this document does not configure
the runner.

| Configuration | Pins | Why kept fixed |
|---|---|---|
| `configs/targets.json` | `rewrite-maven-plugin:6.45.0`, `rewrite-migrate-java:3.40.0`, `rewrite-testing-frameworks:3.40.0` | Candidate recipe/plugin combination with inspected upstream identities and licenses; update together after real recipe execution, Mockito ordering and source-idempotency checks |
| `configs/plugin-configuration-25.json` | compiler `3.15.0`, Surefire/Failsafe `3.5.4`, JaCoCo `0.8.14` | Candidate Java 25 tooling minimums; preserve higher existing versions and verify full tests, bytecode and instrumentation before changing the baseline |
| `configs/targets.json` | FileVault `1.4.0` | Candidate package tooling baseline; changes require package/analyser checks with validators still enabled |
| `configs/dependency-migration.json` | ASM family `9.8`, Byte Buddy/agent `1.17.8` | Candidate bytecode/instrumentation minimums; changes require JVM and Mockito compatibility checks without an automatic experimental flag |
| `configs/dependency-classifier-migration.json` | Sling mock JUnit 5 `3.5.0` | This exact unclassified artifact publication was checked; a new allowed version must have its unclassified artifact verified before removing `jdk11` |

Maintainers must update configuration values and any matching command examples
or documentation in one change. Preserve third-party licensing, recheck the
official Adobe support gate, run the deterministic suite, then record real
source-JDK/target-JDK AEM builds and recipe behavior before treating a new
combination as validated. Until those checks exist, all pins remain candidate
evaluation settings.

JDK numbers, Python/Maven prerequisites, dates and Rewrite's recorded dependency
versions are requirements or historical evidence, not an instruction for Renovate
to upgrade the advertised target or silently change its validation state.
