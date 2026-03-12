# Scheduler Path A: @SlingScheduled (Simple Schedulers)

For schedulers with hardcoded cron, single schedule, and `implements Runnable`.

---

## A1: Migrate Felix SCR to OSGi DS annotations (if present)

If the file uses Felix SCR annotations (`org.apache.felix.scr.annotations.*`), migrate to OSGi DS:

**Remove Felix SCR imports:**
```java
import org.apache.felix.scr.annotations.Activate;
import org.apache.felix.scr.annotations.Component;
import org.apache.felix.scr.annotations.Properties;
import org.apache.felix.scr.annotations.Property;
import org.apache.felix.scr.annotations.Service;
```

**Replace Felix SCR annotations:**
```java
// BEFORE (Felix SCR)
@Component(metatype = true, label = "...", description = "...")
@Service(value = Runnable.class)
@Properties({
    @Property(name = "scheduler.expression", value = "*/30 * * * * ?")
})

// AFTER (OSGi DS)
@Component(service = Runnable.class)
```

**Migrate @Property to @Designate pattern:**
```java
// BEFORE (Felix SCR)
@Property(label = "A parameter", description = "...")
public static final String MY_PARAMETER = "myParameter";

// AFTER (OSGi DS)
@ObjectClassDefinition(name = "...", description = "...")
public @interface Config {
    @AttributeDefinition(name = "A parameter", description = "...")
    String myParameter() default "";
}
```

Then add `@Designate(ocd = ClassName.Config.class)` to the class.

## A2: Update @Component annotation

```java
// BEFORE
@Component(immediate = true)
// OR (Felix SCR)
@Component(metatype = true, ...)
// OR
@Component(service = Job.class, immediate = true)

// AFTER
@Component(service = Runnable.class)
```

Only change the `@Component` parameters. Do NOT remove the import for `@Component`.

## A3: Remove Scheduler injection

Remove the `@Reference` Scheduler field entirely:

```java
// REMOVE these lines
@Reference
private Scheduler scheduler;
```

## A4: Remove scheduler.schedule() and scheduler.unschedule() calls

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

## A5: Remove @Modified method (if it only re-registers schedules)

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

## A6: Replace System.out with SLF4J Logger

```java
// ADD after class declaration
private static final Logger LOG = LoggerFactory.getLogger(MyScheduler.class);

// REPLACE
System.out.println("message")  ->  LOG.info("message")
```

## A7: Extract cron expression and add @SlingScheduled

Find the existing cron expression in the code. Look for:
- String constants or inline cron strings used in `scheduler.schedule()` calls
- `@Property(name = "scheduler.expression", value = "...")` annotations
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
    // existing logic (will be wrapped in A8)
}
```

**Extract the exact cron expression from the code:**
- From `scheduler.schedule(this, ..., "0 0 2 * * ?")` -> use `"0 0 2 * * ?"`
- From `@Property(name = "scheduler.expression", value = "*/30 * * * * ?")` -> use `"*/30 * * * * ?"`
- From `scheduler.EXPR("0 * * * * ?")` -> use `"0 * * * * ?"`

## A8: Add ResourceResolver handling

Replace deprecated `getAdministrativeResourceResolver()` if present, and wrap the `run()` method body:

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

## A9: Update @Activate method

Remove all scheduling logic. If using `@Designate`, change parameter from `Map<String, Object>` to the Config interface:

```java
// BEFORE (Felix SCR)
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

## A10: Update imports

**Remove:**
```java
import org.apache.sling.commons.scheduler.Scheduler;
import org.apache.sling.commons.scheduler.ScheduleOptions;
import org.apache.sling.commons.scheduler.Job;
import org.apache.sling.commons.scheduler.JobContext;
import org.apache.felix.scr.annotations.*;  // all Felix SCR imports
import org.apache.sling.commons.osgi.PropertiesUtil;  // if no longer needed
```

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

## A11: Add @Deactivate method (if missing)

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
- [ ] No Felix SCR annotations remain (`org.apache.felix.scr.annotations.*`)
- [ ] No `scheduler.schedule(` calls remain
- [ ] No `scheduler.unschedule(` calls remain
- [ ] No `scheduler.EXPR(` calls remain
- [ ] No `System.out.` calls remain
- [ ] No `getAdministrativeResourceResolver()` calls remain
- [ ] `@Component(service = Runnable.class)` is present
- [ ] `@SlingScheduled(expression = "...")` is on `run()` method
- [ ] ResourceResolver in try-with-resources
- [ ] `ResourceResolverFactory` injected via `@Reference`
- [ ] SLF4J Logger is present
- [ ] `@Deactivate` method is present
- [ ] Code compiles: `mvn clean compile`
