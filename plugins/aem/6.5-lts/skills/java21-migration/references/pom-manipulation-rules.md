# POM Manipulation Rules

These Python scripts make targeted changes to `pom.xml` files that OpenRewrite
does not handle. They run AFTER the OpenRewrite Java migration and BEFORE the
Mockito migration.

## Script Execution Order

1. `scripts/migrate_plugins.py` — Plugin configurations + SCR removal + classifier migration
2. `scripts/migrate_filevault.py` — FileVault embedded groupId fix

## migrate_plugins.py

Performs three operations in sequence:

### 1. Plugin Configuration Update

**Config file**: `configs/plugin-configuration.json`

Updates `maven-compiler-plugin` configuration to set `<source>21</source>` and `<target>21</target>`.

Handles both:
- Direct values: replaces the XML tag value
- Property references (`${maven.compiler.source}`): updates the property in `<properties>`

### 2. SCR Plugin Line Removal

Removes `<_plugin>` tags containing `SCRDescriptorBndPlugin` from all `pom.xml` files.
These are incompatible with Java 21 and the newer `maven-bundle-plugin` 6.0.0.

Pattern matched:
```xml
<_plugin>...SCRDescriptorBndPlugin...</_plugin>
```

### 3. Dependency Classifier Migration

**Config file**: `configs/dependency-classifier-migration.json`

Adds `<classifier>apis</classifier>` to `uber-jar` dependencies in child POMs.

Logic:
- Only adds classifier if the **immediate parent POM** has the dependency with the classifier
  in its `<dependencyManagement>` section
- Only targets dependencies WITHOUT a `<version>` element (version managed by parent)
- Skips if classifier already exists

Current config:
```json
[{
  "groupId": "com.adobe.aem",
  "artifactId": "uber-jar",
  "classifier": "apis"
}]
```

## migrate_filevault.py

Updates the `groupId` of embedded artifacts matching `aem-groovy-console*` inside
`filevault-package-maven-plugin` configurations.

Changes: old groupId → `be.orbinson.aem`

This is needed because the `aem-groovy-console` project moved to the `be.orbinson.aem`
group in versions compatible with AEM 6.5 LTS / Java 21.

Target plugin:
```xml
<plugin>
  <groupId>org.apache.jackrabbit</groupId>
  <artifactId>filevault-package-maven-plugin</artifactId>
  <configuration>
    <embeddeds>
      <embedded>
        <artifactId>aem-groovy-console*</artifactId>
        <groupId>[old-group-id]</groupId>  <!-- Changed to be.orbinson.aem -->
      </embedded>
    </embeddeds>
  </configuration>
</plugin>
```

## migrate_dependency_versions.py

**Config file**: `configs/dependency-migration.json`

Reference file for known outdated dependency version mappings. The agent can use this
when build errors indicate a dependency version can't be resolved.

Current config upgrades `core.wcm.components.*` artifacts to version 2.24.0 (a
JDK 11-resolvable minimum used only to unblock the initial pre-OpenRewrite build),
skipping `core.wcm.components.examples.*`. The final AEM 6.5 LTS target version
(2.30.4) is set by OpenRewrite in `recipes/java_upgrade.yml`, not here.

Logic:
- Walks all `pom.xml` files
- For each dependency matching `groupId` + `artifactId` pattern from config
- If version is a property reference (`${prop.name}`): updates the property value
- If version is a direct string: updates it in-place
- Skips artifacts listed in the `skip` array
