# Creative-brief and banners-at-scale intake

Load this when the user uploads, pastes, or attaches a document that looks like a creative/marketing
brief — before any workflow has been named — **or** asks to create/compose a banners-at-scale
(template + CSV data merge) workflow. This checklist covers **product banners at scale**
(v1 scope); other briefs use the general composition guidance in [`compose.md`](compose.md).
Without a brief, skip to Step 4.

> **Composition by default:** a brief is input for a new `compose_workflow` graph, not authorization
> to select a featured template. Do not call `list_featured_workflows` / `get_featured_workflow` or
> pass `featuredWorkflowName` unless the user explicitly requests a featured/predefined template.
> A bare user "run banners at scale" with no brief is a **golden** run
> request — route it to `list_golden_workflows`, not here. See [`diagnostics.md`](diagnostics.md) →
> "Running a golden demo by name."
>
> Golden demos are not a brief-classification source. If the user explicitly requests a featured
> template for the brief, follow [`featured-and-templates.md`](featured-and-templates.md), Flow A;
> otherwise use Flow B for supplied INDD/PSD templates.

## What counts as a creative brief

- Signals: campaign/brand name, target audience, messaging/CTA, a list of ad sizes/dimensions, visual
  direction, production notes.
- If the doc is clearly something else (an invoice, a contact sheet, loose asset files with no brief
  text), don't treat it as intake — fall through to normal `run-workflow` behavior.
- DOCX checkbox note: `☒` means checked/selected, `☐` means unchecked. Record `☒` selections as given;
  never treat an unchecked `☐` as an answer.

## Step 1 — Classify: is this "product banners at scale"?

| Signal in the brief | Verdict |
| --- | --- |
| Display/web banners, multiple standard IAB ad sizes (leaderboard, MREC, skyscraper, mobile banner), product photography + headline/CTA, "scaled"/"at scale"/many variants, per-size or per-SKU copy | **Supported** — product banners at scale |
| Video, motion, spin/360, 3D scene/render | Not supported (today) |
| Retargeting-specific dynamic-user-state ads as the explicit ask (not just "banners") | Not supported (today) |
| Localization-only (same creative, just translate) with no size/scale request | Not supported (today) |
| Packaging / packshots / catalogs-and-circulars / promotional-pricing-only | Not supported (today) |
| Print-only deliverables (no digital ad sizes) | Not supported |

This checklist classifies production requirements, not featured catalog matches. Do not look up
`product-banners-at-scale` merely because the brief fits. A brief outside this checklist uses general
composition, not a silently selected featured workflow.

If the brief is ambiguous or mixed (e.g. "banners AND a launch video"), ask one clarifying question
naming the ambiguity before deciding. Only stop once you're confident the primary ask isn't
banners-at-scale.

## Step 2 — Outside this checklist

For video, retargeting, localization, packaging, 3D, or other briefs, use [`compose.md`](compose.md)
and live action/schema discovery to establish supported processing and missing inputs (a supplied
`.usdz`/`.glb` goes to `compose_workflow` as `sceneUrl`). Do not claim
the product cannot support them just because this banners checklist does not cover them. Never
silently select a featured workflow.

## Step 3 — Three-state field resolution (fill / ask / absent)

| State | Meaning | Rule |
| --- | --- | --- |
| **Fill** | Brief states it explicitly | Use verbatim — never reinterpret or reword |
| **Ask** | Brief implies the field exists but the value is missing or unclear | Ask one focused question |
| **Absent** | Brief never mentions it, and the field is optional | Leave unset — don't guess a default and don't ask |

Key sub-rules:

- Never infer or guess a missing **required** value — always ask. A required field with no evidence is
  "ask," not "absent."
- Ask **one question at a time** for narrative fields (audience, messaging, CTA). It's fine to **batch**
  the required-upload ask — e.g. "please share your InDesign/Photoshop/Illustrator template and the
  merge CSV" — since those are independent uploads, not sequential judgment calls.
- Never re-ask something already given in the brief. If the user says "it's in the brief," re-read it,
  correct your extraction, and move on.
- **Non-standard size rule**: if the brief lists a size close to but not a standard IAB size (e.g.
  720x90 where 728x90 is standard), flag it and ask — never silently "correct" it.

## Step 4 — Gather inputs: required first, infer the rest, then optional

The graph agent designs the graph (node versions, merge/parse wiring, renderer branches, Preview)
from the attached files. Your job is to get the right files and the user's intent — not to plan the
graph. Assume the user wants to **compose and run** unless they explicitly say otherwise.

### 4a — Required (block until provided)

| Input | Formats | Ask if missing |
| --- | --- | --- |
| Template | InDesign (`.indd`/`.idml`/`.zip`), Photoshop (`.psd`), or Illustrator | "Please share the InDesign, Photoshop, or Illustrator template for the banners." |
| Merge CSV | `.csv` — one row per variant; `@`-prefixed columns hold image filenames or URLs | "Please share the CSV with one row per banner variant." |

Batch the ask if both are missing. Do not compose a banners-at-scale workflow without both unless
the user explicitly asks to compose with only what they've given (see 4e).

### 4b — Infer from the files (don't ask when the files answer it)

- **Sizes / pages** come from the template. Don't ask which sizes to render; render all of them
  unless the user asked for a subset. If the brief lists sizes the template doesn't contain, flag
  the mismatch once.
