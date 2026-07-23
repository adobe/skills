---
name: run-workflow
description: >-
  Use the run-workflow MCP to discover, compose, execute, publish, and save
  Adobe Firefly workflows. TRIGGER when: user asks what actions are available,
  what the MCP can do, how to process images/video/3D via workflow, wants to
  build/run/save/publish a workflow, OR pastes any workflow/batch/execution ID.
  BARE ID (UUID/workflowId/batchId) = INSPECT ONLY — call inspect_run, NEVER
  run_workflow_submit. ALWAYS call list_actions first for capability/discovery questions.
  DO NOT TRIGGER for direct Firefly API calls without MCP (use firefly-api-specs).
license: Apache-2.0
metadata:
  version: 1.0.0
  visibility: public
---

# run-workflow MCP

Discover, compose, run, publish, and save Adobe Firefly workflows through the run-workflow MCP
server. Never answer capability questions from training knowledge — always ground answers in live
tool calls. `list_actions` is ALWAYS the first call for any capability/discovery question.

This file is the always-loaded core. Deeper procedures live in `references/` and should be read
**only when the current turn needs them**:

| Read this reference when… | File |
| --- | --- |
| User names a featured workflow, or supplies a custom `.indd` template to rewire | [`references/featured-and-templates.md`](references/featured-and-templates.md) |
| Composing a non-trivial graph, wants multi-variant outputs, or a required input is missing | [`references/compose.md`](references/compose.md) |
| Inspecting a run, listing history, or a workflow failed (error tables, `inspect_run` routing) | [`references/diagnostics.md`](references/diagnostics.md) |
| Uploading files, resolving inline pastes, macOS permission error, saving outputs | [`references/asset-input.md`](references/asset-input.md) |
| User asks for alert triage / RCA (dev-only: `login --dev`, Splunk + Slack) | [`references/alert-rca.md`](references/alert-rca.md) |

## BARE ID RULE — read this before anything else

**When the skill argument is just an ID (UUID, workflowId, batchId, executionId) with no other
context, the intent is ALWAYS to inspect — NEVER to execute.**

1. Call `inspect_run(id)` immediately.
2. Present the results (executions, outputs, diagnostics).
3. **STOP.** Do not call `run_workflow_submit` as a follow-up.

**"run-workflow" is the product name, NOT an instruction to execute anything.** Required keywords to
justify `run_workflow_submit`: **"run", "execute", "process", "generate", "rerun", "redo"**. If NONE
appear in the user's message, call `inspect_run`.

**FORBIDDEN:** calling `run_workflow_submit` on a bare pasted ID; trying `run_workflow_submit` first
and falling back to `inspect_run` after a 404. For rerun-after-inspect handling by `canRerun`, see
[`references/diagnostics.md`](references/diagnostics.md).

## When to use

**TRIGGER when the user:** asks what actions/capabilities exist; wants to process images/video/3D
through a Firefly workflow; wants to build/compose/execute a workflow; asks about past runs or
history; pastes any run-workflow ID (→ `inspect_run`); asks "why did my workflow fail"; wants to
publish a workflow as an API; wants to save a workflow to Workflow Builder.

**DO NOT TRIGGER when:** the user wants to call the Firefly REST API directly without MCP (use
`firefly-api-specs`); the user is building/debugging the run-workflow server itself.

## Tool routing

| User intent | Tool |
| --- | --- |
| "What actions are available?" / "What can this MCP do?" / "Show me the catalog" | `list_actions` |
| "What parameters does action X accept?" | `get_action_schema` |
| "Build / compose / create a workflow for…" | `compose_workflow` |
| Upload a local file to get a URL | `upload_asset` |
| Execute a workflow — only with explicit run/execute keywords. Returns a `batchId` immediately (async); safe for any size | `run_workflow_submit` |
| Check whether a running execution is done — **always pass `includeOutputs: true`** on every poll | `run_workflow_get_status` |
| Abort a running batch by batchId | `cancel_workflow` |
| "List my workflows" / "Show my recent runs" (multiple) | `list_workflow_history` |
| "Last workflow I ran" / "Most recent run" (single, by recency) | `list_workflow_history` (limit=1) → `inspect_run` |
| Per-action outputs/logs/errors for a run; "why did it fail?"; any pasted ID | `inspect_run` |
| Look up known-good examples to debug a failed compose | `get_workflow_examples` |
| Reload examples after editing JSON files on disk | `reload_examples` |
| Publish workflow as a reusable API endpoint with curl | `publish_workflow` |
| Save workflow to user's ACP cloud / Workflow Builder UI | `save_workflow_to_acp` |
| Generate a curl command for a published workflowId | `generate_curl` |
| Display output images inline in chat | `display_asset` |
| See newly registered actions (catalog stale) | `refresh_catalog` |
| Run a named/featured workflow (retargeting, banners, localization, packaging…) | `get_featured_workflow` → see [`references/featured-and-templates.md`](references/featured-and-templates.md) |

**Single vs. multiple:** one ID / "the last one" / "that workflow" → `inspect_run` (full details).
A list/history request with no named target → `list_workflow_history` (summaries only). See
[`references/diagnostics.md`](references/diagnostics.md).

## Workflow pattern

