---
name: ops-da
description: Document Authoring (DA) admin operations - list content, get/put source, copy, move, delete, versioning, and configuration via admin.da.live API.
allowed-tools: Read, Write, Edit, Bash
---

# Edge Delivery Services Operations - Document Authoring (DA)

Content management operations for Document Authoring repository (`admin.da.live`).

## Prerequisites

**IMS Token Required** - Uses the same IMS token as all other operations.

If token is missing, invoke the auth skill first:
```
Skill({ skill: "project-management:auth" })
```

---

## API Reference

Base URL: `https://admin.da.live`

| Intent | Endpoint | Method | Description |
|--------|----------|--------|-------------|
| List orgs | `/list` | GET | List available DA organizations |
| List content | `/list/{org}/{site}/{path}` | GET | List files/folders |
| Get source | `/source/{org}/{site}/{path}` | GET | Get file content |
| Create/update | `/source/{org}/{site}/{path}` | POST | Upload content (form-data or text/html) |
| Delete | `/source/{org}/{site}/{path}` | DELETE | Delete file or folder |
| Copy | `/copy/{org}/{site}/{path}` | POST | Copy file/folder (form-data) |
| Move | `/move/{org}/{site}/{path}` | POST | Move/rename (form-data) |
| Upload media | `/media/{org}/{site}/{path}` | POST | Upload images/media via AEM media API |
| Get config | `/config/{org}/{site}` | GET | Get DA site config |
| Set config | `/config/{org}/{site}` | POST | Update DA site config (form-data) |
| List versions | `/versionlist/{org}/{site}/{path}` | GET | List file versions |
| Get version | `/versionsource/{org}/{site}/{fileId}/{versionId}.{ext}` | GET | Get version content (URL from version list) |
| Create version | `/versionsource/{org}/{site}/{path}` | POST | Create a labeled version snapshot |

---

## Operations

### List Organizations

Show all DA organizations the user has access to.

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/list"
```

**Response:**
```json
[
  {"name": "myorg", "created": "2024-01-15T10:30:00Z"},
  {"name": "another-org", "created": "2024-02-20T14:00:00Z"}
]
```

### List Content

List files and folders in a DA path.

```bash
# List site root
curl -s --connect-timeout 15 --max-time 120 \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/list/${ORG}/${SITE}"

# List specific folder
curl -s --connect-timeout 15 --max-time 120 \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/list/${ORG}/${SITE}/blog"
```

**Response:** A flat JSON array of items. Files have `ext` and `lastModified`; folders do not.
```json
[
  {"path": "/mysite/index.html", "name": "index", "ext": "html", "lastModified": 1710493200000},
  {"path": "/mysite/about.html", "name": "about", "ext": "html", "lastModified": 1710430200000},
  {"path": "/mysite/blog", "name": "blog"}
]
```

**Present as table:**
| Name | Type | Last Modified |
|------|------|---------------|
| index.html | file | 2024-03-15 09:00 |
| about.html | file | 2024-03-14 15:30 |
| blog/ | folder | - |

**Note:** Items without `ext` are folders. `lastModified` is a Unix epoch timestamp in milliseconds.

**Pagination:** If the response is truncated, the server returns a `da-continuation-token` response header. Pass it as a `da-continuation-token` request header to fetch the next page.

### Get Source Content

Retrieve file content from DA.

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/source/${ORG}/${SITE}/${PATH}"
```

For HTML files, response is the HTML content. For media, response is binary.

### Create/Update Content

Upload or update content in DA.

**Preferred method (form-data):**
```bash
# Upload HTML file
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "data=@content.html" \
  "https://admin.da.live/source/${ORG}/${SITE}/${PATH}"

# Upload JSON file
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "data=@data.json" \
  "https://admin.da.live/source/${ORG}/${SITE}/data.json"
```

