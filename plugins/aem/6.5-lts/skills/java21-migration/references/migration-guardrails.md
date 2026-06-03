# Migration Safety Guardrails

These rules govern AI agent behavior during AEM 6.5 LTS / Java 21 migration. They are
non-negotiable: the agent MUST enforce each rule unconditionally during every phase.

---

## Hard Stops — Migration Terminates

If any of the following conditions is detected the agent MUST stop, report the blocking
condition with full context, and wait for explicit human approval before proceeding. The
migration is NOT automatically resumable.

### 1. Unsupported Package Patterns

The following package namespaces indicate a dependency on an AEM add-on or deprecated
product line that is outside the scope of a base-platform migration. Migrating these
modules without the corresponding add-on artifacts available at build time will produce
a broken build that cannot be automatically repaired. See the [upgrading code and customizations guide](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations) for the full list of deprecated and removed features.

| Pattern | Product / Reason |
|---------|-----------------|
| `com.adobe.cq.commerce.*` | AEM Commerce (CIF) — requires separate Commerce add-on |
| `com.adobe.cq.social.*` | AEM Communities — deprecated, no LTS path |
| `com.adobe.granite.social.*` | Granite Social layer — deprecated alongside Communities |
| `com.adobe.cq.screens.*` | AEM Screens — separate release cadence, not included in LTS base |
| `com.day.cq.wcm.weretail.*` / `we.retail` | We.Retail reference site — not production code, should not be migrated |
| `com.adobe.cq.dam.pim.*` | DAM Product Information Management — removed in LTS |
| `com.adobe.cq.dam.rating.*` | DAM Rating service — removed in LTS |
| `com.adobe.searchpromote.*` | Search&Promote — product end-of-life, no replacement bundle |

**Why this is a hard stop:** These packages are absent from the AEM 6.5 LTS uber-jar
and from the OSGi runtime. Automated fixes (e.g., removing imports or stubbing classes)
would silently break business functionality. A human architect must decide whether to
remove the feature, obtain the add-on, or exclude the module from the migration.

### 2. Customer-Specific / Private Dependency Resolution Failures

If Maven cannot resolve a `groupId` that does not match any well-known public artifact
(e.g., `com.acme.*`, a corporate groupId, or any artifact requiring credentials to a
private Nexus/Artifactory), the agent must not attempt to guess versions, substitute
similar artifacts, or add repository entries pointing to unknown hosts.

**Why this is a hard stop:** Private artifact resolution requires credentials and
organisational knowledge the agent does not possess. Guessing version bumps can
introduce API incompatibilities or security vulnerabilities in proprietary libraries.

### 3. Network / Infrastructure Issues (HTTP 401 / 403 on Public Repositories)

If Maven dependency resolution returns HTTP 401 (Unauthorized) or HTTP 403 (Forbidden)
against a publicly known repository (Maven Central, Adobe public repo, repo.adobe.com),
the agent must stop rather than retry indefinitely.

**Why this is a hard stop:** A 401/403 against a public repo indicates a local
settings.xml mirror override, corporate proxy interception, or a repository that
requires authentication that has not been provided. Continuing will produce a
misleadingly partial migration. The environment must be fixed first.

---

## Forbidden Actions

The agent MUST NEVER perform any of the following actions under any circumstances,
regardless of whether it believes they would help:

### javax.* Namespace — Never Migrate to jakarta.*

```
FORBIDDEN: replacing javax.annotation.PostConstruct with jakarta.annotation.PostConstruct
FORBIDDEN: replacing javax.inject.Inject with jakarta.inject.Inject
FORBIDDEN: replacing javax.servlet.* with jakarta.servlet.*
```

[AEM 6.5 LTS runs on OSGi / Apache Felix with the **javax** namespace](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/faq). The runtime
classloader resolves `javax.annotation.PostConstruct`, `javax.inject.Inject`, and the
entire `javax.servlet.*` tree. Jakarta EE namespace classes (`jakarta.*`) are absent
from the OSGi framework and **will not trigger a compilation error** — the Jakarta
artifacts are available on Maven Central and will compile cleanly. However, at runtime
the OSGi SCR and Sling injection framework will silently skip methods and fields
annotated with jakarta types. Symptoms: `@PostConstruct` lifecycle callbacks never
fire; `@Inject` / `@OSGiService` fields remain null; HTTP servlets registered via
`jakarta.servlet.Servlet` are never activated.

