---
name: aem-workflow
description: |
  Single entry point for all AEM as a Cloud Service Workflow skills. Covers workflow model design,
  custom process step and participant chooser development, launcher configuration, workflow triggering,
  and production support including debugging stuck/failed workflows, triaging incidents with Cloud Manager
  logs, thread pool analysis, and Sling Job diagnostics for the Granite Workflow Engine.
license: Apache-2.0
compatibility: Requires AEM as a Cloud Service. Maven project structure with core and ui.apps modules.
metadata:
  version: "1.0"
  aem_version: "Cloud Service"
---

# AEM Cloud Service Workflow

Route user requests to the appropriate specialist skill based on intent.

## Intent Router

| User Intent | Skill | Path |
|---|---|---|
| Create a workflow model, add steps, design OR/AND splits, configure variables | Model Design | [workflow-model-design/SKILL.md](./workflow-model-design/SKILL.md) |
| Implement a custom WorkflowProcess step, ParticipantStepChooser, OSGi service registration | Development | [workflow-development/SKILL.md](./workflow-development/SKILL.md) |
| Start a workflow from code, HTTP API, Timeline UI, Manage Publication | Triggering | [workflow-triggering/SKILL.md](./workflow-triggering/SKILL.md) |
| Configure a launcher, auto-start on asset upload, overlay OOTB launcher | Launchers | [workflow-launchers/SKILL.md](./workflow-launchers/SKILL.md) |
| Workflow stuck, failed step, missing Inbox task, stale instances, thread pool exhaustion, purge | Debugging | [workflow-debugging/SKILL.md](./workflow-debugging/SKILL.md) |
| Classify a workflow incident, determine required logs, Splunk queries, data gathering checklist | Triaging | [workflow-triaging/SKILL.md](./workflow-triaging/SKILL.md) |
| End-to-end lifecycle or requests spanning multiple concerns | Orchestrator | [workflow-orchestrator/SKILL.md](./workflow-orchestrator/SKILL.md) |

## How to Use

1. Match the user's request to one row in the Intent Router table above.
2. Read the linked SKILL.md for that specialist skill.
3. Follow the workflow, references, and output contract defined in that skill.
4. For broad or ambiguous requests that span multiple concerns, use the **Orchestrator** which coordinates across all specialist skills and loads foundation references.

## Cloud Service Constraints

| Constraint | Detail |
|---|---|
| No JMX | No `retryFailedWorkItems`, `countStaleWorkflows`, `restartStaleWorkflows`, `purgeCompleted` via JMX |
| `/libs` is immutable | Never write to `/libs`; use `/conf/global/` or `/apps/` overlays |
| Model design-time path | `/conf/global/settings/workflow/models/<id>` |
| Model runtime path (for API calls) | `/var/workflow/models/<id>` |
| Launcher config path | `/conf/global/settings/workflow/launcher/config/` |
| Service users | Always use `workflow-process-service` sub-service; never admin credentials |
| OSGi annotations | DS R6 (`@Component`, `@Reference` from `org.osgi.service.component.annotations`) |
| Deploy via | Cloud Manager pipeline — no Package Manager in production |

## Specialist Skills

- [workflow-model-design/SKILL.md](./workflow-model-design/SKILL.md) — model structure, step types, variables, and model XML
- [workflow-development/SKILL.md](./workflow-development/SKILL.md) — WorkflowProcess, ParticipantStepChooser, metadata, and error handling
- [workflow-triggering/SKILL.md](./workflow-triggering/SKILL.md) — Timeline UI, Manage Publication, WorkflowSession API, and HTTP API
- [workflow-launchers/SKILL.md](./workflow-launchers/SKILL.md) — launcher configuration, JCR event binding, and OOTB overlay
- [workflow-debugging/SKILL.md](./workflow-debugging/SKILL.md) — stuck workflows, failed steps, thread pools, Sling Jobs, and purge
- [workflow-triaging/SKILL.md](./workflow-triaging/SKILL.md) — symptom classification, log patterns, Splunk queries, and data gathering
- [workflow-orchestrator/SKILL.md](./workflow-orchestrator/SKILL.md) — full lifecycle orchestration across all skills
