---
name: dev-console-context
description: Use when the user mentions Developer Console, projects, workspaces, credentials, or orgs — or uses phrases like "show my projects", "project details", "get project information", "describe this project", "who created this project", "list workspaces", "get credentials", "switch project", "which org", "my org", "which organization am I logged into", "default org", "show all organizations", "switch org", "console", "navigate", "explore", "what projects do I have", "show credentials", "what workspace". Also use as the first step of the I/O Events registration and filtering flows — phrases like "subscribe to events", "register for events", "set up webhook", "event registration", "I/O Events", "add filter", "subscriber filter", "test my registration", "sample event" — to establish the org/project/workspace/credential context those flows are scoped to. Maintains a live breadcrumb showing exactly where the user is at all times.
license: Apache-2.0
---

**Mandatory prerequisite:** Before starting this skill, read and apply [Common Skill Rules](references/common-rules.md).


# Console Context Navigator

Track and display the selected organization and resource context within the authenticated account. Organization selection is MCP conversation context, not the Console UI's selection. Navigation replies include a live breadcrumb that grows as the user drills deeper.

## Breadcrumb format

Place this on the first line of navigation replies, but omit it for information-only organization listings so the listing contains only the fields specified below:

```
📍 [Org: {orgName} ({orgId})]
📍 [Org: {orgName} ({orgId})] › [Project: {projectName} ({projectId})]
📍 [Org: {orgName} ({orgId})] › [Project: {projectName} ({projectId})] › [Workspace: {workspaceName} ({workspaceId})]
📍 [Org: {orgName} ({orgId})] › [Project: {projectName} ({projectId})] › [Workspace: {workspaceName} ({workspaceId})] › [Credential: {credentialName} ({credentialType}) ({credentialId})]
```

Rules:
- Start with only what's confirmed — never show a placeholder or "unknown"
- Grow the breadcrumb as each level is selected, never shrink it
- Show name and ID together (e.g. `My Org (12345)`) — never show just raw IDs alone
- If the user changes organization, project, workspace, or credential, update from that level forward using the shared account-org access rules.

## Organization information requests

