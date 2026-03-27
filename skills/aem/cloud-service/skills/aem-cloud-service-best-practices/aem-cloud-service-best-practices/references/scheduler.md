# Scheduler Migration Pattern

Migrates AEM schedulers from legacy patterns to Cloud Service compatible patterns.

**Before path-specific steps:** [aem-cloud-service-pattern-prerequisites.md](aem-cloud-service-pattern-prerequisites.md) (SCR→DS, resolver, logging).

**Two paths based on complexity:**
- **Path A (@SlingScheduled):** Simple schedulers — hardcoded cron, single schedule, `implements Runnable`
- **Path B (Sling Job):** Complex schedulers — config-driven crons, multiple schedules, `implements Job`

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
@Component(service = Runnable.class)
public class MyScheduler implements Runnable {
    @Reference private ResourceResolverFactory resolverFactory;
    
    @Override
    @SlingScheduled(expression = "*/30 * * * * ?")
    public void run() {
        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "scheduler-service"))) {
            // business logic
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
- Cron expression is a hardcoded string constant (not from runtime configuration)
- Only one schedule/cron per class
- Class implements `Runnable` (not `Job`)
- No complex scheduling logic (no `ScheduleOptions.config()`, no job properties)

**If Path A → read `resources/scheduler-path-a.md` and follow its steps.**

### Use Path B when ANY of these are true:
- Cron expression comes from runtime configuration (e.g., `config.cronExpression()`)
- Multiple cron expressions or schedules in one class
- Class implements `org.apache.sling.commons.scheduler.Job` (not `Runnable`)
- Scheduling uses `ScheduleOptions.config()` to pass job properties
- Business logic needs access to job context/properties at execution time
- `@Modified` method re-registers schedules with new config values

**If Path B → read `resources/scheduler-path-b.md` and follow its steps.**

## Scheduler-Specific Rules

- **CLASSIFY FIRST** — determine Path A or Path B before making any changes
- **DO NOT** invent cron expressions — extract from existing code or @Property annotations
- **DO NOT** use `@SlingScheduled` with runtime config values — it requires compile-time constants
- **DO** distribute `@Reference` fields correctly in Path B: business logic services (e.g., `ExampleService`, `ResourceResolverFactory`) go to JobConsumer, infrastructure services (e.g., `SlingSettingsService`, `JobManager`) stay in Scheduler class

## IMPORTANT

**Read ONLY the path file that matches your classification. Do NOT read both.**
