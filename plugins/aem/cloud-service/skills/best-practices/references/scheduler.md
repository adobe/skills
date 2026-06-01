> **Deprecated:** This file is superseded by the `scheduler` expert skill at
> [`../scheduler/SKILL.md`](../scheduler/SKILL.md). It will be removed once all five
> expert skills are in place. Do not update this file — update the skill instead.

# Scheduler Migration Pattern

Migrates AEM schedulers from legacy patterns to Cloud Service compatible patterns.

**Before path-specific steps:** [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) (SCR→DS, resolver, logging).

**Two paths based on complexity:**
- **Path A (Runnable with OSGi scheduler properties):** Simple schedulers — hardcoded cron, single schedule, `implements Runnable`; registered via `scheduler.expression` / `scheduler.concurrent` / `scheduler.runOn` component properties.
- **Path B (Sling Job):** Complex schedulers — config-driven crons, multiple schedules, business logic that belongs on a `JobConsumer`.

> **Note:** There is **no `@SlingScheduled` annotation** in the AEM as a Cloud Service SDK.
> Schedules on a `Runnable` service are always declared through the
> `scheduler.expression` / `scheduler.concurrent` / `scheduler.runOn` OSGi component properties.

---

## Quick Examples

### Path A Example (Simple Scheduler)

**Before:**
```java
@Component(service = Runnable.class)
public class MyScheduler implements Runnable {
    @Reference private Scheduler scheduler;
    
    @Activate
    protected void activate() {
        scheduler.schedule(this, scheduler.EXPR("*/30 * * * * ?"));
    }
    
    @Override
    public void run() {
        ResourceResolver resolver = resolverFactory.getAdministrativeResourceResolver(null);
        // business logic
    }
}
```

**After:**
```java
@Component(
        service = Runnable.class,
        immediate = true,
        property = {
                "scheduler.expression=*/30 * * * * ?",
                "scheduler.concurrent:Boolean=false",
                "scheduler.runOn=SINGLE"
        }
)
public class MyScheduler implements Runnable {
    @Reference private ResourceResolverFactory resolverFactory;

    @Override
    public void run() {
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "scheduler-service"))) {
            // business logic
        } catch (LoginException e) {
            // log and return
        }
    }
}
```

### Path B Example (Complex Scheduler)

**Before:**
```java
@Component(service = Job.class)
public class MyScheduler implements Job {
    @Reference private Scheduler scheduler;
    
    @Activate
    protected void activate(Config config) {
        scheduler.schedule(this, scheduler.EXPR(config.cronExpression()));
    }
    
    @Override
    public void execute(JobContext context) {
        // business logic
    }
}
```

**After (Split into 2 classes):**

**Scheduler.java:**
```java
@Component(immediate = true)
public class MyScheduler {
    @Reference private JobManager jobManager;
    
    @Activate
    protected void activate(Config config) {
        jobManager.createJob("my/job/topic")
            .properties(Map.of("param", config.param()))
            .schedule().cron(config.cronExpression()).add();
    }
}
```

**JobConsumer.java:**
```java
@Component(service = JobConsumer.class, property = {
    JobConsumer.PROPERTY_TOPICS + "=my/job/topic"
})
public class MyJobConsumer implements JobConsumer {
    @Override
    public JobResult process(Job job) {
        // business logic from execute()
        return JobResult.OK;
    }
}
```

---

## Classification

**Classify BEFORE making any changes.**

### Use Path A when ALL of these are true:
- Cron expression is a hardcoded string constant (or a simple `@AttributeDefinition`-backed
  `scheduler.expression` config value)
- Only one schedule/cron per class
- Class implements `Runnable` (not `Job`)
- No complex scheduling logic (no `ScheduleOptions.config()`, no job properties, no per-execution
  job payload)

**If Path A → read [`scheduler-path-a.md`](scheduler-path-a.md) and follow its steps.**

### Use Path B when ANY of these are true:
- Cron expression comes from runtime configuration (e.g., `config.cronExpression()`)
- Multiple cron expressions or schedules in one class
- Class implements `org.apache.sling.commons.scheduler.Job` (not `Runnable`)
- Scheduling uses `ScheduleOptions.config()` to pass job properties
- Business logic needs access to job context/properties at execution time
- `@Modified` method re-registers schedules with new config values

**If Path B → read [`scheduler-path-b.md`](scheduler-path-b.md) and follow its steps.**

## Scheduler-Specific Rules

- **CLASSIFY FIRST** — determine Path A or Path B before making any changes.
- **DO NOT** invent cron expressions — extract the exact value from existing code,
  legacy `@Property` annotations, or legacy metatype.
- **DO NOT** use `@SlingScheduled` — the annotation does **not** exist in the AEMaaCS SDK;
  schedules on a `Runnable` service are always declared via the
  `scheduler.expression` / `scheduler.concurrent` / `scheduler.runOn` OSGi component properties.
- **DO** set `scheduler.concurrent:Boolean=false` unless overlapping runs are explicitly desired.
- **DO** set `scheduler.runOn=SINGLE` (or `LEADER`) when the job writes to the repository or
  calls external systems — otherwise it will fire on **every publish pod**.
- **DO** distribute `@Reference` fields correctly in Path B: business logic services
  (e.g. `ExampleService`, `ResourceResolverFactory`) go to the `JobConsumer`; infrastructure
  services (e.g. `SlingSettingsService`, `JobManager`) stay in the Scheduler class.

## IMPORTANT

**Read ONLY the path file that matches your classification. Do NOT read both.**
