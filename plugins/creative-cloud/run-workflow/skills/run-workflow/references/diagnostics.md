# Inspecting runs & diagnosing failures

Load this when inspecting a run, listing history, or explaining why a workflow failed.

## `inspect_run` vs `list_workflow_history`

- **Single workflow / execution / batch** (user pastes an ID, asks "the last one", "that
  workflow"): use `inspect_run` → full details: workflow JSON, all recent executions, per-action
  outputs, logs, diagnostics.
- **Multiple workflows** (user asks for a list, history, recent runs without naming one): use
  `list_workflow_history` → summaries only (workflowId, source, status, last execution date). Do not
  call `inspect_run` per row.
- **Ambiguous** ("show me my workflows", no count): show the list summary first, then offer to drill
  into any single entry.

Never read local `workflow.json` / `inputs.json` files to reconstruct history — those exist for
human debugging only. `list_workflow_history` / `inspect_run` are authoritative.

## `inspect_run` ID routing

The tool auto-detects the ID type:
- `batch-...` → batch status + failed execution list
- `..._exec-{n}` → single batch execution outputs + diagnostic
- `{workflowId}_{uuid}` (ends with `_{uuid}`, underscore before UUID) → single execution outputs + diagnostic
- pure UUID or workflow name → **all recent executions** with full action outputs + diagnostics for each

## Key fields in the `inspect_run` response

- **`workflowJson`** — the full actions/connections graph. When `hasWorkflowJson: true`, always show
  the graph structure explicitly to the user (list each action node and its connections). Do not
  silently summarize.
- **`canRerun`** — `true` for published workflows (can re-execute by workflowId); `false` for inline
  workflows (must use new UUID + inline definition). Never use `hasDefinitionBlob` alone to decide
  re-executability — use `canRerun`.
- **`hasWorkflowJson`** — `true` when the workflow graph definition is available to display. Both
  published and inline workflows return `true` when the JSON was stored.
- **Logs** — only included in `diagnostic.failedActions[].logs` for failed actions. Successful
  workflows do not include logs (omitted to reduce noise).
- **Expired URLs** — pre-signed S3/Azure URLs that have expired are automatically replaced with
  `[URL expired — re-run the workflow to get fresh outputs]`. Unexpired and unrecognized URLs are
  shown as-is.

## Natural-language history queries

When the user asks about "the last workflow I ran", "my most recent run", "the last published
workflow", etc.:
1. Call `list_workflow_history` with `limit=1` (and `workflowSource=published` if specified)
2. Take the first result's `workflowId`
3. Call `inspect_run` with that `workflowId` to get full details

## Rerun after inspect (only when the user explicitly asks)

- `canRerun: true` (published) → call `run_workflow_submit` with the existing `workflowId`.
- `canRerun: false` (inline) → generate a new UUID, call `run_workflow_submit` with
  `actions`+`connections` from `workflowJson` + `workflowId: <new-uuid>` + same inputs (re-upload if
  expired), then tell the user: "Running as new workflow ID: `<new-uuid>`".

## Error diagnosis

When `inspect_run` returns failed actions, the `diagnostic` field pre-computes the key signals. Use
them to explain what went wrong without asking the user to dig into raw JSON.

**`errorCategory`** — classification of what failed:

| errorCategory | Meaning | Suggested fix |
| --- | --- | --- |
| `validation_error` | Input rejected before the API was called | Check presigned URL expiry, input format, or required fields |
| `auth_error` | The downstream API rejected the auth token | Check credential expiry or API key validity |
| `rate_limit_error` | API quota exceeded | Reduce batch concurrency or wait before retrying |
| `downstream_error` | The upstream API returned an error response | Check `responseBody` in the action logs for details |
| `system_error` | Platform error (unknown actionType, wiring issue) | Verify actionType is spelled correctly and registered |
| `polling_timeout_error` | Job started but never reached a terminal state | The upstream job may still be running; check directly or retry |

**`phase`** — where in the pipeline the failure occurred:

| phase | What it means | Where to look |
| --- | --- | --- |
| `validation` | Input rejected before any API call | Fix the input (expired presigned URL, wrong MIME type, missing required field) |
| `setup` | Config/wiring error before execution | Check actionType spelling, predecessor output exists, connections correct |
| `execute` | Downstream API returned an error | Inspect `logs[].details.responseBody` for the upstream error message |

On a failed workflow: present the error diagnosis and **stop**. Do not auto-retry, re-wire, patch
connections, or resubmit. Ask the user what they want to do next.

## Validation errors from `compose_workflow`

If `compose_workflow` returns validation errors, call `get_workflow_examples` for the relevant
action types, then retry with updated constraints. Cap retries at 1; if still invalid, show the user
the errors and ask how to proceed.
