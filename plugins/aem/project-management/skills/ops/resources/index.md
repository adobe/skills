---
name: ops-index
description: Search index operations for Edge Delivery Services - reindex content for search, remove from index. Handles single and bulk indexing.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Search Index

Manage search index for Edge Delivery Services content.

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

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "reindex /blog" | Re-index `/blog` |
| "update search index for /products" | Re-index `/products` |
| "remove /old-page from search" | Delete from index |
| "reindex /a, /b, /c" | Bulk re-index |
| "refresh the index" | Re-index (ask for path) |
