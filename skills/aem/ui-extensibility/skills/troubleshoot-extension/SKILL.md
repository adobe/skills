# Skill: troubleshoot-extension

## Metadata

-   Name: troubleshoot-extension
-   Version: 1.0.0
-   Description: Diagnoses and resolves common issues when developing or
    running AEM UI Extensions (Content Fragment Editor or Universal
    Editor) backed by Adobe App Builder.
-   Last Updated: 2026-02-12

------------------------------------------------------------------------

## Why this skill exists

UI extensions commonly fail due to configuration/registration mistakes,
missing scopes/permissions, host enablement issues, CORS/allowlist
problems, or action/runtime errors. This skill provides a fast,
structured troubleshooting workflow that reduces iteration time.

------------------------------------------------------------------------

## Agent Behavior Instructions

The agent MUST: 1. **Identify the host** (CFE vs UE) and the failing
extension point(s). 2. **Classify the failure mode** into one (or more)
categories: - Not visible in host UI - Visible but UI fails to load - UI
loads but action calls fail - Auth / permission failures -
Deployment/environment mismatches - Performance/timeouts 3. **Request or
infer minimal diagnostics** without stalling: - Relevant logs (browser
console, App Builder action logs) - Manifest/registration snippet -
app.config.yaml relevant sections - Environment variables/secrets
presence (names only, not values) 4. Provide a **ranked hypothesis
list** (most likely first). 5. Provide **step-by-step verification
actions** and what "good" looks like. 6. Provide **fix guidance** that
is: - Host-specific (CFE vs UE) - Environment-specific
(dev/stage/prod) - Safe (no secret leakage).

The agent SHOULD: - Include "known failure modes" and quick checks
(e.g., missing scope, wrong org/project, stale deployment). - Suggest a
minimal reproduction path if the issue is unclear. - Recommend
adding/confirming telemetry or correlation IDs to improve future
debugging.

The agent MUST NOT: - Ask for secret values. - Suggest bypassing
security controls to "make it work".

------------------------------------------------------------------------

## Required Inputs

At minimum: - Host: Content Fragment Editor or Universal Editor -
Symptoms (what the user sees) - Target environment (dev/stage/prod)

Helpful (if available): - Browser console errors - App Builder action
logs (or snippets) - Manifest/registration excerpts - app.config.yaml
excerpts - Scopes/permissions info

------------------------------------------------------------------------

## Output Contract

The output MUST include: 1. Problem summary 2. Host + extension point(s)
involved 3. Observations (from provided diagnostics) 4. Ranked
hypotheses 5. Verification checklist (step-by-step) 6. Fix plan
(specific config/code changes) 7. Prevention recommendations (tests,
logging, CI checks)

------------------------------------------------------------------------

## Example Usage Prompts

### Not visible in host UI (CFE)

""" Use troubleshoot-extension. Our Content Fragment Editor toolbar
extension is not showing up in the editor. We deployed to dev. Provide a
ranked checklist of what to verify (registration, scopes, enablement,
config). """

### Action failures (UE)

""" Use troubleshoot-extension. Our Universal Editor side panel loads,
but calling the backend action returns 401. We have browser console
errors and App Builder action logs available. Tell us what to check and
how to fix it safely. """
