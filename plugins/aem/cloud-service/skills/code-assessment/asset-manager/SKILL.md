---
name: asset-manager
description: AEM Cloud Service expert skill for the Asset Manager API (com.day.cq.dam.api.AssetManager). Covers two migration paths — Path A (create/upload, replacing createAssetForBinary/getAssetForBinary/client-facing createAsset with Direct Binary Access via @adobe/aem-upload) and Path B (delete, replacing removeAssetForBinary with in-JVM resolver.delete() + commit or external HTTP Assets API with IMS bearer tokens). Covers IMS authentication, service-user setup with crx delete permissions, asset processing pipeline, common pitfalls (hardcoded credentials, AEM calling its own HTTP API), and composition with replication/event-migration skills.
license: Apache-2.0
---

# Asset Manager API — AEM as a Cloud Service

## Overview

`com.day.cq.dam.api.AssetManager` is **not removed** on AEM CS — but several of its operations are. The binary-path APIs that relied on direct filesystem access (`createAssetForBinary`, `getAssetForBinary`, `removeAssetForBinary`) **do not exist on CS** because the cloud runtime does not expose a filesystem path to the AEM JVM. Binary I/O for client uploads moves to **Direct Binary Access** — bytes flow directly between the client and Adobe's binary store, bypassing the JVM entirely.

**API status on AEMaaCS:**

| API | Status | What to use instead |
|-----|--------|---------------------|
| `AssetManager.getAsset(path)` | ✅ **Supported** | No change — still works for reads |
| `AssetManager.createAsset(path, InputStream, mimeType, doSave)` | ⚠️ **Strongly discouraged for client-facing uploads** (2 GB binary limit, blocks the JVM, asset-processing pipeline expects Direct Binary Access). Still callable for in-JVM utilities where the binary is small and already in the JVM (bundled resources, fixtures, back-office imports). | **Direct Binary Access** for client uploads (`@adobe/aem-upload` JavaScript SDK). In-JVM small-file creation OK. |
| `AssetManager.createAssetForBinary(binaryFilePath, doSave)` | ❌ **Removed** — relied on filesystem path the cloud runtime does not expose | **Direct Binary Access** |
| `AssetManager.getAssetForBinary(binaryFilePath)` | ❌ **Removed** | `resolver.getResource(repoPath).adaptTo(Asset.class)` — look up by repository path, not binary path |
| `AssetManager.removeAssetForBinary(binaryFilePath, doSave)` | ❌ **Removed** | In-JVM: `resolver.delete(resource) + resolver.commit()`. External: HTTP Assets API `DELETE /api/assets{path}` |

**Three CS-specific principles:**

| Principle | Why |
|-----------|-----|
| Binary I/O for client uploads goes Direct Binary Access — never through the JVM | The cloud runtime does not have a JVM-accessible filesystem; bytes through the JVM are slow, memory-bound, and blocked by a 2 GB ceiling |
| In-JVM delete uses `resolver.delete()` + `resolver.commit()` with a service user — never AEM calling its own HTTP API | Self-looping HTTP adds latency, requires credentials you shouldn't store, and breaks idempotency |
| External callers authenticate with **IMS / dev-console bearer tokens** — never hardcoded passwords or `userId:password` strings | AEMaaCS has no admin user with a static password; IMS service credentials are the only supported external auth path |

---

## Classification — choose before making any changes

**Uses `AssetManager.createAssetForBinary(...)` or `AssetManager.getAssetForBinary(...)`** (removed APIs)
→ Apply **Path A** (C1–C3).

**Uses `AssetManager.createAsset(path, InputStream, mimeType, doSave)` in a client-facing servlet** (accepts upload from a browser or external caller)
→ Apply **Path A** — migrate to Direct Binary Access (C2 client-facing branch).

**Uses `AssetManager.removeAssetForBinary(...)`** (removed API)
→ Apply **Path B** (D1–D3).

**Uses both a removed create API AND a removed delete API**
→ Apply **Path A first, then Path B**. Both transformations are independent.

**Uses `AssetManager.getAsset(path)` only** (read access)
→ Already compliant — no migration needed.

**Uses `AssetManager.createAsset(path, InputStream, mimeType, doSave)` in an in-JVM back-office utility** (scheduled import, test fixture, asset post-processing — binary is already in the JVM and small)
→ Already supported — verify the surrounding code uses a service-user resolver and closes the stream in try-with-resources, then skip.

