---
name: sling-distribution
description: |
  Monitor and react to content distribution events using Sling Distribution API (org.apache.sling.distribution).
  Covers distribution event handling, queue monitoring, and distribution lifecycle tracking.
---

# AEM Cloud Service Sling Distribution Event Handling

Monitor and react to content distribution lifecycle events using the Sling Distribution API.

## When to Use This Skill

Use Sling Distribution event handling for:
- **Monitoring distribution lifecycle**: Track package creation, queueing, and delivery
- **Custom post-distribution actions**: Cache warming, notifications, analytics
- **Distribution auditing**: Log and track all distribution events
- **Failure handling**: React to dropped packages and distribution failures
- **Integration workflows**: Trigger external systems after successful distribution

**For programmatic publishing**, use the [Replication API](../replication/SKILL.md) instead.

## Official API Documentation

**Javadoc**: https://developer.adobe.com/experience-manager/reference-materials/cloud-service/javadoc/org/apache/sling/distribution/package-summary.html

**Key Packages**:
- `org.apache.sling.distribution` - Core distribution interfaces
- `org.apache.sling.distribution.event` - Event topics and properties
- `org.apache.sling.distribution.queue` - Queue monitoring

## Understanding Sling Distribution in Cloud Service

### What is Sling Distribution?

Sling Distribution is the **underlying transport mechanism** for content replication in AEM Cloud Service. When you use the Replication API (`Replicator.replicate()`), Sling Distribution handles:

1. **Package Creation**: Content is assembled into distribution packages
2. **Queueing**: Packages are queued for delivery
3. **Transport**: Packages are sent to Adobe Developer pipeline service
4. **Import**: Target tier imports and applies the content

### Architecture Flow

```
Replication API Call
       ↓
[AGENT_PACKAGE_CREATED] - Package assembled
       ↓
[AGENT_PACKAGE_QUEUED] - Package added to queue
       ↓
[AGENT_PACKAGE_DISTRIBUTED] - Package sent to pipeline
       ↓
[IMPORTER_PACKAGE_IMPORTED] - Package imported on target tier
```

**OR**

```
[AGENT_PACKAGE_DROPPED] - Package failed and was removed
```

## Distribution Event Topics

### Available Event Topics

Sling Distribution fires events at each stage of the distribution lifecycle:

| Event Topic | When It Fires | Use Case |
|-------------|---------------|----------|
| `AGENT_PACKAGE_CREATED` | After package creation | Track what's being published |
| `AGENT_PACKAGE_QUEUED` | After package is queued | Monitor queue depth |
| `AGENT_PACKAGE_DISTRIBUTED` | After successful distribution | Trigger post-publish actions |
| `AGENT_PACKAGE_DROPPED` | When package fails and is dropped | Handle failures, alert on-call |
| `IMPORTER_PACKAGE_IMPORTED` | After successful import on target | Confirm content is live |

### Event Topic Constants

```java
import org.apache.sling.distribution.event.DistributionEventTopics;

// Event topic strings
DistributionEventTopics.AGENT_PACKAGE_CREATED      // Package created
DistributionEventTopics.AGENT_PACKAGE_QUEUED       // Package queued
DistributionEventTopics.AGENT_PACKAGE_DISTRIBUTED  // Package distributed
DistributionEventTopics.AGENT_PACKAGE_DROPPED      // Package dropped
DistributionEventTopics.IMPORTER_PACKAGE_IMPORTED  // Package imported
```

## Listening to Distribution Events

### Example: Basic Distribution Event Logger

```java
import org.apache.sling.distribution.event.DistributionEventTopics;
import org.apache.sling.distribution.event.DistributionEventProperties;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.event.Event;
import org.osgi.service.event.EventHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Component(
    service = EventHandler.class,
    property = {
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
    }
)
public class DistributionEventLogger implements EventHandler {
    
    private static final Logger LOG = LoggerFactory.getLogger(DistributionEventLogger.class);
    
    @Override
    public void handleEvent(Event event) {
        String topic = event.getTopic();
        
        // Extract event properties
        String componentName = (String) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_COMPONENT_NAME
        );
        String componentKind = (String) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_COMPONENT_KIND
        );
        String distributionType = (String) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_TYPE
        );
        String packageId = (String) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PACKAGE_ID
        );
        String[] paths = (String[]) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PATHS
        );
        Long timestamp = (Long) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_ENQUEUE_TIMESTAMP
        );
        
        LOG.info("Distribution Event: topic={}, component={}, type={}, packageId={}, paths={}, timestamp={}",
            topic, componentName, distributionType, packageId, 
            paths != null ? String.join(",", paths) : "null",
            timestamp
        );
    }
}
```

