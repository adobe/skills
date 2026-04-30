# Quick Start Guide — AEM Workflow Development (6.5 LTS)

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
    ├── "A workflow is stuck / failed / stale / missing Inbox task"
    │       → workflow-debugging/SKILL.md
    │
    ├── "Classify an incident, pick logs/JMX/Splunk, gather diagnostic data"
    │       → workflow-triaging/SKILL.md
    │
    └── "I need end-to-end help designing + building + deploying a workflow"
            → workflow-orchestrator/SKILL.md
```

## Minimum Viable Workflow (3 Steps)

1. **Create** a model in the Workflow Model Editor or via content package at `/conf/global/settings/workflow/models/my-workflow`
2. **Implement** a `WorkflowProcess` class registered with `process.label=My Step`
3. **Deploy** via Maven (`mvn install -P autoInstallPackage`) or Package Manager

## Prerequisite Checklist

```
Before starting:
- [ ] AEM 6.5 LTS instance running (author)
- [ ] Maven project with core + ui.content modules
- [ ] Service user created with appropriate ACLs
- [ ] Bundle deployed; process.label visible in Workflow Model Editor
- [ ] Filter.xml covers model + launcher paths
```

## Verify Deployment

> **Local development only.** The `curl -u admin:admin` examples below target a local author instance at `localhost:4502` with the default admin password. Never run these against a shared, stage, or production instance, and never keep the default admin password enabled outside an isolated dev box.

```bash
# Check bundle is active
curl -u admin:admin http://localhost:4502/system/console/bundles/com.example.my-bundle.json

# Check process.label registered (visible in model editor step picker)
# Navigate to: Tools → Workflow → Models → Create → add Process step → configure

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

Monitor at: **Tools → Workflow → Instances** → filter by model or status.
