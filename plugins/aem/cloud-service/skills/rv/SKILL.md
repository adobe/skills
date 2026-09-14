---
name: rv
description: |
  Verifies a customer's AEM Cloud Service migration on a real local Cloud SDK,
  after the migration skill has applied a code fix. Boots or attaches to the SDK,
  builds the customer's project, deploys the bundle, and checks the runtime
  contract (bundle state, OSGi component state, pattern-specific properties like
  `scheduler.expression`, `scheduler.concurrent:Boolean`, `scheduler.runOn=SINGLE|LEADER`).
  Retries only on transient failures. On the final attempt the skill calls the
  `report-rv-outcome` MCP tool with the structured payload rv-check printed.
  Activate when
  the user says "verify my migration", "run RV", "render and validate", "check my
  scheduler fix", "did the deploy work", or after any migration-skill fix that
  produced a modified Java bundle for AEMaaCS. Do NOT activate for content-package
  patterns (dispatcher, runmodes, filevault, custom templates) yet — those land in
  Phase 3.
license: Apache-2.0
metadata:
  status: beta
  author: AEM Cloud Service Team
  version: "0.1"
  aem_version: "Cloud Service"
---

# RV — Render & Validate

Proves an AEM Cloud Service migration works on a real Cloud SDK. Turns "my code
compiled" into "the bundle is Active and the component satisfies the CS contract."

**When to activate**

- User asks to verify, validate, or "render" a migration.
- User asks whether the recent fix "works", "activated", or is "running on the SDK".
- Immediately after the `migration` (or a `code-assessment/<pattern>`) skill applies
  a Java code change that produces a bundle-runtime pattern (scheduler today; more
  patterns coming).

**When NOT to activate**

- Content-package patterns (dispatcher converter, unsupported runmodes, filevault
  deps, custom templates). Their verify pipeline lands in Phase 3.
- Any request that is really "apply a migration" — hand off to the `migration` skill,
  then RV afterwards.

## The customer contract

Two primitive commands ship with the plugin. The skill orchestrates them so the
customer never types either directly.

```bash
rv-init                       # boots or attaches to the local Cloud SDK, once per session
rv-check <pattern>            # verify one pattern, per finding
```

Both are wired via `npm link` (or by adding `plugins/aem/cloud-service/rv/` to
PATH after `npm install`).

## The flow the skill runs

1. **Setup check.** Does `~/.rv/setup.json` exist and is `sdkUrl` reachable?
   - No  → run `rv-init`. Fail fast with the SDK's own error if boot fails
     (Java version, missing quickstart, license, port busy).
   - Yes → skip. SDK is machine-global; one boot per laptop.

2. **Locate the customer module.** `cd` into the module dir (the one that has a
   `pom.xml` producing the migrated bundle). If the migration skill wrote a
   `.rv/context.json` there — with `projectId` — RV uses that. Otherwise ask
   the user for `--project-id`. `--finding` is no longer required (each
   outcome carries per-class detail under `classes[]`).

3. **Run `rv-check <pattern>`.** The command:
   - Builds `mvn clean package -DskipTests`.
   - Auto-discovers the migrated class from the built jar's OSGi DS descriptors.
     For scheduler it prefers the class that declares `scheduler.runOn` (the
     migrated one) over any pre-migration siblings.
   - Deploys via Felix Web Console with the same-BSN reinstall nudge.
   - Reads `/system/console/bundles/<BSN>.json` and
     `/system/console/components/<FQCN>.json` to check bundle + component state
     and the Cloud Service contract properties.
   - Prints the outcome record and — on the final attempt only — a JSON payload
     block between `=== report-rv-outcome payload ===` and `=== end payload ===`.
     The payload is one aggregate record per run: `summary` counts, a `bundle`
     block, and a `classes[]` array with one entry per verified class
     (`class_name` = FQCN or dialog path; per-class `result` + evidence).
     rv-check does **not** speak MCP itself; **you (the agent) do**.

4. **Call the `report-rv-outcome` MCP tool** with the payload block from
   `rv-check` stdout. This is your MCP tool invocation, not a shell call —
   use the same MCP session you use for `fetch-cam-bpa-findings-*`. Do this
   once, on the final attempt only. Never emit an intermediate payload after
   a transient retry.

5. **Decide what to do with the result.**

| Result | Failure class | Skill action |
|---|---|---|
| pass | — | Show contract summary. Stop. |
| fail | `sdk.unreachable`, `deploy.failed`, `build.failed` (only if the log ends in "timeout") | Wait 5 s → retry. After 3 total attempts, emit final outcome. |
| fail | `runtime.bundle_not_active`, `runtime.component_unsatisfied`, `runtime.activation_error`, `runtime.contract_mismatch`, `source.contract_mismatch`, `tests.failed`, `input.jar_missing`, `discovery.no_pattern_match` | Do NOT retry — retrying the same deploy will produce the same failure. Show the evidence and hand back to the migration skill with the structured evidence (bundle_state, component_state, unsatisfied_references, activation_error). |

6. **One outcome, one MCP call.** The `report-rv-outcome` invocation is made
   once, on the final attempt. `run_id` is the parent identity — duplicates
   are idempotent server-side. When some classes pass and some fail, aggregate
   `result` is `fail` and `summary.classes_pass`/`classes_fail` carry the
   breakdown; iterate over `classes[]` for per-class evidence.

