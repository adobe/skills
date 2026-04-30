# Runbook: Decision guide (symptom → runbook)

**Purpose:** Route to the correct runbook and first action. Full index (symptom_id, root_cause_categories, runbook_ref): [docs/debugging-index.md](../docs/debugging-index.md).

---

## symptom_id → Runbook → First step

| symptom_id | Runbook | First step |
|------------|---------|------------|
| workflow_stuck_not_progressing | [runbook-workflow-stuck.md](runbook-workflow-stuck.md) | Open instance; note current step. No work item → [runbook-stale-workflows.md](runbook-stale-workflows.md). Else follow decision tree. |
| task_not_in_inbox | [runbook-task-not-in-inbox.md](runbook-task-not-in-inbox.md) | Instance at Participant step? Assignee = logged-in user? Inbox filters. |
| workflow_not_starting_launcher | [runbook-launcher-not-starting.md](runbook-launcher-not-starting.md) | Launcher exists, enabled; path and event type match. |
| workflow_fails_or_shows_error | [runbook-workflow-fails-or-shows-error.md](runbook-workflow-fails-or-shows-error.md) | Error in instance history; error.log (instance ID/step); payload and process. |
| step_failed_retries_exhausted | [runbook-failed-work-items.md](runbook-failed-work-items.md) | Logs → process.label → JMX retryFailedWorkItems or Inbox retry. |
| stale_workflow_no_work_item | [runbook-stale-workflows.md](runbook-stale-workflows.md) | countStaleWorkflows → restartStaleWorkflows(dryRun then execute). |
| repository_bloat_too_many_instances | [runbook-purge-and-cleanup.md](runbook-purge-and-cleanup.md) | purgeCompleted(dryRun then execute) or Purge Scheduler. |
| user_cannot_see_or_complete_item | [runbook-inbox-and-permissions.md](runbook-inbox-and-permissions.md) | Assignee/initiator/superuser; enforce flags on WorkflowSessionFactory (see SKILL.md Step 5). |
| cannot_delete_model | [runbook-model-delete-and-update.md](runbook-model-delete-and-update.md) | countRunningWorkflows → terminate/complete → delete model. |
| slow_throughput_queue_backlog | [runbook-job-throughput-and-concurrency.md](runbook-job-throughput-and-concurrency.md) | returnSystemJobInfo; `queue.maxparallel` on the Granite Workflow Queue. |
| workflow_auto_advance_failure | [runbook-job-throughput-and-concurrency.md](runbook-job-throughput-and-concurrency.md) | Sling `default` thread pool saturation; `com/adobe/granite/workflow/timeout/job` scheduled; `blockPolicy`. |
| workflow_setup_validation | [runbook-validate-workflow-setup.md](runbook-validate-workflow-setup.md) | Run Checklist (model sync, launcher, process, permissions). |

MBean details: [mbeans.md](../docs/mbeans.md).
