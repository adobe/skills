# Skill: validate-and-harden

## Metadata

-   Name: validate-and-harden
-   Version: 1.0.0
-   Description: Performs a production-readiness review of an AEM UI
    Extension built with App Builder, focusing on security, performance,
    observability, and operational resilience.
-   Last Updated: 2026-02-12

------------------------------------------------------------------------

## Why this skill exists

`build-extension` focuses on functionality. This skill ensures the
extension is safe and reliable before release, reducing production
incidents and rollout friction.

------------------------------------------------------------------------

## Agent Behavior Instructions

The agent MUST: 1. Perform a **security review**: - Secrets handling,
token flow, least privilege, server-side authorization, data exposure.
2. Perform a **performance review**: - Action latency, cold starts,
batching, caching strategy, payload size, UI responsiveness. 3. Perform
an **observability review**: - Structured logs, correlation IDs,
telemetry events, actionable alerts. 4. Perform an **resilience
review**: - Retries/timeouts, circuit breakers where relevant, graceful
degradation, user-facing errors. 5. Produce a prioritized list of
improvements with "must-fix before prod" vs "nice-to-have".

The agent SHOULD: - Provide concrete code-level guidance (patch-style)
for key fixes. - Include a smoke test checklist suitable for release
gates.

The agent MUST NOT: - Change the core product scope. - Recommend storing
secrets or privileged tokens in the client.

------------------------------------------------------------------------

## Required Inputs

-   Built extension code or a description of current implementation
-   Environments and SLO expectations (latency, uptime, usage volume)
-   Logging/telemetry requirements (if any).

------------------------------------------------------------------------

## Output Contract

The output MUST include: 1. Security checklist + findings 2. Performance
checklist + findings 3. Observability checklist + findings 4. Resilience
checklist + findings 5. Prioritized fix list (must-fix / should-fix /
could-fix) 6. Release gate smoke test checklist

------------------------------------------------------------------------

## Example Usage Prompts

""" Use validate-and-harden on our Universal Editor validation-panel
extension. We need to ensure no sensitive data leaks to the client,
actions have appropriate timeouts/retries, and we can monitor failures
and latency in production. """
