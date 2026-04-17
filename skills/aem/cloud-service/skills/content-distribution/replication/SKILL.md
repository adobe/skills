---
name: replication
description: |
  Programmatic content publishing using AEM Cloud Service Replication API (com.day.cq.replication).
  Covers Replicator service, ReplicationOptions, status checks, and event handling.
---

# AEM Cloud Service Replication API

Programmatic content publishing and unpublishing using the official AEM Replication API.

## When to Use This Skill

Use the Replication API for programmatic content distribution:
- Custom OSGi services that publish content
- Workflow process steps requiring activation
- Automated publishing pipelines
- Integration with external systems
- Bulk operations (with proper constraints)

**For UI-based publishing**, use Manage Publication or Quick Publish instead.

## Official API Documentation

**Javadoc**: https://developer.adobe.com/experience-manager/reference-materials/cloud-service/javadoc/com/day/cq/replication/package-summary.html

**Key Classes**:
- `com.day.cq.replication.Replicator` - Main replication service
- `com.day.cq.replication.ReplicationOptions` - Configuration options
- `com.day.cq.replication.ReplicationStatus` - Publication status
- `com.day.cq.replication.ReplicationActionType` - Action types (ACTIVATE, DEACTIVATE, DELETE, TEST)

## Architecture: How Replication Works in Cloud Service

AEM Cloud Service uses **Sling Content Distribution** as the underlying transport mechanism:

1. Author tier: Replication API call triggers content packaging
2. Content is sent to Adobe Developer pipeline service (external to AEM runtime)
3. Pipeline distributes to target tier (Publish or Preview)
4. Target tier imports and activates content

**Key Difference from AEM 6.x**: No direct JCR replication; content flows through external pipeline service.

## Basic Replication: Single Path

### Example: Activate a Page

```java
import com.day.cq.replication.Replicator;
import com.day.cq.replication.ReplicationActionType;
import com.day.cq.replication.ReplicationException;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import javax.jcr.Session;

@Component(service = ContentPublisher.class)
public class ContentPublisher {
    
    @Reference
    private Replicator replicator;
    
    /**
     * Activate a single page to Publish tier
     */
    public void publishPage(Session session, String pagePath) 
            throws ReplicationException {
        
        replicator.replicate(
            session,
            ReplicationActionType.ACTIVATE,
            pagePath
        );
    }
    
    /**
     * Deactivate a page from Publish tier
     */
    public void unpublishPage(Session session, String pagePath) 
            throws ReplicationException {
        
        replicator.replicate(
            session,
            ReplicationActionType.DEACTIVATE,
            pagePath
        );
    }
    
    /**
     * Delete content from Publish tier
     */
    public void deleteFromPublish(Session session, String path) 
            throws ReplicationException {
        
        replicator.replicate(
            session,
            ReplicationActionType.DELETE,
            path
        );
    }
}
```

### ReplicationActionType Values

| Action Type | Description | Use Case |
|-------------|-------------|----------|
| `ACTIVATE` | Publish content to target tier | Make content live |
| `DEACTIVATE` | Unpublish content from target tier | Remove from production |
| `DELETE` | Delete content from target tier | Permanent removal |
| `TEST` | Test replication connection | Health checks |
| `INTERNAL_POLL` | Internal polling (reverse replication) | System use only |

## Bulk Replication: Multiple Paths

**IMPORTANT CONSTRAINTS**:
- **Recommended limit**: 100 paths per call
- **Hard limit**: 500 paths per call
- **Transactional guarantee**: Only for ≤100 paths
- **Payload size**: 10 MB maximum (excluding binaries)

### Example: Bulk Activation

```java
import com.day.cq.replication.ReplicationOptions;

public class BulkPublisher {
    
    @Reference
    private Replicator replicator;
    
    /**
     * Publish multiple pages (up to 100 for transactional guarantee)
     */
    public void publishMultiplePages(Session session, String[] pagePaths) 
            throws ReplicationException {
        
        // Validate path count
        if (pagePaths.length > 100) {
            throw new IllegalArgumentException(
                "For transactional guarantee, limit to 100 paths. Got: " + pagePaths.length
            );
        }
        
        // Replicate all paths atomically
        replicator.replicate(
            session,
            ReplicationActionType.ACTIVATE,
            pagePaths,
            null  // No additional options
        );
    }
    
    /**
     * Bulk publish with automatic bucketing (>100 paths)
     */
    public void publishLargeSet(Session session, String[] pagePaths) 
            throws ReplicationException {
        
        if (pagePaths.length > 500) {
            throw new IllegalArgumentException(
                "Hard limit is 500 paths per call. Got: " + pagePaths.length
            );
        }
        
        // Use non-atomic calls for automatic bucketing
        ReplicationOptions options = new ReplicationOptions();
        options.setUseAtomicCalls(false);  // Enable automatic bucketing
        
        replicator.replicate(
            session,
            ReplicationActionType.ACTIVATE,
            pagePaths,
            options
        );
    }
}
```

