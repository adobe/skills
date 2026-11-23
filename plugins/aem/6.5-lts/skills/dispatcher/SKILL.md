---
name: dispatcher
description: |
  Use when asked about AEM 6.5 LTS or AMS Dispatcher `.any` farms, filters, vhosts, cache, flush,
  rewrite rules, security, performance, or publish-tier delivery. Covers configuration authoring,
  technical guidance, incident response, and lifecycle work; tool-dependent checks require an
  explicitly approved tool.
license: Apache-2.0
compatibility: AEM 6.5 LTS/AMS Dispatcher configuration; this plugin does not provide an AMS Dispatcher MCP.
allowed-tools: validate lint sdk trace_request inspect_cache monitor_metrics tail_logs
metadata:
  mcp-tool-contract: core-7-tools
---

# AEM 6.5 LTS Dispatcher

Route user requests to the appropriate specialist skill based on intent.

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
5. If no row fits, ask a clarifying question. If a linked guide is unavailable, provide only bounded explanation/static review and mark tool-dependent checks `NOT VERIFIED`.

## Runtime Selection

Before runtime-specific edits, confirm project evidence identifies AEM 6.5 LTS or AMS. If the runtime evidence is missing or conflicting, ask the user; do not silently use Cloud Service instructions.

## MCP Tool Contract

This plugin does not provide an AMS Dispatcher MCP. For 6.5 LTS/AMS, limit work to explanation and static review unless an approved tool is explicitly configured; report each unavailable tool-dependent check as NOT VERIFIED and never fabricate tool output. This entrypoint's runtime and MCP gates govern every linked specialist; do not follow a specialist guide to invoke an unavailable tool or claim runtime verification.
