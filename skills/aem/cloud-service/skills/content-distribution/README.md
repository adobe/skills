# AEM as a Cloud Service Content Distribution Skills

Comprehensive content distribution skills for Adobe Experience Manager as a Cloud Service, covering content publishing, Preview tier management, Sling Content Distribution API, CDN cache management, and troubleshooting.

## Skills Included

### 1. Publish Content
Publish content to Publish and Preview tiers using Cloud Service publishing workflows.

**Key capabilities:**
- Quick Publish for simple activation
- Manage Publication with Preview tier support
- Publish to Preview for content review
- Tree Activation with tier selection
- Scheduled publishing with timezone support
- Unpublish from Publish or Preview tiers
- Content Fragments and Experience Fragments publishing

**Typical use cases:**
- Daily content publishing operations
- Marketing campaign launches with Preview review
- Scheduled content releases
- Bulk content publishing
- Content preview before production

### 2. Preview Tier Management
Manage the Preview tier for content review, testing, and stakeholder approval.

**Key capabilities:**
- Preview publishing workflows
- Preview URL structure and access
- Preview-specific testing (UAT, QA)
- Preview to Publish promotion
- Preview content cleanup
- Preview analytics and tracking

**Typical use cases:**
- Stakeholder content review
- UAT and QA testing
- Marketing campaign preview
- Content approval workflows
- A/B testing preparation

### 3. Content Distribution API
Use Cloud Service APIs and event handling for programmatic content distribution.

**Key capabilities:**
- Sling Content Distribution patterns
- Replication event handlers
- Custom workflow integration
- Bulk operations
- Content Package API
- Publication status queries
- Complete Java code examples

**Typical use cases:**
- Custom OSGi services
- Workflow process steps
- Bulk content operations
- External system integration
- Automated publishing pipelines

### 4. Troubleshoot Distribution
Diagnose and fix content distribution issues in Cloud Service environments.

**Key capabilities:**
- Stuck content diagnosis
- CDN cache issue resolution
- Publication delay troubleshooting
- Preview tier issues
- Sling job queue management
- Permission issues

**Typical use cases:**
- Production incidents
- Content not appearing on Publish/Preview
- Slow content distribution
- CDN cache staleness
- Permission and access issues

### 5. Content Distribution Orchestrator
Coordinates end-to-end workflows spanning multiple sub-skills.

**Key capabilities:**
- Go-live preparation workflows
- Production incident response
- CDN optimization strategies

**Typical use cases:**
- New site go-live
- Environment setup
- Performance optimization

## Key Features

### Preview Tier Native Support
Unlike AEM 6.5 LTS, Cloud Service has a native **Preview tier** for content review:
- Publish to Preview before Publish
- Stakeholder review on Preview tier
- Preview-specific URLs for testing
- Preview analytics integration

### Automatic Content Distribution
No manual replication agent configuration:
- Sling Content Distribution (automatic)
- Managed by Adobe platform
- Transparent to content authors
- Scales automatically

### Integrated CDN
Adobe-managed CDN with automatic cache management:
- Automatic cache invalidation
- Fast content delivery
- Global edge network
- Purge API for custom rules

### Modern APIs
Cloud Service uses different APIs than 6.5 LTS:
- Sling Content Distribution events (replaces Replication API)
- Publication API for programmatic publishing
- Event-driven architecture
- OSGi event handlers

## Documentation Sources

All skills are based on official Adobe AEM as a Cloud Service documentation:

- **Content Distribution**: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/operations/replication
- **Managing Publication**: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/authoring/sites-console/publishing-pages
- **Preview Tier**: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/using-cloud-manager/manage-environments
- **CDN**: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/cdn

## Architecture Differences: 6.5 LTS vs Cloud Service

| Aspect | AEM 6.5 LTS | AEM as a Cloud Service |
|--------|-------------|------------------------|
| **Distribution** | Replication agents | Sling Content Distribution (automatic) |
| **Configuration** | Manual agent setup | Managed by Adobe |
| **Tiers** | Author, Publish | Author, Preview, Publish |
| **CDN** | Optional external | Integrated Adobe CDN |
| **Cache Invalidation** | Dispatcher Flush agents | Automatic CDN purge |
| **API** | `com.day.cq.replication.*` | Sling Distribution events |
| **Preview** | Not available | Native Preview tier |

## Getting Started

1. **For content authors**: Start with [Publish Content](./publish-content/SKILL.md)
2. **For preview workflows**: Use [Preview Tier Management](./preview-tier/SKILL.md)
3. **For developers**: Reference [Content Distribution API](./distribution-api/SKILL.md)
4. **For troubleshooting**: Consult [Troubleshoot Distribution](./troubleshoot-distribution/SKILL.md)
5. **For end-to-end workflows**: Use [Content Distribution Orchestrator](./orchestrator/SKILL.md)

## Total Documentation

- **5 comprehensive skills**
- **Cloud Service-specific patterns**
- **Preview tier workflows**
- **CDN integration guidance**
- **100% based on official Adobe Cloud Service documentation**