- Apply the [shared account-org access rules](references/common-rules.md#account-organization-access-console-and-events).
- Treat general/plural/access-listing requests as all-account inventory using the shared rules, even without the words "all accounts". Fetch that inventory rather than replying with the working org, an account-only subset, or Console/org-switcher advice. Answer a singular working-org question with the one confirmed selected org, not the inventory.
- Keep account-scoped selection results separate from all-account inventory results. An inventory request must not change the selected org or become an operation allowlist.
- When listing organizations, show only their names and user roles and nothing else.
- For "my org"/"current org" with no confirmed selection, or "which orgs can I switch to?", show all orgs under the authenticated account per the shared rules.
- Do not claim that login metadata reveals the Console UI's currently selected org. Report lookup errors rather than guessing.
- For an information-only request, stop at organization level after resolving the requested answer; do not fetch projects, workspaces, or credentials. Do not ask for a selection merely to display the all-account inventory.

## Project information requests

Use this flow whenever the user asks for information about a particular project:

- Reuse confirmed organization and project context. Resolve missing org context with `get_organisations` using `includeAllAccounts: false`, and missing project context with `get_projects`. If the user names a project without its ID, use `get_projects` with `filterBy: "all"` to find it; ask for a selection only if the target is ambiguous.
- Call `get_project_by_id` with `consumerOrgId` and `projectId`. It pulls in profile information for the users who created or modified the project.
- Show the requested details from that response: project name/title, description, type, enabled/deleted status, creation/modification dates, and creator/modifier information when present. Do not infer missing details.
- For an information-only request, stop at project level. Do not fetch workspaces or credentials unless the user also asks for them.

## Navigation flow

### Step 1 — Org
Resolve the target organization using the shared account-org access rules, then retain its ID and IMS code for the remaining flow. For information-only org requests, use the flow above and stop at organization level.

### Step 2 — Project
If the user wants to create a new project, do not list existing projects; hand off to `dev-console-create-project`, preserving the selected org context.

For project-information requests, use the flow above instead of project browsing.

Follow the [shared option-selection rules](references/common-rules.md#options-and-selections) to resolve project reuse, creation, and empty results.

When a project lookup is needed, call `get_projects` with `filterBy: "all"` unless the user asked for only their projects (`filterBy: "me"`). An empty "mine" result does not establish that the organization has no projects.

For project browsing:
- Sort the returned projects by `date_last_modified`, newest first. Put missing or invalid dates last without inventing timestamps.
- Show at most **10 projects per batch** as a clean numbered list (title + last modified date, no raw IDs). State the displayed range and total, for example "Showing 1-10 of 27 projects, most recently modified first."
- Offer **"Show more"** only when unseen projects remain. On request, show the next batch of up to 10 projects with continuous numbering; do not repeat earlier entries.
- `get_projects` returns an array; retain that response for the selected organization and filter and reuse it for subsequent display batches rather than refetching. Restart browsing when the organization or filter changes.
- Resolve a project named by the user against the entire returned list, not just the displayed batch. Likewise, use the full result for empty-list and single-option decisions.

### Step 3 — Workspace
Reuse a confirmed workspace selection or workspace details returned by project creation; otherwise call `list_workspaces` for the chosen project. If only one workspace is returned (default projects always have a single **Production** workspace), select it automatically without asking. If multiple workspaces exist, show them as a numbered list and ask the user to pick.

### Step 4 — Credential (optional)
If the user wants to go deeper, call `get_credentials` for the chosen workspace. For each credential also call `get_credential_services` to show subscribed APIs. Include, for each credential: name, type, client ID (if applicable), and subscribed APIs (or "none yet"). The layout below is a reference for content, not a literal template — adjust formatting as needed for the client:

```
🔑 Credential: "My S2S Cred"  (OAuth Server-to-Server)
   Client ID:  xxxxxxxxxxxxxxx
   APIs:       Adobe Analytics, Firefly API

🔑 Credential: "My Web Cred"  (AdobeId / WebApp)
   APIs:       none yet
```

Ask the user which credential to work with, or say *"none"* to stay at workspace level.

## Context summary

Once the full context is set, summarize it for the user before proceeding — org, project, workspace, and credential (if selected), each with name and ID together. Box-drawing layouts like the one below don't render reliably in every client (e.g. Claude Desktop), so treat it as a reference for *what* to include, not a literal template to reproduce — a plain list or short paragraph is fine:

```
📍 Console Context
Org:         My Org Name  (12345)
Project:     My Project  (111222333444555666)
Workspace:   Production  (777888999000111222)
Credential:  My S2S Cred (OAuth S2S)  (99001)
```

## When Instructions Are Unclear

If the user references an Adobe concept, project type, or Console feature you're unsure about — call `search_adobe_docs` before asking for clarification. For example:

- Unsure what a project type means → search *"Adobe Developer Console project types App Builder default"*
- User mentions a workspace concept you don't recognise → search *"Adobe Developer Console workspace"*
- Unclear what a credential field means → search *"Adobe Developer Console credential {field name}"*

Always prefer fetching from official docs over guessing.

---

## Rules

- If the user says something like *"switch project"* or *"go back"*, reset from that resource level and re-navigate within the selected org.
- For *"switch org"* (or any request to use or work in a named org), first validate the target against the account-scoped orgs per the shared rules. If it is inside the account, reset child resource context and switch. If it is outside the account, deny per the shared rules and keep the current selection; never confirm a switch to it. If no target is named, show the account's orgs per the shared rules. Do not claim to have changed the Console UI's selection.
- This skill sets context — it does not subscribe APIs. For subscribing, hand off to `/dev-console-subscribe-api` with the established context
