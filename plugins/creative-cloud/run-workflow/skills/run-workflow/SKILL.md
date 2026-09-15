---
name: run-workflow
description: >-
  Use the run-workflow MCP to discover, compose, execute, publish, and save
  Adobe Firefly workflows. TRIGGER when: user asks what the MCP can do; wants
  to process images/video/3D via workflow; wants to build/run/save/publish a
  workflow; wants to list/view saved or recent workflows, presets/interfaces,
  or golden demos (e.g. 'run banners at scale'); pastes any
  workflow/batch/execution ID; names a featured workflow (retargeting, product
  banners, localization, packaging, banner advertising) — call
  get_featured_workflow first. NOTE: 'banners at scale' = GOLDEN DEMO
  (list_golden_workflows), NOT the featured workflow 'Product Banners At
  Scale'. BARE ID = INSPECT ONLY — call inspect_run, never
  run_workflow_submit. ALWAYS call list_actions first for action/node
  discovery; a "what tools" question is answered directly from your visible
  tool list, no call. DO NOT TRIGGER for direct Firefly API calls without
  MCP (use firefly-api-specs).
---

# run-workflow MCP

<!-- SYNC: This skill is maintained in three locations that must be kept identical:
     `.claude/skills/run-workflow/` (source), `.cursor/skills/run-workflow/` (Cursor),
     and `packages/mcp-server/references/` (reference files only, bundled with the MCP server).
     Change one, change all three. See docs/CODE_PATTERNS.md → "run-workflow skill twins". -->

Discover, compose, run, publish, and save Adobe Firefly workflows through the run-workflow MCP
server. Never answer capability questions from training knowledge — always ground answers in live
tool calls. `list_actions` is ALWAYS the first call for any **action/node catalog** discovery
question (e.g. "what actions are available"). A **tools** question (e.g. "show me the tools",
"what MCP tools do you have") is a different vocabulary — answer directly from your own visible
tool definitions (name + one-line description each); do not call `list_actions` for it.

This file is the always-loaded core. Deeper procedures live in `references/` and should be read
**only when the current turn needs them**:

| Read this reference when… | File |
| --- | --- |
| User uploads/pastes a document that reads like a creative/marketing brief (not a bare ID, not a named workflow) | [`references/intake.md`](references/intake.md) |
| User names a featured workflow, or supplies a custom `.indd`/`.psd` template to rewire | [`references/featured-and-templates.md`](references/featured-and-templates.md) |
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
and falling back to `inspect_run` after a 404. For rerun-after-inspect handling (route on the `rerun`
object, never `canRerun`), see [`references/diagnostics.md`](references/diagnostics.md).

**"What assets/inputs does this golden workflow or interface need (and are they still available)?"**
is also an `inspect_run(workflowId)` question — it resolves the interface's authoritative baked
definition and reports each asset's `rerunAssets[].resolvedVia` (warm-url / durable-storage /
unavailable). NEVER answer it with `get_featured_workflow` (a different catalog). See
[`references/diagnostics.md`](references/diagnostics.md) → "What assets does this golden/interface need".

## Workflow types (user-facing vocabulary)

Every workflow the user sees falls into one of these types. Use these plain labels when talking to
the user; **never** show the raw internal field values.

