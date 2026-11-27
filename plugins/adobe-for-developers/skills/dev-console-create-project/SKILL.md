---
name: dev-console-create-project
description: Use when the user wants to create a new Adobe Developer Console project — phrases like "create a project", "new project", "set up a project", "create an App Builder project", or "start a new API project". Automatically resolves the name, including duplicates, without ever asking for naming input or confirmation. Creates an App Builder project only when the user explicitly requests "App Builder" or a "template" project; otherwise creates a default project without asking. Creates and initializes the project and reports the actual name and created type; for API subscription afterward, continue with dev-console-subscribe-api.
license: Apache-2.0
---

**Mandatory prerequisite:** Before starting this skill, read and apply [Common Skill Rules](references/common-rules.md).


# Create Project

Create and initialize an Adobe Developer Console project in a selected organization under the authenticated account. Both project types use the same flow and the same `create_project` tool; only the `projectType` argument differs.

## Steps

1. **Resolve the project type from explicit user signals** — Use only explicit instructions for the project being created, from the current request or earlier conversation. Follow the most recent explicit instruction:
   - The user explicitly requests "App Builder" or a "template" project → `projectType: "appBuilder"`.
   - The user explicitly requests a default/empty project or rejects App Builder/templates → `projectType: "default"`.
   - No explicit App Builder/template request for this project → `projectType: "default"`.

   Never infer App Builder from requested APIs, credentials, runtime features, project names, other skills, or prior projects. Unrelated or negated mentions of "App Builder" or "template", including documentation discussions, do not count as a request. Do not ask the user to choose or confirm the project type.

   Steps 2–5 are identical for both types.

2. **Resolve the organization** — Follow the [shared account-org access rules](references/common-rules.md#account-organization-access-console-and-events). Use the selected org's `id` as `consumerOrgId`, keeping IDs internal.

3. **Resolve project naming** — If the user supplied a project name or title for this project, use it, deriving the missing name/title per the [shared naming rules](references/common-rules.md#names-titles-and-descriptions). Otherwise call `get_next_project_name` with the selected `consumerOrgId` and use the returned `name` and `title` exactly. Do not list projects, generate a name yourself, or ask the user for a name or confirmation.

4. **Create and initialize the project** — Call `create_project` with the selected `consumerOrgId`, the resolved `name` and `title`, and the `projectType` from step 1. Do not pass a template ID or workspace details; the tool sets up the project for the chosen type:
   - Default project: creates the project with its default workspace.
   - App Builder template project: creates the project from the App Builder template together with **Production** and **Stage** workspaces, both with runtime enabled.

   If creation fails with an explicit duplicate-name rejection, call `get_next_project_name` again and retry once with the new `name` and `title`. Keep the resolved project type; never ask for a replacement name or reopen the project-type choice.

5. **Report the result** — On success, report the name/title submitted to the tool and explicitly state the created project's type:
   - Default: "Created **{title}** as a **default project**."
   - App Builder: "Created **{title}** as an **App Builder template project**, with **Production** and **Stage** workspaces, both with runtime enabled."

   Retain the returned `projectId` and any workspace IDs for follow-up, but do not display raw IDs. If the response does not include workspace details, call `list_workspaces` for the created project. If the response includes `console_url`, display it as:
   `🔗 View in Adobe Developer Console: {console_url}`

If the user also wants to subscribe an API, continue with `dev-console-subscribe-api` skill using the created org, project, and workspace context. For an App Builder template project with more than one workspace, ask which workspace to use (Production or Stage) unless the user already said. Do not ask the user to select or re-enter IDs already returned by project creation.

## Rules

- This skill creates a project only; it does not create credentials or subscribe APIs.
- Do not call `create_project` until the project type, organization, and project name are known.
- Do not ask for custom workspace names, descriptions, or template choices; the connector does not accept them.
- Do not claim success if the tool returns an error or an ambiguous result.
