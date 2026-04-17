# AEM Workflow Debugging – Reference (Cloud Service)

Quick pointers used by the workflow-debugging skill. For full runbooks and procedures, use the paths below inside this repo.

---

## Runbook locations (relative to repo root)

| Runbook | Path |
|---------|------|
| Decision guide (symptom → runbook) | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-decision-guide.md` |
| Debugging index (machine-readable) | `aem-agent-marketplace-workflow-knowledge-base/docs/debugging-index.md` |
| Workflow stuck | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-workflow-stuck.md` |
| Task not in Inbox | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-task-not-in-inbox.md` |
| Launcher not starting | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-launcher-not-starting.md` |
| Workflow fails / error | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-workflow-fails-or-shows-error.md` |
| Failed work items | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-failed-work-items.md` |
| Stale workflows | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-stale-workflows.md` |
| Purge and cleanup | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-purge-and-cleanup.md` |
| Inbox and permissions | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-inbox-and-permissions.md` |
| Model delete/update | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-model-delete-and-update.md` |
| Job throughput / concurrency | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-job-throughput-and-concurrency.md` |
| Validate workflow setup | `aem-agent-marketplace-workflow-knowledge-base/runbooks/runbook-validate-workflow-setup.md` |

---

## Cloud Service diagnostic tools

| Tool | Where | Purpose |
|------|-------|---------|
| Developer Console | AEM Cloud Service → Developer Console | Thread dumps, OSGi bundles, config |
| Cloud Manager Logs | Cloud Manager → Environments → Logs | error.log, access.log download/streaming |
| Workflow Console | /libs/cq/workflow/admin/console/content/instances.html | Instance status, work items, history |
| Sling Job Console | /system/console/slingjobs | Queue depth, failed jobs, active jobs |
| Inbox | /aem/inbox | Retry failed work items, complete tasks |

---

## Log patterns (see also docs/error-patterns.md)

- `Error executing workflow step` – Process/step exception
- `getProcess for '<name>' failed` – Process not registered
- `Cannot archive workitem` – Stale risk
- `refreshing the session since we had to wait for a lock` – Contention
- `Terminate failed` / `Resume failed` / `Suspend failed` – Permissions
- `PathNotFoundException` (workflow/payload) – Payload or launcher path

---

## External docs (Experience League)

- [Workflows overview (Cloud Service)](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/authoring/workflows/overview)
- [Workflow API (6.5 Javadoc, applies to Cloud)](https://developer.adobe.com/experience-manager/reference-materials/6-5/javadoc/com/adobe/granite/workflow/exec/Workflow.html)