- **Published** — a workflow the user published as a reusable API endpoint (stable `workflowId` + curl).
- **Preset** — a published workflow run from a Firefly UI. **"Preset" and "interface" are the SAME
  thing** — if the user asks about "interfaces" or "presets", they mean this. (Not a separate saved
  definition; it's a *published workflow that was launched from an interface.*)
- **Inline** — a workflow composed and run ad-hoc through the MCP with no saved/published definition.
- **Draft** — saved to Workflow Builder but not yet published. A draft **stays a draft after it is
  run** (source `draft` whether or not it has ever executed), matching the builder UI. Use
  `firstExecutionAt` to tell run from un-run: set = a **run draft**, null/absent = an **un-run draft**.
- **Preview** — a one-off preview execution; ephemeral.
- **Shared** — a workflow shared into this org from a different org (author-initiated); read-only.

A **workflows-listing** request ("give me my workflows", "what have I built") surfaces the caller's
own **Draft** and **Published** rows, plus other org members' **Published** rows and any **Shared**
rows (Preset is a labeled subset of Published) — Inline and Preview are execution artifacts with no
saved definition and are excluded from that intent entirely. Never claim to have run or edited a
workflow authored by someone else, and never offer to edit/republish a Shared row.

For that intent, **by default hide un-run drafts** (`workflowSource === "draft" && !firstExecutionAt`)
and show run drafts alongside published — the un-run drafts are unfinished scratch work the user
rarely means. Include un-run drafts only when the user explicitly asks for un-run / unfinished / all
drafts.

Translate to these labels when listing — full field mapping in [`references/diagnostics.md`](references/diagnostics.md).

## Tool routing

| User intent | Tool |
| --- | --- |
| "Show me the tools" / "show me the MCP tools" / "what tools do you have" / "what tools are available" | Answer directly from your own visible tool list (name + one-line description each) — do NOT call `list_actions` or any other tool |
| "What actions are available?" / "show me the nodes/actions I can use" / "what can I use to build workflows" / "show me the catalog" / "what can you do" (as a workflow-capability question) | `list_actions` |
| "What parameters does action X accept?" | `get_action_schema` |
| "Build / compose / create a workflow for…" | `compose_workflow` |
| Upload a local file to get a URL | `upload_asset` |
| Execute a workflow — only with explicit run/execute keywords. Returns a `batchId` immediately (async); safe for any size | `run_workflow_submit` |
| Check whether a running execution is done — **always pass `includeOutputs: true`** on every poll | `run_workflow_get_status` |
| Abort a running batch by batchId | `cancel_workflow` |
| "Give me my workflows" / "Show me **all** my workflows" / "my recent workflows" / "What have I **built / defined / saved**?" (ANY plain workflows-listing intent, with or without the word "all" — no date filter, no mention of "runs"/"executions") | `list_all_workflows` — ONE call; its `renderedTable` already contains, in order, the 8 golden-demo rows, the `typeSummary` type-count block, then the caller's own workflows table, as a single combined string — never a separate `list_golden_workflows` call, and never separately paste the standalone `typeSummary` field too (it's already embedded). Never `list_workflow_history`/`list_batches`/`inspect_run` for this intent — exact columns and pre-computed fields in [`references/diagnostics.md`](references/diagnostics.md) |
| A **filtered/date-ranged** own-workflow query (e.g. "workflows I published last week") — not the broad listing intent above | `list_workflow_history` (own drafts/published only, with date filters) |
| "List my **interfaces**" / "my **presets**" / "what presets/interfaces do I have published" (DEFINITIONS — a genuinely different entity from a regular published workflow, not runs) | `list_interfaces` — one call, already formatted; render `renderedTable` verbatim |
| "List my **jobs**" / "my interface runs" / "preset runs" / "interface executions" (RUNS only — never bulk-workflow-service traffic, no preview/headless runs) | `list_interface_runs` — one call, already filtered + formatted; render `renderedTable` verbatim; for outputs/errors on one run, `inspect_run` with its `batchId` |
| "List my **workflow runs**" / "runs of my saved workflow" / "what have I run" (when NOT asking about interfaces/presets/jobs specifically) — plain, non-interface runs, no UI precedent so columns/formats are this tool's own design | `list_workflow_runs` — one call, already filtered (excludes interface/preset runs entirely, regardless of channel) + formatted; render `renderedTable` verbatim; for outputs/errors on one run, `inspect_run` with its `batchId` |
| "Show my recent **runs**" / "everything I've **run**" / "The interface I just ran" / "Runs from a specific UI" (any-`batchSource`/`invocationSource`/`hostId` filtered run query — not the intents above) | `list_batches` (filter `batchSource:"preset"` for interface runs, `hostId` for a specific UI) |
| "Last workflow I ran" / "Most recent run" (**single**, by recency) | `list_workflow_history` (limit=1) → `inspect_run` — single-item only, never for a broad list |
| Per-action outputs/logs/errors for a run; "why did it fail?"; any pasted ID | `inspect_run` |
| Look up known-good examples to debug a failed compose | `get_workflow_examples` |
| Reload examples after editing JSON files on disk | `reload_examples` |
| Publish workflow as a reusable API endpoint with curl | `publish_workflow` |
| Save workflow as an editable DRAFT in Workflow Builder (dual-writes ACP + the unified store the backend reads) | `save_workflow` |
| Generate a curl command for a published workflowId | `generate_curl` |
| Display output images inline in chat (not in Claude Desktop — 1MB cap; only after presenting URLs per the Presenting outputs sequence) | `display_asset` |
| See newly registered actions (catalog stale) | `refresh_catalog` |
| Run a named/featured workflow (retargeting, **product** banners at scale, localization, packaging…) — a per-use-case TEMPLATE, distinct from a golden demo (see note below) | `get_featured_workflow` → see [`references/featured-and-templates.md`](references/featured-and-templates.md) |
| "List golden workflows" / "what are the golden demos" (FFCPE's homepage showcase cards — Banners at Scale, Product Assets, Social Video Adaptation — different from featured workflows, which are per-use-case templates, not showcase demos) | `list_golden_workflows` — one call, already formatted; render `renderedTable` verbatim |
| "Run/execute **`<golden demo name>`**" (e.g. "run banners at scale", "run the social video adaptation demo") — an EXECUTE intent naming a golden demo, not a plain listing request | `list_golden_workflows` first to resolve the name to its `workflowId` — a use-case name like "Banners at Scale" matches more than one row; list them and ask which before proceeding, never guess — then submit `run_workflow_submit({ workflowId, inputs: [] })` directly (baked defaults, no confirmation needed — see the **ASK-FIRST (assets)** rule under **Key rules**), unless their prompt already asked for their own assets, in which case collect and pass `inputs`. Never route a bare "run `<use case>`" to `get_featured_workflow` — that's the agent-facing template path, not the user run path. |

**Single vs. multiple:** one ID / "the last one" / "that workflow" → `inspect_run` (full details).
A broad "list my workflows" request with no named target and no "run"/"ran"/"execution" wording →
`list_all_workflows`. If the request mentions runs/executions instead of (or alongside) workflows
— including "my workflow runs" specifically → `list_workflow_runs` (never `list_all_workflows`
or `list_workflow_history`); a broader/filtered run query (any source, a specific `hostId`, etc.)
→ `list_batches` instead.

### Workflows-listing intent — ONE call, THREE sections baked into `renderedTable`

A plain "give me my workflows" intent (see the table row above) is answered with exactly ONE
`list_all_workflows` call. Its `renderedTable` already contains three sections, IN THIS ORDER,
inside one combined string, each separated by a blank line. Paste that string as your reply,
unchanged — do not reconstruct the table from the `workflows` array, do not drop the golden-demo
rows or the Workflow ID column, and do not replace any section with a prose summary. A short
follow-up offer to filter/narrow after the pasted block is fine; it is not a substitute for
pasting the block first.

The three sections:

1. A **"Golden demos:"** label, then FFCPE's 8 homepage golden-demo rows (byte-identical to
   `list_golden_workflows`' own table).
2. The `typeSummary` type-count block (also returned as its own standalone field, for callers
   that want just the counts — but when rendering `renderedTable`, it's already positioned here;
   do not ALSO separately paste the standalone `typeSummary` field before `renderedTable`, or the
   block appears twice).
3. A **"Your workflows:"** label, then the caller's own workflows table (5 columns — see
   [`references/diagnostics.md`](references/diagnostics.md)).

