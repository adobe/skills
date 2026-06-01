> **Deprecated:** This file is superseded by [`../scheduler/path-a.md`](../scheduler/path-a.md).
> It will be removed once all five expert skills are in place. Do not update this file.

# Scheduler Path A — OSGi scheduler properties (simple schedulers)

For schedulers with a hardcoded cron, a single schedule, and `implements Runnable`.

The target pattern is a `Runnable` component whose schedule is declared through the
**Apache Sling Commons Scheduler OSGi component properties**
(`scheduler.expression`, `scheduler.concurrent`, `scheduler.runOn`). No `Scheduler` reference,
no `schedule()` call, no `@SlingScheduled` annotation (that annotation does **not** exist in the
Cloud Service SDK).

---

## Pattern prerequisites

Read [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) and apply the linked prerequisite modules before the scheduler-specific steps below.

## A1: Update `@Component` to declare the schedule via properties

Register the component as a `Runnable` service and push the cron expression, concurrency guard,
and cluster-role setting into the component's `property` list. These three properties are the
public contract between `org.apache.sling.commons.scheduler.Scheduler` and any `Runnable` service.

```java
// BEFORE (legacy)
@Component(immediate = true)
// OR
@Component(service = Job.class, immediate = true)

// AFTER — Cloud Service compatible
import org.osgi.service.component.annotations.Component;

@Component(
        service = Runnable.class,
        immediate = true,
        property = {
                "scheduler.expression=0 0 2 * * ?",          // hardcoded cron, keep your existing value
                "scheduler.concurrent:Boolean=false",        // never run two overlapping invocations
                "scheduler.runOn=SINGLE"                     // only one JVM in the topology runs it
        }
)
public class MyScheduler implements Runnable { /* ... */ }
```

**Property reference:**

| Property | Type | Purpose | Typical value on AEMaaCS |
|----------|------|---------|--------------------------|
| `scheduler.expression` | `String` | Quartz cron expression | Your existing cron |
| `scheduler.concurrent` | `Boolean` | Allow overlapping runs? | **`false`** (set by `:Boolean=false`) |
| `scheduler.runOn` | `String` | Which topology members execute it | `SINGLE` (leader only) or `LEADER`; omit only when every publish must run it independently |
| `scheduler.period` | `Long` | Fixed-interval scheduling (seconds) | Only if you are migrating a periodic scheduler (not cron) — use `scheduler.expression` instead |
| `scheduler.name` | `String` | Human-readable name / registry key | Optional |

**AEM as a Cloud Service caveat:** publish runs multiple pods; without `scheduler.runOn=SINGLE`
(or `LEADER`), a cron `Runnable` will fire **on every pod**. Pick deliberately:

- Writes to the repository / external systems → `SINGLE`.
- Per-pod bookkeeping (local cache warm-up, etc.) → omit `scheduler.runOn`.

Do **not** remove the `@Component` import — it is still needed.

## A2: Remove the `Scheduler` `@Reference` field

Remove the `@Reference` `Scheduler` field entirely:

```java
// REMOVE
import org.apache.sling.commons.scheduler.Scheduler;
...
@Reference
private Scheduler scheduler;
```

The Sling framework calls `run()` directly based on the `scheduler.expression` property — there
is no `Scheduler` API call anywhere in your class.

## A3: Remove every `scheduler.schedule(...)` / `unschedule(...)` / `EXPR(...)` call

Remove all `scheduler.schedule(...)`, `scheduler.unschedule(...)`, and `scheduler.EXPR(...)`
calls. Remove helper methods that only exist for scheduling (`addScheduler()`, `removeScheduler()`,
etc.). Keep `@Activate` / `@Deactivate`, but remove their scheduling calls.

```java
// BEFORE
@Activate
protected void activate() {
    scheduler.schedule(this, scheduler.NOW(-1), CRON);
    System.out.println("Activated");
}

// AFTER
@Activate
protected void activate() {
    LOG.info("Scheduler activated");
}
```

Apply **logging** changes per [resource-resolver-logging.md](resource-resolver-logging.md).

## A4: Remove `@Modified` when it only re-registers schedules

If `@Modified` only calls `removeScheduler()` + `addScheduler()` (or equivalent), remove it
entirely — the Sling framework re-reads the `scheduler.expression` property automatically on
config change.

```java
// REMOVE — framework handles reschedule on property change
@Modified
protected void modified(Config config) {
    removeScheduler();
    addScheduler(config);
}
```

If `@Modified` carries other business logic (updating cached config fields), keep it but drop
the scheduling calls:

```java
@Modified
protected void modified(Config config) {
    this.myParameter = config.myParameter();
    LOG.info("Configuration modified, myParameter='{}'", myParameter);
}
```

## A5: Extract the cron expression and put it on the `@Component`

Find the existing cron in the code:

- String constants or inline cron strings passed to `scheduler.schedule(...)`.
- Legacy `@Property(name = "scheduler.expression", value = "...")` SCR annotations.
- Any scheduler configuration properties with hardcoded defaults.

Move the **exact** cron you extract into the `scheduler.expression` entry of `@Component.property`
(see A1). Examples:

| Found in legacy code | Put in `@Component.property` |
|---|---|
| `scheduler.schedule(this, ..., "0 0 2 * * ?")` | `"scheduler.expression=0 0 2 * * ?"` |
| `@Property(name="scheduler.expression", value="*/30 * * * * ?")` | `"scheduler.expression=*/30 * * * * ?"` |
| `scheduler.EXPR("0 * * * * ?")` | `"scheduler.expression=0 * * * * ?"` |

