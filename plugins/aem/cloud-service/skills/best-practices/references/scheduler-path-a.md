# Scheduler Path A: @SlingScheduled (Simple Schedulers)

For schedulers with hardcoded cron, single schedule, and `implements Runnable`.

---

## Pattern prerequisites

Read [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) and apply the linked prerequisite modules before the scheduler-specific steps below.

## A1: Update @Component annotation

```java
// BEFORE
@Component(immediate = true)
// OR
@Component(service = Job.class, immediate = true)

// AFTER
@Component(service = Runnable.class)
```

Only change the `@Component` parameters. Do NOT remove the import for `@Component`.

## A2: Remove Scheduler injection

Remove the `@Reference` Scheduler field entirely:

```java
// REMOVE these lines
@Reference
private Scheduler scheduler;
```

## A3: Remove scheduler.schedule() and scheduler.unschedule() calls

Remove all `scheduler.schedule(...)`, `scheduler.unschedule(...)`, `scheduler.EXPR(...)` calls. Remove helper methods that only exist for scheduling (e.g., `addScheduler()`, `removeScheduler()`). Keep the `@Activate` annotation and method, but remove the scheduling calls inside it.

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

(Apply **logging** changes per [resource-resolver-logging.md](resource-resolver-logging.md), not ad hoc.)

## A4: Remove @Modified method (if it only re-registers schedules)

If the `@Modified` method only calls `removeScheduler()` + `addScheduler()` (or equivalent), remove it entirely since `@SlingScheduled` handles scheduling automatically.

```java
// REMOVE if it only re-registers schedules
@Modified
protected void modified(Config config) {
    removeScheduler();
    addScheduler(config);
}
```

If `@Modified` has other business logic (e.g., updating config fields), keep the method but remove the scheduling calls:

```java
// KEEP but simplify
@Modified
protected void modified(Config config) {
    this.myParameter = config.myParameter();
    LOG.info("Configuration modified, myParameter='{}'", myParameter);
}
```

## A5: Extract cron expression and add @SlingScheduled

Find the existing cron expression in the code. Look for:
- String constants or inline cron strings used in `scheduler.schedule()` calls
- `@Property(name = "scheduler.expression", value = "...")` annotations (legacy SCR — may already be migrated via DS metatype)
- Any scheduler configuration properties with hardcoded defaults

```java
// BEFORE
@Override
public void run() {
    // existing logic
}

// AFTER
@Override
@SlingScheduled(expression = "*/30 * * * * ?")  // use the EXISTING cron from the code
public void run() {
    // existing logic (will be wrapped in A6)
}
```

**Extract the exact cron expression from the code:**
- From `scheduler.schedule(this, ..., "0 0 2 * * ?")` -> use `"0 0 2 * * ?"`
- From `@Property(name = "scheduler.expression", value = "*/30 * * * * ?")` -> use `"*/30 * * * * ?"`
- From `scheduler.EXPR("0 * * * * ?")` -> use `"0 * * * * ?"`

## A6: Add ResourceResolver handling

Follow [resource-resolver-logging.md](resource-resolver-logging.md) for resolver acquisition and try-with-resources. Wrap the `run()` method body:

```java
// AFTER
@Override
@SlingScheduled(expression = "*/30 * * * * ?")
public void run() {
    try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
            Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "scheduler-service"))) {

        if (resolver == null) {
            LOG.warn("Could not acquire resource resolver, skipping execution");
            return;
        }

        LOG.debug("Running scheduled job");
        // existing job logic here

    } catch (LoginException e) {
        LOG.error("Failed to get resource resolver", e);
    }
}
```

**Add ResourceResolverFactory injection (if not already present):**
```java
@Reference
private ResourceResolverFactory resolverFactory;
```

## A7: Update @Activate method

Remove all scheduling logic. If using `@Designate`, change parameter from `Map<String, Object>` to the Config interface:

```java
// BEFORE
@Activate
protected void activate(final Map<String, Object> config) {
    configure(config);
    addScheduler(config);
}

// AFTER (OSGi DS)
@Activate
protected void activate(final Config config) {
    myParameter = config.myParameter();
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
import org.apache.sling.commons.osgi.PropertiesUtil;  // if no longer needed
```

(Remove Felix SCR imports per **SCR→DS** skill.)

**Add (if not already present):**
```java
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.commons.scheduler.SlingScheduled;
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

**DO NOT** remove or change any other imports that are still used.

## A9: Add @Deactivate method (if missing)

```java
@Deactivate
protected void deactivate() {
    LOG.info("Scheduler deactivated");
}
```

---

# Validation Checklist

- [ ] No `import org.apache.sling.commons.scheduler.Scheduler;` remains
- [ ] No `import org.apache.sling.commons.scheduler.ScheduleOptions;` remains
- [ ] No Felix SCR annotations remain (`org.apache.felix.scr.annotations.*`) — per SCR→DS skill
- [ ] No `scheduler.schedule(` calls remain
- [ ] No `scheduler.unschedule(` calls remain
- [ ] No `scheduler.EXPR(` calls remain
- [ ] Resolver + logging checklist satisfied — per [resource-resolver-logging.md](resource-resolver-logging.md)
- [ ] `@Component(service = Runnable.class)` is present
- [ ] `@SlingScheduled(expression = "...")` is on `run()` method
- [ ] `ResourceResolverFactory` injected via `@Reference` if `run()` uses a resolver
- [ ] `@Deactivate` method is present
- [ ] Code compiles: `mvn clean compile`