On a paginated call (`offset > 0`), section 1 is skipped entirely — golden demos are the same
static 8 rows every time, so they're only fetched/rendered on the first page.

Present the WHOLE string verbatim, top to bottom, in one piece. Do not call
`list_golden_workflows` separately for this intent, do not split `renderedTable` back into
multiple tables/fields, and do not summarize or trim any section just because it isn't the
"main" content.

Three designs for the golden-demos section specifically were tried, in order — the first two
abandoned: (1) two separate sequential tool calls (`list_golden_workflows` then
`list_all_workflows`) — reliably summarized away in practice even with explicit instructions,
because skipping an entire extra tool call turned out to be just as easy for a model to do as
dropping one field; (2) a `goldenRenderedTable` SIBLING field on `list_all_workflows`'s own
response — also reliably dropped, for the same underlying reason a second field is as skippable
as a second call; (3, current) folding the golden rows directly into the ONE string that has
reliably survived every other similar test this feature went through (`renderedTable` itself) —
there is nothing left to selectively omit. The same reasoning was then applied to `typeSummary`'s
position once golden-demo ordering surfaced a second problem (a separate `typeSummary` field
rendered in the wrong order relative to `renderedTable`) — folding it into the same string at the
correct position removes that ordering ambiguity too. `goldenUnavailable: true` means the golden
section specifically failed and was omitted entirely (not left as a blank placeholder) — mention
this to the user rather than presenting the table as if golden demos simply don't exist.

