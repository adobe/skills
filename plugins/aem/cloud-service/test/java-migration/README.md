# Java migration regression and acceptance checks

These fixtures and tests are original, synthetic contribution assets. The XML
fixture is **not** a redistributable real-build AEM acceptance project. Do not
mistake its pinned SDK declaration for a tested SDK/runtime combination.

## Fast, credential-free coverage

From the contribution root:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s plugins/aem/cloud-service/test/java-migration -p 'test_*.py' -v
npm run validate
node scripts/check-release-configs.mjs
git diff --check
```

CI runs the Python suite only when this skill, its tests, or the scoped workflow
changes. Python 3.10+ and Git suffice; no Maven downloads, JDK installs, agents,
deployment, credentials or paid evaluation are performed by the fast suite.

`test_poms.py` checks resulting XML/content, preservation of untouched bytes,
nested plugin versions, module/profile compiler settings, shared properties,
CDATA, namespaces, append attributes, classifiers, FileVault, errors, workspace
boundaries and byte-idempotency.

`test_workflow.py` is an executable **simulated workflow scenario runner**. It
injects fake JDK discovery and fake Maven/recipe execution against disposable Git
projects. It exercises sources 8/11/17/21, source 25 skip, missing source/target
JDKs, gates, preflight/refusal, command failures, partial reports and unique logs.
It also runs a real failing subprocess to check exit-code propagation.
It does **not** exercise an LLM agent, upstream recipe transformations, real JVM
parsing, or AEM tests. Test output and fake test reports are not integration evidence.

## Real migration acceptance procedure

Use fresh, clean, disposable copies of approved multi-module AEM projects for each
source (8/11/17/21). Record fixture repository/commit and SDK/analyser version;
do not commit customer code, large builds, credentials or generated logs here.
Provide the corresponding source JDK, parsing runtime and JDK 25; verify Java and
Maven after each switch. Use the project's supported Maven version/profiles.

The installed runner is the executable scenario entry point:

```bash
python3 "$SKILL_ROOT/scripts/run_migration.py" "$PROJECT" --target 25 --evaluation
# Review preflight and licenses; only after approval:
python3 "$SKILL_ROOT/scripts/run_migration.py" "$PROJECT" --target 25 --evaluation --approve
```

For each source record baseline build/test results, command/log evidence, recipe
and deterministic diffs, final JDK 25 build results, effective compiler settings
for every module/profile, actual Surefire/Failsafe counts and bundle/analyser
inspection. Verify no added skip flags, JavaSE-21 downgrade or unrelated edits.
Reinvoke after success and compare against the **post-migration** state: skip
must make no additional project edits. Inspect real serializable source to ensure
exactly one `@Serial` annotation per applicable member; wrappers alone do not prove
upstream recipe idempotency.

For missing-target coverage, use an environment with no discoverable JDK 25:
unsetting `JAVA25_HOME` alone is not enough. Expect exit 3, explicit skipped
target/Mockito stages and unvalidated edits. Install JDK 25 and explicitly resume
those stages; source-relative skip cannot validate an incomplete previous run.
For missing-source coverage remove/disallow **all** discovery routes for that
source JDK and verify zero migration changes.

Induce a baseline failure and separate recipe/final-build failures in disposable
projects. Check exit status, per-run logs, partial diffs and mandatory report.
Try unsupported target 21, disabled target in a disposable installed skill copy,
non-AEM input, existing dirty files, and parallel runs on **different** projects.

## Installed-agent checks (separate from script scenarios)

Use a supported agent's documented local plugin install. For Claude Code, run
`claude --plugin-dir /absolute/path/to/plugins/aem/cloud-service` from a separate
disposable AEM project. Record the agent version and actual loaded skill path.
Do not install an internal orchestrator or export `AGENT_SKILL_DIR`.

Exercise these prompts and inspect the actual transcript/diff:

| Prompt/case | Required behavior |
|---|---|
| "Evaluate upgrading this AEM Cloud Service project from Java 21 to Java 25" | Select this skill, explain gate, preflight, obtain approval, proceed |
| "Upgrade Java in this AEM project" | Ask target; do not silently select 21 |
| "Migrate AEM 6.5 to Cloud Service" | Select platform migration, not this skill |
| Refuse the proposed migration | No builds, recipes or project edits |
| Source already 25 | Skip, no new edits; never claim previous partial edits validated |
| Missing source JDK | Stop before migration and name the prerequisite |
| Missing target JDK | Report unvalidated edits and skipped target/Mockito stages |
| Command failure | Show failure details and mandatory partial report |

This plugin has no new Tessl eval integration. Do not claim that JSON scenarios
enable it. The existing Tessl review workflow currently requires **80%**, despite
older contributor prose mentioning 50%. With approved tooling/authentication,
run `tessl review run <skill-directory> --workspace adobe --json --threshold 80`.
Do not send private assets or customer projects to external review services.

## Acceptance matrix

Fill with evidence from **actual** executions, not inferred capability:

| Check | Current contribution status | Prerequisite |
|---|---|---|
| Deterministic XML/workflow tests | Run the fast suite above | Python 3.10+, Git |
| Skill structure/references | Run repository validation and resource tests | Repository dependencies |
| Installed-agent selection/approval | BLOCKED until executed | Installed supported agent and disposable AEM project |
| Java 8 → 25 real AEM build | BLOCKED until executed | Approved fixture, source/parsing/target JDKs |
| Java 11 → 25 real AEM build | BLOCKED until executed | Same |
| Java 17 → 25 real AEM build | BLOCKED until executed | Same |
| Java 21 → 25 real AEM build | BLOCKED until executed | Same |
| Actual recipe annotation/idempotency | BLOCKED until executed | Real recipe execution and source inspection |
| Tessl review ≥80% | BLOCKED until executed | Approved Tessl tooling/token |
| Cloud Manager | BLOCKED | Documented Java 25 support, non-production project and separate approval |
| SDK/runtime deployment and smoke tests | BLOCKED | Supported exact SDK/runtime, environment and separate approval |

The skill is evaluation-only until platform support and this matrix justify a
different claim. Do not run a pipeline or deploy to fill a row without approval.