This failure mode is particularly dangerous because:
- The build passes green.
- Unit tests (which usually mock injection) also pass.
- The defect surfaces only at runtime on an AEM instance.

### maven-enforcer-plugin requireJavaVersion — Never Lower the Floor

The `requireJavaVersion` rule in `maven-enforcer-plugin` must only move forward (per the [AEM 6.5 LTS GA release notes](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/service-pack/ga)):

```
Allowed:   1.8  →  11  →  21
Forbidden: 21   →  11  (downgrade)
Forbidden: 21   →  8   (downgrade)
Forbidden: removing the requireJavaVersion rule entirely
```

Lowering the floor permits compilation on an older JDK that may miss binary
incompatibilities with Java 21 class files, and defeats the purpose of the migration.

### Files the Agent Must Not Modify

The following file types and paths are out of scope. The agent must treat them as
read-only regardless of whether modifying them would fix a build error:

| Category | Examples |
|----------|----------|
| Documentation | `README.md`, `CHANGELOG.md`, `*.adoc`, `*.rst` |
| Repository metadata | `.gitignore`, `.gitattributes` |
| Container definitions | `Dockerfile`, `docker-compose.yml`, `*.dockerfile` |
| Build infrastructure scripts | `Makefile`, shell scripts in `scripts/`, `bin/`, CI pipeline YAML |
| Test data fixtures | `src/test/resources/**`, `*.json` fixture files, `*.xml` fixture files |
| Business logic (non-migration changes) | Any `.java` change not required to compile against Java 21 |
| AEM component dialog XML | `_cq_dialog/.content.xml`, `dialog/.content.xml` |
| AEM content XML | `jcr_root/**/.content.xml`, `*.page.xml` |

### New Dependencies — Never Add Without Approval

The agent must not add a `<dependency>` block that was not already present in any
`pom.xml` unless:
1. It is a direct replacement for a removed bundle listed in this document, AND
2. The replacement is specified in the migration recipes.

Even then, the agent records the addition in the migration report and does not silently
add transitive dependencies.

### OSGi Component Annotation Semantics — Never Change

The agent may update annotation class names (e.g., to correct an import path) or add
missing imports, but must not change annotation attribute values such as:
- `@Component(service = ...)` — the registered service interface
- `@Component(immediate = ...)` — startup timing
- `@Reference(cardinality = ...)` — service dependency cardinality
- `@Reference(policy = ...)` — static vs dynamic binding policy

---

## Required Practices

### POM Whitespace and Indentation Preservation

POM files are often under version control and reviewed by developers. Unnecessary
formatting changes produce noisy diffs that obscure the actual migration changes.

The agent MUST:
1. Parse POM files with a proper XML library (not regex) to identify the elements to
   change.
2. Apply changes using text-level replacement that preserves surrounding whitespace,
   indentation style (spaces vs tabs), and line endings.
3. Never pretty-print or reformat an entire POM.

### AI-Assisted Fix Attribution

Every line or block of code added or materially rewritten by the agent to resolve a
build error must be followed by an inline comment:

```java
// AI-assisted migration fix
```

This comment serves two purposes:
1. It marks code that should receive human review before production deployment.
2. It enables automated post-migration audits (`grep -r "AI-assisted migration fix"`)
   to find every AI-generated change.

The comment must be placed on the line immediately following the added code, or on
the same line if it is a one-liner, consistent with the file's commenting style.

### Temporary Workaround Markers

Workarounds that are required to unblock a later phase but must be removed before
the migration is finalised must be wrapped in markers:

```java
// MIGRATION_TEMP_START: <reason>
<temporary code>
// MIGRATION_TEMP_END
```

For XML/POM files:

```xml
<!-- MIGRATION_TEMP_START: <reason> -->
<temporary element/>
<!-- MIGRATION_TEMP_END -->
```

The final cleanup step in the migration workflow searches for these markers and
fails if any remain. This ensures no temporary workaround is inadvertently shipped.

