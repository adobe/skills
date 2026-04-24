---
name: ops-content
description: Content operations for Edge Delivery Services - preview, publish, unpublish, and status checks. Handles single and bulk operations on content paths.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Content

Preview, publish, unpublish, and status operations for Edge Delivery Services content.

## When to Use

- Author finished editing and content needs to appear on the preview CDN
- Previewed page is ready to go live — promote to the live CDN
- Page needs to be taken down from live (unpublish)
- Bulk-promoting an entire site or subtree across preview or live
- Diagnosing stale content — checking whether preview/live timestamps match the latest edit
- Removing a deleted page from the preview or live CDN

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| preview page | `/preview/{org}/{site}/{ref}/{path}` | POST |
| bulk preview | `/preview/{org}/{site}/{ref}/*` | POST |
| preview status | `/preview/{org}/{site}/{ref}/{path}` | GET |
| delete preview | `/preview/{org}/{site}/{ref}/{path}` | DELETE |
| publish page | `/live/{org}/{site}/{ref}/{path}` | POST |
| bulk publish | `/live/{org}/{site}/{ref}/*` | POST |
| publish status | `/live/{org}/{site}/{ref}/{path}` | GET |
| unpublish | `/live/{org}/{site}/{ref}/{path}` | DELETE |
| bulk unpublish | `/live/{org}/{site}/{ref}/*` | DELETE |
| check status | `/status/{org}/{site}/{ref}/{path}` | GET |
| bulk status | `/status/{org}/{site}/{ref}/*` | POST |

## Path Normalization

- Ensure paths start with `/`
- Remove trailing slashes
- "homepage" → `/`
- URL-encode special characters

| User Input | Normalized |
|------------|------------|
| "homepage" | `/` |
| "about page" | `/about` |
| "/blog/my-post" | `/blog/my-post` |
| "blog/my-post" | `/blog/my-post` |
| "/products/" | `/products` |
| "the nav" | `/nav` |

## Operations

## Auth

| Operation | Header |
|-----------|--------|
| Preview, Publish, Unpublish, Delete preview | `authorization: Bearer ${IMS_TOKEN}` + `x-content-source-authorization: Bearer ${IMS_TOKEN}` |
| Status checks (GET /status, GET /preview, GET /live) | `authorization: token ${AUTH_TOKEN}` |

### Preview (Single)

```bash
curl -s -X POST \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  -H "x-content-source-authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/preview/${ORG}/${SITE}/${REF}${PATH}"
```

**On success (200 / 201):**
```
Preview URL: https://{ref}--{site}--{org}.aem.page{path}
```

**▶ Recommended Next Actions:**
1. Open the preview URL to review content — `https://{ref}--{site}--{org}.aem.page{path}`
2. Promote to live when approved
   ```
   publish {path}
   ```
3. Verify timestamps if preview appears stale
   ```
   check status of {path}
   ```
4. *(DA sites only)* View the DA source to inspect the document that was just previewed
   ```
   get DA source {site}{path}
   ```

### Preview (Bulk)

**Limit: 1000 paths max per request.** For larger sets, batch into multiple calls.

**⚠️ DA (Document Authoring) Limitation:** Wildcard bulk preview is **not supported** on sites using DA as the content source. The API returns:
> `wildcard paths are not supported with a markup mountpoint`

Check the site's content source type before running bulk operations:
```bash
curl -s -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/config/${ORG}/sites/${SITE}.json" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('content',{}).get('source',{}).get('type','unknown'))"
```

| `content.source.type` | Wildcard bulk supported? |
|---|---|
| `markup` (DA) | ❌ No — use explicit paths only |
| `onedrive` (SharePoint) | ✅ Yes |
| `google` (Google Drive) | ✅ Yes |

