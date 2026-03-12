# Scheduler Path B: Sling Job (Complex Schedulers)

For schedulers with config-driven crons, multiple schedules, `implements Job`, or `ScheduleOptions.config()`.

This path splits the original class into TWO classes:
1. **Scheduler class** — registers/unregisters Sling Jobs via `JobManager`
2. **JobConsumer class** — executes the business logic when the job fires

---

## B1: Migrate Felix SCR to OSGi DS annotations (if present)

If the file uses Felix SCR annotations (`org.apache.felix.scr.annotations.*`), migrate to OSGi DS:

**Remove Felix SCR imports:**
```java
import org.apache.felix.scr.annotations.Activate;
import org.apache.felix.scr.annotations.Component;
import org.apache.felix.scr.annotations.Properties;
import org.apache.felix.scr.annotations.Property;
import org.apache.felix.scr.annotations.Service;
```

**Replace annotations:**
```java
// BEFORE (Felix SCR)
@Component(metatype = true, ...)
@Service(value = Runnable.class)
@Properties({ @Property(...) })

// AFTER (OSGi DS)
@Component(immediate = true)
```

## B2: Create the Scheduler class (job registration)

Transform the existing class into a job registration class:

```java
// BEFORE
@Component(service = Job.class, immediate = true)
@Designate(ocd = SchedulerConfig.class)
public class AssetPurgeScheduler implements Job {
    @Reference Scheduler scheduler;

    @Activate
    private void activate(SchedulerConfig config) {
        addScheduler(config);
    }

    @Override
    public void execute(JobContext context) {
        // business logic
    }
}

// AFTER
@Component(immediate = true)
@Designate(ocd = SchedulerConfig.class)
public class AssetPurgeScheduler {
    private static final Logger LOG = LoggerFactory.getLogger(AssetPurgeScheduler.class);
    private static final String JOB_TOPIC = "com/example/asset/purge";

    @Reference
    private JobManager jobManager;

    @Activate
    @Modified
    protected void activate(SchedulerConfig config) {
        LOG.info("Scheduler activated");
        unscheduleExistingJobs();
        if (config.enabled()) {
            scheduleJob(config);
        }
    }

    @Deactivate
    protected void deactivate() {
        unscheduleExistingJobs();
        LOG.info("Scheduler deactivated");
    }

    private void scheduleJob(SchedulerConfig config) {
        Map<String, Object> jobProperties = new HashMap<>();
        jobProperties.put("assetPath", config.assetPath());

        JobBuilder.ScheduleBuilder scheduleBuilder = jobManager
            .createJob(JOB_TOPIC)
            .properties(jobProperties)
            .schedule();
        scheduleBuilder.cron(config.cronExpression());

        ScheduledJobInfo info = scheduleBuilder.add();
        if (info == null) {
            LOG.error("Failed to create scheduled job");
        } else {
            LOG.info("Scheduled job created with cron: {}", config.cronExpression());
        }
    }

    private void unscheduleExistingJobs() {
        Collection<ScheduledJobInfo> jobs = jobManager.getScheduledJobs(JOB_TOPIC, 0, null);
        for (ScheduledJobInfo job : jobs) {
            job.unschedule();
        }
    }
}
```

**Key changes:**
- Remove `implements Job` or `implements Runnable`
- Replace `@Reference Scheduler scheduler` with `@Reference JobManager jobManager`
- Remove `@Component(service = ...)` — use `@Component(immediate = true)` only
- Keep `@Activate` and `@Deactivate`
- Keep `@Modified` — it re-registers jobs with new config values
- Move business logic out (goes to JobConsumer in B3)
- Keep environment guards (e.g., `isAuthor()` run mode check) in the Scheduler class
- Keep infrastructure `@Reference` fields (e.g., `SlingSettingsService`) in Scheduler; move business `@Reference` fields (e.g., `ExampleService`, `ResourceResolverFactory`) to JobConsumer

**Idempotency guard (recommended):** Add a `doesScheduledJobExist()` check before scheduling:

```java
@Activate
@Modified
protected void activate(SchedulerConfig config) {
    if (isAuthor() && config.enabled() && !doesScheduledJobExist()) {
        scheduleJob(config);
    }
}

private boolean doesScheduledJobExist() {
    Collection<ScheduledJobInfo> jobs = jobManager.getScheduledJobs(JOB_TOPIC, 0, null);
    return !jobs.isEmpty();
}
```

**Note on `canRunConcurrently()`:** The original code may use `scheduleOptions.canRunConcurrently(false)`. Sling Jobs do not have a direct equivalent — concurrency is controlled via job queue configuration in OSGi. This setting can be safely dropped during migration.

## B3: Create the JobConsumer class (business logic)

Create a NEW class that implements `JobConsumer`:

