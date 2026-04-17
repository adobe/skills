---
name: content-distribution
status: beta
description: |
  [BETA] AEM as a Cloud Service content distribution and replication. Covers programmatic publishing
  using the Replication API and distribution event monitoring using Sling Distribution events.
  This skill is in beta. Verify all outputs before applying them to production projects.
---

# AEM Cloud Service Content Distribution

> **Beta Skill**: This skill is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

Programmatic content publishing and distribution monitoring using official AEM Cloud Service APIs.

## When to Use This Skill

Use this skill collection for:
- **Programmatic publishing**: Publish content via `Replicator` API
- **Distribution monitoring**: Track distribution lifecycle events
- **Automated workflows**: Integration with workflow process steps
- **Event handling**: React to distribution events (failures, completions)
- **Custom publishing logic**: Bulk operations, Preview tier publishing

## Sub-Skills

This is a parent skill that routes to specialized sub-skills based on your task:

| Task | Sub-Skill | File |
|------|-----------|------|
| Programmatically publish/unpublish content | Replication API | [replication/SKILL.md](./replication/SKILL.md) |
| Monitor distribution events and lifecycle | Sling Distribution Events | [sling-distribution/SKILL.md](./sling-distribution/SKILL.md) |

## Quick Decision Guide

**Choose Replication API** when you need to:
- Publish content from custom OSGi services
- Integrate publishing into workflow steps
- Perform bulk publishing operations
- Publish to Preview tier for review
- Check replication status programmatically

**Choose Sling Distribution Events** when you need to:
- Monitor distribution lifecycle (created, queued, distributed, imported)
- React to distribution failures
- Trigger post-distribution actions (cache warming, notifications)
- Audit distribution operations
- Track distribution metrics

## Official APIs

Both skills use official, supported AEM Cloud Service APIs:

1. **Replication API**: `com.day.cq.replication`
   - **Javadoc**: https://developer.adobe.com/experience-manager/reference-materials/cloud-service/javadoc/com/day/cq/replication/package-summary.html
   - **Main Classes**: `Replicator`, `ReplicationOptions`, `ReplicationStatus`, `ReplicationActionType`

2. **Sling Distribution API**: `org.apache.sling.distribution`
   - **Javadoc**: https://developer.adobe.com/experience-manager/reference-materials/cloud-service/javadoc/org/apache/sling/distribution/package-summary.html
   - **Main Packages**: `org.apache.sling.distribution.event` (event topics and properties)

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│ Replication API (Your Code)                     │
│ com.day.cq.replication.Replicator                │
│                                                  │
│ replicator.replicate(session, ACTIVATE, path)   │
└────────────────────┬─────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────┐
│ Sling Distribution (Underlying Transport)       │
│ org.apache.sling.distribution                    │
│                                                  │
│ [AGENT_PACKAGE_CREATED]   ← Distribution events │
│          ↓                   fire at each stage  │
│ [AGENT_PACKAGE_QUEUED]                          │
│          ↓                                       │
│ [AGENT_PACKAGE_DISTRIBUTED]                     │
│          ↓                                       │
│ Adobe Developer Pipeline Service                │
│          ↓                                       │
│ [IMPORTER_PACKAGE_IMPORTED]                     │
└──────────────────────────────────────────────────┘
                     ↓
         Content live on Publish/Preview
```

### How It Works

1. **Your code** calls `Replicator.replicate()` to publish content
2. **Sling Distribution** packages content and fires `AGENT_PACKAGE_CREATED` event
3. Package is **queued** and `AGENT_PACKAGE_QUEUED` event fires
4. Package is **sent** to Adobe Developer pipeline and `AGENT_PACKAGE_DISTRIBUTED` event fires
5. Target tier **imports** content and `IMPORTER_PACKAGE_IMPORTED` event fires
6. Content is **live** on target tier (Publish or Preview)

## Common Patterns

### Pattern 1: Publish and Monitor

Publish content and track when it goes live:

```java
// Step 1: Publish using Replication API
@Reference
private Replicator replicator;

