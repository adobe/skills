# ResourceResolver & logging (AEM as a Cloud Service)

**Part of the `best-practices` skill.** Read this module when fixing Sling resource access or logging; pattern files link here instead of repeating the same rules.

**Expectations** for backend Java on **AEM as a Cloud Service**:

1. Do **not** use `ResourceResolverFactory.getAdministrativeResourceResolver(...)`.
2. Use **`getServiceResourceResolver`** with a **`SUBSERVICE`** mapping to an OSGi service user with the right ACLs.
3. Close resolvers predictably — prefer **try-with-resources**.
4. Use **SLF4J**; do **not** use `System.out`, `System.err`, or `e.printStackTrace()`.

## When to Use

- Migration or review touching `ResourceResolver` or `ResourceResolverFactory`
- Replacing legacy auth maps (`USER`/`PASSWORD`) with service users
- OSGi components, servlets, jobs, listeners

## ResourceResolver: service user (not administrative)

```java
// DISALLOWED on Cloud Service (remove / replace)
ResourceResolver r = factory.getAdministrativeResourceResolver(null);

// PREFERRED
import java.util.Collections;

try (ResourceResolver resolver = factory.getServiceResourceResolver(
        Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "my-service-user"))) {
    if (resolver == null) {
        LOG.warn("Could not acquire resource resolver");
        return;
    }
    // work with resolver
} catch (LoginException e) {
    LOG.error("Failed to open resource resolver", e);
}
```

**Notes:**

- **`SUBSERVICE`** must match a **service user** in your project. Reuse an existing subservice name when one exists for the same concern.
- If you see `getWriteResourceResolver()` or similar deprecated APIs, replace with the **service resolver** pattern where supported by your SDK.
- Prefer **subservice only** for Cloud Service patterns; remove **`USER` / `PASSWORD`** from `authInfo` unless a pattern module documents an exception.

## try-with-resources

```java
// BEFORE (manual close)
ResourceResolver resolver = null;
try {
    resolver = factory.getServiceResourceResolver(authInfo);
    // ...
} finally {
    if (resolver != null && resolver.isLive()) {
        resolver.close();
    }
}

// AFTER
try (ResourceResolver resolver = factory.getServiceResourceResolver(authInfo)) {
    // ...
} catch (LoginException e) {
    LOG.error("Failed to get resource resolver", e);
}
```

Also close other closeables (`InputStream`, `Session` where applicable) with try-with-resources or `finally`.

## Logging: SLF4J

```java
private static final Logger LOG = LoggerFactory.getLogger(MyClass.class);
```

| Legacy | Use instead |
|--------|-------------|
| `System.out.println("x")` | `LOG.info("x")` (or `debug` / `warn`) |
| `System.err.println("x")` | `LOG.error("x")` or `LOG.warn("x")` |
| `e.printStackTrace()` | `LOG.error("Context message", e)` |
| `java.util.logging` in bundle code | Prefer SLF4J |

Log exceptions as the last argument: `LOG.error("msg", e)`.

## Validation checklist

- [ ] No `getAdministrativeResourceResolver(` (unless an approved exception exists elsewhere)
- [ ] `ResourceResolver` closed via try-with-resources or equivalent
- [ ] `SUBSERVICE` / service user valid for the operation
- [ ] `private static final Logger LOG = LoggerFactory.getLogger(...)` where logging is needed
- [ ] No `System.out`, `System.err`, or `printStackTrace()` in production paths

## See also

- **SCR → OSGi DS:** [scr-to-osgi-ds.md](scr-to-osgi-ds.md)
- **Pattern index:** [`../SKILL.md`](../SKILL.md)
