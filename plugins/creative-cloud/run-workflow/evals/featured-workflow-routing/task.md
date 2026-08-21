# Eval: named featured workflow routes through get_featured_workflow, not compose_workflow

## Setup

The run-workflow MCP server is connected and authenticated. The user
has local product photos at `~/Desktop/products/`.

## User prompt

"Run the retargeting workflow using my product photos in
~/Desktop/products."

## Expected behavior

1. The agent recognizes "retargeting" as a named featured workflow
   and calls `get_featured_workflow` (e.g. with a query like
   "retargeting") **before** calling `compose_workflow`.
2. It does not call `compose_workflow` to build a graph from scratch
   for this request — a named template match takes the fast path.
3. It uploads the local product photos via `upload_asset` to obtain
   presigned URLs, and copies those URLs verbatim into the submission
   (does not truncate or reconstruct them).
4. If `get_featured_workflow` returns a single `prepared` match, the
   agent uses `prepared.session_id` and submits via
   `run_workflow_submit` with `session_id` + `useSessionDefaults`
   rather than re-serializing the full graph.
5. If `get_featured_workflow` returns no match (e.g. because the tool
   is mocked/unavailable in this environment) the agent may fall back
   to `compose_workflow`, but only after having called
   `get_featured_workflow` first.

## Known limitation

This scenario requires a live, authenticated call to the hosted
`run-workflow.adobe.io/mcp` server. Without a valid IMS credential
injected into the eval sandbox (e.g. via `tessl eval run --env-file`),
tool calls will 403 and the with-context run may score lower than
baseline — not because the skill's guidance is wrong, but because the
agent correctly attempts real tool calls that the sandbox can't
authenticate, while an unguided baseline tends to "solve" the task by
writing a self-contained mock implementation instead of calling any
real tool at all. Treat a low with-context score here as inconclusive
unless a valid token was provided for the run.