**Alternative (raw text/html body):**
```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -H "Content-Type: text/html" \
  -d '<html><body><h1>Hello</h1></body></html>' \
  "https://admin.da.live/source/${ORG}/${SITE}/hello.html"
```

**Create folder (POST to path with no body):**
```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/source/${ORG}/${SITE}/drafts/new-folder"
```

**Success:** HTTP 201 (create) or 200 (update)

### Upload Media (Images, PDFs, Videos)

For images and other media that need processing through the AEM media pipeline, use the `/media/` endpoint:

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "data=@image.png" \
  "https://admin.da.live/media/${ORG}/${SITE}/media/hero.png"
```

**Note:** The `/media/` endpoint routes uploads through the AEM admin media API (`admin.hlx.page/media`) for proper CDN handling.

### Delete Content

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Before executing:
1. State: "This will permanently delete {path} from Document Authoring."
2. Ask: "Do you want to proceed? (yes/no)"
3. Only execute if user confirms "yes"

```bash
# Delete single file
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/source/${ORG}/${SITE}/${PATH}"

# Delete folder (recursive)
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/source/${ORG}/${SITE}/drafts/old-folder"
```

**Folder deletion:** For large folders, the API returns HTTP 206 with a JSON body containing `{"continuationToken": "..."}` indicating more items remain. Pass the token as a form field in the follow-up DELETE request:

```bash
curl -s --connect-timeout 15 --max-time 120 -X DELETE \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "continuation-token=${CONTINUATION_TOKEN}" \
  "https://admin.da.live/source/${ORG}/${SITE}/drafts/old-folder"
```

Repeat until you receive HTTP 204 (complete, no more items).

**Note:** There is no bulk delete-by-paths endpoint. To delete multiple individual files, issue separate DELETE requests for each path.

### Copy Content

Copy files or folders within DA. Uses **form-data** (not JSON).

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "destination=/${DEST_PATH}" \
  "https://admin.da.live/copy/${ORG}/${SITE}/${SOURCE_PATH}"
```

**Important:** The `destination` value is the path **within the site** (without org prefix). It starts with `/` followed by the site-relative path.

**Example:** Copy template to new page
```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "destination=/new-page.html" \
  "https://admin.da.live/copy/myorg/mysite/templates/basic.html"
```

**Example:** Copy to a different folder
```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "destination=/archive/article.html" \
  "https://admin.da.live/copy/myorg/mysite/drafts/article.html"
```

**Success:** HTTP 204 No Content

**Folder copy:** For large folders, the API returns HTTP 206 with a JSON body containing `{"continuationToken": "..."}`. Pass it as a form field in the follow-up request to continue copying:

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "destination=/archive/old-blog" \
  -F "continuation-token=${CONTINUATION_TOKEN}" \
  "https://admin.da.live/copy/myorg/mysite/blog"
```

### Move/Rename Content

Move or rename files/folders. Uses **form-data** (not JSON).

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "destination=/${DEST_PATH}" \
  "https://admin.da.live/move/${ORG}/${SITE}/${SOURCE_PATH}"
```

**Important:** The `destination` value is the path **within the site** (without org prefix). Destination cannot be a descendant of the source (returns 400).

**Example:** Rename file
```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "destination=/new-name.html" \
  "https://admin.da.live/move/myorg/mysite/old-name.html"
```

**Example:** Move to a different folder
```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "destination=/archive/2024/article.html" \
  "https://admin.da.live/move/myorg/mysite/drafts/article.html"
```

**Success:** HTTP 204 No Content

---

## Versioning Operations

DA automatically creates versions for HTML and JSON files on each save. You can also create labeled versions explicitly (snapshots) and retrieve previous versions.

