# Featured workflows & custom INDD/PSD/MOGRT templates

Load this when the user explicitly requests a featured/predefined workflow or supplies a custom
INDD/PSD/MOGRT template to compose around or rewire. A use-case name alone does not select a
featured workflow. For creative-brief intake with a narrower scope, see [`intake.md`](intake.md) — it covers product
banners at scale only.

> **Featured ≠ golden.** Featured workflows are agent-facing cookie-cutter TEMPLATES to build upon
> (via `get_featured_workflow` → `compose_workflow`/rewire). They are NOT the path for a bare
> user-facing "run `<use case>`" request ("run banners at scale", "run product assets", "run social
> video adaptation"/"run SVA") — those are GOLDEN runs, resolved via `list_golden_workflows` (see
> [`diagnostics.md`](diagnostics.md) → "Running a golden demo by name"). Use this featured path only
> when the user EXPLICITLY asks for a featured/predefined template. New workflows, including those
> with custom templates or creative briefs, default to composition from scratch (Flow B).
> Existing-graph template swaps use `current_graph`, not an unsolicited featured base.

## Featured workflow routing

**Known workflows** (use `get_featured_workflow` to discover — these are slugs/keywords, not exact query strings):

| Slug / keyword | Use case |
|---|---|
| `product-banners-at-scale` | Product banners from a CSV data merge |
| `retargeting` | Retargeting ads |
| `localization` | Localization |
| `generic-banner-advertising` | Generic banners |
| `contextual-or-native-advertising` | Native ads |
| `catalogs-and-circulars` | Catalogs |
| `promotional-pricing-or-discounting` | Pricing promos |
| `packaging-variants-2d` | Packaging |
| `standardized-packshots-2d` / `3d` | Packshots |
| `refreshed-product-imagery-2d` | Product imagery refresh |
| `composite-imagery-3d` | 3D composite |
| `3d-spin-video` | 360 spin video |

Only when the user explicitly asks to look up/use a featured or predefined workflow/template,
call `get_featured_workflow`. Do not infer this from "create banners at scale", "build retargeting",
an attached template, or a brief. If found:

1. Present workflow details and confirm with the user.
2. Ask about templates if not already specified (defaults vs custom `.indd` files).
3. Ask about product images if not provided.
4. **Ask about fonts** — if the user has custom fonts (`.otf`, `.ttf`), upload via `upload_asset`
   and pass them ONCE as the `fonts` field on `get_featured_workflow` (or `compose_workflow`):
   `fonts: [{ presignedUrl, name, storageType }]`. They are cached with the session and broadcast
   automatically on submit — do NOT re-send `defaults.fonts` on `run_workflow_submit`. Pass
   `defaults.fonts` on submit only to override the captured fonts. Omit entirely if no custom fonts.
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
Use `useSessionDefaults: true` so text and template inputs fall back to cached defaults.

Three distinct asset types route to three distinct `inputs[]` nodes — never collapse them onto one:

| Asset type | Node | How to pass |
|---|---|---|
| Product images | `input-images` node (`type: "image"` in `prepared.inputNodes`) | `inputs[]: { node_id, content: [{ type: "image", url, name: "<clean original filename>" }] }` |
| Custom fonts | _(not an input node)_ | Pass `fonts: [{ presignedUrl, name, storageType }]` ONCE to `get_featured_workflow`/`compose_workflow`; cached with the session and broadcast to all merge-data + create-rendition nodes automatically on submit. Use `defaults: { fonts: [...] }` on submit only to override. |
| User-supplied CSV | `input-files` node (`type: "file"` in `prepared.inputNodes`) | `inputs[]: { node_id, content: [{ url, mimeType: "text/csv" }] }` |

**Image `name` is required for CSV `@image` matching.** Each `input-images` content entry must
carry `name` set to the **unmodified original filename** exactly as it appears in the CSV's `@image`
cell (e.g. `01_PRIMARY_moonwalker_BF25_ExpressiveA_1060x1180.png`). The runtime resolves each `@`-cell
to its wired asset by **basename** (`csvFanout.mergeCsvMediaIntoCellOutputs`). If you omit `name`, the
server re-derives a UUID-suffixed name (`…-4a54384e.png`), the basename no longer matches the CSV cell,
and per-row image merge silently binds the wrong image or drops it.

**CSV default behavior:** if `prepared.inputNodes` includes an `input-files` node but the user hasn't provided a CSV, omit that entry — the workflow's baked sample CSV flows through `parse-data` automatically. Only add the `input-files` entry when the user supplies their own CSV.

Only send `inputs[]` entries for nodes you need to override. For custom fonts, pass them once to `get_featured_workflow`/`compose_workflow` (`fonts: [...]`) so they are cached and broadcast automatically — repeating font URLs on each merge-data entry, or re-sending `defaults.fonts` every run, is wrong.

Do NOT read or echo the full `prepared.actions`/`connections` arrays — they are resolved server-side
from the `session_id`.