```bash
# Folder wildcard — supported on SharePoint/Google Drive sites only
curl -s -X POST \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  -H "x-content-source-authorization: Bearer ${IMS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/en/help-center/*"]}' \
  "https://admin.hlx.page/preview/${ORG}/${SITE}/${REF}/*"

# Explicit paths — works on ALL sites including DA
curl -s -X POST \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  -H "x-content-source-authorization: Bearer ${IMS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/path1", "/path2"]}' \
  "https://admin.hlx.page/preview/${ORG}/${SITE}/${REF}/*"
```

**Success (202):** Bulk preview job started — `job.name` returned.

**▶ Recommended Next Actions:**
1. Track progress
   ```
   check job status {jobName}
   ```
2. Once complete, review per-path results
   ```
   get job details {jobName}
   ```
3. Publish all pages when approved
   ```
   publish all pages {folder}/
   ```

### Delete Preview

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, confirm with user: "This will delete the preview for {path}. Proceed? (yes/no)"

```bash
curl -s -X DELETE \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  -H "x-content-source-authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/preview/${ORG}/${SITE}/${REF}${PATH}"
```

**On success (200 / 204):**
```
Preview deleted. https://{ref}--{site}--{org}.aem.page{path} now returns 404.
Live CDN is unaffected.
```

**▶ Recommended Next Actions:**
1. Confirm preview layer shows 404
   ```
   check status of {path}
   ```
2. *(DA sites only)* Delete the DA source too if the document itself is being permanently retired
   ```
   delete DA {site}{path}
   ```

### Publish (Single)

```bash
curl -s -X POST \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  -H "x-content-source-authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/live/${ORG}/${SITE}/${REF}${PATH}"
```

**On success (200 / 201):**
```
Live URL: https://main--{site}--{org}.aem.live{path}
```

**▶ Recommended Next Actions:**
1. Open the live URL to confirm — `https://main--{site}--{org}.aem.live{path}` (CDN propagation takes up to 60 seconds)
2. If live URL shows stale content after 60 seconds
   ```
   purge cache of {path}
   ```
3. Verify `live.lastModified` was updated
   ```
   check status of {path}
   ```
4. *(DA sites only)* View DA version history to track who authored the published content
   ```
   list DA versions of {site}{path}
   ```

### Publish (Bulk)

**Limit: 1000 paths max per request.** For larger sets, batch into multiple calls.

**⚠️ Two restrictions apply:**
1. **DA sites:** Wildcard paths not supported — use explicit paths only (same as bulk preview)
2. **All sites:** Wildcard subtree publish (`/en/*`) is blocked by the API for security reasons — explicit paths required

> `bulk-publish does not support publishing of subtrees due to security reasons`

Use explicit paths only:

```bash
curl -s -X POST \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  -H "x-content-source-authorization: Bearer ${IMS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/path1", "/path2"]}' \
  "https://admin.hlx.page/live/${ORG}/${SITE}/${REF}/*"
```

**Success (202):** Bulk publish job started — `job.name` returned.

**▶ Recommended Next Actions:**
1. Track progress
   ```
   check job status {jobName}
   ```
2. If pages remain stale after job completion
   ```
   purge cache of {folder}/
   ```

### Unpublish (Single)

**Requires Admin role.**

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will unpublish {path} from the live site. Visitors will get a 404 error."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s -X DELETE \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  -H "x-content-source-authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/live/${ORG}/${SITE}/${REF}${PATH}"
```

**On success (200 / 204):**
```
{path} now returns 404 on live CDN.
Preview still available at: https://{ref}--{site}--{org}.aem.page{path}
```

**▶ Recommended Next Actions:**
1. Confirm live layer shows 404
   ```
   check status of {path}
   ```
2. Remove from search index so it no longer appears in results
   ```
   remove from index {path}
   ```
3. If preview also needs to be removed
   ```
   delete preview of {path}
   ```
4. *(DA sites only)* Delete the DA source if the content is being permanently retired
   ```
   delete DA {site}{path}
   ```

### Unpublish (Bulk)

**Requires Admin role.**

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. List ALL paths that will be unpublished
2. Tell user: "This will unpublish {N} pages from the live site. All these URLs will return 404 errors."
3. Ask: "Do you want to proceed? (yes/no)"
4. Only execute if user confirms with "yes"

```bash
curl -s -X DELETE \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  -H "x-content-source-authorization: Bearer ${IMS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/old-1", "/old-2", "/old-3"]}' \
  "https://admin.hlx.page/live/${ORG}/${SITE}/${REF}/*"
