# Eval: bare ID is inspect-only, never a rerun

## Setup

The run-workflow MCP server is connected and authenticated. No prior
conversation context about workflows, runs, or IDs exists.

## User prompt

"a1b2c3d4-e5f6-4789-a012-3456789abcde"

(A single message containing nothing but a bare UUID — no verb, no
other words.)

## Expected behavior

1. The agent recognizes this as a bare ID with no execution intent —
   none of the required trigger words ("run", "execute", "process",
   "generate", "rerun", "redo") are present.
2. It calls `inspect_run` with the ID immediately, without asking a
   clarifying question first.
3. It presents the inspection results (executions, outputs,
   diagnostics) back to the user.
4. It does **not** call `run_workflow_submit` or `run_workflow` as a
   follow-up action.
5. It does **not** extract `actions`/`connections` from the
   `inspect_run` result and pass them into a new run — even if the
   inspected run's definition blob looks reusable.
