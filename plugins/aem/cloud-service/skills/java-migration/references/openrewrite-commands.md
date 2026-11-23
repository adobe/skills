# OpenRewrite execution

All commands use absolute installed resource paths, an explicit target, and a
verified Java environment. Pins and recipe identities are centralized in
[targets.json](../configs/targets.json). Never invoke an unpinned `RELEASE` plugin.

The candidate pins are `rewrite-maven-plugin:6.45.0` (Rewrite 8.88.0),
`rewrite-migrate-java:3.40.0` (Rewrite 8.87.0), and
`rewrite-testing-frameworks:3.40.0` (Rewrite 8.85.4). Their published POMs and the
upstream recipe identifiers were checked; **actual combined execution remains
an integration acceptance check**, not a compatibility guarantee.

```bash
# Set JAVA_HOME to the verified recipe runtime and prepend its bin directory to PATH.
mvn --batch-mode --no-transfer-progress \
  org.openrewrite.maven:rewrite-maven-plugin:6.45.0:run \
  -Drewrite.recipeArtifactCoordinates=org.openrewrite.recipe:rewrite-migrate-java:3.40.0 \
  "-Drewrite.configLocation=$SKILL_ROOT/recipes/java_upgrade.yml" \
  -Drewrite.activeRecipes=adobe.aem.Java25Evaluation
```

[java_upgrade.yml](../recipes/java_upgrade.yml) invokes only
`org.openrewrite.java.migrate.UpgradeToJava25`, whose upstream chain includes the
intermediate Java 21 upgrade. Do not chain Java 8/11/17/21 recipes separately or
repeat `@Serial` insertion. Actual annotation/idempotency behavior must be checked
on real migrated source; wrapper inspection alone does not prove it.

After deterministic POM edits and successful target-JDK main-source compilation
(`mvn compile`), run the analogous command with goal `runNoFork` using
`rewrite-testing-frameworks:3.40.0`,
[mockito_upgrade.yml](../recipes/mockito_upgrade.yml), and
`adobe.aem.MockitoMigration`. The wrapper invokes
`org.openrewrite.java.testing.mockito.Mockito1to5Migration`.
Skip this stage if JDK 25 is missing. Unlike `run`, `runNoFork` does not fork the
Maven lifecycle and therefore does not require test compilation before the recipe
can repair Mockito source incompatibilities. Final `mvn clean verify` still
compiles and runs the full test suite and existing build gates.

Before each command the runner logs `mvn --version` under that JDK. It records
command output separately per stage without a pipe that could hide failure.
Check actual toolchain/profile overrides as well. Never add `-DskipTests`,
`-Dmaven.test.skip`, validator-disabling flags, or broad source exclusions.
