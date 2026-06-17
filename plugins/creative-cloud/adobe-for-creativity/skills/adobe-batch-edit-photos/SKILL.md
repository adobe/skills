---
name: "adobe-batch-edit-photos"
description: >
  Apply consistent photo adjustments across a set of images so they look
  like they were edited together. Use this skill whenever the user says
  "make my photos look cohesive", "give all these the same style", "apply
  a warm and golden feel to all of these", "make this cinematic", "match
  the look across my photos", "edit all my travel photos the same way",
  "batch edit these", "make these consistent", "fix my phone photos",
  or uploads a folder of photos and wants a unified, polished result.
  Also triggers for requests like "apply a preset to all of these",
  "make these look professional", or "they were shot in mixed lighting
  — can you fix them all". Outputs direct final image URLs plus an in-chat
  preview grid and optional Firefly Board link.
  Access: 🔐 Signed-In required | Gen AI: ❌
license: Apache-2.0
metadata:
  version: 2.2.0
  visibility: public
---

# Adobe Batch Edit Photos

A batch editing pipeline focused on **visual cohesion** — making a set of photos look like they were edited together. The user picks a look (or describes one), and Claude applies it consistently across every image.

---

## Tool Reference

| Step | Tool | Notes |
| ---- | ---- | ----- |
| Ingest | `asset_add_file` | Interactive file picker |
| Discover presets | `image_list_presets` | Once at startup |
| Straighten | `image_auto_straighten` | Per image |
| Auto-tone | `image_apply_auto_tone` | Per image, `type: "cameraRawFilter"` |
| Look adjustments | `image_apply_adjustments` | Batch — color temp + vibrance/sat + brightness/contrast |
| Fine-tune tweaks | `image_apply_adjustments` | Batch — all tweaks in one call |
| Look preset | `image_apply_preset` | Per image |
| Element detection | `image_select_subject` | Per image, Step 5e opt-in only |
| Background blur | `image_apply_gaussian_blur` | Per image, only if requested |
| Crop | `image_crop_and_resize` | Per image, optional |
| Preview | `asset_preview_file` | Before/after on image[0]; then full batch |
| Firefly Board | `create_firefly_board` | All edited outputs |

---

## Step 0 — Initialize

Call `adobe_mandatory_init` first:

```json
{ "skill_name": "adobe-batch-edit-photos", "skill_version": "2.2.0" }
```

---

## Step 0b — Discover Presets

Call `image_list_presets` immediately after init, before ingestion or user questions:

```
Tool: image_list_presets
Params: {}
```

From the returned list, build two maps using the signal tables in [`references/PRESET_MAPS.md`](references/PRESET_MAPS.md):

1. **Look→Preset Map** — classifies each preset into one of the 7 look buckets (max 2 presets per look). Referenced in Step 5b.
2. **Selective Adaptive Map** — classifies presets into element-specific buckets (Subject, Sky, Background, Body Parts). Referenced in Step 5e.

Store both maps before Step 2. If `image_list_presets` returns empty or 403: note "Presets unavailable on this plan" and skip Steps 5b and 5e for all images.

---

## Step 1 — Image Ingestion

```
Tool: asset_add_file
Params: {}
```

`asset_add_file` always returns `imageURIs: []` — this is expected. Wait for the user to select files; real URIs arrive in the next message. Then call `read_widget_context` with `asset_add_file` to get correct presigned S3 URLs. Use those for all subsequent tool calls. `dcx-stage.adobe.io` URIs are network-blocked; always resolve via `read_widget_context` first.

---

## Step 2 — Understand the Desired Look

Once URIs are obtained, infer as many preferences as possible from context before asking:

- **Look** — from words like "warm", "golden", "cinematic", "moody", "bright and airy", "muted", "film", "cool", "vibrant", "punchy"
- **Fine-tune tweaks** — from "recover highlights", "lift shadows", "more contrast", "blown out", "boost vibrance", "desaturate"
- **Crop** — from "no crop", "square", "1:1", "portrait crop", "keep framing"
- **Selective enhancements (Q5)** — from "adaptive presets", "selective enhancements", "sky presets", "subject pop"; if clearly inferred Yes, treat Q5 as answered