**One pattern per session.** If the file has multiple flows, migrate one direction (create OR delete) at a time.

**Before starting:** Read [`../references/aem-cloud-service-pattern-prerequisites.md`](../references/aem-cloud-service-pattern-prerequisites.md) and apply SCR→DS, service-user, and SLF4J fixes if present in the same changeset.

---

## Complete example — Path A (create / upload)

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

On AEMaaCS the upload happens **directly between the client and the binary store**; the AEM JVM orchestrates the upload but does not carry the bytes. Delete the upload-accepting servlet entirely, and replace it with a client-side call to the Direct Binary Access HTTP API via `@adobe/aem-upload`:

```javascript
import DirectBinary from '@adobe/aem-upload';

/**
 * Uploads a file to AEMaaCS via Direct Binary Access.
 * @param {File|Blob} file     The binary to upload
 * @param {string} assetPath   Repository destination, e.g. "/content/dam/my-site/file.pdf"
 * @param {string} host        AEM author host, e.g. "https://author-p123-e456.adobeaemcloud.com"
 * @param {string} token       IMS bearer token (Adobe Developer Console service credentials,
 *                             or short-lived user token from the AEM login flow)
 */
async function uploadAsset(file, assetPath, host, token) {
    const upload = new DirectBinary.DirectBinaryUpload();
    const options = new DirectBinary.DirectBinaryUploadOptions()
        .withUrl(`${host}/api/assets${assetPath}`)
        .withUploadFiles([{
            fileName: file.name,
            blob: file,
            fileSize: file.size
        }])
        .withHttpOptions({
            headers: {
                Authorization: `Bearer ${token}`   // IMS / dev-console token — never a static password
            }
        });

    return upload.uploadFiles(options);
}
```

If the servlet path must remain (routing, ACL, audit reasons), convert it to return `410 Gone` with a documented replacement — do **not** silently call a removed API:

```java
package com.example.servlets;

import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.servlets.ServletResolverConstants;
import org.apache.sling.api.servlets.SlingAllMethodsServlet;
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
        LOG.warn("Legacy upload endpoint hit — clients must use Direct Binary Access at /api/assets");
        response.setStatus(410);   // 410 Gone — the operation moved
        response.setContentType("application/json");
        response.getWriter().write(
                "{\"error\":\"Use Direct Binary Access (POST /api/assets + @adobe/aem-upload) to upload assets.\"}");
    }
}
```

---

## Complete example — Path B (delete)

### Before (removed `removeAssetForBinary` API)

```java
package com.example.servlets;

import org.apache.felix.scr.annotations.Component;
import org.apache.felix.scr.annotations.Reference;
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.servlets.SlingAllMethodsServlet;
import com.day.cq.dam.api.AssetManager;

import javax.servlet.ServletException;
import java.io.IOException;

@Component(immediate = true, metatype = false)
public class DeleteAssetServlet extends SlingAllMethodsServlet {

    @Reference
    private AssetManager assetManager;

    @Override
    protected void doDelete(SlingHttpServletRequest request, SlingHttpServletResponse response)
            throws ServletException, IOException {

        String binaryFilePath = request.getParameter("path");

        try {
            boolean isDeleted = assetManager.removeAssetForBinary(binaryFilePath, true);
            response.setContentType("text/plain");
            if (isDeleted) {
                response.getWriter().write("Asset deleted: " + binaryFilePath);
            } else {
                response.setStatus(404);
                response.getWriter().write("Asset not found: " + binaryFilePath);
            }
        } catch (Exception e) {
            System.err.println("Error deleting asset: " + e.getMessage());
            e.printStackTrace();
            response.setStatus(500);
            response.getWriter().write("Error: " + e.getMessage());
        }
    }
}
```

### After — in-JVM delete with a service-user resolver (recommended for code already inside AEM)

Server-side code that already has a trusted `ResourceResolver` should delete assets directly via the resource API. No HTTP, no credentials, no self-loopback through AEM's own API:

