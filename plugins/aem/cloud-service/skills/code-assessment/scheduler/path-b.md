# Scheduler Path B — Sling Jobs via JobManager

For schedulers with config-driven crons, multiple schedules, `implements Job`, or `ScheduleOptions.config()`.

Path B splits the original class into **two** classes:
1. **Scheduler class** — registers and unregisters jobs via `JobManager`
2. **JobConsumer class** — executes business logic when the job fires

Business `@Reference` fields (e.g. `ResourceResolverFactory`, domain services) go to the
**JobConsumer**. Infrastructure fields (`JobManager`, `SlingSettingsService`) stay in the
**Scheduler class**.

**Before starting:** Read [`../references/aem-cloud-service-pattern-prerequisites.md`](../references/aem-cloud-service-pattern-prerequisites.md)
and apply SCR→DS and ResourceResolver fixes.

---

## B1: Create the Scheduler class (job registration)

```java
import org.apache.sling.event.jobs.JobManager;
import org.apache.sling.event.jobs.ScheduledJobInfo;
import org.osgi.service.component.annotations.*;
import org.osgi.service.metatype.annotations.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

@Component(immediate = true)
@Designate(ocd = AssetPurgeScheduler.Config.class)
public class AssetPurgeScheduler {

    private static final Logger LOG = LoggerFactory.getLogger(AssetPurgeScheduler.class);
    private static final String JOB_TOPIC = "com/example/asset/purge";

    @Reference
    private JobManager jobManager;

    @Activate
    @Modified
    protected void activate(Config config) {
        LOG.info("AssetPurgeScheduler activated");
        unscheduleExistingJobs();
        if (config.enabled()) {
            scheduleJob(config);
        }
    }

    @Deactivate
    protected void deactivate() {
        unscheduleExistingJobs();
        LOG.info("AssetPurgeScheduler deactivated");
    }

    private void scheduleJob(Config config) {
        Map<String, Object> jobProperties = new HashMap<>();
        jobProperties.put("assetPath", config.assetPath());

        ScheduledJobInfo info = jobManager
            .createJob(JOB_TOPIC)
            .properties(jobProperties)
            .schedule()
            .cron(config.cronExpression())
            .add();

        if (info == null) {
            LOG.error("Failed to create scheduled job for topic {}", JOB_TOPIC);
        } else {
            LOG.info("Scheduled job created with cron: {}", config.cronExpression());
        }
    }

    private void unscheduleExistingJobs() {
        new ArrayList<>(jobManager.getScheduledJobs(JOB_TOPIC, 0, null)).forEach(ScheduledJobInfo::unschedule);
    }

    @ObjectClassDefinition(name = "Asset Purge Scheduler Config")
    public @interface Config {
        @AttributeDefinition(name = "Enabled") boolean enabled() default true;
        @AttributeDefinition(name = "Cron Expression") String cronExpression() default "0 0 2 * * ?";
        @AttributeDefinition(name = "Asset Path") String assetPath() default "/content/dam";
    }
}
```

Key changes from legacy:
- Remove `implements Job` / `implements Runnable`
- Replace `@Reference Scheduler` with `@Reference JobManager`
- `@Activate` and `@Modified` share the same method
- `unscheduleExistingJobs()` prevents duplicate schedules on config update
- Keep infrastructure `@Reference` fields (`JobManager`, `SlingSettingsService`) in the Scheduler class; move business `@Reference` fields (`ResourceResolverFactory`, domain services) to the `JobConsumer`
- **`canRunConcurrently(false)`** — drop it if present in legacy code; Sling Jobs have no direct equivalent; concurrency is controlled via job queue OSGi config, not in code

**Author-only schedulers:** If the job must only run on author (e.g. replication triggers, workflow launchers), guard in `activate()` using `SlingSettingsService`:

```java
@Reference
private SlingSettingsService slingSettingsService;

@Activate
@Modified
protected void activate(Config config) {
    unscheduleExistingJobs();
    if (config.enabled() && slingSettingsService.getRunModes().contains("author")) {
        scheduleJob(config);
    }
}
```

Import: `import org.apache.sling.settings.SlingSettingsService;`

**Idempotency guard (alternative pattern):** If you need to avoid cancelling a running schedule on config refresh, check existence *before* any unschedule call. Do **not** combine with `unscheduleExistingJobs()` in the same flow — after unscheduling, `doesScheduledJobExist()` is always `false`, making the guard a no-op:

```java
// Alternative: check first, skip if already scheduled
@Activate
@Modified
protected void activate(Config config) {
    if (config.enabled() && !doesScheduledJobExist()) {
        scheduleJob(config);
    }
    // Note: no unscheduleExistingJobs() here — the guard is only useful
    // when you want to preserve an existing schedule across config updates
}

private boolean doesScheduledJobExist() {
    return !jobManager.getScheduledJobs(JOB_TOPIC, 0, null).isEmpty();
}
```

For most migrations, the standard pattern above (unschedule then reschedule unconditionally) is correct and simpler.

> **Limitation of the guard:** if `doesScheduledJobExist()` returns `true` but the admin has changed `cronExpression` in OSGi config, the old schedule is silently kept — the new cron never takes effect until the instance restarts or the job is manually unscheduled. The standard unschedule-then-reschedule flow does not have this problem.