- **Copy** (headline, CTA, …) comes from the CSV. Don't ask for copy that's in the CSV.
- **Image sources**: read the CSV's `@` columns and match each filename value against the images
  the user already attached (by basename). URL values need nothing. If every referenced file was
  attached, there's nothing to ask — just confirm in one line ("Using `background.jpg` and
  `background_expanded.jpg` for the `@background` columns"). Ask only for files that are
  referenced but missing ("Your CSV references `hero-2.jpg` — please upload it"). Never compose
  as if images were absent when the user attached them.
- **Tag ↔ column coverage** is checked by `compose_workflow` itself (it reads the template's tags
  and validates the CSV). Don't call `get_indesign_tags` / `get_psd_tags` / `list_actions` first.

### 4c — Optional (ask once each, only if not already provided)

- **Fonts** — "Does the template use custom fonts that aren't embedded? If so, please share them
  (otf/ttf/woff/zip)." Skip if fonts were supplied or the user says no.
- **Images referenced by the CSV but not uploaded** (from 4b).

### 4d — Intent (not inferable from files — ask if not stated)

- **Output**: keep the native document (INDD/PSD) or render to **JPG / PNG / PDF** (multi-select).
- **Delivery**: preview only (default) or save/deliver to storage (Adobe Files, AEM, Frame.io).

Ask one `ask_user` question at a time with choices. Never ask about node versions, ports, tag
mapping or wiring — that's the graph agent's job.

### 4e — "Compose only" path

If the user explicitly says to compose with just the information provided (e.g. "just build the
workflow, I'll add files later"), skip 4a–4d and compose immediately with what's there. Then offer
next steps (Step 6). Running later requires the real template/CSV to be rewired in first.

## Step 5 — Upload, then ONE compose call

1. Upload the template, CSV, fonts and the CSV's images with [`asset-input.md`](asset-input.md),
   keeping each image's original filename. Images are not a `compose_workflow` argument — hold on to
   their URLs for the run; compose's `next_step.required_inputs` will name the image node and the
   filenames it expects.
2. Call `compose_workflow` **once**:

   ```
   compose_workflow(
     message           = "<user intent in plain language>",
     customTemplateUrl = "<template URL>",
     customTemplateName = "<original template filename>",
     csvUrl            = "<CSV URL>",
     fonts             = [{ presignedUrl, name, storageType }],   # if supplied
     lightPayload      = true
   )
   ```

   Write the `message` as the user's intent, e.g. *"Create banners at scale from the attached
   InDesign template and CSV: one banner set per CSV row, render every size to PNG and PDF using
   the attached fonts, and preview the outputs."* Follow the message contract in
   [`compose.md`](compose.md) — no node versions, ports, tag lists or wiring.
3. On an error, follow the error rules in [`compose.md`](compose.md): show the reason, ask the user
   to fix the input, and re-compose at most once. Never switch to a message-only or legacy compose.

## Step 6 — After compose: offer next steps

Show a short summary of the composed workflow, then offer one `ask_user` choice:

- **Run now** — if the inputs are complete, submit the composed session following
  `next_step.required_inputs`: the CSV on its `text/csv` node and each `@` column's images on that
  column's own node (`<parse>__csv-media-<column>`) with their original filenames — never on the CSV
  node. A column marked `optional` (blank in the CSV) may be left empty; submit drops it. Add the
  prepared template binding from compose. If `required_inputs` lists images the user hasn't attached, ask for them
  before submitting. Then poll
  `run_workflow_get_status(includeOutputs: true)` to completion and present outputs per
  [`SKILL.md`](../SKILL.md). If this was a compose-only workflow (4e), first collect the real
  template/CSV/fonts/images and rewire them in: `compose_workflow(current_graph = <matrix_graph from
  resolve_workflow_session>, customTemplateUrl, customTemplateName, csvUrl, fonts)`, then run.
- **Save to Workflow Builder** — `save_workflow({ session_id })` (after a run, also pass `batch_id`
  to save the executed graph with its assets).
- **Run, then save** / **Done**.

A create/compose request does not itself authorize execution or saving — always offer, never assume.
On a failed run, use `inspect_run` per [`diagnostics.md`](diagnostics.md).

## Example creative brief (for reference/testing)

> Sample brief for testing — not real customer content.
>
> **Campaign:** Trailhead Gear Co. — Spring Trail Collection
> **Brand:** Trailhead Gear Co.
>
> **Target audience:** Outdoor enthusiasts, ages 25–40, active on weekends, follow hiking and
> camping content, browsing gear and trail-review sites.
>
> **Messaging:**
> Headline: "Built for the trail. Ready for anything."
> CTA: Shop the Collection →
>
> **Ad sizes:** 300x250, 728x90, 160x600, 300x600
>
> **Visual direction:** Real outdoor photography, natural light, product shown in use on-trail.
>
> **Notes for production:** All sizes share the same headline and CTA — only layout and image crop
> vary. Product images and logo will be provided separately.

Use this to sanity-check Step 1 (should classify as supported) and Step 4 (should ask for the
template and merge CSV, since neither is in the brief, but should NOT re-ask for sizes, headline,
or CTA; then fonts, output format and delivery if not stated).
