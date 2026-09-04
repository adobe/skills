# Guava cache → Caffeine on AEM as a Cloud Service

BPA pattern id: **`guavaCache`**. Not a Cloud-Service-native code-quality issue — it only shows up in code carried over from a pre-cloud (legacy AEM 6.x / AMS / on-prem) codebase, so this is a migration reference, not a `code-assessment` pattern.

## Why it's flagged

On AEM as a Cloud Service the supported in-process cache library is **Caffeine** (`com.github.benmanes.caffeine.cache.*`). Bundles importing `com.google.common.cache.*` are flagged because Guava is shrinking in the CS uber-jar and relying on Guava's cache from a third-party classloader is unstable. Caffeine is the recommended successor (same author as Guava cache) and its API is intentionally near-identical, so the swap is mechanical with a few well-known call-site renames.

## Discovery — BPA is the source of truth

Findings come from **`getBpaFindings('guavaCache', …)`** (BPA CSV column `subtype` = `com.google.common.cache`). When no BPA/CAM source is available, scan the workspace's `.java` files for `import com.google.common.cache.…` — treat this as a manual, unconfirmed lead per file, not a substitute for BPA.

Group by **file**, not by import: a file with multiple `com.google.common.cache.*` imports is one finding, one migration unit — apply the full recipe to that file once.

BPA gives only a `file` (no `line`/`snippet`) — there is no analyzer detector to resolve those, unlike the `code-assessment` cascade patterns. Open the file directly and locate the `com.google.common.cache.*` imports yourself before editing; do not look for a `guava-cache` entry in the analyzer.

## Classification

A file is in scope when it imports `com.google.common.cache.*` — `Cache`, `CacheBuilder`, `LoadingCache`, `CacheLoader`, `RemovalListener`, or `RemovalNotification`.

1. **Bundle uses Guava cache** (import + real usage) → apply the full recipe: **C1 (pom)** + **C2 (imports)** + **C3 (builder / API call sites)**.
2. **Leftover import, no real usage** → just remove the dead `com.google.common.cache.*` import; no Caffeine dependency needed.
3. **Cache plus unrelated Guava utilities** (`com.google.common.collect.*`, `com.google.common.base.*`) → only the cache portion is in scope; leave other Guava usages alone unless the user asks. Keep the `guava` dependency if other code still imports `com.google.common.*`.

**Not in scope:** look-alike cache classes from other packages — e.g. `io.micrometer.core.instrument.binder.cache.GuavaCacheMetrics` — are not `com.google.common.cache.*` and should not be flagged. If a manual scan flags one of these, treat it as a scan error and skip it; it is not a Guava cache usage.

## Resolution contract

**Self-evident** — the Guava → Caffeine API mapping below is fixed; no user input is required to plan the edit. The only judgment call is the Caffeine version: pin it to the AEM CS SDK BOM (default `3.1.8`).

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
| `.maximumSize(n)` / `.weakKeys()` / `.softValues()` / `.recordStats()` / `.removalListener(l)` | identical |
| `.expireAfterWrite(d, TimeUnit)` | `.expireAfterWrite(Duration)` (preferred) or `(d, TimeUnit)` |
| `.expireAfterAccess(d, TimeUnit)` / `.refreshAfterWrite(d, TimeUnit)` | `.expireAfterAccess(Duration)` / `.refreshAfterWrite(Duration)` |
| `.build()` | identical (returns `Cache<K,V>`) |
| `.build(cacheLoader)` | identical (returns `LoadingCache<K,V>`) |
| `cache.getIfPresent(key)` / `.asMap()` / `.invalidate(key)` / `.invalidateAll()` | identical |
| `cache.get(key, Callable<V>)` | `cache.get(key, Function<K,V>)` — argument is a `Function`, not `Callable` |
| `LoadingCache.getUnchecked(key)` | `LoadingCache.get(key)` — Caffeine's `get` already throws unchecked |
| `LoadingCache.refresh(key)` | identical |

## C1 — Maven dependency swap (bundle pom)

```xml
<!-- BEFORE -->
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
- `<scope>provided</scope>` — Caffeine is supplied by the AEM CS runtime; never embed it.
- If Guava is also used elsewhere in the bundle (not just cache), **keep** the `guava` dependency and add Caffeine alongside.
- Pin the Caffeine version to whatever the AEM CS SDK BOM exports.

## C2 — Imports

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
// ADD (only those actually used)
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.CacheLoader;
import com.github.benmanes.caffeine.cache.LoadingCache;
import com.github.benmanes.caffeine.cache.RemovalListener;
import com.github.benmanes.caffeine.cache.RemovalCause;
```

