# appbuilder-action-scaffolder

## Overview

This skill covers the full lifecycle of Adobe I/O Runtime actions: scaffold, implement, deploy, and debug. It provides structured workflows, production-ready code templates, and validation checklists for common action patterns including REST APIs, cron jobs, event handling, database CRUD, large payloads, action sequences, and Asset Compute workers.

## Structure

```
appbuilder-action-scaffolder/
├── SKILL.md                          ← Agent entry point (frontmatter + workflow)
├── README.md                         ← This file
├── scripts/
│   └── accelerator.py                ← Generates markdown execution plans from CLI args
├── agents/
│   └── openai.yaml                   ← OpenAI platform integration metadata
├── references/
│   ├── playbook.md                   ← 6-step execution procedure
│   ├── checklist.md                  ← 9-item pre-handoff validation checklist
│   ├── prompt-pack.md                ← Ready-to-use agent prompts (discovery, build, quality, ops)
│   ├── implementation-template.md    ← Structured delivery artifact template
│   ├── runtime-reference.md          ← Action structure, params, response formats, SDKs, CLI
│   └── action-patterns.md            ← 12 complete action patterns with manifest + code
├── assets/                           ← 9 JavaScript code templates
│   ├── action-scaffold-template.js   ← Minimal scaffold for quick prototyping
│   ├── action-boilerplate.js         ← Production-ready with logging and error handling
│   ├── database-action-template.js   ← Database CRUD with @adobe/aio-lib-db
│   ├── event-webhook-template.js     ← I/O Events webhook receiver
│   ├── event-provider-template.js    ← Custom event provider
│   ├── journaling-consumer-template.js ← Scheduled journal poller
│   ├── large-payload-template.js     ← Files SDK redirect for oversized responses
│   ├── action-sequence-template.js   ← Linear action sequence pipeline
│   └── asset-compute-worker-template.js ← AEM rendition processing worker
└── evals/
    └── evals.json                    ← 11 evaluation test cases
```

## Prerequisites

1. **Adobe I/O CLI** — `aio --version` must return a version
2. **Node.js 18+** — Required by aio CLI and App Builder SDKs
3. **Python 3** — Required for manifest validation and the accelerator script
4. **Authenticated session** — `aio auth login` must have been completed
5. **Existing App Builder project** — Use `appbuilder-project-init` to create one first

## Configuration

No additional configuration beyond the prerequisites. The skill reads from the existing project's `app.config.yaml` and `ext.config.yaml` files to understand the current manifest structure.

Before using the manifest validator, optionally install PyYAML (`pip install pyyaml`) for better parsing. The validator falls back to regex-based parsing if PyYAML is not available.

## Usage

### Workflow

The skill follows a 6-step workflow (detailed in `references/playbook.md`):

1. **Confirm** target outcome, constraints, and acceptance criteria
2. **Collect** current implementation context (code, environment, Adobe config)
3. **Design** using the appropriate pattern from `references/action-patterns.md`
4. **Implement** using a code template from `assets/`
5. **Validate** using `references/checklist.md` and the manifest validator
6. **Hand off** with summary of decisions, risks, and next actions

### Picking a code template

| Pattern | Template to use |
| --- | --- |
| Quick prototype / minimal action | action-scaffold-template.js |
| Production action (logging, validation) | action-boilerplate.js |
| Database CRUD operations | database-action-template.js |
| Receive I/O Events via webhook | event-webhook-template.js |
| Publish custom domain events | event-provider-template.js |
| Poll event journal on a schedule | journaling-consumer-template.js |
| Response exceeds 1 MB | large-payload-template.js |
| Multi-action linear pipeline | action-sequence-template.js |
| AEM rendition processing | asset-compute-worker-template.js |

### Validate manifest before deploy

```bash
python3 skills/_shared/scripts/validate_manifest_structure.py path/to/app.config.yaml
```

### Generate an execution plan

```bash
python3 skills/appbuilder-action-scaffolder/scripts/accelerator.py \
  --ticket JIRA-123 --workspace Stage --action my-action --project my-project
```

### Common CLI commands

```bash
aio app dev          # Local development (use aio app run if actions use State/Files SDK or sequences)
aio app build        # Build the project
aio app deploy       # Deploy to Adobe I/O Runtime
aio rt action invoke <action-name> --param key value   # Invoke an action directly
```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Actions don't deploy / silently missing | Check manifest structure — actions must be under application.runtimeManifest or in ext.config.yaml, never at root-level runtimeManifest. Run the manifest validator |
| Action timeout (default 60s) | Raise timeout in manifest limits (max 300s for non-web actions), or break work into smaller async steps |
| Response payload too large (>1 MB) | Use the large payload redirect pattern — write to Files SDK, return a presigned URL |
| IMS token not available | Set annotations.require-adobe-auth: true in manifest, confirm aio auth login, verify workspace API access |
| State/Files SDK fails with aio app dev | These SDKs require Runtime. Switch to aio app run for local testing |
| Sequence returns 404 locally | Known limitation of aio app dev. Use aio app run or test with inline orchestration fallback |
| npm install errors | Verify Node.js version (18+), delete node_modules and package-lock.json, retry |

## Skill Chaining

This skill is typically invoked after `appbuilder-project-init` has created the project structure. It can also be used standalone on existing App Builder projects.