public void publishContent(Session session, String path) throws ReplicationException {
    replicator.replicate(session, ReplicationActionType.ACTIVATE, path);
}

// Step 2: Monitor completion using Distribution Events
@Component(service = EventHandler.class, property = {
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        DistributionEventTopics.IMPORTER_PACKAGE_IMPORTED
})
public class PublishCompletionHandler implements EventHandler {
    
    @Override
    public void handleEvent(Event event) {
        String[] paths = (String[]) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PATHS
        );
        
        LOG.info("Content is now live: {}", String.join(",", paths));
        // Trigger post-publish actions (cache warming, notifications, etc.)
    }
}
```

### Pattern 2: Preview-First Workflow

Publish to Preview for approval, then to Publish:

```java
// Workflow Step 1: Publish to Preview
public void publishToPreview(Session session, String path) throws ReplicationException {
    ReplicationOptions options = new ReplicationOptions();
    options.setFilter(agent -> "preview".equals(agent.getId()));
    
    replicator.replicate(session, ReplicationActionType.ACTIVATE, path, options);
}

// Workflow Step 2: After approval, publish to Publish tier
public void publishToProduction(Session session, String path) throws ReplicationException {
    ReplicationOptions options = new ReplicationOptions();
    options.setFilter(agent -> "publish".equals(agent.getId()));
    
    replicator.replicate(session, ReplicationActionType.ACTIVATE, path, options);
}
```

### Pattern 3: Auto-Publish with Failure Handling

Auto-publish content and alert on failures:

```java
// Publish handler
@Component(service = EventHandler.class, property = {
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        SlingConstants.TOPIC_RESOURCE_CHANGED
})
public class AutoPublishHandler implements EventHandler {
    
    @Reference
    private Replicator replicator;
    
    @Override
    public void handleEvent(Event event) {
        String path = (String) event.getProperty(SlingConstants.PROPERTY_PATH);
        
        if (shouldAutoPublish(path)) {
            try (ResourceResolver resolver = getServiceResolver()) {
                Session session = resolver.adaptTo(Session.class);
                replicator.replicate(session, ReplicationActionType.ACTIVATE, path);
            } catch (Exception e) {
                LOG.error("Auto-publish failed", e);
            }
        }
    }
}

// Failure monitoring
@Component(service = EventHandler.class, property = {
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        DistributionEventTopics.AGENT_PACKAGE_DROPPED
})
public class FailureAlertHandler implements EventHandler {
    
    @Reference
    private AlertService alertService;
    
    @Override
    public void handleEvent(Event event) {
        String packageId = (String) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PACKAGE_ID
        );
        
        alertService.sendAlert("Distribution failed", packageId);
    }
}
```

## Rate Limits and Constraints

| Constraint | Limit | Impact |
|-----------|-------|--------|
| Paths per API call (recommended) | 100 | Transactional guarantee |
| Paths per API call (hard limit) | 500 | Beyond this, call fails |
| Payload size | 10 MB | Excluding binaries |
| Use atomic calls | false | For >100 paths, enables auto-bucketing |

**Best Practice**: For operations >500 paths, use Tree Activation workflow step instead of custom code.

## Key Differences from AEM 6.x

| Feature | AEM 6.x | AEM Cloud Service |
|---------|---------|-------------------|
| Replication API | `com.day.cq.replication.Replicator` | ✅ Same API |
| Replication agents | Manual configuration | ✅ Automatic (managed by Adobe) |
| Transport mechanism | Direct JCR replication | ✅ Sling Distribution via Adobe pipeline |
| Preview tier | Not available | ✅ Available (requires agent filtering) |
| Distribution events | Limited | ✅ Full lifecycle via `org.apache.sling.distribution.event` |
| Agent configuration | Manual OSGi config | ❌ Not exposed (managed by Adobe) |

## When NOT to Use These Skills

**Use UI workflows instead** when:
- Publishing small amounts of content manually
- One-off publishing operations
- Content authors can use Quick Publish or Manage Publication

**Use Tree Activation workflow** when:
- Publishing >500 paths
- Large hierarchical content trees
- Don't need custom logic

## Quick Reference

### Replication API Basics

```java
// Inject service
@Reference
private Replicator replicator;

