---
name: adobe-cleanup-audio
description: >
  Removes background noise and echo from speech in a video or audio file with Adobe Enhance Speech
  and returns the cleaned file — for videos, the cleaned speech is put back onto the original
  picture. Use for requests like "clean up the audio", "remove background noise", "remove echo",
  "enhance speech", "fix the audio in this video", or "make my podcast sound clearer". Do NOT use
  for music mixing, adding music or sound effects, or transcription.
license: Apache-2.0
compatibility: "Runs on widget-capable surfaces (Claude, which supports the asset_add_file picker) and on surfaces without widgets (Codex), which use the asset_initialize_file_upload → PUT → asset_finalize_file_upload staging path. Raw local paths are never passed to Adobe tools."
allowed-tools: adobe_mandatory_init asset_add_file asset_openai_file_upload asset_initialize_file_upload asset_finalize_file_upload media_enhance_speech video_metadata video_render video_export
metadata:
  version: 1.0.0
  visibility: public
  surface: [claude, codex]
---

# Adobe Clean Up Audio

Cleans up speech in a video or audio file — removes background noise and echo — and returns the
cleaned file:

- **Audio file** → the cleaned speech track.
- **Video file** → the original video with its audio replaced by the cleaned speech track.

The output contains **speech only**: the background (music/ambient) and reverb tracks that
`media_enhance_speech` separates out are not included.

> **Async handling (`media_enhance_speech`, `video_render`, `video_export`):** a `status: "working"` result is **pending — not a failure and
> not missing output**. The finished result is delivered automatically when the job completes; do
> not call any poll tool yourself. Submit each job **once** — never resubmit while one is pending.
> If the result doesn't arrive, tell the user the job was submitted and is still processing, and
> don't offer workarounds.

---

## Tool Reference

| Step | Tool | Notes |
|------|------|-------|
| Initialize | `adobe_mandatory_init` | Returns file-handling rules and tool routing |
| Select source file | `asset_add_file` | File picker widget; injects the asset ID on confirmation |
| Upload file attached in ChatGPT | `asset_openai_file_upload` | ChatGPT only; returns a URL for the Adobe tools |
| Upload attached/local file | `asset_initialize_file_upload` | Starts the upload; returns a PUT URL |
| Finish upload | `asset_finalize_file_upload` | Completes the upload; returns the asset ID |
| Clean up speech | `media_enhance_speech` | Returns speech, background, and reverb tracks |
| Read video properties (video only) | `video_metadata` | Width, height, fps, duration |
| Recombine picture + cleaned speech (video only) | `video_render` | Max 10 minutes |
| Export final video (video only) | `video_export` | `mp4` or `mov` |

---

## Workflow

### Step 0 — Initialize Adobe Tools

Call `adobe_mandatory_init` first. This returns file handling rules and tool routing guidance
required for the rest of the workflow.

```json
{ "skill_name": "adobe-cleanup-audio", "skill_version": "1.0.0" }
```

---

### Step 1 — Get the Source File

All tools here accept a Creative Cloud asset ID (e.g. `urn:aaid:sc:...`) or a presigned HTTPS URL from an approved storage host. Never pass a raw local path.

| Source | Action |
|---|---|
| File attached in ChatGPT and `asset_openai_file_upload` is available | Call `asset_openai_file_upload` with the attached file and use the URL it returns. Don't pass the attached file's local path to `asset_upload_file_from_url` — it only accepts https URLs. |
| File attached in chat (e.g. `/mnt/user-data/uploads/…`) | Check egress status from `adobe_mandatory_init` (Step 0). If egress is enabled, upload it directly: get its size and MIME type, call `asset_initialize_file_upload({ path, media_type })`, PUT the bytes to the returned URL, then call `asset_finalize_file_upload({ filename, transfer_document })` and use the returned asset ID. If egress is disabled, open the picker (`asset_add_file()`) instead. |
| Creative Cloud asset ID or presigned URL in the message | Use it directly. |
| No file provided yet | Open the picker — no need to ask first. |

Opening the picker:

> *"Let's clean up your audio. Start by selecting your file:"*

```javascript
asset_add_file()
```

Wait for the widget to inject the asset ID on confirmation — do not poll.

