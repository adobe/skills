# Vault package dependencies on AEM as a Cloud Service

Not a Cloud-Service-native code-quality issue — it only shows up in `pom.xml` carried over from a pre-cloud (legacy AEM 6.x / AMS) codebase, so this is a migration reference, not a `code-assessment` pattern. No BPA pattern id exists for it: a `pom.xml` install-time dependency declaration is invisible to a deployed-artifact BPA scan (confirmed against a real BPA report — zero hits for `day/cq60`, `vault`, or `content-package-maven-plugin`).

## Why it's flagged

Content packages built for AEM 6.x declare Vault install-time `<dependencies>` inside `content-package-maven-plugin / <configuration>`. These reference AEM 6.x product packages (`day/cq60/product:cq-content`, `day/cq60/product:cq-commerce-content`, etc.) that were pre-installed on AEM 6.x instances. On AEM as a Cloud Service the platform is delivered via a container image — those product packages no longer exist as installable entries in CRX Package Manager. CRX Package Manager checks all declared Vault dependencies at install time and **refuses the install** if any are unresolvable, even though `mvn clean install` succeeds.

The fix is mechanical: remove the entire `<dependencies>` block. The functionality the packages provided is still present on AEMaaCS; only the install-time check needs to be removed.

## Discovery — effective-POM scan (with text-scan fallback)

Ask Maven for the **effective POM** and scan that, so `<pluginManagement>` inheritance and per-execution vs plugin-level `<configuration>` merging are Maven's problem, not ours. The runner (`migration/scripts/vault-package-scan-runner.js`):

1. Groups Maven project roots under **reactor roots** (a `pom.xml` declaring `<modules>`) and runs `mvn help:effective-pom` **once per reactor**, splitting the resulting `<projects>` file back into per-module XML. This avoids one network-bound `mvn` subprocess per module on a normal multi-module AEM repo.
2. Falls back to `mvn -N help:effective-pom` per module for standalone poms not in any reactor.
3. Falls back to a **raw text-scan of the source `pom.xml`** for every module whose effective-POM resolution failed. Legacy AEM 6.x / AMS projects — the pattern's target audience — frequently can't resolve a build anymore (dead parent repos, missing artifacts, offline), and the text-scan mirrors the pure-Node scan that predated the Maven delegation. It's degraded (inherited-only pluginManagement config that Maven would have merged is invisible without Maven), and every fallback emits a warning so the customer sees the degradation rather than a silent "clean" result.

If every module in the workspace fails **both** the effective-POM path and raw-pom-read, the runner returns `ok:false` and the runbook dispatcher falls the pattern through to the **LLM-scan tier** — never a false "no vault dependency issues" from a scan that couldn't run.

Both the effective-POM and text-scan paths **skip `<plugin>` entries nested under `<pluginManagement>`**. Maven retains pluginManagement blocks in the effective POM even after merging their configuration into `<build><plugins>`, so scanning both would report the same block twice.

Group by **`<dependencies>` block**, not by `<dependency>` entry: a block with several legacy dependencies is still one finding, one migration unit — the fix removes the whole block regardless of how many legacy entries it contains.

## Classification — confirm this pattern applies

- A `pom.xml` whose `content-package-maven-plugin / <configuration>` contains a `<dependencies>` block with at least one `<dependency>` whose `<group>` starts with `day/cq60/`, `day/cq560/`, or `adobe/cq60`.
- Applies regardless of whether the plugin groupId is `com.day.jcr.vault` (legacy) or `org.apache.jackrabbit` (current filevault-package-maven-plugin).
- The same pom may have the plugin in both main `<build>` and inside `<profiles>` — check both.

## Resolution contract

**Self-evident** — always remove the entire `<dependencies>` block. No user input required.

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

Surgical XML edit — anchor on ≥3 lines of context before and after the `<dependencies>` block. Do not re-serialize or reformat any surrounding XML.

## Review checklist

- [ ] Only the `<dependencies>` block under `content-package-maven-plugin / <configuration>` removed — no other plugin config touched
- [ ] Maven classpath `<dependencies>` at the project level left intact
- [ ] No whitespace churn outside the removed block
- [ ] All occurrences removed — check both main `<build>` and any `<profiles>` sections
- [ ] Build still succeeds after the change (`mvn clean install`)
