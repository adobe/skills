---
name: workflow-triggering
description: Start AEM Workflows on AEM 6.5 LTS using all available triggering mechanisms. Use when starting workflows manually via the Timeline UI, programmatically via WorkflowSession.startWorkflow(), via the HTTP Workflow API, through Manage Publication, through replication triggers, or passing initial metadata and payload to a workflow instance.
license: Apache-2.0
---

# Workflow Triggering (AEM 6.5 LTS)

All mechanisms to start a workflow on AEM 6.5 LTS — from UI, programmatic API, HTTP API, Manage Publication, and replication-linked triggers.

## Audience

Developers and integrators starting AEM 6.5 LTS workflows — from the author UI (Timeline, Manage Publication), backend services (`WorkflowSession` API, Sling Scheduler, event handlers), CI/CD pipelines (HTTP API), or content events (launchers, replication triggers).

## Variant Scope

- AEM 6.5 LTS only.
- Includes replication-linked triggering and legacy `/etc`-based workflow packages.
- **Not for AEM as a Cloud Service.** If the target instance is AEMaaCS, stop and use the cloud-service variant of this skill — traditional replication agents do not exist, HTTP API auth differs, and `/etc/workflow/...` paths are deprecated. Patterns documented here will not work as written on AEMaaCS.

## Dependencies

This skill is downstream of two others — both must be in place before any trigger fires:

- **workflow-model-design** — the model you trigger must already be deployed and synced to `/var/workflow/models/<name>`. Triggering a non-deployed model fails with `Workflow model not found`.
- **workflow-development** — every `WorkflowProcess` and `ParticipantStepChooser` referenced by the model must be registered as an OSGi service before the first instance starts. Otherwise the instance fails on first execution with `Process not found`.

## Prerequisites

- AEM 6.5 LTS author instance reachable (local, dev, or sandbox).
- Workflow model deployed and visible at `/var/workflow/models/<name>` (verify via **Tools → Workflow → Models** or `curl /var/workflow/models/<name>.json`).
- For programmatic / API triggers: a Maven bundle to hold the trigger code and a service user mapped via `ServiceUserMapper`.
- For HTTP API triggers from non-local environments: a service-account credential, never the default admin password.

## Required Permissions

- `workflow-users` (or equivalent) — start workflows from the Timeline UI or Manage Publication.
- `workflow-administrators` (or equivalent) — terminate, suspend, or resume instances; required for HTTP `DELETE /api/workflow/instances/...`.
- Service user with `jcr:read` on `/var/workflow/models/` and `jcr:read,jcr:write` on `/var/workflow/instances/` for programmatic triggering. The `workflow-process-service` system user already has these on a stock 6.5 LTS install.

## Triggering Mechanisms Summary

| Mechanism | Use Case |
|---|---|
| **Timeline UI** | One-off manual start on a single page or asset |
| **Manage Publication** | Multi-page batch, integrates with publish pipeline |
| **WorkflowSession API** | Backend Java code, scheduled jobs, event handlers |
| **HTTP Workflow API** | REST calls, scripts, external integrations |
| **Replication Trigger** | Auto-start on replication agent events (6.5 LTS only — see Section 5) |
| **Workflow Launchers** | Automatic on JCR events — see `workflow-launchers` skill |

## 1. Manual via Timeline UI

1. Open a page or asset → **Timeline** (clock icon) → **Start Workflow**
2. Select model, optionally enter title and comment
3. Click **Start**

## 2. Manage Publication (Multi-Page)

1. Sites Console → select pages → **Manage Publication**
2. Check **Include Workflow** and select a model
3. Click **Publish** or **Publish Later**

AEM creates a workflow package — a `cq:Page` collection built from the workflow-collection template (`/libs/cq/workflow/components/collection/page`) — under `/var/workflow/packages/` (newer 6.5 LTS) or `/etc/workflow/packages/` (legacy fallback). Detect at runtime via `payload.adaptTo(ResourceCollection.class)`; do not rely on a primary-type check (it's a `cq:Page`, indistinguishable from an ordinary page by type alone).

## 3. Programmatic (WorkflowSession API)

```java
@Component(service = WorkflowStarterService.class)
public class WorkflowStarterService {

    @Reference
    private ResourceResolverFactory resolverFactory;

    public String startWorkflow(String payloadPath, String modelId) throws WorkflowException, LoginException {
        Map<String, Object> auth = Collections.singletonMap(
            ResourceResolverFactory.SUBSERVICE, "workflow-starter");
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(auth)) {
            WorkflowSession wfSession = resolver.adaptTo(WorkflowSession.class);
            WorkflowModel model = wfSession.getModel(modelId);
            if (model == null) {
                // getModel returns null when the model isn't deployed/synced.
                // Fail fast with a clear message — the next call would NPE silently.
                throw new WorkflowException("Workflow model not found: " + modelId);
            }
            WorkflowData data = wfSession.newWorkflowData("JCR_PATH", payloadPath);
            data.getMetaDataMap().put("workflowTitle", "Triggered by batch job");

            // startWorkflow() is non-blocking — it returns immediately with a handle;
            // step execution happens asynchronously on the Sling job queue.
            Workflow instance = wfSession.startWorkflow(model, data);
            return instance.getId();
        }
    }
}
```

**Model ID format:** `/var/workflow/models/my-workflow` (runtime path)

For `/etc/workflow/models/` legacy models, the ID is `/etc/workflow/models/my-workflow`.

## 4. HTTP Workflow API

> **Local development only.** The `curl -u admin:admin` examples target a local author at `localhost:4502` with the default admin password. Never run them against a shared, stage, or production instance, and never with default `admin:admin` credentials outside an isolated dev box. For production triggers from external systems, use a service-account token or short-lived OAuth credentials instead.

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

## Architecture Considerations

Triggering is the surface where workflow load is *created* — apply these before deploying any auto-trigger:

- **Async by default.** `startWorkflow()` is non-blocking; it returns a handle and step execution happens asynchronously on the Sling job queue. Do not write code that expects the workflow to be complete on return. To wait, poll `instance.getState()` or use a downstream notification step.
- **Cap bulk triggers.** Any trigger driven by a JCR query, directory scan, or external batch must enforce a hard cap per run (see the Sling Scheduler example in [programmatic-api.md](./references/workflow-triggering/programmatic-api.md)). Triggering 10 000 workflows in a tight loop saturates the workflow job queue and pins the calling thread.
- **Use transient workflows for high-volume triggers.** When a workflow is short-lived and triggered at high frequency (asset processing, replication side-effects), set `transient="true"` on the model — see the workflow-model-design Architecture Considerations. Persistent workflows in this regime bloat `/var/workflow/instances` quickly.
- **Avoid recursive triggers.** A `WorkflowProcess.execute()` that starts another workflow on the same payload — or a launcher that re-fires on the writes its own workflow performs — creates an infinite loop. Guard with a metaData flag (`alreadyTriggered=true`) or trigger on a different payload subtree.
- **Stack mechanisms cautiously.** Pairing a Workflow Launcher and a replication-linked trigger on the same content fires *two* workflows per content change. Pick one mechanism per content event.
- **Initiator semantics under service-user triggers.** When a service user calls `startWorkflow()`, the engine-set `initiator` metadata becomes the service-user ID, not a human. Downstream PARTICIPANT steps that route by `initiator`, or audit code that expects a human user, will misbehave. Pass the human user explicitly via a custom metadata key when needed.

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