## Event Properties

### Available Event Properties

Every distribution event contains these properties:

| Property | Type | Description |
|----------|------|-------------|
| `DISTRIBUTION_COMPONENT_NAME` | String | Name of component generating the event |
| `DISTRIBUTION_COMPONENT_KIND` | String | Kind of component (agent, importer, etc.) |
| `DISTRIBUTION_TYPE` | String | Type of distribution request (ADD, DELETE, etc.) |
| `DISTRIBUTION_PACKAGE_ID` | String | Unique package identifier |
| `DISTRIBUTION_PATHS` | String[] | Content paths being distributed |
| `DISTRIBUTION_DEEP_PATHS` | String[] | Deep paths (full subtree) |
| `DISTRIBUTION_ENQUEUE_TIMESTAMP` | Long | When item was enqueued (milliseconds) |

### Accessing Event Properties

```java
import org.apache.sling.distribution.event.DistributionEventProperties;

@Override
public void handleEvent(Event event) {
    // Component information
    String componentName = (String) event.getProperty(
        DistributionEventProperties.DISTRIBUTION_COMPONENT_NAME
    );
    String componentKind = (String) event.getProperty(
        DistributionEventProperties.DISTRIBUTION_COMPONENT_KIND
    );
    
    // Distribution details
    String type = (String) event.getProperty(
        DistributionEventProperties.DISTRIBUTION_TYPE
    );
    String packageId = (String) event.getProperty(
        DistributionEventProperties.DISTRIBUTION_PACKAGE_ID
    );
    
    // Content paths
    String[] paths = (String[]) event.getProperty(
        DistributionEventProperties.DISTRIBUTION_PATHS
    );
    String[] deepPaths = (String[]) event.getProperty(
        DistributionEventProperties.DISTRIBUTION_DEEP_PATHS
    );
    
    // Timing
    Long enqueueTime = (Long) event.getProperty(
        DistributionEventProperties.DISTRIBUTION_ENQUEUE_TIMESTAMP
    );
}
```

## Common Use Cases

### Use Case 1: Alert on Distribution Failures

```java
import org.apache.sling.distribution.event.DistributionEventTopics;

@Component(
    service = EventHandler.class,
    property = {
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
            DistributionEventTopics.AGENT_PACKAGE_DROPPED
    }
)
public class DistributionFailureAlertHandler implements EventHandler {
    
    private static final Logger LOG = LoggerFactory.getLogger(
        DistributionFailureAlertHandler.class
    );
    
    @Reference
    private AlertService alertService;  // Custom alert service
    
    @Override
    public void handleEvent(Event event) {
        String packageId = (String) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PACKAGE_ID
        );
        String[] paths = (String[]) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PATHS
        );
        
        LOG.error("Distribution package dropped: packageId={}, paths={}", 
            packageId, String.join(",", paths));
        
        // Send alert to operations team
        alertService.sendAlert(
            "CRITICAL: Distribution Failed",
            String.format("Package %s was dropped. Paths: %s", 
                packageId, String.join(",", paths))
        );
    }
}
```

### Use Case 2: CDN Cache Warming After Distribution

