---
name: adobe-standardize-headshots
description: >
  Gives a team's headshots the same crop, background, and tone using Adobe
  image tools while preserving each person's appearance. Use when the user
  wants to standardize employee portraits, match staff headshots, or make
  team profile photos consistent for a directory, website, or presentation.
  Not for generating new portraits, general photo enhancement, or official
  passport and identity-document compliance.
license: Apache-2.0
compatibility: "Targets Claude and Codex. Uses Adobe picker and preview widgets when available, with programmatic staging and labeled-link fallbacks for non-widget surfaces. Local staging requires an exposed initialization tool that permits egress; raw local paths never reach image tools."
allowed-tools: adobe_mandatory_init asset_add_file read_widget_context asset_initialize_file_upload asset_finalize_file_upload asset_preview_file image_read image_apply_adjustments image_crop_and_resize image_remove_background
metadata:
  version: 1.0.0
  visibility: public
  surface: [claude, codex]
---

# Adobe Standardize Headshots

## Requirement

Gives a team's headshots the same crop, background, and tone. Produce a
cohesive set of head-and-shoulders portraits with consistent dimensions,
relative head size, headroom, background color, and tonal treatment. Preserve
identity, facial features, natural skin tone, hair, clothing, and expression;
do not generate faces, reshape bodies, or apply beauty retouching.

## Tool Reference

| Step | Tool | Purpose |
|---|---|---|
| Initialize | `adobe_mandatory_init` | When exposed, obtain file-handling and routing rules first |
| Collect | `asset_add_file`, `read_widget_context` | Use the Adobe picker when available and resolve selected asset URLs |
| Stage without widgets | `asset_initialize_file_upload`, `asset_finalize_file_upload` | Use the approved two-step upload only when initialization permits egress |
| Inspect | `image_read` | Inspect sources and edited outputs; follow initialization guidance for any required visual-preview tool |
| Match tone | `image_apply_adjustments` | Correct exposure and color differences conservatively |
| Match crop | `image_crop_and_resize` | Subject-aware crop to shared dimensions and framing |
| Match background | `image_remove_background` | Replace the background using `options.backgroundColor` |
| Deliver | `asset_preview_file` | Show results when this widget is available; always provide labeled links |

## Workflow

### Step 0 - Initialize Adobe Tools

When exposed, call `adobe_mandatory_init` before any other tool. Follow its returned
file-handling, authentication, egress, and routing rules throughout the workflow.
This also applies when the request starts with an approved sample or asks to
resume a batch. Do not infer that initialization already ran in this session.

```json
{ "skill_name": "adobe-standardize-headshots", "skill_version": "1.0.0" }
```

If this tool is absent, do not call it or assume its rules were returned.
Use accessible Adobe assets or the picker when available, but do not attempt
programmatic local-file staging. Decide staging from initialization-tool
availability and its returned rules, not from the surface name or network-message
tags. A failed or denied initialization is a blocker, not tool absence.

The tool reference and `allowed-tools` list describe this workflow, not what the
current session exposes. Use only available tools and their actual schemas.
Do not invent initialization rules, image observations, session handles, or
intermediate/final URLs. When execution is unavailable, state what has not run;
explain intended steps without fictional tool results or claims of verification.

### Step 1 - Collect Headshots and Agree on the Standard

Use headshots already supplied in the conversation when they are accessible
under the applicable file-handling rules. Stage local files with `asset_add_file`
when the picker is available;
never pass raw local paths to remote image tools. The picker initially returns
an empty image list: wait for the user's selection, then use
`read_widget_context` to resolve the usable asset URLs.

For each source with blocked ingestion, mark it not run and request an accessible
Adobe asset link or a supported upload surface. Continue accessible independent
sources through the sample-approval gate without waiting for blocked files.
If no source is accessible and no permitted ingestion route exists, the entire
response is the blocker and that request, for example: "The local portraits have
not been staged or edited. Programmatic staging is unavailable here; please
supply accessible Adobe asset links or use an Adobe file-picker surface."
End the turn there; do not describe hypothetical upload calls or editing recipes
that cannot run in the current session.

> **No-widget fallback** (when `asset_add_file` is unavailable, e.g. Codex):
> use already accessible Adobe assets directly. For local files, proceed only
> when `adobe_mandatory_init` is exposed, its rules permit egress, and both
> upload tools are available. Call `asset_initialize_file_upload` using the
> exposed schema, PUT the bytes/parts only to its returned Adobe-issued upload
> destinations, then call `asset_finalize_file_upload` with the returned transfer
> document after all required uploads succeed. Use only the finalized asset URLs
> as image-tool inputs. If staging is blocked or fails, explain the limitation
> and request accessible Adobe assets or a supported upload surface; never
> invent an upload destination, finalize failed uploads, or pass raw local paths.

Do not route
portraits through third-party storage, install software, or create public links.

Keep a per-image mapping of source label, original URL, latest output URL,
session handle when returned, and processing status. Use neutral labels such
as `headshot-01` unless the user supplied filenames. Do not identify people
from their faces or put names and other personal identifiers in tool prompts.

Read preferences already provided before asking questions. Confirm:

- Crop ratio and dimensions; default to 1:1 at 1024 x 1024 pixels.
- Framing: head and shoulders, centered, with similar head size and headroom.
- Solid background color; default to neutral gray `#cccccc`.
- Tone: default to neutral white balance, balanced exposure, restrained
  contrast, and natural skin tones. An optional reference headshot defines
  framing and photographic treatment, not a skin-color target.

Offer these defaults in one concise question when no standard was supplied.
Do not overwrite originals or publish the portraits to a directory or website.

