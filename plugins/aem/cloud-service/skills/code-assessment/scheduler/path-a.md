# Scheduler Path A — Runnable + OSGi Component Properties

For schedulers with a hardcoded cron, a single schedule, and `implements Runnable`.

**Before starting:** Read [`../references/aem-cloud-service-pattern-prerequisites.md`](../references/aem-cloud-service-pattern-prerequisites.md)
and apply SCR→DS and ResourceResolver fixes if present in the same changeset.

---

## A1: Update `@Component` to declare the schedule via properties

```java
// BEFORE (legacy)
@Component(immediate = true)
// OR: @Component(service = Job.class, immediate = true)

// AFTER — Cloud Service compatible
@Component(
        service = Runnable.class,
        immediate = true,
        property = {
                "scheduler.expression=0 0 2 * * ?",   // keep your existing cron value
                "scheduler.concurrent:Boolean=false",  // :Boolean type hint is required
                "scheduler.runOn=SINGLE"               // one JVM only; use LEADER if needed
        }
)
public class MyScheduler implements Runnable { /* ... */ }
```

`scheduler.concurrent:Boolean=false` requires the `:Boolean` type hint — without it OSGi treats
the value as a String and concurrent execution is not suppressed.

**Full property reference:**

| Property | Type | Purpose | Typical value |
|----------|------|---------|--------------|
| `scheduler.expression` | `String` | Quartz cron expression | Your existing cron |
| `scheduler.concurrent` | `Boolean` | Allow overlapping runs | `false` (set via `:Boolean=false`) |
| `scheduler.runOn` | `String` | Which topology members execute it | `SINGLE` for writes/external calls; omit only for per-pod tasks |
| `scheduler.period` | `Long` | Fixed-interval scheduling in seconds | Only when migrating a periodic (non-cron) scheduler — prefer `scheduler.expression` |
| `scheduler.name` | `String` | Human-readable name / registry key | Optional; useful for identifying the scheduler in Sling Scheduler status (Developer Console on AEMaaCS, Felix Web Console on local SDK) |

---

## A2: Remove the `Scheduler` `@Reference` field

```java
// REMOVE entirely — the framework calls run() directly via scheduler.expression
import org.apache.sling.commons.scheduler.Scheduler;
@Reference
private Scheduler scheduler;
```

---

## A3: Remove every `schedule()` / `unschedule()` / `EXPR()` call

Remove `scheduler.schedule(...)`, `scheduler.unschedule(...)`, `scheduler.EXPR(...)` calls and
helper methods that exist only for scheduling (`addScheduler()`, `removeScheduler()`).

```java
// BEFORE
@Activate
protected void activate() {
    scheduler.schedule(this, scheduler.NOW(-1, 30), "0 0 2 * * ?");
}

// AFTER
@Activate
protected void activate() {
    LOG.info("Scheduler activated");
}
```

---

## A4: Remove `@Modified` if it only re-registers schedules

Sling re-reads `scheduler.expression` automatically on config change.

```java
// REMOVE if it only calls removeScheduler() + addScheduler()
@Modified
protected void modified(Config config) {
    removeScheduler();
    addScheduler(config);
}
```

Keep `@Modified` only if it updates other cached config fields; remove the scheduling calls from it.

**`@Designate`-backed Path A schedulers:** If the class uses `@Designate` and `@Modified` purely to update cached instance fields (not to re-register the schedule), keep `@Modified` — the Sling framework handles the schedule update from the new config automatically, but your code may still need to react to the new config values:

```java
@Modified
protected void modified(Config config) {
    this.myParameter = config.myParameter();  // keep — updates cached field
    // do NOT call removeScheduler() / addScheduler() — Sling handles reschedule
}
```

---

## A5: Extract the cron and put it in `@Component`