**Best Practice**: For bulk operations >500 paths, use Tree Activation workflow step instead of custom code.

## Publishing to Preview Tier

The Preview tier requires explicit agent filtering.

### Example: Publish to Preview

```java
import com.day.cq.replication.Agent;
import com.day.cq.replication.AgentFilter;

public class PreviewPublisher {
    
    @Reference
    private Replicator replicator;
    
    /**
     * Publish to Preview tier only
     */
    public void publishToPreview(Session session, String pagePath) 
            throws ReplicationException {
        
        ReplicationOptions options = new ReplicationOptions();
        
        // Filter to target Preview agent only
        options.setFilter(new AgentFilter() {
            @Override
            public boolean isIncluded(Agent agent) {
                return "preview".equals(agent.getId());
            }
        });
        
        replicator.replicate(
            session,
            ReplicationActionType.ACTIVATE,
            pagePath,
            options
        );
    }
    
    /**
     * Publish to BOTH Preview and Publish tiers
     */
    public void publishToBothTiers(Session session, String pagePath) 
            throws ReplicationException {
        
        ReplicationOptions options = new ReplicationOptions();
        
        // Include both preview and publish agents
        options.setFilter(new AgentFilter() {
            @Override
            public boolean isIncluded(Agent agent) {
                String agentId = agent.getId();
                return "preview".equals(agentId) || "publish".equals(agentId);
            }
        });
        
        replicator.replicate(
            session,
            ReplicationActionType.ACTIVATE,
            pagePath,
            options
        );
    }
}
```

**Note**: Preview agent is disabled by default and must be configured in Cloud Manager.

## Advanced Options: ReplicationOptions

### Synchronous vs. Asynchronous Replication

```java
public class SynchronousPublisher {
    
    @Reference
    private Replicator replicator;
    
    /**
     * Synchronous replication (wait for completion)
     */
    public void publishSynchronously(Session session, String pagePath) 
            throws ReplicationException {
        
        ReplicationOptions options = new ReplicationOptions();
        options.setSynchronous(true);  // Block until complete
        
        // Optional: Add listener for synchronous feedback
        options.setListener(new ReplicationListener() {
            @Override
            public void onStart(ReplicationAction action) {
                // Called when replication starts
            }
            
            @Override
            public void onMessage(ReplicationLog.Level level, String message) {
                // Called for progress updates
            }
            
            @Override
            public void onEnd(ReplicationAction action, ReplicationResult result) {
                // Called when replication completes
            }
            
            @Override
            public void onError(ReplicationAction action, Exception error) {
                // Called if replication fails
            }
        });
        
        replicator.replicate(
            session,
            ReplicationActionType.ACTIVATE,
            pagePath,
            options
        );
    }
}
```

**Important**: `ReplicationListener` only works with synchronous replication.

### Suppress Status Updates

```java
/**
 * Replicate without updating replication metadata properties
 */
public void replicateWithoutStatusUpdate(Session session, String path) 
        throws ReplicationException {
    
    ReplicationOptions options = new ReplicationOptions();
    options.setSuppressStatusUpdate(true);  // Don't update cq:lastReplicated, etc.
    
    replicator.replicate(
        session,
        ReplicationActionType.ACTIVATE,
        path,
        options
    );
}
```

### Suppress Versioning

```java
/**
 * Replicate without creating implicit versions
 */
public void replicateWithoutVersioning(Session session, String path) 
        throws ReplicationException {
    
    ReplicationOptions options = new ReplicationOptions();
    options.setSuppressVersions(true);  // Don't auto-version on replication
    
    replicator.replicate(
        session,
        ReplicationActionType.ACTIVATE,
        path,
        options
    );
}
```

## Checking Replication Status

### Example: Check if Page is Published

