# Workflow Debugging Index (Machine-Readable)

**Purpose:** Map symptoms to runbooks and root-cause categories. Use for production debugging and AI-driven Jira analysis.

**Conventions:** Each entry has a stable `symptom_id`, `root_cause_categories`, and `runbook_ref`. Parsers should key on `symptom_id` or exact symptom phrase.

---

## Index entries

### symptom_id: workflow_stuck_not_progressing

```yaml
symptom_id: workflow_stuck_not_progressing
symptom_description: "Workflow instance remains in Running; does not advance to next step."
root_cause_categories:
  - participant_step_assignee_missing_or_no_access
  - process_step_exception_or_timeout
  - process_step_invalid_payload
  - or_and_split_condition_or_route_invalid
  - stale_instance_no_current_work_item
runbook_ref: runbooks/runbook-workflow-stuck.md
```

---

### symptom_id: task_not_in_inbox

```yaml
symptom_id: task_not_in_inbox
symptom_description: "User expects a work item in Inbox but it does not appear."
root_cause_categories:
  - workflow_not_reached_participant_step
  - participant_user_or_group_mismatch
  - inbox_filter_or_scope_hiding_task
  - repository_permission_insufficient
  - dynamic_participant_resolution_excluded_user
runbook_ref: runbooks/runbook-task-not-in-inbox.md
```

---

### symptom_id: workflow_not_starting_launcher

```yaml
symptom_id: workflow_not_starting_launcher
symptom_description: "Workflow should start automatically (e.g. on node event) but no instance is created."
root_cause_categories:
  - launcher_missing_or_disabled
  - launcher_path_node_type_or_event_mismatch
  - workflow_model_disabled
  - permission_to_start_workflow_denied
  - overlapping_launcher_interference
runbook_ref: runbooks/runbook-launcher-not-starting.md
```

---

### symptom_id: workflow_fails_or_shows_error

```yaml
symptom_id: workflow_fails_or_shows_error
symptom_description: "Workflow instance in Failed state or a step throws an error."
root_cause_categories:
  - process_step_exception
  - payload_missing_or_invalid
  - process_script_or_java_bug
  - timeout_or_transient_failure
runbook_ref: runbooks/runbook-workflow-fails-or-shows-error.md
```

---

### symptom_id: step_failed_retries_exhausted

```yaml
symptom_id: step_failed_retries_exhausted
symptom_description: "Step failed after retries; failure item created in Inbox."
root_cause_categories:
  - process_not_registered_or_label_mismatch
  - exception_in_process_execute
  - payload_or_repository_error
runbook_ref: runbooks/runbook-failed-work-items.md
```

---

### symptom_id: stale_workflow_no_work_item

```yaml
symptom_id: stale_workflow_no_work_item
symptom_description: "Instance in Running but has no current work item (inconsistent state)."
root_cause_categories:
  - job_crashed_during_transition
  - node_left_inconsistent
runbook_ref: runbooks/runbook-stale-workflows.md
```

---

### symptom_id: repository_bloat_too_many_instances

```yaml
symptom_id: repository_bloat_too_many_instances
symptom_description: "Large /var/workflow/instances; slow queries; disk usage high."
root_cause_categories:
  - purge_not_configured_or_infrequent
  - purge_query_or_save_threshold_insufficient
runbook_ref: runbooks/runbook-purge-and-cleanup.md
```

---

### symptom_id: user_cannot_see_or_complete_item

```yaml
symptom_id: user_cannot_see_or_complete_item
symptom_description: "User cannot see work item or cannot complete/delegate/return; access denied."
root_cause_categories:
  - not_assignee_and_enforce_assignee_true
  - not_initiator_and_enforce_initiator_true
  - not_in_superuser_list
  - repository_acl_insufficient
runbook_ref: runbooks/runbook-inbox-and-permissions.md
```

---

### symptom_id: cannot_delete_model

```yaml
symptom_id: cannot_delete_model
symptom_description: "Cannot delete workflow model; error indicates running instances."
root_cause_categories:
  - running_instances_exist_for_model
runbook_ref: runbooks/runbook-model-delete-and-update.md
```

---

### symptom_id: slow_throughput_queue_backlog

```yaml
symptom_id: slow_throughput_queue_backlog
symptom_description: "Workflow jobs queued for long time; slow completion; queue depth high."
root_cause_categories:
  - max_parallel_jobs_too_low
  - instance_lock_contention
  - slow_or_blocking_process_step
runbook_ref: runbooks/runbook-job-throughput-and-concurrency.md
```

---

### symptom_id: workflow_setup_validation

```yaml
symptom_id: workflow_setup_validation
symptom_description: "New or changed workflow not starting or step not executing; need systematic validation."
root_cause_categories:
  - model_not_synced_or_invalid
  - launcher_misconfigured
  - process_not_registered
  - permissions_or_visibility
runbook_ref: runbooks/runbook-validate-workflow-setup.md
```

---

## Lookup table (for AI / scripts)

| symptom_id | runbook_file | primary_doc |
|------------|--------------|-------------|
| workflow_stuck_not_progressing | runbook-workflow-stuck.md | runbooks/ |
| task_not_in_inbox | runbook-task-not-in-inbox.md | runbooks/ |
| workflow_not_starting_launcher | runbook-launcher-not-starting.md | runbooks/ |
| workflow_fails_or_shows_error | runbook-workflow-fails-or-shows-error.md | runbooks/ |
| step_failed_retries_exhausted | runbook-failed-work-items.md | runbooks/ |
| stale_workflow_no_work_item | runbook-stale-workflows.md | runbooks/ |
| repository_bloat_too_many_instances | runbook-purge-and-cleanup.md | runbooks/ |
| user_cannot_see_or_complete_item | runbook-inbox-and-permissions.md | runbooks/ |
| cannot_delete_model | runbook-model-delete-and-update.md | runbooks/ |
| slow_throughput_queue_backlog | runbook-job-throughput-and-concurrency.md | runbooks/ |
| workflow_setup_validation | runbook-validate-workflow-setup.md | runbooks/ |

---

## Root cause category → symptom_ids

| root_cause_category | symptom_ids |
|--------------------|-------------|
| participant_step_assignee_missing_or_no_access | workflow_stuck_not_progressing, task_not_in_inbox |
| process_step_exception_or_timeout | workflow_stuck_not_progressing, workflow_fails_or_shows_error, step_failed_retries_exhausted |
| process_step_invalid_payload | workflow_stuck_not_progressing, workflow_fails_or_shows_error |
| launcher_missing_or_disabled | workflow_not_starting_launcher |
| process_not_registered_or_label_mismatch | step_failed_retries_exhausted, workflow_setup_validation |
| not_assignee_and_enforce_assignee_true | user_cannot_see_or_complete_item, task_not_in_inbox |