**Interfaces/presets vs. their runs:** "interfaces"/"presets" (same thing — "preset" is the
older, backend-internal name) name a DEFINITION (published through a genuinely separate
endpoint/namespace from a regular published workflow) → `list_interfaces`. "jobs" names their
RUNS (executions) → `list_interface_runs`, never bulk-workflow-service traffic (a separate
product with no representation in run-workflow's batch data at all). Don't conflate these two
intents with each other or with `list_all_workflows`/`list_batches`.

**Plain workflow runs vs. interface runs:** `list_workflow_runs` excludes interface/preset runs
entirely (regardless of who/what launched them) — it's the complement of `list_interface_runs`,
not a superset. There is no existing UI for this (unlike interfaces, which mirror bulk-creation's
UI exactly) — its columns/formats are this tool's own design; don't claim they match a screen.

**Golden demos vs. featured workflows on "banners":** both catalogs happen to use the word
"banners," but they are unrelated. "Banners at Scale" (bare) is a golden-demo USE CASE — a homepage
showcase card with 2 sub-demos, resolved via `list_golden_workflows`. "Product Banners At Scale" is
a featured-workflow TEMPLATE (agent-facing, resolved via `get_featured_workflow`). A bare user
"run banners at scale" (or any bare "run `<use case>`") is a GOLDEN request — resolve it via
`list_golden_workflows`, never `get_featured_workflow`. Reach for `get_featured_workflow` only when
the user EXPLICITLY asks for a featured/predefined template, or as a `compose_workflow` precursor.

For the Type/channel taxonomy (`batchSource` vs `invocationSource`) and run-centric routing
details, see [`references/diagnostics.md`](references/diagnostics.md).

## Workflow pattern

```
1. upload_asset        — upload local files; get back URLs for use as inputs
1b. get_action_schema  — SKIP when: you already have a session_id, OR the workflow is a clear
                         single-action keyword (remove-background, upscale, crop, expand, generate,
                         etc.). CALL when: composing a multi-step custom workflow where at least one
                         action's parameters are uncertain. See references/compose.md.
2. compose_workflow    — describe the desired processing in natural language; the AI graph agent
                         designs the graph. DO NOT manually specify actions or connections.
3. run_workflow_submit — execute with inputs; pass session_id from step 2. Pass ALL images in ONE
                         call. Returns a batchId immediately (async); does NOT block on completion.
                         → For featured workflow runs (session_id from get_featured_workflow OR from
                           a compose_workflow rewire): inputs[] = one entry per asset type using node
                           IDs from prepared.inputNodes — preserved through rewires. See table in
                           references/featured-and-templates.md. No deliberation needed.
4. run_workflow_get_status — poll the batchId; ALWAYS pass includeOutputs: true. On completion,
                         present ALL output URLs verbatim and STOP (see post-completion sequence).
5. download_output     — ONLY after the user asks; saveTo a folder they choose.
6. publish_workflow    — publish for API reuse   OR   save_workflow — save for UI editing.
```

## Async polling

After `run_workflow_submit`, poll `run_workflow_get_status` with `includeOutputs: true` using a
tiered interval — read `elapsedSeconds` from each response to pick the next wait:

| `elapsedSeconds` so far | Wait before next poll |
|---|---|
| < 60 | 15s — may finish quickly |
| 60 – 180 | 30s |
| > 180 | 60s — large batch; halve tool calls |

Report progress using `elapsedSeconds` and `percentage` from the response directly — do not estimate
elapsed time yourself:

> **Running** — 3/10 assets complete (30%) · 45s elapsed

**Poll to completion — don't stop early.** Always poll to a terminal state (`completed`/`failed`) before presenting outputs.

| Run type | Email sent? | What to do |
|---|---|---|
| `batchSource: "preset"` (interface/preset — outputs go to Adobe Files) | Yes | May offer "keep polling here or wait for the completion email" — if user chooses to keep polling, continue to completion |
| All other runs (inline / published / preview — presigned `outputUrls` in status) | No | Always poll to completion; do not offer email option |

- If a poll includes `downloadedPreviewOutputs`, display those immediately (labelled in-progress) while continuing to poll.
- When `status === "completed"`, outputs are already in the response — no second call. On a large
  batch the completed response may exceed the client budget and be temp-filed; that's expected —
  extract the `OUTPUT URLS:` block once (see the "Presenting outputs" sequence below and
  [`references/asset-input.md`](references/asset-input.md)) rather than re-polling.
- If `status === "failed"`, call `inspect_run` on the failed execution, summarize, and **stop** — do not auto-retry or re-wire. See [`references/diagnostics.md`](references/diagnostics.md).

## Presenting outputs — post outputs, then one combined offer

Once `run_workflow_get_status` reports `completed` (fully or partially), do exactly two things in
order — post the outputs, then make a single combined offer. Never split the offer into separate asks.

1. **Post all outputs — immediately, no deliberation.** When status becomes `completed`:
   - First, check for a **`VIEW YOUR ASSETS:`** block above the `OUTPUT URLS:` block. This
     appears when the workflow had one or more write-files nodes that saved to Adobe Files, AEM
     Assets, or Frame.io — each entry is a folder link for browsing all outputs delivered to that
     destination. **If present, show all entries first**, labeled prominently (e.g.
     "**View all your assets in Adobe Files:** [link]"). A workflow may have more than one
     write-files node (e.g. one to ACP and one to Frame.io), so there may be multiple links.
   - Then list every URL from the **`OUTPUT URLS:` text block** verbatim as a flat markdown list —
     read from that block, **not** from the trailing JSON `outputUrls[]` blob. Do not re-read any
     reference file. Full URLs only — never truncated or placeholdered (`[presigned URL]` is
     forbidden). If the response overflowed to a temp file (large batch), make two targeted greps:
     first grep for `VIEW YOUR ASSETS:` (show any folder-link lines found), then grep for
     `OUTPUT URLS:` (present the `- name — url` lines that follow) — never multi-pass the JSON blob
     (see [`references/asset-input.md`](references/asset-input.md)).
   - Presigned URLs expire in ~1 hour. Nothing else in this message beyond the outputs.
2. **In ONE message, offer a single combined choice** — never split into separate "download?" and
   "next steps?" turns:
   - **Download to your machine** — call `download_output` with a `saveTo` folder they choose and
     report the exact saved paths; or
   - **The links above are enough** — no download needed; or
   - **What's next** — save to Workflow Builder (`save_workflow`), publish as an API
     (`publish_workflow`), or start a new workflow.

## Key rules

- **Presigned URLs** — copy `url` fields verbatim from all responses — HMAC-signed; one changed character → `asset_download_failed`.
- **ASK-FIRST (assets) — draft/published workflows ONLY, NOT golden demos/interfaces** — before
  running a draft or published workflow, ask the user whether to run with the existing/prior assets
  or supply their own, UNLESS their prompt already established it (they attached files or said "use
  the defaults"). Prefer to verify the prior assets are still hydratable (warm presigned URLs) before
  running; if an asset can't be hydrated, ask for a fresh one rather than submitting blind. A golden
  demo/interface/preset is the OPPOSITE default: submit `inputs: []` directly, no confirmation, no
  pre-verification — its baked assets are curated and durable, not a stale leftover from a prior run.
  Only ask there when the user's own prompt is itself ambiguous about wanting their own assets.
- **Fast rerun** — to rerun a workflow with the same assets, submit `workflowId` ALONE (no
  `actions`/`connections`, `inputs: []`) so the client uploads/re-signs nothing and submit returns
  instantly. Only pass the inline graph for preset/inline sources with no published `workflowId`,
  and then reuse `workflowJson`'s presigned input URLs verbatim (re-upload only `[URL expired …]`
  inputs). Passing the inline graph on a `by_id` rerun re-resolves every asset and stalls
  `run_workflow_submit` for minutes. **Not for a first encounter** (`inspect_run` →
  `executionCount === 0`, any source — never-run draft, freshly imported workflow, un-invoked
  preset): there is no prior run to reproduce, so its baked assets aren't "the same assets from last
  time." If they're all still resolvable (`rerunAssets.status: "all_resolvable"`) tell the user it can
  run as-is and let them confirm; if `some_missing`, collect the real inputs for a first run instead of
  submitting the id alone.
  **Interfaces/presets are a special case of the above, at every run count, not just the first**:
  an interface always ships with its own baked defaults, so `workflowId` + `inputs: []` uses them —
  regardless of how many times it's been run before, and regardless of what a PRIOR run happened to
  submit (a one-off custom asset from a previous run, including a failed one, is never silently
  reused). Per the **ASK-FIRST (assets)** rule above, this is the OPPOSITE default from a plain
  workflow — submit `inputs: []` directly with no confirmation and no pre-verification; pass `inputs`
  only when the user's own prompt already asked to swap an asset. See
  [`references/diagnostics.md`](references/diagnostics.md).
- **session_id** — `compose_workflow` and `get_featured_workflow` both return one. Retain it for the
  whole conversation; pass it to `run_workflow_submit`, `publish_workflow`, `save_workflow`
  instead of re-serializing actions/connections. The server holds it for 2 hours.
- **Batch inputs** — pass ALL images/assets into a SINGLE `run_workflow_submit` call (use the
  `content` array on the input node). Never make separate calls per image.
- **publish vs save** — `publish_workflow` creates a reusable API endpoint (`workflowId` + curl):
  use for "publish", "make it callable", "create an API". `save_workflow` (formerly `save_workflow_to_acp`) saves to the user's
  Adobe cloud for Workflow Builder: use for "save", "keep editing", "open in the UI". If ambiguous,
  ask before proceeding.
- **History** — `inspect_run` for a single item; `list_all_workflows` for any broad "list my
  workflows" intent; `list_workflow_history` only for filtered/date-ranged own-workflow queries.
  Never read local `workflow.json`/`inputs.json`. Details in [`references/diagnostics.md`](references/diagnostics.md).
- **Missing required input** — never silently resolve it (no substituting a simpler action, no
  auto-generating a placeholder/mask, no scripted workaround). Stop and present options. See
  [`references/compose.md`](references/compose.md).

## Anti-patterns

These traps are non-obvious and not clearly covered by the sections above:

- **Conflating "tools" with "actions/nodes"** — these are different vocabularies. "Show me the
  tools" / "what MCP tools do you have" asks about the MCP tool surface (`list_actions`,
  `compose_workflow`, `run_workflow_submit`, etc.) — answer directly from your own visible tool
  list, no tool call. "What actions are available" / "show me the nodes" asks about the workflow
  action/node catalog — call `list_actions`. Never answer one with the other.
