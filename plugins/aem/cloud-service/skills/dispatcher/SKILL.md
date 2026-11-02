---
name: dispatcher
description: |
  Use for AEM as a Cloud Service Dispatcher work: author or validate .any filters, vhosts, rewrite
  and cache rules, investigate incidents, and review performance or security. Routes Cloud-specific
  work to specialist skills; use the 6.5 LTS Dispatcher skill for AMS or on-prem environments.
license: Apache-2.0
compatibility: Tool-dependent checks require Dispatcher MCP configured for cloud variant (`AEM_DEPLOYMENT_MODE=cloud`); bounded explanation/static review is available without MCP.
allowed-tools: validate lint sdk trace_request inspect_cache monitor_metrics tail_logs
metadata:
  mcp-tool-contract: core-7-tools
---

# AEM Cloud Service Dispatcher

Route user requests to the appropriate specialist skill based on intent.

## Intent Router

| User Intent | Skill | Path |
|---|---|---|
| Create, modify, review, or harden dispatcher config files (`.any`, vhost, rewrite, cache, filter) | Config Authoring | [config-authoring/SKILL.md](./config-authoring/SKILL.md) |
| Conceptual questions (`statfileslevel`, filter rules, URL decomposition, cache invalidation, rewrite behavior, security headers) | Technical Advisory | [technical-advisory/SKILL.md](./technical-advisory/SKILL.md) |
| Investigate runtime incidents, failures, probe regressions, or cache anomalies | Incident Response | [incident-response/SKILL.md](./incident-response/SKILL.md) |
| Optimize cache efficiency, latency, and throughput | Performance Tuning | [performance-tuning/SKILL.md](./performance-tuning/SKILL.md) |
| Security audit, threat model, exposure control, header hardening | Security Hardening | [security-hardening/SKILL.md](./security-hardening/SKILL.md) |
| End-to-end lifecycle (design → implement → validate → release → incident) or requests spanning multiple concerns | Workflow Orchestrator | [workflow-orchestrator/SKILL.md](./workflow-orchestrator/SKILL.md) |

## How to Use

1. Match the user's request to one row in the Intent Router table above.
2. Read the linked SKILL.md for that specialist skill.
3. Follow the workflow, references, and output contract defined in that skill.
4. For broad or ambiguous requests that span multiple concerns, use the **Workflow Orchestrator** which coordinates across all specialist skills.

## MCP Tool Contract

The configured Dispatcher MCP supports publish-layer checks only; do not use it as an Author-tier tool. When Dispatcher MCP tools are unavailable, limit work to explanation and static review; report each tool-dependent check as NOT VERIFIED and never fabricate tool output.

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
- [technical-advisory/SKILL.md](./technical-advisory/SKILL.md) — policy, documentation, cloud guardrails, and evidence planning
- [incident-response/SKILL.md](./incident-response/SKILL.md) — runtime incident triage and remediation
- [performance-tuning/SKILL.md](./performance-tuning/SKILL.md) — cache and throughput optimization
- [security-hardening/SKILL.md](./security-hardening/SKILL.md) — security audit and hardening
- [workflow-orchestrator/SKILL.md](./workflow-orchestrator/SKILL.md) — full lifecycle orchestration across all skills