```java
import com.day.cq.replication.ReplicationStatus;
import org.apache.sling.api.resource.Resource;

public class StatusChecker {
    
    @Reference
    private Replicator replicator;
    
    /**
     * Check if content is currently published
     */
    public boolean isPublished(Session session, String path) 
            throws ReplicationException {
        
        ReplicationStatus status = replicator.getReplicationStatus(session, path);
        
        if (status == null) {
            return false;  // No replication metadata
        }
        
        return status.isActivated();
    }
    
    /**
     * Get detailed replication information
     */
    public void printReplicationInfo(Session session, String path) 
            throws ReplicationException {
        
        ReplicationStatus status = replicator.getReplicationStatus(session, path);
        
        if (status != null) {
            System.out.println("Activated: " + status.isActivated());
            System.out.println("Deactivated: " + status.isDeactivated());
            System.out.println("Last Published: " + status.getLastPublished());
            System.out.println("Published By: " + status.getLastPublishedBy());
            System.out.println("Last Action: " + status.getLastReplicationAction());
            System.out.println("Pending: " + status.isPending());
        }
    }
    
    /**
     * Alternative: Adapt resource to ReplicationStatus
     */
    public boolean isPublished(Resource resource) {
        ReplicationStatus status = resource.adaptTo(ReplicationStatus.class);
        return status != null && status.isActivated();
    }
}
```

### Batch Status Queries

For checking status of multiple resources, use `ReplicationStatusProvider.getBatchReplicationStatus()` for better performance.

## Permission Checks

### Example: Validate User Can Replicate

```java
public class PermissionValidator {
    
    @Reference
    private Replicator replicator;
    
    /**
     * Check if user has permission to replicate
     */
    public boolean canUserReplicate(Session session, String path) {
        try {
            replicator.checkPermission(
                session,
                ReplicationActionType.ACTIVATE,
                path
            );
            return true;
        } catch (ReplicationException e) {
            // User lacks permission
            return false;
        }
    }
    
    /**
     * Validate before replicating
     */
    public void safeReplicate(Session session, String path) 
            throws ReplicationException {
        
        // Check permission first
        replicator.checkPermission(session, ReplicationActionType.ACTIVATE, path);
        
        // Proceed with replication
        replicator.replicate(session, ReplicationActionType.ACTIVATE, path);
    }
}
```

## Workflow Integration

### Example: Workflow Process Step

```java
import com.adobe.granite.workflow.WorkflowException;
import com.adobe.granite.workflow.WorkflowSession;
import com.adobe.granite.workflow.exec.WorkItem;
import com.adobe.granite.workflow.exec.WorkflowProcess;
import com.adobe.granite.workflow.metadata.MetaDataMap;
import org.osgi.service.component.annotations.Component;

@Component(
    service = WorkflowProcess.class,
    property = {
        "process.label=Publish Content to Publish Tier"
    }
)
public class PublishWorkflowProcess implements WorkflowProcess {
    
    @Reference
    private Replicator replicator;
    
    @Override
    public void execute(WorkItem workItem, WorkflowSession workflowSession, 
                       MetaDataMap args) throws WorkflowException {
        
        String payloadPath = workItem.getWorkflowData().getPayload().toString();
        
        try {
            Session session = workflowSession.adaptTo(Session.class);
            
            replicator.replicate(
                session,
                ReplicationActionType.ACTIVATE,
                payloadPath
            );
            
        } catch (ReplicationException e) {
            throw new WorkflowException("Failed to publish content", e);
        }
    }
}
```

**Process Arguments** (configured in workflow model):
- Can use `MetaDataMap args` to pass custom parameters like target tier

## Listening to Replication Events

Use OSGi Event Handlers to react to replication events:

```java
import org.osgi.service.component.annotations.Component;
import org.osgi.service.event.Event;
import org.osgi.service.event.EventHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Component(
    service = EventHandler.class,
    property = {
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + "com/day/cq/replication"
    }
)
public class ReplicationEventLogger implements EventHandler {
    
    private static final Logger LOG = LoggerFactory.getLogger(ReplicationEventLogger.class);
    
    @Override
    public void handleEvent(Event event) {
        String[] paths = (String[]) event.getProperty("paths");
        String action = (String) event.getProperty("action");
        String userId = (String) event.getProperty("userId");
        
        if (paths != null) {
            for (String path : paths) {
                LOG.info("Replication: action={}, path={}, user={}", action, path, userId);
            }
        }
    }
}
```

**Event Properties**:
- `paths` - Array of replicated paths
- `action` - Replication action (Activate, Deactivate, etc.)
- `userId` - User who triggered replication

## Best Practices

### 1. Respect Rate Limits
- ≤100 paths per call for transactional guarantee
- ≤500 paths hard limit
- ≤10 MB payload size

