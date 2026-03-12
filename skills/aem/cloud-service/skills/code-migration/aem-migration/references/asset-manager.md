# Asset Manager API Migration Pattern

Migrates legacy AEM Asset Manager API usage to Cloud Service compatible patterns.

**Two paths based on operation type:**
- **Path A (Create/Upload):** Uses deprecated `createAsset()`, `createAssetForBinary()`, or `getAssetForBinary()` — migrates to **Direct Binary Access** via `@adobe/aem-upload` SDK
- **Path B (Delete):** Uses deprecated `removeAssetForBinary()` — migrates to **HTTP Assets API** `DELETE /api/assets{path}`

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