- **Running a draft/published workflow without first asking about assets** — don't. Before running
  one, ask whether to use the existing/prior assets or the user's own, UNLESS their prompt already
  established the choice (they attached files or said "use the defaults"). Prefer to verify the prior
  assets are still hydratable (warm presigned URLs) before running; if one can't be hydrated, ask for
  a fresh asset rather than submitting blind. See the **ASK-FIRST (assets)** rule under **Key rules**.
  **A golden demo/interface is the opposite case** — don't ask, and don't call `inspect_run` first to
  "verify" its baked assets either: submit `run_workflow_submit({workflowId, inputs: []})` directly.
  Its baked defaults are curated/durable, `inspect_run` inspects a prior *execution* (nothing to find
  for a never-run interface, and calling it first only risks an unrelated 404), and submit's own
  preflight already surfaces a real problem via `needs_reattach` if one exists.

- **Answering a new listing intent from a PRIOR list result instead of a fresh tool call** — don't.
  Each row in the Tool routing table above is a distinct tool over a distinct data source; a
  follow-up question that names a different entity — e.g. asking about golden demos right after
  listing plain workflows for the last week, or asking for interfaces right after a
  `list_workflow_history` query — is a NEW intent, not a filter over what is already in context.
  Route it through the table again and call the matching tool fresh. Never search, filter, or answer
  from a previously-returned list just because a similar-sounding request landed a moment ago —
  `list_golden_workflows`/`list_interfaces`/etc. are separate catalogs the prior call never fetched.

