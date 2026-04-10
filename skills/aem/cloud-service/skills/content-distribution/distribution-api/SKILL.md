---
name: distribution-api
description: |
  Programmatic content distribution using Sling Content Distribution API, event handling,
  and custom workflows. Covers publication events, bulk operations, and custom distribution logic.
---

# Content Distribution API

Programmatic content distribution using Sling Content Distribution API, event handling, and custom workflows.

## When to Use This Skill

Use this skill for programmatic content distribution:
- Custom OSGi services that publish content
- Workflow process steps that activate content
- Bulk content operations
- Integration with external systems
- Automated publishing pipelines
- React to publication events

For UI-based publishing, use [Publish Content](../publish-content/SKILL.md) instead.

## Important: Cloud Service API

**The Replication API (`com.day.cq.replication.*`) is the official programmatic API for content distribution in AEM as a Cloud Service.**

### Available APIs in Cloud Service:
- ✅ `Replicator` interface with `replicate()` methods
- ✅ `ReplicationOptions` for configuring replication requests
- ✅ `ReplicationStatus` and `ReplicationStatusProvider` for status queries
- ✅ `ReplicationEvent` for OSGi event handling
- ✅ Automatic agent management (no manual configuration needed)

### Key Differences from 6.5 LTS:

| Aspect | 6.5 LTS | Cloud Service |
|--------|---------|---------------|
| **API** | Same Replication API | Same Replication API |
| **Agent configuration** | Manual via UI | Automatic (managed by Adobe) |
| **Capacity limits** | No hard limits | Max 100 paths per call (500 absolute limit), 10MB size limit |
| **Bulk operations** | Custom code allowed | Use Tree Activation workflow step instead |
| **CDN cache** | Manual Dispatcher Flush agents | Automatic CDN purge |

## Programmatic Publishing Approaches

### Approach 1: Replication API (Recommended)

Use the official `Replicator` interface to trigger content distribution.

**Use when**: Programmatic publishing in OSGi services or workflows

#### Example: Publish a Single Page

```java
import com.day.cq.replication.Replicator;
import com.day.cq.replication.ReplicationActionType;
import com.day.cq.replication.ReplicationException;
import org.apache.sling.api.resource.ResourceResolver;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import javax.jcr.Session;

@Component(service = ContentPublisher.class)
public class ContentPublisher {
    
    @Reference
    private Replicator replicator;
    
    /**
     * Publish a page to the Publish tier
     */
    public void publishPage(ResourceResolver resolver, String pagePath) 
            throws ReplicationException {
        
        Session session = resolver.adaptTo(Session.class);
        
        // Activate (publish) the page
        replicator.replicate(session, ReplicationActionType.ACTIVATE, pagePath);
    }
}
```

**Key Points**:
- Inject `Replicator` service via OSGi reference
- Use `ReplicationActionType.ACTIVATE` for publishing
- Use `ReplicationActionType.DEACTIVATE` for unpublishing
- Limit to 100 paths per call (Cloud Service capacity limit)

#### Example: Unpublish a Page

```java
public void unpublishPage(ResourceResolver resolver, String pagePath) 
        throws ReplicationException {
    
    Session session = resolver.adaptTo(Session.class);
    
    // Deactivate (unpublish) the page
    replicator.replicate(session, ReplicationActionType.DEACTIVATE, pagePath);
}
```

#### Example: Publish Multiple Pages with Options

```java
import com.day.cq.replication.ReplicationOptions;

public void publishMultiplePages(ResourceResolver resolver, String[] pagePaths) 
        throws ReplicationException {
    
    Session session = resolver.adaptTo(Session.class);
    
    // Configure replication options
    ReplicationOptions options = new ReplicationOptions();
    options.setSynchronous(false);  // Asynchronous replication
    options.setSuppressStatusUpdate(false);  // Update replication status
    
    // Replicate multiple paths
    // IMPORTANT: Limit to max 100 paths (Cloud Service limit)
    if (pagePaths.length > 100) {
        throw new IllegalArgumentException(
            "Cannot replicate more than 100 paths at once. Use Tree Activation workflow instead.");
    }
    
    replicator.replicate(session, ReplicationActionType.ACTIVATE, pagePaths, options);
}
```