```

**Success (202):** Bulk unpublish job started — `job.name` returned.

**▶ Recommended Next Actions:**
1. Track progress
   ```
   check job status {jobName}
   ```
2. Remove pages from search index
   ```
   reindex {folder}/
   ```

### Check Status

```bash
curl -s \
  -H "authorization: token ${AUTH_TOKEN}" \
  "https://admin.hlx.page/status/${ORG}/${SITE}/${REF}${PATH}"
```

**On success (200):** Display a status summary using the full URLs. Use `preview.url` as the heading — not the short path.

```
Status of https://{ref}--{site}--{org}.aem.page{path}

| Layer   | Status | Last Modified          |
|---------|--------|------------------------|
| Preview | ✅ 200 | {preview.lastModified} |
| Live    | ✅ 200 | {live.lastModified}    |
| Edit    | —      | {edit.lastModified}    |
```

Then diagnose:

| Condition | Recommended Action |
|-----------|-------------------|
| `edit` newer than `preview` | `preview {path}` — content changed since last preview |
| `preview` newer than `live` | `publish {path}` — preview is ahead of live |
| Timestamps match, browser shows old content | `purge cache {path}` — CDN cache is stale |
| `live.status` = 404 | `publish {path}` — page not published yet |
| All in sync | No action needed — page is up to date |

**▶ Recommended Next Actions:**
1. If edit is ahead of preview
   ```
   preview {path}
   ```
2. If preview is ahead of live
   ```
   publish {path}
   ```
3. If timestamps match but browser shows stale content
   ```
   purge cache of {path}
   ```
4. *(DA sites only)* View the DA source to inspect the current document state in the authoring layer
   ```
   get DA source {site}{path}
   ```

### Bulk Status

```bash
curl -s -X POST \
  -H "authorization: token ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/page-1", "/page-2"]}' \
  "https://admin.hlx.page/status/${ORG}/${SITE}/${REF}/*"
```

**Success (202):** Bulk status job started — `job.name` returned.

**▶ Recommended Next Actions:**
1. Track progress
   ```
   check job status {jobName}
   ```
2. Review per-path results once complete
   ```
   get job details {jobName}
   ```
3. Preview pages that are behind
   ```
   preview all pages {folder}/
   ```

## Branch Support

All operations support feature branches:

```bash
# Preview on feature branch
curl -s -X POST \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  -H "x-content-source-authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/preview/${ORG}/${SITE}/${BRANCH}${PATH}"
```

Branch URLs: `https://{branch}--{site}--{org}.aem.page{path}`

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "preview /blog/my-post" | Preview single on main |
| "preview /blog/my-post on feature-x" | Preview on branch |
| "preview the homepage" | Preview `/` |
| "publish /products/widget and /products/gadget" | Bulk publish |
| "unpublish /old-page" | Unpublish single |
| "unpublish /old-1, /old-2, /old-3" | Bulk unpublish (confirm) |
| "check status of /about" | Status check |
| "is /blog/post published?" | Status check (live) |

## Success Criteria

- ✅ HTTP 200 or 201 received from the Admin API
- ✅ Preview or live URL shown to user after a successful operation
- ✅ Bulk operations report the job ID and user is directed to check job status
- ✅ Status checks display a layered summary (preview / live / edit timestamps)
- ✅ Destructive operations (unpublish, delete preview) confirmed with user before executing
- ✅ Recommended next actions communicated based on the operation result