- **Omitting `csvData` from a deterministic `compose_workflow` rewire when the user has a CSV** —
  `csvData` is the *only* input that drives parse-data routing; without it all image ports direct-wire,
  causing item-count mismatches at runtime (`"image" has 4, "Headline" has 16`). The `message`
  parameter cannot override routing. See [`references/featured-and-templates.md`](references/featured-and-templates.md).
- **Rewiring a custom template (`.indd`/`.psd`) through the `message`/LLM path or a bare "swap"** —
  leaves the featured base graph's lower-case merge ports (e.g. `headline`) in place, so InDesign data
  merge (case-sensitive) fails 107013 against a `Headline` placeholder after a long merge. Always use
  `compose_workflow(customTemplateUrl=…)`, which rebinds each port to the template tag's exact case.
  Re-casing the CSV header does **not** fix this (the CSV header is discarded; the data-source header
  comes from the merge port name). On a custom-template + CSV run also run the case-insensitive tag ↔ CSV
  **coverage** check (every tag has a column; image columns keep `@`). See [`references/featured-and-templates.md`](references/featured-and-templates.md).
- **Placing a merge-data template in an input node's `content[]`** — for `merge-data` /
  `data-merge-psd` workflows, the `.indd` or `.psd` template MUST be supplied via
  `inputs[].template.presignedUrl` on the **merge node itself**, not as a `content[]` item on
  `input-files` or any other input node. Placing it in `content[]` silently mis-routes it and the
  run fails with `"merge-data requires at least one template file"` (and a `write-files` cascade).
  `run_workflow_submit` now returns `status:"missing_template"` with `misplacedOnNodeId` when it
  detects this mistake. `inspect_run` surfaces required-but-empty template slots as
  `reattachVia:"template"` leaves so you know which node id to target before submitting.
