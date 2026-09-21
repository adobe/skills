# Asset input & output handling

Load this when uploading files, resolving inline-paste images, hitting a macOS permission error, or
saving outputs locally.

## Uploading assets — 3-rule decision (apply in order, stop at first match)

**Rule 1 — Have a local file path?**
→ Call `upload_asset(filePaths: [path])` immediately. Do not diagnose your environment first.
→ If it throws a hosted-mode error (`"filePath" not supported` / `not available in hosted mode`):
  switch to the **Hosted upload flow** below. Do not retry with a different path.

**Rule 2 — Have a URL (public, presigned, or SAS)?**
→ Call `upload_asset(urls: [url])`. No further evaluation needed.

**Rule 3 — User attached a file in chat with no path available?**
→ Use the **Hosted upload flow** below (`create_upload_url` → POST → use response `url`).

**Never use base64 for file assets** — base64 is only for small text/JSON payloads already in memory.
Never use claude.ai sandbox paths (`/mnt/user-data/…`, `/home/claude/…`, `/tmp/claude…`) as
`filePaths` — the MCP server can never read them.

If you have none of the above (no path, no URL, no attached file): ask the user before calling anything.

## Hosted upload flow (hosted mode only)

Use this whenever `upload_asset` with `filePath`/`filePaths` throws the hosted-mode error, or the user
is on a hosted MCP connection and has (or has been asked to) attach real asset files in chat. Files
attached in chat land inside the client's own code-execution/analysis sandbox (e.g. Claude Desktop's,
typically under `/mnt/user-data/uploads/…`) — that environment can reach them, the MCP server cannot.

1. Call `create_upload_url` once per file (or one batched call with `files: [{fileName, mediaType}, …]`
   for a folder's worth of assets). Each result carries `uploadUrl`, `uploadToken`, `fileName` plus a
   self-describing POST spec (`method`, `fieldName`, `tokenHeader`, `mediaType`, `expectedResponse`, and
   a ready-to-run `example`) so you can build the upload from the tool result alone. `uploadUrl` is on
   this **same run-workflow domain** (`/mcp/upload`) — never an Azure Storage domain — so nothing here
   requires the client's sandbox to reach any host beyond the one it already uses for the MCP
   connection itself.
2. For each file, use the code-execution/analysis tool (NOT an MCP tool call) to POST the attached
   file's bytes as `multipart/form-data` straight to its `uploadUrl`, sending the `uploadToken` in the
   `x-upload-token` header (never in the URL) — bytes never enter the model's context or any MCP
   tool-call payload:
   ```
   curl -X POST -H "x-upload-token: <uploadToken>" -F "file=@<path-to-attached-file>;type=<mediaType>" "<uploadUrl>"
   ```
3. The POST response is itself `{ url, blobPath, storageType }`. Use **that response's `url`** (not the
   `uploadUrl` you POSTed to) directly as the workflow input — pass it as the input's `content[].url`.
   A follow-up `upload_asset` with `url`/`urls` set to it is **optional**: it recognizes the already-
   valid presigned URL and passes it through unchanged, so it adds a round-trip without moving bytes.
   Use it only if you specifically want the normalized asset-reference shape back.

## Folder paths — check access, then curate

When the user gives a **folder** path (not a single file), don't hand the raw folder to `upload_asset`
blindly. Instead:

1. **Check access.** Try to list the folder's contents yourself (e.g. `ls`/`Glob` on the path). If that
   fails with a permission error, tell the user you don't have access and ask them to grant it — either
   by moving the folder to an accessible location or by granting access when prompted. (This is a
   separate permission boundary from the run-workflow MCP server's own access — if `upload_asset` later
   also fails with EPERM on the same path, follow the reactive `request_folder_access` flow below;
   don't conflate the two.)
2. **Pull everything.** Once listable, enumerate every file in the folder — not just images. Include
   documents, CSVs, fonts, templates, etc. so nothing relevant is missed.
3. **Analyze relevance.** Match each file against what the current task actually needs (e.g. for a
   banners-at-scale run: product images, a template, fonts, a merge CSV, brand guidelines — see
   [`intake.md`](intake.md) Step 4 for the checklist shape). Note files that are clearly unrelated (a
   random invoice, `.DS_Store`, an unrelated screenshot) and leave them out.
4. **Confirm before uploading.** Tell the user which files you found and which ones you plan to use; if
   it's ambiguous whether a file is relevant, ask rather than guessing. Then call `upload_asset` with an
   explicit `filePaths` list containing only the relevant files — not the bare folder path.

`upload_asset`'s own folder-expansion behavior (extension-whitelist only, no curation) is a fallback for
already-confirmed asset folders, not the default path for a folder the user just handed over.

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

The server organizes outputs internally under
`{outputDir}/sessions/{sessionId}/{workflowId}/outputs/` so re-runs never overwrite each other. If
the user granted a folder via `request_folder_access`, that path becomes the root instead.

**When downloading outputs** (only after the user confirms in the 3-step sequence in
[`SKILL.md`](../SKILL.md) — do not download automatically):
→ Pass `saveTo` set to an `outputs/` subfolder next to the user's input files. Example: if images
  came from `/Users/alice/photos/`, use `saveTo: "/Users/alice/photos/outputs/"`.
→ Always tell the user the exact folder path where files were saved. In Claude Desktop, files are
  written to disk and not shown inline (1MB cap).

`saveTo` is the user-facing destination you pass to `download_output`; the server's internal
session path above is separate — they compose, not compete.

## Retrieving outputs after completion

After `run_workflow_get_status` returns `completed`, read the **`OUTPUT URLS:` text block** that
leads the response — it lists every output as one compact `- <name> — <url>` line. Copy the `url`
values from those lines verbatim. This block is the intended source for presenting outputs.

**Do not parse the JSON `outputUrls[]` array to get URLs.** The response also ends with a large
`JSON.stringify(statusResult)` blob (batch metadata + `outputUrls[]`); it exists for programmatic /
diagnostic use only. On a big batch that blob is what balloons the response — reading it to fish out
URLs is the slow path.

**Large / overflowed responses (50+ outputs).** On a large batch the completed response can exceed
the client response budget and get truncated or written to a temp file. When that happens: make two
targeted greps — first grep for `VIEW YOUR ASSETS:` (show any folder-link lines found), then grep
for `OUTPUT URLS:` (take the contiguous `- … — …` lines that follow). Do **not**:
- do multiple exploratory reads through the JSON blob to reconstruct the URL list, or
- re-call `run_workflow_get_status` to "get the rest" — there is no pagination; the completed
  response already contains every URL, all in that one `OUTPUT URLS:` block.

Only check `downloadedOutputs[]` if the `OUTPUT URLS:` block is absent or empty. Only call
`inspect_run` as a last resort if both are absent. Do not call `display_asset` here — follow the
Presenting outputs sequence in [`SKILL.md`](../SKILL.md).
