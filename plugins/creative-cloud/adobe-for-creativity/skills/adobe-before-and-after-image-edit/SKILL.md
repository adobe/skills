---
name: adobe-before-and-after-image-edit
description: >
  Builds a labeled side-by-side before-and-after comparison from an original photo and its
  already-edited version. Use this skill whenever the user has two versions of an image and
  wants them shown together — "make a before and after", "put the original next to my edit",
  "side-by-side of my retouch", "before/after for my portfolio or client", "compare these two
  versions" — even if they never say "before and after". Compare-only: it needs both images
  and never edits them. Shows an in-chat Before/After preview; where previews don't render, it
  builds one side-by-side PNG (if Pillow is already installed) or returns two labeled links.
  Creates a shareable Firefly Board on request.
  Gen AI: ❌
license: Apache-2.0
compatibility: "Runs on widget-capable surfaces (e.g. Claude, with the asset_add_file picker and asset_preview_file preview) and non-UI agents (e.g. Codex). Without the preview widget, the bundled scripts/compose_before_after.py builds the side-by-side PNG using Python 3.8+ and Pillow 9.2+ only if they are already installed; nothing is ever installed, and two labeled links are returned instead."
allowed-tools: adobe_mandatory_init asset_add_file asset_initialize_file_upload asset_finalize_file_upload asset_preview_file create_firefly_board
metadata:
  version: 1.0.0
  visibility: public
  surface: [claude, codex]
---

# Adobe Before and After Image Edit

Turns an original photo and its edited version into a labeled before-and-after comparison —
Before on the left, After on the right. The skill only compares: it never edits, re-exports, or
overwrites either image, so the comparison shows exactly what the user's edit changed.

> **Surface note:** The default flow uses Adobe's MCP App widgets — the `asset_add_file` picker (Step 2) and the `asset_preview_file` preview (Step 3). Follow it as written. Only if a widget tool is **not available on this surface** or the host can't render it (e.g. Codex) use the *No-widget fallback* attached to that step. Present `AskUserQuestion` prompts as plain-text options wherever no question widget exists.

> **No editing here.** This overrides the single-image widget offer in the *Interactive Image Widgets* section of `adobe_mandatory_init`: this skill compares two existing images, so never call or mention an image-editing tool (any `image_*` tool) or an interactive editing widget (any `_app` tool).

---

## Tool Reference

| Step | Tool | Notes |
|------|------|-------|
| Initialize | `adobe_mandatory_init` | Routing rules, widget availability, egress status |
| Pick or upload the images | `asset_add_file` | Picker widget; returns a presigned URL for each selected file |
| Stage a local file (start) | `asset_initialize_file_upload` | Programmatic upload; requires egress |
| Stage a local file (finish) | `asset_finalize_file_upload` | Returns the presigned Creative Cloud URL |
| Show side-by-side preview | `asset_preview_file` | Before/After widget *(no-widget fallback: Step 3b image or labeled links)* |
| Firefly Board (on request only) | `create_firefly_board` | Both images on one shareable board |

The bundled helper [`scripts/compose_before_after.py`](scripts/compose_before_after.py) (not an
MCP tool) builds the single side-by-side image in Step 3b.

---

## Workflow

### Step 0 — Initialize Adobe Tools

Call `adobe_mandatory_init` first. This returns file handling rules and tool routing guidance required for the rest of the workflow.

```json
{ "skill_name": "adobe-before-and-after-image-edit", "skill_version": "1.0.0" }
```

Note whether egress is enabled (Step 2 staging depends on it) and whether `asset_add_file` and
`asset_preview_file` are available on this surface.

---

### Step 1 — Identify the Before and After images

A comparison needs exactly one **Before** (the original, unedited image) and one **After** (the
edited version).

- **No images yet** — go straight to Step 2 and open the picker; don't ask first.
- **Only one image** — work out which version it is with the rules below, then ask for the
  other one: the original if it's the edit, the edited version if it's the original. If you
  can't tell, ask whether it's the original or the edit, and for the other version. This skill
  doesn't edit photos; if the user hasn't made the edit yet, explain that and ask them to come
  back with both versions.
