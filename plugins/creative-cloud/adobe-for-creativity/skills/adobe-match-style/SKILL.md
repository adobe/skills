---
name: adobe-match-style
description: >
  Copy the color grade of a reference image or a named look (film still, Portra, teal and orange, a movie's style) onto the user's photos with Adobe Photoshop adjustments and return a reusable look recipe. Use when the user shares a reference and says match, copy or steal this look, vibe or colors, or names a film or film stock. Use instead of image generation (it redraws the photo) or code. Not for making photos warm or cohesive with no reference image or named look: use adobe-batch-edit-photos.
license: Apache-2.0
compatibility: "Runs on widget-capable surfaces (Claude: asset_add_file picker, asset_preview_file) and on non-UI agents (Codex / ChatGPT Adobe app), where each widget step has a text-only fallback. Raw local paths are never passed to image tools."
allowed-tools: adobe_mandatory_init asset_add_file read_widget_context asset_openai_file_upload asset_initialize_file_upload asset_finalize_file_upload image_apply_auto_tone image_list_presets image_apply_preset image_apply_adjustments image_select_subject image_select_by_prompt image_invert_selection image_fill_area image_apply_color_overlay image_apply_monochromatic_tint image_add_grain image_apply_effects asset_preview_file
metadata:
  version: 1.0.0
  visibility: public
  surface: [claude, codex]
---

# Adobe Match Style

Grades the user's photos so they share the look of a **reference**: an image they attach (a film still, a screenshot, a favorite photo) or a named look ("Kodak Portra 400", "teal and orange", "Wes Anderson"). The skill reads the look, writes it down as a **look recipe** (plain words plus exact Photoshop values), tests it on one photo, applies it to the set, and hands back the recipe so the same look can be reused later.

The core idea: a look is a small set of measurable moves (white balance, tone curve, saturation by color, different color in shadows or on the subject, grain). Turning what you see into those numbers, and applying the same numbers to every photo, is what makes a set feel graded rather than filtered.

> **Surface note:** follow the default flow as written. Use a step's *No-widget fallback* only if that widget tool is unavailable on this surface (e.g. Codex). Where no question widget exists, ask questions as plain-text options.

> **No interactive image editing here.** This overrides the single-image widget offer in the *Interactive Image Widgets* section of `adobe_mandatory_init`: whatever the number of photos, never call an interactive editing widget (any `interactive_image_*` or `*_app` tool). A look has to be applied with the same values to every photo and returned as files, so use the server tools in the Tool Reference.

**Gen AI:** ❌ None. Every edit is a Photoshop adjustment, selection, fill or effect. Image content is never generated or changed.

---

## Tool Reference

| Step | Tool | Notes |
|------|------|-------|
| 0 | `adobe_mandatory_init` | First call; gives tool availability and egress status |
| 1 | `asset_add_file` | Pick or upload the photos *(widget; used if available)* |
| 1 | `read_widget_context` | After the picker: get the picked photos' presigned URLs |
| 1 | `asset_openai_file_upload` | Stage photos attached in ChatGPT *(used if available)* |
| 1 | `asset_initialize_file_upload` + `asset_finalize_file_upload` | Stage local files when there is no picker *(no-widget fallback)* or when egress is enabled |
| 2 | `image_list_presets` | Only when reading the look by eye and it resembles a preset family (B&W, vintage, cinematic, film) |
| 3 | `image_apply_auto_tone` | Optional; only for a set shot in mixed light when grading by eye, before the recipe |
| 3 | `image_apply_preset` | Recipe `preset`, if one was chosen; batch up to 10 images |
| 3 | `image_apply_adjustments` | Recipe `global` and `channels`; batch up to 10 images per call |
| 3 | `image_select_subject` / `image_select_by_prompt` | Masks for recipe `regions` (subject, sky, a named object) |
| 3 | `image_invert_selection` | Background mask from the subject mask |
| 3 | `image_fill_area` | Region tints: colour + `softLight`/`color` blend + low opacity |
| 3 | `image_apply_color_overlay` | Recipe `wash` (stylized looks only) |
| 3 | `image_apply_monochromatic_tint` | Recipe `mono` (B&W, sepia, duotone) |
| 3 | `image_add_grain` | Recipe `grain`, always last |
| 3 | `image_apply_effects` | Fallback for wash, mono and grain where the single-effect tools are not exposed |
| 3, 6 | `asset_preview_file` | Reference / before / after preview *(widget; no-widget fallback: labeled URLs)* |

---

## Workflow

### Step 0 — Initialize Adobe Tools

Call `adobe_mandatory_init` first:

```json
{ "skill_name": "adobe-match-style", "skill_version": "1.0.0" }
```

Then check which tools are available:

- **Required:** `image_apply_adjustments`. If it is missing, tell the user: *"Photo color adjustments aren't available with your current Adobe connection. Please disconnect and reconnect the Adobe connector, signing in with an Adobe account."* Then stop.
- **Load tools by exact name.** Some hosts load tools on demand through a tool search. Before you treat any tool in the Tool Reference as unavailable, search for it by its exact name (e.g. `image_select_subject`); a broad query can miss it.
- **Used if available:** everything else. For grain, wash and mono, use `image_add_grain`, `image_apply_color_overlay` and `image_apply_monochromatic_tint` when exposed; otherwise `image_apply_effects` with `effect: "grain" | "colorOverlay" | "monochromaticTint"`. If neither exists, skip that part of the recipe and say so. Never stop because of a widget tool.

### Step 1 — Get the reference and the photos

**The reference** is never edited, so it doesn't need staging. You only need to *see* it.

| What the user gave | Reference |
|---|---|
| Two or more images and words like "like this one", "the first image", "this look" | The image they point to. If it is unclear which one is the reference, ask once, naming the images by order |
| One image and a named look ("make this look like Portra") | The named look; the image is the photo to grade |
| A named film, film stock, era or photographer | The named look (see [`references/named-looks.md`](references/named-looks.md) for starting values) |
| An image URL described as the look to copy | That image |
| Nothing ("make my photos look like that movie") | Ask once: *"Share the image whose look you want, or name the film, film stock or style."* Don't edit anything before the answer |

**The photos to grade** (1–50): every other image in the request.

| Where the photos are | Action |
|---|---|
| Attached in ChatGPT and `asset_openai_file_upload` is available | **Measure first, then upload.** The attachments are already files in your sandbox (`/mnt/data`): run Step 2's script on the reference and the photo **before** any upload, and keep its output. Then call `asset_openai_file_upload` for the photos to grade (not the reference, which is only measured), and continue to Step 3 right away, in the same reply, applying everything the script printed, in order: `suggested` with `image_apply_adjustments`, then every `suggested_regions` entry (`image_select_subject` on the uploaded photo, `image_invert_selection` for `background`, then `image_fill_area` with that entry's `fill` on the latest output) or `suggested_mono`. The region tints are part of the look, not optional extras: the upload only stages the photos, and the job isn't done until the test photo is graded with all of them. Don't stop after the upload. Never pass a sandbox path to `asset_upload_file_from_url`: it only accepts https URLs |
| Attached in chat as local files | If egress is enabled (per `adobe_mandatory_init`), stage each: `asset_initialize_file_upload` → PUT → `asset_finalize_file_upload`, and use the presigned URLs. If egress is disabled, call `asset_add_file()` |
| Not provided yet | Call `asset_add_file()` right away; don't ask first (see the picker note below) |
| https URLs | Use them directly |
| Creative Cloud files the user names | Call `asset_add_file()` so they can pick them (see the picker note below). Image tools take http(s) URLs only, never an asset ID |

