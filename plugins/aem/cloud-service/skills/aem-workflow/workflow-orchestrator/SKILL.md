---
name: workflow-orchestrator
description: Master entry point for AEM as a Cloud Service Workflow tasks — routes development, debugging, and operational requests to the right sub-skill. AEMaaCS only — stop on AEM 6.5 LTS.
license: Apache-2.0
---

# Workflow Orchestrator — AEM as a Cloud Service

## Audience

AEM as a Cloud Service developers (and the IDE LLM acting on their behalf) building, deploying, debugging, or operating Workflow models, process steps, launchers, or programmatic workflow starts on AEMaaCS author tier — local SDK or cloud environment.

## Variant Scope

**AEM as a Cloud Service only.** If the user is on AEM 6.5 LTS, stop and load the 6.5-lts variant of this orchestrator. Cloud Manager-only deploy, Developer Console (in place of production Felix Console JMX), IMS-based auth, and `all`-package deployment documented here do not apply on 6.5 LTS.

## Purpose

Master entry point for AEM Workflow tasks on AEM as a Cloud Service. Read this skill first. It classifies the user's request and routes to the right sub-skill.

## Dependencies

This orchestrator routes into six sub-skills:

- `workflow-model-design` — design models (steps, splits, joins) and model XML
- `workflow-development` — implement `WorkflowProcess`, `ParticipantStepChooser`, variables and metadata
- `workflow-triggering` — start workflows from code, HTTP API, or Manage Publication
- `workflow-launchers` — configure `cq:WorkflowLauncher` for event-driven start
- `workflow-debugging` — diagnose stuck or failed workflows on an accessible AEMaaCS environment (local SDK or via Cloud Manager Logs / Developer Console)
- `workflow-triaging` — symptom→runbook mapping for multi-environment / log-mining contexts via Cloud Manager Logs (load only when the user explicitly invokes that context)

## Cross-Cutting Invariants

These apply to every workflow task; surface them regardless of which sub-skill is loaded:

- **Loop prevention.** A workflow whose process step modifies a JCR path watched by a launcher will re-trigger itself. The `session` parameter on `WorkflowProcess.execute()` is a `WorkflowSession`, **not** a JCR `Session` — adapt it first (`javax.jcr.Session jcrSession = session.adaptTo(javax.jcr.Session.class);`) and tag the JCR `Session` with `jcrSession.getWorkspace().getObservationManager().setUserData("workflowmanager")` before the write so `WorkflowLauncherListener` ignores the resulting events. See `workflow-launchers` for code examples and the alternative `excludeList` / JCR-flag patterns.
- **JMX safety on AEMaaCS.** AEMaaCS production has **no Felix Console JMX**. Never recommend JMX-based remediation (`restartStaleWorkflows`, `purgeCompleted`, `terminate`, `retryFailedWorkItems`, etc.) for cloud environments — these are 6.5-LTS-only mechanisms. Use **Inbox Retry**, the **Purge Scheduler** (configured as OSGi config committed to Git), and Cloud Manager pipeline-driven config changes instead. JMX is available only on the local AEMaaCS SDK at `localhost:4502/system/console/jmx`; never recommend its use against cloud environments.
- **6.5-LTS stop-rule.** If the user's target is AEM 6.5 LTS, stop and load the 6.5-lts orchestrator — see Variant Scope above.

## How to Use This Skill

1. Read the user's request carefully.
2. Confirm the variant (AEMaaCS vs 6.5 LTS) before routing — see Variant Scope.
3. Classify the request using the **Task Classifier** table below.
4. Load the identified sub-skill's `SKILL.md` and its references.
5. For development tasks, always load the `workflow-foundation` references alongside the sub-skill references.
6. The cross-cutting invariants above apply regardless of which sub-skill is loaded.

---

## Task Classifier

### Development Skills

| User Says / Asks | Sub-Skill to Load |
|---|---|
| "Create a workflow model", "Add steps to a workflow", "Design an OR split", "I need a parallel review" | `workflow-model-design` |
| "Implement a custom process step", "Write a WorkflowProcess", "Create a ParticipantStepChooser", "Dynamic participant" | `workflow-development` |
| "Start a workflow from code", "Trigger a workflow via API", "Use Manage Publication with a workflow", "HTTP REST API to start a workflow" | `workflow-triggering` |
| "Configure a launcher", "Auto-start on asset upload", "Launcher not firing", "cq:WorkflowLauncher", "Overlay an OOTB launcher" | `workflow-launchers` |
| "How do workflows work?", "Explain workflow architecture" | Load `workflow-foundation` references only |