## Custom template handling — Flow A: featured workflow + custom INDD or PSD

When the user explicitly selects a featured base and provides custom `.indd` or `.psd` templates
instead of using its defaults (or swaps a template on an existing Matrix graph), use the
deterministic fast path — do **not** hand-roll the tag diff or write the wiring instructions
yourself.

**Fast path (deterministic, always preferred):** Call `compose_workflow` with `customTemplateUrl`
(or `filePath`) plus one of:
- `featuredWorkflowName` — rewire an explicitly requested featured base (e.g. "product banners at scale")
- `current_graph` — rewire an authoritative Matrix (`nodes`/`edges`) graph you already have (e.g. a
  draft or a Builder-published `ui.json` sidecar); execution-format graphs are not rewireable

> **For a swap, one of `featuredWorkflowName` / `current_graph` is REQUIRED.** A bare
> `customTemplateUrl` without a base or message returns `no_base_graph`. For a new workflow,
> pass a message and follow Flow B instead of selecting a featured base.
> For a saved/draft/published workflow, get `current_graph` from `run_workflow_submit` →
> `status: "needs_rewire"` → `currentGraph` (see the backstop note below); never send a bare
> `customTemplateUrl` and discard the existing graph when the user requested a swap.

Add `mergeNodeId` when the base has more than one merge node. **If the user has provided a CSV,
always pass it — inline as `csvData`, or by reference as `csvUrl` (a presigned/public URL the
server fetches and reads; prefer this for large or multi-line files). If both are given, `csvUrl`
wins.** This is the *only* input that controls parse-data vs. direct-wire
routing for `@image` columns: a full column routes through parse-data (per-row images from the
CSV); an empty column is left UNWIRED (no image is supplied for that tag). A **partially-filled**
image column (some rows name a file, some are blank) is valid: compose returns a warning (not
`csv_validation_failed`) and wires it exactly like a full one (through parse-data); the blank rows
render without that image (InDesign: empty field; Photoshop: the template's placeholder smart
object stays; MOGRT: the `.mogrt` default). An image node between parse-data and the merge (e.g.
`remove-background`, crop, upscale) is skipped for the blank rows rather than failing.
For a multi-template CSV with a `Template` (Template Match) column (FFENT-20222), column fill is
evaluated **per template**: an image column may be filled only for the rows routed to templates that
bind that tag and left blank for the others — fill is read within each template's routed rows,
not across the whole CSV (a blank `Template` cell routes to every template).
Without `csvData`, the server falls back to
direct-wiring ALL image ports regardless of what the CSV contains — causing item-count mismatches
at runtime when text ports emit N rows but the image port only receives the number of uploaded
input images.

> **`csvUrl`/`csvData` at compose is routing-only — it does NOT wire the CSV into the graph.**
> Compose uses it solely to decide parse-data-vs-direct-wire routing; it is not baked into the
> `input-files` node and is not cached as a session default. You must still pass the CSV in
> `run_workflow_submit.inputs` to the `input-files` node (`mimeType: "text/csv"`), or the run fails
> with `[parse-data] no CSV wired to input-file port`. Compose→submit is two steps for the CSV, not
> one — the compose result's `next_step.required_inputs` names the exact `input-files` node_id to pass.

The server auto-detects INDD vs PSD by file extension (`.psd` → PSD tag extraction;
anything else → InDesign tag extraction) and fetches tags internally. **Do not call
`get_indesign_tags` or `get_psd_tags` standalone _before_ this call to drive wiring** —
`compose_workflow` fetches and compares tags server-side; there is no `customTags` input. The result
has `deterministic: true` and returns near-instantly. No separate `validate_workflow` call is needed —
structural validation backstops are included in the deterministic path.

> **Backstop for a bare rerun that skips compose.** If a new `.indd`/`.psd` template reaches
> `run_workflow_submit` as an `inputs[].template` on a `merge-data`/`data-merge-psd` node **without** a
> composed `session_id`, the submit guard describes it and **diffs its tags against the merge node's
> current ports** (see `references/diagnostics.md`, "Rerun with a NEW template"). A tag diff — not the
> URL — decides: an **empty diff runs as-is** (matching template, no compose needed); a **non-empty
> diff returns `needs_rewire`** with the concrete `diff`, and you route it back through this Flow A
> compose path. When the source has no authoritative Matrix graph, a mismatch returns
> `no_editable_graph` (edit in Builder). This backstop means a mismatched template can never silently
> run into the wrong ports (the InDesign 107013 failure), but the deterministic compose path above is
> still the preferred first move for a known custom-template job.

**Concrete call (custom INDD + user CSV):**

```
compose_workflow(
  customTemplateUrl   = "<presigned INDD URL from upload_asset>",
  featuredWorkflowName = "product banners at scale",
  mergeNodeId         = "<merge node id — only when the base has >1 merge node>",
  csvData             = "<full raw CSV text, headers + all rows, unchanged>"
  # ...or, instead of csvData: csvUrl = "<presigned/public CSV URL the server fetches>"
)
```

