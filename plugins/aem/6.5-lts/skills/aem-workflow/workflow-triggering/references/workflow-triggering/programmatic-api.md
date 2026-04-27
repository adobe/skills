# Programmatic Workflow API — AEM 6.5 LTS

## Service User Setup (6.5 LTS)

Use `ResourceResolverFactory.getServiceResourceResolver()` with a sub-service name. Map the sub-service in a factory config via Felix SCR or DS R6:

```xml
<!-- /apps/my-app/config.author/
     org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-myapp.xml -->
<jcr:root
    xmlns:jcr="http://www.jcp.org/jcr/1.0"
    xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
    jcr:primaryType="sling:OsgiConfig"
    user.mapping="[com.example.my-bundle:workflow-starter=workflow-process-service]"/>
```

Alternatively, define a dedicated service user and add `jcr:read` on model paths and `jcr:write` on instance paths.

## Complete Service Class Pattern (DS R6)

```java
@Component(service = WorkflowStarterService.class)
public class WorkflowStarterService {

    private static final Logger LOG = LoggerFactory.getLogger(WorkflowStarterService.class);

    @Reference
    private ResourceResolverFactory resolverFactory;

    public String startWorkflow(String payloadPath, String modelId, String title)
            throws WorkflowException {
        Map<String, Object> auth = Collections.singletonMap(
            ResourceResolverFactory.SUBSERVICE, "workflow-starter");
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(auth)) {
            WorkflowSession session = resolver.adaptTo(WorkflowSession.class);
            WorkflowModel model = session.getModel(modelId);
            if (model == null) {
                // getModel returns null when the model isn't deployed or the path
                // is wrong (typo, not synced from /conf to /var). Fail fast — the
                // next call would NPE.
                throw new WorkflowException("Workflow model not found: " + modelId);
            }
            WorkflowData data = session.newWorkflowData("JCR_PATH", payloadPath);
            data.getMetaDataMap().put("workflowTitle", title);
            // startWorkflow() is non-blocking; step execution happens asynchronously
            // on the Sling job queue. To wait for completion, poll instance.getState().
            Workflow instance = session.startWorkflow(model, data);
            LOG.info("Started workflow {} for payload {}", instance.getId(), payloadPath);
            return instance.getId();
        } catch (LoginException e) {
            throw new WorkflowException("Service user login failed", e);
        }
    }
}
```

## Felix SCR Equivalent (Legacy 6.5 Projects)

```java
@org.apache.felix.scr.annotations.Component(metatype = false)
@org.apache.felix.scr.annotations.Service(value = WorkflowStarterService.class)
public class WorkflowStarterService {
    @org.apache.felix.scr.annotations.Reference
    private ResourceResolverFactory resolverFactory;
    // ... same implementation
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

    private static final Logger LOG = LoggerFactory.getLogger(NightlyAssetProcessingJob.class);

    // Hard cap per run — prevents an unbounded query result from saturating the
    // workflow job queue. Tune to your environment; remaining items run next cycle.
    private static final int MAX_PER_RUN = 500;

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public void run() {
        Map<String, Object> auth = Collections.singletonMap(
            ResourceResolverFactory.SUBSERVICE, "workflow-starter");
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(auth)) {
            WorkflowSession wfs = resolver.adaptTo(WorkflowSession.class);
            WorkflowModel model = wfs.getModel("/var/workflow/models/asset-processing");
            if (model == null) {
                LOG.error("Workflow model not deployed; aborting batch");
                return;
            }
            // High-volume triggering: set transient="true" on the model to avoid
            // /var/workflow/instances bloat. See workflow-model-design Architecture
            // Considerations for the full rationale.
            Iterator<Resource> assets = resolver.findResources(
                "SELECT * FROM [dam:Asset] WHERE ISDESCENDANTNODE('/content/dam/pending')",
                Query.JCR_SQL2);
            int started = 0;
            while (assets.hasNext() && started < MAX_PER_RUN) {
                String path = assets.next().getPath();
                try {
                    WorkflowData data = wfs.newWorkflowData("JCR_PATH", path);
                    wfs.startWorkflow(model, data);
                    started++;
                } catch (WorkflowException e) {
                    // One bad payload should not abort the whole batch — log and continue.
                    LOG.warn("Failed to start workflow for {}: {}", path, e.getMessage());
                }
            }
            LOG.info("Started {} workflows; remaining will run next cycle", started);
        } catch (LoginException e) {
            LOG.error("Service user login failed", e);
        }
    }
}
```

## Querying Active Workflow Instances

```java
WorkflowSession session = resolver.adaptTo(WorkflowSession.class);
WorkflowFilter filter = session.createWorkflowFilter();
filter.setWorkflowStatus(Workflow.STATUS_RUNNING);
filter.setWorkflowModelId("/var/workflow/models/my-workflow");
Workflow[] running = session.getWorkflows(filter);
```

## 6.5 LTS-Specific: SlingRepository.loginAdministrative (Deprecated — Avoid)

In legacy AEM 6.x code, you may encounter:
```java
Session jcrSession = slingRepository.loginAdministrative(null);
```
This is deprecated and should be replaced with `loginService(bundleSymbolicName, subServiceName)` or the `ResourceResolverFactory` pattern shown above.

## Model ID Reference

| What you have | What to use as modelId |
|---|---|
| Design-time path | `/conf/global/settings/workflow/models/my-workflow` — **do not use** |
| Runtime path (correct) | `/var/workflow/models/my-workflow` |
| Legacy `/etc` path | `/etc/workflow/models/my-workflow` — check if still valid |
| How to find it | Open Model Editor → copy the **ID** field from the Model Properties dialog |

On 6.5 LTS, models authored in `/etc/workflow/models/` remain valid; models migrated via the Workflow Migration Tool live at `/conf/global/settings/workflow/models/` (design-time) and `/var/workflow/models/` (runtime).