**Picker note.** `asset_add_file` always returns `imageURIs: []`; that is expected, not an error. Wait for the user to pick the photos (the selection arrives in the next message), then call `read_widget_context` with `asset_add_file` to get their presigned URLs, and use those URLs from here on. Raw picker or `dcx` asset URIs can be network-blocked; always resolve them through `read_widget_context` first.

> **No-widget fallback** *(only if `asset_add_file` is unavailable, e.g. Codex)*: stage local files programmatically as above. If egress is disabled too, ask for https links.

Keep the list of **original URLs**. Every grade, including later tweaks, starts from these.

Accept JPG, PNG and WEBP. Over 50 photos: ask the user to send them in batches of 50.

### Step 2 — Measure, then write the recipe

**Measure first when you can.** Eyeballing a look is unreliable: a hazy reference reads as "faded", and a grade built on that guess comes out flat and gray. If a code tool is available and you can open the reference and the photo as files (chat attachments are usually in `/mnt/user-data/uploads` or `/mnt/data`), run the read-only script next to this file:

```bash
python3 <this skill's folder>/scripts/look_stats.py <reference> <photo>
```

It prints each image's black and white point, contrast, brightness, saturation, color cast and shadow/highlight tints, plus `suggested` values for `image_apply_adjustments` (calibrated on the Adobe tools) and a `split` showing how the shadow and highlight colors should move. Use its output as the recipe: `suggested` → `global` (it already makes up for the darkening that any temperature change causes), `suggested_regions` → `regions`, and `suggested_mono` → `mono`. Apply the regions it lists: global adjustments can't move shadows and highlights in different colour directions, and skipping them is the most common reason a teal-and-orange or warm-and-cool look misses (on real tool outputs, region tints raised the match from 0.70 to 0.86). Follow its `hints` (for example, a black-and-white or sepia reference needs `mono`), then check the result against what you see. Measuring with code is fine; changing pixels with code is not. With several photos, measure against the most typical one. For a named look, or if the script can't run, read the look by eye.