### List Versions

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/versionlist/${ORG}/${SITE}/${PATH}"
```

**Response:** A flat JSON array of version entries (newest first). Each entry includes a `url` field with the path to retrieve that version's content.
```json
[
  {
    "users": "[{\"email\":\"user@example.com\"}]",
    "timestamp": "1710493200000",
    "path": "mysite/blog/article.html",
    "label": "Before Major Edit",
    "versionId": "aa449650-b75c-463b-ae57-15902cd21a86.html",
    "url": "/versionsource/myorg/mysite/f85f9b05-ae48-485b-a3b3-dd203ac5c734/aa449650-b75c-463b-ae57-15902cd21a86.html"
  },
  {
    "users": "[{\"email\":\"user@example.com\"}]",
    "timestamp": "1710430200000",
    "path": "mysite/blog/article.html"
  }
]
```

**Present as table:**
| # | Date | User | Label | Has Version |
|---|------|------|-------|-------------|
| 1 | 2024-03-15 09:00 | user@example.com | Before Major Edit | Yes |
| 2 | 2024-03-14 15:30 | user@example.com | — | No (audit only) |

**Notes:**
- `timestamp` is a Unix epoch in milliseconds (as a string).
- `users` is a JSON-encoded string containing an array of user objects.
- Entries with a `versionId` and `url` have retrievable content. Entries without are audit-only records.
- The `url` field is a relative path — prepend `https://admin.da.live` to form the full URL.

### Get Version Content

Use the `url` from the version list response:

```bash
# Get the full URL from the version list entry's "url" field
curl -s --connect-timeout 15 --max-time 120 \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live${VERSION_URL}"
```

**Example using a version list entry:**
```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/versionsource/myorg/mysite/f85f9b05-ae48-485b-a3b3-dd203ac5c734/aa449650-b75c-463b-ae57-15902cd21a86.html"
```

Returns the raw file content at that version.

### Create Labeled Version (Snapshot)

Create a labeled version of the current file state. This is useful before making significant changes.

```bash
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"label": "Before Major Edit"}' \
  "https://admin.da.live/versionsource/${ORG}/${SITE}/${PATH}"
```

**Required:** The `label` field is mandatory. The API returns 400 if no label is provided.

**Success:** HTTP 201 Created

### Restore a Previous Version

There is no dedicated restore endpoint. To restore a previous version:

1. **List versions** to find the desired version URL
2. **Get the version content** using the `url` from the list
3. **Write the content back** to the source path

```bash
# Step 1: List versions and find the target
VERSIONS=$(curl -s --connect-timeout 15 --max-time 120 \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/versionlist/${ORG}/${SITE}/${PATH}")

# Step 2: Get the version content (use the url field from step 1)
VERSION_CONTENT=$(curl -s --connect-timeout 15 --max-time 120 \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live${VERSION_URL}")

# Step 3: Write the content back to the original path
# Use form-data upload (works for both HTML and JSON files)
echo "${VERSION_CONTENT}" > /tmp/da-restore-content
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "data=@/tmp/da-restore-content" \
  "https://admin.da.live/source/${ORG}/${SITE}/${PATH}"
rm -f /tmp/da-restore-content
```

**Important:** Before restoring, consider creating a labeled version of the current state so you can undo the restore if needed.

---

## Configuration

DA site configuration uses a sheet-based JSON format stored in Cloudflare KV. Configs define permissions, settings, and other site-level properties.

### Get DA Site Config

```bash
curl -s --connect-timeout 15 --max-time 120 \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/config/${ORG}/${SITE}"
```

**Response:** JSON in sheet format, e.g.:
```json
{
  ":names": ["permissions", "settings"],
  ":type": "multi-sheet",
  "permissions": {
    "total": 2,
    "data": [
      {"path": "CONFIG", "actions": "write", "groups": "admin@example.com"},
      {"path": "/**", "actions": "read,write", "groups": "*@example.com"}
    ]
  },
  "settings": {
    "total": 1,
    "data": [
      {"key": "theme", "value": "default"}
    ]
  }
}
```

### Get Path-Specific Config

Configs can be scoped to directories or specific paths:

