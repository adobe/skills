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

## Invocation and contract

Applies to project-wide Java upgrades in an AEM Cloud Service Maven reactor with
a declared `com.adobe.aem:aem-sdk-api` dependency. It is not a code-assessment
pattern. Ask for an ambiguous target; never silently substitute Java 21.

Resolve `SKILL_ROOT` from this installed file, not `AGENT_SKILL_DIR` or the
project checkout. Resolve `PROJECT` only within the active workspace or a
user-named path; do not search elsewhere. Use a disposable clean project copy
when existing edits conflict. Target rules come from [targets.json](configs/targets.json).

Before execution read [recipe.md](recipe.md), [POM rules](references/pom-manipulation-rules.md)
and [repair constraints](references/build-fix-constraints.md). Inspect effective
compiler profiles/toolchains rather than assuming raw POM values are effective.
Present evaluation limits, JDKs, proposed changes and external recipe licenses;
obtain explicit approval before builds, recipes or edits.

```bash
python3 "$SKILL_ROOT/scripts/run_migration.py" "$PROJECT" --target 25 --evaluation
# Only after the user approves the preflight proposal:
python3 "$SKILL_ROOT/scripts/run_migration.py" "$PROJECT" --target 25 --evaluation --approve
```

## Hard gates

- Source 21 to 25 must proceed; source >=25 skips without edits. A skip does not
  validate a previous partial run. Source 8/11/17/21 paths remain unvalidated candidates.
- Missing source JDK stops migration. Missing target JDK permits applicable edits
  but skips target builds/Mockito: report **changes applied, not locally validated**.
- Never disable tests/validators, blindly add Byte Buddy experimental flags,
  declare JavaSE-21 for Java 25 bytecode, or convert Servlet namespaces.
- Do not clone, commit, push, create branches/PRs, deploy or run pipelines without
  separate authorization. This workflow does none of those automatically.
- Always return the report, including failures/skips, nonzero exits and blocked
  checks. Per-run JSON/logs are not runtime evidence. Lost baseline tests are
  unvalidated, not success.

See [README](README.md) for structure, [OpenRewrite commands](references/openrewrite-commands.md)
for execution details, and [version policy](references/version-pins.md) for intentional pins.
