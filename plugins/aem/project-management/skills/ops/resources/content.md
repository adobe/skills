---
name: ops-content
description: Content operations for Edge Delivery Services - preview, publish, unpublish, and status checks. Handles single and bulk operations on content paths.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Content

Preview, publish, unpublish, and status operations for Edge Delivery Services content.

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

### Preview (Single)

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/preview/${ORG}/${SITE}/${REF}${PATH}"
```

**Success:** `Previewed: https://{ref}--{site}--{org}.aem.page{path}`

### Preview (Bulk)

**Limit: 1000 paths max per request.** For larger sets, batch into multiple calls.

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/path1", "/path2"]}' \
  "https://admin.hlx.page/preview/${ORG}/${SITE}/${REF}/*"
```

### Delete Preview

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, confirm with user: "This will delete the preview for {path}. Proceed? (yes/no)"

```bash
curl -s -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/preview/${ORG}/${SITE}/${REF}${PATH}"
```

### Publish (Single)

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/live/${ORG}/${SITE}/${REF}${PATH}"
```

**Success:** `Published: https://{ref}--{site}--{org}.aem.live{path}`

### Publish (Bulk)

**Limit: 1000 paths max per request.** For larger sets, batch into multiple calls.

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/path1", "/path2"]}' \
  "https://admin.hlx.page/live/${ORG}/${SITE}/${REF}/*"
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
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/live/${ORG}/${SITE}/${REF}${PATH}"
```

**Success:** `Unpublished {path} from live`

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
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/old-1", "/old-2", "/old-3"]}' \
  "https://admin.hlx.page/live/${ORG}/${SITE}/${REF}/*"
```

### Check Status

```bash
curl -s \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/status/${ORG}/${SITE}/${REF}${PATH}"
```

### Bulk Status

```bash
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/page-1", "/page-2"]}' \
  "https://admin.hlx.page/status/${ORG}/${SITE}/${REF}/*"
```

## Branch Support

All operations support feature branches:

```bash
# Preview on feature branch
curl -s -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
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
