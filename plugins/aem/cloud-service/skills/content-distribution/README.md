# AEM as a Cloud Service Content Distribution Skills

Programmatic content publishing and distribution monitoring for Adobe Experience Manager as a Cloud Service.

## Overview

These skills cover the official APIs for content replication and distribution event handling in AEM Cloud Service:

1. **Replication API** (`com.day.cq.replication`) - Programmatic content publishing
2. **Sling Distribution Events** (`org.apache.sling.distribution.event`) - Distribution lifecycle monitoring

## Official Documentation

- **Replication API Javadoc**: https://developer.adobe.com/experience-manager/reference-materials/cloud-service/javadoc/com/day/cq/replication/package-summary.html
- **Sling Distribution Javadoc**: https://developer.adobe.com/experience-manager/reference-materials/cloud-service/javadoc/org/apache/sling/distribution/package-summary.html
- **Adobe Replication Guide**: https://experienceleague.adobe.com/docs/experience-manager-cloud-service/content/operations/replication.html

## Skills Included

### 1. Replication API (`replication/SKILL.md`)

Use the official AEM Replication API to programmatically publish and unpublish content.

**What it covers**:
- `Replicator` service usage with code examples
- Publishing to Publish and Preview tiers
- Bulk replication (with rate limits)
- `ReplicationOptions` for advanced configuration
- Replication status checks
- Permission validation
- Workflow integration
- Event handling for replication events

**When to use**:
- Custom OSGi services that publish content
- Workflow process steps
- Automated publishing pipelines
- Integration with external systems

**Official API**: `com.day.cq.replication.Replicator`

### 2. Sling Distribution Event Handling (`sling-distribution/SKILL.md`)

Monitor and react to content distribution lifecycle events.

**What it covers**:
- Distribution event topics (package created, queued, distributed, dropped, imported)
- Event properties and metadata
- OSGi event handler examples
- Common use cases (alerting, cache warming, analytics)
- Queue monitoring patterns
- Distribution request types

**When to use**:
- Monitor distribution lifecycle
- Trigger post-distribution actions (cache warming, notifications)
- Distribution auditing and logging
- Handle distribution failures
- Integration workflows

**Official API**: `org.apache.sling.distribution.event`

## How They Work Together

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Your Code: Replication API                              │
│ replicator.replicate(session, ACTIVATE, "/content/...") │
└──────────────────────┬──────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│ Sling Distribution: Underlying Transport                │
│                                                          │
│ [AGENT_PACKAGE_CREATED]   ← Event fires                 │
│         ↓                                                │
│ [AGENT_PACKAGE_QUEUED]    ← Event fires                 │
│         ↓                                                │
│ [AGENT_PACKAGE_DISTRIBUTED] ← Event fires               │
│         ↓                                                │
│ Adobe Developer Pipeline Service                        │
│         ↓                                                │
│ [IMPORTER_PACKAGE_IMPORTED] ← Event fires on target     │
└─────────────────────────────────────────────────────────┘
                       ↓
              Content is live on Publish/Preview
```

### Workflow Example

**Scenario**: Publish a page and warm the CDN cache after distribution completes.

**Step 1**: Use Replication API to publish:
```java
@Reference
private Replicator replicator;

// Publish content
replicator.replicate(session, ReplicationActionType.ACTIVATE, "/content/mysite/en/page");
```

**Step 2**: Listen for distribution completion:
```java
@Component(
    service = EventHandler.class,
    property = {
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
            DistributionEventTopics.IMPORTER_PACKAGE_IMPORTED
    }
)
public class CacheWarmingHandler implements EventHandler {
    
    @Override
    public void handleEvent(Event event) {
        String[] paths = (String[]) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PATHS
        );
        
        for (String path : paths) {
            warmCache(path);  // Custom cache warming logic
        }
    }
}
```

## Key Differences from AEM 6.x

| Aspect | AEM 6.x | AEM Cloud Service |
|--------|---------|-------------------|
| **Replication API** | `com.day.cq.replication.Replicator` | ✅ Same API available |
| **Transport** | Direct JCR replication | Sling Distribution via Adobe Developer pipeline |
| **Agents** | Manual configuration | Automatic (managed by Adobe) |
| **Preview Tier** | Not available | Available with agent filtering |
| **Distribution Events** | Limited | Full lifecycle events via `org.apache.sling.distribution.event` |

## Rate Limits and Constraints

### Replication API Limits

| Constraint | Limit |
|-----------|-------|
| Paths per API call (recommended) | 100 |
| Paths per API call (above 100) | System auto-splits into non-transactional chunks |
| Transactional guarantee | ≤100 paths only |
| Payload size | 10 MB maximum |

### Best Practices

1. **Respect rate limits**: ≤100 paths per call for transactional guarantee
2. **Use workflow for large trees**: Tree Activation workflow step for large hierarchical content trees
3. **Handle failures gracefully**: Always catch `ReplicationException`
4. **Use service users**: Never replicate with admin credentials
5. **Publish only what's needed**: Avoid unnecessary bulk operations
6. **Monitor events**: Use Sling Distribution events for observability

## Common Use Cases

### Use Case 1: Auto-Publish Content Fragments

```java
// Listen for content fragment changes
@Component(service = EventHandler.class, property = {
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        SlingConstants.TOPIC_RESOURCE_CHANGED
})
public class AutoPublishHandler implements EventHandler {
    
    @Reference
    private Replicator replicator;
    
    @Reference
    private ResourceResolverFactory resolverFactory;
    