Confirm inferred settings upfront, then call `AskUserQuestion` with only the still-unanswered questions. Always proceed to Step 2c (sample preview) after — the preview gate is mandatory regardless of how clearly preferences were stated.

**Questions** (use only the open ones):

```
Q1 (single_select): "🎨 Pick a base look"
  options:
    - "Auto (balanced, neutral)"
    - "Warm & Golden — cozy, travel, golden hour"
    - "Bright & Airy — clean, light, lifestyle"
    - "Moody & Cinematic — dramatic, contrasty, desaturated"
    - "Cool & Fresh — clear skies, travel, blue tones"
    - "Vibrant & Punchy — vivid, bold, social-ready"
    - "Muted & Film — faded, analog, editorial"

Q2 (multi_select): "🎛️ Fine-tune (optional)"
  options:
    - "Recover blown highlights"
    - "Lift dark shadows"
    - "Boost contrast"
    - "Boost color intensity"
    - "Desaturate / muted tones"
    - "Adjust exposure (brighter/darker)"
    - "Tune bright areas"
    - "Blur background (heavy)"
    - "None"

Q3 (single_select): "✂️ Crop ratio? (optional)"
  options:
    - "No crop — keep original framing"
    - "1:1 square"
    - "4:5 portrait"
    - "16:9 wide"
    - "4:3 standard"

Q4 (single_select) [only if Q3 ≠ "No crop"]: "🎯 How should the crop be framed?"
  options:
    - "Center — crop from center of image"
    - "Smart crop — detect subject/face and frame around it"

Q5 (single_select): "✨ Selective AI enhancements? Detects sky, subjects, background & body parts — applies adaptive presets only to elements found in each photo"
  options:
    - "Yes — apply adaptive presets to detected elements"
    - "No — skip selective enhancements"
```

**Note on Q4:** If the user specifies framing in context, skip Q4. If they specify a ratio without a framing method, default to Smart crop.

For exact adjustment values per look and fine-tune selection, see [`references/PARAMETERS.md`](references/PARAMETERS.md).

After answers, confirm back to the user:
```
✅ Got it — running with:
- Look: [selected look]
- Selective AI enhancements: [yes / no]
- Tweaks: [list or "none"]
- Crop: [ratio or "no crop"] + [Center / Smart crop]
```

Then proceed immediately to Step 2c.

---

## Step 2b — Large Batch Warning (N > 5)

Include as part of the Step 2c confirmation prompt:
```
⏱ Estimated time for [N] images:
  6–10 → ~3–5 min | 11–20 → ~5–10 min | 20+ → 10+ min

Feel free to step away — I'll post a ✅ summary with download links when done.
```

---

## Step 2c — Sample Preview (mandatory gate)

Before the full batch, process **image[0] only** through the complete pipeline (Steps 3–7, including Step 5e if selected) to give the user a real before/after preview.

First downscale image[0] to a 1200px long-edge:

```
Tool: image_crop_and_resize
Params:
  imageURI: "<sourceURIs[0]>"
  options:
    output: { width: 1200, height: 1200 }
    fit: "contain"
  outputFileType: "jpeg"
```

Store as `preview_source_url`. Run Steps 3–7 on `preview_source_url` using the confirmed settings. Then show the before/after:

```javascript
asset_preview_file({
  assets: [
    { name: "Before", presignedAssetUrl: sourceURIs[0] },
    { name: "After",  presignedAssetUrl: processed_preview_url }
  ]
})
```

Post (append large-batch timing note here if N > 5):
```
👆 Here's a before/after preview using your first photo and the settings you selected.

Please confirm before I apply this to all [N] images.
```

