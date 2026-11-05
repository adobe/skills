---
name: java-migration
description: |
  [BETA] Evaluates upgrading AEM as a Cloud Service Maven projects to Java 25 with
  OpenRewrite, compiler/plugin/dependency updates, Mockito migration, and build reports.
  Use for explicit JDK/Java 25 upgrade requests, including Java 21 to 25; not for
  general AEM platform migration, non-AEM Java, or Jakarta namespace conversion.
  This skill is in beta. Verify all outputs before applying them to production projects.
license: Apache-2.0
metadata:
  status: beta
compatibility: Requires Git, Python 3.10+, Maven, source JDK, OpenRewrite runtime JDK 17+, and network access to Maven repositories. JDK 25 is required for target builds and Mockito. macOS and Linux JDK discovery; configured homes supported.
---

# AEM Java 25 migration

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

**Evaluation only, not production-ready.** Adobe's documented Cloud Manager build
selector accepts Java 17/21 and ignores other values. Java 25 runtime rollout is
described as upcoming. Writing `25` does not enable Cloud Manager support. Read
[prerequisites](references/prerequisites.md) before proposing changes.

## Direct invocation

Examples: "Evaluate upgrading this AEM Cloud Service project to Java 25" or
"Migrate my AEM Maven project from Java 21 to Java 25 in a disposable checkout."
For an ambiguous Java upgrade request, ask for the target; never substitute 21.
For an AEM 6.5/AMS platform migration, use the separate `migration` skill.

Resolve the installed directory containing **this** `SKILL.md` as `SKILL_ROOT`.
Use its absolute resource paths; do not assume the project contains this repository
or that `AGENT_SKILL_DIR` is set. Resolve `PROJECT` to the active AEM project or the
user's explicitly named path. Never search outside those boundaries.

1. Read [recipe.md](recipe.md) fully, including approval,
   source-relative skip, missing-JDK handling, and reporting.
2. Read [POM rules](references/pom-manipulation-rules.md) and
   [build-fix constraints](references/build-fix-constraints.md).
3. Inspect the chosen project, its Git changes, effective compiler settings
   (including active profiles/toolchains), prerequisites and compatibility.
   The runner requires an explicit `com.adobe.aem:aem-sdk-api` dependency and a
   clean project scope; use a disposable checkout if the user has existing edits.
4. Present the evaluation limitations, third-party recipe licenses, files/settings
   to change, source and target JDKs, planned commands, and any blocked coverage.
   Obtain explicit approval **before** running builds, recipes, or edits.
5. Run the preflight, then the approved execution as described below. An approval
   of preflight alone does not grant deployment, pipeline, or Git publishing rights.
6. Always deliver the final report, including on failure or skip.

```bash
# SKILL_ROOT and PROJECT are absolute paths resolved by the agent, not harness variables.
python3 "$SKILL_ROOT/scripts/run_migration.py" "$PROJECT" --target 25 --evaluation
# Only after the user approves the proposal:
python3 "$SKILL_ROOT/scripts/run_migration.py" "$PROJECT" --target 25 --evaluation --approve
```

The runner does not clone, commit, push, create branches/PRs, deploy, or start
pipelines. It uses no entitlement, internal service, MCP server, or orchestrator.
Recipe execution requires the user's acceptance of the external recipe licenses;
the Apache license on this skill does not relicense those artifacts.

## Classification and discovery

This skill applies to a project-wide Java-version upgrade in an AEM as a Cloud
Service Maven reactor with a declared `com.adobe.aem:aem-sdk-api` dependency.
It does not consume code-assessment findings or register an analyzer pattern.

Discovery is read-only preflight: follow declared modules, resolve compiler
settings, inspect Git state, and verify JDK homes. No repository clone, parent
directory search, Maven build, or project edit is part of this preflight.
If compiler settings are controlled externally, inspect the effective POM with
the user's approval rather than guessing a source version.

## Resolution contract

**User-supplied target, configuration-driven transforms.** The request must name
Java 25; an ambiguous request requires clarification. Target availability, pins,
recipe identity and compatibility limits come from
[targets.json](configs/targets.json), not a silent default or an unpinned latest
release. The runner resolves the live project again before applying changes.

## Required outcomes

- Source 8/11/17/21 to target 25: candidate evaluation paths, **not a validated
  AEM acceptance matrix**. Source 21 must proceed. Source >=25 skips without edits.
- Missing source JDK: stop before migration. Missing target JDK: perform applicable
  edits with a verified parsing JDK, skip target builds and Mockito, explicitly
  report **changes applied, not locally validated** (exit 3).
- Never downgrade bundle execution requirements to JavaSE-21 while emitting
  Java 25 bytecode, disable tests/validators, add experimental flags blindly,
  or equate a successful compile with supported AEM runtime behavior.
- `report.json` and individual command logs live in a unique per-run temporary
  directory whose path is returned. Preserve errors and nonzero exit codes.

## Review checklist

- [ ] Correct project and explicit target confirmed; evaluation limitations accepted.
- [ ] Source compiler levels, source/parsing/target JDKs and Maven verified.
- [ ] Preflight reviewed and user approval obtained before execution or edits.
- [ ] Source baseline passed; existing failures were not masked by skipping tests.
- [ ] Recipe and scoped POM diffs preserve unrelated settings and user content.
- [ ] Final JDK 25 verification includes actual test-report counts.
- [ ] Every failure, skipped stage and blocked external check appears in the report.
- [ ] No deployment, pipeline, publishing or production-readiness claim is implied.

## Resources

- [README](README.md): scope, structure and direct invocation.
- [Target metadata](configs/targets.json): availability, pins, JDK lookup and gate.
- [OpenRewrite commands](references/openrewrite-commands.md): recipes and pins.
- Regression and scenario procedure: `test/java-migration/README.md` in the
  contribution's Cloud Service plugin (not required in an installed skill).