    @Override
    public void handleEvent(Event event) {
        String path = (String) event.getProperty(SlingConstants.PROPERTY_PATH);
        
        if (isContentFragment(path)) {
            try (ResourceResolver resolver = getServiceResolver()) {
                Session session = resolver.adaptTo(Session.class);
                replicator.replicate(session, ReplicationActionType.ACTIVATE, path);
            } catch (Exception e) {
                LOG.error("Auto-publish failed", e);
            }
        }
    }
    
    private ResourceResolver getServiceResolver() throws LoginException {
        Map<String, Object> param = Map.of(
            ResourceResolverFactory.SUBSERVICE, "contentPublisher"
        );
        return resolverFactory.getServiceResourceResolver(param);
    }
    
    private boolean isContentFragment(String path) {
        return path != null && path.startsWith("/content/dam") && 
               path.contains("/jcr:content");
    }
}
```

### Use Case 2: Alert on Distribution Failures

```java
// Monitor for dropped packages
@Component(service = EventHandler.class, property = {
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        DistributionEventTopics.AGENT_PACKAGE_DROPPED
})
public class FailureAlertHandler implements EventHandler {
    
    @Override
    public void handleEvent(Event event) {
        String packageId = (String) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PACKAGE_ID
        );
        String[] paths = (String[]) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PATHS
        );
        
        LOG.error("Distribution failed: packageId={}, paths={}", 
            packageId, String.join(",", paths));
        
        // Send alert to operations team
        alertService.sendAlert("Distribution failure", packageId);
    }
}
```

### Use Case 3: CDN Cache Warming

```java
// Warm cache after successful distribution
@Component(service = EventHandler.class, property = {
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        DistributionEventTopics.IMPORTER_PACKAGE_IMPORTED
})
public class CacheWarmingHandler implements EventHandler {
    
    @Override
    public void handleEvent(Event event) {
        String[] paths = (String[]) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PATHS
        );
        
        for (String path : paths) {
            String url = convertToPublicUrl(path);
            httpClient.execute(new HttpGet(url));  // Warm cache
        }
    }
}
```

### Use Case 4: Publish to Preview for Approval Workflow

```java
// Workflow step: Publish to Preview for review
@Component(service = WorkflowProcess.class, property = {
    "process.label=Publish to Preview for Review"
})
public class PublishToPreviewStep implements WorkflowProcess {
    
    @Reference
    private Replicator replicator;
    
    @Override
    public void execute(WorkItem workItem, WorkflowSession workflowSession, 
                       MetaDataMap args) throws WorkflowException {
        
        String payloadPath = workItem.getWorkflowData().getPayload().toString();
        Session session = workflowSession.adaptTo(Session.class);
        
        // Create options to target Preview tier
        ReplicationOptions options = new ReplicationOptions();
        options.setFilter(agent -> "preview".equals(agent.getId()));
        
        try {
            replicator.replicate(
                session,
                ReplicationActionType.ACTIVATE,
                payloadPath,
                options
            );
        } catch (ReplicationException e) {
            throw new WorkflowException("Failed to publish to Preview", e);
        }
    }
}
```

## Quick Reference

### Replication API - Key Classes

```java
// Inject the service
@Reference
private Replicator replicator;

// Single path
replicator.replicate(session, ReplicationActionType.ACTIVATE, "/content/page");

// Multiple paths
replicator.replicate(session, ReplicationActionType.ACTIVATE, 
    new String[]{"/content/page1", "/content/page2"}, null);

// With options
ReplicationOptions options = new ReplicationOptions();
options.setFilter(agent -> "preview".equals(agent.getId()));
replicator.replicate(session, ReplicationActionType.ACTIVATE, "/content/page", options);

// Check status
ReplicationStatus status = replicator.getReplicationStatus(session, "/content/page");
boolean isPublished = status != null && status.isActivated();
```

### Distribution Events - Key Topics

```java
// Listen for events
@Component(service = EventHandler.class, property = {
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        DistributionEventTopics.AGENT_PACKAGE_CREATED,
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        DistributionEventTopics.AGENT_PACKAGE_QUEUED,
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        DistributionEventTopics.AGENT_PACKAGE_DISTRIBUTED,
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        DistributionEventTopics.AGENT_PACKAGE_DROPPED,
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        DistributionEventTopics.IMPORTER_PACKAGE_IMPORTED
})
public class MyDistributionHandler implements EventHandler {
    
    @Override
    public void handleEvent(Event event) {
        String packageId = (String) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PACKAGE_ID
        );
        String[] paths = (String[]) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PATHS
        );
        // Handle event
    }
}
```

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| ReplicationException | Permission denied | Check service user has `crx:replicate` permission |
| Content not appearing | Wrong tier selected | Verify agent filter targets correct tier (preview vs publish) |
| Event handler not firing | Wrong event topic | Use exact constants from `DistributionEventTopics` |
| "Too many paths" error | >100 paths lose transactional guarantee | Use ≤100 for atomicity; system auto-splits larger sets |

### Debug Checklist

1. **Replication fails**:
   - Check logs for `ReplicationException`
   - Verify user has `crx:replicate` permission on content path
   - Check Sling jobs console: `/system/console/slingjobs`

2. **Events not firing**:
   - Verify component is active: `/system/console/components`
   - Check event topic matches exactly
   - Verify OSGi event handler properties

3. **Content not on target tier**:
   - Check replication status: `replicator.getReplicationStatus()`
   - Verify agent filter targets correct tier
   - Check distribution logs in Cloud Manager

## References

- **Replication Skill**: [replication/SKILL.md](./replication/SKILL.md)
- **Sling Distribution Skill**: [sling-distribution/SKILL.md](./sling-distribution/SKILL.md)
- **Official Javadoc**: https://developer.adobe.com/experience-manager/reference-materials/cloud-service/javadoc/
- **Adobe Documentation**: https://experienceleague.adobe.com/docs/experience-manager-cloud-service/content/operations/replication.html