**Cloud Service Capacity Limits**:
- Maximum 100 paths per `replicate()` call (recommended)
- Absolute limit: 500 paths (throws `ReplicationException` if exceeded)
- Maximum 10MB content size per call (excluding binaries)
- For bulk operations (>100 paths), use Tree Activation workflow step

### Approach 2: Sling POST Servlet (HTTP-Based)

Trigger publishing via HTTP POST request.

**Use when**: External systems need to trigger publishing, or HTTP API is preferred

#### Example: HTTP Request to Publish

```bash
# Publish a page
curl -X POST \
  -u admin:admin \
  -F "cmd=Activate" \
  -F "path=/content/wknd/en/about-us" \
  https://author-p12345-e67890.adobeaemcloud.com/bin/replicate.json

# Response:
{
  "success": true,
  "path": "/content/wknd/en/about-us",
  "action": "Activate"
}
```

#### Example: Unpublish via HTTP

```bash
curl -X POST \
  -u admin:admin \
  -F "cmd=Deactivate" \
  -F "path=/content/wknd/en/about-us" \
  https://author-p12345-e67890.adobeaemcloud.com/bin/replicate.json
```

#### Example: Bulk Publish Multiple Paths

```bash
curl -X POST \
  -u admin:admin \
  -F "cmd=Activate" \
  -F "path=/content/wknd/en/page1" \
  -F "path=/content/wknd/en/page2" \
  -F "path=/content/wknd/en/page3" \
  https://author-p12345-e67890.adobeaemcloud.com/bin/replicate.json
```

**Best Practices**:
- Use service user authentication (not admin credentials)
- Limit bulk operations to 100 paths per request
- Implement retry logic for transient failures

### Approach 3: Workflow Process Step

Integrate publishing into custom workflows.

**Use when**: Approval workflows require automatic publishing after approval

#### Example: Workflow Process Step for Publishing

```java
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import com.adobe.granite.workflow.WorkflowException;
import com.adobe.granite.workflow.WorkflowSession;
import com.adobe.granite.workflow.exec.WorkflowData;
import com.adobe.granite.workflow.exec.WorkflowProcess;
import com.adobe.granite.workflow.metadata.MetaDataMap;
import com.day.cq.replication.Replicator;
import com.day.cq.replication.ReplicationActionType;
import com.day.cq.replication.ReplicationException;
import javax.jcr.Session;

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
        
        WorkflowData workflowData = workItem.getWorkflowData();
        String payloadPath = workflowData.getPayload().toString();
        
        try {
            Session session = workflowSession.adaptTo(Session.class);
            
            // Publish the content using Replication API
            replicator.replicate(session, ReplicationActionType.ACTIVATE, payloadPath);
            
        } catch (ReplicationException e) {
            throw new WorkflowException("Failed to publish content: " + payloadPath, e);
        }
    }
}
```

**Process Arguments** (configured in workflow model):
- None required - publishes to default Publish tier
- For bulk operations, use the Tree Activation workflow step instead

### Approach 4: Event-Driven Publishing

React to content changes and automatically publish.

**Use when**: Specific content types should auto-publish on save

#### Example: Auto-Publish Content Fragments on Save