| Found in legacy code | Put in `@Component.property` |
|---|---|
| `scheduler.schedule(this, ..., "0 0 2 * * ?")` | `"scheduler.expression=0 0 2 * * ?"` |
| `@Property(name="scheduler.expression", value="*/30 * * * * ?")` | `"scheduler.expression=*/30 * * * * ?"` |
| `scheduler.EXPR("0 * * * * ?")` | `"scheduler.expression=0 * * * * ?"` |

**Do not invent a cron.** If not found in the legacy code, ask the user.

For configurable crons, use `@Designate` with an `@ObjectClassDefinition`:

```java
@ObjectClassDefinition(name = "My Scheduler")
public @interface Config {
    @AttributeDefinition(name = "Cron expression")
    String scheduler_expression() default "0 0 2 * * ?";

    @AttributeDefinition(name = "Concurrent")
    boolean scheduler_concurrent() default false;

    @AttributeDefinition(name = "Run on")
    String scheduler_runOn() default "SINGLE";
}

@Component(service = Runnable.class, immediate = true)
@Designate(ocd = MyScheduler.Config.class)
public class MyScheduler implements Runnable { /* ... */ }
```

`scheduler_expression()` maps to property key `scheduler.expression` — underscores become dots.

> **If the cron must come from runtime OSGi configuration with arbitrary values** (the admin can
> set any cron at runtime), this is a **Path B** scheduler — stop here and follow
> [path-b.md](path-b.md) instead.

---

## A6: Add `ResourceResolver` handling inside `run()`

```java
@Override
public void run() {
    try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
            Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "scheduler-service"))) {
        // existing job logic here
        LOG.debug("Scheduled job completed");
    } catch (LoginException e) {
        LOG.error("Could not open service resolver for subservice 'scheduler-service'", e);
    }
}
```

**`getServiceResourceResolver` throws `LoginException` on failure — it does NOT normally return
`null`.** Catch `LoginException` and log; do not add a `resolver == null` branch unless a custom
wrapper is in use.

**Write-side schedulers:** If `run()` modifies JCR content, call `resolver.commit()` before the try-with-resources closes the resolver. Changes not committed are silently discarded on resolver close:

```java
@Override
public void run() {
    try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
            Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "scheduler-service"))) {
        Resource resource = resolver.getResource("/content/my-page");
        if (resource != null) {
            ModifiableValueMap props = resource.adaptTo(ModifiableValueMap.class);
            props.put("lastRun", System.currentTimeMillis());
            resolver.commit();  // required — changes are discarded without this
        }
    } catch (LoginException e) {
        LOG.error("Could not open service resolver for subservice 'scheduler-service'", e);
    } catch (PersistenceException e) {
        LOG.error("Failed to commit changes", e);
    }
}
```

**Author-only schedulers:** If `run()` must only execute on author, inject `SlingSettingsService` and guard at the top of `run()`:

```java
@Reference
private SlingSettingsService slingSettingsService;

@Override
public void run() {
    if (!slingSettingsService.getRunModes().contains("author")) {
        return;
    }
    // author-only logic
}
```

Import: `import org.apache.sling.settings.SlingSettingsService;`

Add the factory field if missing:

```java
@Reference
private ResourceResolverFactory resolverFactory;
```

---

## A7: Update `@Activate`

```java
// BEFORE
@Activate
protected void activate(final Map<String, Object> config) {
    configure(config);
    addScheduler(config);
}

// AFTER
@Activate
protected void activate(final Config config) {
    this.myParameter = config.myParameter();
    LOG.info("Scheduler activated");
}
```

---

## A8: Update imports

Remove:
```java
import org.apache.sling.commons.scheduler.Scheduler;
import org.apache.sling.commons.scheduler.ScheduleOptions;
import org.apache.sling.commons.scheduler.Job;
import org.apache.sling.commons.scheduler.JobContext;
```

Add if not present:
```java
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Deactivate;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.metatype.annotations.AttributeDefinition;
import org.osgi.service.metatype.annotations.Designate;
import org.osgi.service.metatype.annotations.ObjectClassDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Collections;
```

