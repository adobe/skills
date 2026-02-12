# Skill: configure-and-register

## Metadata

-   Name: configure-and-register
-   Version: 1.0.0
-   Description: Applies and verifies App Builder + AEM host
    configuration, including extension manifests/registration,
    environment variables and host enablement steps for CFE/UE.
-   Last Updated: 2026-02-12

------------------------------------------------------------------------

## Why this skill exists

Configuration/registration issues are the #1 cause of slowdowns (wrong
manifest, scopes, host enablement). This skill makes configuration a
first-class, repeatable workflow.

------------------------------------------------------------------------

## Agent Behavior Instructions

The agent MUST: 1. Treat configuration as environment-specific: -
dev/stage/prod separation, secrets handled correctly. 2. Validate
registration for the correct host: - CFE vs UE, and the correct
extension points. 3. Produce a checklist for host-side enablement where
applicable. 4. Identify required scopes/permissions and map them to
configuration entries. 5. Output "verify" steps that a developer can run
to confirm configuration is correct.

The agent SHOULD: - Provide a "known failure modes" section (missing
scope, wrong allowlist, wrong host endpoint, etc.). - Minimize
assumptions; when uncertain, include verification steps and point to the
knowledge base.

The agent MUST NOT: - Deploy production changes (that's
`distribute-extension`). - Store secrets in plaintext in repo output.

------------------------------------------------------------------------

## Required Inputs

-   Target host: Content Fragment Editor or Universal Editor
-   App Builder configuration from user (app.config.yaml + environment
    variables/secrets)
-   Target environments (dev/stage/prod)
-   Any required integrations (AEM APIs, external APIs)

------------------------------------------------------------------------

## Output Contract

The output MUST include: 1. Configuration change list (what files/values
to change) 2. Manifest/registration guidance (host-specific) 3.
Permissions/scopes checklist 4. Environment variable + secret checklist
5. Verification steps (how to confirm registration + basic
functionality) 6. Known failure modes + how to diagnose

------------------------------------------------------------------------

## Example Usage Prompts

### CFE

""" Use configure-and-register to validate and update configuration for
a Content Fragment Editor extension. Ensure the manifest/registration is
correct, required scopes are present, and the extension is enabled in
the target AEM environment. """

### UE

""" Use configure-and-register to validate and update configuration for
a Universal Editor UI extension. Include steps to confirm the extension
points are registered and visible in the Universal Editor UI. """