```bash
# Root config
curl -s --connect-timeout 15 --max-time 120 \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/config/${ORG}/${SITE}/config"

# Directory-specific config
curl -s --connect-timeout 15 --max-time 120 \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/config/${ORG}/${SITE}/drafts/config"
```

### Update DA Site Config

Uses **form-data** with a `config` field containing the JSON sheet structure.

```bash
# Multi-sheet config
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F 'config={":names":["permissions","settings"],":type":"multi-sheet","permissions":{"total":1,"data":[{"path":"CONFIG","actions":"write","groups":"admin@example.com"}]},"settings":{"total":1,"data":[{"key":"theme","value":"default"}]}}' \
  "https://admin.da.live/config/${ORG}/${SITE}"

# Single-sheet config (permissions only)
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F 'config={":sheetname":"permissions",":type":"sheet","total":1,"data":[{"path":"CONFIG","actions":"write","groups":"admin@example.com"}]}' \
  "https://admin.da.live/config/${ORG}/${SITE}/permissions"
```

**Important:** The config JSON must include at least one entry granting CONFIG write permission to a user or group (path=`CONFIG`, actions=`write`, groups must be non-empty). Otherwise the API returns 400.

**Success:** HTTP 201 with the saved config in response body.

---

## Preview/Publish DA Content

After modifying content in DA, trigger Edge Delivery Services preview/publish:

```bash
# Preview DA content
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -H "x-content-source-authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/preview/${ORG}/${SITE}/${REF}${PATH}"

# Publish DA content
curl -s --connect-timeout 15 --max-time 120 -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -H "x-content-source-authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.hlx.page/live/${ORG}/${SITE}/${REF}${PATH}"
```

**Note:** The `x-content-source-authorization` header passes the IMS token to authorize DA content source access. This is required for DA sites but not for SharePoint/Google Drive sites.

---

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "da list" | List orgs |
| "da list files in /blog" | List content |
| "da show /index.html" | Get source |
| "da get source /about" | Get source |
| "da upload content to /new.html" | Create content |
| "da update /page.html" | Update content |
| "da delete /old.html" | Delete (confirm) |
| "da copy /template to /new" | Copy |
| "da move /draft to /final" | Move |
| "da rename /old to /new" | Move |
| "da versions /page.html" | List versions |
| "da create version" | Create labeled version |
| "da restore version X" | Restore version (get + write back) |
| "da config" | Get site config |
| "da update config" | Update site config |
| "da preview /page" | Preview after DA edit |
| "da publish /page" | Publish after DA edit |

---

## Error Handling

| HTTP Code | Cause | Action |
|-----------|-------|--------|
| **400** | Invalid request — bad path, missing form data, invalid content type, or config missing CONFIG write permission | Check request format and payload |
| **401** | Missing/invalid IMS token | Run `Skill({ skill: "project-management:auth" })` |
| **403** | No permission for org/site/path | Check DA access permissions in config |
| **404** | Path not found or file does not exist | Verify org, site, path exist |
| **409** | Conflict (concurrent edit via If-Match/If-None-Match) | Retry or resolve version conflict |
| **412** | Precondition failed (ETag mismatch on conditional write) | Re-fetch content and retry |
| **500** | Server error | Retry; check DA service status |

---

## DA vs SharePoint/Google Drive

| Feature | DA | SharePoint/Drive |
|---------|-----|------------------|
| Auth | IMS OAuth token | Config Service token |
| Admin API | admin.da.live | admin.hlx.page only |
| Content format | Form-data (`data` field) or text/html body | N/A (edit in source app) |
| Copy/Move format | Form-data (`destination` field) | N/A |
| Bulk ops | Per-path (no wildcard `/*`) | Wildcard `/*` supported |
| Versioning | Built-in `/versionlist` + `/versionsource` | Via content source |
| Direct edit | Yes (via API) | Edit in source app |

**Key difference for preview/publish:**
- DA sites: Use `Authorization` + `x-content-source-authorization` headers
- SharePoint/Drive: Use `Authorization: Bearer` header only
