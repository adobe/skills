> **Deprecated:** This file is superseded by [`../asset-manager/SKILL.md`](../asset-manager/SKILL.md).
> It will be removed once all five expert skills are in place. Do not update this file.

# Asset Manager Path A: Create / Upload

For files using the `AssetManager` create / upload APIs.

**Scope:**

- `AssetManager.createAssetForBinary(binaryFilePath, doSave)` — **removed on AEMaaCS** → Direct Binary Access.
- `AssetManager.getAssetForBinary(binaryFilePath)` — **removed on AEMaaCS** → path-based lookup via `resolver.getResource(...).adaptTo(Asset.class)`.
- `AssetManager.createAsset(path, InputStream, mimeType, doSave)` — **still supported** for in-JVM use, but client-facing servlets that accept uploads must move to Direct Binary Access.

---

## When does `createAsset` need to change?

| Caller | Keep `createAsset(path, is, mimeType, doSave)`? |
|--------|--------------------------------------------------|
| Client-facing servlet accepting `multipart` / `InputStream` from a browser or external caller | **No** — migrate to Direct Binary Access. |
| Back-office utility creating small assets from a bundled resource or another already-in-JVM stream (fixtures, reports, migration imports) | **Yes, still supported.** Use a service-user resolver and close the stream. |
| Scheduled asset ingestion pulling from an external source | **Prefer** Direct Binary Access through the HTTP API; the job acts as an external client. |

When you keep `createAsset`, apply [resource-resolver-logging.md](resource-resolver-logging.md)
and make sure the `InputStream` is closed in try-with-resources.

`createAssetForBinary` and `getAssetForBinary` are always replaced — those APIs do not exist on
AEMaaCS.

---

## Complete Example: Before and After

### Before (client-facing upload via `AssetManager.createAsset`)

```java
package com.example.servlets;

import org.apache.felix.scr.annotations.Component;
import org.apache.felix.scr.annotations.Reference;
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.servlets.SlingAllMethodsServlet;
import com.day.cq.dam.api.Asset;
import com.day.cq.dam.api.AssetManager;

import javax.servlet.ServletException;
import java.io.IOException;
import java.io.InputStream;

@Component(immediate = true, metatype = false)
public class CreateAssetServlet extends SlingAllMethodsServlet {

    @Reference
    private AssetManager assetManager;

    @Override
    protected void doPost(SlingHttpServletRequest request, SlingHttpServletResponse response)
            throws ServletException, IOException {

        String assetPath = request.getParameter("path");
        String mimeType = request.getParameter("mimeType");
        InputStream inputStream = request.getInputStream();

        try {
            Asset asset = assetManager.createAsset(assetPath, inputStream, mimeType, true);
            response.setContentType("text/plain");
            response.getWriter().write("Asset created: " + asset.getPath());
        } catch (Exception e) {
            System.err.println("Error creating asset: " + e.getMessage());
            e.printStackTrace();
            response.setStatus(500);
            response.getWriter().write("Error: " + e.getMessage());
        }
    }
}
```

### After — Cloud Service compatible (client-side Direct Binary Access)

On AEMaaCS the upload must happen **directly between the client and the binary store**; the AEM
JVM orchestrates the upload but does not carry the bytes. Delete the servlet; replace it with a
client-side upload:

```javascript
import DirectBinary from '@adobe/aem-upload';

async function uploadAsset(file, assetPath, host, token) {
    const upload = new DirectBinary.DirectBinaryUpload();
    const options = new DirectBinary.DirectBinaryUploadOptions()
        .withUrl(`${host}/api/assets${assetPath}`)
        .withUploadFiles([{ fileName: file.name, blob: file, fileSize: file.size }])
        .withHttpOptions({
            headers: {
                Authorization: `Bearer ${token}`   // IMS / dev-console token — never a static password
            }
        });

    return upload.uploadFiles(options);
}
```

If the servlet **must** remain (for example, routing / ACL reasons), return a clear error
instead of accepting the upload — do **not** silently call a removed API:

```java
package com.example.servlets;

import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.servlets.SlingAllMethodsServlet;
import org.apache.sling.api.servlets.ServletResolverConstants;
import org.osgi.service.component.annotations.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.servlet.Servlet;
import javax.servlet.ServletException;
import java.io.IOException;

@Component(service = Servlet.class, property = {
        ServletResolverConstants.SLING_SERVLET_PATHS + "=/bin/createasset"
})
public class CreateAssetServlet extends SlingAllMethodsServlet {

    private static final Logger LOG = LoggerFactory.getLogger(CreateAssetServlet.class);

    @Override
    protected void doPost(SlingHttpServletRequest request, SlingHttpServletResponse response)
            throws ServletException, IOException {
        LOG.warn("Legacy upload endpoint hit — clients must use Direct Binary Access.");
        response.setStatus(410);   // 410 Gone — the operation moved
        response.setContentType("application/json");
        response.getWriter().write(
                "{\"error\":\"Use Direct Binary Access (/api/assets + @adobe/aem-upload) to upload assets.\"}");
    }
}
```