```java
@Component(
    service = EventHandler.class,
    property = {
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
            DistributionEventTopics.IMPORTER_PACKAGE_IMPORTED
    }
)
public class CdnCacheWarmingHandler implements EventHandler {
    
    private static final Logger LOG = LoggerFactory.getLogger(
        CdnCacheWarmingHandler.class
    );
    
    @Reference
    private HttpClient httpClient;
    
    @Override
    public void handleEvent(Event event) {
        String[] paths = (String[]) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PATHS
        );
        String distributionType = (String) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_TYPE
        );
        
        // Only warm cache on ADD (activation)
        if ("ADD".equals(distributionType) && paths != null) {
            for (String path : paths) {
                warmCache(path);
            }
        }
    }
    
    private void warmCache(String path) {
        try {
            // Convert JCR path to public URL
            String publicUrl = "https://www.example.com" + 
                path.replace("/content/mysite", "") + ".html";
            
            LOG.info("Warming CDN cache for: {}", publicUrl);
            
            HttpGet request = new HttpGet(publicUrl);
            httpClient.execute(request);
            
        } catch (Exception e) {
            LOG.error("Cache warming failed for path: " + path, e);
        }
    }
}
```

### Use Case 3: Distribution Analytics Tracking

```java
@Component(
    service = EventHandler.class,
    property = {
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
            DistributionEventTopics.AGENT_PACKAGE_CREATED,
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
            DistributionEventTopics.AGENT_PACKAGE_DISTRIBUTED,
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
            DistributionEventTopics.AGENT_PACKAGE_DROPPED
    }
)
public class DistributionAnalyticsHandler implements EventHandler {
    
    @Reference
    private AnalyticsService analyticsService;
    
    @Override
    public void handleEvent(Event event) {
        String topic = event.getTopic();
        String packageId = (String) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PACKAGE_ID
        );
        String[] paths = (String[]) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PATHS
        );
        Long timestamp = (Long) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_ENQUEUE_TIMESTAMP
        );
        
        // Track metrics
        if (DistributionEventTopics.AGENT_PACKAGE_CREATED.equals(topic)) {
            analyticsService.trackEvent("distribution.package.created", 
                Map.of("packageId", packageId, "pathCount", paths.length));
        } 
        else if (DistributionEventTopics.AGENT_PACKAGE_DISTRIBUTED.equals(topic)) {
            long duration = System.currentTimeMillis() - timestamp;
            analyticsService.trackEvent("distribution.package.distributed", 
                Map.of("packageId", packageId, "duration", duration));
        }
        else if (DistributionEventTopics.AGENT_PACKAGE_DROPPED.equals(topic)) {
            analyticsService.trackEvent("distribution.package.failed", 
                Map.of("packageId", packageId, "paths", String.join(",", paths)));
        }
    }
}
```

### Use Case 4: Slack Notifications for Production Publishes

```java
@Component(
    service = EventHandler.class,
    property = {
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
            DistributionEventTopics.IMPORTER_PACKAGE_IMPORTED
    }
)
public class ProductionPublishNotificationHandler implements EventHandler {
    
    @Reference
    private SlackService slackService;
    
    @Reference
    private SlingSettingsService slingSettings;
    
    @Override
    public void handleEvent(Event event) {
        // Only notify for production environment
        if (!slingSettings.getRunModes().contains("prod")) {
            return;
        }
        
        String[] paths = (String[]) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PATHS
        );
        String componentName = (String) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_COMPONENT_NAME
        );
        
        // Only notify for publish agent (not preview)
        if (!"publish".equals(componentName)) {
            return;
        }
        
        String message = String.format(
            ":rocket: Content published to production: %s",
            String.join(", ", paths)
        );
        
        slackService.postToChannel("#content-releases", message);
    }
}
```

### Use Case 5: Audit Log for All Distribution Events

