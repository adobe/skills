# Parameter Reference

## Look → Adjustments (Steps 5a + 5b)

**Step 5a:** one `image_apply_adjustments` call per look — include only the params listed below.
**Step 5b:** apply the preset(s) from your Look→Preset Map (built in Step 0b) — never hardcode names.

| Look | Color Temp (tempA, tempB, tempLuminance) | Saturation / Vibrance | Brightness / Contrast |
|------|------------------------------------------|-----------------------|-----------------------|
| Auto (balanced) | none | none | none |
| Warm & Golden | tempA=32, tempB=120, tempLuminance=67 | vibrance +15 | none |
| Bright & Airy | tempA=20, tempB=60, tempLuminance=62 | saturation -10, vibrance +10 | brightness +15 |
| Moody & Cinematic | tempA=20, tempB=-50, tempLuminance=45 | saturation -20 | contrast +25 |
| Cool & Fresh | tempA=18, tempB=-123, tempLuminance=45 | vibrance +10 | none |
| Vibrant & Punchy | none | vibrance +30, saturation +15 | contrast +10 |
| Muted & Film | none | saturation -35, vibrance -10 | contrast +10 |

Apply the **same values to every image** — cohesion over per-image perfection.

## Fine-Tune → Parameters (Step 6)

Combine all selected tweaks into one `image_apply_adjustments` call. These are deltas on top of the already-applied look adjustments from Step 5a.

| Selection | Parameter |
|-----------|-----------|
| "Recover blown highlights" | `highlights: -60` |
| "Lift dark shadows" | `darks: +40` (positive lifts dark areas) |
| "Boost contrast" | `contrast: +30` (delta only — do not sum with look's contrast value) |
| "Boost color intensity" | `vibrance: 30` |
| "Desaturate / muted tones" | `saturation: -30` |
| "Adjust exposure (brighter/darker)" | `exposure: +0.5` or `-0.5`; infer direction from context, default `+0.3` |
| "Tune bright areas" | `lights: +20` |
| "Blur background (heavy)" | separate `image_apply_gaussian_blur`: `blurRadius: 12, blurTarget: "background"` |
| "None" | skip Step 6 entirely |

## Crop Mapping (Step 7)

Both modes use `image_crop_and_resize` with `fit: "reframe"` at the chosen ratio.

| Selection | Params |
|-----------|--------|
| "No crop" | skip Step 7 entirely |
| Ratio + "Center" | `align: { x: 0.5, y: 0.5 }` (geometric center cut) |
| Ratio + "Smart crop" | `focus: "face"` if portraits/people likely, else `focus: "subject"` |
