# Asset Manager Path A: Create/Upload → Direct Binary Access

For files using deprecated `createAsset()`, `createAssetForBinary()`, or `getAssetForBinary()`.

These deprecated APIs are replaced with **Direct Binary Access** via the `@adobe/aem-upload` SDK (client-side) or HTTP API (server-side).

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

### After (Cloud Service Compatible - Client-Side Upload)

**Note:** In AEM Cloud Service, asset creation from InputStream in servlets is deprecated. Migrate to client-side upload using Direct Binary Access.

**Client-side JavaScript (replaces servlet):**
```javascript
import DirectBinary from '@adobe/aem-upload';

async function uploadAsset(file, assetPath, host, token) {
    const upload = new DirectBinary.DirectBinaryUpload();
    const options = new DirectBinary.DirectBinaryUploadOptions()
        .withUrl(`${host}/api/assets${assetPath}`)
        .withUploadFiles([file])
        .withHttpOptions({ 
            headers: { 
                Authorization: `Bearer ${token}`,
                'Content-Type': file.type
            } 
        });
    
    try {
        const result = await upload.uploadFiles(options);
        return result;
    } catch (error) {
        console.error('Upload failed:', error);
        throw error;
    }
}
```

**If servlet must remain (redirects to client-side):**
```java
package com.example.servlets;

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

@Component(service = Servlet.class, property = {
    ServletResolverConstants.SLING_SERVLET_PATHS + "=/bin/createasset"
})
public class CreateAssetServlet extends SlingAllMethodsServlet {

    private static final Logger LOG = LoggerFactory.getLogger(CreateAssetServlet.class);

    @Override
    protected void doPost(SlingHttpServletRequest request, SlingHttpServletResponse response)
            throws ServletException, IOException {
        
        // In Cloud Service, asset creation must use Direct Binary Access
        // Redirect client to use @adobe/aem-upload SDK
        response.setContentType("application/json");
        response.setStatus(400);
        response.getWriter().write("{\"error\":\"Asset creation must use Direct Binary Access. " +
            "Use @adobe/aem-upload SDK client-side or HTTP API.\"}");
        LOG.warn("Deprecated createAsset API called - redirecting to Direct Binary Access");
    }
}
```

**Key Changes:**
- ✅ Removed `AssetManager.createAsset()` calls
- ✅ Migrated to Direct Binary Access pattern (`@adobe/aem-upload`)
- ✅ Removed Felix SCR → OSGi DS annotations
- ✅ Replaced `System.out/err` → SLF4J Logger
- ✅ Servlet redirects to client-side upload pattern

---

## Pattern prerequisites

Read [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) for Java/OSGi hygiene. Asset creation/upload scope follows **this file** and `asset-manager.md` only.

## C1: Replace createAssetForBinary / getAssetForBinary with Direct Binary Access

**Remove deprecated API usage:**

```java
// BEFORE (deprecated)
assetManager.createAssetForBinary(binaryFilePath, doSave);
Asset asset = assetManager.getAssetForBinary(binaryFilePath);
if (asset != null) {
    response.getWriter().write("Asset created successfully: " + asset.getPath());
} else {
    response.getWriter().write("Failed to create asset.");
}

// AFTER (Cloud Service — use Direct Binary Access)
// In AEM as a Cloud Service, asset creation must use Direct Binary Access.
// Migrate to client-side upload using @adobe/aem-upload SDK:
//   const DirectBinary = require('@adobe/aem-upload');
//   const upload = new DirectBinary.DirectBinaryUpload();
//   const options = new DirectBinary.DirectBinaryUploadOptions()
//       .withUrl(targetUrl)
//       .withUploadFiles(uploadFiles)
//       .withHttpOptions({ headers: { Authorization: ... } });
//   upload.uploadFiles(options).then(...)
// See: https://experienceleague.adobe.com/docs/experience-manager-cloud-service/content/assets/admin/direct-binary-access.html
```

**For Java servlets that must remain:** Redirect to client-side upload flow or return instructions. Do not retain deprecated calls.

## C2: Replace createAsset(path, is, mimeType, overwrite) with Direct Binary Access

**Remove deprecated API usage:**

```java
// BEFORE (deprecated)
AssetManager assetManager = req.getResourceResolver().adaptTo(AssetManager.class);
Asset imageAsset = assetManager.createAsset("/content/dam/mysite/test." + fileExt, is, mimeType, true);
resp.setContentType("text/plain");
resp.getWriter().write("Image Uploaded = " + imageAsset.getName() + " to path = " + imageAsset.getPath());

// AFTER (Cloud Service — use Direct Binary Access)
// In AEM as a Cloud Service, asset creation from InputStream is deprecated.
// Migrate to client-side upload using @adobe/aem-upload:
//   fetch(sourceUrl).then(r => r.blob()).then(blob => {
//       const upload = new DirectBinary.DirectBinaryUpload();
//       const options = new DirectBinary.DirectBinaryUploadOptions()
//           .withUrl(targetUrl)
//           .withUploadFiles(blob)
//           .withHttpOptions({ headers: { Authorization: ... } });
//       upload.uploadFiles(options).then(...);
//   });
```

**InputStream handling:** Ensure any `InputStream` is closed in try-with-resources or `finally` block. If migrating away from Java entirely, remove the InputStream logic.

**ResourceResolver + logging:** Apply [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) for any remaining servlet or service code that opens a resolver or logs errors.

## C3: Update imports

**Remove (when deprecated AssetManager usage is removed):**
```java
import com.day.cq.dam.api.Asset;
import com.day.cq.dam.api.AssetManager;
import com.day.cq.dam.api.metadata.MetaDataMap;  // if only used for deprecated flow
```

**Keep (if AssetManager still used for read-only operations):**
```java
import com.day.cq.dam.api.Asset;
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

- [ ] No `createAssetForBinary(binaryFilePath, doSave)` or `getAssetForBinary(binaryFilePath)` calls remain
- [ ] No `createAsset(path, is, mimeType, overwrite)` calls remain
- [ ] Direct Binary Access pattern documented or implemented (client-side `@adobe/aem-upload` or equivalent)
- [ ] [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) satisfied for SCR, resolver, logging
- [ ] InputStream resources closed in try-with-resources or `finally` (if any remain)
- [ ] `@Reference` AssetManager removed if no longer needed for create flows
- [ ] Code compiles: `mvn clean compile`
