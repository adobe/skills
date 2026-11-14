# Composing workflows — schema injection, multi-variant, missing inputs

Load this when composing a non-trivial workflow, when a user wants multiple output variants, or when
a required input can't be satisfied by upstream outputs.

## Composition is the default

For "create", "build", or "compose", call `compose_workflow` with a natural-language `message`
describing the requested processing and supplied assets. This includes banners at scale,
retargeting, localization, packaging, and creative briefs. Do not first search the featured catalog
or pass `featuredWorkflowName` unless the user explicitly requests a featured/predefined template.
A known use-case name, custom template, or brief is not such a request.

- "Create a banners at scale workflow with attached assets" → compose from scratch.
- "Use the featured Product Banners At Scale template" → `get_featured_workflow`.
- Bare "run banners at scale" → resolve a golden demo via `list_golden_workflows`, not composition.

For a supplied INDD/PSD/Illustrator template (banners at scale / data merge), gather inputs with
[`intake.md`](intake.md) Step 4 — template and CSV are required — then make **one** call:
`compose_workflow(message, customTemplateUrl, customTemplateName, csvUrl, fonts, lightPayload: true)`.
Compose reads the template's tags, validates the CSV against them, and hands the graph agent the
files as evidence; the agent picks the latest eligible merge/rendition versions and does all wiring.
Do **not** pre-call `get_indesign_tags` / `get_psd_tags` / `list_actions` for this. See Flow B in
[`featured-and-templates.md`](featured-and-templates.md).
For an existing graph that needs a template swap, use `current_graph` for deterministic rewiring;
no featured lookup is needed.

## Validate an existing edit without recomposing

Use `compose_workflow` to generate or change a graph, not to validate, explain, or approve an
already-edited graph. If you have already made the requested edit (for example, removed an
unwanted Output node and its edges), call `validate_workflow({ graph: editedMatrixGraph })` or
`validate_workflow({ workflow: editedExecutableWorkflow })` instead. Do not send that graph back
to compose with "keep exactly as is" or "just validate": the graph agent may correctly make no
change and return prose, which compose rejects as "did not produce a graph".

Session-only validation/submission uses the cached graph, not your local edits. Validate the
edited graph inline and, if execution was requested, submit its explicit `actions` and
`connections` with the required inputs. Do not use the original `session_id` alone to run the edit;
retain the template/font bindings and all unaffected wiring from the accepted composition.
Validation checks the graph; it does not update the compose session or authorize execution.

## Writing the compose `message` — intent, not wiring

The graph agent owns node selection and wiring and refuses requests that dictate them incorrectly.
Describe **what the user wants**, in plain language:

- **Do** state: the goal, which attached files play which role, requested output formats
  (native vs JPG/PNG/PDF), any page/size subset the user asked for, fonts supplied, and whether to
  preview only or save/deliver to a named destination.