- **The same file twice** — say both inputs are identical and treat them as one image. Use
  the rules below to identify its version, then ask for the missing counterpart: the original
  if both are After, the edited version if both are Before. If its version is unclear, ask
  which version it is and request the other one.
- **More than two images** — ask which two to compare. If the user clearly paired several sets
  (e.g. `room1_before.jpg` / `room1_after.jpg`, `room2_before.jpg` / `room2_after.jpg`), run
  Steps 2–3 once per pair and send one summary at the end.
- **Unsupported format** — comparisons work with JPEG, PNG, WebP, and TIFF. For HEIC, camera RAW,
  PDF, or video, ask for a JPEG or PNG export.

Decide which image is Before with the first rule that applies. Don't guess — swapped labels
would misrepresent the edit.

1. The user says which is which.
2. One image is the output of an earlier tool call in this conversation — it's After, and that
   call's input is Before.
3. File names say so: `original`, `orig`, `raw`, `before`, `unedited`, `source` → Before;
   `edited`, `edit`, `after`, `final`, `retouched`, `fixed`, `v2` → After.
4. Otherwise ask one question — "Which image is the original (Before)?" — listing both file
   names (`AskUserQuestion`, or plain text where no question widget exists), and wait.

Labels default to "Before" and "After". If the user wants other wording (e.g. "Original" /
"Retouched", or another language), use it in every step.

---

### Step 2 — Get previewable URLs

`asset_preview_file` needs a presigned URL for each image. Resolve each image with the first
matching row:

| Where the image is | Action |
|---|---|
| A presigned HTTPS URL already in the conversation (e.g. an earlier Adobe tool's output) | Use it as-is. |
| Not shared yet, or attached in a way you can't read as a file | Call `asset_add_file()` right away — don't ask first — and ask the user to select both images. Use the presigned URL it returns for each selected file; until the user picks, it returns none, which is expected. |
| Uploaded to the chat (e.g. `/mnt/user-data/uploads/…`) and egress **enabled** | Stage it: get its size and MIME type, call `asset_initialize_file_upload({ path: "<filename>", media_type: "<mime>" })`, PUT the bytes to the returned upload URL, then call `asset_finalize_file_upload({ filename: "<filename>", transfer_document: <from the initialize response> })` and use the returned presigned URL. |
| Uploaded to the chat with egress **disabled**, or a Creative Cloud asset ID (`urn:aaid:…`) | Open the `asset_add_file` picker, ask the user to select it there, and use the presigned URL it returns. |

Never pass a raw local path to an Adobe tool.

> **No-widget fallback** *(only if `asset_add_file` and `asset_preview_file` are unavailable on this surface, e.g. Codex)* — skip this step: Step 3b works from local files. If no images have been shared yet, ask for both (local paths or links). Keep local paths as they are and note any HTTPS URLs to download in Step 3b. A Creative Cloud asset ID with no URL can't be fetched here — ask the user to export the file locally or share a link.

---

### Step 3 — Show the side-by-side comparison

#### 3a. Preview

Call `asset_preview_file` with Before first and After second:

```javascript
asset_preview_file({
  assets: [
    { name: "Before", presignedAssetUrl: "<before_url>" },
    { name: "After",  presignedAssetUrl: "<after_url>" }
  ]
})
```

Pass both URLs as they are — don't resize, crop, or re-export first. The widget makes its own
thumbnails, and different dimensions are expected when the edit cropped or straightened the photo.

If the user explicitly asked for one downloadable comparison image (a file to post or send),
also run 3b after the preview.

> **No-widget fallback** *(only if `asset_preview_file` is unavailable on this surface or the host can't render it, e.g. Codex)* — skip the preview and go to 3b.

#### 3b. Build one side-by-side image

Run this only when the preview isn't available (see 3a) or the user asked for an image file.
Never install Python, Pillow, or any other package for it — if it can't run, fall back to the
labeled links in item 3.

1. **Get local copies.** Use local files as they are. Download each HTTPS URL into a
   `before-after/` folder in the working directory, keeping the URL's extension:
   `curl -fL --create-dirs -o before-after/before.jpg "<before_url>"` (same for After; use
   `curl.exe` in Windows PowerShell, where `curl` is an alias for a different command).
2. **Build the image** with the system Python (`python3`, or `python` if `python3` isn't found),
   where `<skill-dir>` is this skill's directory:

   ```bash
   python3 "<skill-dir>/scripts/compose_before_after.py" "<before_path>" "<after_path>" "before-after/<before-name>-before-after.png"
   ```

   `<before-name>` is the original file's name without its extension. If that output name is
   taken, add `-2`, `-3`, … — the script never overwrites files. Add `--layout vertical` when the
   user wants the images stacked, and `--before-label "…" --after-label "…"` for custom labels.
   Integer-grayscale inputs use one shared sample range, starting at 0–65535 and extending
   to include wider or signed samples from either image, so tonal differences stay visible.
3. **Check the result.** Exit code `0` prints a JSON summary with the output path and size —
   share that file with the user. Exit code `4` means the labels can't be drawn here (no
   installed font has their characters, or they need right-to-left layout): run the same command
   again with `--no-labels`, and say in your reply which side is which, in the user's wording. On
   exit code `3` (Pillow isn't installed), no Python, a failed download, or any other error,
   present two labeled links instead:

   ```
   Before: <before URL or local path>
   After:  <after URL or local path>
   ```

---

### Step 4 — Firefly Board (only when the user asks)

Skip this step unless the user asks for a board (e.g. "put them on a Firefly board", "make a
shareable board"). Then call `create_firefly_board` with Before first:

```javascript
create_firefly_board({
  name: "Before and after — <short subject, e.g. kitchen remodel>",
  import_generic_assets: ["<before_url>", "<after_url>"]
})
```

The board needs presigned URLs or Creative Cloud asset IDs. Stage local files first as in Step 2
(requires egress); if egress is disabled and there's no picker, tell the user the board can't be
created on this surface. Images are placed automatically — if the response reports
`placementMode: "manual"`, tell the user they'll drag the two images into place when they open
the board.

---

### Step 5 — Deliver

Close every run with this summary:

```
✅ Before and after ready

Before: <before URL or path>
After:  <after URL or path>
Comparison: <side-by-side preview above | image saved to <output path> | labeled links above — no preview or image could be made here>
🎨 Firefly Board: <board_url>   ← only if one was created
```

If no board was created, end with: "Want both images on a shareable Firefly Board? Just ask."

---

## Error Handling

| Situation | Action |
|---|---|
| Any Adobe tool returns 403 (entitlement) | Stop right there — don't retry, and don't switch to another tool or path. Send the stop message below. |
| Any Adobe tool returns 401 | Ask the user to sign in to Adobe again, then retry that step once. |
| `asset_add_file` returns no URLs yet | Expected while the picker is open — wait for the selection; remind the user to pick both images if needed. |
| Staging upload fails (PUT error) | Open the `asset_add_file` picker instead; where there's no picker, continue with the local files in Step 3b. |
| `asset_preview_file` fails (not 403) | Go to Step 3b. |
| Script exits `3`, Python is missing, or a download fails | Present the two labeled links. Never install anything. |
| Script exits `4` (the labels can't be drawn here) | Run it again with `--no-labels`, and name the sides in your reply using the user's wording. |
| Script exits `1` (an image couldn't be read) | Tell the user which file failed (from the script's error message) and present the labeled links. |
| `create_firefly_board` fails (not 403) | Say the board couldn't be created — the comparison is already delivered. Don't retry. |

**Stop message (403)** — never show raw error codes or service messages:

```
I couldn't finish your before-and-after comparison.

**Why:** <feature, e.g. "Firefly Boards"> isn't included in your current Adobe plan.
**What you need:** <the Adobe product or plan that includes it>.
**Options:**
- Upgrade your Adobe plan to include <product>.
- In the meantime, here are your two images — Before: <URL or path> · After: <URL or path>
```

---

## Constraints

- Before always comes first — left when side by side, top when stacked — in the preview, the
  image, and the board.
- Never modify, re-export, or overwrite either source image, and never upscale one to match the
  other.
- One pair per comparison.
- Never install Python, Pillow, or any other package — fall back to labeled links.
- Pass only presigned URLs or asset IDs to Adobe tools — never raw local paths.
