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

## Important: Cloud Service API Differences

**⚠️ CRITICAL**: The AEM 6.5 LTS Replication API (`com.day.cq.replication.*`) is **REMOVED** in Cloud Service.

### APIs That Don't Exist in Cloud Service:
- ❌ `Replicator` interface
- ❌ `ReplicationOptions`
- ❌ `ReplicationStatus`
- ❌ `AgentManager`
- ❌ `ReplicationQueue`
- ❌ Replication agents (no manual configuration)

### Cloud Service Alternatives:

| 6.5 LTS API | Cloud Service Alternative |
|-------------|--------------------------|
| `Replicator.replicate()` | Use `Replication` via Resource Resolver or JCR events |
| `ReplicationOptions` | Publication request properties |
| Agent configuration | Automatic (managed by Adobe) |
| `ReplicationListener` | OSGi Event Handler for replication events |
| Dispatcher Flush | Automatic CDN purge |

## Programmatic Publishing Approaches

### Approach 1: JCR-Based Replication (Recommended)

Trigger content distribution by setting JCR properties.

**Use when**: Simple programmatic publishing in OSGi services or workflows

#### Example: Publish a Page

```java
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ModifiableValueMap;
import javax.jcr.Node;
import javax.jcr.Session;

public class ContentPublisher {
    
    /**
     * Publish a page to the Publish tier
     */
    public void publishPage(ResourceResolver resolver, String pagePath) 
            throws Exception {
        
        Resource pageResource = resolver.getResource(pagePath + "/jcr:content");
        if (pageResource == null) {
            throw new IllegalArgumentException("Page not found: " + pagePath);
        }
        
        Node pageNode = pageResource.adaptTo(Node.class);
        
        // Set replication action
        pageNode.setProperty("cq:lastReplicationAction", "Activate");
        pageNode.setProperty("cq:lastReplicated", java.util.Calendar.getInstance());
        pageNode.setProperty("cq:lastReplicatedBy", resolver.getUserID());
        
        // Trigger replication
        Session session = resolver.adaptTo(Session.class);
        session.save();
        
        // Cloud Service automatically detects and replicates the content
    }
}
```

**Key Points**:
- Set `cq:lastReplicationAction` to `"Activate"`
- Set `cq:lastReplicated` to current timestamp
- Call `session.save()` to trigger distribution
- Cloud Service automatically detects changes and replicates

#### Example: Unpublish a Page

```java
public void unpublishPage(ResourceResolver resolver, String pagePath) 
        throws Exception {
    
    Resource pageResource = resolver.getResource(pagePath + "/jcr:content");
    if (pageResource == null) {
        return; // Page doesn't exist, nothing to unpublish
    }
    
    Node pageNode = pageResource.adaptTo(Node.class);
    
    // Set deactivation action
    pageNode.setProperty("cq:lastReplicationAction", "Deactivate");
    pageNode.setProperty("cq:lastReplicated", java.util.Calendar.getInstance());
    pageNode.setProperty("cq:lastReplicatedBy", resolver.getUserID());
    
    Session session = resolver.adaptTo(Session.class);
    session.save();
    
    // Cloud Service automatically unpublishes the content
}
```

#### Example: Publish to Preview Tier

```java
public void publishToPreview(ResourceResolver resolver, String pagePath) 
        throws Exception {
    
    Resource pageResource = resolver.getResource(pagePath + "/jcr:content");
    if (pageResource == null) {
        throw new IllegalArgumentException("Page not found: " + pagePath);
    }
    
    Node pageNode = pageResource.adaptTo(Node.class);
    
    // Set replication properties for Preview
    pageNode.setProperty("cq:lastReplicationAction", "Activate");
    pageNode.setProperty("cq:lastReplicated", java.util.Calendar.getInstance());
    pageNode.setProperty("cq:lastReplicatedBy", resolver.getUserID());
    
    // Target Preview tier (implementation may vary)
    // Cloud Service determines target tier based on request context
    
    Session session = resolver.adaptTo(Session.class);
    session.save();
}
```

