# Build Fix Constraints

Rules the agent MUST follow when fixing build errors during migration.

## Unsupported Packages — HARD STOP

Before attempting ANY fix, check if errors reference these packages:

- `com.adobe.cq.commerce.*`
- `com.adobe.cq.social.*`
- `com.adobe.granite.social.*`
- `com.adobe.cq.screens.*`
- `com.adobe.cq.sample.we.retail.*`
- `com.day.cq.dam.pim.*`
- `com.day.cq.dam.rating.*`
- `com.adobe.cq.searchpromote.*`

**If ANY error requires these packages: STOP the entire migration immediately.**
Report: "Project uses unsupported AEM packages (Commerce/Social/Screens). Migration cannot proceed."

Do NOT:
- Add these packages to `pom.xml`
- Try to find alternatives for these packages
- Attempt any workaround

## javax vs jakarta — NEVER Migrate

AEM 6.5 LTS uses the **javax** namespace. The AEM uber-jar ships `javax.*` APIs.

**NEVER replace `javax.*` with `jakarta.*`** — this will break the build. This applies to:
- Java imports (`import javax.xml.bind.*` must NOT become `import jakarta.xml.bind.*`)
- Maven dependencies in `pom.xml` (`<groupId>javax.xml.bind</groupId>` must NOT become `<groupId>jakarta.xml.bind</groupId>`)
- Affected packages include but are not limited to: `javax.xml.bind`, `javax.annotation`, `javax.inject`, `javax.servlet`, `javax.ws.rs`, `javax.persistence`, `javax.mail`, `javax.activation`.

If you see `javax` import errors, fix them by adding the correct `javax.*` dependency to `pom.xml`, NOT by changing the import or dependency to `jakarta.*`. If a previous OpenRewrite step swapped a dependency to jakarta, revert it back to the javax equivalent.

## Maven Enforcer — `requireJavaVersion` Must Only Increase

If the build fails on `org.apache.maven.plugins:maven-enforcer-plugin` with a `requireJavaVersion` rule:

- The fix is to **raise** the floor, never lower it. Allowed transitions: `1.8 → 11 → 21`.
- **NEVER** change `<version>11</version>` to `<version>1.8</version>`. Likewise never go `21 → 11`.
- If the project enforces `11` and you are migrating to JDK 21, leave it at `11` (or raise it to `21`) — both are satisfied by JDK 21 at runtime.
- Also update the `<message>` text consistently with the new floor (do not leave a "Java 8" message attached to a `version=11` rule).

## AEM 6.5 LTS — Removed / Non-Exported Bundles

The following packages are NOT exported by the AEM 6.5 LTS runtime. Adding them as
`scope=provided` (or expecting them to come from uber-jar) will cause OSGi resolution
failure at deploy time:

```
osgi.wiring.package; (...) Cannot be resolved
```