// Publish single page
replicator.replicate(session, ReplicationActionType.ACTIVATE, "/content/mysite/page");

// Unpublish
replicator.replicate(session, ReplicationActionType.DEACTIVATE, "/content/mysite/page");

// Bulk publish (≤100 for transactional guarantee)
replicator.replicate(session, ReplicationActionType.ACTIVATE, 
    new String[]{"/content/page1", "/content/page2"}, null);

// Publish to Preview
ReplicationOptions options = new ReplicationOptions();
options.setFilter(agent -> "preview".equals(agent.getId()));
replicator.replicate(session, ReplicationActionType.ACTIVATE, "/content/page", options);

// Check status
ReplicationStatus status = replicator.getReplicationStatus(session, "/content/page");
boolean isPublished = status != null && status.isActivated();
```

### Distribution Event Handling Basics

```java
// Listen for distribution events
@Component(service = EventHandler.class, property = {
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        DistributionEventTopics.AGENT_PACKAGE_CREATED,
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        DistributionEventTopics.AGENT_PACKAGE_DISTRIBUTED,
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        DistributionEventTopics.AGENT_PACKAGE_DROPPED,
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        DistributionEventTopics.IMPORTER_PACKAGE_IMPORTED
})
public class DistributionMonitor implements EventHandler {
    
    @Override
    public void handleEvent(Event event) {
        String topic = event.getTopic();
        String packageId = (String) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PACKAGE_ID
        );
        String[] paths = (String[]) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PATHS
        );
        
        // Handle event based on topic
        if (DistributionEventTopics.AGENT_PACKAGE_DROPPED.equals(topic)) {
            LOG.error("Distribution failed: {}", packageId);
        } else if (DistributionEventTopics.IMPORTER_PACKAGE_IMPORTED.equals(topic)) {
            LOG.info("Content is live: {}", String.join(",", paths));
        }
    }
}
```

## Best Practices

1. **Use the right API**: Replication API for publishing, Distribution events for monitoring
2. **Respect rate limits**: ≤100 paths for transactional guarantee
3. **Handle failures**: Always catch `ReplicationException`, monitor `AGENT_PACKAGE_DROPPED` events
4. **Use service users**: Never use admin credentials
5. **Filter events appropriately**: Only listen to events you need
6. **Validate permissions**: Call `replicator.checkPermission()` before replication
7. **Publish only what's needed**: Avoid unnecessary bulk operations

## Troubleshooting

### Replication Issues

| Issue | Solution |
|-------|----------|
| `ReplicationException` | Check service user has `crx:replicate` permission |
| Content not on target tier | Verify agent filter, check replication status |
| "Too many paths" error | Reduce to ≤500 paths or use Tree Activation workflow |

### Event Handling Issues

| Issue | Solution |
|-------|----------|
| Event handler not firing | Verify event topic constant matches exactly |
| Missing event properties | Always null-check event properties |
| Handler slowing distribution | Use async job processing, don't block |

## Detailed Documentation

For detailed examples, code samples, and advanced usage:

- **Replication API**: See [replication/SKILL.md](./replication/SKILL.md)
- **Sling Distribution Events**: See [sling-distribution/SKILL.md](./sling-distribution/SKILL.md)

## References

- **Replication Javadoc**: https://developer.adobe.com/experience-manager/reference-materials/cloud-service/javadoc/com/day/cq/replication/package-summary.html
- **Sling Distribution Javadoc**: https://developer.adobe.com/experience-manager/reference-materials/cloud-service/javadoc/org/apache/sling/distribution/package-summary.html
- **Adobe Documentation**: https://experienceleague.adobe.com/docs/experience-manager-cloud-service/content/operations/replication.html
- **Sling Distribution**: https://sling.apache.org/documentation/bundles/content-distribution.html
