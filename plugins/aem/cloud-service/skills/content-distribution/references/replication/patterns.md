# Replication Patterns

## Pattern 1: Auto-Publish on Content Fragment Save

```java
@Component(service = EventHandler.class,
    property = EventConstants.EVENT_TOPIC + "=" + SlingConstants.TOPIC_RESOURCE_CHANGED)
public class AutoPublishContentFragmentHandler implements EventHandler {
    @Reference private Replicator replicator;
    @Reference private ResourceResolverFactory resolverFactory;

    @Override
    public void handleEvent(Event event) {
        String path = (String) event.getProperty(SlingConstants.PROPERTY_PATH);
        if (path != null && path.startsWith("/content/dam") && isContentFragment(path)) {
            try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                    Map.of(ResourceResolverFactory.SUBSERVICE, "contentPublisher"))) {
                Session session = resolver.adaptTo(Session.class);
                replicator.replicate(session, ReplicationActionType.ACTIVATE, path);
            } catch (Exception e) {
                LOG.error("Auto-publish failed for {}", path, e);
            }
        }
    }
}
```

## Pattern 2: External Cache Purge After Publication

```java
@Component(service = EventHandler.class,
    property = EventConstants.EVENT_TOPIC + "=com/day/cq/replication")
public class ExternalCachePurgeHandler implements EventHandler {
    @Reference private HttpClient httpClient;

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
        try {
            HttpPost request = new HttpPost("https://cdn.example.com/purge");
            request.setHeader("Content-Type", "application/json");
            request.setEntity(new StringEntity("{\"path\":\"" + path + "\"}"));
            httpClient.execute(request);
        } catch (Exception e) {
            LOG.error("Cache purge failed for {}", path, e);
        }
    }
}
```

## Pattern 3: Service User Setup for Replication

OSGi service user mapping config (`ui.config/.../org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-myapp.cfg.json`):

```json
{
  "user.mapping": [
    "com.myapp.core:contentPublisher=myapp-replication-service"
  ]
}
```

Obtain the resolver in code:

```java
@Reference private ResourceResolverFactory resolverFactory;

private ResourceResolver getServiceResolver() throws LoginException {
    return resolverFactory.getServiceResourceResolver(
        Map.of(ResourceResolverFactory.SUBSERVICE, "contentPublisher"));
}
```

The principal `myapp-replication-service` must have `jcr:read` + `crx:replicate` on `/content`, provisioned via Repo Init scripts.
