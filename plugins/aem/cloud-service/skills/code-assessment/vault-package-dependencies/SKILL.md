---
name: vault-package-dependencies
description: |
  AEM Cloud Service expert skill — remove legacy AEM 6.x Vault install-time <dependencies> from
  content-package-maven-plugin <configuration> in pom.xml. These day/cq60/product:* entries do not
  exist on AEMaaCS (the platform is baked into the container image), so CRX Package Manager refuses
  to install the package at deploy time even though the Maven build succeeds. Use for "package install
  fails on AEMaaCS", "day/cq60/product dependency", "CRX refuses install", or when scanning a project
  for deployment blockers. Fix is mechanical: remove the entire <dependencies> block.
license: Apache-2.0
---

# Vault package dependencies — AEM as a Cloud Service

> This pattern is executed by the code-assessment runbook — follow [`../references/runbook.md`](../references/runbook.md) for the full flow (preflight → plan → apply → verify, run log). This skill supplies the detection + recipe the runbook applies.

## Overview

Content packages built for AEM 6.x declare Vault install-time `<dependencies>` inside
`content-package-maven-plugin / <configuration>`. These reference AEM 6.x product packages
(`day/cq60/product:cq-content`, `day/cq60/product:cq-commerce-content`, etc.) that were
pre-installed on AEM 6.x instances. On AEM as a Cloud Service the platform is delivered via a
container image — those product packages no longer exist as installable entries in CRX Package
Manager. CRX Package Manager checks all declared Vault dependencies at install time and **refuses
the install** if any are unresolvable, even though `mvn clean install` succeeds.

The fix is mechanical: remove the entire `<dependencies>` block. The functionality the packages
provided is still present on AEMaaCS; only the install-time check needs to be removed.

## Classification — confirm this pattern applies

- A `pom.xml` whose `content-package-maven-plugin / <configuration>` contains a `<dependencies>`
  block with at least one `<dependency>` whose `<group>` starts with `day/cq60/`, `day/cq560/`,
  or `adobe/cq60`.
- Applies regardless of whether the plugin groupId is `com.day.jcr.vault` (legacy) or
  `org.apache.jackrabbit` (current filevault-package-maven-plugin).
- The same pom may have the plugin in both main `<build>` and inside `<profiles>` — check both.

## Discovery

Detection is performed by the analyzer ([`../scripts/analyze.sh`](../scripts/README.md)), run by
the runbook:

```bash
bash ../scripts/analyze.sh <workspace-root> --pattern vault-package-dependencies
```

**Match criteria:** a `<plugin>` whose direct `<artifactId>` child equals
`content-package-maven-plugin`, with a direct `<configuration>` child containing a direct
`<dependencies>` child that has at least one `<dependency>/<group>` prefixed with `day/cq60/`,
`day/cq560/`, or `adobe/cq60`. One finding per `<dependencies>` block.

## Resolution contract

**self-evident** — always remove the entire `<dependencies>` block. No user input required.

## Review checklist

- [ ] Only the `<dependencies>` block under `content-package-maven-plugin / <configuration>` removed — no other plugin config touched
- [ ] Maven classpath `<dependencies>` at the project level left intact
- [ ] No whitespace churn outside the removed block
- [ ] All occurrences removed — check both main `<build>` and any `<profiles>` sections
- [ ] Build still succeeds after the change (`mvn clean install`)

## Recipe

Read [`recipe.md`](recipe.md) in full before editing: locator, edit, unlocatable reasons, before/after example, editing strategy.

## Handoff

The skill never commits. See [`../references/git-workflow.md`](../references/git-workflow.md) for git vs in-place handoff and the suggested commit message.
