# Asset Manager Path B: Delete → HTTP Assets API

For files using deprecated `removeAssetForBinary()`.

This deprecated API is replaced with the **HTTP Assets API** `DELETE /api/assets{path}`.

---

## D1: Migrate Felix SCR to OSGi DS annotations (if present)

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
    @Property(name = "sling.servlet.paths", value = "/bin/deleteasset")
})

// AFTER (OSGi DS)
@Component(service = Servlet.class, property = {
    ServletResolverConstants.SLING_SERVLET_PATHS + "=/bin/deleteasset"
})
```

## D2: Replace removeAssetForBinary with HTTP Assets API

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

## D3: Replace getAdministrativeResourceResolver() with getServiceResourceResolver()

If the file uses `getAdministrativeResourceResolver()`:

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

## D4: Add ResourceResolver try-with-resources (if applicable)

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

## D5: Replace System.out and e.printStackTrace() with SLF4J Logger

```java
// ADD after class declaration
private static final Logger LOG = LoggerFactory.getLogger(MyServlet.class);

// REPLACE
System.out.println("message")  ->  LOG.info("message")
e.printStackTrace()            ->  LOG.error("Error occurred", e)
response.getWriter().write("Error: " + e.getMessage());  // keep for user-facing, add:
LOG.error("Error processing request", e);
```

## D6: Update imports

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
- [ ] No Felix SCR annotations remain
- [ ] SLF4J Logger is present
- [ ] No `System.out.` or `e.printStackTrace()` calls remain
- [ ] `@Reference` AssetManager removed if no longer needed for delete flows
- [ ] No `getAdministrativeResourceResolver()` — uses `getServiceResourceResolver()` if ResourceResolver needed
- [ ] ResourceResolver in try-with-resources where applicable
- [ ] Code compiles: `mvn clean compile`
