---
name: inject-in-sling-model
description: |
  [BETA] AEM Cloud Service expert skill — migrate javax.inject.@Inject fields in Sling Model (@Model) classes to injector-specific annotations (@ValueMapValue / @OSGiService / @SlingObject). Self-discoverable (scan for @Model classes with field-level @Inject); the replacement is chosen deterministically from each field's declared type. Use for "fix @Inject in HeroModel.java", "modernize my Sling Models", or when scanning an AEM project for @Inject misuse. Detailed decision table, companion-annotation handling, import management, and file-level skip policy are in recipe.md.
  This skill is in beta. Verify all outputs before applying them to production projects.
metadata:
  status: beta
license: Apache-2.0
---

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

# @Inject in Sling Models — AEM as a Cloud Service

> This pattern is executed by the code-assessment runbook — follow [`../references/runbook.md`](../references/runbook.md) for the full flow (preflight → plan → apply → verify, run log). This skill supplies the detection + recipe the runbook applies.

## Overview

`javax.inject.@Inject` on fields of `@Model` classes is discouraged by the Apache Sling Models documentation. Removing `@Inject` without a replacement breaks injection, so each field is migrated to an injector-specific annotation chosen from its declared type.

## Classification — confirm this pattern applies

- A `*.java` file whose class is annotated `@Model`, with at least one **field** annotated `@Inject`.
- Constructor-parameter and setter-method `@Inject` are out of scope (trigger the file-level skip).

## Discovery

Detection is performed by the analyzer ([`../scripts/analyze.sh`](../scripts/README.md)), run by
the runbook:

```bash
bash ../scripts/analyze.sh <workspace-root> --pattern inject-in-sling-model
```

**Match criteria (what the detector flags):** a class annotated `@Model`
(`org.apache.sling.models.annotations.Model`, confirmed import-aware) with at least one **field**
annotated `@Inject` (`javax.inject.Inject` or `jakarta.inject.Inject`). One finding per matching
field. Constructor/setter `@Inject` and non-`@Model` classes are not flagged. The replacement
annotation is chosen from the field's declared type by the decision table in `recipe.md`.

## Resolution contract

**self-evident** — the replacement annotation is fully determined by the field's declared Java type via the decision table in `recipe.md`. No external input is required.

## Review checklist

- [ ] Each migrated field maps to exactly one injector-specific annotation per the decision table
- [ ] Sling objects (`Resource` / `ResourceResolver` / request / response) → `@SlingObject`, **not** `@Self`
- [ ] `@Named` merged into the new annotation's `name`; `@Default` / `@Via` preserved
- [ ] `@Optional` → per-field `injectionStrategy = InjectionStrategy.OPTIONAL` (**never** a class-level `defaultInjectionStrategy` change)
- [ ] Unused imports removed; new imports added and ordered per the file's convention
- [ ] File-level skip respected — no partial migration of a file with any ambiguous field

## Recipe

Read [`recipe.md`](recipe.md) in full before editing: input contract, decision table, companion annotations, import management, unlocatable / skip-file policy, per-file procedure, before/after example, editing strategy.

## Handoff

The skill never commits. See [`../references/git-workflow.md`](../references/git-workflow.md) for git vs in-place handoff and the suggested commit message.
