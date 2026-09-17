# Featured workflows & custom INDD templates

Load this when the user names a featured workflow (retargeting, localization, banner advertising,
packaging, product banners at scale, etc.) or supplies a custom `.indd` template to rewire.

## Featured workflow routing

When the user asks to run a named workflow, ALWAYS call `get_featured_workflow` first. If found:

1. Present workflow details and confirm with the user.
2. Ask about templates if not already specified (defaults vs custom `.indd` files).
3. Ask about product images if not provided.
4. **Ask about fonts** — if the user has custom fonts (`.otf`, `.ttf`), upload via `upload_asset`
   and pass them in `defaults: { fonts: [{ presignedUrl, name, storageType }] }` on
   `run_workflow_submit`. The server broadcasts them to all merge-data **and create-rendition**
   nodes automatically (both call the InDesign API, so both need fonts to render custom-font text) —
   no need to repeat on each node. If no custom fonts, omit `defaults` (the InDesign API will use
   system/embedded fonts).
5. **Prompt only for missing workflow inputs** — same rule as any composed workflow. Before submit,
   check each required input node: if it has no user value and no featured default, ask the user.

**Multiple matches returned:** If `get_featured_workflow` returns more than one match, the
`prepared` field will be absent. **Always ask the user which workflow they meant** — present the
list of matched names and let them pick. Once the user confirms, retry `get_featured_workflow` with
the **exact workflow name** to get the `prepared` data. **Never guess which workflow the user
intended, and never fall back to `compose_workflow`** for a workflow that already exists as a
featured workflow.

**Merge-data ports vs other input-text nodes:** Only InDesign tags from `get_indesign_tags` that
become **merge-data ports** need user-facing text or image inputs. Featured workflows such as
retargeting also have `input-text` nodes wired to **non-merge** actions (e.g. `gen-object-composite`
scene prompts) with pre-filled defaults in `prepared.inputs` — keep those unless the user explicitly
asks to change scene generation. When the user says "all text fields", override only merge-port tags
(`heading`, `sub-heading`, etc.), not scene prompts.

**Defaults (fast path):** If the user wants default templates **and** default text, submit directly
via `run_workflow_submit` using the `session_id` from `prepared` — do NOT call `compose_workflow`.
Use `useSessionDefaults: true` so text and template inputs fall back to cached defaults. Only send
the `inputs[]` entries you need to override (typically just the `input-images` node with the user's
uploaded URLs). For custom fonts, use `defaults: { fonts: [...] }` instead of repeating fonts on
every merge-data entry.

### Large workflow handling (15+ actions)

When `get_featured_workflow` returns a `session_id` in `prepared`, use `useSessionDefaults: true`
and `defaults: { fonts: [...] }` to minimize the payload:

1. Upload the user's images and fonts via `upload_asset`.
2. Call `run_workflow_submit` with:
   - `session_id` from `prepared`
   - `useSessionDefaults: true` — all text nodes and merge-data templates fall back to cached defaults
   - `defaults: { fonts: [{ presignedUrl, name, storageType }, ...] }` — broadcast to all merge-data and create-rendition nodes
   - `inputs: [{ node_id: "<input-images-id>", content: [{ type: "image", url: "..." }] }]` — only the overridden entries

This replaces the previous approach of sending all 25+ input entries with duplicated font/template
URLs. The server merges caller inputs on top of session defaults and broadcasts `defaults.fonts` to
all merge-data and create-rendition nodes.

Do NOT read or echo the full `prepared.actions`/`connections` arrays — they are resolved server-side
from the `session_id`.

## Custom template handling — Flow A: featured workflow + custom INDD

When the user provides custom `.indd` templates instead of using defaults, use these deterministic
tools — do **not** hand-roll the tag diff or write the wiring instructions yourself.

**Preferred fast path (deterministic, no LLM agent):** Call `compose_workflow` with
`featuredWorkflowName` + `customTemplateUrl` (and `mergeNodeId` if the base has more than one merge
node). This runs the deterministic rewire server-side — it diffs tags, checks feasibility, re-wires
the merge node, and (for CSV/parse-data-driven bases like *Product Banners at Scale v2*) wires the
CSV columns through `parse-data` automatically. The result has `deterministic: true` and returns
near-instantly. **Do this instead of the manual `plan_template_rewire` → `compose_workflow(message=…)`
chain below whenever you are rewiring a known featured base.** Reserve the message-driven
`compose_workflow` (LLM graph agent) for genuinely new graphs — it can take up to ~2 min and may
exceed the MCP client request timeout (`-32001`).