```java
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.event.Event;
import org.osgi.service.event.EventHandler;
import org.apache.sling.api.SlingConstants;
import org.apache.sling.api.resource.ResourceResolverFactory;
import com.day.cq.replication.Replicator;
import com.day.cq.replication.ReplicationActionType;
import javax.jcr.Session;

@Component(
    service = EventHandler.class,
    property = {
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
            SlingConstants.TOPIC_RESOURCE_CHANGED
    }
)
public class AutoPublishContentFragmentHandler implements EventHandler {
    
    @Reference
    private ResourceResolverFactory resolverFactory;
    
    @Reference
    private Replicator replicator;
    
    @Override
    public void handleEvent(Event event) {
        String path = (String) event.getProperty(SlingConstants.PROPERTY_PATH);
        
        // Only process content fragments
        if (path != null && path.contains("/content/dam") && 
            path.endsWith("/jcr:content")) {
            
            ResourceResolver resolver = null;
            try {
                // Get service resolver
                resolver = getServiceResourceResolver();
                
                Resource resource = resolver.getResource(path);
                if (resource != null && isContentFragment(resource)) {
                    // Auto-publish the content fragment using Replication API
                    Session session = resolver.adaptTo(Session.class);
                    
                    // Strip /jcr:content suffix for replication
                    String assetPath = path.substring(0, path.lastIndexOf("/jcr:content"));
                    replicator.replicate(session, ReplicationActionType.ACTIVATE, assetPath);
                }
                
            } catch (Exception e) {
                // Log error
            } finally {
                if (resolver != null && resolver.isLive()) {
                    resolver.close();
                }
            }
        }
    }
    
    private boolean isContentFragment(Resource resource) {
        // Check if resource is a content fragment
        return resource.isResourceType("dam/cfm/components/contentfragment");
    }
    
    private ResourceResolver getServiceResourceResolver() throws Exception {
        Map<String, Object> param = new HashMap<>();
        param.put(ResourceResolverFactory.SUBSERVICE, "contentPublisher");
        return resolverFactory.getServiceResourceResolver(param);
    }
}
```

**Service User Configuration**:
```
# ui.config/src/main/content/jcr_root/apps/wknd/osgiconfig/config/
# org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-contentPublisher.cfg.json
{
  "user.mapping": [
    "com.adobe.aem.wknd.core:contentPublisher=wknd-service-user"
  ]
}
```

## Listening to Replication Events

### OSGi Event Handler for Replication Events

React when content is published or unpublished.

**Use when**: Need to trigger actions after content distribution (e.g., cache warming, analytics, notifications)

#### Example: Log Replication Events

```java
import org.osgi.service.component.annotations.Component;
import org.osgi.service.event.Event;
import org.osgi.service.event.EventHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Component(
    service = EventHandler.class,
    property = {
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
            "com/day/cq/replication"
    }
)
public class ReplicationEventLogger implements EventHandler {
    
    private static final Logger LOG = 
        LoggerFactory.getLogger(ReplicationEventLogger.class);
    
    @Override
    public void handleEvent(Event event) {
        String[] paths = (String[]) event.getProperty("paths");
        String action = (String) event.getProperty("action");
        String userId = (String) event.getProperty("userId");
        
        if (paths != null) {
            for (String path : paths) {
                LOG.info("Replication event: action={}, path={}, user={}", 
                    action, path, userId);
            }
        }
    }
}
```

#### Example: Purge External Cache After Publication

```java
@Component(
    service = EventHandler.class,
    property = {
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
            "com/day/cq/replication"
    }
)
public class ExternalCachePurgeHandler implements EventHandler {
    
    @Reference
    private HttpClient httpClient; // Apache HttpClient
    
    @Override
    public void handleEvent(Event event) {
        String action = (String) event.getProperty("action");
        
        // Only purge on Activate or Deactivate
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
        try {
            // Call external CDN purge API
            HttpPost request = new HttpPost("https://cdn.example.com/purge");
            request.setHeader("Content-Type", "application/json");
            request.setEntity(new StringEntity("{\"path\":\"" + path + "\"}"));
            
            HttpResponse response = httpClient.execute(request);
            // Handle response
            
        } catch (Exception e) {
            // Log error
        }
    }
}
```

#### Example: Send Notification After Publication

