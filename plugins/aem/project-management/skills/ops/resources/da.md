---
name: ops-da
description: Document Authoring (DA) API operations - list folders, get/create/delete source content, copy, move, manage versions, and read/write DA config. Uses admin.da.live with IMS Bearer token.
allowed-tools: Read, Write, Edit, Bash
---

# Document Authoring (DA) API Operations

Browse folders, manage source content, copy/move documents, manage versions, and configure DA sites via the `admin.da.live` API.

## When to Use

- Listing folders and files inside a DA org or site
- Reading the raw source HTML of a DA document
- Uploading or creating a new document in DA
- Deleting a document or folder from DA
- Copying a document to a new location (e.g. duplicating a template)
- Moving or renaming a document or folder
- Viewing version history of a DA document
- Restoring or reading a previous version of a document
- Reading or updating DA site/folder configuration

## API Reference

| Intent | Endpoint | Method |
|--------|----------|--------|
| list org | `/list/{org}` | GET |
| list site root | `/list/{org}/{site}` | GET |
| list folder | `/list/{org}/{site}/{path}` | GET |
| get source | `/source/{org}/{site}/{path}` | GET |
| create/upload source | `/source/{org}/{site}/{path}` | POST |
| delete source | `/source/{org}/{site}/{path}` | DELETE |
| copy source | `/copy/{org}/{site}/{path}` | POST |
| move source | `/move/{org}/{site}/{path}` | POST |
| list versions | `/versionlist/{org}/{site}/{path}` | GET |
| get version by guid | `/versionsource/{org}/{site}/{guid}` | GET |
| create version snapshot | `/versionsource/{org}/{site}/{path}` | POST |
| get DA config | `/config/{org}/{site}/{path}` | GET |
| create/update DA config | `/config/{org}/{site}/{path}` | POST |

## Auth

All DA API operations require an IMS Bearer token:

| Header | Value |
|--------|-------|
| `Authorization` | `Bearer ${IMS_TOKEN}` |

**If `IMS_TOKEN` is empty**, prompt the user:
> "I need an Adobe IMS Bearer token to call the DA API. Open DevTools on any DA or AEM page → Network tab → copy the `Authorization: Bearer eyJ...` value from any request and share it here."

---

## Operations

### List — Org Root

Lists all sites (repos) inside an org.

```bash
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/list/${ORG}"
```

**On success (200):** Display `sources` array as a table:

```
DA Org: {org}
Total: {N} sites

  Name                         Last Modified
  ──────────────────────────── ─────────────────────
  bbw-uat-kw-da                2024-03-15T10:22:31Z
  ...
```

**▶ Recommended Next Actions:**
1. Browse a specific site
   ```
   list DA folders in {site}
   ```

---

### List — Site Root or Folder

Lists files and sub-folders at the site root or any folder path.

```bash
# Site root
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/list/${ORG}/${SITE}"

# Specific folder
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/list/${ORG}/${SITE}/${PATH}"
```

**On success (200):** Display `sources` array:

```
DA Folder: /{site}{path}
Total: {N} items

  Name                  Ext    Last Modified
  ───────────────────── ────── ─────────────────────
  en/                   folder —
  nav                   html   2024-03-15T10:22:31Z
  ...
```

**▶ Recommended Next Actions:**
1. Read a specific document
   ```
   get DA source {path}
   ```
2. Browse a sub-folder
   ```
   list DA folders in {site}/{folder}
   ```

---

### Get Source

Retrieves the raw source content (HTML, JSON, image, PDF) of a DA document.

```bash
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/source/${ORG}/${SITE}/${PATH}"
```

**On success (200):** Display content inline. For HTML, show the raw markup. For JSON, format it. For binary types (images, PDFs), report the content type and size only — do not display binary content.

**▶ Recommended Next Actions:**
1. Create a new version snapshot before editing
   ```
   create DA version of {path}
   ```
2. After editing, upload the updated source
   ```
   create DA source at {path}
   ```

---

### Create / Upload Source

Creates or overwrites a document at the given path. Content is sent as `multipart/form-data`.

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "data=@/path/to/local/file.html;type=text/html" \
  "https://admin.da.live/source/${ORG}/${SITE}/${PATH}"
```

For plain HTML content string (no local file):

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "data=<html><body><p>Content</p></body></html>;type=text/html" \
  "https://admin.da.live/source/${ORG}/${SITE}/${PATH}"
```

**On success (201):** Display returned `source` and `aem` URLs:

```
Created: {path}
  Source URL : {sourceUrl}
  AEM URL    : {aemUrl}
```

**▶ Recommended Next Actions:**
1. Preview the page to make it visible on the preview CDN
   ```
   preview {path}
   ```

---

### Delete Source

**DESTRUCTIVE OPERATION - CONFIRMATION REQUIRED**

Deletes a document or an entire folder (recursive) from DA.

Before executing, you MUST:
1. Tell user: "This will permanently delete `{path}` from DA. This cannot be undone."
2. For folders: "This deletes the folder and ALL its contents."
3. Ask: "Do you want to proceed? (yes/no)"
4. Only execute if user confirms with "yes"

