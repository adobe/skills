# Workflow Orchestrator — AEM 6.5 LTS

## Purpose

This is the **master entry point** for all AEM Workflow tasks on AEM 6.5 LTS — spanning both **development** (building workflows) and **production support** (debugging and triaging workflow issues). Read this skill first. It classifies the user's request and routes to the right sub-skill.

## How to Use This Skill

1. Read the user's request carefully
2. Classify it using the **Task Classifier** table below
3. Load the identified sub-skill's `SKILL.md` and its references
4. For development tasks, always load the `workflow-foundation` references alongside the sub-skill references
5. For production-support tasks, the debugging and triaging skills are self-contained

---

## Task Classifier

### Development Skills

| User Says / Asks | Sub-Skill to Load |
|---|---|
| "Create a workflow model", "Add steps to a workflow", "Design an OR split", "I need a parallel review" | `workflow-model-design` |
| "Implement a custom process step", "Write a WorkflowProcess", "Create a ParticipantStepChooser", "Dynamic participant" | `workflow-development` |
| "Start a workflow from code", "Trigger a workflow via API", "Use Manage Publication with a workflow", "HTTP REST API to start a workflow" | `workflow-triggering` |
| "Configure a launcher", "Auto-start on asset upload", "Launcher not firing", "cq:WorkflowLauncher", "Overlay an OOTB launcher" | `workflow-launchers` |
| "How do workflows work?", "What is the Granite Workflow Engine?", "Explain workflow architecture" | Load `workflow-foundation` references only |

### Production Support Skills

| User Says / Asks | Sub-Skill to Load |
|---|---|
| "Workflow is stuck", "Why isn't my workflow advancing?", "No work item", "Workflow failed", "Step shows error" | `workflow-debugging` |
| "Task not in Inbox", "User can't see work item", "Permissions error on workflow" | `workflow-debugging` |
| "Thread pool exhausted", "Auto-advancement not working", "Queue backlog", "Sling Jobs stuck" | `workflow-debugging` |
| "Repository bloat", "Too many workflow instances", "Purge not working", "Stale workflows" | `workflow-debugging` |
| "countStaleWorkflows", "restartStaleWorkflows", "retryFailedWorkItems", "JMX workflow" | `workflow-debugging` |
| "What workflow errors on host X?", "Workflow activity for the past N hours", "What should I collect?" | `workflow-triaging` |
| "Classify this workflow ticket", "What Splunk query should I use?", "What logs do I need?" | `workflow-triaging` |
| "Why did workflow X fail? Show me the error.", "Failure details for model Y" | `workflow-triaging` |
| "What does JMX returnSystemJobInfo show?", "Check queue depth via JMX" | `workflow-triaging` |

**Routing heuristic:**
- Building/implementing workflows → development skills (`workflow-model-design`, `workflow-development`, `workflow-triggering`, `workflow-launchers`)
- Deep troubleshooting (decision trees, config checks, thread analysis, JMX remediation) → `workflow-debugging`
- Incident classification (symptom → runbook, log patterns, Splunk, JMX metrics, data gathering) → `workflow-triaging`
- When both debugging and triaging apply, start with `workflow-triaging` to classify, then `workflow-debugging` for resolution

---

## Reference Loading Order

For every workflow task on AEM 6.5 LTS, load in this order:

### Step 1: Always load these foundation references

```
workflow-orchestrator/references/workflow-foundation/architecture-overview.md
workflow-orchestrator/references/workflow-foundation/api-reference.md
workflow-orchestrator/references/workflow-foundation/jcr-paths-reference.md
workflow-orchestrator/references/workflow-foundation/65-lts-guardrails.md
workflow-orchestrator/references/workflow-foundation/quick-start-guide.md
```

### Step 2: Load the sub-skill's SKILL.md

```
workflow-model-design/SKILL.md         ← for model design tasks
workflow-development/SKILL.md          ← for Java implementation tasks
workflow-triggering/SKILL.md           ← for start/trigger tasks
workflow-launchers/SKILL.md            ← for launcher config tasks
workflow-debugging/SKILL.md            ← for production debugging tasks
workflow-triaging/SKILL.md             ← for incident triage tasks
```

### Step 3: Load the sub-skill's topic references

**workflow-model-design:**
```
workflow-model-design/references/workflow-model-design/step-types-catalog.md
workflow-model-design/references/workflow-model-design/model-xml-reference.md
workflow-model-design/references/workflow-model-design/model-design-patterns.md
```

**workflow-development:**
```
workflow-development/references/workflow-development/process-step-patterns.md
workflow-development/references/workflow-development/participant-step-patterns.md
workflow-development/references/workflow-development/variables-and-metadata.md
```

**workflow-triggering:**
```
workflow-triggering/references/workflow-triggering/triggering-mechanisms.md
workflow-triggering/references/workflow-triggering/programmatic-api.md
```

**workflow-launchers:**
```
workflow-launchers/references/workflow-launchers/launcher-config-reference.md
workflow-launchers/references/workflow-launchers/condition-patterns.md
```

**workflow-debugging:**
```
workflow-debugging/SKILL.md
workflow-debugging/reference.md
```

**workflow-triaging:**
```
workflow-triaging/SKILL.md
```

---

## 6.5 LTS / AMS Production Support Capabilities

| Capability | Detail |
|---|---|
| JMX | Full access via Felix Console (`/system/console/jmx`) or JMX client |
| Retry failed items | JMX `retryFailedWorkItems` or Inbox Retry |
| Stale detection | JMX `countStaleWorkflows` |
| Stale restart | JMX `restartStaleWorkflows(dryRun=true)` then execute |
| Purge | JMX `purgeCompleted(dryRun=true)` or Purge Scheduler |
| Queue info | JMX `returnSystemJobInfo`, `returnWorkflowQueueInfo` |
| Log access | Direct filesystem (`crx-quickstart/logs/`) or AMS log access |
| Thread dumps | jstack or AMS support request |
| Config status ZIP | Felix Console → Status → Configuration Status |
| Config changes | Felix Console, OSGi config in repo, or CRX/DE |

