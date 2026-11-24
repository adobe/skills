---
name: adobe-expand-image
description: >
  This skill extends a single photo beyond its borders with Adobe Firefly Generative Expand without cropping the original composition. Use when someone asks to expand, uncrop, outpaint or zoom out an image, add background or breathing room, or fit one photo to a new shape (16:9, 9:16, square, phone, story, wallpaper, banner, thumbnail, 1920x1080), unless they explicitly ask to crop. It is not for social-media packs or same-shape resizing.
license: Apache-2.0
compatibility: "Runs on widget-capable surfaces (Claude: asset_add_file picker, asset_preview_file) and on non-UI agents (Codex / ChatGPT Adobe app), where each widget step has a text-only fallback. Raw local paths are never passed to image tools."
allowed-tools: adobe_mandatory_init asset_add_file asset_openai_file_upload asset_initialize_file_upload asset_finalize_file_upload image_crop_and_resize image_generative_expand asset_preview_file
metadata:
  version: 1.0.0
  visibility: public
  surface: [claude, codex]
---

# Adobe Expand Image

Extends one photo outward with **Firefly Generative Expand**. The original composition is retained; an exact-size resize resamples pixels. New content continues the scene (subject, background, perspective, lighting, colour and texture) on the added sides, with no visible seams, borders or repetition. This is the same job as the Firefly *Expand image* quick action, which offers the ratios 1:1, 4:3, 16:9, 3:4 and 9:16.

> **Surface note:** follow the default flow as written. Use a step's *No-widget fallback* only if that widget tool is unavailable on this surface (e.g. Codex). Where no question widget exists, ask questions as plain-text options.

**Gen AI:** ✅ Adobe Firefly Generative Expand (`image_generative_expand`), when available and entitled. On 403 the skill stops and offers labeled non-generative alternatives. It never substitutes one silently.

---

## Tool Reference

| Step | Tool | Notes |
|------|------|-------|
| 0 | `adobe_mandatory_init` | First call; gives tool availability and egress status |
| 1 | `asset_add_file` | Pick or upload the source photo *(widget; used if available)* |
| 1 | `asset_openai_file_upload` | Stage a file attached in ChatGPT *(Codex/ChatGPT only; used if available)* |
| 1 | `asset_initialize_file_upload` + `asset_finalize_file_upload` | Stage a local file when there is no picker *(no-widget fallback)* or when egress is enabled |
| 3 | — | Read the source dimensions from file metadata or ask the user; do not make an editing call just to discover dimensions |
| 3 | `image_generative_expand` | The expansion itself (`options.expandPixels`, each side 0–4096 px) |
| 4 | `image_crop_and_resize` | Only when the user asked for exact output pixels: same-ratio resize of the expanded image |
| 5 | `asset_preview_file` | Before/after preview *(widget; no-widget fallback: labeled URLs)* |

---

## Workflow

### Step 0 — Initialize Adobe Tools

Call `adobe_mandatory_init` first:

```json
{ "skill_name": "adobe-expand-image", "skill_version": "1.0.0" }
```

Then check which tools are available:

- **Required:** `image_generative_expand`. If it is missing, tell the user: *"Expanding images isn't available with your current Adobe connection. Please disconnect and reconnect the Adobe connector, signing in with an Adobe account."* Then stop.
- `image_crop_and_resize` is needed only when the user requests exact output pixels. If it is unavailable, continue the expansion, explain that exact resizing and letterboxing are unavailable here, and ask whether the user wants the expanded image as-is.
- **Used if available:** `asset_add_file` and `asset_preview_file`. If they are missing, use each step's fallback. Never stop because of them.

### Step 1 — Get the source photo

