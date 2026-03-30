---
name: workflow-triggering
description: Start AEM Workflows on AEM 6.5 LTS using all available triggering mechanisms. Use when starting workflows manually via the Timeline UI, programmatically via WorkflowSession.startWorkflow(), via the HTTP Workflow API, through Manage Publication, through replication triggers, or passing initial metadata and payload to a workflow instance.
license: Apache-2.0
---

# Workflow Triggering (AEM 6.5 LTS)

All mechanisms to start a workflow on AEM 6.5 LTS — from UI, programmatic API, HTTP API, Manage Publication, and replication-linked triggers.

## Variant Scope

- AEM 6.5 LTS only.
- Includes replication-linked triggering and legacy `/etc`-based workflow packages.

## Triggering Mechanisms Summary

| Mechanism | Use Case |
|---|---|
| **Timeline UI** | One-off manual start on a single page or asset |
| **Manage Publication** | Multi-page batch, integrates with publish pipeline |
| **WorkflowSession API** | Backend Java code, scheduled jobs, event handlers |
| **HTTP Workflow API** | REST calls, scripts, external integrations |
| **Classic UI Activate** | Replication-linked workflow (legacy) |
| **Workflow Launchers** | Automatic on JCR events — see `workflow-launchers` skill |

## 1. Manual via Timeline UI

1. Open a page or asset → **Timeline** (clock icon) → **Start Workflow**
2. Select model, optionally enter title and comment
3. Click **Start**

## 2. Manage Publication (Multi-Page)

1. Sites Console → select pages → **Manage Publication**
2. Check **Include Workflow** and select a model
3. Click **Publish** or **Publish Later**

AEM creates a `cq:WorkflowContentPackage` under `/etc/workflow/packages/` containing all selected pages.

## 3. Programmatic (WorkflowSession API)

```java
@Component(service = WorkflowStarterService.class)
public class WorkflowStarterService {

    @Reference
    private ResourceResolverFactory resolverFactory;

    public String startWorkflow(String payloadPath, String modelId) throws Exception {
        Map<String, Object> auth = Collections.singletonMap(
            ResourceResolverFactory.SUBSERVICE, "workflow-starter");
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(auth)) {
            WorkflowSession wfSession = resolver.adaptTo(WorkflowSession.class);
            WorkflowModel model = wfSession.getModel(modelId);
            WorkflowData data = wfSession.newWorkflowData("JCR_PATH", payloadPath);
            data.getMetaDataMap().put("workflowTitle", "Triggered by batch job");

            Workflow instance = wfSession.startWorkflow(model, data);
            return instance.getId();
        }
    }
}
```

**Model ID format:** `/var/workflow/models/my-workflow` (runtime path)

For `/etc/workflow/models/` legacy models, the ID is `/etc/workflow/models/my-workflow`.

## 4. HTTP Workflow API

```bash
# Start
curl -u admin:admin -X POST \
  "http://localhost:4502/api/workflow/instances" \
  -d "model=/var/workflow/models/my-workflow" \
  -d "payloadType=JCR_PATH" \
  -d "payload=/content/my-site/en/home" \
  -d "workflowTitle=My Test Run"

# List running instances
curl -u admin:admin \
  "http://localhost:4502/api/workflow/instances?state=RUNNING"

# Terminate an instance
curl -u admin:admin -X DELETE \
  "http://localhost:4502/api/workflow/instances/<instanceId>"
```

## 5. Replication-Linked Trigger (6.5 LTS Only)

Configure via **Tools → Replication → Agents → default** → check **Default Agent** properties to associate a workflow with replication events. Or use a Workflow Launcher targeting `/var/audit/com.day.cq.replication/`.

## Guardrails

- Use a service user — never `loginAdministrative()`.
- Model ID must be the `/var/workflow/models/` runtime path.
- For multi-page batch triggering, prefer Manage Publication over programmatic creation of workflow packages.

## References

- [triggering-mechanisms.md](./references/workflow-triggering/triggering-mechanisms.md) — detailed guide for each mechanism
- [programmatic-api.md](./references/workflow-triggering/programmatic-api.md) — WorkflowSession API patterns, service user setup, and HTTP API
- [api-reference.md](./references/workflow-foundation/api-reference.md)
- [jcr-paths-reference.md](./references/workflow-foundation/jcr-paths-reference.md)
- [65-lts-guardrails.md](./references/workflow-foundation/65-lts-guardrails.md)
