---
name: workflow-model-design
description: Design and create AEM Workflow models on AEM 6.5 LTS. Use when creating workflow models via the Workflow Model Editor or content package XML, defining step types (PROCESS, PARTICIPANT, DYNAMIC_PARTICIPANT, OR_SPLIT, AND_SPLIT), configuring step properties, declaring workflow variables, deploying to /etc or /conf, and syncing to /var/workflow/models via Package Manager or Maven.
license: Apache-2.0
---

# Workflow Model Design (AEM 6.5 LTS)

Design workflow models for AEM 6.5 LTS: step structure, transitions, OR/AND splits, variables, and model XML deployment via Package Manager.

## Audience

Developers and workflow designers building or modifying AEM 6.5 LTS workflow models — via the Workflow Model Editor or by hand-authoring model XML and shipping it as a content package.

## Variant Scope

- This skill is AEM 6.5 LTS only.
- Models can be stored at `/conf/global/settings/workflow/models/` (preferred) or `/etc/workflow/models/` (legacy — auto-deployed without Sync).
- **Not for AEM as a Cloud Service.** If the target instance is AEMaaCS, stop and use the cloud-service variant of this skill — `/etc/workflow/models/` is deprecated, the Sync flow differs, and several patterns documented here will produce models that fail to deploy.

## Dependencies

Models reference deployed `WorkflowProcess` and `ParticipantStepChooser` services by `process.label` / `chooser.label` or fully-qualified class name. **Build and deploy the Java step first; reference it from the model second.** A model that references a label whose service is not yet registered fails at runtime with `Process not found` — Sync will succeed and the model will appear in the editor, but instances will fail on first execution. See [workflow-development](../workflow-development/SKILL.md) for step implementation.

## Prerequisites

- AEM 6.5 LTS author instance reachable (local, dev, or sandbox).
- Maven project with `ui.content` module — or the ability to author in the Workflow Model Editor and export as a content package.
- Required `WorkflowProcess` / `ParticipantStepChooser` services already implemented and deployed (see Dependencies above).
- `filter.xml` covering the model path you intend to install, with `mode="merge"`.

## Required Permissions

- `workflow-editors` (or equivalent write access to `/conf/global/settings/workflow/models/`) — create or modify models in the Workflow Model Editor or via content package.
- `workflow-administrators` (or equivalent) — start test workflow instances and terminate stuck test instances during iteration.
- Read access to `/conf/global/settings/workflow/models/` and `/var/workflow/models/` for verification.

## Workflow

```text
Model Design Progress
- [ ] 1) Clarify the workflow purpose: what triggers it, what steps are needed, who approves
- [ ] 2) Map out steps: PROCESS (auto), PARTICIPANT (human), OR_SPLIT (decision), AND_SPLIT (parallel)
- [ ] 3) Decide payload type: single JCR_PATH or multi-page workflow package (a `cq:Page` collection, detected at runtime via `adaptTo(ResourceCollection.class)`)
- [ ] 4) Identify workflow variables needed for inter-step data passing
- [ ] 5) Design model XML: flow/parsys layer with correct nt:unstructured step components and sling:resourceType per step
- [ ] 6) Choose storage: `/conf/global/settings/workflow/models/<id>` (default; requires Sync) unless the user explicitly names a site — then `/conf/<site>/settings/workflow/models/<id>`; or `/etc/workflow/models/<id>` (legacy, auto-deployed)
- [ ] 7) Add filter.xml entry with mode="merge"
- [ ] 8) Deploy via mvn install or Package Manager
- [ ] 9) Open the model in Tools → Workflow → Models → Edit → Sync; verify the model appears in /var/workflow/models/ and all steps render on the editor canvas
- [ ] 10) Start a test workflow instance; confirm it runs to completion
```

## Output Contract

**Generate only these files for a `/conf`-based model:**

| File | Node type | Purpose |
|---|---|---|
| `jcr_root/conf/.../models/<id>/.content.xml` | `cq:Page` | Model root page |
| `jcr_root/conf/.../models/<id>/jcr:content/.content.xml` | `cq:PageContent` | Title, template, resourceType |
| `jcr_root/conf/.../models/<id>/jcr:content/flow/.content.xml` | `nt:unstructured` + parsys | Step nodes |

**Never generate — hard stops:**

- ❌ **Any file under `jcr_root/var/`** — AEM Sync writes `/var/workflow/models/` automatically after you click Sync in the editor. Never ship `/var` content in a content package.
- ❌ **A `model/` directory inside `jcr:content/` at the `/conf` path** — a `cq:WorkflowModel` node with `<nodes>` and `<transitions>` is the runtime format. It must never appear under `/conf`. The Workflow Model Editor cannot open a model that contains it.
- ❌ **`<filter root="/var/workflow/models/..."/>` in filter.xml** — `/var` is never a package filter target. The only filter entry needed is the design-time `/conf` (or `/etc`) path.

