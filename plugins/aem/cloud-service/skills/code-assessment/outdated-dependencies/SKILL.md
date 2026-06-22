---
name: outdated-dependencies
description: "[BETA] AEM Cloud Service expert skill — upgrade outdated Maven dependencies in pom.xml, both literal <version> and same-pom ${property} shapes. Use for \"update my aem-sdk-api\", \"upgrade mockito\", or scanning a project for stale dependency versions. Discovery can find <dependency> blocks but \"outdated\" needs a target version, which the user supplies. Pattern A/B locators and editing strategy are in recipe.md. This skill is in beta. Verify all outputs before applying them to production projects."
metadata:
  status: beta
license: Apache-2.0
---

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

# Outdated Maven dependencies — AEM as a Cloud Service

> This pattern is executed by the code-assessment runbook — follow [`../references/runbook.md`](../references/runbook.md) for the full flow (preflight → plan → apply → verify, run log). This skill supplies the detection + recipe the runbook applies.

## Overview

Stale Maven dependencies (notably `aem-sdk-api`) cause build failures and local/runtime drift. This skill bumps a dependency's version surgically — literal `<version>` or a same-pom `${property}` — without reformatting the pom.

## Answering "are my dependencies up to date?"

This pattern **locates** Maven coordinates; it does **not** declare a dependency outdated vs current without a **user-supplied target version** (see Resolution contract). For a comparative ask ("up to date?", "stale?", "outdated?") with `report` intent:

1. Run discovery via the analyzer (`--pattern outdated-dependencies`, or a full audit).
2. Present every located coordinate in the Step 7 **Candidates** table with planned action `skipped` and reason `needs-user-target` (no target supplied).
3. State plainly: *"Found N versioned dependencies across M pom files. Supply target versions to mark upgrades. For `aem-sdk-api`, align with your Cloud Manager environment SDK — do not assume the latest public version."*
4. Offer follow-up: reply with target versions to apply, or name coordinates then say **apply**.

**Do not** run `mvn versions:display-*`, `npm outdated`, or Maven Central / registry lookups in place of this inventory. A live registry comparison needs network and is advisory only — if the user explicitly asks, do it as a separate step **after** the skill report.

## Classification — confirm this pattern applies

- A `pom.xml` with a `<dependency>` whose version the user wants raised, either as a literal `<version>` or via a `<version>${prop}</version>` + `<properties>` entry.
- Applies to a `<dependency>` that carries a `<version>` (literal or `${property}`) in `<dependencies>` **or** `<dependencyManagement>`. Not for `<plugin>` / `<build>` dependencies, version-less (inherited) `<dependency>` entries, or versions defined only in an out-of-workspace parent pom.

## Discovery

Detection is performed by the analyzer ([`../scripts/analyze.sh`](../scripts/README.md)), run by
the runbook:

```bash
bash ../scripts/analyze.sh <workspace-root> --pattern outdated-dependencies
```

**Match criteria (what the detector flags):** each `<dependency>` element carrying a `<version>`
(literal or `${property}`) under `<dependencies>` or `<dependencyManagement>` — excluding
`<plugin>`/`<pluginManagement>`/`<build>`/`<reporting>` dependencies and version-less (inherited)
`<dependency>` entries — emitted with its `groupId:artifactId@version` and the line of its
`<artifactId>`. The analyzer only **locates** dependencies — "is this outdated?" and "what is the
target version?" are **user-supplied** (see Resolution contract); the analyzer performs no network
lookup. If the same `(groupId, artifactId, version)` appears in more than one `<dependency>` block
in a file, the recipe's `ambiguous-locator` skip applies during planning.

**Allowlist scope:** by default the detector is scoped to a curated allowlist of coordinates where
upgrades are actionable in AEM Cloud Service projects (currently `com.adobe.aem:aem-sdk-api` and
`org.mockito:*`). Non-allowlisted versioned dependencies are silently skipped. To list every
versioned dependency regardless of allowlist, pass `--all` to `analyze.sh` — but **only** for an
explicit full audit ("all dependencies", "every library", "comprehensive"). For a normal "are my
dependencies outdated?" ask, keep the default allowlist scope: it is the actionable answer, and
`--all` adds platform deps (OSGi, JCR, servlet-api) that are not independently upgradeable. Adding a coordinate to
the allowlist is a one-line change in `OutdatedDependencies.java`; `analyze.sh` recompiles
automatically. Both exact `groupId:artifactId` and prefix-wildcard `groupId:prefix*` forms are
supported.

## Resolution contract

**user-supplied** — list the found coordinates with their current versions and ask which to upgrade and to what target version before planning. Never guess a version.

## Review checklist

- [ ] Only the `<version>` text (or the `<properties>` entry) changed — no whitespace/attribute churn
- [ ] Property shape edits validated: property exists, value matched, referenced by the target dependency
- [ ] Ambiguous (multi-match) locators skipped, not guessed
- [ ] Target version came from the user — never invented

## Recipe

Read [`recipe.md`](recipe.md) in full before editing: input contract, Pattern A (literal), Pattern B (property), multi-module caveat, editing strategy.

## Handoff

The skill never commits. See [`../references/git-workflow.md`](../references/git-workflow.md) for git vs in-place handoff and the suggested commit message.
