---
name: run-workflow
description: >-
  Use the run-workflow MCP to discover, compose, execute, publish, and save
  Firefly workflows. TRIGGER when: user asks what the MCP can do; wants
  to process images/video/3D models (.usdz/.glb) via workflow; wants to build/run/save/publish a
  workflow; wants to list/view saved or recent workflows, presets/interfaces,
  or Quickstart workflows (e.g. 'run banners at scale'); pastes any
  workflow/batch/execution ID. Create/compose requests default to
  compose_workflow from scratch. Call get_featured_workflow ONLY when explicitly asked for a
  featured/predefined template. Bare 'run banners at scale' = QUICKSTART
  (list_golden_workflows). BARE ID = INSPECT ONLY — call inspect_run, never
  run_workflow_submit. ALWAYS call list_actions first for action/node
  discovery; a "what tools" question is answered directly from your visible
  tool list, no call. DO NOT TRIGGER for direct Firefly API calls without
  MCP (use firefly-api-specs).
compatibility: Requires an enterprise Adobe account with a Firefly Services or Firefly Creative Production entitlement, assigned via the Adobe Admin Console. Not available to individual/personal Adobe accounts.
license: Apache-2.0
metadata:
  version: 1.0.0
  visibility: public
---

# run-workflow MCP

Discover, compose, run, publish, and save Adobe Firefly workflows through the run-workflow MCP.
Requires an enterprise Adobe account with a Firefly Services or Firefly Creative Production
entitlement assigned via the Adobe Admin Console; individual/personal accounts are not supported.

This core routes requests and keeps safety rules always loaded. `packages/mcp-server/` is the
source of truth for `SKILL.md` and `references/`; bump `skill-version.json` with every change.
Read the relevant reference **before** acting; do not load unrelated references or re-read them
just to present completed outputs.

| Read before... | Reference |
| --- | --- |
| Listing workflows/runs, executing, polling, presenting outputs, saving, or publishing | [Workflow guide](references/workflow-guide.md) — full routing, taxonomy, lifecycle, key rules, and anti-patterns |
| Processing a creative/marketing brief or composing template + CSV data merges | [Intake](references/intake.md) — required inputs, inference vs. questions, one compose call, run/save offer |
| Using an explicitly requested featured template, custom INDD/PSD, or MOGRT motion graphics template | [Featured and templates](references/featured-and-templates.md) — compose/rewire, CSV mappings, DGR controls and video counts |
| Composing a graph, handling missing inputs, multi-variant outputs, or a 3D scene | [Compose](references/compose.md) |
| Inspecting IDs, rerunning, handling errors, reattachment, or filtered history | [Diagnostics](references/diagnostics.md) |
| Uploading files, resolving inline pastes, macOS permission errors, or downloading outputs | [Asset input](references/asset-input.md) |
| Alert triage/RCA (stdio CLI only, `login --dev`, Splunk + Slack) | [Alert RCA](references/alert-rca.md) |

## Bare ID = inspect only

When the user's entire input is an ID (UUID, workflowId, batchId, executionId) without context:

1. Call `inspect_run(id)`.
2. Present executions, outputs, and diagnostics.
3. **STOP. Never call `run_workflow_submit` as a follow-up.**

"run-workflow" is the product name, not an execution instruction. Submission requires explicit
intent such as "run", "execute", "process", "generate", "rerun", or "redo". Never try submission
first and fall back to inspection after a 404. Questions about required assets for a
Quickstart workflow/interface use `inspect_run({ id: workflowId, interface: true })`,
not `get_featured_workflow`.

## Discovery and routing

Ground capability answers in live tools, not training knowledge. **Tools** and **actions/nodes**
are different vocabularies: answer "what MCP tools do you have?" directly from visible tool
definitions without calling a tool; call `list_actions` first for action/node catalog discovery.
Use `get_action_schema` for uncertain action parameters.

Homepage showcase workflows are **Quickstart Workflows**, formerly "golden workflows/demos".
Both names resolve to `list_golden_workflows`, not featured templates or internal golden fixtures.
Preserve configured headings in `renderedTable` verbatim, including
`RW_MCP_QUICKSTART_WORKFLOWS_HEADING` (default: `Quickstart Workflows`).

| Intent | Route |
| --- | --- |
| Create/compose, including named use cases, banners at scale, templates, or briefs | `compose_workflow` from scratch; no featured lookup/base unless explicitly requested |
| Explicitly use a featured/predefined workflow/template | `get_featured_workflow`, then follow the featured/template reference |
| List Quickstart/golden workflows | `list_golden_workflows`; render `renderedTable` verbatim |
| Run a Quickstart workflow (e.g. "run banners at scale") | `list_golden_workflows` to resolve its workflowId; ask which if multiple matches, then submit `workflowId`, `inputs: []`, `interfaceRerun: true` unless the user requested their own assets |
| Any broad "list my workflows"/"what have I built/saved?" request, even with "all" | One `list_all_workflows` call; no separate Quickstart lookup or history call |
| Filtered/date-ranged own workflows | `list_workflow_history` |
| Interfaces/presets (definitions) | `list_interfaces` |
| Jobs/interface/preset runs | `list_interface_runs` |
| Plain workflow runs/"what have I run?" (not interface-specific) | `list_workflow_runs`, which excludes interface/preset runs |
| Broader/filtered run queries (any source, specific UI/host) | `list_batches` with appropriate filters |
| Single most recent run | `list_workflow_history(limit=1)`, then `inspect_run` |
| One named run, pasted ID, outputs, logs, or failure | `inspect_run` |
| Known-good examples to debug compose; reload edited examples | `get_workflow_examples`; `reload_examples` |
| Upload local file; abort running batch | `upload_asset`; `cancel_workflow` |
| Execute; poll | `run_workflow_submit`; `run_workflow_get_status(includeOutputs: true)` |
| Save editable draft; publish reusable API; get published curl | `save_workflow`; `publish_workflow`; `generate_curl` |
| Catalog stale | `refresh_catalog` |
| Display/download outputs | `display_asset` only outside Claude Desktop; `download_output` only after the user asks |

