---
name: validate-migration
description: |
  [BETA] Use when asked to validate a migration, smoke-test a branch, check a
  scheduler fix on the Cloud SDK, compare static and editable template pages, or verify supported code changes after the
  migration or code-assessment skill. This skill is in beta. Verify all outputs
  before applying them to production projects.
license: Apache-2.0
metadata:
  status: beta
  author: AEM Cloud Service Team
  version: "0.3"
  aem_version: "Cloud Service"
---

# validate-migration

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

Verify migrated code on a local Cloud SDK without modifying customer code.
Completion requires a saved report AND an accepted outcome submission, not just
a successful build or an emitted payload. Restricted passes retain their caveats.

## Scope and paths

Use `scheduler`, `asset-manager`, `event-migration`, `resource-change-listener`,
`replication`, `legacy-ui`, `custom-templates`, or explicit `cdw`. Do not use this
skill for dispatcher, unsupported-runmodes or filevault-deps. Fixes belong to `migration`.

This skill is the orchestrator: it runs the shared workflow below and, for each
pattern in scope, that pattern's check (`validate-migration/check/patterns/`).
When a pattern has a reference, read it before running that pattern; skip it otherwise.

| Pattern | Checks | Needs SDK + MCP | Pattern reference |
|---|---|---|---|
| `scheduler`, `asset-manager`, `event-migration`, `resource-change-listener`, `replication` | Built DS contract, bundle/component state | Yes | none |
| `legacy-ui`, `cdw` | Dialog files in the built package | No | none |
| `custom-templates` | Offline component mapping, SDK health, side-by-side page compare | Yes | [custom-templates](references/patterns/custom-templates.md) |

The validator holds no SDK credentials and never calls the SDK console. Bundle
runtime state comes only from the AEM Quickstart MCP.

Resolve `$VALIDATOR` to the absolute path of `../../validate-migration` relative
to this file. Run commands from the customer's project/module root. For a
single Java class, retain `--pattern <pattern> --fqcn <FQCN> --project <module>`
on prepare and verify. Deployment installs the whole bundle; verification stays
class-scoped. Otherwise prepare auto-diffs `origin/main` (fallback `main`),
including staged, unstaged, and untracked changes.

## Validation boundary

Validate reusable migration contracts and deployment health, not each customer's
business implementation. Built DS descriptors establish service interfaces and
declared properties; MCP establishes bundle/component state. Neither proves
effective overridden properties, callback execution, or business correctness.
Keep `checks.migration_contract` separate from `checks.business_behavior=not_tested`
in saved reports and MCP outcomes. A restricted pass retains all unverified checks.
Old prepared state without built DS contract evidence cannot pass; rerun `prepare`
with the same pattern and class scope before diagnosis and verification.

Do not invoke customer business actions, submit jobs, send email, change content,
shorten schedules, add instrumentation/test endpoints, or modify customer source
to obtain a pass. Only a pattern reference may grant narrow, approved exceptions
(for example the `custom-templates` target deployment and disposable fixtures).
Existing comparison pages remain read-only;
never overwrite or delete them. Existing customer tests may be run separately, unchanged, only
with explicit authorization and a safe test environment; never infer their result.
Before deployment, confirm the selected SDK is safe for automatic activation:
installing a bundle can start scheduled work or listeners. If isolation from
production systems and side effects cannot be established, stop and ask for safe
SDK configuration. Do not change credentials or SDK configuration without approval.

## Workflow

1. **Readiness.** Confirm `diagnose-osgi-bundle` (bundle-runtime patterns) and
  `submit-migration-validation-result` are available before building. Confirm the reporting
   server's CAM URL configuration and intended environment when inspectable;
   tool availability alone does not prove configuration readiness. Never probe
  reporting by sending a fabricated outcome. Load the actual project ID from the
  nearest `migration-runbook.json` (`project.id`), or use an explicit project
  flag. Explicit selection wins. If absent, ask once for the CAM project name;
  never guess or assume a context file is consumed.
