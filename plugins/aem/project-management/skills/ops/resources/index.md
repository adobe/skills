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
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/index/${ORG}/${SITE}/${REF}${PATH}"
```

**Success:** `Re-indexed {path}`

### Re-index (Bulk)

**Limit: 1000 paths max per request.** For larger sets, batch into multiple calls.

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/path1", "/path2"]}' \
  "https://admin.hlx.page/index/${ORG}/${SITE}/${REF}/*"
```

**Success:** `Job started: {jobName} - use "job status {jobName}" to track`

### Index Status

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/index/${ORG}/${SITE}/${REF}${PATH}"
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
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/index/${ORG}/${SITE}/${REF}${PATH}"
```

**Success:** `Removed {path} from search index`

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "reindex /blog" | Re-index `/blog` |
| "update search index for /products" | Re-index `/products` |
| "remove /old-page from search" | Delete from index |
| "reindex /a, /b, /c" | Bulk re-index |
| "refresh the index" | Re-index (ask for path) |
