# OpenRewrite Commands

Exact Maven commands used for Java and Mockito migrations.

## Java Migration (8/11 → 21)

Runs the `java_upgrade.yml` recipe using OpenRewrite with JDK 11.

```bash
cd $AEM_PROJECT_PATH && \
env JAVA_HOME=$JAVA11_HOME PATH=$JAVA11_HOME/bin:$PATH \
mvn org.openrewrite.maven:rewrite-maven-plugin:6.19.0:run \
  -Drewrite.recipeArtifactCoordinates=org.openrewrite.recipe:rewrite-migrate-java:3.18.0 \
  -Drewrite.configLocation=$SKILL_BASE_DIR/recipes/java_upgrade.yml \
  -Drewrite.activeRecipes=com.org.adobe.JavaUpgrade \
  -DskipFrontend=true \
  -Dassembly.skipAssembly=true \
  -Dvault.skipValidation=true \
  -Dcheckstyle.skip=true \
  -Djacoco.skip=true \
  -Dbnd.skip=true \
  -Dsling.install.skip=true \
  -Dexec.skip=true
```

**Why JDK 11?** OpenRewrite needs to parse the source code. JDK 11 can parse both Java 8 and 11
source code. JDK 21 is NOT used here because it may fail to compile pre-migration code.

**Fallback to JDK 8**: If OpenRewrite fails with JDK 11 and the source project is Java 8,
try re-running with `$JAVA8_HOME` instead. Some Java 8 projects have toolchain or dependency
configurations that only work with JDK 8.

### What java_upgrade.yml Does

- Upgrades Java APIs: `Java8toJava11` → `UpgradeBuildToJava17` → `UpgradeBuildToJava21`
- Removes unused imports and illegal semicolons
- Updates deprecated APIs (`Thread.stop`, `URL` constructors, `Subject` methods, `finalize`)
- Adds `SequencedCollection` usage, pattern matching, text blocks
- Upgrades build plugins: `bnd-maven-plugin` → 6.4.0, `maven-bundle-plugin` → 6.0.0, `maven-scr-plugin` → 1.26.4
- Upgrades `uber-jar` to 6.6.0 with `apis` classifier
- Changes `aem-groovy-console*` groupId to `be.orbinson.aem`
- Sets `maven-compiler-plugin` release to 21
- Updates toolchain JDK version to 21
- Upgrades `core.wcm.components.*` to 2.30.4
- Upgrades `guice` → 5.x, `commons-codec` → 1.17.x, `mapstruct` → 1.6.x
- Upgrades `jacoco-maven-plugin` → 0.8.12

## Mockito Migration (1.x → 5.x)

Runs the `mockito_upgrade.yml` recipe using OpenRewrite with JDK 21.

```bash
cd $AEM_PROJECT_PATH && \
env JAVA_HOME=$JAVA21_HOME PATH=$JAVA21_HOME/bin:$PATH \
mvn org.openrewrite.maven:rewrite-maven-plugin:6.19.0:run \
  -Drewrite.recipeArtifactCoordinates=org.openrewrite.recipe:rewrite-testing-frameworks:3.18.0 \
  -Drewrite.configLocation=$SKILL_BASE_DIR/recipes/mockito_upgrade.yml \
  -Drewrite.activeRecipes=com.org.adobe.MockitoUpgrade \
  -DskipFrontend=true \
  -Dassembly.skipAssembly=true \
  -Dvault.skipValidation=true \
  -Dcheckstyle.skip=true \
  -Djacoco.skip=true \
  -Dbnd.skip=true \
  -Dsling.install.skip=true \
  -Dexec.skip=true
```

**Why JDK 21?** By this point, the project has been migrated to Java 21. Mockito migration
runs with the target JDK since the codebase is already on Java 21.

### What mockito_upgrade.yml Does

- Replaces `org.mockito.Matchers` → `org.mockito.ArgumentMatchers`
- Upgrades Mockito progressively: 1.x → 3.x → 4.x → 5.x
- Replaces `mockito-all` → `mockito-core`, `mockito-inline` → `mockito-core`
- Upgrades `byte-buddy` to 1.15.x
- Updates deprecated Mockito API calls
- Removes `FieldSetter.setField()` with TODO comments
- Converts `MockitoJUnitRunner` → `MockitoExtension`
- Removes `PowerMockito` usage

## Maven Build Command

Used for all build verification phases (initial, pre-Mockito, final):

```bash
cd $AEM_PROJECT_PATH && \
env JAVA_HOME=$JAVA_HOME_FOR_THIS_PHASE PATH=$JAVA_HOME_FOR_THIS_PHASE/bin:$PATH \
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

### Build Phases and JDK Used

| Phase | JDK | Variable | Purpose |
|-------|-----|----------|---------|
| Initial build | Source (8 or 11) | `$JAVA8_HOME` or `$JAVA11_HOME` | Verify project compiles before migration |
| Pre-Mockito build | 21 | `$JAVA21_HOME` | Verify Java 21 migration succeeded |
| Final build | 21 | `$JAVA21_HOME` | Verify everything works after Mockito migration |