```java
@Component(
    service = EventHandler.class,
    property = {
        org.osgi.service.event.EventConstants.EVENT_TOPIC + "=" + 
            "com/day/cq/replication"
    }
)
public class PublicationNotificationHandler implements EventHandler {
    
    @Reference
    private MailService mailService;
    
    @Override
    public void handleEvent(Event event) {
        String action = (String) event.getProperty("action");
        
        if ("Activate".equals(action)) {
            String[] paths = (String[]) event.getProperty("paths");
            String userId = (String) event.getProperty("userId");
            
            // Send notification email
            String message = String.format(
                "User %s published %d page(s)", 
                userId, paths.length
            );
            
            sendNotification(message);
        }
    }
    
    private void sendNotification(String message) {
        // Send email or Slack notification
    }
}
```

## Querying Publication Status

Check if content is published.

### Example: Check Publication Status

```java
import com.day.cq.wcm.api.Page;
import com.day.cq.wcm.api.PageManager;

public class PublicationStatusChecker {
    
    /**
     * Check if a page is published
     */
    public boolean isPublished(ResourceResolver resolver, String pagePath) {
        PageManager pageManager = resolver.adaptTo(PageManager.class);
        Page page = pageManager.getPage(pagePath);
        
        if (page == null) {
            return false;
        }
        
        // Check replication status from jcr:content
        Resource contentResource = page.getContentResource();
        if (contentResource != null) {
            ValueMap properties = contentResource.getValueMap();
            String action = properties.get("cq:lastReplicationAction", String.class);
            return "Activate".equals(action);
        }
        
        return false;
    }
    
    /**
     * Get last publication date
     */
    public Calendar getLastPublished(ResourceResolver resolver, String pagePath) {
        PageManager pageManager = resolver.adaptTo(PageManager.class);
        Page page = pageManager.getPage(pagePath);
        
        if (page != null) {
            Resource contentResource = page.getContentResource();
            if (contentResource != null) {
                ValueMap properties = contentResource.getValueMap();
                return properties.get("cq:lastReplicated", Calendar.class);
            }
        }
        
        return null;
    }
    
    /**
     * Check if page has unpublished changes
     */
    public boolean hasUnpublishedChanges(ResourceResolver resolver, String pagePath) {
        PageManager pageManager = resolver.adaptTo(PageManager.class);
        Page page = pageManager.getPage(pagePath);
        
        if (page != null) {
            Resource contentResource = page.getContentResource();
            if (contentResource != null) {
                ValueMap properties = contentResource.getValueMap();
                Calendar lastModified = properties.get("cq:lastModified", Calendar.class);
                Calendar lastReplicated = properties.get("cq:lastReplicated", Calendar.class);
                
                if (lastModified != null && lastReplicated != null) {
                    return lastModified.after(lastReplicated);
                }
            }
        }
        
        return false;
    }
}
```

## Bulk Operations

**⚠️ IMPORTANT**: For bulk operations (>100 paths), Adobe recommends using the **Tree Activation workflow step** instead of custom code. See the [official documentation](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/operations/replication) for details.

### Example: Bulk Publish Content Fragments (Small Scale)

For publishing <100 items programmatically:

```java
import org.apache.sling.api.resource.ResourceResolver;
import org.osgi.service.component.annotations.Reference;
import com.day.cq.replication.Replicator;
import com.day.cq.replication.ReplicationActionType;
import com.day.cq.replication.ReplicationOptions;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import javax.jcr.Session;

@Component(service = BulkContentFragmentPublisher.class)
public class BulkContentFragmentPublisher {
    
    @Reference
    private Replicator replicator;
    
    /**
     * Publish content fragments under a path (max 100 items)
     */
    public void publishContentFragments(ResourceResolver resolver, 
                                        String basePath) throws Exception {
        
        // Find all content fragments
        Iterator<Resource> fragments = resolver.findResources(
            "SELECT * FROM [dam:Asset] WHERE " +
            "ISDESCENDANTNODE('" + basePath + "') " +
            "AND [jcr:content/contentFragment] = true",
            javax.jcr.query.Query.JCR_SQL2
        );
        
        // Collect paths (Cloud Service limit: max 100 paths per call)
        List<String> paths = new ArrayList<>();
        while (fragments.hasNext() && paths.size() < 100) {
            Resource fragment = fragments.next();
            paths.add(fragment.getPath());
        }
        
        if (paths.isEmpty()) {
            return; // Nothing to publish
        }
        
        // Replicate using Replication API
        Session session = resolver.adaptTo(Session.class);
        ReplicationOptions options = new ReplicationOptions();
        options.setSynchronous(false);  // Asynchronous for better performance
        
        replicator.replicate(
            session, 
            ReplicationActionType.ACTIVATE, 
            paths.toArray(new String[0]), 
            options
        );
        
        LOG.info("Published {} content fragments from {}", paths.size(), basePath);
    }
}
```