```java
package com.example.servlets;

import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.PersistenceException;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.api.servlets.ServletResolverConstants;
import org.apache.sling.api.servlets.SlingAllMethodsServlet;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.servlet.Servlet;
import javax.servlet.ServletException;
import java.io.IOException;
import java.util.Collections;

@Component(service = Servlet.class, property = {
        ServletResolverConstants.SLING_SERVLET_PATHS + "=/bin/deleteasset"
})
public class DeleteAssetServlet extends SlingAllMethodsServlet {

    private static final Logger LOG = LoggerFactory.getLogger(DeleteAssetServlet.class);
    private static final String SUBSERVICE = "asset-admin-service";

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    protected void doDelete(SlingHttpServletRequest request, SlingHttpServletResponse response)
            throws ServletException, IOException {

        String assetPath = request.getParameter("path");
        if (assetPath == null || assetPath.isEmpty() || !assetPath.startsWith("/content/dam/")) {
            response.setStatus(400);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"valid /content/dam path parameter required\"}");
            return;
        }

        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, SUBSERVICE))) {

            Resource resource = resolver.getResource(assetPath);
            if (resource == null) {
                response.setStatus(404);
                response.setContentType("application/json");
                response.getWriter().write("{\"error\":\"asset not found\"}");
                return;
            }

            resolver.delete(resource);
            resolver.commit();

            response.setContentType("application/json");
            response.getWriter().write("{\"success\":true}");
            LOG.info("Deleted asset at {}", assetPath);

        } catch (LoginException e) {
            LOG.error("Could not open service resolver for subservice '{}'", SUBSERVICE, e);
            response.setStatus(500);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"internal error\"}");
        } catch (PersistenceException e) {
            LOG.error("Commit failed while deleting asset {}", assetPath, e);
            response.setStatus(500);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"internal error\"}");
        }
    }
}
```

### After — external-caller delete via the HTTP Assets API

If the deleter is **outside** the AEM JVM (integration backend, CLI, worker), call the HTTP API with an IMS or dev-console bearer token — never a hardcoded password:

```javascript
import axios from 'axios';

/**
 * Deletes an asset from AEMaaCS via the HTTP Assets API.
 * Caller must provide a bearer token from Adobe Developer Console service credentials
 * or a short-lived user token from the AEM login flow.
 */
export async function deleteAsset({ host, assetPath, bearerToken }) {
    const response = await axios.delete(`${host}/api/assets${assetPath}`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
        validateStatus: status => status === 200 || status === 204 || status === 404
    });
    return response.status !== 404;
}
```

---

## C1 — Replace `createAssetForBinary` / `getAssetForBinary`

These APIs do not exist on AEMaaCS. Remove every call.

```java
// BEFORE (removed APIs)
assetManager.createAssetForBinary(binaryFilePath, doSave);
Asset asset = assetManager.getAssetForBinary(binaryFilePath);
```

**Replacements:**

| Legacy call | AEMaaCS replacement |
|-------------|---------------------|
| `createAssetForBinary(binaryFilePath, doSave)` | **Direct Binary Access** via `@adobe/aem-upload` or HTTP `POST /api/assets`. The binary never sits on the AEM filesystem. |
| `getAssetForBinary(binaryFilePath)` | `resolver.getResource(repoPath).adaptTo(Asset.class)` using the **repository path** (not a filesystem path) |

```javascript
// Direct Binary Access — client side
const DirectBinary = require('@adobe/aem-upload');
const upload = new DirectBinary.DirectBinaryUpload();
const options = new DirectBinary.DirectBinaryUploadOptions()
    .withUrl(`${host}/api/assets${assetPath}`)
    .withUploadFiles(uploadFiles)
    .withHttpOptions({ headers: { Authorization: `Bearer ${token}` } });
await upload.uploadFiles(options);
```

```java
// Look up by repository path — replaces getAssetForBinary
Resource resource = resolver.getResource("/content/dam/my-site/report.pdf");
Asset asset = resource != null ? resource.adaptTo(Asset.class) : null;
```

The legacy "binary path" concept (a filesystem path under the AEM install) does **not** exist on AEMaaCS. Anywhere your legacy code passed a binary path, replace with the asset's repository path (`/content/dam/...`).

---

## C2 — Decide whether `createAsset(path, InputStream, mimeType, overwrite)` needs to change

Apply the decision matrix:

| Caller | Keep `createAsset(...)`? |
|--------|--------------------------|
| Client-facing servlet accepting `multipart` / `InputStream` from a browser or external caller | **No** — migrate to Direct Binary Access |
| Back-office utility creating small assets from a bundled resource or another already-in-JVM stream (fixtures, reports, migration imports) | **Yes, still supported** — use a service-user resolver and close the stream |
| Scheduled asset ingestion pulling from an external source | **Prefer** Direct Binary Access through the HTTP API; the scheduler-triggered job acts as an external client |

**When keeping `createAsset` for in-JVM use:**

