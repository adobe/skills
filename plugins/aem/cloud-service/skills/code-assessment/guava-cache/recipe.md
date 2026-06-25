# Recipe — Guava cache → Caffeine

> Read this fully before editing. Control plane: [SKILL.md](SKILL.md).

## Input contract

Per finding, regardless of how it was obtained:

| Field | Example | Source |
|---|---|---|
| `file` | `core/.../UserCache.java` | Repo-relative path to the flagged Java file |
| `line` | `7` | Line of the `com.google.common.cache.*` import |
| `snippet` | `import com.google.common.cache.CacheBuilder;` | The flagged import |

The fix parameters are **self-evident** — the Guava → Caffeine mapping below is fixed. The only choice is the Caffeine version: pin to the AEM CS SDK BOM (default `3.1.8`).

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

## Unlocatable / skip

- `import-not-found: com.google.common.cache.* not present in <file>` — the flagged import is no longer there (already migrated). Record `skipped`.
- `guava-still-required: non-cache com.google.common.* usage in <file>` — only remove the cache imports; keep the Guava dependency. Record as a partial apply note, not a skip.

## Editing strategy

Surgical, formatting-preserving text edits — no reformatting / re-serialization:
1. Replace each `com.google.common.cache.X` import with its Caffeine counterpart (C2); drop imports for types no longer referenced.
2. Replace `CacheBuilder.newBuilder()` → `Caffeine.newBuilder()` (C3).
3. Replace `getUnchecked(` → `get(`, and convert any `cache.get(key, Callable)` to a `Function` lambda.
4. Convert anonymous `CacheLoader` to a lambda where the `load` body is a single expression.
5. Swap the C1 pom dependency.

Anchor each replace on the smallest unique substring so unrelated identical text is not touched.

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

- [`../references/aem-cloud-service-pattern-prerequisites.md`](../references/aem-cloud-service-pattern-prerequisites.md) — SCR → DS, service-user resolvers, SLF4J.
- Caffeine wiki: <https://github.com/ben-manes/caffeine/wiki> — behaviour differences (async loading, weight-based eviction) beyond this near-1:1 swap.
