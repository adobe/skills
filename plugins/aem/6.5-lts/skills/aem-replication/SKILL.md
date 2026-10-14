---
name: aem-replication
description: |
  Single entry point for all AEM 6.5 LTS Replication skills. Covers configuring replication agents,
  activating/deactivating content, using the Replication API programmatically, and troubleshooting
  distribution issues for Adobe Experience Manager 6.5 LTS. Use when the user asks about publishing,
  unpublishing, replicating, or distributing content in AEM 6.5 LTS or AMS — including flushing the
  dispatcher cache, fixing stuck or blocked replication queues, or configuring replication agents.
license: Apache-2.0
compatibility: Requires AEM 6.5 LTS or Adobe Managed Services (AMS). NOT compatible with AEM as a Cloud Service (use Sling Distribution API instead).
metadata:
  version: "1.0"
  aem_version: "6.5 LTS"
---

# AEM 6.5 LTS Replication

Route user requests to the appropriate specialist skill based on intent.

## Intent Router

| User Intent | Skill | Path |
|---|---|---|
| Configure replication agents (default, dispatcher flush, reverse replication) | Configure Replication Agent | [configure-replication-agent/SKILL.md](./configure-replication-agent/SKILL.md) |
| Activate or deactivate content using UI or workflows | Replicate Content | [replicate-content/SKILL.md](./replicate-content/SKILL.md) |
| Use Replication API programmatically in custom code | Replication API | [replication-api/SKILL.md](./replication-api/SKILL.md) |
| Diagnose blocked queues, connectivity issues, or distribution problems | Troubleshoot Replication | [troubleshoot-replication/SKILL.md](./troubleshoot-replication/SKILL.md) |
| End-to-end workflows: new environment setup, incident response, performance optimization | Replication Orchestrator | [replication-orchestrator/SKILL.md](./replication-orchestrator/SKILL.md) |

## How to Use

1. Match the user's request to one row in the Intent Router table above.
2. Read the linked SKILL.md for that specialist skill.
3. Follow the workflow and guidance defined in that skill.
4. For complex scenarios spanning multiple skills (e.g., configure agent then troubleshoot), start with the primary intent and cross-reference as needed.
5. If the request doesn't clearly match a single row, ask the user to clarify before proceeding.

## Skill Overview

- **Configure Replication Agent** — Set up default, Dispatcher Flush, reverse, and multi-publish agents. Use for first-time setup, adding publish instances, or reconfiguring agents.
- **Replicate Content** — Activate/deactivate content via Quick Publish, Manage Publication, Tree Activation, Package Manager, workflows, or scheduled activation. Use for publishing/unpublishing pages, assets, or DAM content.
- **Replication API** — Programmatic replication via `Replicator`, `ReplicationOptions`, `ReplicationStatus`, `AgentManager`, `ReplicationQueue`, and `ReplicationListener`. Use for custom code integration, bulk operations, workflow process steps, or servlets.
- **Troubleshoot Replication** — Diagnose blocked queues, connection errors, missing content, agent misconfiguration, and stuck jobs. Use when replication fails, underperforms, or content isn't distributing.
- **Replication Orchestrator** — Coordinates multi-step scenarios across the other sub-skills: environment setup, incident response, performance optimization, migration prep.

## Common Workflows

### First-Time Setup
1. Use **Configure Replication Agent** to set up default agent
2. Use **Replicate Content** to test with a sample page
3. If issues occur, use **Troubleshoot Replication**

### Production Operations
1. Use **Replicate Content** for day-to-day publishing
2. Use **Replication API** for automated/bulk operations
3. Use **Troubleshoot Replication** when issues arise

### Advanced Integration
1. Use **Replication API** to understand available methods
2. Use **Configure Replication Agent** to understand agent configuration
3. Use **Troubleshoot Replication** for debugging custom replication code

## Foundation References

Shared reference materials used across all replication skills:

- **[Agent Types](./references/replication-foundation/agent-types.md)**: Default, Dispatcher Flush, Reverse, and Static agents
- **[Queue Mechanics](./references/replication-foundation/queue-mechanics.md)**: FIFO processing, retry logic, queue management
- **[AEM 6.5 LTS Guardrails](./references/replication-foundation/65-lts-guardrails.md)**: Service users, timeouts, batch limits, best practices
- **[API Quick Reference](./references/replication-foundation/api-reference.md)**: Replicator, ReplicationOptions, ReplicationStatus methods

## Official Documentation

All skills reference official Adobe AEM 6.5 LTS documentation:
- [Replication Documentation](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/configuring/replication)
- [Replication Troubleshooting](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/configuring/troubleshoot-rep)
- [Replication API JavaDoc](https://developer.adobe.com/experience-manager/reference-materials/6-5-lts/javadoc/com/day/cq/replication/package-summary.html)

## Related Skills

- **AEM Workflow**: Integrate replication with approval workflows
- **Dispatcher**: Configure Dispatcher Flush agents for cache invalidation

## Migration to AEM as a Cloud Service

AEM as a Cloud Service uses the **Sling Distribution API** instead of replication agents. If planning migration:
- Review [Cloud Service Distribution Documentation](https://experienceleague.adobe.com/docs/experience-manager-cloud-service/content/operations/distribution.html)
- For code migration patterns, use the `code-assessment` skill: `skills/aem/cloud-service/skills/code-assessment/replication/SKILL.md`
- Avoid agent-specific coupling (filter by agent ID) to reduce migration complexity
