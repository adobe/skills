# Skill: scaffold-extension

## Metadata

-   Name: scaffold-extension
-   Version: 1.0.0
-   Description: Generates a minimal, host-specific scaffold for an AEM
    UI Extension (Content Fragment Editor or Universal Editor) inside an
    existing App Builder project.
-   Last Updated: 2026-02-12

------------------------------------------------------------------------

## Why this skill exists

Teams often waste time re-creating the same boilerplate. This skill
creates a consistent baseline structure so `build-extension` can focus
on business logic.

------------------------------------------------------------------------

## Agent Behavior Instructions

The agent MUST: 1. Confirm the target host: **CFE** or **UE**. 2.
Scaffold only what is required for the selected extension point(s). 3.
Keep the scaffold minimal and easy to extend: - Separate UI extension
code, shared utils, and backend actions. 4. Include placeholders for: -
Host context extraction - Action invocation wrapper - Error boundary +
loading states 5. Produce a patch-style output (what folders/files to
add) rather than a large monolithic paste when possible.

The agent SHOULD: - Provide a "first-run" checklist to verify the
scaffold loads in the host. - Reference `docs/knowledge-base.md` for
host setup expectations.

The agent MUST NOT: - Implement full business logic (that's
`build-extension`). - Add extra extension points beyond the requested
ones.

------------------------------------------------------------------------

## Required Inputs

-   Target host: Content Fragment Editor or Universal Editor
-   Chosen extension point(s)
-   Existing App Builder project layout (or allow the agent to propose a
    standard layout)

------------------------------------------------------------------------

## Output Contract

The output MUST include: 1. Proposed folder structure 2. Files to add
with short purpose statements 3. Minimal manifest/registration stubs
needed to load the UI 4. "First-run" verification steps in the host
editor.

------------------------------------------------------------------------

## Example Usage Prompts

### CFE

""" Use scaffold-extension to create the minimal scaffold for a Content
Fragment Editor toolbar button + modal extension. """

### UE

""" Use scaffold-extension to create the minimal scaffold for a
Universal Editor side panel extension. """
