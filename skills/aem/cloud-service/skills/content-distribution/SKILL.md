---
name: content-distribution
description: |
  Single entry point for all content distribution skills. Covers content publishing,
  Preview tier management, Sling Content Distribution API, CDN cache management, and troubleshooting
  distribution issues.
license: Apache-2.0
compatibility: AEM as a Cloud Service ONLY. For AEM 6.5 LTS/AMS on-prem, use aem-replication skill instead.
metadata:
  version: "1.0"
  aem_version: "Cloud Service"
---

# Content Distribution

Route user requests to the appropriate specialist skill based on intent.

## Intent Router

| User Intent | Skill | Path |
|---|---|---|
| Publish content to Publish or Preview tiers | Publish Content | [publish-content/SKILL.md](./publish-content/SKILL.md) |
| Manage Preview tier, preview workflows, and content preview | Preview Tier Management | [preview-tier/SKILL.md](./preview-tier/SKILL.md) |
| Use Sling Distribution API, event handling, or custom workflows | Content Distribution API | [distribution-api/SKILL.md](./distribution-api/SKILL.md) |
| Diagnose stuck content, CDN cache issues, or distribution problems | Troubleshoot Distribution | [troubleshoot-distribution/SKILL.md](./troubleshoot-distribution/SKILL.md) |
| End-to-end workflows: new environment setup, go-live preparation, CDN optimization | Content Distribution Orchestrator | [orchestrator/SKILL.md](./orchestrator/SKILL.md) |

## How to Use

1. Match the user's request to one row in the Intent Router table above.
2. Read the linked SKILL.md for that specialist skill.
3. Follow the workflow and guidance defined in that skill.
4. For complex scenarios spanning multiple skills, start with the primary intent and cross-reference as needed.

## Skill Overview

### Publish Content

Publish content to Publish and Preview tiers using Cloud Service publishing workflows:
- **Quick Publish**: Simple one-click activation to Publish tier
- **Manage Publication**: Advanced control with Preview tier support, scheduling, and approval workflows
- **Publish to Preview**: Content preview before production publishing
- **Tree Activation**: Hierarchical bulk publishing with tier selection
- **Package Manager**: Specific content set distribution
- **Scheduled Publishing**: Time-based content publishing with timezone support
- **Unpublish/Deactivate**: Remove content from Publish or Preview tiers

**When to use:** Publishing pages, assets, content fragments, or experience fragments; content preview; unpublishing content

### Preview Tier Management

Manage the Preview tier for content review and testing:
- **Preview Publishing Workflows**: Publish to Preview before Publish
- **Preview URL Structure**: Access content on Preview tier
- **Preview-Specific Testing**: UAT, stakeholder review, QA validation
- **Preview to Publish Promotion**: Move approved content from Preview to Publish
- **Preview Content Cleanup**: Remove outdated preview content
- **Preview Analytics**: Track preview usage and engagement

**When to use:** Content review workflows, stakeholder approval, UAT testing, marketing campaign preview

### Content Distribution API

Programmatic content distribution using Cloud Service APIs and event handling:
- **Sling Content Distribution**: Modern distribution API for Cloud Service
- **Replication Event Handlers**: React to publish/unpublish events
- **Custom Workflows**: Integrate distribution into custom workflows
- **Bulk Operations**: Programmatic bulk publishing
- **Content Package API**: Package-based distribution
- **Publication Status Queries**: Check content publication state

**When to use:** Custom OSGi services, workflow process steps, bulk operations, integration with external systems

### Troubleshoot Distribution

Diagnose and fix Cloud Service content distribution issues:
- **Stuck Content**: Content not appearing on Publish or Preview
- **CDN Cache Issues**: Stale content, cache invalidation failures
- **Publication Delays**: Slow content distribution
- **Preview Tier Issues**: Content not appearing on Preview
- **Replication Job Failures**: Sling job queue issues
- **Permission Issues**: Insufficient publish permissions

**When to use:** Content not appearing, slow distribution, CDN cache problems, Preview tier issues

### Content Distribution Orchestrator

Coordinates end-to-end content distribution workflows spanning multiple sub-skills:
- **Go-Live Preparation**: Configure Preview tier → Test workflows → CDN warmup → Go live
- **Production Incident Response**: Diagnose → Fix → Clear CDN → Verify
- **CDN Optimization**: Cache analysis → Configure purge rules → Validate

**When to use:** Multi-step scenarios requiring coordination across publish, preview, API, and troubleshoot skills

## Common Workflows

### First-Time Cloud Service Setup
1. Use **Preview Tier Management** to understand Preview tier architecture
2. Use **Publish Content** to test publishing to Preview and Publish tiers
3. If issues occur, use **Troubleshoot Distribution**

### Content Author Operations
1. Use **Publish Content** for day-to-day publishing workflows
2. Use **Preview Tier Management** for content preview and approval
3. Use **Troubleshoot Distribution** when content doesn't appear

### Developer Integration
1. Use **Content Distribution API** to understand available methods and event handlers
2. Use **Publish Content** to understand publishing workflows
3. Use **Troubleshoot Distribution** for debugging custom distribution code

## Foundation References

Shared reference materials used across all content distribution skills:

- **[Cloud Service Architecture](./references/cloud-distribution-foundation/architecture.md)**: Author, Preview, Publish tiers, and content distribution flow
- **[Cloud Service Guardrails](./references/cloud-distribution-foundation/cloud-guardrails.md)**: Rate limits, best practices, and constraints

**Note**: Additional reference documentation (Sling Content Distribution details, Preview tier architecture deep-dive, CDN integration patterns) will be added in future updates.

## Official Documentation

All skills reference official Adobe AEM as a Cloud Service documentation:
- [Content Distribution in AEM as a Cloud Service](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/operations/replication)
- [Managing Publication](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/authoring/sites-console/publishing-pages)
- [Preview Tier](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/using-cloud-manager/manage-environments)
- [CDN in AEM as a Cloud Service](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/cdn)

## Key Differences from AEM 6.5 LTS

AEM as a Cloud Service has **fundamentally different** content distribution architecture:

| Feature | AEM 6.5 LTS | AEM as a Cloud Service |
|---|---|---|
| **Distribution Model** | Replication agents | Sling Content Distribution (automatic) |
| **Agent Configuration** | Manual agent setup required | Managed by Adobe (no agent configuration) |
| **Tiers** | Author, Publish | Author, Preview, Publish |
| **CDN** | Optional, external | Integrated Adobe CDN (mandatory) |
| **API** | Replication API (`com.day.cq.replication`) | Sling Distribution events, Publication API |
| **Cache Invalidation** | Dispatcher Flush agents | Automatic CDN purge |
| **Preview** | Not available | Native Preview tier for content review |

**Note:** The Replication API (`com.day.cq.replication`) exists in both 6.5 LTS and Cloud Service. Cloud Service uses automatic Sling Content Distribution instead of manual replication agent configuration.

## Related Skills

- **AEM Workflow**: Integrate publishing with approval workflows
- **Dispatcher**: CDN configuration and cache management (Cloud Service patterns)
- **AEM Replication** (6.5 LTS): For on-prem or AMS environments

## When NOT to Use This Skill

This skill is for **AEM as a Cloud Service ONLY**. For other AEM deployments:
- **AEM 6.5 LTS** (on-prem or AMS): Use `aem-replication` skill
- **AEM 6.4 or earlier**: Use `aem-replication` skill (if available)
