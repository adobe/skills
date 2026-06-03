# AEM 6.5 LTS Platform Changes Reference

This document describes the platform-level changes introduced in AEM 6.5 LTS that
directly affect code compilation, OSGi bundle resolution, and runtime behaviour. Use
this as the definitive reference when diagnosing why code that compiled on a previous
AEM 6.5 service pack fails to compile or run after migrating to the LTS baseline.

---

## Runtime Changes

### Java 21 as Minimum Supported JDK

[AEM 6.5 LTS mandates Java 21](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/service-pack/ga) as the minimum runtime JDK. The previous long-running
releases supported Java 8 and Java 11; those JDKs are no longer tested or supported.

Key implications for application code:

- Maven compiler `source` and `target` (or `release`) must be set to `21`.
- `requireJavaVersion` in `maven-enforcer-plugin` must specify `[21,)`.
- Java language features available: records, sealed classes, pattern matching for
  `instanceof`, text blocks, switch expressions (all finalised).
- Internal JDK APIs previously accessible via `--add-opens` in Java 9–17 are now
  strongly encapsulated. Reflective access without explicit `--add-opens` flags
  throws `InaccessibleObjectException` at runtime.
- The reserved keyword set has expanded: `record`, `sealed`, `permits`, `yield` are
  context-sensitive keywords in Java 17+ and become reserved identifiers in Java 21.
  Variable or method names using these words must be renamed.

### Sling Framework Upgrade

AEM 6.5 LTS ships with updated Sling API and Sling Models bundles. The core Sling API
version advances to align with current Apache Sling releases:

- `org.apache.sling.api` — updated. `SlingHttpServletRequest.adaptTo()` generic
  signatures tightened; callers with raw types may see unchecked cast warnings promoted
  to errors under `-Werror`.
- Sling Models — injector resolution order adjusted. `@OSGiService` takes precedence
  over `@Inject` when both annotations target the same field type; code that relied on
  the previous resolution order may inject an unexpected value.
- `ResourceResolverFactory` API — `getServiceResourceResolver()` now requires an
  explicit sub-service name in the authentication info map. Callers passing `null` will
  receive a `LoginException` rather than an administrative session.
- Sling Scripting (HTL / Sightly) engine updated. The Use-API adapter cache is
  invalidated on bundle restart, which may surface lazy-initialisation bugs previously
  hidden by cached adapters.

### OSGi R8 Framework (Apache Felix 7.x)

AEM 6.5 LTS moves to an OSGi R8-compliant framework based on Apache Felix 7.x. Notable
changes affecting application bundles:

- **Component property types** (OSGi R7+) are now the preferred configuration API.
  Annotation-based component property interfaces replace the legacy
  `PropertiesUtil.toStringArray()` / `PropertiesUtil.toLong()` pattern.
- **Declarative Services 1.4** features are active: `@Activate` / `@Modified` methods
  may accept a `ComponentContext`, `BundleContext`, `Map<String, Object>`, or a
  component property type directly.
- **Bundle symbolic names** must be globally unique. Duplicate symbolic names that
  previously resolved by load order now cause one bundle to remain unresolved.
- **`ServiceObjects`** API is available for prototype-scope services. Bundles that
  previously obtained a new service instance on each `getService()` call (relying on
  undocumented behaviour) must be updated to use `ServiceObjects.getService()`.

### Oak 1.68+ with Segment-Tar Improvements

The underlying JCR repository is built on Apache Jackrabbit Oak 1.68+.

- **Index definition validation** is stricter. `oak:index` nodes with malformed or
  unsupported properties that were silently ignored in earlier versions now log
  `WARNING` or fail to activate.
- **Segment store format** version updated. Repositories created on earlier Oak versions
  are migrated on first startup; this migration is one-way and cannot be rolled back.
- **Query engine**: `QueryBuilder.createQuery()` with deprecated `XPATH` queries logs
  deprecation warnings. The `JCR-SQL2` dialect is the supported path.
- **EventListener registration**: synchronous observation listeners block the commit
  thread more aggressively under heavy write load. Listeners that perform repository
  writes should be converted to asynchronous listeners.

### Jackrabbit 2.22+

The Jackrabbit compatibility layer (used for legacy JCR 2.0 API calls) is updated to
2.22+. Binary-compatible with 2.20 for most API surfaces. Note:
`JackrabbitSession.impersonate()` requires an explicit privilege grant in the
repository access control list; silent impersonation through configuration is removed.

---

## Removed Bundles

### Google Guava

Guava was previously exported from an AEM internal system bundle, making classes such
as `ImmutableList`, `CacheBuilder`, `Joiner`, and `Preconditions` available to all
application bundles without a compile-time dependency.

