> **Deprecated:** This file is superseded by the `asset-manager` expert skill at
> [`../asset-manager/SKILL.md`](../asset-manager/SKILL.md). It will be removed once all
> five expert skills are in place. Do not update this file — update the skill instead.

# Asset Manager API Migration Pattern

Covers how to handle `com.day.cq.dam.api.AssetManager` usage so it is safe and idiomatic on
**AEM as a Cloud Service**.

**Before you start:** Java baseline ([scr-to-osgi-ds.md](scr-to-osgi-ds.md),
[resource-resolver-logging.md](resource-resolver-logging.md)) via
[aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md).
This file **classifies** the usage and routes to path modules
(`asset-manager-create.md`, `asset-manager-delete.md`).

---

## What changed on AEM as a Cloud Service

`com.day.cq.dam.api.AssetManager` itself is **not removed**; several of its operations *are*
removed or strongly discouraged because binary I/O no longer flows through the AEM JVM the way
it did on AEM 6.x.

| API | Status on AEMaaCS | What to use instead |
|-----|-------------------|---------------------|
| `AssetManager.getAsset(path)` | Supported — read-only use | No change |
| `AssetManager.createAsset(path, InputStream, mimeType, doSave)` | **Strongly discouraged at runtime** for client-driven uploads (performance, 2 GB binary limit, asset-processing pipeline expects Direct Binary Access). Still callable in bulk import / back-office utilities where the binary is already local to the AEM JVM and small. | **Direct Binary Access** via `@adobe/aem-upload` (HTTP clients) for client uploads. In-JVM small-file creation from bundled resources is still OK. |
| `AssetManager.createAssetForBinary(binaryFilePath, doSave)` | **Removed on AEMaaCS** — relied on direct filesystem access that the cloud runtime does not expose. | **Direct Binary Access** (`@adobe/aem-upload` or the HTTP Assets API). |
| `AssetManager.getAssetForBinary(binaryFilePath)` | **Removed on AEMaaCS** — same reason. | Look up the `Asset` by repository path via `resolver.getResource(path).adaptTo(Asset.class)`. |
| `AssetManager.removeAssetForBinary(binaryFilePath, doSave)` | **Removed on AEMaaCS** — same reason. | For server-side (in-JVM) deletes: `resolver.delete(resource); resolver.commit();`. For external callers: HTTP Assets API `DELETE /api/assets{path}`. |

**Bottom line:**

- **Uploads from outside AEM (browser, integration, ingestion worker)** → Direct Binary Access.
- **Server-side (inside the AEM JVM) delete** → service-user `ResourceResolver` +
  `resolver.delete(resource)` + `resolver.commit()`. Do not call AEM's own HTTP API from inside
  the JVM.
- **External callers deleting assets** → HTTP Assets API `DELETE /api/assets{path}`.
- Read access via `AssetManager.getAsset` / `resolver.adaptTo(Asset.class)` is unchanged.

---

## Quick Examples

### Path A Example (create / upload)

**Before (deprecated binary-path API):**

```java
AssetManager assetManager = resolver.adaptTo(AssetManager.class);
Asset asset = assetManager.createAssetForBinary(binaryFilePath, true);
```

**After — client-side Direct Binary Access:**

```javascript
const DirectBinary = require('@adobe/aem-upload');
const upload = new DirectBinary.DirectBinaryUpload();
const options = new DirectBinary.DirectBinaryUploadOptions()
    .withUrl(`${host}/api/assets${path}`)
    .withUploadFiles([file])
    .withHttpOptions({ headers: { Authorization: `Bearer ${token}` } });
await upload.uploadFiles(options);
```

### Path B Example (delete)

**Before (removed on AEMaaCS):**

```java
AssetManager assetManager = resolver.adaptTo(AssetManager.class);
boolean deleted = assetManager.removeAssetForBinary(binaryFilePath, true);
```

**After — server-side delete with a service-user resolver:**

```java
try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
        Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "asset-admin-service"))) {
    Resource resource = resolver.getResource(assetPath);
    if (resource == null) {
        LOG.info("Asset already gone at {}", assetPath);
        return;
    }
    resolver.delete(resource);
    resolver.commit();
    LOG.info("Deleted asset at {}", assetPath);
} catch (LoginException e) {
    LOG.error("Could not open service resolver for subservice 'asset-admin-service'", e);
} catch (PersistenceException e) {
    LOG.error("Failed to commit asset delete at {}", assetPath, e);
}
```

**After — external-caller delete via the HTTP Assets API:**

```javascript
await axios.delete(`${host}/api/assets${assetPath}`, {
    headers: { Authorization: `Bearer ${token}` }    // IMS / dev-console token — never a static "password"
});
```

---

## Classification

**Classify BEFORE making any changes.**

### Use Path A when ANY of these are true:
- File calls `assetManager.createAssetForBinary(binaryFilePath, doSave)`.
- File calls `assetManager.getAssetForBinary(binaryFilePath)`.
- File calls `assetManager.createAsset(path, InputStream, mimeType, overwrite)` from a client-facing
  servlet (accepts uploads from browsers or external callers).

**If Path A → read [`asset-manager-create.md`](asset-manager-create.md) and follow its steps.**

### Use Path B when ANY of these are true:
- File calls `assetManager.removeAssetForBinary(binaryFilePath, doSave)`.
- File deletes assets via a public HTTP endpoint and relies on `AssetManager`.

**If Path B → read [`asset-manager-delete.md`](asset-manager-delete.md) and follow its steps.**

### Mixed operations (both create and delete)

If the file uses BOTH a removed create API AND a removed delete API, process **Path A first**,
then **Path B**. Read both path files sequentially.

### Already compliant — skip migration

- File only uses `AssetManager.getAsset(path)` for read operations (metadata, renditions).
- File uses `AssetManager.createAsset(path, InputStream, mimeType, overwrite)` **internally** in
  a back-office utility (scheduled import, test fixture, asset post-processing) where the binary
  is already inside the AEM JVM and is small. This is still supported — flag and move on.

## Asset-specific rules

- **CLASSIFY FIRST** — Path A, Path B, or Mixed — before making any changes.
- **Do** replace `createAssetForBinary` / `getAssetForBinary` / `removeAssetForBinary` — these do
  not exist on AEMaaCS.
- **Do** migrate client-facing uploads (servlets that accept `multipart` or `InputStream` from
  external callers) to Direct Binary Access.
- **Do** replace server-side HTTP `DELETE /api/assets` loops with in-JVM
  `resolver.delete(resource)` + `resolver.commit()` — AEM should never call its own HTTP API.
- **Do not** hardcode credentials. Never use a literal `":password"` string; external callers
  authenticate with an IMS / dev-console bearer token, internal JVM code uses a service-user
  resolver.
- **Do not** rewrite perfectly valid internal `AssetManager.getAsset()` reads — they still work.

## IMPORTANT

**Read ONLY the path file that matches your classification. Do NOT read both (unless Mixed).**
