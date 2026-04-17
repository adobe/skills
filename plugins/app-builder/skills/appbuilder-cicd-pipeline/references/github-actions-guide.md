# GitHub Actions Guide for App Builder CI/CD

Source: [Adobe CI/CD Documentation](https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/deployment/cicd-using-github-actions)

## Overview

App Builder provides CI/CD via GitHub Actions using two official actions:

- `adobe/aio-cli-setup-action@3` — Installs the Adobe I/O CLI
- `adobe/aio-apps-action@3.3.0` — Runs build, test, and deploy commands

## Three Default Workflows

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| deploy_stage.yml | Push to main | Deploy to Stage workspace |
| deploy_prod.yml | GitHub release created | Deploy to Production workspace |
| pr_test.yml | Pull request opened/updated | Run aio app test |

Bootstrap with: `aio app add ci` (generates starter files in `.github/workflows/`).

## Required Secrets (per workspace)

**CRITICAL: Use repository secrets only. App Builder does NOT support GitHub environment secrets.**

### Stage Workspace Secrets

| # | Secret Name | Used By |
| --- | --- | --- |
| 1 | CLIENTID_STAGE | deploy_stage.yml, pr_test.yml |
| 2 | CLIENTSECRET_STAGE | deploy_stage.yml, pr_test.yml |
| 3 | TECHNICALACCID_STAGE | deploy_stage.yml, pr_test.yml |
| 4 | TECHNICALACCEMAIL_STAGE | deploy_stage.yml, pr_test.yml |
| 5 | IMSORGID_STAGE | deploy_stage.yml, pr_test.yml |
| 6 | SCOPES_STAGE | deploy_stage.yml, pr_test.yml |
| 7 | AIO_RUNTIME_NAMESPACE_STAGE | deploy_stage.yml, pr_test.yml |
| 8 | AIO_RUNTIME_AUTH_STAGE | deploy_stage.yml |
| 9 | AIO_PROJECT_ID_STAGE | deploy_stage.yml |
| 10 | AIO_PROJECT_NAME_STAGE | deploy_stage.yml |
| 11 | AIO_PROJECT_ORG_ID_STAGE | deploy_stage.yml |
| 12 | AIO_PROJECT_WORKSPACE_ID_STAGE | deploy_stage.yml |
| 13 | AIO_PROJECT_WORKSPACE_NAME_STAGE | deploy_stage.yml |
| 14 | AIO_PROJECT_WORKSPACE_DETAILS_SERVICES_STAGE | deploy_stage.yml |

### Production Workspace Secrets

Same 14 secrets with `_PROD` suffix instead of `_STAGE`. Used by `deploy_prod.yml`.

## Auth Model

**The **`auth`** command in **`aio-apps-action`** is DEPRECATED.** It generated JWT tokens which are no longer supported.

Use **OAuth Server-to-Server (S2S)** credentials with IMS authentication:

- Add "I/O Management API" to the workspace in Developer Console
- This creates an OAuth S2S credential automatically
- The credential provides the `CLIENTID`, `CLIENTSECRET`, `TECHNICALACCID`, `TECHNICALACCEMAIL`, `IMSORGID`, and `SCOPES` values

## Workflow Structure

Each workflow follows this pattern:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: '20'
  - uses: adobe/aio-cli-setup-action@3
    with:
      os: ubuntu
  - uses: adobe/aio-apps-action@3.3.0
    with:
      os: ubuntu
      command: build    # or test, deploy
    env:
      # All 14 secrets injected here
```

## Adding Custom Secrets

Add custom application secrets under the `env` key in the Deploy step:

```yaml
- uses: adobe/aio-apps-action@3.3.0
  with:
    os: ubuntu
    command: deploy
  env:
    # Standard secrets...
    MY_CUSTOM_SECRET: ${{ secrets.MY_CUSTOM_SECRET_STAGE }}
```

Store the value as a repository secret in GitHub Settings → Secrets and variables → Actions.

## Multi-Workspace Setup

For additional workspaces beyond Stage and Production:

1. Create a new workflow file `deploy_<workspace>.yml`
2. Customize the trigger (branch, tag, or manual dispatch)
3. Add all 14 secrets with `_<WORKSPACE>` suffix
4. Follow the same secrets extraction process per workspace

## Workflow Customization

- **Change target branch:** Edit the `on.push.branches` array
- **Add manual trigger:** Add `workflow_dispatch` to the `on` section
- **Add build matrix:** Use `strategy.matrix` for multi-Node-version testing
- **Add approval gate:** Use GitHub Environments with required reviewers (but keep secrets at repository level)