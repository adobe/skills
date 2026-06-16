# Guava cache → Caffeine on AEM as a Cloud Service

BPA pattern id: **`guavaCache`**.

Covers BPA findings flagged on bundles that depend on `com.google.common.cache.*`. On AEM as a Cloud Service the supported in-process cache library is **Caffeine** (`com.github.benmanes.caffeine.cache.*`). Volumes are small (~34 findings across the reference customer set, all severity *info*), but the swap is a near-1:1 API mapping and worth doing in a single sweep per bundle.

---

## Why Guava cache is flagged

- Guava as a transitive dependency is shrinking in the AEM Cloud Service uber-jar; relying on `com.google.common.cache.*` from a third-party classloader is unstable.
- Caffeine is the recommended high-performance JVM cache successor (same author as Guava cache) and is the library Adobe ships and supports in CS.
- Caffeine's API is intentionally near-identical to Guava's `CacheBuilder`, so the migration is mechanical.

> **Subtype string note:** the BPA CSV column `subtype` carries `com.google.common.cache` for these findings. If your BPA report uses a different subtype, update [`bpa-local-parser.js`](../../migration/scripts/bpa-local-parser.js) and [`unified-collection-reader.js`](../../migration/scripts/unified-collection-reader.js).

---

## API mapping (Guava → Caffeine)

| Guava | Caffeine |
|---|---|
| `com.google.common.cache.Cache` | `com.github.benmanes.caffeine.cache.Cache` |
| `com.google.common.cache.LoadingCache` | `com.github.benmanes.caffeine.cache.LoadingCache` |
| `com.google.common.cache.CacheBuilder` | `com.github.benmanes.caffeine.cache.Caffeine` |
| `com.google.common.cache.CacheLoader` | `com.github.benmanes.caffeine.cache.CacheLoader` |
| `com.google.common.cache.RemovalListener` | `com.github.benmanes.caffeine.cache.RemovalListener` |
| `com.google.common.cache.RemovalNotification` | callback signature `(K key, V value, RemovalCause cause)` |
| `CacheBuilder.newBuilder()` | `Caffeine.newBuilder()` |
| `.maximumSize(n)` | identical |
| `.expireAfterWrite(d, TimeUnit)` | `.expireAfterWrite(Duration)` (preferred) or `.expireAfterWrite(d, TimeUnit)` |
| `.expireAfterAccess(d, TimeUnit)` | `.expireAfterAccess(Duration)` |
| `.refreshAfterWrite(d, TimeUnit)` | `.refreshAfterWrite(Duration)` |
| `.weakKeys()` / `.weakValues()` / `.softValues()` | identical |
| `.recordStats()` | identical |
| `.removalListener(listener)` | identical |
| `.build()` | identical (returns `Cache<K, V>`) |
| `.build(cacheLoader)` | identical (returns `LoadingCache<K, V>`) |

**Method-name differences that catch people:**

| Guava `Cache` | Caffeine `Cache` |
|---|---|
| `cache.getIfPresent(key)` | identical |
| `cache.get(key, Callable<V>)` | `cache.get(key, Function<K, V>)` — argument is a `Function`, not `Callable` |
| `cache.asMap()` | identical (`ConcurrentMap` view) |
| `cache.invalidate(key)` / `.invalidateAll()` | identical |
| `LoadingCache.getUnchecked(key)` | `LoadingCache.get(key)` — Caffeine's `get` already throws unchecked |
| `LoadingCache.refresh(key)` | identical |

---

## Classification

1. **Bundle has Guava cache on its compile classpath** (pom dependency or import) → **apply C1 (pom)** + **C2 (imports)** + **C3 (builder/API)**.
2. **Bundle has only an `import com.google.common.cache.*` left over but no real usage** → just remove the import (dead-code cleanup); no Caffeine dep needed.
3. **Code uses Guava `Cache` but also unrelated Guava utilities** (`com.google.common.collect.*`, `com.google.common.base.*`) → only the cache portion is in scope here. Leave other Guava usages alone unless the user explicitly asks.