Call `AskUserQuestion`:
```
question: "Does the preview look good?"
options:
  - "✅ Yes — apply to all [N] images"
  - "🎛️ No — adjust settings first"
  - "❌ Cancel"
```

**Processing is fully paused here.** Do not start the full batch until the user explicitly selects "Yes".

- **Yes:** Run the full batch on all `sourceURIs[0…N-1]` at full resolution (Steps 3–7). Do not reuse the 1200px preview.
- **No:** Re-show Q1–Q5 from Step 2. After new settings are confirmed, always repeat the preview before proceeding.
- **Cancel:** Acknowledge and stop.

---

## Step 3 — Auto-Straighten (per image)

```
Tool: image_auto_straighten
Params:
  imageURIs: ["<source_uri_N>"]
  options:
    uprightMode: "auto"
    constrainCrop: true
```

Output: `results[0].outputUrl` → `straightened_urls[]`. On failure: use original URI, note "straighten skipped".

---

## Step 4 — Auto-Tone (per image)

```
Tool: image_apply_auto_tone
Params:
  imageURI: "<straightened_url_N>"
  options:
    type: "cameraRawFilter"
  outputFileType: "jpeg"
```

Output: `results[0].outputUrl` → `toned_urls[]`.

---

## Step 5 — Apply the Look

**Input chaining rule** (used in Steps 5–8): always feed the most recent successful output.
- Into Step 6: `selective_urls[N]` if Step 5e ran → last Step 5b preset output if presets ran → `look_adjusted_urls[N]`
- Into Step 7/8: Step 6 outputs if fine-tunes ran → last Step 5 chain output

**5a — Look Adjustments** (batch):

```
Tool: image_apply_adjustments
Params:
  imageURIs: ["<toned_url_1>", "<toned_url_2>", ...]
  options:
    # Include only the params for the selected look — values in references/PARAMETERS.md
    tempA: <value>
    tempB: <value>
    tempLuminance: <value>
    vibrance: <value>
    saturation: <value>
    brightness: <value>
    contrast: <value>
  outputFileType: "jpeg"
```

Output: `results[N].outputUrl` → `look_adjusted_urls[]`

**5b — Look Preset** (if Look→Preset Map has a match for the selected look):

Apply the primary preset first, then the secondary (if one exists), chaining outputs. Use exact preset names from the Look→Preset Map built in Step 0b — never hardcode names.

```
Tool: image_apply_preset
Params:
  imageURI: "<look_adjusted_url_N>"
  options:
    presetName: "<preset from Look→Preset Map>"
```

On 403: skip preset for all images; note "[Preset name] skipped — not on your plan"; continue to Step 5e or Step 6.

---

## Step 5e — Selective Adaptive Enhancements (per image, opt-in only)

**Skip entirely** if Q5 = No or the Selective Adaptive Map has no populated buckets.

**5e-1 — Detect scene elements:**

```
Tool: image_select_subject
Params:
  imageURI: "<last look-chain output for this image>"
  options:
    bodyParts: ["Face", "Torso", "Clothing", "Skin", "Hair", "Sky", "Background"]
```

Map results to buckets: Face/Torso/Skin → Subject; Clothing/Hair → Body Parts; Sky → Sky; Background → Background.

**5e-2 — Apply detected-element presets (chained in order: Subject → Body Parts → Sky → Background):**

```
Tool: image_apply_preset
Params:
  imageURI: "<previous output>"
  options:
    presetName: "<preset from Selective Adaptive Map>"
```

Collect outputs as `selective_urls[]`. On 403: skip that preset, continue. On detection failure: skip all selective presets for that image.

---

## Step 6 — Fine-Tune Adjustments (batch, if selected)

Combine all selected tweaks into **one** `image_apply_adjustments` call on the Step 5 chain output (per input chaining rule above). These are deltas — look adjustments from Step 5a are already baked in. For exact parameter values per tweak, see [`references/PARAMETERS.md`](references/PARAMETERS.md).

