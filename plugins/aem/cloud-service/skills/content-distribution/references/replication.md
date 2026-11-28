# AEM Cloud Service Replication API

Programmatic content publishing and unpublishing using the official AEM Replication API.

## When to Use the Replication API

Use the Replication API for programmatic content distribution:
- Custom OSGi services that publish content
- Workflow process steps requiring activation
- Automated publishing pipelines
- Integration with external systems
- Bulk operations (with proper constraints)

**For UI-based publishing**, use Manage Publication or Quick Publish instead.

## Official API Documentation

**Javadoc (AEM SDK 2026.9.28386.20260923T071724Z-260900)**: https://javadoc.io/static/com.adobe.aem/aem-sdk-api/2026.9.28386.20260923T071724Z-260900/com/day/cq/replication/package-summary.html

**Key Classes**:
- `com.day.cq.replication.Replicator` - Main replication service
- `com.day.cq.replication.ReplicationOptions` - Configuration options
- `com.day.cq.replication.ReplicationStatus` - Publication status
- `com.day.cq.replication.ReplicationActionType` - Action types (ACTIVATE, DEACTIVATE, DELETE, TEST)

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

## Bulk Replication: Multiple Paths

**Bulk publishing limits** (Cloud Service operations documentation and [AEM SDK Javadocs, version 2026.9.28386.20260923T071724Z-260900](https://javadoc.io/static/com.adobe.aem/aem-sdk-api/2026.9.28386.20260923T071724Z-260900/com/day/cq/replication/Replicator.html)):
- Prefer fewer than 100 paths per custom call. Use the Tree Activation workflow for large hierarchies.
- The Cloud Service operations guide documents a 500-path cap for default calls; larger requests throw `ReplicationException`.
- It separately describes `ReplicationOptions.setUseAtomicCalls(false)` as a way to bucket larger requests, while the SDK 2026.9 Javadoc marks the option deprecated and “no longer required.” Treat this as a documented conflict: do not promise automatic splitting; handle `ReplicationException` and verify target-runtime behavior before relying on larger requests.
- **Payload size**: 10 MB maximum (excluding binaries).

### Example: Bulk Activation

```java
public class BulkPublisher {
    
    @Reference
    private Replicator replicator;
    
    /**
     * Publish multiple pages.
     * Keep custom calls below 100 paths when possible. Product docs state calls above 500 paths
     * throw ReplicationException by default; larger-batch behavior is not claimed here.
     */
    public void publishMultiplePages(Session session, String[] pagePaths) 
            throws ReplicationException {
        
        replicator.replicate(
            session,
            ReplicationActionType.ACTIVATE,
            pagePaths,
            null  // Keep custom requests below 100 paths; handle ReplicationException.
        );
    }
}
```

**Best Practice**: For large hierarchical content trees, use the Tree Activation workflow step instead of custom code.

## Publishing to Preview Tier

Without an `AgentFilter`, `Replicator` targets the enabled-by-default **publish** agent only. Preview requires an explicit filter and the Preview agent must be available in the target environment.

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

### Checking Preview Status

After a preview-only activation, the per-agent status can be active even though aggregate `isActivated()` remains false:

```java
import com.day.cq.replication.ReplicationStatus;

ReplicationStatus aggregate = replicator.getReplicationStatus(session, pagePath);
ReplicationStatus preview = aggregate == null ? null : aggregate.getStatusForAgent("preview");
boolean previewIsActivated = preview != null && preview.isActivated();
// A preview-only activation can make previewIsActivated true while aggregate.isActivated() is false.
```

**Note**: Preview is not enabled by default; verify that the Preview agent is available in the target environment before using it.

## Advanced Options: ReplicationOptions

### Synchronous vs. Asynchronous Replication

```java
import com.day.cq.replication.Agent;
import com.day.cq.replication.Replicator;
import com.day.cq.replication.ReplicationAction;
import com.day.cq.replication.ReplicationActionType;
import com.day.cq.replication.ReplicationException;
import com.day.cq.replication.ReplicationListener;
import com.day.cq.replication.ReplicationLog;
import com.day.cq.replication.ReplicationOptions;
import com.day.cq.replication.ReplicationResult;
import javax.jcr.Session;
import org.osgi.service.component.annotations.Reference;

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
            public void onStart(Agent agent, ReplicationAction action) {
                // Called when replication starts
            }
            
            @Override
            public void onMessage(ReplicationLog.Level level, String message) {
                // Called for progress updates
            }
            
            @Override
            public void onEnd(Agent agent, ReplicationAction action, ReplicationResult result) {
                // Called when replication completes
            }
            
            @Override
            public void onError(Agent agent, ReplicationAction action, Exception error) {
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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class StatusChecker {

    private static final Logger LOG = LoggerFactory.getLogger(StatusChecker.class);

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
        
        return status.isActivated();  // Aggregate/default-publish status; use getStatusForAgent("preview") for Preview.
    }
    
    /**
     * Get detailed replication information
     */
    public void printReplicationInfo(Session session, String path) 
            throws ReplicationException {
        
        ReplicationStatus status = replicator.getReplicationStatus(session, path);
        
        if (status != null) {
            LOG.info("Activated: {}", status.isActivated());
            LOG.info("Deactivated: {}", status.isDeactivated());
            LOG.info("Last Published: {}", status.getLastPublished());
            LOG.info("Published By: {}", status.getLastPublishedBy());
            LOG.info("Last Action: {}", status.getLastReplicationAction());
            LOG.info("Pending: {}", status.isPending());
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

Use `ReplicationStatusProvider.getBatchReplicationStatus()` when you need to check the publication state of multiple resources in a single call. It is more efficient than calling `Replicator.getReplicationStatus()` in a loop.

**Javadoc**: `com.day.cq.replication.ReplicationStatusProvider`

```java
import com.day.cq.replication.ReplicationStatus;
import com.day.cq.replication.ReplicationStatusProvider;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ResourceResolver;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;

@Component(service = BatchStatusChecker.class)
public class BatchStatusChecker {

    @Reference
    private ReplicationStatusProvider replicationStatusProvider;

    /**
     * Returns a map of path → ReplicationStatus for all given paths.
     * Uses ReplicationStatusProvider.getBatchReplicationStatus(Resource...)
     * which is more efficient than per-path Replicator.getReplicationStatus() calls.
     */
    public Map<String, Boolean> checkPublishedState(ResourceResolver resolver, String[] paths) {
        // Resolve all paths to Resource objects
        Resource[] resources = Arrays.stream(paths)
            .map(resolver::getResource)
            .filter(Objects::nonNull)
            .toArray(Resource[]::new);

        // Single batch call — returns Map<path, ReplicationStatus>
        Map<String, ReplicationStatus> statusMap =
            replicationStatusProvider.getBatchReplicationStatus(resources);

        Map<String, Boolean> result = new LinkedHashMap<>();
        for (String path : paths) {
            ReplicationStatus status = statusMap.get(path);
            result.put(path, status != null && status.isActivated());
        }
        return result;
    }
}
```

**Required imports**:
```java
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
```

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
- Keep custom calls below 100 paths; see the batching caveat above and do not rely on automatic splitting.
- ≤10 MB payload size

### 2. Use Workflow for Large Operations
Don't build custom bulk publishing code. Use Tree Activation workflow step.

### 3. Validate Permissions
Always check permissions before replication to avoid exceptions.

### 4. Use Service Users
Never replicate with admin credentials. Map a sub-service name to the principal that holds `crx:replicate` via `ServiceUserMapperImpl.amended` config. Provision the principal with `jcr:read` + `crx:replicate` on `/content` via Repo Init scripts — see [AEM Project Structure — Repo Init](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/aem-project-content-package-structure#repo-init). See [replication/patterns.md](replication/patterns.md) for the full service user setup example.

### 5. Publish Only What's Needed
Minimize replication volume to reduce queue pressure and pipeline load.

## Common Patterns

See [replication/patterns.md](replication/patterns.md) for complete implementations:
- **Auto-Publish on Content Fragment Save** — event-driven publish using `SlingConstants.TOPIC_RESOURCE_CHANGED`
- **External Cache Purge After Publication** — CDN invalidation via replication event handler
- **Service User Setup for Replication** — OSGi service user mapping and Repo Init provisioning

## Troubleshooting

### Issue: Replication Fails Silently

**Check**: In **Tools > Deployment > Distribution**, open the `publish` or `preview` agent. Review its **persisted** and **fully published** queues and the **Logs** tab. Clearing `persisted` means content is durable on Publish; clearing `fully published` means it is live across Publish pods and Dispatcher invalidation is complete. A queued or accepted request alone does not prove delivery.

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

- **AEM SDK Javadocs (2026.9.28386.20260923T071724Z-260900)**: https://javadoc.io/static/com.adobe.aem/aem-sdk-api/2026.9.28386.20260923T071724Z-260900/com/day/cq/replication/package-summary.html
- **Cloud Service replication operations**: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/operations/replication
- **Sling Distribution**: https://sling.apache.org/documentation/bundles/content-distribution.html