**In AEM 6.5 LTS, [Guava is no longer exported](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations).** The bundle may still be present in
the OSGi container for internal Adobe use, but it is not exported to the application
classloader. Any `Import-Package: com.google.common.*` in an application bundle will
fail to resolve.

Affected API areas:

| Area | Guava Classes |
|------|--------------|
| Immutable collections | `ImmutableList`, `ImmutableMap`, `ImmutableSet`, `ImmutableSortedMap` |
| Caching | `CacheBuilder`, `LoadingCache`, `CacheLoader`, `CacheStats` |
| String utilities | `Joiner`, `Splitter`, `Strings`, `CharMatcher` |
| I/O utilities | `Files` (Guava), `ByteStreams`, `CharStreams` |
| Functional | `Function`, `Predicate`, `FluentIterable`, `Optional` (Guava) |
| Preconditions | `Preconditions`, `Verify` |
| Concurrency | `ListenableFuture`, `Futures`, `MoreExecutors` |

See `removed-bundles-remediation.md` for a complete mapping to JDK and alternative
implementations.

### Apache Commons Collections 3

`org.apache.commons.collections` (version 3.x) is no longer on the runtime classpath.
This library contained known serialisation vulnerabilities (CVE-2015-7501 and
subsequent) and was removed from the AEM runtime.

The replacement is **Apache Commons Collections 4** (`org.apache.commons.collections4`).
The top-level package name changes; most class names are preserved. Generics are
enforced in version 4, so raw-type usages must be parameterised.

### Caffeine Cache Library

`com.github.benmanes.caffeine` is not deployed to the AEM 6.5 LTS OSGi runtime. Code
that uses `Caffeine.newBuilder()` or `LoadingCache` from Caffeine (as opposed to Guava)
will fail at runtime with `ClassNotFoundException`.

Remediation: embed Caffeine as a private OSGi package within the application bundle, or
replace simple caches with `ConcurrentHashMap.computeIfAbsent()`.

---

## Namespace: javax Stays in AEM 6.5 LTS

[AEM 6.5 LTS does **not** adopt the Jakarta EE namespace](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/faq). Every javax package that was
present in previous AEM 6.5 service packs remains under the `javax.*` namespace:

| Package | Status |
|---------|--------|
| `javax.servlet.*` | Unchanged — use this |
| `javax.servlet.http.*` | Unchanged — use this |
| `javax.annotation.PostConstruct` | Unchanged — use this |
| `javax.annotation.PreDestroy` | Unchanged — use this |
| `javax.inject.Inject` | Unchanged — use this |
| `javax.inject.Named` | Unchanged — use this |
| `jakarta.servlet.*` | NOT present in runtime |
| `jakarta.annotation.*` | NOT present in runtime |
| `jakarta.inject.*` | NOT present in runtime |

**Why this matters:** Jakarta EE artifacts are widely published on Maven Central and
compile without error. A developer who accepts an IDE suggestion to import
`jakarta.annotation.PostConstruct` instead of `javax.annotation.PostConstruct` will
produce a bundle that:

1. Compiles successfully.
2. Passes unit tests (most unit tests mock injection rather than exercising the OSGi
   container).
3. Deploys to AEM without error.
4. Silently fails at runtime — `@PostConstruct` methods are never called, `@Inject`
   fields remain null.

OpenRewrite's standard Jakarta migration recipe (`org.openrewrite.java.migrate.jakarta.*`)
MUST be excluded from the recipe list when running on AEM codebases.

---

## Build Plugin Compatibility

Plugins that parse or generate Java bytecode must support Java 21 class file format
(major version 65). Older plugin versions will fail with
`Unsupported class file major version 65` or produce incorrect Bundle-ClassPath entries.
See the [upgrading code and customizations guide](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations) for the full list of supported plugin versions.

### maven-bundle-plugin

Minimum version: **5.1.9**

Versions before 5.1.9 use an embedded bnd library that cannot parse Java 21 class
files. The symptom is `Unsupported class file major version 65` during the `package`
phase.

```xml
<plugin>
  <groupId>org.apache.felix</groupId>
  <artifactId>maven-bundle-plugin</artifactId>
  <version>5.1.9</version>
  <extensions>true</extensions>
</plugin>
```

### bnd-maven-plugin

Minimum version: **6.4.0** (bnd 6.4.0 supports Java 21 bytecode analysis).

### maven-scr-plugin

Minimum version: **1.26.4** with **ASM 9.7.1**.

The maven-scr-plugin uses the ASM bytecode library to parse `@SlingServlet` and related
annotations. ASM versions below 9.x cannot parse Java 21 class files. Version 1.26.4
ships with ASM 9.7.1.