- **Don't** name node versions (`v1`, `v2`, "legacy", "per-tag"), ports, template tag lists, CSV
  column lists (compose states the attached CSV's headers for you), Parse Data routing, or
  `merge.images` — unless the user explicitly asked for a
  specific version, in which case pass that request through verbatim.
- **Don't** treat an output format as a rename, or add a save/write-files step unless the user
  asked to save or deliver.
- **Don't** claim tags match CSV columns, or paste file contents into the message — attach files
  via `customTemplateUrl` / `csvUrl` / `fonts`; a URL mentioned only in the message isn't attached.
- **Don't** force a named archetype onto a genuinely custom request.

Good: *"Create banners at scale from the attached InDesign template and CSV. One banner set per
row, render every size to PNG and PDF with the attached fonts, preview the outputs."*
Bad: *"Use the legacy per-tag merge-data node with ports Headline, subHead, @background…"*

## Compose errors and refusals — fix the input, don't switch paths

| Result | What to do |
| --- | --- |
| `csv_validation_failed` | Show the `reason` (missing columns, image column without `@`, …). Ask the user to fix the CSV or confirm the mapping; re-compose with the corrected file. Never silently rename columns. |
| `csv_fetch_failed` | The CSV URL couldn't be read — re-upload it and re-compose. |
| `tag_extraction_failed` | The template couldn't be read or has no data-merge tags — tell the user and ask for a corrected template. |
| Graph agent refusal naming missing tags/columns | Show what's missing and ask the user; don't guess a mapping. |
| Graph agent clarification question | Relay it to the user with `ask_user`; compose again with their answer. |
| `fallback: true` / "did not produce a graph" (e.g. "attach the CSV", "CSV headers are unknown") with `customTemplateUrl` + `csvUrl` already attached | Retry **once** with the same attachments and the same intent-only message. Do not add wiring, node names, port lists, or column lists — compose already sends the CSV headers and template tags to the graph agent. If it fails again, tell the user and offer to open it in Workflow Builder. |

Rules: surface the error to the user; re-compose **at most once**, and only after the stated cause
is fixed. A retry keeps the **same message contract** as the first call (intent, not wiring).
Never retry by dropping `customTemplateUrl`/`csvUrl` for a message-only compose, never retry by
asking for a legacy/v1 node, and never retry by spelling out the graph ("input-files → parse-data →
merge-data → …") — all make it worse.

For a supplied 3D scene (`.usdz` / `.glb` — e.g. "composite my product into a living room", "packshots
of this model", "360 spin video"), get a URL for it like any other asset (see
[`asset-input.md`](asset-input.md)) and pass it to `compose_workflow` as `sceneUrl` alongside the
`message`. Compose binds the scene URL to every `input-3d` node (no scene processing at compose time),
so `run_workflow_submit({ session_id })` needs no `inputs[]`. For Composite images (3D), choose the
camera / hero object first — see [`diagnostics.md`](diagnostics.md) → "3D-scene and IBL overrides"
(`describe_scene`, `sceneCamera` / `sceneHeroAsset`).
If no scene file is available, ask for the `.usdz`/`.glb` — not a photo, and not other 3D formats.

## Fonts and saving the executed graph

Supply fonts once to `compose_workflow` as `fonts: [{ presignedUrl, name, storageType }]`.
Submit broadcasts them to V1 merge and InDesign/Photoshop rendition nodes unless those nodes
already have explicit fonts. `defaults.fonts` overrides the session fonts; `useSessionDefaults: false`
opts out. V2 rendition nodes use wired `fonts` ports, not `fontDirectories`.

After submit, `save_workflow({ session_id, batch_id })` saves that accepted execution's editable
graph with the submitted assets, templates, fonts, output destination and connections. Omitting
`batch_id` selects the latest accepted run for the session. Before any run, a session save still
saves the composition. A failed submit does not replace the last accepted snapshot.
Snapshot retention is two hours; a missing/expired exact snapshot must not be replaced by a
new composition. Saving stores input files and Data Merge templates in the draft's ACP folder
(as Workflow Builder does), so they reload after run URLs expire; other asset URLs are kept
as-is. Report any `assetPersistence` failures so the user can re-attach them.
If submit warns that snapshot retention failed, keep its batch ID and surface the warning;
do not run again merely to save.

## Pre-composition schema injection

When you can identify the target action type(s) from the user's request before calling
`compose_workflow`:

1. Call `get_action_schema` for those action types (up to 3).
2. Include the returned `parameters` schema and `usage.commonPatterns` verbatim in your
   `compose_workflow` message under the heading `## Action Parameter Schema`.
3. If the schema shows an array-type output parameter (e.g., `output.renditions[]`,
   `outputConfig.aspectRatios[]`), add an explicit note in the compose message: *"This action
   supports multiple output variants in ONE node via [parameter name] — do not create parallel nodes
   for each variant."*

**When to skip:** simple, single-action workflows where the action type and its parameters are
unambiguous (e.g., "remove the background from this image" → `remove-background`), and template /
CSV data-merge composes (banners at scale) — the graph agent resolves those from the attached files.

## Multi-output / multi-variant pattern

When a user requests multiple output variants from the same step (different aspect ratios, sizes,
formats, locales):

1. Call `get_action_schema` for the relevant action and look for array-type output parameters.
2. **If the schema shows an array-type parameter:** instruct the graph agent to use **ONE node with
   an array** — never parallel nodes. Include in compose message: *"Use a single [actionType] node.
   Put all [N] variants in the [parameter] array."*
3. **If the schema does NOT show an array-type parameter but the action is in the known-multi-output
   list below:** the catalog schema is incomplete. Call `get_workflow_examples([actionType])` to get
   the authoritative parameter format. Include the example's `parameters` JSON block verbatim in your
   compose message: *"Use this exact parameter structure: [paste JSON from example]."* Do not trust
   the flat schema for these actions.

**Known multi-output actions:**
- `video-reframe` → `outputConfig.aspectRatios: string[]` e.g. `["1:1", "9:16", "4:5"]` — schema
  correctly shows this; use schema directly.
- `video-reframe-v2` → `output.renditions: Array<{aspectRatio: {x, y}}>` — **catalog schema is
  incomplete** (only exposes flat `aspectRatio: string`). Always call
  `get_workflow_examples(['video-reframe-v2'])` for multi-ratio requests and include the example JSON
  in the compose message. This is the preferred version over v1.

## Missing required inputs

If a required input for an action cannot be satisfied by any upstream output in the current workflow:

1. Call `list_actions` (or scan catalog knowledge) to identify actions whose outputs match the
   missing input type (e.g., `mask-objects` or `luminosity-mask` produce mask images; `gen-image`
   produces background images).
2. Present the user with a clear choice **and stop**:
   - **Option A — upload**: "You can upload your own `<input name>` (`<accepted MIME types>`) and
     I'll wire it in."
   - **Option B — generate**: list the candidate actions that can produce the missing input, with a
     one-line description of each.
3. **Do not proceed until the user explicitly responds.** None of the following are permitted without
   user confirmation:
   - Substituting a simpler action (e.g. `blend` instead of `object-composite-v2`)
   - Auto-generating or synthesizing the missing input yourself (e.g. creating a white mask image,
     generating a placeholder, or scripting a workaround)
   - Making any assumption about where/how to place the object
4. Once the user chooses, call `compose_workflow` again with updated natural-language instructions
   that incorporate either the uploaded asset URL or the additional generation step.

## Response payload size — `lightPayload`

`compose_workflow` returns the full `matrix_graph` (a ReactFlow node graph with per-node catalog
data) by default. It is large and slow to tokenize, and `run_workflow_submit` never needs it — it
only needs the lean `workflow` (actions + connections), `session_id`, and `next_step`, all of which
are always returned.

- **Single-template composes → pass `lightPayload: true`.** This drops `matrix_graph` from the
  response and cuts latency. The full graph is still cached server-side; retrieve it any time with
  `resolve_workflow_session(session_id)` (e.g. to store `workflow.json` for UI import).
- **Chaining composes → omit `lightPayload` (or set `false`).** When you feed one compose response's
  `matrix_graph` back as `current_graph` into a subsequent `compose_workflow` call (multi-template
  rewire), that path reads `matrix_graph` inline, so it must stay in the response.

When `lightPayload: true`, the response replaces `matrix_graph` with `matrix_graph_omitted: true` and
a hint pointing at `resolve_workflow_session`.

### Lean the other tools too — `list_featured_workflows` and `validate_workflow`

The same "don't tokenize what you won't read" principle applies before compose and before submit:

- **`list_featured_workflows(lightPayload: true)`** — omits the heavyweight `workflowGraph` from every
  entry while keeping `classifierDescription`, `featuredWorkflowId`, `featuredVersion`, `name`,
  `requiredInputs`, and `templateType`. That's everything you need to pick a workflow; `compose_workflow`
  re-resolves the graph server-side by id, so it never reads `workflowGraph`. Use it whenever you only
  need to choose a workflow **and the user explicitly asked to browse/use featured templates**.
  Do not call it as a default pre-composition or brief-classification step.
- **`validate_workflow(session_id: …)`** — validate the workflow cached by `compose_workflow` without
  re-emitting the graph as tool arguments. Pass the compose `session_id` alone (no `workflow`/`graph`).
  This is the preferred lean form **only when the graph is unchanged**. After a local edit, pass
  the edited `workflow` or `graph` instead; session-only validation checks the old cached graph.
  Note that on the deterministic custom-template path `compose_workflow`
  already validates and auto-corrects internally, so a separate `validate_workflow` is usually redundant.

## Validation errors from `compose_workflow`

If `compose_workflow` returns validation errors on a general (non-template) compose, call
`get_workflow_examples` for the relevant action types, then retry with updated constraints. Cap
retries at 1; if still invalid, show the user the errors and ask how to proceed. For template/CSV
errors, use the table above instead.

Example (`object-composite-v2` missing placement mask):
> `object-composite-v2` needs a **placement mask** — an image that marks where on the background the
> object should appear. I can't derive this from your current assets. Here are your options:
> - **A) Upload your own mask** (PNG/JPEG, white = placement area)
> - **B) Add `mask-objects`** to detect regions in the generated cafe background automatically
> - **C) Add a custom placement step** to draw a mask at a specific position (tell me where you want
>   the cup — e.g. "center bottom")
>
> Which would you prefer?