```java
package com.example.schedulers;

import org.apache.sling.api.resource.LoginException;
import org.apache.sling.api.resource.ResourceResolver;
import org.apache.sling.api.resource.ResourceResolverFactory;
import org.apache.sling.event.jobs.Job;
import org.apache.sling.event.jobs.consumer.JobConsumer;
import org.apache.sling.event.jobs.consumer.JobResult;
import org.apache.sling.event.jobs.consumer.JobUtil;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Collections;

@Component(
    service = JobConsumer.class,
    property = {
        JobConsumer.PROPERTY_TOPICS + "=" + "com/example/asset/purge"
    }
)
public class AssetPurgeJobConsumer implements JobConsumer {

    private static final Logger LOG = LoggerFactory.getLogger(AssetPurgeJobConsumer.class);

    @Reference
    private ResourceResolverFactory resolverFactory;

    @Override
    public JobResult process(final Job job) {
        String assetPath = job.getProperty("assetPath", String.class);
        LOG.info("Processing asset purge job for path: {}", assetPath);

        try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
                Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "scheduler-service"))) {

            if (resolver == null) {
                LOG.warn("Could not acquire resource resolver");
                return JobResult.FAILED;
            }

            // === EXISTING BUSINESS LOGIC FROM run()/execute() GOES HERE ===

            return JobResult.OK;

        } catch (LoginException e) {
            LOG.error("Failed to get resource resolver", e);
            return JobResult.FAILED;
        } catch (Exception e) {
            LOG.error("Error executing scheduled job", e);
            return JobResult.FAILED;
        }
    }
}
```

**Key rules for JobConsumer:**
- Job topic MUST match the topic used in the Scheduler class
- Move ALL business logic from `run()` or `execute(JobContext)` into `process(Job)`
- Move business-logic `@Reference` fields here (e.g., `ExampleService`, `ResourceResolverFactory`)
- Extract job properties via `job.getProperty("key", Type.class)` or `JobUtil.getProperty(job, "key", Type.class)` (both valid)
- Map `jobContext.getConfiguration().get("key")` (old) to `job.getProperty("key", Type.class)` (new)
- Return `JobResult.OK` on success, `JobResult.FAILED` on failure
- Replace `getAdministrativeResourceResolver()` with `getServiceResourceResolver()`
- Add SLF4J Logger

## B4: Handle multiple cron expressions (if applicable)

If the original scheduler has multiple cron expressions (e.g., per locale), create separate scheduled jobs for each:

```java
// BEFORE: multiple scheduler.schedule() calls
scheduler.schedule(this, enScheduleOptions);  // English
scheduler.schedule(this, frScheduleOptions);  // French
scheduler.schedule(this, inScheduleOptions);  // Indian

// AFTER: multiple jobManager.createJob() calls
private void scheduleJobs(SchedulerConfig config) {
    scheduleJob(config.enCronExpression(), config.enAssetPath(), "en");
    scheduleJob(config.frCronExpression(), config.frAssetPath(), "fr");
    scheduleJob(config.inCronExpression(), config.inAssetPath(), "in");
}

private void scheduleJob(String cron, String assetPath, String locale) {
    Map<String, Object> props = new HashMap<>();
    props.put("assetPath", assetPath);
    props.put("locale", locale);

    JobBuilder.ScheduleBuilder builder = jobManager
        .createJob(JOB_TOPIC)
        .properties(props)
        .schedule();
    builder.cron(cron);
    builder.add();
    LOG.info("Scheduled {} job with cron: {}", locale, cron);
}
```

## B5: Replace System.out with SLF4J Logger

Add Logger in both Scheduler and JobConsumer classes:

```java
private static final Logger LOG = LoggerFactory.getLogger(MyClass.class);

// REPLACE
System.out.println("message")  ->  LOG.info("message")
```

## B6: Replace deprecated ResourceResolver APIs

Replace deprecated `getAdministrativeResourceResolver()` in the JobConsumer:

```java
// BEFORE (deprecated)
ResourceResolver resolver = resourceResolverFactory.getAdministrativeResourceResolver(null);

// AFTER
try (ResourceResolver resolver = resolverFactory.getServiceResourceResolver(
        Collections.singletonMap(ResourceResolverFactory.SUBSERVICE, "scheduler-service"))) {
    // use resolver
} catch (LoginException e) {
    LOG.error("Failed to get resource resolver", e);
}
```

## B7: Update imports

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
import org.apache.sling.event.jobs.JobBuilder;
import org.apache.sling.event.jobs.JobManager;
import org.apache.sling.event.jobs.ScheduledJobInfo;
import org.osgi.service.component.annotations.Activate;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Deactivate;
import org.osgi.service.component.annotations.Modified;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.metatype.annotations.Designate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Collection;
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
import org.apache.sling.event.jobs.consumer.JobUtil;  // optional, for JobUtil.getProperty()
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Collections;
```

## B8: Verify @Activate, @Modified, @Deactivate lifecycle

```java
@Activate
@Modified
protected void activate(SchedulerConfig config) {
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

---

# Validation Checklist

**Scheduler class:**
- [ ] No `import org.apache.sling.commons.scheduler.Scheduler;` remains
- [ ] No `implements Runnable` or `implements Job` remains
- [ ] No `scheduler.schedule(` calls remain
- [ ] No Felix SCR annotations remain
- [ ] Uses `@Reference JobManager jobManager`
- [ ] Uses `jobManager.createJob(TOPIC).properties(...).schedule().cron(...).add()`
- [ ] Has `unscheduleExistingJobs()` method
- [ ] `@Activate` and `@Deactivate` properly manage job lifecycle
- [ ] `@Modified` re-registers jobs if present
- [ ] SLF4J Logger is present

**JobConsumer class:**
- [ ] Implements `JobConsumer`
- [ ] Has `@Component(service = JobConsumer.class, property = {"job.topics=..."})`
- [ ] Job topic matches the Scheduler class topic
- [ ] Business logic from original `run()`/`execute()` is preserved
- [ ] Returns `JobResult.OK` or `JobResult.FAILED`
- [ ] No `getAdministrativeResourceResolver()` — uses `getServiceResourceResolver()`
- [ ] ResourceResolver in try-with-resources
- [ ] SLF4J Logger is present
- [ ] Code compiles: `mvn clean compile`
