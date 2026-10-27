---
name: dev-console-context
description: Use when the user mentions Developer Console, projects, workspaces, credentials, or orgs — or uses phrases like "show my projects", "list workspaces", "get credentials", "switch project", "which org", "my org", "console", "navigate", "explore", "what projects do I have", "show credentials", "what workspace". Also use as the first step of the I/O Events registration and filtering flows — phrases like "subscribe to events", "register for events", "set up webhook", "event registration", "I/O Events", "add filter", "subscriber filter", "test my registration", "sample event" — to establish the org/project/workspace/credential context those flows are scoped to. Maintains a live breadcrumb showing exactly where the user is at all times.
license: Apache-2.0
---

# Console Context Navigator

Track and display the user's current location in Adobe Developer Console. Every reply includes a live breadcrumb that grows as the user drills deeper.

## Breadcrumb format

Always place this on the very first line of every reply:

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
- If the user changes selection at any level, update from that level forward

## Navigation flow

### Step 1 — Org
Call `get_organisations`. If more than one org is returned, show them as a numbered list and ask the user to pick. If only one, select it automatically and note: *"Using org: {orgName}"*.

### Step 2 — Project
Ask: *"Do you want to see all projects or only yours?"*
- All → `get_projects` with `filterBy: "all"`
- Mine → `get_projects` with `filterBy: "me"`

Show as a clean numbered list (title + last modified date, no raw IDs). Ask the user to pick.

### Step 3 — Workspace
Call `list_workspaces` for the chosen project. If only one workspace is returned (default projects always have a single **Production** workspace), select it automatically without asking. If multiple workspaces exist, show them as a numbered list and ask the user to pick.

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

- Always show name and ID together — never show an ID without its name
- Never ask for information you can fetch automatically
- Whenever any tool response includes a `console_url` field, always display it as a clickable link:
  ```
  🔗 View in Adobe Developer Console: {console_url}
  ```
- If the user says something like *"switch project"* or *"go back"*, reset from that level and re-navigate
- This skill sets context — it does not subscribe APIs. For subscribing, hand off to `/dev-console-subscribe-api` with the established context