---

## B2: Create the JobConsumer class (business logic)

```java
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.event.jobs.Job;
import org.apache.sling.event.jobs.consumer.JobConsumer;
import org.apache.sling.event.jobs.consumer.JobResult;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Collections;

@Component(
    service = JobConsumer.class,
    property = { JobConsumer.PROPERTY_TOPICS + "=com/example/asset/purge" }
)
public class AssetPurgeJobConsumer implements JobConsumer {

    private static final Logger LOG = LoggerFactory.getLogger(AssetPurgeJobConsumer.class);

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public JobResult process(final Job job) {
        final String assetPath = job.getProperty("assetPath", String.class);

        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "scheduler-service"))) {

            LOG.info("Purging assets at: {}", assetPath);
            // === business logic from original run()/execute() goes here ===
            return JobResult.OK;

        } catch (LoginException e) {
            LOG.error("Failed to get resource resolver for 'scheduler-service'", e);
            return JobResult.FAILED;
        } catch (Exception e) {
            LOG.error("Error executing scheduled job for path {}", assetPath, e);
            return JobResult.FAILED;
        }
    }
}
```

Rules:
- Job topic **must** match the Scheduler class constant exactly
- Read job properties via `job.getProperty("key", Type.class)` — not `JobUtil.getProperty(...)` (deprecated)
- Return `JobResult.OK` on success, `JobResult.FAILED` for retryable failure, `JobResult.CANCEL` for unrecoverable

---

## B3: Multiple cron expressions in one legacy class

Split into one `scheduleJob` call per schedule:

```java
private void scheduleJobs(Config config) {
    scheduleLocaleJob(config.enCronExpression(), config.enAssetPath(), "en");
    scheduleLocaleJob(config.frCronExpression(), config.frAssetPath(), "fr");
}

private void scheduleLocaleJob(String cron, String path, String locale) {
    Map<String, Object> props = Map.of("assetPath", path, "locale", locale);
    jobManager.createJob(JOB_TOPIC).properties(props).schedule().cron(cron).add();
}
```

---

## B4: Update imports

**Scheduler class — Remove:**
```java
import org.apache.sling.commons.scheduler.Scheduler;
import org.apache.sling.commons.scheduler.ScheduleOptions;
import org.apache.sling.commons.scheduler.Job;
import org.apache.sling.commons.scheduler.JobContext;
import org.apache.felix.scr.annotations.*;
import org.apache.sling.commons.osgi.PropertiesUtil;
```

**Scheduler class — Add:**
```java
import org.apache.sling.event.jobs.JobManager;
import org.apache.sling.event.jobs.ScheduledJobInfo;
import org.apache.sling.settings.SlingSettingsService;
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Deactivate;
import org.osgi.service.component.annotations.Modified;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.metatype.annotations.Designate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
```

**JobConsumer class — Add:**
```java
import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.event.jobs.Job;
import org.apache.sling.event.jobs.consumer.JobConsumer;
import org.apache.sling.event.jobs.consumer.JobResult;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Collections;
```

---

## B5: Verify `@Activate`, `@Modified`, `@Deactivate` lifecycle

OSGi DS allows `@Activate` and `@Modified` on the **same method** — it fires at component start and on every config change. This is the simplest form when both need the same logic:

```java
@Activate
@Modified
protected void activate(Config config) {
    unscheduleExistingJobs();
    if (config.enabled()) {
        scheduleJob(config);
    }
}

@Deactivate
protected void deactivate() {
    unscheduleExistingJobs();
}
```

**Alternative — separate `@Modified` method.** If the surrounding bundle uses separate methods, delegate from `modified` to `activate`:

```java
@Activate
protected void activate(Config config) {
    unscheduleExistingJobs();
    if (config.enabled()) { scheduleJob(config); }
}

@Modified
protected void modified(Config config) {
    activate(config);
}

@Deactivate
protected void deactivate() {
    unscheduleExistingJobs();
}
```

**Do NOT mix both styles in the same class.** Match whichever pattern the surrounding bundle already uses.

---

## Path B — Validation checklist

**Scheduler class:**
- [ ] No `import org.apache.sling.commons.scheduler.Scheduler` remains
- [ ] No `implements Runnable` or `implements Job` on the Scheduler class
- [ ] No `scheduler.schedule(` calls remain
- [ ] `@Reference JobManager` present
- [ ] Uses `jobManager.createJob(TOPIC).properties(...).schedule().cron(...).add()`
- [ ] `unscheduleExistingJobs()` clears existing schedule by topic before re-scheduling
- [ ] `@Activate`, `@Modified`, `@Deactivate` manage job lifecycle

**JobConsumer class:**
- [ ] `implements JobConsumer`
- [ ] `@Component(service = JobConsumer.class, property = { PROPERTY_TOPICS + "=<same-topic>" })`
- [ ] Job topic constant matches the Scheduler class exactly
- [ ] Business logic from original `run()`/`execute()` fully preserved
- [ ] Returns `JobResult.OK` / `FAILED` / `CANCEL` — not void, not boolean
- [ ] Resolver in try-with-resources using `getServiceResourceResolver(SUBSERVICE)`
- [ ] `job.getProperty("key", Type.class)` used — not deprecated `JobUtil`