Read the workflow guide for complete listing semantics. Render each listing tool's `renderedTable`
verbatim. For `list_all_workflows`, it already contains Quickstart rows, `typeSummary`, then the
own-workflows table in that order; never split, summarize, reconstruct, or separately paste
`typeSummary`. Mention `goldenUnavailable` when true. Each new listing intent requires a fresh
matching tool call, not filtering an earlier result from a different catalog.

Use plain type labels: Published, Preset (same as interface), Inline, Draft, Preview, Shared.
By default hide un-run drafts; include them only when explicitly asked. A draft stays a draft
after execution. Never offer to edit/republish a Shared workflow or claim another author's work.

## Compose and execute safely

- Describe intent, not node versions, ports, tags, or wiring. Do not manually design the graph.
  For template/CSV data merges, gather the required template + CSV first (unless explicitly told
  to "just compose"); infer from files and ask for optional fonts and output/run/save intent.
  Pass `customTemplateUrl`, `csvUrl`, and `fonts` in one compose call. Do not pre-call tag
  extraction/catalog tools unless the user asks to inspect them.
- For 3D products, only `.usdz`/`.glb` scenes are supported; pass `sceneUrl` to compose.
  For Composite images (3D), call `describe_scene` once, use an exact user-provided name,
  a single candidate, or `main_camera`; otherwise ask using returned names. Pass exact
  `sceneCamera`/`sceneHeroAsset`. For Render 3D/360 spin, only select a camera if the user names one.
- Never silently substitute a simpler action, generate placeholder inputs, or use scripted
  workarounds. Surface missing inputs and compose errors. Re-compose at most once after the
  cause is fixed with the same intent-only message; never drop CSV/templates or request legacy
  wiring to bypass failure.
- Retain `session_id` from compose/featured lookup for submit, save, and publish (2-hour lifetime).
  Offer Run now / Save to Workflow Builder / both after compose. If the graph was edited, validate
  it with `validate_workflow` and submit explicit edited actions/connections/inputs; the cached
  session alone still points to the unedited graph.
- Submit all assets in **one** call, not one per image. Use `prepared.inputNodes` for featured
  inputs. Copy presigned URLs verbatim; changing any character invalidates the signature.
- **ASK-FIRST for draft/published assets:** ask existing/prior vs. user-supplied assets unless
  already established by the prompt; prefer checking prior asset resolvability and collect fresh
  files for missing assets. This also applies to never-run published workflows; do not rely on
  submit's automatic confirmation guard. Check `durabilityCoverage`, not just `resolvedVia`.
- **Quickstart/interfaces/presets are the opposite default:** submit `workflowId` + `inputs: []`
  directly, with no asset confirmation or pre-verification; baked defaults are curated/durable.
  Preserve an explicitly selected interface definition with `interfaceRerun: true` (interfaces
  share their source workflow's ID). Only collect overrides when the user's prompt asks for them.
  Do not reuse a prior run's custom assets silently.
- For same-assets reruns, use `workflowId` alone with `inputs: []` when available, not an inline
  graph. Read diagnostics first for `rerun` object routing, first-run cases, `inline_exact`,
  `interfaceRerun`, `needs_reattach`, `needs_rewire`, and `no_editable_graph`.
- Never force past `invalid_workflow`, `needs_rewire`, or `no_editable_graph`. A corrupt published
  definition needs correct republication; do not compose a replacement for a user who asked to run it.

## Poll, present, and persist

Read the workflow guide before submission for the detailed lifecycle and output protocol.
Always poll with `includeOutputs: true` to a terminal state; use returned `elapsedSeconds`
and `percentage` for progress, not estimates. Wait 15s below 60s elapsed, 30s from 60–180s,
60s above 180s. Only preset/interface runs offer completion email instead of continued polling.
Show `downloadedPreviewOutputs` immediately as in-progress. On failure, inspect, summarize,
and stop; never auto-retry/rewire.

On completion, present every `VIEW YOUR ASSETS:` folder link first, then all `OUTPUT URLS:`
lines verbatim (not the trailing JSON). For oversized responses, extract those text blocks
once from the temp file; do not re-poll or repeatedly parse JSON. No placeholders/truncated URLs.
Then offer one combined choice: download locally, keep links, or next steps (save/publish/new
workflow). In stdio, download to the user's chosen `saveTo` folder; hosted download returns
`downloadUrl`/`downloadToken` for a GET with `x-download-token`, not a local save path.
Do not call `display_asset` in Claude Desktop (1MB response cap).

Save is for editable Workflow Builder drafts; publish is for API reuse. Ask if ambiguous.
Session saves use the latest accepted submission; pass both `session_id` and `batch_id` for
the exact run. Expired/missing snapshots are errors, never a reason to re-compose a replacement.
Draft inspection/reruns re-sign stored files with the user's access; report `draftAssetRefresh`
failures and `assetPersistence` reattachments. Photoshop action files are stored too but remain
original links in Builder and are not `inputs[]` slots; follow `needs_reattach` hints. Save a
corrected submission again after running, since earlier drafts are not updated automatically.
A rewired run's `postRun` requires offering save/publish/create_preset after completion;
ordinary input swaps do not.

## Further reading

- [Workflow Builder API docs](https://developer.adobe.com/firefly-services/docs/workflow-builder/)
- For direct Firefly REST calls without MCP, use the `firefly-api-specs` skill instead.