---

## Transformation steps

### C1 — Maven dependency swap

```xml
<!-- BEFORE — bundle pom.xml -->
<dependency>
    <groupId>com.google.guava</groupId>
    <artifactId>guava</artifactId>
    <version>31.1-jre</version>
    <scope>provided</scope>
</dependency>
```

```xml
<!-- AFTER -->
<dependency>
    <groupId>com.github.ben-manes.caffeine</groupId>
    <artifactId>caffeine</artifactId>
    <version>3.1.8</version>
    <scope>provided</scope>
</dependency>
```

Rules:
- `<scope>provided</scope>` — Caffeine is supplied by the AEM Cloud Service runtime; never embed it in the bundle.
- If Guava is also used elsewhere in the bundle (not just for cache), keep the `guava` dependency and add Caffeine alongside. Do not remove Guava if other code still imports `com.google.common.*`.
- Confirm the Caffeine version against your AEM CS SDK BOM — pin to whatever the SDK exports.

### C2 — Imports

```java
// REMOVE
import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import com.google.common.cache.CacheLoader;
import com.google.common.cache.LoadingCache;
import com.google.common.cache.RemovalListener;
import com.google.common.cache.RemovalNotification;
```

```java
// ADD
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.CacheLoader;
import com.github.benmanes.caffeine.cache.LoadingCache;
import com.github.benmanes.caffeine.cache.RemovalListener;
import com.github.benmanes.caffeine.cache.RemovalCause;
```

### C3 — Builder + API call sites

```java
// BEFORE — Guava
LoadingCache<String, User> users = CacheBuilder.newBuilder()
        .maximumSize(10_000)
        .expireAfterWrite(10, TimeUnit.MINUTES)
        .recordStats()
        .build(new CacheLoader<String, User>() {
            @Override
            public User load(String id) throws Exception {
                return userRepo.findById(id);
            }
        });

User u = users.getUnchecked("u-42");
```

```java
// AFTER — Caffeine
LoadingCache<String, User> users = Caffeine.newBuilder()
        .maximumSize(10_000)
        .expireAfterWrite(Duration.ofMinutes(10))
        .recordStats()
        .build(id -> userRepo.findById(id));

User u = users.get("u-42");
```

```java
// BEFORE — Guava get-or-compute
String value = cache.get(key, () -> compute(key)); // Callable

// AFTER — Caffeine
String value = cache.get(key, k -> compute(k));    // Function
```

```java
// BEFORE — RemovalListener
RemovalListener<String, User> rl = notification ->
        log.info("evicted {} cause={}", notification.getKey(), notification.getCause());

// AFTER — RemovalListener
RemovalListener<String, User> rl = (key, value, cause) ->
        log.info("evicted {} cause={}", key, cause);
```

---

## Validation checklist

- [ ] No `import com.google.common.cache.*` remains in changed files.
- [ ] No `CacheBuilder.newBuilder()` remains; all builders use `Caffeine.newBuilder()`.
- [ ] No `LoadingCache.getUnchecked(...)` remains; replaced with `.get(...)`.
- [ ] No `cache.get(key, Callable)` remains; the Callable is a `Function` (lambda).
- [ ] `Caffeine` is on the bundle's `pom.xml` with `<scope>provided</scope>` matching the AEM CS SDK BOM version.
- [ ] `mvn clean install` passes; **aemanalyser** reports no `com.google.common.cache` API leaks.
- [ ] Unit tests covering cache behaviour (load, expiry, eviction) still pass.

---

## See also

- [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) — SCR → DS, service-user resolvers, SLF4J.
- [`../SKILL.md`](../SKILL.md) — pattern index.
- Caffeine docs: https://github.com/ben-manes/caffeine/wiki — for behavior differences (e.g. async loading, weight-based eviction) not covered above.
