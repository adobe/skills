---
name: run-featured-workflow
description: >-
  Run predefined featured workflows via run-workflow MCP. TRIGGER when user names
  a featured workflow (retargeting, banners at scale, localization, packaging,
  banner advertising, etc.) or asks to run a known marketing/production workflow.
  Requires run-workflow MCP. ALWAYS call get_featured_workflow before compose_workflow.
  DO NOT TRIGGER for custom one-off workflows with no named template — use run-workflow skill.
license: Apache-2.0
metadata:
  version: 1.0.0
  visibility: public
---

# Featured Workflows (run-workflow MCP)

Run pre-built marketing and production workflows bundled with the MCP server. Never compose from scratch when `get_featured_workflow` finds a match.

## When to use

**TRIGGER when the user:**
- Names a featured workflow: retargeting, localization, banner advertising, packaging, product banners at scale, catalogs, packshots, spin video, etc.
- Asks to run a "known" or "predefined" workflow by name or keyword
- Provides product images + fonts for a banner/merge-data workflow with defaults

**DO NOT TRIGGER when:**
- User wants a custom workflow with no named match — use [run-workflow](../run-workflow/SKILL.md) and `compose_workflow`
- User pastes only a batch/execution/workflow ID — use `inspect_run` via run-workflow skill

## Tool routing

| Step | Tool |
|------|------|
| Find predefined workflow | `get_featured_workflow` |
| Upload images, fonts, custom templates, CSV data | `upload_asset` |
| Extract merge tags from custom `.indd` | `get_indesign_tags` |
| Submit (large / multi-banner) | `run_workflow_submit` |
| Poll progress and outputs | `run_workflow_get_status` (always `includeOutputs: true`) |
| Re-wire graph after tag diff | `compose_workflow` (custom templates only) |
| Diagnose failure | `inspect_run` |

## Discovery flow

1. Call `get_featured_workflow({ query: "<keyword>" })`.
2. **Multiple matches** — `prepared` is absent. List matched names, ask user to pick, retry with exact name.
3. **Single match** — present `mergeNodes`, required inputs, sizes. Confirm with user.
4. Ask about templates if not specified (defaults vs custom `.indd`).
5. Ask about fonts if user has `.otf`/`.ttf` files — upload via `upload_asset`.
6. If the user supplies a `.csv` (data-merge workflows like `product-banners-at-scale`), upload it and wire it to the **`input-files` node** (`type: "file"` in `prepared.inputNodes`) — see Data/CSV inputs below.

**Distinct asset types route to distinct input nodes:** images → `input-images`, fonts → `defaults.fonts`, CSV/data → `input-files` (which feeds `parse-data`). Never collapse them onto one node.

## Fast path (defaults)

When user wants default templates **and** default text:

1. Upload product images and fonts via `upload_asset`.
2. Call `run_workflow_submit`:

```json
{
  "session_id": "<prepared.session_id>",
  "useSessionDefaults": true,
  "defaults": {
    "fonts": [{ "presignedUrl": "...", "name": "Font.otf", "storageType": "azure" }]
  },
  "inputs": [
    {
      "node_id": "<input-images id from prepared.inputNodes>",
      "content": [{ "type": "image", "url": "..." }]
    }
  ]
}
```

- Do **not** call `compose_workflow`.
- Do **not** send `actions`/`connections` when `session_id` is present.
- Pass **all** images in one `content` array — one submit call.

## Data / CSV inputs

Some featured workflows (e.g. `product-banners-at-scale`) have a CSV branch: `input-files` → `parse-data` → `merge-data`. `prepared.inputNodes` surfaces the CSV node with `type: "file"`, and `prepared.inputs` carries the workflow's baked **sample CSV** as inline content.

- **Defaults only (no user CSV):** submit as-is — the baked sample CSV flows through, no `input-files` entry needed.
- **User-supplied CSV:** upload it via `upload_asset`, then add an `inputs[]` entry for the `input-files` node id so it overrides the baked default:

```json
{
  "node_id": "<input-files id from prepared.inputNodes>",
  "content": [{ "url": "<uploaded csv url>", "mimeType": "text/csv" }]
}
```

The CSV columns drive the `parse-data` fan-out (e.g. `headline`, `subcopy`, `CTA`) — do not also wire those as separate text inputs. A product image that's constant across every row (not a per-row CSV column) wires `input-images` **directly** into `merge-data`, bypassing `parse-data` entirely — this is the privileged default; only route an image through `parse-data`'s media-override port when it genuinely varies per row.

## Custom template path

When user provides custom `.indd` templates:

1. `get_indesign_tags` on each template.
2. Compare to `prepared.mergeNodes[].tags`:
   - **Identical** → swap template URLs only; skip compose.
   - **Different** → feasibility check, then optional `compose_workflow` re-wire.
3. If a critical image tag was removed (e.g. `background` in retargeting), stop — offer defaults, different template, or build from scratch.
4. Show updated graph visually. Prompt for missing merge-data inputs only.
5. Submit after user confirms all values.

**Merge-data vs scene prompts:** Only InDesign merge-port tags need user-facing text/image inputs. Keep `gen-object-composite` scene prompts at their defaults unless user asks to change them.

## Polling and outputs

After `run_workflow_submit`, poll `run_workflow_get_status` every ~5 seconds with `includeOutputs: true`.

- Report: `Running — N/M complete (X%) · Ns elapsed` using `elapsedSeconds` from response.
- On completion: list every output's **full presigned URL** verbatim. Never truncate.
- On failure: `inspect_run`, summarize, stop — do not auto-retry.

## Known featured workflows

| Slug / keyword | Use case |
|----------------|----------|
| `product-banners-at-scale` | Product banners from a CSV (data merge), one template + constant image, per-row copy |
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

## Anti-patterns

- Calling `compose_workflow` when featured workflow exists and tags match
- Sending full graph JSON when `session_id` is available
- Repeating `fonts` on every merge-data input — use `defaults.fonts`
- Sending all input entries when `useSessionDefaults: true` suffices
- Separate submit per image
- Skipping user confirmation on missing merge-data text fields

## References

- Full run-workflow skill (asset input, publish/save, alert RCA): [run-workflow/SKILL.md](../run-workflow/SKILL.md)