> **Session defaults include the custom template.** After the rewire returns, the cached session
> stores the custom INDD URL as a `preparedInputs` default for the merge-data node — so
> `run_workflow_submit(session_id, useSessionDefaults: true)` does NOT need an explicit `template`
> entry in `inputs[]`. Only send `inputs[]` entries that override session defaults (e.g. the
> input-images nodes with the user's uploaded URLs). Use `defaults: { fonts: [...] }` for custom
> fonts as usual.

> **Multi-image-port rewires return `imageSources`.** When the rewire creates more than one
> `input-images` source (e.g. a custom template with `background` + `background-wide` image tags),
> the response carries `imageSources: [{ nodeId, mergePort, csvColumn? }, …]`. **When
> `imageSources.length > 1`, do NOT guess image-to-port mapping from filename tails** — present the
> user with a numbered list of `(image, mergePort, csvColumn)` pairs and ask which uploaded image
> goes to which port. The transcript bug we want to avoid: silently assigning images to ports by
> filename heuristic and producing the wrong banner.

> **CSV / parse-data-driven featured workflows (e.g. v2):** the merge node's text and images come
> from CSV columns via a `parse-data` node, NOT from `input-text`/`input-images` sources. The
> deterministic rewire detects this and re-wires the parse-data columns (one media input port per
> `@image` column). Do NOT synthesize `input-text` nodes for these — that strands the CSV and loses
> per-row variation. If you must drive it through the message-based agent, give it the CSV column
> names explicitly.

The manual steps below remain valid (e.g. when you need to inspect feasibility first, or to operate
on an arbitrary `current_graph`):

**Step 1 — Extract tags.** Call `get_indesign_tags` on each custom template.

**Step 2 — Check for identical tags.** Compare custom tags to `get_featured_workflow` →
`prepared.mergeNodes[n].tags` for the matching merge node.

- **Identical tags** → swap template URLs only in `prepared.inputs`. No graph changes needed — skip
  to Step 5.
- **Different tags** → continue to Step 3.

**Step 3 — Plan the rewire.** Call `plan_template_rewire`:

```
plan_template_rewire(
  defaultTags   = prepared.mergeNodes[n].tags,
  customTags    = <tags from get_indesign_tags>,
  currentGraph  = prepared.matrixGraph  (or the matrix_graph from compose_workflow),
  mergeNodeId   = prepared.mergeNodes[n].nodeId,
  customTemplateUrl = <custom template presigned URL>
)
```

- If `feasible === false` → stop and ask the user:

  > Your custom template removes the `background` image port, which the retargeting workflow's
  > compositing pipeline feeds into. Without it the workflow can't produce a merged output.
  >
  > - **A)** Use the default templates instead
  > - **B)** Provide a different custom template that includes a `background` image port
  > - **C)** Build an entirely new workflow from scratch for your template
  >
  > Which would you prefer?

  Do NOT proceed, auto-fix, or silently drop pipeline nodes.

- If `feasible === true` → proceed to Step 4 using the returned `prompt`, `constraints`, and
  `currentGraph`.

**Step 4 — Re-wire via compose.** Call `compose_workflow` using the plan output directly:

```
compose_workflow(
  current_graph = <plan_template_rewire result: currentGraph>,
  message       = <plan_template_rewire result: prompt>,
  constraints   = <plan_template_rewire result: constraints>
)
```

The plan already contains explicit REMOVE/ADD/UPDATE/KEEP instructions and guards that prevent the
image pipeline from being broken — do not paraphrase or override them.

**Step 4b — Validate.** Call `validate_workflow` with the `matrix_graph` from `compose_workflow`:

```
validate_workflow(graph = <compose_workflow result: matrix_graph>)
```

- If `valid === false` → retry `compose_workflow` once, appending the errors to `constraints` (the
  errors describe exactly what to fix). Cap at 1 retry.
- If still invalid after retry → show the user the validation errors and ask how they want to
  proceed. Do not submit a broken workflow.

**Step 5 — Show the updated graph.** Present the workflow to the user in a visual format (not raw
JSON). Use a table or indented list:

```
Retargeting workflow (custom templates)

  [Input Images] ─── product photo(s)
       │
  [Remove Background]
       │
  ┌────┴────┐
  │         │
  [Gen Composite 1080]   [Gen Composite 300×600]
  (scene: night landscape) (scene: blue sky)
       │                        │
  [Crop 1080×1080]         [Crop 300×600]
       │                        │
  [Apply Edits]            [Apply Edits]
       │                        │
  [Merge Data 1080]        [Merge Data 300×600]
  ├─ background (image) ← from pipeline
  ├─ heading (text) ← "?"
  ├─ sub-heading (text) ← "?"
  └─ header (text) ← "?" [NEW]
       │                        │
  [Preview 1080]           [Preview 300×600]
```

