# Recipe - AEM Java 25 migration

> Read this fully before editing. Control plane: [SKILL.md](SKILL.md).

1. Resolve the project and requested target. Do not supply a default target.
   Load [target metadata](configs/targets.json); unsupported/disabled targets
   stop before edits. Explain the evaluation-only platform gate.
2. Inspect Git state, project scope, effective compiler versions, active profiles,
   toolchains, `.mvn/` configuration, and test/build commands. The automated runner
   uses `mvn clean verify`; if the project needs special profiles, first document
   and obtain approval for a manual execution using the same ordered gates.
   Never pass ad hoc test-skipping or validation-disabling flags.
3. Run preflight without `--approve`. It returns source, discovered JDKs,
   compatibility warnings and blocked external checks. It does not execute Maven.
   Review its results with the user and obtain approval for evaluation, external
   recipe license terms and project execution before rerunning with `--approve`.
4. Skip only when **source >= requested target**. In mixed reactors the runner
   uses the lowest declared compiler setting for the skip decision and the highest
   for the baseline JDK (so a lower-level child does not force an insufficient
   compiler for its parent). Inspect effective settings and active profiles too.
   A skip is not a claim that a previously partial migration was validated.
5. Build/test the unchanged project under its source JDK. Stop if the baseline
   fails and report it as an existing failure, not migration damage.
6. Run the Java recipe with the verified OpenRewrite runtime; each intermediate
   Java step is reached through the single upstream Java 25 chain. Do not invoke
   additional intermediate chains or `AddSerialAnnotation` separately.
7. Reparse all reactor POMs and plan compiler/plugin/dependency/classifier/FileVault
   changes. Validate candidate XML for every module before writing deterministic
   changes. Set `.cloudmanager/java-version` to `25` for evaluation only.
8. If JDK 25 is absent, skip all remaining stages and report **changes applied,
   not locally validated** with exit 3. Install JDK 25 and explicitly resume the
   unperformed stages after inspecting the partial diff; rerunning the whole
   runner may now skip because the POM already says 25.
9. With JDK 25: run `mvn test`, Mockito migration, then `mvn clean verify`.
   Inspect test reports to prove expected tests actually ran; check bundle
   manifests and analyser results. A build exit code alone is not acceptance.
10. Review the diff, changed modules, unrelated content, test counts, warnings
    and logs. Apply only bounded repairs from [constraints](references/build-fix-constraints.md).
    Preserve failed command exit codes; the runner never retries silently.

## Mandatory final report

The runner writes `report.json` even for blocked/failed/skipped migrations and
prints its content. Return a human-readable report directly to the user with:

- Project, detected source, explicit target, JDK/Maven versions and log location.
- Changed files and meaningful recipe, compiler, dependency and package changes.
- Each operation's passed/failed/skipped result and useful error/log details.
- Baseline failures distinguished from migration-introduced failures.
- Actual test counts, any disabled tests, analyser/artifact inspection results.
- Every unvalidated path and manual prerequisite, especially target JDK and
  SDK/runtime/Cloud Manager support.

Report external checks as **BLOCKED**, not passed: installed-agent behavior,
real source-version builds, Cloud Manager, deployment, runtime smoke tests.
Mark one passed only after independent evidence exists. Keep logs private and
sanitize them before sharing; Maven can print user-specific repository details.