### Best Practices for Bulk Operations

1. **Use Tree Activation Workflow**: For >100 paths, use the Tree Activation workflow step (recommended by Adobe)
2. **Respect Cloud Service Limits**: Maximum 100 paths per `replicate()` call (500 absolute limit)
3. **Size Limit**: Maximum 10MB content per call (excluding binaries)
4. **Error Handling**: Log failures but continue processing
5. **Service User**: Use service user with appropriate permissions
6. **Performance**: Run during off-peak hours
7. **Asynchronous Replication**: Set `ReplicationOptions.setSynchronous(false)` for better performance

## Service User Configuration

All programmatic publishing requires service user permissions.

### Create Service User

```xml
<!-- ui.apps/src/main/content/jcr_root/apps/wknd/config.author/
     org.apache.sling.jcr.repoinit.RepositoryInitializer~wknd.config -->
create service user wknd-content-publisher

set ACL for wknd-content-publisher
    allow jcr:read,rep:write on /content
    allow jcr:read,rep:write on /content/dam
end
```

### Map Service User

```json
// ui.config/src/main/content/jcr_root/apps/wknd/osgiconfig/config/
// org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-contentPublisher.cfg.json
{
  "user.mapping": [
    "com.adobe.aem.wknd.core:contentPublisher=wknd-content-publisher"
  ]
}
```

### Use Service User in Code

```java
@Component(service = ContentPublisher.class)
public class ContentPublisher {
    
    @Reference
    private ResourceResolverFactory resolverFactory;
    
    public void publishContent(String path) {
        ResourceResolver resolver = null;
        try {
            Map<String, Object> param = new HashMap<>();
            param.put(ResourceResolverFactory.SUBSERVICE, "contentPublisher");
            resolver = resolverFactory.getServiceResourceResolver(param);
            
            // Use resolver to publish content
            // ...
            
        } catch (LoginException e) {
            // Handle error
        } finally {
            if (resolver != null && resolver.isLive()) {
                resolver.close();
            }
        }
    }
}
```

## Best Practices

### Development Best Practices

1. **Use Service Users**: Never use admin credentials
2. **Error Handling**: Implement robust error handling and logging
3. **Transactions**: Commit in batches for bulk operations
4. **Resource Management**: Always close ResourceResolver in finally block
5. **Permissions**: Request minimal required permissions

### Performance Best Practices

1. **Batch Operations**: Commit every 50-100 items
2. **Off-Peak Scheduling**: Run bulk operations during low-traffic periods
3. **Async Processing**: Use Sling Jobs for large operations
4. **Rate Limiting**: Add delays between batches if needed
5. **Monitoring**: Track operation progress and duration

### Security Best Practices

1. **Least Privilege**: Grant minimal required permissions
2. **Input Validation**: Validate all paths and parameters
3. **Authentication**: Use service user authentication
4. **Audit Logging**: Log all programmatic publications
5. **Path Restrictions**: Restrict service user to specific content paths

## Official Documentation

- [Replication in Cloud Service](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/operations/replication)
- [Service Users](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/security/best-practices-for-sling-service-user-mapping-and-service-user-definition)
- [OSGi Event Handling](https://sling.apache.org/documentation/bundles/apache-sling-eventing-and-job-handling.html)

## Related Skills

- **Publish Content**: UI-based publishing workflows
- **Troubleshoot Distribution**: Diagnose API issues
- **AEM Workflow**: Integrate with workflows