### 2. Use Workflow for Large Operations
Don't build custom bulk publishing code. Use Tree Activation workflow step.

### 3. Validate Permissions
Always check permissions before replication to avoid exceptions.

### 4. Handle Exceptions
```java
try {
    replicator.replicate(session, ReplicationActionType.ACTIVATE, path);
} catch (ReplicationException e) {
    LOG.error("Replication failed for path: " + path, e);
    // Handle failure (retry, notify, etc.)
}
```

### 5. Use Service Users
Never replicate with admin credentials. Create service users with minimum required permissions.

```xml
<!-- Service user mapping -->
<!-- ui.config/src/main/content/jcr_root/apps/myapp/osgiconfig/config/ -->
<!-- org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-myapp.cfg.json -->
{
  "user.mapping": [
    "com.myapp.core:contentPublisher=myapp-replication-service"
  ]
}
```

### 6. Publish Only What's Needed
"It is always a good practice to only publish content that must be published."

## Common Patterns

### Pattern 1: Auto-Publish on Content Fragment Save

```java
import org.apache.sling.api.SlingConstants;
import org.apache.sling.api.resource.ResourceResolverFactory;

@Component(
    service = EventHandler.class,
    property = {
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
            SlingConstants.TOPIC_RESOURCE_CHANGED
    }
)
public class AutoPublishContentFragmentHandler implements EventHandler {
    
    @Reference
    private Replicator replicator;
    
    @Reference
    private ResourceResolverFactory resolverFactory;
    
    @Override
    public void handleEvent(Event event) {
        String path = (String) event.getProperty(SlingConstants.PROPERTY_PATH);
        
        // Only process content fragments
        if (path != null && path.startsWith("/content/dam") && 
            isContentFragment(path)) {
            
            try (ResourceResolver resolver = getServiceResolver()) {
                Session session = resolver.adaptTo(Session.class);
                replicator.replicate(
                    session,
                    ReplicationActionType.ACTIVATE,
                    path
                );
            } catch (Exception e) {
                LOG.error("Auto-publish failed", e);
            }
        }
    }
    
    private ResourceResolver getServiceResolver() throws Exception {
        Map<String, Object> param = Map.of(
            ResourceResolverFactory.SUBSERVICE, "contentPublisher"
        );
        return resolverFactory.getServiceResourceResolver(param);
    }
    
    private boolean isContentFragment(String path) {
        // Implementation to check if path is a content fragment
        return true;
    }
}
```

### Pattern 2: External Cache Purge After Publication

```java
@Component(
    service = EventHandler.class,
    property = {
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + "com/day/cq/replication"
    }
)
public class ExternalCachePurgeHandler implements EventHandler {
    
    @Reference
    private HttpClient httpClient;
    
    @Override
    public void handleEvent(Event event) {
        String action = (String) event.getProperty("action");
        
        if ("Activate".equals(action) || "Deactivate".equals(action)) {
            String[] paths = (String[]) event.getProperty("paths");
            
            if (paths != null) {
                for (String path : paths) {
                    purgeExternalCache(path);
                }
            }
        }
    }
    
    private void purgeExternalCache(String path) {
        // Call external CDN purge API
        try {
            HttpPost request = new HttpPost("https://cdn.example.com/purge");
            request.setHeader("Content-Type", "application/json");
            request.setEntity(new StringEntity("{\"path\":\"" + path + "\"}"));
            httpClient.execute(request);
        } catch (Exception e) {
            LOG.error("Cache purge failed", e);
        }
    }
}
```

## Troubleshooting

### Issue: Replication Fails Silently

**Check**: Verify replication queues in Felix console
```
https://author-p12345-e67890.adobeaemcloud.com/system/console/slingjobs
```

Look for failed jobs with topic: `com/day/cq/replication`

### Issue: Permission Errors

**Error**: `javax.jcr.AccessDeniedException`

**Solution**: Verify service user has replication permissions:
```
/content/mysite -> jcr:read, crx:replicate
```

### Issue: Content Not Appearing

**Check**: 
1. Verify replication status: `replicator.getReplicationStatus()`
2. Check logs for distribution errors
3. Verify target tier (Preview vs. Publish)

## References

- **Official Javadoc**: https://developer.adobe.com/experience-manager/reference-materials/cloud-service/javadoc/com/day/cq/replication/package-summary.html
- **Adobe Docs**: https://experienceleague.adobe.com/docs/experience-manager-cloud-service/content/operations/replication.html
- **Sling Distribution**: https://sling.apache.org/documentation/bundles/content-distribution.html
