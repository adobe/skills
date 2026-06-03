# Post-Migration Verification Checklist

This checklist must be completed in full before a migrated codebase is considered
ready for deployment to any non-local environment. Work through sections in order —
each section depends on the previous one passing cleanly.

---

## Section 1: Automated Checks

Run the migration verification script against the repository root. All checks must
pass before proceeding to Section 2.

### POM Compiler Settings

- [ ] Every `pom.xml` that contains a `maven-compiler-plugin` configuration has
      `<release>21</release>` (or `<source>21</source>` + `<target>21</target>`).
      No module should still compile to an earlier release.

- [ ] No `pom.xml` contains `<source>8</source>`, `<source>1.8</source>`,
      `<source>11</source>`, or `<target>` values below 21.

- [ ] The `maven-enforcer-plugin` `requireJavaVersion` rule is set to `[21,)` in
      every module that declares it. No module lowers the floor.

### Namespace Integrity

- [ ] Zero occurrences of `import jakarta.annotation.` in `src/main/java`.
- [ ] Zero occurrences of `import jakarta.inject.` in `src/main/java`.
- [ ] Zero occurrences of `import jakarta.servlet.` in `src/main/java`.
- [ ] All `@PostConstruct` and `@PreDestroy` imports resolve to `javax.annotation`.
- [ ] All `@Inject` imports resolve to `javax.inject.Inject`.

  Verification command:
  ```bash
  grep -rn "import jakarta\." src/main/java --include="*.java"
  # Expected: no output
  ```

### Temporary Workaround Markers

- [ ] Zero `MIGRATION_TEMP_START` markers remain in any source file.
- [ ] Zero `MIGRATION_TEMP_END` markers remain in any source file.

  Verification command:
  ```bash
  grep -rn "MIGRATION_TEMP_START\|MIGRATION_TEMP_END" src/ pom.xml **/pom.xml
  # Expected: no output
  ```

### Cloud Manager Java Version File

- [ ] The file `.cloudmanager/java-version` exists at the repository root.
- [ ] Its content is exactly `21` (no trailing spaces, single newline).

  Verification command:
  ```bash
  cat .cloudmanager/java-version
  # Expected output: 21
  ```

### AEM UberJar

- [ ] The uber-jar `<version>` is `6.6.0` (or the version specified in the migration
      target config).
- [ ] The uber-jar `<classifier>` is `apis`.
- [ ] No module references the old uber-jar without the `apis` classifier.

  Verification command:
  ```bash
  grep -rn "uber-jar" pom.xml **/pom.xml | grep -v "apis"
  # Expected: no output (all uber-jar references include classifier=apis)
  ```

### Duplicate Dependencies

- [ ] Running `mvn dependency:analyze` produces no `WARN  Duplicate artifact` lines.
- [ ] No module declares both `commons-collections` (v3) and
      `commons-collections4` (v4) — only the v4 artifact should be present.

### Unsupported Package Imports

- [ ] Zero `import com.google.common.` in `src/main/java` unless the module embeds
      Guava as a private OSGi package (confirmed in plugin config).
- [ ] Zero `import org.eclipse.jetty.` in `src/main/java`.
- [ ] Zero `import org.apache.commons.collections.` (v3) — only
      `org.apache.commons.collections4.` is permitted.
- [ ] Zero `import com.github.benmanes.caffeine.` in `src/main/java` unless the module
      embeds Caffeine as a private OSGi package.

### Build Passes with JDK 21

- [ ] A clean build (`mvn clean install -DskipTests`) completes with `BUILD SUCCESS`
      when executed with JDK 21.
- [ ] No `[WARNING]` lines related to unchecked casts, deprecated APIs, or
      serialisation issues that were not present before migration (new warnings
      introduced by the migration must be resolved, not suppressed).

---

## Section 2: Manual Code Review

A human reviewer must inspect every file touched by the migration before this section
is marked complete.

### AI-Assisted Fix Annotations

- [ ] Every block of code added or materially rewritten by the automated migration
      carries an `// aem-lts-migration: ai-fix` comment.
- [ ] The annotated code is reviewed line-by-line for correctness. Automated fixes
      are not inherently correct; they must be verified by a developer with knowledge
      of the component's intended behaviour.
- [ ] The complete list of AI-assisted fixes is recorded in the migration report.

### Business Logic Integrity

- [ ] No `if`, `for`, `while`, `switch`, or `return` statement in production code was
      changed except where strictly required to compile against Java 21.
- [ ] No algorithm or data processing logic was rewritten or restructured during
      migration (only import changes, type parameter additions, and API substitutions
      are permitted).
- [ ] All public method signatures (name, parameter types, return type) are unchanged
      unless a removed API forced a signature change. Any signature change must be
      documented in the migration report.

### Test Assertion Integrity

- [ ] No `assertEquals`, `assertThat`, `assertTrue`, `verify`, or similar assertion
      was removed or weakened (e.g., replaced with `assertNotNull` where a specific
      value was previously asserted).
- [ ] No test was disabled (via `@Disabled`, `@Ignore`, or commenting out) to work
      around a migration issue.
- [ ] Tests that previously tested the behaviour of a removed API (e.g., Guava
      `LoadingCache`) now test the equivalent replacement behaviour.

### POM Formatting

- [ ] The diff of each `pom.xml` contains only the lines that were intentionally
      changed (dependency versions, plugin versions, compiler settings). No
      reformatting, indentation changes, or XML attribute reordering is present.
- [ ] This can be verified by reviewing the `git diff` for each `pom.xml` and
      confirming every changed line maps to a documented migration action.

---

## Section 3: Runtime Verification

These checks require access to a running AEM 6.5 LTS instance with the migrated
bundles deployed. They cannot be substituted with build-time checks.