Parameter casing is exact: `customTemplateUrl`, `featuredWorkflowName`, `mergeNodeId`, `csvData`,
`csvUrl` (all camelCase). `csvData` is **raw CSV text**; `csvUrl` is a **presigned/public URL** to
the CSV (server fetches and reads it) — pass one or the other, `csvUrl` wins if both are set. Use
`filePath` instead of `customTemplateUrl` only when the template is a local path you haven't uploaded.

### Pre-flight tag ↔ CSV coverage check (custom template **and** CSV) — do this before submit

**Why CSV header case does *not* matter, and what actually causes 107013.** The InDesign data-source
column header InDesign sees at merge time is derived from the **merge-data input port name** (the edge
`targetHandle`), *not* from your CSV header text and *not* from the slugified `parse-data` port. The CSV
header is consumed by `parse-data` (which lowercases it to a slug) and then discarded; `merge-data`
rebuilds a synthetic data source whose header equals the merge port name, verbatim
(`mergeDataHandler.ts` derives the header from `outputPort`, not `metadata.column`). InDesign matches
that header against the template placeholder **case-sensitively**. So:

- **Rewriting or re-casing the CSV header fixes nothing** — the text is thrown away.
- 107013 happens when the **merge-data port** is cased differently from the template placeholder — e.g.
  the port is `headline` but the placeholder is `Headline`. The deterministic
  `compose_workflow(customTemplateUrl=…)` path binds each merge port to the template tag's **exact**
  case (`applyRewirePlan` sets `targetHandle = tag.name`), so a graph built that way matches and
  succeeds. The failure mode is a graph where the port kept its old lower-case name — see the callout
  below.

