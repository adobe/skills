# Quick Start Guide — AEM Workflow Development (Cloud Service)

## Determine What You Need

```
User request
    ├── "How do I create a workflow model?"
    │       → workflow-model-design/SKILL.md
    │
    ├── "How do I write a custom process step / participant chooser?"
    │       → workflow-development/SKILL.md
    │
    ├── "How do I start a workflow programmatically / via API?"
    │       → workflow-triggering/SKILL.md
    │
    ├── "How do I auto-trigger a workflow when content changes?"
    │       → workflow-launchers/SKILL.md
    │
    └── "I need end-to-end help designing + building + deploying a workflow"
            → workflow-orchestrator/SKILL.md
```

## Minimum Viable Workflow (3 steps)

1. **Create** a model XML at `/conf/global/settings/workflow/models/my-workflow/jcr:content/model`
2. **Implement** a `WorkflowProcess` class registered with `process.label=My Step`
3. **Deploy** via Cloud Manager pipeline (model in `ui.content`, bundle in `ui.apps`)

## Prerequisite Checklist

```
Before starting:
- [ ] AEM Cloud Service SDK installed locally
- [ ] Maven project with ui.apps + ui.content modules
- [ ] Service user configured (or use existing workflow-process-service)
- [ ] Bundle deployed and process.label visible in Workflow Model Editor
```

## Verify Deployment

```bash
# Check OSGi bundle active
curl -u admin:admin http://localhost:4502/system/console/bundles/<bundle-name>.json

# Verify process.label registered
curl -u admin:admin "http://localhost:4502/libs/cq/workflow/admin/console/content/models.json"

# Check model synced to /var
curl -u admin:admin "http://localhost:4502/var/workflow/models/my-workflow.json"
```

## Start a Test Workflow via API

```bash
curl -u admin:admin -X POST \
  "http://localhost:4502/api/workflow/instances" \
  -d "model=/var/workflow/models/my-workflow" \
  -d "payloadType=JCR_PATH" \
  -d "payload=/content/test-page"
```

Monitor at: **Tools → Workflow → Instances** → filter by model.
