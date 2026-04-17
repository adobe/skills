# Skills Framework

## Overview

This folder contains the Adobe App Builder agent skills maintained in this repository.Each skill packages instructions, references, and helper assets for a focused App Builder workflow.This README is for human maintainers; agents should start from each skill's `SKILL.md`.

## Skills inventory

| Name | Purpose | Status |
| --- | --- | --- |
| appbuilder-project-init | Initialize new Adobe App Builder projects and choose the right bootstrap path. | Active |
| appbuilder-action-scaffolder | Scaffold, implement, deploy, and debug Adobe Runtime actions. | Active |
| appbuilder-testing | Generate and run Jest tests for App Builder actions and React Spectrum UI components. | Active |
| appbuilder-cicd-pipeline | Set up CI/CD pipelines (GitHub Actions, Azure DevOps, GitLab CI). | Active |
| appbuilder-ui-scaffolder | Generate React Spectrum UI components for ExC Shell SPAs. | Active |
| appbuilder-e2e-testing | Playwright browser E2E tests for ExC Shell SPAs and AEM extensions. | Active |
| _shared | Shared guardrails, validation scripts, and runtime references used across skills. | Shared support |

## Architecture

Each skill lives in `skills/<skill-name>/` and is usually organized as:

- `SKILL.md` — canonical skill entry point with frontmatter
- `scripts/` — helper automation used by the skill
- `references/` — deeper docs, playbooks, and checklists
- `assets/` — templates or other static resources used during execution
- optional integration metadata such as `agents/` when platform-specific configuration is needed

## The `_shared` convention

`skills/_shared/` is intentionally shared across skills.It contains cross-skill resources that would be duplicated otherwise, including guardrails, validation scripts, and runtime or architecture references.Treat `_shared/` as a support library, not as a standalone skill.

## Skill chaining

`appbuilder-project-init` handles project creation, template selection, and initial scaffolding. From there, two main workflows branch out:

- **Actions path**: `appbuilder-project-init` → `appbuilder-action-scaffolder` → `appbuilder-testing` → `appbuilder-cicd-pipeline`
- **UI path**: `appbuilder-project-init` → `appbuilder-ui-scaffolder` → `appbuilder-testing` → `appbuilder-cicd-pipeline`
- **E2E path**: `appbuilder-ui-scaffolder` or `appbuilder-testing` → `appbuilder-e2e-testing` → `appbuilder-cicd-pipeline`

When the project exists and the next task is adding or refining Runtime actions, hand off to `appbuilder-action-scaffolder` for action implementation, manifest wiring, validation, deploy, and debugging workflows. For UI work, hand off to `appbuilder-ui-scaffolder` to generate React Spectrum components for ExC Shell SPAs. Once code is in place, use `appbuilder-testing` to generate and run Jest tests, then `appbuilder-cicd-pipeline` to set up continuous integration and deployment. For browser-level E2E validation, use `appbuilder-e2e-testing` to generate Playwright tests for ExC Shell SPAs and AEM extensions.

## Spec compliance

These skills follow the Agent Skills spec at [agentskills.io](https://agentskills.io/specification).In practice, that means each skill is centered on a `SKILL.md` file with frontmatter and keeps supporting materials close by in standard subdirectories.

## Adding a new skill

1. Create a new directory at `skills/<new-skill-name>/`.
2. Add `SKILL.md` with the required frontmatter and a concise skill body.
3. Put automation in `scripts/`, extended docs in `references/`, and static artifacts in `assets/` as needed.
4. Use `_shared/` only for intentionally cross-skill resources; otherwise keep files local to the skill.
5. Check the finished layout against the Agent Skills spec before merging.