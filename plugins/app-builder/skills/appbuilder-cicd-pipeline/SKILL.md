---
name: appbuilder-cicd-pipeline
description: >-
  Set up CI/CD pipelines for Adobe App Builder projects. Generates GitHub Actions workflows using
  adobe/aio-cli-setup-action@3 and adobe/aio-apps-action@3.3.0, plus patterns for Azure DevOps
  and GitLab CI. Handles OAuth S2S secrets injection, multi-workspace promotion (stage → prod),
  deploy gating with manifest validation. Use this skill whenever the
  user mentions CI/CD for App Builder, GitHub Actions for aio deploy, automated deployment
  pipelines, continuous integration, continuous delivery, deploy automation, multi-environment
  promotion, aio app add ci, or wants to automate their App Builder build and release process.
  Also trigger when users mention deploy workflows, release pipelines, or GitHub secrets for
  App Builder.
metadata:
  category: deployment-automation
license: Apache-2.0
compatibility: Requires aio CLI, Node.js 18+, and a CI/CD platform (GitHub Actions, Azure DevOps, or GitLab CI)
allowed-tools: Bash(aio:*) Bash(npm:*) Bash(git:*) Read Write Edit
---
# App Builder CI/CD Pipeline

Set up CI/CD pipelines for Adobe App Builder projects — GitHub Actions (primary), Azure DevOps, GitLab CI. Uses OAuth S2S credentials with IMS authentication. Repository secrets only (no environment secrets).

## Pattern Quick-Reference

| User wants | Template |
| --- | --- |
| GitHub Actions deploy-to-stage | assets/deploy-stage.yml |
| GitHub Actions deploy-to-prod | assets/deploy-prod.yml |
| GitHub Actions PR tests | assets/pr-test.yml |
| Extract secrets from workspace | assets/fetch-secrets.sh |
| Azure DevOps / GitLab CI / Jenkins | references/generic-pipeline-guide.md |
| Secrets setup guide | references/secrets-management.md |
| Debugging deploy failures | references/debugging.md |

## Fast Path (for clear requests)

When the user says "set up CI/CD for my App Builder project" and they use GitHub, generate all 3 workflow files + secrets guide immediately:

1. Copy `assets/deploy-stage.yml` → `.github/workflows/deploy_stage.yml`
2. Copy `assets/deploy-prod.yml` → `.github/workflows/deploy_prod.yml`
3. Copy `assets/pr-test.yml` → `.github/workflows/pr_test.yml`
4. Guide secrets setup using `references/secrets-management.md`

If user specifies Azure DevOps, GitLab CI, or Jenkins → use `references/generic-pipeline-guide.md`.

## Quick Reference

- **Workflow location:** `.github/workflows/` at repository root
- **Bootstrap command:** `aio app add ci` generates starter workflow files
- **Official actions:** `adobe/aio-cli-setup-action@3` (CLI install) + `adobe/aio-apps-action@3.3.0` (build/test/deploy)
- **Auth model:** OAuth Server-to-Server (S2S) with IMS — the `auth` command in `aio-apps-action` is **DEPRECATED** (JWT). Do not use it.
- **Secrets scope:** Repository secrets only. App Builder does **NOT** support GitHub environment secrets.
- **Secrets per workspace:** 14 secrets with workspace suffix (`_STAGE`, `_PROD`)
- **Prerequisite:** Add "I/O Management API" to each workspace in Developer Console before extracting secrets
- **Workspace config:** Run `aio app use <workspace.json>` to configure `.aio` and `.env` files

## Full Workflow (for ambiguous or complex requests)

1. **Check existing setup:** Look for `.github/workflows/` (from `aio app add ci` or manual). Check if workflows already exist.
2. **Determine CI/CD platform:** GitHub Actions is default. Ask if user needs Azure DevOps, GitLab CI, or Jenkins.
3. **Generate workflow files:** Copy templates from `assets/` to `.github/workflows/`. Customize triggers, branch names, and environment suffixes as needed.
4. **Guide secrets setup:**a. Ensure "I/O Management API" is added to the workspace in Developer Consoleb. Download `workspace.json` from Developer Consolec. Run `aio app use <workspace.json>` to configure local `.aio` and `.env`d. Run `assets/fetch-secrets.sh` to extract credential valuese. Guide user to add each secret to GitHub **repository** secrets (NOT environment secrets)f. Add `_STAGE` or `_PROD` suffix to each secret name
5. **Add custom secrets:** If the app uses custom env vars, add them under the `env` key in the Deploy step
6. **Validate:** Run through `references/checklist.md` before merge
7. **Troubleshoot:** If deploy fails, consult `references/debugging.md` for common scenarios
8. **Test:** Push to a branch and verify workflow runs successfully

## Inputs To Request

- Current repository path and CI/CD platform preference
- Target Adobe organization, project, and workspace names
- Whether Stage, Production, or both workspaces need CI/CD
- Any custom secrets the application requires

## Deliverables

- Workflow YAML files in `.github/workflows/`
- Secrets extraction output for repository configuration
- Pre-merge validation against `references/checklist.md`

## Quality Bar

- All workflow YAML must be syntactically valid
- Secrets must use repository scope, never environment scope
- OAuth S2S credentials only — no JWT auth references
- Each workspace gets its own secret set with correct suffix
- Workflows must use pinned action versions (`@3`, `@3.3.0`)

## References

- Use `references/github-actions-guide.md` for GitHub Actions workflow patterns and secrets table.
- Use `references/generic-pipeline-guide.md` for Azure DevOps, GitLab CI, and Jenkins patterns.
- Use `references/secrets-management.md` for OAuth S2S credential extraction and GitHub secrets setup.
- Use `references/debugging.md` for troubleshooting deploy failures, CI errors, and workspace promotion issues.
- Use `references/checklist.md` for pre-merge CI readiness validation.
- Use `assets/deploy-stage.yml`, `assets/deploy-prod.yml`, `assets/pr-test.yml` as workflow templates.
- Use `assets/fetch-secrets.sh` to extract secret values from workspace configuration.
- Official Adobe docs: [https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/deployment/cicd-using-github-actions](https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/deployment/cicd-using-github-actions)

## Common Issues

- **Workflow not triggering:** Verify workflow files are committed to the default branch and triggers match your branching strategy.
- **Deploy fails with auth error:** The `auth` command is deprecated. Ensure you are using OAuth S2S credentials, not JWT. Verify all 14 secrets are set correctly with the right workspace suffix.
- **"I/O Management API not found":** Add the I/O Management API service to the workspace in Developer Console before extracting secrets.
- **Environment secrets not working:** App Builder does NOT support GitHub environment secrets. Move all secrets to repository-level secrets.
- **Missing secrets:** Run `fetch-secrets.sh` and compare output against the 14-secret table in `references/github-actions-guide.md`. Each value must be present and correctly suffixed.
- **Custom env vars not available in action:** Add custom secrets under the `env` key in the Deploy step of the workflow, not just in GitHub secrets.

## Chaining

- Chains FROM `appbuilder-action-scaffolder` (after actions are implemented)
- Chains FROM `appbuilder-testing` (automated test execution in CI)
- Standalone after setup (workflows run automatically on push/PR/release)