```java
import javax.jcr.Node;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;

@Component(
    service = EventHandler.class,
    property = {
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
    }
)
public class DistributionAuditHandler implements EventHandler {
    
    @Reference
    private ResourceResolverFactory resolverFactory;
    
    @Override
    public void handleEvent(Event event) {
        try (ResourceResolver resolver = getServiceResolver()) {
            
            String topic = event.getTopic();
            String packageId = (String) event.getProperty(
                DistributionEventProperties.DISTRIBUTION_PACKAGE_ID
            );
            String[] paths = (String[]) event.getProperty(
                DistributionEventProperties.DISTRIBUTION_PATHS
            );
            Long timestamp = (Long) event.getProperty(
                DistributionEventProperties.DISTRIBUTION_ENQUEUE_TIMESTAMP
            );
            
            // Create audit log entry under /var/audit/distribution
            String auditPath = "/var/audit/distribution/" + 
                System.currentTimeMillis();
            
            Node auditNode = resolver.getResource("/var/audit/distribution")
                .adaptTo(Node.class)
                .addNode(String.valueOf(System.currentTimeMillis()), "nt:unstructured");
            
            auditNode.setProperty("topic", topic);
            auditNode.setProperty("packageId", packageId);
            auditNode.setProperty("paths", paths);
            auditNode.setProperty("timestamp", timestamp);
            auditNode.setProperty("auditTime", System.currentTimeMillis());
            
            resolver.commit();
            
        } catch (Exception e) {
            LOG.error("Failed to create audit log", e);
        }
    }
    
    private ResourceResolver getServiceResolver() throws Exception {
        Map<String, Object> param = Map.of(
            ResourceResolverFactory.SUBSERVICE, "distributionAuditor"
        );
        return resolverFactory.getServiceResourceResolver(param);
    }
}
```

## Distribution Request Types

When monitoring events, the `DISTRIBUTION_TYPE` property indicates the type of operation:

| Request Type | Description | When Used |
|--------------|-------------|-----------|
| `ADD` | Content is being added/activated | Normal publishing |
| `DELETE` | Content is being deleted | Unpublishing, deletion |
| `PULL` | Content is being pulled from target | Reverse replication |
| `INVALIDATE` | Cache invalidation only | CDN purge |
| `TEST` | Connection test | Health checks |

### Example: Handle Different Distribution Types

```java
@Override
public void handleEvent(Event event) {
    String distributionType = (String) event.getProperty(
        DistributionEventProperties.DISTRIBUTION_TYPE
    );
    String[] paths = (String[]) event.getProperty(
        DistributionEventProperties.DISTRIBUTION_PATHS
    );
    
    switch (distributionType) {
        case "ADD":
            LOG.info("Content activated: {}", String.join(",", paths));
            break;
        case "DELETE":
            LOG.info("Content deleted: {}", String.join(",", paths));
            break;
        case "INVALIDATE":
            LOG.info("Cache invalidated: {}", String.join(",", paths));
            break;
        case "TEST":
            LOG.debug("Distribution test executed");
            break;
        default:
            LOG.warn("Unknown distribution type: {}", distributionType);
    }
}
```

## Best Practices

### 1. Filter Events Appropriately

Only listen to events you need:

```java
// Good: Listen to specific events
property = {
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        DistributionEventTopics.AGENT_PACKAGE_DROPPED
}

// Avoid: Listening to all events if not needed
```

### 2. Handle Events Asynchronously

Event handlers should be fast. Offload heavy processing:

```java
@Reference
private JobManager jobManager;

@Override
public void handleEvent(Event event) {
    // Queue a job for async processing
    Map<String, Object> jobProperties = new HashMap<>();
    jobProperties.put("packageId", event.getProperty(
        DistributionEventProperties.DISTRIBUTION_PACKAGE_ID));
    
    jobManager.addJob("com/myapp/distribution/process", jobProperties);
}
```

### 3. Use Service Users

Event handlers should use service users, not admin sessions:

```xml
<!-- Service user mapping -->
{
  "user.mapping": [
    "com.myapp.core:distributionEventHandler=myapp-distribution-service"
  ]
}
```

### 4. Handle Null Properties

Not all properties are available in all events:

```java
String[] paths = (String[]) event.getProperty(
    DistributionEventProperties.DISTRIBUTION_PATHS
);

if (paths != null && paths.length > 0) {
    // Process paths
}
```

### 5. Log Appropriately

Use appropriate log levels:

```java
// INFO for normal flow
LOG.info("Package distributed: {}", packageId);

// WARN for unexpected situations
LOG.warn("Package queued longer than expected: {}", packageId);

// ERROR for failures
LOG.error("Package dropped: {}", packageId);
```

## Monitoring Distribution Queue

While you can't directly query distribution queues via the API in Cloud Service, you can monitor via:

1. **Events**: Track `AGENT_PACKAGE_QUEUED` and `AGENT_PACKAGE_DISTRIBUTED` events
2. **Felix Console**: View Sling jobs at `/system/console/slingjobs`
3. **Logs**: Check distribution logs in Cloud Manager