### Debugging Skills

| User Says / Asks | Sub-Skill to Load |
|---|---|
| "Workflow is stuck", "Why isn't my workflow advancing?", "No work item", "Workflow failed", "Step shows error" | `workflow-debugging` |
| "Task not in Inbox", "User can't see work item", "Permissions error on workflow" | `workflow-debugging` |
| "Thread pool exhausted", "Auto-advancement not working", "Queue backlog", "Sling Jobs stuck" | `workflow-debugging` |
| "Repository bloat", "Too many workflow instances", "Purge not working", "Stale workflows" | `workflow-debugging` |

**Routing heuristic:**
- Building/implementing workflows → development skills (`workflow-model-design`, `workflow-development`, `workflow-triggering`, `workflow-launchers`)
- Diagnosis of a stuck or failed workflow on an accessible AEMaaCS environment → `workflow-debugging` (decision trees, OSGi config-via-Git checks, Developer Console thread dumps, Cloud Manager Logs — under the JMX-safety invariant above)
- Multi-environment / log-mining contexts (Cloud Manager Logs queries across environments, ticket classification, "errors across environments over the past N hours") → `workflow-triaging` — **load only when the user explicitly invokes that context**, not by default

---

## Reference Loading Order

For every workflow task on Cloud Service, load in this order:

### Step 1: Always load these foundation references

```
workflow-orchestrator/references/workflow-foundation/architecture-overview.md
workflow-orchestrator/references/workflow-foundation/api-reference.md
workflow-orchestrator/references/workflow-foundation/jcr-paths-reference.md
workflow-orchestrator/references/workflow-foundation/cloud-service-guardrails.md
workflow-orchestrator/references/workflow-foundation/quick-start-guide.md
```

### Step 2: Load the sub-skill's SKILL.md

```
workflow-model-design/SKILL.md         ← for model design tasks
workflow-development/SKILL.md          ← for Java implementation tasks
workflow-triggering/SKILL.md           ← for start/trigger tasks
workflow-launchers/SKILL.md            ← for launcher config tasks
workflow-debugging/SKILL.md            ← for production debugging tasks
workflow-triaging/SKILL.md             ← for incident triage tasks
```

### Step 3: Load the sub-skill's topic references

**workflow-model-design:**
```
workflow-model-design/references/workflow-model-design/step-types-catalog.md
workflow-model-design/references/workflow-model-design/model-xml-reference.md
workflow-model-design/references/workflow-model-design/model-design-patterns.md
```

**workflow-development:**
```
workflow-development/references/workflow-development/process-step-patterns.md
workflow-development/references/workflow-development/participant-step-patterns.md
workflow-development/references/workflow-development/variables-and-metadata.md
```

**workflow-triggering:**
```
workflow-triggering/references/workflow-triggering/triggering-mechanisms.md
workflow-triggering/references/workflow-triggering/programmatic-api.md
```

**workflow-launchers:**
```
workflow-launchers/references/workflow-launchers/launcher-config-reference.md
workflow-launchers/references/workflow-launchers/condition-patterns.md
```

**workflow-debugging:**
```
workflow-debugging/SKILL.md
workflow-debugging/references/docs/debugging-index.md   ← symptom→runbook index
workflow-debugging/references/runbooks/<symptom_id>.md  ← runbook(s) matching the classified symptom_id
```

**workflow-triaging:**
```
workflow-triaging/SKILL.md
```

---

## Cloud Service Production Support Constraints

> **Cloud environments only.** These constraints describe AEMaaCS dev/stage/prod cloud environments. The **local AEMaaCS SDK** at `localhost:4502` has Felix Console with JMX, accepts Package Manager uploads, supports `admin:admin` auth, and gives `jstack` access — none of which apply to cloud environments. When reasoning about debug paths, distinguish the two and never carry local-SDK affordances over to cloud.

| Constraint | Detail |
|---|---|
| No JMX (cloud) | No `retryFailedWorkItems`, `countStaleWorkflows`, `restartStaleWorkflows`, `purgeCompleted` via JMX on cloud environments. JMX is available only on the local AEMaaCS SDK. |
| Retry failed items | Inbox Retry only |
| Stale detection | Custom API/script only |
| Purge | Purge Scheduler (OSGi config in Git) |
| Log access | Cloud Manager → Environments → Logs (download / streaming) |
| Thread dumps | Developer Console or support request |
| Config changes | Code in Git + Cloud Manager pipeline deploy |

---

