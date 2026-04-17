---
name: workflow-model-design
description: Design and create AEM Workflow models on AEM as a Cloud Service. Use when creating workflow models via the Workflow Model Editor or content package XML, defining step types (PROCESS, PARTICIPANT, DYNAMIC_PARTICIPANT, OR_SPLIT, AND_SPLIT), configuring step properties, declaring workflow variables, and deploying models through the Cloud Manager pipeline.
license: Apache-2.0
---

# Workflow Model Design (Cloud Service)

Design workflow models for AEM Cloud Service: step structure, transitions, OR/AND splits, variables, and model XML deployment.

## Variant Scope

- This skill is AEM Cloud Service only.
- Models are stored at `/conf/global/settings/workflow/models/`. Do not write to `/libs` or `/etc`.

## Workflow

```text
Model Design Progress
- [ ] 1) Clarify the workflow purpose: what triggers it, what steps are needed, who approves
- [ ] 2) Map out steps: PROCESS (auto), PARTICIPANT (human), OR_SPLIT (decision), AND_SPLIT (parallel)
- [ ] 3) Decide payload type: single JCR_PATH page/asset, or multi-page via workflow package
- [ ] 4) Identify workflow variables needed for inter-step data passing
- [ ] 5) Design model XML: nodes + transitions + metaData with correct step properties
- [ ] 6) Add filter.xml entry with mode="merge" for the model path
- [ ] 7) Verify model synced to /var/workflow/models/ after deployment
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
| `EXTERNAL_PROCESS` | Poll an external system | `EXTERNAL_PROCESS` = FQCN |

## Cloud Service Deployment

1. Place model XML at: `/conf/global/settings/workflow/models/<name>/jcr:content/model/`
2. Add to `ui.content` package with `filter.xml` entry `mode="merge"`
3. After Cloud Manager pipeline install: open Workflow Model Editor → **Sync** (or use `deployModel()`)
4. Engine reads from `/var/workflow/models/<name>` — verify sync succeeded

## References

- [step-types-catalog.md](./references/workflow-model-design/step-types-catalog.md) — complete step type reference with XML snippets
- [model-xml-reference.md](./references/workflow-model-design/model-xml-reference.md) — full model XML structure and property reference
- [model-design-patterns.md](./references/workflow-model-design/model-design-patterns.md) — common design patterns: linear, decision, parallel, loop-back
- [architecture-overview.md](./references/workflow-foundation/architecture-overview.md)
- [jcr-paths-reference.md](./references/workflow-foundation/jcr-paths-reference.md)
- [cloud-service-guardrails.md](./references/workflow-foundation/cloud-service-guardrails.md)