### Step 2 - Inspect and Prepare One Sample

Inspect each source visually, using the inspection/preview tools available
under initialization guidance. Never choose tonal values from the request
alone. Flag low resolution, clipped hair or shoulders, multiple people, or
an unclear subject. Ask which person to retain when ambiguous; do not guess.

Choose a representative usable headshot. Run this sequence for the sample:

1. **Tone:** Complete any required visual preview before a direct
   `image_apply_adjustments` call. Pass `imageURIs: [<source URL>]` and
   `options` containing only justified corrections. Recover bright highlights
   with negative `highlights`, lift deep shadows with positive `shadows`,
   and prefer `vibrance` over heavy global saturation. If temperature needs
   correction, supply `tempA`, `tempB`, and `tempLuminance` together. Omit
   adjustments when the source already matches. Keep intermediate outputs PNG.
2. **Crop:** Call `image_crop_and_resize` on the latest output using
   `imageURI` and the agreed dimensions. Start with the options below, then
   adjust margins/alignment based on the inspected result to match the shared
   head size and headroom. Identical settings alone do not guarantee matching
   framing across different source photos.
3. **Background:** Call `image_remove_background` with the cropped output as
   `imageURI` and `options: {"backgroundColor": "<agreed hex color>"}`.
   Do this last so tonal corrections do not change the shared background color.
   This solid-color mode returns JPEG; do not promise PNG or transparency.

Starting crop options for the default standard:

```json
{
  "fit": "extract",
  "focus": "upper_body",
  "margin": { "top": 0.15, "right": 0.1, "bottom": 0.05, "left": 0.1 },
  "align": { "x": 0.5, "y": 0.5 },
  "output": { "width": 1024, "height": 1024 },
  "onSubjectClipping": "error"
}
```

Use the actual `outputUrl` or `presignedAssetUrl` returned by each tool as
the next input. Preserve per-image session handles where supported. Inspect
the finished sample for crop, skin rendering, and hair/shoulder cutout edges.
Present its preview or link and the agreed standard. Require explicit approval
of the sample before editing the remaining headshots. If the sample is rejected,
revise it from the appropriate source rather than stacking repeated corrections.

### Step 3 - Standardize the Team

When resuming from an approved sample URL, inspect that sample and the remaining
sources before editing so the approved visual standard is available, rather
than relying only on its written description.

After approval, process remaining images sequentially using the same
tone -> crop -> background sequence. Match the approved visual result, not
identical brightness or temperature numbers: mixed lighting requires different
corrections, and different natural skin tones must remain different.

Before each direct adjustment call, perform the tool's required visual
inspection. Direct sample adjustments feed the crop tool, rather than being
a standalone single-image adjustment delivered to the user; follow the
initialization routing rules for any other single-image edit.

Check every output against the approved sample: dimensions and ratio, head
size and headroom, preserved facial features, natural tone, exact requested
background setting, and clean subject edges. Retry a local defect once from
the suitable source. Do not silently use generative expansion, invent missing
hair or shoulders, or upscale a visibly inadequate source without approval.
If the standard cannot be met, flag the image and request a better source.
For clipped or inadequate originals, explicitly ask for an uncropped or
higher-resolution replacement, retain the original link, and mark that image
incomplete. Do not wait for its replacement before continuing independent usable
images under the approved standard.

### Step 4 - Deliver

Return a labeled download link for every successful headshot. Use
`asset_preview_file` to show the sample and final results when available;
this is a display widget, not a substitute for model-side visual inspection.

> **No-widget fallback** (when `asset_preview_file` is unavailable):
> present the labeled tool-returned URLs and the sample-approval question in
> text. Still wait for explicit sample approval before processing the remainder.

State the shared crop/dimensions, background color, and tone
briefly. Keep each result mapped to its original label and identify skipped
or failed images separately; do not claim the entire set is standardized when
some files are incomplete. For failures, return the original file link when
accessible and explain what is still needed. Distinguish completed, incomplete,
and not-run images; an original link is not a standardized result. Report only
checks actually performed. A missing tool-result URL blocks the next dependent
step: do not substitute a placeholder, predict an output URL, or claim completion.

## Error Handling

Treat HTTP 403 as an access or plan restriction, not a transient editing defect.
Do not retry the denied operation or try another tool to bypass the restriction.
If initialization or all asset access is denied, stop and explain the blocker.
If an image's inspection, required tonal correction, crop, or background step is
denied, stop further edits to that image, mark it incomplete, and return its
original link when available. Continue independent images only where access is
available; do not call a partially edited image standardized.

| Situation | Action |
|---|---|
| Sign-in or upload unavailable | Explain the blocker and request supported Adobe asset access; do not bypass authentication |
| Initialization absent or egress disallowed | Do not call programmatic upload tools; use accessible Adobe assets or the picker when available, otherwise explain the staging blocker |
| Part upload or finalization fails | Do not edit that local file or claim it was staged; report incomplete ingestion and continue only accessible independent images |
| Required tool result has no usable output URL | Stop dependent steps for that image, mark incomplete, return its original link when available, and explain the missing result; continue independent accessible images |
| Multiple people or unclear subject | Ask the user to select the intended subject before editing that source |
| Crop clips hair/shoulders or source is too small | Adjust framing once if possible; otherwise request a better source and mark incomplete |
| Poor cutout or unnatural tone | Retry once from the appropriate earlier source; preserve the original if unresolved |
| Tool unavailable or one image fails | Report the missing operation, continue independent files, and deliver originals for failures when possible |
| Background request is not a solid color | Explain this skill's solid-color scope and agree on a supported color before proceeding |