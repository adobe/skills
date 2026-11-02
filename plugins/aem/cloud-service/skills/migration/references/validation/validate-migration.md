# Branch G — Validate migration (`validate-migration`)

> **Beta**: Branch G is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

Verify migrated code on a local Cloud SDK without modifying customer code.
Completion requires a saved report; when a CAM project is linked it also requires
an accepted outcome submission, not just a successful build or an emitted payload. Restricted passes retain their caveats.

## Scope and paths

Use `scheduler`, `asset-manager`, `event-migration`, `resource-change-listener`,
`replication`, `legacy-ui`, `custom-templates`, or explicit `cdw`. Do not use this
branch for dispatcher, unsupported-runmodes or filevault-deps. Fixes belong to the migration branches (A–E).
`--pattern` also accepts the migration runbook / BPA names: `assetApi`,
`resourceChangeListener`, `eventListener`/`eventHandler`, `lui`/`luiCoral2`,
`templateModernization`. Reports and outcomes use the validator names above.

This branch is the orchestrator: it runs the shared workflow below and, for each
pattern in scope, that pattern's check (`scripts/validate-migration/check/patterns/`).
When a pattern has a reference, read it before running that pattern; skip it otherwise.

| Pattern | Checks | Needs SDK + MCP | Pattern reference |
|---|---|---|---|
| `scheduler`, `asset-manager`, `event-migration`, `resource-change-listener`, `replication` | Built DS contract, bundle/component state | Yes | none |
| `legacy-ui`, `cdw` | Dialog files in the built package, against the package-checkable rules of the migration skill's dialog and CDW `validation.md` | No | none |
| `custom-templates` | Offline component mapping, SDK health, side-by-side page compare | Yes | [custom-templates](custom-templates.md) |

The validator scripts never contact AEM directly and never handle AEM credentials.
Deployment uses the project's Maven profile; bundle runtime state comes only from
the AEM Quickstart MCP.

Resolve `$VALIDATOR` to the absolute path of the migration skill's `scripts/validate-migration/` directory. Run commands from the customer's project/module root. For a
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
Installing a bundle can start scheduled work or listeners. Before deployment,
inspect available project configuration for production connections or other unsafe
side effects. Raise a specific, plain-language deployment blocker when evidence
shows a risk or a concrete uncertainty needs resolving; do not add a generic
"SDK is isolated and safe" confirmation to instance startup.
Do not change credentials or SDK configuration without approval.

## Workflow

