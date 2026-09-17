# Inspecting runs & diagnosing failures

Load this when inspecting a run, listing history, or explaining why a workflow failed.

## `inspect_run` vs `list_all_workflows` vs `list_workflow_history` vs `list_interfaces` vs `list_interface_runs` vs `list_workflow_runs`

- **Single workflow / execution / batch** (user pastes an ID, asks "the last one", "that
  workflow"): use `inspect_run` → full details: workflow JSON, all recent executions, per-action
  outputs, logs, diagnostics.
- **Any broad "list my workflows" intent** (no named target, no date filter): use
  `list_all_workflows` — one call, already merged/deduped/sorted across own + org-wide + shared.
  Answer from the rows alone with **zero `inspect_run` calls**.
- **Filtered/date-ranged own-workflow query** (e.g. "workflows I published last week"): use
  `list_workflow_history` instead — it stays scoped to the caller's own drafts/published.
- **"List my interfaces" / "what presets do I have"** (definitions — a genuinely separate
  entity from a regular published workflow, not a status on one): use `list_interfaces`
  ("preset" is the same thing under its older, backend-internal name). Never confuse this with
  `list_all_workflows` — interfaces are published through a different endpoint/namespace
  entirely.
- **"List my jobs" / "my interface runs"** (executions of interfaces/presets, never
  bulk-workflow-service traffic): use `list_interface_runs` — already filtered to
  `batchSource: "preset"` only.
- **"List my workflow runs" / "runs of my saved workflow"** (executions of a PLAIN, non-interface
  workflow — the complement of `list_interface_runs`, not a superset): use `list_workflow_runs`.
  No UI shows this today (unlike interfaces), so its columns/formats are this tool's own design —
  don't claim they match a screen.
- **Ambiguous** ("show me my workflows", no count): render `list_all_workflows`'s `typeSummary`
  block first (counts by type across the caller's full matching set), then `renderedTable`, then
  offer to drill into any single entry.

Never read local `workflow.json` / `inputs.json` files to reconstruct history — those exist for
human debugging only. `list_all_workflows` / `list_workflow_history` / `list_interfaces` /
`list_interface_runs` / `list_workflow_runs` / `inspect_run` are authoritative.

Each `list_workflow_history` row also carries `assetsLikelyDurable` — a coarse, fetch-free hint that
this source's input assets will survive a rerun (`true` for published/interface rows; ephemeral raw
batch/preview runs are `false`). Use it only to set expectations when the user scans the list ("this
one can rerun with its original assets; that older raw run may need re-attaching"). It is a heuristic,
not the authoritative per-input signal — for an actual same-assets rerun consult `rerunAssets` from
`inspect_run` (see "Rerun with the same assets" below).

## Presenting a workflow list — match the bulk-creation UI's columns

Rows carry internal fields that mean nothing to the user (`workflowSource`, `source`,
`batchSource`/`isInterface`). Never print those raw strings — use the columns below.

**Workflows-listing intent.** For any "list my workflows"-style request, call `list_all_workflows`
once — it is already merged, deduped, and sorted (own drafts + published, other org members'
published, workflows shared into this org). Do not re-sort, re-group by `source`, or make additional
calls. **Never call `list_workflow_history`, `list_batches`, or `inspect_run`** to populate this
response.

**Render `renderedTable` verbatim, once — do not reconstruct it and do not separately re-paste
`typeSummary`.** The response's `renderedTable` field already contains THREE sections, in this
exact order, inside one combined string, each separated by a blank line:

1. A **"Golden demos:"** label, then FFCPE's 8 homepage golden-demo rows (Use Case/Name/Workflow
   ID, byte-identical to `list_golden_workflows`' own table).
2. The `typeSummary` type-count block (`statusDisplay` counts — Published/Draft/Draft
   Version/Shared in normal use — across the caller's FULL matching set, not just the current
   page). `typeSummary` is ALSO returned as its own standalone field, for callers that want just
   the count breakdown without the full table — but when rendering `renderedTable`, this block is
   already embedded at its correct position; do not additionally paste the standalone
   `typeSummary` field before `renderedTable`, or the block appears twice.
3. A **"Your workflows:"** label, then this tool's own 5-column workflows table for the current
   page — never split into separate "your workflows" / "others' workflows" sections.

On a paginated call (`offset > 0`), section 1 is skipped entirely (not re-fetched, not
re-rendered) — golden demos are the same static 8 rows regardless of page.

Render the whole string top to bottom, in one piece, exactly as returned — do not peel any
section off into a separate call, do not reorder them, and do not trim/summarize any section just
because it isn't the row-level table. Output it as your response body as-is. Do not narrate the
extraction process to the user (no "let me pull the renderedTable field" commentary) — just
present it. If the raw JSON result is large enough to land in a temp file and you query it with
jq/grep to save tokens, select **`renderedTable` alone** (it already carries everything
`typeSummary` would, embedded) — pulling a subset of per-row fields instead (e.g. only
`nameDisplay`/`lastModifiedDisplay`/`statusDisplay`) is exactly how the **Created by** and
**Workflow ID** columns have been silently dropped before, how the list has been wrongly split
into two tables before, and how the golden-demo rows at the top have been dropped before too;
`renderedTable` exists specifically so there's nothing left to reconstruct. This is a different
axis from `source` (own/org/shared — visibility scope); never group or relabel `typeSummary` by
`source`.

**The same 5 columns apply to a `list_workflow_history` result** (filtered/date-ranged own-workflow
queries — see above) — only build your own table from the fields below if `renderedTable` is somehow
absent (never present on `list_workflow_history`, since it has no cross-source merge to pre-render).

**Drafts are returned run and un-run** (a draft keeps `workflowSource: "draft"` after it runs, matching
the builder UI). **By default drop un-run drafts** from this list — a row where
`workflowSource === "draft" && !firstExecutionAt` — keeping run drafts (`firstExecutionAt` set)
alongside published. Keep un-run drafts only when the user explicitly asks for un-run / unfinished /
all drafts.

**Exactly these 5 columns, every time — no more, no fewer:**


| Column | Source | Notes |
| --- | --- | --- |
| **Name** | `nameDisplay` | Pre-computed — render verbatim. Never blank. |
| **Last modified** | `lastModifiedDisplay` | Pre-computed — render verbatim. |
| **Created by** | `createdBy` (per-row, `list_all_workflows`) or `callerDisplayName` (response-level, `list_workflow_history` — every row it returns is the caller's own) | Pre-computed — render verbatim; fall back to **"You"** only if `callerDisplayName` is absent. |
| **Status** | `statusDisplay` | Pre-computed — render verbatim. Normal values for `list_all_workflows` are Published/Draft/Draft Version/**Shared** — the same four labels bulk-creation's own "Your workflows" table shows (this tool is definitions-only, so Inline/Preview never appear; "Preset" is a different tool/entity — see `list_interfaces` above — never a workflow status). |
| **Workflow ID** *(stands in for the UI's API-link column)* | `workflowId` | Never drop — what the user pastes back to inspect/re-run. |

No run-count/last-run-status column (this is a workflows list, not a runs list). Never collapse a
column into prose ("All created by Jane Doe" instead of a **Created by** column) just because every
row shares a value, and never add a column that isn't in this list (e.g. a `#` row-number column).

Rows with `source: "org"` or `"shared"` were authored by someone else — never claim to have
run/edited them on the user's behalf, and never offer to edit/republish a `"shared"` row (read-only).
Only `source: "own"` rows carry run-activity fields (`runCount`, `lastRunAt`, etc.) — `"org"`/`"shared"`
rows omit them entirely (batch history isn't visible across users); do not describe those rows as
"never run".

`nameDisplay`/`lastModifiedDisplay`/`statusDisplay` are computed in
`packages/mcp-server/src/workflow-display-format.ts` — that file is the source of truth (exact
elapsed-time buckets, Status derivation, and the "Untitled workflow - `<date>` at `<time>`" auto-name
convention), not repeated here. Paste the fields as-is; if you're computing any of them by hand from
`name`/`updatedAt`/`workflowSource`/`isVersionDraft`/`isInterface` instead of reading the field,
you're missing it — this was a repeated, concrete source of drift (wrong date formats, garbled
synthesized names). (`list_batches`/`inspect_run` rows don't carry these fields — for those, fall
back to the `workflowId` with a note like "(inline)" when nameless; see "Two independent axes"
below for Type labeling.)

**Ordering for run-centric/single-recency flows** that still call `list_batches` (see the Tool
routing table): lead with in-progress runs: **In-progress runs (running/pending) first** — these
need immediate attention — then idle **Interfaces (Preset)**, then **Drafts**, then **Published**,
then **Inline/Preview**, most-recent-first within each group. `list_workflow_history` already
returns rows pre-grouped in exactly this order by default (no explicit `sortBy`), so **present them
in the order returned — don't re-sort**. Only when the user explicitly asks for a different order
(e.g. "oldest first", "by publish date") pass a `sortBy` and render as returned.

## Presenting interfaces (`list_interfaces`) and their runs (`list_interface_runs`)

Same discipline as `list_all_workflows` above — render `renderedTable` verbatim, do not narrate
the extraction, do not reconstruct the table from per-row fields. Two distinct tools, don't mix
their rows into one table:

- **`list_interfaces`** (definitions): columns **Name / Description / Author / Published date /
  Workflow ID**, matching bulk-creation's "Interfaces" card exactly (FFENT-17750 added author +
  publish date to that card). `Published date` is an absolute ordinal date ("20th August 2026"),
  not relative time. No own/org split like `list_all_workflows` — every org member's interfaces
  are visible in one flat list (the backend has no such scope concept for this endpoint).
  `descriptionDisplay`/`authorDisplay` are "—" only when that field is genuinely unavailable (no
  description was published; author resolution failed), not an error. This `workflowId` is a
  fresh ID minted when the interface was published — it does NOT match the ID of the source
  workflow it was promoted from; never treat an interface's workflowId as interchangeable with
  one from `list_all_workflows`/`list_workflow_history`, even for what looks like the same
  underlying workflow.
- **`list_interface_runs`** (executions/"jobs"): columns **Job name / Start date / Status /
  Duration / Batch ID** — the first four match bulk-creation's Job log column labels exactly
  (`historylist-job-name`/`historylist-start-date`/`historylist-status`/`historylist-duration`);
  `Batch ID` is a 5th column not on the UI's own table (the UI only shows it in a secondary "More"
  popover) — kept visible here since this tool has no popover affordance and the caller needs it
  to chain into `inspect_run`. Formats mirror the Job log exactly too, not this MCP's other list
  tools: `Start date` is absolute ("8/24/26, 11:52 AM"), not relative; `Duration` is a coarse
  rounded unit ("1 min"/"2 hrs"), never seconds; `Status`'s "Processing" only carries a `%` when
  real progress data exists. Always scoped to `batchSource: "preset"` — never preview/headless
  runs, never bulk-workflow-service traffic (a separate product, no representation in
  run-workflow's batch data). For outputs, errors, or full details on one run, use `inspect_run`
  with its `batchId` — this list deliberately omits download links/error reports, matching how
  single-item detail is always handled separately from list views in this skill.

## Presenting workflow runs (`list_workflow_runs`)

No UI shows run history for a plain (non-interface) workflow today — unlike `list_interfaces`/
`list_interface_runs`, which mirror bulk-creation's UI exactly, these columns/formats are this
tool's own design. Same discipline applies regardless: render `renderedTable` verbatim, don't
narrate the extraction, don't reconstruct the table from `runs`.

Columns: **Job name / Start date / Status / Duration / Batch ID** — same 5-column shape and
formats as `list_interface_runs` (absolute `Start date`, coarse rounded `Duration`, conditional
`%` in `Status`), for consistency across this MCP's run-listing tools. Scope: excludes
`batchSource: "preset"` entirely, regardless of channel (`invocationSource`) — it's the
complement of `list_interface_runs`, not a broader "all runs" view (use `list_batches` for that).
Since the backend can't filter out preset rows in a single query, this scans forward across
pages internally, accumulating non-preset rows up to a bounded safety cap — `runsTruncated: true`
means that cap was hit while still short of enough rows; there may be more further back than
shown. Always mention this to the user when true rather than presenting the list as complete.

## Presenting golden workflows (`list_golden_workflows`)

Distinct from BOTH `list_featured_workflows`/`get_featured_workflow` (per-scenario templates —
retargeting, localization, packaging) AND the `golden-demos` example fixtures used by
`get_workflow_examples`/`reload_examples` (internal compose_workflow debugging references) —
don't conflate any of these despite the shared "golden"/"featured" wording. This one lists
FFCPE's homepage showcase groups (Banners at Scale, Product Assets, Social Video Adaptation; 8
named demos total). Unlike `list_workflow_runs`, this genuinely does live-query the same backend
`list_interfaces` uses (`ApiClient.getPresets()`) — it isn't a static/no-UI-precedent list.

Columns: **Use Case / Name / Workflow ID** — deliberately minimal, matching the UI as closely as
this data allows. `useCase`/`name` are the UI's own fixed labels (bulk-creation's own code calls
the grouping `useCaseCards`, hence "Use Case" rather than an invented term), byte-identical to
what's shown on the homepage — render them verbatim. `workflowId` is the one deliberate addition
beyond the UI itself: the homepage never shows this ID (it silently falls back to a static
template with no visible indication when no live preset backs a slot), but it's kept so a caller
can chain into `inspect_run`/`run_workflow_submit` for a specific demo — same exception already
made for `list_interfaces`. Every one of the 8 rows must always be shown, `workflowId` is `"—"`
when no live preset currently backs that slot — a normal, expected state, not an error.

**A plain "list my workflows" intent does NOT call this tool separately.** `list_all_workflows`'s
own `renderedTable` already leads with this same 8-row golden table (byte-identical rendering),
followed by a blank line, then the caller's own workflows — one combined string. Only call
`list_golden_workflows` directly when the user specifically asks about golden demos/showcase
workflows on their own, or as the first step of "run `<use case>`" (see below). `goldenUnavailable:
true` on `list_all_workflows`'s response means that section failed and was OMITTED from
`renderedTable` entirely (not left as an empty placeholder) — mention this to the user.

### Running a golden demo by name

"Run banners at scale" / "run the social video adaptation demo" is an EXECUTE intent, not a listing
one — `list_golden_workflows` still resolves it, but as the first step of a run, not the end of the
request. Flow: call `list_golden_workflows`, match the named use case/row, then
`run_workflow_submit({ workflowId, inputs: [] })` directly — baked defaults, no confirmation needed
(see below) — or with the user's own `inputs` if their prompt already asked for that. A use-case name
alone (e.g. "Banners at Scale") can match more than one row — list the matches and ask which before
proceeding; never guess. `workflowId: "—"` means that slot has no live preset — tell the user it isn't
currently available rather than attempting to run it.

Golden demos are interfaces — passing empty `inputs: []` runs them on their baked default assets,
and `run_workflow_submit` resolves those automatically (it never falls back to whatever a PRIOR run
happened to submit — a one-off custom asset from an earlier run, including one that already failed,
is never silently reused just because the user says "run it" again). A partial override (one input
supplied, the rest left blank) leaves every other slot on its baked default.

**Do NOT ask first here (this is the opposite default from ASK-FIRST — see `SKILL.md`).** A golden
demo's/interface's baked assets are curated and durable, not a stale leftover from a prior run — there
is nothing to confirm and nothing to pre-verify, so submit `inputs: []` directly without asking or
checking asset hydratability first (`inspect_run` inspects a prior EXECUTION, not a preset's
definition — it has nothing to find for a never-run interface, and calling it first only adds a
round-trip that can 404 for no reason). Only ask when the user's own prompt is itself ambiguous about
wanting to supply their own assets instead of running as-is.

### "What assets does this golden/interface need — and are they still available?"

Route this to **`inspect_run(workflowId)`** — never `get_featured_workflow` (a different catalog:
agent-facing scenario templates, not this interface's baked defaults). Given a preset/interface
workflowId, `inspect_run` resolves the interface's authoritative current definition directly (via
the preset endpoint, not batch history) and returns its required inputs in `rerunAssets.inputs[]`.
Each asset carries an explicit `resolvedVia` verdict so you can answer the availability question
without guessing:

- `resolvedVia: "warm-url"` — resolvable now via a still-valid presigned URL, but NOT retained
  server-side; a later rerun (once the URL expires) will need a fresh upload.
- `resolvedVia: "durable-storage"` — backed by retained bytes (CAS / stored preset ref); re-signable
  indefinitely, so a rerun always resolves it regardless of URL expiry.
- `resolvedVia: "unavailable"` — cannot be fetched (`needsReattach: true`, see `unresolvableReason`);
  ask the user to supply it before running.

**How much to trust the verdict — `rerunAssets.durabilityCoverage`.** The envelope also carries a
top-level `durabilityCoverage` telling you whether the per-asset `resolvedVia` verdicts are backed by
an authoritative backend durability map or merely inferred from URL expiry:

- `durabilityCoverage: "authoritative"` — a backend durability map was supplied (CAS-published or a
  resolved preset/interface). `durable-storage` vs `unavailable` is a real server-side fact; trust it.
- `durabilityCoverage: "warmth-guessed"` — no durability map was available (a draft, a legacy/native
  publish with no CAS, or a batch record read without enrichment), so `resolvedVia` rests on URL
  expiry alone. A `warm-url` here means "the URL still looks valid," NOT "retained" — treat it as
  best-effort and expect a possible `needs_reattach` on a later rerun. A draft is always
  `warmth-guessed` by design (it is never published, so it has no durable store). Additionally, each
  leaf carries `urlExpiry` (`valid` | `expired` | `unknown`) — `unknown` means the URL is on an
  unrecognized host so even the expiry check was a guess; most relevant when `warmth-guessed`.

`inspect_run` on an interface deliberately skips the recent-executions scan (it's a
describe-the-baked-defaults question) — for an interface's run history, use `list_interface_runs`.

## Two independent axes: Type (what) vs. channel (who launched it)

`batchSource` (execution surface) drives the **Type** label; `invocationSource` (launch channel) is
who kicked the run off. They are orthogonal — a single run can be `batchSource: "preset"` **and**
`invocationSource: "mcp"` at once. Lead with Type; surface channel only when the user asks.

| `invocationSource` | Channel label |
| --- | --- |
| `mcp` | **Agent (MCP)** |
| `interface` / `workflowbuilder` | **UI** |
| `api` | **Direct API / headless** |

`list_batches(invocationSource: "mcp")` — only agent-launched runs. `batchSource: "preset"` — only
interface runs (regardless of who launched them). The filters compose.

## Rerun intake — resolve the identifier, then the intent

Before routing a rerun, settle two things without making the user learn the taxonomy.

**1. Resolve the identifier (auto-resolve; clarify only on ambiguity).** The user pastes whatever
they have — a workflow/preset name, a `workflowId` (UUID), or a `batchId` (`batch-…`). Detect the
kind yourself:
- a `batch-…` string → a `batchId` (that specific run);
- a bare UUID → a `workflowId`;
- anything else → a name: fuzzy-match it against `list_workflow_history` (and, for a preset,
  the interface list).

Exactly one confident match → proceed with it. Zero or several matches → surface the candidates
(name + last-run date) and ask which one. **Never demand a raw ID** or make the user restate what
kind of thing they pasted.

**2. Infer the intent (same assets vs new assets — prompt only when genuinely ambiguous).** Decide
whether the user wants to reuse the run's assets or provide new ones by inference first:
- They attached or named **new** assets, or supplied `inputs` / a new template → **new assets**:
  wire them in. A new template on a data-merge node routes through the rewire path (`needs_rewire`
  / `no_editable_graph`, see "Rerun with a NEW template" below) — never a bare swap.
- They said "rerun" / "run it again" / "same assets" / "reproduce" with no new assets → **same
  assets**: anchor to the run (a bare `workflowId` with no inputs anchors to its **most-recent**
  run), hydrate the durable statics, and let the preflight prompt (`needs_reattach`) only for the
  genuinely unrecoverable ephemeral inputs.
- A bare "run this X" with no assets and no clear rerun verb — **especially an interface/preset,
  which is designed to take fresh inputs each run** → **ask**: "Reuse the assets from your last run,
  or provide new ones?" This residual-ambiguity case is the *only* one that gets an up-front prompt;
  don't ask when either signal above is already present.

> **Replay semantics:** a bare `workflowId` submitted with **empty `inputs` (`[]`)** now *replays the
> most-recent prior run with that run's frozen per-run inputs* — it does **not** fall back to the
> workflow definition's default inputs. `run_workflow_submit` resolves the anchor run's `batchId` and
> resubmits its stored graph. If you instead want the definition's defaults (a "clean" run), the user
> must supply fresh `inputs` explicitly. Note the anchor is the newest run within a bounded lookup
> window — see `resolveMostRecentBatchId` in `run-workflow-submit.ts` for the tracked ordering caveat.

## `inspect_run` ID routing

The tool auto-detects the ID type:
- `batch-...` → batch status + failed execution list
- `..._exec-{n}` → single batch execution outputs + diagnostic
- `{workflowId}_{uuid}` (ends with `_{uuid}`, underscore before UUID) → single execution outputs + diagnostic
- pure UUID or workflow name → **all recent executions** with full action outputs + diagnostics for each

## Key fields in the `inspect_run` response

- **`workflowJson`** — the full actions/connections graph. **Not returned by default** — pass
  `includeWorkflowJson: true` when you need the graph (e.g. `rerun.method === "inline"`, or the user
  asks to inspect the graph). (`"inline_exact"` comes only from batch lookups, which always include
  the graph and never consult this flag.) When `hasWorkflowJson: true`, show the graph
  structure explicitly (list each action node and its connections); do not silently summarize.
- **`rerun`** — the AUTHORITATIVE re-run signal: `{ runnable, method, draftFixHint? }`. `rerun.runnable`
  is the honest answer to "can I re-run this?" (true for essentially anything in history);
  `rerun.method` (`"by_id"` | `"inline"` | `"inline_exact"`) tells `run_workflow_submit` how. **Route
  re-run on this, not on the raw booleans below.**
- **`rerunAssets`** — per-input asset audit for a *same-assets* rerun: `{ status, inputs[] }` where
  `status` is `"all_resolvable" | "some_missing" | "none"` and each input carries
  `{ nodeId?, actionType?, path, filename?, mime?, resolvableNow, needsReattach, durable?, assetRole, reattachVia, unresolvableReason? }`.
  It answers "will this rerun find its original input assets?" — published/CAS/preset inputs and
  still-valid presigned URLs are `resolvableNow: true`; expired raw-batch URLs are `needsReattach: true`.
  `durable` (when present, from the backend) is authoritative: `durable: false` means the bytes won't
  survive a later rerun even if the URL looks valid right now. `unresolvableReason` (when present) names
  *why* a slot can't be reused: `"data-uri"` is a baked-in base64 blob (`data:` URI) that was never a
  reusable asset reference; `"stored-path"` is a schemeless/relative stored blob path (e.g. an ACP
  `cloud-content/…` path baked into a draft) that is not directly fetchable — both must be re-attached as
  a real file, never resubmitted verbatim. `reattachVia` (derived from `assetRole`) tells you *how* to
  re-attach: `"input"` → a fresh file in the matching `inputs[]` slot; `"template"` → route through
  `inputs[].template.presignedUrl` / a `compose_workflow` rewire (NEVER a bare `inputs[].content`, which
  returns `invalid_input_target`); `"rewire-only"` → a font/DGR-preset/PS-action static that is not
  submittable as an input at all and can only be changed in the Workflow Builder / via `compose_workflow`.
  Use this ONLY when the user asked to reuse the same assets — see "Rerun with the same assets" below. It
  never mutates the graph (distinct from the Expired-URL redaction).
- **`mergeTemplatePorts`** — advisory list of the workflow's **dynamic-port** merge nodes
  (`merge-data`, `data-merge-psd`): `[{ nodeId, actionType, tags: [{ name, type }] }]`. Each `tags`
  list is the placeholders/layers the node is currently **wired for** — i.e. what a replacement
  template must match to rerun as-is. Read it **before** supplying a new `inputs[].template`: if the
  new template's InDesign tags / PSD layers (from `get_indesign_tags` / `get_psd_tags`) match these,
  the rerun runs as-is; if they differ, expect `run_workflow_submit` to return `needs_rewire` (route
  through `compose_workflow`). Purely informational — no enforcement here; the submit-time tag-diff
  guard is the backstop.
- **`canRerun`** — INTERNAL/legacy hint only; literally `workflowSource === 'published'`. It does NOT
  mean "can be re-run" (inline/preset/draft rows are re-runnable with `canRerun: false`). Never surface
  it to the user or route re-run on it — use `rerun`. (`canRun`/`canExecuteInline` are likewise
  internal mechanism hints subsumed by `rerun`.)
- **`exactGraph`** (batch lookups) — `true` when `workflowJson` is the EXACT graph THIS run submitted
  (incl. UI tweaks), not the canonical/latest definition. When `true`, `rerun.method` is
  `"inline_exact"`: resubmit `workflowJson` with a fresh UUID rather than re-running by workflowId.
- **`hasWorkflowJson`** — `true` when the workflow graph definition is available to display. Both
  published and inline workflows return `true` when the JSON was stored.
- **Logs** — only included in `diagnostic.failedActions[].logs` for failed actions. Successful
  workflows do not include logs (omitted to reduce noise).
- **Expired URLs** — pre-signed S3/Azure URLs that have expired are automatically replaced with
  `[URL expired — re-run the workflow to get fresh outputs]`. Unexpired and unrecognized URLs are
  shown as-is.

## Natural-language history queries

"Last workflow I ran" / "most recent run" (a **single** item, by recency): `list_workflow_history(limit=1)`
→ take `workflowId` → `inspect_run(id, includeWorkflowJson: true)`. Pass `includeWorkflowJson: true`
whenever you intend to display or rerun the graph; omit it for status/diagnostic-only lookups. This
list→inspect chain is **only** for single-item recency requests — a broad "list my workflows" /
"show my recent runs" is answered from the list rows alone, with no `inspect_run` (see the
inspect-vs-list rules above).

## Rerun after inspect (only when the user explicitly asks)

Route on the `rerun` object — never on `canRerun`. Any workflow/batch source is re-runnable:

- `rerun.method: "by_id"` → call `run_workflow_submit` with the original `workflowId` and
  **NOTHING else** — no `actions`, no `connections`, `inputs: []` (a draft's MatrixGraph is
  auto-translated on submit). This is the FAST path: the client uploads/re-signs nothing and the
  server reuses the published inputs, so submit returns in ~1s. **Never also pass the inline graph
  on a `by_id` rerun** — doing so makes the client re-resolve every asset (re-signing, and
  re-downloading + re-uploading large videos/templates), which stalls `run_workflow_submit` for
  minutes before it returns a batchId. When a published `workflowId` exists, prefer `by_id`.
- `rerun.method: "inline_exact"` → generate a new UUID, call `run_workflow_submit` with
  `actions`+`connections` from `workflowJson` (the EXACT submitted graph) + `workflowId: <new-uuid>` +
  same inputs. **Copy every input URL from `workflowJson` VERBATIM** — they are the prior run's
  already-resolved presigned URLs and pass through with zero network. Re-upload (`upload_asset`)
  ONLY the specific inputs shown as the `[URL expired — re-run …]` placeholder; leave every other
  URL untouched, and never swap a still-valid `workflowJson` URL back to the original source URL
  (that re-triggers the slow re-upload). Tell the user the new id. Reproduces exactly what ran.
  **If this run is a preset/interface** (`rerun.method: "inline_exact"` or `isInterface: true`),
  ALSO pass `interfaceRerun: true` so the reproduced run is recorded as an interface run
  (`batchSource: "preset"`) and stays in the UI's interface list — it is still attributed to the
  agent (`invocationSource: "mcp"`). Do **not** set `interfaceRerun` on ordinary published/inline
  re-runs (they are not interface runs).
- `rerun.method: "inline"` → same inline resubmit, from the resolved `workflowJson`; reuse its
  input URLs verbatim as in `inline_exact` above.
- `rerun.runnable: false` → only genuine block (a broken never-run draft): relay `rerun.draftFixHint`
  and stop; do NOT tell the user to publish it or fall back to `compose_workflow`.
- `executionCount === 0` → a **first encounter**: this workflow has never been run, whatever its
  source (a never-run draft, a freshly imported/never-run published workflow, a preset/interface not
  yet invoked). There is **no** prior run to reproduce and no session defaults — its asset leaves are
  the workflow's *baked* assets, not the output of a previous run. This signal is **source-agnostic**:
  do not special-case drafts. Combine it with `rerunAssets.status` (below) to decide what to tell the
  user — the routing itself is uniform, only the phrasing changes:
  - `executionCount === 0` **and** `rerunAssets.status: "all_resolvable"` → the baked assets are all
    still resolvable, so the workflow **can** technically be run as-is. **Inform** the user of that
    (naming that these are the baked-in assets, not a prior run's output) rather than silently firing
    it — let them confirm or supply their own inputs first. Do not treat this as a "rerun with the
    same assets from last time"; there was no last time.
  - `executionCount === 0` **and** `rerunAssets.status: "some_missing"` → the baked assets are not all
    reusable (e.g. a schemeless ACP `cloud-content/…` stored path, a `data:` blob, or — most often for a
    never-run published workflow — a required input with **no source at all**,
    `unresolvableReason: "missing-required"`, because publish strips input assets). Do NOT offer to
    "rerun with defaults" — treat the first run as an inputs-collection step and gather the real inputs
    for the `needsReattach` slots (per the routing below). First-encounter is not a separate rule here:
    it is one instance of "a required input has no valid source," which `some_missing` already captures
    source- and run-count-agnostically.
  Whatever the source, once you have the workflow JSON the reuse-vs-re-attach decision is driven only
  by `rerunAssets` — see the next section.

## Rerun with the same assets (re-attach when missing)

When the user asks to rerun **with the same assets** (not new ones), consult `rerunAssets` before
submitting:

- `rerunAssets.status === "all_resolvable"` → every input is still resolvable (published/CAS/preset,
  or a still-valid presigned URL). The assets **can** be reused as-is — but a **bare same-assets rerun**
  (no fresh `inputs[]`) does not fire silently: `run_workflow_submit` returns
  `status: "needs_confirmation"` first (see "Confirm a bare same-assets rerun" below), listing the exact
  assets it would reuse. Show them to the user and confirm, then resubmit with `confirmRerun: true` (or
  with fresh `inputs[]` to swap assets). This confirmation is **run-count-agnostic** — it fires on the
  first reproduction and every later one alike; do NOT gate it on `executionCount`. Once confirmed,
  follow the normal `rerun.method` routing above and reuse the resolvable URLs verbatim (no re-attach).
- `rerunAssets.status === "some_missing"` → one or more inputs can't be reused (expired presigned URL,
  backend `durable: false`, a baked-in base64 blob flagged `unresolvableReason: "data-uri"`, a
  schemeless/relative stored blob path flagged `unresolvableReason: "stored-path"` — e.g. an ACP
  `cloud-content/…` path baked into a draft, which is not directly fetchable — or a required input that
  has **no source at all**, flagged `unresolvableReason: "missing-required"`). The last case is the
  **zero-leaf** signal: a downstream-consumed `input-*` node with no baked URL and no stored ref. It is
  **source- and run-count-agnostic** — a never-run published workflow (whose input assets are stripped at
  publish) is only its most common instance; an nth-run input whose URL was never retained trips it too.
  Do NOT submit with dead
  URLs, re-send a `data:` URI, or resubmit a stored path (it fails at submit with "Invalid source URL"). Ask the user to re-attach **exactly** the inputs where
  `needsReattach: true`, identifying each by its `filename` (fallback `nodeId`/`path`). Route the files
  the user re-attaches through the normal upload path (`create_upload_url` → `upload_asset`, see
  [`asset-input.md`](asset-input.md)), then resubmit with those fresh URLs in the matching `inputs[]`
  slots and copy every still-resolvable input URL verbatim. A `data:`-URI slot is the one case where the
  URL string *looks* self-contained but is never reusable — a base64 blob in a saved graph was a
  one-shot paste, not a durable reference, so the audit flags it missing even though nothing "expired";
  treat it exactly like an expired input and collect a real file. The audit recognizes an asset slot by
  its key — the `url`/`sourceUrl`/`presignedUrl`/`actionJSONUrl` core plus any `*Url`-suffixed key
  (`templateUrl`, `dataUrl`, `scenePresignedUrl`, …) — so a base64 blob under any asset-URL field is
  caught rather than silently dropped. The audit distinguishes *absolute* URLs from stored paths: an
  unsigned but durable **absolute http(s)** host URL (CloudFront/Frame.io/azureedge/Dropbox/GCS) is judged
  by the expiry heuristic — not blanket-flagged — so a legitimately durable unsigned asset stays
  `resolvableNow` and silent. A **schemeless/relative** value (no `http(s)` scheme — e.g. an ACP
  `cloud-content/…` blob path) is NOT directly fetchable and is flagged `some_missing`
  (`unresolvableReason: "stored-path"`) unless the backend supplies a `durable: true` hint for it (which
  is authoritative and re-mints it server-side). Do not treat a baked stored path as reusable.
- `rerunAssets.status === "none"` → the graph has no input-asset leaves (nothing to reuse); rerun
  normally.

Each leaf carries an `assetRole`: `"input"` (an `input-*` node's own asset) or a **static** asset the
workflow itself depends on — `"template"` (merge-data / data-merge-psd), `"font"`, `"dgr-preset"`, or
`"ps-action"`. The leaf's `reattachVia` is derived directly from this role and tells you the ONLY valid
re-attach route — never guess from the missing-ness alone:
- `assetRole: "input"` → `reattachVia: "input"`: re-attach a fresh file in the matching `inputs[]` slot.
- `assetRole: "template"` → `reattachVia: "template"`: route through `inputs[].template.presignedUrl`
  or a `compose_workflow` rewire (next section). NEVER submit a template as a bare `inputs[].content` /
  plain input targeting the merge node — that returns `invalid_input_target`.
- `assetRole: "font" | "dgr-preset" | "ps-action"` → `reattachVia: "rewire-only"`: these are not
  submittable as inputs at all; change them in the Workflow Builder or via `compose_workflow`.
A published workflow's static assets are CAS-durable (`durable: true`) so they stay `all_resolvable` and
silent; a raw/draft rerun with an expired, non-durable one surfaces as `some_missing` with that
`assetRole` — re-attach it via its `reattachVia`, because a re-attached template may not be the same one
the graph was wired for (hence the rewire route, next section).

`run_workflow_submit` runs this same audit as a **preflight** on every submit that resolves a graph —
a `batchId` rerun, a bare `workflowId` (never-run or with `inputs[]`), and a draft — not just hot
same-assets reruns. The preflight is **per-slot**: supplying fresh `inputs` for some slots no longer
blinds it to a *different* still-missing asset — it excuses only the slots you actually override and
audits the rest. If any non-overridden **input** is missing it returns a `status: "needs_reattach"`
result (with the `rerunAssets` list and a hint) **before creating a batch** — nothing is submitted, so
a skill-less caller cannot fire a doomed batch that fails at the first processing node. This includes
the zero-leaf `missing-required` case: a never-run published workflow whose used input has no source
is hard-refused up front, naming the slots. Surface that to the user and collect the re-attachments;
don't retry the submit until you've supplied the missing `inputs`. (A missing *template* is not a
re-attach — it routes through the `needs_rewire` / `missing_template` guards below instead.)

### Confirm a bare same-assets rerun (`needs_confirmation`)

"Rerun the workflow" with no fresh `inputs[]` — a bare `workflowId` (anchored to its most-recent run) or
a `batchId` reproduce — reuses the prior run's assets. Even when those assets are still warm (unexpired
presigned URLs, or a durable static re-minted server-side), reusing them **without asking** is an
assumption the user may not have intended: they may want the same assets, or may have meant to swap some.
So on **every** bare same-assets rerun, `run_workflow_submit` stops **once** and returns
`status: "needs_confirmation"` — carrying the `rerunAssets` it would reuse — **before creating a batch**.

- Relay the assets to the user (identify each by `filename`/`nodeId`) and confirm this is what they want.
- To proceed with the **same** assets, resubmit the identical call with `confirmRerun: true`.
- To run with **different** assets, resubmit with fresh `inputs[]` instead — supplying inputs is itself
  the choice, so it needs no `confirmRerun`.

This is distinct from `needs_reattach`: that fires when a reused asset can no longer be resolved (expired,
non-durable), and it takes precedence — the confirm gate is reached only when the assets are still warm.
A rerun that already supplies `inputs[]`, and a never-run workflow (no prior assets to reuse), never hit
this gate. Do NOT set `confirmRerun: true` on a first/normal submit — only after the user has confirmed.

**Which sources fire `needs_confirmation` (a deliberate per-source contract).** The one-time confirm
gate fires only on the **batch-anchored** bare rerun — a `batchId` reproduce, or a bare `workflowId`
that resolved to a specific prior batch's frozen graph. It replays a SPECIFIC run's assets, which may
include a one-off custom asset from that single run, so confirming-before-reuse is warranted. It does
**NOT** fire on:
- an **interface/preset** resolved via `getPresetDefinition` — that returns the interface's *current
  baked defaults*, not a prior run's one-off assets, so there is nothing surprising to confirm; and
- a **never-run published workflow** (no anchor batch) — there are no prior assets to reuse.

For those two, ASK-FIRST before running is *your* responsibility per the tool description (confirm the
user's intent), not a structured gate. A `batchSource: "preset"` tag on an anchored batch does NOT move
it to the interface path — the "an interface never needs confirmation" guarantee belongs only to a graph
actually resolved via `getPresetDefinition`.

### Rerun with a NEW template (a tag diff decides run-as-is vs. rewire)

A dynamic-port merge node's input ports ARE its current template's tags/layers, so dropping a
**different** template's URL into the old ports silently misroutes content — but a template whose
placeholders **match** the existing ports needs no rewire at all. So `run_workflow_submit` does not
guess from URLs: when you supply `inputs[].template` for a `merge-data` / `data-merge-psd` action
**without** a composed `session_id`, it **describes the new template** (`get_indesign_tags` /
`get_psd_tags`, session-cached) and **diffs its tags against the merge node's current ports**
(`computeTagDiff`). The diff — not the URL — decides the outcome:
- **Empty diff** (no placeholder added, removed, or text↔image type-changed): the existing wiring is
  valid for the new template, so the submit **proceeds as-is** — no compose round-trip. The backend
  still swaps in the supplied template file; the graph just reproduces the same ports. (This is the
  common "same template family, new copy" rerun — don't force a needless compose.)
- **Non-empty diff** — and **a Matrix graph is available** (a Workflow Builder draft, or a
  Builder-published `ui.json` sidecar surfaced as `uiGraph`): returns `status: "needs_rewire"` (NOT
  `submitted`), carrying that **Matrix** graph as `currentGraph` **and the concrete `diff`**
  (`removed` / `added` / `changedType` / `unchanged`) so you can see and relay exactly which
  placeholders changed. Route it through compose: `compose_workflow({ current_graph: <that
  currentGraph>, customTemplateUrl: <the new template url>, csvData: <the customer CSV> })` —
  **passing `current_graph` is required**; a bare `customTemplateUrl` with no base graph returns
  `no_base_graph` (compose rewires an existing base, it does not build net-new). Then
  `run_workflow_submit({ session_id, inputs })` with the returned session. If compose returns
  `csv_validation_failed`, the CSV headers don't cover the new template's tags — surface that and stop;
  do not force the run. (If the new template's tags can't be read at all, the guard falls back to
  `needs_rewire` **without** a `diff` — a safe default, since a matching template just recomposes to
  the same graph.)
- **No Matrix graph exists** (a native/API `run-workflow` publish with no matrix, a preset/interface,
  or a raw/ad-hoc batch run — all stored in execution form only): returns
  `status: "no_editable_graph"`. The rewire engine edits only a Matrix graph and the MCP does **not**
  synthesize one via a lossy reverse conversion, so a template change here is not rewireable. Surface
  the honest diagnosis: tell the user to change the template in the **Workflow Builder** (which produces
  an editable Matrix graph) or to rerun **without** a template change. Do not resubmit as-is.

**After a re-wired run, offer to persist the new wiring.** When a submit executes a graph that came
from a composed/rewired `session_id` (the compose happy-path, or the `needs_rewire` → compose route
above), the `submitted` result carries a `postRun` block — `{ rewired: true, sessionId, options:
["save_workflow", "publish_workflow", "create_preset"] }`. Once `run_workflow_get_status`
reaches `completed`, offer those three so the re-wired workflow isn't lost: **save the draft**
(`save_workflow`, keep editing in Builder), **re-publish** (`publish_workflow`, new/updated
`workflowId`), or **update/create a preset** (`create_preset`, template baked in) — all keyed off
`postRun.sessionId`. `postRun` is scoped to a `compose_workflow` (rewire/compose) session: a plain
input-swap rerun and a plain `get_featured_workflow` run of an uncustomized featured base (its `feat-`
session never rewires) carry **no** `postRun` block, so don't prompt to persist there.

A template supplied **with** a `session_id`/`useSessionDefaults` is already rewired (the compose
happy-path) and passes through. Only the two **dynamic-port** merges (`merge-data`, `data-merge-psd`)
carry a template in their **own** params and rewire. Every other template consumer has **fixed or
hybrid** ports and takes its template from an **upstream `input-*` node** → the consumer's template
port — so it **never** rewires: **DGR** (`dgr-render-template`/`dgr-merge-template`), InDesign data-merge
**v2** (`merge-data-v2`), Illustrator data-merge (`data-merge-illustrator`), and `data-merge-html5`. For
these, a replacement template (e.g. a new DGR `.mogrt`) is attached as `inputs[].content` on that
**upstream input node** (audited as `assetRole: "input"`), NOT as an `inputs[].template` on the consumer
node — the durable/expired mogrt is reused/reattached exactly like any other input asset. Graphs with no
template consumer at all are tag-free and submit as-is.

**Prefer `by_id` for a durable published rerun.** A published workflow's durable assets are re-minted
only on the backend *definition* resolve path, so a `workflowId` (`by_id`) rerun re-resolves them
fresh. A `batchId` rerun runs the frozen inline graph, whose captured per-run URLs expire — but any
leaf the definition marks durable (`durable: true` in the map: the statics, plus whatever inputs the
publish baked into CAS) is still recoverable, so `run_workflow_submit` transparently re-routes that
`batchId` rerun by `workflowId` to re-mint it (statics *and* durable inputs alike). Only a leaf that is
genuinely non-durable and expired — a per-run input the definition never captured — surfaces as
`some_missing` and needs a re-attach (or switch to `by_id`).

**Presets/interfaces now reach the same durable-asset parity as published.** A preset's static assets
(templates, fonts, DGR presets, PS-action JSON) are stored durably alongside its definition, so
`inspect_run` populates `rerunAssets.durable` for a preset just like a published workflow — a durable
static reads `durable: true` and stays `all_resolvable`/silent (re-minted server-side on the resolve
path), and only the ephemeral per-run inputs (which are never reproduced from the definition) can
surface as `needs_reattach`. You do NOT prompt to re-attach a preset's template/fonts on a same-assets
rerun; you only prompt for the run's own inputs when their frozen URLs have expired.

**A durable-static rerun re-routes by `workflowId` so the backend re-hydrates.** Freshening an expired-but-durable static requires the backend definition-resolve path (the only place fresh SAS is minted);
the MCP cannot mint static SAS itself and the frozen inline graph holds dead URLs. So when a `batchId`
rerun's preflight would have prompted on a static that the durability map excuses (durable, but its
frozen URL looks expired), `run_workflow_submit` submits **by `workflowId`** — dropping the inline
graph — and carries that anchor batch's still-valid per-run **inputs** forward explicitly (expired,
non-overridden inputs still drive the re-attach prompt). This is why you must **never pass inline
`actions`/`connections` on a `by_id` rerun**: the whole point of `by_id` is to let the backend
re-resolve and re-mint durable assets, which an inline graph would bypass. Within the SAS window (all
frozen URLs still valid) the tool keeps the exact inline replay — no re-route, no extra reads.

**Reuse-as-is rule of thumb:** an asset URL needs no upload/re-sign when the URL string itself
proves it's valid — an Azure blob URL with a `sig` param and a future `se=` expiry, or an S3 URL
with `X-Amz-Signature` plus `X-Amz-Date`/`X-Amz-Expires` not yet elapsed. For those, change
nothing. The fastest rerun does no client-side asset work at all: prefer `by_id` (workflowId
alone) so the whole question is moot.

**Per source:** published → `by_id` (or `inline_exact` by batchId); preset/interface → `inline_exact`
by batchId (or `by_id` by workflowId — backend resolves the newest interface graph); inline →
`inline`/`inline_exact`; draft → `by_id` (never inline-resubmit its raw nodes/edges graph). A transient
`/preview` run is ephemeral — not in history, not re-runnable; offer to compose/run fresh.

**Picking by name:** `list_workflow_history` rows now carry a human-readable `name` for published and
named-draft workflows — use it to match a user's named request. When `name` is absent (inline/preview
rows, or the blob-scan fallback), fall back to matching against the `workflowId` slug. Either way pass
the resolved `workflowId` — there is still no server-side name→id index, so a free-text name isn't a
lookup key on its own.

## Submit-time preflight guards (structured diagnoses instead of a raw backend throw)

`run_workflow_submit` runs a set of preflight checks on a locally-resolved graph and returns a structured
status — with an actionable hint — instead of letting the backend throw a cryptic error. They fire
only when the graph is resolved locally (a draft, inline, or composed submit); a bare published
`workflowId` rerun skips them (the backend owns wiring there). When you get one of these, relay the
hint and stop — do not retry the same submit.

**Multiple blockers surface together (`needs_preflight`).** A first run commonly trips more than one of
these at once — e.g. a missing data-merge template AND an un-defaultable output destination. Rather than
force you to rediscover each on a separate submit (a slow one-problem-per-round-trip cascade), the two
"supply-a-required-thing" guards (`missing_template`, `needs_output_destination`) run together and, when
two or more coexist, are returned as a single `status: "needs_preflight"` whose `blockers[]` array holds
each individual result verbatim (its own `status`, `reason`, and `hint`). Fix **every** blocker, then
resubmit **once** — fixing only one just surfaces the rest. When exactly one fires it still returns its
own single status (back-compat). The `invalid_input_target` and `unsupported_override` guards are NOT
aggregated — a mis-targeted input or an unhonorable `input-3d` override is a malformed submit (and a
mis-placed asset may itself be the "missing" template), so they short-circuit first; fix the graph, then
resubmit. A `needs_rewire` / `no_editable_graph` / `graph_unresolved` diagnosis likewise routes through
`compose_workflow` or the Workflow Builder and is not aggregated.

The fastest way to avoid the whole cascade on a **first run from a draft**: call `inspect_run(workflowId)`
BEFORE submitting to read the required inputs and any empty template slot up front, gather them from the
user in one pass, and submit them together — don't discover requirements by submitting and reading errors.

### Data-merge template not supplied (`missing_template`)

A `merge-data` / `data-merge-psd` node **requires** a template (`.indd` / `.psd`) to run. The submit
path returns `status: "missing_template"` (with `mergeNodeId` and `actionType`) when no template is
present in either the stored graph's `parameters.templates[]` **or** the caller's `inputs[]`. When the
template was detected in the wrong place (a content item on an input node), `misplacedOnNodeId` names
that node.

**The only correct way to supply a template at submit time:**

```jsonc
{ "node_id": "<merge-node-id>", "template": { "presignedUrl": "...", "name": "template.indd", "storageType": "aws" } }
```

**NEVER** pass the template as a `content[]` item on an `input-files` or any other input node — that
silently mis-routes the asset (it becomes a plain file input) and `parameters.templates[]` stays empty,
producing `"merge-data requires at least one template file"` from the backend. `run_workflow_submit`
now catches this before it reaches BatchExecute.

**NEVER** put the template URL in a `workflowTemplateUrl` / `templateUrl` / `indesignTemplateUrl`
parameter either. Those are graph **node-data authoring fields** (often a non-presigned CloudFront
reference), read by the Workflow Builder for display — the backend **never** reads them when the action
runs, so a merge node whose only "template" is a `*TemplateUrl` still fails with the same *"requires at
least one template file."* The flattener now strips these fields from execution `parameters` so they
can't masquerade as a template; the sole runtime source is `parameters.templates[]`, produced from the
`inputs[].template` shape above (or, on a rewired session, applied automatically from the composed
template — no `useSessionDefaults` needed). See `featured-and-templates.md` for the full callout.

**Pre-run visibility.** `inspect_run` now surfaces required-but-empty template slots as an
`assetRole: "template"` / `reattachVia: "template"` / `unresolvableReason: "missing-required"` leaf
in `rerunAssets.inputs` — you no longer need to hit the backend error to discover the requirement.
Upload the template via `upload_asset`, then supply it as `inputs[].template.presignedUrl` on the
merge node.

### New assets map ONLY to `input-*` nodes (`invalid_input_target`)

An `inputs[]` entry addresses a node by `node_id` (or `actionId`), and only an **input node** accepts
one — every input type is named `input-*` (`input-images`, `input-videos`, `input-audio`, `input-text`,
`input-files`, `input-3d`, plus `input-ibl`, `input-graph`, and any future one). Targeting any other
node — most often the `merge-data`/InDesign node (trying to swap the template) or the terminal
`write-files` node — used to fall through to the backend and throw the opaque
`No input action found with actionId "…"`. The MCP now catches it first and returns
`status: "invalid_input_target"` carrying `{ nodeId, actionType, validInputNodeIds }`. Membership is
decided SOLELY by the catalog: a node is an input node when its catalog entry has
`workflowRole === "source"`. There is no `input-` name-prefix fallback — the catalog is the single
source of truth, and legacy canvas wrapper types (`imageInput`, `multipleImageInput`, `binaryInput`, …)
resolve through their modern source entry's `aliases`. If the action catalog has not loaded, the
classifier fails loud (`getCachedCatalog()` throws `OFFLINE_CATALOG_MESSAGE`) rather than silently
degrading to a name guess. The shared classifier lives in `input-classification.ts`
(`isInputNodeType`). The catalog is not a frozen list, so a new input node type is accepted automatically
once it ships as a `workflowRole:"source"` entry, rather than being falsely rejected — `validInputNodeIds`
lists every input node in the graph:

- Re-target the asset to one of the listed `validInputNodeIds` (the graph's actual `input-*` nodes).
- To change a **template** on a `merge-data` / `data-merge-psd` node, do NOT use `inputs[]` — that
  routes through the rewire path (`compose_workflow`); see "Rerun with a NEW template" above.
- A slot `inspect_run` reports as `durable: true` is already re-minted server-side on a rerun — leave
  it alone; re-sending it as an input is unnecessary and, if it targets a non-input node, is exactly
  what trips this guard.

### 3D-scene override on an `input-3d` node (`unsupported_override`)

`input-3d` is a valid input node, so it passes the `invalid_input_target` guard — but 3D-scene wiring
is **not on the MCP path yet**, so an asset supplied via `inputs[]` for an `input-3d` node has no
ingestion mapping and would be **silently dropped** (the run would proceed with the ORIGINAL scene while
you believe your swap took). To make that honest, `run_workflow_submit` detects an override (a `content[]`
or `template`) targeting an `input-3d` node and returns `status: "unsupported_override"` carrying
`{ nodeId, actionType }` instead of no-op'ing.

- To change the 3D scene/asset, open the workflow in the **Workflow Builder** (which owns 3D-scene
  wiring end to end) and re-save/re-publish it — do NOT resubmit the same override.
- To rerun with the existing 3D scene unchanged, drop that `inputs[]` entry and resubmit.
- This is the only currently-unsupported override on an otherwise-valid input node; every other
  `input-*` type ingests its `inputs[]` asset normally.

### Write-files output destination (`needs_output_destination` + auto-backfill of the default folder)

A `write-files` (Output assets) node's `storageDestination` is only the *kind* of destination; the
actual folder lives elsewhere per kind: `yourFiles` → `exportTarget.path`; `frame` →
`exportTarget.accountId` + `folderId`; `aem` → `aemFolderTarget.repositoryId` + `folderUrn`. The
Workflow Builder backfills a default **Your Files** folder client-side at submit time, but an MCP rerun
bypasses that — so a saved `yourFiles` node with an empty path used to reach the backend and hard-throw.

**`"requires parameters.storageDestination"` is a converter parity gap, not a draft misconfiguration.**
`storageDestination` (and `frameExportTarget`) live at the top level of the `write-files` node's `data`,
not inside `data.parameters[]`. The MCP flattener's catalog-def loop only reads param names from
`data.parameters[]`, so it once dropped these top-level fields — the submitted `parameters` carried only
`{ actionType, exportTarget }` and the backend 500'd with `"requires parameters.storageDestination"`
even though `inspect_run` showed the draft correctly set (e.g. `storageDestination: yourFiles`). The
server-side legacy translator always carried the field (`WriteFilesNode.ts`), so the two flatteners had
drifted. The converter now copies `node.data.storageDestination` / `frameExportTarget` into execution
`parameters`, closing the gap — do NOT tell the user to reconfigure the Output node for this error.

- **Your Files is auto-fixed.** The submit path now reproduces the frontend injection: a `yourFiles`
  node (or one with no `storageDestination`, which defaults to Your Files) whose path is empty/blank is
  backfilled to `cloud-content/workflow-builder/<outputFolderId>/outputs` (where `outputFolderId` is the
  workflow's `documentId ?? workflowId`) and the submit proceeds. A user-picked path is left untouched.
  So a default Output-assets node "just works" on rerun — no prompt needed.
- **Frame / AEM can't be defaulted → `needs_output_destination`.** When a `frame` or `aem` node has no
  folder target (or the rare `yourFiles` case with no id to build a default from), the submit returns
  `status: "needs_output_destination"` with `problems[]` naming each offending `{ nodeId,
  storageDestination }`. Tell the user to pick an output folder in the Workflow Builder cloud picker and
  re-save/re-publish; there is no submit-time folder override for frame/aem. This is a **non-fatal
  diagnosis** — the backend stays authoritative (e.g. it skips the check for tech-account users), so
  present it as guidance, not a hard block.
- **Pre-run visibility.** `inspect_run` surfaces the same signal as `outputDestinations`
  (`{ status, nodes: [{ nodeId, state }] }`, where `state` is `will_default` | `configured` |
  `needs_destination`) so you can flag an un-defaultable destination before ever submitting.

### Structurally un-runnable graph (`invalid_workflow`)

Before the backend call, `run_workflow_submit` runs the **same validators as `validate_workflow`**
(`validateWorkflow` + `validateWorkflowStructure`) on a locally-resolved graph, so a wiring mistake
fails on its merits here instead of deep in the Durable run. It returns `status: "invalid_workflow"`
with an `errors[]` array (`{ code, message, actionId? }`) only for the genuinely **un-runnable**
faults — a required input port with **no incoming connection** (`UNCONNECTED_REQUIRED_INPUT`), **two
connections into one input port** (`MULTIPLE_CONNECTIONS_TO_PORT`), a **cycle** (`CYCLE_DETECTED`), or
a connection that **dangles off a non-existent node** (`MISSING_SOURCE_ACTION` / `MISSING_TARGET_ACTION`).
Fix the wiring per `errors` (connect the required inputs, remove the duplicate/dangling connection,
break the cycle) — or re-run `compose_workflow` / `validate_workflow` — then resubmit. Nothing is
auto-corrected; the graph is rejected as-is.

- **Wasteful-but-runnable findings are warnings, not blocks.** An **orphaned node** (`ORPHANED_NODE`,
  its output unused) and an **unreachable node** (`DISCONNECTED_NODE`, not reachable from any source)
  do **not** block — the connected part of the graph still runs. They ride along on a **`submitted`**
  result as a `warnings: string[]` array (each `"[CODE] message"`). Surface them if useful, but the run
  proceeded. `DISCONNECTED_NODE` is intentionally non-blocking because it also fires on a partially-wired
  graph and on any catalog drift (an unrecognized node type isn't classed as a source), so blocking on
  it would regress runnable submits.
- **Templated merge nodes are exempt from the required-input check.** A `merge-data` / `data-merge-psd`
  node resolves its ports from the template at runtime, so an unconnected "required" port on one is never
  flagged `UNCONNECTED_REQUIRED_INPUT` (a missing *template* is the separate `missing_template` guard
  above).
- **When it does NOT run.** Like the other preflight guards, structural validation fires only when a
  local graph is resolved (draft / inline / composed / batch-replay). A bare published `workflowId` rerun
  with no local graph skips it (the backend owns wiring). It also skips silently if the action catalog is
  unavailable, rather than risk a false block.

### A published workflow that fails at EVERY submit shape → the definition is likely corrupt (diagnose + STOP, never re-compose)

When the user says *"run this published workflow"* and a bare `workflowId` run fails — and every
variation you try (with `inputs[]`, with `inputs: []`, with an inline graph) also fails — with errors
drawn from this set:

- `Workflow has no input actions (…)`
- `Workflow with actions and connections is required`
- `invalid_input_target` with an **empty** `validInputNodeIds: []`
- `Circular dependency detected involving action: undefined`

then the stored definition is almost certainly **not in executable form**. It was published from a raw
React-Flow graph (nodes keyed by `id`, the real type buried under `data.actionType`, edges using
`source`/`target`) instead of the flattened `actionId` / `actionType` / `connectionSource` /
`connectionTarget` contract. The executor keys on the top-level `actionType`/`actionId`, so a graph
missing them has no recognizable input nodes and no real dependency edges — which is why all of these
symptoms appear at once for the same workflow.

**What to do:** relay a one-line diagnosis — *the published workflow is stored in a non-executable
form and must be re-published correctly* — and **STOP**. Do **NOT** keep trying submit shapes, and do
**NOT** fall back to `compose_workflow` to rebuild the graph yourself. The user asked to *run an
existing* published workflow, not to author a new one; composing is a different, un-asked-for action
(the only compose-from-run route is the narrow new-template rewire — `needs_rewire` /
`no_editable_graph` — which does not apply here). The fix is to re-publish the workflow properly: from a
`compose_workflow` session_id, or from the Workflow Builder — both emit the executable graph. (Newer
`publish_workflow` normalizes-or-rejects such graphs, and the backend fails closed with `Workflow
contains actions without an actionType`, so a freshly published workflow won't hit this; this signature
means a definition published before that guard, or by another client.)

**A resolved interface with no runnable graph → `graph_unresolved`.** A narrower, structured form of the
same corruption: when `getPresetDefinition` resolves an **authoritative interface** (so it *should*
carry a graph) but neither it nor the `getWorkflowDetail` fallback yields an execution-shaped graph, and
you supplied fresh `inputs[]`, `run_workflow_submit` returns `status: "graph_unresolved"` rather than
passing the inputs to the backend un-validated (which would fail deep — "false confidence"). Treat it
like the corrupt-definition case above: relay *the interface has no runnable execution graph and must be
re-saved/re-published in the Workflow Builder*, and **STOP** — do not retry submit shapes. To rerun the
existing configuration unchanged, resubmit with **empty `inputs[]`** (the backend resolves the workflow's
own baked defaults by id). Note this fires ONLY for a `getPresetDefinition`-resolved interface; a plain
headless/API-published source with no local graph is legitimately runnable by id and is never blocked
here.

**First-run paradigm for a *correctly* published workflow.** `inspect_run` may report `rerunAssets:
{ status: "none", inputs: [] }` for a never-run published workflow even though it has inputs — the
stored input assets are stripped at publish, so do NOT read that as "nothing to collect." Discover the
input node ids from the submit **preflight**, not from `inspect_run`: submit `workflowId` +
`inputs: []`, read the `needs_reattach` result's `rerunAssets.inputs[].nodeId`, then resubmit
`workflowId` + `inputs[]` targeting those node ids (see "Rerun with the same assets" above). If that
`inputs: []` preflight itself fails with one of the signatures above, you are back in the corrupt-publish
case — diagnose and stop.

## Error diagnosis

When `inspect_run` returns failed actions, the `diagnostic` field pre-computes the key signals. Use
them to explain what went wrong without asking the user to dig into raw JSON.

**`errorCategory`** — classification of what failed:

| errorCategory | Meaning | Suggested fix |
| --- | --- | --- |
| `validation_error` | Input rejected before the API was called | Check presigned URL expiry, input format, or required fields |
| `auth_error` | The downstream API rejected the auth token | Check credential expiry or API key validity |
| `rate_limit_error` | API quota exceeded | Reduce batch concurrency or wait before retrying |
| `downstream_error` | The upstream API returned an error response | Check `responseBody` in the action logs for details |
| `system_error` | Platform error (unknown actionType, wiring issue) | Verify actionType is spelled correctly and registered |
| `polling_timeout_error` | Job started but never reached a terminal state | The upstream job may still be running; check directly or retry |

**`phase`** — where in the pipeline the failure occurred:

| phase | What it means | Where to look |
| --- | --- | --- |
| `validation` | Input rejected before any API call | Fix the input (expired presigned URL, wrong MIME type, missing required field) |
| `setup` | Config/wiring error before execution | Check actionType spelling, predecessor output exists, connections correct |
| `execute` | Downstream API returned an error | Inspect `logs[].details.responseBody` for the upstream error message |

On a failed workflow: present the error diagnosis and **stop**. Do not auto-retry, re-wire, patch
connections, or resubmit. Ask the user what they want to do next.

## Known error patterns

**Image port item-count mismatch** — error message contains `"Connected inputs have mismatched item
counts"` with `"image" has N` (small number = uploaded images) while text ports (`"Headline"`,
`"Subcopy"`, etc.) have `M` (larger number = CSV rows):

- **Root cause:** the image port was direct-wired (`input-images → merge-data`) while parse-data
  drove the text ports from CSV rows. This happens when `csvData` was not passed to
  `compose_workflow` — the server soft-blocked and fell back to direct-wiring all image ports.
- **Fix:** recompose with `csvData` set to the customer's CSV text. Do NOT retry by changing
  `message` — the deterministic path ignores `message` for routing. Do NOT submit again with the
  same graph.

**InDesign placeholder mismatch** — InDesign error 107013 (`data placeholder cannot be found in the
data source`), or cells silently drop in merge output. This one error has **three** distinct causes;
disambiguate before acting:

1. **Wrong / absent CSV.** The user's CSV was never wired to the `input-files` node, so `parse-data`
   ran on the workflow's baked sample CSV — whose columns don't match the custom template's
   placeholders. Signal: `workflowJson` shows the `input-files` node with no user CSV, or the merge ran
   on unexpected copy. **Fix:** wire the user's CSV to the `input-files` node with `mimeType:
   "text/csv"` and resubmit (see the CSV callout in
   [`featured-and-templates.md`](featured-and-templates.md)).
2. **Merge-data port ↔ template placeholder case mismatch** *(the most common actual cause)*. The
   data-source header InDesign matches against is derived from the **merge-data input port name** (the
   edge `targetHandle`), case-preserved — **not** from the CSV header (`parse-data` lowercases the header
   to a slug and it is then discarded). InDesign matching is **case-sensitive**, so a merge port named
   `headline` fails against a template placeholder `Headline`. This happens when the graph was rewired
   through the `message`/LLM path or the merge ports were hand-edited, leaving the base graph's
   lower-case port (product-banners-at-scale **v1** ships a lower-case `headline` port) in place. The
   deterministic `customTemplateUrl` rewire does **not** cause this — it always rebinds ports to the
   custom tag's exact case. Signal: the merge runs for a while (InDesign opened the template) then fails
   107013; the failing
   placeholder differs only in case from the wired merge port. **Fix:** recompose via the deterministic
   `compose_workflow(customTemplateUrl=…)` path (not `message`) so `applyRewirePlan` rebinds each merge
   port to the template tag's exact case; verify via `inspect_run` that each merge-data input port name
   equals the template tag exactly (case included). **Editing or re-casing the CSV header does not
   help** — that text is discarded. Do **not** retry by changing `message`. (Image columns are a related
   but separate check: an image tag `image` needs an `@image` CSV column — the `@` is mandatory — see the
   coverage check in [`featured-and-templates.md`](featured-and-templates.md).)
3. **Renamed asset.** An upstream processing node (crop, lightroom, remove-background) renamed the
   asset (e.g. `jacket.png` → `jacket_1678_1679.png`) while the CSV still references the original name.
   **Fix:** check whether `csvFanout`'s `sourceName` fallback is wired (FFENT-17217). If the workflow
   predates that fix, add a `modify-file-attributes` node to rename processed assets back to their
   original basename, or update the CSV to match the processed filenames. (Also confirm each
   `input-images` entry carries `name` = the clean CSV filename — a missing `name` produces a
   UUID-suffixed basename that reproduces this mismatch.)

**Merge-data "requires at least one template file"** — the merge-data (or create-rendition) node ran
with no InDesign/PSD template attached:

- **Root cause:** on a custom-template rewire, `parameters.templates[]` reached the backend empty.
  A `session_id` submit now injects the cached composed template automatically (no `useSessionDefaults`
  needed), so on a session submit this almost always means the cached presigned template URL **expired**
  (~1h), or (on an InDesign open/script error) it loaded but couldn't be read. It can also mean the
  template was passed in the wrong place — a `content[]` item or a `workflowTemplateUrl`/`*TemplateUrl`
  parameter, neither of which is a runtime template source (see the `missing_template` section above).
- **Fix:** re-upload the template with `upload_asset` and attach it explicitly to the merge-data node
  via `inputs[]: { node_id, template: { presignedUrl, name, storageType } }` (see
  [`featured-and-templates.md`](featured-and-templates.md)). Do not resubmit the same graph unchanged.

