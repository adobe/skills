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

## Auth

All cache operations require:
```
authorization: Bearer ${IMS_TOKEN}
x-content-source-authorization: Bearer ${IMS_TOKEN}
```

## Operations

### Purge Cache

```bash
curl -s -X POST \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  -H "x-content-source-authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/cache/${ORG}/${SITE}/${REF}${PATH}"
```

**Success:** `Cache purged for {path}`

> **Note:** Cache purge does NOT republish — it only clears what the CDN has cached. If the page content is wrong, run Publish first, then purge.

**▶ Recommended Next Actions:**
1. Hard-refresh your browser — `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows)
2. If content remains incorrect after purge, republish first
   ```
   publish {path}
   ```
3. Verify publish and cache state are aligned
   ```
   check status of {path}
   ```

### Force Purge Cache

Bypasses edge cache entirely:

```bash
curl -s -X POST \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  -H "x-content-source-authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/cache/${ORG}/${SITE}/${REF}${PATH}?forceUpdate=true"
```

**Success:** `Force-purged cache for {path}`

**▶ Recommended Next Actions:**
1. Hard-refresh your browser — `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows)
2. If content remains incorrect, republish to push latest version
   ```
   publish {path}
   ```

### Purge All

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, confirm: "This will invalidate ALL cached content for the site. Proceed? (yes/no)"

```bash
curl -s -X POST \
  -H "authorization: Bearer ${IMS_TOKEN}" \
  -H "x-content-source-authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/cache/${ORG}/${SITE}/${REF}/*"
```

**▶ Recommended Next Actions:**
1. Hard-refresh your browser — `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows)
2. Allow 10–15 seconds before checking — full site purge takes longer to propagate than single-path purge
3. If specific pages remain stale, republish them
   ```
   publish {path}
   ```

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "clear cache for /about" | Purge `/about` |
| "force clear cache for /about" | Force purge with `forceUpdate=true` |
| "purge everything" | Purge `/*` |
| "invalidate cache" | Purge cache |
| "bust the cache for /products" | Purge `/products` |
