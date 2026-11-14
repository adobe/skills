# AEM 6.5 LTS Plugin

Skills for developing and operating AEM 6.5 LTS and Adobe Managed Services (AMS) projects — Dispatcher configuration, workflows, replication, and project bootstrap.

---

## Installation

**Claude Code:**

```bash
/plugin marketplace add adobe/skills
/plugin install aem-6-5-lts@adobe-skills
```

---

## Skills

### Bootstrap

| Skill | Description | Try it |
|-------|-------------|--------|
| [ensure-agents-md](skills/ensure-agents-md/SKILL.md) | Auto-generates `AGENTS.md` and `CLAUDE.md` for AEM 6.5 LTS projects when missing — tailored to discovered modules, add-ons, and Dispatcher layout. Runs first, before any other work. | `Set up my AEM 6.5 project for AI agents` |

### Dispatcher

Config authoring, advisory, performance, security, and incident response. Requires [Dispatcher MCP](https://github.com/AdobeDocs/aem-dispatcher-mcp) (`AEM_DEPLOYMENT_MODE=ams`).

| Skill | Description | Try it |
|-------|-------------|--------|
| [config-authoring](skills/dispatcher/config-authoring/SKILL.md) | Create, modify, review, and harden Dispatcher config files (`.any`, vhost, rewrite, cache, filter) for AEM 6.5 LTS and AMS | `Add a new vhost for my AMS site` |
| [technical-advisory](skills/dispatcher/technical-advisory/SKILL.md) | Conceptual guidance on `statfileslevel`, filter rules, URL decomposition, cache invalidation, rewrite behavior, and security headers | `Explain statfileslevel for my AMS setup` |
| [incident-response](skills/dispatcher/incident-response/SKILL.md) | Investigate runtime incidents, failures, and cache anomalies on AMS Dispatcher | `My pages are returning 403 on the AMS dispatcher` |
| [performance-tuning](skills/dispatcher/performance-tuning/SKILL.md) | Optimize Dispatcher cache efficiency, latency, and throughput for AMS environments | `Tune my AMS dispatcher cache` |
| [security-hardening](skills/dispatcher/security-hardening/SKILL.md) | Security audits, threat models, exposure control, and header hardening for AMS Dispatcher | `Harden my AMS dispatcher security headers` |
| [workflow-orchestrator](skills/dispatcher/workflow-orchestrator/SKILL.md) | Orchestrate complete Dispatcher lifecycle from design through validation and incident troubleshooting | `Walk me through AMS dispatcher setup end-to-end` |

### Workflow

Granite Workflow Engine lifecycle with JMX, Felix Console, and direct log access.

| Skill | Description | Try it |
|-------|-------------|--------|
| [workflow-model-design](skills/aem-workflow/workflow-model-design/SKILL.md) | Design workflow models — step types, variables, OR/AND splits | `Design an approval workflow with OR split` |
| [workflow-development](skills/aem-workflow/workflow-development/SKILL.md) | Implement custom WorkflowProcess steps, ParticipantStepChooser, OSGi service registration | `Create a custom workflow process step` |
| [workflow-triggering](skills/aem-workflow/workflow-triggering/SKILL.md) | Start workflows via Timeline UI, WorkflowSession API, HTTP API, Manage Publication, or replication triggers | `How do I trigger a workflow on content activation?` |
| [workflow-launchers](skills/aem-workflow/workflow-launchers/SKILL.md) | Configure Workflow Launchers that auto-start workflows on JCR content changes | `Set up a launcher for asset uploads` |
| [workflow-debugging](skills/aem-workflow/workflow-debugging/SKILL.md) | Debug stuck workflows, failed steps, missing Inbox tasks, thread pool exhaustion, queue backlogs — with JMX and direct log access | `My workflow is stuck — help debug` |
| [workflow-triaging](skills/aem-workflow/workflow-triaging/SKILL.md) | Classify workflow incidents, gather JMX/Splunk data, and map to runbooks | `Triage this workflow failure` |
| [workflow-orchestrator](skills/aem-workflow/workflow-orchestrator/SKILL.md) | End-to-end workflow lifecycle orchestration across all sub-skills | `Build a complete content approval workflow` |

### Replication

Content distribution lifecycle from agent configuration to troubleshooting.

| Skill | Description | Try it |
|-------|-------------|--------|
| [configure-replication-agent](skills/aem-replication/configure-replication-agent/SKILL.md) | Configure replication agents for publishing, dispatcher flush, and reverse replication | `Set up a dispatcher flush agent` |
| [replicate-content](skills/aem-replication/replicate-content/SKILL.md) | Activate and deactivate content using UI, workflows, and package manager | `How do I activate a page tree?` |
| [replication-api](skills/aem-replication/replication-api/SKILL.md) | Use the Replication API programmatically in custom code — 57 Java examples for OSGi services, servlets, and workflow steps | `Publish content programmatically from a servlet` |
| [troubleshoot-replication](skills/aem-replication/troubleshoot-replication/SKILL.md) | Diagnose and fix blocked queues, connectivity failures, and distribution problems — 12+ troubleshooting scenarios | `My replication queue is blocked` |
| [replication-orchestrator](skills/aem-replication/replication-orchestrator/SKILL.md) | End-to-end replication lifecycle orchestration across all sub-skills — new environment setup, production incidents, performance optimization, and migration preparation | `Set up replication for a new AEM 6.5 environment end-to-end` |
