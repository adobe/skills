# App Builder Action Scaffolder Playbook

## Goal
Create well-structured Adobe Runtime actions with consistent layout, validation, and error handling.

## Category Context
Architecture and Runtime: Action design, contracts, orchestration, and runtime constraints

## Execution Flow
1. Define scope boundary: what is in and out for this request.
2. Gather evidence: code state, config state, and runtime dependencies.
3. Design the minimum safe change that achieves the target outcome.
4. Implement with deterministic checks where possible.
5. Validate behavior and non-functional impact.
6. Produce concise handoff notes with unresolved risks.

## Decision Rules
- Prefer explicit contracts over implicit assumptions.
- Avoid one-off fixes when a reusable pattern is possible.
- Keep backward compatibility unless a controlled breaking change is approved.
- Surface security and compliance impacts before release decisions.

## Typical Artifacts
- Implementation changes in source and configuration files
- Test or verification outputs tied to acceptance criteria
- Operational notes for deployment and support teams

## Manifest Guardrail
In `app.config.yaml`, define actions under `application.runtimeManifest`.
Root-level `runtimeManifest` is invalid for App Builder action discovery.
From the project root, run: `python3 skills/_shared/scripts/validate_manifest_structure.py <path-to-app.config.yaml>`.