| Where the photo is | Action |
|---|---|
| Attached in ChatGPT and `asset_openai_file_upload` is available | Call `asset_openai_file_upload` with the attached file and use the returned URL. Don't pass the local path to `asset_upload_file_from_url`: it only accepts https URLs |
| Attached in chat as a local file | If egress is enabled (per `adobe_mandatory_init`), stage it: `asset_initialize_file_upload` → PUT → `asset_finalize_file_upload`. Use the returned presigned URL. If egress is disabled, call `asset_add_file()` |
| Not provided yet | Call `asset_add_file()` right away; don't ask first |
| An https URL | Use it directly |
| A Creative Cloud file the user names and `asset_add_file` is available | Call `asset_add_file()` so they can pick it, and use the returned URL. Never pass an asset id or URN to an image tool: image tools take http(s) URLs only |

> **No-widget fallback** *(only if `asset_add_file` is unavailable, e.g. Codex)*: stage the local file programmatically as above. If egress is disabled too, tell the user the file can't be staged here and ask for a fetchable HTTPS image URL. A named Creative Cloud file is usable only when a supported picker is available.

Accept JPG, PNG and WEBP photos. For any other file (PDF, DOCX, video), say that only images can be expanded, and stop.

### Step 2 — Decide how far to expand

Read the request into **one** of these targets:

| The user says | Target |
|---|---|
| A ratio: "16:9", "make it square", "portrait / 9:16", "4:3", "3:4", "for a banner" or "desktop wallpaper" (16:9), "phone screen" or "story" (9:16) | `ratio` (string, e.g. `"16:9"`) |
| Sides and amounts: "add 500 px on the left", "more sky on top", "extend both sides" | `pixels` per side. If no amount is given, use 25% of the image's width (left/right) or height (top/bottom), rounded to a whole number |
| Exact pixels: "1920×1080 without cropping" | `ratio` from the size (1920×1080 → `"16:9"`), plus `final_size` for Step 4 |
| Only "expand this", "zoom out", "too tight", "give it breathing room" | Ask once, using the quick action's options: **Square 1:1 · Landscape 4:3 · Widescreen 16:9 · Portrait 3:4 · Story 9:16**. Default to 1:1 if the user says "you pick" |

> **No-widget fallback** for the question: list the same five options as text, and wait for the reply.

Expansion is generative, so state the choice in one line before running it. Example: *"Expanding to 16:9 while keeping the original composition uncropped."*

### Step 3 — Expand with Firefly

**If the target is `ratio`**, compute the padding from the source size in pixels (W×H). Keep the original centered and add scene to reach the target ratio without cropping.

1. Get W×H without editing the image: read it from the file (e.g. image metadata in a code tool), or use a size the user or the attachment states. If neither is possible, ask the user for the pixel size, or offer amounts per side instead. Don't run `image_crop_and_resize` or `image_generative_expand` just to learn the size (the host displays their output), and don't estimate it from the preview.
2. Reduce the target a:b to its smallest whole-number terms (for example, 1920:1080 becomes 16:9). If `W × b = H × a`, the photo already has that ratio, so don't call the expand tool:
   - if `final_size` is set, go straight to Step 4 (one resize, nothing cropped);
   - otherwise say so, and ask whether the user wants a bigger canvas at the same ratio. If yes, choose one integer ratio multiplier for the whole target canvas: `k = ceil((W / a) × scale)`, where `scale = 1.25` means 25% more width and height. Set `W′ = k × a` and `H′ = k × b`, then split the total padding `W′ − W` and `H′ − H` using floor on the left/top and the remainder on the right/bottom. For 1600×900 at 16:9 and scale 1.25, the target is 2000×1125: `{ left: 200, right: 200, top: 112, bottom: 113 }`. Never round each side independently.
3. Otherwise find the smallest integer `k = max(ceil(W / a), ceil(H / b))`, then set the exact-ratio canvas to `W′ = k × a`, `H′ = k × b`. Split `W′ − W` between left and right, and `H′ − H` between top and bottom; put any odd extra pixel on the right or bottom. This preserves the whole source while making the canvas exactly a:b.
4. Call `image_generative_expand` with those `expandPixels` on the original source.

**If the target is `pixels`**, call `image_generative_expand` directly:

```json
{ "imageURIs": ["<source>"], "options": { "expandPixels": { "left": 500, "right": 500 } }, "filename": "<name>-expanded" }
```

