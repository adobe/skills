# Removed Bundle Remediation Guide

This document provides concrete, step-by-step remediation for every library that is
no longer available on the AEM 6.5 LTS runtime classpath. For each library, two
strategies are offered: (a) refactor to a JDK or alternative API (preferred when
usage is light), and (b) embed the library as a private OSGi package (required when
the effort of refactoring is disproportionate to the risk).

---

## Google Guava (`com.google.common.*`)

Guava is [no longer exported from the AEM 6.5 LTS runtime](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations). See also [deprecated and removed features](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/release-notes/deprecated-removed-features) for the full scope of removals.

### Assessment: Light vs. Heavy Usage

Count usages before choosing a strategy:

```bash
grep -r "com.google.common" src/main/java --include="*.java" | wc -l
```

- **Fewer than 20 usages across the module:** refactor to JDK equivalents.
- **20 or more usages, or usage of `LoadingCache` / `ListenableFuture`:** embed Guava
  as a private OSGi package.

### Strategy A — Refactor to JDK Equivalents

The following table maps every commonly used Guava class or method to its JDK
replacement. All JDK equivalents listed are available in [Java 11+](https://docs.oracle.com/en/java/javase/21/docs/api/).

| Guava | JDK Equivalent | Notes |
|-------|---------------|-------|
| `ImmutableList.of(...)` | `List.of(...)` | Null-hostile (throws NPE), unmodifiable |
| `ImmutableList.copyOf(collection)` | `List.copyOf(collection)` | Same null-hostile semantics |
| `ImmutableMap.of(k,v,...)` | `Map.of(k,v,...)` | Max 10 entries; use `Map.ofEntries()` beyond that |
| `ImmutableMap.copyOf(map)` | `Map.copyOf(map)` | |
| `ImmutableSet.of(...)` | `Set.of(...)` | |
| `ImmutableSet.copyOf(collection)` | `Set.copyOf(collection)` | |
| `ImmutableSortedMap` | `Collections.unmodifiableSortedMap(new TreeMap<>(...))` | No direct replacement |
| `com.google.common.base.Optional` | `java.util.Optional` | API nearly identical |
| `Optional.fromNullable(x)` | `Optional.ofNullable(x)` | |
| `Optional.absent()` | `Optional.empty()` | |
| `optional.or(default)` | `optional.orElse(default)` | |
| `Preconditions.checkNotNull(x)` | `Objects.requireNonNull(x)` | |
| `Preconditions.checkNotNull(x, msg)` | `Objects.requireNonNull(x, msg)` | |
| `Preconditions.checkArgument(cond, msg)` | `if (!cond) throw new IllegalArgumentException(msg)` | No single-call replacement |
| `Preconditions.checkState(cond, msg)` | `if (!cond) throw new IllegalStateException(msg)` | |
| `Strings.isNullOrEmpty(s)` | `s == null \|\| s.isEmpty()` | |
| `Strings.nullToEmpty(s)` | `s == null ? "" : s` | |
| `Strings.emptyToNull(s)` | `(s == null \|\| s.isEmpty()) ? null : s` | |
| `Joiner.on(sep).join(list)` | `String.join(sep, list)` | |
| `Joiner.on(sep).join(a, b, c)` | `String.join(sep, a, b, c)` | |
| `Joiner.on(sep).skipNulls().join(...)` | `stream.filter(Objects::nonNull).collect(Collectors.joining(sep))` | |
| `Splitter.on(sep).split(s)` | `Arrays.stream(s.split(sep))` | Returns `Stream<String>` |
| `Splitter.on(sep).trimResults().split(s)` | `Arrays.stream(s.split(sep)).map(String::trim)` | |
| `Files.toString(file, charset)` | `Files.readString(file.toPath(), charset)` | Java 11+ |
| `Files.toByteArray(file)` | `Files.readAllBytes(file.toPath())` | |
| `Files.write(bytes, file)` | `Files.write(file.toPath(), bytes)` | |
| `CharStreams.toString(reader)` | `reader.lines().collect(Collectors.joining("\n"))` | Or use `BufferedReader.readLine()` loop |
| `ByteStreams.toByteArray(stream)` | `stream.readAllBytes()` | Java 11+ |
| `ByteStreams.copy(in, out)` | `in.transferTo(out)` | Java 9+ |
| `Lists.newArrayList()` | `new ArrayList<>()` | |
| `Lists.newArrayList(elements...)` | `new ArrayList<>(Arrays.asList(elements...))` | |
| `Lists.newArrayList(iterable)` | `StreamSupport.stream(iterable.spliterator(), false).collect(Collectors.toList())` | |
| `Lists.partition(list, size)` | No direct JDK equivalent — keep Guava or implement manually | |
| `Maps.newHashMap()` | `new HashMap<>()` | |
| `Maps.newLinkedHashMap()` | `new LinkedHashMap<>()` | |
| `Maps.newConcurrentMap()` | `new ConcurrentHashMap<>()` | |
| `Maps.transformValues(map, fn)` | `map.entrySet().stream().collect(Collectors.toMap(Map.Entry::getKey, e -> fn.apply(e.getValue())))` | |
| `Sets.newHashSet()` | `new HashSet<>()` | |
| `Sets.union(a, b)` | `Stream.concat(a.stream(), b.stream()).collect(Collectors.toSet())` | |
| `Sets.intersection(a, b)` | `a.stream().filter(b::contains).collect(Collectors.toSet())` | |
| `Sets.difference(a, b)` | `a.stream().filter(e -> !b.contains(e)).collect(Collectors.toSet())` | |
| `FluentIterable.from(col)` | `col.stream()` | |
| `FluentIterable.from(col).filter(pred)` | `col.stream().filter(pred)` | |
| `FluentIterable.from(col).transform(fn)` | `col.stream().map(fn)` | |
| `FluentIterable.from(col).toList()` | `col.stream().collect(Collectors.toList())` | |
| `Iterables.transform(col, fn)` | `col.stream().map(fn).collect(Collectors.toList())` | |
| `Iterables.filter(col, pred)` | `col.stream().filter(pred).collect(Collectors.toList())` | |
| `Iterables.getFirst(col, default)` | `col.stream().findFirst().orElse(default)` | |
| `Iterables.isEmpty(col)` | `!col.iterator().hasNext()` or `col instanceof Collection c && c.isEmpty()` | |
| `Collections2.transform(col, fn)` | `col.stream().map(fn).collect(Collectors.toList())` | |
| `Collections2.filter(col, pred)` | `col.stream().filter(pred).collect(Collectors.toList())` | |

#### Caching: `CacheBuilder` / `LoadingCache` Replacement

For simple time-based eviction caches, replace with a `ConcurrentHashMap` plus
scheduled cleanup:

```java
// Before (Guava)
private final LoadingCache<String, MyObject> cache = CacheBuilder.newBuilder()
    .expireAfterWrite(10, TimeUnit.MINUTES)
    .maximumSize(1000)
    .build(CacheLoader.from(key -> loadValue(key)));

// After (JDK — suitable for moderate-traffic caches without strict eviction)
private final ConcurrentHashMap<String, MyObject> cache = new ConcurrentHashMap<>();

public MyObject get(String key) {
    return cache.computeIfAbsent(key, this::loadValue); // aem-lts-migration: ai-fix
}
```

For production caches that require LRU eviction, TTL, or statistics, see
Strategy B (embed Caffeine).

### Strategy B — Embed as Private OSGi Package

When Guava usage is pervasive (20+ usages) or uses `LoadingCache`, `ListenableFuture`,
or other features without clean JDK replacements, embed Guava inside the OSGi bundle
as a private (non-exported) package.

**Step 1** — Add Guava as a `compile`-scoped Maven dependency (it is already a
transitive dependency in most AEM projects; make it explicit):

```xml
<dependency>
  <groupId>com.google.guava</groupId>
  <artifactId>guava</artifactId>
  <version>32.1.3-jre</version>
  <scope>compile</scope>
</dependency>
```

**Step 2** — Configure `maven-bundle-plugin` to embed and privatise the package:

```xml
<plugin>
  <groupId>org.apache.felix</groupId>
  <artifactId>maven-bundle-plugin</artifactId>
  <version>5.1.9</version>
  <extensions>true</extensions>
  <configuration>
    <instructions>
      <Embed-Dependency>guava;scope=compile</Embed-Dependency>
      <Embed-Transitive>false</Embed-Transitive>
      <Private-Package>com.google.common.*</Private-Package>
      <!-- Ensure these do not appear in Import-Package -->
      <Import-Package>!com.google.common.*,*</Import-Package>
    </instructions>
  </configuration>
</plugin>
```

**Step 3** — Verify that `Import-Package` in the generated MANIFEST.MF does not
include `com.google.common.*`:

```bash
mvn package -pl <module>
unzip -p target/<bundle>.jar META-INF/MANIFEST.MF | grep "Import-Package" | grep -v "com.google.common"
```

**Isolation note:** Because Guava is embedded as a private package, it is classloader-
isolated to this bundle. Other bundles cannot share the same instance. This is
intentional and correct — it prevents version conflicts.

---

## Apache Commons Collections 3 → 4

See the [Apache Commons Collections 4 migration guide](https://commons.apache.org/proper/commons-collections/upgradeto4_0.html) for detailed upgrade instructions.

### Package Rename

The top-level package changes from `org.apache.commons.collections` (v3) to
`org.apache.commons.collections4` (v4).

```java
// Before (v3)
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.collections.MapUtils;
import org.apache.commons.collections.Transformer;
import org.apache.commons.collections.Predicate;

// After (v4)
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.collections4.MapUtils;
import org.apache.commons.collections4.Transformer;
import org.apache.commons.collections4.Predicate;
```

### Maven Dependency

```xml
<!-- Remove v3 -->
<!-- <dependency>
  <groupId>commons-collections</groupId>
  <artifactId>commons-collections</artifactId>
  <version>3.2.2</version>
</dependency> -->

<!-- Add v4 -->
<dependency>
  <groupId>org.apache.commons</groupId>
  <artifactId>commons-collections4</artifactId>
  <version>4.4</version>
  <scope>provided</scope>  <!-- provided: AEM 6.5 LTS exports this package -->
</dependency>
```

### Generics Enforcement

Collections4 enforces proper generic type parameters. Raw-type usages will produce
compiler warnings or errors under `-Xlint:unchecked`:

```java
// Before (v3 — raw type accepted)
List result = CollectionUtils.select(inputList, predicate);

// After (v4 — generics required)
List<String> result = (List<String>) CollectionUtils.select(inputList, predicate);
// Or preferably:
Collection<String> result = CollectionUtils.select(inputList, (Predicate<String>) predicate);
```

---

## Caffeine Cache Library

[Caffeine is not deployed to the AEM 6.5 LTS OSGi runtime.](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations)

### Strategy A — Replace with JDK ConcurrentHashMap (Simple Caches)

```java
// Before (Caffeine)
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;

private Cache<String, Resource> resourceCache = Caffeine.newBuilder()
    .maximumSize(500)
    .expireAfterWrite(5, TimeUnit.MINUTES)
    .build();

// After (ConcurrentHashMap — no TTL, bounded by maximumSize approximation)
private final ConcurrentHashMap<String, Resource> resourceCache = new ConcurrentHashMap<>(); // aem-lts-migration: ai-fix

public Resource getResource(String key) {
    return resourceCache.computeIfAbsent(key, this::loadResource); // aem-lts-migration: ai-fix
}
```

Note: `ConcurrentHashMap.computeIfAbsent()` has no built-in eviction. For caches
where stale entries are a concern, implement a periodic cleanup via a
`ScheduledExecutorService`, or use Strategy B.

### Strategy B — Embed Caffeine as Private OSGi Package

```xml
<dependency>
  <groupId>com.github.ben-manes.caffeine</groupId>
  <artifactId>caffeine</artifactId>
  <version>3.1.8</version>
  <scope>compile</scope>
</dependency>
```

```xml
<plugin>
  <groupId>org.apache.felix</groupId>
  <artifactId>maven-bundle-plugin</artifactId>
  <version>5.1.9</version>
  <configuration>
    <instructions>
      <Embed-Dependency>caffeine;scope=compile</Embed-Dependency>
      <Private-Package>com.github.benmanes.caffeine.*</Private-Package>
      <Import-Package>!com.github.benmanes.caffeine.*,*</Import-Package>
    </instructions>
  </configuration>
</plugin>
```

---

## Jetty (`org.eclipse.jetty.*`)

[Direct Jetty API usage in application code is unsupported.](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations) The Jetty packages are not
exported from the OSGi system bundle to application classloaders.

### Inbound Request Handling

Replace Jetty-specific request/response types with Sling or Servlet API types:

```java
// Before (incorrect — Jetty-specific)
import org.eclipse.jetty.server.Request;
import org.eclipse.jetty.server.Response;

// After (correct — Servlet API, available as javax.servlet.*)
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
```

For Sling servlets, extend `SlingSafeMethodsServlet` or `SlingAllMethodsServlet` and
use `SlingHttpServletRequest` / `SlingHttpServletResponse`.

### HTTP Client Usage

If the codebase uses Jetty's `HttpClient` for outbound requests:

```java
// Before (Jetty HttpClient — not available)
import org.eclipse.jetty.client.HttpClient;

// After (Apache HttpComponents — available via AEM platform)
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
```

Or use the OSGi `HttpClientBuilderFactory` service provided by the Sling
HTTP client bundle for a container-managed client instance.

### WebSocket Usage

If Jetty WebSocket APIs are used (`org.eclipse.jetty.websocket.*`), this is not
supported in AEM application bundles and must be removed. The AEM Dispatcher or an
external reverse proxy should handle WebSocket upgrade for client-facing use cases.

---

## References

- [Upgrading code and customizations](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations)
- [Java deprecated and removed features](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/release-notes/deprecated-removed-features)
- [Java 21 API documentation](https://docs.oracle.com/en/java/javase/21/docs/api/)
- [Apache Commons Collections 4 migration guide](https://commons.apache.org/proper/commons-collections/upgradeto4_0.html)
- [AEM 6.5 LTS FAQ](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/faq)
