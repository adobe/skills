---
name: ops-index
description: Search index operations for Edge Delivery Services - reindex content for search, remove from index. Handles single and bulk indexing.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Search Index

Manage search index for Edge Delivery Services content.

## When to Use

- Page was published but search results are not reflecting the latest content
- New pages need to be made searchable immediately without waiting for scheduled indexing
- A page was deleted and its stale entry needs to be removed from the search index
- Bulk re-indexing a section of the site after a structural content change
- Diagnosing search relevance issues by forcing a fresh index of specific pages

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| reindex page | `/index/{org}/{site}/{ref}/{path}` | POST |
| bulk reindex | `/index/{org}/{site}/{ref}/*` | POST |
| index status | `/index/{org}/{site}/{ref}/{path}` | GET |
| remove from index | `/index/{org}/{site}/{ref}/{path}` | DELETE |

## Operations

### Re-index (Single)

```bash
curl -s -X POST \
  -H "authorization: token ${AUTH_TOKEN}" \
  "https://admin.hlx.page/index/${ORG}/${SITE}/${REF}${PATH}"
```

**Success:** `Re-indexed {path}`

**▶ Recommended Next Actions:**
1. Confirm the page is now indexed
   ```
   show index status of {path}
   ```
2. If page is not yet published, publish it first then reindex
   ```
   publish {path}
   ```
3. Reindex additional pages in the same folder
   ```
   reindex all pages {folder}/
   ```
4. *(DA sites only)* View DA source to verify the page content that was just indexed is correct
   ```
   get DA source {site}{path}
   ```

### Re-index (Bulk)

**Limit: 1000 paths max per request.** For larger sets, batch into multiple calls.

```bash
curl -s -X POST \
  -H "authorization: token ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/path1", "/path2"]}' \
  "https://admin.hlx.page/index/${ORG}/${SITE}/${REF}/*"
```

**Success (202):** Bulk reindex job started — `job.name` returned.

**▶ Recommended Next Actions:**
1. Track progress
   ```
   check job status {jobName}
   ```
2. Review per-path results once complete
   ```
   get job details {jobName}
   ```
3. If pages remain absent from search, verify they are published
   ```
   check status of {path}
   ```

### Index Status

```bash
curl -s \
  -H "authorization: token ${AUTH_TOKEN}" \
  "https://admin.hlx.page/index/${ORG}/${SITE}/${REF}${PATH}"
```

**On success (200):** Display a status summary:

| Field | Value |
|-------|-------|
| **Path** | `{path}` |
| **Indexed** | `{indexed}` (true / false) |
| **Last Modified** | `{lastModified}` |

**▶ Recommended Next Actions:**
1. If page is not indexed, trigger a reindex
   ```
   reindex {path}
   ```
2. If page is not yet published, publish it first
   ```
   publish {path}
   ```
3. To remove the page from search results entirely
   ```
   remove from index {path}
   ```

### Remove from Index

**Requires Admin role.**

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will remove {path} from the search index. It will no longer appear in search results."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s -X DELETE \
  -H "authorization: token ${AUTH_TOKEN}" \
  "https://admin.hlx.page/index/${ORG}/${SITE}/${REF}${PATH}"
```

**Success:** `Removed {path} from search index`

**▶ Recommended Next Actions:**
1. Confirm the page is no longer indexed
   ```
   show index status of {path}
   ```
2. If live CDN also needs to come down
   ```
   unpublish {path}
   ```
3. If preview also needs to be removed
   ```
   delete preview of {path}
   ```
4. *(DA sites only)* Delete the DA source if the content is being permanently retired
   ```
   delete DA {site}{path}
   ```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "reindex /blog" | Re-index `/blog` |
| "update search index for /products" | Re-index `/products` |
| "remove /old-page from search" | Delete from index |
| "reindex /a, /b, /c" | Bulk re-index |
| "refresh the index" | Re-index (ask for path) |

## Success Criteria

- ✅ HTTP 200 received confirming the index operation completed
- ✅ Bulk re-index reports the job ID and user is directed to monitor job status
- ✅ Index removal confirmed — deleted pages no longer surface in search results
- ✅ Recommended next actions communicated based on whether the operation was single or bulk
