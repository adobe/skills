---
name: ops-content
description: Content operations for Edge Delivery Services - preview, publish, unpublish, and status checks. Handles single and bulk operations on content paths.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Content

Preview, publish, unpublish, and status operations for Edge Delivery Services content.

## API Reference

| Intent | Endpoint | Method | Required Role |
|--------|----------|--------|---------------|
| preview page | `/preview/{org}/{site}/{ref}/{path}` | POST | `basic_author`, `author`, `publish`, or `admin` |
| bulk preview | `/preview/{org}/{site}/{ref}/*` | POST | `author`, `publish`, or `admin` |
| preview status | `/preview/{org}/{site}/{ref}/{path}` | GET | `basic_author`+ |
| delete preview | `/preview/{org}/{site}/{ref}/{path}` | DELETE | `basic_author`+ |
| publish page | `/live/{org}/{site}/{ref}/{path}` | POST | `basic_publish`, `publish`, or `admin` |
| bulk publish | `/live/{org}/{site}/{ref}/*` | POST | `publish` or `admin` |
| publish status | `/live/{org}/{site}/{ref}/{path}` | GET | `basic_author`+ |
| unpublish | `/live/{org}/{site}/{ref}/{path}` | DELETE | `publish` or `admin` |
| bulk unpublish | `/live/{org}/{site}/{ref}/*` | POST (with `"delete": true` in body) | `publish` or `admin` |
| check status | `/status/{org}/{site}/{ref}/{path}` | GET | any authenticated user |
| bulk status | `/status/{org}/{site}/{ref}/*` | POST | any authenticated user |

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
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/preview/${ORG}/${SITE}/${REF}${PATH}"
```

**Success:** `Previewed: https://{ref}--{site}--{org}.aem.page{path}`

### Preview (Bulk)

**Limit: 1000 paths max per request.** For larger sets, batch into multiple calls.

**DA sites:** Bulk operations with `/*` wildcard are not supported on Document Authoring sites. List paths explicitly instead.

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/path1", "/path2"]}' \
  "https://admin.hlx.page/preview/${ORG}/${SITE}/${REF}/*"
```

### Delete Preview

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, confirm with user: "This will delete the preview for {path}. Proceed? (yes/no)"

```bash
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/preview/${ORG}/${SITE}/${REF}${PATH}"
```

### Publish (Single)

**Requires `basic_publish`, `publish`, or `admin` role** (`live:write` permission).

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/live/${ORG}/${SITE}/${REF}${PATH}"
```

**Success:** `Published: https://{ref}--{site}--{org}.aem.live{path}`

### Publish (Bulk)

**Limit: 1000 paths max per request.** For larger sets, batch into multiple calls.

**DA sites:** Bulk operations with `/*` wildcard are not supported on Document Authoring sites. List paths explicitly instead.

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/path1", "/path2"]}' \
  "https://admin.hlx.page/live/${ORG}/${SITE}/${REF}/*"
```

### Unpublish (Single)

**Requires `publish` or `admin` role** (`live:delete` permission). If user gets 403, they need the `publish` role added to their account.

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. Tell user: "This will unpublish {path} from the live site. Visitors will get a 404 error."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms with "yes"

```bash
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/live/${ORG}/${SITE}/${REF}${PATH}"
```

**Success:** `Unpublished {path} from live. Preview still available at https://{ref}--{site}--{org}.aem.page{path}`

### Unpublish (Bulk)

**DA sites:** Bulk operations with `/*` wildcard are not supported on Document Authoring sites. List paths explicitly instead.

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing, you MUST:
1. List ALL paths that will be unpublished
2. Tell user: "This will unpublish {N} pages from the live site. All these URLs will return 404 errors."
3. Ask: "Do you want to proceed? (yes/no)"
4. Only execute if user confirms with "yes"

Bulk unpublish uses the same bulk publish endpoint with `"delete": true`:

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"delete": true, "paths": ["/old-1", "/old-2", "/old-3"]}' \
  "https://admin.hlx.page/live/${ORG}/${SITE}/${REF}/*"
```

### Check Status

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/status/${ORG}/${SITE}/${REF}${PATH}"
```

### Bulk Status

For explicit paths:
```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/page-1", "/page-2"]}' \
  "https://admin.hlx.page/status/${ORG}/${SITE}/${REF}/*"
```