---

## AEM 6.5 LTS Guardrails Summary

Before doing anything, apply these constraints:

| Rule | Detail |
|---|---|
| Avoid editing `/libs` | Use overlays under `/apps` or store at `/conf/global` |
| Model design-time path | `/conf/global/settings/workflow/models/<id>` (preferred) or `/etc/workflow/models/<id>` (legacy) |
| Model runtime path (for API calls) | `/var/workflow/models/<id>` |
| Launcher config paths | `/conf/global/settings/workflow/launcher/config/` (preferred), `/apps/settings/workflow/launcher/config/` (overlay), or `/etc/workflow/launcher/config/` (legacy) |
| Service users | Use `ResourceResolverFactory.getServiceResourceResolver()` with a sub-service; avoid `loginAdministrative` |
| OSGi annotations | DS R6 preferred; Felix SCR still supported on 6.5 LTS |
| Deploy via | Package Manager (CRX Package), Maven + Content Package Plugin, or ACS AEM Commons JCR |
| No `javax.jcr.Session.loginAdministrative` | Deprecated — use `loginService()` or `ResourceResolverFactory` |

Full detail: `references/workflow-foundation/65-lts-guardrails.md`

---

## Quick Architecture Recap

```
Author tier
  │
  ├── Content Author
  │     └── triggers via: Timeline UI / Manage Publication
  │
  ├── Custom code (OSGi service / event handler / scheduler)
  │     └── triggers via: WorkflowSession.startWorkflow()
  │
  ├── Workflow Launcher (cq:WorkflowLauncher)
  │     └── triggers via: JCR observation events
  │
  └── Replication Agent (6.5 LTS only)
        └── triggers via: replication event / "Trigger on Receive"
              ↓
        Granite Workflow Engine
              ↓
        Workflow Instance (/var/workflow/instances/)
              ↓
        Steps executed as Sling Jobs:
          - PROCESS step  → WorkflowProcess.execute()
          - PARTICIPANT step → inbox task for user/group
          - DYNAMIC_PARTICIPANT → ParticipantStepChooser.getParticipant()
          - OR_SPLIT → route expression evaluates to true/false
          - AND_SPLIT → parallel branches, AND_JOIN waits for all
```

---

## Common Task Patterns (End-to-End)

### Pattern A: New custom approval workflow

1. Load `workflow-model-design` + `workflow-development` sub-skills
2. Design model: START → PARTICIPANT (reviewer) → PROCESS (approve/reject logic) → END
3. Implement `WorkflowProcess` for the approve/reject step
4. Deploy model XML to `/conf/global/settings/workflow/models/` via Maven content package
5. Deploy OSGi bundle with the process step
6. Sync via Package Manager for quick iteration

### Pattern B: Auto-process content on upload

1. Load `workflow-launchers` sub-skill
2. Configure a `cq:WorkflowLauncher` for `NODE_ADDED` on the DAM path
3. Point it to your workflow model at `/var/workflow/models/`
4. Deploy launcher config to `/conf/global/settings/workflow/launcher/config/`

### Pattern C: Programmatically batch-start workflows

1. Load `workflow-triggering` sub-skill
2. Implement `WorkflowStarterService` using `ResourceResolverFactory` + `WorkflowSession`
3. Map sub-service `workflow-starter` to `workflow-process-service` or a dedicated service user
4. Deploy and trigger from a Sling Scheduler or Servlet

### Pattern D: Replace OOTB DAM Update Asset launcher

1. Load `workflow-launchers` sub-skill
2. Overlay `dam_update_asset_create` from `/libs/settings/workflow/launcher/config/` to `/apps/settings/workflow/launcher/config/`
3. Set `enabled="{Boolean}false"` on the overlay
4. Create a new custom launcher pointing to your replacement model

### Pattern E: "Workflow errors on host X for the past 4 hours"

1. Load `workflow-triaging` → classify as `workflow_fails_or_shows_error`
2. Suggest Splunk / error.log search for `Error executing workflow step` on host + time range
3. Use JMX `returnSystemJobInfo` for queue/job metrics
4. If errors found, load `workflow-debugging` → map to runbook, walk decision tree
5. Return: symptom_id, runbook, evidence, remediation (including JMX actions)

### Pattern F: "Workflow stuck — not advancing"

1. Load `workflow-debugging` → classify as `workflow_stuck_not_progressing`
2. JMX `countStaleWorkflows` to check for stale instances
3. Follow decision tree: check for work item → step type → specific checks
4. If thread pool suspected, analyze config status ZIP (`039_Sling_Thread_Pools.txt`)
5. Return: root cause, JMX remediation, config fix

### Pattern G: "What should I collect for this workflow ticket?"

1. Load `workflow-triaging` → identify required inputs (host, time range, model, instance ID)
2. Suggest specific log patterns and Splunk queries
3. Suggest JMX data collection: `countStaleWorkflows`, `returnSystemJobInfo`, `returnWorkflowQueueInfo`
4. Suggest config status ZIP if thread pool or scheduler issues suspected
5. Return: data collection checklist, Splunk queries, JMX commands, next steps

---

## References in This Skill

```
references/workflow-foundation/architecture-overview.md
references/workflow-foundation/api-reference.md
references/workflow-foundation/jcr-paths-reference.md
references/workflow-foundation/65-lts-guardrails.md
references/workflow-foundation/quick-start-guide.md
```