```bash
curl -s -X DELETE \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/source/${ORG}/${SITE}/${PATH}"
```

**On success (204):**
```
Deleted: {path} from DA ({org}/{site})
```

**▶ Recommended Next Actions:**
1. Unpublish the page from live CDN if it was published
   ```
   unpublish {path}
   ```
2. Remove from search index
   ```
   remove from index {path}
   ```

---

### Copy Source

Copies a document or folder to a new destination path within the same org.

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "destination=/{destPath}" \
  "https://admin.da.live/copy/${ORG}/${SITE}/${SOURCE_PATH}"
```

**On success (204):**
```
Copied: {sourcePath} → {destPath}
```

**▶ Recommended Next Actions:**
1. Preview the copied document to make it visible
   ```
   preview {destPath}
   ```

---

### Move Source

Moves or renames a document or folder to a new destination path.

**Note:** Moving a published page does not automatically update the live CDN — unpublish the old path after moving.

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "destination=/{destPath}" \
  "https://admin.da.live/move/${ORG}/${SITE}/${SOURCE_PATH}"
```

**On success (204):**
```
Moved: {sourcePath} → {destPath}
```

**▶ Recommended Next Actions:**
1. Preview the new path
   ```
   preview {destPath}
   ```
2. Unpublish the old path from live CDN
   ```
   unpublish {sourcePath}
   ```
3. Remove old path from search index
   ```
   remove from index {sourcePath}
   ```

---

### List Versions

Lists all saved versions of a document.

```bash
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/versionlist/${ORG}/${SITE}/${PATH}"
```

**On success (200):** Display versions as a table, newest first:

```
Versions of {path}
Total: {N} versions

  #   Timestamp                 URL
  ─── ─────────────────────── ────────────────────────────────────
  1   2024-03-15T10:22:31Z    https://admin.da.live/versionsource/...
  2   2024-03-10T08:05:12Z    https://admin.da.live/versionsource/...
```

**▶ Recommended Next Actions:**
1. View a specific version
   ```
   get DA version {guid}
   ```
2. Create a new version snapshot before editing
   ```
   create DA version of {path}
   ```

---

### Get Version

Retrieves the content of a specific version by its GUID.

```bash
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/versionsource/${ORG}/${SITE}/${GUID}"
```

**On success (200):** Display the version content. Report timestamp and users from the version metadata.

**▶ Recommended Next Actions:**
1. Restore by uploading this version's content back as source
   ```
   create DA source at {path}
   ```

---

### Create Version Snapshot

Saves the current state of a document as a named version checkpoint.

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/versionsource/${ORG}/${SITE}/${PATH}"
```

**On success (200):** Display returned version metadata:

```
Version snapshot created for {path}
  Timestamp : {timestamp}
  URL       : {versionUrl}
  Users     : {users}
```

---

### Get DA Config

Retrieves DA configuration for an org, site, or specific path.

```bash
# Org-level config
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/config/${ORG}"

# Site-level config
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/config/${ORG}/${SITE}"

# Path-level config
curl -s \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  "https://admin.da.live/config/${ORG}/${SITE}/${PATH}"
```

**On success (200):** Display key-value config data as a table.

---

### Create / Update DA Config

Creates or updates DA configuration at org, site, or path level.

```bash
curl -s -X POST \
  -H "Authorization: Bearer ${IMS_TOKEN}" \
  -F "data=@/path/to/config-file" \
  "https://admin.da.live/config/${ORG}/${SITE}/${PATH}"
```

**On success (201):**
```
DA config updated at {path}
  Source URL : {sourceUrl}
  AEM URL    : {aemUrl}
```

---

## Natural Language Patterns

| User Says | Operation |
|-----------|-----------|
| "list DA folders" / "browse DA" | List — org root |
| "list DA folders in {site}" | List — site root |
| "list DA files in {site}/en" | List — specific folder |
| "get DA source of /en/home" | Get Source |
| "show DA content of /nav" | Get Source |
| "upload {file} to DA at /en/home" | Create Source |
| "create DA document at /en/test" | Create Source |
| "delete DA /en/old-page" | Delete Source (confirm) |
| "copy /en/template to /en/new-page" | Copy |
| "move /en/old-name to /en/new-name" | Move |
| "show version history of /en/home" | List Versions |
| "get DA version {guid}" | Get Version |
| "snapshot /en/home" / "create version of /en/home" | Create Version Snapshot |
| "show DA config" | Get DA Config |
| "update DA config" | Create/Update DA Config |

---

## Success Criteria

- ✅ IMS Bearer token present before any DA API call
- ✅ List operations display `sources` array as a formatted table with item count
- ✅ Get Source shows raw content inline (text) or content-type + size (binary)
- ✅ Create/upload returns and displays `sourceUrl` and `aemUrl`
- ✅ Delete operations confirmed with user before executing — folder deletes note recursive impact
- ✅ Move operations remind user to unpublish the old path from live CDN
- ✅ Version list shows versions newest-first with timestamps and GUIDs
- ✅ Recommended next actions provided after every operation in fenced code blocks