1. **Setup and readiness.**

    **Setup (scoped).** `legacy-ui`/`cdw` are offline: do not request or start AEM
    instances or require diagnosis MCP for them. Bundle-runtime patterns need the
    Cloud SDK (default `http://localhost:4602`) and its AEM Quickstart MCP server.
    Side-by-side `custom-templates` validation also needs source AEM 6.5 (default
    `http://localhost:4502`). Honor explicit URLs before saved setup and defaults.
    Run `node "$VALIDATOR/init.js"` from the project root,
    retaining any explicit `--sdk`/`--quickstart` URLs and `--pattern` scope
    (comma-separated for multiple patterns). Without `--pattern`, setup uses the
    changed patterns versus main. It checks local tools, rejects a source URL that
    is the SDK URL, and saves the selected URLs. It never contacts or starts an
    instance. Stop until it prints `setup ready`. Fix each required ✗ item, then rerun:
    - **Instances.** Ask the developer to start the required instances (Cloud SDK
      on 4602, AEM 6.5 on 4502, or their explicit URLs). Do not search for, start,
      or download Quickstart JARs. Point to the SDK download page only if the
      developer says they lack the SDK.
    - **MCP (runtime scope only).** Ready when your own tools include
      `diagnose-osgi-bundle` connected to `<selected-sdk-url>/bin/mcp`; this is
      the readiness check for the SDK. If not, ask the
      user to add `<selected-sdk-url>/bin/mcp` to their coding assistant's MCP
      config themselves, following
      [AEM Quickstart MCP server setup](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/ai-in-aem/local-development-with-ai-tools#aem-quickstart-mcp-server),
      then restart the server. Never edit their MCP config or ask for credentials in chat.
    Handle MCP setup and any missing reporting identity once the instances are started.
    For a pattern with a reference,
    also run that reference's readiness checks.

    **Reporting (optional).** The CAM project comes from the nearest
    `migration-runbook.json` (`project.id`) or an explicit `--project-id` /
    `--project-name` (explicit wins). With no linked project, validate locally: do not
    ask for one, and report that the outcome was not reported to CAM. With a linked
    project, confirm `submit-migration-validation-result` is in your tools; never test
    it with a fabricated outcome.

2. **Prepare.** Run `node "$VALIDATOR/check.js" --stage prepare` with the selected
  scope/project/SDK flags. It builds, discovers, deploys bundle-runtime patterns
  through the project's Maven install profile, and saves `.validate-migration/state.json`.
   A pattern reference may add steps between prepare and verify; follow it.
   The build uses `-DskipTests`; do not claim customer unit tests passed.
3. **Diagnose (bundle-runtime scope only).** Skip this step for offline
  `legacy-ui`/`cdw` checks. For each emitted BSN, call MCP `diagnose-osgi-bundle` with
   `{ "bundleSymbolicName": "<BSN>" }` against the SAME SDK. Save the exact returned report in
   `.validate-migration/diagnosis-map.json` as `{ "<BSN>": "<raw report>" }`.
  If unavailable, stop recovery and follow the missing-diagnosis path below.
  Never substitute direct Felix calls. Pattern references that deploy bundles use
  this same diagnosis.

4. **Verify.** Run `node "$VALIDATOR/check.js" --stage verify` with the same scope
  flags. It writes `.validate-migration/<run_id>.{md,json}` and emits one outcome
  payload per task (one per discovered template) when a CAM project is linked. A
  passing validation exits `0` with no linked project, or `3` while reporting is
  pending; this is not a code failure. Scheduler properties and Distributor registration are
   restricted when MCP cannot expose them: report exactly what remains unverified,
  including scheduler cluster behavior. Missing diagnosis is `setup.mcp_unavailable`.
  Before treating a runtime failure as final, follow **Bounded runtime recovery**
  below. The agent coordinates recovery; the validator does not poll the SDK.

5. **Submit (linked project only).** Forward the emitted `submit-migration-validation-result`
   payload through MCP once on the final verification attempt, including failed validation outcomes.
   Require `ok: true` and a matching `run_id` before saying "outcome recorded".
  Save only the actual response's `ok`, `run_id`, `stored_at`, and `duplicate`
  fields as `.validate-migration/<run_id>-receipt.json`. For failures save
  `{ "ok": false, "error": "<credential-free summary>" }`; never persist raw
  sensitive error text. Never fabricate an acknowledgement. Missing CAM config,
   rejection, or network failure leaves reporting incomplete; do not silently retry.
   Request/response shape: [cam-mcp.md](../cam-mcp.md#tool-submit-migration-validation-result).

6. **Finalize (linked project only).** Run the command below even after submission fails, using the
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

With no linked project, verify exits `0` for a pass and `1` for a failure. With one,
finalization exits `0` for validated and recorded, `1` for failed validation
with reporting recorded, `3` for reporting incomplete; `2` is usage/error.
`--stage all` also exits `3` when runtime diagnosis is still needed.

Close with the target/class count, validation result (including restrictions),
report link, and actual reporting status. Do not claim end-to-end success while
reporting is pending/failed. A local pass and failed submission are distinct.
A no-changes exit is a no-op, not evidence that code was validated.
For failures, explain the root cause and next action briefly; do not dump raw
evidence. A timeout-ending `deploy.failed` allows one deployment retry after
5 seconds. `sdk.unreachable` means Maven could not connect to the selected SDK:
ask the developer to start it (or correct `--sdk`) and rerun prepare. Runtime recovery follows the bounded policy above; never blindly retry
runtime/source contract failures. Source-only failures go back to `migration`
without automatic repair in this runtime recovery loop. Pattern references define
any extra revalidation for their pattern.

## Guardrails and reference

- Never modify customer source within `validate-migration`, bypass the Maven profile, or report outcomes
  other than through `submit-migration-validation-result`. Updating generated reports is allowed.
- Never invent projects, runtime evidence, receipts, or failure classes; use
  [the frozen taxonomy](../../scripts/validate-migration/failure-classes.js).
- Never start, download, or search for AEM instances or JARs; the developer runs
  them. Never persist credentials in reports, receipts,
  or the user's HOME. The scripts never handle AEM credentials; deployment
  authenticates through the project's Maven settings. Never assume a default password.
- Read [the validator reference](../../scripts/validate-migration/README.md) only for
  configuration, per-pattern contracts, deployment details, or setup guidance.
