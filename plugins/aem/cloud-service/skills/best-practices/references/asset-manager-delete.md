# Asset Manager Path B: Delete → HTTP Assets API

For files using deprecated `removeAssetForBinary()`.

This deprecated API is replaced with the **HTTP Assets API** `DELETE /api/assets{path}`.

---

## Complete Example: Before and After

### Before (Legacy AssetManager API)

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

### After (Cloud Service Compatible - Client-Side)

**Client-side JavaScript:**
```javascript
async function deleteAsset(assetPath, host, credentials) {
    try {
        const response = await axios.delete(`${host}/api/assets${assetPath}`, {
            auth: {
                username: credentials.username,
                password: credentials.password
            }
        });
        return response.status === 200 || response.status === 204;
    } catch (error) {
        if (error.response?.status === 404) {
            return false; // Asset not found
        }
        throw error;
    }
}
```

### After (Cloud Service Compatible - Server-Side Java)

**If servlet must remain:**
```java
package com.example.servlets;

import org.apache.http.client.HttpClient;
import org.apache.http.client.methods.HttpDelete;
import org.apache.http.impl.client.HttpClientBuilder;
import org.osgi.service.component.annotations.Component;
import org.apache.sling.api.SlingHttpServletRequest;
import org.apache.sling.api.SlingHttpServletResponse;
import org.apache.sling.api.servlets.SlingAllMethodsServlet;
import org.apache.sling.api.servlets.ServletResolverConstants;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.servlet.Servlet;
import javax.servlet.ServletException;
import java.io.IOException;
import java.util.Base64;

@Component(service = Servlet.class, property = {
    ServletResolverConstants.SLING_SERVLET_PATHS + "=/bin/deleteasset"
})
public class DeleteAssetServlet extends SlingAllMethodsServlet {

    private static final Logger LOG = LoggerFactory.getLogger(DeleteAssetServlet.class);

    @Override
    protected void doDelete(SlingHttpServletRequest request, SlingHttpServletResponse response)
            throws ServletException, IOException {
        
        String assetPath = request.getParameter("path");
        if (assetPath == null || assetPath.isEmpty()) {
            response.setStatus(400);
            response.getWriter().write("{\"error\":\"path parameter required\"}");
            return;
        }

        try {
            // Use HTTP Assets API
            String host = request.getScheme() + "://" + request.getServerName() + ":" + request.getServerPort();
            String apiUrl = host + "/api/assets" + assetPath;
            
            HttpClient client = HttpClientBuilder.create().build();
            HttpDelete deleteRequest = new HttpDelete(apiUrl);
            
            // Add authentication header (use service user credentials)
            String auth = Base64.getEncoder().encodeToString(
                (request.getUserPrincipal().getName() + ":password").getBytes()
            );
            deleteRequest.setHeader("Authorization", "Basic " + auth);
            
            org.apache.http.HttpResponse httpResponse = client.execute(deleteRequest);
            int statusCode = httpResponse.getStatusLine().getStatusCode();
            
            response.setContentType("application/json");
            if (statusCode == 200 || statusCode == 204) {
                response.getWriter().write("{\"success\":true,\"message\":\"Asset deleted: " + assetPath + "\"}");
            } else if (statusCode == 404) {
                response.setStatus(404);
                response.getWriter().write("{\"error\":\"Asset not found: " + assetPath + "\"}");
            } else {
                response.setStatus(statusCode);
                response.getWriter().write("{\"error\":\"Delete failed with status: " + statusCode + "\"}");
            }
            
        } catch (Exception e) {
            LOG.error("Error deleting asset: {}", assetPath, e);
            response.setStatus(500);
            response.getWriter().write("{\"error\":\"Internal server error\"}");
        }
    }
}
```

**Key Changes:**
- ✅ Removed `AssetManager.removeAssetForBinary()` calls
- ✅ Migrated to HTTP Assets API `DELETE /api/assets{path}`
- ✅ Removed Felix SCR → OSGi DS annotations
- ✅ Replaced `System.out/err` → SLF4J Logger
- ✅ Used HttpClient for server-side API calls
- ✅ Proper error handling and status codes

---

## Pattern prerequisites

Read [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) for Java/OSGi hygiene. Asset delete scope follows **this file** and `asset-manager.md` only.

## D1: Replace removeAssetForBinary with HTTP Assets API

**Remove deprecated API usage:**

```java
// BEFORE (deprecated)
boolean isAssetDeleted = assetManager.removeAssetForBinary(binaryFilePath, doSave);
if (isAssetDeleted) {
    response.getWriter().write("Asset deleted successfully: " + binaryFilePath);
} else {
    response.getWriter().write("Failed to delete asset.");
}

// AFTER (Cloud Service — use HTTP Assets API)
// Option A: Call HTTP API from Java (requires HttpClient/HttpURLConnection)
//   DELETE {host}/api/assets{path}
//   with basic auth
//
// Option B: Migrate to client-side delete using HTTP API:
//   const response = await axios.delete(`${host}/api/assets${assetPath}`, {
//       auth: { username, password }
//   });
```

**HTTP API delete example (client-side):**
```javascript
const response = await axios.delete(`${host}/api/assets${assetPath}`, {
    auth: { username, password }
});
```

**ResourceResolver + logging:** Apply [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) for any remaining servlet or service code.

## D2: Update imports

**Remove (when deprecated AssetManager delete usage is removed):**
```java
import com.day.cq.dam.api.AssetManager;  // if no longer needed
```

**Keep (if AssetManager still used for other operations):**
```java
import com.day.cq.dam.api.AssetManager;
```

**Add (for logging):**
```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
```

**Remove (Felix SCR, if migrated):**
```java
import org.apache.felix.scr.annotations.*;
```

**Add (OSGi DS, if migrated):**
```java
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.apache.sling.api.servlets.ServletResolverConstants;
import javax.servlet.Servlet;
```

---

# Validation

- [ ] No `removeAssetForBinary(binaryFilePath, doSave)` calls remain
- [ ] HTTP Assets API `DELETE /api/assets{path}` used (client or server)
- [ ] [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) satisfied for SCR, resolver, logging
- [ ] `@Reference` AssetManager removed if no longer needed for delete flows
- [ ] Code compiles: `mvn clean compile`
