# Asset Manager Path A: Create/Upload → Direct Binary Access

For files using deprecated `createAsset()`, `createAssetForBinary()`, or `getAssetForBinary()`.

These deprecated APIs are replaced with **Direct Binary Access** via the `@adobe/aem-upload` SDK (client-side) or HTTP API (server-side).

---

## C1: Migrate Felix SCR to OSGi DS annotations (if present)

If the file uses Felix SCR annotations (`org.apache.felix.scr.annotations.*`), migrate to OSGi DS:

**Remove Felix SCR imports:**
```java
import org.apache.felix.scr.annotations.Component;
import org.apache.felix.scr.annotations.Service;
import org.apache.felix.scr.annotations.Properties;
import org.apache.felix.scr.annotations.Property;
import org.apache.felix.scr.annotations.Reference;
```

**Replace annotations:**
```java
// BEFORE (Felix SCR)
@Component(immediate = true)
@Service
@Properties({
    @Property(name = "sling.servlet.paths", value = "/bin/createasset")
})
public class CreateAssetServlet extends SlingAllMethodsServlet {
    @Reference
    private AssetManager assetManager;
}

// AFTER (OSGi DS)
@Component(service = Servlet.class, property = {
    ServletResolverConstants.SLING_SERVLET_PATHS + "=/bin/createasset"
})
public class CreateAssetServlet extends SlingAllMethodsServlet {
    @Reference
    private AssetManager assetManager;
}
```

## C2: Replace createAssetForBinary / getAssetForBinary with Direct Binary Access

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

## C3: Replace createAsset(path, is, mimeType, overwrite) with Direct Binary Access

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

## C4: Replace getAdministrativeResourceResolver() with getServiceResourceResolver()

If the file uses `getAdministrativeResourceResolver()` for any AssetManager-related workflow:

```java
// BEFORE (deprecated)
ResourceResolver resolver = resourceResolverFactory.getAdministrativeResourceResolver(null);

// AFTER
try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
        Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "asset-service-user"))) {
    // use resolver
} catch (LoginException e) {
    LOG.error("Failed to get resource resolver", e);
}
```

## C5: Add ResourceResolver try-with-resources (if applicable)

If the file acquires a ResourceResolver for asset operations (and keeps non-deprecated usage):

```java
// BEFORE
ResourceResolver resolver = resourceResolverFactory.getServiceResourceResolver(authInfo);
// ... use resolver ...
resolver.close();

// AFTER
try (ResourceResolver resolver = resourceResolverFactory.getServiceResourceResolver(authInfo)) {
    // ... use resolver ...
}
```

## C6: Replace System.out and e.printStackTrace() with SLF4J Logger

```java
// ADD after class declaration
private static final Logger LOG = LoggerFactory.getLogger(MyServlet.class);

// REPLACE
System.out.println("message")  ->  LOG.info("message")
e.printStackTrace()            ->  LOG.error("Error occurred", e)
response.getWriter().write("Error: " + e.getMessage());  // keep for user-facing, add:
LOG.error("Error processing request", e);
```

## C7: Update imports

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
- [ ] No Felix SCR annotations remain
- [ ] SLF4J Logger is present
- [ ] No `System.out.` or `e.printStackTrace()` calls remain
- [ ] InputStream resources closed in try-with-resources or `finally` (if any remain)
- [ ] `@Reference` AssetManager removed if no longer needed for create flows
- [ ] No `getAdministrativeResourceResolver()` — uses `getServiceResourceResolver()` if ResourceResolver needed
- [ ] ResourceResolver in try-with-resources where applicable
- [ ] Code compiles: `mvn clean compile`
