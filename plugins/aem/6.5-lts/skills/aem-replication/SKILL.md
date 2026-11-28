---
name: aem-replication
description: |
  Use for AEM 6.5 LTS or AMS replication: configure content or Dispatcher Flush agents, publish
  or unpublish content, flush the Dispatcher cache, use the Replication API, inspect queues, or
  troubleshoot distribution. For AEM as a Cloud Service, use the Cloud Service Content Distribution skill.
license: Apache-2.0
compatibility: "AEM 6.5 LTS or AMS agent-based replication. AEM as a Cloud Service also exposes the Replication API, backed by Sling Content Distribution; use Cloud Service-specific guidance for its managed-agent behavior."
metadata:
  version: "1.0"
  aem_version: "6.5 LTS"
---

# AEM 6.5 LTS Replication

Use this top-level skill to route AEM 6.5 LTS/AMS requests to the bundled reference guides.

| Task | Guide |
|---|---|
| Configure default, flush, reverse, or publish agents | [Configure Replication Agent](./references/configure-replication-agent.md) |
| Activate or deactivate pages, assets, or trees | [Replicate Content](./references/replicate-content.md) |
| Programmatic replication, listeners, and APIs | [Replication API](./references/replication-api.md) |
| Diagnose queues, connectivity, or missing content | [Troubleshoot Replication](./references/troubleshoot-replication.md) |
| Coordinate multi-step replication work | [Replication Orchestrator](./references/replication-orchestrator.md) |

## Guardrails

- Use explicit trusted publish-source addresses for Dispatcher Flush access; never recommend a wildcard client allow.
- Verify API claims against the 6.5 LTS Javadocs; do not imply a live queue or runtime check without obtaining it.

## Foundation references

- [Agent Types](./references/replication-foundation/agent-types.md)
- [Queue Mechanics](./references/replication-foundation/queue-mechanics.md)
- [AEM 6.5 LTS Guardrails](./references/replication-foundation/65-lts-guardrails.md)
- [API Quick Reference](./references/replication-foundation/api-reference.md)

## Official documentation

- [AEM 6.5 LTS replication](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/configuring/replication)
- [Replication API Javadocs](https://developer.adobe.com/experience-manager/reference-materials/6-5-lts/javadoc/com/day/cq/replication/package-summary.html)