- **Passing a template as a `workflowTemplateUrl` / `templateUrl` / `indesignTemplateUrl` parameter** —
  those are graph node-data authoring fields (often a non-presigned CloudFront reference) the backend
  **never** reads at runtime; the flattener strips them from execution `parameters`. A merge node whose
  only "template" is a `*TemplateUrl` still fails `"requires at least one template file"`. The sole
  runtime source is `parameters.templates[]` (from `inputs[].template.presignedUrl`, or the composed
  template on a rewired session). See [`references/featured-and-templates.md`](references/featured-and-templates.md).
- **Supplying an image input without `name`** — a missing `name` breaks per-row `@image` basename
  matching. (A rewired `session_id` now injects the composed template automatically — you no longer
  need `useSessionDefaults: true` just to get the template; that flag now only governs the broader
  non-template session defaults such as text fills.) See [`references/featured-and-templates.md`](references/featured-and-templates.md).
- **Swapping in a *different* template on a bare rerun and assuming it just runs** — for a
  `merge-data`/`data-merge-psd` node, the input ports ARE the old template's tags, so a new template
  whose placeholders differ misroutes content and fails late with InDesign **107013**. On a bare
  `inputs[].template` swap (no composed `session_id`), `run_workflow_submit` now describes the new
  template and **diffs its tags against the node's current ports**: an **empty diff runs as-is**; a
  **non-empty diff returns `needs_rewire`** (with the concrete `diff`) → route through
  `compose_workflow`; a mismatch on a source with no Matrix graph returns `no_editable_graph` (edit in
  Builder). Don't force-resubmit past `needs_rewire`/`no_editable_graph`. Read a node's expected tags
  up front via `inspect_run`'s `mergeTemplatePorts`. See [`references/diagnostics.md`](references/diagnostics.md).
- **Submitting a graph with a wiring mistake** — `run_workflow_submit` now structurally validates any
  locally-resolved graph (the same checks as `validate_workflow`) before the backend call and returns
  `status:"invalid_workflow"` with an `errors[]` list for the un-runnable faults: a required input port
  with no incoming connection, two connections into one port, a cycle, or a connection to a non-existent
  node. Fix the wiring (or re-run `compose_workflow` / `validate_workflow`) and resubmit — don't submit
  as-is. Orphaned/unreachable nodes are non-fatal: they ride along as a `warnings[]` array on a
  `submitted` result. See [`references/diagnostics.md`](references/diagnostics.md).
- **Forgetting to offer persist after a re-wired run** — when a submit ran a rewired `session_id`, the
  `submitted` result carries a `postRun` block; once `completed`, offer `save_workflow` /
  `publish_workflow` / `create_preset` (keyed off `postRun.sessionId`) so the new wiring isn't lost. A
  plain input-swap rerun has no `postRun` — don't prompt there. See [`references/featured-and-templates.md`](references/featured-and-templates.md).
- **Rewriting a merge CSV's `@image` filename cells into presigned URLs** — submit the CSV as-is;
  the runtime resolves filenames to wired assets by basename. Only edit the CSV when a diagnosed
  failure points to a filename↔asset mismatch, and only after telling the user.
- **Setting `interfaceRerun: true` on an ordinary published/inline re-run** — use it ONLY when
  reproducing a preset/interface run (`rerun.method: "inline_exact"` and `isInterface: true`). See
  [`references/diagnostics.md`](references/diagnostics.md).
- **Calling `display_asset` in Claude Desktop** — the 1MB response cap makes inline display fail;
  present text URLs only and offer `download_output` with `saveTo` for local saving.
