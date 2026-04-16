# Triggering Mechanisms — AEM Workflow (6.5 LTS)

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
String instanceId = instance.getId();

// With initial metadata
data.getMetaDataMap().put("workflowTitle", "Batch Review Job");
data.getMetaDataMap().put("department", "marketing");
wfs.startWorkflow(model, data);
```

**Service user requirement:** Map a sub-service or use the deprecated SlingRepository.loginService(). The `workflow-process-service` system user exists for this purpose on 6.5 LTS.

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

# Get instance details
curl -u admin:admin \
  "http://localhost:4502/api/workflow/instances/<instanceId>.json"

# Terminate a workflow
curl -u admin:admin -X DELETE \
  "http://localhost:4502/api/workflow/instances/<instanceId>"
```

---

## Mechanism 5: Workflow Launchers (Automatic)

**When to use:** Automatically start a workflow whenever content changes match a pattern.

Launchers are `cq:WorkflowLauncher` nodes under `/conf/global/settings/workflow/launcher/config/` (or overlaid from `/libs/`). See the `workflow-launchers` skill for full configuration.

---

## Mechanism 6: Replication Triggers (6.5 LTS Only)

**When to use:** Automatically kick off a workflow when a replication agent fires.

In the Replication Agent configuration (`/etc/replication/agents.author/<agent>`):
- Open **Settings** tab
- Set **Trigger on Receive** or use the **Workflow** field to specify a model to start on replication success

This mechanism is **not available** on AEM as a Cloud Service (no traditional replication agents).

---

## Mechanism Decision Matrix

| Scenario | Mechanism |
|---|---|
| Author clicks "start workflow" on one page | Timeline UI |
| Author publishes 10+ pages with review step | Manage Publication |
| Backend job processes assets nightly | WorkflowSession Java API |
| CI pipeline triggers review after code deploy | HTTP Workflow REST API |
| Every new DAM upload should process automatically | Workflow Launcher |
| Content replication should trigger a post-publish task | Replication Trigger (6.5 only) |
