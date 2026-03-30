# AEM Cloud Service Workflow Skills

This package contains workflow skills for **AEM as a Cloud Service** — covering both **development** (building workflows) and **production support** (debugging and triaging).

"Workflow" here means the **Granite Workflow Engine** — models, process steps, participant steps, launchers, Sling Jobs, and the `WorkflowSession` API. It does not mean CI/CD pipelines.

## Scope

### Development
- Designing and deploying workflow models (XML, Workflow Model Editor)
- Implementing custom `WorkflowProcess` and `ParticipantStepChooser` Java components
- Configuring workflow launchers that automatically start workflows on JCR events
- Starting workflows manually, via Manage Publication, or programmatically via the API
- Cloud Service deployment guardrails (immutable `/libs`, Cloud Manager, service users)

### Production Support
- Debugging stuck, failed, or stale workflow instances
- Triaging workflow incidents from logs, Splunk, or Cloud Manager
- Investigating missing Inbox tasks, launcher failures, and permissions errors
- Analyzing thread pool exhaustion, Sling Job queue backlogs, and auto-advancement failures
- Determining correct Splunk queries and log patterns for workflow errors

## Skill Map

| Skill | Category | Purpose |
|-------|----------|---------|
| `workflow-orchestrator/` | Entry point | Classifies requests and routes to the right specialist skill |
| `workflow-model-design/` | Development | Step types, model XML, OR/AND splits, variables, model deployment |
| `workflow-development/` | Development | `WorkflowProcess`, `ParticipantStepChooser`, OSGi registration |
| `workflow-triggering/` | Development | Manual, Manage Publication, programmatic API, HTTP API |
| `workflow-launchers/` | Development | `cq:WorkflowLauncher` nodes: event types, glob patterns, conditions |
| `workflow-debugging/` | Production Support | Symptom → runbook, decision trees, thread pool analysis, remediation |
| `workflow-triaging/` | Production Support | Symptom classification, log patterns, Splunk queries, data gathering |

## How To Start

For broad or first-time requests, start with `workflow-orchestrator/SKILL.md`.

## Cloud Service Constraints

- No JMX access — use Developer Console, Cloud Manager logs, custom HTTP APIs
- Config changes via code in Git + Cloud Manager pipeline deploy
- Thread dumps via Developer Console or support request
- Purge via Purge Scheduler (no JMX `purgeCompleted`)
- Retry failed work items via Inbox Retry (no JMX `retryFailedWorkItems`)