**Key changes:**

- Removed client-facing use of `AssetManager.createAsset(path, InputStream, mimeType, boolean)` —
  replaced with Direct Binary Access.
- No more `createAssetForBinary` / `getAssetForBinary` — these APIs are not available on AEMaaCS.
- Removed Felix SCR → OSGi DS.
- Replaced `System.out` / `System.err` with SLF4J.

---

## Pattern prerequisites

Read [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md)
for Java/OSGi hygiene (SCR → DS, service-user resolvers, SLF4J). Asset creation/upload scope
follows this file and [`asset-manager.md`](asset-manager.md) only.

## C1: Replace `createAssetForBinary` / `getAssetForBinary`

These APIs do not exist on AEMaaCS. Remove every call.

```java
// BEFORE (removed API)
assetManager.createAssetForBinary(binaryFilePath, doSave);
Asset asset = assetManager.getAssetForBinary(binaryFilePath);
```

**Replacements:**

| Legacy call | AEMaaCS replacement |
|-------------|----------------------|
| `createAssetForBinary(binaryFilePath, doSave)` | **Direct Binary Access** (`@adobe/aem-upload` or HTTP `POST /api/assets`). The binary never sits on the AEM filesystem. |
| `getAssetForBinary(binaryFilePath)` | `resolver.getResource(repoPath).adaptTo(Asset.class)` using the repository path of the asset — not a filesystem path. |

```javascript
// Direct Binary Access upload (client-side)
const DirectBinary = require('@adobe/aem-upload');
const upload = new DirectBinary.DirectBinaryUpload();
const options = new DirectBinary.DirectBinaryUploadOptions()
    .withUrl(targetUrl)
    .withUploadFiles(uploadFiles)
    .withHttpOptions({ headers: { Authorization: `Bearer ${token}` } });
await upload.uploadFiles(options);
```

If the caller used `getAssetForBinary` to locate an existing asset, switch to the repository path:

```java
Resource r = resolver.getResource("/content/dam/my-site/report.pdf");
Asset asset = r != null ? r.adaptTo(Asset.class) : null;
```

## C2: Decide whether `createAsset(path, InputStream, mimeType, overwrite)` needs to change

Apply the decision table at the top of this file:

- **Client-facing servlet** receiving `request.getInputStream()` or a multipart part from a
  browser / external caller → replace with Direct Binary Access. Remove the servlet or convert
  it to a `410 Gone` redirect.
- **In-JVM utility** creating an asset from a bundled resource / fixture stream → keep
  `createAsset`, but harden the surrounding code:
  - Open the resolver via `getServiceResourceResolver(SUBSERVICE)` (see
    [resource-resolver-logging.md](resource-resolver-logging.md)).
  - Close the `InputStream` in try-with-resources.
  - Call `resolver.commit()` only if `doSave=false` was used (AEM usually auto-commits when
    `doSave=true`).

```java
try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
        Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "asset-admin-service"));
     InputStream stream = bundleContext.getBundle().getResource(bundledPath).openStream()) {

    AssetManager assetManager = resolver.adaptTo(AssetManager.class);
    Asset asset = assetManager.createAsset(dest, stream, mimeType, true);
    LOG.info("Seeded asset at {}", asset.getPath());

} catch (LoginException e) {
    LOG.error("Could not open service resolver for subservice 'asset-admin-service'", e);
} catch (IOException e) {
    LOG.error("Failed to read bundled asset {}", bundledPath, e);
}
```

This is legitimate on AEMaaCS — it does not hit the removed binary APIs and does not accept
arbitrary client uploads.

## C3: Update imports

**Remove** (when `createAssetForBinary` / `getAssetForBinary` are removed):

```java
import com.day.cq.dam.api.metadata.MetaDataMap;  // if only used for deprecated flow
```

Keep `com.day.cq.dam.api.Asset` / `com.day.cq.dam.api.AssetManager` when `createAsset` /
`getAsset` are still in use.

**Add** (for logging and OSGi DS):

```java
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.apache.sling.api.servlets.ServletResolverConstants;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import javax.servlet.Servlet;
```

Remove Felix SCR imports per [scr-to-osgi-ds.md](scr-to-osgi-ds.md).

---

## Validation

- [ ] No `createAssetForBinary(` or `getAssetForBinary(` calls remain.
- [ ] Client-facing upload endpoints moved to Direct Binary Access; any residual Java endpoint returns 410 Gone (or equivalent) with a documented replacement path.
- [ ] `createAsset(path, InputStream, mimeType, overwrite)` only remains in in-JVM utilities where the stream is trusted and small; the stream is closed in try-with-resources.
- [ ] Service-user resolver + `SUBSERVICE` used (Repoinit-provisioned) where `AssetManager.adaptTo` is still called.
- [ ] [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) satisfied for SCR, resolver, logging.
- [ ] No hardcoded credentials (`":password"`, literal bearer tokens) anywhere in the sample flow.
- [ ] `@Reference AssetManager` removed if no longer needed.
- [ ] Code compiles: `mvn clean compile`.