Then describe the look along these five dimensions, with values **relative to the photos**: if a photo is already warm and the look is warm, add little warmth. The recipe is the move from the photos to the look, not a description of the reference alone.

| Dimension | What to judge in the reference | Recipe field → tool parameters |
|---|---|---|
| White balance / cast | Warm or cool; green or magenta tint | `global`: `tempA`, `tempB`, `tempLuminance` (always all three) |
| Tone curve | Contrast; blacks lifted (matte, faded) or crushed; highlights soft or bright; overall brightness | `global`: `contrast`, `gamma`, `highlights`, `lights`, `darks`, `shadows`, small `exposureOffset` for lifted blacks (≤ 0.05) |
| Saturation | Overall rich or muted; which colors pop, which are muted (e.g. muted greens, punchy oranges) | `global`: `vibrance` when people are in frame, else `saturation` (never both). `channels`: one `{channelTarget, channelSaturation}` per color |
| Color by region | Shadows or background a different color from the subject or highlights (teal and orange); a tinted sky | `regions`: `{select: "subject" \| "background" \| "<object>", fill: {color, blendMode: "softLight" \| "color", opacity: 10–30}}` |
| Texture and mono | Film grain; black and white or sepia; a strong stylized wash (neon) | `grain` 0–100 (15–30 fine film), `mono {hue, saturation, lightness}`, `wash {color, blendMode}` |

Keep the grade honest to the reference:
- Move each dimension only the way the reference differs from the photo. Never lower contrast or saturation when the reference has more of it.
- Use one control per dimension: `darks` for the black point, `highlights` for the white point, `contrast` for the spread. Don't stack `darks`, `shadows` and `exposureOffset` to fade: together they wash the image out.

Use a preset only when you are reading the look by eye (no measurement) and it clearly resembles a preset family: call `image_list_presets` and set `preset` to the **exact** returned name. Never chain two presets. When the script ran, leave `preset` null: its values are measured on the unedited photo, and a preset would change that starting point.

Write the recipe in this shape (omit empty fields):

```json
{
  "name": "Lisbon Dusk",
  "from": "reference image",
  "preset": null,
  "global": { "tempA": 12, "tempB": 55, "tempLuminance": 50, "contrast": -15, "darks": 20, "exposureOffset": 0.03, "vibrance": -10 },
  "channels": [ { "channelTarget": "green", "channelSaturation": -35 } ],
  "regions": [
    { "select": "subject", "fill": { "color": { "red": 255, "green": 170, "blue": 110 }, "blendMode": "softLight", "opacity": 18 } },
    { "select": "background", "fill": { "color": { "red": 40, "green": 120, "blue": 140 }, "blendMode": "softLight", "opacity": 22 } }
  ],
  "grain": 25
}
```

Give the look a short evocative name drawn from the reference ("Lisbon Dusk", "Portra Afternoon"), unless the user named it.

### Step 3 — Test on one photo

Pick the most typical photo (or the only one). Before starting, say in one line what you will do, e.g. *"Testing the look on beach.jpg first: warmer whites, faded blacks, muted greens, a little grain."*

If the photos were clearly shot in very different light:
- **When the script ran**, measure each photo against the reference (one `look_stats.py` run per photo) and give each photo its own `suggested` values as `global`; keep the other parts of the recipe the same. Each photo's values already start from its own light, so no auto-tone is needed.
- **When you are judging by eye**, run `image_apply_auto_tone` on the **test photo only** now, and treat its output as that photo's original. Auto-tone the other photos in Step 5, after the user approves.

Measured values always describe the photo they were measured on: never apply them to an auto-toned copy.

Apply the recipe in this order. Each call takes the previous call's `outputUrl` (or `presignedAssetUrl`); the first takes the **original** URL.