Only skip submission when the user explicitly asks for local-only
    validation; state that end-to-end reporting remains incomplete.

    **Setup (always first, before any comparison).** Ask the user to export their
    logins in the shell (`AEM_TARGET_AUTH` for the Cloud SDK, `AEM_SOURCE_AUTH` for
    AEM 6.5, as `user:password`); never ask for them in chat. Then run
    `node "$VALIDATOR/init.js" --search <workspace>` from the project root. It reads
    each local instance's About page (`2026.x` = Cloud SDK, `6.5.x` = AEM 6.5),
    checks the SDK, its AEM Quickstart MCP server, the editor MCP config and the
    Quickstart, and saves the URLs to `.validate-migration/setup.json`; later
    `check.js` runs reuse that SDK. Only items needed by the changed patterns block:
    runtime patterns need SDK + MCP, `custom-templates` also needs AEM 6.5,
    `legacy-ui`/`cdw` need none. Show the detected roles once and let the user
    correct them with `--sdk <url>` / `--quickstart <url>`.
    Fix each ✗ item, then rerun until it prints `setup ready`:
    - SDK not found: ask for the absolute SDK directory and rerun with
      `--search "<dir>"` (the JAR may sit outside the workspace; do not scan the
      machine). Confirm before booting an external JAR; give download guidance
      only after the user confirms no local SDK exists.
    - MCP package missing on the SDK: offer to install
      `com.adobe.aem:com.adobe.aem.mcp-server-contribs-content` from Maven Central
      via Package Manager (`/crx/packmgr`), only after approval, picking the release
      the [supported-versions table](https://github.com/adobe/cq-quickstart-mcp-server#supported-versions)
      lists for this SDK (ask if none is listed) and verifying its `.sha1` first.
    - MCP not in the editor: with approval, rerun with `--setup-mcp`; it adds
      `<sdk>/bin/mcp` to the VS Code user `mcp.json` with a prompted password input
      (no credential stored). Other assistants: ask the user to add it. Then
      confirm your own session lists `diagnose-osgi-bundle`.
    For a pattern with a reference, also run that reference's readiness checks.
    Never skip deployment or diagnosis when setup fails.

2. **Prepare.** Run `node "$VALIDATOR/check.js" --stage prepare` with the selected
  scope/project/SDK flags. It builds, discovers, deploys bundle-runtime patterns
  through the project's Maven install profile, and saves `.validate-migration/state.json`.
   A pattern reference may add steps between prepare and verify; follow it.
   The build uses `-DskipTests`; do not claim customer unit tests passed.
3. **Diagnose.** For each emitted BSN, call MCP `diagnose-osgi-bundle` with
   `{ "bundleSymbolicName": "<BSN>" }` against the SAME SDK. Save the exact returned report in
   `.validate-migration/diagnosis-map.json` as `{ "<BSN>": "<raw report>" }`.
  If unavailable, stop recovery and follow the missing-diagnosis path below.
  Never substitute direct Felix calls. Pattern references that deploy bundles use
  this same diagnosis.

4. **Verify.** Run `node "$VALIDATOR/check.js" --stage verify` with the same scope
  flags. It writes `.validate-migration/<run_id>.{md,json}` and emits one outcome
  payload per task (one per discovered template). A passing validation exits `3` while reporting is pending; this is
   not a code failure. Scheduler properties and Distributor registration are
   restricted when MCP cannot expose them: report exactly what remains unverified,
  including scheduler cluster behavior. Missing diagnosis is `setup.mcp_unavailable`.
  Before treating a runtime failure as final, follow **Bounded runtime recovery**
  below. The skill coordinates recovery; the validator does not poll the SDK.

5. **Submit.** Forward the emitted `submit-migration-validation-result` payload through MCP
   once on the final verification attempt, including failed validation outcomes.
   Require `ok: true` and a matching `run_id` before saying "outcome recorded".
  Save only the actual response's `ok`, `run_id`, `stored_at`, and `duplicate`
  fields as `.validate-migration/<run_id>-receipt.json`. For failures save
  `{ "ok": false, "error": "<credential-free summary>" }`; never persist raw
  sensitive error text. Never fabricate an acknowledgement. Missing CAM config,
   rejection, or network failure leaves reporting incomplete; do not silently retry.

6. **Finalize.** Run the command below even after submission fails, using the
   saved validation JSON and actual MCP receipt. It updates both reports with
   reporting status, errors, and restrictions. A backend outcome acknowledgement
   confirms acceptance/persistence, NOT separate downstream event delivery; leave
   that unconfirmed unless there is explicit delivery evidence.

```bash
node "$VALIDATOR/check.js" --stage finalize --project <project> \
  --report <project>/.validate-migration/<run_id>.json \
  --receipt <project>/.validate-migration/<run_id>-receipt.json
```

## Bounded runtime recovery

Recovery uses the AEM SDK diagnosis MCP, not outcome-reporting retries. Keep the
same SDK, project/module, pattern, and class filters throughout the original scope.
Unrelated out-of-scope component errors do not fail a scoped validation or trigger
repair unless evidence proves they block a selected class's required dependency.

1. **Activation checks.** For `runtime.bundle_not_active` without a diagnosed code
  blocker, use at most 3 diagnosis checks total per affected BSN per deployment,
  counting the initial check. Between checks, wait 5 seconds, then obtain a
  fresh `diagnose-osgi-bundle` report from the SAME SDK.
  In the map, replace the affected BSN's entry in `diagnosis-map.json` with the
  exact new report, preserve other BSNs, and rerun `--stage verify` with the
  same flags and prepared state. Do not rebuild or redeploy during activation checks.
  Stop waiting as soon as the bundle is Active, or diagnosis identifies a blocker;
  an Active bundle still needs successful component and migration-contract checks.

2. **Analyze and repair.** If activation checks are exhausted, or another runtime
  check fails, inspect MCP bundle/component/log evidence for
  unresolved imports, missing services, or activation exceptions. Permit
  at most one repair cycle for the entire validation invocation, not per class.
  `migration` owns customer source changes: hand it the diagnosis, failed class,
  original scope, and failure evidence. Proceed only with a clear, minimal fix
  within the authorized migration scope. Do not edit source in `validate-migration`,
  guess dependencies, change credentials, broaden scope, or invoke business actions.
  For unclear causes, out-of-scope fixes, or unavailable migration/diagnosis tools,
  stop recovery with the blocker; stop recovery immediately on `setup.mcp_unavailable`.
  If diagnosis becomes unavailable after prepare, remove affected BSN entries
  from the map and rerun verify to produce a final missing-diagnosis outcome;
  never reuse stale evidence. Continue the normal final steps with that outcome.
  If unavailable before prepare, stop with setup guidance without fabricating a run.

3. **Revalidate.** After migration repairs source, recheck deployment safety and
  any affected existing customer tests BEFORE rerunning `--stage prepare` to build
  and deploy the changed artifact through the same Maven profile. A `-DskipTests`
  build is not test evidence. Regenerate diagnosis from this deployment, then rerun verify.
  The new deployment has the same activation-check limit, but no second repair
  cycle. Never verify repaired source using the old artifact or diagnosis.

4. **Keep evidence and finish.** Save credential-free attempt summaries in
  `.validate-migration/recovery.md`: original failure, diagnosis-check counts,
  repair and rationale, each report's run_id, final result, and restrictions.
  Preserve earlier reports; do not overwrite them as though the failure never
  happened. Finish recovery before submission; only the payload and run_id from
  the final verification attempt proceed to Submit and Finalize. Do not submit
  intermediate attempts. If recovery still fails, explain the remaining cause
  and next action rather than starting another loop.

## Completion and failures

Finalization exits `0` for validated and recorded, `1` for failed validation
with reporting recorded, `3` for reporting incomplete; `2` is usage/error.
`--stage all` also exits `3` when runtime diagnosis is still needed.

Close with the target/class count, validation result (including restrictions),
report link, and actual reporting status. Do not claim end-to-end success while
reporting is pending/failed. A local pass and failed submission are distinct.
A no-changes exit is a no-op, not evidence that code was validated.
For failures, explain the root cause and next action briefly; do not dump raw
evidence. A timeout-ending `deploy.failed` allows one deployment retry after
5 seconds. Runtime recovery follows the bounded policy above; never blindly retry
runtime/source contract failures. Source-only failures go back to `migration`
without automatic repair in this runtime recovery loop. Pattern references define
any extra revalidation for their pattern.

## Guardrails and reference

- Never modify customer source within `validate-migration`, bypass the Maven profile, or send outcomes
  directly to adoption-service. Updating generated reports is allowed.
- Never invent projects, runtime evidence, receipts, or failure classes; use
  [the frozen taxonomy](../../validate-migration/failure-classes.js).
- Only boot workspace SDK JARs or user-confirmed local SDK JARs outside the
  workspace. Never download an SDK or persist credentials in reports, receipts,
  or the user's HOME. Credentials a pattern needs come only from environment
  variables the user sets (see the pattern reference); never assume a default.
- Read [the validator reference](../../validate-migration/README.md) only for
  configuration, per-pattern contracts, deployment details, or setup guidance.
