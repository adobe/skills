# Eval: capability questions are answered by calling list_actions

## Setup

The run-workflow MCP server is connected and authenticated. No prior
conversation context exists.

## User prompt

"What actions does run-workflow support? What can you do with it?"

## Expected behavior

1. The agent treats this as a capability/discovery question and calls
   `list_actions` before answering — it does not answer from training
   knowledge or a cached/remembered description of the catalog.
2. The response to the user is grounded in the actual tool result
   (names/categories of actions returned by the call), not a generic
   or invented list.
3. The agent does not call `run_workflow_submit`, `compose_workflow`,
   or `inspect_run` for this turn — the request is purely a discovery
   question, not a request to build or run anything.