For wildcard (all pages under a path) — returns async job:
```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/blog/*"]}' \
  "https://admin.hlx.page/status/${ORG}/${SITE}/${REF}/*"
```

**Response format:** Present as table — Path | Preview Status | Live Status | Last Modified

**Note:** Wildcard returns HTTP 202 with job name. Use job status to get results.

## Branch Support

All operations support feature branches:

```bash
# Preview on feature branch
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/preview/${ORG}/${SITE}/${BRANCH}${PATH}"
```

Branch URLs: `https://{branch}--{site}--{org}.aem.page{path}`

## Workflow Shortcuts

### Preview and Publish (Single)

When user says "preview and publish /path", execute both in sequence:

```bash
# Step 1: Preview
HTTP_CODE=$(curl -s --connect-timeout 15 --max-time 120 -w "%{http_code}" -o /tmp/preview.json -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  "https://admin.hlx.page/preview/${ORG}/${SITE}/${REF}${PATH}")

# Step 2: Publish only if preview succeeded (200/201)
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
  curl -s --connect-timeout 15 --max-time 120 -X POST \
    -H "x-auth-token: ${AUTH_TOKEN}" \
    "https://admin.hlx.page/live/${ORG}/${SITE}/${REF}${PATH}"
  echo "Previewed and published: https://${REF}--${SITE}--${ORG}.aem.live${PATH}"
else
  echo "Preview failed (HTTP $HTTP_CODE). Publish aborted."
  cat /tmp/preview.json
fi
```

**Important:** Publish only proceeds when preview returns 200/201.

### Preview and Publish (Bulk)

When user says "preview and publish /path1, /path2, /path3":

```bash
PATHS='["/path1", "/path2", "/path3"]'

# Step 1: Bulk preview - get job name from response
PREVIEW_RESPONSE=$(curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "x-auth-token: ${AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"paths\": ${PATHS}}" \
  "https://admin.hlx.page/preview/${ORG}/${SITE}/${REF}/*")

JOB_NAME=$(echo "$PREVIEW_RESPONSE" | grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/"name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
echo "Preview job started: $JOB_NAME"

# Step 2: Wait for preview job to complete (max 60 attempts, ~5 minutes)
MAX_ATTEMPTS=60
ATTEMPT=0
FAILED=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  RESPONSE=$(curl -s --connect-timeout 15 --max-time 120 -w "\n%{http_code}" \
    -H "x-auth-token: ${AUTH_TOKEN}" \
    "https://admin.hlx.page/job/${ORG}/${SITE}/${REF}/preview/${JOB_NAME}")
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  STATUS=$(echo "$RESPONSE" | sed '$d')
  
  if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "202" ]; then
    echo "Failed to fetch job status (HTTP $HTTP_CODE). Aborting."
    exit 1
  fi
  
  STATE=$(echo "$STATUS" | grep -o '"state"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"//')
  FAILED=$(echo "$STATUS" | grep -o '"failed"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*$')
  
  [ "$STATE" = "stopped" ] || [ "$STATE" = "completed" ] && break
  ATTEMPT=$((ATTEMPT + 1))
  sleep 5
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
  echo "Preview job timeout. Check status manually before publishing."
  exit 1
fi

# Step 3: Only publish if preview had no failures
if [ "${FAILED:-0}" -eq 0 ]; then
  curl -s --connect-timeout 15 --max-time 120 -X POST \
    -H "x-auth-token: ${AUTH_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"paths\": ${PATHS}}" \
    "https://admin.hlx.page/live/${ORG}/${SITE}/${REF}/*"
  echo "Publish job started"
else
  echo "Preview had $FAILED failures. Publish aborted. Check job details for failed paths."
fi
```

**Important:** Publish only proceeds when preview job completes with zero failures.

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "preview /blog/my-post" | Preview single on main |
| "preview /blog/my-post on feature-x" | Preview on branch |
| "preview the homepage" | Preview `/` |
| "preview and publish /about" | Preview then publish (single) |
| "preview and publish /p1, /p2, /p3" | Preview then publish (bulk) |
| "publish /products/widget and /products/gadget" | Bulk publish |
| "unpublish /old-page" | Unpublish single |
| "unpublish /old-1, /old-2, /old-3" | Bulk unpublish (confirm) |
| "check status of /about" | Status check |
| "is /blog/post published?" | Status check (live) |
| "status of all pages under /blog" | Bulk status (wildcard) |
| "get status of /p1, /p2, /p3" | Bulk status (explicit paths) |
