# validate-migration

Deploys migrated AEM Cloud Service bundles to a local Cloud SDK and confirms they
actually run — bundle Active, OSGi component Active, Cloud Service contract
properties correct.

Companion to the `migration` skill: `migration` applies the fix,
`validate-migration` proves it works.

> Status: Beta. Verified end-to-end against AEM SDK 2026.8+ with the
> [AEM Quickstart MCP content package](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/ai-in-aem/local-development-with-ai-tools#aem-quickstart-mcp-server).

## Validation and reporting flow

The migration skill's Branch G ([validate-migration.md](../../references/validation/validate-migration.md))
drives these scripts by absolute path (`$VALIDATOR` is this directory) — there is no `npm link` and no
global bin.

```bash
# From your project root — scoped setup (or pass --pattern scheduler, etc.).
# Offline dialog checks need no instances. Runtime checks need the Cloud SDK;
# template comparison also needs AEM 6.5. Start them yourself; setup saves their
# URLs and never contacts AEM or asks for AEM credentials.
node "$VALIDATOR/init.js"

# Per branch, from your project root:
#   1. build + deploy, list the Bundle-SymbolicNames to diagnose
node "$VALIDATOR/check.js" --stage prepare

#   2. the coding assistant now calls the AEM Quickstart MCP tool
#      `diagnose-osgi-bundle` (argument `bundleSymbolicName`) for each BSN and writes the raw text outputs to
#      <project>/.validate-migration/diagnosis-map.json as { "<BSN>": "..." }

#   3. consume the diagnosis + emit outcome
node "$VALIDATOR/check.js" --stage verify

#   4. the assistant submits the emitted payload through submit-migration-validation-result
#      and saves the actual MCP response to .validate-migration/<run_id>-receipt.json

#   5. persist the acknowledgement or submission error in both local reports
node "$VALIDATOR/check.js" --stage finalize \
  --report .validate-migration/<run_id>.json \
  --receipt .validate-migration/<run_id>-receipt.json
```

Resolve script paths relative to this directory, not the customer's working
directory. Run commands from the selected project/module root or pass
`--project <module>`. For a single Java class, use
`--pattern scheduler --fqcn com.customer.Scheduler --project <bundle-module>`
on prepare and verify. The entire bundle is deployed; only that class is evaluated.
The build uses `-DskipTests`, so this flow does not establish unit-test success.

Auto-diff mode diffs `HEAD` against `origin/main` (fallback `main`),
**including staged, unstaged, and untracked changes** so runs immediately after
the sibling `migration` skill (which edits files without committing) still see
the pending work. Manual override: `--pattern <name>` runs one pattern only.

`--stage all` (the default) stops after prepare with exit `3` when runtime
diagnosis is needed. With an explicit diagnosis map it can run prepare + verify
in one invocation; that does not replace outcome submission and finalization.
Any BSN missing from the map is
reported with `failure_class: setup.mcp_unavailable` and setup guidance; there
is no silent fallback to the Felix Web Console.

## Bounded runtime recovery

The agent, not `check.js` or the outcome-reporting tool, coordinates recovery via
the AEM SDK diagnosis MCP. Keep the original scope and the same project/module,
SDK, pattern, and class filters.
Unrelated out-of-scope component errors do not fail a scoped validation or trigger
repair unless evidence proves they block a selected class's required dependency.

- For `runtime.bundle_not_active` without a diagnosed code blocker, allow at most
  3 diagnosis checks total per affected BSN per deployment, including the initial
  check. Between checks, wait 5 seconds, then obtain a fresh `diagnose-osgi-bundle`
  report and replace the affected entry in `diagnosis-map.json`, preserving other
  BSNs. Rerun verify using saved prepared state. Do not rebuild or redeploy during activation checks.
  Stop waiting when Active or when diagnosis shows a blocker; still verify the
  components and migration contract.
- After exhausted checks or another runtime failure, analyze MCP evidence for
  unresolved imports, missing services, or activation exceptions. Allow
  at most one repair cycle for the entire validation invocation, not per class.
  `migration` owns customer source changes; validation hands it the failed class,
  diagnosis, scope, and evidence, and never edits customer source itself. Only
  clear, minimal fixes within authorized scope qualify. Do not guess dependencies,
  change credentials, broaden scope, or invoke business actions. Stop for unclear
  causes, out-of-scope fixes, or unavailable tools; stop recovery immediately on `setup.mcp_unavailable`.
  If diagnosis becomes unavailable after prepare, remove affected BSN entries
  from the map and rerun verify to produce a final missing-diagnosis outcome,
  then continue the normal final steps. Do not reuse stale diagnosis. If unavailable
  before prepare, stop with setup guidance without fabricating a run.
- After a repair, recheck deployment safety and affected existing customer tests,
  then run prepare again through the same Maven profile, obtain new diagnosis,
  and verify again. The new deployment retains the activation-check limit but
  permits no second repair cycle. Never reuse the old artifact or diagnosis.
- Preserve credential-free attempt summaries in `.validate-migration/recovery.md`
  with the original failure, counts, repair rationale, report run_ids, final result,
  and restrictions. Preserve intermediate reports without submitting them; only
  the payload and run_id from the final verification attempt proceed to submission
  and finalization. Unresolved failures stop with the remaining cause and next action.

For a timeout-ending `deploy.failed`, permit one deployment retry after 5 seconds.
Do not blindly retry runtime/source contract failures. Source-only failures return
to migration without automatic repair in this runtime recovery loop.

## Completion contract

Verify always writes `.validate-migration/<run_id>.md` and `.json`. Validation
and reporting are separate: a restricted local pass is not end-to-end completion.
With no linked CAM project, reporting is `not_reported` and the run is complete:
passing verification exits `0`, failed validation `1`. With a linked project,
passing verification exits `3` while awaiting reporting; failed validation exits
`1` but its outcome must still be submitted.

With a linked project, confirm `submit-migration-validation-result` is in the coding
assistant's tools; runtime scope also requires `diagnose-osgi-bundle` against the
selected SDK. Offline `legacy-ui`/`cdw` checks need no diagnosis MCP.
Never test reporting with a fabricated payload. Load `project.id` (and optional
`project.name`) from the nearest `migration-runbook.json`, or use an explicit
flag, which takes precedence. If none is linked, ask for the actual CAM project
name. Context files are not consumed. Only skip submission for an explicit local-only
request, and do not label reporting complete.

Forward the emitted payload once to `submit-migration-validation-result`, then save its
actual `ok`, `run_id`, `stored_at`, and `duplicate` fields as the receipt. Wrap
errors as `{ "ok": false, "error": "<credential-free summary>" }`, not raw
potentially sensitive text. Never put credentials in receipts. Finalization
keeps a safe error summary rather than copying arbitrary error text to reports.
Finalization requires `ok: true` and the SAME `run_id`; it does not make a network
request or resubmit the outcome. It persists reporting status, errors, and
restricted-check explanations in the reports. Exit codes:

| Stage/result | Exit |
|---|---|
| Finalize: validation passed and outcome recorded | `0` |
| Validation failed (including after acknowledged reporting) | `1` |
| Usage or malformed input | `2` |
| Diagnosis or reporting incomplete | `3` |

An acknowledged outcome means the backend accepted/persisted it. It is not proof
of a separate downstream event being delivered; the report leaves event delivery
unconfirmed. A failed submission does not turn a local validation pass into a
code failure, and must not be silently retried or presented as recorded.

## Prerequisites

- Offline `legacy-ui`/`cdw` checks require no running instances or diagnosis MCP.
- Bundle-runtime checks require AEM Cloud SDK (default `http://localhost:4602`).
  Side-by-side `custom-templates` validation additionally requires source AEM 6.5
  Quickstart (default `http://localhost:4502`). Override with `--quickstart <url>` /
  `--sdk <url>`; scoped `init.js --pattern <a,b>` records only the required URLs,
  or infers the changed patterns versus main when no scope is supplied.
  Setup never contacts AEM: it rejects a source URL that is the SDK URL and saves
  the selected URLs. The coding assistant's `diagnose-osgi-bundle` tool on
  `<sdk>/bin/mcp` confirms the SDK is running. If deployment cannot connect,
  prepare reports `sdk.unreachable`; start the SDK and rerun. Setup never
  searches for, boots, or downloads Quickstart JARs. Only offer
  [SDK download guidance](https://experience.adobe.com/#/downloads/content/software-distribution/en/aemcloud.html)
  after the user confirms no local SDK exists. Never skip runtime validation.
- [AEM Quickstart MCP server](https://github.com/adobe/cq-quickstart-mcp-server/)
  (`com.adobe.aem:com.adobe.aem.mcp-server-contribs-content`, on Maven Central) installed
  on the SDK for runtime checks and added by you to the coding assistant's MCP config. Ready when the
  assistant lists `diagnose-osgi-bundle`; `init.js` does not probe it. See the
  [Adobe setup docs](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/ai-in-aem/local-development-with-ai-tools#aem-quickstart-mcp-server).
- `mvn` and `unzip` on `PATH`.
- Node 18+.

## Config

Zero config for standard local dev. Overrides via env or CLI:

| Env | CLI | Default | Notes |
|---|---|---|---|
| `AEM_SDK_URL` | `--sdk <url>` | saved setup, else `http://localhost:4602` | never falls back to AEM 6.5 on 4502 |
| — | `--quickstart <url>` | saved setup, else `http://localhost:4502` | source URL for scoped `init.js` template comparison setup |
| — | `--pattern <a,b>` | changed patterns versus main | scope for `init.js`; `check.js` accepts one explicit pattern |
| — | `--project-id <id>` | auto-loaded from nearest `migration-runbook.json` | explicit selection overrides inherited identity |
| — | `--project-name <name>` | user-confirmed CAM project name | reporting MCP resolves the name; payload can be emitted without an ID |
| — | `--diagnosis-map <file>` | `<project>/.validate-migration/diagnosis-map.json` | agent-supplied BSN → raw MCP text output |
| — | `--fqcn <class>` | inferred | pin the Java class for patterns that support it, including scheduler |
| — | `--stage prepare\|verify\|all\|finalize` | `all` | validation and acknowledged-report finalization |
| — | `--report <json>` | required for finalize | saved validation record |
| — | `--receipt <json>` | required for finalize | actual reporting MCP response |

No global validator configuration or credentials are persisted to `$HOME`.
No `~/.validate-migration/*`.

### Missing local instances

Only instances required by the selected patterns are needed, at saved/explicit URLs
or the defaults (4502 for AEM 6.5, 4602 for Cloud SDK). The scripts never probe
them: if `diagnose-osgi-bundle` cannot reach the SDK or prepare reports
`sdk.unreachable`, ask the developer to start the instance and rerun.
Do not ask a generic SDK-isolation question during startup; before deployment,
raise specific risks found in project configuration in plain language.

## Deploy strategy

Uses only the customer project's `-PautoInstallBundle` (or `-PautoInstallPackage`)
Maven profile — the AEM archetype standard. The project's own pom and Maven
settings own the install endpoint and credentials; the validator never handles
credentials or calls AEM directly. Only `-Daem.host`/`-Daem.port` are
passed so the deployment targets the selected local SDK. If Maven cannot connect,
prepare reports `sdk.unreachable`. If the project has no such profile, prepare
reports `deploy.failed` and the developer deploys the bundle with their usual
workflow before re-running.

## Runtime verification via MCP

Bundle + component state come from the coding-assistant's own MCP session with
the [AEM Quickstart MCP server](https://github.com/adobe/cq-quickstart-mcp-server)
(`diagnose-osgi-bundle` tool). **This script does not speak MCP** — it consumes
a JSON map of `{ "<BSN>": "<raw tool text output>" }` written to
`.validate-migration/diagnosis-map.json` by the coding assistant between
`--stage prepare` and `--stage verify`.

Signals the MCP tool does not expose today (component DS properties like
`scheduler.expression`, `scheduler.runOn`, `job.topics` on the running
component; `Distributor` service registration) are reported as
`restricted: true` on an otherwise-passing outcome and tracked as upstream
feature requests against
[`apache/sling-org-apache-sling-mcp-server-contributions`](https://github.com/apache/sling-org-apache-sling-mcp-server-contributions).
There is no fallback to direct Felix Web Console access.

## Pattern contracts

| Pattern | Verification | Unverified signals |
|---|---|---|
| `scheduler` | Built Runnable service, scalar nonempty expression, scalar SINGLE/LEADER runOn, scalar Boolean concurrency if declared; Active bundle/component via MCP | effective properties, cron interpretation, scheduled execution, and cluster behavior |
| `asset-manager` | Active bundle/component; offline absence of AssetManager references | customer asset operations and business effects |
| `event-migration` | Built JobConsumer service and nonempty String `job.topics`; Active bundle/component | effective properties, job processing, and business effects |
| `resource-change-listener` | Built listener service, nonempty String paths and supported change types; Active bundle/component | effective properties, listener callbacks, and business effects |
| `replication` | Active bundle; distribution import, no CQ replication import | Distributor service registration, distribution execution, and business effects |
| `legacy-ui` | Source-only dialog inspection for Classic UI and Coral 2, plus the package-checkable rules of `migration/references/legacy-ui/dialog/validation.md` (rule ids in evidence; blocking for dialogs changed on the branch, warnings in a full-package scan) | source-tree checks in that file (backups, sidecars, filter.xml); runtime rendering and interactions |
| `cdw` | Source-only inspection for classic widget types and custom xtypes, plus `migration/references/legacy-ui/cdw/validation.md` 2.2 | session-specific checks in that file; runtime rendering and interactions |

### Validation boundary

These are reusable migration-contract checks, not customer-specific business tests.
DS checks inspect the built descriptor, including scalar and multiline properties;
they do not establish effective SDK configuration. Invalid supported source contracts
fail with `source.contract_mismatch` before runtime diagnosis. Reports and MCP class
entries separate `checks.migration_contract` (`pass`, `fail`, or `not_verified`) from
`checks.business_behavior=not_tested`. A pass is limited to the supported contract;
restrictions and reporting status remain separate. It is not a claim of business
correctness or cluster behavior.
Older prepared state without built DS contract evidence is not verified and cannot
pass; rerun `--stage prepare` with the same pattern and class scope. An external
listener marker does not replace registration under `ResourceChangeListener`.

Do not invoke customer business actions, send email, submit jobs, mutate customer
content, change schedules, or add test endpoints/instrumentation. The only exception
is an explicitly approved disposable page under a dedicated test parent for
`custom-templates`; cleanup is mandatory. Do not modify
customer source. Existing customer tests can be run separately and unchanged only
with explicit authorization and a safe test setup; this validator does not run them.
Before deployment, confirm the SDK is isolated from production side effects because
bundle activation can itself start customer work. If safety cannot be established,
stop for safe SDK configuration; configuration changes require approval.

`cdw` must be selected explicitly; auto-diff classifies shared dialog paths as
`legacy-ui`. Dispatcher, unsupported-runmodes, and filevault-deps
are not wired into this validator. Source-only CLI checks do not touch the SDK.
By default, `custom-templates` checks each editable template in the built
content package for a `cq:Template` definition plus `structure` and `initial`
content (`policies` is reported but optional). Optionally pass
`--template /conf/<site>/settings/wcm/templates/<name>` on prepare to narrow
selection. Package-only checks do not create or render pages.
For static-to-editable runtime comparison the agent orchestrates two-instance
readiness, approved target-only package deployment, equivalent source/target pages,
content preservation and reviewed desktop/mobile screenshots. Pass
`--template-mode runtime` on prepare and `--template-evidence <absolute-json-path>`
on verify. The runtime requirement persists in state, and missing evidence cannot
silently pass as source-only. The CLI validates browser evidence; it does not run
a browser, hold SDK credentials, create fixtures or deploy content ZIPs itself.
See [Template runtime validation](../../references/validation/custom-templates.md)
for setup, approval, evidence schema and cleanup. Each template gets its own payload,
report, receipt and finalize invocation. Other patterns are unchanged.
The validator has no npm dependencies; screenshot dimensions are read with the
built-in `check/lib/png.js`.

## Files that ship with this plugin

- `init.js` — scoped setup: checks local tools, rejects a source URL that is the
  SDK URL, saves the selected URLs to `.validate-migration/setup.json`, and reminds
  the coding assistant to check diagnosis MCP for runtime scope. It makes no HTTP calls.
- `setup.js` — per-pattern prerequisites and the saved setup file.
- `mcp.js` — the required diagnosis tool name (`diagnose-osgi-bundle`). It does not
  probe the SDK or edit the IDE configuration; the user configures the server
  and the coding assistant confirms `diagnose-osgi-bundle`.
- `check.js` — orchestrator CLI: prepare = build/discover/deploy; verify = consume
  diagnosis and run each pattern's check; finalize = persist the reporting
  acknowledgement or error.
- `check/patterns/` — one module per pattern, each exporting `discover` and `verify`;
  `index.js` registers them. Add a pattern by adding one module and registering it.
  - `custom-templates/` — `index.js` (pattern), `discover.js` (templates in a package),
    `mapping.js` (offline check that every component of the pre-migration static
    template, read from Git via `--static-template` / `--baseline-ref`, defaults
    `/apps/<site>/templates/<name>` and `HEAD`, exists in the editable template),
    `evidence.js` (agent-captured runtime evidence, PNG screenshots, content
    preservation, run/package binding and fixture cleanup).
- `check/lib/` — shared helpers: `jar.js` (jar contents and manifest),
  `descriptor.js` (DS descriptors and contracts), `diagnosis.js` (MCP diagnosis map),
  `runtime-gate.js` (shared bundle/component state checks), `dialogs.js` (dialog
  discovery and classification).
- `plan.js` — branch-diff scoping. Includes committed, staged, unstaged, and
  untracked changes.
- `build.js`, `deploy.js` — reusable helpers.
- `failure-classes.js` — frozen failure taxonomy accepted by the
  `submit-migration-validation-result` MCP tool.
