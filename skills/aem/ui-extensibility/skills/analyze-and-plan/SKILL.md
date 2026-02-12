# Skill: analyze-and-plan

## Metadata

-   Name: analyze-and-plan
-   Version: 1.3.0
-   Description: Produces a complete technical architecture and
    execution plan for building an AEM UI Extension (Content Fragment
    Editor or Universal Editor) using Adobe App Builder.
-   Last Updated: 2026-02-12

------------------------------------------------------------------------

## When to use

Use this skill **before any implementation** to: - Confirm which editor
is targeted (**Content Fragment Editor** vs **Universal Editor**) and
which extension points are in scope. - Produce a build-ready plan that
downstream skills can execute without re-discovering requirements.

------------------------------------------------------------------------

## Agent Behavior Instructions

When executing this skill, the agent MUST:

1.  **Identify the target editor(s)** up front:
    -   Content Fragment Editor (CFE) extension, Universal Editor (UE)
        extension, or both.
2.  **Pin down extension points** and the host UI context they provide
    (selection, entity IDs, authoring context, events).
3.  **Verify extension point feasibility**:
    -   If any extension point is uncertain, include a verification
        checklist with links to `docs/knowledge-base.md`.
4.  **Map UI → backend responsibilities**:
    -   What runs in the UI extension (React) vs what runs as App
        Builder actions.
5.  **Assume the App Builder app already exists**:
    -   The agent must plan using a user-provided configuration, not by
        creating a new app from scratch.
6.  **Security-first design**:
    -   Explicitly cover IMS scopes, secrets, token handling, and
        least-privilege access.
7.  **Environment strategy**:
    -   Dev/stage/prod configuration separation, promotion steps, and
        rollback notes.
8.  **Deliver structured outputs** exactly per the Output Contract
    below.

The agent SHOULD: - Call out performance risks (cold starts, chatty API
calls, large payloads) and propose mitigations. - Include
telemetry/logging from day one. - Propose a clear integration-test
approach inside the host editor.

The agent MUST NOT: - Produce large code implementations (small
illustrative snippets are OK) unless explicitly asked. - Invent
extension points; if unsure, list verification steps and cite official
docs via the knowledge base.

------------------------------------------------------------------------

## Required Inputs

-   Extension target: **Content Fragment Editor** or **Universal
    Editor**
-   Extension point(s) to use
-   Business objective and user stories
-   App Builder configuration (provided by the user)
-   Target environments (dev/stage/prod)
-   Security constraints (IMS scopes, data residency, compliance)

------------------------------------------------------------------------

## Output Contract

The output MUST include:

1.  **Executive Summary**
2.  **Host & Extension Point Matrix**
    -   Host: CFE / UE
    -   Extension point(s)
    -   Context available from host
    -   UX affordances (where it shows up, user flow)
3.  **Architecture Diagram Description**
4.  **Extension → Action Mapping Table**
5.  **Security Design**
    -   Auth model, IMS scopes, token flow, secrets, permission checks
6.  **Storage + State Design**
7.  **Deployment + Promotion Strategy**
8.  **Testing Strategy**
    -   Unit, integration (host), e2e smoke checks
9.  **Risk Assessment + Mitigations**
10. **Open Questions / Verification Checklist**

-   Anything that must be confirmed in official docs; point to
    `docs/knowledge-base.md`

------------------------------------------------------------------------

## Example Usage Prompts

### Content Fragment Editor (CFE)

""" Use analyze-and-plan to design an App Builder app for an AEM Content
Fragment Editor extension. Add a toolbar button in the editor that opens
a modal to run an AI-based rewrite suggestion on the selected field. The
backend action must call an external API and write the approved
suggestion back to the fragment via AEM APIs. Environments: dev and
stage. The App Builder config will be provided. """

### Universal Editor (UE)

""" Use analyze-and-plan to design an App Builder app for a Universal
Editor UI extension. The extension should add a panel that lets authors
validate page content against a custom checklist and show actionable
fixes. Backend actions should fetch validation rules from an internal
service and optionally create tasks via a REST API. Environments: dev,
stage, prod. The App Builder config will be provided. """
# Skill: analyze-and-plan

