# Recipe — Vault package dependencies

> Read this fully before editing. Control plane: [SKILL.md](SKILL.md).

## Input contract

Per invocation, a deduplicated list of repo-relative pom paths:

```json
{
  "files": [
    "ui.apps/pom.xml",
    "ui.commons/pom.xml"
  ]
}
```

Sources:

1. **User-named** — the user names the pom file(s) directly.
2. **Discover** — the file list is the output of the **Discovery** scan in [`SKILL.md`](SKILL.md).

## Locator

For each file:

1. Find the `<plugin>` element whose direct `<artifactId>` child text equals `content-package-maven-plugin`.
2. Inside that plugin, find the direct `<configuration>` child element.
3. Inside `<configuration>`, find the direct `<dependencies>` child element containing at least one `<dependency>/<group>` prefixed with `day/cq60/`, `day/cq560/`, or `adobe/cq60`.
4. Repeat for every occurrence of `content-package-maven-plugin` in the file — the same pom may declare the plugin in the main `<build>` section **and** in one or more `<profiles>/<profile>/<build>` sections.

## Edit

Remove the entire `<dependencies>...</dependencies>` block, including its surrounding blank/indentation line. Do not touch any sibling elements (`<subPackages>`, `<embeddeds>`, `<filters>`, `<properties>`, etc.).

## Before / after

**Before (`ui.apps/pom.xml`):**
```xml
<configuration>
    <verbose>true</verbose>
    <failOnError>true</failOnError>
    <group>adobe/aem6/sample</group>
    <failOnMissingEmbed>true</failOnMissingEmbed>
    <dependencies>
        <dependency>
            <group>day/cq60/product</group>
            <name>cq-content</name>
            <version>[6.3.0,)</version>
        </dependency>
        <dependency>
            <group>day/cq60/product</group>
            <name>cq-commerce-content</name>
            <version>[1.5.0,)</version>
        </dependency>
    </dependencies>
    <subPackages>
        ...
    </subPackages>
</configuration>
```

**After:**
```xml
<configuration>
    <verbose>true</verbose>
    <failOnError>true</failOnError>
    <group>adobe/aem6/sample</group>
    <failOnMissingEmbed>true</failOnMissingEmbed>
    <subPackages>
        ...
    </subPackages>
</configuration>
```

## Unlocatable / skip reasons

| Situation | `skipped` reason string |
|---|---|
| `content-package-maven-plugin` not found in pom | `vault-package-dependencies-no-plugin: content-package-maven-plugin not found in <file>` |
| Plugin found but no `<configuration>/<dependencies>` block present | `vault-package-dependencies-no-deps-block: no <dependencies> block under <configuration> in <file>` |
| `<dependencies>` block contains no legacy group prefixes | `vault-package-dependencies-no-legacy-groups: no day/cq60 or day/cq560 group prefixes found in <file>` |

## Editing strategy

Surgical XML edit — anchor on ≥3 lines of context before and after the `<dependencies>` block. Use `replace_string_in_file`. Do not re-serialize or reformat any surrounding XML.