### Build-Fix Retry Limit

For each migration phase, the agent is permitted a maximum of **3 consecutive
build-fix retry attempts**. If the build has not succeeded after 3 attempts:

1. Record the full Maven output of the final failed attempt.
2. Record every change made across all 3 attempts.
3. Escalate to human review.
4. Do not attempt a 4th fix.

This prevents infinite loops where the agent oscillates between two broken states.

### JDK Version Selection

The correct JDK must be used at each phase of the migration. Using the wrong JDK
produces misleading errors (e.g., Java 21 bytecode errors during an OpenRewrite run
that should target Java 11).

| Phase | JDK to Use | Reason |
|-------|-----------|--------|
| Initial baseline build | Detected source JDK (8 or 11) | Reproduce the original build environment |
| OpenRewrite Java migration recipes | JDK 11 | OpenRewrite 8.x can parse both Java 8 and Java 11 source; running under JDK 21 may trigger parser edge cases with legacy syntax |
| All builds after Java 21 source/target is set | JDK 21 | Verify actual target bytecode compatibility |
| Mockito / test framework migration | JDK 21 | Byte-buddy (used by Mockito 5.x) requires JDK 17+ to instrument Java 21 class files |

Always select the **lowest JDK version that satisfies the enforcer floor** for each
phase. Do not use JDK 21 where JDK 11 is sufficient, to keep build output
representative of the phase's requirements.

---

## Removed and Non-Exported Bundles in AEM 6.5 LTS

The following libraries are no longer available as exported OSGi packages in the
AEM 6.5 LTS runtime. Code that imports these packages will compile if the
corresponding Maven artifact is on the compile classpath, but will fail at runtime
with `ClassNotFoundException` or `NoClassDefFoundError`.

### Google Guava (`com.google.common.*`)

[Guava was previously exported by an AEM system bundle. In AEM 6.5 LTS it is no
longer exported from the container classloader.](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations)

**Options:**

**(a) Refactor to JDK equivalents** — preferred for light usage. See
`removed-bundles-remediation.md` for the full mapping table.

**(b) Embed as private OSGi package** — required for heavy usage where refactoring
is impractical. Add `Embed-Dependency` and `Private-Package` instructions to the
bundle plugin configuration. The Guava classes will be classloader-isolated to that
bundle and will not conflict with other bundles.

### Caffeine (`com.github.benmanes.caffeine.*`)

[Caffeine is not deployed to the AEM 6.5 LTS OSGi runtime.](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations) Code using
`Caffeine.newBuilder()` or any `com.github.benmanes.caffeine.*` class will fail at
runtime.

Same options as Guava: refactor to `ConcurrentHashMap.computeIfAbsent()` for
simple caching, or embed Caffeine as a private package for complex cache policies.

### Jetty (`org.eclipse.jetty.*`)

[Jetty is the embedded servlet container in AEM but its packages are not exported
from the system classloader into application bundles.](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations) Direct use of Jetty APIs
(e.g., `org.eclipse.jetty.server.*`, `org.eclipse.jetty.client.*`) is unsupported
in application code.

Replace with Servlet API abstractions (`javax.servlet.*`) for inbound request
handling, and use the OSGi `HttpService` or Sling `SlingHttpServletRequest` /
`SlingHttpServletResponse` wrappers.

### Apache Commons Collections 3 (`org.apache.commons.collections`)

Version 3.x of Commons Collections is no longer on the AEM runtime classpath.
Migrate all usages to Commons Collections 4 (`org.apache.commons.collections4`).

The top-level package name changes from `org.apache.commons.collections` to
`org.apache.commons.collections4`. Most class names are identical; the migration
is primarily an import update. Verify generics — Collections4 enforces proper
generic type parameters that Collections3 often omitted.

---

## References

- [AEM 6.5 LTS GA release notes](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/service-pack/ga)
- [AEM 6.5 LTS SP2 release notes](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/release-notes)
- [Upgrading code and customizations](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations)
- [AEM 6.5 LTS FAQ](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/faq)
- [AEM 6.5 LTS Analyzer Tool](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/aem-analyzer)
- [Java deprecated and removed features](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/release-notes/deprecated-removed-features)