Note: The maven-scr-plugin is considered legacy. New code should use OSGi DS
annotations (`@Component`, `@Service`) rather than Sling-specific SCR annotations.
If the project uses only DS annotations, this plugin can be removed from the build.

### maven-compiler-plugin

Minimum version: **3.11.0** for Java 21 support.

Use `<release>21</release>` rather than `<source>21</source>` + `<target>21</target>`.
The `release` parameter additionally sets the bootstrap classpath to the Java 21
platform API, preventing accidental use of JDK-internal classes:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <version>3.11.0</version>
  <configuration>
    <release>21</release>
  </configuration>
</plugin>
```

---

## Dependency Version Requirements

### AEM UberJar

The [AEM 6.5 LTS uber-jar](https://mvnrepository.com/artifact/com.adobe.aem/uber-jar) coordinate changes:

| Item | Previous (6.5.x SP) | AEM 6.5 LTS |
|------|--------------------|--------------------|
| Version | `6.5.x` (e.g. `6.5.21`) | `6.6.0` |
| Classifier | none or `uber-jar` | `apis` |
| Scope | `provided` | `provided` |

```xml
<dependency>
  <groupId>com.adobe.aem</groupId>
  <artifactId>uber-jar</artifactId>
  <version>6.6.0</version>
  <classifier>apis</classifier>
  <scope>provided</scope>
</dependency>
```

Using the old uber-jar without the `apis` classifier against AEM 6.5 LTS will result in
missing classes for newer Sling API methods added in the LTS release.

### AEM Core WCM Components

Minimum version: **2.24.0**. Recommended: **2.30.4** or later.

Versions before 2.24.0 were not tested against Java 21 and may produce compilation
warnings or fail OSGi resolution due to transitive Guava dependencies.

```xml
<dependency>
  <groupId>com.adobe.cq</groupId>
  <artifactId>core.wcm.components.core</artifactId>
  <version>2.30.4</version>
  <scope>provided</scope>
</dependency>
```

### AEM Groovy Console

The Groovy Console artifact has been transferred to a new Maven group:

| Item | Previous | Current |
|------|----------|---------|
| GroupId | `be.orbinson.aem` | `be.orbinson.aem` |
| ArtifactId | `aem-groovy-console-bundle` | `aem-groovy-console-bundle` |
| Version | `<19.0.0` | `19.0.8` |

Version 19.0.8 is compiled against Java 21 and OSGi R8. Earlier versions will not
resolve on AEM 6.5 LTS.

---

## Deprecated APIs

The following APIs are present in AEM 6.5 LTS for backwards compatibility but should
not be used in migrated code. They may be removed in a future LTS release.

### `org.apache.sling.commons.osgi.PropertiesUtil`

All `PropertiesUtil.to*()` methods are deprecated. Replace with OSGi R7 component
property types — define an `@interface` annotated with `@ObjectClassDefinition` and
inject it as the `@Activate` parameter.

```java
// Deprecated pattern
@Activate
protected void activate(Map<String, Object> config) {
    String value = PropertiesUtil.toString(config.get("myProp"), "default");
}

// Preferred pattern (OSGi R7 component property type)
@interface Config {
    String myProp() default "default";
}

@Activate
protected void activate(Config config) {
    String value = config.myProp();
}
```

### Foundation Components (`/libs/foundation/*`)

Foundation page components, form components, and parsys implementations under
`/libs/foundation/` are deprecated. Migrated projects should reference Core WCM
Components from `core.wcm.components.*`. Foundation components will not receive
bug fixes against AEM 6.5 LTS.

### Classic UI (ExtJS) Widgets

All Classic UI JavaScript widgets (`CQ.Ext.*`, `CQ.form.*`) are in maintenance-only
mode. They are not supported in the LTS release for new development. Touch UI (Coral UI
/ Granite UI) is the supported authoring interface.

### `JcrPropertyPredicateEvaluator` Direct Instantiation

Direct instantiation of `com.day.cq.search.eval.JcrPropertyPredicateEvaluator` is
deprecated. Use the `property` predicate string key through `QueryBuilder.createQuery()`
instead of referencing the evaluator class directly. This decouples code from the
internal evaluator implementation, which may be replaced in a future LTS release.

---

## References

- [AEM 6.5 LTS GA release notes](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/service-pack/ga)
- [AEM 6.5 LTS SP2 release notes](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/release-notes)
- [Upgrading code and customizations](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations)
- [AEM 6.5 LTS FAQ](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/faq)
- [AEM 6.5 LTS Analyzer Tool](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/aem-analyzer)
- [AEM UberJar on Maven Central](https://mvnrepository.com/artifact/com.adobe.aem/uber-jar)