### Bundle Resolution (Felix Console)

See [Apache Sling OSGi bundle documentation](https://sling.apache.org/documentation/) for Felix web console guidance.

- [ ] Navigate to `/system/console/bundles`.
- [ ] Every application bundle is in `Active` state.
- [ ] Zero bundles are in `Installed`, `Resolved` (without being `Active`), or
      `Failure` state.
- [ ] The bundle count in `Active` state matches the count from the pre-migration
      baseline (no bundles were accidentally dropped from the deployment).

### Sling Models Registration

See [Apache Sling Models documentation](https://sling.apache.org/documentation/bundles/models.html) for registration and injection details.

- [ ] Navigate to `/system/console/status-slingmodels`.
- [ ] Every Sling Model class present before migration is listed.
- [ ] No model shows a registration error or `Unresolvable` status.
- [ ] Models that use `@Inject` fields are spot-checked: inject a known resource or
      OSGi service and confirm the field is non-null at runtime.

### OSGi Service Activation

- [ ] Navigate to `/system/console/components`.
- [ ] Every `@Component`-annotated class is in `Active` state.
- [ ] Zero components are in `Unsatisfied` or `Failure` state.
- [ ] For components with `@Reference` fields, confirm each reference shows as
      `satisfied` in the component detail view.

### Lifecycle Callback Verification

- [ ] Add a log statement at `INFO` level to at least one `@PostConstruct` method in
      each migrated bundle (or confirm existing log statements are present).
- [ ] Deploy the bundle and verify the log message appears in `error.log` or
      `stdout` within 30 seconds of bundle activation.
- [ ] Remove test log statements before promotion to higher environments.

**Why this check is critical:** Jakarta annotation imports compile and deploy without
error but produce no log output. This check is the only reliable way to confirm
`@PostConstruct` is actually executing.

### ClassNotFoundException / NoClassDefFoundError

- [ ] Monitor `error.log` for 5 minutes after bundle deployment. Zero
      `ClassNotFoundException` or `NoClassDefFoundError` entries are acceptable.
- [ ] If errors appear, identify the offending class and check whether its containing
      package is in the removed-bundle list (`migration-guardrails.md`).

### Dispatcher Cache Rules

- [ ] Send requests for at least 3 different page types through the Dispatcher.
- [ ] Confirm that cache headers (`Cache-Control`, `Dispatcher-TTL`) are present and
      match pre-migration values.
- [ ] Confirm that the Dispatcher cache is being populated (check cache directory for
      newly created `.html` files after a cache flush).
- [ ] Invalidation requests from AEM author still propagate to the Dispatcher
      correctly (publish a page, observe the corresponding cache file is deleted).

### Content Rendering

- [ ] Render 5 representative pages of each major template type (landing page,
      article, product detail, etc.) and visually compare with the pre-migration
      baseline screenshots.
- [ ] No `WCMMode.DISABLED` rendering errors appear in page source (`class="parbase
      error"`).
- [ ] HTL / Sightly expressions that use Sling Models render expected values.
- [ ] Forms (if present) still submit and process correctly.

---

## Section 4: Performance Validation

### Page Load Times

- [ ] Run a load test against at least 3 representative pages using the same tool and
      configuration as the pre-migration performance baseline.
- [ ] P50 response time is within 10% of the pre-migration baseline.
- [ ] P95 response time is within 15% of the pre-migration baseline.
- [ ] No new timeouts (HTTP 504) were observed that were not present in the baseline.

### Memory and GC Behaviour

Refer to the [Java 21 GC tuning documentation](https://docs.oracle.com/en/java/javase/21/gctuning/) when evaluating GC behaviour after migration.

- [ ] Monitor the JVM heap for 30 minutes under representative load.
- [ ] No `java.lang.OutOfMemoryError: Java heap space` events.
- [ ] GC pause times (observable via JVM flags `-Xlog:gc*` or via JMX) are not
      materially higher than the pre-migration baseline.
- [ ] If the JVM is configured to use ZGC (`-XX:+UseZGC`), confirm pause times are
      consistently below 1 ms under normal load (ZGC is the recommended collector for
      Java 21 with AEM 6.5 LTS).
- [ ] If using G1GC, confirm no `To-space exhausted` events appear in GC logs.

### Thread Usage

- [ ] Thread count under load is not materially higher than the pre-migration baseline
      (check via `/system/console/status-threads` or JMX `java.lang:type=Threading`).
- [ ] No thread deadlocks (`java.lang.management.ThreadMXBean.findDeadlockedThreads()`
      returns null).

---

## Completion Sign-Off

All four sections must pass before marking the migration complete:

| Section | Pass / Fail | Reviewer | Date |
|---------|------------|----------|------|
| 1 — Automated Checks | | | |
| 2 — Manual Code Review | | | |
| 3 — Runtime Verification | | | |
| 4 — Performance Validation | | | |

The migration is complete when all four rows show **Pass** and are signed by a
reviewer with commit access to the repository.

---

## References

- [AEM 6.5 LTS GA release notes](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/service-pack/ga)
- [AEM 6.5 LTS SP2 release notes](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/release-notes)
- [Upgrading code and customizations](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/implementing/deploying/upgrading/upgrading-code-and-customizations)
- [AEM 6.5 LTS FAQ](https://experienceleague.adobe.com/en/docs/experience-manager-65-lts/content/release-notes/faq)
- [Apache Sling documentation](https://sling.apache.org/documentation/)
- [Apache Sling Models documentation](https://sling.apache.org/documentation/bundles/models.html)
- [Java 21 GC tuning guide](https://docs.oracle.com/en/java/javase/21/gctuning/)