## C3 — Builder + API call sites

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
// BEFORE — get-or-compute (Callable)        // AFTER — Caffeine (Function)
String v = cache.get(key, () -> compute(key));   String v = cache.get(key, k -> compute(k));
```

```java
// BEFORE — RemovalListener (RemovalNotification)
RemovalListener<String, User> rl = notification ->
        log.info("evicted {} cause={}", notification.getKey(), notification.getCause());

// AFTER — RemovalListener (3-arg)
RemovalListener<String, User> rl = (key, value, cause) ->
        log.info("evicted {} cause={}", key, cause);
```

## Editing strategy

Surgical, formatting-preserving text edits — no reformatting / re-serialization:
1. Replace each `com.google.common.cache.X` import with its Caffeine counterpart (C2); drop imports for types no longer referenced.
2. Replace `CacheBuilder.newBuilder()` → `Caffeine.newBuilder()` (C3).
3. Replace `getUnchecked(` → `get(`, and convert any `cache.get(key, Callable)` to a `Function` lambda.
4. Convert anonymous `CacheLoader` to a lambda where the `load` body is a single expression.
5. Swap the C1 pom dependency.

Anchor each replace on the smallest unique substring so unrelated identical text is not touched.

## Unlocatable / skip

- `import-not-found: com.google.common.cache.* not present in <file>` — the flagged import is no longer there (already migrated). Record `skipped`.
- `guava-still-required: non-cache com.google.common.* usage in <file>` — only remove the cache imports; keep the Guava dependency. Record as a partial apply note, not a skip.

## Review checklist

- [ ] No `import com.google.common.cache.*` remains in changed files.
- [ ] No `CacheBuilder.newBuilder()` remains; all builders use `Caffeine.newBuilder()`.
- [ ] No `LoadingCache.getUnchecked(...)` remains; replaced with `.get(...)`.
- [ ] No `cache.get(key, Callable)` remains; the `Callable` is a `Function` (lambda).
- [ ] `RemovalListener` callbacks use the `(key, value, cause)` signature, not `RemovalNotification`.
- [ ] `Caffeine` is on the bundle's `pom.xml` with `<scope>provided</scope>`, version pinned to the AEM CS SDK BOM.
- [ ] `mvn clean install` passes.
- [ ] Guava dependency kept only if non-cache `com.google.common.*` usage remains.

## Common pitfalls

- **Embedding Caffeine** — use `<scope>provided</scope>`; Caffeine is supplied by the CS runtime, never embed it in the bundle.
- **Removing Guava too eagerly** — if other code still imports `com.google.common.collect/base`, keep the dependency and add Caffeine alongside.
- **`getUnchecked` left in place** — Caffeine has no `getUnchecked`; `LoadingCache.get(key)` already throws unchecked.
- **`Callable` vs `Function`** — `cache.get(key, …)` takes a `Function<K,V>` in Caffeine, not a `Callable<V>`.

## Test generation

After the swap, generate a JUnit test that confirms cache behaviour is preserved — `getIfPresent` returns `null` for unknown keys, `cache.get(key, Function)` computes and caches, `invalidate(key)` removes the entry, and `LoadingCache.get(key)` does not throw checked exceptions. One test class per production class changed, suffix `Test`, under `src/test/java/…`.

```java
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Before;
import org.junit.Test;

public class UserCacheTest {

    private UserCache service;

    @Before
    public void setUp() {
        service = new UserCache();
        service.activate(java.util.Collections.emptyMap());
    }

    @Test
    public void shouldReturnNullForUnknownKey() {
        assertNull(service.getIfPresent("u-unknown"));
    }

    @Test
    public void shouldComputeAndCache() {
        Object first = service.get("u-42");
        assertNotNull(first);
        assertEquals(first, service.get("u-42"));
    }

    @Test
    public void shouldInvalidateEntry() {
        service.get("u-42");
        service.invalidate("u-42");
        assertNull(service.getIfPresent("u-42"));
    }
}
```

## See also

- Caffeine wiki: <https://github.com/ben-manes/caffeine/wiki> — behaviour differences (async loading, weight-based eviction) beyond this near-1:1 swap.