**Do not invent a cron.** If you cannot find one, ask the user.

### Making the cron configurable (metatype, still Cloud Service compatible)

If the legacy code sourced the cron from metatype / config, keep it configurable by backing the
three properties with an `@ObjectClassDefinition`. The framework still schedules from the
resulting component properties:

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

Prefer the direct `property = { ... }` form (A1) for **hardcoded** Path-A schedulers; use the
OCD form when the cron truly needs to be admin-configurable.

> If the cron value **must** come from runtime OSGi configuration with arbitrary values, this is
> actually a **Path B** scheduler — see [scheduler-path-b.md](scheduler-path-b.md) and use the
> Sling Jobs flow instead.

## A6: Add `ResourceResolver` handling inside `run()`

Follow [resource-resolver-logging.md](resource-resolver-logging.md) for resolver acquisition and
try-with-resources. `run()` becomes:

```java
@Override
public void run() {
    try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
            Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "scheduler-service"))) {

        LOG.debug("Running scheduled job");
        // existing job logic here
    } catch (LoginException e) {
        LOG.error("Could not open service resolver for subservice 'scheduler-service'", e);
    }
}
```

Notes:

- `getServiceResourceResolver` throws `LoginException` on failure — it does **not** normally
  return `null`. Catch `LoginException` and log; do not add a `resolver == null` branch unless
  you have a specific reason (e.g. a wrapper that returns `null`).
- The `SUBSERVICE` name must be backed by a Repoinit service user plus a
  `ServiceUserMapperImpl.amended-*.cfg.json` mapping — see
  [resource-resolver-logging.md](resource-resolver-logging.md).

Add the factory field if not already present:

```java
@Reference
private ResourceResolverFactory resolverFactory;
```

## A7: Update `@Activate`

Remove all scheduling logic from `@Activate`. If using `@Designate`, change the parameter from
`Map<String, Object>` to the typed `Config`:

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
    LOG.info("Scheduler activated, myParameter='{}'", myParameter);
}
```

## A8: Update imports

**Remove:**

```java
import org.apache.sling.commons.scheduler.Scheduler;
import org.apache.sling.commons.scheduler.ScheduleOptions;
import org.apache.sling.commons.scheduler.Job;
import org.apache.sling.commons.scheduler.JobContext;
import org.apache.sling.commons.osgi.PropertiesUtil;  // if no longer used
```

Remove Felix SCR imports per [scr-to-osgi-ds.md](scr-to-osgi-ds.md).

**Do NOT** add `org.apache.sling.commons.scheduler.SlingScheduled` — that class does not exist
in the AEM Cloud Service SDK. The scheduling is entirely driven by the component properties in
A1.

**Add (if not already present):**

```java
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Deactivate;
import org.osgi.service.component.annotations.Reference;
// Only if you keep a typed Config via OCD:
import org.osgi.service.metatype.annotations.AttributeDefinition;
import org.osgi.service.metatype.annotations.Designate;
import org.osgi.service.metatype.annotations.ObjectClassDefinition;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Collections;
```

**Do not** remove or change any other imports that are still used.

## A9: Add `@Deactivate` (if missing)

```java
@Deactivate
protected void deactivate() {
    LOG.info("Scheduler deactivated");
}
```

---

## Complete Path-A example (after)

```java
package com.example.scheduling;

import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Deactivate;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collections;

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
    protected void activate() {
        LOG.info("NightlyCleanupScheduler activated");
    }

    @Deactivate
    protected void deactivate() {
        LOG.info("NightlyCleanupScheduler deactivated");
    }

    @Override
    public void run() {
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "scheduler-service"))) {
            // business logic
            LOG.debug("Nightly cleanup completed");
        } catch (LoginException e) {
            LOG.error("Could not open service resolver for subservice 'scheduler-service'", e);
        }
    }
}
```

---

## Validation checklist

- [ ] No `import org.apache.sling.commons.scheduler.Scheduler;` remains.
- [ ] No `import org.apache.sling.commons.scheduler.ScheduleOptions;` remains.
- [ ] **No `@SlingScheduled` annotation** (it does not exist in the AEMaaCS SDK).
- [ ] No Felix SCR annotations remain (`org.apache.felix.scr.annotations.*`) — per [scr-to-osgi-ds.md](scr-to-osgi-ds.md).
- [ ] No `scheduler.schedule(`, `scheduler.unschedule(`, `scheduler.EXPR(` calls remain.
- [ ] Resolver + logging checklist satisfied — per [resource-resolver-logging.md](resource-resolver-logging.md).
- [ ] `@Component(service = Runnable.class, property = { "scheduler.expression=...", "scheduler.concurrent:Boolean=false", "scheduler.runOn=SINGLE" })` is present, with the exact cron extracted from the legacy code.
- [ ] `scheduler.concurrent:Boolean=false` is set (or `scheduler.concurrent=false` with a matching OCD method).
- [ ] `scheduler.runOn=SINGLE` (or `LEADER`) is set — unless every publish pod must run the job.
- [ ] `ResourceResolverFactory` injected via `@Reference` if `run()` uses a resolver.
- [ ] `@Deactivate` method is present.
- [ ] Service user + mapping exists in Repoinit / `ui.config` (see [resource-resolver-logging.md](resource-resolver-logging.md)).
- [ ] Code compiles: `mvn clean compile`.