```java
try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
        Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "asset-admin-service"));
     InputStream stream = bundleContext.getBundle().getResource(bundledPath).openStream()) {

    AssetManager assetManager = resolver.adaptTo(AssetManager.class);
    Asset asset = assetManager.createAsset(destPath, stream, mimeType, true);
    LOG.info("Seeded asset at {}", asset.getPath());

} catch (LoginException e) {
    LOG.error("Could not open service resolver for subservice 'asset-admin-service'", e);
} catch (IOException e) {
    LOG.error("Failed to read bundled asset {}", bundledPath, e);
}
```

This is legitimate on AEMaaCS — it does not hit the removed binary APIs and does not accept arbitrary client uploads. Constraints:

- Service-user resolver in try-with-resources (no admin auth, no `USER`/`PASSWORD` maps)
- `InputStream` in try-with-resources — leaking streams blocks bundle reload
- `doSave=true` auto-commits; if you pass `false`, call `resolver.commit()` explicitly
- Binary size should be modest — for large files, prefer Direct Binary Access even from in-JVM callers

---

## C3 — Update imports (Path A)

**Remove (when `createAssetForBinary` / `getAssetForBinary` are gone):**

```java
import com.day.cq.dam.api.metadata.MetaDataMap;  // if only used for deprecated flow
```

Keep `com.day.cq.dam.api.Asset` and `com.day.cq.dam.api.AssetManager` when `createAsset` / `getAsset` are still in use.

**Remove (SCR → DS):**

```java
import org.apache.felix.scr.annotations.*;
```

**Add — servlet shell:**

```java
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.servlets.ServletResolverConstants;
import org.apache.sling.api.servlets.SlingAllMethodsServlet;
import org.osgi.service.component.annotations.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import javax.servlet.Servlet;
```

**Add — in-JVM `createAsset` utility:**

```java
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.osgi.service.component.annotations.Reference;
import java.io.InputStream;
import java.util.Collections;
```

---

## D1 — Replace `removeAssetForBinary` with `ResourceResolver#delete` (in-JVM)

```java
// BEFORE (removed API)
boolean isAssetDeleted = assetManager.removeAssetForBinary(binaryFilePath, doSave);

// AFTER — in-JVM with service-user resolver
try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
        Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "asset-admin-service"))) {

    Resource resource = resolver.getResource(assetPath);   // repository path, not binary path
    if (resource == null) {
        LOG.info("Asset already gone at {}", assetPath);
        return;  // idempotent — treat "not found" as success, not failure
    }
    resolver.delete(resource);
    resolver.commit();
    LOG.info("Deleted asset at {}", assetPath);
} catch (LoginException e) {
    LOG.error("Could not open service resolver for subservice 'asset-admin-service'", e);
} catch (PersistenceException e) {
    LOG.error("Commit failed while deleting asset {}", assetPath, e);
}
```

Rules:

- `assetPath` is the **repository path** (e.g. `/content/dam/site/file.jpg`). The legacy "binary path" concept does not exist on AEMaaCS.
- Service-user privileges must include `jcr:removeNode` and `jcr:removeChildNodes` on the asset tree (see [Repoinit setup](#repoinit-and-service-user-mapping) below).
- **Do not** call AEM's own HTTP API (`/api/assets`) from inside the JVM — it adds latency, requires credentials the JVM shouldn't store, and breaks idempotency. Use the resource API directly.
- Treat "resource is null" (asset already gone) as a successful no-op, not a failure — delete operations should be idempotent on retry.
- **Validate the path parameter** before deletion (e.g. `path.startsWith("/content/dam/")`) — a poorly-validated delete endpoint is a destructive vulnerability.

---

## D2 — External callers use the HTTP Assets API with a bearer token

For deleters running **outside** the AEM JVM (integration backends, CLIs, ingestion workers), call the HTTP API:

```javascript
import axios from 'axios';

export async function deleteAsset({ host, assetPath, bearerToken }) {
    const response = await axios.delete(`${host}/api/assets${assetPath}`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
        validateStatus: status => status === 200 || status === 204 || status === 404
    });
    return response.status !== 404;
}
```

**Where `bearerToken` comes from:**

- **Adobe Developer Console / IMS** service credentials (server-to-server JWT exchange producing a short-lived bearer token), **or**
- A short-lived user token obtained via the AEM login flow (for human-driven CLIs)

**Never** hardcode usernames and passwords. **Never** pass `":password"` strings or basic auth literals. AEMaaCS has no static admin password.

```javascript
// WRONG — hardcoded credentials, no admin password exists on AEMaaCS
const response = await axios.delete(url, {
    headers: { Authorization: 'Basic ' + Buffer.from('admin:admin').toString('base64') }
});

// RIGHT — IMS bearer token
const response = await axios.delete(url, {
    headers: { Authorization: `Bearer ${imsToken}` }
});
```

---

## D3 — Update imports (Path B)

**Remove (when all `AssetManager` delete calls are gone):**

```java
import com.day.cq.dam.api.AssetManager;  // remove if no other AssetManager usage remains in the file
```

Keep `AssetManager` if the file still uses `AssetManager.getAsset(...)` for reads.

**Remove (SCR → DS):**

```java
import org.apache.felix.scr.annotations.*;
```

**Add — in-JVM delete servlet:**

```java
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.PersistenceException;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.api.servlets.ServletResolverConstants;
import org.apache.sling.api.servlets.SlingAllMethodsServlet;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import javax.servlet.Servlet;
import javax.servlet.ServletException;
import java.io.IOException;
import java.util.Collections;
```

---

## Repoinit and service-user mapping

The in-JVM create/delete operations acquire a resolver via `SUBSERVICE`. On AEM CS the backing system user **must** be created via Repoinit and mapped through `ServiceUserMapperImpl.amended`. The classic UI-based user admin is not available.

**Repoinit** (in `ui.config`):

```
create service user asset-admin-service

set ACL for asset-admin-service
    allow jcr:read,rep:write,jcr:removeNode,jcr:removeChildNodes on /content/dam
end
```

The `jcr:removeNode` and `jcr:removeChildNodes` privileges are **required** for delete. `rep:write` alone is not sufficient. Without them, `resolver.delete(resource)` succeeds in memory but `resolver.commit()` throws `AccessDeniedException`.

**Service-user mapping** (`ui.config`, file named e.g. `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-asset-admin.cfg.json`):

```json
{
  "user.mapping": [
    "com.example.mybundle:asset-admin-service=[asset-admin-service]"
  ]
}
```

**Mapping conventions:**

- Use the **amend** form — do not edit the base `ServiceUserMapperImpl` config
- Use **principal-name mapping**: the square-bracket form `=[service-user-name]`
- Do **not** use the deprecated `userName` form
- Bundle symbolic name on the left of `:` **must** match the bundle owning the servlet / utility
- Permissions must be declared **directly on the service user** — do not rely on group inheritance

See [`../references/aem-cloud-service-pattern-prerequisites.md`](../references/aem-cloud-service-pattern-prerequisites.md) for the full Repoinit workflow.

---

## Greenfield — writing new asset operations

For new asset code (not migrating legacy), the rules collapse to three patterns:

**Reading an asset** — use the resource API; do not adapt to `AssetManager` unnecessarily:

```java
try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
        Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "asset-reader-service"))) {

    Resource resource = resolver.getResource(assetPath);
    if (resource == null) {
        return Optional.empty();
    }
    Asset asset = resource.adaptTo(Asset.class);
    return Optional.ofNullable(asset);

} catch (LoginException e) {
    LOG.error("Could not open service resolver", e);
    return Optional.empty();
}
```

**Uploading from a client** — never write an upload-accepting servlet. The client calls Direct Binary Access:

```javascript
import DirectBinary from '@adobe/aem-upload';

async function uploadAsset(file, assetPath, host, token) {
    const upload = new DirectBinary.DirectBinaryUpload();
    const options = new DirectBinary.DirectBinaryUploadOptions()
        .withUrl(`${host}/api/assets${assetPath}`)
        .withUploadFiles([{ fileName: file.name, blob: file, fileSize: file.size }])
        .withHttpOptions({ headers: { Authorization: `Bearer ${token}` } });
    return upload.uploadFiles(options);
}
```

**Deleting from in-JVM code** — service-user resolver + `delete()` + `commit()`:

```java
try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
        Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "asset-admin-service"))) {

    Resource resource = resolver.getResource(assetPath);
    if (resource == null) {
        return;  // idempotent — already gone
    }
    resolver.delete(resource);
    resolver.commit();

} catch (LoginException e) {
    LOG.error("Could not open service resolver", e);
} catch (PersistenceException e) {
    LOG.error("Commit failed for {}", assetPath, e);
}
```

What this captures:

- **No client-facing upload servlets** — every upload goes Direct Binary Access
- **`getResource().adaptTo(Asset.class)` for reads** — direct AssetManager.adaptTo is rarely needed
- **Service-user resolver everywhere** — never admin, never `USER`/`PASSWORD` maps
- **Idempotent delete** — null resource is a successful no-op

---

## Composition with other skills

**Trigger replication after a delete:** combine with the [`replication` skill](../replication/SKILL.md):

```java
// Inside the delete code path, after resolver.commit()
DistributionRequest request = new SimpleDistributionRequest(
        DistributionRequestType.DELETE, false, assetPath);
DistributionResponse response = distributor.distribute("publish", resolver, request);
if (!response.isSuccessful()) {
    LOG.warn("Delete distribution failed for {}: {}", assetPath, response.getMessage());
}
```

**React to asset add/remove events:** use the [`resource-change-listener` skill](../resource-change-listener/SKILL.md) to observe `/content/dam`, then a `JobConsumer` to handle the business logic. Do not put asset processing inside `onChange()`.

**Hook into the asset processing pipeline:** Adobe-managed asset processing runs out-of-band on AEMaaCS. To act *after* processing completes (renditions ready, metadata extracted), listen for the relevant DAM workflow completion event via the [`event-migration` skill](../event-migration/SKILL.md).

---

## Review Checklist

**Cross-cutting:**
- [ ] No `createAssetForBinary(`, `getAssetForBinary(`, or `removeAssetForBinary(` calls remain
- [ ] No `getAdministrativeResourceResolver()` or `USER`/`PASSWORD` auth maps
- [ ] No hardcoded credentials anywhere (`":password"`, literal bearer tokens, basic-auth literals)
- [ ] `getServiceResourceResolver(SUBSERVICE)` used in try-with-resources for any in-JVM AEM operation
- [ ] OSGi DS R6 annotations — no `org.apache.felix.scr.annotations.*` imports
- [ ] SLF4J logging — no `System.out` / `System.err` / `printStackTrace`

**Path A (create / upload):**
- [ ] Client-facing upload endpoints replaced with Direct Binary Access (`@adobe/aem-upload`) — any residual servlet returns `410 Gone` with a documented replacement
- [ ] `createAsset(path, InputStream, mimeType, overwrite)` remains only in in-JVM utilities where the binary is small and already in the JVM (fixtures, bundled resources, post-processing)
- [ ] `InputStream` closed in try-with-resources
- [ ] Service-user resolver used for in-JVM `createAsset` flows
- [ ] No `getAssetForBinary` — `resolver.getResource(repoPath).adaptTo(Asset.class)` used instead
- [ ] No reference to a "binary file path" — only repository paths (`/content/dam/...`)

**Path B (delete):**
- [ ] In-JVM deletes use `resolver.delete(resource) + resolver.commit()` — not AEM calling its own HTTP API
- [ ] `resource == null` treated as successful no-op (idempotent delete)
- [ ] Path parameter validated (e.g. `startsWith("/content/dam/")`) before delete
- [ ] `PersistenceException` caught separately from `LoginException` and logged with the path
- [ ] Service user has `jcr:removeNode` and `jcr:removeChildNodes` (not just `rep:write`)
- [ ] External-caller examples use IMS bearer tokens — not basic auth

**Configuration:**
- [ ] Service user created via Repoinit in `ui.config` with correct ACL privileges for the operation (read for reads, removeNode for deletes)
- [ ] `ServiceUserMapperImpl.amended-*.cfg.json` maps `<bundle>:<subservice>` → the service user (principal-name form)
- [ ] Bundle symbolic name in the mapping matches the bundle owning the servlet / utility
- [ ] `mvn clean install` succeeds with no SCR-related or deprecated-API warnings

---

## Troubleshooting

| Symptom | Log to search | Fix direction |
|---------|--------------|--------------|
| `NoSuchMethodError: AssetManager.createAssetForBinary` at runtime | the exception name verbatim | Legacy binary-path API isn't on the CS SDK classpath — complete the C1 migration |
| `NoSuchMethodError: AssetManager.removeAssetForBinary` at runtime | the exception name verbatim | Same as above — complete the D1 migration |
| Upload endpoint returns 500 or times out under load | client-side `socket timeout` or `payload too large`; server-side may show memory pressure | Client is uploading through the JVM via legacy servlet — migrate to Direct Binary Access; the bytes should never flow through AEM's JVM |
| `LoginException: Unable to retrieve the service resource resolver` | the exception name verbatim | Service user not provisioned via Repoinit, OR `ServiceUserMapperImpl.amended-*.cfg.json` missing/misnamed, OR bundle symbolic name in mapping doesn't match the bundle owning the servlet |
| `AccessDeniedException` on `resolver.commit()` after `resolver.delete()` | `AccessDeniedException` near a `commit()` call | Service user lacks `jcr:removeNode` and/or `jcr:removeChildNodes` on the asset tree — extend Repoinit ACL |
| Delete servlet returns 200 but the asset is still present | none | Code path is missing `resolver.commit()` — `delete()` only stages the operation; without `commit()`, try-with-resources closes the resolver and silently discards the pending change |
| External caller gets 401 Unauthorized on `/api/assets` | server-side `401` or `WWW-Authenticate: Bearer` | Caller is using basic auth with a hardcoded password — switch to an IMS / dev-console bearer token |
| Direct Binary Access upload fails with CORS error | browser console `CORS policy: No 'Access-Control-Allow-Origin'` | Client origin not configured in AEMaaCS Cross-Origin Resource Sharing OSGi config — add the origin to the allowlist |
| Direct Binary Access upload completes but processed renditions never appear | none synchronously | Asset processing is asynchronous on AEMaaCS — verify in the DAM admin UI; if stuck, check the asset processing pipeline status in Cloud Manager |

---

## Common Pitfalls

**Calling `createAssetForBinary` / `getAssetForBinary` / `removeAssetForBinary`** — these APIs do not exist on AEMaaCS. The compile-time signature is gone; if a build succeeds against legacy AEM jars and then deploys to CS, every call throws `NoSuchMethodError` at runtime.

**Accepting client uploads via a Java servlet that calls `createAsset(path, InputStream, ...)`** — funnels every byte through the AEM JVM. Slow, memory-bound, blocked by a 2 GB ceiling, and bypasses the asset processing pipeline's Direct Binary Access path. Migrate to `@adobe/aem-upload` on the client.

**Hardcoding credentials** — `Authorization: Basic Buffer.from('admin:admin').toString('base64')`, literal `":password"` strings, plain-text bearer tokens. AEMaaCS has no static admin password; external callers must use IMS / dev-console service credentials that produce short-lived bearer tokens.

**AEM calling its own HTTP API from inside the JVM** — `DELETE /api/assets/...` from a Java servlet adds latency, requires credentials the JVM shouldn't hold, and breaks idempotency. Use the resource API directly (`resolver.delete()` + `resolver.commit()`).

**Forgetting `resolver.commit()` after `resolver.delete()`** — try-with-resources closes the resolver and silently discards the pending delete. Always commit before the resolver closes.

**Treating "asset not found" as an error** — delete operations should be idempotent. If the asset is already gone, return success (200/204), not 404 as a failure. Otherwise retries against a now-deleted resource fail unnecessarily.

**Service user with only `rep:write`** — `rep:write` does NOT include node removal. The Repoinit ACL must grant `jcr:removeNode` and `jcr:removeChildNodes` for delete operations to succeed.

**Confusing repository path with binary path** — `getAssetForBinary("/var/dam-binaries/foo.jpg")` is gone. The new world only has repository paths (`/content/dam/site/foo.jpg`). Any code path that constructed a "binary path" should be deleted along with the legacy API call.

**Not validating the path parameter on a delete endpoint** — `request.getParameter("path")` without validation is a destructive vulnerability. Anchor to `/content/dam/` (or your tenant's subtree) before calling `resolver.delete()`.

**Catching `Exception` broadly and swallowing the cause** — `LoginException`, `PersistenceException`, and `IOException` carry distinct failure modes. Catch them separately and log with the asset path so audit logs are actionable.

---

## Modern Alternatives

| Need | Use |
|------|-----|
| Read an asset (path lookup, metadata, renditions) | `resolver.getResource(path).adaptTo(Asset.class)` — `AssetManager.getAsset(path)` is also supported |
| Upload from a browser or external client | **Direct Binary Access** via `@adobe/aem-upload` (HTTP `POST /api/assets`) |
| Create a small asset from a bundled resource (in-JVM) | `AssetManager.createAsset(path, InputStream, mimeType, true)` with a service-user resolver — still supported |
| Delete from in-JVM code (servlet, scheduler, JobConsumer) | `resolver.delete(resource) + resolver.commit()` with a service-user resolver |
| Delete from outside AEM (integration backend, CLI) | HTTP `DELETE /api/assets{path}` with an IMS / dev-console bearer token |
| Update metadata on an existing asset | `resource.adaptTo(ModifiableValueMap.class)` on `/content/dam/.../jcr:content/metadata` + `resolver.commit()`. For external callers: `PUT /api/assets{path}.json` |
| React to asset events (added, processed, deleted) | `ResourceChangeListener` on `/content/dam` (see `resource-change-listener` skill) |
| Trigger replication after asset operations | `Distributor.distribute(...)` (see `replication` skill) |
| Hook the asset processing pipeline | Asset processing runs out-of-band on AEMaaCS — listen for DAM workflow completion events via `event-migration` skill, not the legacy `dam/update_asset` workflow internals |
| Bulk asset import / migration | Direct Binary Access from the migration tool, OR Adobe-managed bulk import (Cloud Manager) — not a JVM loop calling `createAsset` |

---

## Expert Guidance

**Binary I/O does not flow through the AEM JVM on AEMaaCS.** This is the single biggest architectural shift. Direct Binary Access uploads negotiate a short-lived URL between the client and Adobe's binary store; the AEM JVM only handles metadata and the post-upload `complete` call. Any pattern that involves the JVM holding bytes (large `InputStream` over a servlet, `createAssetForBinary`, in-memory image manipulation before upload) belongs to the legacy AEM 6.x architecture and won't perform on CS.

**Asset processing is asynchronous and Adobe-managed.** When Direct Binary Access completes the upload, the asset is *queued* for processing — renditions, metadata extraction, smart tags. The completion of the upload does NOT mean renditions are ready. Code that depends on processed renditions must either:

- Listen for DAM workflow completion events
- Poll the asset's `jcr:content/renditions` path with backoff
- Accept eventual consistency and not block on rendition availability

**Authentication splits two ways on AEMaaCS.** In-JVM code uses a service-user resolver — no credentials, no tokens, just a `SUBSERVICE` name resolved by `ServiceUserMapperImpl.amended`. External callers use IMS or dev-console bearer tokens — short-lived, scope-limited, never hardcoded. There is no third option. Hardcoded passwords, basic auth literals, and "admin" accounts do not exist on CS.

**Delete operations should be idempotent.** Treat `resource == null` as success; the result of "asset is not present" is the same as "asset was deleted successfully". This matters for retry semantics on JobConsumers and external callers — non-idempotent delete leads to flaky tests and false alarms.

**Failure modes to plan for:**

- **`NoSuchMethodError` at runtime** — bundle compiled against legacy AEM jars but deployed to CS. Update bundle dependencies.
- **`AccessDeniedException` on commit** — service-user ACL missing `jcr:removeNode` for deletes or `rep:write` for creates. Extend Repoinit.
- **CORS errors on Direct Binary Access** — client origin not in the CS CORS allowlist. Configure via OSGi config (Cross-Origin Resource Sharing factory).
- **Upload timeout under load** — code path still goes through the JVM. Audit for residual `request.getInputStream()` + `createAsset` patterns.
- **Renditions never appear** — asset processing pipeline issue or workflow disabled. Check Cloud Manager pipeline status; don't try to recreate the rendition pipeline in custom code.

---

### Practical engineering notes

The following are practical observations from production AEMaaCS code rather than items documented as part of Adobe's official Asset Manager or DAM API contract. They are useful design guidance but should not be treated as guarantees:

- **`createAsset` `doSave=true` versus explicit commit.** Empirically, `createAsset(..., true)` auto-commits on most CS versions, but behavior across resolver lifecycles (especially when the call is wrapped in a transaction-like sequence with other writes) is not formally documented. If you need deterministic commit ordering with other writes in the same flow, prefer `createAsset(..., false)` followed by an explicit `resolver.commit()`.
- **Asset metadata updates after Direct Binary Access.** The `@adobe/aem-upload` flow uploads the binary but does not set custom metadata. To attach `dc:title`, `dc:description`, or custom properties, follow up with a `PUT /api/assets{path}.json` (external) or a `ModifiableValueMap` write to `jcr:content/metadata` (in-JVM, after the asset is processed). Doing both in parallel can race the processing pipeline.
- **Direct Binary Access maximum file size.** The documented ceiling is large (~100 GB by manifest, varies by environment), but practical timeouts and client-side memory often bind well before that. For files >2 GB, validate the client SDK version and the AEMaaCS environment tier before promising the upload will work.
