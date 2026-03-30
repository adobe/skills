---
name: aem-workflow
description: |
  Single entry point for all AEM 6.5 LTS Workflow skills. Covers workflow model design,
  custom process step and participant chooser development, launcher configuration, workflow triggering,
  and production support including debugging stuck/failed workflows, triaging incidents with JMX,
  Splunk, direct log access, thread pool analysis, and Sling Job diagnostics for the Granite Workflow Engine.
license: Apache-2.0
compatibility: Requires AEM 6.5 LTS or Adobe Managed Services (AMS). Maven project structure with core and ui.apps modules.
metadata:
  version: "1.0"
  aem_version: "6.5 LTS"
---

# AEM 6.5 LTS Workflow

Route user requests to the appropriate specialist skill based on intent.

## Intent Router

| User Intent | Skill | Path |
|---|---|---|
| Create a workflow model, add steps, design OR/AND splits, configure variables | Model Design | [workflow-model-design/SKILL.md](./workflow-model-design/SKILL.md) |
| Implement a custom WorkflowProcess step, ParticipantStepChooser, OSGi service registration | Development | [workflow-development/SKILL.md](./workflow-development/SKILL.md) |
| Start a workflow from code, HTTP API, Timeline UI, Manage Publication, replication triggers | Triggering | [workflow-triggering/SKILL.md](./workflow-triggering/SKILL.md) |
| Configure a launcher, auto-start on asset upload, overlay OOTB launcher | Launchers | [workflow-launchers/SKILL.md](./workflow-launchers/SKILL.md) |
| Workflow stuck, failed step, missing Inbox task, stale instances, thread pool exhaustion, purge | Debugging | [workflow-debugging/SKILL.md](./workflow-debugging/SKILL.md) |
| Classify a workflow incident, determine required logs, JMX diagnostics, Splunk queries | Triaging | [workflow-triaging/SKILL.md](./workflow-triaging/SKILL.md) |
| End-to-end lifecycle or requests spanning multiple concerns | Orchestrator | [workflow-orchestrator/SKILL.md](./workflow-orchestrator/SKILL.md) |

## How to Use

1. Match the user's request to one row in the Intent Router table above.
2. Read the linked SKILL.md for that specialist skill.
3. Follow the workflow, references, and output contract defined in that skill.
4. For broad or ambiguous requests that span multiple concerns, use the **Orchestrator** which coordinates across all specialist skills and loads foundation references.

## 6.5 LTS / AMS Capabilities

| Capability | Detail |
|---|---|
| JMX | Full access via Felix Console (`/system/console/jmx`) or JMX client |
| Retry failed items | JMX `retryFailedWorkItems` or Inbox Retry |
| Stale detection | JMX `countStaleWorkflows` |
| Stale restart | JMX `restartStaleWorkflows(dryRun=true)` then execute |
| Purge | JMX `purgeCompleted(dryRun=true)` or Purge Scheduler |
| Log access | Direct filesystem (`crx-quickstart/logs/`) or AMS log access |
| Config changes | Felix Console, OSGi config in repo, or CRX/DE |

## 6.5 LTS Guardrails

| Rule | Detail |
|---|---|
| Avoid editing `/libs` | Use overlays under `/apps` or store at `/conf/global` |
| Model design-time path | `/conf/global/settings/workflow/models/<id>` (preferred) or `/etc/workflow/models/<id>` (legacy) |
| Model runtime path (for API calls) | `/var/workflow/models/<id>` |
| Launcher config paths | `/conf/global/settings/workflow/launcher/config/` (preferred) |
| Service users | Use `ResourceResolverFactory.getServiceResourceResolver()` with a sub-service; avoid `loginAdministrative` |
| OSGi annotations | DS R6 preferred; Felix SCR still supported on 6.5 LTS |
| Deploy via | Package Manager, Maven + Content Package Plugin |

## Specialist Skills

- [workflow-model-design/SKILL.md](./workflow-model-design/SKILL.md) — model structure, step types, variables, and model XML
- [workflow-development/SKILL.md](./workflow-development/SKILL.md) — WorkflowProcess, ParticipantStepChooser, metadata, and error handling
- [workflow-triggering/SKILL.md](./workflow-triggering/SKILL.md) — Timeline UI, Manage Publication, WorkflowSession API, HTTP API, and replication triggers
- [workflow-launchers/SKILL.md](./workflow-launchers/SKILL.md) — launcher configuration, JCR event binding, and OOTB overlay
- [workflow-debugging/SKILL.md](./workflow-debugging/SKILL.md) — stuck workflows, failed steps, JMX remediation, thread pools, and purge
- [workflow-triaging/SKILL.md](./workflow-triaging/SKILL.md) — symptom classification, JMX diagnostics, log patterns, Splunk queries, and data gathering
- [workflow-orchestrator/SKILL.md](./workflow-orchestrator/SKILL.md) — full lifecycle orchestration across all skills