**filter.xml — correct entry:**
```xml
<filter root="/conf/global/settings/workflow/models/my-workflow" mode="merge"/>
```

## Node Types Quick Reference

| Type | Purpose | Key metaData property |
|---|---|---|
| `START` | Entry point | — |
| `END` | Terminal | — |
| `PROCESS` | Auto-executed Java step | `PROCESS` = FQCN or process.label |
| `PARTICIPANT` | Human task (static assignee) | `PARTICIPANT` = principal name |
| `DYNAMIC_PARTICIPANT` | Human task (runtime assignee) | `DYNAMIC_PARTICIPANT` = chooser.label |
| `OR_SPLIT` | One branch selected by rule | Transition `rule` = ECMAScript (Rhino) |
| `AND_SPLIT` | All branches execute in parallel | — |
| `AND_JOIN` | Wait for all parallel branches | — |

## Default Path Rule

**Unless the user explicitly names a specific AEM site, always generate models at `/conf/global/settings/workflow/models/<id>`.** Do not infer a site-scoped path (e.g., `/conf/wknd/…`) from conversational context such as "for the WKND site" or "install on the WKND instance." Workflow models are not site-scoped by default — they are global resources. Only use `/conf/<site>/settings/workflow/models/<id>` when the user explicitly states that the model should be scoped to a specific site.

## 6.5 LTS: /conf vs /etc

| Location | Sync Required | Best For |
|---|---|---|
| `/conf/global/settings/workflow/models/` | Yes — via UI or `deployModel()` | New models, forward-compatible |
| `/etc/workflow/models/` | No — auto-deployed | Legacy models, simple setups |

**Design-time vs runtime paths**: `/conf/global/settings/workflow/models/` stores the editor's
`flow/parsys` format — this is what you author and deploy in a content package. Steps are
`nt:unstructured` nodes with `sling:resourceType`; no `cq:WorkflowNode` or `cq:WorkflowTransition`
nodes appear here. `/var/workflow/models/` holds the runtime copy generated by Sync — it uses
`cq:WorkflowModel`, `cq:WorkflowNode`, and `cq:WorkflowTransition`. Never write `cq:WorkflowModel`
nodes to the `/conf` path, and never hand-author `/var` content — AEM manages the runtime layer
entirely via Sync.

## Deployment

```bash
# Deploy via Maven
mvn clean install -P autoInstallPackage

# Or install package manually via Package Manager
http://localhost:4502/crx/packmgr
```

## Architecture Considerations

These choices are made at design time and are hard to retrofit. Apply them before locking the model shape:

- **Transient vs persistent.** Set `transient="true"` on the model for high-volume, short-lived workflows (e.g., asset metadata extraction, replication side-effects). Transient instances create no JCR node under `/var/workflow/instances` until a retry or external-process step forces persistence — the difference between a healthy repository and unbounded growth.
- **Participant timeouts.** A `PARTICIPANT` step with no timeout can stall a workflow indefinitely and consume a job slot for the duration. For any human task that may not be acted on promptly, configure `TIMEOUT` and a `TIMEOUT_HANDLER` route on the step's metaData.
- **Goto retry caps.** Always enforce a hard cap on retry counters used by `Goto Step` rules (e.g., `count < 3`). An uncapped Goto loop will pin a worker thread and accumulate failed instances until the workflow is terminated by hand.
- **Purge is a design-time concern.** Estimate instance volume before go-live. Configure the **Adobe Granite Workflow Purge Configuration** factory in the same content package as the model so purge ships with the workflow, not as an after-the-fact follow-up. Set `scheduledpurge.purgePackagePayload=true` if the workflow uses workflow packages.
- **Model versioning.** In-flight instances stay bound to the model version they started with; new instances pick up the new version. When changing a deployed model, plan a brief drain window for old-version instances before declaring the change complete.

## References

- [step-types-catalog.md](./references/workflow-model-design/step-types-catalog.md) — complete step type reference with XML snippets
- [model-xml-reference.md](./references/workflow-model-design/model-xml-reference.md) — full model XML structure and property reference
- [model-design-patterns.md](./references/workflow-model-design/model-design-patterns.md) — common design patterns: linear, decision, parallel, loop-back
- [architecture-overview.md](../workflow-orchestrator/references/workflow-foundation/architecture-overview.md) — canonical foundation copy
- [jcr-paths-reference.md](../workflow-orchestrator/references/workflow-foundation/jcr-paths-reference.md) — canonical foundation copy
- [65-lts-guardrails.md](../workflow-orchestrator/references/workflow-foundation/65-lts-guardrails.md) — canonical foundation copy