Do **not** add `org.apache.sling.commons.scheduler.SlingScheduled` — it does not exist in the CS SDK.

---

## A9: Add `@Deactivate` if missing

```java
@Deactivate
protected void deactivate() {
    LOG.info("Scheduler deactivated");
}
```

For a stateless Path A scheduler, `@Deactivate` provides no functional benefit — OSGi unregisters the component and the Sling Scheduler removes the job automatically. The method is conventional and aids observability in logs, but is **optional**. If the legacy class already has a `@Deactivate` with meaningful cleanup (closing resources, clearing caches), keep it. If there is none, adding a log-only method is fine but not required.

---

## Complete example after migration

```java
@Component(
        service = Runnable.class,
        immediate = true,
        property = {
                "scheduler.expression=0 0 2 * * ?",
                "scheduler.concurrent:Boolean=false",
                "scheduler.runOn=SINGLE"
        }
)
public class NightlyCleanupScheduler implements Runnable {

    private static final Logger LOG = LoggerFactory.getLogger(NightlyCleanupScheduler.class);

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Activate
    protected void activate() { LOG.info("NightlyCleanupScheduler activated"); }

    @Deactivate
    protected void deactivate() { LOG.info("NightlyCleanupScheduler deactivated"); }

    @Override
    public void run() {
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "scheduler-service"))) {
            // business logic
        } catch (LoginException e) {
            LOG.error("Could not open service resolver for subservice 'scheduler-service'", e);
        }
    }
}
```

---

## Greenfield template (Path A)

Use `@Designate(factory = true)` to allow multiple independent instances via OSGi factory configs.

```java
@Component(service = Runnable.class, immediate = true)
@Designate(ocd = MyScheduler.Config.class, factory = true)
public class MyScheduler implements Runnable {

    private static final Logger LOG = LoggerFactory.getLogger(MyScheduler.class);

    @ObjectClassDefinition(name = "My Scheduler Config")
    @interface Config {
        @AttributeDefinition(name = "Enabled")
        boolean enabled() default true;

        @AttributeDefinition(name = "Cron Expression")
        String scheduler_expression() default "0 0 2 * * ?";

        @AttributeDefinition(name = "Concurrent")
        boolean scheduler_concurrent() default false;

        @AttributeDefinition(name = "Run On")
        String scheduler_runOn() default "SINGLE";
    }

    private volatile boolean enabled;

    @Activate
    @Modified
    protected void activate(Config config) {
        this.enabled = config.enabled();
    }

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public void run() {
        if (!enabled) {
            return;
        }
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "my-scheduler-service"))) {
            // business logic
        } catch (LoginException e) {
            LOG.error("Failed to obtain service ResourceResolver", e);
        }
    }
}
```

SUBSERVICE name must match a `ServiceUserMapperImpl.amended-*.cfg.json` mapping.

---

## Path A — Validation checklist

- [ ] No `import org.apache.sling.commons.scheduler.Scheduler` remains
- [ ] No `@SlingScheduled` annotation
- [ ] No `scheduler.schedule(`, `scheduler.unschedule(`, `scheduler.EXPR(` calls remain
- [ ] `@Component(service = Runnable.class)` with all three scheduler properties
- [ ] Cron value extracted from legacy code — not invented
- [ ] `scheduler.concurrent:Boolean=false` uses the `:Boolean` type hint
- [ ] `scheduler.runOn=SINGLE` or `LEADER` when job writes to repo or calls external systems
- [ ] `ResourceResolverFactory` injected via `@Reference` if `run()` uses a resolver
- [ ] Resolver in try-with-resources in `run()` — not a field
- [ ] `@Deactivate` present if there is meaningful cleanup; optional for purely stateless schedulers (see A9)
- [ ] OSGi DS R6 annotations — no `org.apache.felix.scr.annotations.*`
- [ ] Service user + mapping exists in Repoinit / `ui.config`
- [ ] `mvn clean compile` passes
