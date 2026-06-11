# Programmatic Workflow API — AEM Cloud Service

## Service User Setup (Cloud Service)

Never use admin credentials in production. Map a sub-service (e.g. `workflow-starter`) to a
**service user that is a member of the `workflow-process-service` group** — `workflow-process-service`
is a group, not a user, so map the subservice to your own service user and grant it the group
membership (this is the Cloud Service–correct pattern and avoids the user-vs-group confusion).

Create the service user and its group membership via repoinit (Cloud Manager OSGi config), then
map your bundle's subservice to it:

```
# repoinit (e.g. ui.config .../org.apache.sling.jcr.repoinit.RepositoryInitializer~myapp.cfg.json)
create service user my-app-workflow-starter
add my-app-workflow-starter to group workflow-process-service
```

```xml
<!-- ui.apps/src/main/content/jcr_root/apps/my-app/config/
     org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-myapp.xml -->
<jcr:root
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    jcr:primaryType="sling:OsgiConfig"
    user.mapping="[com.example.my-bundle:workflow-starter=my-app-workflow-starter]"/>
```

## Complete Service Class Pattern

```java
@Component(service = WorkflowStarterService.class)
public class WorkflowStarterService {

    private static final Logger LOG = LoggerFactory.getLogger(WorkflowStarterService.class);
    private static final String SUBSERVICE = "workflow-starter";

    @Reference
    private ResourceResolverFactory resolverFactory;

    /**
     * Start a workflow synchronously and return the instance ID.
     */
    public String startWorkflow(String payloadPath, String modelId,
                                String title) throws WorkflowException {
        Map<String, Object> auth = Collections.singletonMap(
            ResourceResolverFactory.SUBSERVICE, SUBSERVICE);
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(auth)) {
            WorkflowSession session = resolver.adaptTo(WorkflowSession.class);
            if (session == null) {
                throw new WorkflowException("WorkflowSession not available");
            }
            WorkflowModel model = session.getModel(modelId);
            WorkflowData data = session.newWorkflowData("JCR_PATH", payloadPath);
            data.getMetaDataMap().put("workflowTitle", title);
            Workflow instance = session.startWorkflow(model, data);
            LOG.info("Started workflow {} for payload {}", instance.getId(), payloadPath);
            return instance.getId();
        } catch (LoginException e) {
            throw new WorkflowException("Service user login failed", e);
        }
    }

    /**
     * Terminate a running workflow by instance ID.
     */
    public void terminateWorkflow(String instanceId) throws WorkflowException {
        Map<String, Object> auth = Collections.singletonMap(
            ResourceResolverFactory.SUBSERVICE, SUBSERVICE);
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(auth)) {
            WorkflowSession session = resolver.adaptTo(WorkflowSession.class);
            Workflow instance = session.getWorkflow(instanceId);
            session.terminateWorkflow(instance);
        } catch (LoginException e) {
            throw new WorkflowException("Service user login failed", e);
        }
    }
}
```

## Starting a Workflow from a Sling Scheduler

```java
@Component(service = Runnable.class,
           property = {
               Scheduler.PROPERTY_SCHEDULER_EXPRESSION + "=0 0 2 * * ?",
               Scheduler.PROPERTY_SCHEDULER_CONCURRENT + "=false"
           })
public class NightlyAssetProcessingJob implements Runnable {

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public void run() {
        Map<String, Object> auth = Collections.singletonMap(
            ResourceResolverFactory.SUBSERVICE, "workflow-starter");
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(auth)) {
            WorkflowSession wfs = resolver.adaptTo(WorkflowSession.class);
            WorkflowModel model = wfs.getModel("/var/workflow/models/asset-processing");
            Iterator<Resource> assets = resolver.findResources(
                "SELECT * FROM [dam:Asset] WHERE ISDESCENDANTNODE('/content/dam/pending')",
                Query.JCR_SQL2);
            while (assets.hasNext()) {
                String path = assets.next().getPath();
                WorkflowData data = wfs.newWorkflowData("JCR_PATH", path);
                wfs.startWorkflow(model, data);
            }
        } catch (Exception e) {
            LoggerFactory.getLogger(getClass()).error("Nightly workflow job failed", e);
        }
    }
}
```

## Starting a Workflow from a Sling Event Handler

```java
@Component(service = EventHandler.class,
           property = {
               EventConstants.EVENT_TOPIC + "=com/example/content/published"
           })
public class ContentPublishedHandler implements EventHandler {

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public void handleEvent(Event event) {
        String path = (String) event.getProperty("path");
        if (path == null) return;

        Map<String, Object> auth = Collections.singletonMap(
            ResourceResolverFactory.SUBSERVICE, "workflow-starter");
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(auth)) {
            WorkflowSession wfs = resolver.adaptTo(WorkflowSession.class);
            WorkflowModel model = wfs.getModel("/var/workflow/models/post-publish-review");
            WorkflowData data = wfs.newWorkflowData("JCR_PATH", path);
            data.getMetaDataMap().put("triggeredBy", "ContentPublishedHandler");
            wfs.startWorkflow(model, data);
        } catch (Exception e) {
            LoggerFactory.getLogger(getClass()).error(
                "Failed to start workflow for {}", path, e);
        }
    }
}
```

## Querying Active Workflow Instances

```java
WorkflowSession session = resolver.adaptTo(WorkflowSession.class);

// Get all RUNNING workflows.
// Workflow.State is an enum { RUNNING, COMPLETED, SUSPENDED, ABORTED };
// getWorkflows(...) takes the state names as Strings.
Workflow[] running = session.getWorkflows(new String[]{Workflow.State.RUNNING.name()});

// Paginated retrieval (start offset, page size)
ResultSet<Workflow> page = session.getWorkflows(
    new String[]{Workflow.State.RUNNING.name()}, 0L, 50L);

// Filter in-memory by model
Arrays.stream(running)
    .filter(wf -> "/var/workflow/models/my-workflow".equals(
        wf.getWorkflowModel().getId()))
    .forEach(wf -> LOG.info("Instance: {}", wf.getId()));
```

## Completing a Work Item Programmatically

```java
// Used for automated approval in tests or batch tools
WorkItem item = ...; // obtained from session.getActiveWorkItems()
List<Route> routes = session.getRoutes(item, false);
Route approve = routes.stream()
    .filter(r -> "Approve".equals(r.getName()))
    .findFirst().orElse(routes.get(0));
item.getWorkflowData().getMetaDataMap().put("reviewDecision", "APPROVE");
session.complete(item, approve);
```

## Model ID Reference

| What you have | What to use as modelId |
|---|---|
| Design-time path | `/conf/global/settings/workflow/models/my-workflow` — **do not use** |
| Runtime path (correct) | `/var/workflow/models/my-workflow` |
| How to find it | Open the model in the Workflow Model Editor → copy the **ID** field from Model Properties, or call `WorkflowSession.getModels()` and inspect `model.getId()` |

Always use the `/var/workflow/models/` runtime path with `getModel()`. On Cloud Service
the `/etc/workflow/models/` path is deprecated and unsupported — use `/var/workflow/models/` only.