## What to show the user on success

```
✓ VERIFIED on Cloud SDK
  run:      <run_id>
  pattern:  scheduler@1.0
  bundle:   <BSN> → Active
  classes:  N pass / 0 fail
            • <class_name> → pass  (scheduler.expression, concurrent:Boolean, runOn=SINGLE|LEADER)
  outcome recorded via MCP
```

Also write a customer-facing report at `<project-root>/RV/<pattern>-<run_id>.md`
so each run leaves a persistent artifact next to the code. Follow the shape of
the Option C payload: identifiers block, aggregate summary, bundle block,
per-class table.

## What to show on a real (non-transient) failure

Never retry these. **Do not dump raw `evidence` at the user** — it's a
structured field for the MCP payload and adoption-service. Instead, **you (the
LLM) translate each failed class's `failure_class` + `evidence` into a short
natural-language explanation** of what went wrong and what to do next. Keep
it to 3–5 lines per failed class; iterate over `classes[]` where `result=fail`.

Structure of your reply, per failed class:

1. One sentence naming the failure in plain terms
   (e.g. *"`com.acme.LegacyCronTask` compiled but its OSGi component won't
   activate because it references a service AEM Cloud Service doesn't inject
   the same way."*)
2. One or two bullets pulled from that class's structured fields (below) with
   the specific values.
3. One line telling the user what typically fixes it, or handing back to the
   migration skill.

Fields to pull from each `classes[i]` (never paste raw):

- `class_name`
- `failure_class` (frozen enum)
- `bundle_state` (Installed | Resolved | Active | Fragment)
- `component_state` (Active | Satisfied | Unsatisfied)
- `unsatisfied_references[]`
- `activation_error` (short, ≤512 chars)
- `evidence` (mvn / Felix output — use for your own diagnosis; do not paste
  verbatim; extract the one line that names the root cause)

When the migration skill is available in the same session, hand back with the
structured payload so it can decide on a follow-up recipe.

## Guardrails

- **Never modify customer code.** RV verifies. Fixes belong to the `migration`
  skill.
- **Never touch adoption-service directly.** Every outcome goes through the
  `report-rv-outcome` MCP tool. Contract stays frozen even when the local sink
  is swapped for the real service.
- **Never invent a `failure_class`.** Use only the frozen enum in
  `plugins/aem/cloud-service/rv/failure-classes.js`.
- **Never batch multiple findings into one run.** One `rv-check` invocation = one
  finding. If several findings are pending, loop the flow above per finding.
- **Never run destructive SDK operations** (kill pid, wipe crx-quickstart) without
  the user confirming. Boot is fine; wipe is not.

## Supported patterns today

Five patterns are wired into `rv-check`. All share the same CLI shape
(`rv-check <pattern>`) and the same MCP payload — only the per-pattern
discover + verify functions differ.

**bundle-runtime** (`mode: bundle-runtime`) — build → deploy to Felix → check
bundle_state + component_state on the SDK:

- **scheduler** — `Sling Scheduler` Cloud Service contract. Checks
  `scheduler.expression`, `scheduler.concurrent:Boolean`, and
  `scheduler.runOn ∈ {SINGLE, LEADER}` on the migrated DS component.
- **asset-manager** — `AssetManager → ResourceResolver`. Bundle must be Active,
  component Active, and manifest must not import `com.day.cq.dam.api.AssetManager`.
- **event-migration** — `OSGi EventHandler → Sling JobConsumer`. Bundle
  Active, JobConsumer component Active, and its `job.topics` property present.
- **replication** — `CQ Replicator / Sling Replicator → Sling Distribution API`.
  Bundle Active, manifest imports `org.apache.sling.distribution` and not
  `com.day.cq.replication`, and the `Distributor` service is present on the SDK.

**source-only** (`mode: source-only`) — build → inspect the artifact; no SDK
touched, no bundle deploy:

- **legacy-ui** — `Classic UI / Coral 2 dialogs → Coral 3`. Extracts every
  `cq:dialog/.content.xml` from the built artifact and flags any remaining
  Classic UI `xtype=` attributes or Coral 2 resource types
  (`cq/gui/components/authoring/dialog/...`); passes only when all dialogs use
  Coral 3 (`granite/ui/components/coral/foundation/...`). Runs in ~2 s with no
  Cloud SDK required.

## Patterns not yet wired

Coming as source-only entries (same shape as legacy-ui, offline artifact
inspection): `dispatcher-converter`, `unsupported-runmodes`, `filevault-deps`.
`custom-templates` needs a content-package deploy pipeline
(`POST /crx/packmgr/service.jsp`) which is the next mode to add.

## Reference

- Frozen failure taxonomy: `plugins/aem/cloud-service/rv/failure-classes.js`
- MCP tool: `aemcs-migration-mcp/src/tools/report-rv-outcome.ts`
- Primitives: `plugins/aem/cloud-service/rv/rv-init.js`, `rv-check.js`
- State on disk:
  - `~/.rv/setup.json` — SDK URL, creds, pid (machine-global)
  - `<project>/.rv/context.json` — projectId + pending findings (per-project,
    written by analyze/migration)
