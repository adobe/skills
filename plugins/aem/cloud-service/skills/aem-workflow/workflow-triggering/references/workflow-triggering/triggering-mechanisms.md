# Triggering Mechanisms — AEM Workflow (Cloud Service)

## Mechanism 1: Timeline UI (Single Item)

**When to use:** One-off manual start for a single page or asset during authoring.

**Steps:**
1. Open the page or asset in Sites or Assets console
2. Click the **Timeline** panel (clock icon, left sidebar)
3. Click **Start Workflow** (at the bottom of the timeline)
4. Select the workflow model from the dropdown
5. Optionally enter a **Workflow Title** (helps identify the instance in the console)
6. Click **Start**

**Payload:** The currently open page or asset becomes the `JCR_PATH` payload.

**Initiator:** The logged-in user.

---

## Mechanism 2: Manage Publication (Multi-Page Batch)

**When to use:** Publishing or unpublishing multiple pages with an associated review/approval workflow.

**Steps:**
1. Sites Console → select one or more pages
2. Click **Manage Publication** in the action bar
3. In the wizard: set Action to **Publish**, schedule if needed
4. Check **Include Workflow** → select a workflow model
5. Click **Publish** or **Publish Later**

**Payload:** AEM creates a `cq:WorkflowContentPackage` node containing all selected paths. The workflow receives this package as the `JCR_PATH` payload.

**Reading package members in a process step:**
```java
ResourceResolver resolver = session.adaptTo(ResourceResolver.class);
Resource payload = resolver.getResource(data.getPayload().toString());
ResourceCollection collection = rcManager.getResourceCollection(payload);
if (collection != null) {
    collection.list(new String[]{"cq:Page"}).forEachRemaining(node -> {
        // process each page in the package
    });
}
```

---

## Mechanism 3: WorkflowSession Java API

**When to use:** Backend services, scheduled jobs, event handlers, migration scripts.

```java
// Minimal start
WorkflowSession wfs = resolver.adaptTo(WorkflowSession.class);
WorkflowModel model = wfs.getModel("/var/workflow/models/my-workflow");
WorkflowData data = wfs.newWorkflowData("JCR_PATH", "/content/my-site/en/page");
Workflow instance = wfs.startWorkflow(model, data);
String instanceId = instance.getId();  // e.g. /var/workflow/instances/server0/2024-01-01/abc

// With initial metadata
data.getMetaDataMap().put("workflowTitle", "Batch Review Job");
data.getMetaDataMap().put("department", "marketing");
wfs.startWorkflow(model, data);
```

**Service user requirement:** Use a service user sub-service, not admin credentials. Map to `workflow-process-service` or a custom service user.

---

## Mechanism 4: HTTP Workflow REST API

**When to use:** CI/CD pipelines, external systems, shell scripts, integration tests.

```bash
# Start a workflow instance
curl -u admin:admin -X POST \
  "http://localhost:4502/api/workflow/instances" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "model=/var/workflow/models/my-workflow" \
  -d "payloadType=JCR_PATH" \
  -d "payload=/content/my-site/en/home" \
  -d "workflowTitle=CI Triggered Review"
# Response: 201 Created, Location: /api/workflow/instances/<id>

# Get instance details
curl -u admin:admin \
  "http://localhost:4502/api/workflow/instances/<instanceId>.json"

# List running instances filtered by model
curl -u admin:admin \
  "http://localhost:4502/api/workflow/instances?state=RUNNING&model=/var/workflow/models/my-workflow"

# Suspend a running workflow
curl -u admin:admin -X PUT \
  "http://localhost:4502/api/workflow/instances/<instanceId>" \
  -d "state=SUSPENDED"

# Resume a suspended workflow
curl -u admin:admin -X PUT \
  "http://localhost:4502/api/workflow/instances/<instanceId>" \
  -d "state=RUNNING"

# Terminate a workflow
curl -u admin:admin -X DELETE \
  "http://localhost:4502/api/workflow/instances/<instanceId>"
```

---

## Mechanism 5: Workflow Launchers (Automatic)

**When to use:** Automatically start a workflow whenever content changes match a pattern.

Launchers are `cq:WorkflowLauncher` nodes that listen for JCR events. See the `workflow-launchers` skill for full configuration.

Quick example — trigger on DAM asset upload:
- **Event type:** `NODE_ADDED` (value `1`)
- **Path:** `/content/dam/(.*)`
- **Node type:** `dam:AssetContent`
- **Model:** `/var/workflow/models/dam/update_asset`

---

## Mechanism Decision Matrix

| Scenario | Mechanism |
|---|---|
| Author clicks "start workflow" on one page | Timeline UI |
| Author publishes 10+ pages with review step | Manage Publication |
| Backend job processes assets nightly | WorkflowSession Java API |
| CI pipeline triggers review after code deploy | HTTP Workflow REST API |
| Every new DAM upload should process automatically | Workflow Launcher |
| Content modification at a specific path triggers review | Workflow Launcher |
