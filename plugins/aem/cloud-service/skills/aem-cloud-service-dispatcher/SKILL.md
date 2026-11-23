---
name: aem-cloud-service-dispatcher
description: |
  Use when the user needs help with AEM as a Cloud Service Dispatcher: author or review farms, vhosts,
  cache, filters, or rewrite configuration; troubleshoot publish delivery; assess security or
  performance; or plan approved Dispatcher MCP checks.
license: Apache-2.0
compatibility: Tool-dependent checks require Dispatcher MCP configured for cloud variant (`AEM_DEPLOYMENT_MODE=cloud`); bounded explanation/static review is available without MCP.
allowed-tools: validate lint sdk trace_request inspect_cache monitor_metrics tail_logs
metadata:
  mcp-tool-contract: core-7-tools
---

# AEM Cloud Service Dispatcher

Route user requests to the appropriate specialist guide based on intent.

## Intent Router

| User Intent | Specialist guide | Path |
|---|---|---|
| Create, modify, review, or harden dispatcher config files (`.any`, vhost, rewrite, cache, filter) | Config Authoring | [config-authoring/GUIDE.md](./references/config-authoring/GUIDE.md) |
| Conceptual questions (`statfileslevel`, filter rules, URL decomposition, cache invalidation, rewrite behavior, security headers) | Technical Advisory | [technical-advisory/GUIDE.md](./references/technical-advisory/GUIDE.md) |
| Investigate runtime incidents, failures, probe regressions, or cache anomalies | Incident Response | [incident-response/GUIDE.md](./references/incident-response/GUIDE.md) |
| Optimize cache efficiency, latency, and throughput | Performance Tuning | [performance-tuning/GUIDE.md](./references/performance-tuning/GUIDE.md) |
| Security audit, threat model, exposure control, header hardening | Security Hardening | [security-hardening/GUIDE.md](./references/security-hardening/GUIDE.md) |
| End-to-end lifecycle (design → implement → validate → release → incident) or requests spanning multiple concerns | Workflow Orchestrator | [workflow-orchestrator/GUIDE.md](./references/workflow-orchestrator/GUIDE.md) |

## How to Use

1. Before runtime-specific edits, verify project evidence identifies AEM as a Cloud Service. If evidence is missing or conflicting, ask the user; do not silently choose 6.5 LTS/AMS instructions.
2. Match the user's request to one row in the Intent Router table above.
3. Read the linked specialist guide and follow its workflow, references, and output contract.
4. If no row fits, ask a clarifying question. If a linked guide is unavailable, use the fallback in the MCP Tool Contract.

## MCP Tool Contract

The configured Dispatcher MCP supports publish-layer checks only; do not use it as an Author-tier tool. When tools are unavailable or a linked guide cannot be loaded, limit work to explanation and static review; report each tool-dependent check as NOT VERIFIED and never fabricate tool output. This entrypoint's runtime and MCP gates govern every linked specialist and cannot be bypassed by a routed guide.

The specialist guides share the same core-7 MCP tool set:

- `validate` — static config validation
- `lint` — deep/order-aware linting
- `sdk` — SDK check-files and diff-baseline
- `trace_request` — trace a request through dispatcher
- `inspect_cache` — inspect cache state
- `monitor_metrics` — runtime metrics
- `tail_logs` — log tailing