### Example: Queue Depth Monitoring

```java
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;

@Component(
    service = {EventHandler.class, QueueMonitor.class},
    property = {
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
            DistributionEventTopics.AGENT_PACKAGE_QUEUED,
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
            DistributionEventTopics.AGENT_PACKAGE_DISTRIBUTED,
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
            DistributionEventTopics.AGENT_PACKAGE_DROPPED
    }
)
public class QueueMonitor implements EventHandler {
    
    private final Map<String, Long> queuedPackages = new ConcurrentHashMap<>();
    
    @Override
    public void handleEvent(Event event) {
        String topic = event.getTopic();
        String packageId = (String) event.getProperty(
            DistributionEventProperties.DISTRIBUTION_PACKAGE_ID
        );
        
        if (DistributionEventTopics.AGENT_PACKAGE_QUEUED.equals(topic)) {
            queuedPackages.put(packageId, System.currentTimeMillis());
            LOG.info("Queue depth: {}", queuedPackages.size());
            
            // Alert if queue is too deep
            if (queuedPackages.size() > 50) {
                LOG.warn("Distribution queue depth exceeds threshold: {}", 
                    queuedPackages.size());
            }
        } 
        else if (DistributionEventTopics.AGENT_PACKAGE_DISTRIBUTED.equals(topic) ||
                 DistributionEventTopics.AGENT_PACKAGE_DROPPED.equals(topic)) {
            Long queuedTime = queuedPackages.remove(packageId);
            
            if (queuedTime != null) {
                long duration = System.currentTimeMillis() - queuedTime;
                LOG.info("Package processed in {}ms. Queue depth: {}", 
                    duration, queuedPackages.size());
            }
        }
    }
    
    public int getQueueDepth() {
        return queuedPackages.size();
    }
}
```

## Troubleshooting

### Issue: Event Handler Not Firing

**Causes**:
1. Wrong event topic constant
2. Component not activated
3. Event topic not registered

**Solution**:
```java
// Verify event topic matches exactly
property = {
    org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
        DistributionEventTopics.AGENT_PACKAGE_CREATED  // Exact constant
}

// Check component is active in Felix console
// /system/console/components
```

### Issue: Missing Event Properties

**Cause**: Not all properties are available in all events

**Solution**: Always null-check:
```java
String[] paths = (String[]) event.getProperty(
    DistributionEventProperties.DISTRIBUTION_PATHS
);

if (paths == null) {
    LOG.warn("No paths in distribution event");
    return;
}
```

### Issue: Event Handler Slowing Down Distribution

**Cause**: Synchronous processing in event handler

**Solution**: Use async job processing:
```java
@Reference
private JobManager jobManager;

@Override
public void handleEvent(Event event) {
    // Don't do heavy work here
    jobManager.addJob("com/myapp/process", eventData);
}
```

## Relationship with Replication API

**Key Understanding**:
- **Replication API** (`com.day.cq.replication.Replicator`) - What you call to publish content
- **Sling Distribution Events** (`org.apache.sling.distribution.event`) - What fires during the distribution lifecycle

**Workflow**:
```
Your Code: replicator.replicate(...)
    ↓
Sling Distribution: Creates package → [AGENT_PACKAGE_CREATED]
    ↓
Sling Distribution: Queues package → [AGENT_PACKAGE_QUEUED]
    ↓
Sling Distribution: Sends package → [AGENT_PACKAGE_DISTRIBUTED]
    ↓
Target Tier: Imports package → [IMPORTER_PACKAGE_IMPORTED]
```

## References

- **Sling Distribution Javadoc**: https://developer.adobe.com/experience-manager/reference-materials/cloud-service/javadoc/org/apache/sling/distribution/package-summary.html
- **Sling Distribution Docs**: https://sling.apache.org/documentation/bundles/content-distribution.html
- **Replication API Skill**: [replication/SKILL.md](../replication/SKILL.md)
- **Adobe AEM Replication**: https://experienceleague.adobe.com/docs/experience-manager-cloud-service/content/operations/replication.html
