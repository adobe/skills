# AEM as a Cloud Service Plugin

Skills for developing, assessing, migrating, and operating AEM as a Cloud Service projects — component development, Dispatcher configuration, workflows, code assessment, content distribution, migration from legacy AEM, and Rapid Development Environments.

---

## Installation

**Claude Code:**

```bash
/plugin marketplace add adobe/skills
/plugin install aem-cloud-service@adobe-skills
```

---

## Skills

### Bootstrap & scaffolding

| Skill | Description | Try it |
|-------|-------------|--------|
| [ensure-agents-md](skills/ensure-agents-md/SKILL.md) | Auto-generates `AGENTS.md` and `CLAUDE.md` from `pom.xml` when missing — tailored to the project's modules and add-ons (CIF, Forms, SPA, precompiled scripts). Runs first, before any other work. | `Set up my AEM project for AI agents` |
| [create-component](skills/create-component/SKILL.md) | Create complete AEM components following Adobe best practices: component definition, dialog XML, HTL template, Sling Model, unit tests, clientlibs (component and dialog), and optional Sling Servlet for dynamic content. | `Create a hero banner component with title, description, and CTA` |

### Dispatcher

Config authoring, advisory, performance, security, and incident response. Requires [Dispatcher MCP](https://github.com/AdobeDocs/aem-dispatcher-mcp) (`AEM_DEPLOYMENT_MODE=cloud`).

| Skill | Description | Try it |
|-------|-------------|--------|
| [config-authoring](skills/dispatcher/config-authoring/SKILL.md) | Create, modify, review, and harden Dispatcher config files (`.any`, vhost, rewrite, cache, filter) | `Add a new vhost for my site` |
| [technical-advisory](skills/dispatcher/technical-advisory/SKILL.md) | Conceptual guidance on `statfileslevel`, filter rules, URL decomposition, cache invalidation, rewrite behavior, and security headers — with public-doc citations | `Explain statfileslevel for my site` |
| [incident-response](skills/dispatcher/incident-response/SKILL.md) | Investigate runtime incidents, failures, probe regressions, and cache anomalies using Dispatcher MCP evidence | `Why are my pages returning 403?` |
| [performance-tuning](skills/dispatcher/performance-tuning/SKILL.md) | Optimize Dispatcher cache efficiency, latency, and throughput with cloud-specific baselines | `Tune my dispatcher cache for better hit ratios` |
| [security-hardening](skills/dispatcher/security-hardening/SKILL.md) | Security audits, threat models, exposure control, and header hardening | `Harden my dispatcher security headers` |
| [workflow-orchestrator](skills/dispatcher/workflow-orchestrator/SKILL.md) | Orchestrate complete Dispatcher lifecycle from design through validation, release readiness, and incident troubleshooting | `Walk me through setting up dispatcher for a new site end-to-end` |

### Workflow

Granite Workflow Engine lifecycle: design, develop, deploy, debug.

| Skill | Description | Try it |
|-------|-------------|--------|
| [workflow-model-design](skills/aem-workflow/workflow-model-design/SKILL.md) | Design workflow models — step types, variables, OR/AND splits, deployment through Cloud Manager pipeline | `Design an approval workflow with OR split` |
| [workflow-development](skills/aem-workflow/workflow-development/SKILL.md) | Implement custom WorkflowProcess steps, ParticipantStepChooser, OSGi DS R6 registration | `Create a custom workflow process step` |
| [workflow-triggering](skills/aem-workflow/workflow-triggering/SKILL.md) | Start workflows via Timeline UI, WorkflowSession API, HTTP API, or Manage Publication | `How do I trigger a workflow programmatically?` |
| [workflow-launchers](skills/aem-workflow/workflow-launchers/SKILL.md) | Configure Workflow Launchers that auto-start workflows on JCR content changes | `Set up a launcher for asset uploads` |
| [workflow-debugging](skills/aem-workflow/workflow-debugging/SKILL.md) | Debug stuck workflows, failed steps, missing Inbox tasks, thread pool exhaustion, queue backlogs, purge failures | `My workflow is stuck — help debug` |
| [workflow-triaging](skills/aem-workflow/workflow-triaging/SKILL.md) | Classify workflow incidents, determine required logs, and map to Splunk queries | `Triage this workflow failure from Cloud Manager logs` |
| [workflow-orchestrator](skills/aem-workflow/workflow-orchestrator/SKILL.md) | End-to-end workflow lifecycle orchestration across all sub-skills | `Build a complete content approval workflow` |

### Code quality & migration

| Skill | Description | Try it |
|-------|-------------|--------|
| [code-assessment](skills/code-assessment/SKILL.md) | Detect and fix AEM CS code-quality issues locally — Sling Model patterns (`@Inject` to injector-specific), deprecated APIs, scheduler, replication, resource listeners, unbounded queries, outbound call timeouts, event migration, asset manager API, outdated Maven dependencies. Verifies with `mvn compile`. | `Scan this AEM project for code issues` |
| [migration](skills/migration/SKILL.md) | Migrate legacy AEM (6.x, AMS, on-prem) to AEM CS using BPA CSV/cache or CAM/MCP discovery. Covers scheduler, ResourceChangeListener, replication, EventListener, OSGi EventHandler, DAM AssetManager, HTL lint, Classic UI dialog migration, Custom Design Widgets, static to editable template modernization, and OSGi config to Cloud Manager. One pattern per session; delegates refactors to `code-assessment`. | `Review my code for AEMaaCS migration` |

### Content distribution

| Skill | Description | Try it |
|-------|-------------|--------|
| [content-distribution](skills/content-distribution/SKILL.md) | Programmatic content publishing via the Replication API (single-path, bulk, preview-tier, async) and distribution event monitoring via Sling Distribution events | `Publish content programmatically` |

### Rapid Development Environment

| Skill | Description | Try it |
|-------|-------------|--------|
| [aem-rde](skills/aem-rde/SKILL.md) *(beta)* | Expert assistance for `aio aem rde` — deploy bundles/configs/content/frontend, inspect artifacts, tail logs, create/restore snapshots, and troubleshoot RDE issues. Activates only on explicit RDE references. | `Deploy my bundle to the RDE` |
