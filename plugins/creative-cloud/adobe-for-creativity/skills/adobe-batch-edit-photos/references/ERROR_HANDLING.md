# Output Extraction & Error Handling

## Output Extraction

All pipeline tools return:

```json
{ "results": [{ "success": true, "outputUrl": "https://..." }] }
```

Read `results[N].outputUrl`. On `success: false` → apply the error table below.

## Error Table

| Situation | Action |
|-----------|--------|
| `image_list_presets` returns empty or 403 | Skip Steps 5b and 5e for all images. Note in summary: "Presets unavailable on this plan." Color temp and manual adjustments still run. |
| `image_select_subject` fails in Step 5e | Skip all selective presets for that image; use look output as input to Step 6. Note once in summary. |
| `image_apply_preset` returns 403 | Skip preset for all images. Note in summary: "[Preset name] was skipped — not included in your Adobe plan." Continue with other look steps. |
| Any tone/color tool returns 403 | Skip that step. Note in summary. Continue. |
| Any tool returns "No approval received" | Treat as 403 entitlement error. Skip optional step and note in summary. Retrying does not help. |
| Any tool returns 401 | Ask user to re-authenticate via Adobe OAuth and retry. |
| Any tool returns "file too large or corrupted" | Stop processing that image immediately. Do not retry. Tell the user: "I couldn't process [filename] — it's either too large or the file may be damaged. Try re-uploading a smaller version, or check that the file opens correctly on your end." Flag in summary; continue with remaining images. |
| `asset_add_file` shows no files | Remind user to select files in the picker. |
| URI starts with `dcx-stage.adobe.io` | Call `read_widget_context` for the real presigned S3 URL. |
| `image_auto_straighten` fails | Use original URI; note "straighten skipped". |
| `image_apply_auto_tone` fails | Use straightened URI; note in summary. |
| Any adjustment tool fails | Use previous step's output; note in summary. |
| `image_apply_gaussian_blur` fails | Use previous output; note "blur skipped". |
| `image_crop_and_resize` fails | Use blur/adjusted output as final; note in summary. |
| `asset_preview_file` returns "No approval received" | Present final output URLs as plain text links instead. |
| All steps fail on one image | Return original URI; flag clearly in summary. |