**Note**: Targeting specific tiers (Preview vs. Publish) programmatically may require Adobe support configuration.

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
import com.adobe.granite.workflow.WorkflowException;
import com.adobe.granite.workflow.WorkflowSession;
import com.adobe.granite.workflow.exec.WorkflowData;
import com.adobe.granite.workflow.exec.WorkflowProcess;
import com.adobe.granite.workflow.metadata.MetaDataMap;

@Component(
    service = WorkflowProcess.class,
    property = {
        "process.label=Publish Content to Publish Tier"
    }
)
public class PublishWorkflowProcess implements WorkflowProcess {
    
    @Override
    public void execute(WorkItem workItem, WorkflowSession workflowSession, 
                       MetaDataMap args) throws WorkflowException {
        
        WorkflowData workflowData = workItem.getWorkflowData();
        String payloadPath = workflowData.getPayload().toString();
        
        ResourceResolver resolver = null;
        try {
            // Get resolver from workflow session
            Session session = workflowSession.adaptTo(Session.class);
            resolver = ... // Get resource resolver from session
            
            // Publish the content
            Resource resource = resolver.getResource(payloadPath + "/jcr:content");
            if (resource != null) {
                Node node = resource.adaptTo(Node.class);
                node.setProperty("cq:lastReplicationAction", "Activate");
                node.setProperty("cq:lastReplicated", 
                    java.util.Calendar.getInstance());
                session.save();
            }
            
        } catch (Exception e) {
            throw new WorkflowException("Failed to publish content", e);
        } finally {
            if (resolver != null && resolver.isLive()) {
                resolver.close();
            }
        }
    }
}
```

**Process Arguments** (configured in workflow model):
- `target=publish` - Publish to Publish tier
- `target=preview` - Publish to Preview tier (if supported)

### Approach 4: Event-Driven Publishing

React to content changes and automatically publish.

**Use when**: Specific content types should auto-publish on save

#### Example: Auto-Publish Content Fragments on Save

```java
import org.osgi.service.component.annotations.Component;
import org.osgi.service.event.Event;
import org.osgi.service.event.EventHandler;
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
    private ResourceResolverFactory resolverFactory;
    
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
                    // Auto-publish the content fragment
                    Node node = resource.adaptTo(Node.class);
                    node.setProperty("cq:lastReplicationAction", "Activate");
                    node.setProperty("cq:lastReplicated", 
                        java.util.Calendar.getInstance());
                    resolver.commit();
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

### Example: Bulk Publish Content Fragments

```java
import org.apache.sling.api.resource.ResourceResolver;
import java.util.Iterator;

public class BulkContentFragmentPublisher {
    
    /**
     * Publish all content fragments under a path
     */
    public void publishAllContentFragments(ResourceResolver resolver, 
                                          String basePath) throws Exception {
        
        // Find all content fragments
        Iterator<Resource> fragments = resolver.findResources(
            "SELECT * FROM [dam:Asset] WHERE " +
            "ISDESCENDANTNODE('" + basePath + "') " +
            "AND [jcr:content/contentFragment] = true",
            javax.jcr.query.Query.JCR_SQL2
        );
        
        int count = 0;
        int batchSize = 50;
        
        while (fragments.hasNext()) {
            Resource fragment = fragments.next();
            Resource contentResource = fragment.getChild("jcr:content");
            
            if (contentResource != null) {
                Node node = contentResource.adaptTo(Node.class);
                node.setProperty("cq:lastReplicationAction", "Activate");
                node.setProperty("cq:lastReplicated", 
                    java.util.Calendar.getInstance());
                
                count++;
                
                // Commit in batches to avoid memory issues
                if (count % batchSize == 0) {
                    resolver.commit();
                }
            }
        }
        
        // Final commit
        if (count % batchSize != 0) {
            resolver.commit();
        }
        
        // Log results
        System.out.println("Published " + count + " content fragments");
    }
}
```

### Best Practices for Bulk Operations

1. **Batch Size**: Commit in batches of 50-100 items
2. **Error Handling**: Log failures but continue processing
3. **Service User**: Use service user with appropriate permissions
4. **Performance**: Run during off-peak hours
5. **Monitoring**: Log progress and errors
6. **Rate Limiting**: Add delays between batches if needed

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