## Metadata

-   Name: analyze-and-plan
-   Version: 1.3.0
-   Description: Produces a complete technical architecture and
    execution plan for building an AEM UI Extension (Content Fragment
    Editor or Universal Editor) using Adobe App Builder.
-   Last Updated: 2026-02-12

------------------------------------------------------------------------

## When to use

Use this skill **before any implementation** to: - Confirm which editor
is targeted (**Content Fragment Editor** vs **Universal Editor**) and
which extension points are in scope. - Produce a build-ready plan that
downstream skills can execute without re-discovering requirements.

------------------------------------------------------------------------

## Agent Behavior Instructions

When executing this skill, the agent MUST:

1.  **Identify the target editor(s)** up front:
    -   Content Fragment Editor (CFE) extension, Universal Editor (UE)
        extension, or both.
2.  **Pin down extension points** and the host UI context they provide
    (selection, entity IDs, authoring context, events).
3.  **Verify extension point feasibility**:
    -   If any extension point is uncertain, include a verification
        checklist with links to `docs/knowledge-base.md`.
4.  **Map UI → backend responsibilities**:
    -   What runs in the UI extension (React) vs what runs as App
        Builder actions.
5.  **Assume the App Builder app already exists**:
    -   The agent must plan using a user-provided configuration, not by
        creating a new app from scratch.
6.  **Security-first design**:
    -   Explicitly cover IMS scopes, secrets, token handling, and
        least-privilege access.
7.  **Environment strategy**:
    -   Dev/stage/prod configuration separation, promotion steps, and
        rollback notes.
8.  **Deliver structured outputs** exactly per the Output Contract
    below.

The agent SHOULD: - Call out performance risks (cold starts, chatty API
calls, large payloads) and propose mitigations. - Include
telemetry/logging from day one. - Propose a clear integration-test
approach inside the host editor.

The agent MUST NOT: - Produce large code implementations (small
illustrative snippets are OK) unless explicitly asked. - Invent
extension points; if unsure, list verification steps and cite official
docs via the knowledge base.

------------------------------------------------------------------------

## Required Inputs

-   Extension target: **Content Fragment Editor** or **Universal
    Editor**
-   Extension point(s) to use
-   Business objective and user stories
-   App Builder configuration (provided by the user)
-   Target environments (dev/stage/prod)
-   Security constraints (IMS scopes, data residency, compliance)

------------------------------------------------------------------------

## Output Contract

The output MUST include:

1.  **Executive Summary**
2.  **Host & Extension Point Matrix**
    -   Host: CFE / UE
    -   Extension point(s)
    -   Context available from host
    -   UX affordances (where it shows up, user flow)
3.  **Architecture Diagram Description**
4.  **Extension → Action Mapping Table**
5.  **Security Design**
    -   Auth model, IMS scopes, token flow, secrets, permission checks
6.  **Storage + State Design**
7.  **Deployment + Promotion Strategy**
8.  **Testing Strategy**
    -   Unit, integration (host), e2e smoke checks
9.  **Risk Assessment + Mitigations**
10. **Open Questions / Verification Checklist**

-   Anything that must be confirmed in official docs; point to
    `docs/knowledge-base.md`

------------------------------------------------------------------------

## Example Usage Prompts

### Content Fragment Editor (CFE)

""" Use analyze-and-plan to design an App Builder app for an AEM Content
Fragment Editor extension. Add a toolbar button in the editor that opens
a modal to run an AI-based rewrite suggestion on the selected field. The
backend action must call an external API and write the approved
suggestion back to the fragment via AEM APIs. Environments: dev and
stage. The App Builder config will be provided. """

### Universal Editor (UE)

""" Use analyze-and-plan to design an App Builder app for a Universal
Editor UI extension. The extension should add a panel that lets authors
validate page content against a custom checklist and show actionable
fixes. Backend actions should fetch validation rules from an internal
service and optionally create tasks via a REST API. Environments: dev,
stage, prod. The App Builder config will be provided. """