Mark any newly added ports with `[NEW]`. Mark any ports with no value as `← "?"`.

**Step 6 — Prompt for missing inputs.** After showing the graph, ask the user for values for every
merge-port `input-text` or `input-images` node that has no value and no featured default.
Scene-generation prompts (wired to `gen-object-composite` etc.) keep their defaults — do not ask
unless the user explicitly wants to change them.

Only after the user provides all missing values, proceed to `run_workflow_submit`.

## Custom INDD workflow — Flow B: user supplies their own template, no featured base

When the user wants to build a workflow around an InDesign template they provide — **not** starting
from a featured workflow — always call `get_indesign_tags` first. The graph agent cannot guess
merge-data port names without them.

**Step 1 — Extract tags.**

```
get_indesign_tags(templateUrl = <user's .indd presigned URL>)
```

Returns `[{ name: "background", type: "image" }, { name: "headline", type: "text" }, ...]`.

**Step 2 — Compose with explicit tag context.** Embed the tag list in the compose message so the
agent wires all ports correctly:

```
compose_workflow(
  message = "Create a merge-data workflow. The InDesign template has these tags:
             <tag list with types, e.g. 'background [image], headline [text], logo [image]'>.
             Wire: input-images → merge.<imageTagName> for each image tag;
                   input-text → merge.<textTagName> for each text tag.
             Template URL: <url>."
)
```

**Step 3 — Validate.**

```
validate_workflow(graph = <compose_workflow result: matrix_graph>)
```

Retry once on failure (same as Flow A, Step 4b).

**Step 4** — Show graph, collect inputs, `run_workflow_submit`.

## Node selection: `merge-data` vs `merge-data-v2`

| Scenario | Use | Why |
|----------|-----|-----|
| Featured workflow (re-wiring) | `merge-data` — same node as in the original featured workflow | `plan_template_rewire` targets the existing node by ID; node type never changes |
| Custom workflow, INDD only (Flow B) | `merge-data` with tags from `get_indesign_tags` | Production-available; dynamic ports wired using discovered tag names |
| Custom workflow, INDD + CSV (dev mode only) | `merge-data-v2` (fixed `template`/`data` ports) | Only when `RW_IN_DEVELOPMENT=true`; no per-tag wiring needed |

**`parse-data` output ports are dynamic** — one output port per CSV column, named after the
slugified column header (e.g. `Product Name` → `product_name`). The agent cannot wire them without
knowing the column names. When the user's workflow involves `parse-data`, ask them for their CSV
column names and include those names explicitly in the `compose_workflow` message.

## Featured-workflow anti-patterns

- **Calling `compose_workflow` when tags are identical** — if `get_indesign_tags` returns the same
  tags as the featured workflow's merge nodes, only swap the template URLs. There is nothing to
  re-wire.
- **Skipping input prompts** — never use default text values from `prepared.inputs` for user-facing
  merge-data ports (heading, sub-heading, etc.) without confirming with the user.
- **Placing fonts directly on `actions[].parameters.fontDirectories`** — fonts must be passed via
  `defaults: { fonts: [...] }` on `run_workflow_submit` (preferred, broadcasts to all merge-data
  and create-rendition nodes) or via `inputs[].fonts` on individual merge-data input entries
  (per-node override). The `mergeInputsIntoActions` function converts these into the correct format
  the backend expects.
- **Wiring fonts only to the merge-data node in an InDesign workflow** — if the graph has a
  `create-rendition` step (it re-rasterizes the merged INDD in a separate InDesign call), fonts must
  reach it too or the rendered banner falls back to default fonts. `defaults: { fonts: [...] }`
  covers both automatically; don't font the merge node alone.
- **Repeating font URLs on every merge-data input entry** — use `defaults: { fonts: [...] }`; the
  server broadcasts to all merge-data and create-rendition nodes that lack per-node fonts.
- **Sending all input entries when defaults are fine** — with a `session_id`, set
  `useSessionDefaults: true` and only send the `inputs[]` entries that need overriding.
- **Re-reading large `get_featured_workflow` responses chunk by chunk** — when `prepared.session_id`
  is present, you never need the full `actions`/`connections`. When it is absent (older server),
  write a script to modify `inputs` from the tool output file rather than reading 50-100KB of JSON.
