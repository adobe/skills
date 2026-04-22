# Runbooks — Cloud Service variant

> ⚠ **JMX warning for AEMaaCS users:** the 12 runbooks in this folder were authored
> against AEM 6.5 LTS and still reference JMX MBeans such as
> `com.adobe.granite.workflow:type=Maintenance` and operations like
> `countStaleWorkflows`, `restartStaleWorkflows`, `retryFailedWorkItems`,
> `purgeCompleted`, `returnSystemJobInfo`, `returnWorkflowQueueInfo`.
>
> **None of these JMX endpoints are reachable on AEM as a Cloud Service.**
> `/system/console/jmx` is disabled on AEMaaCS.

The **diagnosis checklists** in each runbook still apply 1:1 — use them as written
for symptom classification and log/state inspection. Only the **remediation** steps
need to be translated.

## JMX → Cloud Service remediation translation

| Runbook step (JMX) | Cloud Service equivalent |
|--------------------|--------------------------|
| `restartStaleWorkflows(model, dryRun)` | Deploy `references/examples/StaleWorkflowServlet.java`. Invoke `GET /bin/support/workflow/stale?dryRun=true` first; then `POST ...?dryRun=false`. |
| `countStaleWorkflows(model)` | Same servlet, GET with `dryRun=true` — response JSON includes `staleCount`. |
| `retryFailedWorkItems` | `/aem/inbox` Retry (preferred, preserves history). Bulk via `terminateWorkflow` + `startWorkflow` is a **replay** not a retry — loses audit history. |
| `purgeCompleted(dryRun)` | `com.adobe.granite.workflow.purge.Scheduler-<alias>.cfg.json` as a Maintenance Task — see `references/examples/`. |
| `returnSystemJobInfo` / `returnWorkflowQueueInfo` | Sling Job Console at `/system/console/slingjobs` (read-only). |
| Any JMX config write (retry count, superuser, etc.) | OSGi config JSON in Git → Cloud Manager pipeline — see `references/examples/`. |

## One correction from the 6.5 runbooks

The runbooks mention `cq.workflow.job.max.procs` as a parallelism knob on
`WorkflowSessionFactory`. **This property does not exist** on any AEM version
(verified against `com.adobe.granite.workflow.core.WorkflowSessionFactory` source).
Ignore it in all bundled runbooks and use the Granite Workflow Queue's
`queue.maxparallel` instead — see
`references/examples/org.apache.sling.event.jobs.QueueConfiguration-granitewfe.cfg.json`.

## Using the runbooks

1. Pick the runbook matching your `symptom_id` from the table in `SKILL.md` Step 1.
2. Follow the **Checklist** section exactly — it works on AEMaaCS.
3. When the **Remediation** section cites a JMX operation, consult the translation
   table above or the top of `reference.md`.
4. When in doubt, default to the Cloud Service artifacts in `references/examples/`
   rather than writing new code.

Full JMX → Cloud mapping also lives at the top of `../../reference.md`.
