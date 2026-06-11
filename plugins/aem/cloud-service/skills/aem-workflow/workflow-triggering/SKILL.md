---
name: workflow-triggering
description: Start AEM Workflows on AEM as a Cloud Service using all available triggering mechanisms. Use when starting workflows manually via the Timeline UI, programmatically via WorkflowSession.startWorkflow(), via the HTTP Workflow API, through Manage Publication, or passing initial metadata and payload to a workflow instance.
license: Apache-2.0
---

# Workflow Triggering (Cloud Service)

All mechanisms to start a workflow on AEM Cloud Service — from UI, programmatic API, HTTP API, and Manage Publication.

## Variant Scope

- AEM Cloud Service only.
- For programmatic triggering, use a service user — map a sub-service (e.g. `workflow-starter`)
  to a service user that is a member of the `workflow-process-service` group
  (`workflow-process-service` is a group, not a user). See
  [programmatic-api.md](./references/workflow-triggering/programmatic-api.md) for the mapping config.

## Triggering Mechanisms Summary

| Mechanism | Use Case |
|---|---|
| **Timeline UI** | One-off manual start on a single page or asset |
| **Manage Publication** | Multi-page batch start, integrates with publish pipeline |
| **WorkflowSession API** | Backend Java code, scheduled jobs, event handlers |
| **HTTP Workflow API** | REST calls, scripts, external integrations |
| **Workflow Launchers** | Automatic on JCR events — see `workflow-launchers` skill |

## 1. Manual via Timeline UI

1. Navigate to a page or asset in Sites/Assets console
2. Open **Timeline** panel (clock icon)
3. Click **Start Workflow**
4. Select the model from the dropdown
5. Optionally enter a workflow title and comment
6. Click **Start**

The workflow starts with the selected item as `JCR_PATH` payload and the current user as initiator.

## 2. Manage Publication (Multi-Page)

1. Sites Console → select pages → **Manage Publication**
2. Choose action (Publish / Unpublish)
3. Check **Include Workflow**
4. Select workflow model
5. Click **Publish Later** or **Publish Now**

AEM creates a `cq:WorkflowContentPackage` containing all selected pages as the workflow payload.
The payload is a `JCR_PATH` pointing to the generated package node under `/var/workflow/packages`
(legacy: `/etc/workflow/packages`) — useful to know when debugging payload issues, since the
payload is the package node, not the individual pages.

## 3. Programmatic (WorkflowSession API)

```java
@Component(service = MyWorkflowService.class)
public class MyWorkflowService {

    @Reference
    private ResourceResolverFactory resolverFactory;

    public String startWorkflow(String payloadPath, String modelId,
                                Map<String, Object> initialMeta) throws Exception {
        Map<String, Object> auth = Collections.singletonMap(
            ResourceResolverFactory.SUBSERVICE, "workflow-starter");
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(auth)) {
            WorkflowSession wfSession = resolver.adaptTo(WorkflowSession.class);
            WorkflowModel model = wfSession.getModel(modelId);
            WorkflowData data = wfSession.newWorkflowData("JCR_PATH", payloadPath);

            // Set initial metadata
            MetaDataMap meta = data.getMetaDataMap();
            if (initialMeta != null) {
                initialMeta.forEach(meta::put);
            }

            Workflow instance = wfSession.startWorkflow(model, data);
            return instance.getId();
        }
    }
}
```

**Model ID format:** `/var/workflow/models/my-workflow` (the runtime path, not the design-time path)

## 4. HTTP Workflow API

The API is rooted at `/var/workflow/instances`. Do **not** POST to `/api/workflow/instances` —
no workflow servlet is mounted there, so the Sling default POST servlet silently writes stray JCR
nodes and returns a misleading 2xx **without starting any workflow**.

```bash
# Start a workflow — returns HTTP 201 with an HTML body linking to the new instance path
curl -u admin:admin -X POST \
  "http://localhost:4502/var/workflow/instances" \
  --data-urlencode "_charset_=utf-8" \
  --data-urlencode "model=/var/workflow/models/my-workflow" \
  --data-urlencode "payloadType=JCR_PATH" \
  --data-urlencode "payload=/content/my-site/en/home" \
  --data-urlencode "workflowTitle=Review Request from CI" \
  --data-urlencode "startComment=triggered via HTTP API"

# The start response is HTML — parse the instance path from the
# <a id="Location"> anchor (or "Modified Resource" link in the body),
# e.g. /var/workflow/instances/server0/<date>/my-workflow_1

# List all instances (JSON)
curl -u admin:admin "http://localhost:4502/var/workflow/instances.json"

# List by state using a selector (.RUNNING.json, .SUSPENDED.json, .COMPLETED.json, .ABORTED.json)
curl -u admin:admin "http://localhost:4502/var/workflow/instances.RUNNING.json"

# Get instance details — JSON fields: id, state, initiator, startTime,
#   model, payloadType, payload, workItems[]
curl -u admin:admin \
  "http://localhost:4502/var/workflow/instances/server0/<date>/my-workflow_1.json"

# Suspend a running workflow — POST state=SUSPENDED, returns HTTP 200
curl -u admin:admin -X POST \
  "http://localhost:4502/var/workflow/instances/server0/<date>/my-workflow_1" \
  --data-urlencode "_charset_=utf-8" \
  --data-urlencode "state=SUSPENDED"

# Resume a suspended workflow — POST state=RUNNING, returns HTTP 200
curl -u admin:admin -X POST \
  "http://localhost:4502/var/workflow/instances/server0/<date>/my-workflow_1" \
  --data-urlencode "_charset_=utf-8" \
  --data-urlencode "state=RUNNING"

# Terminate (abort) a workflow — POST state=ABORTED, returns HTTP 200
curl -u admin:admin -X POST \
  "http://localhost:4502/var/workflow/instances/server0/<date>/my-workflow_1" \
  --data-urlencode "_charset_=utf-8" \
  --data-urlencode "state=ABORTED" \
  --data-urlencode "terminateComment=cleanup"
```

## Guardrails

- Always specify a `workflowTitle` when starting programmatically — it helps operators identify instances in the console.
- Never start workflows with admin credentials from production code. Use a service user.
- Model ID must be the `/var/workflow/models/` path (runtime). Do not use the `/conf` design-time path.
- Check that the model is synced to `/var/workflow/models/` before calling `startWorkflow()`.
- For multi-page batch triggering, prefer Manage Publication over programmatic creation of workflow packages — it is better integrated with the publish pipeline and avoids manual package lifecycle management.

## References

- [triggering-mechanisms.md](./references/workflow-triggering/triggering-mechanisms.md) — detailed guide for each mechanism
- [programmatic-api.md](./references/workflow-triggering/programmatic-api.md) — WorkflowSession API patterns and service user setup
- [api-reference.md](./references/workflow-foundation/api-reference.md)
- [jcr-paths-reference.md](./references/workflow-foundation/jcr-paths-reference.md)
- [cloud-service-guardrails.md](./references/workflow-foundation/cloud-service-guardrails.md)