> **No-widget fallback** *(only if `asset_add_file` is unavailable on this surface, e.g. Codex)* —
> stage any local file with the same `asset_initialize_file_upload` → PUT →
> `asset_finalize_file_upload` sequence. If egress is disabled, tell the user the file can't be
> staged on this surface. If no file was provided, ask the user to attach their video or audio file.

Note whether the source is **video** (`video/*`) or **audio** (`audio/*`). If it is neither, say so
and ask for a video or audio file.

---

### Step 2 — Enhance the Speech

```javascript
media_enhance_speech({
  assetId: "<source asset ID or presigned URL>",
  filename: "<source-name>-clean-speech"
})
```

Acknowledge briefly: *"Cleaning up the speech — this can take a moment."* If the result reports a
pending/working status, wait for the completed result; never act on a pending status.

From the completed result, keep the **speech track** URL. Ignore the background and reverb tracks.

- **Audio source** → go to Step 4 and deliver the speech track.
- **Video source** → continue to Step 3 right away, in the same reply — the job isn't done until
  the cleaned speech is back on the video. Don't stop and deliver only the speech track.

---

### Step 3 — Put the Cleaned Speech Back on the Video (video only)

**3a. Read the source video's properties.**

```javascript
video_metadata({ assetId: "<source asset ID>" }) // → width, height, fps, duration (seconds)
```

If `duration` is over 600 seconds, `video_render` can't render it (10-minute limit): deliver the
speech track as in Step 4 and tell the user the video was too long to recombine.

**3b. Render.** Pass the source video as `assetIds[0]` and the speech track as `assetIds[1]`. The
video track uses only the source picture; the audio track uses only the cleaned speech. Express
`fps` and `duration` as rationals (`{ "n": <numerator>, "d": <denominator> }`) — e.g. 29.97 fps →
`{ "n": 30000, "d": 1001 }`, 30 fps → `{ "n": 30, "d": 1 }`, a 73.883 s duration →
`{ "n": 73883, "d": 1000 }`.

```javascript
video_render({
  assetIds: ["<source asset ID>", "<speech track URL>"],
  filename: "<source-name>-clean-audio",
  document: {
    version: 1,
    width: <width>,
    height: <height>,
    framerate: <fps as rational>,
    tracks: [
      {
        type: "video",
        clips: [{
          mediaIndex: 0,
          sourceStart: { n: 0, d: 1 },
          sourceDuration: <duration as rational>,
          editStart: { n: 0, d: 1 }
        }]
      },
      {
        type: "audio",
        clips: [{
          mediaIndex: 1,
          sourceStart: { n: 0, d: 1 },
          sourceDuration: <duration as rational>,
          editStart: { n: 0, d: 1 }
        }]
      }
    ]
  }
})
```

Wait for the completed render; never act on a pending status.

**3c. Export.** Export the rendered video in the source's container — `mov` for a `.mov` source,
otherwise `mp4`:

```javascript
video_export({
  assetId: "<rendered video>",
  format: "<mp4 or mov>",
  filename: "<source-name>-clean-audio"
})
```

---

### Step 4 — Deliver

Present only URLs that a tool actually returned:

- **Video source** → `<source-name> (clean audio).<ext> → <exported video URL>`
- **Audio source** → `<source-name> (clean speech) → <speech track URL>`

Add one line noting that background music/ambient sound was removed along with the noise and echo.

---

## Error Handling

| Situation | Action |
|---|---|
| No speech in the file | Tell the user there is no speech to clean up; do not deliver an empty or silent result as success |
| `media_enhance_speech` returns 403 (not on user's plan) | Stop — tell the user speech enhancement isn't included in their Adobe plan; do not retry |
| `video_metadata`, `video_render`, or `video_export` returns 403 (not on user's plan) | Deliver the cleaned speech track and tell the user it couldn't be put back on the video because that feature isn't included in their Adobe plan; do not retry |
| `video_render` or `video_export` fails with a temporary error (`5xx`/`429`) | Retry once; if it still fails, deliver the cleaned speech track and state that it could not be recombined with the video |
| Video longer than 10 minutes | Deliver the cleaned speech track and tell the user the video was too long to recombine |
| 401 (not authenticated) | Ask the user to sign in to Adobe again, then retry |
| Other `4xx` | Do not retry — report the error |

---

## Constraints

- Never pass a raw local filesystem path to any Adobe tool.
- Process multiple files one at a time.
