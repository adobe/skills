# Branch J — Cloud Manager code-quality readiness

Check and fix a migrated project **before** it reaches a Cloud Manager pipeline, so the Code Quality step does not fail. A green local build with passing unit tests proves neither of the two results that most often fail migrated projects:

- **Reliability rating.** This is a Critical category: the pipeline fails when the rating is below D, and the failure **cannot be overridden**. A single **Blocker** bug is enough.
- **Coverage.** This is an Important category: the pipeline pauses below **50%**. Only a full-stack pipeline lets a manager override the pause; a code-quality-only pipeline cannot.

Paths that start with `scripts/` are relative to the migration skill directory, the folder of `SKILL.md`. This branch never pushes, never runs a Cloud Manager pipeline, and never changes Cloud Manager settings.

## Where the checks run

The developer never runs "Branch J" as a separate stream. It is one engine, `scripts/cm-quality-precheck.js`, used at the three moments of the migration:

| Moment | What runs | Cost | Decides |
|---|---|---|---|
| **Assess** — Step 0 runbook | The static precheck, inside `runbook-generator.js` | Seconds, no build | Nothing. It records the **baseline** (`cmReadiness` in `migration-runbook.json`) and puts the pre-flight items first in the runbook |
| **Fix** — end of each pattern session (Step 6) | The static precheck **against the baseline** | Under a second | Only what this session **added**. Inherited findings are reported, not blamed on the session |
| **Prove** — *"Am I ready to push to Cloud Manager?"* | The static precheck, then a Cloud Manager-equivalent build with coverage | One full build, after asking | The go/no-go before a push, inherited findings included |

Separating inherited debt from new regressions is the point of the baseline. The gate scores the whole codebase, so a pattern session must never end up owning legacy test debt; that debt is a planned runbook item instead.

## Assess: the runbook's readiness section

Step 0 writes a **Cloud Manager readiness** section above the patterns, with up to three items:

- **Pre-flight.** Tooling that zeroes coverage (`argLine`, JaCoCo version, test skips).
- **Reliability Blockers already in the code.**
- **Coverage debt.** Modules with main code and no tests.

The runbook's prompts for the first two (*"Fix the Cloud Manager pre-flight items from the migration runbook"*, *"Fix the reliability Blockers listed in the migration runbook"*) come here: run the static precheck again (the baseline may be stale), then apply layers 1 and 2 of [Fix, in this order](#3-fix-in-this-order). Fix pre-flight items **before** the first pattern: until they are fixed, no coverage figure means anything.

## Fix: the end-of-session delta

At the end of each pattern session (SKILL.md Step 6):

```bash
node scripts/cm-quality-precheck.js <projectRoot> --baseline ./migration-runbook.json
```

Without a runbook cache, use `--base origin/main` instead; it marks changed files, but it cannot tell old from new.

- **New gate finding** (status `fail`, exit `1`): this session introduced it, almost always while rewriting the pattern's code. Fix it before closing the session, and re-run the command.
- **Inherited findings**: name the count in one line and point to the runbook. Do not fix them in a pattern session (one pattern per session).
- **New production classes without a test**: list them as coverage candidates for the Prove step.

Do not run the Maven build here.

## Prove: "Am I ready to push?"

