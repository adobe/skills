---
name: aem-replication
description: |
  Single entry point for all AEM 6.5 LTS Replication skills. Covers configuring replication agents,
  activating/deactivating content, using the Replication API programmatically, and troubleshooting
  distribution issues for Adobe Experience Manager 6.5 LTS.
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

## Skill Overview

### Configure Replication Agent

Set up and configure replication agents for:
- **Default agents**: Author to Publish content distribution
- **Dispatcher Flush agents**: Cache invalidation
- **Reverse replication**: Publish to Author user-generated content flow
- **Multiple publish instances**: Load balancing and high availability

**When to use:** First-time setup, adding new publish instances, reconfiguring agents

### Replicate Content

Activate and deactivate content through:
- **Quick Publish**: Simple one-click activation
- **Manage Publication**: Advanced scheduling and approval workflows
- **Tree Activation**: Hierarchical bulk publishing
- **Package Manager**: Specific content set distribution
- **Workflows**: Approval-based publishing
- **Scheduled Activation**: Time-based content publishing

**When to use:** Publishing pages, assets, or DAM content; unpublishing content

### Replication API

Programmatic replication using official AEM 6.5 LTS public APIs:
- **Replicator interface**: Core replication methods
- **ReplicationOptions**: Configure synchronous/asynchronous, agent filtering
- **ReplicationStatus**: Query replication state
- **AgentManager, ReplicationQueue, ReplicationListener**: Advanced queue management and monitoring

**When to use:** Custom code integration, bulk operations, workflow process steps, servlets

### Troubleshoot Replication

Diagnose and fix common issues:
- **Blocked queues**: FIFO queue failures
- **Connection errors**: Network, authentication, SSL issues
- **Content not appearing**: Dispatcher cache, permissions
- **Agent configuration**: URI, credentials, triggers
- **Event queue issues**: Stuck replication jobs

**When to use:** Replication failures, performance issues, content not distributing

### Replication Orchestrator

Coordinates end-to-end replication workflows spanning multiple sub-skills:
- **New Environment Setup**: Configure agents → Test replication → Troubleshoot
- **Production Incident Response**: Diagnose → Fix → Verify
- **Performance Optimization**: Monitor → Tune → Validate
- **Migration Preparation**: Audit → Plan → Execute

**When to use:** Multi-step scenarios requiring coordination across configure, replicate, API, and troubleshoot skills

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
- For code migration patterns, see `skills/aem/cloud-service/skills/best-practices/references/replication.md`
- Avoid agent-specific coupling (filter by agent ID) to reduce migration complexity
