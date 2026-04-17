---
name: workflow-model-design
description: Design and create AEM Workflow models on AEM 6.5 LTS. Use when creating workflow models via the Workflow Model Editor or content package XML, defining step types (PROCESS, PARTICIPANT, DYNAMIC_PARTICIPANT, OR_SPLIT, AND_SPLIT), configuring step properties, declaring workflow variables, deploying to /etc or /conf, and syncing to /var/workflow/models via Package Manager or Maven.
license: Apache-2.0
---

# Workflow Model Design (AEM 6.5 LTS)

Design workflow models for AEM 6.5 LTS: step structure, transitions, OR/AND splits, variables, and model XML deployment via Package Manager.

## Variant Scope

- This skill is AEM 6.5 LTS only.
- Models can be stored at `/conf/global/settings/workflow/models/` (preferred) or `/etc/workflow/models/` (legacy — auto-deployed without Sync).

## Workflow

```text
Model Design Progress
- [ ] 1) Clarify the workflow purpose: what triggers it, what steps are needed, who approves
- [ ] 2) Map out steps: PROCESS (auto), PARTICIPANT (human), OR_SPLIT (decision), AND_SPLIT (parallel)
- [ ] 3) Decide payload type: single JCR_PATH or multi-page cq:WorkflowContentPackage
- [ ] 4) Identify workflow variables needed for inter-step data passing
- [ ] 5) Design model XML: nodes + transitions + metaData with correct step properties
- [ ] 6) Choose storage: /conf (requires Sync) vs /etc (auto-deployed)
- [ ] 7) Add filter.xml entry with mode="merge"
- [ ] 8) Deploy via mvn install or Package Manager; verify sync to /var/workflow/models/
```

## Node Types Quick Reference

| Type | Purpose | Key metaData property |
|---|---|---|
| `START` | Entry point | — |
| `END` | Terminal | — |
| `PROCESS` | Auto-executed Java step | `PROCESS` = FQCN or process.label |
| `PARTICIPANT` | Human task (static assignee) | `PARTICIPANT` = principal name |
| `DYNAMIC_PARTICIPANT` | Human task (runtime assignee) | `DYNAMIC_PARTICIPANT` = chooser.label |
| `OR_SPLIT` | One branch selected by rule | Transition `rule` = ECMA/Groovy |
| `AND_SPLIT` | All branches execute in parallel | — |
| `AND_JOIN` | Wait for all parallel branches | — |

## 6.5 LTS: /conf vs /etc

| Location | Sync Required | Best For |
|---|---|---|
| `/conf/global/settings/workflow/models/` | Yes — via UI or `deployModel()` | New models, forward-compatible |
| `/etc/workflow/models/` | No — auto-deployed | Legacy models, simple setups |

## Deployment

```bash
# Deploy via Maven
mvn clean install -P autoInstallPackage

# Or install package manually via Package Manager
http://localhost:4502/crx/packmgr
```

## References

- [step-types-catalog.md](./references/workflow-model-design/step-types-catalog.md) — complete step type reference with XML snippets
- [model-xml-reference.md](./references/workflow-model-design/model-xml-reference.md) — full model XML structure and property reference
- [model-design-patterns.md](./references/workflow-model-design/model-design-patterns.md) — common design patterns: linear, decision, parallel, loop-back
- [architecture-overview.md](./references/workflow-foundation/architecture-overview.md)
- [jcr-paths-reference.md](./references/workflow-foundation/jcr-paths-reference.md)
- [65-lts-guardrails.md](./references/workflow-foundation/65-lts-guardrails.md)
