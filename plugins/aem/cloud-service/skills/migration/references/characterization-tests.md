# Characterization tests (behavior pinning for migration)

A characterization test **pins the current observable behavior** of a class before it is migrated,
then proves the transformed class still behaves the same. It is a regression net, not a design
exercise — the pattern guide's own `mvn clean compile` / `mvn clean install` step proves the code
*builds*; this proves it still *does the same thing* across the migration.

This is a **migration-only policy** — it applies to the per-finding apply loop (**Step 5**) of a
migration session. A standalone `code-assessment` run on the same pattern does **not** pin behavior;
migrations are the riskier, cross-version change where a behavioral regression is worth catching.

This module is **bounded on purpose**: nominal authoring effort, no rerun loops. Follow the
efficiency contract exactly — when anything costs more than one fill-in skeleton and one green run,
**skip and record the reason** instead of spending effort.

## Eligibility — only these patterns, only before the edit

Pin a test **only** for a pattern marked **before-eligible**. These are the migration Java-cascade
patterns that preserve a behavioral seam a single test can bind to on both sides of the edit.

| Pattern (BPA id) | Before-eligible? | Seam the test binds to |
|---|---|---|
| `guavaCache` (Guava → Caffeine) | ✅ | The cache-owner service's public method — near 1:1 swap, public API unchanged |
| `scheduler` | ✅ | The job's **work method** (`run()` body / extracted `doJob()`) — only registration changes |
| `resourceChangeListener` | ✅ *(conditional)* | The **business method the callback delegates to** — only when a stable delegate exists |
| `eventListener` / `eventHandler` | ✅ *(conditional)* | The delegated handler method / `JobConsumer#process` outcome |
| `replication` (Replicator → Distribution) | ❌ | Sync → **async** model change — a before-test pins behavior that no longer exists |
| `assetApi` (AssetManager → external) | ❌ | In-JVM → out-of-process — no surviving in-process seam |

Non-Java migration patterns (`htlLint`, `vault-package-dependencies`, `osgiConfig`, `lui`, `cdw`,
`templateModernization`, `dispatcherConversion`) are **out of scope** — no Java unit under test.
For `replication` and `assetApi`, do **not** write a test: rely on the guide's compile/build step
plus a dev-deploy check before merge.

## Efficiency contract (non-negotiable — this is what keeps it cheap)

1. **One test per finding**, ≤ ~25 lines, one assertion of the behavioral outcome, from a skeleton
   below. No suites, edge cases, or parameterized variants. A migration batch is at most **5
   findings** (Step 5), so a batch pins at most 5 tests — no separate cap needed.
