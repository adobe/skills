# Asset input & output handling

Load this when uploading files, resolving inline-paste images, hitting a macOS permission error, or
saving outputs locally.

The run-workflow MCP server is a **local process** on the user's machine. **It can only upload from a
real local file path or a URL** — it can never read an image that exists only as an inline paste/drag
in the chat. Never try to read, base64-encode, or open files yourself; delegate to `upload_asset`.
When you don't have a path or URL, ask the user for one.

## Where am I running?
- **Cursor** — real file paths and local references are available → use `upload_asset` with
  `filePaths`. Inline images and paths work as they do today; do not add prompts or change behavior.
- **Claude Code** — a path exists only when the user typed or `@`-mentioned it. A pasted screenshot
  is vision-only with no path → ask the user for a local file path or a URL.
- **Claude Desktop** — pasted/attached images have no local path the server can read → ask the user
  for a local file path or a URL.

## Routing

| Source | Call |
|---|---|
| Public URL | `upload_asset` with `urls` (server re-uploads to ADLS) |
| Presigned / SAS URL | `upload_asset` with `urls` (passed through unchanged) |
| Real local file path or folder | `upload_asset` with `filePaths` (folders expand to their image/video contents) |
| Inline paste with no path (Claude Code/Desktop) | Ask the user for a local path or URL — do **not** guess a path |
| A base64 string you already hold | `upload_asset` with `base64Items` |

Never transcribe a pasted image into base64. Never use claude.ai sandbox paths (`/mnt/user-data/…`,
`/home/claude/…`, `/tmp/claude…`) — they do not exist for the local MCP server.

## Inline-image flow (Claude Code / Desktop)
When the user provided an image inline (pasted/dragged, no path) and run-workflow needs it:
1. Prompt: *"Please share the local file path for that image (e.g.
   `/Users/<name>/Downloads/photo.jpg`), or a URL."*
2. Call `upload_asset` with `filePaths: ["<the path>"]`.

## On a permission error — MANDATORY, no exceptions

**CRITICAL: If `upload_asset` fails with ANY of these signals — `EPERM`, `permission`,
`access denied`, `operation not permitted` — you MUST call `request_folder_access`
immediately. Do NOT ask the user to re-upload, do NOT attempt base64 encoding,
do NOT suggest alternative paths. `request_folder_access` is the ONLY correct response.**

1. Call `request_folder_access` with `path` set to the exact file path that failed. This opens a
   **native folder picker**; the user selects the folder their asset is in, which grants access
   **without Full Disk Access**.
2. When it reports `granted: true`, retry `upload_asset` with the same path — it now works, and
   workflow outputs will be saved into that same folder (`<folder>/run-workflow-outputs/`).
3. Only if `request_folder_access` reports the grant did **not** take (older macOS / cancelled /
   denied), relay its Full Disk Access fallback message verbatim and stop.

**Forbidden fallbacks after an EPERM — treat these as bugs:**
- ❌ Asking the user to drag/upload the file through chat
- ❌ Trying to base64-encode the file yourself
- ❌ Suggesting the user move the file somewhere else
- ❌ Retrying `upload_asset` on the same path without calling `request_folder_access` first

Do not retry the same path in a loop or invent alternate paths (never `/mnt/user-data/…`).

## Workflow outputs
Downloaded outputs are organized per run under
`{outputDir}/sessions/{sessionId}/{workflowId}/outputs/`, so re-runs and multiple workflows never
overwrite each other. If the user granted a folder via `request_folder_access`, outputs go under
`<grantedFolder>/run-workflow-outputs/sessions/{sessionId}/{workflowId}/` instead.

**After a workflow completes (downloading outputs):**
→ Call `download_output` with `saveTo` set to an `outputs/` subfolder next to the user's input files.
   Example: if the user's images came from `/Users/alice/photos/`, use
   `saveTo: "/Users/alice/photos/outputs/"`.
   In Claude Desktop, output files are written directly to disk and are NOT shown inline in chat
   (1MB response cap).
→ Always tell the user the exact folder path where their files were saved.

## Retrieving outputs after completion

After `run_workflow_get_status(instanceId, includeOutputs: true)` returns, extract output URLs using
the **first matching path** below. Do NOT call `inspect_run` for successful runs.

**Path A — `outputUrls[]` present (preferred).** Each entry has `url`, `name`, `nodeId`, `mimeType`.
Use these directly.

**Path B — `downloadedOutputs[]` present.** Each entry also has `localPath`. Present `url`. Then
check displayability:
- Filter entries where `mimeType` is `image/jpeg`, `image/png`, `image/gif`, or `image/webp` (PDFs
  and videos are not displayable inline)
- If ≤ 5 displayable entries have a `localPath`, call `display_asset` with those paths to show them
  inline in chat
- If > 5 displayable entries, skip `display_asset` — listing URLs is sufficient (too many images
  would exceed the response cap)

**Path C — last resort.** Call `inspect_run` with the execution ID.

**Inline-capable clients (Cursor etc.):** the server already embeds inline images automatically — do
NOT call `display_asset`; still print the URLs in text (inline images are additive). In Claude
Desktop, never re-inline via `display_asset` (exceeds the response cap) — text URLs only.