This means the only useful pre-flight is a **coverage** check (mirroring ffcp's `coverage_gaps`), run
**after `compose_workflow`, before `run_workflow_submit`**. It is **optional and best-effort**: it reads
the CSV header row, so if you can't read the CSV in-sandbox (egress block, presigned-only URL), **skip
it** — pass the CSV as `csvUrl` and rely on the server's `validateCsvForRewire`, which runs the same
coverage check and returns a structured `csv_validation_failed` / `csv_fetch_failed`. Never ask the user
to paste the CSV just to run this local check.

1. Call `get_indesign_tags(templateUrl=<custom INDD URL>)` (or `get_psd_tags` for `.psd`). This
   returns `[{ name, type }, …]`. **This is the one sanctioned validation-only use of these tools on
   the featured path** — it does not drive wiring (`compose_workflow` already did that).
2. Diff the tag names against the CSV header row **case-insensitively** (lowercase both sides and strip
   a leading `@` before comparing):
   - Every `type: "text"` tag must have a CSV column with the same name ignoring case.
   - Every `type: "image"` tag `X` must have a CSV column named `@X` — the **`@` is mandatory** for
     image columns (the runtime treats a bare `X` as text); the rest of the name is compared ignoring
     case.
3. Stop and report **only** a genuine coverage gap — a template tag with **no** CSV column at all, or an
   image tag whose column is **missing its `@`**. Do **not** flag a pure case difference
   (`Headline` vs `headline`) — the deterministic rewire already reconciles case via the port name, and
   editing the CSV header would not change the data-source header anyway.

The run-workflow MCP's server-side `validateCsvForRewire` remains authoritative; this pre-flight is a
local backstop so you don't burn a long merge to discover a missing column or a missing `@`.

> **Always rewire a custom template through the deterministic `customTemplateUrl` path.** The
> product-banners-at-scale **v1** base graph ships a **lower-case `headline` merge port** (alongside
> `CTA`, `subcopy`, `image`). The deterministic rewire matches tags case-sensitively (`computeTagDiff`
> uses `===`) and **always** mints each merge port from the custom tag's exact name — it removes the
> base `headline` and adds `Headline`, so even a template that differs from the base only in letter-case
> comes out correctly cased. The lower-case base port only survives — and 107013 only results — if you
> instead rewire through the **`message`/LLM path** or **hand-edit** the ports. So always call
> `compose_workflow` with `customTemplateUrl` (never drive the wiring through `message`), and never
> hand-edit or lower-case the merge ports.

> **`message` does not control routing.** The deterministic rewire path ignores the `message`
> parameter for wiring decisions. If a first recompose produced the wrong routing (e.g. direct-wire
> instead of parse-data), do NOT retry with a different `message` — pass `csvData` and recompose.

> **Session defaults include the custom template — and it now applies automatically.** After the
> rewire returns, the cached session stores the custom INDD URL as a `preparedInputs` default for the
> merge-data node. On a `session_id` submit **the cached template is applied automatically** — you no
> longer need `useSessionDefaults: true` just to get the template (the composed template is
> definitionally required, so the submit path always injects it unless you explicitly set
> `useSessionDefaults: false`). **Still pass `useSessionDefaults: true`** so the broader non-template
> session defaults — cached text fills and source-node overrides — are also applied; omitting it leaves
> those unset. Be ready to re-attach the template if its presigned URL has expired (see below).
> Use node IDs from `prepared.inputNodes` (the
> `get_featured_workflow` result) for all `inputs[]` entries — they are preserved through the rewire.
> Pass:
> - Product images → `input-images` node (as above, with `name`)
> - User CSV → `input-files` node with `mimeType: "text/csv"` **— required if the user provided a
>   CSV; without it `parse-data` uses the baked sample CSV and InDesign error 107013 results**
> - Fonts → pass once as the `fonts` field on the `compose_workflow` rewire call; they are cached
>   with the session and broadcast automatically on submit (not an input node). Only pass
>   `defaults: { fonts: [...] }` on submit to override them.
>
> **The cached presigned template URL can expire (~1h).** If a run fails with *"requires at least one
> template file"* even with `useSessionDefaults: true`, or with an InDesign open/script error (the
> template loaded but couldn't be read), re-upload the template with `upload_asset` and attach it
> explicitly to the merge-data node: `inputs[]: { node_id: <merge-data node id>, template: {
> presignedUrl, name, storageType } }`. This is the documented recovery — do not just resubmit the
> same graph. (This recovery re-attaches the SAME template within an active session, so the wiring
> already matches — it passes the submit guard below.)
>
> **A NEW/different template on a BARE rerun must go back through compose — and only when an
> authoritative Matrix graph exists.** Attaching `inputs[].template` to a `merge-data`/`data-merge-psd`
> node **without** a `session_id`/`useSessionDefaults` triggers a rewire, which runs **only on a Matrix
> (`nodes`/`edges`) graph** — the rewire engine never reverse-converts an execution graph. If the
> source has a Matrix graph (a Workflow Builder draft or a Builder-published `ui.json` sidecar,
> surfaced as `uiGraph`), `run_workflow_submit` → `status: "needs_rewire"` carries that **Matrix** graph
> as `currentGraph`; recompose it: `compose_workflow({ current_graph, customTemplateUrl, csvData })` →
> submit with the returned `session_id` (a `csv_validation_failed` there means the CSV doesn't cover the
> new template's tags — surface it and stop). If the source has **no** Matrix graph (a native no-matrix
> publish, a preset/interface, or a raw batch run), `run_workflow_submit` → `status:
> "no_editable_graph"`: a template change isn't rewireable there — tell the user to change the template
> in the Workflow Builder (which produces an editable Matrix graph) or rerun without a template change.
> `compose_workflow.current_graph` accepts **only** a Matrix graph.
>
> **The template is read only from `parameters.templates` (or the `inputs[].template` port that
> produces it).** `workflowTemplateUrl`, `templateUrl`, and `indesignTemplateUrl` are graph
> **node-data authoring fields** and are **never read when the action runs** — adding any of them to a
> merge-data node's `parameters` does *not* supply a template, and the run still fails with *"requires
> at least one template file."* If you must attach a template inline (no session), use the
> `inputs[].template` shape above; do not guess a `*TemplateUrl` parameter name.

> **`create_preset`/`publish_workflow` now bake a rewired session's template durably.** When you build
> a preset or publish from a `session_id` whose merge node was rewired to a `customTemplateUrl`, the
> composed template lives only in the session's cached `preparedInputs` (the flattened executable graph
> strips it — see the `customTemplateUrl` note above). Both tools now lift that cached template onto the
> published merge node's `parameters.templates[].url` before publishing, so the backend's durable-asset
> extractor persists it and every later preset rerun re-mints it from the stored definition. You no
> longer see *"merge-data requires at least one template file"* on a preset rerun of a rewired session.
> The baking runs on a clone — the cached session action is untouched — and it never resurrects
> `workflowTemplateUrl`/`templateUrl` as a source (those stay authoring-only). If neither a session
> template nor an explicit `parameters.templates[]` is present, publish still surfaces the empty slot
> rather than shipping a preset that can't run.

> **After a re-wired run completes, offer to persist it (`postRun`).** When `run_workflow_submit`
> executes a graph from a composed/rewired `session_id`, the `submitted` result carries a `postRun`
> block: `{ rewired: true, sessionId, options: ["save_workflow", "publish_workflow",
> "create_preset"] }`. Once `run_workflow_get_status` reaches `completed`, offer those three so the new
> wiring isn't lost — **save the draft** (`save_workflow`), **re-publish** (`publish_workflow`),
> or **update/create a preset** (`create_preset`), all keyed off `postRun.sessionId`. This is what
> prompts the user to keep a rewired custom-template workflow. `postRun` is scoped to a
> `compose_workflow` (rewire/compose) session only: a plain input-swap rerun and a plain
> `get_featured_workflow` run of a featured base (no customization — its `feat-` session never rewires)
> carry **no** `postRun` block, so don't prompt to persist there (the general "next steps" offer already
> covers saving an uncustomized featured run).

