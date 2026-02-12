# Skill: build-extension

## Metadata

-   Name: build-extension
-   Version: 1.3.0
-   Description: Implements and validates an AEM UI Extension (Content
    Fragment Editor or Universal Editor) using Adobe App Builder based
    on an approved plan.
-   Last Updated: 2026-02-12

------------------------------------------------------------------------

## When to use

Use this skill after `analyze-and-plan` and (optionally)
`scaffold-extension` to: - Implement UI + actions - Wire host context to
actions - Validate locally and in a dev host environment.

------------------------------------------------------------------------

## Agent Behavior Instructions

When executing this skill, the agent MUST:

1.  **Follow the approved plan** (no scope creep).
2.  **Keep UI and backend concerns separate**:
    -   UI extension: React/SPA, host context handling, UX,
        accessibility.
    -   App Builder actions: secure calls to AEM/external APIs, secrets,
        validation.
3.  **Secure by default**:
    -   Never hardcode secrets; use App Builder secrets / environment
        variables.
    -   Never place privileged operations in the client.
4.  **Add structured logging + basic telemetry hooks** to actions and
    key UI flows.
5.  **Host-specific validation**:
    -   Confirm the extension behaves correctly in the intended host
        (CFE or UE).
6.  **Provide complete testing instructions**:
    -   Local tests, action invocation tests, host integration steps.

The agent SHOULD: - Prefer small, composable modules. - Include robust
error handling and user-friendly failure states. - Call out dependencies
on AEM APIs, CORS, allowlists, or permissions.

The agent MUST NOT: - Introduce new extension points beyond the plan. -
Store sensitive data in client-side state. - Assume production readiness
(that is handled by `validate-and-harden` and `distribute-extension`).

------------------------------------------------------------------------

## Required Inputs

-   Approved technical plan from analyze-and-plan
-   App Builder project configuration (provided by the user)
-   Target AEM environment details (URLs, org/program identifiers as
    applicable)
-   API credentials/scopes available to the project

------------------------------------------------------------------------

## Output Contract

The output MUST include:

1.  **Folder/File Structure** (what to create/modify)
2.  **Backend Action Implementations** (or clear patch-style guidance if
    code is too large)
3.  **UI Component Implementation**
    -   Host SDK integration points, context usage, loading/error states
4.  **Configuration Updates**
    -   app.config.yaml snippets
    -   extension manifest/registration snippets (host-specific)
5.  **Local Testing Instructions**
6.  **Integration Testing Steps**
    -   Host-specific checks for CFE vs UE
7.  **Known Issues / Follow-ups**

------------------------------------------------------------------------

## Example Usage Prompts

### Content Fragment Editor (CFE)

""" Use build-extension to implement the planned Content Fragment Editor
toolbar + modal extension. The modal should show the current field
value, call the backend action for rewrite suggestions, and allow
writing the selected suggestion back to the fragment. """

### Universal Editor (UE)

""" Use build-extension to implement the planned Universal Editor panel
extension. It should read the current authoring context from the host,
fetch validation results from a backend action, and render a checklist
with fix actions. """
