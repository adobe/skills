---
name: ops-cache
description: Cache operations for Edge Delivery Services - purge CDN cache for paths. Supports regular and force purge modes.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Cache

Purge CDN cache for Edge Delivery Services content.

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| clear cache | `/cache/{org}/{site}/{ref}/{path}` | POST |
| force clear | `/cache/{org}/{site}/{ref}/{path}?forceUpdate=true` | POST |

## Operations

### Purge Cache

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/cache/${ORG}/${SITE}/${REF}${PATH}"
```

**Success:** `Cache purged for {path}`

### Force Purge Cache

Bypasses edge cache entirely:

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/cache/${ORG}/${SITE}/${REF}${PATH}?forceUpdate=true"
```

**Success:** `Force-purged cache for {path}`

### Purge All

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, confirm: "This will invalidate ALL cached content for the site. Proceed? (yes/no)"

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/cache/${ORG}/${SITE}/${REF}/*"
```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "clear cache for /about" | Purge `/about` |
| "force clear cache for /about" | Force purge with `forceUpdate=true` |
| "purge everything" | Purge `/*` |
| "invalidate cache" | Purge cache |
| "bust the cache for /products" | Purge `/products` |