```
1. upload_asset        — upload local files; get back URLs for use as inputs
1b. get_action_schema  — if you can identify 1–3 target action types, fetch schemas BEFORE
                         composing and inject them into the compose message (see references/compose.md).
                         Skip for simple/obvious single-action workflows.
2. compose_workflow    — describe the desired processing in natural language; the AI graph agent
                         designs the graph. DO NOT manually specify actions or connections.
3. run_workflow_submit — execute with inputs; pass session_id from step 2. Pass ALL images in ONE
                         call. Returns a batchId immediately (async); does NOT block on completion.
4. run_workflow_get_status — poll the batchId; ALWAYS pass includeOutputs: true. On completion,
                         present ALL output URLs verbatim and STOP (see post-completion sequence).
5. download_output     — ONLY after the user asks; saveTo a folder they choose.
6. publish_workflow    — publish for API reuse   OR   save_workflow_to_acp — save for UI editing.
```

## Async polling

**CRITICAL — Presigned URLs must NEVER be retyped or reconstructed.** Azure SAS / AWS S3 presigned
URLs are HMAC-signed over every character. Changing one character invalidates the signature
(`asset_download_failed`). Always copy `url` fields verbatim from responses.

After `run_workflow_submit`, poll `run_workflow_get_status` **every ~5s** with `includeOutputs: true`
(the server short-circuits the flag while running — zero extra cost). Report progress using
`elapsedSeconds` and `percentage` from the response directly — do not estimate elapsed time
yourself:

> **Running** — 3/10 assets complete (30%) · 45s elapsed

- If a poll includes `downloadedPreviewOutputs`, display those immediately (labelled in-progress)
  while continuing to poll.
- When `status === "completed"`, outputs are already in the response — no second call. Responses are
  slim by default; pass `includeProvenance: true` only if you need the full per-node asset tree.
- If `status === "failed"`, call `inspect_run` on the failed execution, summarize, and **stop** — do
  not auto-retry or re-wire. See [`references/diagnostics.md`](references/diagnostics.md).

For output extraction paths and inline-display rules, see
[`references/asset-input.md`](references/asset-input.md).

## Presenting outputs — strict 3-step sequence

Once `run_workflow_get_status` reports `completed`, run these steps **in order, one message each,
each gated on the user's reply.** Never merge them or skip ahead.

1. **Present the raw presigned URLs only.** Every output from every output node, verbatim, full URL,
   never truncated or placeholdered (`[presigned URL]` is forbidden). URLs expire in ~1 hour. Group
   terminal outputs under **Final outputs**, pipeline artifacts under **Intermediate outputs**. For
   featured workflows, surface the merge-data banners (1080×1080, 300×600, etc.) as Final outputs.
   Nothing else in this message — no download/save/publish offer.
2. **Ask about local download** — whether to download locally and to which folder. Only if yes, call
   `download_output` with their chosen `saveTo` and report the exact saved paths.
3. **Ask about next steps** — save to Workflow Builder (`save_workflow_to_acp`), publish as an API
   (`publish_workflow`), or start a new workflow.

## Key rules

- **session_id** — `compose_workflow` and `get_featured_workflow` both return one. Retain it for the
  whole conversation; pass it to `run_workflow_submit`, `publish_workflow`, `save_workflow_to_acp`
  instead of re-serializing actions/connections. The server holds it for 2 hours.
- **Batch inputs** — pass ALL images/assets into a SINGLE `run_workflow_submit` call (use the
  `content` array on the input node). Never make separate calls per image.
- **publish vs save** — `publish_workflow` creates a reusable API endpoint (`workflowId` + curl):
  use for "publish", "make it callable", "create an API". `save_workflow_to_acp` saves to the user's
  Adobe cloud for Workflow Builder: use for "save", "keep editing", "open in the UI". If ambiguous,
  ask before proceeding.
- **History** — `inspect_run` for a single item; `list_workflow_history` for lists. Never read local
  `workflow.json`/`inputs.json`. Details in [`references/diagnostics.md`](references/diagnostics.md).
- **Missing required input** — never silently resolve it (no substituting a simpler action, no
  auto-generating a placeholder/mask, no scripted workaround). Stop and present options. See
  [`references/compose.md`](references/compose.md).

## Anti-patterns

- Answering capability questions from training knowledge instead of calling `list_actions`.
- Composing non-trivial actions without injecting `get_action_schema` context (see compose.md).
- Using parallel nodes for multi-variant outputs — use one node with an array parameter (compose.md).
- Manually wiring actions in `compose_workflow` — describe intent in natural language.
- Separate `run_workflow_submit` calls per image — pass all inputs in one call.
- Reading local files for history — `list_workflow_history`/`inspect_run` are authoritative.
- Confusing publish and save — publish = API endpoint; save = Workflow Builder. Ask if ambiguous.
- Calling `run_workflow_submit` on a bare pasted ID — inspect, present, stop.
- Auto-rerunning after inspect, or auto-retrying/patching a failed workflow — always stop and ask.
- Silently resolving a missing input (blank mask, placeholder, simpler action) — stop and ask first.
- Trying to display outputs inline in Claude Desktop (`display_asset` exceeds the 1MB cap) — present
  text URLs; use `download_output` with `saveTo` to save locally.
- Listing only local paths without the full presigned URLs — always include both.
- Recommending AWS/S3 upload to work around errors — Azure ADLS is the only supported user path.

## References

- [Workflow Builder API docs](https://developer.adobe.com/firefly-services/docs/workflow-builder/)
- Paired skill for direct Firefly REST calls without MCP: `firefly-api-specs` (not included in this plugin)
- On-demand procedures: [`references/`](references/) (featured-and-templates, compose, diagnostics,
  asset-input, alert-rca).
