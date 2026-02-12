# Skill: generate-sample-extension

## Metadata

-   Name: generate-sample-extension
-   Version: 1.0.0
-   Description: Generates a working reference implementation for an AEM
    UI Extension (Content Fragment Editor or Universal Editor) using an
    existing App Builder project, including minimal UI + backend
    action + configuration guidance.
-   Last Updated: 2026-02-12

------------------------------------------------------------------------

## Why this skill exists

Teams learn fastest from a working example. This skill produces a
"known-good" sample aligned to the chosen host and extension point,
which can be used as a starting point or to validate
environment/registration correctness.

------------------------------------------------------------------------

## Agent Behavior Instructions

The agent MUST: 1. Confirm the target host: - **Content Fragment
Editor** (CFE) or **Universal Editor** (UE). 2. Confirm the sample type
(choose one): - "Hello World" UI-only extension (no backend) - UI +
backend action roundtrip (recommended) 3. Generate a **minimal but
complete** example: - UI renders in host - UI invokes an App Builder
action - Action returns deterministic data (e.g., echo/ping) safely 4.
Include configuration/registration instructions sufficient to run: -
app.config.yaml snippets - manifest/registration stubs as applicable -
environment variables/secrets names (no values) 5. Provide run + test
steps: - local dev run - host verification steps - basic smoke checks.

The agent SHOULD: - Provide a patch-style "files to add/modify"
output. - Keep dependencies minimal and avoid optional complexity. -
Include basic logging + correlation ID guidance.

The agent MUST NOT: - Embed real credentials or secrets. - Implement
business-specific logic beyond the sample. - Assume unspecified
extension points; if the user doesn't specify, choose a common baseline
and document it.

------------------------------------------------------------------------

## Required Inputs

-   Host: Content Fragment Editor or Universal Editor
-   Preferred sample type: UI-only or UI+action roundtrip
-   App Builder configuration (or confirmation it will be supplied)
-   Target environment for verification (dev recommended)

------------------------------------------------------------------------

## Output Contract

The output MUST include: 1. Sample overview (what it demonstrates) 2.
Folder/file changes (add/modify list) 3. UI code (minimal, complete) 4.
Action code (minimal, complete; deterministic response) 5.
Config/registration snippets 6. Run instructions (local) 7. Host
verification steps (CFE vs UE) 8. Smoke test checklist

------------------------------------------------------------------------

## Example Usage Prompts

### CFE sample (UI + action)

""" Use generate-sample-extension to create a working Content Fragment
Editor sample extension: - Adds a toolbar button that opens a modal -
Modal calls a backend action that returns an echo response Provide the
file list, code, config snippets, and steps to verify in our dev
environment. """

### UE sample (UI + action)

""" Use generate-sample-extension to create a working Universal Editor
side panel sample extension: - Renders a panel with a 'Ping' button -
Button calls a backend action and displays the returned message Include
registration/config guidance and verification steps for the Universal
Editor UI. """
