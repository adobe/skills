---
name: ops-cache
description: Cache operations for Edge Delivery Services - purge CDN cache for paths. Supports regular and force purge modes.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Cache

Purge CDN cache for Edge Delivery Services content.

## API Reference

| Intent | Endpoint | Method | Auth Required |
|--------|----------|--------|---------------|
| clear cache (single path) | `/cache/{org}/{site}/{ref}/{path}` | POST | Optional (`cache:write` if authenticated) |

> **Note:** The admin API documents only the single-path `POST /cache/{org}/{site}/{ref}/{path}` endpoint. Cache purge supports both authenticated (`Authorization: Bearer`) and unauthenticated requests. If your CDN uses a custom purge hook (`byo` CDN), it is triggered automatically when configured in the site settings. The `/*` wildcard path is not explicitly documented — use it cautiously as behavior may vary.

## Operations

### Purge Cache (Single Path)

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/cache/${ORG}/${SITE}/${REF}${PATH}"
```

**Success:** `Cache purged for {path}. Hard-refresh browser to verify.`

### Purge All (Wildcard — Use With Caution)

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

> This uses the `/*` wildcard path which is not explicitly documented in the admin API. It follows the same pattern as other bulk endpoints but behavior may vary.

Before executing, you MUST:
1. Tell user: "This will attempt to invalidate ALL cached content for the site."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/cache/${ORG}/${SITE}/${REF}/*"
```

**Success:** `{"status": 200, "path": "/*"}`

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "clear cache for /about" | Purge `/about` |
| "force clear cache for /about" | Purge `/about` (same endpoint) |
| "purge everything" | Purge `/*` |
| "invalidate cache" | Purge cache (ask for path) |
| "bust the cache for /products" | Purge `/products` |