## AEM Cloud Service Guardrails Summary

Before doing anything, apply these non-negotiable constraints:

| Rule | Detail |
|---|---|
| `/libs` is immutable | Never write to `/libs`; use `/conf/global/` or `/apps/` overlays |
| Model design-time path | `/conf/global/settings/workflow/models/<id>` |
| Model runtime path (for API calls) | `/var/workflow/models/<id>` |
| Launcher config path | `/conf/global/settings/workflow/launcher/config/` |
| OSGi annotations | Use DS R6 (`@Component`, `@Reference` from `org.osgi.service.component.annotations`) |
| Deploy via | Cloud Manager pipeline — no Package Manager in production |
| No `javax.jcr.Session.loginAdministrative` | Use `ResourceResolverFactory.getServiceResourceResolver()` |
| Launcher run-mode restriction | The `runModes` property on `cq:WorkflowLauncher` has known reliability issues — package the launcher's `.content.xml` under `config.author/` (the canonical AEMaaCS run-mode-aware folder) and let Sling's run-mode-aware OSGi config handling drive it |

Full detail: `references/workflow-foundation/cloud-service-guardrails.md`

---

## Quick Architecture Recap

> **Author-tier only by default.** Workflows on AEMaaCS execute on the **author tier** — the publish tier is read-mostly and replication-driven. The diagram below is author-tier; do not assume publish-tier workflow infrastructure unless the user has an explicit publish-tier-execution requirement (rare on AEMaaCS).

```
Author tier
  │
  ├── Content Author
  │     └── triggers via: Timeline UI / Manage Publication
  │
  ├── Custom code (OSGi service / event handler / scheduler)
  │     └── triggers via: WorkflowSession.startWorkflow()
  │
  └── Workflow Launcher (cq:WorkflowLauncher)
        └── triggers via: JCR observation events
              ↓
        Granite Workflow Engine
              ↓
        Workflow Instance (/var/workflow/instances/)
              ↓
        Steps executed as Sling Jobs:
          - PROCESS step  → WorkflowProcess.execute()
          - PARTICIPANT step → inbox task for user/group
          - DYNAMIC_PARTICIPANT → ParticipantStepChooser.getParticipant()
          - OR_SPLIT → route expression evaluates to true/false
          - AND_SPLIT → parallel branches, AND_JOIN waits for all
```

---

## Common Task Patterns (End-to-End)

### Pattern A: New custom approval workflow

1. Load `workflow-model-design` + `workflow-development` sub-skills
2. Design model: START → PARTICIPANT (reviewer) → PROCESS (approve/reject logic) → END
3. Implement `WorkflowProcess` for the approve/reject step
4. Deploy model XML to `/conf/global/settings/workflow/models/<id>` via the project's `all` content package and the Cloud Manager pipeline
5. Deploy the OSGi bundle in the same pipeline run so the process step is registered
6. Run **Tools → Workflow → Models → Sync** so the runtime copy at `/var/workflow/models/<id>` matches design-time. The engine reads only from `/var/workflow/models/<id>`.

### Pattern B: Auto-process content on upload

1. Load `workflow-launchers` sub-skill
2. Configure a `cq:WorkflowLauncher` for `NODE_ADDED` on the DAM path
3. Point it to your workflow model at `/var/workflow/models/`
4. Deploy launcher config to `/conf/global/settings/workflow/launcher/config/`

### Pattern C: Programmatically batch-start workflows

1. Load `workflow-triggering` sub-skill
2. Implement `WorkflowStarterService` using `ResourceResolverFactory` + `WorkflowSession`
3. Map sub-service `workflow-starter` via `ServiceUserMapper` to a service user with the ACLs your starter needs.
4. Deploy and trigger from a Sling Scheduler or Servlet

### Pattern D: "Workflow stuck — not advancing"

1. Load `workflow-debugging` → classify as `workflow_stuck_not_progressing`
2. Follow decision tree: check for work item → step type → specific checks
3. If thread pool suspected, guide thread dump analysis via the AEMaaCS **Developer Console**
4. Return: root cause, config fix (committed to Git via the project's OSGi config module and deployed through Cloud Manager), remediation steps (under the JMX-safety invariant — JMX-based remediation does not apply on AEMaaCS production)

---

## References in This Skill

```
references/workflow-foundation/architecture-overview.md
references/workflow-foundation/api-reference.md
references/workflow-foundation/jcr-paths-reference.md
references/workflow-foundation/cloud-service-guardrails.md
references/workflow-foundation/quick-start-guide.md
```
