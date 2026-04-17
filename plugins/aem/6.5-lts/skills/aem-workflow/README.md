# AEM 6.5 LTS / AMS Workflow Skills

This package contains workflow skills for **AEM 6.5 LTS** and **Adobe Managed Services (AMS)** — covering both **development** (building workflows) and **production support** (debugging and triaging).

"Workflow" here means the **Granite Workflow Engine** — models, process steps, participant steps, launchers, Sling Jobs, and the `WorkflowSession` API. It does not mean CI/CD pipelines.

## Scope

### Development
- Designing and deploying workflow models (XML, Workflow Model Editor, `/etc/workflow/models/`)
- Implementing custom `WorkflowProcess` and `ParticipantStepChooser` Java components
- Configuring workflow launchers that automatically start workflows on JCR events
- Starting workflows manually, via Manage Publication, or programmatically via the API
- 6.5 LTS deployment patterns: Package Manager, Maven, Felix SCR annotations, legacy `/etc` paths

### Production Support
- Debugging stuck, failed, or stale workflow instances with JMX
- Triaging workflow incidents from logs, Splunk, or direct filesystem access
- Using JMX MBeans for workflow diagnostics (retry, stale restart, purge, queue info)
- Analyzing thread pool exhaustion, Sling Job queue backlogs, and auto-advancement failures
- Analyzing configuration status ZIPs and thread dumps

## Skill Map

| Skill | Category | Purpose |
|-------|----------|---------|
| `workflow-orchestrator/` | Entry point | Classifies requests and routes to the right specialist skill |
| `workflow-model-design/` | Development | Step types, model XML, OR/AND splits, variables, legacy `/etc` vs `/conf` |
| `workflow-development/` | Development | `WorkflowProcess`, `ParticipantStepChooser`, Felix SCR and DS R6 registration |
| `workflow-triggering/` | Development | Manual, Manage Publication, API, HTTP, replication-linked triggers |
| `workflow-launchers/` | Development | `cq:WorkflowLauncher` nodes: event types, glob patterns, conditions, legacy paths |
| `workflow-debugging/` | Production Support | Symptom → runbook, decision trees, thread pool analysis, JMX remediation |
| `workflow-triaging/` | Production Support | Symptom classification, log patterns, Splunk queries, JMX diagnostics |

## How To Start

For broad or first-time requests, start with `workflow-orchestrator/SKILL.md`.

## 6.5 LTS / AMS Capabilities

- Full JMX access via Felix Console or JMX client
- Direct filesystem log access or AMS log access
- Configuration status ZIP from Felix Console → Status → Configuration Status
- Thread dumps via jstack or AMS support request
- Config changes via Felix Console or OSGi config in repository
- Purge via JMX `purgeCompleted` or Purge Scheduler
- Retry via JMX `retryFailedWorkItems` or Inbox Retry