> **Multi-image-port rewires return `imageSources`.** When the rewire creates more than one
> `input-images` source (e.g. a custom template with `background` + `background-wide` image tags),
> the response carries `imageSources: [{ nodeId, mergePort, csvColumn? }, …]`. **When
> `imageSources.length > 1`, do NOT guess image-to-port mapping from filename tails** — present the
> user with a numbered list of `(image, mergePort, csvColumn)` pairs and ask which uploaded image
> goes to which port. The failure mode to avoid: silently assigning images to ports by
> filename heuristic and producing the wrong banner.

> **CSV / parse-data-driven featured workflows (e.g. Product Banners at Scale v2 — featured-workflow version, distinct from the `merge-data-v2` node type):** the merge node's text and images come
> from CSV columns via a `parse-data` node, NOT from `input-text`/`input-images` sources. The
> deterministic rewire detects this and re-wires the parse-data columns (one media input port per
> `@image` column). Do NOT synthesize `input-text` nodes for these — that strands the CSV and loses
> per-row variation. If you must drive it through the message-based agent, give it the CSV column
> names explicitly.
>
> **Use the CSV as-is — never rewrite `@image` filenames into presigned URLs.** The `@`-prefixed
> image columns hold **filenames** that reference uploaded product images. The runtime resolves each
> `@`-cell to the correct wired asset by basename (`csvFanout.mergeCsvMediaIntoCellOutputs`). If the
> user has provided a CSV with filled `@image` columns, submit it **unchanged**. Presigned-URL
> substitution defeats filename matching and the URLs expire (~1h). Empty `@image` columns
> are left UNWIRED — no image is supplied for that tag (deterministic — already handled); a
> partially-filled image column is valid — its blank rows simply get no image — so submit that
> CSV unchanged too. Only revisit
> the CSV if a run fails **and** the diagnosis specifically points to a filename↔asset mismatch — and
> only after telling the user what you intend to change.

> **Critical image tag removed from custom template.** If the deterministic rewire detects that
> a tag required by the featured base (e.g. `background` in retargeting) is absent from the custom
> template, **stop** — do not wire around the gap. Offer the user three options: (a) use the
> featured default template, (b) supply a different custom template that includes the required tag,
> or (c) build the workflow from scratch with `compose_workflow`. Do not auto-substitute or silence
> the missing tag.

> **Legacy manual path (superseded — do not use).** Before June 2026 the only option was
> `get_indesign_tags` → `plan_template_rewire` → `compose_workflow(message=…)`. The fast path above
> covers every rewire case (named featured base, arbitrary `current_graph`) and is
> strictly better: deterministic wiring, reuses all freed pipelines, supports CSV pipeline forking,
> and includes structural validation backstops the LLM path lacks. `get_indesign_tags` and
> `get_psd_tags` remain available as standalone tools for debug inspection **and for the sanctioned
> post-compose tag ↔ CSV pre-flight above**. On Flow A, deterministic rewiring owns the wiring;
> on Flow B below, `compose_workflow` extracts the tags itself and passes them to the graph agent.

## Custom INDD/PSD workflow — Flow B: user supplies their own template, no featured base

When the user wants to build a workflow around an InDesign, Photoshop or Illustrator template they
provide — **not** starting from a featured workflow. **This is the default for create/build/compose
with supplied templates**, including banners at scale. Do not call `get_featured_workflow` /
`list_featured_workflows`, set `featuredWorkflowName`, or require the user to say "from scratch".

The split of responsibilities:

- **You (the skill):** gather the required files and the user's intent — see
  [`intake.md`](intake.md) Step 4 (template + CSV required; sizes, copy and image sources inferred
  from the files; then fonts; then output format and delivery).
- **`compose_workflow`:** extracts the template's tags (INDD vs PSD by extension), validates the CSV
  against them, and gives both to the graph agent as evidence.
- **Graph agent:** chooses the latest eligible merge/rendition versions, Parse Data routing, image
  and font wiring, renderer branches per format, and Preview / save sinks.

**Step 1 — Upload** the template, CSV, fonts and any images ([`asset-input.md`](asset-input.md)).
Do not call `get_indesign_tags` / `get_psd_tags` / `list_actions` first — compose does this.

**Step 2 — Compose once.**

```
compose_workflow(
  message            = "<user's intent: goal, output formats, preview vs save>",
  customTemplateUrl  = "<template URL>",
  customTemplateName = "<original template filename>",
  csvUrl             = "<the customer CSV URL>",
  fonts              = [{ presignedUrl, name, storageType }],   # if supplied
  lightPayload       = true
)
```