- **Dropping `createdBy`/`workflowId` when a large `list_all_workflows` result gets grep/jq'd,
  or separately re-pasting the standalone `typeSummary` field before `renderedTable`** — select
  and render the response's `renderedTable` field verbatim (it already contains, in order: golden
  demos, the type-count block, then a ready-to-paste markdown table with all 5 required columns)
  instead of reconstructing any part of it from individual per-row fields, and instead of also
  pasting the standalone `typeSummary` field separately (it's already embedded at the correct
  position inside `renderedTable` — pasting both duplicates the block). Pulling only
  `nameDisplay`/`lastModifiedDisplay`/`statusDisplay` and collapsing `createdBy` into prose ("all
  authored by you") is exactly the recurring failure `renderedTable` exists to prevent.
- **Calling `list_golden_workflows` separately before `list_all_workflows` for a plain "give me
  my workflows" intent, or trimming/summarizing the golden-demo rows at the top of
  `list_all_workflows`'s `renderedTable` into a one-line mention like "golden demos are also
  available"** — see "Workflows-listing intent — ONE call, THREE sections" under Tool routing
  above: `list_all_workflows` is the ONLY call needed; its `renderedTable` already contains the
  golden rows, then `typeSummary`, then the own-workflows table, in that order. Present the whole
  string verbatim, top to bottom — do not split it, do not call `list_golden_workflows` too, and
  do not collapse any section into prose.
- **Falling back to `compose_workflow` when a published workflow won't run** — if *"run this published
  workflow"* fails at every submit shape with `Workflow has no input actions` / `Workflow with actions
  and connections is required` / `invalid_input_target` + empty `validInputNodeIds: []` / `Circular
  dependency … action: undefined`, the published **definition is corrupt** (published from a raw
  React-Flow graph, not the executable contract). Diagnose in one line and **STOP** — never re-compose
  to rebuild it; the user asked to *run* an existing workflow, not author a new one. The fix is to
  re-publish it correctly (compose_workflow `session_id` or the Workflow Builder). For a correctly
  published first run, discover input node ids via the submit preflight (`workflowId` + `inputs: []` →
  `needs_reattach.rerunAssets.inputs[].nodeId`), NOT from `inspect_run` (which reports `rerunAssets:
  none` for a never-run published workflow). See [`references/diagnostics.md`](references/diagnostics.md).
- **Overriding a 3D-scene node (`input-3d`) via `inputs[]`** — that override is NOT wired on the MCP
  path; the ingestion layer used to silently drop it. `run_workflow_submit` now returns
  `status:"unsupported_override"` (with the `nodeId`/`actionType`) instead — route the user to the
  Workflow Builder for 3D-scene wiring rather than resubmitting. See [`references/diagnostics.md`](references/diagnostics.md).
- **Trusting `resolvedVia` without checking `durabilityCoverage`** — every `rerunAssets` /
  `needs_reattach` envelope now carries `durabilityCoverage: "authoritative" | "warmth-guessed"`.
  `authoritative` (CAS/preset — a real durability map) means the `warm-url` / `durable-storage` /
  `unavailable` verdict is backend-backed; `warmth-guessed` (draft/legacy/native — no durable store
  by design) means it's inferred from URL expiry alone, so a `warm-url` there can go cold without
  warning. Weight your ASK-FIRST re-attach nudges accordingly. See [`references/diagnostics.md`](references/diagnostics.md).
- **Assuming `run_workflow_submit` always prompts before reusing baked assets** — the automatic
  `needs_confirmation` guard fires ONLY on a batch-anchored bare rerun (reusing that specific run's
  frozen assets). A never-run PUBLISHED workflow does NOT auto-prompt either — YOU still owe the
  ASK-FIRST question there. A `getPresetDefinition`-resolved INTERFACE also never auto-prompts, but
  for the opposite reason: its baked defaults are trustworthy, so no ASK-FIRST is owed there at all —
  submit `inputs: []` directly. See [`references/diagnostics.md`](references/diagnostics.md).

## References

- [Workflow Builder API docs](https://developer.adobe.com/firefly-services/docs/workflow-builder/) — [`firefly-api-specs`](../firefly-api-specs/SKILL.md) for direct Firefly REST calls
- On-demand: [`references/`](references/) — featured-and-templates, compose, diagnostics, asset-input, alert-rca
