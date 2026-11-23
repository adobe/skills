---
name: adobe-summarize-media
description: >
  Summarizes the spoken content of a video or audio recording (meeting, interview, lecture,
  podcast, voice memo) with Adobe and saves the summary as a PDF. Use for requests like "summarize
  this recording", "summarize this video/audio", "give me a summary of this meeting recording", or
  "turn this interview into a PDF summary". Do NOT use for full transcripts or captions, for
  silent or music-only footage, or for visual highlight reels.
license: Apache-2.0
compatibility: "Runs on widget-capable surfaces (Claude, which supports the asset_add_file picker) and on surfaces without widgets (Codex), which use the asset_initialize_file_upload → PUT → asset_finalize_file_upload staging path. Raw local paths are never passed to Adobe tools."
allowed-tools: adobe_mandatory_init asset_add_file asset_openai_file_upload asset_initialize_file_upload asset_finalize_file_upload media_summarize markdown_to_pdf pdf_operation_status
metadata:
  version: 1.0.0
  visibility: public
  surface: [claude, codex]
---

# Adobe Summarize Media

Summarizes what is **said** in a video or audio recording and delivers the summary as a **PDF**,
plus a short version in chat.

> **Scope:** summaries only. Full transcripts and captions are out of scope for this skill.

> **Async handling (`media_summarize`):** a `status: "working"` result is **pending — not a failure and
> not missing output**. The finished result is delivered automatically when the job completes; do
> not call any poll tool yourself. Submit each job **once** — never resubmit while one is pending.
> If the result doesn't arrive, tell the user the job was submitted and is still processing, and
> don't offer workarounds.

---

## Tool Reference

| Step | Tool | Notes |
|------|------|-------|
| Initialize | `adobe_mandatory_init` | Returns file-handling rules and tool routing |
| Select recording | `asset_add_file` | File picker widget; injects the asset ID on confirmation |
| Upload file attached in ChatGPT | `asset_openai_file_upload` | ChatGPT only; returns a URL for the Adobe tools |
| Upload attached/local file | `asset_initialize_file_upload` | Starts the upload; returns a PUT URL |
| Finish upload | `asset_finalize_file_upload` | Completes the upload; returns the asset ID |
| Summarize spoken content | `media_summarize` | Needs significant dialogue or narration |
| Save summary as PDF | `markdown_to_pdf` | Converts inline Markdown to a PDF |
| Wait for PDF | `pdf_operation_status` | Only when `markdown_to_pdf` returns a `tracking_id` |

---

## Workflow

### Step 0 — Initialize Adobe Tools

Call `adobe_mandatory_init` first. This returns file handling rules and tool routing guidance
required for the rest of the workflow.

```json
{ "skill_name": "adobe-summarize-media", "skill_version": "1.0.0" }
```

---

### Step 1 — Get the Recording

`media_summarize` accepts a Creative Cloud asset ID (e.g. `urn:aaid:sc:...`) or a presigned HTTPS URL from an approved storage host. Never pass a raw local path.

| Source | Action |
|---|---|
| File attached in ChatGPT and `asset_openai_file_upload` is available | Call `asset_openai_file_upload` with the attached file and use the URL it returns. Don't pass the attached file's local path to `asset_upload_file_from_url` — it only accepts https URLs. |
| File attached in chat (e.g. `/mnt/user-data/uploads/…`) | Check egress status from `adobe_mandatory_init` (Step 0). If egress is enabled, upload it directly: get its size and MIME type, call `asset_initialize_file_upload({ path, media_type })`, PUT the bytes to the returned URL, then call `asset_finalize_file_upload({ filename, transfer_document })` and use the returned asset ID. If egress is disabled, open the picker (`asset_add_file()`) instead. |
| Creative Cloud asset ID or presigned URL in the message | Use it directly. |
| No file provided yet | Open the picker — no need to ask first. |

Opening the picker:

> *"Let's summarize your recording. Start by selecting your file:"*

```javascript
asset_add_file()
```

Wait for the widget to inject the asset ID on confirmation — do not poll.

> **No-widget fallback** *(only if `asset_add_file` is unavailable on this surface, e.g. Codex)* —
> stage any local file with the same `asset_initialize_file_upload` → PUT →
> `asset_finalize_file_upload` sequence. If egress is disabled, tell the user the file can't be
> staged on this surface. If no file was provided, ask the user to attach their video or audio file.

If the selected file is not `video/*` or `audio/*`, say so and ask for a video or audio recording.

---

### Step 2 — Summarize the Spoken Content

```javascript
media_summarize({
  assetId: "<asset ID or presigned URL>",
  filename: "<recording-name>-summary"
})
```

Use a short, descriptive `filename` without an extension (e.g. `"team-sync-summary"`).

Acknowledge briefly while it runs: *"Summarizing your recording — this can take a moment for longer
files."* If the result reports a pending/working status, wait for the completed result; never act on
a pending status.

From the completed result, keep the **summary text**. Then continue to Step 3 right away, in the same reply —
the job isn't done until the PDF is created. Don't stop and deliver only the summary text.

---

### Step 3 — Save the Summary as PDF

Format the summary text from `media_summarize` as Markdown — a `# <recording name> — Summary`
title followed by the summary content — and pass it to `markdown_to_pdf`. Use only content from the
`media_summarize` result; do not add facts.

```javascript
markdown_to_pdf({ /* Markdown summary, per the tool's input schema */ })
```

If `markdown_to_pdf` returns a `tracking_id`, call `pdf_operation_status` with that exact
`tracking_id` and `operation_name: "markdown_to_pdf"` until it returns a final result.

Present only a PDF URL that the tools actually returned — never reconstruct or invent one.

---

### Step 4 — Deliver

Reply with:

1. The PDF link: `<recording-name> summary.pdf → <pdf URL>`.
2. A short version of the summary (a few bullet points) taken from the `media_summarize` result.

Do not add facts that are not in the `media_summarize` result.

---

## Error Handling

| Situation | Action |
|---|---|
| Little or no speech (silent, music-only, very short) | Tell the user the recording doesn't have enough speech to summarize; do not invent a summary |
| `media_summarize` returns 403 (not on user's plan) | Stop — tell the user summarization isn't included in their Adobe plan; do not retry |
| `markdown_to_pdf` returns 403 (not on user's plan) | Show the summary in chat and tell the user it couldn't be saved as PDF because PDF creation isn't included in their Adobe plan; do not retry |
| `markdown_to_pdf` fails with a temporary error (`5xx`/`429`) | Retry once; if it still fails, show the summary in chat and state that the PDF could not be created |
| 401 (not authenticated) | Ask the user to sign in to Adobe again, then retry |
| Other `4xx` | Do not retry — report the error |

---

## Constraints

- Never pass a raw local filesystem path to `media_summarize`.
- Process multiple recordings one at a time.
