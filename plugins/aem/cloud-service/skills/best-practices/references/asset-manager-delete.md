> **Deprecated:** This file is superseded by [`../asset-manager/SKILL.md`](../asset-manager/SKILL.md).
> It will be removed once all five expert skills are in place. Do not update this file.

# Asset Manager Path B: Delete

For files using `AssetManager.removeAssetForBinary(binaryFilePath, doSave)` — an API that
**does not exist on AEM as a Cloud Service**.

On AEMaaCS, asset deletion splits two ways:

| Where is the deleter running? | Use |
|------------------------------|-----|
| **Inside the AEM JVM** (servlet, Sling job, scheduler, workflow step) | Service-user `ResourceResolver` + `resolver.delete(resource)` + `resolver.commit()`. **Never** call AEM's own HTTP API from inside the JVM. |
| **Outside AEM** (ingestion worker, integration backend, CLI) | HTTP Assets API `DELETE /api/assets{path}` with an **IMS / dev-console bearer token** (never a static password). |

---

## Complete Example: Before and After

### Before (removed API)

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
                response.getWriter().write("Asset deleted successfully: " + binaryFilePath);
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

### After — in-JVM delete with a service-user resolver (recommended)

Server-side code that already has a trusted `ResourceResolver` should delete assets directly.
No HTTP, no credentials, no self-loopback.

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
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "asset-admin-service"))) {

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
            LOG.error("Could not open service resolver for subservice 'asset-admin-service'", e);
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

Supporting Repoinit / service-user mapping (in `ui.config`):

```
create service user asset-admin-service

set ACL for asset-admin-service
    allow jcr:read,rep:write,jcr:removeNode,jcr:removeChildNodes on /content/dam
end
```

```json
{
  "user.mapping": [
    "com.example.mybundle:asset-admin-service=[asset-admin-service]"
  ]
}
```

### After — external-caller delete via the HTTP Assets API

If the deleter is **outside** the AEM JVM (integration backend, CLI, worker), call the HTTP API
with an IMS or dev-console bearer token — not with a hardcoded password.

```javascript
import axios from 'axios';

export async function deleteAsset({ host, assetPath, bearerToken }) {
    const response = await axios.delete(`${host}/api/assets${assetPath}`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
        validateStatus: s => s === 200 || s === 204 || s === 404
    });
    return response.status !== 404;
}
```

**Key changes:**

- Removed use of `AssetManager.removeAssetForBinary()` (the API is gone on AEMaaCS).
- Server-side deletion goes through `ResourceResolver#delete` + `commit`, using a service user
  provisioned via Repoinit.
- No hardcoded `":password"` anywhere. External callers use an IMS / dev-console token.
- Removed Felix SCR → OSGi DS.
- Replaced `System.out` / `System.err` / `printStackTrace` with SLF4J.

---

## Pattern prerequisites

Read [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md)
for Java/OSGi hygiene. Asset delete scope follows this file and
[`asset-manager.md`](asset-manager.md) only.

## D1: Replace `removeAssetForBinary` with `ResourceResolver#delete` (in-JVM)

```java
// BEFORE (removed API)
boolean isAssetDeleted = assetManager.removeAssetForBinary(binaryFilePath, doSave);
if (isAssetDeleted) {
    response.getWriter().write("Asset deleted successfully: " + binaryFilePath);
} else {
    response.getWriter().write("Failed to delete asset.");
}

// AFTER — in-JVM
try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
        Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "asset-admin-service"))) {

    Resource resource = resolver.getResource(assetPath);   // repository path, not binary path
    if (resource == null) {
        // asset already gone
        return;
    }
    resolver.delete(resource);
    resolver.commit();
} catch (LoginException e) {
    LOG.error("Could not open service resolver for subservice 'asset-admin-service'", e);
} catch (PersistenceException e) {
    LOG.error("Commit failed while deleting asset {}", assetPath, e);
}
```

Notes:

- `assetPath` must be the **repository path** (e.g. `/content/dam/site/file.jpg`) — the old
  "binary path" concept does not exist on AEMaaCS.
- The service user behind the `SUBSERVICE` name must have
  `jcr:removeNode` / `jcr:removeChildNodes` on the asset tree (Repoinit rule above).
- Do not call AEM's own HTTP API (`/api/assets`) from inside the JVM — it adds an extra hop,
  requires credentials you shouldn't store, and breaks idempotency.

## D2: For external callers, use the HTTP Assets API with a bearer token

```javascript
await axios.delete(`${host}/api/assets${assetPath}`, {
    headers: { Authorization: `Bearer ${bearerToken}` }
});
```

Where `bearerToken` comes from:

- **Adobe Developer Console / IMS** service credentials (server-to-server), **or**
- A short-lived user token obtained via the AEM login flow.

**Never** hardcode usernames and passwords in source or pass `":password"` strings.

## D3: Update imports

**Remove** (when all `AssetManager` delete calls are gone):

```java
import com.day.cq.dam.api.AssetManager;
```

**Keep** if the file still uses `AssetManager.getAsset(...)` for reads.

**Add** (for the in-JVM delete path):

```java
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.PersistenceException;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Collections;
```

Remove Felix SCR imports per [scr-to-osgi-ds.md](scr-to-osgi-ds.md).

---

## Validation

- [ ] No `removeAssetForBinary(` calls remain.
- [ ] In-JVM deletes use `resolver.delete(resource)` + `resolver.commit()` with a service-user resolver; the servlet no longer calls AEM's own HTTP API.
- [ ] Service user + mapping provisioned via Repoinit in `ui.config`, with ACLs granting `jcr:removeNode` / `jcr:removeChildNodes` on the asset tree.
- [ ] No hardcoded credentials (`":password"`, plain-text basic auth strings) anywhere.
- [ ] External-caller examples use a bearer token — not basic auth with a literal password.
- [ ] [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) satisfied for SCR, resolver, logging.
- [ ] `@Reference AssetManager` removed if no longer needed for delete flows.
- [ ] Code compiles: `mvn clean compile`.