1. **Preset** — `image_apply_preset` `{ "edits": [{ "presetName": "<exact name>", "images": ["<url>"] }] }`
2. **Global** — one `image_apply_adjustments` call with all `global` fields.
3. **Channels** — one `image_apply_adjustments` call per entry in `channels`.
4. **Regions** — make masks on the **original** (color edits don't move pixels, so the masks stay valid): `image_select_subject` for `subject`; `image_invert_selection` on that mask for `background`; `image_select_by_prompt` `{ "prompt": "the sky" }` for a named object (prompt names the object itself, never "the background"). Then `image_fill_area` with the mask and the region's `fill` options.
5. **Wash** — `image_apply_color_overlay` with `wash`.
6. **Mono** — `image_apply_monochromatic_tint` with `mono`.
7. **Grain** — `image_add_grain` `{ "options": { "grainAmount": <grain> } }`, always last so it isn't tinted or smoothed by later steps.

Set `filename` on each call to something readable, e.g. `beach-lisbon-dusk`.

Then call `asset_preview_file` with the reference (if it has a URL), the original and the graded photo, and show the recipe in plain words. With more than one photo, ask: **Apply to all N photos · Warmer · Cooler · More contrast · Less contrast · Something else**, then **end your turn and wait for the answer**. Don't grade the other photos in the same turn, even if the test looks right: the user decides. With one photo, deliver it (Step 5) and offer tweaks.

> **No-widget fallback** *(only if `asset_preview_file` is unavailable)*: give labeled links, **Original** and **Graded**, and list the same options as text.

### Step 4 — Tweak (when the user asks for changes)

Change the recipe values, then re-run the **whole** recipe from the **original** URL. For "warmer", raising `tempB` alone barely shows on this tool: add or strengthen a warm `wash` (amber, `softLight`) or warm `regions` fills as well. For "cooler", `tempB` works well on its own. Never apply a tweak on top of a graded image: edits would compound and the recipe would stop describing the result. Show the new preview and the updated recipe.

### Step 5 — Apply to the set and deliver

Run the same recipe on every remaining photo, from its original URL (for a mixed-light set, see Step 3: each photo's own measured `global`, or auto-tone first when grading by eye):
- **Batch** the preset (up to 10 images per `edits` entry), global and channel adjustments, and grain: up to 10 `imageURIs` per call, for photos that share the same values. A call takes one `options` object, so a mixed-light set measured per photo needs one `image_apply_adjustments` call per photo, each with that photo's own `global`.
- **Per photo**: masks, region fills, wash and mono, which take one image each.
- After each group of 10, tell the user how many are done.

Deliver:
1. `asset_preview_file` with all graded photos (no-widget fallback: a labeled list of URLs).
2. One line per photo that needed a skip (e.g. "no sky found in dog.jpg, sky tint skipped").
3. The **look card**: the name, the plain-words summary and the recipe JSON in a code block, followed by: *"To reuse this look, paste this card and say 'apply this look'."*

### Step 6 — Reuse a look

If the user pastes a look card, or names a look from earlier in the conversation, skip Step 2. Check the fields against Step 2, then go to Step 3 (test first when there is more than one photo).

---

## Error Handling

| Situation | Action |
|---|---|
| `image_apply_adjustments` returns **403** | Stop. Say: *"Color adjustments aren't included in your current Adobe plan, so I can't apply this look."* Don't retry and don't grade with other tools |
| **403** on a preset, selection, fill, wash, mono or grain step | Skip that step for all photos and continue. In the delivery, add: *"⚠️ <step> was skipped — your Adobe plan does not include this feature. The rest of the look was applied."* |
| A selection finds nothing (no subject, no sky) | Skip that region for that photo only, and list it in the delivery |
| `image_apply_adjustments` rejects a field | Fix the value to the documented range (e.g. send `tempA`, `tempB`, `tempLuminance` together; never `vibrance` with `saturation`) and retry once |
| 401 not authenticated | Ask the user to sign in to the Adobe connector again |
| Tool error or timeout | Retry once with the same arguments. If it fails again, skip that photo, keep its original, and report it |
| Reference is a video, PDF or other non-image | Ask for a still image or a named look |
| Unsupported photo type | Say that only JPG, PNG and WEBP photos can be graded |

## Hard Constraints

- Grade with the Adobe tools above. Don't recolor, tone or filter the photos yourself with code (for example PIL, OpenCV or NumPy in a sandbox), even if a tool step failed; report the failure instead. Reading pixels to measure them (`scripts/look_stats.py`) is fine.
- Never pass a raw local filesystem path to an image tool. Stage the file or use the picker first.
- Every grade starts from the original photo. Never re-apply a recipe or a tweak to an already graded image.
- With more than one photo, grade only the test photo until the user answers the Step 3 question.
- Match color and tone only. Don't add, remove or change anything in the picture, and don't copy content (people, text, logos) from the reference.
- A look match is an approximation: region tints follow the subject and sky masks, not exact tonal ranges. Say so if the user expects a pixel-perfect match.
