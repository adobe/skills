# Asset Manager API Migration Pattern

Migrates legacy AEM Asset Manager API usage to Cloud Service compatible patterns.

**Before you start:** Java baseline ([scr-to-osgi-ds.md](scr-to-osgi-ds.md), [resource-resolver-logging.md](resource-resolver-logging.md)) via [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md). This file **classifies** deprecated `AssetManager` usage and routes to path modules (`asset-manager-create.md`, `asset-manager-delete.md`); asset API scope stays limited to that pattern.

**Two paths based on operation type:**
- **Path A (Create/Upload):** Uses deprecated `createAsset()`, `createAssetForBinary()`, or `getAssetForBinary()` — migrates to **Direct Binary Access** via `@adobe/aem-upload` SDK
- **Path B (Delete):** Uses deprecated `removeAssetForBinary()` — migrates to **HTTP Assets API** `DELETE /api/assets{path}`

---

## Quick Examples

### Path A Example (Create/Upload)

**Before:**
```java
AssetManager assetManager = resolver.adaptTo(AssetManager.class);
Asset asset = assetManager.createAssetForBinary(binaryFilePath, true);
```

**After (Client-side):**
```javascript
const DirectBinary = require('@adobe/aem-upload');
const upload = new DirectBinary.DirectBinaryUpload();
const options = new DirectBinary.DirectBinaryUploadOptions()
    .withUrl(`${host}/api/assets${path}`)
    .withUploadFiles([file])
    .withHttpOptions({ headers: { Authorization: `Bearer ${token}` } });
await upload.uploadFiles(options);
```

### Path B Example (Delete)

**Before:**
```java
AssetManager assetManager = resolver.adaptTo(AssetManager.class);
boolean deleted = assetManager.removeAssetForBinary(binaryFilePath, true);
```

**After (Client-side):**
```javascript
await axios.delete(`${host}/api/assets${assetPath}`, {
    auth: { username, password }
});
```

**After (Server-side Java):**
```java
// Use HttpClient to call DELETE /api/assets{path}
HttpClient client = HttpClientBuilder.create().build();
HttpDelete delete = new HttpDelete(host + "/api/assets" + assetPath);
delete.setHeader("Authorization", "Basic " + base64Credentials);
HttpResponse response = client.execute(delete);
```

---

## Classification

**Classify BEFORE making any changes.**

### Use Path A when ANY of these are true:
- File calls `assetManager.createAsset(path, inputStream, mimeType, overwrite)`
- File calls `assetManager.createAssetForBinary(binaryFilePath, doSave)`
- File calls `assetManager.getAssetForBinary(binaryFilePath)`
- File uses `resourceResolver.adaptTo(AssetManager.class)` for asset creation or upload

**If Path A → read `asset-manager-create.md` and follow its steps.**

### Use Path B when ANY of these are true:
- File calls `assetManager.removeAssetForBinary(binaryFilePath, doSave)`
- File uses `AssetManager` exclusively for delete operations

**If Path B → read `asset-manager-delete.md` and follow its steps.**

### Mixed operations (both create and delete):
If the file uses BOTH create/upload AND delete operations, process **Path A first**, then **Path B**. Read both path files sequentially.

### Already compliant — skip migration:
- File only uses `AssetManager.getAsset(path)` for read operations (metadata, renditions) — no migration needed

## Asset-Specific Rules

- **CLASSIFY FIRST** — determine Path A, Path B, or Mixed before making any changes
- **DO** replace deprecated `createAssetForBinary` / `getAssetForBinary` with Direct Binary Access
- **DO** replace deprecated `removeAssetForBinary` with HTTP Assets API DELETE
- **DO** replace deprecated `createAsset(path, is, mimeType, overwrite)` with Direct Binary Access
- **DO** use `@adobe/aem-upload` SDK for client-side uploads
- **DO** use HTTP API for server-side delete operations when migrating servlets
- **DO NOT** call deprecated AssetManager methods for create/remove
- **DO NOT** keep inline asset creation from InputStream in Java servlets

## IMPORTANT

**Read ONLY the path file that matches your classification. Do NOT read both (unless Mixed).**
