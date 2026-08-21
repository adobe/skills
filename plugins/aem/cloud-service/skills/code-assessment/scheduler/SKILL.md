---
name: scheduler
description: AEM Cloud Service expert skill for Sling Scheduler. Routes to path-a.md (Runnable + OSGi properties) or path-b.md (Sling Jobs via JobManager). Covers classification, CS-specific constraints (no @SlingScheduled, multi-pod runOn, Boolean type hint), review checklist, troubleshooting fingerprints, and common pitfalls.
license: Apache-2.0
---

# Scheduler — AEM as a Cloud Service

## Overview

Schedules in AEM CS **must be declared as OSGi component properties** — `Scheduler.schedule()` is not persisted across restarts. There is **no `@SlingScheduled` annotation** in the CS SDK.

Three properties control every scheduler:

| Property | Required value | Why |
|----------|---------------|-----|
| `scheduler.expression` | Valid Quartz cron string | Declares the trigger |
| `scheduler.concurrent:Boolean=false` | `:Boolean` type hint required | Without the hint OSGi treats it as String and concurrent runs are not suppressed |
| `scheduler.runOn` | `SINGLE` or `LEADER` for any write or external call | Default `ALL` fires on every publish pod simultaneously |

---

## Classification — choose before making any changes

**Path A — Runnable + OSGi component properties** when ALL are true:
- Cron is a hardcoded constant or single `@AttributeDefinition`-backed value
- Only one schedule per class
- Class `implements Runnable`
- No `ScheduleOptions.config()`, no per-execution job payload

→ Read [path-a.md](path-a.md) and follow its steps.

**Path B — Sling Jobs via JobManager** when ANY is true in the **legacy source**:
- Cron comes from runtime config (`config.cronExpression()`)
- Multiple cron expressions per class
- Legacy code needs per-execution job data, config-driven scheduling, or a Scheduler + JobConsumer split
- Business logic needs job context or properties at execution time
- `@Modified` re-registers schedules with new config values

→ Read [path-b.md](path-b.md) and follow its steps.

**One pattern per session.** If the codebase has both kinds, fix one class at a time.

---

## Discovery

Detection is performed by the analyzer ([`../scripts/analyze.sh`](../scripts/README.md)), run by the runbook:

```bash
bash ../scripts/analyze.sh <workspace-root> --pattern scheduler
```

**Match criteria (what the detector flags):**

- A class that **`implements org.apache.sling.commons.scheduler.Job`** (import-aware).
- The **OSGi-property scheduler** shape — a class that **`implements Runnable`** and carries an OSGi `@Component` declaring a `scheduler.expression` / `scheduler.name` / `scheduler.period` property.
- A file that **imports `org.apache.sling.commons.scheduler.Scheduler`** (programmatic use via an injected `Scheduler`) but has no class-level match — one finding at the file's primary type.

Emitted at the class declaration, with the class header as the snippet. Parse-level only — direct `implements` clause and same-file `@Component`; reached-via-base-class and constant-valued properties are not resolved.

## Resolution contract

**guided** — `apply (guided)`. The analyzer locates and reports each scheduler class; remediation is judgment-based and routed by the Classification above to **Path A** ([path-a.md](path-a.md), Runnable + OSGi properties) or **Path B** ([path-b.md](path-b.md), Sling Jobs via `JobManager`). Open the chosen path and apply its steps in an apply session.

| Site shape | Disposition |
|---|---|
| Single-schedule, hardcoded cron, `implements Runnable` | apply (guided) → path-a.md |
| Config-driven cron, multiple schedules, `implements Job`, or `ScheduleOptions.config()` | apply (guided) → path-b.md |
| Already Sling Jobs via `JobManager` with single-execution guard | skipped: `already-compliant` |
| Test code (`src/test/`) | skipped: `test-scope` |

---

## Review Checklist

Use the path-specific checklists in [path-a.md](path-a.md) and [path-b.md](path-b.md) for scheduler mechanics.

