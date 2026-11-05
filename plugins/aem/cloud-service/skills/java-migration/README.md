# java-migration

Standalone, beta **Java 25 evaluation** for AEM as a Cloud Service Maven projects.
This is a sibling of platform migration and code assessment, not an analyzer
pattern or a dependency on either skill's runbook.

**Not production-ready:** documented Cloud Manager build selection currently
accepts Java 17/21 and ignores other values. Java 25 SDK/runtime support and real
source-to-target acceptance remain separate checks. Read
[prerequisites](references/prerequisites.md) before execution.

## How it works

| Phase | Behavior |
|---|---|
| Preflight | Resolve the requested target, declared reactor/compiler settings, clean project scope and verified JDK homes; no Maven execution or project edits |
| Approval | Present the evaluation limits, planned commands/changes and external recipe licenses; obtain explicit user approval |
| Baseline | Build and test under the source JDK; stop on existing failures |
| Migration | Invoke the pinned Java recipe once, then scoped compiler/plugin/dependency/classifier/FileVault edits and the proposed Cloud Manager selector |
| Verification | With JDK 25, run tests, Mockito migration and final verification; inspect actual test-report counts |
| Report | Return each passed/failed/skipped operation, errors, changed files, logs, blocked checks and manual prerequisites |

Without the source JDK the migration stops. Without the target JDK, applicable
edits can proceed but target builds and Mockito are explicitly skipped and
reported as **changes applied, not locally validated**. No test-skipping,
JavaSE-21 bytecode workaround, deployment or automatic Git publishing is added.

## Structure

```text
java-migration/
  SKILL.md       # selection, classification, contracts and review checklist
  README.md      # scope, structure and invocation
  recipe.md      # ordered execution and reporting procedure
  configs/       # explicit target metadata and scoped transformation rules
  recipes/       # wrappers invoking upstream Java and Mockito chains
  scripts/       # preflight/workflow runner and deterministic POM helpers
  references/    # prerequisites, commands, POM rules and repair constraints
```

## Direct invocation

Install the existing `aem-cloud-service` plugin and ask:
"Evaluate upgrading this AEM Cloud Service project from Java 21 to Java 25."
The agent resolves the installed skill directory and the chosen project; no
internal harness variable or orchestrator is required.

```bash
# Absolute paths resolved by the agent:
python3 "$SKILL_ROOT/scripts/run_migration.py" "$PROJECT" --target 25 --evaluation
# Only after approval:
python3 "$SKILL_ROOT/scripts/run_migration.py" "$PROJECT" --target 25 --evaluation --approve
```

The runner emits JSON and writes `report.json` plus stage logs in a unique per-run
directory. See [recipe.md](recipe.md) for the complete procedure.

Requirements: Python 3.10+, Git, Maven, the source JDK, a JDK 17+ recipe runtime,
and access to approved Maven repositories. JDK 25 is required for target
verification. External recipe artifacts retain their own licenses.

Regression fixtures, executable simulated workflow scenarios, and the real-build
acceptance procedure live in the contribution's
`plugins/aem/cloud-service/test/java-migration/` directory. They do not turn
unperformed agent, JDK, SDK, pipeline or runtime checks into passes.