| Package | Status on AEM 6.5 LTS |
|---|---|
| `com.google.common.*` (Guava) | Bundle removed ([Adobe deprecation list](https://experienceleague.adobe.com/en/docs/experience-manager-65/content/release-notes/deprecated-removed-features)) |
| `com.github.benmanes.caffeine.*` | Not deployed |
| `org.eclipse.jetty.*` | Not exported (Jetty is private inside `org.apache.felix.http.jetty`) |

**How to fix when you see resolution errors on these packages:**

1. **Light usage (1–2 call sites)** → refactor the code to remove the dependency:
   - `com.google.common.cache` → `java.util.concurrent.ConcurrentHashMap` or `Caffeine` (embedded, see #2)
   - `com.google.common.collect` → JDK collections / `List.of()` / `Map.of()`
   - `com.google.common.base.Preconditions` → `java.util.Objects.requireNonNull` / explicit `if`
   - `org.eclipse.jetty.util.*` → JDK or Sling/Felix abstractions

2. **Heavy usage** → embed the library inside the consuming bundle so no Import-Package is generated:
   - Add the dep with `<scope>compile</scope>` (NOT `provided`)
   - In the module's `maven-bundle-plugin` (or `bnd-maven-plugin`) `<configuration>` add:
     ```xml
     <Embed-Dependency>caffeine;inline=true</Embed-Dependency>
     <Embed-Transitive>true</Embed-Transitive>
     <Import-Package>!com.github.benmanes.caffeine.*,*</Import-Package>
     ```
   - Same pattern for jetty: `<Embed-Dependency>org.apache.felix.http.jetty;inline=true</Embed-Dependency>` + `!org.eclipse.jetty.*` in `<Import-Package>`.

**Known-good replacement versions for AEM 6.5 LTS** (use these when embedding):
- Caffeine: `com.github.ben-manes.caffeine:caffeine:2.9.3`
- Jetty: `org.apache.felix:org.apache.felix.http.jetty:5.1.26`

Do NOT pick newer majors (Caffeine 3.x, Jetty 12.x) — they require Java/JDK features or APIs incompatible with AEM 6.5 LTS.

## POM Indentation — Preserve Exact Whitespace

When editing `pom.xml`, count the leading whitespace (spaces/tabs) of the line you are
replacing and use the EXACT same indent for the replacement. Do NOT use default 2-space
indentation.

Example: if `<source>1.8</source>` is indented 20 spaces inside a 16-space
`<configuration>` block, the replacement `<release>21</release>` MUST also be
indented 20 spaces — NOT 10, NOT 12.

This applies to every pom.xml change: `<release>`, `<version>`, `<requireJavaVersion>`,
`<classifier>`, dependency blocks, plugin blocks. Inconsistent indentation makes the
diff unreviewable.

## JDK Selection Rule

If the build command uses a `JAVA_HOME` below the floor required by `<requireJavaVersion>`
in any `pom.xml` in the reactor (root or submodule):

1. Pick the **lowest JDK** that satisfies the floor (e.g., floor=11 → JDK 11, floor=21 → JDK 21)
2. Re-run the build with the matching JDK:
   ```bash
   env JAVA_HOME=<chosen> PATH=<chosen>/bin:$PATH mvn ...
   ```
3. Do NOT lower the enforcer rule
4. Do NOT change `<source>`, `<release>`, or `<requireJavaVersion>` in any pom.xml
5. This is a **runtime-only override** — do not commit JAVA_HOME changes to any file

## Temporary Workaround Pattern

If you need to make changes ONLY to pass an intermediate build (like adding Maven Central
fallback for missing dependencies during initial build), mark them with:

```xml
<!-- TEMP_WORKAROUND_START -->
[your temporary changes]
<!-- TEMP_WORKAROUND_END -->
```

These markers are cleaned up before the final diff. Use for:
- Adding Maven Central fallback in `settings.xml`
- Commenting out temporarily unresolvable dependencies
- Any other temporary fix needed only for intermediate builds

## What You CAN Fix

- Compilation errors caused by Java API changes (8/11 → 21)
- Missing imports due to removed/relocated Java APIs
- Deprecated API usage that no longer compiles
- Missing dependencies that need to be added to `pom.xml`
- Type inference issues from stricter Java 21 compiler

## What You CANNOT Modify

- README files
- `.gitignore`, `Dockerfile`, `docker-compose.yml`
- Configuration files (`settings.xml`, `toolchains.xml`)
- Build scripts (`build.sh`, deploy scripts)
- Test data files
- Business logic in working code
- AEM component structure
- Spring/OSGi configurations (unless directly blocking compilation)

## Change Attribution

Add this comment above EVERY code change you make:

```java
// Fixed by Migration AI
```

For XML/POM changes:

```xml
<!-- Fixed by Migration AI -->
```

This distinguishes agent fixes from OpenRewrite changes in the final diff.

## Initial Build — Extra Rules

When fixing the initial build (source Java, before any migration):

1. **Missing customer-specific dependencies** (private groupId, internal library):
   STOP. Report: "Missing customer-specific dependencies that require manual intervention."

2. **Public library auth failures** (401/403 but library exists on Maven Central):
   STOP. Report: "Dependency auth failure — customer's Maven settings need to be fixed manually."

3. **Infrastructure issues** (connection refused, network errors without specific artifact):
   STOP. Report: "Infrastructure/network issue — cannot fix automatically."

## Build Fix Iteration Pattern

1. Run the build command
2. If exit code = 0 → SUCCESS, move on
3. If exit code != 0 → read the error output
4. Check for unsupported packages → if found, STOP
5. Identify the first failing module (fix root cause first)
6. Apply minimal fixes to resolve compilation errors
7. Re-run the build
8. Repeat up to 3 times total
9. If still failing after 3 attempts → report failure and stop