Cross-cutting checks:
- [ ] The chosen path matches the source shape: Path A for a single hardcoded cron + `Runnable`; Path B for config-driven or multi-schedule legacy code
- [ ] No `@SlingScheduled` annotation
- [ ] No `scheduler.schedule()`, `scheduler.unschedule()`, or `scheduler.EXPR()` calls in the migrated code
- [ ] `getServiceResourceResolver` used — not `getAdministrativeResourceResolver`
- [ ] ResourceResolver in try-with-resources — not stored as a field
- [ ] OSGi DS R6 annotations (`org.osgi.service.component.annotations`) — no Felix SCR
- [ ] Service user subservice name matches a `ServiceUserMapperImpl.amended` config

Path A checks:
- [ ] `scheduler.expression` is a valid Quartz cron string (6 or 7 fields)
- [ ] `scheduler.concurrent:Boolean=false` present with the `:Boolean` type hint
- [ ] `scheduler.runOn=SINGLE` or `LEADER` set when the job writes to repo or calls external systems

Path B checks:
- [ ] The job topic constant is shared between the Scheduler and JobConsumer classes
- [ ] Job properties are read with `job.getProperty("key", Type.class)`
- [ ] `JobResult.OK`, `FAILED`, or `CANCEL` is returned from the consumer

---

## Troubleshooting

| Symptom | Log to search | Fix direction |
|---------|--------------|--------------|
| Scheduler never fires after deployment | none (silent) | Inspect the component's runtime state: if `UNSATISFIED`, the cause is usually a missing config or a misspelled config field name (`scheduler_expression()` in Path A, `cronExpression()` in Path B); if `ACTIVE` but no executions, the cron property name is misspelled or `scheduler.expression` is invalid |
| Fires N times per trigger (N = pod count) | none | Add `scheduler.runOn=SINGLE` to `@Component` property array |
| Two instances run simultaneously | none | Add `scheduler.concurrent:Boolean=false` — the `:Boolean` type hint is mandatory |
| Stops firing with no code change; unrelated workflows also stall | `RejectedExecutionException` in `sling-default` pool entries | Thread pool starvation — see diagnosis below |

**Thread pool starvation root cause chain:**
1. A scheduler makes a blocking call (HTTP/LDAP/DB) without a read timeout
2. `scheduler.concurrent` missing/`true` → new thread per trigger
3. All `ApacheSlingdefault` threads stuck
4. `block policy=ABORT` silently rejects new submissions — no log, no execution

Diagnose: Developer Console → Thread Pool → `ApacheSlingdefault` → check `active count` vs `max pool size` and `block policy`.
Fix: add HTTP read timeout to the blocking scheduler; set `scheduler.concurrent:Boolean=false`; change `block policy` to `RUN` via OSGi config in Git.

---

## Common Pitfalls

**`@SlingScheduled` used** — the annotation does not exist in the CS SDK; class compiles but schedule is never registered (silent failure).

**`scheduler.schedule()` in `@Activate`** — dynamic registration is not persisted across restarts; schedule disappears on next deployment.

**Missing `scheduler.runOn` on a write-side scheduler** — default `ALL` fires on every publish pod; 3 pods = 3× the JCR writes / external calls per trigger.

**Static `ResourceResolver` field** — closed by the repo after idle timeout; subsequent `run()` invocations throw `ClosedResourceResolverException`.

**`scheduler.concurrent=false` without `:Boolean` type hint** — OSGi treats it as String, concurrent execution is not suppressed.

---

## Modern Alternatives

| Requirement | Use |
|-------------|-----|
| Stateless periodic task, missed runs on restart OK | Sling Scheduler — Path A |
| Config-driven cron or multiple schedules | Sling Jobs — Path B |
| Task must survive instance restart | Sling Jobs (`JobManager.createJob().schedule().cron()`) |
| Exactly-once across entire cluster | Sling Jobs + `JobConsumer` |
| Automatic retry on failure | Sling Jobs (retry per queue config) |
| Per-execution parameters | Sling Jobs (`JobBuilder.properties()`) |
| Event-driven + time-driven | Sling Jobs (triggered by both `addJob()` and `schedule()`) |
