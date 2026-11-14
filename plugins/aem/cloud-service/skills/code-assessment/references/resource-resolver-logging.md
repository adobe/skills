# ResourceResolver & logging (AEM as a Cloud Service)

**Part of the `best-practices` skill.** Read this module when fixing Sling resource access or
logging; pattern files link here instead of repeating the same rules.

**Expectations** for backend Java on **AEM as a Cloud Service**:

1. Do **not** use `ResourceResolverFactory.getAdministrativeResourceResolver(...)`.
2. Use **`getServiceResourceResolver`** with a **`SUBSERVICE`** mapping to an OSGi service user
   with the right ACLs.
3. The service user and its ACLs must be provisioned through **Repoinit** (the Apache Sling
   Repoinit OSGi factory config), because AEM as a Cloud Service does **not** provide an
   interactive user-admin UI for creating users or adjusting their ACLs at runtime.
4. The `<bundle>:<subservice>` → service-user mapping must be declared in a
   `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-*.cfg.json` file under
   the appropriate `ui.config` runmode folder.
5. Close resolvers predictably — prefer **try-with-resources**.
6. Use **SLF4J**; do **not** use `System.out`, `System.err`, or `e.printStackTrace()`.

## When to Use

- Migration or review touching `ResourceResolver` or `ResourceResolverFactory`.
- Replacing legacy auth maps (`USER` / `PASSWORD`) with service users.
- OSGi components, servlets, jobs, listeners.

## ResourceResolver: service user (not administrative)

```java
// DISALLOWED on Cloud Service (remove / replace)
ResourceResolver r = factory.getAdministrativeResourceResolver(null);

// PREFERRED
import java.util.Collections;

try (ResourceResolver resolver = factory.getServiceResourceResolver(
        Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "my-service-user"))) {
    // work with resolver
} catch (LoginException e) {
    LOG.error("Could not open service resolver for subservice 'my-service-user'", e);
}
```

### `LoginException` vs. `null` — what to check

`getServiceResourceResolver` signals failure by **throwing `LoginException`**; it does **not**
normally return `null`. Catch `LoginException` and log. You do **not** need a defensive
`resolver == null` branch unless a downstream wrapper in your codebase can legitimately return
`null` (rare).

The same applies to `getResourceResolver(authInfo)`.

### Notes

- **`SUBSERVICE`** must match a **service user** in your project that is provisioned through
  Repoinit and mapped through `ServiceUserMapperImpl.amended` (see below). Reuse an existing
  subservice name when one exists for the same concern.
- If you see `getWriteResourceResolver()` or similar deprecated APIs, replace with the
  **service resolver** pattern.
- Prefer **subservice only** for Cloud Service patterns; remove **`USER` / `PASSWORD`** from
  `authInfo` unless a pattern module documents an explicit exception (there are none at the
  moment).

## Provisioning the service user with Repoinit

On AEM as a Cloud Service, service users, system users, and their ACLs must be created through
the **Apache Sling Repoinit** OSGi factory configuration. The classic `/useradmin` UI and
ad-hoc ACL editing through CRXDE are not available.

Place the Repoinit config in a `ui.config` package under a runmode folder that matches where
the service user is needed (`osgiconfig/config`, `osgiconfig/config.author`,
`osgiconfig/config.publish`, etc.).

**File name:** `org.apache.sling.jcr.repoinit.RepositoryInitializer~my-service-user.cfg.json`

```json
{
  "scripts": [
    "create service user my-service-user",
    "set ACL for my-service-user",
    "  allow jcr:read on /content",
    "  allow jcr:read,rep:write on /var/my-app",
    "end"
  ]
}
```

Repoinit idempotency: the `create service user` / `set ACL` statements are safe to run on every
deployment. They create the user if missing and re-apply ACLs; they never drop other users or
other grants.

See Adobe's documentation for the full Repoinit grammar (node creation, group membership,
principal-based ACLs, path globs, etc.).

## Mapping the bundle subservice to the service user

Without a mapping, `SUBSERVICE = "my-service-user"` resolves to nothing and
`getServiceResourceResolver` throws `LoginException`. Declare the mapping in a
`ServiceUserMapperImpl.amended-*.cfg.json` file in the same `ui.config` module.

**File name:** `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-my-app.cfg.json`

```json
{
  "user.mapping": [
    "com.example.mybundle:my-service-user=[my-service-user]"
  ]
}
```

The entry format is `<bundle-symbolic-name>:<subservice-name>=[<system-user>]`. The bundle
symbolic name must match the Maven `<artifactId>` / `Bundle-SymbolicName` of the bundle doing
the `getServiceResourceResolver(SUBSERVICE=...)` call.

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
    LOG.error("Could not open service resolver for subservice '...'", e);
}
```

Also close other closeables (`InputStream`, `Session` where applicable) with try-with-resources
or `finally`.

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

- [ ] No `getAdministrativeResourceResolver(` remains.
- [ ] `ResourceResolver` closed via try-with-resources (or equivalent for non-trivial flows).
- [ ] `SUBSERVICE` / service user matches a Repoinit-provisioned system user.
- [ ] `org.apache.sling.jcr.repoinit.RepositoryInitializer~*.cfg.json` under `ui.config`
      creates the service user and grants the minimum required ACLs.
- [ ] `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-*.cfg.json` maps
      `<bundle-symbolic-name>:<subservice>` → the service user.
- [ ] `LoginException` is caught (not left unchecked) where
      `getServiceResourceResolver` is called; no defensive `== null` branch unless justified.
- [ ] `private static final Logger LOG = LoggerFactory.getLogger(...)` where logging is needed.
- [ ] No `System.out`, `System.err`, or `printStackTrace()` in production paths.

## See also

- **SCR → OSGi DS:** [scr-to-osgi-ds.md](scr-to-osgi-ds.md)
- **Pattern index:** [`../SKILL.md`](../SKILL.md)
