# Scheduler Migration Pattern

Migrates AEM schedulers from legacy patterns to Cloud Service compatible patterns.

**Two paths based on complexity:**
- **Path A (@SlingScheduled):** Simple schedulers — hardcoded cron, single schedule, `implements Runnable`
- **Path B (Sling Job):** Complex schedulers — config-driven crons, multiple schedules, `implements Job`

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