2. **Match the module's test stack; add the minimum only if none exists.** Skeleton A needs only
   JUnit + Mockito; skeletons B/C also need `io.wcm.testing.mock.aem` (AemContext) — so a missing
   `io.wcm.testing.mock.aem` blocks only B/C, never the Mockito-only skeleton A.
   - **Harness already present (common on projects migrated from AEM 6.x):** use whatever the module
     has and **match its version** — **JUnit 4** (`@RunWith(MockitoJUnitRunner.class)`, `AemContext`
     as a `@Rule` field) or **JUnit 5** (`@ExtendWith(...)`, `AemContextExtension`). Add nothing.
   - **No test harness in the module:** add the minimal `<scope>test</scope>` deps **once per
     module** — `org.junit.jupiter:junit-jupiter` + `org.mockito:mockito-core` (+
     `io.wcm.testing.aem-mock-junit5` for B/C). **Version-match the project's Java level: Java 8 →
     Mockito 4.x** (Mockito 5 requires Java 11), Java 11+ → Mockito 5.x. This is a once-per-module
     cost amortized across that module's findings, not per-finding.
   - **Guardrail — a run reporting `Tests run: 0` is a false pass, not a pin.** (Happens when a
     JUnit 5 test is added to a module whose Surefire can't see the jupiter engine.) If the pre-edit
     run does not actually execute the test, record `no-test-harness` and move on — never report
     `pinned` for a test that did not run.
   - If deps can't be resolved (dead legacy repo / offline — common for 6.x/AMS) → skip
     `no-test-harness`; do not retry.
3. **Stable seam required.** Bind to a method that exists **unchanged** after the migration (a work
   method or a delegated business method). If the logic is inline in the framework callback with no
   stable delegate → **skip** (`no-stable-seam`). This is the single most important rule: it is what
   prevents a test that cannot span both sides and the rerun loop that follows.
4. **One attempt, then skip.** Run the new test once **before** the edit. If it is not green on the
   first run → **discard it and skip** (`baseline-red`). Do **not** debug or rewrite the test.
   Continue the migration for that finding compile-only.
5. **Exactly two runs total.** Green before the edit (pins behavior), green after the edit (same
   Step 5 iteration). Nothing in between.

**The one legitimate reason to skip is `no-stable-seam` (rule 3), not tooling.** Some legacy jobs and
listeners inline their logic in the framework callback with nothing to bind to — skip those. But a
missing JUnit 5 dep is **not** a reason to skip: match the module's JUnit 4/5 stack, or add the
minimal deps once (rule 2). Do not chase coverage or reshape the target code to make it testable —
that is the only effort this module refuses to spend.

## Reporting (Step 5 / Step 6)

There is no `.autofix` run log in a migration session. Record each finding's pin outcome inline in
the **Step 6 batch report**, one token per finding:

- `pinned` — green before **and** after (behavior preserved)
- `pin-skip: <no-stable-seam | no-test-harness | baseline-red>` — no test written
- `pin-fail → reverted` — green before, **red after** (real regression; the edit was reverted)

## Where the test file goes

`<module>/src/test/java/<same-package-as-target>/<TargetClass>MigrationTest.java`. If a test class
for the target already exists, add **one** method to it instead of a new file.

## Run command (scoped — never the whole suite)

Run only the generated test, from the reactor root:

```bash
mvn -pl <module> -am -Dtest=<TargetClass>MigrationTest -DfailIfNoTests=false -Dsurefire.failIfNoSpecifiedTests=false test
```

Do **not** add `-q`: on a *passing* build Maven prints neither `BUILD SUCCESS` nor the Surefire
`Tests run:` line (both are INFO-level, which `-q` suppresses), so a green run would look like a
failure and you would wrongly skip it. `-DfailIfNoTests=false -Dsurefire.failIfNoSpecifiedTests=false`
is required because `-am` also builds the target module's upstream **reactor** modules through the
`test` phase, where the `-Dtest` filter matches nothing — without those flags Surefire fails them
with *"No tests matching pattern"* before the target test ever runs.

- **Before the edit:** the run must end in `BUILD SUCCESS` (exit 0) with the target test green —
  `Tests run: 1, Failures: 0, Errors: 0`. **`Tests run: 0` is a false pass, not a pin:**
  `-DfailIfNoTests=false` lets a test that never executed still succeed (e.g. a freshly added
  JUnit 5 test in a module whose Surefire can't see the jupiter engine). If the target test did not
  actually run, record `no-test-harness` and move on.
- **After the edit:** re-run the identical command. `BUILD SUCCESS` with the target test green =
  behavior preserved. `BUILD FAILURE` with the target test failing = real regression → revert that
  finding's edit and record `pin-fail → reverted`.

## Skeletons (fill placeholders from the finding — do not extend)

> **JUnit 4 modules:** the bodies are identical — only swap the annotations. Class-level
> `@RunWith(MockitoJUnitRunner.class)`; for A/B/C an `AemContext` `@Rule` field
> (`@Rule public final AemContext ctx = new AemContext();`) instead of `AemContextExtension`;
> `org.junit.Test` and `org.junit.Assert.*`.

### A. `guavaCache` — cached lookup returns a stable value (memoization check optional)

Construct the SUT however the module allows — do **not** require a constructor-injectable backend.
The mandatory part pins the current return value (characterization); add the memoization `verify`
**only** when a loader/backend collaborator is actually mockable.

```java
class <TargetClass>MigrationTest {
  @Test
  void cachedLookupIsStable() throws Exception {
    <TargetClass> sut = /* construct as the module allows: new <TargetClass>(),
        ctx.registerInjectActivateService(new <TargetClass>()), or new <TargetClass>(mockedDep) */;

    Object first  = sut.<publicCacheMethod>(<KEY>);   // pin whatever it returns today
    Object second = sut.<publicCacheMethod>(<KEY>);

    assertNotNull(first);
    assertEquals(first, second);                       // repeated lookup stays consistent post-swap
    // OPTIONAL — add @ExtendWith(MockitoExtension.class) (JUnit 5) / @RunWith(MockitoJUnitRunner.class)
    // (JUnit 4) and this line ONLY when the backend is a mockable collaborator:
    //   verify(backend, times(1)).<load>(<KEY>);      // pins memoization itself, identical Guava/Caffeine
  }
}
```

### B. `scheduler` — work method side effect (invoke the work directly, no scheduler)

```java
@ExtendWith(AemContextExtension.class)
class <TargetClass>MigrationTest {
  private final AemContext ctx = new AemContext();

  @Test
  void workMethodProducesExpectedSideEffect() throws Exception {
    <TargetClass> sut = ctx.registerInjectActivateService(new <TargetClass>());
    // arrange minimal input the work method reads (resource, service mock, etc.)

    sut.<workMethod>();   // the body that survives migration — NOT the scheduler registration

    // assert the observable outcome (resource written / collaborator called)
    assertEquals(<EXPECTED>, ctx.resourceResolver().getResource(<PATH>).getValueMap().get(<PROP>));
  }
}
```

### C. `resourceChangeListener` / `eventListener` / `eventHandler` — delegated-handler outcome

Only when the callback delegates to a stable business method. If it does not, skip
(`no-stable-seam`).

```java
@ExtendWith(AemContextExtension.class)
class <TargetClass>MigrationTest {
  private final AemContext ctx = new AemContext();

  @Test
  void handlingPathProducesExpectedSideEffect() throws Exception {
    <TargetClass> sut = ctx.registerInjectActivateService(new <TargetClass>());
    ctx.create().resource(<CHANGED_PATH>, <SEED_PROPS>);

    sut.<delegatedBusinessMethod>(<CHANGED_PATH>);   // the seam that survives the interface swap

    assertEquals(<EXPECTED>, ctx.resourceResolver().getResource(<TARGET_PATH>).getValueMap().get(<PROP>));
  }
}
```
