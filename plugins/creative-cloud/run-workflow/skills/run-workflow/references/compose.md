# Composing workflows — schema injection, multi-variant, missing inputs

Load this when composing a non-trivial workflow, when a user wants multiple output variants, or when
a required input can't be satisfied by upstream outputs.

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
unambiguous (e.g., "remove the background from this image" → `remove-background`).

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

Example (`object-composite-v2` missing placement mask):
> `object-composite-v2` needs a **placement mask** — an image that marks where on the background the
> object should appear. I can't derive this from your current assets. Here are your options:
> - **A) Upload your own mask** (PNG/JPEG, white = placement area)
> - **B) Add `mask-objects`** to detect regions in the generated cafe background automatically
> - **C) Add a custom placement step** to draw a mask at a specific position (tell me where you want
>   the cup — e.g. "center bottom")
>
> Which would you prefer?
