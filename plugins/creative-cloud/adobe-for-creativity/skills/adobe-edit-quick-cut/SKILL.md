---
name: adobe-edit-quick-cut
description: >
  Create a punchy highlight cut from a video with Adobe Quick Cut — for requests like "make a
  sizzle reel", "make a highlight reel", "quick cut this", "cut the best parts", "shorten this
  video", "make a highlight clip", or "summarize this video visually". Works from the user's
  original request without follow-up questions and produces one highlight cut. Do NOT use it for
  exact-timestamp trims ("cut from 0:30 to 1:15") or other deterministic edits — Quick Cut selects
  moments by relevance, not exact instructions; those need manual editing. Requires a video file
  (an upload or an already-referenced Creative Cloud asset).
license: Apache-2.0
compatibility: "Runs on widget-capable surfaces (e.g. Claude Cowork, which supports the asset_add_file picker and asset_preview_file preview widgets) and on surfaces where those widgets aren't available. The default flow uses the widgets; each widget step has a text-only fallback used only when that widget isn't available on the current surface. Raw local paths are never passed to video tools."
allowed-tools: adobe_mandatory_init asset_add_file asset_initialize_file_upload asset_finalize_file_upload video_create_quick_cut asset_preview_file video_resize video_render
metadata:
  version: 3.0.0
  visibility: public
  surface: [claude, codex]
---

# Adobe Edit Quick Cut

Produces **one** AI-edited highlight cut from a source video, working entirely from the user's
original request. **No follow-up questions** — infer the intent and duration from what the user
already said, fall back to a sensible default when they said nothing, and deliver a single preview.

> **Surface note:** The default flow uses Adobe's MCP App widgets — the `asset_add_file` file picker (Step 2) and the `asset_preview_file` preview (Step 5). Use a step's *No-widget fallback* only when that widget isn't available on the current surface — decide by availability, not by client name.

---

## How Quick Cut Works — and What to Design Around

`video_create_quick_cut` is an AI rough-cut tool. Its `user_prompt` is a **description of the video
and the kind of result you want** (e.g. "interview with a nonprofit for social fundraising"), not a
list of pacing directives. It selects moments itself. Key limits, each mapped to a rule below:

| Quick Cut behavior / limit | Consequence | How this skill handles it |
|---|---|---|
| `user_prompt` describes **what the video is / is for** | Vague energy adjectives do little on their own | Send a clear description; merge the user's own words when given (Step 3) |
| `target_duration` is a **soft target, not a hard trim** | Output can overshoot | Always pass a number — the user's length when given, else a **30s default** (Step 3) |
| Output is a **transient presigned URL**, not a CC asset | The URL expires; can't feed `video_resize` directly | Preview **immediately** on completion (Step 5); re-ingest for resize (see *Known Gap*) |
| An **identical prompt** tends to produce a **similar cut** | Re-runs give little variety | Offer another only with a **different intent or duration** (Step 6) |
| **`video_create_quick_cut` runs async** (`status: "working"` → result on completion) | Proceeding on a "working" status skips the real result | Wait for the widget's completion event — never act on a "working" status (see *Async handling* below) |

> **Async handling (`video_create_quick_cut`):** A `status: "working"` response is **pending — not a failure and not missing output**; never treat it as either. **Polling is managed by the widget — wait for its completion event; do not call any poll tool yourself.** Only after a **completed** result — or a terminal failure — do you read the output or apply any fallback.

---

## Tool Reference

| Tool | Purpose |
|------|---------|
| `adobe_mandatory_init` | Required init; returns file-handling rules and tool routing. |
| `asset_add_file` | File picker; the widget injects the selected CC `assetId` into context on confirmation — wait for that, don't poll. |
| `asset_initialize_file_upload` | No-widget staging fallback (step 1); begins a local-file upload. |
| `asset_finalize_file_upload` | No-widget staging fallback (step 2); completes the upload and returns the `assetId`. |
| `video_create_quick_cut` | Creates the highlight cut (one call). **Async** — may return `status: "working"`; the finished cut arrives when the job completes (widget-tracked). |
| `asset_preview_file` | Renders the finished cut immediately on completion. |
| `video_resize` | Resize workaround only, after re-ingesting a downloaded cut. |
| `video_render` | For edits Quick Cut can't do — exact-timestamp trims, and adding/replacing music, audio, or images. |

---

## Workflow

### Step 0 — Initialize Adobe Tools

Call `adobe_mandatory_init` first.

