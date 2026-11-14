---
name: adobe-product-photo-cutout
description: >
  Removes the background from a product photo and standardizes it to a clean, consistent catalog
  canvas (transparent or flat-color, centered, padded to a target size). Use this skill when the user
  says "remove the background from this product photo", "cut out this product", "make a clean product
  shot", "give me a transparent PNG of this item", "prep this for the catalog", or uploads a product
  photo and wants it ready for an e-commerce listing.
license: Apache-2.0
allowed-tools: adobe_mandatory_init asset_add_file asset_initialize_file_upload asset_finalize_file_upload asset_search asset_license_and_download_stock image_remove_background image_crop_and_resize image_apply_auto_tone image_list_presets image_apply_preset asset_inline_preview asset_preview_file
metadata:
  version: 1.0.0
  visibility: public
  surface: [claude, codex]
---

# Product Photo Cutout

Cuts a product out of its photo onto a transparent (or flat-color) background and pads it to a
consistent catalog canvas, ready for e-commerce listings. Source: Firefly quick action
`product-photo-cutout` (Priority 0, ~94k background removals/month), ported from
[`Research-Adobe/expand-adobe-3p-skills`](https://github.com/Research-Adobe/expand-adobe-3p-skills/blob/main/photoshop/skills/product-photo-cutout.md).

> **Surface note:** Follow the default flow as written. Only if a widget tool is not available on this
> surface, use the *No-widget fallback* on that step.

---

## Tool Reference

| Step | Tool | Notes |
|------|------|-------|
| Pick the source image | `asset_add_file` | File picker / CC browse / upload |
| Upload a chat-dropped image | `asset_initialize_file_upload` → `asset_finalize_file_upload` | Two-step upload for sandbox-local files |
| (Optional) Find a stock product shot | `asset_search` (`entityScope: StockAsset`) → confirm with user → `asset_license_and_download_stock` | Only if the user has no image of their own; get explicit yes + mention credits/cost before licensing |
| Cut out the background | `image_remove_background` | Keep the cutout transparent through canvas sizing |
| Improve a rough edge (conditional) | `image_crop_and_resize` → `image_remove_background` | Retry once with a cleaner source crop when available |
| Standardize the canvas | `image_crop_and_resize` | Subject extract with margin, then `fit: "pad"` with explicit `{width, height}` |
| Apply a flat color (conditional) | `image_remove_background` | Apply `options.backgroundColor` after sizing, then verify the result |
| Optional tone pass | `image_list_presets` → `image_apply_preset`, or `image_apply_auto_tone` | For cross-SKU color consistency |
| Verify | `asset_inline_preview` | Check for halo/fringe before delivering |
| Deliver | `asset_preview_file` | Final output to the user |

---

## Workflow

### Step 0 — Initialize Adobe Tools

Call `adobe_mandatory_init` first. This returns file handling rules and tool routing guidance required
for the rest of the workflow.

```json
{ "skill_name": "adobe-product-photo-cutout", "skill_version": "1.0.0" }
```

---

### Step 1: Collect the source image

Open the File Picker with `asset_add_file`.

> **No-widget fallback** *(only if `asset_add_file` is unavailable on this surface, e.g. Codex)* — stage
> the file with `asset_initialize_file_upload` → PUT the chunks → `asset_finalize_file_upload`.

If the user wants a stock/reference product shot instead of supplying their own: `asset_search(query,
entityScope="StockAsset")` to show candidates (low-res thumbnails only — never edit those directly).
Ask the user which license tier they want to filter by.
Before calling `asset_license_and_download_stock`, show the user the specific candidate and ask for
explicit confirmation (e.g. "License and download this image? This will use a Stock credit/license
under your plan — some assets may incur a cost depending on your entitlement.") and wait for a yes.
Only call `asset_license_and_download_stock` after the user confirms — never license automatically
right after search, even if the result turns out to be free tier.
If confirmation has not arrived, end the turn after asking; do not assume or simulate a yes to
continue with licensing or editing. If the user declines, wait for their own image instead.

### Step 2: Ask the output parameters (only if not already stated)

- **Background:** transparent PNG (default) vs. a flat color (hex) composited behind the subject.
- **Target canvas size:** default square, e.g. 2000×2000 px. Ask if the user has a specific catalog spec.
- **Tone/consistency pass:** whether to apply a preset or auto-tone for cross-SKU color matching.

Use `AskUserQuestion` when it exists; otherwise ask in plain text and wait for the reply, or proceed with
the stated defaults if the user already gave clear instructions.

### Step 3: Remove the background

Call `image_remove_background(imageURI=<source>)` without `options.backgroundColor` to produce a
transparent PNG, even when the user requested a flat color. Keep this cutout until the final
composite is verified.

### Step 4: Check the edge, refine if needed

Call `asset_inline_preview` on the cutout. If there's a visible halo, fringe, or stray background pixels
(common with reflective/transparent products like glass or jewelry, or low-contrast backgrounds):
- If a cleaner source crop is available, run `image_remove_background` once on that crop and
  re-preview it. Preserve the best cutout.
- If the halo remains, tell the user the matte may need manual touch-up; do not silently claim it is clean.

### Step 5: Standardize the canvas

First call `image_crop_and_resize` on the transparent cutout with `options.fit: "extract"`,
`options.focus: "subject"`, `options.margin: 0.15`, and `outputFileType: "png"`, omitting
`options.output`. This preserves transparency and trims uneven margins around an off-center product.
Preview the extraction; if
subject detection clips or misses product details, use the unextracted cutout instead and tell the
user centering could not be verified.

Then call `image_crop_and_resize` on the chosen transparent image with:
- `options.fit: "pad"` and `outputFileType: "png"` (preserves the whole chosen image and adds transparent padding)
- `options.output: {width, height}` set to the target size (e.g. `{width: 2000, height: 2000}`).
  **Always pass explicit pixel dimensions here, not an aspect-ratio string** — pad mode rejects ratio
  strings like `"1:1"` even though they're accepted in other fit modes.

### Step 6: Optional tone/consistency pass

Only if the user requests it, apply the chosen preset using `image_list_presets` →
`image_apply_preset`, or use `image_apply_auto_tone`. Preserve PNG transparency for the next step.

### Step 7: Verify and deliver

For a flat-color request, call `image_remove_background` on the padded PNG with
`options.backgroundColor` set to the requested 6-digit hex **including the leading `#`**
(for example, `"#336699"`). This produces a composited JPEG.
Preview it against the retained transparent padded PNG: confirm the color covers the whole canvas
and no product detail was lost or altered by subject detection. If verification fails or the tool
cannot composite the padded image, deliver the retained transparent PNG and explain that the
requested flat background could not be verified. For a 403, follow the error handling below.

`asset_inline_preview` on the final output to confirm no clipping, halo, or color shift, then
`asset_preview_file` to show the user. Offer to persist it via `asset_add_file`/the user's asset library
if they want it saved, and mention batching (roughly 20 images per burst) if they describe a larger
catalog job.

> **No-widget fallback** *(only if `asset_preview_file` is unavailable)* — list the labeled output URL(s)
> in the message.

---

## Error Handling

| Situation | Action |
|---|---|
| `image_remove_background` or `image_crop_and_resize` returns 403 (entitlement) | Stop with a message: "This feature isn't included in your Adobe plan." Don't retry. |
| A generative tool is not exposed on this surface | Don't call it, offer it or mention it. Take the non-generative path, or explain the limitation. |
| No image provided | Ask for one image and wait. |
| `image_crop_and_resize` in `pad` mode rejects the `output` value | Re-call with explicit `{width, height}` pixels instead of an aspect-ratio string. |
| Product occupies near-full frame / touches edges | If extraction clips product details, use the original transparent cutout for `fit: "pad"` and disclose any centering limitation. |
| Reflective/translucent product (glass, jewelry) still shows a halo after one refine pass | Flag the low-confidence matte to the user and suggest a manual touch-up pass rather than looping indefinitely. |
| Large catalog (many images) | Explain that each call is per-image; batch client-side in bursts of ~20. |