Follow the message contract in [`compose.md`](compose.md) → "Writing the compose `message`": state
intent; never name node versions, ports, tags, columns or wiring. On `csv_validation_failed`,
`csv_fetch_failed`, `tag_extraction_failed`, or a graph-agent refusal/clarification, follow
[`compose.md`](compose.md) → "Compose errors and refusals": show the reason, get the fix from the
user, re-compose at most once — never fall back to a message-only or legacy compose.

**Step 3 — Offer next steps** ([`intake.md`](intake.md) Step 6): run now, save to Workflow Builder,
or both. A compose request doesn't itself authorize running or saving. `compose_workflow` already
validates on this path; a separate `validate_workflow(session_id)` is optional.

**Step 4 — Run (if chosen).** Use node IDs from the composed result (`next_step.required_inputs`;
resolve the session if needed, not a featured lookup). Supply the CSV as `content[]` with
`mimeType: "text/csv"` on the `text/csv` node from `required_inputs`. Compose gives each CSV `@`
image column its own Input node wired to the matching Parse Data column port
(`<parse>__csv-media-<column>`); put that column's images (with original `name`) only on its node,
never on the CSV node. An `optional` column node (blank in the CSV) may be left empty — submit prunes
it. Only legacy sessions without column nodes fall back to the single `image/*` node listed. Add the prepared template binding returned by compose. Fixed-port merges
use `content[]` on their wired template source; per-tag (v1) merges use `inputs[].template` on the
merge node. Never transfer one version's attachment convention to another. Re-supply the CSV at
submit; compose uses it for evidence only. After a corrected run, save the accepted session/batch
if persistence was requested; an earlier pre-run save is not automatically updated. Inspect the
accepted graph with `resolve_workflow_session`; use `view: "composition"` only when inspecting the
original authoring graph deliberately.

### Legacy per-tag merges — explicit v1 requests or existing v1 graphs only

Only when the user explicitly asks for the per-tag (v1) merge, or is editing a graph that already
uses one: per-tag merges have ports named exactly like the template tags (case-sensitive), fed by
`parse-data` outputs. Populated image columns feed uploaded images into `parse-data` for per-row
filename matching; entirely empty image columns stay unconnected; a partially-filled column is wired
like a populated one (blank rows get no image; with a `Template` Match column, fill is read per
template). An empty column cannot select a constant image from a generic pool unless the user
explicitly asks for that constant. Never introduce this pattern for a new workflow on your own, and
never ask the graph agent for it as a retry after an error.

### Standalone tag inspection (only when the user asks)

`get_indesign_tags` / `get_psd_tags` return `[{ name, type }]` (PSD `type: "image"` = a
`{{layerName}}` smart object; `type: "text"` = a `{{variable}}` text layer). Use them when the user
asks what tags a template has, or to show a mismatch after `csv_validation_failed` — not as a
compose pre-step. PSD returns no missing-fonts report, so ask about fonts explicitly.

> **`get_psd_tags_v2`** extracts the same PSD tags through the Photoshop V2 API and additionally
> returns `artboardCount`, the number of top-level artboards. Use it when the artboard count
> matters (e.g. confirming a multi-size banner template). **`artboardCount: null` means UNKNOWN,
> not zero** — re-run, or ask the user, rather than reporting "0 artboards".

## Motion graphics (`.mogrt`) templates

Pass the `.mogrt` as `mogrtTemplateUrl` (`customTemplateUrl` / `filePath` ending in `.mogrt` are
auto-detected). What `compose_workflow` does depends on whether a base graph or a message is supplied:

| Request | Call | Result |
| --- | --- | --- |
| Render the template on its own ("render this mogrt with my headline") | `compose_workflow(mogrtTemplateUrl)` | Template controls + output presets; `next_step` → `run_dgr_render` |
| Swap a new `.mogrt` into an existing DGR workflow (Flow A) | `compose_workflow(mogrtTemplateUrl, current_graph \| featuredWorkflowName)` | Deterministic re-wire of the DGR node + a `session_id` |
| Build a new workflow around a `.mogrt` (reframe/translate first, CSV variants, social video adaptation — Flow B) | `compose_workflow(message, mogrtTemplateUrl)` | A composed workflow + a `session_id`, `.mogrt` pre-filled |

**Flow B — new workflow around a `.mogrt`.** Pass the user's request as `message` with the `.mogrt`
as `mogrtTemplateUrl` — one call; do not describe the template and hand-write a second prompt.
`compose_workflow` describes the `.mogrt`, adds its port controls (`isPortControl: true` —
text/media/audio, by `variableId` and label) to the message so the graph agent can connect produced
content (e.g. a reframed video, translated audio) to real control slots, and pre-fills the `.mogrt` on
the input-files node feeding the DGR `templates` port. `templateControls` lists the controls. Then
`run_workflow_submit({ session_id, inputs })` with the user's other assets; the `.mogrt` is applied
automatically. Controls left unconnected take a CSV column (matched by `variableId` or label) or the
template default. A DGR node's control ports are named by the template's control `variableId`s,
so the agent can wire them once the `.mogrt` is described.

