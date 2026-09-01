# RV — Render & Validate

Verification layer for the AEM Cloud Service migration skills. After a skill
applies a pattern change, RV proves the result is **Cloud-Service correct** and
turns failures into permanent regression tests.

> Status: **prototype / reference implementation.** Proven end-to-end on the
> `scheduler` pattern against a real AEM Cloud Service SDK. Other patterns and
> full harness automation are not yet built.

## Two gates per pattern

1. **Source gate** (offline, no instance) — proves the migrated code is correct:
   `invariants/scheduler-source.js` checks SCR→DS, `scheduler.expression`,
   `scheduler.concurrent:Boolean`, `scheduler.runOn=SINGLE|LEADER`.
2. **Runtime gate** (needs a Cloud SDK) — proves it actually works:
   `invariants/scheduler.js` checks the component is active and *fires*.

## The loop

```
skill migrates code → verify → outcome record → (fail?) → auto-generated eval fixture
```

## Run it

```bash
# source gate — before vs after the skill (instant, no instance)
node verify.js scheduler example/SimpleScheduledTask.legacy.java     # FAIL + writes eval fixture
node verify.js scheduler example/SimpleScheduledTask.migrated.java   # PASS

# leadership dashboard (real data: runs verify.js + reads the live Cloud SDK on 4602)
cd ui && node server.js      # http://localhost:4700
```

## Files

| File | Role |
|---|---|
| `verify.js` | one-command loop: source gate → outcome → fixture |
| `runner.js` | orchestrator (static gate + runtime invariant → outcome record) |
| `invariants/scheduler-source.js` | offline source contract check |
| `invariants/scheduler.js` | runtime firing check (via `probe.js`) |
| `probe.js` / `mock-probe.js` | live AEM client / offline simulator |
| `static-gate.js` | compile · AEM Analyser · detector→0 (degrades to skipped) |
| `fixture.js` | failure → `evals/<name>/{task.md,criteria.json}` |
| `ui/server.js` | dependency-free dashboard (port 4700) |
| `example/` | WKND legacy vs skill-migrated scheduler |

## Verified against a real Cloud SDK

The `scheduler` migration was built into an OSGi bundle and deployed to an AEM
Cloud Service SDK: component registered **active** as OSGi DS with
`runOn=LEADER`, and fired on schedule (confirmed via OSGi console + instance log).
