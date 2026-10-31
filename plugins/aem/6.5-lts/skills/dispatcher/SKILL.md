---
name: dispatcher
description: |
  Single entry point for all AEM 6.5 LTS Dispatcher skills. Covers config authoring,
  technical advisory, incident response, performance tuning, security hardening, and full lifecycle
  orchestration for the Adobe Dispatcher Apache HTTP Server module and its HTTPD/dispatcher configuration
  in AEM 6.5 LTS and AMS environments.
license: Apache-2.0
compatibility: Tool-dependent checks require exposed Dispatcher MCP tools configured for AMS (`AEM_DEPLOYMENT_MODE=ams`); bounded explanation/static review is available without MCP.
allowed-tools: validate lint sdk trace_request inspect_cache monitor_metrics tail_logs
metadata:
  mcp-tool-contract: core-7-tools
---

# AEM 6.5 LTS Dispatcher

Route user requests to the appropriate specialist skill based on intent.

## Runtime and Availability Preflight

Before routing, workflows, edits, or commands, confirm the target project/module runtime from active dependencies, deployment configuration, and Dispatcher layout, not this directory or `AEM_DEPLOYMENT_MODE` alone:

- Cloud evidence: primary `aem-sdk-api` and Cloud target/defaults; `opt-in/USE_SOURCES_DIRECTLY` identifies flexible mode, but legacy Cloud may lack it.
- AMS evidence: primary `uber-jar`/6.5 product version and AMS target/layout such as `ams_default.vars` and tier farms. Confirm actual LTS version/hosting; shared `conf.d`/`conf.dispatcher.d` directories alone prove neither runtime.
- On a wrong-runtime mismatch, STOP; explicitly route to `cloud-service/skills/dispatcher` or `6.5-lts/skills/dispatcher`, with no wrong-mode commands. For missing/conflicting evidence, ask focused confirmation of target runtime and module/source root; make no runtime-specific edits or commands until resolved.
- Discover actual AMS MCP tools and host/log prerequisites separately from mode. All dependent workflows and checklists are conditional: permit bounded conceptual explanation/static source review without MCP; report each required tool-dependent check BLOCKED / NOT VERIFIED with its missing prerequisite and leave checklist items incomplete.
- Never fabricate output or substitute another runtime's tools. Distinguish static review, file/baseline or Apache host syntax checks, and live target observations; none substitutes for missing MCP evidence or proves production behavior. No runtime/release sign-off with required checks unavailable. Core-7 signatures are repository contracts, not publicly verified Adobe SDK interfaces; inspect exposed schemas/installed help before execution.

Sources: [AMS layout](https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/basic-file-layout), [immutable files](https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/immutable-files), and [flushing](https://experienceleague.adobe.com/en/docs/experience-manager-learn/ams/dispatcher/disp-flushing) (updated 2026-09-22). Preserve deny-first explicit publish IP flush ACLs, mutable includes, tier variables, and author/publish separation. Java API JAR compilation does not verify Apache configuration or private MCP signatures.

## Intent Router

| User Intent | Skill | Path |
|---|---|---|
| Create, modify, review, or harden dispatcher config files (`.any`, vhost, rewrite, cache, filter) | Config Authoring | [config-authoring/SKILL.md](./config-authoring/SKILL.md) |
| Conceptual questions (`statfileslevel`, filter rules, URL decomposition, cache invalidation, rewrite behavior, security headers) | Technical Advisory | [technical-advisory/SKILL.md](./technical-advisory/SKILL.md) |
| Investigate runtime incidents, failures, or cache anomalies | Incident Response | [incident-response/SKILL.md](./incident-response/SKILL.md) |
| Optimize cache efficiency, latency, and throughput | Performance Tuning | [performance-tuning/SKILL.md](./performance-tuning/SKILL.md) |
| Security audit, threat model, exposure control, header hardening | Security Hardening | [security-hardening/SKILL.md](./security-hardening/SKILL.md) |
| End-to-end lifecycle (design → implement → validate → release → incident) or requests spanning multiple concerns | Workflow Orchestrator | [workflow-orchestrator/SKILL.md](./workflow-orchestrator/SKILL.md) |

## How to Use

1. Match the user's request to one row in the Intent Router table above.
2. Read the linked SKILL.md for that specialist skill.
3. Follow the workflow, references, and output contract defined in that skill.
4. For broad or ambiguous requests that span multiple concerns, use the **Workflow Orchestrator** which coordinates across all specialist skills.

## MCP Tool Contract

All specialist skills share the same core-7 MCP tool set:

- `validate` — static config validation
- `lint` — deep/order-aware linting
- `sdk` — SDK check-files and diff-baseline
- `trace_request` — trace a request through dispatcher
- `inspect_cache` — inspect cache state
- `monitor_metrics` — runtime metrics
- `tail_logs` — log tailing

## Specialist Skills

- [config-authoring/SKILL.md](./config-authoring/SKILL.md) — config file design, edits, and validation
- [technical-advisory/SKILL.md](./technical-advisory/SKILL.md) — policy, documentation, and evidence planning
- [incident-response/SKILL.md](./incident-response/SKILL.md) — runtime incident triage and remediation
- [performance-tuning/SKILL.md](./performance-tuning/SKILL.md) — cache and throughput optimization
- [security-hardening/SKILL.md](./security-hardening/SKILL.md) — security audit and hardening
- [workflow-orchestrator/SKILL.md](./workflow-orchestrator/SKILL.md) — full lifecycle orchestration across all skills