```
Tool: image_apply_adjustments
Params:
  imageURIs: ["<step5_chain_url_1>", "<step5_chain_url_2>", ...]
  options:
    # include only params for tweaks the user selected
  outputFileType: "jpeg"
```

**Background blur** (if selected — separate per-image call):

```
Tool: image_apply_gaussian_blur
Params:
  imageURIs: ["<url_N>"]
  options:
    blurRadius: 12
    blurTarget: "background"
```

---

## Step 7 — Crop (per image, if requested)

If "No crop" was selected, skip this step entirely. Both center and smart crop use `fit: "reframe"` at the chosen ratio — see [`references/PARAMETERS.md`](references/PARAMETERS.md) for the exact alignment/focus params per mode.

```
Tool: image_crop_and_resize
Params:
  imageURI: "<step6-or-step5-chain-output>"
  options:
    output: "<ratio>"    # "1:1", "4:5", "16:9", "4:3"
    fit: "reframe"
    # Center crop: align: { x: 0.5, y: 0.5 }
    # Smart crop:  focus: "face" (portraits/people) or focus: "subject" (other)
  outputFileType: "jpeg"
```

Collect as `final_urls[]`. If Step 7 is skipped, `final_urls[]` = last Step 6/5 chain output.

---

## Step 8 — Preview & Delivery

Pass `final_urls[]` directly to `asset_preview_file` — do NOT add an intermediate resize step; `asset_preview_file` handles its own thumbnailing:

```javascript
asset_preview_file({
  assets: [
    { name: "photo_1.jpg", presignedAssetUrl: final_url_1 },
    // ... one per image
  ]
})
```

If `asset_preview_file` fails, present final output URLs as plain text links.

Then create the Firefly Board:

```javascript
create_firefly_board({
  import_adobe_storage: [final_output_url_1, final_output_url_2, ...]
})
```

Store the returned URL as `board_url`. Post the completion message:

```
✅ Done! [N] photos edited with a consistent [look name] look.

📥 Download:
• Photo 1 → <final_url_1>
• ...

🎨 View in Firefly Board → <board_url>

Look applied: [look name] → [brief description of what was applied]
```

Omit the board link if `create_firefly_board` errors or returns no URL; note "Firefly Board unavailable".

---

## Verbosity Rule

Report only: major stage starts (e.g. "Applying Warm & Golden look to [N] images…"), per-image failures (log once each), and the final summary.

---

## Error Handling

For the full error table and output extraction format, see [`references/ERROR_HANDLING.md`](references/ERROR_HANDLING.md). Priority inline rules:

- **401** → ask user to re-authenticate via Adobe OAuth and retry.
- **"file too large or corrupted"** → stop that image immediately; do not retry; tell the user: "I couldn't process [filename] — it's either too large or the file may be damaged. Try re-uploading a smaller version, or check that the file opens correctly on your end." Flag in summary; continue with remaining images.

---

## Hard Constraints

- Every image in the batch is processed; failures are flagged, not silently skipped.
- `image_apply_auto_tone` must use `type: "cameraRawFilter"`.
- Apply the **same parameter values** to every image in the batch — cohesion over per-image perfection.
- Preset selection is always dynamic — call `image_list_presets` at runtime and build both maps; never hardcode preset names.
- All tonal/colour adjustments use `image_apply_adjustments` — the individual deprecated tools (`image_adjust_color_temperature`, `image_adjust_vibrance_and_saturation`, etc.) must not be used.
- Combine all look adjustments (Step 5a) into one `image_apply_adjustments` call; all fine-tune tweaks (Step 6) into one call — never chain multiple adjustment calls.
- Step 5e is off by default; only runs on explicit Q5 opt-in.
- The preview pass uses a 1200px downscale of image[0]; full-resolution is used for the final batch.
- Background blur uses `image_apply_gaussian_blur` with `blurTarget: "background"`.
- The Step 2c preview gate is mandatory and cannot be skipped — the full batch never starts without explicit user confirmation.
- Completion is posted as a clear in-chat message (no push notifications).