Constraints:
- Each side must be 0–4096 px. If a request exceeds that, cap it at 4096 and say so.
- Always expand from the **original** source, never from an earlier expansion: chained expansions lose quality.
- If the user asks for both a ratio and extra margin, do it in **one** call on the original: compute the ratio multiplier `k` as above, then use `k_margin = ceil(k × (1 + margin))` (e.g. `margin = 0.2` for 20% more). Set the target to `a × k_margin` by `b × k_margin`, then split its total width/height padding using floor on the left/top and the remainder on the right/bottom. This keeps the integer target canvas at the exact ratio rather than independently rounding its sides.

### Step 4 — Exact output size (only if `final_size` was set)

Check the expanded image's size first. If it already matches the requested width and height, no resize call is needed. Otherwise, use `image_crop_and_resize` with `fit: "reframe"` only when `expanded_width × target_height = expanded_height × target_width`; this exact ratio match ensures nothing is cropped. If the ratios differ, do not use `reframe`. Deliver the expanded image as-is, or offer the clearly labeled `fit: "pad"` letterbox alternative if the tool is available; run it only if the user chooses it. If `image_crop_and_resize` is unavailable, deliver the expanded image and state its actual size.

If a side was capped at 4096 px, the image can't reach the target ratio, and `reframe` would crop the original. Don't run it. Tell the user, and offer the expanded image as-is or, if the tool is available, a labeled letterbox to the exact size (`fit: "pad"`, `output: { width: W, height: H }`).

### Step 5 — Deliver

Call `asset_preview_file` with the source and the expanded image side by side. Then reply in a few lines covering:
- the new ratio or size;
- which sides were extended;
- that the original composition was not cropped, and whether an exact-size resize resampled pixels;
- the download link.

> **No-widget fallback** *(only if `asset_preview_file` is unavailable)*: give two labeled links, **Original** and **Expanded**.

Offer one next step only if it fits the request: *upscale*, *remove an object*, or *expand again in a different direction*.

---

## Error Handling

| Situation | Action |
|---|---|
| `image_generative_expand` returns **403** (plan lacks Generative Expand) | Stop; don't retry, and don't switch tools silently. Say: *"Generative Expand isn't included in your current Adobe plan, so I can't extend this photo with new content."* If `image_crop_and_resize` is available, explicitly list both alternatives, label each **not generative**, and ask which the user wants: **(a) Letterbox:** fit the whole photo in the new ratio with plain bars (`fit: "pad"`); **(b) Crop to ratio:** keep the subject but trim edges (`fit: "reframe"`). Do not stop after explaining the 403 or run either option before the user chooses. If the tool is unavailable, say those alternatives cannot be run here and leave the original unchanged. |
| Source dimensions cannot be read from the file or message | Ask the user for the pixel size, or offer amounts per side; do not call an editing tool just to inspect dimensions |
| Exact-size resize requested but `image_crop_and_resize` is unavailable or returns 403 | Deliver the expanded image if possible and explain that exact resizing and letterboxing are unavailable here; ask whether the user wants the expanded image as-is |
| 401 not authenticated | Ask the user to sign in to the Adobe connector again |
| Tool error or timeout from `image_generative_expand` | Retry once with the same arguments. If it fails again, report it plainly and keep the original untouched |
| A side over 4096 px | Cap at 4096 px and tell the user the expansion was limited |
| Already at the exact target ratio | Say so; don't call the expand tool unasked |
| Unsupported file type | Say that only JPG, PNG and WEBP photos can be expanded |

## Hard Constraints

- Never pass a raw local filesystem path to an image tool. Stage the file or use the picker first.
- Don't crop or pad the image yourself with code (for example PIL in a sandbox) to change its shape. If the user didn't ask for a crop, expand; offer a crop only as a labeled alternative.
- Never deliver a cropped or letterboxed image as an "expanded" one. If a non-generative alternative was used, label it that way.
- The expansion only continues the existing scene. Don't add people, text or logos, and don't change the subject.