**Flow A — swap a `.mogrt` into an existing workflow.** `compose_workflow(mogrtTemplateUrl,
current_graph)` (the Matrix nodes/edges graph, e.g. from `needs_rewire.currentGraph`) describes the new
template and re-wires the DGR node with no graph agent; `controlDiff` reports what changed:

- `kept` — wired control ports the new template still has;
- `reattached` — a wired port whose control is gone moved to an unwired control of the same kind
  (text/media/audio): `by: "label"` when the control labels match (the same `variableId`-then-label
  order the DGR backend uses to match CSV columns across templates), else `by: "position"` — the next
  one in template order. Control `variableId`s are positional, so a re-authored template often
  renumbers the same slot. Position moves also appear in `rewireWarnings`; confirm them with the user;
- `removed` — no same-kind control left; the connection is dropped (and an orphaned `input-*` source
  deleted);
- `unwired` — new controls with nothing wired; at run time they take a CSV column or the template default.

The rewire only re-maps connections that already exist. If the base graph connects nothing to the
template's controls (e.g. the graph agent built it without the `.mogrt`), nothing is connected and
`rewireWarnings` says so — use Flow B (`compose_workflow(message, mogrtTemplateUrl)`) instead.

The `.mogrt` is pre-filled on its input-files node (`next_step.required_inputs`); a
`run_workflow_submit` with the returned `session_id` applies it automatically. `workflow.actions` shows
`dgr-merge-template` when a CSV is wired to `data` — the execution-time form of `dgr-render-template`,
expected. The server does not check CSV headers against the controls — run the coverage check below.

On a bare rerun, a new `.mogrt` whose controls still cover every wired port runs as-is; one that drops a
wired port returns `needs_rewire` with `staleControls` (route through Flow A) — see
[`diagnostics.md`](diagnostics.md).

### How a DGR render works

A DGR node (`dgr-render-template`) renders each `.mogrt` once per CSV row per output preset. Its inputs:

- **`templates`** — one or more `.mogrt` files. A `.mogrt` fixes the layout and aspect ratio, so each
  output shape (vertical, square, …) is its own `.mogrt`.
- **`data`** — the CSV file itself. DGR reads the rows and fans out on its own, so the CSV connects
  directly to `data`, not through `parse-data`/`iterate`.
- **One port per control** (text/media/audio), named by the control's `variableId`. These only exist
  once the `.mogrt` is described, which is why composing a template workflow needs the `.mogrt` up front
  (ask for it if the user hasn't supplied it; a golden demo run by name already has its `.mogrt` files).
- **Output presets** — the frame each video is encoded at; a row's `preset_id` cell overrides them.

Unlike InDesign/PSD merges, there are no per-tag merge ports, no `parse-data` step, and media columns
don't need a leading `@`.

**How each control gets its value, per row** (first match wins): a value wired to its port → the
matching Reframe/Translate output → a CSV column named after its `variableId` or label (case, spacing and
a leading `@` ignored) → the template default. A missing value never fails the row; DGR renders the
template default and logs a warning. Details:

- Media cells are a URL or a filename matched (case-insensitively, by basename) to an uploaded asset's
  `name`.
- Reframe/Translate outputs are matched by aspect ratio, by the row's `Language`/`Locale` cell (exact,
  e.g. `fr-FR`), and — when several sources go through one Reframe/Translate — by the CSV column naming
  the control, which holds each row's **original** source filename.
- Reserved columns (not controls): `Language`/`Locale`, `preset_id`, `output_filename` (unique per row).

**Languages.** `video-translate`/`audio-translate` take only target languages (`targetLocaleCodes`); the
source language is detected from the media. Because each row picks the translation matching its
`Language` cell, the targets are every `Language` value in the CSV, including the source language.

**Output count and shape.** Videos = `.mogrt` files × CSV rows (no CSV = 1) × presets per row. State the
number before submitting. Each video is encoded at its preset's frame: a preset of a different shape than
the `.mogrt` boxes the design with bars. `compose_workflow` doesn't set presets and a session submit
can't, so composed DGR nodes use the default `ffs_video_api_land_1080p_hq` (16:9), as the Social Video
Adaptation golden does. To render each `.mogrt` in its own shape, set matching presets (with Smart
Matching for several `.mogrt` files) in the Workflow Builder, or use `run_dgr_render` with `presets` for a
template-only render.

The authoritative behavior is `packages/actions-dgr/src/mergeTemplateHandler.ts`; see
`packages/actions-dgr/docs/dgr-integration-contracts.md`.

### Pre-flight control ↔ CSV coverage check (`.mogrt` **and** CSV) — before submit

Best-effort, like the InDesign/PSD check: skip it if you can't read the CSV header; never ask the user to
paste the CSV for it. Using `templateControls` (or `get_dgr_template_description`), report controls that
will silently fall back to the template default:

- a text/media/audio control with no matching column and nothing wired (may be intended);
- media cells that don't match any uploaded asset's name;
- several sources through one Reframe/Translate with no column naming the control;
- translated media with no `Language` column, or values that aren't exactly the target locale codes.

Don't flag headers that differ only in case, spacing or a leading `@`.

## Node selection: use the live catalog

The template format determines the merge node and the rendition node:

| Format | Merge node | Rendition node | Tag tool |
|--------|-----------|----------------|----------|
| InDesign (`.indd`/`.idml`/`.zip`) | Latest eligible `merge-data` family version | Latest compatible InDesign rendition | `get_indesign_tags` |
| Photoshop (`.psd`) | Latest eligible `data-merge-psd` family version | Latest compatible Photoshop rendition | `get_psd_tags` |

| Scenario | Use | Why |
|----------|-----|-----|
| Featured workflow (re-wiring) | The **same merge node** as in the original featured workflow (`merge-data` for INDD, `merge-photoshop-data` for PSD) | The deterministic `compose_workflow` rewire targets the existing node by ID; node type never changes |
| New custom workflow (Flow B) | Latest eligible catalog version | Availability and ports come from the catalog, not a historical skill list |
| Explicit older-version request | Requested version if available and compatible | Preserve the user's choice; explain unsupported combinations |
| Fixed-port CSV merge | Real template/CSV/image/font ports | No invented per-tag overrides; template is a wired file |

**`parse-data` output ports are dynamic** — one output port per CSV column, named after the
slugified column header (e.g. `Product Name` → `product_name`). The agent cannot wire them without
knowing the column names. When the user's workflow involves `parse-data`, read the supplied CSV's
headers (ask only if unavailable) and include those names explicitly in the `compose_workflow` message.

## Featured-workflow anti-patterns

- **Omitting `csvData`** — see the Fast path section above; this is the single most common cause of
  item-count mismatch failures.
- **Retrying a wrong-routing recompose by changing `message`** — the `message` parameter is ignored
  by the deterministic path. If routing is wrong, pass `csvData` and recompose; do not iterate on
  `message`.
- **Rewriting a merge CSV's `@image` filenames into presigned URLs** — see the CSV callout above.
- **Re-casing or rewriting CSV headers to "match" the template** — the CSV header is discarded; the
  data-source header comes from the merge port name. Fix case mismatches by recomposing deterministically
  (which rebinds the port to the template's exact case), never by editing the CSV.
- **Rewiring a custom template through the `message`/LLM path (or hand-editing merge ports)** — leaves
  the base graph's lower-case ports (e.g. `headline`) in place and causes InDesign 107013. The
  deterministic `customTemplateUrl` path always rebinds ports to the template's exact case (even a
  case-only-different template), so always use it.
- **Skipping input prompts** — never use default text values from `prepared.inputs` for user-facing
  merge-data ports (heading, sub-heading, etc.) without confirming with the user.
- **Font placement** — prefer passing `fonts: [...]` ONCE to `get_featured_workflow`/`compose_workflow`;
  the server caches them with the session and, on submit (with `useSessionDefaults` not set to false),
  broadcasts them to all merge-data **and** create-rendition nodes automatically — so you no longer
  re-send the (large) fonts blob on every run. Fonts must reach the create-rendition node too: if the
  graph has a create-rendition step, it re-rasterizes the merged document in a **separate** InDesign
  call, and without the fonts there the rendered banner falls back to default fonts (the cached-fonts
  broadcast covers it). To OVERRIDE the cached fonts on a specific submit, pass
  `defaults: { fonts: [...] }`; caller-supplied `defaults.fonts` always wins over the cached set. As a
  further alternative, fonts may be attached per-node via `inputs[].fonts` on individual merge-data
  input entries (the server's `mergeInputsIntoActions` converts either form to the backend shape). Do
  not place fonts on `actions[].parameters.fontDirectories`.
- **Bypassing the session to "bake fonts"** — cached fonts and `defaults: { fonts: [...] }` both work
  **with** `session_id` + `useSessionDefaults: true`; the broadcast reaches both merge-data and
  create-rendition even on a deterministic-rewire session. **Never drop the session and submit inline
  just to attach fonts**: on the `customTemplateUrl` rewire the custom template lives **only** in the
  session's cached `preparedInputs` (never in `actions[].parameters`), so going inline forfeits the
  template and the run fails with *"requires at least one template file."* Capture fonts at compose (or
  pass `defaults: { fonts }`) and keep the session. The per-node `inputs[].fonts` form is only read on
  an entry that **also** carries a `template` — a fonts-only entry is silently ignored, so when in
  doubt capture fonts at compose or use the `defaults` broadcast.
- **Re-reading large `get_featured_workflow` responses** — when `prepared.session_id` is present,
  you never need the full `actions`/`connections`. Write a script to modify `inputs` from the tool
  output file rather than reading 50–100 KB of JSON.
