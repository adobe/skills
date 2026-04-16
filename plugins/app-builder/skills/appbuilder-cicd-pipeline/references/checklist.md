# Pre-Merge CI Readiness Checklist

Run through this checklist before merging CI/CD workflow changes.

## Workflow Files

- [ ] Workflow YAML files are in `.github/workflows/` at repository root
- [ ] YAML syntax is valid (no tabs, correct indentation)
- [ ] `deploy_stage.yml` triggers on push to `main` branch
- [ ] `deploy_prod.yml` triggers on GitHub release creation
- [ ] `pr_test.yml` triggers on pull request opened/synchronize
- [ ] All workflows use `actions/checkout@v4`
- [ ] All workflows use `actions/setup-node@v4` with `node-version: '20'`
- [ ] All workflows use `adobe/aio-cli-setup-action@3`
- [ ] All workflows use `adobe/aio-apps-action@3.3.0`
- [ ] No references to deprecated `auth` command

## Secrets Configuration

- [ ] All 14 secrets configured for Stage workspace (`*_STAGE` suffix)
- [ ] All 14 secrets configured for Production workspace (`*_PROD` suffix) if production deploy is set up
- [ ] Secrets are stored as **repository** secrets (NOT environment secrets)
- [ ] `I/O Management API` is added to each workspace in Developer Console
- [ ] OAuth S2S credential exists in each workspace
- [ ] `SCOPES` is a comma-separated string
- [ ] `AIO_PROJECT_WORKSPACE_DETAILS_SERVICES` is valid JSON
- [ ] Custom app secrets (if any) are added to both GitHub secrets and workflow `env` sections

## Auth Model

- [ ] Using OAuth S2S credentials (NOT JWT)
- [ ] No references to `auth` command in `aio-apps-action` steps
- [ ] `CLIENTID` and `CLIENTSECRET` are from OAuth S2S credential, not JWT

## Deployment Flow

- [ ] `build` step runs before `deploy` step in deploy workflows
- [ ] PR test workflow runs `test` command (not deploy)
- [ ] Deploy workflows do not run on pull requests
- [ ] Each workflow step has correct `env` block with all required secrets

## Security

- [ ] `.aio` and `.env` are in `.gitignore`
- [ ] No hardcoded credentials in workflow files
- [ ] No credentials in commit history
- [ ] `workspace.json` is not committed to the repository

## Testing

- [ ] Push a commit to `main` → verify `deploy_stage.yml` triggers
- [ ] Open a pull request → verify `pr_test.yml` triggers and tests pass
- [ ] Create a GitHub release → verify `deploy_prod.yml` triggers (if configured)
- [ ] Verify deployed application is accessible after workflow completes
