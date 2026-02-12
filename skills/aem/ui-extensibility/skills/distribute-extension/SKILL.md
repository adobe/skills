# Skill: distribute-extension

## Metadata

-   Name: distribute-extension
-   Version: 1.3.0
-   Description: Packages, deploys, and prepares an AEM UI Extension
    (Content Fragment Editor or Universal Editor) built with App Builder
    for distribution and promotion across environments.
-   Last Updated: 2026-02-12

------------------------------------------------------------------------

## When to use

Use this skill after the extension passes `build-extension` (and ideally
`validate-and-harden`) to: - Prepare production builds - Deploy/promote
across environments - Produce release + rollback artifacts.

------------------------------------------------------------------------

## Agent Behavior Instructions

When executing this skill, the agent MUST:

1.  **Validate production readiness inputs**:
    -   Ensure configuration and secrets are environment-specific and
        correct.
2.  **Confirm extension registration and visibility** in the target
    host:
    -   Content Fragment Editor vs Universal Editor.
3.  **Provide environment-specific checklists**:
    -   IMS scopes, AEM permissions, CORS, allowlists, endpoints.
4.  **Produce release documentation**:
    -   Release notes draft + operational notes + smoke test checklist.
5.  **Provide rollback plan**:
    -   How to revert deployment/config safely.

The agent SHOULD: - Recommend CI/CD steps appropriate for App Builder +
AEM UIX promotion. - Ensure telemetry/monitoring is enabled and
validated post-deploy. - Highlight any manual steps required in AEM
(e.g., enabling extensions per instance via Extension Manager where
applicable).

The agent MUST NOT: - Assume a single environment or single tenant. -
Skip validation steps that would surface permissions/scope mismatches.

------------------------------------------------------------------------

## Required Inputs

-   Completed App Builder project (built + tested)
-   Target deployment environment(s)
-   Distribution requirements (internal-only vs marketplace-style,
    approval gates, etc.)

------------------------------------------------------------------------

## Output Contract

The output MUST include:

1.  **Production Build Steps**
2.  **Deployment Commands**
3.  **Environment Configuration Checklist**
4.  **Extension Registration Validation Steps**
    -   Host-specific checks for CFE vs UE
5.  **Smoke Test Plan**
6.  **Release Notes Template**
7.  **Rollback Plan**

------------------------------------------------------------------------

## Example Usage Prompts

### Content Fragment Editor (CFE)

""" Use distribute-extension to prepare the Content Fragment Editor
rewrite-suggestion extension for production. Include a smoke test that
verifies toolbar button visibility, modal behavior, and write-back to
fragments. Provide a rollback plan that restores the previous
deployment. """

### Universal Editor (UE)

""" Use distribute-extension to prepare the Universal Editor
validation-panel extension for production. Include checks for enabling
the extension on a per-instance basis (where applicable), telemetry
verification, and a rollback plan. """
