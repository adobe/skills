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

> **Note:** The admin API documents only the single-path `POST /cache/{org}/{site}/{ref}/{path}` endpoint. Cache purge supports both authenticated (`x-auth-token`) and unauthenticated requests. If your CDN uses a custom purge hook (`byo` CDN), it is triggered automatically when configured in the site settings. The `/*` wildcard path is not explicitly documented — use it cautiously as behavior may vary.

## Operations

### Purge Cache (Single Path)

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/cache/${ORG}/${SITE}/${REF}${PATH}"
```

**Success:** `Cache purged for {path}. Hard-refresh browser to verify.`

### Purge All (Wildcard — Use With Caution)

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

> This uses the `/*` wildcard path which is not explicitly documented in the admin API. It follows the same pattern as other bulk endpoints but behavior may vary.

Before executing, confirm: "This will attempt to invalidate ALL cached content for the site. Proceed? (yes/no)"

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
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