```json
{ "skill_name": "adobe-edit-quick-cut", "skill_version": "3.0.0" }
```

---

### Step 1 — Entitlement Check

`adobe_mandatory_init` confirms the "Adobe for creativity" connector is live. Confirm `video_create_quick_cut` and `asset_preview_file` are available. If `asset_add_file` or `asset_preview_file` is unavailable on this surface, use that step's *No-widget fallback*. If a tool result carries an `importantNote` or "Asset Storage & Display" guidance, it overrides the presentation defaults here.

---

### Step 2 — Get the Source Video

If the user's message already references a Creative Cloud asset (a CC `assetId`), use it directly. Otherwise — including a raw chat upload or a local file, which isn't usable until it reaches Creative Cloud — get it in first via the picker (or the no-widget staging fallback below):

> *"Let's create a highlight cut from your video. Start by selecting your file:"*

```javascript
asset_add_file()
```

Extract `assetId` (the CC asset ID) from the widget context — the widget injects it on confirmation, so wait for that (don't poll).

> `video_create_quick_cut` requires a CC asset ID (`assetId`), not `presignedAssetUrl`.

**No-widget fallback** *(only if `asset_add_file` is unavailable on this surface)* — get the `assetId` from where the file is. A file already in Creative Cloud is referenced directly by its CC `assetId`. To stage a **local** file, use the upload path `adobe_mandatory_init` routes to for this surface (surfaces differ — it may name a surface-specific upload tool, or the `asset_initialize_file_upload` → PUT → `asset_finalize_file_upload` sequence). Staging requires egress — check egress status from `adobe_mandatory_init` first; if egress is disabled and no picker exists here, tell the user staging isn't possible. For the initialize/finalize sequence: get file size and MIME type, call `asset_initialize_file_upload({ path, media_type })`, PUT the bytes to the returned URL, then `asset_finalize_file_upload({ filename, transfer_document })`, and extract the `assetId`.

---

### Step 3 — Build the Intent from the Original Request (no questions)

Do **not** ask the user anything. Derive both inputs from their original message.

**`user_prompt`** — start from the generic intent, and merge the user's own words only if they gave any:

- **Generic intent (default when the user gave no detail):**
  > `An engaging highlight reel of this video that keeps its most compelling, high-energy, and visually interesting moments, with a strong opening and a natural flow, ready to share on social media.`

- **User gave intent or output details** (content, occasion, purpose, a **topic focus** such as "the parts about pricing", or a vibe such as "cinematic", "hype", "for our fundraiser") — put their description first and keep the highlight framing:
  > `<user's description>. Edit into an engaging highlight reel that keeps the strongest, most compelling moments with a natural flow, suitable for social sharing.`
  Fold any named vibe adjective ("cinematic", "energetic") into the sentence. If the user's own description already fully specifies the desired output, use it as-is.

**`target_duration`** (seconds) — always pass a number:

- **User stated a length** → use that number. It's a **soft target** — Quick Cut aims for it but may run slightly over. For an upper bound ("under a minute"), target a few seconds under the cap (e.g. ~50) and note it's approximate; if they need a strict cap or an exact runtime, use `video_render` instead.
- **No length stated** → use a **30s default**.

> **Note (API gap):** the Quick Cut UI offers `Duration: Auto`, but the MCP `video_create_quick_cut` requires a numeric `target_duration` — so pass the user's length, or the 30s default.

---

### Step 4 — Run One Cut, Then Wait for Completion

```javascript
video_create_quick_cut({
  assetIds: [assetId],
  target_duration: <stated_length_or_30>,
  user_prompt: "<generic-or-merged intent>"
}) // → taskId
```

Acknowledge briefly: *"Creating your highlight cut — I'll preview it as soon as it's ready."*

`video_create_quick_cut` is **async** too (returns `status: "working"`). **Wait for the completed result** before previewing (see *Async handling* above) — don't act on a `working` status. On completion, store `outputUrl` (the completed `presignedAssetUrl`). **The URL is time-limited — go straight to the preview.**

> **If the completion event never arrives:** don't stall or invent a status — the last known state is *processing*. If a tracker exists but is slow, tell the user the cut is still processing and its preview will appear when it completes; if this surface has no async tracker at all, tell them the cut was submitted and is processing but this session can't retrieve the result, and suggest a widget-capable client such as Adobe Express.

---

### Step 5 — Preview the Result (mandatory, do this first)

The moment the job completes, **call `asset_preview_file` as your very next action, before writing any summary.** Do not describe the video in prose instead of previewing it — the call must actually run, promptly, or the URL may expire.

```javascript
asset_preview_file({
  assets: [
    {
      name: "Highlight cut.mp4",
      presignedAssetUrl: outputUrl,
      mediaType: "video/mp4",
      source: "acp"
    }
  ]
})
```

Include `mediaType` and `source` — without them the widget may fail to render the video.

**No-widget fallback** *(only if `asset_preview_file` is unavailable on this surface)* — present the URL directly (`Highlight cut.mp4 → <outputUrl>`). UI clients render media URLs inline; where inline rendering isn't available, download it (`curl -L -o highlight_cut.mp4 "<outputUrl>"`) and reference the local path. If `asset_preview_file` errors, immediately fall back to posting the URL as a link.

---

### Step 6 — Summary + Offer Another

After the preview renders, give a one-line summary of what was made (and the actual length if it came out longer than any requested length — say so honestly). Then offer:

> *"Want another version? Tell me a **different focus** (e.g. a specific moment or vibe) or a **different length** — that's what actually changes the cut. I can also resize it for a specific platform, or you can download it from the preview above."*

If the user asks for another, return to Step 4 with the new intent/length. Re-running the same intent tends to produce a very similar cut, so steer them toward a change.

---

## ⚠️ Known Gap — Output Cannot Feed Downstream Video Tools Directly

`video_create_quick_cut` returns a temporary presigned URL, not a CC-stored asset ID. `video_resize`
and `media_enhance_speech` require a CC asset ID, so **you cannot chain Quick Cut → Resize / Enhance
directly.** To resize a Quick Cut output: tell the user to download it, re-ingest it exactly as in
Step 2 (`asset_add_file()` or the staging fallback), then run `video_resize` on the fresh `assetId`.
Surface this proactively when the user asks to resize or enhance a Quick Cut output.

---

## What Quick Cut Does NOT Support

Quick Cut selects the most relevant moments for you — working from the video's **transcript/dialogue** when there's enough speech (and you can steer it to a **topic**, e.g. "the parts about pricing" or "the dog-washing parts"), and falling back to **visual** content (the footage captioned in chunks) when there's little speech. It always produces a highlight. It does **not**:

- Remove repeats or disfluencies ("um", "uh"), or do other deterministic transcript surgery you dictate — it selects a highlight, not exact edits.
- Trim to specific timestamps ("cut from 0:30 to 1:15"), or add/replace music, audio, or images — **the `video_render` tool does these** (use it for precise trims and for adding music/audio/images).

---

## Error Handling

- **`video_create_quick_cut` returns 403 (entitlement)**: Do not retry. Tell the user Quick Cut isn't on their current Adobe plan and offer to upgrade or trim manually in Premiere Rush / Premiere Pro.

- **Any tool returns 401 (not authenticated)**: Ask the user to re-authenticate via Adobe OAuth and retry.

- **Output overshoots any requested length**: Expected — `target_duration` is a soft target. Report honestly. If they want it tighter, re-run once with a shorter length; for an exact runtime, use `video_render`.

- **Job fails with any other error on the first attempt**: Retry once only for a confirmed transient `5xx` (500/502/503/504). For `429`, wait for `Retry-After` (or a short backoff) before a single retry. Do **not** blindly retry other `4xx` responses — report them. If submission timed out and the job may have been accepted, wait for the existing job's completion event instead of submitting again (a second job wastes an expensive async run). If the permitted retry also fails, report and suggest re-uploading the source video.

- **Progress stalls at the same % for a long time**: Inform the user, suggest re-uploading the source.

- **User uploads an image by mistake**: Detect from `mediaType` — if not `video/*`, say so and re-open the picker (or re-run the staging fallback).

---

## Constraints

- Never pass a raw local filesystem path to `video_create_quick_cut` or any other video tool. Local files must reach Creative Cloud first — via the `asset_add_file` picker or the `asset_initialize_file_upload` → PUT → `asset_finalize_file_upload` staging fallback; only the resulting `assetId` is valid.
- `video_create_quick_cut` requires `assetId` (CC asset ID), not `presignedAssetUrl`.
- Produce **one** cut per request. Never fire multiple `video_create_quick_cut` jobs in parallel — additional versions are made one at a time, only when the user asks (Step 6).
- Do not ask the user clarifying questions — work from the original request and the generic intent.