This is the go/no-go. Run it without `--baseline`, because Cloud Manager fails inherited findings too. Steps 1–4 below are the whole flow. When the user also asks to validate on the local Cloud SDK, run **Branch G** as the runtime lane and close with one summary of both lanes ([validate-migration.md](validation/validate-migration.md#before-a-push-the-cloud-manager-gate-lane)). Without a running SDK, the gate lane runs alone: say that runtime behaviour was not validated.

## What Cloud Manager measures

- **Build.** `mvn --batch-mode org.jacoco:jacoco-maven-plugin:prepare-agent package`, on the JDK named in `.cloudmanager/java-version`, or JDK 8 when the file is absent. Coverage therefore depends on the project's own JaCoCo version, the Surefire `argLine`, and its skip switches.
- **Coverage.** `(CT + CF + LC) / (2B + EL)` — covered branch outcomes plus covered lines, over all branch outcomes plus all executable lines. It is computed over **every module with main Java code**, legacy code included; a module without tests counts as 0%.
- **Blocker bugs** in the Cloud Manager rule set (2024.12):
  - Java: `java:S2095` (resources should be closed), `java:S2168` (double-checked locking), `java:S2276` (`Thread.sleep` while holding a lock).
  - Oak indexes: `IndexType`, `IndexAsyncProperty`, `IndexTikaNode`, `IndexDamAssetLucene`.
  - Workflows: `CloudServiceIncompatibleWorkflowProcess`.
- **Critical bugs** do not fail the gate on their own, but fix them: `BannedPath` (`/libs` in a package), `CQRules:ConnectionTimeoutMechanism`, `CQBP-84` (`@ProviderType` implemented), `java:S2222`, `java:S1143`, `java:S3518`.

## Prove workflow

### 1. Static precheck (no build, no network)

```bash
node scripts/cm-quality-precheck.js <projectRoot> --base origin/main
```

`--base` marks the files changed since that ref, so migrated code is fixed first. The script exits `1` when it predicts a gate failure and `0` otherwise. Its status is one of:

- `fail` — a gate-failing finding.
- `unverified` — no static blocker, but coverage has not been measured.
- `at-risk` — coverage is under the safety target, or a Critical finding remains.
- `ready` — nothing found.

Read the whole report: it ends with what it does **not** evaluate.

### 2. Build like Cloud Manager, then measure coverage

This step builds the whole reactor, runs the customer's unit tests, and may download dependencies. **Ask the user before running it.** Use the JDK named in `.cloudmanager/java-version`.

```bash
mvn --batch-mode clean org.jacoco:jacoco-maven-plugin:prepare-agent package org.jacoco:jacoco-maven-plugin:report
node scripts/cm-quality-precheck.js <projectRoot> --coverage --base origin/main
```

- Never add `-DskipTests`, `-Dmaven.test.skip`, `-Djacoco.skip` or `-q`.
- If the build fails, stop: that is a build problem, not a gate result. Hand it to the branch that owns the failing code.
- The coverage figure is an estimate: modules without a JaCoCo report are estimated from their sources. The default target is **55%**, a margin over the 50% gate.

### 3. Fix, in this order

Each layer can change the result of the next, so do not reorder them.

1. **Tooling that zeroes coverage** (`argline-drops-jacoco-agent`, `jacoco-too-old`, `tests-skipped`, `jacoco-skipped`, `jacoco-agent-not-attached`). These are mechanical POM edits; apply the `Fix:` the report gives and show the diff.
   - Use `@{argLine}`, never `${argLine}`, and keep an empty `<argLine></argLine>` property.
   - Changing `.cloudmanager/java-version` changes the build and runtime JDK: ask first.
   - After tooling fixes, **re-run step 2**. The earlier coverage number is invalid.
2. **Blocker bugs.** The Java findings are source heuristics: open each site and confirm it before editing.
   - `java:S2095`: open the resource in a try-with-resources header.
     - Never close a stream the method did not open; that closes the caller's stream.
     - A resource that must outlive the method (returned, or stored in a field) is a false positive. Leave it and say so.
   - `java:S2276`: sleep outside the lock, or `lock.wait(timeout)`. In a migrated job, use a Sling Job retry instead of sleeping.
   - `java:S2168`: make the field `volatile`, or use a holder class.
   - Oak index findings belong to **Branch F** ([oak-index.md](oak-index.md)). `CloudServiceIncompatibleWorkflowProcess` belongs to **Branch H**. `BannedPath` needs the user's decision on where the `/apps` overlay goes.
   - Suppress a finding only when it is a confirmed false positive, with `@SuppressWarnings("java:S2095")` on the member (never on the class) and a one-line reason.
3. **Coverage gap.** Only after layers 1 and 2, and a fresh measurement.
   - Work through the report's ranked classes: changed classes first, then the most missed lines and branches.
   - Process **five classes per batch**, re-measure, report, and stop when the target is met.
   - Write tests that assert observable behaviour. Match the module's test stack (JUnit 4 or 5, Mockito, `AemContext`) as [characterization-tests.md](characterization-tests.md) rule 2 describes.
   - Give a failing new test one fix. If it still fails, delete it and record `test-skip: <class> <reason>`; never debug in a loop.
   - Do not refactor production code to make it testable. Skip the class and say so.
4. **Re-run step 1**, and step 2 if coverage was in scope, until the status is `ready` or `at-risk`.

**Never pass the gate by hiding code or tests.** Do not add JaCoCo `excludes` or `sonar.coverage.exclusions`. Do not add `@Ignore`/`@Disabled` or `testFailureIgnore`. Do not write assertion-free tests, delete production code, or skip tests in a profile Cloud Manager activates.

### 4. Report

Save the final precheck output with `--out .validate-migration/cm-gate-<YYYYMMDD-HHMM>.md`, next to Branch G's reports, and give:

- the status, and the coverage before and after (both estimates);
- each finding that was fixed, confirmed false, or left to its owning branch;
- every `test-skip`;
- the report's "Not evaluated locally" list;
- with Branch G: one line per lane (runtime, Cloud Manager gate). Without it: "runtime behaviour not validated".

Say the project is *predicted* to pass the reliability and coverage gates. Never say Cloud Manager will pass: the Security and Maintainability ratings and most of the rule set are not evaluated here. After inherited items are fixed, suggest regenerating the runbook (Step 0) so the baseline is current.

## Gate-safe code (every branch that writes Java)

Use this checklist while you apply any Java pattern, so the gate is never the first to see the problem:

- Open every stream, reader, writer or file the new code creates in try-with-resources. Close only what the code opened.
- Close the `ResourceResolver` the code obtains (try-with-resources).
- Never `Thread.sleep` inside `synchronized`. No double-checked locking without `volatile`.
- Give HTTP clients connect and socket timeouts: [`{code-assessment}/outbound-call-timeouts`](../../code-assessment/outbound-call-timeouts/guide.md).
- Do not implement or extend `@ProviderType` product APIs.
- A new production class (a `JobConsumer`, a cache holder) is uncovered unless a test runs it. If the pinned characterization test does not, name the class in the Step 6 report as a coverage candidate for the Prove step.
